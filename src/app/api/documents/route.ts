import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';
import { saveDocumentFile, MAX_DOCUMENT_SIZE_BYTES, ALLOWED_DOCUMENT_TYPES } from '@/lib/documentStorage';

export async function POST(req: Request) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return apiError('Invalid request body', 400);
  }

  const file = formData.get('file');
  const claimId = formData.get('claimId');
  const weeklyCertificationId = formData.get('weeklyCertificationId');

  if (!(file instanceof File)) {
    return apiError('A file is required', 400);
  }
  if (typeof claimId !== 'string' || !claimId) {
    return apiError('claimId is required', 400);
  }
  if (!ALLOWED_DOCUMENT_TYPES.has(file.type)) {
    return apiError('Only PDF, PNG, or JPEG files are allowed', 400);
  }
  if (file.size > MAX_DOCUMENT_SIZE_BYTES) {
    return apiError('File exceeds the 10MB size limit', 400);
  }

  const claim = await prisma.claim.findUnique({ where: { id: claimId } });
  if (!claim) {
    return apiError('Claim not found', 404);
  }

  let validatedCertificationId: string | null = null;
  if (typeof weeklyCertificationId === 'string' && weeklyCertificationId) {
    const certification = await prisma.weeklyCertification.findUnique({
      where: { id: weeklyCertificationId },
      select: { id: true, claimId: true },
    });
    if (!certification || certification.claimId !== claimId) {
      return apiError('weeklyCertificationId is invalid for this claim', 400);
    }
    validatedCertificationId = certification.id;
  }

  const storedPath = await saveDocumentFile(file);

  const document = await prisma.document.create({
    data: {
      claimId,
      weeklyCertificationId: validatedCertificationId,
      uploadedByUserId: session!.user.id,
      filename: file.name,
      storedPath,
    },
  });

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'DOCUMENT_UPLOADED',
    targetEntity: 'Document',
    targetId: document.id,
    metadata: { claimId },
  });

  return Response.json(
    { id: document.id, filename: document.filename, uploadedAt: document.uploadedAt },
    { status: 201 }
  );
}
