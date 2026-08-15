import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmployerDashboardPage from '@/app/employer/dashboard/page';
import VerifyFeinPage from '@/app/employer/verify-fein/page';

// M10: /employer/dashboard and /employer/verify-fein used to render their
// full authenticated content (including a real SSN input, on the dashboard)
// to any visitor before a session even loaded, only failing once the visitor
// tried to submit. These pages now guard on useSession() the same way
// src/app/staff/dashboard/page.tsx and src/app/claim/dashboard/page.tsx do.

const { sessionState } = vi.hoisted(() => ({
  sessionState: { data: null as unknown, status: 'loading' as 'loading' | 'authenticated' | 'unauthenticated' },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => sessionState,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

function mockEmployerSession(overrides: Partial<{ role: string; employerProfileId?: string }> = {}) {
  sessionState.status = 'authenticated';
  sessionState.data = {
    user: { id: 'u1', role: overrides.role ?? 'EMPLOYER', employerProfileId: overrides.employerProfileId ?? 'ep1' },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  };
}

describe('EmployerDashboardPage guard', () => {
  beforeEach(() => {
    sessionState.status = 'loading';
    sessionState.data = null;
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a loading state while the session is resolving, and never renders the SSN form', () => {
    render(<EmployerDashboardPage />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Social Security number/i)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a sign-in message and no SSN form when there is no session', () => {
    sessionState.status = 'unauthenticated';
    sessionState.data = null;
    render(<EmployerDashboardPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/sign in with an employer account/i);
    expect(screen.queryByLabelText(/Social Security number/i)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows a sign-in message and no SSN form for a wrong-role session (e.g. CLAIMANT)', () => {
    mockEmployerSession({ role: 'CLAIMANT' });
    render(<EmployerDashboardPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/sign in with an employer account/i);
    expect(screen.queryByLabelText(/Social Security number/i)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('loads wage records and renders the form for an authenticated EMPLOYER session', async () => {
    mockEmployerSession();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => [],
    } as Response);
    render(<EmployerDashboardPage />);
    expect(await screen.findByLabelText(/Social Security number/i)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/employer/wage-records');
  });
});

describe('VerifyFeinPage guard', () => {
  beforeEach(() => {
    sessionState.status = 'loading';
    sessionState.data = null;
  });

  it('shows a loading state while the session is resolving, and never renders the FEIN form', () => {
    render(<VerifyFeinPage />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByLabelText(/FEIN/i)).not.toBeInTheDocument();
  });

  it('shows a sign-in message and no FEIN form when there is no session', () => {
    sessionState.status = 'unauthenticated';
    sessionState.data = null;
    render(<VerifyFeinPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/sign in with an employer account/i);
    expect(screen.queryByLabelText(/FEIN/i)).not.toBeInTheDocument();
  });

  it('shows a sign-in message and no FEIN form for a wrong-role session', () => {
    mockEmployerSession({ role: 'CASEWORKER' });
    render(<VerifyFeinPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/sign in with an employer account/i);
    expect(screen.queryByLabelText(/FEIN/i)).not.toBeInTheDocument();
  });

  it('renders the FEIN form for an authenticated EMPLOYER session', () => {
    mockEmployerSession();
    render(<VerifyFeinPage />);
    expect(screen.getByLabelText(/FEIN/i)).toBeInTheDocument();
  });
});
