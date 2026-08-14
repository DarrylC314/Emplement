import { prisma } from '@/lib/prisma';
import { employerWageRecordUpdateSchema } from '@/lib/validation/employerWageRecord';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.employerProfileId) {
    return apiError('Employer profile not found', 404);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = employerWageRecordUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const employerProfile = await prisma.employerProfile.findUnique({
    where: { id: session!.user.employerProfileId },
    select: { fein: true, verificationStatus: true },
  });
  if (!employerProfile || employerProfile.verificationStatus !== 'VERIFIED' || !employerProfile.fein) {
    return apiError('Employer account is not verified', 403);
  }

  const record = await prisma.wageRecord.findUnique({
    where: { id: params.id },
    select: { fein: true },
  });
  if (!record) {
    return apiError('Wage record not found', 404);
  }
  if (record.fein !== employerProfile.fein) {
    return apiError('Forbidden', 403);
  }

  const updated = await prisma.wageRecord.update({
    where: { id: params.id },
    data: {
      employerVerifiedStatus: parsed.data.disputeNote ? 'DISPUTED' : 'VERIFIED',
      employerDisputeNote: parsed.data.disputeNote ?? null,
    },
    select: {
      id: true,
      employerName: true,
      workLocation: true,
      jobTitle: true,
      firstDayWorked: true,
      lastDayWorked: true,
      wageRate: true,
      hoursPerWeek: true,
      separationReason: true,
      recallDate: true,
      employerVerifiedStatus: true,
      employerDisputeNote: true,
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: parsed.data.disputeNote ? 'WAGE_RECORD_DISPUTED_BY_EMPLOYER' : 'WAGE_RECORD_VERIFIED_BY_EMPLOYER',
    targetEntity: 'WageRecord',
    targetId: params.id,
  });

  return Response.json(updated, { status: 200 });
}
