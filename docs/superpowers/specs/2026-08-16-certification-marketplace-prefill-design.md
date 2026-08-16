# Certification Job-Search Prefill from Marketplace Applications Design

## Purpose

Bridges two previously-separate subsystems: weekly certification (built well before the
marketplace) and the employer marketplace (three sub-projects built and deployed the
prior day). When a claimant fills out their weekly certification, job-search-activity
rows for that week's marketplace applications are pre-filled automatically — reviewed
and submitted like any other row, never retyped from scratch.

## Background / relationship to existing work

`WeeklyCertification.jobSearchActivities` (`JobSearchActivity[]`) is currently built
entirely from free-text rows the claimant types on `/claim/certify`
(`src/app/claim/certify/page.tsx`): `employerName`, `contactMethod`, `contactDate`,
`position`, all manually entered, with no structured link to anything else in the app.
`evaluateCertification` (`src/lib/decisionEngine.ts`) requires at least 3
(`MIN_JOB_SEARCH_CONTACTS`) for a clean `APPROVED` decision, counted as
`jobSearchActivities.length` — a plain count, with no concept of where an entry came
from.

Separately, `JobApplication` (built across this session's three marketplace
sub-projects) already captures real, structured data every time a claimant applies to
a `JobPosting`: which employer, which role, and exactly when. This spec makes that
existing data show up on the certification form instead of asking the claimant to
retype it.

## Scope

**In scope:**

- On `/claim/certify`, when the week-ending date field loses focus and parses as a
  valid date, fetch the claimant's marketplace applications and prefill one job-search
  row per application whose `createdAt` falls in the 7-day window ending on that date.
- Prefilled rows are read-only display, not editable text fields, and carry a "Remove"
  button.
- A "Remove" button is added to every row, prefilled or manual — this doesn't exist on
  the form today and becomes necessary now that a row can appear without the claimant
  having typed it.
- Manual rows work exactly as they do today (add, edit, type from scratch), with the
  one addition of also being removable, for UI consistency with prefilled rows.
- No new API route: reuses the existing `GET /api/job-applications` (built for the My
  Applications page) and filters to the date window client-side.

**Out of scope for this feature:**

- Any change to `evaluateCertification`, the `MIN_JOB_SEARCH_CONTACTS` threshold, or
  how `jobSearchActivityCount` is computed — it stays `jobSearchActivities.length`,
  unaware of row provenance.
- Any change to `POST /api/certifications` or the `WeeklyCertification`/
  `JobSearchActivity` Prisma models — this is a pure frontend feature; a submitted
  prefilled row is indistinguishable, at the data layer, from one the claimant typed.
- Editing a prefilled row's structured fields (employer/position/date) — they're
  removable but not editable, since they reflect a real record.
- Preventing the same `JobApplication` from ever appearing in two different weeks'
  prefill — not needed, since each application's `createdAt` is fixed and falls in
  exactly one non-overlapping weekly window by construction.
- Any server-side enforcement that a submitted job-search row actually corresponds to
  a real application — the backend already trusts claimant-submitted certification
  data as-is (this matches the existing, unrelated trust boundary for manually-typed
  rows, which the backend has never validated against reality either).

## Data flow

`src/app/claim/certify/page.tsx`'s `JobSearchEntry` type gains a `source: 'marketplace'
| 'manual'` field, defaulting to `'manual'` for the page's existing initial empty row
and anything added via "Add another job search activity".

On the week-ending date field's `onBlur`, if the value parses as a valid date:
1. Compute the 7-day window: `[weekEndingDate - 6 days, weekEndingDate]` (inclusive),
   i.e. the certification week itself.
2. `fetch('/api/job-applications')` (already-existing, unfiltered) and filter
   client-side to applications whose `createdAt` falls in that window. A small pure
   function, `filterApplicationsInWeek(applications, weekEndingDate)`, does this
   filtering so it's unit-testable without mounting the page.
3. Replace the current set of `source: 'marketplace'` rows with one freshly-built row
   per matching application (`employerName` = `application.jobPosting.employer
   .companyName ?? 'An employer'`, `position` = `application.jobPosting.title`,
   `contactDate` = `application.createdAt`, `contactMethod` = `'Applied through
   Emplement marketplace'`). Rows with `source: 'manual'` are left untouched — this
   step never touches or removes anything the claimant typed themselves.

Submission is unchanged: both row types serialize into the same `jobSearchActivities`
array sent to `POST /api/certifications`, which has no concept of `source` and never
sees that field (it's stripped before the request body is built, matching the shape
`weeklyCertificationSchema` already expects).

## UI changes

- Prefilled rows render `employerName`/`contactMethod`/`contactDate`/`position` as
  plain read-only text (not `TextField`s) inside the same per-entry `<fieldset>`
  structure the form already uses, plus a "Remove" button.
- Manual rows are unchanged `TextField`s, plus the same new "Remove" button.
- Removing a row (either kind) simply drops it from the `activities` array — no
  confirmation dialog, matching this app's existing low-friction interaction style
  elsewhere (e.g. Cancel on the interview-propose form).
- If the fetch fails, the form degrades to its current behavior (no prefill, no error
  banner) rather than blocking certification — a claimant must always be able to
  certify by typing manually, prefill is a convenience layered on top, not a
  dependency.

## Testing

- Unit: `filterApplicationsInWeek` — applications on the boundary dates (exactly 6
  days before, exactly on the week-ending date), applications outside the window in
  both directions, an empty applications list, applications from multiple different
  postings.
- E2E: extend the existing marketplace flow — claimant applies to a posting, opens
  `/claim/certify`, enters a week-ending date matching the application's week, confirms
  a read-only row prefilled with the correct employer/position/date, adds one manual
  row to reach the 3-contact minimum, submits, and confirms the certification's
  `autoDecision` is `APPROVED`.

## Success criteria

A claimant who applied to marketplace postings during the certification week sees
those applications already listed as job-search contacts when they open the
certification form — reviewed, not retyped — and can still remove any row or add
manual ones to reach the required minimum.
