import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EmployerVerificationRequestsPage from '@/app/employer/verification-requests/page';

const { sessionState } = vi.hoisted(() => ({
  sessionState: { data: null as unknown, status: 'loading' as 'loading' | 'authenticated' | 'unauthenticated' },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => sessionState,
}));

function mockEmployerSession(overrides: Partial<{ role: string }> = {}) {
  sessionState.status = 'authenticated';
  sessionState.data = {
    user: { id: 'u1', role: overrides.role ?? 'EMPLOYER', employerProfileId: 'org-1' },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  };
}

function pendingRequest(
  overrides: Partial<{
    id: string;
    credentialType: string;
    requestedTitle: string | null;
    legalName: string | null;
  }> = {}
) {
  return {
    id: overrides.id ?? 'vr-1',
    credentialType: overrides.credentialType ?? 'MILITARY_SERVICE',
    requestedTitle: overrides.requestedTitle ?? null,
    authorizedAt: '2026-08-01T00:00:00.000Z',
    claimantProfile: { legalName: overrides.legalName ?? 'Jordan Rivera' },
  };
}

describe('EmployerVerificationRequestsPage guard', () => {
  beforeEach(() => {
    sessionState.status = 'loading';
    sessionState.data = null;
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a loading state while the session is resolving', () => {
    render(<EmployerVerificationRequestsPage />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a sign-in message and does not load when there is no session', () => {
    sessionState.status = 'unauthenticated';
    sessionState.data = null;
    render(<EmployerVerificationRequestsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/sign in with an employer account/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a sign-in message and does not load for a wrong-role session (e.g. CLAIMANT)', () => {
    mockEmployerSession({ role: 'CLAIMANT' });
    render(<EmployerVerificationRequestsPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/sign in with an employer account/i);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('loads and renders a pending request with the claimant name and credential type', async () => {
    mockEmployerSession();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [pendingRequest({ legalName: 'Jordan Rivera', credentialType: 'MILITARY_SERVICE' })],
    } as Response);

    render(<EmployerVerificationRequestsPage />);

    expect(await screen.findByText('Jordan Rivera')).toBeInTheDocument();
    expect(screen.getByText(/MILITARY_SERVICE/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/employer/verification-requests');
  });

  it('clicking Respond reveals the type-specific detail fields for that request\'s credential type', async () => {
    mockEmployerSession();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [pendingRequest({ credentialType: 'MILITARY_SERVICE' })],
    } as Response);

    render(<EmployerVerificationRequestsPage />);

    const respondButton = await screen.findByRole('button', { name: 'Respond' });
    fireEvent.click(respondButton);

    expect(screen.getByLabelText(/Branch/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Rank/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Discharge type/)).toBeInTheDocument();
    // A field belonging to a different credential type must not appear.
    expect(screen.queryByLabelText(/Major/)).not.toBeInTheDocument();
  });

  it('submitting "No record found" posts { confirmed: false, responseNote }', async () => {
    mockEmployerSession();
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === '/api/employer/verification-requests' && !init) {
        return { ok: true, json: async () => [pendingRequest({ id: 'vr-1' })] } as Response;
      }
      if (url === '/api/employer/verification-requests/vr-1/respond' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ id: 'vr-1', credentialRecordId: null }) } as Response;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(<EmployerVerificationRequestsPage />);

    const respondButton = await screen.findByRole('button', { name: 'Respond' });
    fireEvent.click(respondButton);

    fireEvent.change(screen.getByLabelText(/No record found — note/), {
      target: { value: 'No matching service record on file.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'No record found' }));

    await waitFor(() => {
      const postCall = vi
        .mocked(fetch)
        .mock.calls.find(
          ([reqInput, reqInit]) => reqInput === '/api/employer/verification-requests/vr-1/respond' && reqInit?.method === 'POST'
        );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1]!.body as string);
      expect(body).toEqual({ confirmed: false, responseNote: 'No matching service record on file.' });
    });
  });
});
