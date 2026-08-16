import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { GET as scenarioLinks } from '@/app/api/demo/scenario-links/route';

describe('GET /api/demo/scenario-links', () => {
  beforeAll(async () => {
    // Upserted (not created) by the exact identities prisma/seed.ts uses,
    // so this test works whether or not the real seed script has already
    // run against this database, and never collides with it on a shared
    // unique email/id.
    const claimantUser = await prisma.user.upsert({
      where: { email: 'claimant@example.com' },
      update: {},
      create: { email: 'claimant@example.com', passwordHash: 'x', role: 'CLAIMANT' },
    });
    await prisma.claimantProfile.upsert({
      where: { userId: claimantUser.id },
      update: {},
      create: { userId: claimantUser.id, legalName: 'Seed Claimant', identityVerificationStatus: 'VERIFIED' },
    });

    const employerUser = await prisma.user.upsert({
      where: { email: 'employer@example.com' },
      update: {},
      create: { email: 'employer@example.com', passwordHash: 'x', role: 'EMPLOYER' },
    });
    const employerProfile = await prisma.employerProfile.upsert({
      where: { userId: employerUser.id },
      update: {},
      create: {
        userId: employerUser.id,
        fein: '47-1002233',
        companyName: 'Riverbend Logistics Inc.',
        verificationStatus: 'VERIFIED',
      },
    });

    const existingPosting = await prisma.jobPosting.findFirst({
      where: { employerId: employerProfile.id, title: 'Warehouse Associate' },
    });
    if (!existingPosting) {
      await prisma.jobPosting.create({
        data: {
          employerId: employerProfile.id,
          title: 'Warehouse Associate',
          description: 'N/A',
          location: 'Jefferson City, MO',
        },
      });
    }
  });

  it('resolves the warehouse posting id and Seed Claimant\'s profile id', async () => {
    const res = await scenarioLinks();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.warehousePostingId).toBe('string');
    expect(typeof body.claimantProfileId).toBe('string');
  });
});
