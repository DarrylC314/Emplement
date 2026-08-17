import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { GET as listOwnPostings, POST as createPosting } from '@/app/api/employer/job-postings/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('employer job posting routes', () => {
  let verifiedUserId: string;
  let verifiedProfileId: string;
  let unverifiedUserId: string;
  let unverifiedProfileId: string;

  beforeAll(async () => {
    const verifiedUser = await prisma.user.create({
      data: { email: `posting-employer-verified-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    verifiedUserId = verifiedUser.id;
    const verifiedProfile = await prisma.employerProfile.create({
      data: { userId: verifiedUser.id, fein: '71-2233445', companyName: 'Posting Test Co', verificationStatus: 'VERIFIED' },
    });
    verifiedProfileId = verifiedProfile.id;

    const unverifiedUser = await prisma.user.create({
      data: { email: `posting-employer-unverified-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    unverifiedUserId = unverifiedUser.id;
    const unverifiedProfile = await prisma.employerProfile.create({ data: { userId: unverifiedUser.id } });
    unverifiedProfileId = unverifiedProfile.id;
  });

  it('rejects posting creation for an unverified employer with 403', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: unverifiedUserId, role: 'EMPLOYER', employerProfileId: unverifiedProfileId, email: 'unverified@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const req = new Request('http://localhost/api/employer/job-postings', {
      method: 'POST',
      body: JSON.stringify({ title: 'Cook', description: 'Line cook', location: 'St. Louis, MO' }),
    });
    const res = await createPosting(req);
    expect(res.status).toBe(403);
  });

  it('creates a job posting for a verified employer', async () => {
    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: verifiedUserId, role: 'EMPLOYER', employerProfileId: verifiedProfileId, email: 'verified@example.com' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
    const req = new Request('http://localhost/api/employer/job-postings', {
      method: 'POST',
      body: JSON.stringify({ title: 'Warehouse associate', description: 'Day shift', location: 'Jefferson City, MO' }),
    });
    const res = await createPosting(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('OPEN');

    const listRes = await listOwnPostings();
    expect(listRes.status).toBe(200);
    const list = await listRes.json();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Warehouse associate');
  });

  it('creates a job posting with tags', async () => {
    const req = new Request('http://localhost/api/employer/job-postings', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Registered nurse',
        description: 'ICU, night shift',
        location: 'Columbia, MO',
        tags: ['HEALTHCARE_PRACTITIONER'],
      }),
    });
    const res = await createPosting(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.tags).toEqual(['HEALTHCARE_PRACTITIONER']);

    const listRes = await listOwnPostings();
    const list = await listRes.json();
    const created = list.find((p: { id: string }) => p.id === body.id);
    expect(created.tags).toEqual(['HEALTHCARE_PRACTITIONER']);
  });

  it('creates a job posting with an optional fixed-term end date, converted to UTC', async () => {
    const req = new Request('http://localhost/api/employer/job-postings', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Seasonal warehouse associate',
        description: 'Holiday season only',
        location: 'Springfield, MO',
        expectedEndDate: '2026-11-30',
      }),
    });
    const res = await createPosting(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.expectedEndDate).toBe('2026-12-01T05:59:59.999Z');
  });

  it('creates a job posting with no fixed-term end date when omitted', async () => {
    const req = new Request('http://localhost/api/employer/job-postings', {
      method: 'POST',
      body: JSON.stringify({ title: 'Permanent role', description: 'Ongoing', location: 'Rolla, MO' }),
    });
    const res = await createPosting(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.expectedEndDate).toBeNull();
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [verifiedUserId, unverifiedUserId] } } });
    await prisma.jobPosting.deleteMany({ where: { employerId: verifiedProfileId } });
    await prisma.employerProfile.delete({ where: { id: verifiedProfileId } });
    await prisma.user.delete({ where: { id: verifiedUserId } });
    await prisma.employerProfile.delete({ where: { id: unverifiedProfileId } });
    await prisma.user.delete({ where: { id: unverifiedUserId } });
    await prisma.$disconnect();
  });
});
