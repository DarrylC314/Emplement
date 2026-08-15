'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Fieldset } from '@/components/ui/Fieldset';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

const EVENT_TYPES = [
  { value: 'HIRE', label: 'Hire' },
  { value: 'SEPARATION', label: 'Separation' },
];

type WageRecord = {
  id: string;
  employerName: string;
  workLocation: string;
  jobTitle: string;
  firstDayWorked: string;
  lastDayWorked: string | null;
  wageRate: string;
  hoursPerWeek: string;
  separationReason: string;
  employerVerifiedStatus: 'UNVERIFIED' | 'VERIFIED' | 'DISPUTED';
  employerDisputeNote: string | null;
};

export default function EmployerDashboardPage() {
  const { data: session, status } = useSession();
  const [records, setRecords] = useState<WageRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState('');
  const [disputeNoteError, setDisputeNoteError] = useState<string | undefined>();
  const [actionError, setActionError] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState('');
  const [ssn, setSsn] = useState('');
  const [eventType, setEventType] = useState('HIRE');
  const [eventDate, setEventDate] = useState('');
  const [eventErrors, setEventErrors] = useState<{ id: string; message: string }[]>([]);
  const [eventFieldErrors, setEventFieldErrors] = useState<Record<string, string | undefined>>({});
  const [eventSuccess, setEventSuccess] = useState<string | null>(null);

  async function loadRecords() {
    const res = await fetch('/api/employer/wage-records');
    if (!res.ok) {
      if (res.status === 403) {
        setUnverified(true);
        return;
      }
      setLoadError('We could not load your wage records. Please try again.');
      return;
    }
    setRecords(await res.json());
  }

  useEffect(() => {
    // Guards against fetching (and, in loadRecords' 403 branch, exposing the
    // "verify your company" state) before we know the visitor is actually
    // signed in as an employer — see the render guard below for the same
    // check applied to the page itself.
    if (status !== 'authenticated' || session?.user.role !== 'EMPLOYER') return;
    loadRecords();
  }, [status, session?.user.role]);

  async function handleVerify(id: string) {
    setActionError(null);
    const res = await fetch(`/api/employer/wage-records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      setActionError('We could not record your confirmation. Please try again.');
      return;
    }
    const updated = await res.json();
    setRecords((prev) => prev?.map((r) => (r.id === id ? updated : r)) ?? null);
  }

  async function handleDispute(id: string) {
    if (!disputeNote.trim()) {
      setDisputeNoteError("Enter what's incorrect before submitting.");
      return;
    }
    setDisputeNoteError(undefined);
    setActionError(null);
    const res = await fetch(`/api/employer/wage-records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ disputeNote }),
    });
    if (!res.ok) {
      setActionError('We could not record your dispute. Please try again.');
      return;
    }
    const updated = await res.json();
    setRecords((prev) => prev?.map((r) => (r.id === id ? updated : r)) ?? null);
    setCorrectingId(null);
    setDisputeNote('');
  }

  async function handleReportEvent(e: React.FormEvent) {
    e.preventDefault();
    setEventErrors([]);
    setEventFieldErrors({});
    setEventSuccess(null);
    const res = await fetch('/api/employer/events', {
      method: 'POST',
      body: JSON.stringify({ employeeName, ssn, type: eventType, eventDate }),
    });
    if (res.ok) {
      setEventSuccess('Event reported.');
      setEmployeeName('');
      setSsn('');
      setEventDate('');
      return;
    }
    const body = await res.json().catch(() => null);
    const zodFieldErrors: Record<string, string[]> | undefined = body?.errors?.fieldErrors;
    if (zodFieldErrors) {
      // The Zod schema's field is named `type`, but the form's radio group
      // (a Fieldset, not a TextField) is `eventType` — map the error onto the
      // UI field name so it reaches Fieldset's `error` prop, and anchor the
      // summary link at the Fieldset's own rendered error text (it has no
      // element with id "eventType"/"type" to jump to otherwise).
      const nextFieldErrors: Record<string, string> = {};
      const summary: { id: string; message: string }[] = [];
      for (const [field, messages] of Object.entries(zodFieldErrors)) {
        if (!messages?.[0]) continue;
        const uiField = field === 'type' ? 'eventType' : field;
        nextFieldErrors[uiField] = messages[0];
        summary.push({ id: uiField === 'eventType' ? 'eventType-error' : uiField, message: messages[0] });
      }
      setEventFieldErrors(nextFieldErrors);
      setEventErrors(summary);
      return;
    }
    setEventErrors([{ id: 'employeeName', message: body?.error ?? 'We could not report that event. Please try again.' }]);
  }

  if (status === 'loading') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        Loading…
      </main>
    );
  }

  // Unlike the API routes (which are the real enforcement boundary), this
  // page used to render its full authenticated content — including the SSN
  // input on the event-reporting form — to anyone, session or no session,
  // and only fail once they tried to submit. Mirrors the guard pattern in
  // src/app/staff/dashboard/page.tsx and src/app/claim/dashboard/page.tsx.
  if (status !== 'authenticated' || session?.user.role !== 'EMPLOYER') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Employer dashboard</h1>
        <p role="alert" className="text-error-text">
          Sign in with an employer account to see your dashboard.
        </p>
      </main>
    );
  }

  if (unverified) {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Employer dashboard</h1>
        <p role="alert" className="mb-2 text-error-text">
          You need to verify your company before you can respond to wage records or report events.{' '}
          <Link href="/employer/verify-fein" className="text-link underline">
            Verify your company →
          </Link>
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Employer dashboard</h1>

      <section className="border border-border rounded p-4">
        <h2 className="font-medium mb-2">Wage records on file</h2>
        {loadError && (
          <p role="alert" className="mb-2 text-error-text">
            {loadError}
          </p>
        )}
        {records === null && !loadError && <p>Loading…</p>}
        {records !== null && records.length === 0 && (
          <p className="text-sm text-text-secondary">No wage records are on file for your company yet.</p>
        )}
        {actionError && (
          <p role="alert" className="mb-2 text-error-text">
            {actionError}
          </p>
        )}
        {records !== null && records.length > 0 && (
          <ul className="space-y-4">
            {records.map((r) => (
              <li key={r.id} className="border-t border-border pt-3 text-sm">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 mb-2">
                  <dt>Work location</dt>
                  <dd>{r.workLocation}</dd>
                  <dt>Job title</dt>
                  <dd>{r.jobTitle}</dd>
                  <dt>First day worked</dt>
                  <dd>{new Date(r.firstDayWorked).toLocaleDateString()}</dd>
                  <dt>Last day worked</dt>
                  <dd>{r.lastDayWorked ? new Date(r.lastDayWorked).toLocaleDateString() : '—'}</dd>
                  <dt>Wage rate</dt>
                  <dd>${r.wageRate}/hr</dd>
                  <dt>Hours per week</dt>
                  <dd>{r.hoursPerWeek}</dd>
                  <dt>Separation reason</dt>
                  <dd>{r.separationReason}</dd>
                </dl>
                {r.employerVerifiedStatus === 'VERIFIED' && (
                  <p role="status" className="text-status-active-text font-medium">
                    ✓ Confirmed
                  </p>
                )}
                {r.employerVerifiedStatus === 'DISPUTED' && (
                  <p role="status" className="text-error-text font-medium">
                    ⚠ Disputed: {r.employerDisputeNote}
                  </p>
                )}
                {r.employerVerifiedStatus === 'UNVERIFIED' && correctingId === r.id && (
                  <div>
                    <TextField
                      id={`dispute-${r.id}`}
                      label="What's incorrect?"
                      value={disputeNote}
                      onChange={setDisputeNote}
                      error={disputeNoteError}
                      required
                    />
                    <Button onClick={() => handleDispute(r.id)}>Submit dispute</Button>
                  </div>
                )}
                {r.employerVerifiedStatus === 'UNVERIFIED' && correctingId !== r.id && (
                  <div className="flex gap-3">
                    <Button onClick={() => handleVerify(r.id)}>Confirm</Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setCorrectingId(r.id);
                        setDisputeNote('');
                        setDisputeNoteError(undefined);
                      }}
                    >
                      This isn&apos;t right
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border border-border rounded p-4 mt-6">
        <h2 className="font-medium mb-2">Report a hire or separation</h2>
        {eventSuccess && (
          <p role="status" className="mb-2 text-status-active-text">
            {eventSuccess}
          </p>
        )}
        <ErrorSummary errors={eventErrors} />
        <form onSubmit={handleReportEvent} noValidate>
          <TextField
            id="employeeName"
            label="Employee name"
            value={employeeName}
            onChange={setEmployeeName}
            error={eventFieldErrors.employeeName}
            required
          />
          <TextField
            id="ssn"
            label="Employee Social Security number (123-45-6789)"
            value={ssn}
            onChange={setSsn}
            error={eventFieldErrors.ssn}
            required
          />
          <Fieldset
            legend="Event type"
            name="eventType"
            options={EVENT_TYPES}
            value={eventType}
            onChange={setEventType}
            error={eventFieldErrors.eventType}
          />
          <TextField
            id="eventDate"
            label="Event date"
            type="date"
            value={eventDate}
            onChange={setEventDate}
            error={eventFieldErrors.eventDate}
            required
          />
          <Button type="submit">Report event</Button>
        </form>
      </section>
    </main>
  );
}
