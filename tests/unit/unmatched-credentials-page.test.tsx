import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import UnmatchedCredentialsPage from '@/app/staff/unmatched-credentials/page';

const { sessionState } = vi.hoisted(() => ({
  sessionState: { data: null as unknown, status: 'loading' as 'loading' | 'authenticated' | 'unauthenticated' },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => sessionState,
}));

function mockCaseworkerSession(overrides: Partial<{ role: string }> = {}) {
  sessionState.status = 'authenticated';
  sessionState.data = {
    user: { id: 'u1', role: overrides.role ?? 'CASEWORKER' },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  };
}

describe('UnmatchedCredentialsPage guard', () => {
  beforeEach(() => {
    sessionState.status = 'loading';
    sessionState.data = null;
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a loading state while the session is resolving', () => {
    render(<UnmatchedCredentialsPage />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows an access-denied message and does not load when there is no session', () => {
    sessionState.status = 'unauthenticated';
    sessionState.data = null;
    render(<UnmatchedCredentialsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/you do not have access to this page/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows an access-denied message and does not load for a wrong-role session (e.g. CLAIMANT)', () => {
    mockCaseworkerSession({ role: 'CLAIMANT' });
    render(<UnmatchedCredentialsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/you do not have access to this page/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('loads and renders an unmatched credential for an authenticated CASEWORKER session', async () => {
    mockCaseworkerSession();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'cred-1',
          type: 'CERTIFICATION',
          title: 'CPA',
          eventDate: '2020-01-01T00:00:00.000Z',
          createdAt: '2020-01-02T00:00:00.000Z',
          organization: { companyName: 'UC Test University' },
        },
      ],
    } as Response);
    render(<UnmatchedCredentialsPage />);
    expect(await screen.findByText(/CPA/)).toBeInTheDocument();
    expect(screen.getByText(/UC Test University/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/staff/unmatched-credentials');
  });
});
