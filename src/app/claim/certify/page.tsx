'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Fieldset } from '@/components/ui/Fieldset';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';
import { filterApplicationsInWeek, type MarketplaceApplication } from '@/lib/certificationPrefill';

type JobSearchEntry = {
  employerName: string;
  contactMethod: string;
  contactDate: string;
  position: string;
  source: 'marketplace' | 'manual';
  applicationId?: string;
};

const YES_NO = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

export default function CertifyPage() {
  return (
    <Suspense fallback={null}>
      <CertifyForm />
    </Suspense>
  );
}

function CertifyForm() {
  const router = useRouter();
  const params = useSearchParams();
  const claimId = params.get('claimId') ?? '';

  const [weekEndingDate, setWeekEndingDate] = useState('');
  const [ableAndAvailable, setAbleAndAvailable] = useState('yes');
  const [workedThisWeek, setWorkedThisWeek] = useState('no');
  const [earnings, setEarnings] = useState('0');
  const [refusedWork, setRefusedWork] = useState('no');
  const [activities, setActivities] = useState<JobSearchEntry[]>([
    { employerName: '', contactMethod: '', contactDate: '', position: '', source: 'manual' },
  ]);
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  // Application IDs the claimant has explicitly removed, so a later blur of
  // the (unchanged) week-ending date doesn't silently resurrect a row they
  // just deleted.
  const [removedApplicationIds, setRemovedApplicationIds] = useState<Set<string>>(new Set());

  function updateActivity(index: number, field: keyof JobSearchEntry, value: string) {
    const next = [...activities];
    const current = next[index];
    if (!current) return;
    next[index] = { ...current, [field]: value };
    setActivities(next);
  }

  function addActivity() {
    setActivities([
      ...activities,
      { employerName: '', contactMethod: '', contactDate: '', position: '', source: 'manual' },
    ]);
  }

  function removeActivity(index: number) {
    const removed = activities[index];
    if (removed?.source === 'marketplace' && removed.applicationId) {
      setRemovedApplicationIds((prev) => new Set(prev).add(removed.applicationId!));
    }
    setActivities(activities.filter((_, i) => i !== index));
  }

  async function handleWeekEndingDateBlur() {
    if (!weekEndingDate || isNaN(Date.parse(weekEndingDate))) return;
    const res = await fetch('/api/job-applications');
    if (!res.ok) return;
    const applications: MarketplaceApplication[] = await res.json();
    const matches = filterApplicationsInWeek(applications, weekEndingDate).filter(
      (a) => !removedApplicationIds.has(a.id)
    );
    const prefilled: JobSearchEntry[] = matches.map((a) => ({
      employerName: a.jobPosting.employer.companyName ?? 'An employer',
      contactMethod: 'Applied through Emplement marketplace',
      contactDate: a.createdAt.slice(0, 10),
      position: a.jobPosting.title,
      source: 'marketplace',
      applicationId: a.id,
    }));
    setActivities((prev) => [...prefilled, ...prev.filter((a) => a.source === 'manual')]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    const res = await fetch('/api/certifications', {
      method: 'POST',
      body: JSON.stringify({
        claimId,
        weekEndingDate,
        ableAndAvailable: ableAndAvailable === 'yes',
        workedThisWeek: workedThisWeek === 'yes',
        earnings: Number(earnings),
        refusedWork: refusedWork === 'yes',
        jobSearchActivities: activities.map(({ employerName, contactMethod, contactDate, position }) => ({
          employerName,
          contactMethod,
          contactDate,
          position,
        })),
      }),
    });
    if (res.ok) {
      router.push('/claim/dashboard');
      return;
    }
    setErrors([{ id: 'weekEndingDate', message: 'Please check your entries and try again.' }]);
  }

  return (
    <main id="main-content" className="max-w-2xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-4">Weekly certification</h1>
      <ErrorSummary errors={errors} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          id="weekEndingDate"
          label="Week ending date"
          type="date"
          value={weekEndingDate}
          onChange={setWeekEndingDate}
          onBlur={handleWeekEndingDateBlur}
          required
        />
        <Fieldset legend="Were you able and available to work this week?" name="ableAndAvailable" options={YES_NO} value={ableAndAvailable} onChange={setAbleAndAvailable} />
        <Fieldset legend="Did you work this week?" name="workedThisWeek" options={YES_NO} value={workedThisWeek} onChange={setWorkedThisWeek} />
        <TextField id="earnings" label="Total earnings this week ($)" type="number" value={earnings} onChange={setEarnings} />
        <Fieldset legend="Did you refuse any offer of work this week?" name="refusedWork" options={YES_NO} value={refusedWork} onChange={setRefusedWork} />

        <fieldset className="mb-4">
          <legend className="font-medium mb-2">Job search activities (minimum 3 required)</legend>
          {activities.map((a, i) => (
            // Nested fieldset per entry, not just a styled <div>: with two or
            // more activities, every entry's fields share the exact same
            // labels ("Employer name", "Contact method", ...). A sighted user
            // tells them apart visually by position; a screen-reader user
            // navigating by field name hears "Employer name" repeated with no
            // way to know which entry they're in. A legend here gives that
            // context back — most screen readers announce the nearest
            // enclosing legend alongside the field's own label — the same
            // technique already used for the Yes/No question groups above.
            <fieldset key={i} className="border border-border rounded p-4 mb-3">
              <legend className="sr-only">Job search activity {i + 1}</legend>
              {a.source === 'marketplace' ? (
                <div className="mb-3 text-sm">
                  <p>
                    <span className="font-medium">Employer:</span> {a.employerName}
                  </p>
                  <p>
                    <span className="font-medium">Contact method:</span> {a.contactMethod}
                  </p>
                  <p>
                    <span className="font-medium">Contact date:</span> {a.contactDate}
                  </p>
                  <p>
                    <span className="font-medium">Position:</span> {a.position}
                  </p>
                  <p role="status" className="text-status-active-text font-medium mt-1">
                    Prefilled from your marketplace application
                  </p>
                </div>
              ) : (
                <>
                  <TextField id={`employer-${i}`} label="Employer name" value={a.employerName} onChange={(v) => updateActivity(i, 'employerName', v)} required />
                  <TextField id={`method-${i}`} label="Contact method" value={a.contactMethod} onChange={(v) => updateActivity(i, 'contactMethod', v)} required />
                  <TextField id={`date-${i}`} label="Contact date" type="date" value={a.contactDate} onChange={(v) => updateActivity(i, 'contactDate', v)} required />
                  <TextField id={`position-${i}`} label="Position applied for" value={a.position} onChange={(v) => updateActivity(i, 'position', v)} required />
                </>
              )}
              <Button type="button" variant="secondary" onClick={() => removeActivity(i)}>
                Remove
              </Button>
            </fieldset>
          ))}
          <Button type="button" variant="secondary" onClick={addActivity}>
            Add another job search activity
          </Button>
        </fieldset>

        <Button type="submit">Submit certification</Button>
      </form>
    </main>
  );
}
