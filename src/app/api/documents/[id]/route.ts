import { prisma } from '@/lib/prisma';
import { writeAuditLog } from '@/lib/audit';
import { getServerAuthSession } from '@/lib/auth';
import { requireRole } from '@/lib/rbac';
import { apiError } from '@/lib/apiRequest';
import { readDocumentFile } from '@/lib/documentStorage';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerAuthSession();
  const access = requireRole(session, ['CASEWORKER', 'ADMIN']);
  if (!access.ok) {
    return apiError('Unauthorized', access.status);
  }

  const document = await prisma.document.findUnique({ where: { id: params.id } });
  if (!document) {
    return apiError('Document not found', 404);
  }

  let buffer: Buffer;
  try {
    buffer = await readDocumentFile(document.storedPath);
  } catch {
    return apiError('Document file is no longer available', 404);
  }

  await writeAuditLog({
    actorUserId: session!.user.id,
    action: 'DOCUMENT_DOWNLOADED',
    targetEntity: 'Document',
    targetId: document.id,
  });

  const safeFilename = document.filename.replace(/[^\w.-]/g, '_');
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${safeFilename}"`,
    },
  });
}
