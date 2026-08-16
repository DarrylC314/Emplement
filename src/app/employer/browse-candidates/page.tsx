'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import { scoreByTagOverlap } from '@/lib/ranking';
import type { TagCategoryValue } from '@/lib/tagOptions';

type Candidate = {
  id: string;
  headline: string;
  skills: string;
  bio: string | null;
  availability: string;
  tags: TagCategoryValue[];
};

type JobPosting = {
  id: string;
  title: string;
  status: 'OPEN' | 'FILLED';
  tags: TagCategoryValue[];
};

export default function BrowseCandidatesPage() {
  const { data: session, status } = useSession();
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [postings, setPostings] = useState<JobPosting[] | null>(null);
  const [selectedPostingId, setSelectedPostingId] = useState<Record<string, string>>({});
  const [recommendPostingId, setRecommendPostingId] = useState<string>('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reachedOutIds, setReachedOutIds] = useState<Set<string>>(new Set());

  async function loadData() {
    const [candidatesRes, postingsRes] = await Promise.all([
      fetch('/api/employer/candidates'),
      fetch('/api/employer/job-postings'),
    ]);
    if (!candidatesRes.ok || !postingsRes.ok) {
      setLoadError('We could not load candidates. Please try again.');
      return;
    }
    setCandidates(await candidatesRes.json());
    const openPostings = (await postingsRes.json()).filter((p: JobPosting) => p.status === 'OPEN');
    setPostings(openPostings);
    if (openPostings.length === 1) {
      setRecommendPostingId(openPostings[0].id);
    }
  }

  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'EMPLOYER') return;
    loadData();
  }, [status, session?.user.role]);

  async function handleReachOut(candidateProfileId: string) {
    const jobPostingId = selectedPostingId[candidateProfileId];
    if (!jobPostingId) {
      setActionError('Choose a posting before reaching out.');
      return;
    }
    setActionError(null);
    const res = await fetch('/api/employer/job-applications', {
      method: 'POST',
      body: JSON.stringify({ jobPostingId, candidateProfileId }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setActionError(body?.error ?? 'We could not reach out to this candidate. Please try again.');
      return;
    }
    setReachedOutIds((prev) => new Set(prev).add(candidateProfileId));
  }

  if (status === 'loading') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        Loading…
      </main>
    );
  }

  if (status !== 'authenticated' || session?.user.role !== 'EMPLOYER') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Browse candidates</h1>
        <p role="alert" className="text-error-text">
          Sign in with an employer account to browse candidates.
        </p>
      </main>
    );
  }

  const selectedRecommendPosting = postings?.find((p) => p.id === recommendPostingId) ?? null;
  const recommended =
    candidates && selectedRecommendPosting
      ? scoreByTagOverlap(selectedRecommendPosting.tags, candidates)
      : [];

  function renderCandidate(c: Candidate, prefix: string) {
    return (
      <li key={c.id} className="border border-border rounded p-4">
        <p className="font-medium">{c.headline}</p>
        <p className="text-sm text-text-secondary mb-1">Skills: {c.skills}</p>
        <p className="text-sm text-text-secondary mb-2">Availability: {c.availability}</p>
        {c.bio && <p className="text-sm mb-2">{c.bio}</p>}
        {reachedOutIds.has(c.id) ? (
          <p role="status" className="text-status-active-text font-medium">
            ✓ Reached out
          </p>
        ) : postings !== null && postings.length > 0 ? (
          <div className="flex items-end gap-3">
            <div className="mb-4">
              <label htmlFor={`${prefix}-posting-${c.id}`} className="block font-medium text-text-primary mb-1">
                For which posting?
              </label>
              <select
                id={`${prefix}-posting-${c.id}`}
                value={selectedPostingId[c.id] ?? ''}
                onChange={(e) =>
                  setSelectedPostingId((prev) => ({ ...prev, [c.id]: e.target.value }))
                }
                className="w-full rounded border border-border px-3 py-2"
              >
                <option value="">Select a posting</option>
                {postings.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
            <Button onClick={() => handleReachOut(c.id)}>Reach out</Button>
          </div>
        ) : null}
      </li>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Browse candidates</h1>
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
      {postings !== null && postings.length === 0 && (
        <p className="mb-4 text-sm text-text-secondary">
          You need at least one open job posting before you can reach out to a candidate.
        </p>
      )}

      {postings !== null && postings.length > 0 && (
        <div className="mb-6">
          <label htmlFor="recommend-posting" className="block font-medium text-text-primary mb-1">
            Show recommendations for
          </label>
          <select
            id="recommend-posting"
            value={recommendPostingId}
            onChange={(e) => setRecommendPostingId(e.target.value)}
            className="w-full max-w-sm rounded border border-border px-3 py-2"
          >
            <option value="">Select a posting</option>
            {postings.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </div>
      )}

      {recommended.length > 0 && selectedRecommendPosting && (
        <section className="mb-8">
          <h2 className="text-xl font-bold mb-4">Recommended for {selectedRecommendPosting.title}</h2>
          <ul className="space-y-4">{recommended.map((c) => renderCandidate(c, 'rec'))}</ul>
        </section>
      )}

      {candidates === null && !loadError && <p>Loading…</p>}
      {candidates !== null && candidates.length === 0 && (
        <p className="text-sm text-text-secondary">No candidates on the marketplace yet.</p>
      )}
      {candidates !== null && candidates.length > 0 && (
        <ul className="space-y-4">{candidates.map((c) => renderCandidate(c, 'all'))}</ul>
      )}
    </main>
  );
}
