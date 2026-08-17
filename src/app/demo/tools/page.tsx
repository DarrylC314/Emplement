'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

export default function DemoToolsPage() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [resetResult, setResetResult] = useState<string | null>(null);

  async function loginAsClaimant2() {
    setErrors([]);
    setPending(true);
    const result = await signIn('credentials', {
      redirect: false,
      email: 'claimant2@example.com',
      password: 'Claimant2Pass123',
    });
    if (result?.error) {
      setErrors([{ id: 'claimant2', message: 'The demo login is temporarily unavailable. Please try again.' }]);
      setPending(false);
      return;
    }
    router.push('/claim/dashboard');
  }

  async function resetGuidedDemoData() {
    setErrors([]);
    setResetResult(null);
    setPending(true);
    try {
      const res = await fetch('/api/demo/reset', { method: 'POST' });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setResetResult(body?.error ?? 'Reset failed. Please try again.');
        return;
      }
      setResetResult('Guided demo data has been reset to its starting state.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main id="main-content" className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Demo tools</h1>
      <p className="text-sm text-text-secondary mb-8">
        Internal utilities for testing the guided demo — not linked from the homepage.
      </p>

      <ErrorSummary errors={errors} />

      <section className="border border-border rounded p-4 mb-6">
        <h2 className="font-medium mb-1">Seed Claimant Two</h2>
        <p className="text-sm text-text-secondary mb-4">
          Logs in directly as claimant2@example.com — a second demo claimant used for testing, outside the
          primary guided-demo sequence.
        </p>
        <Button type="button" onClick={loginAsClaimant2} disabled={pending}>
          {pending ? 'Logging in…' : 'Log in as Seed Claimant Two'}
        </Button>
      </section>

      <section className="border border-border rounded p-4">
        <h2 className="font-medium mb-1">Reset guided demo data</h2>
        <p className="text-sm text-text-secondary mb-4">
          Reverts Seed Claimant&apos;s Warehouse Associate interview, application, and claim status back to
          their starting state, so the guided demo can be run again from a clean slate.
        </p>
        {resetResult && (
          <p role="status" className="text-sm mb-3">
            {resetResult}
          </p>
        )}
        <Button type="button" variant="secondary" onClick={resetGuidedDemoData} disabled={pending}>
          {pending ? 'Resetting…' : 'Reset guided demo data'}
        </Button>
      </section>
    </main>
  );
}
