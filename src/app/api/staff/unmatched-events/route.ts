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

  const events = await prisma.employmentEvent.findMany({
    where: { matchedClaimantProfileId: null, dismissedAt: null },
    orderBy: { eventDate: 'desc' },
    select: {
      id: true,
      type: true,
      employeeName: true,
      eventDate: true,
      createdAt: true,
      employer: { select: { companyName: true } },
    },
  });

  return Response.json(events);
}
