import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import VerificationRequestsPage from '@/app/claim/verification-requests/page';

const { sessionState } = vi.hoisted(() => ({
  sessionState: { data: null as unknown, status: 'loading' as 'loading' | 'authenticated' | 'unauthenticated' },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => sessionState,
}));

function mockClaimantSession(overrides: Partial<{ role: string }> = {}) {
  sessionState.status = 'authenticated';
  sessionState.data = {
    user: { id: 'u1', role: overrides.role ?? 'CLAIMANT', claimantProfileId: 'cp1' },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  };
}

function verificationRequest(
  overrides: Partial<{
    id: string;
    credentialType: string;
    requestedTitle: string | null;
    status: string;
    responseNote: string | null;
    companyName: string;
  }> = {}
) {
  return {
    id: overrides.id ?? 'vr-1',
    credentialType: overrides.credentialType ?? 'EDUCATION',
    requestedTitle: overrides.requestedTitle ?? null,
    status: overrides.status ?? 'CONFIRMED',
    responseNote: overrides.responseNote ?? null,
    createdAt: '2026-08-01T00:00:00.000Z',
    organization: { companyName: overrides.companyName ?? 'State University' },
  };
}

describe('VerificationRequestsPage guard', () => {
  beforeEach(() => {
    sessionState.status = 'loading';
    sessionState.data = null;
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a loading state while the session is resolving', () => {
    render(<VerificationRequestsPage />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a sign-in message and does not load when there is no session', () => {
    sessionState.status = 'unauthenticated';
    sessionState.data = null;
    render(<VerificationRequestsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/sign in with a claimant account/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a sign-in message and does not load for a wrong-role session (e.g. EMPLOYER)', () => {
    mockClaimantSession({ role: 'EMPLOYER' });
    render(<VerificationRequestsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/sign in with a claimant account/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('loads and renders an existing request with its organization name and status label', async () => {
    mockClaimantSession();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [verificationRequest({ status: 'CONFIRMED', companyName: 'State University' })],
    } as Response);

    render(<VerificationRequestsPage />);

    expect(await screen.findByText(/State University/)).toBeInTheDocument();
    expect(screen.getByText('Confirmed')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/verification-requests');
  });

  it('submits a new request with the picked organization and chosen credential type', async () => {
    mockClaimantSession();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('/api/organizations')) {
        return { ok: true, json: async () => [{ id: 'org-1', companyName: 'State University' }] } as Response;
      }
      if (url === '/api/verification-requests' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ id: 'vr-new' }) } as Response;
      }
      if (url === '/api/verification-requests') {
        return { ok: true, json: async () => [] } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(<VerificationRequestsPage />);

    // Wait for the initial (empty) requests list to load before interacting.
    await screen.findByText(/haven't requested any verifications yet/i);

    fireEvent.change(screen.getByLabelText(/search for the organization/i), { target: { value: 'State' } });
    const orgButton = await screen.findByRole('button', { name: 'State University' });
    fireEvent.click(orgButton);

    // The picker swaps the search field for a read-only "Organization: ..." row.
    expect(screen.getByText('Organization: State University')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/credential type/i), { target: { value: 'EDUCATION' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send request' }));

    await waitFor(() => {
      const postCall = vi
        .mocked(fetch)
        .mock.calls.find(([reqInput, reqInit]) => reqInput === '/api/verification-requests' && reqInit?.method === 'POST');
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1]!.body as string);
      expect(body).toEqual({ organizationId: 'org-1', credentialType: 'EDUCATION' });
    });
  });
});
