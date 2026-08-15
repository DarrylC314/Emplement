import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { hashSSN } from '@/lib/ssnHash';
import { RATE_LIMIT_MAX_ATTEMPTS, resetRateLimits } from '@/lib/rateLimit';
import { POST as manualMatch } from '@/app/api/staff/unmatched-events/[id]/match/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/staff/unmatched-events/[id]/match', () => {
  let caseworkerUserId: string;
  let employerUserId: string;
  let employerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let eventId: string;
  let secondEventId: string;
  let alreadyMatchedEventId: string;
  const correctSsn = '512-88-3344';

  beforeAll(async () => {
    const caseworkerUser = await prisma.user.create({
      data: { email: `match-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerUserId = caseworkerUser.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: caseworkerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const employerUser = await prisma.user.create({
      data: { email: `match-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, companyName: 'Match Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `match-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: hashSSN(correctSsn) },
    });
    claimantProfileId = claimantProfile.id;

    // The event's own stored ssnHash deliberately does NOT match the
    // claimant above — it represents the employer's original, incorrect
    // submission. The manual-match route must hash the freshly-submitted
    // SSN, not compare against this stale value.
    const event = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Typo Victim',
        ssnHash: `original-wrong-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
      },
    });
    eventId = event.id;

    const secondEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'SEPARATION',
        employeeName: 'No Such Claimant',
        ssnHash: `unrelated-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
      },
    });
    secondEventId = secondEvent.id;

    const alreadyMatchedEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Already Resolved',
        ssnHash: `already-resolved-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
        matchedClaimantProfileId: claimantProfileId,
      },
    });
    alreadyMatchedEventId = alreadyMatchedEvent.id;
  });

  it('links the event to the claimant matching the freshly-submitted SSN', async () => {
    const req = new Request(`http://localhost/api/staff/unmatched-events/${eventId}/match`, {
      method: 'POST',
      body: JSON.stringify({ ssn: correctSsn, note: 'Employer had a typo; confirmed correct SSN with claimant by phone.' }),
    });
    const res = await manualMatch(req, { params: { id: eventId } });
    expect(res.status).toBe(200);

    const event = await prisma.employmentEvent.findUnique({ where: { id: eventId } });
    expect(event?.matchedClaimantProfileId).toBe(claimantProfileId);
    // The event's originally-stored ssnHash is left untouched — it's a
    // historical record of what the employer actually submitted.
    expect(event?.ssnHash).not.toBe(hashSSN(correctSsn));

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'EmploymentEvent', targetId: eventId, action: 'EMPLOYMENT_EVENT_MANUALLY_MATCHED' },
    });
    expect(log).not.toBeNull();
    expect((log?.metadata as { via?: string; note?: string })?.via).toBe('manual');
    expect((log?.metadata as { via?: string; note?: string })?.note).toContain('typo');
  });

  it('returns 404 when no claimant matches the submitted SSN, and audits the miss without the SSN', async () => {
    resetRateLimits();
    const req = new Request(`http://localhost/api/staff/unmatched-events/${secondEventId}/match`, {
      method: 'POST',
      body: JSON.stringify({ ssn: '999-99-9999', note: 'Tried a guess based on the employer roster.' }),
    });
    const res = await manualMatch(req, { params: { id: secondEventId } });
    expect(res.status).toBe(404);

    const log = await prisma.auditLog.findFirst({
      where: {
        targetEntity: 'EmploymentEvent',
        targetId: secondEventId,
        action: 'EMPLOYMENT_EVENT_MATCH_ATTEMPT_FAILED',
      },
    });
    expect(log).not.toBeNull();
    const metadata = log?.metadata as { note?: string; ssn?: string; ssnHash?: string };
    expect(metadata?.note).toContain('Tried a guess');
    expect(metadata?.ssn).toBeUndefined();
    expect(metadata?.ssnHash).toBeUndefined();
    expect(JSON.stringify(metadata)).not.toContain('999-99-9999');
  });

  it('rejects a request missing the required note with 400', async () => {
    resetRateLimits();
    const req = new Request(`http://localhost/api/staff/unmatched-events/${secondEventId}/match`, {
      method: 'POST',
      body: JSON.stringify({ ssn: correctSsn }),
    });
    const res = await manualMatch(req, { params: { id: secondEventId } });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed SSN format with a 400 and field-level errors', async () => {
    resetRateLimits();
    const req = new Request(`http://localhost/api/staff/unmatched-events/${secondEventId}/match`, {
      method: 'POST',
      body: JSON.stringify({ ssn: '999999999', note: 'No dashes on this one.' }),
    });
    const res = await manualMatch(req, { params: { id: secondEventId } });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors?.fieldErrors?.ssn?.[0]).toMatch(/123-45-6789/);
  });

  it('rate limits repeated match attempts and refuses with 429', async () => {
    resetRateLimits();
    const makeRequest = () =>
      new Request(`http://localhost/api/staff/unmatched-events/${secondEventId}/match`, {
        method: 'POST',
        body: JSON.stringify({ ssn: '999-99-9999', note: 'Rate limit probe.' }),
      });

    for (let attempt = 1; attempt <= RATE_LIMIT_MAX_ATTEMPTS; attempt += 1) {
      const res = await manualMatch(makeRequest(), { params: { id: secondEventId } });
      expect(res.status).toBe(404);
    }

    const blocked = await manualMatch(makeRequest(), { params: { id: secondEventId } });
    expect(blocked.status).toBe(429);
    expect((await blocked.json()).error).toMatch(/too many/i);

    resetRateLimits();
  });

  it('returns 409 when the event is already matched', async () => {
    const req = new Request(`http://localhost/api/staff/unmatched-events/${alreadyMatchedEventId}/match`, {
      method: 'POST',
      body: JSON.stringify({ ssn: correctSsn, note: 'Retrying anyway.' }),
    });
    const res = await manualMatch(req, { params: { id: alreadyMatchedEventId } });
    expect(res.status).toBe(409);
  });

  it('rejects a CLAIMANT session with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const req = new Request(`http://localhost/api/staff/unmatched-events/${secondEventId}/match`, {
      method: 'POST',
      body: JSON.stringify({ ssn: correctSsn, note: 'Should be rejected.' }),
    });
    const res = await manualMatch(req, { params: { id: secondEventId } });
    expect(res.status).toBe(403);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: caseworkerUserId } });
    await prisma.employmentEvent.deleteMany({ where: { employerId: employerProfileId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: employerUserId } });
    await prisma.user.delete({ where: { id: caseworkerUserId } });
    await prisma.$disconnect();
  });
});
