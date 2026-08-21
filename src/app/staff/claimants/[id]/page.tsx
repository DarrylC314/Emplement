'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { Select } from '@/components/ui/Select';
import { OrganizationPicker, type Organization } from '@/components/credentials/OrganizationPicker';

type ClaimantDetail = {
  id: string;
  legalName: string | null;
  prefix: 'MR' | 'MRS' | 'MS' | 'DR' | 'MX' | null;
  suffix: 'JR' | 'SR' | 'II' | 'III' | 'IV' | null;
  gender: string | null;
  claims: {
    id: string;
    status: 'ACTIVE' | 'RESTRICTED' | 'REEVALUATION_REQUIRED' | 'DENIED' | 'CLOSED';
    weeklyBenefitAmount: string;
    certifications: {
      id: string;
      weekEndingDate: string;
      autoDecision: string;
      autoDecisionReason: string;
    }[];
    caseNotes: { id: string; note: string; createdAt: string }[];
  }[];
  timeline: {
    timestamp: string;
    title: string;
    detail: string;
  }[];
  credentialRecords: {
    id: string;
    type: string;
    title: string;
    eventDate: string;
    details: Record<string, unknown>;
    organization: { companyName: string | null };
  }[];
  credentialVerificationRequests: {
    id: string;
    credentialType: string;
    requestedTitle: string | null;
    status: 'PENDING_AUTHORIZATION' | 'AUTHORIZED' | 'CONFIRMED' | 'NO_RECORD_FOUND' | 'DECLINED';
    responseNote: string | null;
    createdAt: string;
    organization: { companyName: string | null };
  }[];
};

const PREFIX_LABELS: Record<NonNullable<ClaimantDetail['prefix']>, string> = {
  MR: 'Mr.',
  MRS: 'Mrs.',
  MS: 'Ms.',
  DR: 'Dr.',
  MX: 'Mx.',
};

const SUFFIX_LABELS: Record<NonNullable<ClaimantDetail['suffix']>, string> = {
  JR: 'Jr.',
  SR: 'Sr.',
  II: 'II',
  III: 'III',
  IV: 'IV',
};

function formatClaimantName(claimant: ClaimantDetail): string {
  const name = claimant.legalName ?? 'Unnamed claimant';
  const withPrefix = claimant.prefix ? `${PREFIX_LABELS[claimant.prefix]} ${name}` : name;
  return claimant.suffix ? `${withPrefix}, ${SUFFIX_LABELS[claimant.suffix]}` : withPrefix;
}

