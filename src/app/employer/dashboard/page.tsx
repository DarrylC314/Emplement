'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

type WageRecord = {
  id: string;
  employerName: string;
  workLocation: string;
  jobTitle: string;
  wageRate: string;
  hoursPerWeek: string;
  separationReason: string;
  employerVerifiedStatus: 'UNVERIFIED' | 'VERIFIED' | 'DISPUTED';
  employerDisputeNote: string | null;
};

export default function EmployerDashboardPage() {
  const [records, setRecords] = useState<WageRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  async function loadRecords() {
    const res = await fetch('/api/employer/wage-records');
    if (!res.ok) {
      setLoadError('We could not load your wage records. Please try again.');
      return;
    }
    setRecords(await res.json());
  }

  useEffect(() => {
    loadRecords();
  }, []);

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
    if (!disputeNote.trim()) return;
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
    </main>
  );
}
