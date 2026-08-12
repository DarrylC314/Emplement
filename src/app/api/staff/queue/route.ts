import { prisma } from '@/lib/prisma';

export async function GET(_req: Request) {
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
