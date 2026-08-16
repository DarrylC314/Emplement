'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { TextField } from '@/components/ui/TextField';
import { CheckboxGroup } from '@/components/ui/CheckboxGroup';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';
import { TAG_OPTIONS } from '@/lib/tagOptions';

type JobPosting = {
  id: string;
  title: string;
  description: string;
  location: string;
  status: 'OPEN' | 'FILLED';
  createdAt: string;
};

export default function JobPostingsPage() {
  const { data: session, status } = useSession();
  const [postings, setPostings] = useState<JobPosting[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  async function loadPostings() {
    const res = await fetch('/api/employer/job-postings');
    if (!res.ok) {
      setLoadError('We could not load your job postings. Please try again.');
      return;
    }
    setPostings(await res.json());
  }

  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'EMPLOYER') return;
    loadPostings();
  }, [status, session?.user.role]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setFieldErrors({});
    const res = await fetch('/api/employer/job-postings', {
      method: 'POST',
      body: JSON.stringify({ title, description, location, tags }),
    });
    if (res.ok) {
      setTitle('');
      setDescription('');
      setLocation('');
      setTags([]);
      await loadPostings();
      return;
    }
    const body = await res.json().catch(() => null);
    const zodFieldErrors: Record<string, string[]> | undefined = body?.errors?.fieldErrors;
    if (zodFieldErrors) {
      const nextFieldErrors: Record<string, string> = {};
      const summary: { id: string; message: string }[] = [];
      for (const [field, messages] of Object.entries(zodFieldErrors)) {
        if (!messages?.[0]) continue;
        nextFieldErrors[field] = messages[0];
        summary.push({ id: field, message: messages[0] });
      }
      setFieldErrors(nextFieldErrors);
      setErrors(summary);
      return;
    }
    setErrors([{ id: 'title', message: body?.error ?? 'We could not create that posting. Please try again.' }]);
  }

  if (status === 'loading') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        Loading…
      </main>
    );
  }

  if (status !== 'authenticated' || session?.user.role !== 'EMPLOYER') {
    return (
      <main id="main-content" className="max-w-3xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Job postings</h1>
        <p role="alert" className="text-error-text">
          Sign in with an employer account to manage job postings.
        </p>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-3xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Job postings</h1>

      <section className="border border-border rounded p-4 mb-6">
        <h2 className="font-medium mb-2">Post a job</h2>
        <ErrorSummary errors={errors} />
        <form onSubmit={handleSubmit} noValidate>
          <TextField id="title" label="Title" value={title} onChange={setTitle} error={fieldErrors.title} required />
          <TextField id="description" label="Description" value={description} onChange={setDescription} error={fieldErrors.description} required />
          <TextField id="location" label="Location" value={location} onChange={setLocation} error={fieldErrors.location} required />
          <CheckboxGroup legend="Tags (optional)" name="tags" options={TAG_OPTIONS} value={tags} onChange={setTags} error={fieldErrors.tags} />
          <Button type="submit">Post job</Button>
        </form>
      </section>

      <section className="border border-border rounded p-4">
        <h2 className="font-medium mb-2">Your postings</h2>
        {loadError && (
          <p role="alert" className="mb-2 text-error-text">
            {loadError}
          </p>
        )}
        {postings === null && !loadError && <p>Loading…</p>}
        {postings !== null && postings.length === 0 && (
          <p className="text-sm text-text-secondary">You haven&apos;t posted any jobs yet.</p>
        )}
        {postings !== null && postings.length > 0 && (
          <ul className="space-y-3">
            {postings.map((p) => (
              <li key={p.id} className="border-t border-border pt-3 text-sm">
                <p className="font-medium">{p.title}</p>
                <p className="text-text-secondary mb-1">
                  {p.location} — {p.status === 'OPEN' ? 'Open' : 'Filled'}
                </p>
                <Link href={`/employer/job-postings/${p.id}`} className="text-link underline">
                  View applications
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
