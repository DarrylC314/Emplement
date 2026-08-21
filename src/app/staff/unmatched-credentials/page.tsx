'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

type UnmatchedCredential = {
  id: string;
  type: string;
  title: string;
  eventDate: string;
  createdAt: string;
  organization: { companyName: string | null };
};

export default function UnmatchedCredentialsPage() {
  const { data: session, status } = useSession();
  const [credentials, setCredentials] = useState<UnmatchedCredential[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [ssn, setSsn] = useState('');
  const [ssnError, setSsnError] = useState<string | undefined>();
  const [matchNote, setMatchNote] = useState('');
  const [matchNoteError, setMatchNoteError] = useState<string | undefined>();
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissNote, setDismissNote] = useState('');
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function loadCredentials() {
    setLoadError(null);
    const res = await fetch('/api/staff/unmatched-credentials');
    if (!res.ok) {
      setLoadError('We could not load the unmatched credentials queue. Please try again.');
      return;
    }
    setCredentials(await res.json());
  }

  useEffect(() => {
    if (status === 'authenticated' && (session?.user.role === 'CASEWORKER' || session?.user.role === 'ADMIN')) {
      loadCredentials();
    }
  }, [status, session]);

  function resolveCredential(id: string) {
    setCredentials((prev) => prev?.filter((c) => c.id !== id) ?? null);
    setMatchingId(null);
    setSsn('');
    setSsnError(undefined);
    setMatchNote('');
    setMatchNoteError(undefined);
    setDismissingId(null);
    setDismissNote('');
  }

  function openMatch(id: string) {
    setMatchingId(id);
    setSsn('');
    setSsnError(undefined);
    setMatchNote('');
    setMatchNoteError(undefined);
    setActionError(null);
  }

  function cancelMatch() {
    setMatchingId(null);
    setSsn('');
    setSsnError(undefined);
    setMatchNote('');
    setMatchNoteError(undefined);
  }

  function openDismiss(id: string) {
    setDismissingId(id);
    setDismissNote('');
    setActionError(null);
  }

  function cancelDismiss() {
    setDismissingId(null);
    setDismissNote('');
  }

  async function handleRetry(id: string) {
    setActionError(null);
    setPendingId(id);
    try {
      const res = await fetch(`/api/staff/unmatched-credentials/${id}/retry`, { method: 'POST' });
      if (!res.ok) {
        if (res.status === 409) {
          setActionError('Another staff member already resolved this credential.');
          await loadCredentials();
          return;
        }
        setActionError(
          res.status === 404
            ? 'No claimant found for this credential yet.'
            : 'We could not retry this match. Please try again.'
        );
        return;
      }
      resolveCredential(id);
    } finally {
      setPendingId(null);
    }
  }

  async function handleMatch(id: string, e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    setSsnError(undefined);
    setMatchNoteError(undefined);
    setPendingId(id);
    try {
      const res = await fetch(`/api/staff/unmatched-credentials/${id}/match`, {
        method: 'POST',
        body: JSON.stringify({ ssn, note: matchNote }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          setActionError('Another staff member already resolved this credential.');
          await loadCredentials();
          return;
        }
        if (res.status === 400) {
          const body = await res.json().catch(() => null);
          const fieldErrors: Record<string, string[]> | undefined = body?.errors?.fieldErrors;
          if (fieldErrors) {
            setSsnError(fieldErrors.ssn?.[0]);
            setMatchNoteError(fieldErrors.note?.[0]);
            setActionError(fieldErrors.ssn?.[0] ?? fieldErrors.note?.[0] ?? 'We could not record this match. Please try again.');
            return;
          }
        }
        setActionError(
          res.status === 404
            ? 'No claimant found with that SSN.'
            : 'We could not record this match. Please try again.'
        );
        return;
      }
      resolveCredential(id);
    } finally {
      setPendingId(null);
    }
  }

  async function handleDismiss(id: string, e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    setPendingId(id);
    try {
      const res = await fetch(`/api/staff/unmatched-credentials/${id}/dismiss`, {
        method: 'POST',
        body: JSON.stringify({ note: dismissNote }),
      });
      if (!res.ok) {
        if (res.status === 409) {
          setActionError('Another staff member already resolved this credential.');
          await loadCredentials();
          return;
        }
        setActionError('We could not dismiss this credential. Please try again.');
        return;
      }
      resolveCredential(id);
    } finally {
      setPendingId(null);
    }
  }

  if (status === 'loading') {
    return (
      <main id="main-content" className="p-8">
        Loading…
      </main>
    );
  }

  if (status !== 'authenticated' || (session?.user.role !== 'CASEWORKER' && session?.user.role !== 'ADMIN')) {
    return (
      <main id="main-content" className="p-8">
        <p role="alert">You do not have access to this page.</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Unmatched credentials</h1>
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
      {credentials === null && !loadError && <p>Loading…</p>}
      {credentials !== null && credentials.length === 0 && (
        <p className="text-sm text-text-secondary">No unmatched credentials on file.</p>
      )}
      {credentials !== null && credentials.length > 0 && (
        <ul className="space-y-4">
          {credentials.map((credential) => (
            <li key={credential.id} className="border border-border rounded p-4">
              <p className="font-medium">
                {credential.type}: {credential.title}
              </p>
              <p className="text-sm text-text-secondary mb-2">
                Reported by {credential.organization.companyName ?? 'an organization'} — event date{' '}
                {new Date(credential.eventDate).toLocaleDateString()}
              </p>

              {matchingId === credential.id && (
                <form onSubmit={(e) => handleMatch(credential.id, e)} className="mb-2">
                  <TextField
                    id={`match-ssn-${credential.id}`}
                    label="Social Security number (123-45-6789)"
                    value={ssn}
                    onChange={setSsn}
                    error={ssnError}
                    required
                  />
                  <TextField
                    id={`match-note-${credential.id}`}
                    label="Match notes (audit-logged)"
                    value={matchNote}
                    onChange={setMatchNote}
                    error={matchNoteError}
                    required
                  />
                  <div className="flex gap-3">
                    <Button type="submit" disabled={pendingId === credential.id}>
                      Confirm match
                    </Button>
                    <Button type="button" variant="secondary" onClick={cancelMatch} disabled={pendingId === credential.id}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}

              {dismissingId === credential.id && (
                <form onSubmit={(e) => handleDismiss(credential.id, e)} className="mb-2">
                  <TextField
                    id={`dismiss-note-${credential.id}`}
                    label="Reason for dismissal (audit-logged)"
                    value={dismissNote}
                    onChange={setDismissNote}
                    required
                  />
                  <div className="flex gap-3">
                    <Button type="submit" disabled={pendingId === credential.id}>
                      Confirm dismissal
                    </Button>
                    <Button type="button" variant="secondary" onClick={cancelDismiss} disabled={pendingId === credential.id}>
                      Cancel
                    </Button>
                  </div>
                </form>
              )}

              {matchingId !== credential.id && dismissingId !== credential.id && (
                <div className="flex gap-3">
                  <Button onClick={() => handleRetry(credential.id)} disabled={pendingId === credential.id}>
                    Retry
                  </Button>
                  <Button variant="secondary" onClick={() => openMatch(credential.id)} disabled={pendingId === credential.id}>
                    Manual match
                  </Button>
                  <Button variant="secondary" onClick={() => openDismiss(credential.id)} disabled={pendingId === credential.id}>
                    Dismiss
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
