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

/**
 * Ownership (IDOR) check for a resource that belongs to a specific claimant.
 *
 * A CLAIMANT may only act on their own ClaimantProfile; CASEWORKER/ADMIN
 * sessions pass through, since their access is already gated by requireRole at
 * the top of the route. Use this *after* requireRole — a missing session is
 * treated as a failure here purely as a fail-safe, not as the auth check.
 *
 * Extracted from the identical three-line guard that appeared in 7 routes.
 */
export function requireOwnership(
  session: Session | null,
  resourceClaimantId: string | null | undefined
): { ok: true } | { ok: false; status: 403 } {
  if (!session) return { ok: false, status: 403 };
  if (session.user.role === 'CLAIMANT' && session.user.claimantProfileId !== resourceClaimantId) {
    return { ok: false, status: 403 };
  }
  return { ok: true };
}
