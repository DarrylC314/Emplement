import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT', 'CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const claim = await prisma.claim.findUnique({
    where: { id: params.id },
    include: {
      certifications: {
        include: { jobSearchActivities: true },
        orderBy: { weekEndingDate: 'desc' },
      },
      caseNotes: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!claim) {
    return Response.json({ error: 'Claim not found' }, { status: 404 });
  }

  const user = session!.user;
  if (user.role === 'CLAIMANT' && user.claimantProfileId !== claim.claimantId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  return Response.json(claim);
}
