import { describe, it, expect } from 'vitest';
import { requireOwnership, requireRole } from '@/lib/rbac';
import type { Session } from 'next-auth';

function sessionWithRole(
  role: 'CLAIMANT' | 'CASEWORKER' | 'ADMIN' | 'EMPLOYER',
  claimantProfileId?: string
): Session {
  return {
    user: { id: 'user-1', role, claimantProfileId, email: 'test@example.com' },
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

  it('allows a session whose role is EMPLOYER when EMPLOYER is in the allowed list', () => {
    expect(requireRole(sessionWithRole('EMPLOYER'), ['EMPLOYER'])).toEqual({ ok: true });
  });

  it('rejects a session whose role is not EMPLOYER with 403', () => {
    expect(requireRole(sessionWithRole('CLAIMANT'), ['EMPLOYER'])).toEqual({
      ok: false,
      status: 403,
    });
  });
});

describe('requireOwnership', () => {
  it('allows a claimant acting on their own profile', () => {
    expect(requireOwnership(sessionWithRole('CLAIMANT', 'profile-a'), 'profile-a')).toEqual({
      ok: true,
    });
  });

  it("rejects a claimant acting on another claimant's profile with 403", () => {
    expect(requireOwnership(sessionWithRole('CLAIMANT', 'profile-a'), 'profile-b')).toEqual({
      ok: false,
      status: 403,
    });
  });

  it('rejects a claimant with no profile id with 403', () => {
    expect(requireOwnership(sessionWithRole('CLAIMANT'), 'profile-b')).toEqual({
      ok: false,
      status: 403,
    });
  });

  it('lets caseworkers and admins through — their access is gated by requireRole', () => {
    expect(requireOwnership(sessionWithRole('CASEWORKER'), 'profile-b')).toEqual({ ok: true });
    expect(requireOwnership(sessionWithRole('ADMIN'), 'profile-b')).toEqual({ ok: true });
  });

  it('fails safe on a missing session', () => {
    expect(requireOwnership(null, 'profile-b')).toEqual({ ok: false, status: 403 });
  });
});
