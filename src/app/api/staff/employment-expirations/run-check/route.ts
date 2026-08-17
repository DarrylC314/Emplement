import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';
import { runEmploymentExpirationCheck } from '@/lib/employmentExpiration';

export async function POST() {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const summary = await runEmploymentExpirationCheck({
    source: 'SYSTEM_MANUAL_CHECK',
    userId: session!.user.id,
  });

  return Response.json(summary, { status: 200 });
}
