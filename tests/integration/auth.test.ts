import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import { authorizeCredentials } from '@/lib/auth';
import bcrypt from 'bcryptjs';

describe('authorizeCredentials', () => {
  let claimantEmail: string;
  let claimantPassword: string;
  let claimantProfileId: string;
  let caseworkerEmail: string;
  let caseworkerPassword: string;

  // Setup: Create test users
  beforeEach(async () => {
    claimantEmail = `claimant-${Date.now()}@example.com`;
    claimantPassword = 'CorrectHorseBattery9';
    caseworkerEmail = `caseworker-${Date.now()}@example.com`;
    caseworkerPassword = 'SecurePassword123';

    // Create a CLAIMANT user with ClaimantProfile
    const claimantUser = await prisma.user.create({
      data: {
        email: claimantEmail,
        passwordHash: await bcrypt.hash(claimantPassword, 12),
        role: 'CLAIMANT',
      },
    });
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id },
    });
    claimantProfileId = claimantProfile.id;

    // Create a CASEWORKER user (no ClaimantProfile)
    await prisma.user.create({
      data: {
        email: caseworkerEmail,
        passwordHash: await bcrypt.hash(caseworkerPassword, 12),
        role: 'CASEWORKER',
      },
    });
  });

  it('resolves claimantProfileId for a CLAIMANT user', async () => {
    const result = await authorizeCredentials(claimantEmail, claimantPassword);
    expect(result).not.toBeNull();
    expect(result?.claimantProfileId).toBe(claimantProfileId);
    expect(result?.role).toBe('CLAIMANT');
  });

  it('returns undefined claimantProfileId for a CASEWORKER user', async () => {
    const result = await authorizeCredentials(caseworkerEmail, caseworkerPassword);
    expect(result).not.toBeNull();
    expect(result?.claimantProfileId).toBeUndefined();
    expect(result?.role).toBe('CASEWORKER');
  });

  it('returns null for invalid credentials', async () => {
    const result = await authorizeCredentials(claimantEmail, 'WrongPassword123');
    expect(result).toBeNull();
  });

  it('returns null for non-existent user', async () => {
    const result = await authorizeCredentials('nonexistent@example.com', claimantPassword);
    expect(result).toBeNull();
  });

  afterAll(async () => {
    // Clean up: Delete claimant profile and users
    await prisma.claimantProfile.deleteMany({
      where: {
        userId: {
          in: [
            (await prisma.user.findUnique({ where: { email: claimantEmail } }))?.id,
            (await prisma.user.findUnique({ where: { email: caseworkerEmail } }))?.id,
          ].filter((id) => id !== undefined) as string[],
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        email: { in: [claimantEmail, caseworkerEmail] },
      },
    });
    await prisma.$disconnect();
  });
});
