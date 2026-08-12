'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Fieldset } from '@/components/ui/Fieldset';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';

type JobSearchEntry = { employerName: string; contactMethod: string; contactDate: string; position: string };

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
    { employerName: '', contactMethod: '', contactDate: '', position: '' },
  ]);
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);

  function updateActivity(index: number, field: keyof JobSearchEntry, value: string) {
    const next = [...activities];
    const current = next[index];
    if (!current) return;
    next[index] = { ...current, [field]: value };
    setActivities(next);
  }

  function addActivity() {
    setActivities([...activities, { employerName: '', contactMethod: '', contactDate: '', position: '' }]);
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
        jobSearchActivities: activities,
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
        <TextField id="weekEndingDate" label="Week ending date" type="date" value={weekEndingDate} onChange={setWeekEndingDate} required />
        <Fieldset legend="Were you able and available to work this week?" name="ableAndAvailable" options={YES_NO} value={ableAndAvailable} onChange={setAbleAndAvailable} />
        <Fieldset legend="Did you work this week?" name="workedThisWeek" options={YES_NO} value={workedThisWeek} onChange={setWorkedThisWeek} />
        <TextField id="earnings" label="Total earnings this week ($)" type="number" value={earnings} onChange={setEarnings} />
        <Fieldset legend="Did you refuse any offer of work this week?" name="refusedWork" options={YES_NO} value={refusedWork} onChange={setRefusedWork} />

        <fieldset className="mb-4">
          <legend className="font-medium mb-2">Job search activities (minimum 3 required)</legend>
          {activities.map((a, i) => (
            <div key={i} className="border border-border rounded p-4 mb-3">
              <TextField id={`employer-${i}`} label="Employer name" value={a.employerName} onChange={(v) => updateActivity(i, 'employerName', v)} required />
              <TextField id={`method-${i}`} label="Contact method" value={a.contactMethod} onChange={(v) => updateActivity(i, 'contactMethod', v)} required />
              <TextField id={`date-${i}`} label="Contact date" type="date" value={a.contactDate} onChange={(v) => updateActivity(i, 'contactDate', v)} required />
              <TextField id={`position-${i}`} label="Position applied for" value={a.position} onChange={(v) => updateActivity(i, 'position', v)} required />
            </div>
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
