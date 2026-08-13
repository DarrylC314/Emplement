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
  const claimants = await prisma.claimantProfile.findMany({
    where: {
      OR: [
        { legalName: { contains: q, mode: 'insensitive' } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
      ],
    },
    include: {
      user: true,
      claims: {
        include: {
          certifications: true,
          caseNotes: { orderBy: { createdAt: 'desc' } },
        },
      },
    },
    take: 25,
  });
  return Response.json(claimants);
}
