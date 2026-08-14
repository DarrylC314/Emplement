import { prisma } from '@/lib/prisma';
import { wageRecordUpdateSchema } from '@/lib/validation/wageRecord';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireOwnership, requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = wageRecordUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const record = await prisma.wageRecord.findUnique({
    where: { id: params.id },
    select: { claim: { select: { claimantId: true } } },
  });
  if (!record) {
    return apiError('Wage record not found', 404);
  }

  const owns = requireOwnership(session, record.claim.claimantId);
  if (!owns.ok) {
    return apiError('Forbidden', owns.status);
  }

  const { confirmed, disputeNote, ...corrections } = parsed.data;

  const updated = await prisma.wageRecord.update({
    where: { id: params.id },
    data: {
      claimantConfirmed: confirmed,
      claimantDisputeNote: disputeNote ?? null,
      ...(corrections.employerName !== undefined && { employerName: corrections.employerName }),
      ...(corrections.fein !== undefined && { fein: corrections.fein }),
      ...(corrections.workLocation !== undefined && { workLocation: corrections.workLocation }),
      ...(corrections.jobTitle !== undefined && { jobTitle: corrections.jobTitle }),
      ...(corrections.wageRate !== undefined && { wageRate: corrections.wageRate }),
      ...(corrections.hoursPerWeek !== undefined && { hoursPerWeek: corrections.hoursPerWeek }),
      ...(corrections.separationReason !== undefined && {
        separationReason: corrections.separationReason,
      }),
      ...(corrections.firstDayWorked !== undefined && {
        firstDayWorked: new Date(corrections.firstDayWorked),
      }),
      ...(corrections.lastDayWorked !== undefined && {
        lastDayWorked: corrections.lastDayWorked === null ? null : new Date(corrections.lastDayWorked),
      }),
      ...(corrections.recallDate !== undefined && {
        recallDate: corrections.recallDate === null ? null : new Date(corrections.recallDate),
      }),
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: disputeNote ? 'WAGE_RECORD_CORRECTED' : 'WAGE_RECORD_CONFIRMED',
    targetEntity: 'WageRecord',
    targetId: params.id,
    metadata: {
      correctedFields: Object.keys(corrections).filter(
        (k) => corrections[k as keyof typeof corrections] !== undefined
      ),
    },
  });

  return Response.json(updated, { status: 200 });
}
