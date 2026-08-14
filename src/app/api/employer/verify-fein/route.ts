import { prisma } from '@/lib/prisma';
import { feinVerificationSchema } from '@/lib/validation/feinVerification';
import { verifyFein } from '@/lib/mockFeinVerify';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

export async function POST(req: Request) {
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

  const parsed = feinVerificationSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const { verified } = verifyFein(parsed.data.fein, parsed.data.companyName);
  if (!verified) {
    return apiError('We could not verify that FEIN. Please check it and try again.', 400);
  }

  await prisma.employerProfile.update({
    where: { id: session!.user.employerProfileId },
    data: {
      fein: parsed.data.fein,
      companyName: parsed.data.companyName,
      verificationStatus: 'VERIFIED',
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'EMPLOYER_FEIN_VERIFIED',
    targetEntity: 'EmployerProfile',
    targetId: session!.user.employerProfileId,
  });

  return Response.json({ status: 'VERIFIED' }, { status: 200 });
}
