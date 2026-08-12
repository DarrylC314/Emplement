'use client';

import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';

export default function VerifyIdentityPage() {
  const { data: session, status } = useSession();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState(false);

  async function handleStart() {
    if (status !== 'authenticated' || !session?.user.claimantProfileId) return;
    setError(false);
    setStarting(true);
    const res = await fetch('/api/identity-verification/start', {
      method: 'POST',
      body: JSON.stringify({ claimantProfileId: session.user.claimantProfileId }),
    });
    if (!res.ok) {
      setStarting(false);
      setError(true);
      return;
    }
    const data = await res.json();
    window.location.href = `/claim/verify-identity/callback?ref=${data.mockReferenceId}`;
  }

  return (
    <main id="main-content" className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Verify your identity</h1>
      <p className="mb-4 text-text-secondary">
        Before you can file a claim, we need to confirm you are who you say you are. This
        protects your benefits from being claimed fraudulently by someone else. You&apos;ll be
        asked for your legal name, date of birth, Social Security number, and contact
        information. This information is encrypted and only used to verify your identity and
        process your claim.
      </p>
      {error && (
        <p role="alert" className="mb-4 text-error-text">
          Something went wrong starting identity verification. Please try again.
        </p>
      )}
      <Button onClick={handleStart} disabled={starting || status !== 'authenticated'}>
        {starting ? 'Starting…' : 'Continue to identity verification'}
      </Button>
    </main>
  );
}
