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

  // Wage records for the seeded claim, so a fresh seed + login as the
  // seeded caseworker actually demonstrates the evidence bundle this plan
  // was built to deliver — including the conflict-flag panel: the seeded
  // certification above reports no work/earnings for the week, and this
  // first record has no separation on file (an active job), which is
  // exactly what findConflictingWageRecords flags as a conflict.
  const existingWageRecords = await prisma.wageRecord.findFirst({ where: { claimId: claim.id } });
  if (!existingWageRecords) {
    const seededRecords = await prisma.wageRecord.createMany({
      data: [
        {
          claimId: claim.id,
          employerName: 'Acme Corp',
          fein: '43-1234567',
          workLocation: 'Jefferson City, MO',
          jobTitle: 'Machinist',
          firstDayWorked: new Date('2024-06-01'),
          lastDayWorked: null,
          wageRate: 22.5,
          hoursPerWeek: 40,
          separationReason: 'N/A — no separation on file, job still active',
          recallDate: null,
          source: 'Simulated state wage database lookup',
        },
        {
          claimId: claim.id,
          employerName: 'Riverbend Logistics Inc.',
          fein: '61-9876543',
          workLocation: 'Columbia, MO',
          jobTitle: 'Warehouse Associate',
          firstDayWorked: new Date('2025-01-10'),
          lastDayWorked: new Date('2026-07-18'),
          wageRate: 18.75,
          hoursPerWeek: 32,
          separationReason: 'Seasonal layoff',
          recallDate: null,
          source: 'Simulated state wage database lookup',
        },
      ],
    });

    // Mirrors the WAGE_LOOKUP_PERFORMED audit entry POST /api/wage-lookup
    // writes on a real lookup — that entry is the idempotency signal the
    // route checks before generating new records. Without it here, a
    // claimant visiting /claim/wage-confirmation for this seeded claim would
    // never see a "prior lookup", and the route would append a further mock
    // record on top of these two every time.
    await prisma.auditLog.create({
      data: {
        actorUserId: claimantUser.id,
        action: 'WAGE_LOOKUP_PERFORMED',
        targetEntity: 'Claim',
        targetId: claim.id,
        metadata: { recordCount: seededRecords.count },
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
