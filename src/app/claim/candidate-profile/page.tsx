'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

type CandidateProfile = {
  id: string;
  headline: string;
  skills: string;
  bio: string | null;
  availability: string;
};

export default function CandidateProfilePage() {
  const { data: session, status } = useSession();
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [headline, setHeadline] = useState('');
  const [skills, setSkills] = useState('');
  const [bio, setBio] = useState('');
  const [availability, setAvailability] = useState('');
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});

  useEffect(() => {
    if (status !== 'authenticated' || session?.user.role !== 'CLAIMANT') return;
    fetch('/api/candidate-profile')
      .then((res) => (res.ok ? res.json() : null))
      .then(setProfile)
      .finally(() => setLoading(false));
  }, [status, session?.user.role]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setFieldErrors({});
    const res = await fetch('/api/candidate-profile', {
      method: 'POST',
      body: JSON.stringify({ headline, skills, bio: bio || undefined, availability }),
    });
    if (res.ok) {
      setProfile(await res.json());
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
    setErrors([{ id: 'headline', message: body?.error ?? 'We could not save your profile. Please try again.' }]);
  }

  if (status === 'loading' || loading) {
    return (
      <main id="main-content" className="max-w-2xl mx-auto p-8">
        Loading…
      </main>
    );
  }

  if (status !== 'authenticated' || session?.user.role !== 'CLAIMANT') {
    return (
      <main id="main-content" className="max-w-2xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Candidate profile</h1>
        <p role="alert" className="text-error-text">
          Sign in with a claimant account to build your candidate profile.
        </p>
      </main>
    );
  }

  if (profile) {
    return (
      <main id="main-content" className="max-w-2xl mx-auto p-8">
        <h1 className="text-2xl font-bold mb-4">Your candidate profile</h1>
        <dl className="space-y-2">
          <dt className="font-medium">Headline</dt>
          <dd>{profile.headline}</dd>
          <dt className="font-medium">Skills</dt>
          <dd>{profile.skills}</dd>
          <dt className="font-medium">Availability</dt>
          <dd>{profile.availability}</dd>
          {profile.bio && (
            <>
              <dt className="font-medium">Bio</dt>
              <dd>{profile.bio}</dd>
            </>
          )}
        </dl>
      </main>
    );
  }

  return (
    <main id="main-content" className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Build your candidate profile</h1>
      <p className="mb-4 text-text-secondary">
        Employers browsing the marketplace will see your headline, skills, availability, and
        bio — never your Social Security number, date of birth, or mailing address.
      </p>
      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField id="headline" label="Headline" value={headline} onChange={setHeadline} error={fieldErrors.headline} required />
        <TextField id="skills" label="Skills" value={skills} onChange={setSkills} error={fieldErrors.skills} required />
        <TextField id="availability" label="Availability" value={availability} onChange={setAvailability} error={fieldErrors.availability} required />
        <TextField id="bio" label="Bio (optional)" value={bio} onChange={setBio} error={fieldErrors.bio} />
        <Button type="submit">Save profile</Button>
      </form>
    </main>
  );
}
