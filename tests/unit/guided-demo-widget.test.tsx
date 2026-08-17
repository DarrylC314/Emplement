import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GuidedDemoWidget } from '@/components/demo/GuidedDemoWidget';

const { pushMock, signInMock, getSessionMock, pathnameMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  signInMock: vi.fn(),
  getSessionMock: vi.fn(),
  pathnameMock: vi.fn(() => '/'),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => pathnameMock(),
}));

vi.mock('next-auth/react', () => ({
  signIn: signInMock,
  getSession: getSessionMock,
}));

const links = { warehousePostingId: 'posting-1', claimantProfileId: 'claimant-1' };

const EMAIL_TO_SESSION_ROLE: Record<string, string> = {
  'claimant@example.com': 'CLAIMANT',
  'employer@example.com': 'EMPLOYER',
  'caseworker@example.com': 'CASEWORKER',
};

// Mirrors the real flow: signIn() "commits" a role, getSession() reflects
// whatever role was most recently committed. Individual tests can still
// override either mock's behavior directly for a specific scenario (a
// failed sign-in, a session that takes a few calls to catch up).
let currentSessionRole = 'CLAIMANT';

function mockFetchRouter(overrides: {
  linksOk?: boolean;
  interviewStatus?: string | null;
  hireStatus?: string;
} = {}) {
  const { linksOk = true, interviewStatus = 'CONFIRMED', hireStatus = 'HIRED' } = overrides;
  vi.mocked(fetch).mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/demo/scenario-links') {
      return { ok: linksOk, json: async () => links } as Response;
    }
    if (url === '/api/job-applications') {
      return {
        ok: true,
        json: async () => [
          {
            jobPosting: { title: 'Warehouse Associate' },
            interview: interviewStatus ? { status: interviewStatus } : null,
          },
        ],
      } as Response;
    }
    if (url === `/api/employer/job-postings/${links.warehousePostingId}/applications`) {
      return { ok: true, json: async () => [{ status: hireStatus }] } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
}

