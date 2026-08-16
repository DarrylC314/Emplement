'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';

type JobPosting = {
  id: string;
  title: string;
  description: string;
  location: string;
  createdAt: string;
  employer: { companyName: string | null };
};

export default function BrowsePostingsPage() {
  const { data: session, status } = useSession();
  const [postings, setPostings] = useState<JobPosting[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  async function loadPostings() {
    const res = await fetch('/api/job-postings');
    if (!res.ok) {
      setLoadError('We could not load job postings. Please try again.');
      return;
    }
    setPostings(await res.json());
  }

  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'CLAIMANT') return;
    loadPostings();
  }, [status, session?.user.role]);

  async function handleApply(jobPostingId: string) {
    setActionError(null);
    const res = await fetch('/api/job-applications', {
      method: 'POST',
      body: JSON.stringify({ jobPostingId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setActionError(body?.error ?? 'We could not submit your application. Please try again.');
      return;
    }
    setAppliedIds((prev) => new Set(prev).add(jobPostingId));
  }

  if (status === 'loading') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        Loading…
      </main>
    );
  }

  if (status !== 'authenticated' || session?.user.role !== 'CLAIMANT') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Job postings</h1>
        <p role="alert" className="text-error-text">
          Sign in with a claimant account to browse job postings.
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Job postings</h1>
      {loadError && (
        <p role="alert" className="mb-4 text-error-text">
          {loadError}
        </p>
      )}
      {actionError && (
        <p role="alert" className="mb-4 text-error-text">
          {actionError}
        </p>
      )}
      {postings === null && !loadError && <p>Loading…</p>}
      {postings !== null && postings.length === 0 && (
        <p className="text-sm text-text-secondary">No open postings right now.</p>
      )}
      {postings !== null && postings.length > 0 && (
        <ul className="space-y-4">
          {postings.map((p) => (
            <li key={p.id} className="border border-border rounded p-4">
              <p className="font-medium">{p.title}</p>
              <p className="text-sm text-text-secondary mb-2">
                {p.employer.companyName ?? 'An employer'} — {p.location}
              </p>
              <p className="text-sm mb-2">{p.description}</p>
              {appliedIds.has(p.id) ? (
                <p role="status" className="text-status-active-text font-medium">
                  ✓ Applied
                </p>
              ) : (
                <Button onClick={() => handleApply(p.id)}>Apply</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
