'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Fieldset } from '@/components/ui/Fieldset';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

const ACTIONS = [
  { value: 'APPROVED', label: 'Approve' },
  { value: 'DENIED', label: 'Deny' },
  { value: 'FLAGGED_FOR_FRAUD', label: 'Flag for fraud investigation' },
  { value: 'AMOUNT_ADJUSTED', label: 'Adjust weekly benefit amount' },
];

type ReviewEvidence = {
  certification: {
    id: string;
    weekEndingDate: string;
    ableAndAvailable: boolean;
    workedThisWeek: boolean;
    earnings: string;
    refusedWork: boolean;
    autoDecision: string;
    autoDecisionReason: string;
    autoDecisionRuleId: string | null;
    autoDecisionThreshold: string | null;
    autoDecisionActualValue: string | null;
  };
  jobSearchActivities: {
    id: string;
    employerName: string;
    contactMethod: string;
    contactDate: string;
    position: string;
  }[];
  claim: { id: string; status: string; weeklyBenefitAmount: string; claimantName: string | null };
  certificationHistory: {
    id: string;
    weekEndingDate: string;
    autoDecision: string;
    autoDecisionReason: string;
  }[];
  caseNotes: { id: string; note: string; createdAt: string }[];
  wageRecords: {
    id: string;
    employerName: string;
    fein: string;
    workLocation: string;
    jobTitle: string;
    firstDayWorked: string;
    lastDayWorked: string | null;
    wageRate: string;
    hoursPerWeek: string;
    separationReason: string;
    recallDate: string | null;
    employerVerifiedStatus: string;
    source: string;
    claimantConfirmed: boolean;
    claimantDisputeNote: string | null;
  }[];
  documents: { id: string; filename: string; uploadedAt: string }[];
  conflicts: { wageRecordId: string; message: string }[];
  paymentPreview: { approve: string; deny: string };
};

