import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const { claimId, note } = await req.json();
  if (!claimId || !note) {
    return Response.json({ error: 'claimId and note are required' }, { status: 400 });
  }
  // Attribution always comes from the verified session, never client input —
  // otherwise an authenticated caseworker could attribute a note to a colleague.
  const created = await prisma.caseNote.create({
    data: { claimId, caseworkerId: session!.user.id, note },
  });
  return Response.json(created, { status: 201 });
}
