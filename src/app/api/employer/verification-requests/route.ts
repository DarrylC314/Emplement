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

  const requests = await prisma.credentialVerificationRequest.findMany({
    where: { organizationId: session!.user.employerProfileId, status: 'AUTHORIZED' },
    orderBy: { authorizedAt: 'asc' },
    select: {
      id: true,
      credentialType: true,
      requestedTitle: true,
      authorizedAt: true,
      claimantProfile: { select: { legalName: true } },
    },
  });

  return Response.json(requests);
}
