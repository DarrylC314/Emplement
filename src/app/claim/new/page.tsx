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
        reasonForSeparation,
        benefitYearStart,
      }),
    });
    if (res.ok) {
      const claim = await res.json();
      router.push(`/claim/wage-confirmation?claimId=${claim.id}`);
      return;
    }
    setErrors([{ id: 'benefitYearStart', message: 'Please check your entries and try again.' }]);
  }

  return (
    <main id="main-content" className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">File a new claim</h1>
      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
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
