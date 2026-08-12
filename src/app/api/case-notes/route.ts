import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const { claimId, caseworkerId, note } = await req.json();
  if (!claimId || !caseworkerId || !note) {
    return Response.json({ error: 'claimId, caseworkerId, and note are required' }, { status: 400 });
  }
  const created = await prisma.caseNote.create({
    data: { claimId, caseworkerId, note },
  });
  return Response.json(created, { status: 201 });
}
