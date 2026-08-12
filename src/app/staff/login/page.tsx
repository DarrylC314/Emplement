'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

export default function StaffLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    const result = await signIn('credentials', { redirect: false, email, password });
    if (result?.error) {
      setErrors([{ id: 'email', message: 'Invalid email or password.' }]);
      return;
    }
    router.push('/staff/dashboard');
  }

  return (
    <main id="main-content" className="max-w-md mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Staff log in</h1>
      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField id="email" label="Email address" type="email" value={email} onChange={setEmail} autoComplete="email" required />
        <TextField id="password" label="Password" type="password" value={password} onChange={setPassword} autoComplete="current-password" required />
        <Button type="submit">Log in</Button>
      </form>
    </main>
  );
}
