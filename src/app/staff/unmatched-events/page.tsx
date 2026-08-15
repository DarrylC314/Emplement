'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

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
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
