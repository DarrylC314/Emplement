'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
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
  claimantConfirmed: boolean;
  claimantDisputeNote: string | null;
};

export default function WageConfirmationPage() {
  return (
    <Suspense fallback={null}>
      <WageConfirmationForm />
    </Suspense>
  );
}

function WageConfirmationForm() {
  const params = useSearchParams();
  const router = useRouter();
  const claimId = params.get('claimId') ?? '';

  const [records, setRecords] = useState<WageRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [correctingId, setCorrectingId] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState('');

  useEffect(() => {
    if (!claimId) return;
    fetch('/api/wage-lookup', { method: 'POST', body: JSON.stringify({ claimId }) })
      .then((res) => {
        if (!res.ok) throw new Error('lookup failed');
        return res.json();
      })
      .then(setRecords)
      .catch(() => setLoadError('We could not look up your employment records. Please try again.'));
  }, [claimId]);

  async function handleConfirm(id: string) {
    const res = await fetch(`/api/wage-records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ confirmed: true }),
    });
    if (res.ok) {
      const updated = await res.json();
      setRecords((prev) => prev?.map((r) => (r.id === id ? updated : r)) ?? null);
    }
  }

  async function handleDispute(id: string) {
    if (!disputeNote.trim()) return;
    const res = await fetch(`/api/wage-records/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ confirmed: true, disputeNote }),
    });
    if (res.ok) {
      const updated = await res.json();
      setRecords((prev) => prev?.map((r) => (r.id === id ? updated : r)) ?? null);
      setCorrectingId(null);
      setDisputeNote('');
    }
  }

  const allConfirmed = records !== null && records.every((r) => r.claimantConfirmed);

  return (
    <main id="main-content" className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Confirm your employment</h1>

      {loadError && (
        <p role="alert" className="mb-4 text-error-text">
          {loadError}
        </p>
      )}

      {records === null && !loadError && <p>Looking up your employment records…</p>}

      {records !== null && records.length === 0 && (
        <>
          <p className="mb-6 text-text-secondary">
            We didn&apos;t find any employer or wage records on file for you. You can continue.
          </p>
          <Button onClick={() => router.push('/claim/dashboard')}>Continue to my dashboard</Button>
        </>
      )}

      {records !== null && records.length > 0 && (
        <>
          <p className="mb-6 text-text-secondary">
            We found these employers and wage records. Please confirm or correct them.
          </p>
          <ul className="space-y-4 mb-6">
            {records.map((r) => (
              <li key={r.id} className="border border-border rounded p-4">
                <p className="font-medium">{r.employerName}</p>
                <dl className="text-sm text-text-secondary grid grid-cols-2 gap-x-4 gap-y-1 my-2">
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

                {r.claimantConfirmed ? (
                  <p role="status" className="text-status-active-text font-medium">
                    {r.claimantDisputeNote ? 'Correction submitted' : '✓ Confirmed'}
                  </p>
                ) : correctingId === r.id ? (
                  <div>
                    <TextField
                      id={`dispute-${r.id}`}
                      label="What's incorrect?"
                      value={disputeNote}
                      onChange={setDisputeNote}
                      required
                    />
                    <Button onClick={() => handleDispute(r.id)}>Submit correction</Button>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <Button onClick={() => handleConfirm(r.id)}>Confirm</Button>
                    <Button variant="secondary" onClick={() => { setCorrectingId(r.id); setDisputeNote(''); }}>
                      This isn&apos;t right
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <Button disabled={!allConfirmed} onClick={() => router.push('/claim/dashboard')}>
            Continue to my dashboard
          </Button>
        </>
      )}
    </main>
  );
}
