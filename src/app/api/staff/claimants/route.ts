import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';

export async function GET(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return Response.json({ error: 'Unauthorized' }, { status: access.status });
  }

  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  // Explicit select — never include: { user: true }, which would ship the
  // full User row (passwordHash included) to the browser. Also omits
  // ssnEncrypted (not used by any caller of this route; SSN access goes
  // through the separate audit-logged reveal-ssn endpoint) and other
  // ClaimantProfile PII the UI doesn't display (phone, mailingAddress).
  // dateOfBirth IS returned deliberately — the unmatched-events staff
  // workflow relies on it to disambiguate between similarly-named
  // claimants when manually matching an event. Only returns what
  // src/app/staff/dashboard/page.tsx and src/app/staff/claimants/[id]/page.tsx
  // actually read.
  const claimants = await prisma.claimantProfile.findMany({
    where: {
      OR: [
        { legalName: { contains: q, mode: 'insensitive' } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
      ],
    },
    select: {
      id: true,
      legalName: true,
      prefix: true,
      suffix: true,
      gender: true,
      dateOfBirth: true,
      user: { select: { email: true } },
      claims: {
        select: {
          id: true,
          status: true,
          weeklyBenefitAmount: true,
          certifications: {
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
    take: 25,
  });
  return Response.json(claimants);
}
