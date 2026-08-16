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
    select: { verificationStatus: true },
  });
  if (!employerProfile || employerProfile.verificationStatus !== 'VERIFIED') {
    return apiError('Employer account is not verified', 403);
  }

  const candidates = await prisma.candidateProfile.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      headline: true,
      skills: true,
      bio: true,
      availability: true,
      tags: true,
      createdAt: true,
    },
  });

  return Response.json(candidates);
}
