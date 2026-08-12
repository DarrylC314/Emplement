import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';

describe('writeAuditLog', () => {
  it('creates an AuditLog row with the given fields', async () => {
    const user = await prisma.user.create({
      data: {
        email: `audit-test-${Date.now()}@example.com`,
        passwordHash: 'x',
        role: 'CASEWORKER',
      },
    });

    await writeAuditLog({
      actorUserId: user.id,
      action: 'SSN_REVEALED',
      targetEntity: 'ClaimantProfile',
      targetId: 'profile-123',
      metadata: { reason: 'identity dispute review' },
    });

    const logs = await prisma.auditLog.findMany({ where: { actorUserId: user.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe('SSN_REVEALED');
    expect(logs[0].targetEntity).toBe('ClaimantProfile');
    expect((logs[0].metadata as Record<string, unknown>).reason).toBe(
      'identity dispute review'
    );

    await prisma.auditLog.deleteMany({ where: { actorUserId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
