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
