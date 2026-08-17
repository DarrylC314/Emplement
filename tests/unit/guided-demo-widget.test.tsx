import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GuidedDemoWidget } from '@/components/demo/GuidedDemoWidget';

const { pushMock, signInMock, pathnameMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  signInMock: vi.fn(),
  pathnameMock: vi.fn(() => '/'),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => pathnameMock(),
}));

vi.mock('next-auth/react', () => ({
  signIn: signInMock,
}));

const links = { warehousePostingId: 'posting-1', claimantProfileId: 'claimant-1' };

function mockLinksFetch(ok = true) {
  vi.mocked(fetch).mockResolvedValue({ ok, json: async () => links } as Response);
}

describe('GuidedDemoWidget', () => {
  beforeEach(() => {
    sessionStorage.clear();
    pushMock.mockClear();
    signInMock.mockReset();
    signInMock.mockResolvedValue({ error: undefined });
    pathnameMock.mockReset();
    pathnameMock.mockReturnValue('/');
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders nothing when no guided demo is in progress', () => {
    mockLinksFetch();
    const { container } = render(<GuidedDemoWidget />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders step 1 content when sessionStorage has an active step', async () => {
    mockLinksFetch();
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    expect(await screen.findByText('Accept a proposed interview time')).toBeInTheDocument();
    expect(screen.getByText(/Now viewing as: Seed Claimant/)).toBeInTheDocument();
  });

  it('advancing to a different-role step signs in and navigates', async () => {
    mockLinksFetch();
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
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/employer/job-postings/posting-1'));
    expect(sessionStorage.getItem('emplement-guided-demo-step')).toBe('2');
  });

  it('advancing between two steps with the same role does not sign in or navigate', async () => {
    mockLinksFetch();
    sessionStorage.setItem('emplement-guided-demo-step', '2');
    render(<GuidedDemoWidget />);
    await screen.findByText('See the interview confirmed');

    fireEvent.click(screen.getByRole('button', { name: /Next: hire the candidate/i }));

    const heading = await screen.findByRole('heading', { name: 'Hire the candidate' });
    expect(signInMock).not.toHaveBeenCalled();
    expect(pushMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('emplement-guided-demo-step')).toBe('3');
    expect(document.activeElement).toBe(heading);
  });

  it('shows an error and does not advance when sign-in fails', async () => {
    mockLinksFetch();
    signInMock.mockResolvedValue({ error: 'CredentialsSignin' });
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    await screen.findByText('Accept a proposed interview time');

    fireEvent.click(screen.getByRole('button', { name: /Next: switch to the employer/i }));

    expect(await screen.findByText(/demo login is temporarily unavailable/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('emplement-guided-demo-step')).toBe('1');
  });

  it('exiting the demo clears the stored step and unmounts', async () => {
    mockLinksFetch();
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    await screen.findByText('Accept a proposed interview time');

    fireEvent.click(screen.getByRole('button', { name: /exit demo/i }));

    expect(sessionStorage.getItem('emplement-guided-demo-step')).toBeNull();
    await waitFor(() => expect(screen.queryByText('Accept a proposed interview time')).not.toBeInTheDocument());
  });

  it('shows a data-unavailable message and disables the primary action when scenario-links fails', async () => {
    mockLinksFetch(false);
    sessionStorage.setItem('emplement-guided-demo-step', '1');
    render(<GuidedDemoWidget />);
    expect(await screen.findByText(/isn't available in this environment/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next: switch to the employer/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /exit demo/i })).toBeEnabled();
  });

  it('fetches scenario-links exactly once across mount and a step transition', async () => {
    mockLinksFetch();
    sessionStorage.setItem('emplement-guided-demo-step', '2');
    render(<GuidedDemoWidget />);
    await screen.findByText('See the interview confirmed');
    expect(fetch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Next: hire the candidate/i }));
    await screen.findByText('Hire the candidate');

    expect(fetch).toHaveBeenCalledTimes(1);
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
    mockLinksFetch();
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
    mockLinksFetch();
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
});