describe('GuidedDemoWidget', () => {
  beforeEach(() => {
    sessionStorage.clear();
    pushMock.mockClear();
    pathnameMock.mockReset();
    pathnameMock.mockReturnValue('/');
    currentSessionRole = 'CLAIMANT';

    signInMock.mockReset();
    signInMock.mockImplementation(async (_provider: string, opts: { email: string }) => {
      currentSessionRole = EMAIL_TO_SESSION_ROLE[opts.email] ?? currentSessionRole;
      return { error: undefined };
    });

    getSessionMock.mockReset();
    getSessionMock.mockImplementation(async () => ({ user: { role: currentSessionRole } }));

    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing when no guided demo is in progress', () => {
    mockFetchRouter();
    const { container } = render(<GuidedDemoWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders step 1 content when sessionStorage has an active step', async () => {
    mockFetchRouter();
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    expect(await screen.findByText('Accept a proposed interview time')).toBeInTheDocument();
    expect(screen.getByText(/Now viewing as: Seed Claimant/)).toBeInTheDocument();
  });

  it('advancing to a different-role step signs in, verifies the session role, and navigates', async () => {
    mockFetchRouter();
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    await screen.findByText('Accept a proposed interview time');

    fireEvent.click(screen.getByRole('button', { name: /Next: switch to the employer/i }));

    await waitFor(() =>
      expect(signInMock).toHaveBeenCalledWith('credentials', {
        redirect: false,
        email: 'employer@example.com',
        password: 'EmployerPass123',
      })
    );
    await waitFor(() => expect(getSessionMock).toHaveBeenCalled());
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/employer/job-postings/posting-1'));
    expect(sessionStorage.getItem('emplement-guided-demo-step')).toBe('2');
  });

  it('retries getSession until the new role is actually live before navigating', async () => {
    // The exact race this guards against: signIn()'s promise resolving
    // doesn't guarantee the session context has caught up yet. Simulate
    // getSession() returning the OLD role for the first two calls, then the
    // new one — the widget must wait for it, not navigate on the first call.
    mockFetchRouter();
    let getSessionCallCount = 0;
    getSessionMock.mockImplementation(async () => {
      getSessionCallCount += 1;
      const role = getSessionCallCount <= 2 ? 'CLAIMANT' : 'EMPLOYER';
      return { user: { role } };
    });
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    await screen.findByText('Accept a proposed interview time');

    fireEvent.click(screen.getByRole('button', { name: /Next: switch to the employer/i }));

    await waitFor(() => expect(getSessionCallCount).toBeGreaterThanOrEqual(3));
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/employer/job-postings/posting-1'));
  });

  it('shows an error and does not navigate if the session role never catches up', async () => {
    mockFetchRouter();
    getSessionMock.mockImplementation(async () => ({ user: { role: 'CLAIMANT' } }));
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    await screen.findByText('Accept a proposed interview time');

    fireEvent.click(screen.getByRole('button', { name: /Next: switch to the employer/i }));

    expect(await screen.findByText(/session hasn.t taken effect yet/i, {}, { timeout: 8000 })).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('emplement-guided-demo-step')).toBe('1');
  }, 10000);

  it('advancing between two steps with the same role does not sign in, verify session, or navigate', async () => {
    mockFetchRouter();
    sessionStorage.setItem('emplement-guided-demo-step', '2');
    render(<GuidedDemoWidget />);
    await screen.findByText('See the interview confirmed');

    fireEvent.click(screen.getByRole('button', { name: /Next: hire the candidate/i }));

    const heading = await screen.findByRole('heading', { name: 'Hire the candidate' });
    expect(signInMock).not.toHaveBeenCalled();
    expect(getSessionMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('emplement-guided-demo-step')).toBe('3');
    expect(document.activeElement).toBe(heading);
  });

  it('shows an error and does not advance when sign-in fails', async () => {
    mockFetchRouter();
    signInMock.mockResolvedValue({ error: 'CredentialsSignin' });
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    await screen.findByText('Accept a proposed interview time');

    fireEvent.click(screen.getByRole('button', { name: /Next: switch to the employer/i }));

    expect(await screen.findByText(/demo login is temporarily unavailable/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('emplement-guided-demo-step')).toBe('1');
  });

  it('blocks advancing from step 1 if the interview has not actually been accepted yet', async () => {
    mockFetchRouter({ interviewStatus: 'PROPOSED' });
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    await screen.findByText('Accept a proposed interview time');

    fireEvent.click(screen.getByRole('button', { name: /Next: switch to the employer/i }));

    expect(await screen.findByText(/accept one of the proposed interview times/i)).toBeInTheDocument();
    expect(signInMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('emplement-guided-demo-step')).toBe('1');
  });

  it('allows advancing from step 1 once the interview is confirmed', async () => {
    mockFetchRouter({ interviewStatus: 'CONFIRMED' });
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    await screen.findByText('Accept a proposed interview time');

    fireEvent.click(screen.getByRole('button', { name: /Next: switch to the employer/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/employer/job-postings/posting-1'));
  });

  it('blocks advancing from step 3 if Hire has not actually been completed yet', async () => {
    mockFetchRouter({ hireStatus: 'PENDING' });
    sessionStorage.setItem('emplement-guided-demo-step', '3');
    render(<GuidedDemoWidget />);
    await screen.findByText('Hire the candidate');

    fireEvent.click(screen.getByRole('button', { name: /Next: switch back to the claimant/i }));

    expect(await screen.findByText(/click hire above before continuing/i)).toBeInTheDocument();
    expect(signInMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('emplement-guided-demo-step')).toBe('3');
  });

  it('allows advancing from step 3 once Hire has been completed', async () => {
    mockFetchRouter({ hireStatus: 'HIRED' });
    sessionStorage.setItem('emplement-guided-demo-step', '3');
    render(<GuidedDemoWidget />);
    await screen.findByText('Hire the candidate');

    fireEvent.click(screen.getByRole('button', { name: /Next: switch back to the claimant/i }));

    await waitFor(() =>
      expect(signInMock).toHaveBeenCalledWith('credentials', {
        redirect: false,
        email: 'claimant@example.com',
        password: 'ClaimantPass123',
      })
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/claim/dashboard'));
  });

  it('exiting the demo clears the stored step and unmounts', async () => {
    mockFetchRouter();
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    await screen.findByText('Accept a proposed interview time');

    fireEvent.click(screen.getByRole('button', { name: /exit demo/i }));

    expect(sessionStorage.getItem('emplement-guided-demo-step')).toBeNull();
    await waitFor(() => expect(screen.queryByText('Accept a proposed interview time')).not.toBeInTheDocument());
  });

  it('shows a data-unavailable message and disables the primary action when scenario-links fails', async () => {
    mockFetchRouter({ linksOk: false });
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    expect(await screen.findByText(/isn't available in this environment/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next: switch to the employer/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /exit demo/i })).toBeEnabled();
  });

  it('fetches scenario-links exactly once across mount and a step transition', async () => {
    mockFetchRouter();
    sessionStorage.setItem('emplement-guided-demo-step', '2');
    render(<GuidedDemoWidget />);
    await screen.findByText('See the interview confirmed');
    const linksCallsBefore = vi.mocked(fetch).mock.calls.filter(([u]) => u === '/api/demo/scenario-links').length;
    expect(linksCallsBefore).toBe(1);

    fireEvent.click(screen.getByRole('button', { name: /Next: hire the candidate/i }));
    await screen.findByText('Hire the candidate');

    const linksCallsAfter = vi.mocked(fetch).mock.calls.filter(([u]) => u === '/api/demo/scenario-links').length;
    expect(linksCallsAfter).toBe(1);
  });

  it('disables the primary button while scenario-links is still loading', async () => {
    let resolveFetch!: (value: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.mocked(fetch).mockReturnValue(fetchPromise);
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    await screen.findByText('Accept a proposed interview time');

    expect(screen.getByRole('button', { name: /Next: switch to the employer|Loading/i })).toBeDisabled();

    resolveFetch({ ok: true, json: async () => links } as Response);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Next: switch to the employer/i })).toBeEnabled()
    );
  });

  it('never paints the primary button as enabled on the commit that first shows step content', async () => {
    // A plain post-render assertion can't catch this: @testing-library's
    // render() flushes React's passive effects synchronously (via act()),
    // so by the time render() returns, the fetch effect's own
    // setLinksLoading(true) call has already run regardless of the
    // useState default — collapsing the real gap this bug lived in
    // (passive effects commit after paint, so a real browser can render
    // one frame with the button enabled before the effect corrects it).
    //
    // Instead, watch the actual sequence of DOM mutations to the button's
    // `disabled` attribute via MutationObserver, which records each
    // synchronous mutation in the order it happened even though delivery
    // is batched. If linksLoading ever defaulted to false, the button's
    // *first* observed transition would be FROM enabled (attribute absent,
    // recorded oldValue === null) — exactly the bug this test guards
    // against.
    mockFetchRouter();
    sessionStorage.setItem('emplement-guided-demo-step', '1');

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((mutations) => records.push(...mutations));
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['disabled'],
      subtree: true,
      attributeOldValue: true,
    });

    render(<GuidedDemoWidget />);
    await screen.findByText('Accept a proposed interview time');
    observer.disconnect();

    const primaryButtonMutations = records.filter((r) =>
      /Next: switch to the employer|Loading/i.test((r.target as HTMLElement).textContent ?? '')
    );
    const everStartedEnabled = primaryButtonMutations.some((r) => r.oldValue === null);
    expect(everStartedEnabled).toBe(false);
  });

  it('exiting the demo while the scenario-links fetch is still in flight does not warn or throw', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let resolveFetch!: (value: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    vi.mocked(fetch).mockReturnValue(fetchPromise);
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    await screen.findByText('Accept a proposed interview time');

    fireEvent.click(screen.getByRole('button', { name: /exit demo/i }));
    expect(sessionStorage.getItem('emplement-guided-demo-step')).toBeNull();
    await waitFor(() => expect(screen.queryByText('Accept a proposed interview time')).not.toBeInTheDocument());

    // Resolve the in-flight fetch after the exit — with the cancelled flag
    // removed, its .then/.finally handlers now run for real. This must not
    // throw or produce a React "state update" warning.
    resolveFetch({ ok: true, json: async () => links } as Response);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    // Give the resolved fetch's .then/.finally chain a turn to run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('picks up a sessionStorage step written after mount once the route changes', async () => {
    // Regression test: the widget is mounted once, globally, in
    // providers.tsx and never remounts across client-side navigation. A
    // "Start Guided Demo" button on another page writes sessionStorage
    // directly and then navigates — the already-mounted widget must notice
    // via the pathname dependency, not require a full page reload.
    mockFetchRouter();
    pathnameMock.mockReturnValue('/');
    const { rerender } = render(<GuidedDemoWidget />);
    expect(screen.queryByText('Accept a proposed interview time')).not.toBeInTheDocument();

    // Simulate another component writing sessionStorage and then a
    // client-side route change (App Router keeps this widget mounted, so
    // only its pathname prop-equivalent changes, not a remount).
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    pathnameMock.mockReturnValue('/some/other/page');
    rerender(<GuidedDemoWidget />);

    expect(await screen.findByText('Accept a proposed interview time')).toBeInTheDocument();
  });

  it('does not show a Back button on step 1', async () => {
    mockFetchRouter();
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    await screen.findByText('Accept a proposed interview time');
    expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
  });

  it('Back navigates to the previous step without requiring the current step to be complete', async () => {
    // Step 2 has no completion requirement of its own, but this proves Back
    // skips findIncompleteStepMessage entirely rather than happening to pass
    // it: step 2's own instruction doesn't depend on any action, so a false
    // pass here wouldn't be distinguishable from a real skip. What's real is
    // that no completion-check fetch (/api/job-applications) fires for a
    // step-1-targeted Back click, verified below by asserting only the
    // scenario-links call happened.
    mockFetchRouter();
    sessionStorage.setItem('emplement-guided-demo-step', '2');
    render(<GuidedDemoWidget />);
    await screen.findByText('See the interview confirmed');
    vi.mocked(fetch).mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));

    await waitFor(() =>
      expect(signInMock).toHaveBeenCalledWith('credentials', {
        redirect: false,
        email: 'claimant@example.com',
        password: 'ClaimantPass123',
      })
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/claim/applications'));
    expect(sessionStorage.getItem('emplement-guided-demo-step')).toBe('1');
    expect(vi.mocked(fetch).mock.calls.some(([u]) => u === '/api/job-applications')).toBe(false);
  });

  it('collapses to a small chip and expands back to the full panel', async () => {
    mockFetchRouter();
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    await screen.findByText('Accept a proposed interview time');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse guided demo' }));

    expect(screen.queryByRole('region', { name: 'Guided demo' })).not.toBeInTheDocument();
    expect(screen.queryByText('Accept a proposed interview time')).not.toBeInTheDocument();
    const chip = screen.getByRole('button', { name: /Expand guided demo — step 1 of 5/i });
    expect(chip).toBeInTheDocument();

    fireEvent.click(chip);

    expect(await screen.findByText('Accept a proposed interview time')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Guided demo' })).toBeInTheDocument();
  });

  it('stays collapsed with an up-to-date step label across a step transition', async () => {
    mockFetchRouter();
    sessionStorage.setItem('emplement-guided-demo-step', '2');
    render(<GuidedDemoWidget />);
    await screen.findByText('See the interview confirmed');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse guided demo' }));
    expect(screen.getByRole('button', { name: /Expand guided demo — step 2 of 5/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Expand guided demo/i }));
    fireEvent.click(screen.getByRole('button', { name: /Next: hire the candidate/i }));
    await screen.findByText('Hire the candidate');
    fireEvent.click(screen.getByRole('button', { name: 'Collapse guided demo' }));

    expect(screen.getByRole('button', { name: /Expand guided demo — step 3 of 5/i })).toBeInTheDocument();
  });
});
