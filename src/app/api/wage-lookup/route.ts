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

  const existing = await prisma.wageRecord.findMany({ where: { claimId } });
  if (existing.length > 0) {
    return Response.json(existing, { status: 200 });
  }

  const mockRecords = generateMockWageRecords(claimId);
  const created = await Promise.all(
    mockRecords.map((r) =>
      prisma.wageRecord.create({
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

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'WAGE_LOOKUP_PERFORMED',
    targetEntity: 'Claim',
    targetId: claimId,
    metadata: { recordCount: created.length },
  });

  return Response.json(created, { status: 201 });
}
