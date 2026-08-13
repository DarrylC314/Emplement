import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireOwnership, requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT', 'CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
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
    return apiError('Claim not found', 404);
  }

  const owns = requireOwnership(session, claim.claimantId);
  if (!owns.ok) {
    return apiError('Forbidden', owns.status);
  }

  return Response.json(claim);
}
