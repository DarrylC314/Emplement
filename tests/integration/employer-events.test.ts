import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { hashSSN } from '@/lib/ssnHash';
import { RATE_LIMIT_MAX_ATTEMPTS, resetRateLimits } from '@/lib/rateLimit';
import { POST } from '@/app/api/employer/events/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/employer/events', () => {
  let employerUserId: string;
  let employerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  const eventIds: string[] = [];
  // Derived from Date.now() rather than hardcoded: several other integration
  // test files (e.g. identity-verification.test.ts) also persist a
  // ClaimantProfile with ssnHash = hashSSN('123-45-6789'), and ssnHash is a
  // globally unique column. Reusing that literal here raced against those
  // files under the full suite's parallel file execution and intermittently
  // failed this test's beforeAll with a P2002 unique-constraint error.
  const uniqueDigits = Date.now().toString().slice(-9).padStart(9, '0');
  const matchableSsn = `${uniqueDigits.slice(0, 3)}-${uniqueDigits.slice(3, 5)}-${uniqueDigits.slice(5, 9)}`;

  beforeAll(async () => {
    const employerUser = await prisma.user.create({
      data: { email: `employer-events-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, fein: '77-7777777', companyName: 'Events Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: employerUser.id, role: 'EMPLOYER', employerProfileId: employerProfile.id, email: employerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const claimantUser = await prisma.user.create({
      data: { email: `employer-events-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const profile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, legalName: 'Matchable Claimant', ssnHash: hashSSN(matchableSsn) },
    });
    claimantProfileId = profile.id;
  });

  it('creates a matched event when the SSN corresponds to an existing claimant', async () => {
    const req = new Request('http://localhost/api/employer/events', {
      method: 'POST',
      body: JSON.stringify({
        employeeName: 'Matchable Claimant',
        ssn: matchableSsn,
        type: 'HIRE',
        eventDate: '2026-08-01',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    eventIds.push(body.id);

    const event = await prisma.employmentEvent.findUnique({ where: { id: body.id } });
    expect(event?.matchedClaimantProfileId).toBe(claimantProfileId);
  });

  it('creates an unmatched event when the SSN does not correspond to any claimant, without revealing that to the caller', async () => {
    const req = new Request('http://localhost/api/employer/events', {
      method: 'POST',
      body: JSON.stringify({
        employeeName: 'Nobody On File',
        ssn: '999-99-9999',
        type: 'SEPARATION',
        eventDate: '2026-08-01',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    eventIds.push(body.id);
    expect(body).not.toHaveProperty('matched');
    expect(body).not.toHaveProperty('matchedClaimantProfileId');

    const event = await prisma.employmentEvent.findUnique({ where: { id: body.id } });
    expect(event?.matchedClaimantProfileId).toBeNull();
  });

  it('rejects a malformed SSN with a 400', async () => {
    const req = new Request('http://localhost/api/employer/events', {
      method: 'POST',
      body: JSON.stringify({
        employeeName: 'Bad SSN',
        ssn: 'not-an-ssn',
        type: 'HIRE',
        eventDate: '2026-08-01',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rate limits repeated event reports and refuses with 429', async () => {
    // M13: keyed by the employer's own profile (events:${employerProfileId}),
    // not globally, so this throttles one employer account rather than every
    // employer at once.
    resetRateLimits();
    const makeRequest = () =>
      new Request('http://localhost/api/employer/events', {
        method: 'POST',
        body: JSON.stringify({
          employeeName: 'Rate Limit Probe',
          ssn: '888-88-8888',
          type: 'HIRE',
          eventDate: '2026-08-01',
        }),
      });

    for (let attempt = 1; attempt <= RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
      const res = await POST(makeRequest());
      expect(res.status).toBe(201);
      const body = await res.json();
      eventIds.push(body.id);
    }

    const blocked = await POST(makeRequest());
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toMatch(/too many/i);

    resetRateLimits();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: employerUserId } });
    await prisma.employmentEvent.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.$disconnect();
  });
});
