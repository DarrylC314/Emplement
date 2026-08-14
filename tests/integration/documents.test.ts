import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs/promises';
import { prisma } from '@/lib/prisma';
import { getServerAuthSession } from '@/lib/auth';
import { POST } from '@/app/api/documents/route';
import { GET } from '@/app/api/documents/[id]/route';

vi.mock('@/lib/auth', () => ({
  getServerAuthSession: vi.fn(),
}));

describe('document upload/download', () => {
  let caseworkerId: string;
  let claimantUserId: string;
  let claimantProfileId: string;
  let claimId: string;
  let documentId: string;

  beforeAll(async () => {
    const caseworker = await prisma.user.create({
      data: { email: `doc-caseworker-${Date.now()}@example.com`, passwordHash: 'x', role: 'CASEWORKER' },
    });
    caseworkerId = caseworker.id;

    const claimantUser = await prisma.user.create({
      data: { email: `doc-claimant-${Date.now()}@example.com`, passwordHash: 'x', role: 'CLAIMANT' },
    });
    claimantUserId = claimantUser.id;
    const profile = await prisma.claimantProfile.create({ data: { userId: claimantUser.id } });
    claimantProfileId = profile.id;
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

    vi.mocked(getServerAuthSession).mockResolvedValue({
      user: { id: caseworker.id, role: 'CASEWORKER', email: caseworker.email },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    });
  });

  it('uploads a PDF and writes an audit log', async () => {
    const file = new File([Buffer.from('%PDF-1.4 fake pdf content')], 'evidence.pdf', {
      type: 'application/pdf',
    });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('claimId', claimId);

    const req = new Request('http://localhost/api/documents', { method: 'POST', body: formData });
    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    documentId = body.id;

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'Document', targetId: documentId, action: 'DOCUMENT_UPLOADED' },
    });
    expect(log).not.toBeNull();
  });

  it('rejects a disallowed file type', async () => {
    const file = new File([Buffer.from('not allowed')], 'malware.exe', {
      type: 'application/x-msdownload',
    });
    const formData = new FormData();
    formData.append('file', file);
    formData.append('claimId', claimId);

    const req = new Request('http://localhost/api/documents', { method: 'POST', body: formData });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('downloads the uploaded document and writes an audit log', async () => {
    const res = await GET(new Request('http://localhost/api/documents/x'), {
      params: { id: documentId },
    });
    expect(res.status).toBe(200);
    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.toString()).toContain('fake pdf content');

    const log = await prisma.auditLog.findFirst({
      where: { targetEntity: 'Document', targetId: documentId, action: 'DOCUMENT_DOWNLOADED' },
    });
    expect(log).not.toBeNull();
  });

  afterAll(async () => {
    const document = await prisma.document.findUnique({ where: { id: documentId } });
    if (document) {
      await fs.rm(document.storedPath, { force: true });
    }
    await prisma.auditLog.deleteMany({ where: { targetEntity: 'Document', targetId: documentId } });
    await prisma.document.deleteMany({ where: { claimId } });
    await prisma.claim.delete({ where: { id: claimId } });
    await prisma.claimantProfile.delete({ where: { id: claimantProfileId } });
    await prisma.user.delete({ where: { id: claimantUserId } });
    await prisma.user.delete({ where: { id: caseworkerId } });
    await prisma.$disconnect();
  });
});
