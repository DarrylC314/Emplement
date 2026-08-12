import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SessionTimeoutWarning } from '@/components/layout/SessionTimeoutWarning';

const { updateMock, signOutMock } = vi.hoisted(() => ({
  updateMock: vi.fn().mockResolvedValue(undefined),
  signOutMock: vi.fn(),
}));

const mockSession = {
  user: { id: '1' },
  expires: new Date(Date.now() + 1000).toISOString(),
};

vi.mock('next-auth/react', () => ({
  useSession: () => ({ data: mockSession, status: 'authenticated', update: updateMock }),
  signOut: signOutMock,
}));

describe('SessionTimeoutWarning', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    updateMock.mockClear();
    signOutMock.mockClear();
  });

  it('shows a warning dialog before the session expires, genuinely extends the session on "Stay logged in", and re-arms the warning for the extended session', async () => {
    render(<SessionTimeoutWarning warnBeforeMs={500} sessionLengthMs={1000} />);
    act(() => {
      vi.advanceTimersByTime(600);
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

    // Without resetting the local warning timer, the original setTimeout (armed
    // at mount) would already have fired and the warning would never come back.
    // Advancing another full warn-before window proves the timer was re-armed
    // for the newly-extended session rather than firing only once.
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('logs the user out immediately when "Log out now" is clicked', () => {
    render(<SessionTimeoutWarning warnBeforeMs={500} sessionLengthMs={1000} />);
    act(() => {
      vi.advanceTimersByTime(600);
    });

    fireEvent.click(screen.getByRole('button', { name: /log out now/i }));
    expect(signOutMock).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });
});
