'use client';

import { Suspense, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Fieldset } from '@/components/ui/Fieldset';
import { TextField } from '@/components/ui/TextField';
import { Button } from '@/components/ui/Button';
import { ErrorSummary } from '@/components/ui/ErrorSummary';
import { filterApplicationsInWeek, type MarketplaceApplication } from '@/lib/certificationPrefill';

type JobSearchEntry = {
  id: string;
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
    { id: 'manual-seed', employerName: '', contactMethod: '', contactDate: '', position: '', source: 'manual' },
  ]);
  const [errors, setErrors] = useState<{ id: string; message: string }[]>([]);
  // A stable, client-generated id per manual row (marketplace rows already
  // have one: the underlying applicationId). Used only as the React `key` —
  // fixes DOM-identity migration when prefill/remove reorders or resizes the
  // array, so a field a user is focused in doesn't silently start holding a
  // different logical row's data. Input `id`s stay positional (`employer-0`,
  // `employer-1`, ...) since existing E2E tests select on that convention.
  const manualIdCounter = useRef(0);
  const [announcement, setAnnouncement] = useState('');
  // `weekEndingDate:applicationId` pairs the claimant has explicitly removed,
  // so a later blur of the (unchanged) week-ending date doesn't silently
  // resurrect a row they just deleted. Scoped per-date because week-ending
  // dates aren't locked to a fixed grid — two dates less than 7 days apart
  // produce overlapping windows, so the same application can match more than
  // one date's prefill. A ref (not state) avoids a stale-closure read in
  // handleWeekEndingDateBlur if a removal happens while its fetch is in
  // flight — the same class of bug already fixed once for `activities`.
  const removedApplicationIdsRef = useRef<Set<string>>(new Set());
  // Guards against two overlapping blurs (e.g. the claimant quickly corrects
  // a mistyped date and blurs again before the first fetch has resolved)
  // applying their results out of order: whichever fetch resolves last would
  // otherwise win regardless of which blur was actually more recent, so a
  // slower response for a since-superseded date could overwrite the correct
  // one. Incremented on every blur; a response only gets applied if it's
  // still the most recently started one when it resolves.
  const latestBlurRequestId = useRef(0);
  // Visible (not just screen-reader-only) status for the prefill fetch
  // itself, so a claimant — or anyone diagnosing a report that prefill
  // "isn't working" — can see whether it ran at all, and if it did, whether
  // it found nothing for that week or failed outright, instead of a silent
  // no-op that looks identical in all three cases.
  const [prefillStatus, setPrefillStatus] = useState<
    { kind: 'idle' } | { kind: 'loading' } | { kind: 'success'; count: number } | { kind: 'empty' } | { kind: 'error' }
  >({ kind: 'idle' });

  // All three of these use the functional setActivities form — not
  // setActivities(activities.filter(...)) / setActivities([...activities, x])
  // — for the same reason handleWeekEndingDateBlur does: `activities` in this
  // closure is only as fresh as the render that created it. Two of these
  // called back-to-back (e.g. two rapid "Add another job search activity"
  // clicks, or one racing an in-flight prefill fetch) could otherwise both
  // read the same stale array and one update would silently overwrite the
  // other instead of stacking. Confirmed via a real regression: adding
  // prefillStatus's extra synchronous setState in handleWeekEndingDateBlur
  // shifted render timing enough to expose exactly this in
  // tests/e2e/claimant-flow.spec.ts (two Add clicks collapsing into one row).
  function updateActivity(index: number, field: keyof JobSearchEntry, value: string) {
    setActivities((prev) => {
      const current = prev[index];
      if (!current) return prev;
      const next = [...prev];
      next[index] = { ...current, [field]: value };
      return next;
    });
  }

  function addActivity() {
    manualIdCounter.current += 1;
    const newEntry: JobSearchEntry = {
      id: `manual-${manualIdCounter.current}`,
      employerName: '',
      contactMethod: '',
      contactDate: '',
      position: '',
      source: 'manual',
    };
    setActivities((prev) => [...prev, newEntry]);
  }

  function removeActivity(index: number) {
    // Only used to decide whether to fire the announcement/focus side
    // effects below — approximate staleness here is harmless. The actual
    // state mutation and the removedApplicationIdsRef bookkeeping both run
    // against `prev` inside the updater, where correctness matters.
    const removed = activities[index];
    setActivities((prev) => {
      const target = prev[index];
      if (!target) return prev;
      if (target.source === 'marketplace' && target.applicationId) {
        removedApplicationIdsRef.current.add(`${weekEndingDate}:${target.applicationId}`);
      }
      return prev.filter((_, i) => i !== index);
    });
    if (removed) {
      setAnnouncement('Job search activity removed.');
      // The removed row's own Remove button no longer exists, so the
      // browser drops focus to <body> unless something else claims it —
      // send it somewhere still on the page rather than losing it.
      document.getElementById('add-activity-button')?.focus();
    }
  }

  async function handleWeekEndingDateBlur() {
    const dateAtBlur = weekEndingDate;
    if (!dateAtBlur || isNaN(Date.parse(dateAtBlur))) return;
    const requestId = ++latestBlurRequestId.current;
    setPrefillStatus({ kind: 'loading' });
    let res: Response;
    try {
      res = await fetch('/api/job-applications');
    } catch {
      if (requestId === latestBlurRequestId.current) setPrefillStatus({ kind: 'error' });
      return;
    }
    if (!res.ok) {
      if (requestId === latestBlurRequestId.current) setPrefillStatus({ kind: 'error' });
      return;
    }
    const applications: MarketplaceApplication[] = await res.json();
    // A newer blur started (and possibly already resolved) while this fetch
    // was in flight — its result is stale, discard it rather than clobbering
    // whatever the newer one already applied.
    if (requestId !== latestBlurRequestId.current) return;
    const matches = filterApplicationsInWeek(applications, dateAtBlur).filter(
      (a) => !removedApplicationIdsRef.current.has(`${dateAtBlur}:${a.id}`)
    );
    const prefilled: JobSearchEntry[] = matches.map((a) => ({
      id: a.id,
      employerName: a.jobPosting.employer.companyName ?? 'An employer',
      contactMethod: 'Applied through Emplement marketplace',
      // Displayed via toLocaleDateString() below to match this app's
      // local-time date convention elsewhere; this stored value (used for
      // the submitted contactDate) stays a UTC-sliced ISO date. It's a
      // display/storage format choice, independent of
      // filterApplicationsInWeek's own (now local-time) window matching.
      contactDate: a.createdAt.slice(0, 10),
      position: a.jobPosting.title,
      source: 'marketplace',
      applicationId: a.id,
    }));
    // The visible prefillStatus paragraph below (role="status") already
    // announces this to screen readers — no need to also push it through
    // the separate sr-only `announcement` region.
    setPrefillStatus(prefilled.length > 0 ? { kind: 'success', count: prefilled.length } : { kind: 'empty' });
    setActivities((prev) => [...prefilled, ...prev.filter((a) => a.source === 'manual')]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    // Marketplace prefill can leave the form's originally-seeded blank manual
    // row untouched alongside real prefilled rows. A claimant who never
    // typed into that row hasn't left anything "incomplete" — drop
    // completely-untouched manual rows here rather than 400ing on a field
    // the claimant never saw as required. A partially-filled row (some but
    // not all fields entered) is left as-is, so its real validation error
    // still surfaces normally.
    const submittableActivities = activities.filter(
      (a) =>
        a.source === 'marketplace' ||
        a.employerName || a.contactMethod || a.contactDate || a.position
    );
    const res = await fetch('/api/certifications', {
      method: 'POST',
      body: JSON.stringify({
        claimId,
        weekEndingDate,
        ableAndAvailable: ableAndAvailable === 'yes',
        workedThisWeek: workedThisWeek === 'yes',
        earnings: Number(earnings),
        refusedWork: refusedWork === 'yes',
        jobSearchActivities: submittableActivities.map(
          ({ employerName, contactMethod, contactDate, position }) => ({
            employerName,
            contactMethod,
            contactDate,
            position,
          })
        ),
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
          {/* Visible status for the prefill fetch itself — loading, found
              nothing, found some, or failed all render distinctly, so
              "prefill isn't working" is diagnosable by looking at the page
              rather than indistinguishable silent no-ops. Always rendered
              (never conditionally omitted) with a reserved min-height: an
              earlier version only rendered this paragraph once
              prefillStatus left 'idle', which inserted a new line of text
              directly above "Add another job search activity" the instant
              a blur fired — shifting that button down mid-click and
              causing a real, reproducible misclick on it. */}
          <p role="status" className="text-sm mb-2 min-h-[1.25rem] text-text-secondary">
            {prefillStatus.kind === 'loading' && 'Checking for marketplace applications for this week…'}
            {prefillStatus.kind === 'success' &&
              `${prefillStatus.count} job search ${prefillStatus.count === 1 ? 'activity was' : 'activities were'} prefilled from your marketplace applications.`}
            {prefillStatus.kind === 'empty' &&
              'No marketplace applications found for this week — add job search activities manually below.'}
            {prefillStatus.kind === 'error' &&
              "We couldn't check for marketplace applications. You can still add job search activities manually."}
          </p>
          {/* Separate sr-only live region for row-removal announcements —
              a distinct, transient event from the prefill status above. */}
          <div aria-live="polite" className="sr-only">
            {announcement}
          </div>
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
            //
            // key={a.id} (not the array index): prefill/remove can reorder
            // or resize this array, and an index key would let React reuse
            // a DOM node — and any focus in it — for a different logical
            // row. a.id is stable per entry (the applicationId for
            // marketplace rows, a generated id for manual ones).
            <fieldset key={a.id} className="border border-border rounded p-4 mb-3">
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
                    <span className="font-medium">Contact date:</span>{' '}
                    {new Date(`${a.contactDate}T00:00:00Z`).toLocaleDateString()}
                  </p>
                  <p>
                    <span className="font-medium">Position:</span> {a.position}
                  </p>
                  <p className="text-status-active-text font-medium mt-1">
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
          <Button type="button" variant="secondary" onClick={addActivity} id="add-activity-button">
            Add another job search activity
          </Button>
        </fieldset>

        <Button type="submit">Submit certification</Button>
      </form>
    </main>
  );
}
