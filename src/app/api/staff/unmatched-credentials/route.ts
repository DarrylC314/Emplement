import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

export async function GET() {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const records = await prisma.credentialRecord.findMany({
    where: { matchedClaimantProfileId: null, dismissedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      type: true,
      title: true,
      eventDate: true,
      createdAt: true,
      organization: { select: { companyName: true } },
    },
  });

  return Response.json(records);
}
