import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';

// A verified-organization picker for the credential-verification request
// flow (claimant and staff pages both search by name to pick a target
// organization). Only VERIFIED EmployerProfiles are returned — an
// unverified one can't be asked to verify anything.
export async function GET(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CLAIMANT', 'CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';

  const organizations = await prisma.employerProfile.findMany({
    where: {
      verificationStatus: 'VERIFIED',
      companyName: { contains: q, mode: 'insensitive' },
    },
    select: { id: true, companyName: true },
    orderBy: { companyName: 'asc' },
    take: 25,
  });

  return Response.json(organizations);
}
