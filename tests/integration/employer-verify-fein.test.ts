import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST } from '@/app/api/employer/verify-fein/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('POST /api/employer/verify-fein', () => {
  let userId: string;
  let employerProfileId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `verify-fein-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    userId = user.id;
    const profile = await prisma.employerProfile.create({ data: { userId: user.id } });
    employerProfileId = profile.id;

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: user.id, role: 'EMPLOYER', employerProfileId: profile.id, email: user.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('verifies a well-formed FEIN and updates the employer profile', async () => {
    const req = new Request('http://localhost/api/employer/verify-fein', {
      method: 'POST',
      body: JSON.stringify({ fein: '43-1234567', companyName: 'Acme Corp' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);

    const profile = await prisma.employerProfile.findUnique({ where: { id: employerProfileId } });
    expect(profile?.fein).toBe('43-1234567');
    expect(profile?.companyName).toBe('Acme Corp');
    expect(profile?.verificationStatus).toBe('VERIFIED');
  });

  it('rejects a malformed FEIN with a 400', async () => {
    const req = new Request('http://localhost/api/employer/verify-fein', {
      method: 'POST',
      body: JSON.stringify({ fein: 'not-a-fein', companyName: 'Acme Corp' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { targetId: employerProfileId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });
});
