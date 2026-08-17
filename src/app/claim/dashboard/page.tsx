'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';

type Claim = {
  id: string;
  status: 'ACTIVE' | 'RESTRICTED' | 'REEVALUATION_REQUIRED' | 'DENIED' | 'CLOSED';
  weeklyBenefitAmount: string;
  openedDate: string;
};

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;

    // Every path must clear `loading`. It used to be cleared only inside the
    // success callback, so a caseworker landing on this claimant-only page, a
    // failed fetch, or a 401/403 left the page stuck on "Loading…" forever.
    const claimantProfileId = session?.user.claimantProfileId;
    if (!claimantProfileId) {
      setLoading(false);
      setError('Sign in with a claimant account to see your claims.');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/claims?claimantProfileId=${claimantProfileId}`);
        if (cancelled) return;
        // A 401/403 body is `{ error: '...' }`, not an array — passing it to
        // setClaims would crash the render on .map instead of explaining.
        if (!res.ok) {
          setError('We could not load your claims. Please sign in again and retry.');
          return;
        }
        setClaims(await res.json());
      } catch {
        if (!cancelled) setError('We could not load your claims. Please check your connection.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user.claimantProfileId, status]);

  if (loading) return <main id="main-content" className="p-8">Loading…</main>;

  if (error) {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Your claims</h1>
        <p role="alert" className="text-error-text">
          {error}
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Your claims</h1>
      {claims.length === 0 ? (
        <div>
          <p className="mb-4">You don&apos;t have any claims yet.</p>
          <Link href="/claim/new">
            <Button>File a new claim</Button>
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {claims.map((c) => (
            <li key={c.id} className="border border-border rounded p-4 flex justify-between items-center">
              <div>
                <p className="font-medium">Weekly benefit: ${c.weeklyBenefitAmount}</p>
                <p className="text-sm text-text-secondary">
                  Opened {new Date(c.openedDate).toLocaleDateString()}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge status={c.status} />
                <Link href={`/claim/certify?claimId=${c.id}`} className="text-link underline">
                  Certify this week
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