export default function ClaimantCasePage({ params }: { params: { id: string } }) {
  const [claimant, setClaimant] = useState<ClaimantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [revealedSsn, setRevealedSsn] = useState<string | null>(null);
  const [revealReason, setRevealReason] = useState('');
  const [revealError, setRevealError] = useState<string | null>(null);
  const [messageSubject, setMessageSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [messageSent, setMessageSent] = useState(false);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [requestOrganization, setRequestOrganization] = useState<Organization | null>(null);
  const [requestCredentialType, setRequestCredentialType] = useState('');
  const [requestTitle, setRequestTitle] = useState('');
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSuccess, setRequestSuccess] = useState(false);

  // Fetches the single claimant by id. Previously this called the *search*
  // route (`?q=`), which returns at most 25 unordered rows — claimants outside
  // that window were unreachable from their own case page.
  const loadClaimant = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`/api/staff/claimants/${params.id}`);
      if (!res.ok) {
        // The route returns real 401/403s now, whose bodies are `{ error }`,
        // not a claimant — passing that straight into state would crash the
        // render instead of telling the caseworker what happened.
        setClaimant(null);
        setLoadError(
          res.status === 404
            ? 'We could not find that claimant.'
            : 'We could not load this case. You may not have access, or your session may have expired.'
        );
        return;
      }
      setClaimant(await res.json());
    } catch {
      setClaimant(null);
      setLoadError('We could not load this case. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    loadClaimant();
  }, [loadClaimant]);

  // Note on every handler below: no `caseworkerId` is sent. The server derives
  // the acting caseworker from the verified session and ignores client-supplied
  // attribution; sending it would read as if client-side attribution still
  // worked and invites a future regression that trusts it again.
  async function handleAddNote(claimId: string, e: React.FormEvent) {
    e.preventDefault();
    setNoteError(null);
    const res = await fetch('/api/case-notes', {
      method: 'POST',
      body: JSON.stringify({ claimId, note }),
    });
    if (!res.ok) {
      setNoteError('We could not save that case note. Please try again.');
      return;
    }
    setNote('');
    loadClaimant();
  }

  async function handleRevealSsn(e: React.FormEvent) {
    e.preventDefault();
    setRevealError(null);
    const res = await fetch(`/api/staff/claimants/${params.id}/reveal-ssn`, {
      method: 'POST',
      body: JSON.stringify({ reason: revealReason }),
    });
    if (!res.ok) {
      setRevealError(
        res.status === 404
          ? 'There is no Social Security number on file for this claimant.'
          : 'We could not reveal the Social Security number. Please try again.'
      );
      return;
    }
    const data = await res.json();
    setRevealedSsn(data.ssn);
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    setMessageError(null);
    setMessageSent(false);
    const res = await fetch('/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        claimantProfileId: params.id,
        subject: messageSubject,
        body: messageBody,
      }),
    });
    if (!res.ok) {
      setMessageError('We could not send that message. Please try again.');
      return;
    }
    setMessageSubject('');
    setMessageBody('');
    setMessageSent(true);
  }

  async function handleRequestVerification(e: React.FormEvent) {
    e.preventDefault();
    setRequestError(null);
    setRequestSuccess(false);
    if (!requestOrganization || !requestCredentialType) {
      setRequestError('Select an organization and a credential type.');
      return;
    }
    const res = await fetch('/api/verification-requests', {
      method: 'POST',
      body: JSON.stringify({
        claimantProfileId: params.id,
        organizationId: requestOrganization.id,
        credentialType: requestCredentialType,
        requestedTitle: requestTitle || undefined,
      }),
    });
    if (!res.ok) {
      setRequestError('We could not send that request. Please try again.');
      return;
    }
    setRequestOrganization(null);
    setRequestCredentialType('');
    setRequestTitle('');
    setRequestSuccess(true);
    loadClaimant();
  }

  if (loading) {
    return (
      <main id="main-content" className="p-8">
        Loading…
      </main>
    );
  }

  if (loadError || !claimant) {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Case unavailable</h1>
        <p role="alert" className="text-error-text">
          {loadError ?? 'We could not find that claimant.'}
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-1">{formatClaimantName(claimant)}</h1>
      <div className="mb-4">
        {claimant.gender && <p className="text-text-secondary">Gender: {claimant.gender}</p>}
      </div>

      <section className="border border-border rounded p-4 mb-6">
        <h2 className="font-medium mb-2">Social Security number</h2>
        {revealedSsn ? (
          <p className="font-mono">{revealedSsn}</p>
        ) : (
          <>
            {revealError && (
              <p role="alert" className="mb-2 text-error-text">
                {revealError}
              </p>
            )}
            <form onSubmit={handleRevealSsn} className="flex items-end gap-3">
              <TextField
                id="reveal-reason"
                label="Reason for reveal (audit-logged)"
                value={revealReason}
                onChange={setRevealReason}
                required
              />
              <Button type="submit">Reveal SSN</Button>
            </form>
          </>
        )}
      </section>

      <section className="border border-border rounded p-4 mb-6 bg-surface-alt">
        <h2 className="font-medium mb-3">Case timeline</h2>
        {claimant.timeline.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No application, interview, or employment activity on file yet.
          </p>
        ) : (
          <ol className="space-y-4">
            {claimant.timeline.map((event, i) => (
              <li key={`${event.timestamp}-${i}`} className="flex gap-3">
                <div className="flex flex-col items-center pt-1" aria-hidden="true">
                  <span className="w-2.5 h-2.5 rounded-full bg-primary shrink-0" />
                  {i < claimant.timeline.length - 1 && <span className="w-px flex-1 bg-border mt-1" />}
                </div>
                <div className="pb-1">
                  <p className="font-medium">{event.title}</p>
                  <p className="text-sm text-text-secondary">{event.detail}</p>
                  <p className="text-xs text-text-secondary">{new Date(event.timestamp).toLocaleDateString()}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="border border-border rounded p-4 mb-6">
        <h2 className="font-medium mb-3">Verified credentials</h2>
        {claimant.credentialRecords.length === 0 ? (
          <p className="text-sm text-text-secondary mb-4">No verified credentials on file yet.</p>
        ) : (
          <ul className="space-y-2 mb-4">
            {claimant.credentialRecords.map((c) => (
              <li key={c.id} className="text-sm border-t border-border pt-2">
                <p className="font-medium">{c.title}</p>
                <p className="text-text-secondary">
                  {/* Organization name in its own element so it has an exact,
                      isolated accessible text match distinct from the
                      em-dash-joined date next to it (see
                      tests/e2e/credential-verification.spec.ts, which asserts
                      on the organization name with { exact: true }). */}
                  <span>{c.organization.companyName}</span> — {new Date(c.eventDate).toLocaleDateString()}
                </p>
              </li>
            ))}
          </ul>
        )}

        {claimant.credentialVerificationRequests.length > 0 && (
          <>
            <h3 className="font-medium mb-2 text-sm">Requests</h3>
            <ul className="space-y-2 mb-4">
              {claimant.credentialVerificationRequests.map((r) => (
                <li key={r.id} className="text-sm border-t border-border pt-2">
                  {r.organization.companyName} — {r.requestedTitle ?? r.credentialType} — {r.status}
                  {r.status === 'NO_RECORD_FOUND' && r.responseNote && <span> ({r.responseNote})</span>}
                </li>
              ))}
            </ul>
          </>
        )}

        <h3 className="font-medium mb-2 text-sm">Request a new verification</h3>
        {requestSuccess && <p role="status" className="mb-2 text-status-active-text">Request sent.</p>}
        {requestError && (
          <p role="alert" className="mb-2 text-error-text">
            {requestError}
          </p>
        )}
        <form onSubmit={handleRequestVerification} noValidate>
          <OrganizationPicker selectedOrganization={requestOrganization} onSelect={setRequestOrganization} />
          <Select
            id="requestCredentialType"
            label="Credential type"
            value={requestCredentialType}
            onChange={setRequestCredentialType}
            options={[
              { value: 'EDUCATION', label: 'Education' },
              { value: 'MILITARY_SERVICE', label: 'Military service' },
              { value: 'LAW_ENFORCEMENT', label: 'Law enforcement' },
              { value: 'CERTIFICATION', label: 'Certification' },
              { value: 'OTHER', label: 'Other' },
            ]}
            required
          />
          <TextField
            id="requestTitle"
            label="What are you asking them to confirm? (optional)"
            value={requestTitle}
            onChange={setRequestTitle}
          />
          <Button type="submit">Send request</Button>
        </form>
      </section>

      {claimant.claims.map((claim) => (
        <section key={claim.id} className="border border-border rounded p-4 mb-6">
          <div className="flex items-center gap-3 mb-3">
            <StatusBadge status={claim.status} />
            <span>Weekly benefit: ${claim.weeklyBenefitAmount}</span>
          </div>

          <h2 className="font-medium mb-2">Certifications</h2>
          <ul className="space-y-2 mb-4">
            {claim.certifications.map((c) => (
              <li key={c.id} className="text-sm">
                {new Date(c.weekEndingDate).toLocaleDateString()} — {c.autoDecision}:{' '}
                {c.autoDecisionReason}{' '}
                <a href={`/staff/certifications/${c.id}/review`} className="text-link underline">
                  Review
                </a>
              </li>
            ))}
          </ul>

          <h2 className="font-medium mb-2">Case notes</h2>
          <ul className="space-y-2 mb-3">
            {claim.caseNotes.map((n) => (
              <li key={n.id} className="text-sm border-t border-border pt-2">
                {n.note}
                <span className="block text-text-secondary">
                  {new Date(n.createdAt).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
          {noteError && (
            <p role="alert" className="mb-2 text-error-text">
              {noteError}
            </p>
          )}
          <form onSubmit={(e) => handleAddNote(claim.id, e)}>
            <label htmlFor={`note-${claim.id}`} className="block font-medium mb-1">
              Add a case note
            </label>
            <textarea
              id={`note-${claim.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full rounded border border-border px-3 py-2 mb-2"
            />
            <Button type="submit">Add note</Button>
          </form>
        </section>
      ))}

      <section className="border border-border rounded p-4">
        <h2 className="font-medium mb-2">Send a message to this claimant</h2>
        {messageSent && <p role="status" className="mb-2 text-status-active-text">Message sent.</p>}
        {messageError && (
          <p role="alert" className="mb-2 text-error-text">
            {messageError}
          </p>
        )}
        <form onSubmit={handleSendMessage}>
          <TextField id="message-subject" label="Subject" value={messageSubject} onChange={setMessageSubject} required />
          <div className="mb-4">
            <label htmlFor="message-body" className="block font-medium mb-1">
              Message
            </label>
            <textarea
              id="message-body"
              value={messageBody}
              onChange={(e) => setMessageBody(e.target.value)}
              className="w-full rounded border border-border px-3 py-2"
              required
            />
          </div>
          <Button type="submit">Send message</Button>
        </form>
      </section>
    </main>
  );
}
