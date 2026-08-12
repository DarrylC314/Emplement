import { prisma } from '@/lib/prisma';

export async function writeAuditLog(params: {
  actorUserId: string;
  action: string;
  targetEntity: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: params.actorUserId,
      action: params.action,
      targetEntity: params.targetEntity,
      targetId: params.targetId,
      metadata: params.metadata ?? undefined,
    },
  });
}
