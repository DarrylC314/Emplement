import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/signup/route';

describe('POST /api/signup', () => {
  const testEmail = `signup-test-${Date.now()}@example.com`;

  it('creates a claimant user with a hashed password', async () => {
    const req = new Request('http://localhost/api/signup', {
      method: 'POST',
      body: JSON.stringify({ email: testEmail, password: 'CorrectHorseBattery9', role: 'CLAIMANT' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    expect(user).not.toBeNull();
    expect(user?.passwordHash).not.toBe('CorrectHorseBattery9');
    expect(user?.role).toBe('CLAIMANT');
  });

  it('rejects a duplicate email with 409', async () => {
    const req = new Request('http://localhost/api/signup', {
      method: 'POST',
      body: JSON.stringify({ email: testEmail, password: 'CorrectHorseBattery9', role: 'CLAIMANT' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it('rejects an invalid payload with 400', async () => {
    const req = new Request('http://localhost/api/signup', {
      method: 'POST',
      body: JSON.stringify({ email: 'not-an-email', password: 'short', role: 'CLAIMANT' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  afterAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: testEmail } });
    if (user) {
      await prisma.claimantProfile.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
    await prisma.$disconnect();
  });
});
