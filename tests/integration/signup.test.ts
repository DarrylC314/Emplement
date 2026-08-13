import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { POST } from '@/app/api/signup/route';

describe('POST /api/signup', () => {
  const testEmail = `signup-test-${Date.now()}@example.com`;
  let escalationEmail: string | undefined;

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

  it('ignores a role field in the body and still creates a CLAIMANT', async () => {
    // Regression guard for the original self-service-caseworker-signup hole:
    // the route must never let the request body choose the account's role.
    const email = `signup-role-escalation-${Date.now()}@example.com`;
    const req = new Request('http://localhost/api/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password: 'CorrectHorseBattery9', role: 'CASEWORKER' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const user = await prisma.user.findUnique({ where: { email } });
    expect(user?.role).toBe('CLAIMANT');
    escalationEmail = email;
  });

  it('rejects a malformed JSON body with a clean 400', async () => {
    const req = new Request('http://localhost/api/signup', {
      method: 'POST',
      body: '{not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid request body' });
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
    const emails = [testEmail, ...(escalationEmail ? [escalationEmail] : [])];
    for (const email of emails) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        await prisma.claimantProfile.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    }
    await prisma.$disconnect();
  });
});
