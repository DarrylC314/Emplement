import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST, GET } from '@/app/api/messages/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('messages API', () => {
  let claimantProfileId: string;
  let caseworkerId: string;
  let claimantUserId: string;

  function mockCaseworkerSession() {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworkerId, role: 'CASEWORKER', email: 'mock-caseworker@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  }

  function mockClaimantSession() {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'mock-claimant@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  }

  beforeAll(async () => {
    const claimantUser = await prisma.user.create({
      data: { email: `msg-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const profile = await prisma.claimantProfile.create({ data: { userId: claimantUser.id } });
    claimantProfileId = profile.id;
    const caseworker = await prisma.user.create({
      data: { email: `msg-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerId = caseworker.id;
  });

  it('sends a message from a caseworker to a claimant, attributed to the session caseworker', async () => {
    mockCaseworkerSession();
    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        claimantProfileId,
        // Deliberately mismatched from the mocked session's caseworker id —
        // proves the route ignores a client-supplied caseworkerId and always
        // attributes the message to the verified session instead.
        caseworkerId: 'attacker-supplied-not-a-real-user-id',
        subject: 'Additional information needed',
        body: 'Please provide documentation of your job search for the week of 8/15.',
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const sent = await res.json();
    expect(sent.caseworkerId).toBe(caseworkerId);
  });

  it('lists messages for a claimant', async () => {
    mockClaimantSession();
    const res = await GET(
      new Request(`http://localhost/api/messages?claimantProfileId=${claimantProfileId}`)
    );
    const messages = await res.json();
    expect(messages).toHaveLength(1);
    expect(messages[0].subject).toBe('Additional information needed');
  });

  it('marks unread messages as read on fetch', async () => {
    mockCaseworkerSession();
    const sendReq = new Request('http://localhost/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        claimantProfileId,
        caseworkerId,
        subject: 'Second notice',
        body: 'Your certification is under review.',
      }),
    });
    const sendRes = await POST(sendReq);
    const sent = await sendRes.json();
    expect(sent.readAt).toBeNull();

    mockClaimantSession();
    const firstGetRes = await GET(
      new Request(`http://localhost/api/messages?claimantProfileId=${claimantProfileId}`)
    );
    const firstMessages = await firstGetRes.json();
    const firstFetched = firstMessages.find((m: { id: string }) => m.id === sent.id);
    expect(firstFetched.readAt).toBeNull();

    const secondGetRes = await GET(
      new Request(`http://localhost/api/messages?claimantProfileId=${claimantProfileId}`)
    );
    const secondMessages = await secondGetRes.json();
    const secondFetched = secondMessages.find((m: { id: string }) => m.id === sent.id);
    expect(secondFetched.readAt).not.toBeNull();

    const dbMessage = await prisma.message.findUnique({ where: { id: sent.id } });
    expect(dbMessage?.readAt).not.toBeNull();
  });

  afterAll(async () => {
    await prisma.message.deleteMany({ where: { claimantId: claimantProfileId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: caseworkerId } });
    await prisma.$disconnect();
  });
});
