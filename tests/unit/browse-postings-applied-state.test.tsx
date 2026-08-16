import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import BrowsePostingsPage from '@/app/claim/browse-postings/page';

// BrowsePostingsPage used to only learn about a claimant's existing
// applications from clicks made during the current page visit — appliedIds
// started empty on every mount and was never seeded from the server. A
// claimant who'd already applied in a prior visit saw "Apply" again on
// reload, even though JobApplication's unique constraint would reject a
// second application to the same posting regardless of its status.

const { sessionState } = vi.hoisted(() => ({
  sessionState: { data: null as unknown, status: 'loading' as 'loading' | 'authenticated' | 'unauthenticated' },
}));

vi.mock('next-auth/react', () => ({
  useSession: () => sessionState,
}));

const postings = [
  {
    id: 'posting-1',
    title: 'Warehouse Associate',
    description: 'Day shift.',
    location: 'Jefferson City, MO',
    tags: [],
    createdAt: '2026-08-10T00:00:00.000Z',
    employer: { companyName: 'Riverbend Logistics Inc.' },
  },
  {
    id: 'posting-2',
    title: 'Customer Service Representative',
    description: 'Inbound support.',
    location: 'Columbia, MO',
    tags: [],
    createdAt: '2026-08-11T00:00:00.000Z',
    employer: { companyName: 'Riverbend Logistics Inc.' },
  },
];

function mockFetch() {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/job-postings') {
      return { ok: true, json: async () => postings } as Response;
    }
    if (url === '/api/candidate-profile') {
      return { ok: true, json: async () => ({ tags: [] }) } as Response;
    }
    if (url === '/api/job-applications') {
      return { ok: true, json: async () => [{ jobPostingId: 'posting-1' }] } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

describe('BrowsePostingsPage applied-state on load', () => {
  beforeEach(() => {
    sessionState.status = 'authenticated';
    sessionState.data = {
      user: { id: 'u1', role: 'CLAIMANT', claimantProfileId: 'cp1' },
      expires: new Date(Date.now() + 3600_000).toISOString(),
    };
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows "Applied" for a posting the claimant already applied to in a prior visit, and "Apply" for one they have not', async () => {
    mockFetch();
    render(<BrowsePostingsPage />);

    expect(await screen.findByText('✓ Applied')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Apply' })).toHaveLength(1);
  });
});
