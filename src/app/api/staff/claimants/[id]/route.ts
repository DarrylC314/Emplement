import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';

const EDITABLE_FIELDS = ['legalName', 'phone', 'mailingAddress'] as const;

/**
 * Single-claimant detail fetch for the staff case-detail page.
 *
 * The page used to call the search route (`GET /api/staff/claimants?q=`) and
 * pick its claimant out of the response, which capped it at the first 25
 * unordered rows — any claimant past that window was simply unreachable.
 *
 * The `select` below deliberately mirrors the search route's: never
 * `include: { user: true }` (that ships passwordHash to the browser), and no
 * ssnEncrypted (SSN access goes through the audit-logged reveal-ssn endpoint)
 * or unused ClaimantProfile PII (dateOfBirth, phone, mailingAddress).
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const claimant = await prisma.claimantProfile.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      legalName: true,
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
    },
  });

  if (!claimant) {
    return Response.json({ error: 'Claimant not found' }, { status: 404 });
  }

  return Response.json(claimant);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const body = await req.json();
  // caseworkerId, if sent, is ignored — attribution always comes from the
  // verified session, never client input.
  const { caseworkerId: _ignoredCaseworkerId, ...updates } = body;

  const data: Record<string, string> = {};
  for (const field of EDITABLE_FIELDS) {
    if (typeof updates[field] === 'string') data[field] = updates[field];
  }
  if (Object.keys(data).length === 0) {
    return Response.json({ error: 'No editable fields provided' }, { status: 400 });
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
