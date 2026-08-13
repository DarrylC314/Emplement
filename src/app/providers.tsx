'use client';

import { useEffect } from 'react';
import { SessionProvider } from 'next-auth/react';
import { AppNav } from '@/components/layout/AppNav';
import { SessionTimeoutWarning } from '@/components/layout/SessionTimeoutWarning';
import { RouteFocusManager } from '@/components/layout/RouteFocusManager';

export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // A hydration signal E2E tests can wait on before interacting with any
    // form. Playwright's actionability checks (visible/stable/enabled) pass
    // before React has attached event handlers, so a click that lands in
    // that window triggers a native form submit instead of the page's
    // onSubmit — reloading the page and silently losing whatever the test
    // just filled in. This runs in an effect, so it only sets once React is
    // actually live, and — unlike waiting on AppNav's sign-out button — it
    // works on unauthenticated pages too (signup, login), where no nav
    // renders at all.
    document.body.dataset.hydrated = 'true';
  }, []);

  return (
    // AppNav needs the session, so it lives inside SessionProvider rather than
    // in layout.tsx. It renders before {children} — and therefore before each
    // page's own <main id="main-content"> — so the layout's skip link still
    // jumps past the navigation to the page content, as WCAG expects.
    <SessionProvider>
      <RouteFocusManager />
      <AppNav />
      {children}
      <SessionTimeoutWarning />
    </SessionProvider>
  );
}
