import { prisma } from '@/lib/prisma';
import { generateMockWageRecords } from '@/lib/mockWageLookup';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireOwnership, requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const body = await parseJson<{ claimId?: string }>(req);
  if (!body) return invalidBody();

  const { claimId } = body;
  if (!claimId) {
    return apiError('claimId is required', 400);
  }

  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  if (!claim) {
    return apiError('Claim not found', 404);
  }

  const owns = requireOwnership(session, claim.claimantId);
  if (!owns.ok) {
    return apiError('Forbidden', owns.status);
  }

  const result = await prisma.$transaction(async (tx) => {
    // Advisory lock keyed by claimId, held for the transaction: serializes
    // concurrent lookups for the SAME claim (e.g. React Strict Mode's
    // deliberate double-invocation of a mount effect) so only one ever
    // performs the actual generate+create — without needing a new unique
    // constraint on WageRecord.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${claimId}))`;

    const priorLookup = await tx.auditLog.findFirst({
      where: { targetEntity: 'Claim', targetId: claimId, action: 'WAGE_LOOKUP_PERFORMED' },
    });
    if (priorLookup) {
      const existing = await tx.wageRecord.findMany({ where: { claimId } });
      return { records: existing, status: 200 as const };
    }

    const mockRecords = generateMockWageRecords(claimId);
    const created = await Promise.all(
      mockRecords.map((r) =>
        tx.wageRecord.create({
          data: {
            claimId,
            employerName: r.employerName,
            fein: r.fein,
            workLocation: r.workLocation,
            jobTitle: r.jobTitle,
            firstDayWorked: r.firstDayWorked,
            lastDayWorked: r.lastDayWorked,
            wageRate: r.wageRate,
            hoursPerWeek: r.hoursPerWeek,
            separationReason: r.separationReason,
            recallDate: r.recallDate,
            source: 'Simulated state wage database lookup',
          },
        })
      )
    );

    // Inlined rather than the shared writeAuditLog helper: this write must
    // participate in the same transaction as the lock/check/create above,
    // and writeAuditLog always uses the global prisma client, not a tx client.
    await tx.auditLog.create({
      data: {
        actorUserId: session!.user.id,
        action: 'WAGE_LOOKUP_PERFORMED',
        targetEntity: 'Claim',
        targetId: claimId,
        metadata: { recordCount: created.length },
      },
    });

    return { records: created, status: 201 as const };
  });

  return Response.json(result.records, { status: result.status });
}
