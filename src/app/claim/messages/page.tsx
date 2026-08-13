'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

type MessageItem = { id: string; subject: string; body: string; sentAt: string };

export default function MessagesPage() {
  const { data: session, status } = useSession();
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'loading') return;
    const claimantProfileId = session?.user.claimantProfileId;
    if (!claimantProfileId) {
      setLoading(false);
      setError('Sign in with a claimant account to read your messages.');
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/messages?claimantProfileId=${claimantProfileId}`);
        if (cancelled) return;
        // Without this check a 401/403 body ({ error: '...' }) lands in state
        // where an array is expected and the render crashes on .map.
        if (!res.ok) {
          setError('We could not load your messages. Please sign in again and retry.');
          return;
        }
        setMessages(await res.json());
      } catch {
        if (!cancelled) setError('We could not load your messages. Please check your connection.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.user.claimantProfileId, status]);

  return (
    <main id="main-content" className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Messages</h1>
      {error ? (
        <p role="alert" className="text-error-text">
          {error}
        </p>
      ) : loading ? (
        <p>Loading…</p>
      ) : messages.length === 0 ? (
        <p>You have no messages.</p>
      ) : (
        <ul className="space-y-3">
          {messages.map((m) => (
            <li key={m.id} className="border border-border rounded p-4">
              <h2 className="font-medium">{m.subject}</h2>
              <p className="text-sm text-text-secondary mb-2">
                {new Date(m.sentAt).toLocaleString()}
              </p>
              <p>{m.body}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
