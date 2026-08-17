'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import { formatInterviewTime } from '@/lib/formatInterviewTime';

type Slot = { id: string; startTime: string };
type Interview = {
  id: string;
  status: 'PROPOSED' | 'CONFIRMED' | 'DECLINED';
  location: string | null;
  confirmedSlot: string | null;
  slots: Slot[];
};
type Application = {
  id: string;
  status: 'PENDING' | 'HIRED' | 'REJECTED';
  initiatedBy: 'CANDIDATE' | 'EMPLOYER';
  createdAt: string;
  jobPosting: { title: string; employer: { companyName: string | null } };
  interview: Interview | null;
};

export default function MyApplicationsPage() {
  const { data: session, status } = useSession();
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function loadApplications() {
    const res = await fetch('/api/job-applications');
    if (!res.ok) {
      setLoadError('We could not load your applications. Please try again.');
      return;
    }
    setApplications(await res.json());
  }

  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'CLAIMANT') return;
    loadApplications();
  }, [status, session?.user.role]);

  async function handleAccept(applicationId: string, slotId: string) {
    setActionError(null);
    setPendingId(applicationId);
    try {
      const res = await fetch(`/api/job-applications/${applicationId}/interview/accept`, {
        method: 'POST',
        body: JSON.stringify({ slotId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setActionError(body?.error ?? 'We could not accept that time. Please try again.');
        return;
      }
      await loadApplications();
    } finally {
      setPendingId(null);
    }
  }

  async function handleDecline(applicationId: string) {
    setActionError(null);
    setPendingId(applicationId);
    try {
      const res = await fetch(`/api/job-applications/${applicationId}/interview/decline`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setActionError(body?.error ?? 'We could not decline. Please try again.');
        return;
      }
      await loadApplications();
    } finally {
      setPendingId(null);
    }
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
        <h1 className="text-2xl font-bold mb-4">My applications</h1>
        <p role="alert" className="text-error-text">
          Sign in with a claimant account to see your applications.
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">My applications</h1>
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
      {applications === null && !loadError && <p>Loading…</p>}
      {applications !== null && applications.length === 0 && (
        <p className="text-sm text-text-secondary">You haven&apos;t applied to any postings yet.</p>
      )}
      {applications !== null && applications.length > 0 && (
        <ul className="space-y-4">
          {applications.map((a) => (
            <li key={a.id} className="border border-border rounded p-4">
              <p className="font-medium">{a.jobPosting.title}</p>
              <p className="text-sm text-text-secondary mb-2">
                {a.jobPosting.employer.companyName ?? 'An employer'}
              </p>
              <p className="text-sm text-text-secondary mb-2">
                Applied on {new Date(a.createdAt).toLocaleDateString()}
              </p>
              {a.status === 'PENDING' && (
                <p role="status" className="text-sm mb-2">
                  Status: Pending
                </p>
              )}
              {a.status === 'HIRED' && (
                <p role="status" className="text-status-active-text font-medium mb-2">
                  ✓ Hired
                </p>
              )}
              {a.status === 'REJECTED' && (
                <p role="status" className="text-text-secondary font-medium mb-2">
                  — Not selected
                </p>
              )}

              {a.status === 'PENDING' && a.interview?.status === 'PROPOSED' && (
                <div className="mt-2 border-t border-border pt-2">
                  <p className="text-sm font-medium mb-2">Proposed interview times:</p>
                  <ul className="space-y-2 mb-2">
                    {a.interview.slots.map((s) => (
                      <li key={s.id} className="flex items-center gap-3">
                        <span className="text-sm">{formatInterviewTime(s.startTime)}</span>
                        <Button disabled={pendingId === a.id} onClick={() => handleAccept(a.id, s.id)}>
                          Accept
                        </Button>
                      </li>
                    ))}
                  </ul>
                  {a.interview.location && (
                    <p className="text-sm text-text-secondary mb-2">Location: {a.interview.location}</p>
                  )}
                  <Button disabled={pendingId === a.id} onClick={() => handleDecline(a.id)} variant="secondary">
                    Decline all
                  </Button>
                </div>
              )}
              {a.interview?.status === 'CONFIRMED' && (
                <p role="status" className="text-status-active-text font-medium mt-2">
                  ✓ Interview confirmed: {formatInterviewTime(a.interview.confirmedSlot!)}
                  {a.interview.location && ` — ${a.interview.location}`}
                </p>
              )}
              {a.interview?.status === 'DECLINED' && (
                <p role="status" className="text-text-secondary text-sm mt-2">
                  You declined the proposed interview times.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
