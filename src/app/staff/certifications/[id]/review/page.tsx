'use client';

import { useState } from 'react';
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

export default function ReviewCertificationPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [action, setAction] = useState('APPROVED');
  const [reason, setReason] = useState('');
  const [newValue, setNewValue] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  // Field-level errors, so an empty required field is reported *on the field*
  // and not only as a generic "please check your entries" summary line. The
  // form keeps noValidate (matching the certification wizard) and does its own
  // validation, because native validation bubbles are neither announced
  // consistently by screen readers nor styled by the design-token layer.
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [newValueError, setNewValueError] = useState<string | undefined>();

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

    // Map server-side field errors back onto the fields where possible.
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
    <main id="main-content" className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Review certification</h1>
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
