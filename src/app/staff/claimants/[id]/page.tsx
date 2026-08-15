'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

type ClaimantDetail = {
  id: string;
  legalName: string | null;
  prefix: 'MR' | 'MRS' | 'MS' | 'DR' | 'MX' | null;
  suffix: 'JR' | 'SR' | 'II' | 'III' | 'IV' | null;
  gender: string | null;
  claims: {
    id: string;
    status: 'ACTIVE' | 'RESTRICTED' | 'DENIED' | 'CLOSED';
    weeklyBenefitAmount: string;
    certifications: {
      id: string;
      weekEndingDate: string;
      autoDecision: string;
      autoDecisionReason: string;
    }[];
    caseNotes: { id: string; note: string; createdAt: string }[];
  }[];
  matchedEmploymentEvents: {
    id: string;
    type: 'HIRE' | 'SEPARATION';
    eventDate: string;
    employer: { companyName: string | null };
  }[];
};

const PREFIX_LABELS: Record<string, string> = {
  MR: 'Mr.',
  MRS: 'Mrs.',
  MS: 'Ms.',
  DR: 'Dr.',
  MX: 'Mx.',
};

const SUFFIX_LABELS: Record<string, string> = {
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

      <section className="border border-border rounded p-4 mb-6">
        <h2 className="font-medium mb-2">Employer-reported events</h2>
        {claimant.matchedEmploymentEvents.length === 0 ? (
          <p className="text-sm text-text-secondary">No employer-reported events on file.</p>
        ) : (
          <ul className="space-y-2">
            {claimant.matchedEmploymentEvents.map((event) => (
              <li key={event.id} className="text-sm border-t border-border pt-2">
                {event.type === 'HIRE' ? 'Hired' : 'Separated'} by{' '}
                {event.employer.companyName ?? 'an employer'} on{' '}
                {new Date(event.eventDate).toLocaleDateString()}
              </li>
            ))}
          </ul>
        )}
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
