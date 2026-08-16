import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CertifyPage from '@/app/claim/certify/page';

// Covers the marketplace-application prefill feature on /claim/certify.
// The final whole-branch review for this feature flagged that the
// prefill/remove/removed-tracking logic had no test coverage at any level
// and had already broken twice during manual E2E runs before merge — these
// tests exercise that logic directly, in the established page-component
// style (see tests/unit/employer-page-guards.test.tsx).

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams('claimId=claim-1'),
}));

const application = (overrides: Partial<{ id: string; createdAt: string; title: string; companyName: string | null }> = {}) => ({
  id: overrides.id ?? 'app-1',
  createdAt: overrides.createdAt ?? '2026-08-12T12:00:00.000Z',
  jobPosting: {
    title: overrides.title ?? 'Warehouse Associate',
    employer: { companyName: overrides.companyName ?? 'Riverbend Logistics Inc.' },
  },
});

function mockJobApplicationsFetch(applications: ReturnType<typeof application>[], ok = true) {
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    if (typeof input === 'string' && input === '/api/job-applications') {
      return { ok, json: async () => applications } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

describe('CertifyPage marketplace prefill', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefills a read-only row from a matching marketplace application on date blur', async () => {
    mockJobApplicationsFetch([application()]);
    render(<CertifyPage />);

    fireEvent.change(screen.getByLabelText(/week ending date/i), { target: { value: '2026-08-15' } });
    fireEvent.blur(screen.getByLabelText(/week ending date/i));

    expect(await screen.findByText('Riverbend Logistics Inc.')).toBeInTheDocument();
    expect(screen.getByText('Warehouse Associate')).toBeInTheDocument();
    expect(screen.getByText('Prefilled from your marketplace application')).toBeInTheDocument();
    // A prefilled row is read-only display, not an editable field — the only
    // "Employer name" input left is the form's own seeded manual row.
    expect(screen.getAllByLabelText(/employer name/i)).toHaveLength(1);
    // One summary announcement, not one per row.
    expect(screen.getByText('1 job search activity was prefilled from your marketplace applications.')).toBeInTheDocument();
  });

  it('preserves an in-progress manual row when a prefill sync runs', async () => {
    mockJobApplicationsFetch([application()]);
    render(<CertifyPage />);

    // The form seeds one manual row; type into it before the prefill fetch
    // resolves so we can confirm the sync doesn't clobber it.
    fireEvent.change(screen.getByLabelText(/employer name/i), { target: { value: 'Acme Corp' } });

    fireEvent.change(screen.getByLabelText(/week ending date/i), { target: { value: '2026-08-15' } });
    fireEvent.blur(screen.getByLabelText(/week ending date/i));

    await screen.findByText('Riverbend Logistics Inc.');
    expect(screen.getByLabelText(/employer name/i)).toHaveValue('Acme Corp');
  });

  it('does not resurrect a removed marketplace row when the same date is blurred again', async () => {
    mockJobApplicationsFetch([application()]);
    render(<CertifyPage />);

    const dateField = screen.getByLabelText(/week ending date/i);
    fireEvent.change(dateField, { target: { value: '2026-08-15' } });
    fireEvent.blur(dateField);
    await screen.findByText('Riverbend Logistics Inc.');

    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0]!);
    expect(screen.queryByText('Riverbend Logistics Inc.')).not.toBeInTheDocument();
    expect(screen.getByText('Job search activity removed.')).toBeInTheDocument();
    // Focus lands somewhere still on the page, not lost to <body>.
    expect(document.activeElement).toHaveAttribute('id', 'add-activity-button');

    // Re-blurring the unchanged date field must not bring the removed row back.
    fireEvent.blur(dateField);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Riverbend Logistics Inc.')).not.toBeInTheDocument();
  });

  it('lets a removed application reappear for a different week whose window still matches it', async () => {
    // createdAt 08-12 falls inside both the [08-09..08-15] and [08-10..08-16]
    // windows — exactly the overlapping-window case the week-scoped removal
    // tracking exists to handle correctly.
    mockJobApplicationsFetch([application()]);
    render(<CertifyPage />);

    const dateField = screen.getByLabelText(/week ending date/i);
    fireEvent.change(dateField, { target: { value: '2026-08-15' } });
    fireEvent.blur(dateField);
    await screen.findByText('Riverbend Logistics Inc.');

    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0]!);
    expect(screen.queryByText('Riverbend Logistics Inc.')).not.toBeInTheDocument();

    fireEvent.change(dateField, { target: { value: '2026-08-16' } });
    fireEvent.blur(dateField);

    expect(await screen.findByText('Riverbend Logistics Inc.')).toBeInTheDocument();
  });

  it('degrades to plain manual entry with no error banner when the prefill fetch fails', async () => {
    mockJobApplicationsFetch([application()], false);
    render(<CertifyPage />);

    const dateField = screen.getByLabelText(/week ending date/i);
    fireEvent.change(dateField, { target: { value: '2026-08-15' } });
    fireEvent.blur(dateField);

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByText('Riverbend Logistics Inc.')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // The seeded manual row is still there and usable.
    expect(screen.getByLabelText(/employer name/i)).toBeInTheDocument();
  });

  it('drops a fully-untouched manual row from submission but keeps a partially-filled one', async () => {
    mockJobApplicationsFetch([
      application(),
      application({ id: 'app-2', title: 'Customer Service Representative', companyName: 'Metro Health Partners' }),
    ]);
    render(<CertifyPage />);

    const dateField = screen.getByLabelText(/week ending date/i);
    fireEvent.change(dateField, { target: { value: '2026-08-15' } });
    fireEvent.blur(dateField);
    await screen.findByText('Metro Health Partners');

    // The seeded manual row is left completely untouched — two marketplace
    // rows plus this blank one is what a claimant sees without typing
    // anything themselves.
    fireEvent.click(screen.getByRole('button', { name: /submit certification/i }));

    await waitFor(() => {
      const postCall = vi.mocked(fetch).mock.calls.find(([url]) => url === '/api/certifications');
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1]!.body as string);
      expect(body.jobSearchActivities).toHaveLength(2);
      expect(body.jobSearchActivities.every((a: { employerName: string }) => a.employerName)).toBe(true);
    });
  });

  it('discards a stale prefill response when a newer blur has already resolved', async () => {
    let resolveFirst: (value: Response) => void;
    let resolveSecond: (value: Response) => void;
    const firstFetch = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const secondFetch = new Promise<Response>((resolve) => {
      resolveSecond = resolve;
    });

    let jobApplicationsCallCount = 0;
    vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
      if (typeof input === 'string' && input === '/api/job-applications') {
        jobApplicationsCallCount += 1;
        return jobApplicationsCallCount === 1 ? firstFetch : secondFetch;
      }
      return { ok: true, json: async () => ({}) } as Response;
    });

    render(<CertifyPage />);
    const dateField = screen.getByLabelText(/week ending date/i);

    // First blur (date A) — its fetch will resolve LAST, after the second's.
    fireEvent.change(dateField, { target: { value: '2026-08-15' } });
    fireEvent.blur(dateField);
    // Second blur (date B), e.g. the claimant quickly corrected a mistyped
    // date — its fetch resolves FIRST.
    fireEvent.change(dateField, { target: { value: '2026-08-16' } });
    fireEvent.blur(dateField);

    resolveSecond!({
      ok: true,
      json: async () => [application({ id: 'app-b', title: 'Customer Service Representative', companyName: 'Metro Health Partners' })],
    } as Response);
    await screen.findByText('Metro Health Partners');

    // The first (older) request resolves after the newer one already
    // applied its result — it must be discarded, not overwrite the screen.
    resolveFirst!({ ok: true, json: async () => [application()] } as Response);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    expect(screen.getByText('Metro Health Partners')).toBeInTheDocument();
    expect(screen.queryByText('Riverbend Logistics Inc.')).not.toBeInTheDocument();
  });
});
