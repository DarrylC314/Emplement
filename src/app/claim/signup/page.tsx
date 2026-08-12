'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrors([]);
    const res = await fetch('/api/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, role: 'CLAIMANT' }),
    });
    setSubmitting(false);
    if (res.ok) {
      router.push('/claim/login?registered=1');
      return;
    }
    const data = await res.json();
    if (res.status === 409) {
      setErrors([{ id: 'email', message: data.error }]);
    } else {
      setErrors([{ id: 'email', message: 'Please check your email and password and try again.' }]);
    }
  }

  const emailError = errors.find((e) => e.id === 'email')?.message;
  const passwordError = errors.find((e) => e.id === 'password')?.message;

  return (
    <main id="main-content" className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Create your account</h1>
      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          id="email"
          label="Email address"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          required
          error={emailError}
        />
        <TextField
          id="password"
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          required
          error={passwordError}
        />
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
    </main>
  );
}
