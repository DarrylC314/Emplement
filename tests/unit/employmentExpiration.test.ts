import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { hashSSN } from '@/lib/ssnHash';
import { runEmploymentExpirationCheck, FIXED_TERM_SEPARATION_REASON } from '@/lib/employmentExpiration';

describe('runEmploymentExpirationCheck', () => {
  let systemActorUserId: string;
  let employerUserId: string;
  let employerProfileId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  const claimIds: string[] = [];
  const employmentEventIds: string[] = [];

  beforeEach(async () => {
    // Only Date is faked (not setTimeout/setInterval/etc.) — these tests
    // make real Prisma calls against a real database while the fake clock
    // is active, and Prisma's own network I/O relies on real timers.
    // Faking every timer alongside real async DB calls risks hangs.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-05T12:00:00Z'));

    const systemUser = await prisma.user.upsert({
      where: { email: 'system@emplement.internal' },
      update: {},
      create: { email: 'system@emplement.internal', passwordHash: 'x', role: 'ADMIN' },
    });
    systemActorUserId = systemUser.id;

    const employerUser = await prisma.user.create({
      data: { email: `expiration-employer-${Date.now()}-${Math.random()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    employerUserId = employerUser.id;
    const employerProfile = await prisma.employerProfile.create({
      data: { userId: employerUser.id, companyName: 'Expiration Test Co', verificationStatus: 'VERIFIED' },
    });
    employerProfileId = employerProfile.id;

    const claimantUser = await prisma.user.create({
      data: { email: `expiration-claimant-${Date.now()}-${Math.random()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const claimantProfile = await prisma.claimantProfile.create({
      data: {
        userId: claimantUser.id,
        legalName: 'Expiration Test Claimant',
        ssnHash: hashSSN('512-88-3344'),
        identityVerificationStatus: 'VERIFIED',
      },
    });
    claimantProfileId = claimantProfile.id;
  });

  afterEach(async () => {
    vi.useRealTimers();
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [employerUserId, systemActorUserId] } } });
    await prisma.message.deleteMany({ where: { claimantId: claimantProfileId } });
    await prisma.employmentEvent.deleteMany({ where: { id: { in: employmentEventIds } } });
    employmentEventIds.length = 0;
    await prisma.claim.deleteMany({ where: { id: { in: claimIds } } });
    claimIds.length = 0;
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: employerUserId } });
  });

  async function createRestrictedClaim(overrides: { benefitYearEnd?: Date } = {}) {
    const claim = await prisma.claim.create({
      data: {
        claimantId: claimantProfileId,
        status: 'RESTRICTED',
        benefitYearStart: new Date('2026-08-01'),
        benefitYearEnd: overrides.benefitYearEnd ?? new Date('2027-08-01'),
        weeklyBenefitAmount: 320,
      },
    });
    claimIds.push(claim.id);
    return claim;
  }

  async function createDueHireEvent(overrides: { expectedEndDate?: Date; matchedClaimantProfileId?: string | null } = {}) {
    const event = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Expiration Test Claimant',
        ssnHash: hashSSN('512-88-3344'),
        eventDate: new Date('2026-08-01'),
        expectedEndDate: overrides.expectedEndDate ?? new Date('2026-12-01T05:59:59.999Z'),
        matchedClaimantProfileId:
          overrides.matchedClaimantProfileId === undefined ? claimantProfileId : overrides.matchedClaimantProfileId,
      },
    });
    employmentEventIds.push(event.id);
    return event;
  }

  it('reactivates the claim when it was the final active employment and structural checks pass', async () => {
    await createRestrictedClaim();
    const hireEvent = await createDueHireEvent();

    const summary = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });

    expect(summary.recordsEvaluated).toBe(1);
    expect(summary.separationsCreated).toBe(1);
    expect(summary.claimsReactivated).toBe(1);
    expect(summary.claimsSentToReevaluation).toBe(0);
    expect(summary.claimsRetainedRestricted).toBe(0);
    expect(summary.failures).toEqual([]);

    const claim = await prisma.claim.findUnique({ where: { id: claimIds[0] } });
    expect(claim?.status).toBe('ACTIVE');

    const separation = await prisma.employmentEvent.findFirst({
      where: { employerId: employerProfileId, type: 'SEPARATION' },
    });
    employmentEventIds.push(separation!.id);
    expect(separation?.reason).toBe(FIXED_TERM_SEPARATION_REASON);
    expect(separation?.triggerSource).toBe('SYSTEM_SCHEDULED');
    expect(separation?.triggeredByUserId).toBeNull();
    expect(separation?.eventDate.toISOString()).toBe('2026-12-01T05:59:59.999Z');

    const updatedHire = await prisma.employmentEvent.findUnique({ where: { id: hireEvent.id } });
    expect(updatedHire?.separationTriggeredAt).not.toBeNull();

    const message = await prisma.message.findFirst({ where: { claimantId: claimantProfileId } });
    expect(message?.subject).toBe('Your claim has been reactivated');

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'EmploymentEvent', targetId: separation!.id, action: 'EMPLOYMENT_EXPIRATION_PROCESSED' },
    });
    expect(log?.actorUserId).toBe(systemActorUserId);
    const metadata = log?.metadata as { outcome?: string; triggerSource?: string } | null;
    expect(metadata?.outcome).toBe('REACTIVATED');
    expect(metadata?.triggerSource).toBe('SYSTEM_SCHEDULED');
  });

  it('leaves the claim in REEVALUATION_REQUIRED when the benefit year has already ended', async () => {
    await createRestrictedClaim({ benefitYearEnd: new Date('2026-11-01') });
    await createDueHireEvent();

    const summary = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });

    expect(summary.claimsSentToReevaluation).toBe(1);
    expect(summary.claimsReactivated).toBe(0);

    const claim = await prisma.claim.findUnique({ where: { id: claimIds[0] } });
    expect(claim?.status).toBe('REEVALUATION_REQUIRED');

    const separation = await prisma.employmentEvent.findFirst({ where: { employerId: employerProfileId, type: 'SEPARATION' } });
    employmentEventIds.push(separation!.id);
    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'EmploymentEvent', targetId: separation!.id, action: 'EMPLOYMENT_EXPIRATION_PROCESSED' },
    });
    const metadata = log?.metadata as { reasons?: string[] } | null;
    expect(metadata?.reasons).toContain('Benefit year has ended');

    const message = await prisma.message.findFirst({ where: { claimantId: claimantProfileId } });
    expect(message?.subject).toBe('Your claim is under review');
  });

  it('leaves the claim in REEVALUATION_REQUIRED when identity verification is not VERIFIED', async () => {
    await prisma.claimantProfile.update({ where: { id: claimantProfileId }, data: { identityVerificationStatus: 'PENDING' } });
    await createRestrictedClaim();
    await createDueHireEvent();

    const summary = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });

    expect(summary.claimsSentToReevaluation).toBe(1);
    const claim = await prisma.claim.findUnique({ where: { id: claimIds[0] } });
    expect(claim?.status).toBe('REEVALUATION_REQUIRED');

    const separation = await prisma.employmentEvent.findFirst({ where: { employerId: employerProfileId, type: 'SEPARATION' } });
    employmentEventIds.push(separation!.id);
  });

  it('retains RESTRICTED, without touching the claim, when other active employment exists', async () => {
    await createRestrictedClaim();
    await createDueHireEvent();

    const otherEmployerUser = await prisma.user.create({
      data: { email: `expiration-other-employer-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    const otherEmployerProfile = await prisma.employerProfile.create({
      data: { userId: otherEmployerUser.id, companyName: 'Other Active Employer LLC', verificationStatus: 'VERIFIED' },
    });
    const otherHire = await prisma.employmentEvent.create({
      data: {
        employerId: otherEmployerProfile.id,
        type: 'HIRE',
        employeeName: 'Expiration Test Claimant',
        ssnHash: hashSSN('512-88-3344'),
        eventDate: new Date('2026-09-01'),
        matchedClaimantProfileId: claimantProfileId,
      },
    });

    const summary = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });

    expect(summary.claimsRetainedRestricted).toBe(1);
    expect(summary.claimsSentToReevaluation).toBe(0);
    expect(summary.claimsReactivated).toBe(0);

    const claim = await prisma.claim.findUnique({ where: { id: claimIds[0] } });
    expect(claim?.status).toBe('RESTRICTED');

    const message = await prisma.message.findFirst({ where: { claimantId: claimantProfileId } });
    expect(message?.subject).toBe('Your fixed-term employment has ended');
    expect(message?.body).toContain('Other Active Employer LLC');

    const separation = await prisma.employmentEvent.findFirst({ where: { employerId: employerProfileId, type: 'SEPARATION' } });
    employmentEventIds.push(separation!.id);

    await prisma.employmentEvent.delete({ where: { id: otherHire.id } });
    await prisma.auditLog.deleteMany({ where: { actorUserId: otherEmployerUser.id } });
    await prisma.employerProfile.delete({ where: { id: otherEmployerProfile.id } });
    await prisma.user.delete({ where: { id: otherEmployerUser.id } });
  });

  it('is idempotent: a second run against the same data processes zero records', async () => {
    await createRestrictedClaim();
    await createDueHireEvent();

    const first = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });
    expect(first.recordsEvaluated).toBe(1);

    const second = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });
    expect(second.recordsEvaluated).toBe(0);
    expect(second.separationsCreated).toBe(0);

    const separation = await prisma.employmentEvent.findFirst({ where: { employerId: employerProfileId, type: 'SEPARATION' } });
    employmentEventIds.push(separation!.id);
  });

  it('does not select a HIRE event whose expectedEndDate is in the future', async () => {
    await createRestrictedClaim();
    await createDueHireEvent({ expectedEndDate: new Date('2027-01-01T05:59:59.999Z') });

    const summary = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });
    expect(summary.recordsEvaluated).toBe(0);
  });

  it('attributes a manually-triggered run to the calling staff member', async () => {
    await createRestrictedClaim();
    await createDueHireEvent();

    const caseworker = await prisma.user.create({
      data: { email: `expiration-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });

    await runEmploymentExpirationCheck({ source: 'SYSTEM_MANUAL_CHECK', userId: caseworker.id });

    const separation = await prisma.employmentEvent.findFirst({ where: { employerId: employerProfileId, type: 'SEPARATION' } });
    employmentEventIds.push(separation!.id);
    expect(separation?.triggerSource).toBe('SYSTEM_MANUAL_CHECK');
    // triggeredByUserId on the EmploymentEvent itself is reserved for the
    // STAFF trigger source (a direct staff-recorded separation) — a
    // manually-*run* check is still system logic, so this stays null. The
    // calling caseworker's identity is captured on the AuditLog row instead.
    expect(separation?.triggeredByUserId).toBeNull();

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'EmploymentEvent', targetId: separation!.id, action: 'EMPLOYMENT_EXPIRATION_PROCESSED' },
    });
    expect(log?.actorUserId).toBe(caseworker.id);

    await prisma.auditLog.deleteMany({ where: { actorUserId: caseworker.id } });
    await prisma.user.delete({ where: { id: caseworker.id } });
  });

  it('does not touch a claim when the due HIRE event has no matched claimant', async () => {
    await createDueHireEvent({ matchedClaimantProfileId: null });

    const summary = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });
    expect(summary.separationsCreated).toBe(1);
    expect(summary.claimsReactivated + summary.claimsSentToReevaluation + summary.claimsRetainedRestricted).toBe(0);

    const separation = await prisma.employmentEvent.findFirst({ where: { employerId: employerProfileId, type: 'SEPARATION' } });
    employmentEventIds.push(separation!.id);
  });

  it('records a per-record failure without stopping the rest of the batch', async () => {
    // Both due events must be valid rows (every FK here is enforced, so an
    // invalid employerId/claimantId would fail at fixture-creation time,
    // before the check even runs) — the failure is instead injected by
    // making the second prisma.$transaction call reject, isolating exactly
    // the try/catch behavior in runEmploymentExpirationCheck without
    // depending on which of the two due events it happens to land on (query
    // order across two freshly-inserted rows isn't guaranteed), so this test
    // uses two independent claimants and checks the aggregate outcome
    // instead of asserting which specific one failed.
    await createRestrictedClaim();
    await createDueHireEvent();

    const secondClaimantUser = await prisma.user.create({
      data: { email: `expiration-claimant-2-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    const secondClaimantProfile = await prisma.claimantProfile.create({
      data: {
        userId: secondClaimantUser.id,
        legalName: 'Second Expiration Test Claimant',
        ssnHash: hashSSN('488-22-9911'),
        identityVerificationStatus: 'VERIFIED',
      },
    });
    const secondClaim = await prisma.claim.create({
      data: {
        claimantId: secondClaimantProfile.id,
        status: 'RESTRICTED',
        benefitYearStart: new Date('2026-08-01'),
        benefitYearEnd: new Date('2027-08-01'),
        weeklyBenefitAmount: 300,
      },
    });
    const secondHireEvent = await prisma.employmentEvent.create({
      data: {
        employerId: employerProfileId,
        type: 'HIRE',
        employeeName: 'Second Expiration Test Claimant',
        ssnHash: hashSSN('488-22-9911'),
        eventDate: new Date('2026-07-01'),
        expectedEndDate: new Date('2026-11-15'),
        matchedClaimantProfileId: secondClaimantProfile.id,
      },
    });
    employmentEventIds.push(secondHireEvent.id);

    const originalTransaction = prisma.$transaction.bind(prisma);
    let transactionCallCount = 0;
    const transactionSpy = vi
      .spyOn(prisma, '$transaction')
      .mockImplementation(((fn: unknown) => {
        transactionCallCount += 1;
        if (transactionCallCount === 2) {
          return Promise.reject(new Error('Simulated transaction failure'));
        }
        return originalTransaction(fn as never);
      }) as typeof prisma.$transaction);

    const summary = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });
    transactionSpy.mockRestore();

    expect(summary.recordsEvaluated).toBe(2);
    expect(summary.separationsCreated).toBe(1);
    expect(summary.failures).toHaveLength(1);
    expect(summary.failures[0].error).toBe('Simulated transaction failure');

    const [claim1, claim2] = await Promise.all([
      prisma.claim.findUnique({ where: { id: claimIds[0] } }),
      prisma.claim.findUnique({ where: { id: secondClaim.id } }),
    ]);
    // Exactly one of the two claims was left untouched by the failed
    // transaction (still RESTRICTED); the other was successfully processed.
    const stillRestrictedCount = [claim1?.status, claim2?.status].filter((s) => s === 'RESTRICTED').length;
    expect(stillRestrictedCount).toBe(1);

    const separation = await prisma.employmentEvent.findFirst({ where: { employerId: employerProfileId, type: 'SEPARATION' } });
    if (separation) employmentEventIds.push(separation.id);

    // The audit log write happens inside the same per-event transaction as
    // the SEPARATION event, separationTriggeredAt stamp, and claim/message
    // writes (see processDueEvent) — so it's atomic with them. Proof here:
    // the rejected second $transaction call produced zero orphan audit
    // rows; only the one event that actually committed wrote a log entry.
    const auditLogs = await prisma.auditLog.findMany({
      where: { actorUserId: systemActorUserId, action: 'EMPLOYMENT_EXPIRATION_PROCESSED' },
    });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].targetId).toBe(separation!.id);

    await prisma.claim.delete({ where: { id: secondClaim.id } });
    await prisma.claimantProfile.delete({ where: { id: secondClaimantProfile.id } });
    await prisma.user.delete({ where: { id: secondClaimantUser.id } });
  });

  it('does not double-process a due event that a concurrent run claims first', async () => {
    // Simulates two overlapping runEmploymentExpirationCheck invocations
    // (e.g. a scheduled run and a manually-triggered one) both selecting the
    // same due HIRE event before either commits. Here, "the other run"
    // claims the event by stamping separationTriggeredAt directly (a raw
    // update, standing in for that other invocation's own transaction)
    // between this run's due-event SELECT and this event's own per-event
    // transaction — reached by hooking the SELECT itself via a spy, since
    // that's the exact window processDueEvent's own updateMany-based guard
    // (the AlreadyClaimedError path) is meant to close.
    await createRestrictedClaim();
    const hireEvent = await createDueHireEvent();

    const originalFindMany = prisma.employmentEvent.findMany.bind(prisma.employmentEvent);
    const findManySpy = vi
      .spyOn(prisma.employmentEvent, 'findMany')
      .mockImplementationOnce((async (args: unknown) => {
        const dueEvents = await originalFindMany(args as never);
        await prisma.employmentEvent.update({
          where: { id: hireEvent.id },
          data: { separationTriggeredAt: new Date() },
        });
        return dueEvents;
      }) as typeof prisma.employmentEvent.findMany);

    const summary = await runEmploymentExpirationCheck({ source: 'SYSTEM_SCHEDULED' });
    findManySpy.mockRestore();

    // Selected (the outer SELECT ran before the race), but not processed:
    // the per-event transaction's own guard caught the race and rolled
    // back, and AlreadyClaimedError is treated as a benign skip, not a
    // failure.
    expect(summary.recordsEvaluated).toBe(1);
    expect(summary.separationsCreated).toBe(0);
    expect(summary.failures).toEqual([]);

    const separation = await prisma.employmentEvent.findFirst({ where: { employerId: employerProfileId, type: 'SEPARATION' } });
    expect(separation).toBeNull();

    const claim = await prisma.claim.findUnique({ where: { id: claimIds[0] } });
    expect(claim?.status).toBe('RESTRICTED');

    const auditLogs = await prisma.auditLog.findMany({
      where: { actorUserId: systemActorUserId, action: 'EMPLOYMENT_EXPIRATION_PROCESSED' },
    });
    expect(auditLogs).toHaveLength(0);
  });
});
