'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { TextField } from '@/components/ui/TextField';
import { Fieldset } from '@/components/ui/Fieldset';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

const REASONS = [
  { value: 'LAYOFF', label: 'Laid off / position eliminated' },
  { value: 'FIRED', label: 'Fired' },
  { value: 'QUIT', label: 'Quit' },
  { value: 'CONTRACT_ENDED', label: 'Contract ended' },
  { value: 'OTHER', label: 'Other' },
];

export default function NewClaimPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [employmentHistory, setEmploymentHistory] = useState('');
  const [reasonForSeparation, setReasonForSeparation] = useState('LAYOFF');
  const [benefitYearStart, setBenefitYearStart] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    const res = await fetch('/api/claims', {
      method: 'POST',
      body: JSON.stringify({
        claimantProfileId: session?.user.claimantProfileId,
        employmentHistory,
        reasonForSeparation,
        benefitYearStart,
      }),
    });
    if (res.ok) {
      router.push('/claim/dashboard');
      return;
    }
    setErrors([{ id: 'employmentHistory', message: 'Please check your entries and try again.' }]);
  }

  return (
    <main id="main-content" className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">File a new claim</h1>
      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
        <div className="mb-4">
          <label htmlFor="employmentHistory" className="block font-medium mb-1">
            Employment history
          </label>
          <textarea
            id="employmentHistory"
            className="w-full rounded border border-border px-3 py-2"
            value={employmentHistory}
            onChange={(e) => setEmploymentHistory(e.target.value)}
            required
          />
        </div>
        <Fieldset
          legend="Reason for separation"
          name="reasonForSeparation"
          options={REASONS}
          value={reasonForSeparation}
          onChange={setReasonForSeparation}
        />
        <TextField
          id="benefitYearStart"
          label="Benefit year start date"
          type="date"
          value={benefitYearStart}
          onChange={setBenefitYearStart}
          required
        />
        <Button type="submit">Submit claim</Button>
      </form>
    </main>
  );
}
