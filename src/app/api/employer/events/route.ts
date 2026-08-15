import { prisma } from '@/lib/prisma';
import { employmentEventSchema } from '@/lib/validation/employmentEvent';
import { hashSSN } from '@/lib/ssnHash';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';
import { checkRateLimit, rateLimitKey } from '@/lib/rateLimit';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['EMPLOYER']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }
  if (!session!.user.employerProfileId) {
    return apiError('Employer profile not found', 404);
  }

  // Basic rate limiting on employer-reported events: this endpoint accepts
  // an arbitrary SSN on every request and looks it up against the claimant
  // roster, so it's the same shape of risk the identity-verification
  // endpoints already guard against. Keyed by the employer's own profile so
  // one account can't hammer it, rather than a global/IP-based limit.
  const limit = checkRateLimit(rateLimitKey(req, 'employer-events', session!.user.employerProfileId));
  if (!limit.allowed) {
    return apiError('Too many events reported. Please try again in a minute.', 429);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  const parsed = employmentEventSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ errors: parsed.error.flatten() }, { status: 400 });
  }

  const employerProfile = await prisma.employerProfile.findUnique({
    where: { id: session!.user.employerProfileId },
    select: { verificationStatus: true },
  });
  if (!employerProfile || employerProfile.verificationStatus !== 'VERIFIED') {
    return apiError('Employer account is not verified', 403);
  }

  const ssnHash = hashSSN(parsed.data.ssn);
  // Whether a match was found is never returned to the caller (see the
  // spec's error-handling note): revealing that would let anyone probe
  // whether a given SSN belongs to a claimant in the system.
  const matchedClaimant = await prisma.claimantProfile.findUnique({
    where: { ssnHash },
    select: { id: true },
  });

  const event = await prisma.employmentEvent.create({
    data: {
      employerId: session!.user.employerProfileId,
      type: parsed.data.type,
      employeeName: parsed.data.employeeName,
      ssnHash,
      eventDate: new Date(parsed.data.eventDate),
      matchedClaimantProfileId: matchedClaimant?.id,
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'EMPLOYMENT_EVENT_REPORTED',
    targetEntity: 'EmploymentEvent',
    targetId: event.id,
    metadata: { type: parsed.data.type, matched: Boolean(matchedClaimant) },
  });

  return Response.json({ id: event.id }, { status: 201 });
}
