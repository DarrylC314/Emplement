import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SessionTimeoutWarning } from '@/components/layout/SessionTimeoutWarning';

// The component derives its warning timing from the session's real `expires`,
// so the mock models the real thing: `update()` refreshes the expiry the way
// NextAuth's JWT strategy does (now + maxAge), and the component is expected to
// re-arm off that new value rather than off a fixed mount-relative duration.
const SESSION_LENGTH_MS = 1000;

const { updateMock, signOutMock, sessionState } = vi.hoisted(() => {
  const sessionState = { expires: '' };
  return {
    sessionState,
    updateMock: vi.fn(async () => {
      sessionState.expires = new Date(Date.now() + 1000).toISOString();
    }),
    signOutMock: vi.fn(),
  };
});

vi.mock('next-auth/react', () => ({
  useSession: () => ({
    data: { user: { id: '1' }, expires: sessionState.expires },
    status: 'authenticated',
    update: updateMock,
  }),
  signOut: signOutMock,
}));

describe('SessionTimeoutWarning', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updateMock.mockClear();
    signOutMock.mockClear();
    sessionState.expires = new Date(Date.now() + SESSION_LENGTH_MS).toISOString();
  });

  it('shows a warning dialog before the session expires, genuinely extends the session on "Stay logged in", and re-arms the warning for the extended session', async () => {
    render(<SessionTimeoutWarning warnBeforeMs={500} />);

    // Nothing yet: the warning is armed for expiry-minus-500ms, i.e. t+500.
    act(() => {
      vi.advanceTimersByTime(400);
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/session is about to expire/i)).toBeInTheDocument();

    const extendButton = screen.getByRole('button', { name: /stay logged in/i });
    await act(async () => {
      fireEvent.click(extendButton);
    });

    // The dialog must not just hide itself -- it must genuinely extend the
    // underlying NextAuth session via useSession()'s update(), or the token
    // keeps expiring on its original schedule regardless (a WCAG 2.2.1 violation).
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    // The refreshed session expires 1000ms after the extend, so the warning is
    // due 500ms later. Firing again proves the timer was re-armed off the new
    // real expiry rather than firing once and never again.
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('warns immediately when the session is already inside the warning window', () => {
    sessionState.expires = new Date(Date.now() + 100).toISOString();
    render(<SessionTimeoutWarning warnBeforeMs={500} />);
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('renders nothing when there is no session expiry to warn about', () => {
    sessionState.expires = '';
    render(<SessionTimeoutWarning warnBeforeMs={500} />);
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  it('logs the user out immediately when "Log out now" is clicked', () => {
    render(<SessionTimeoutWarning warnBeforeMs={500} />);
    act(() => {
      vi.advanceTimersByTime(600);
    });

    fireEvent.click(screen.getByRole('button', { name: /log out now/i }));
    expect(signOutMock).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
