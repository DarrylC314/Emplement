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

  it('refuses re-verification once the employer is already VERIFIED', async () => {
    // The first test in this file already verified this employer profile.
    const req = new Request('http://localhost/api/employer/verify-fein', {
      method: 'POST',
      body: JSON.stringify({ fein: '99-9999999', companyName: 'A New Company' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already verified/i);

    // The FEIN on file must not have changed.
    const profile = await prisma.employerProfile.findUnique({ where: { id: employerProfileId } });
    expect(profile?.fein).toBe('43-1234567');
  });

  it('returns a clean 409 (without revealing whose FEIN it is) on a FEIN collision', async () => {
    const otherUser = await prisma.user.create({
      data: { email: `verify-fein-other-${Date.now()}@example.com`, passwordHash: 'x', role: 'EMPLOYER' },
    });
    const otherProfile = await prisma.employerProfile.create({ data: { userId: otherUser.id } });

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: otherUser.id, role: 'EMPLOYER', employerProfileId: otherProfile.id, email: otherUser.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });

    // The FEIN '43-1234567' is already held by the profile from the first test.
    const req = new Request('http://localhost/api/employer/verify-fein', {
      method: 'POST',
      body: JSON.stringify({ fein: '43-1234567', companyName: 'Acme Corp' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).not.toMatch(/already registered|belongs to another|another account/i);

    const refreshed = await prisma.employerProfile.findUnique({ where: { id: otherProfile.id } });
    expect(refreshed?.verificationStatus).not.toBe('VERIFIED');

    await prisma.auditLog.deleteMany({ where: { targetId: otherProfile.id } });
    await prisma.employerProfile.delete({ where: { id: otherProfile.id } });
    await prisma.user.delete({ where: { id: otherUser.id } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { targetId: employerProfileId } });
    await prisma.employerProfile.delete({ where: { id: employerProfileId } });
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });
});
