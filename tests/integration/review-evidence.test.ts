import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET } from '@/app/api/certifications/[id]/review/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('GET /api/certifications/[id]/review', () => {
  let caseworkerId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let claimId: string;
  let certId: string;
  let wageRecordId: string;

  beforeAll(async () => {
    const caseworker = await prisma.user.create({
      data: { email: `evidence-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerId = caseworker.id;

    const claimantUser = await prisma.user.create({
      data: { email: `evidence-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const profile = await prisma.claimantProfile.create({
      data: { userId: claimantUser.id, legalName: 'Evidence Test Claimant' },
    });
    claimantProfileId = profile.id;

    const claim = await prisma.claim.create({
      data: {
        claimantId: profile.id,
        status: 'RESTRICTED',
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });
    claimId = claim.id;

    const cert = await prisma.weeklyCertification.create({
      data: {
        claimId,
        weekEndingDate: new Date('2026-08-15'),
        ableAndAvailable: true,
        workedThisWeek: false,
        earnings: 0,
        refusedWork: false,
        autoDecision: 'FLAGGED',
        autoDecisionReason: 'Fewer than 3 job-search contacts.',
        autoDecisionRuleId: 'JOB_SEARCH_MINIMUM',
        autoDecisionThreshold: '3 contacts',
        autoDecisionActualValue: '1 contacts',
        jobSearchActivities: {
          create: [
            { employerName: 'Acme', contactMethod: 'Online', contactDate: new Date('2026-08-12'), position: 'Machinist' },
          ],
        },
      },
    });
    certId = cert.id;

    await prisma.caseNote.create({
      data: { claimId, caseworkerId: caseworker.id, note: 'Called claimant, left voicemail.' },
    });

    const wageRecord = await prisma.wageRecord.create({
      data: {
        claimId,
        employerName: 'Acme Manufacturing LLC',
        fein: '43-1234567',
        workLocation: 'Jefferson City, MO',
        jobTitle: 'Machinist',
        firstDayWorked: new Date('2024-01-01'),
        wageRate: 22.5,
        hoursPerWeek: 40,
        separationReason: 'Laid off',
        source: 'Simulated state wage database lookup',
        employerVerifiedStatus: 'DISPUTED',
        employerDisputeNote: 'Wage rate is wrong.',
      },
    });
    wageRecordId = wageRecord.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworker.id, role: 'CASEWORKER', email: caseworker.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('returns the full evidence bundle including a computed conflict', async () => {
    const res = await GET(new Request('http://localhost/api/certifications/x/review'), {
      params: { id: certId },
    });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.certification.autoDecisionRuleId).toBe('JOB_SEARCH_MINIMUM');
    expect(body.jobSearchActivities).toHaveLength(1);
    expect(body.claim.claimantName).toBe('Evidence Test Claimant');
    expect(body.caseNotes).toHaveLength(1);
    expect(body.wageRecords).toHaveLength(1);
    expect(body.wageRecords[0].id).toBe(wageRecordId);
    expect(body.wageRecords[0].employerVerifiedStatus).toBe('DISPUTED');
    expect(body.wageRecords[0].employerDisputeNote).toBe('Wage rate is wrong.');
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].wageRecordId).toBe(wageRecordId);
    expect(Number(body.paymentPreview.approve)).toBe(320);
  });

  it('rejects a claimant session', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValueOnce({
      user: { id: claimantUserId, role: 'CLAIMANT', claimantProfileId, email: 'x@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const res = await GET(new Request('http://localhost/api/certifications/x/review'), {
      params: { id: certId },
    });
    expect(res.status).toBe(403);
  });

  afterAll(async () => {
    await prisma.wageRecord.deleteMany({ where: { claimId } });
    await prisma.caseNote.deleteMany({ where: { claimId } });
    await prisma.jobSearchActivity.deleteMany({ where: { weeklyCertificationId: certId } });
    await prisma.weeklyCertification.delete({ where: { id: certId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: caseworkerId } });
    await prisma.$disconnect();
  });
});
