# Live Interview Scheduling Design

## Purpose

Builds the third sub-project of "Phase 3: employer marketplace" — named in the
candidate/posting ranking sub-project's inherited roadmap as: *"once an application is
under active consideration, letting employer and candidate coordinate an interview
inside the product rather than off-platform."* This closes that gap: an employer
proposes interview time slots for a `PENDING` application, and the candidate accepts
one or declines, entirely inside the app.

## Background / relationship to existing work

Two marketplace sub-projects are already merged and live: the first slice
(`docs/superpowers/specs/2026-08-15-employer-marketplace-slice-design.md` —
`CandidateProfile`, `JobPosting`, `JobApplication`, the hire transaction) and
automated candidate/posting ranking
(`docs/superpowers/specs/2026-08-15-candidate-posting-ranking-design.md` — the
`TagCategory` taxonomy and "Recommended" sections). This sub-project builds on top of
`JobApplication` without modifying it — no new `ApplicationStatus` value, no change to
the existing Hire/Reject routes.

There is currently no page anywhere in the app where a claimant can see their own
`JobApplication`s — `/claim/browse-postings` only shows a one-time "✓ Applied"
confirmation for the current session. This sub-project adds that page
(`/claim/applications`), since interview responses need somewhere to live for the
candidate to act on them, and a persistent application list is independently useful
beyond this feature.

There is also no notification mechanism for employers anywhere in this app — nobody
gets notified when a candidate applies, when an employer reaches out, or when a hire
happens on the employer's own side. This sub-project does not add one; the employer
sees interview status when they next visit the application-review page, consistent
with that existing precedent.

## Scope

**In scope:**

- `Interview` (1:1 with `JobApplication`) and `InterviewSlot` (many, belongs to
  `Interview`): an employer proposes 2-3 candidate date/time slots plus an optional
  free-text location/link field.
- Claimant response: accept one proposed slot (confirms it, implicitly closes out the
  others) or decline all.
- Re-proposing: if a claimant declines all slots, the employer can propose a fresh set
  — this replaces the previous slots and resets the interview to `PROPOSED`, rather
  than accumulating a history of past rounds.
- A new claimant-facing "My Applications" page (`/claim/applications`) listing the
  claimant's own applications and, for any with a pending interview proposal, the
  slots to respond to.
- An automatic system `Message` to the claimant when an employer (re-)proposes slots,
  reusing the existing `caseworkerId: null` system-message pattern established by the
  hire flow.
- Employer-side UI on the existing application-review page
  (`/employer/job-postings/[id]`) to propose slots and see the interview's current
  state.

**Out of scope for this sub-project:**

- Any change to `JobApplication.status`, or to the Hire/Reject routes — Hire and
  Reject remain available on a `PENDING` application at any time, regardless of
  whether an interview was ever proposed, confirmed, or declined.
- Real video/conferencing integration — the location/link field is free text the
  employer fills in themselves (e.g., a pasted Zoom URL), never a real calendar or
  video-call integration, consistent with this app's established pattern of mocking
  or omitting third-party integrations rather than building them.
- Any employer-facing notification mechanism — none exists in this app today for
  anything, and this sub-project doesn't introduce the first one.
- A history of past interview rounds — re-proposing overwrites, it doesn't append.
- Editing a single proposed slot in place — declining and re-proposing (a fresh set)
  is the only path back to a new proposal.

## Data model

```prisma
enum InterviewStatus {
  PROPOSED
  CONFIRMED
  DECLINED
}

model Interview {
  id               String          @id @default(cuid())
  jobApplicationId String          @unique
  jobApplication   JobApplication  @relation(fields: [jobApplicationId], references: [id])
  status           InterviewStatus @default(PROPOSED)
  location         String?
  confirmedSlot    DateTime?
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt

  slots InterviewSlot[]
}

model InterviewSlot {
  id          String    @id @default(cuid())
  interviewId String
  interview   Interview @relation(fields: [interviewId], references: [id])
  startTime   DateTime
}
```

