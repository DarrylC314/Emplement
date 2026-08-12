import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signupSchema } from '@/lib/validation/auth';

export async function POST(req: Request) {
  const body = await req.json();
  const credsParsed = signupSchema.safeParse({ email: body.email, password: body.password });

  if (!credsParsed.success) {
    return Response.json({ errors: credsParsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: credsParsed.data.email } });
  if (existing) {
    return Response.json({ error: 'An account with this email already exists.' }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(credsParsed.data.password, 12);
  const user = await prisma.user.create({
    data: { email: credsParsed.data.email, passwordHash, role: 'CLAIMANT' },
  });

  await prisma.claimantProfile.create({ data: { userId: user.id } });

  return Response.json({ id: user.id, email: user.email }, { status: 201 });
}
