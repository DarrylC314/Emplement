import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { hashSSN } from '@/lib/ssnHash';
import { POST as retryMatch } from '@/app/api/staff/unmatched-events/[id]/retry/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/staff/unmatched-events/[id]/retry', () => {
  let caseworkerUserId: string;
  let employerUserId: string;
  let employerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let matchableEventId: string;
  let stillUnmatchedEventId: string;
  let alreadyMatchedEventId: string;
  const matchableSsn = '408-77-2211';

  beforeAll(async () => {
    const caseworkerUser = await prisma.user.create({
      data: { email: `retry-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerUserId = caseworkerUser.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: caseworkerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const employerUser = await prisma.user.create({
      data: { email: `retry-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, companyName: 'Retry Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `retry-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: hashSSN(matchableSsn) },
    });
    claimantProfileId = claimantProfile.id;

    // Same ssnHash as the claimant above — models a claimant who verified
    // their identity *after* the employer reported this event.
    const matchableEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Late Verifier',
        ssnHash: hashSSN(matchableSsn),
        eventDate: new Date('2026-08-01'),
      },
    });
    matchableEventId = matchableEvent.id;

    const stillUnmatchedEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Nobody On File',
        ssnHash: `no-match-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
      },
    });
    stillUnmatchedEventId = stillUnmatchedEvent.id;

    const alreadyMatchedEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Already Resolved',
        ssnHash: `already-matched-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
        matchedClaimantProfileId: claimantProfileId,
      },
    });
    alreadyMatchedEventId = alreadyMatchedEvent.id;
  });

  it('links the event when the stored ssnHash now matches a claimant', async () => {
    const res = await retryMatch(
      new Request(`http://localhost/api/staff/unmatched-events/${matchableEventId}/retry`, { method: 'POST' }),
      { params: { id: matchableEventId } }
    );
    expect(res.status).toBe(200);

    const event = await prisma.employmentEvent.findUnique({ where: { id: matchableEventId } });
    expect(event?.matchedClaimantProfileId).toBe(claimantProfileId);

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'EmploymentEvent', targetId: matchableEventId, action: 'EMPLOYMENT_EVENT_MANUALLY_MATCHED' },
    });
    expect(log).not.toBeNull();
    expect((log?.metadata as { via?: string })?.via).toBe('retry');
  });

  it('returns 404 when the stored ssnHash still matches no claimant', async () => {
    const res = await retryMatch(
      new Request(`http://localhost/api/staff/unmatched-events/${stillUnmatchedEventId}/retry`, { method: 'POST' }),
      { params: { id: stillUnmatchedEventId } }
    );
    expect(res.status).toBe(404);

    const event = await prisma.employmentEvent.findUnique({ where: { id: stillUnmatchedEventId } });
    expect(event?.matchedClaimantProfileId).toBeNull();
  });

  it('returns 409 when the event is already matched', async () => {
    const res = await retryMatch(
      new Request(`http://localhost/api/staff/unmatched-events/${alreadyMatchedEventId}/retry`, { method: 'POST' }),
      { params: { id: alreadyMatchedEventId } }
    );
    expect(res.status).toBe(409);
  });

  it('rejects a CLAIMANT session with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await retryMatch(
      new Request(`http://localhost/api/staff/unmatched-events/${stillUnmatchedEventId}/retry`, { method: 'POST' }),
      { params: { id: stillUnmatchedEventId } }
    );
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
