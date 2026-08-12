import crypto from 'crypto';
import { prisma } from '@/lib/prisma';

export async function POST(req: Request) {
  const { claimantProfileId } = await req.json();
  if (!claimantProfileId) {
    return Response.json({ error: 'claimantProfileId is required' }, { status: 400 });
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
