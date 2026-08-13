import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';

export async function GET(_req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const queue = await prisma.weeklyCertification.findMany({
    where: { autoDecision: 'FLAGGED', reviewActions: { none: {} } },
    include: {
      claim: { include: { claimant: true } },
      jobSearchActivities: true,
    },
    orderBy: { submittedAt: 'asc' },
  });
  return Response.json(queue);
}
