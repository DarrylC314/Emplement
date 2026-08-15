import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signupSchema } from '@/lib/validation/auth';
import { apiError, invalidBody, parseJson } from '@/lib/apiRequest';
import { createUserWithProfile } from '@/lib/signup';

export async function POST(req: Request) {
  // Note the deliberately narrow pick below: a `role` field in the body is
  // ignored outright and every account is created as a CLAIMANT. Accepting it
  // would let anyone self-provision a CASEWORKER account.
  const body = await parseJson<{ email?: string; password?: string }>(req);
  if (!body) return invalidBody();

  const credsParsed = signupSchema.safeParse({ email: body.email, password: body.password });

  if (!credsParsed.success) {
    return Response.json({ errors: credsParsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: credsParsed.data.email } });
  if (existing) {
    return apiError('An account with this email already exists.', 409);
  }

  const passwordHash = await bcrypt.hash(credsParsed.data.password, 12);
  const user = await createUserWithProfile(credsParsed.data.email, passwordHash, 'CLAIMANT');

  return Response.json({ id: user.id, email: user.email }, { status: 201 });
}
