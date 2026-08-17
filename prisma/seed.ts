// prisma/seed.ts
import bcrypt from 'bcryptjs';
import { prisma } from '../src/lib/prisma';
import { evaluateCertification } from '../src/lib/decisionEngine';
import { hashSSN } from '../src/lib/ssnHash';
import { encryptSSN } from '../src/lib/encryption';

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

  const systemActorPasswordHash = await bcrypt.hash(`system-actor-${Date.now()}-not-a-login`, 12);
  await prisma.user.upsert({
    where: { email: 'system@emplement.internal' },
    update: {},
    create: {
      email: 'system@emplement.internal',
      passwordHash: systemActorPasswordHash,
      role: 'ADMIN',
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
      ssnHash: hashSSN('247-01-3456'),
    },
  });

  // Backfill ssnEncrypted/ssnHash for already-seeded environments —
  // including this worktree's local dev database and production — that
  // already have a Seed Claimant row from before these fields were
  // required, and ssnHash must be non-null for the guided demo's Hire step
  // to succeed while ssnEncrypted must be set for the staff Reveal SSN form
  // to work. The two are normally written together (mirroring
  // src/app/api/identity-verification/callback/route.ts), but this checks
  // each independently rather than gating both on ssnHash alone: an earlier
  // version of this backfill (already run against some databases, including
  // this worktree's local dev database, before this check existed) wrote
  // ssnHash unconditionally without ever setting ssnEncrypted, so a
  // ssnHash-only guard would permanently skip the ssnEncrypted backfill on
  // those rows. Only backfilling what's actually unset means a real
  // identity-verification run through this same profile is never silently
  // reverted by a later re-seed, and a fake-hash collision with a real SSN
  // can't abort the rest of the seed run with P2002.
  const seedSsn = '247-01-3456';
  const profileSsnBackfill: { ssnEncrypted?: string; ssnHash?: string } = {};
  if (!profile.ssnEncrypted) profileSsnBackfill.ssnEncrypted = encryptSSN(seedSsn);
  if (!profile.ssnHash) profileSsnBackfill.ssnHash = hashSSN(seedSsn);
  if (Object.keys(profileSsnBackfill).length > 0) {
    await prisma.claimantProfile.update({
      where: { id: profile.id },
      data: profileSsnBackfill,
    });
  }

  const existingClaim = await prisma.claim.findFirst({ where: { claimantId: profile.id } });
  const claim =
    existingClaim ??
    (await prisma.claim.create({
      data: {
        claimantId: profile.id,
        // ACTIVE (not RESTRICTED): the guided demo scenario hires this same
        // claimant later (see the Interview seeded further below) and needs
        // a visible ACTIVE -> RESTRICTED transition to show — the hire
        // route only flips claims that start ACTIVE.
        status: 'ACTIVE',
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

  // Employer marketplace demo data — gives the "one-click demo" a real
  // employer, real postings, and an applicant already waiting so the whole
  // apply -> review -> hire -> claim-status story is visible on first login,
  // not just after manually clicking through an empty marketplace.
  const employerPasswordHash = await bcrypt.hash('EmployerPass123', 12);
  const employerUser = await prisma.user.upsert({
    where: { email: 'employer@example.com' },
    update: {},
    create: {
      email: 'employer@example.com',
      passwordHash: employerPasswordHash,
      role: 'EMPLOYER',
    },
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

  const postingSeeds = [
    {
      title: 'Warehouse Associate',
      description: 'Day shift, full time. Forklift certification a plus.',
      location: 'Jefferson City, MO',
      tags: ['TRANSPORTATION_MATERIAL_MOVING', 'PRODUCTION_MANUFACTURING'] as const,
    },
    {
      title: 'Customer Service Representative',
      description: 'Inbound support for logistics customers, full time.',
      location: 'Columbia, MO',
      tags: ['OFFICE_ADMINISTRATIVE', 'SALES'] as const,
    },
    {
      title: 'Certified Nursing Assistant',
      description: 'Skilled nursing facility, evening shift.',
      location: 'Springfield, MO',
      tags: ['HEALTHCARE_SUPPORT'] as const,
    },
  ];
  const postings = [];
  for (const seed of postingSeeds) {
    const existing = await prisma.jobPosting.findFirst({
      where: { employerId: employerProfile.id, title: seed.title },
    });
    const posting =
      existing ??
      (await prisma.jobPosting.create({
        data: {
          employerId: employerProfile.id,
          title: seed.title,
          description: seed.description,
          location: seed.location,
          tags: [...seed.tags],
        },
      }));
    postings.push(posting);
  }

  // Give the seeded claimant a candidate profile tagged to match the first
  // posting, so "Recommended for you" has something to show immediately.
  const candidateProfile = await prisma.candidateProfile.upsert({
    where: { claimantProfileId: profile.id },
    update: {},
    create: {
      claimantProfileId: profile.id,
      headline: 'Warehouse & Logistics Associate',
      skills: 'Forklift certified, inventory management, RF scanner experience',
      availability: 'Immediate',
      tags: ['TRANSPORTATION_MATERIAL_MOVING'],
    },
  });

  // The claimant has already applied to the first posting, so logging in as
  // the seeded employer immediately shows a real applicant to review. This
  // is also the guided demo scenario's claimant/application: their claim
  // starts ACTIVE above specifically so hiring them later (once the
  // Interview seeded just below is accepted) produces a visible
  // ACTIVE -> RESTRICTED transition.
  const warehousePosting = postings[0]!;
  const application1 =
    (await prisma.jobApplication.findFirst({
      where: { jobPostingId: warehousePosting.id, candidateProfileId: candidateProfile.id },
    })) ??
    (await prisma.jobApplication.create({
      data: {
        jobPostingId: warehousePosting.id,
        candidateProfileId: candidateProfile.id,
        initiatedBy: 'CANDIDATE',
      },
    }));

  // This applicant's interview is already PROPOSED (not yet responded to),
  // so both sides of the live interview-scheduling story are demonstrable
  // without first having to manually walk through the propose step: the
  // employer's job-posting page shows "waiting for candidate response",
  // and claimant@example.com's My Applications page shows two proposed
  // times ready to Accept — the interactive half of the demo.
  const existingInterview1 = await prisma.interview.findUnique({
    where: { jobApplicationId: application1.id },
  });
  if (!existingInterview1) {
    await prisma.interview.create({
      data: {
        jobApplicationId: application1.id,
        status: 'PROPOSED',
        location: 'Riverbend Logistics Inc. — 4400 Freight Way, Jefferson City, MO',
        slots: {
          create: [
            { startTime: new Date('2026-08-19T15:00:00Z') }, // 10:00 AM Central
            { startTime: new Date('2026-08-20T19:00:00Z') }, // 2:00 PM Central
          ],
        },
      },
    });
  }

  // A second demo claimant whose claim starts ACTIVE, specifically so
  // clicking Hire on their application visibly flips it to RESTRICTED —
  // the actual before/after moment the marketplace hire flow is meant to
  // demonstrate. Applies to a different posting than the first claimant so
  // the employer sees two distinct applicants across two postings.
  const claimant2PasswordHash = await bcrypt.hash('Claimant2Pass123', 12);
  const claimant2User = await prisma.user.upsert({
    where: { email: 'claimant2@example.com' },
    update: {},
    create: {
      email: 'claimant2@example.com',
      passwordHash: claimant2PasswordHash,
      role: 'CLAIMANT',
    },
  });
  const profile2 = await prisma.claimantProfile.upsert({
    where: { userId: claimant2User.id },
    update: {},
    create: {
      userId: claimant2User.id,
      legalName: 'Seed Claimant Two',
      identityVerificationStatus: 'VERIFIED',
    },
  });
  const existingClaim2 = await prisma.claim.findFirst({ where: { claimantId: profile2.id } });
  if (!existingClaim2) {
    await prisma.claim.create({
      data: {
        claimantId: profile2.id,
        status: 'ACTIVE',
        benefitYearStart: new Date('2026-08-01'),
        benefitYearEnd: new Date('2027-08-01'),
        weeklyBenefitAmount: 300,
      },
    });
  }
  const candidateProfile2 = await prisma.candidateProfile.upsert({
    where: { claimantProfileId: profile2.id },
    update: {},
    create: {
      claimantProfileId: profile2.id,
      headline: 'Customer Service Specialist',
      skills: 'Call center experience, CRM software, bilingual (English/Spanish)',
      availability: 'Immediate',
      tags: ['OFFICE_ADMINISTRATIVE'],
    },
  });
  const customerServicePosting = postings[1]!;
  const application2 =
    (await prisma.jobApplication.findFirst({
      where: { jobPostingId: customerServicePosting.id, candidateProfileId: candidateProfile2.id },
    })) ??
    (await prisma.jobApplication.create({
      data: {
        jobPostingId: customerServicePosting.id,
        candidateProfileId: candidateProfile2.id,
        initiatedBy: 'CANDIDATE',
      },
    }));

  // This applicant's interview is already CONFIRMED (accepted), so the
  // employer's job-posting page shows a confirmed date/time and a natural
  // next action — Hire — completing the full story this second demo
  // claimant exists for: apply -> interview scheduled -> accepted ->
  // hired -> ACTIVE claim visibly flips to RESTRICTED. Hire/Reject stay
  // fully independent of interview status by design (unchanged from the
  // interview-scheduling spec) — this is a demo-narrative sequence, not a
  // new dependency between the two.
  const existingInterview2 = await prisma.interview.findUnique({
    where: { jobApplicationId: application2.id },
  });
  if (!existingInterview2) {
    const confirmedSlot = new Date('2026-08-18T14:00:00Z'); // 9:00 AM Central
    await prisma.interview.create({
      data: {
        jobApplicationId: application2.id,
        status: 'CONFIRMED',
        confirmedSlot,
        location: 'Video call — link sent by email after confirmation',
        slots: {
          create: [
            { startTime: confirmedSlot },
            { startTime: new Date('2026-08-18T18:00:00Z') }, // 1:00 PM Central, not chosen
          ],
        },
      },
    });
  }

  // An unmatched employer-reported hire event, so the staff unmatched-events
  // queue (/staff/unmatched-events) has something to demonstrate too — a
  // marketplace hire always arrives already matched by design, so only a
  // manually-reported event with no corresponding claimant shows up here.
  const existingUnmatchedEvent = await prisma.employmentEvent.findFirst({
    where: { employerId: employerProfile.id, employeeName: 'Pat Reyes' },
  });
  if (!existingUnmatchedEvent) {
    await prisma.employmentEvent.create({
      data: {
        employerId: employerProfile.id,
        type: 'HIRE',
        employeeName: 'Pat Reyes',
        ssnHash: hashSSN('999-99-9999'),
        eventDate: new Date('2026-08-10'),
      },
    });
  }

  console.log('Seed complete: caseworker@example.com / CaseworkerPass123');
  console.log('Seed complete: claimant@example.com / ClaimantPass123 (flagged certification, claim ACTIVE; has a PROPOSED interview to Accept/Decline on My Applications — this is the guided demo scenario claimant)');
  console.log('Seed complete: claimant2@example.com / Claimant2Pass123 (claim ACTIVE, interview already CONFIRMED — hire this applicant to see it flip to RESTRICTED)');
  console.log('Seed complete: employer@example.com / EmployerPass123 (3 postings, 2 applicants — one interview proposed, one confirmed and ready to hire)');
  console.log('Seed complete: system@emplement.internal (service account for scheduled jobs, no login)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
