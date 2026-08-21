'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

type PendingRequest = {
  id: string;
  credentialType: 'EDUCATION' | 'MILITARY_SERVICE' | 'LAW_ENFORCEMENT' | 'CERTIFICATION' | 'OTHER';
  requestedTitle: string | null;
  authorizedAt: string;
  claimantProfile: { legalName: string | null };
};

// One row per credential type: which detail fields the respond form
// collects, folded into CredentialRecord.details. Keys/labels match the
// per-type Zod schemas in src/lib/validation/credential.ts exactly.
const DETAIL_FIELDS: Record<PendingRequest['credentialType'], { key: string; label: string; required?: boolean }[]> = {
  EDUCATION: [
    { key: 'major', label: 'Major / field of study' },
    { key: 'degreeType', label: 'Degree type' },
    { key: 'graduationDate', label: 'Graduation date' },
  ],
  MILITARY_SERVICE: [
    { key: 'branch', label: 'Branch', required: true },
    { key: 'rank', label: 'Rank' },
    { key: 'dischargeType', label: 'Discharge type' },
  ],
  LAW_ENFORCEMENT: [
    { key: 'agency', label: 'Agency', required: true },
    { key: 'role', label: 'Role' },
  ],
  CERTIFICATION: [
    { key: 'certificationName', label: 'Certification name', required: true },
    { key: 'expirationDate', label: 'Expiration date' },
  ],
  OTHER: [{ key: 'description', label: 'Description', required: true }],
};

export default function EmployerVerificationRequestsPage() {
  const { data: session, status } = useSession();
  const [requests, setRequests] = useState<PendingRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [detailValues, setDetailValues] = useState<Record<string, string>>({});
  const [responseNote, setResponseNote] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  async function loadRequests() {
    const res = await fetch('/api/employer/verification-requests');
    if (!res.ok) {
      setLoadError('We could not load pending verification requests. Please try again.');
      return;
    }
    setRequests(await res.json());
  }

  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'EMPLOYER') return;
    loadRequests();
  }, [status, session?.user.role]);

  function startResponding(request: PendingRequest) {
    setRespondingId(request.id);
    setTitle(request.requestedTitle ?? '');
    setEventDate('');
    setDetailValues({});
    setResponseNote('');
    setErrors([]);
    setFieldErrors({});
  }

  async function submitResponse(request: PendingRequest, confirmed: boolean, e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setFieldErrors({});
    const payload = confirmed
      ? {
          confirmed: true,
          title,
          eventDate,
          details: { schemaVersion: 1, ...detailValues },
        }
      : { confirmed: false, responseNote: responseNote || undefined };

    const res = await fetch(`/api/employer/verification-requests/${request.id}/respond`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      setRespondingId(null);
      await loadRequests();
      return;
    }
    const body = await res.json().catch(() => null);
    const zodFieldErrors: Record<string, string[]> | undefined = body?.errors?.fieldErrors;
    if (zodFieldErrors) {
      const nextFieldErrors: Record<string, string> = {};
      const summary: { id: string; message: string }[] = [];
      for (const [field, messages] of Object.entries(zodFieldErrors)) {
        if (!messages?.[0]) continue;
        nextFieldErrors[field] = messages[0];
        summary.push({ id: field, message: messages[0] });
      }
      setFieldErrors(nextFieldErrors);
      setErrors(summary);
      return;
    }
    setErrors([{ id: 'title', message: body?.error ?? 'We could not submit that response. Please try again.' }]);
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
        <h1 className="text-2xl font-bold mb-4">Verification requests</h1>
        <p role="alert" className="text-error-text">
          Sign in with an employer account to see verification requests.
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Verification requests</h1>
      {loadError && (
        <p role="alert" className="mb-2 text-error-text">
          {loadError}
        </p>
      )}
      {requests === null && !loadError && <p>Loading…</p>}
      {requests !== null && requests.length === 0 && (
        <p className="text-sm text-text-secondary">No pending verification requests right now.</p>
      )}
      {requests !== null && requests.length > 0 && (
        <ul className="space-y-4">
          {requests.map((r) => (
            <li key={r.id} className="border border-border rounded p-4">
              <p className="font-medium">{r.claimantProfile.legalName ?? 'Unnamed claimant'}</p>
              <p className="text-sm text-text-secondary mb-2">
                {r.credentialType} {r.requestedTitle ? `— ${r.requestedTitle}` : ''}
              </p>
              {respondingId !== r.id ? (
                <Button onClick={() => startResponding(r)}>Respond</Button>
              ) : (
                <div>
                  <ErrorSummary errors={errors} />
                  <form onSubmit={(e) => submitResponse(r, true, e)} noValidate className="mb-4">
                    <TextField id="title" label="Title" value={title} onChange={setTitle} error={fieldErrors.title} required />
                    <TextField id="eventDate" label="Date" type="date" value={eventDate} onChange={setEventDate} error={fieldErrors.eventDate} required />
                    {DETAIL_FIELDS[r.credentialType].map((field) => (
                      <TextField
                        key={field.key}
                        id={field.key}
                        label={field.label}
                        value={detailValues[field.key] ?? ''}
                        onChange={(v) => setDetailValues((prev) => ({ ...prev, [field.key]: v }))}
                        required={field.required}
                      />
                    ))}
                    <Button type="submit">Confirm and submit</Button>
                  </form>
                  <form onSubmit={(e) => submitResponse(r, false, e)}>
                    <TextField id="responseNote" label="No record found — note (optional)" value={responseNote} onChange={setResponseNote} />
                    <Button type="submit" variant="secondary">
                      No record found
                    </Button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