export default function ReviewCertificationPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [evidence, setEvidence] = useState<ReviewEvidence | null>(null);
  const [evidenceError, setEvidenceError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [action, setAction] = useState('APPROVED');
  const [reason, setReason] = useState('');
  const [newValue, setNewValue] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [newValueError, setNewValueError] = useState<string | undefined>();

  async function loadEvidence() {
    const res = await fetch(`/api/certifications/${params.id}/review`);
    if (!res.ok) {
      setEvidenceError('We could not load the evidence for this certification.');
      return;
    }
    setEvidence(await res.json());
  }

  useEffect(() => {
    loadEvidence();
    // Loaded once per certification id; loadEvidence is stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setUploadError(null);
    if (!evidence) return;
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem('file') as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('claimId', evidence.claim.id);
    formData.append('weeklyCertificationId', evidence.certification.id);

    setUploading(true);
    const res = await fetch('/api/documents', { method: 'POST', body: formData });
    setUploading(false);
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      setUploadError(body?.error ?? 'We could not upload that file. Please try again.');
      return;
    }
    form.reset();
    loadEvidence();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setReasonError(undefined);
    setNewValueError(undefined);

    const summary: { id: string; message: string }[] = [];
    if (!reason.trim()) {
      const message = 'Enter a reason for this decision.';
      setReasonError(message);
      summary.push({ id: 'reason', message });
    }
    if (action === 'AMOUNT_ADJUSTED' && !(Number(newValue) > 0)) {
      const message = 'Enter the new weekly benefit amount as a number greater than zero.';
      setNewValueError(message);
      summary.push({ id: 'newValue', message });
    }
    if (summary.length > 0) {
      setErrors(summary);
      return;
    }

    // No caseworkerId is sent: the server derives the acting caseworker from
    // the verified session and ignores client-supplied attribution.
    const res = await fetch(`/api/certifications/${params.id}/review`, {
      method: 'POST',
      body: JSON.stringify({
        action,
        reason,
        newValue: action === 'AMOUNT_ADJUSTED' ? newValue : undefined,
      }),
    });
    if (res.ok) {
      router.push('/staff/dashboard');
      return;
    }

    const body = await res.json().catch(() => null);
    const fieldErrors: Record<string, string[]> | undefined = body?.errors?.fieldErrors;
    if (fieldErrors?.reason?.[0]) {
      setReasonError(fieldErrors.reason[0]);
      setErrors([{ id: 'reason', message: fieldErrors.reason[0] }]);
      return;
    }
    if (fieldErrors?.newValue?.[0]) {
      setNewValueError(fieldErrors.newValue[0]);
      setErrors([{ id: 'newValue', message: fieldErrors.newValue[0] }]);
      return;
    }
    setErrors([
      {
        id: 'reason',
        message: body?.error ?? 'We could not record that decision. Please try again.',
      },
    ]);
  }

  const reasonErrorId = 'reason-error';

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Review certification</h1>

      {evidenceError && (
        <p role="alert" className="mb-4 text-error-text">
          {evidenceError}
        </p>
      )}
      {!evidence && !evidenceError && <p className="mb-4">Loading evidence…</p>}

      {evidence && (
        <>
          <section className="border border-border rounded p-4 mb-4">
            <h2 className="font-medium mb-2">
              Certification answers — week ending{' '}
              {new Date(evidence.certification.weekEndingDate).toLocaleDateString()}
            </h2>
            <dl className="text-sm grid grid-cols-2 gap-x-4 gap-y-1">
              <dt>Able and available</dt>
              <dd>{evidence.certification.ableAndAvailable ? 'Yes' : 'No'}</dd>
              <dt>Worked this week</dt>
              <dd>{evidence.certification.workedThisWeek ? 'Yes' : 'No'}</dd>
              <dt>Earnings</dt>
              <dd>${evidence.certification.earnings}</dd>
              <dt>Refused work</dt>
              <dd>{evidence.certification.refusedWork ? 'Yes' : 'No'}</dd>
            </dl>
          </section>

          <section className="border border-border rounded p-4 mb-4">
            <h2 className="font-medium mb-2">Job-search contacts this week</h2>
            {evidence.jobSearchActivities.length === 0 ? (
              <p className="text-sm text-text-secondary">No job-search contacts were logged.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {evidence.jobSearchActivities.map((a) => (
                  <li key={a.id}>
                    {a.employerName} — {a.position} ({a.contactMethod},{' '}
                    {new Date(a.contactDate).toLocaleDateString()})
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border border-border rounded p-4 mb-4">
            <h2 className="font-medium mb-2">Why this was flagged</h2>
            {evidence.certification.autoDecisionRuleId ? (
              <p className="text-sm">
                <strong>{evidence.certification.autoDecisionRuleId.replace(/_/g, ' ')}</strong>
                {evidence.certification.autoDecisionThreshold &&
                  evidence.certification.autoDecisionActualValue && (
                    <>
                      : required {evidence.certification.autoDecisionThreshold}, claimant reported{' '}
                      {evidence.certification.autoDecisionActualValue}
                    </>
                  )}
              </p>
            ) : (
              <p className="text-sm">{evidence.certification.autoDecisionReason}</p>
            )}
          </section>

          <section className="border border-border rounded p-4 mb-4">
            <h2 className="font-medium mb-2">Employer and wage records</h2>
            {evidence.wageRecords.length === 0 ? (
              <p className="text-sm text-text-secondary">No wage records were found for this claim.</p>
            ) : (
              <ul className="space-y-3">
                {evidence.wageRecords.map((w) => {
                  const conflict = evidence.conflicts.find((c) => c.wageRecordId === w.id);
                  return (
                    <li key={w.id} className="border-t border-border pt-2 text-sm">
                      <p className="font-medium">
                        {w.employerName} (FEIN {w.fein})
                      </p>
                      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 my-1">
                        <dt>Work location</dt>
                        <dd>{w.workLocation}</dd>
                        <dt>Job title</dt>
                        <dd>{w.jobTitle}</dd>
                        <dt>First/last day worked</dt>
                        <dd>
                          {new Date(w.firstDayWorked).toLocaleDateString()} –{' '}
                          {w.lastDayWorked ? new Date(w.lastDayWorked).toLocaleDateString() : 'ongoing'}
                        </dd>
                        <dt>Wage rate</dt>
                        <dd>
                          ${w.wageRate}/hr, {w.hoursPerWeek} hrs/week
                        </dd>
                        <dt>Separation reason</dt>
                        <dd>{w.separationReason}</dd>
                        <dt>Recall date</dt>
                        <dd>{w.recallDate ? new Date(w.recallDate).toLocaleDateString() : 'None on file'}</dd>
                        <dt>Employer-verified status</dt>
                        <dd>Unverified — no employer response system available yet</dd>
                        <dt>Source</dt>
                        <dd>{w.source}</dd>
                      </dl>
                      {w.claimantDisputeNote && (
                        <p role="alert" className="text-error-text">
                          ⚠ Claimant dispute: {w.claimantDisputeNote}
                        </p>
                      )}
                      {conflict && (
                        <p role="alert" className="text-error-text">
                          ⚠ Conflict: {conflict.message}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="border border-border rounded p-4 mb-4">
            <h2 className="font-medium mb-2">Certification history</h2>
            {evidence.certificationHistory.length === 0 ? (
              <p className="text-sm text-text-secondary">No prior certifications on this claim.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {evidence.certificationHistory.map((c) => (
                  <li key={c.id}>
                    {new Date(c.weekEndingDate).toLocaleDateString()} — {c.autoDecision}:{' '}
                    {c.autoDecisionReason}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border border-border rounded p-4 mb-4">
            <h2 className="font-medium mb-2">Case notes</h2>
            {evidence.caseNotes.length === 0 ? (
              <p className="text-sm text-text-secondary">No case notes on this claim.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {evidence.caseNotes.map((n) => (
                  <li key={n.id}>
                    {n.note}
                    <span className="block text-text-secondary">
                      {new Date(n.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border border-border rounded p-4 mb-4">
            <h2 className="font-medium mb-2">Payment consequence</h2>
            <p className="text-sm">
              Approving records a ${evidence.paymentPreview.approve} payment for this week. Denying or
              flagging for fraud withholds it.
            </p>
          </section>

          <section className="border border-border rounded p-4 mb-6">
            <h2 className="font-medium mb-2">Supporting documents</h2>
            {evidence.documents.length === 0 ? (
              <p className="text-sm text-text-secondary mb-3">No documents submitted.</p>
            ) : (
              <ul className="space-y-1 text-sm mb-3">
                {evidence.documents.map((d) => (
                  <li key={d.id}>
                    <a href={`/api/documents/${d.id}`} className="text-link underline">
                      {d.filename}
                    </a>{' '}
                    <span className="text-text-secondary">
                      ({new Date(d.uploadedAt).toLocaleDateString()})
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {uploadError && (
              <p role="alert" className="mb-2 text-error-text">
                {uploadError}
              </p>
            )}
            <form onSubmit={handleUpload}>
              <label htmlFor="file" className="block font-medium mb-1">
                Attach a supporting document (PDF, PNG, or JPEG, up to 10MB)
              </label>
              <input id="file" name="file" type="file" accept=".pdf,.png,.jpg,.jpeg" className="mb-2" />
              <Button type="submit" disabled={uploading}>
                {uploading ? 'Uploading…' : 'Upload'}
              </Button>
            </form>
          </section>
        </>
      )}

      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
        <Fieldset legend="Decision" name="action" options={ACTIONS} value={action} onChange={setAction} />
        {action === 'AMOUNT_ADJUSTED' && (
          <TextField
            id="newValue"
            label="New weekly benefit amount ($)"
            type="number"
            value={newValue}
            onChange={setNewValue}
            error={newValueError}
            required
          />
        )}
        <div className="mb-4">
          <label htmlFor="reason" className="block font-medium mb-1">
            Reason (required for every decision)
          </label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
            aria-invalid={Boolean(reasonError)}
            aria-describedby={reasonError ? reasonErrorId : undefined}
            className={`w-full rounded border px-3 py-2 ${
              reasonError ? 'border-error-border' : 'border-border'
            }`}
          />
          {reasonError && (
            <p id={reasonErrorId} className="mt-1 text-error-text text-sm" role="alert">
              {reasonError}
            </p>
          )}
        </div>
        <Button type="submit">Submit decision</Button>
      </form>
    </main>
  );
}
