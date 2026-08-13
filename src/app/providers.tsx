'use client';

import { SessionProvider } from 'next-auth/react';
import { AppNav } from '@/components/layout/AppNav';
import { SessionTimeoutWarning } from '@/components/layout/SessionTimeoutWarning';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // AppNav needs the session, so it lives inside SessionProvider rather than
    // in layout.tsx. It renders before {children} — and therefore before each
    // page's own <main id="main-content"> — so the layout's skip link still
    // jumps past the navigation to the page content, as WCAG expects.
    <SessionProvider>
      <AppNav />
      {children}
      <SessionTimeoutWarning />
    </SessionProvider>
  );
}
