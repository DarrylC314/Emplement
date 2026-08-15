'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

type UnmatchedEvent = {
  id: string;
  type: 'HIRE' | 'SEPARATION';
  employeeName: string;
  eventDate: string;
  createdAt: string;
  employer: { companyName: string | null };
};

export default function UnmatchedEventsPage() {
  const { data: session, status } = useSession();
  const [events, setEvents] = useState<UnmatchedEvent[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [matchingId, setMatchingId] = useState<string | null>(null);
  const [ssn, setSsn] = useState('');
  const [matchNote, setMatchNote] = useState('');

  async function loadEvents() {
    setLoadError(null);
    const res = await fetch('/api/staff/unmatched-events');
    if (!res.ok) {
      setLoadError('We could not load the unmatched events queue. Please try again.');
      return;
    }
    setEvents(await res.json());
  }

  useEffect(() => {
    if (status === 'authenticated' && (session?.user.role === 'CASEWORKER' || session?.user.role === 'ADMIN')) {
      loadEvents();
    }
  }, [status, session]);

  function resolveEvent(id: string) {
    setEvents((prev) => prev?.filter((e) => e.id !== id) ?? null);
    setMatchingId(null);
    setSsn('');
    setMatchNote('');
  }

  async function handleRetry(id: string) {
    setActionError(null);
    const res = await fetch(`/api/staff/unmatched-events/${id}/retry`, { method: 'POST' });
    if (!res.ok) {
      setActionError(
        res.status === 404
          ? 'No claimant found for this event yet.'
          : 'We could not retry this match. Please try again.'
      );
      return;
    }
    resolveEvent(id);
  }

  async function handleMatch(id: string, e: React.FormEvent) {
    e.preventDefault();
    setActionError(null);
    const res = await fetch(`/api/staff/unmatched-events/${id}/match`, {
      method: 'POST',
      body: JSON.stringify({ ssn, note: matchNote }),
    });
    if (!res.ok) {
      setActionError(
        res.status === 404
          ? 'No claimant found with that SSN.'
          : 'We could not record this match. Please try again.'
      );
      return;
    }
    resolveEvent(id);
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
      <h1 className="text-2xl font-bold mb-4">Unmatched employer events</h1>
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
      {events === null && !loadError && <p>Loading…</p>}
      {events !== null && events.length === 0 && (
        <p className="text-sm text-text-secondary">No unmatched events on file.</p>
      )}
      {events !== null && events.length > 0 && (
        <ul className="space-y-4">
          {events.map((event) => (
            <li key={event.id} className="border border-border rounded p-4">
              <p className="font-medium">
                {event.type === 'HIRE' ? 'Hired' : 'Separated'}: {event.employeeName}
              </p>
              <p className="text-sm text-text-secondary mb-2">
                Reported by {event.employer.companyName ?? 'an employer'} — event date{' '}
                {new Date(event.eventDate).toLocaleDateString()}
              </p>

              {matchingId === event.id ? (
                <form onSubmit={(e) => handleMatch(event.id, e)} className="mb-2">
                  <TextField
                    id={`match-ssn-${event.id}`}
                    label="Social Security number (123-45-6789)"
                    value={ssn}
                    onChange={setSsn}
                    required
                  />
                  <TextField
                    id={`match-note-${event.id}`}
                    label="Match notes (audit-logged)"
                    value={matchNote}
                    onChange={setMatchNote}
                    required
                  />
                  <div className="flex gap-3">
                    <Button type="submit">Confirm match</Button>
                    <Button type="button" variant="secondary" onClick={() => setMatchingId(null)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="flex gap-3">
                  <Button onClick={() => handleRetry(event.id)}>Retry</Button>
                  <Button variant="secondary" onClick={() => setMatchingId(event.id)}>
                    Manual match
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
