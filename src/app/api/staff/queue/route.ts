import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';

export async function GET(_req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: access.status });
  }

  // Explicit select, mirroring src/app/api/staff/claimants/route.ts. The
  // previous `include: { claim: { include: { claimant: true } } }` shipped the
  // entire ClaimantProfile row — ssnEncrypted, dateOfBirth, phone,
  // mailingAddress — to the browser, even though the consuming page
  // (src/app/staff/dashboard/page.tsx) only renders the claimant's id and
  // legalName. Job-search activities are kept (a reviewer's queue item is the
  // natural place for them) but likewise field-scoped rather than splatted.
  const queue = await prisma.weeklyCertification.findMany({
    where: { autoDecision: 'FLAGGED', reviewActions: { none: {} } },
    select: {
      id: true,
      weekEndingDate: true,
      submittedAt: true,
      autoDecision: true,
      autoDecisionReason: true,
      claim: {
        select: {
          id: true,
          status: true,
          claimant: { select: { id: true, legalName: true } },
        },
      },
      jobSearchActivities: {
        select: {
          id: true,
          employerName: true,
          contactMethod: true,
          contactDate: true,
          position: true,
        },
      },
    },
    orderBy: { submittedAt: 'asc' },
  });
  return Response.json(queue);
}
