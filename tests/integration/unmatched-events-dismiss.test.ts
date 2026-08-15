import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST as dismissEvent } from '@/app/api/staff/unmatched-events/[id]/dismiss/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/staff/unmatched-events/[id]/dismiss', () => {
  let caseworkerUserId: string;
  let employerUserId: string;
  let employerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let eventId: string;
  let secondEventId: string;
  let alreadyDismissedEventId: string;

  beforeAll(async () => {
    const caseworkerUser = await prisma.user.create({
      data: { email: `dismiss-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerUserId = caseworkerUser.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworkerUserId, role: 'CASEWORKER', email: caseworkerUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const employerUser = await prisma.user.create({
      data: { email: `dismiss-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, companyName: 'Dismiss Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `dismiss-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({ data: { userId: claimantUser.id } });
    claimantProfileId = claimantProfile.id;

    const event = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Never Will Match',
        ssnHash: `dismiss-target-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
      },
    });
    eventId = event.id;

    const secondEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'SEPARATION',
        employeeName: 'No Note Provided',
        ssnHash: `no-note-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
      },
    });
    secondEventId = secondEvent.id;

    const alreadyDismissedEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Already Dismissed',
        ssnHash: `already-dismissed-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
        dismissedAt: new Date(),
        dismissedByUserId: caseworkerUserId,
      },
    });
    alreadyDismissedEventId = alreadyDismissedEvent.id;
  });

  it('dismisses the event, attributing it to the acting caseworker', async () => {
    const req = new Request(`http://localhost/api/staff/unmatched-events/${eventId}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ note: 'Confirmed with the employer this employee never actually filed a claim.' }),
    });
    const res = await dismissEvent(req, { params: { id: eventId } });
    expect(res.status).toBe(200);

    const event = await prisma.employmentEvent.findUnique({ where: { id: eventId } });
    expect(event?.dismissedAt).not.toBeNull();
    expect(event?.dismissedByUserId).toBe(caseworkerUserId);

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'EmploymentEvent', targetId: eventId, action: 'EMPLOYMENT_EVENT_DISMISSED' },
    });
    expect(log).not.toBeNull();
    expect((log?.metadata as { note?: string })?.note).toContain('never actually filed');
  });

  it('rejects a request missing the required note with 400', async () => {
    const req = new Request(`http://localhost/api/staff/unmatched-events/${secondEventId}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await dismissEvent(req, { params: { id: secondEventId } });
    expect(res.status).toBe(400);

    const event = await prisma.employmentEvent.findUnique({ where: { id: secondEventId } });
    expect(event?.dismissedAt).toBeNull();
  });

  it('returns 409 when the event is already dismissed', async () => {
    const req = new Request(`http://localhost/api/staff/unmatched-events/${alreadyDismissedEventId}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ note: 'Dismissing again.' }),
    });
    const res = await dismissEvent(req, { params: { id: alreadyDismissedEventId } });
    expect(res.status).toBe(409);
  });

  it('rejects a CLAIMANT session with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const req = new Request(`http://localhost/api/staff/unmatched-events/${secondEventId}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ note: 'Should be rejected.' }),
    });
    const res = await dismissEvent(req, { params: { id: secondEventId } });
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
