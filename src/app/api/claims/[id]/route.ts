import { prisma } from '@/lib/prisma';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const claim = await prisma.claim.findUnique({
    where: { id: params.id },
    include: {
      certifications: {
        include: { jobSearchActivities: true },
        orderBy: { weekEndingDate: 'desc' },
      },
      caseNotes: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!claim) {
    return Response.json({ error: 'Claim not found' }, { status: 404 });
  }
  return Response.json(claim);
}
