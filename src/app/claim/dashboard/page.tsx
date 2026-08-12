'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';

type Claim = {
  id: string;
  status: 'ACTIVE' | 'RESTRICTED' | 'DENIED' | 'CLOSED';
  weeklyBenefitAmount: string;
  openedDate: string;
};

export default function DashboardPage() {
  const { data: session } = useSession();
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.user.claimantProfileId) return;
    fetch(`/api/claims?claimantProfileId=${session.user.claimantProfileId}`)
      .then((r) => r.json())
      .then((data) => {
        setClaims(data);
        setLoading(false);
      });
  }, [session?.user.claimantProfileId]);

  if (loading) return <main id="main-content" className="p-8">Loading…</main>;

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
