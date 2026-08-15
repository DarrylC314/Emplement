# Unmatched Employer Events (Staff Resolution Queue) — Design

## Purpose

Gives staff a way to resolve `EmploymentEvent` rows that an employer reported but that
never automatically matched a claimant — currently these are stored and never surfaced
to anyone. This is the second of two sub-projects identified while scoping the next
Employer Portal phase; the first (claimant `prefix`/`suffix`/`gender` fields) has
already shipped, specifically so this sub-project's staff-facing search could
cross-reference on them.

## Background / relationship to existing work

`POST /api/employer/events` (from the Employer Portal claims-response feature) already
hashes an employer-submitted SSN and looks up a matching `ClaimantProfile` by
`ssnHash`. When no match is found, the event is created anyway with
`matchedClaimantProfileId: null` and is never surfaced — the design spec for that
feature explicitly deferred "any UI for unmatched hire/separation events" to a future
phase. This is that phase.

The existing staff claimant search (`GET /api/staff/claimants`, rendered by
`/staff/claimants`) already supports free-text search over `legalName`/email, capped
at 25 results, gated by `requireRole(['CASEWORKER','ADMIN'])`. It's extended here
rather than duplicated.

The existing reveal-SSN route (`POST /api/staff/claimants/[id]/reveal-ssn`)
establishes the pattern this feature's justification notes follow: a required
`reason`/`note` string, stored only in `AuditLog.metadata`, actor always derived from
`session.user.id`, never a persisted column on the target entity.

## Scope

**In scope:**

- A new staff-facing queue (`/staff/unmatched-events`) listing every `EmploymentEvent`
  with no claimant match and not dismissed
