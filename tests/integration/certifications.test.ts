import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST } from '@/app/api/certifications/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/certifications', () => {
  let claimId: string;
  let userId: string;
  let claimantProfileId: string;
  const certificationIds: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `cert-test-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    userId = user.id;
    const profile = await prisma.claimantProfile.create({
      data: { userId: user.id, identityVerificationStatus: 'VERIFIED' },
    });
    claimantProfileId = profile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: user.id, role: 'CLAIMANT', claimantProfileId: profile.id, email: user.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    const claim = await prisma.claim.create({
      data: {
        claimantId: profile.id,
        status: 'ACTIVE',
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });
    claimId = claim.id;
  });

  it('auto-approves a clean certification and writes an audit log', async () => {
    const req = new Request('http://localhost/api/certifications', {
      method: 'POST',
      body: JSON.stringify({
        claimId,
        weekEndingDate: '2026-08-15',
        ableAndAvailable: true,
        workedThisWeek: false,
        earnings: 0,
        refusedWork: false,
        jobSearchActivities: [
          { employerName: 'Acme', contactMethod: 'Online', contactDate: '2026-08-12', position: 'Machinist' },
          { employerName: 'Beta', contactMethod: 'Phone', contactDate: '2026-08-13', position: 'Operator' },
          { employerName: 'Gamma', contactMethod: 'In person', contactDate: '2026-08-14', position: 'Technician' },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const cert = await res.json();
    expect(cert.autoDecision).toBe('APPROVED');
    certificationIds.push(cert.id);

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'WeeklyCertification', targetId: cert.id },
    });
    expect(log).not.toBeNull();
  });

  it('flags a certification with fewer than 3 job-search contacts', async () => {
    const req = new Request('http://localhost/api/certifications', {
      method: 'POST',
      body: JSON.stringify({
        claimId,
        weekEndingDate: '2026-08-22',
        ableAndAvailable: true,
        workedThisWeek: false,
        earnings: 0,
        refusedWork: false,
        jobSearchActivities: [
          { employerName: 'Acme', contactMethod: 'Online', contactDate: '2026-08-19', position: 'Machinist' },
        ],
      }),
    });
    const res = await POST(req);
    const cert = await res.json();
    expect(cert.autoDecision).toBe('FLAGGED');
    certificationIds.push(cert.id);
  });

  it('refuses a certification against a DENIED or CLOSED claim', async () => {
    const closedClaim = await prisma.claim.create({
      data: {
        claimantId: claimantProfileId,
        status: 'CLOSED',
        benefitYearStart: new Date('2026-08-11'),
        benefitYearEnd: new Date('2027-08-11'),
        weeklyBenefitAmount: 320,
      },
    });

    const req = new Request('http://localhost/api/certifications', {
      method: 'POST',
      body: JSON.stringify({
        claimId: closedClaim.id,
        weekEndingDate: '2026-08-29',
        ableAndAvailable: true,
        workedThisWeek: false,
        earnings: 0,
        refusedWork: false,
        jobSearchActivities: [
          { employerName: 'Acme', contactMethod: 'Online', contactDate: '2026-08-26', position: 'Machinist' },
          { employerName: 'Beta', contactMethod: 'Phone', contactDate: '2026-08-27', position: 'Operator' },
          { employerName: 'Gamma', contactMethod: 'In person', contactDate: '2026-08-28', position: 'Technician' },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/closed/i);

    // No certification may be recorded against a terminal claim.
    const created = await prisma.weeklyCertification.count({ where: { claimId: closedClaim.id } });
    expect(created).toBe(0);

    await prisma.claim.delete({ where: { id: closedClaim.id } });
  });

  it('rejects a malformed JSON body with a clean 400', async () => {
    const res = await POST(
      new Request('http://localhost/api/certifications', { method: 'POST', body: '<<<not json' })
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid request body' });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { targetEntity: 'WeeklyCertification', targetId: { in: certificationIds } },
    });
    await prisma.jobSearchActivity.deleteMany({
      where: { weeklyCertification: { claimId } },
    });
    await prisma.weeklyCertification.deleteMany({ where: { claimId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });
});
