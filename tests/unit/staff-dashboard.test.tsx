import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StaffDashboardPage from '@/app/staff/dashboard/page';

const { sessionState } = vi.hoisted(() => ({
  sessionState: { data: null as unknown },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: sessionState.data }),
}));

function mockCaseworkerSession() {
  sessionState.data = {
    user: { id: 'cw1', role: 'CASEWORKER' },
    expires: new Date(Date.now() + 3600_000).toISOString(),
  };
}

describe('StaffDashboardPage — expiration check control', () => {
  beforeEach(() => {
    mockCaseworkerSession();
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url === '/api/staff/queue') {
          return Promise.resolve({ ok: true, json: async () => [] } as Response);
        }
        return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a "Run expiration check now" button', async () => {
    render(<StaffDashboardPage />);
    expect(await screen.findByRole('button', { name: /run expiration check now/i })).toBeInTheDocument();
  });

  it('shows the full results summary after a successful run', async () => {
    vi.mocked(fetch).mockImplementation((url: string) => {
      if (url === '/api/staff/queue') return Promise.resolve({ ok: true, json: async () => [] } as Response);
      if (url === '/api/staff/employment-expirations/run-check') {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            recordsEvaluated: 3,
            separationsCreated: 3,
            claimsRetainedRestricted: 1,
            claimsSentToReevaluation: 1,
            claimsReactivated: 1,
            failures: [{ employmentEventId: 'evt-1', error: 'Something went wrong' }],
            results: [],
          }),
        } as Response);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as Response);
    });

    render(<StaffDashboardPage />);
    fireEvent.click(await screen.findByRole('button', { name: /run expiration check now/i }));

    await waitFor(() => expect(screen.getByText(/3 evaluated/i)).toBeInTheDocument());
    expect(screen.getByText(/1 reactivated/i)).toBeInTheDocument();
    expect(screen.getByText(/1 sent to reevaluation/i)).toBeInTheDocument();
    expect(screen.getByText(/1 retained as restricted/i)).toBeInTheDocument();
    expect(screen.getByText(/1 failure/i)).toBeInTheDocument();
    expect(screen.getByText(/Something went wrong/i)).toBeInTheDocument();
  });
});
