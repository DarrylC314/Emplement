import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function cleanup() {
  try {
    // Count orphaned test users before cleanup
    const beforeCount = await prisma.user.count({
      where: {
        OR: [
          { email: { contains: 'claimant-' } },
          { email: { contains: 'caseworker-' } },
          { email: { contains: 'auth-test-' } },
        ],
        email: { endsWith: '@example.com' },
      },
    });

    console.log(`Orphaned test users before cleanup: ${beforeCount}`);

    // Get all orphaned claimant profile IDs
    const orphanedUserIds = await prisma.user.findMany({
      where: {
        OR: [
          { email: { contains: 'claimant-' } },
          { email: { contains: 'caseworker-' } },
          { email: { contains: 'auth-test-' } },
        ],
        email: { endsWith: '@example.com' },
      },
      select: { id: true },
    });

    const userIds = orphanedUserIds.map(u => u.id);

    // Delete orphaned claimant profiles first
    const deletedProfiles = await prisma.claimantProfile.deleteMany({
      where: { userId: { in: userIds } },
    });

    console.log(`Deleted orphaned ClaimantProfiles: ${deletedProfiles.count}`);

    // Delete orphaned users
    const deletedUsers = await prisma.user.deleteMany({
      where: {
        OR: [
          { email: { contains: 'claimant-' } },
          { email: { contains: 'caseworker-' } },
          { email: { contains: 'auth-test-' } },
        ],
        email: { endsWith: '@example.com' },
      },
    });

    console.log(`Deleted orphaned Users: ${deletedUsers.count}`);

    // Count remaining test users
    const afterCount = await prisma.user.count({
      where: {
        OR: [
          { email: { contains: 'claimant-' } },
          { email: { contains: 'caseworker-' } },
          { email: { contains: 'auth-test-' } },
        ],
        email: { endsWith: '@example.com' },
      },
    });

    console.log(`Orphaned test users after cleanup: ${afterCount}`);
    console.log(`Total cleaned: ${beforeCount - afterCount} rows`);
  } catch (error) {
    console.error('Cleanup error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

cleanup();
