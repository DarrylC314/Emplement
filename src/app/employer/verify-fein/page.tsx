'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

export default function VerifyFeinPage() {
  const router = useRouter();
  const [fein, setFein] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setFieldErrors({});
    const res = await fetch('/api/employer/verify-fein', {
      method: 'POST',
      body: JSON.stringify({ fein, companyName }),
    });
    if (res.ok) {
      router.push('/employer/dashboard');
      return;
    }
    const body = await res.json().catch(() => null);
    const zodFieldErrors: Record<string, string[]> | undefined = body?.errors?.fieldErrors;
    if (zodFieldErrors) {
      const nextFieldErrors: Record<string, string> = {};
      const summary: { id: string; message: string }[] = [];
      for (const [field, messages] of Object.entries(zodFieldErrors)) {
        if (messages?.[0]) {
          nextFieldErrors[field] = messages[0];
          summary.push({ id: field, message: messages[0] });
        }
      }
      setFieldErrors(nextFieldErrors);
      setErrors(summary);
      return;
    }
    setErrors([{ id: 'fein', message: body?.error ?? 'Please check the information you entered and try again.' }]);
  }

  return (
    <main id="main-content" className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Verify your company</h1>
      <p className="mb-4 text-text-secondary">
        Before you can respond to wage records or report employment events, we need to confirm
        your Federal Employer Identification Number (FEIN) and company name.
      </p>
      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          id="fein"
          label="FEIN (12-3456789)"
          value={fein}
          onChange={setFein}
          error={fieldErrors.fein}
          required
        />
        <TextField
          id="companyName"
          label="Company name"
          value={companyName}
          onChange={setCompanyName}
          error={fieldErrors.companyName}
          required
        />
        <Button type="submit">Verify</Button>
      </form>
    </main>
  );
}
