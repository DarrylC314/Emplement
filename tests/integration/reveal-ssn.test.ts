import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { encryptSSN } from '@/lib/encryption';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn().mockResolvedValue({
    user: { id: 'mock-caseworker-user-id', role: 'CASEWORKER', email: 'mock-caseworker@example.com' },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  }),
}));

process.env.SSN_ENCRYPTION_KEY =
  process.env.SSN_ENCRYPTION_KEY ??
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd';

describe('POST /api/staff/claimants/[id]/reveal-ssn', () => {
  let claimantProfileId: string;
  let claimantUserId: string;
  let caseworkerId: string;

  beforeAll(async () => {
    const claimantUser = await prisma.user.create({
      data: { email: `reveal-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const profile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnEncrypted: encryptSSN('123-45-6789') },
    });
    claimantProfileId = profile.id;
    const caseworker = await prisma.user.create({
      data: { email: `reveal-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerId = caseworker.id;
  });

  it('returns the decrypted SSN and writes an audit log', async () => {
    const { POST } = await import('@/app/api/staff/claimants/[id]/reveal-ssn/route');
    const req = new Request(`http://localhost/api/staff/claimants/${claimantProfileId}/reveal-ssn`, {
      method: 'POST',
      body: JSON.stringify({ caseworkerId, reason: 'Identity dispute — verifying against paper file.' }),
    });
    const res = await POST(req, { params: { id: claimantProfileId } });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ssn).toBe('123-45-6789');

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'ClaimantProfile', targetId: claimantProfileId, action: 'SSN_REVEALED' },
    });
    expect(log).not.toBeNull();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { targetId: claimantProfileId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: caseworkerId } });
    await prisma.$disconnect();
  });
});
