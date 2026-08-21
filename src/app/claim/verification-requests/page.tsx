'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { TextField } from '@/components/ui/TextField';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';
import { OrganizationPicker, type Organization } from '@/components/credentials/OrganizationPicker';

const CREDENTIAL_TYPE_OPTIONS = [
  { value: 'EDUCATION', label: 'Education' },
  { value: 'MILITARY_SERVICE', label: 'Military service' },
  { value: 'LAW_ENFORCEMENT', label: 'Law enforcement' },
  { value: 'CERTIFICATION', label: 'Certification' },
  { value: 'OTHER', label: 'Other' },
];

type VerificationRequest = {
  id: string;
  credentialType: string;
  requestedTitle: string | null;
  status: 'PENDING_AUTHORIZATION' | 'AUTHORIZED' | 'CONFIRMED' | 'NO_RECORD_FOUND' | 'DECLINED';
  responseNote: string | null;
  createdAt: string;
  organization: { companyName: string | null };
};

const STATUS_LABELS: Record<VerificationRequest['status'], string> = {
  PENDING_AUTHORIZATION: 'Awaiting your authorization',
  AUTHORIZED: 'Sent — awaiting response',
  CONFIRMED: 'Confirmed',
  NO_RECORD_FOUND: 'No record found',
  DECLINED: 'Declined',
};

export default function VerificationRequestsPage() {
  const { data: session, status } = useSession();
  const [requests, setRequests] = useState<VerificationRequest[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [credentialType, setCredentialType] = useState('');
  const [requestedTitle, setRequestedTitle] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function loadRequests() {
    const res = await fetch('/api/verification-requests');
    if (!res.ok) {
      setLoadError('We could not load your verification requests. Please try again.');
      return;
    }
    setRequests(await res.json());
  }

  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'CLAIMANT') return;
    loadRequests();
  }, [status, session?.user.role]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setFieldErrors({});
    if (!organization) {
      setFieldErrors({ 'organization-search': 'Select an organization from the search results.' });
      return;
    }
    const res = await fetch('/api/verification-requests', {
      method: 'POST',
      body: JSON.stringify({ organizationId: organization.id, credentialType, requestedTitle: requestedTitle || undefined }),
    });
    if (res.ok) {
      setOrganization(null);
      setCredentialType('');
      setRequestedTitle('');
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
    setErrors([{ id: 'organization-search', message: body?.error ?? 'We could not submit that request. Please try again.' }]);
  }

  async function handleAuthorize(id: string) {
    setActionError(null);
    setPendingId(id);
    const res = await fetch(`/api/verification-requests/${id}/authorize`, { method: 'POST' });
    setPendingId(null);
    if (!res.ok) {
      setActionError('We could not authorize that request. Please try again.');
      return;
    }
    await loadRequests();
  }

  async function handleDecline(id: string) {
    setActionError(null);
    setPendingId(id);
    const res = await fetch(`/api/verification-requests/${id}/decline`, { method: 'POST' });
    setPendingId(null);
    if (!res.ok) {
      setActionError('We could not decline that request. Please try again.');
      return;
    }
    await loadRequests();
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
        <h1 className="text-2xl font-bold mb-4">Verification requests</h1>
        <p role="alert" className="text-error-text">
          Sign in with a claimant account to see your verification requests.
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Verification requests</h1>

      <section className="border border-border rounded p-4 mb-6">
        <h2 className="font-medium mb-2">Request a new verification</h2>
        <p className="text-sm text-text-secondary mb-3">
          Ask an organization already in this system — an employer, school, licensing body, or other
          verified organization — to confirm a credential on your behalf.
        </p>
        <ErrorSummary errors={errors} />
        <form onSubmit={handleSubmit} noValidate>
          <OrganizationPicker selectedOrganization={organization} onSelect={setOrganization} error={fieldErrors['organization-search']} />
          <Select
            id="credentialType"
            label="Credential type"
            value={credentialType}
            onChange={setCredentialType}
            options={CREDENTIAL_TYPE_OPTIONS}
            error={fieldErrors.credentialType}
            required
          />
          <TextField
            id="requestedTitle"
            label="What are you asking them to confirm? (optional)"
            value={requestedTitle}
            onChange={setRequestedTitle}
            error={fieldErrors.requestedTitle}
          />
          <Button type="submit">Send request</Button>
        </form>
      </section>

      <section className="border border-border rounded p-4">
        <h2 className="font-medium mb-2">Your requests</h2>
        {loadError && (
          <p role="alert" className="mb-2 text-error-text">
            {loadError}
          </p>
        )}
        {actionError && (
          <p role="alert" className="mb-2 text-error-text">
            {actionError}
          </p>
        )}
        {requests === null && !loadError && <p>Loading…</p>}
        {requests !== null && requests.length === 0 && (
          <p className="text-sm text-text-secondary">You haven&apos;t requested any verifications yet.</p>
        )}
        {requests !== null && requests.length > 0 && (
          <ul className="space-y-3">
            {requests.map((r) => (
              <li key={r.id} className="border-t border-border pt-3 text-sm">
                <p className="font-medium">
                  {r.organization.companyName} — {r.requestedTitle ?? r.credentialType}
                </p>
                <p className="text-text-secondary mb-2">{STATUS_LABELS[r.status]}</p>
                {r.status === 'NO_RECORD_FOUND' && r.responseNote && (
                  <p className="text-text-secondary mb-2">Note from organization: {r.responseNote}</p>
                )}
                {r.status === 'PENDING_AUTHORIZATION' && (
                  <div className="flex gap-3">
                    <Button onClick={() => handleAuthorize(r.id)} disabled={pendingId === r.id}>
                      Authorize
                    </Button>
                    <Button variant="secondary" onClick={() => handleDecline(r.id)} disabled={pendingId === r.id}>
                      Decline
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
