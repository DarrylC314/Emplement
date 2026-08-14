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

  afterAll(async () => {
    await prisma.$disconnect();
  });
});
