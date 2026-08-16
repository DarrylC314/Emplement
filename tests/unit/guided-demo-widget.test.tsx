import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GuidedDemoWidget } from '@/components/demo/GuidedDemoWidget';

const { pushMock, signInMock } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  signInMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
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
});
