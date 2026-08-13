'use client';

import React, { useEffect, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';

type Props = {
  /** How long before expiry to show the warning. Defaults to 2 minutes. */
  warnBeforeMs?: number;
};

export function SessionTimeoutWarning({ warnBeforeMs = 2 * 60 * 1000 }: Props) {
  const { data, update } = useSession();
  const [visible, setVisible] = useState(false);

  // Depend on the expiry string, not the `data` object itself: SessionProvider's
  // default refetchOnWindowFocus re-fetches (and returns a brand-new `data`
  // reference) on every tab/window refocus even when nothing actually changed.
  // Depending on the whole object would tear down and reschedule this timer on
  // every refocus, repeatedly deferring the warning from the real session start.
  const expiresAt = data?.expires;

  useEffect(() => {
    // No active session (e.g. an unauthenticated page) -- nothing to warn about.
    if (!expiresAt) return;

    // Anchored to the session's real expiry, not a fixed duration measured from
    // whenever this component happened to mount. A mount-relative timer drifts
    // away from the truth on every client-side navigation and says nothing
    // about when the token actually dies (WCAG 2.2.1 wants a warning about the
    // real timeout). Re-arming is automatic: extending the session changes
    // `expires`, which re-runs this effect for the new deadline.
    const msUntilWarning = new Date(expiresAt).getTime() - Date.now() - warnBeforeMs;
    if (msUntilWarning <= 0) {
      setVisible(true);
      return;
    }

    setVisible(false);
    const warnTimer = setTimeout(() => setVisible(true), msUntilWarning);
    return () => clearTimeout(warnTimer);
  }, [expiresAt, warnBeforeMs]);

  async function handleExtend() {
    // Genuinely extend the underlying NextAuth session (JWT strategy: this
    // re-fetches/refreshes the token, resetting its rolling expiry) rather
    // than just dismissing the warning while the token keeps expiring. The
    // refreshed `expires` re-arms the timer above via the effect dependency.
    await update();
    setVisible(false);
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
