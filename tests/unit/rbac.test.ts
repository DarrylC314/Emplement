import { describe, it, expect } from 'vitest';
import { requireRole } from '@/lib/rbac';
import type { Session } from 'next-auth';

function sessionWithRole(role: 'CLAIMANT' | 'CASEWORKER' | 'ADMIN'): Session {
  return {
    user: { id: 'user-1', role, email: 'test@example.com' },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  };
}

describe('requireRole', () => {
  it('allows a session whose role is in the allowed list', () => {
    expect(requireRole(sessionWithRole('CASEWORKER'), ['CASEWORKER', 'ADMIN'])).toEqual({ ok: true });
  });

  it('rejects a session whose role is not in the allowed list with 403', () => {
    expect(requireRole(sessionWithRole('CLAIMANT'), ['CASEWORKER', 'ADMIN'])).toEqual({
      ok: false,
      status: 403,
    });
  });

  it('rejects a null session with 401', () => {
    expect(requireRole(null, ['CASEWORKER'])).toEqual({ ok: false, status: 401 });
  });
});
