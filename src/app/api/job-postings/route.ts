import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function GET() {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const postings = await prisma.jobPosting.findMany({
    where: { status: 'OPEN' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      title: true,
      description: true,
      location: true,
      tags: true,
      createdAt: true,
      employer: { select: { companyName: true } },
    },
  });

  return Response.json(postings);
}
