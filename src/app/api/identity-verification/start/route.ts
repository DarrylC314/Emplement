import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireOwnership, requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  // Spec: basic rate limiting on the identity-verification endpoints. Keyed by
  // the authenticated user (falling back to client IP) so one account cannot
  // hammer the mocked identity provider.
  const limit = checkRateLimit(rateLimitKey(req, 'idv-start', session!.user.id));
  if (!limit.allowed) {
    return apiError('Too many verification attempts. Please try again in a minute.', 429);
  }

  const body = await parseJson<{ claimantProfileId?: string }>(req);
  if (!body) return invalidBody();

  const { claimantProfileId } = body;
  if (!claimantProfileId) {
    return apiError('claimantProfileId is required', 400);
  }

  const owns = requireOwnership(session, claimantProfileId);
  if (!owns.ok) {
    return apiError('Forbidden', owns.status);
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
