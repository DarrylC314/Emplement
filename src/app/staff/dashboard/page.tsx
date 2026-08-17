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

type ExpirationCheckSummary = {
  recordsEvaluated: number;
  separationsCreated: number;
  claimsRetainedRestricted: number;
  claimsSentToReevaluation: number;
  claimsReactivated: number;
  failures: { employmentEventId: string; error: string }[];
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
  const [expirationSummary, setExpirationSummary] = useState<ExpirationCheckSummary | null>(null);
  const [expirationRunning, setExpirationRunning] = useState(false);
  const [expirationError, setExpirationError] = useState<string | null>(null);

  async function handleRunExpirationCheck() {
    setExpirationRunning(true);
    setExpirationError(null);
    try {
      const res = await fetch('/api/staff/employment-expirations/run-check', { method: 'POST' });
      if (!res.ok) {
        setExpirationError('The expiration check could not be run. Please try again.');
        return;
      }
      setExpirationSummary(await res.json());
    } finally {
      setExpirationRunning(false);
    }
  }

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

      <section className="border border-border rounded p-4 mb-8">
        <h2 className="font-medium mb-2">Employment expiration check</h2>
        <p className="text-sm text-text-secondary mb-2">
          Runs automatically on a schedule. Use this to run it now for a demo, or to catch up after a missed run.
        </p>
        <button
          type="button"
          onClick={handleRunExpirationCheck}
          disabled={expirationRunning}
          className="rounded bg-primary px-4 py-2 text-white disabled:opacity-50"
        >
          {expirationRunning ? 'Running…' : 'Run expiration check now'}
        </button>
        {expirationError && (
          <p role="alert" className="mt-2 text-error-text">
            {expirationError}
          </p>
        )}
        {expirationSummary && (
          <dl className="mt-4 text-sm grid grid-cols-2 gap-x-4 gap-y-1 max-w-md">
            <dt className="text-text-secondary">Evaluated</dt>
            <dd>{expirationSummary.recordsEvaluated} evaluated</dd>
            <dt className="text-text-secondary">Separations created</dt>
            <dd>{expirationSummary.separationsCreated}</dd>
            <dt className="text-text-secondary">Reactivated</dt>
            <dd>{expirationSummary.claimsReactivated} reactivated</dd>
            <dt className="text-text-secondary">Sent to reevaluation</dt>
            <dd>{expirationSummary.claimsSentToReevaluation} sent to reevaluation</dd>
            <dt className="text-text-secondary">Retained as restricted</dt>
            <dd>{expirationSummary.claimsRetainedRestricted} retained as restricted</dd>
            <dt className="text-text-secondary">Failures</dt>
            <dd>{expirationSummary.failures.length} failure{expirationSummary.failures.length === 1 ? '' : 's'}</dd>
          </dl>
        )}
        {expirationSummary && expirationSummary.failures.length > 0 && (
          <ul className="mt-2 text-sm text-error-text space-y-1">
            {expirationSummary.failures.map((f) => (
              <li key={f.employmentEventId}>
                {f.employmentEventId}: {f.error}
              </li>
            ))}
          </ul>
        )}
      </section>

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
                  {claimant.dateOfBirth &&
                    // Pinned to UTC specifically for this field: Prisma
                    // serializes dateOfBirth as UTC midnight, and this
                    // workflow relies on DOB for claimant disambiguation, so
                    // it can't render a day early for viewers west of UTC
                    // the way the app's other (lower-stakes) date displays
                    // do.
                    `DOB: ${new Date(claimant.dateOfBirth).toLocaleDateString(undefined, { timeZone: 'UTC' })}`}
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
