'use client';

import Link from 'next/link';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

const primaryLinkClasses =
  'rounded px-4 py-2 font-medium focus-visible:outline focus-visible:outline-2 bg-primary text-white hover:bg-primary-hover';
const secondaryLinkClasses =
  'rounded px-4 py-2 font-medium focus-visible:outline focus-visible:outline-2 bg-surface border border-border text-text-primary hover:bg-surface-alt';

type DemoRole = 'claimant' | 'caseworker';

const DEMO_ACCOUNTS: Record<DemoRole, { email: string; password: string; dashboard: string }> = {
  claimant: { email: 'claimant@example.com', password: 'ClaimantPass123', dashboard: '/claim/dashboard' },
  caseworker: { email: 'caseworker@example.com', password: 'CaseworkerPass123', dashboard: '/staff/dashboard' },
};

export default function Home() {
  const router = useRouter();
  const [pendingDemo, setPendingDemo] = useState<DemoRole | null>(null);
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);

  async function enterDemo(role: DemoRole) {
    setErrors([]);
    setPendingDemo(role);
    const { email, password, dashboard } = DEMO_ACCOUNTS[role];
    const result = await signIn('credentials', { redirect: false, email, password });
    if (result?.error) {
      setErrors([{ id: 'demo', message: 'The demo login is temporarily unavailable. Please try again.' }]);
      setPendingDemo(null);
      return;
    }
    router.push(dashboard);
  }

  return (
    <main id="main-content" className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold">Emplement</h1>
      <p className="mt-2 mb-8 text-text-secondary">
        Unemployment benefit claims — claimant and caseworker portals.
      </p>

      <ErrorSummary errors={errors} />

      <div className="grid gap-6 sm:grid-cols-2">
        <section className="border border-border rounded p-4">
          <h2 className="font-medium mb-1">Claimants</h2>
          <p className="text-sm text-text-secondary mb-4">
            File a new claim, certify your weekly benefits, or check your claim status.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/claim/login" className={primaryLinkClasses}>
              Log in
            </Link>
            <Link href="/claim/signup" className={secondaryLinkClasses}>
              Create an account
            </Link>
            <Button
              type="button"
              variant="secondary"
              onClick={() => enterDemo('claimant')}
              disabled={pendingDemo !== null}
            >
              {pendingDemo === 'claimant' ? 'Entering demo…' : 'Enter Claimant Demo'}
            </Button>
          </div>
        </section>

        <section className="border border-border rounded p-4">
          <h2 className="font-medium mb-1">Caseworkers</h2>
          <p className="text-sm text-text-secondary mb-4">
            Review flagged certifications, manage claimant cases, and respond to messages.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/staff/login" className={secondaryLinkClasses}>
              Staff log in
            </Link>
            <Button
              type="button"
              variant="secondary"
              onClick={() => enterDemo('caseworker')}
              disabled={pendingDemo !== null}
            >
              {pendingDemo === 'caseworker' ? 'Entering demo…' : 'Enter Caseworker Demo'}
            </Button>
          </div>
        </section>
      </div>
    </main>
  );
}
