'use client';

import React, { useEffect, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';

type Props = {
  /** How long before expiry to show the warning. Defaults to 2 minutes. */
  warnBeforeMs?: number;
  /** Total session length, used only for the test harness; production reads from the session. */
  sessionLengthMs?: number;
};

export function SessionTimeoutWarning({
  warnBeforeMs = 2 * 60 * 1000,
  sessionLengthMs = 30 * 60 * 1000,
}: Props) {
  const { data, update } = useSession();
  const [visible, setVisible] = useState(false);
  // Bumped every time the session is extended, to re-arm the warning timer
  // below for the new expiry instead of only ever firing once at mount.
  const [cycle, setCycle] = useState(0);

  // Depend on the expiry string, not the `data` object itself: SessionProvider's
  // default refetchOnWindowFocus re-fetches (and returns a brand-new `data`
  // reference) on every tab/window refocus even when nothing actually changed.
  // Depending on the whole object would tear down and reschedule this timer on
  // every refocus, repeatedly deferring the warning from the real session start.
  const expiresAt = data?.expires;

  useEffect(() => {
    // No active session (e.g. an unauthenticated page) -- nothing to warn about.
    if (!expiresAt) return;

    const warnTimer = setTimeout(() => setVisible(true), sessionLengthMs - warnBeforeMs);
    return () => clearTimeout(warnTimer);
  }, [expiresAt, sessionLengthMs, warnBeforeMs, cycle]);

  async function handleExtend() {
    // Genuinely extend the underlying NextAuth session (JWT strategy: this
    // re-fetches/refreshes the token, resetting its rolling expiry) rather
    // than just dismissing the warning while the token keeps expiring.
    await update();
    setVisible(false);
    setCycle((c) => c + 1);
  }

  if (!visible) return null;

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="timeout-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="bg-surface rounded p-6 max-w-sm">
        <h2 id="timeout-title" className="font-bold text-lg mb-2">
          Your session is about to expire
        </h2>
        <p className="mb-4 text-text-secondary">
          You&apos;ll be logged out soon due to inactivity. Any unsaved work will be lost.
        </p>
        <div className="flex gap-3">
          <Button onClick={handleExtend}>Stay logged in</Button>
          <Button variant="secondary" onClick={() => signOut()}>
            Log out now
          </Button>
        </div>
      </div>
    </div>
  );
}
