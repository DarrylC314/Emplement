'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

export default function IdentityVerificationCallbackPage() {
  const { data: session } = useSession();
  const router = useRouter();
  const [form, setForm] = useState({
    legalName: '',
    dateOfBirth: '',
    ssn: '',
    phone: '',
    mailingAddress: '',
  });
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  // Per-field errors, mapped from the API's Zod fieldErrors, so a screen-
  // reader/keyboard user is told *which* field is wrong (and gets it marked
  // aria-invalid, via TextField's error prop) instead of always being pointed
  // at "legalName" regardless of what actually failed — e.g. a malformed SSN
  // previously surfaced as "check the information you entered" anchored to
  // the legal name field, which is both unhelpful and inaccurate.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setFieldErrors({});
    const res = await fetch('/api/identity-verification/callback', {
      method: 'POST',
      body: JSON.stringify({ claimantProfileId: session?.user.claimantProfileId, ...form }),
    });
    if (res.ok) {
      router.push('/claim/new');
      return;
    }
    if (res.status === 429) {
      setErrors([{ id: 'legalName', message: 'Too many attempts. Please wait a minute and try again.' }]);
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
      if (summary.length > 0) {
        setFieldErrors(nextFieldErrors);
        setErrors(summary);
        return;
      }
    }
    setErrors([{ id: 'legalName', message: 'Please check the information you entered and try again.' }]);
  }

  return (
    <main id="main-content" className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Confirm your identity</h1>
      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField id="legalName" label="Legal name" value={form.legalName} onChange={(v) => setForm({ ...form, legalName: v })} error={fieldErrors.legalName} required />
        <TextField id="dateOfBirth" label="Date of birth" type="date" value={form.dateOfBirth} onChange={(v) => setForm({ ...form, dateOfBirth: v })} error={fieldErrors.dateOfBirth} required />
        <TextField id="ssn" label="Social Security number (123-45-6789)" value={form.ssn} onChange={(v) => setForm({ ...form, ssn: v })} error={fieldErrors.ssn} required />
        <TextField id="phone" label="Phone number" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} error={fieldErrors.phone} required />
        <TextField id="mailingAddress" label="Mailing address" value={form.mailingAddress} onChange={(v) => setForm({ ...form, mailingAddress: v })} error={fieldErrors.mailingAddress} required />
        <Button type="submit">Verify identity</Button>
      </form>
    </main>
  );
}
