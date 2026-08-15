'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';

type QueueItem = {
  id: string;
  weekEndingDate: string;
  autoDecisionReason: string;
  claim: { id: string; claimant: { id: string; legalName: string | null } };
};

type ClaimantResult = {
  id: string;
  legalName: string | null;
  prefix: 'MR' | 'MRS' | 'MS' | 'DR' | 'MX' | null;
  suffix: 'JR' | 'SR' | 'II' | 'III' | 'IV' | null;
  gender: string | null;
  dateOfBirth: string | null;
  user: { email: string };
};

const PREFIX_LABELS: Record<NonNullable<ClaimantResult['prefix']>, string> = {
  MR: 'Mr.',
  MRS: 'Mrs.',
  MS: 'Ms.',
  DR: 'Dr.',
  MX: 'Mx.',
};

const SUFFIX_LABELS: Record<NonNullable<ClaimantResult['suffix']>, string> = {
  JR: 'Jr.',
  SR: 'Sr.',
  II: 'II',
  III: 'III',
  IV: 'IV',
};

function formatClaimantName(claimant: ClaimantResult): string {
  const name = claimant.legalName ?? claimant.user.email;
  const withPrefix = claimant.prefix ? `${PREFIX_LABELS[claimant.prefix]} ${name}` : name;
  return claimant.suffix ? `${withPrefix}, ${SUFFIX_LABELS[claimant.suffix]}` : withPrefix;
}

export default function StaffDashboardPage() {
  const { data: session } = useSession();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ClaimantResult[]>([]);

  useEffect(() => {
    fetch('/api/staff/queue')
      .then((r) => r.json())
      .then(setQueue);
  }, []);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/staff/claimants?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    setResults(data);
  }

  if (session && session.user.role !== 'CASEWORKER' && session.user.role !== 'ADMIN') {
    return (
      <main id="main-content" className="p-8">
        <p role="alert">You do not have access to this page.</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Review queue</h1>
      <p className="mb-4 text-text-secondary">
        {queue.length} certification{queue.length === 1 ? '' : 's'} awaiting review.
      </p>
      <ul className="space-y-3 mb-8">
        {queue.map((item) => (
          <li key={item.id} className="border border-border rounded p-4">
            <p className="font-medium">
              {item.claim.claimant.legalName ?? 'Unnamed claimant'} — week ending{' '}
              {new Date(item.weekEndingDate).toLocaleDateString()}
            </p>
            <p className="text-sm text-text-secondary mb-2">{item.autoDecisionReason}</p>
            <Link href={`/staff/claimants/${item.claim.claimant.id}`} className="text-link underline">
              Review case
            </Link>
          </li>
        ))}
      </ul>

      <form
        onSubmit={handleSearch}
        role="search"
        aria-label="Search claimants"
        className="max-w-sm mb-8"
      >
        <label htmlFor="claimant-search" className="block font-medium mb-1">
          Search claimants
        </label>
        <input
          id="claimant-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded border border-border px-3 py-2"
        />
      </form>

      {results.length > 0 && (
        <ul className="space-y-3">
          {results.map((claimant) => (
            <li key={claimant.id} className="border border-border rounded p-4">
              <p className="font-medium">{formatClaimantName(claimant)}</p>
              {(claimant.gender || claimant.dateOfBirth) && (
                <p className="text-sm text-text-secondary">
                  {claimant.gender && `Gender: ${claimant.gender}`}
                  {claimant.gender && claimant.dateOfBirth && ' — '}
                  {claimant.dateOfBirth && `DOB: ${new Date(claimant.dateOfBirth).toLocaleDateString()}`}
                </p>
              )}
              <Link href={`/staff/claimants/${claimant.id}`} className="text-link underline">
                Review case
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
