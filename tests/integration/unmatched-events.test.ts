import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET as listUnmatchedEvents } from '@/app/api/staff/unmatched-events/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('GET /api/staff/unmatched-events', () => {
  let caseworkerUserId: string;
  let employerUserId: string;
  let employerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let unmatchedEventId: string;
  let matchedEventId: string;
  let dismissedEventId: string;

  beforeAll(async () => {
    const caseworkerUser = await prisma.user.create({
      data: { email: `unmatched-events-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerUserId = caseworkerUser.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: caseworkerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const employerUser = await prisma.user.create({
      data: { email: `unmatched-events-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;

    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, companyName: 'Unmatched Events Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `unmatched-events-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({ data: { userId: claimantUser.id } });
    claimantProfileId = claimantProfile.id;

    const unmatchedEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Still Unmatched',
        ssnHash: `unmatched-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
      },
    });
    unmatchedEventId = unmatchedEvent.id;

    const matchedEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Already Matched',
        ssnHash: `matched-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
        matchedClaimantProfileId: claimantProfileId,
      },
    });
    matchedEventId = matchedEvent.id;

    const dismissedEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'SEPARATION',
        employeeName: 'Already Dismissed',
        ssnHash: `dismissed-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
        dismissedAt: new Date(),
        dismissedByUserId: caseworkerUserId,
      },
    });
    dismissedEventId = dismissedEvent.id;
  });

  it('lists only events with no match and no dismissal', async () => {
    const res = await listUnmatchedEvents();
    expect(res.status).toBe(200);
    const events = await res.json();

    const ids = events.map((e: { id: string }) => e.id);
    expect(ids).toContain(unmatchedEventId);
    expect(ids).not.toContain(matchedEventId);
    expect(ids).not.toContain(dismissedEventId);

    const target = events.find((e: { id: string }) => e.id === unmatchedEventId);
    expect(target.employeeName).toBe('Still Unmatched');
    expect(target.type).toBe('HIRE');
    expect(target.employer.companyName).toBe('Unmatched Events Test Co');
  });

  it('rejects a CLAIMANT session with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await listUnmatchedEvents();
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
