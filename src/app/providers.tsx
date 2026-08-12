'use client';

import { SessionProvider } from 'next-auth/react';
import { SessionTimeoutWarning } from '@/components/layout/SessionTimeoutWarning';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      {children}
      <SessionTimeoutWarning />
    </SessionProvider>
  );
}
