import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { hashSSN } from '@/lib/ssnHash';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit';

// Mirrors employmentEventSchema's ssn field (src/lib/validation/employmentEvent.ts):
// same canonical dashed format, same message. Kept as a local schema rather
// than importing that one directly, since this route's body shape (ssn +
// note) isn't otherwise related to reporting an event.
const manualMatchSchema = z.object({
  ssn: z.string().regex(/^\d{3}-\d{2}-\d{4}$/, 'SSN must be in 123-45-6789 format'),
  note: z.string().min(1, 'A note is required'),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  // This is the only SSN-lookup endpoint that accepts a caller-supplied SSN
  // and reveals (via 404 vs. 200) whether it matched — the same probing risk
  // src/app/api/employer/events/route.ts guards against. Keyed by the acting
  // staff member's own session id, not IP, consistent with that route.
  const limit = checkRateLimit(rateLimitKey(req, 'staff-event-match', session!.user.id));
  if (!limit.allowed) {
    return apiError('Too many match attempts. Please try again in a minute.', 429);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = manualMatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }
  const { ssn, note } = parsed.data;

  const event = await prisma.employmentEvent.findUnique({
    where: { id: params.id },
    select: { id: true, matchedClaimantProfileId: true, dismissedAt: true },
  });
  if (!event) {
    return apiError('Event not found', 404);
  }
  if (event.matchedClaimantProfileId || event.dismissedAt) {
    return apiError('This event has already been resolved', 409);
  }

  // Hashes the freshly-submitted SSN — never the event's own stored
  // ssnHash. This is what handles "the employer had the wrong SSN on
  // file": the event's original hash will never match anyone no matter
  // how many times it's retried, so staff supply a corrected one here.
  const ssnHash = hashSSN(ssn);
  const matchedClaimant = await prisma.claimantProfile.findUnique({
    where: { ssnHash },
    select: { id: true },
  });
  if (!matchedClaimant) {
    // Audited even on a miss: unlike the retry route (which takes no
    // caller-supplied SSN and has no probing surface), this endpoint lets a
    // caller submit an arbitrary SSN and observe whether it matched. The
    // submitted SSN/hash is deliberately never logged — only the staff
    // member's stated reasoning for the attempt.
    await writeAuditLog({
      actorUserId: session!.user.id,
      action: 'EMPLOYMENT_EVENT_MATCH_ATTEMPT_FAILED',
      targetEntity: 'EmploymentEvent',
      targetId: params.id,
      metadata: { note },
    });
    return apiError('No claimant found with that SSN', 404);
  }

  // Atomic compare-and-swap: the findUnique check above is still needed for
  // the 404-not-found and fast-path 409 message, but the actual write is
  // guarded against a concurrent Retry/Dismiss on the same event racing past
  // that check — updateMany only touches the row if it's still unresolved.
  const updated = await prisma.employmentEvent.updateMany({
    where: { id: params.id, matchedClaimantProfileId: null, dismissedAt: null },
    data: { matchedClaimantProfileId: matchedClaimant.id },
  });
  if (updated.count === 0) {
    return apiError('This event has already been resolved', 409);
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'EMPLOYMENT_EVENT_MANUALLY_MATCHED',
    targetEntity: 'EmploymentEvent',
    targetId: params.id,
    metadata: { via: 'manual', note },
  });

  return Response.json({ id: params.id }, { status: 200 });
}
