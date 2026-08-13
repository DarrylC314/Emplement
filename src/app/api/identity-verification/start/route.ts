import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const { claimantProfileId } = await req.json();
  if (!claimantProfileId) {
    return Response.json({ error: 'claimantProfileId is required' }, { status: 400 });
  }

  const user = session!.user;
  if (user.role === 'CLAIMANT' && user.claimantProfileId !== claimantProfileId) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }

  const mockReferenceId = `mock-idv-${crypto.randomUUID()}`;
  await prisma.identityVerificationAttempt.create({
    data: {
      claimantId: claimantProfileId,
      mockProvider: 'MockIDProof',
      status: 'PENDING',
      mockReferenceId,
    },
  });

  return Response.json({ mockReferenceId }, { status: 200 });
}
