import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { apiError } from '@/lib/apiRequest';

// Reverts exactly what the guided demo's Accept (POST
// /api/job-applications/[id]/interview/accept) and Hire (POST
// /api/employer/job-applications/[id]/hire) steps can mutate for Seed
// Claimant's Warehouse Associate application, so the guided demo is
// replayable. Not a general-purpose undo tool — scoped to this one
// walkthrough's own records. AuditLog rows are deliberately left alone:
// an appropriate permanent record even in a demo, and nothing in the
// walkthrough's own visibility depends on their absence.
export async function POST() {
  const session = await getServerAuthSession();
  if (!session) {
    return apiError('You must be logged in as a demo account first.', 401);
  }

  const claimantUser = await prisma.user.findUnique({
    where: { email: 'claimant@example.com' },
    select: {
      claimantProfile: {
        select: {
          id: true,
          claims: { select: { id: true }, take: 1 },
          candidateProfile: {
            select: {
              applications: {
                where: { jobPosting: { title: 'Warehouse Associate' } },
                select: { id: true },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  const claimantProfile = claimantUser?.claimantProfile;
  const claim = claimantProfile?.claims[0];
  const application = claimantProfile?.candidateProfile?.applications[0];
  if (!claimantProfile || !claim || !application) {
    return apiError('Guided demo data is not available in this environment.', 404);
  }

  await prisma.interview.update({
    where: { jobApplicationId: application.id },
    data: { status: 'PROPOSED', confirmedSlot: null },
  });

  const jobApplication = await prisma.jobApplication.update({
    where: { id: application.id },
    data: { status: 'PENDING' },
    select: { jobPostingId: true },
  });

  await prisma.jobPosting.update({
    where: { id: jobApplication.jobPostingId },
    data: { status: 'OPEN' },
  });

  await prisma.claim.update({
    where: { id: claim.id },
    data: { status: 'ACTIVE' },
  });

  await prisma.employmentEvent.deleteMany({
    where: { matchedClaimantProfileId: claimantProfile.id, type: 'HIRE' },
  });

  await prisma.message.deleteMany({
    where: { claimantId: claimantProfile.id, subject: 'Your claim status has changed' },
  });

  return Response.json({ reset: true });
}
