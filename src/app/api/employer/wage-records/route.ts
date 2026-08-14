import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function GET() {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.employerProfileId) {
    return apiError('Employer profile not found', 404);
  }

  const employerProfile = await prisma.employerProfile.findUnique({
    where: { id: session!.user.employerProfileId },
    select: { fein: true, verificationStatus: true },
  });
  if (!employerProfile || employerProfile.verificationStatus !== 'VERIFIED' || !employerProfile.fein) {
    return apiError('Employer account is not verified', 403);
  }

  const wageRecords = await prisma.wageRecord.findMany({
    where: { fein: employerProfile.fein },
    select: {
      id: true,
      employerName: true,
      workLocation: true,
      jobTitle: true,
      firstDayWorked: true,
      lastDayWorked: true,
      wageRate: true,
      hoursPerWeek: true,
      separationReason: true,
      recallDate: true,
      employerVerifiedStatus: true,
      employerDisputeNote: true,
    },
  });

  return Response.json(wageRecords);
}
