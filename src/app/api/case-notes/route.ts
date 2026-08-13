import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const { claimId, caseworkerId, note } = await req.json();
  if (!claimId || !caseworkerId || !note) {
    return Response.json({ error: 'claimId, caseworkerId, and note are required' }, { status: 400 });
  }
  const created = await prisma.caseNote.create({
    data: { claimId, caseworkerId, note },
  });
  return Response.json(created, { status: 201 });
}
