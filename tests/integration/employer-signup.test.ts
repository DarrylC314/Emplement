import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/employer/signup/route';

describe('POST /api/employer/signup', () => {
  const email = `employer-signup-${Date.now()}@example.com`;
  let userId: string;
  let employerProfileId: string;

  it('creates an EMPLOYER user with an EmployerProfile', async () => {
    const req = new Request('http://localhost/api/employer/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'EmployerPass123' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    userId = body.id;

    const user = await prisma.user.findUnique({ where: { id: userId } });
    expect(user?.role).toBe('EMPLOYER');

    const profile = await prisma.employerProfile.findUnique({ where: { userId } });
    expect(profile).not.toBeNull();
    expect(profile?.fein).toBeNull();
    expect(profile?.verificationStatus).toBe('PENDING');
    employerProfileId = profile!.id;
  });

  it('rejects a duplicate email with 409', async () => {
    const req = new Request('http://localhost/api/employer/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'AnotherPass123' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it('rejects a malformed JSON body with a clean 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/employer/signup', { method: 'POST', body: '<<<not json' })
    );
    expect(res.status).toBe(400);
  });

  it('creates both the User and its EmployerProfile together', async () => {
    // Regression guard for M8: User + EmployerProfile creation is now wrapped
    // in a single prisma.$transaction (see src/lib/signup.ts) so a failure
    // partway through can never leave an orphaned EMPLOYER user with no
    // profile (which would otherwise 404 on every employer route and 409 on
    // re-signup, permanently locking the email). We can't easily force a
    // mid-transaction failure here, so this confirms the successful path:
    // both rows exist immediately after a 201.
    const atomicEmail = `employer-signup-atomic-${Date.now()}@example.com`;
    const req = new Request('http://localhost/api/employer/signup', {
      method: 'POST',
      body: JSON.stringify({ email: atomicEmail, password: 'EmployerPass123' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { email: atomicEmail } });
    expect(user).not.toBeNull();
    const profile = await prisma.employerProfile.findUnique({ where: { userId: user!.id } });
    expect(profile).not.toBeNull();

    await prisma.employerProfile.delete({ where: { userId: user!.id } });
    await prisma.user.delete({ where: { id: user!.id } });
  });

  afterAll(async () => {
    if (employerProfileId) {
      await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    }
    if (userId) {
      await prisma.user.delete({ where: { id: userId } });
    }
    await prisma.$disconnect();
  });
});
