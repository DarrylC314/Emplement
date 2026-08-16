import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

// Thrown from inside the transaction below to force a full rollback — never
// caught anywhere except this file's own try/catch. See this task's brief
// for why a thrown error is used instead of returning null.
class ApplicationAlreadyResolvedError extends Error {}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.employerProfileId) {
    return apiError('Employer profile not found', 404);
  }

  const application = await prisma.jobApplication.findUnique({
    where: { id: params.id },
    select: {
      status: true,
      initiatedBy: true,
      jobPostingId: true,
      jobPosting: { select: { employerId: true } },
      candidateProfile: {
        select: {
          claimantProfileId: true,
          claimantProfile: { select: { legalName: true, ssnHash: true } },
        },
      },
    },
  });
  if (!application) {
    return apiError('Application not found', 404);
  }
  if (application.jobPosting.employerId !== session!.user.employerProfileId) {
    return apiError('Forbidden', 403);
  }
  if (application.status !== 'PENDING') {
    return apiError('This application has already been resolved', 409);
  }
  if (application.initiatedBy !== 'CANDIDATE') {
    return apiError('This application must be candidate-initiated before it can be hired', 409);
  }
  if (!application.candidateProfile.claimantProfile.ssnHash) {
    // Should be unreachable: candidate profile creation requires identity
    // verification, which is what populates ssnHash. Guarded anyway since
    // EmploymentEvent.ssnHash is a required, non-null column.
    return apiError('This candidate has not completed identity verification', 409);
  }

  const claimantProfileId = application.candidateProfile.claimantProfileId;
  const legalName = application.candidateProfile.claimantProfile.legalName ?? 'Unknown';
  const ssnHash = application.candidateProfile.claimantProfile.ssnHash;
  const jobPostingId = application.jobPostingId;
  const employerProfileId = session!.user.employerProfileId;

  let result;
  try {
    result = await prisma.$transaction(async (tx) => {
      // The JobPosting is the actual contended resource — only one
      // application on a posting can ever be hired. Gating here first, before
      // touching the specific application, is what prevents two different
      // PENDING applications on the same posting from both being hired by a
      // race between two concurrent requests.
      const filledPosting = await tx.jobPosting.updateMany({
        where: { id: jobPostingId, status: 'OPEN' },
        data: { status: 'FILLED' },
      });
      if (filledPosting.count === 0) {
        throw new ApplicationAlreadyResolvedError();
      }

      const hiredApplication = await tx.jobApplication.updateMany({
        where: { id: params.id, status: 'PENDING' },
        data: { status: 'HIRED' },
      });
      if (hiredApplication.count === 0) {
        // The posting-level gate above already succeeded, but this specific
        // application had independently already been resolved (e.g.
        // rejected before this request arrived) — throwing here rolls back
        // the posting flip too, so the transaction has no partial effect.
        throw new ApplicationAlreadyResolvedError();
      }

      const rejectedApplications = await tx.jobApplication.updateMany({
        where: { jobPostingId, status: 'PENDING' },
        data: { status: 'REJECTED' },
      });

      const event = await tx.employmentEvent.create({
        data: {
          employerId: employerProfileId,
          type: 'HIRE',
          employeeName: legalName,
          ssnHash,
          eventDate: new Date(),
          matchedClaimantProfileId: claimantProfileId,
        },
      });

      const restrictedClaims = await tx.claim.updateMany({
        where: { claimantId: claimantProfileId, status: 'ACTIVE' },
        data: { status: 'RESTRICTED' },
      });

      const message = await tx.message.create({
        data: {
          claimantId: claimantProfileId,
          caseworkerId: null,
          subject: 'Your claim status has changed',
          body: 'Your claim status was updated to Restricted because you were hired through the Emplement marketplace. If you believe this is a mistake, please contact your caseworker.',
        },
      });

      return {
        event,
        message,
        autoRejectedCount: rejectedApplications.count,
        restrictedClaimCount: restrictedClaims.count,
      };
    });
  } catch (err) {
    if (err instanceof ApplicationAlreadyResolvedError) {
      return apiError('This application has already been resolved', 409);
    }
    throw err;
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'JOB_APPLICATION_HIRED',
    targetEntity: 'JobApplication',
    targetId: params.id,
    metadata: {
      employmentEventId: result.event.id,
      claimantProfileId,
      autoRejectedCount: result.autoRejectedCount,
      restrictedClaimCount: result.restrictedClaimCount,
    },
  });

  return Response.json({ id: params.id }, { status: 200 });
}
