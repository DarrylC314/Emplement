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

  it('can create and read back a WageRecord, Payment, and Document tied to a claim', async () => {
    const user = await prisma.user.create({
      data: {
        email: `schema-test-wage-${Date.now()}@example.com`,
        passwordHash: 'not-a-real-hash',
        role: 'CLAIMANT',
      },
    });
    const profile = await prisma.claimantProfile.create({ data: { userId: user.id } });
    const claim = await prisma.claim.create({
      data: {
        claimantId: profile.id,
        status: 'ACTIVE',
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });
    const cert = await prisma.weeklyCertification.create({
      data: {
        claimId: claim.id,
        weekEndingDate: new Date('2026-08-15'),
        ableAndAvailable: true,
        workedThisWeek: false,
        earnings: 0,
        refusedWork: false,
        autoDecision: 'APPROVED',
        autoDecisionReason: 'All eligibility criteria met.',
        autoDecisionRuleId: 'ALL_CRITERIA_MET',
      },
    });

    const wageRecord = await prisma.wageRecord.create({
      data: {
        claimId: claim.id,
        employerName: 'Acme Manufacturing LLC',
        fein: '43-1234567',
        workLocation: 'Jefferson City, MO',
        jobTitle: 'Machinist',
        firstDayWorked: new Date('2024-01-01'),
        wageRate: 22.5,
        hoursPerWeek: 40,
        separationReason: 'Laid off — reduction in force',
        source: 'Simulated state wage database lookup',
      },
    });
    expect(wageRecord.employerVerifiedStatus).toBe('UNVERIFIED');
    expect(wageRecord.claimantConfirmed).toBe(false);

    const payment = await prisma.payment.create({
      data: {
        claimId: claim.id,
        weeklyCertificationId: cert.id,
        amount: 320,
        status: 'PAID',
      },
    });
    expect(payment.status).toBe('PAID');

    const document = await prisma.document.create({
      data: {
        claimId: claim.id,
        weeklyCertificationId: cert.id,
        uploadedByUserId: user.id,
        filename: 'proof.pdf',
        storedPath: '/tmp/whatever.pdf',
      },
    });
    expect(document.filename).toBe('proof.pdf');

    await prisma.document.delete({ where: { id: document.id } });
    await prisma.payment.delete({ where: { id: payment.id } });
    await prisma.wageRecord.delete({ where: { id: wageRecord.id } });
    await prisma.weeklyCertification.delete({ where: { id: cert.id } });
    await prisma.claim.delete({ where: { id: claim.id } });
    await prisma.claimantProfile.delete({ where: { id: profile.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('can create and read back an EmployerProfile and EmploymentEvent', async () => {
    const user = await prisma.user.create({
      data: {
        email: `schema-test-employer-${Date.now()}@example.com`,
        passwordHash: 'not-a-real-hash',
        role: 'EMPLOYER',
      },
    });

    const employer = await prisma.employerProfile.create({
      data: { userId: user.id },
    });
    expect(employer.fein).toBeNull();
    expect(employer.verificationStatus).toBe('PENDING');

    const verifiedEmployer = await prisma.employerProfile.update({
      where: { id: employer.id },
      data: { fein: '99-9999999', companyName: 'Schema Test Co', verificationStatus: 'VERIFIED' },
    });
    expect(verifiedEmployer.fein).toBe('99-9999999');

    const claimantUser = await prisma.user.create({
      data: {
        email: `schema-test-claimant-${Date.now()}@example.com`,
        passwordHash: 'not-a-real-hash',
        role: 'CLAIMANT',
      },
    });
    const claimant = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: `test-hash-${Date.now()}` },
    });

    const event = await prisma.employmentEvent.create({
      data: {
        employerId: employer.id,
        type: 'HIRE',
        employeeName: 'Test Employee',
        ssnHash: claimant.ssnHash!,
        eventDate: new Date('2026-08-01'),
        matchedClaimantProfileId: claimant.id,
      },
    });
    expect(event.matchedClaimantProfileId).toBe(claimant.id);

    await prisma.employmentEvent.delete({ where: { id: event.id } });
    await prisma.claimantProfile.delete({ where: { id: claimant.id } });
    await prisma.user.delete({ where: { id: claimantUser.id } });
    await prisma.employerProfile.delete({ where: { id: employer.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('can create and read back a ClaimantProfile with prefix, suffix, and gender', async () => {
    const user = await prisma.user.create({
      data: {
        email: `schema-test-identity-${Date.now()}@example.com`,
        passwordHash: 'not-a-real-hash',
        role: 'CLAIMANT',
      },
    });

    const profile = await prisma.claimantProfile.create({
      data: { userId: user.id },
    });
    expect(profile.prefix).toBeNull();
    expect(profile.suffix).toBeNull();
    expect(profile.gender).toBeNull();

    const updated = await prisma.claimantProfile.update({
      where: { id: profile.id },
      data: { prefix: 'DR', suffix: 'JR', gender: 'Non-binary' },
    });
    expect(updated.prefix).toBe('DR');
    expect(updated.suffix).toBe('JR');
    expect(updated.gender).toBe('Non-binary');

    await prisma.claimantProfile.delete({ where: { id: profile.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it('can create and read back an EmploymentEvent with dismissal fields', async () => {
    const employerUser = await prisma.user.create({
      data: { email: `schema-test-employer-dismiss-${Date.now()}@example.com`, passwordHash: 'not-a-real-hash', role: 'EMPLOYER' },
    });
    const employerProfile = await prisma.employerProfile.create({ data: { userId: employerUser.id } });

    const staffUser = await prisma.user.create({
      data: { email: `schema-test-staff-dismiss-${Date.now()}@example.com`, passwordHash: 'not-a-real-hash', role: 'CASEWORKER' },
    });

    const event = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfile.id,
        type: 'HIRE',
        employeeName: 'Test Employee',
        ssnHash: `test-hash-${Date.now()}`,
        eventDate: new Date('2026-08-01'),
      },
    });
    expect(event.dismissedAt).toBeNull();
    expect(event.dismissedByUserId).toBeNull();

    const dismissed = await prisma.employmentEvent.update({
      where: { id: event.id },
      data: { dismissedAt: new Date(), dismissedByUserId: staffUser.id },
    });
    expect(dismissed.dismissedAt).not.toBeNull();
    expect(dismissed.dismissedByUserId).toBe(staffUser.id);

    await prisma.employmentEvent.delete({ where: { id: event.id } });
    await prisma.employerProfile.delete({ where: { id: employerProfile.id } });
    await prisma.user.delete({ where: { id: employerUser.id } });
    await prisma.user.delete({ where: { id: staffUser.id } });
  });

  it('can create and read back a CandidateProfile, JobPosting, and JobApplication', async () => {
    const claimantUser = await prisma.user.create({
      data: { email: `schema-test-candidate-${Date.now()}@example.com`, passwordHash: 'not-a-real-hash', role: 'CLAIMANT' },
    });
    const claimantProfile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, ssnHash: `schema-test-hash-${Date.now()}` },
    });

    const employerUser = await prisma.user.create({
      data: { email: `schema-test-employer-marketplace-${Date.now()}@example.com`, passwordHash: 'not-a-real-hash', role: 'EMPLOYER' },
    });
    const employerProfile = await prisma.employerProfile.create({ data: { userId: employerUser.id } });

    const candidateProfile = await prisma.candidateProfile.create({
      data: {
        claimantProfileId: claimantProfile.id,
        headline: 'Warehouse associate',
        skills: 'Forklift certified, inventory management',
        availability: 'Immediate',
      },
    });
    expect(candidateProfile.bio).toBeNull();

    const jobPosting = await prisma.jobPosting.create({
      data: {
        employerId: employerProfile.id,
        title: 'Warehouse associate',
        description: 'Day shift, full time',
        location: 'Jefferson City, MO',
      },
    });
    expect(jobPosting.status).toBe('OPEN');

    const application = await prisma.jobApplication.create({
      data: {
        jobPostingId: jobPosting.id,
        candidateProfileId: candidateProfile.id,
        initiatedBy: 'CANDIDATE',
      },
    });
    expect(application.status).toBe('PENDING');

    await expect(
      prisma.jobApplication.create({
        data: {
          jobPostingId: jobPosting.id,
          candidateProfileId: candidateProfile.id,
          initiatedBy: 'EMPLOYER',
        },
      })
    ).rejects.toThrow();

    await prisma.jobApplication.delete({ where: { id: application.id } });
    await prisma.jobPosting.delete({ where: { id: jobPosting.id } });
    await prisma.candidateProfile.delete({ where: { id: candidateProfile.id } });
    await prisma.employerProfile.delete({ where: { id: employerProfile.id } });
    await prisma.user.delete({ where: { id: employerUser.id } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfile.id } });
    await prisma.user.delete({ where: { id: claimantUser.id } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
