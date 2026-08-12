'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
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
  const { data: session } = useSession();
  const router = useRouter();
  const [action, setAction] = useState('APPROVED');
  const [reason, setReason] = useState('');
  const [newValue, setNewValue] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    const res = await fetch(`/api/certifications/${params.id}/review`, {
      method: 'POST',
      body: JSON.stringify({
        caseworkerId: session?.user.id,
        action,
        reason,
        newValue: action === 'AMOUNT_ADJUSTED' ? newValue : undefined,
      }),
    });
    if (res.ok) {
      router.push('/staff/dashboard');
      return;
    }
    setErrors([{ id: 'reason', message: 'Please check your entries and try again.' }]);
  }

  return (
    <main id="main-content" className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Review certification</h1>
      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
        <Fieldset legend="Decision" name="action" options={ACTIONS} value={action} onChange={setAction} />
        {action === 'AMOUNT_ADJUSTED' && (
          <TextField id="newValue" label="New weekly benefit amount ($)" type="number" value={newValue} onChange={setNewValue} required />
        )}
        <div className="mb-4">
          <label htmlFor="reason" className="block font-medium mb-1">
            Reason (required for every decision)
          </label>
          <textarea
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded border border-border px-3 py-2"
            required
          />
        </div>
        <Button type="submit">Submit decision</Button>
      </form>
    </main>
  );
}
