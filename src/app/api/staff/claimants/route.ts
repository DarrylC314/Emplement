import { prisma } from '@/lib/prisma';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';
  const claimants = await prisma.claimantProfile.findMany({
    where: {
      OR: [
        { legalName: { contains: q, mode: 'insensitive' } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
      ],
    },
    include: { user: true, claims: true },
    take: 25,
  });
  return Response.json(claimants);
}
