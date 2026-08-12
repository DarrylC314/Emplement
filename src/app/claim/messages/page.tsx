'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';

type MessageItem = { id: string; subject: string; body: string; sentAt: string };

export default function MessagesPage() {
  const { data: session } = useSession();
  const [messages, setMessages] = useState<MessageItem[]>([]);

  useEffect(() => {
    if (!session?.user.claimantProfileId) return;
    fetch(`/api/messages?claimantProfileId=${session.user.claimantProfileId}`)
      .then((r) => r.json())
      .then(setMessages);
  }, [session?.user.claimantProfileId]);

  return (
    <main id="main-content" className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Messages</h1>
      {messages.length === 0 ? (
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
