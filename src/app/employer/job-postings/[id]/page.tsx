'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

type Interview = {
  id: string;
  status: 'PROPOSED' | 'CONFIRMED' | 'DECLINED';
  location: string | null;
  confirmedSlot: string | null;
  slots: { id: string; startTime: string }[];
};

type Application = {
  id: string;
  status: 'PENDING' | 'HIRED' | 'REJECTED';
  initiatedBy: 'CANDIDATE' | 'EMPLOYER';
  createdAt: string;
  candidateProfile: {
    headline: string;
    skills: string;
    bio: string | null;
    availability: string;
  };
  interview: Interview | null;
};

export default function JobPostingDetailPage({ params }: { params: { id: string } }) {
  const { data: session, status } = useSession();
  const [applications, setApplications] = useState<Application[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [proposingId, setProposingId] = useState<string | null>(null);
  const [slot1, setSlot1] = useState('');
  const [slot2, setSlot2] = useState('');
  const [slot3, setSlot3] = useState('');
  const [interviewLocation, setInterviewLocation] = useState('');
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [proposeFieldErrors, setProposeFieldErrors] = useState<Record<string, string | undefined>>({});

  async function loadApplications() {
    setLoadError(null);
    const res = await fetch(`/api/employer/job-postings/${params.id}/applications`);
    if (!res.ok) {
      setLoadError('We could not load applications for this posting. Please try again.');
      return;
    }
    setApplications(await res.json());
  }

  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'EMPLOYER') return;
    loadApplications();
  }, [status, session?.user.role]);

  async function handleReject(id: string) {
    setActionError(null);
    setPendingId(id);
    try {
      const res = await fetch(`/api/employer/job-applications/${id}/reject`, { method: 'POST' });
      if (!res.ok) {
        setActionError(
          res.status === 409
            ? 'This application was already resolved.'
            : 'We could not reject this application. Please try again.'
        );
        if (res.status === 409) await loadApplications();
        return;
      }
      await loadApplications();
    } finally {
      setPendingId(null);
    }
  }

  async function handleHire(id: string) {
    setActionError(null);
    setPendingId(id);
    try {
      const res = await fetch(`/api/employer/job-applications/${id}/hire`, { method: 'POST' });
      if (!res.ok) {
        setActionError(
          res.status === 409
            ? 'This application (or its posting) was already resolved.'
            : 'We could not hire this candidate. Please try again.'
        );
        if (res.status === 409) await loadApplications();
        return;
      }
      await loadApplications();
    } finally {
      setPendingId(null);
    }
  }

  async function handlePropose(applicationId: string, e: React.FormEvent) {
    e.preventDefault();
    setProposeError(null);
    setProposeFieldErrors({});
    setPendingId(applicationId);
    try {
      const slots = [slot1, slot2, slot3].filter((s) => s.trim() !== '');
      const res = await fetch(`/api/employer/job-applications/${applicationId}/interview`, {
        method: 'POST',
        body: JSON.stringify({ slots, location: interviewLocation || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const zodFieldErrors: Record<string, string[]> | undefined = body?.errors?.fieldErrors;
        if (zodFieldErrors) {
          const nextFieldErrors: Record<string, string> = {};
          for (const [field, messages] of Object.entries(zodFieldErrors)) {
            if (!messages?.[0]) continue;
            nextFieldErrors[field] = messages[0];
          }
          setProposeFieldErrors(nextFieldErrors);
          return;
        }
        setProposeError(body?.error ?? 'We could not propose interview times. Please try again.');
        return;
      }
      setProposingId(null);
      setSlot1('');
      setSlot2('');
      setSlot3('');
      setInterviewLocation('');
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

  if (status !== 'authenticated' || session?.user.role !== 'EMPLOYER') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Applications</h1>
        <p role="alert" className="text-error-text">
          Sign in with an employer account to review applications.
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Applications</h1>
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
        <p className="text-sm text-text-secondary">No applications for this posting yet.</p>
      )}
      {applications !== null && applications.length > 0 && (
        <ul className="space-y-4">
          {applications.map((a) => (
            <li key={a.id} className="border border-border rounded p-4">
              <p className="font-medium">{a.candidateProfile.headline}</p>
              <p className="text-sm text-text-secondary mb-1">Skills: {a.candidateProfile.skills}</p>
              <p className="text-sm text-text-secondary mb-2">Availability: {a.candidateProfile.availability}</p>
              {a.status === 'PENDING' && (
                <div className="flex gap-3 mb-3">
                  <Button disabled={pendingId === a.id} onClick={() => handleHire(a.id)}>
                    Hire
                  </Button>
                  <Button disabled={pendingId === a.id} onClick={() => handleReject(a.id)} variant="secondary">
                    Reject
                  </Button>
                </div>
              )}
              {a.status === 'HIRED' && (
                <p role="status" className="text-status-active-text font-medium">
                  ✓ Hired
                </p>
              )}
              {a.status === 'REJECTED' && (
                <p role="status" className="text-text-secondary font-medium">
                  — Rejected
                </p>
              )}

              {a.status === 'PENDING' && (!a.interview || a.interview.status === 'DECLINED') && proposingId !== a.id && (
                <Button variant="secondary" onClick={() => setProposingId(a.id)}>
                  {a.interview?.status === 'DECLINED' ? 'Propose new interview times' : 'Propose interview'}
                </Button>
              )}
              {proposingId === a.id && (
                <div className="mt-3 border-t border-border pt-3">
                  {proposeError && (
                    <p role="alert" className="mb-2 text-error-text">
                      {proposeError}
                    </p>
                  )}
                  <form onSubmit={(e) => handlePropose(a.id, e)}>
                    <TextField
                      id={`slot1-${a.id}`}
                      label="Slot 1"
                      type="datetime-local"
                      value={slot1}
                      onChange={setSlot1}
                      error={proposeFieldErrors.slots}
                      required
                    />
                    <TextField
                      id={`slot2-${a.id}`}
                      label="Slot 2"
                      type="datetime-local"
                      value={slot2}
                      onChange={setSlot2}
                      error={undefined}
                      required
                    />
                    <TextField
                      id={`slot3-${a.id}`}
                      label="Slot 3 (optional)"
                      type="datetime-local"
                      value={slot3}
                      onChange={setSlot3}
                      error={undefined}
                    />
                    <TextField
                      id={`location-${a.id}`}
                      label="Location or video link (optional)"
                      value={interviewLocation}
                      onChange={setInterviewLocation}
                      error={proposeFieldErrors.location}
                    />
                    <div className="flex gap-3">
                      <Button type="submit" disabled={pendingId === a.id}>
                        Send proposal
                      </Button>
                      <Button type="button" variant="secondary" onClick={() => setProposingId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                </div>
              )}
              {a.interview?.status === 'PROPOSED' && (
                <p role="status" className="text-sm text-text-secondary mt-2">
                  Interview proposed, waiting for candidate response.
                </p>
              )}
              {a.interview?.status === 'CONFIRMED' && (
                <p role="status" className="text-status-active-text font-medium mt-2">
                  ✓ Interview confirmed: {new Date(a.interview.confirmedSlot!).toLocaleString()}
                  {a.interview.location && ` — ${a.interview.location}`}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
