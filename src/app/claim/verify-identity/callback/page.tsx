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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
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
    setErrors([{ id: 'legalName', message: 'Please check the information you entered and try again.' }]);
  }

  return (
    <main id="main-content" className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Confirm your identity</h1>
      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField id="legalName" label="Legal name" value={form.legalName} onChange={(v) => setForm({ ...form, legalName: v })} required />
        <TextField id="dateOfBirth" label="Date of birth" type="date" value={form.dateOfBirth} onChange={(v) => setForm({ ...form, dateOfBirth: v })} required />
        <TextField id="ssn" label="Social Security number (123-45-6789)" value={form.ssn} onChange={(v) => setForm({ ...form, ssn: v })} required />
        <TextField id="phone" label="Phone number" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} required />
        <TextField id="mailingAddress" label="Mailing address" value={form.mailingAddress} onChange={(v) => setForm({ ...form, mailingAddress: v })} required />
        <Button type="submit">Verify identity</Button>
      </form>
    </main>
  );
}
