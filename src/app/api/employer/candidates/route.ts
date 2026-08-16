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

  const candidates = await prisma.candidateProfile.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      headline: true,
      skills: true,
      bio: true,
      availability: true,
      createdAt: true,
    },
  });

  return Response.json(candidates);
}
