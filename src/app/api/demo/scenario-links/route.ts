import { prisma } from '@/lib/prisma';
import { apiError } from '@/lib/apiRequest';

// Resolves the two database ids the guided-demo widget needs to deep-link
// into pages, by the fixed identities prisma/seed.ts creates — never by a
// hardcoded id, since cuids differ per database. Unauthenticated: neither
// id is sensitive (this app already treats posting ids as freely visible
// via /claim/browse-postings), and the widget needs this before any
// particular login has necessarily completed.
export async function GET() {
  const posting = await prisma.jobPosting.findFirst({
    where: { title: 'Warehouse Associate', employer: { companyName: 'Riverbend Logistics Inc.' } },
    select: { id: true },
  });
  if (!posting) {
    return apiError('Guided demo data is not available in this environment.', 404);
  }

  const claimantUser = await prisma.user.findUnique({
    where: { email: 'claimant@example.com' },
    select: { claimantProfile: { select: { id: true } } },
  });
  if (!claimantUser?.claimantProfile) {
    return apiError('Guided demo data is not available in this environment.', 404);
  }

  return Response.json({
    warehousePostingId: posting.id,
    claimantProfileId: claimantUser.claimantProfile.id,
  });
}
