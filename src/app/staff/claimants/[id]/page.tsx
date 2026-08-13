'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';

type ClaimantDetail = {
  id: string;
  legalName: string | null;
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
};

export default function ClaimantCasePage({ params }: { params: { id: string } }) {
  const { data: session } = useSession();
  const [claimant, setClaimant] = useState<ClaimantDetail | null>(null);
  const [note, setNote] = useState('');
  const [revealedSsn, setRevealedSsn] = useState<string | null>(null);
  const [revealReason, setRevealReason] = useState('');
  const [messageSubject, setMessageSubject] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [messageSent, setMessageSent] = useState(false);

  async function loadClaimant() {
    const res = await fetch(`/api/staff/claimants?q=`);
    const all: ClaimantDetail[] = await res.json();
    setClaimant(all.find((c) => c.id === params.id) ?? null);
  }

  useEffect(() => {
    loadClaimant();
  }, [params.id]);

  async function handleAddNote(claimId: string, e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/case-notes', {
      method: 'POST',
      body: JSON.stringify({ claimId, caseworkerId: session?.user.id, note }),
    });
    setNote('');
    loadClaimant();
  }

  async function handleRevealSsn(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/staff/claimants/${params.id}/reveal-ssn`, {
      method: 'POST',
      body: JSON.stringify({ caseworkerId: session?.user.id, reason: revealReason }),
    });
    if (res.ok) {
      const data = await res.json();
      setRevealedSsn(data.ssn);
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    await fetch('/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        claimantProfileId: params.id,
        caseworkerId: session?.user.id,
        subject: messageSubject,
        body: messageBody,
      }),
    });
    setMessageSubject('');
    setMessageBody('');
    setMessageSent(true);
  }

  if (!claimant) return <main id="main-content" className="p-8">Loading…</main>;

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">{claimant.legalName ?? 'Unnamed claimant'}</h1>

      <section className="border border-border rounded p-4 mb-6">
        <h2 className="font-medium mb-2">Social Security number</h2>
        {revealedSsn ? (
          <p className="font-mono">{revealedSsn}</p>
        ) : (
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
