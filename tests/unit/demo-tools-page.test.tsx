import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DemoToolsPage from '@/app/demo/tools/page';

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

describe('DemoToolsPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    signInMock.mockReset();
    signInMock.mockResolvedValue({ error: undefined });
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('logs in as claimant2@example.com and navigates to the claimant dashboard', async () => {
    render(<DemoToolsPage />);
    fireEvent.click(screen.getByRole('button', { name: /log in as seed claimant two/i }));

    await waitFor(() =>
      expect(signInMock).toHaveBeenCalledWith('credentials', {
        redirect: false,
        email: 'claimant2@example.com',
        password: 'Claimant2Pass123',
      })
    );
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/claim/dashboard'));
  });

  it('shows an error if the claimant2 login fails', async () => {
    signInMock.mockResolvedValue({ error: 'CredentialsSignin' });
    render(<DemoToolsPage />);
    fireEvent.click(screen.getByRole('button', { name: /log in as seed claimant two/i }));

    expect(await screen.findByText(/demo login is temporarily unavailable/i)).toBeInTheDocument();
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('calls the reset endpoint and shows a success message', async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ reset: true }) } as Response);
    render(<DemoToolsPage />);
    fireEvent.click(screen.getByRole('button', { name: /reset guided demo data/i }));

    expect(fetch).toHaveBeenCalledWith('/api/demo/reset', { method: 'POST' });
    expect(await screen.findByText(/reset to its starting state/i)).toBeInTheDocument();
  });

  it('shows the server error message when reset fails', async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'You must be logged in as a demo account first.' }),
    } as Response);
    render(<DemoToolsPage />);
    fireEvent.click(screen.getByRole('button', { name: /reset guided demo data/i }));

    expect(await screen.findByText('You must be logged in as a demo account first.')).toBeInTheDocument();
  });
});