- Three actions per queued event:
  - **Retry**: re-checks the event's own already-stored `ssnHash` against current
    claimants (handles "the claimant verified their identity after the event was
    reported" — the event's original hash was always correct, it just didn't match
    *yet*). No note required — it's a zero-judgment recheck, not a decision.
  - **Manual match**: staff submits a *different*, corrected SSN (handles "the
    employer had the wrong SSN on file" — the event's stored hash will never match
    anyone no matter how many times it's retried). Hashed immediately, looked up the
    same way the automatic path does. Requires a justification note.
  - **Dismiss**: marks the event as reviewed with no match, removing it from the
    active queue. Requires a justification note.
- Extending the existing staff claimant search's `select` and results display with
  `prefix`, `suffix`, `gender`, `dateOfBirth` — the disambiguation data staff use to
  figure out which SSN to try before returning to the queue to attempt a match
- `EmploymentEvent.dismissedAt`/`dismissedByUserId` — queryable state distinguishing
  "still active" from "dismissed" in the queue's list query

**Out of scope (explicitly deferred):**

- Employer-facing visibility into their own unmatched events — still never shown to
  the employer, by design (revealing this would leak information no different in kind
  from the existing "never reveal match status" guarantee)
- Bulk/batch matching or dismissal tools
- Any change to the automatic matching logic in `POST /api/employer/events` itself
- A dedicated, purpose-built search UI embedded in the events queue — the existing
  staff claimant search is reused instead
- Any UI resurfacing a dismissed event (dismissal is final within this phase; no
  "undismiss" action)

## Data model

```prisma
model EmploymentEvent {
  // ...existing fields unchanged...
  dismissedAt       DateTime?
  dismissedByUserId String?
  dismissedBy       User?     @relation(fields: [dismissedByUserId], references: [id])
}
```

`User` gains the required back-relation: `dismissedEmploymentEvents EmploymentEvent[]`.

No new columns for match/dismiss justification notes — those live only in
`AuditLog.metadata`, per the reveal-SSN precedent. An event's state is fully
derivable from existing/new columns: `matchedClaimantProfileId` set → matched (already
surfaced on the claimant's case-detail page, unchanged); `dismissedAt` set →
dismissed; both null → active in the queue.

`ClaimantProfile.prefix`/`suffix`/`gender`/`dateOfBirth` already exist (shipped in the
prior sub-project) — no schema change needed there, only the search route's `select`
block and the search page's display gain them.

## Flows

### Staff: viewing the queue

`GET /api/staff/unmatched-events` — `requireRole(['CASEWORKER','ADMIN'])`, selects
`id`, `type`, `employeeName`, `eventDate`, `createdAt`, and `employer.companyName`
(explicit `select`, no `include`) for every `EmploymentEvent` where
`matchedClaimantProfileId IS NULL AND dismissedAt IS NULL`, ordered by `eventDate`
descending. `/staff/unmatched-events` renders the list; each row exposes Retry,
Manual match, and Dismiss.

### Staff: investigating a candidate

No new UI here — staff opens the (now-extended) `/staff/claimants` search, searches
by the event's `employeeName`, and cross-references results' `prefix`/`suffix`/
`gender`/`dateOfBirth` against whatever the employer's event record and other context
suggest, to figure out which SSN is worth trying.

### Staff: retry

`POST /api/staff/unmatched-events/[id]/retry` — no request body. Looks up
`ClaimantProfile.findUnique({ where: { ssnHash: event.ssnHash } })` using the event's
own already-stored hash. Match found → `EmploymentEvent.update` sets
`matchedClaimantProfileId`, audit-logs `EMPLOYMENT_EVENT_MANUALLY_MATCHED` with
`metadata: { via: 'retry' }`. No match → 404, event stays in the queue, no audit log
written (a no-op recheck isn't itself an auditable action — only a resulting change
is).

### Staff: manual match

`POST /api/staff/unmatched-events/[id]/match` with `{ ssn, note }` — both required.
Hashes the *submitted* SSN (via the existing `hashSSN`, never the event's stored
hash), looks up a claimant by that new hash. Found → sets
`matchedClaimantProfileId`, audit-logs `EMPLOYMENT_EVENT_MANUALLY_MATCHED` with
`metadata: { via: 'manual', note }`. Not found → 404 "No claimant found with that
SSN." — informing the staff member is correct and necessary here, unlike the
employer-facing route: staff already have full context (the event's `employeeName`,
employer, date) and audit-logged access to claimant data at the same trust level as
the reveal-SSN feature; there is no probing concern to guard against.

### Staff: dismiss

`POST /api/staff/unmatched-events/[id]/dismiss` with `{ note }` — required. Sets
`dismissedAt: new Date()`, `dismissedByUserId: session.user.id`, audit-logs
`EMPLOYMENT_EVENT_DISMISSED` with `metadata: { note }`.

## Error handling

- All four new routes 401/403 via `requireRole` before touching any event data.
- An `id` that doesn't correspond to any `EmploymentEvent` → 404, same convention as
  every other staff detail route (`/api/staff/claimants/[id]`).
- An `id` that corresponds to an already-matched or already-dismissed event → 409
  (the queue's own listing shouldn't produce this in normal use, but a second staff
  member acting on a stale page load is a real race to guard against — same class of
  concern as double-submitting a case note).
- Manual match's `note`/dismiss's `note` missing or empty → 400, mirroring reveal-SSN's
  `reason is required` check exactly.

## Testing

- Integration: queue listing (only active events returned, matched/dismissed
  excluded); retry hit (event with a real, now-matchable `ssnHash` gets linked, audit
  log written) and miss (no claimant, 404, no audit log); manual match hit (submitted
  SSN differs from the event's original, still links correctly) and miss (404,
  correct message, no claimant existence leaked beyond the 404 itself); dismiss (state
  set, audit log written, event no longer appears in the queue); 409 on acting on an
  already-resolved event; RBAC rejection for non-staff roles on all four routes.
- Accessibility: `/staff/unmatched-events` scanned by the existing axe-core E2E gate,
  same as every other route.
- E2E: full flow — employer reports an event with an SSN matching no current
  claimant → event appears in the queue → staff manually matches it with a note →
  event disappears from the queue → event appears on the claimant's case-detail page
  (existing "Employer-reported events" section, unchanged).

## Success criteria

A hire/separation event an employer reports that doesn't automatically match anyone
is no longer invisible: staff can see it, investigate who it's likely to be using the
same identity fields the prior sub-project added, resolve it either by retrying the
original SSN (for late identity verification) or manually matching a corrected one
(for employer data errors), or dismiss it with a note if it will never match anyone.
