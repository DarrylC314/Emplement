import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { feinVerificationSchema } from '@/lib/validation/feinVerification';
import { verifyFein } from '@/lib/mockFeinVerify';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.employerProfileId) {
    return apiError('Employer profile not found', 404);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = feinVerificationSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const employerProfile = await prisma.employerProfile.findUnique({
    where: { id: session!.user.employerProfileId },
    select: { verificationStatus: true },
  });
  if (!employerProfile) {
    return apiError('Employer profile not found', 404);
  }
  // Spec: one login per company for this phase. Without this check, an
  // already-verified employer could re-run verification and silently hop to
  // a different FEIN, orphaning historical AuditLog/WageRecord/
  // EmploymentEvent associations built under the old FEIN.
  if (employerProfile.verificationStatus === 'VERIFIED') {
    return apiError('Your company is already verified.', 409);
  }

  const { verified } = verifyFein(parsed.data.fein, parsed.data.companyName);
  if (!verified) {
    return apiError('We could not verify that FEIN. Please check it and try again.', 400);
  }

  try {
    await prisma.employerProfile.update({
      where: { id: session!.user.employerProfileId },
      data: {
        fein: parsed.data.fein,
        companyName: parsed.data.companyName,
        verificationStatus: 'VERIFIED',
      },
    });
  } catch (err) {
    // EmployerProfile.fein is @unique. A collision means another account
    // already holds this FEIN — the message deliberately mirrors the
    // FEIN-verification-failed wording above so we don't leak which FEINs
    // are already registered to someone else.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return apiError('We could not verify that FEIN. Please check it and try again.', 409);
    }
    // P2025: the row `update` targeted no longer exists. The `findUnique`
    // check above already guards the common case, but the profile could
    // still be deleted in the gap between that read and this write — or, if
    // this session's JWT was ever minted against a profile that's since
    // been removed, the row was never there to begin with. Either way this
    // is a data-integrity edge case, not a privacy-sensitive one, so a plain
    // 404 is fine.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
      return apiError('Employer profile not found. Please sign in again.', 404);
    }
    throw err;
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'EMPLOYER_FEIN_VERIFIED',
    targetEntity: 'EmployerProfile',
    targetId: session!.user.employerProfileId,
  });

  return Response.json({ status: 'VERIFIED' }, { status: 200 });
}
