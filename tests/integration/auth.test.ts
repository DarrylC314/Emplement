import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { prisma } from '@/lib/prisma';
import { authorizeCredentials } from '@/lib/auth';
import bcrypt from 'bcryptjs';

describe('authorizeCredentials', () => {
  const claimantEmail = `auth-test-claimant-${Date.now()}@example.com`;
  const claimantPassword = 'CorrectHorseBattery9';
  const caseworkerEmail = `auth-test-caseworker-${Date.now()}@example.com`;
  const caseworkerPassword = 'SecurePassword123';

  let claimantUserId: string;
  let claimantProfileId: string;
  let caseworkerUserId: string;

  // Setup: Create test users once before all tests
  beforeAll(async () => {
    // Create a CLAIMANT user with ClaimantProfile
    const claimantUser = await prisma.user.create({
      data: {
        email: claimantEmail,
        passwordHash: await bcrypt.hash(claimantPassword, 12),
        role: 'CLAIMANT',
      },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id },
    });
    claimantProfileId = claimantProfile.id;

    // Create a CASEWORKER user (no ClaimantProfile)
    const caseworkerUser = await prisma.user.create({
      data: {
        email: caseworkerEmail,
        passwordHash: await bcrypt.hash(caseworkerPassword, 12),
        role: 'CASEWORKER',
      },
    });
    caseworkerUserId = caseworkerUser.id;
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
    // Clean up: Delete claimant profile and users using stored IDs
    await prisma.claimantProfile.deleteMany({
      where: {
        userId: { in: [claimantUserId] },
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: { in: [claimantUserId, caseworkerUserId] },
      },
    });
    await prisma.$disconnect();
  });
});
