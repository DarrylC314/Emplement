import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';

const EDITABLE_FIELDS = ['legalName', 'phone', 'mailingAddress'] as const;

/**
 * Single-claimant detail fetch for the staff case-detail page.
 *
 * The page used to call the search route (`GET /api/staff/claimants?q=`) and
 * pick its claimant out of the response, which capped it at the first 25
 * unordered rows — any claimant past that window was simply unreachable.
 *
 * The `select` below is a superset of the search route's: like that route, it
 * never uses `include: { user: true }` (that ships passwordHash to the
 * browser) and never selects ssnEncrypted (SSN access goes through the
 * audit-logged reveal-ssn endpoint) or unused ClaimantProfile PII
 * (dateOfBirth, phone, mailingAddress). Unlike that route, it additionally
 * selects prefix/suffix/gender — those are detail-view-only, added for staff
 * identification purposes on this audited, single-record view, and
 * intentionally omitted from the search route's list of many claimants,
 * where they aren't needed. This divergence is deliberate, not a mirroring
 * bug.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const claimant = await prisma.claimantProfile.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      legalName: true,
      prefix: true,
      suffix: true,
      gender: true,
      user: { select: { email: true } },
      claims: {
        select: {
          id: true,
          status: true,
          weeklyBenefitAmount: true,
          certifications: {
            orderBy: { weekEndingDate: 'desc' },
            select: {
              id: true,
              weekEndingDate: true,
              autoDecision: true,
              autoDecisionReason: true,
            },
          },
          caseNotes: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              note: true,
              createdAt: true,
            },
          },
        },
      },
      matchedEmploymentEvents: {
        orderBy: { eventDate: 'desc' },
        select: {
          id: true,
          type: true,
          eventDate: true,
          employer: { select: { companyName: true } },
        },
      },
    },
  });

  if (!claimant) {
    return apiError('Claimant not found', 404);
  }

  // Deliberate, per-record access, unlike the search/queue list routes: a
  // caseworker opening one specific claimant's case file is exactly the kind
  // of PII read the spec's AuditLog scope calls for ("every PII read/write
  // and claim-status change"). List/search views aren't audited the same way
  // — logging every keystroke of a search or every dashboard-queue load
  // would be noise, not accountability; opening a specific case file is the
  // meaningful, auditable event, the same distinction the reveal-ssn route
  // already draws for SSN access specifically.
  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CLAIMANT_RECORD_VIEWED',
    targetEntity: 'ClaimantProfile',
    targetId: params.id,
  });

  return Response.json(claimant);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const body = await parseJson<Record<string, unknown>>(req);
  if (!body) return invalidBody();

  // caseworkerId, if sent, is ignored — attribution always comes from the
  // verified session, never client input.
  const { caseworkerId: _ignoredCaseworkerId, ...updates } = body;

  const data: Record<string, string> = {};
  for (const field of EDITABLE_FIELDS) {
    const value = updates[field];
    if (typeof value === 'string') data[field] = value;
  }
  if (Object.keys(data).length === 0) {
    return apiError('No editable fields provided', 400);
  }

  const updated = await prisma.claimantProfile.update({
    where: { id: params.id },
    data,
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'CLAIMANT_RECORD_EDITED',
    targetEntity: 'ClaimantProfile',
    targetId: params.id,
    metadata: { fields: Object.keys(data) },
  });

  return Response.json(updated, { status: 200 });
}
