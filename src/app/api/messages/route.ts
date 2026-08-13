import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const { claimantProfileId, caseworkerId, subject, body } = await req.json();
  if (!claimantProfileId || !subject || !body) {
    return Response.json({ error: 'claimantProfileId, subject, and body are required' }, { status: 400 });
  }
  const message = await prisma.message.create({
    data: { claimantId: claimantProfileId, caseworkerId: caseworkerId ?? null, subject, body },
  });
  return Response.json(message, { status: 201 });
}

export async function GET(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT', 'CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const url = new URL(req.url);
  const claimantProfileId = url.searchParams.get('claimantProfileId');
  if (!claimantProfileId) {
    return Response.json({ error: 'claimantProfileId is required' }, { status: 400 });
  }

  const user = session!.user;
  if (user.role === 'CLAIMANT' && user.claimantProfileId !== claimantProfileId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const messages = await prisma.message.findMany({
    where: { claimantId: claimantProfileId },
    orderBy: { sentAt: 'desc' },
  });
  await prisma.message.updateMany({
    where: { claimantId: claimantProfileId, readAt: null },
    data: { readAt: new Date() },
  });
  return Response.json(messages);
}
