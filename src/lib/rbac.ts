import type { Session } from 'next-auth';

type Role = 'CLAIMANT' | 'CASEWORKER' | 'ADMIN';

export function requireRole(
  session: Session | null,
  allowedRoles: Role[]
): { ok: true } | { ok: false; status: 401 | 403 } {
  if (!session) return { ok: false, status: 401 };
  if (!allowedRoles.includes(session.user.role)) return { ok: false, status: 403 };
  return { ok: true };
}
