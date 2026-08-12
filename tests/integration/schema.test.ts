import { describe, it, expect, afterAll } from 'vitest';
import { prisma } from '@/lib/prisma';

describe('database schema', () => {
  it('can create and read back a User', async () => {
    const user = await prisma.user.create({
      data: {
        email: `schema-test-${Date.now()}@example.com`,
        passwordHash: 'not-a-real-hash',
        role: 'CLAIMANT',
      },
    });

    const found = await prisma.user.findUnique({ where: { id: user.id } });
    expect(found?.email).toBe(user.email);

    await prisma.user.delete({ where: { id: user.id } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
