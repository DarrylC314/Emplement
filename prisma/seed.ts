// prisma/seed.ts
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import { evaluateCertification } from '../src/lib/decisionEngine';

async function main() {
  const caseworkerPasswordHash = await bcrypt.hash('CaseworkerPass123', 12);
  await prisma.user.upsert({
    where: { email: 'caseworker@example.com' },
    update: {},
    create: {
      email: 'caseworker@example.com',
      passwordHash: caseworkerPasswordHash,
      role: 'CASEWORKER',
    },
  });

  const claimantPasswordHash = await bcrypt.hash('ClaimantPass123', 12);
  const claimantUser = await prisma.user.upsert({
    where: { email: 'claimant@example.com' },
    update: {},
    create: {
      email: 'claimant@example.com',
      passwordHash: claimantPasswordHash,
      role: 'CLAIMANT',
    },
  });

  const profile = await prisma.claimantProfile.upsert({
    where: { userId: claimantUser.id },
    update: {},
    create: {
      userId: claimantUser.id,
      legalName: 'Seed Claimant',
      identityVerificationStatus: 'VERIFIED',
    },
  });

  const existingClaim = await prisma.claim.findFirst({ where: { claimantId: profile.id } });
  const claim =
    existingClaim ??
    (await prisma.claim.create({
      data: {
        claimantId: profile.id,
        status: 'RESTRICTED',
        benefitYearStart: new Date('2026-08-01'),
        benefitYearEnd: new Date('2027-08-01'),
        weeklyBenefitAmount: 320,
      },
    }));

  const decision = evaluateCertification({
    ableAndAvailable: true,
    workedThisWeek: false,
    earnings: 0,
    refusedWork: false,
    jobSearchActivityCount: 1,
  });

  const existingCert = await prisma.weeklyCertification.findFirst({ where: { claimId: claim.id } });
  if (!existingCert) {
    await prisma.weeklyCertification.create({
      data: {
        claimId: claim.id,
        weekEndingDate: new Date('2026-08-08'),
        ableAndAvailable: true,
        workedThisWeek: false,
        earnings: 0,
        refusedWork: false,
        autoDecision: decision.decision,
        autoDecisionReason: decision.reason,
        jobSearchActivities: {
          create: [
            {
              employerName: 'Acme Corp',
              contactMethod: 'Online application',
              contactDate: new Date('2026-08-05'),
              position: 'Machinist',
            },
          ],
        },
      },
    });
  }

  console.log('Seed complete: caseworker@example.com / CaseworkerPass123');
  console.log('Seed complete: claimant@example.com / ClaimantPass123 (has a flagged certification)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