`JobApplication` gains a back-relation `interview Interview?`. An `Interview` is
created on first proposal (`status: PROPOSED`); accepting a slot sets
`status: CONFIRMED` and `confirmedSlot` to that slot's `startTime` (the `InterviewSlot`
rows themselves are left in place as a record of what was offered, not deleted);
declining all sets `status: DECLINED`. Re-proposing after `DECLINED` deletes the old
`InterviewSlot` rows, creates new ones, and resets `status` to `PROPOSED` and
`confirmedSlot` to `null`.

**Why 1:1 with `JobApplication` rather than a history table:** every other model this
app introduced for the marketplace (`CandidateProfile`, `EmploymentEvent`) represents
current state, not an append-only log — `AuditLog` is the one place history is
actually tracked, and every interview action here is already audited there. Adding a
separate `InterviewRound` history model would duplicate that without a stated need for
it in this slice.

## Flows

### Employer: propose and monitor

1. On `/employer/job-postings/[id]`, a `PENDING` application with no `Interview` yet
   shows a "Propose interview" action: 2-3 date/time fields and an optional
   location/link field.
2. Once proposed, that application's row shows the interview's current status
   (`Proposed`, `Confirmed — [time]`, or `Declined`) instead of the propose form.
3. If `DECLINED`, the propose form reappears in place of the status display, letting
   the employer submit a fresh set of slots.
4. Hire and Reject remain visible and functional on the application regardless of
   interview state, exactly as they already work today.

### Claimant: respond

1. `/claim/applications` (new page, new nav link) lists every `JobApplication` the
   claimant has, across every posting, with its status.
2. An application with a `PROPOSED` interview shows each slot with an "Accept" button,
   plus a "Decline all" action.
3. Accepting a slot confirms the interview (closes out the others implicitly — no
   separate action needed on the un-picked slots) and the page reflects
   `Confirmed — [time]` immediately.
4. Declining all sets the interview to `Declined`; the claimant sees that state and
   waits for the employer to either re-propose or resolve the application via
   Hire/Reject.

## Security & RBAC

- Propose/re-propose: `requireRole(['EMPLOYER'])`, plus an ownership check that the
  target `JobApplication`'s `jobPosting.employerId` matches the acting employer's
  `employerProfileId` — same pattern already established for Reject/Hire.
- Accept/decline: `requireRole(['CLAIMANT'])`, plus an ownership check that the target
  `JobApplication`'s `candidateProfile.claimantProfileId` matches the acting
  claimant's own `claimantProfileId`.
- Every propose, accept, and decline action writes an `AuditLog` row, attributed to
  the acting user, matching every other status-affecting write in this app.

## Error handling

- Proposing slots for an application that isn't `PENDING`, or one that already has a
  `PROPOSED` or `CONFIRMED` interview — 409 ("this application already has an active
  interview" / "this application is no longer open"). Re-proposing is only valid when
  the existing interview is `DECLINED`.
- Accepting or declining when the interview isn't `PROPOSED` (already `CONFIRMED` or
  `DECLINED`) — 409, using the same atomic `updateMany`-based compare-and-swap pattern
  already established for Reject/Hire, to correctly reject a race between two
  concurrent responses.
- Accepting a slot id that doesn't belong to the target interview — 404.

## Testing

- Integration: propose (ownership check, non-`PENDING`-application rejection,
  duplicate-proposal rejection), accept (confirms the right slot, 409 on an
  already-resolved interview, race-safety via the compare-and-swap), decline (sets
  `DECLINED`, 409 on already-resolved), re-propose after decline (slots replaced,
  status reset), the automatic `Message` on propose/re-propose.
- E2E: extend the existing marketplace flow — employer proposes slots for the
  candidate's application, claimant visits `/claim/applications`, accepts a slot,
  employer sees the confirmed state.
- Accessibility: axe-core scan of the new `/claim/applications` page, in both its
  empty state and with a pending proposal rendered.

## Success criteria

An employer can propose interview time slots for any `PENDING` application without
leaving the app. The candidate sees those slots on a new "My Applications" page and
can accept one or decline all, entirely in-app. A full decline lets the employer
propose again. None of this touches or gates the existing Hire/Reject flow.
