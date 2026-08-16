# Guided Demo Scenario Design

## Purpose

Every capability needed to demonstrate the full applicant lifecycle — apply,
schedule an interview, accept it, get hired, see a benefit claim react, have
a caseworker review the outcome — already exists and works. None of it is
easy to *show*. A presenter today has to know which of four seeded accounts
to log into for each moment of the story and click through each page
manually. This spec adds a guided walkthrough that drives a presenter
through the whole story with one button per step, plus fixes a pre-existing
gap (Employer has no one-click demo login, unlike Claimant and Caseworker).

## Background

The homepage (`src/app/page.tsx`) already has one-click demo login buttons
for Claimant and Caseworker (`enterDemo`, added for investor presentations —
see `5f8b5b5`), signing in via NextAuth credentials and redirecting to that
role's dashboard. Employer has no equivalent button.

Seed data (`prisma/seed.ts`) already carries a claimant ("Seed Claimant",
`claimant@example.com`) with a `CandidateProfile`, a `JobApplication` to the
"Warehouse Associate" posting at Riverbend Logistics Inc. (owned by the
seeded `employer@example.com`), and — as of the most recent seed change — an
`Interview` in `PROPOSED` status with two slots. A second claimant
(`claimant2@example.com`) carries a separate application with an interview
already `CONFIRMED`, built for an earlier version of this story that used
two claimants; this spec reworks the primary story around one claimant and
retires claimant2 to a secondary, unlinked testing role only (see Scope).

## Scope

**In scope:**

- Seed data: `claimant@example.com`'s claim changes from `RESTRICTED` to
  `ACTIVE` at creation, so hiring this same claimant later produces a
  visible `ACTIVE` → `RESTRICTED` transition (the hire route only flips
  `ACTIVE` claims; a claim already `RESTRICTED` shows no change). Nothing
  else about this claimant's seed data changes.
- A "Start Guided Demo" button on the homepage, and an "Enter Employer Demo"
  button matching the existing Claimant/Caseworker ones.
- A persistent floating widget, mounted in the root layout, driving a
  5-step walkthrough across Claimant → Employer → Claimant → Caseworker,
  entirely for Seed Claimant's Warehouse Associate application.
- Two new API routes: one resolving the dynamic IDs (posting id, claimant
  profile id) the widget needs to deep-link into pages; one resetting the
  specific records the walkthrough's two interactive steps (Accept, Hire)
  mutate, so the whole sequence is replayable.
- An unlinked internal page (`/demo/tools`, not linked from the homepage)
  offering direct login as `claimant2@example.com` and a manual "Reset
  guided demo data" button — for testing, not for presentations.

**Out of scope:**

- Any change to the Accept/Hire business logic itself, or to the
  independence of Hire/Reject from interview status (unchanged, per the
  interview-scheduling spec).
- A general-purpose "undo any action" tool. The reset endpoint targets
  exactly the records this specific walkthrough mutates — nothing else.
- Removing or restructuring `claimant2@example.com`'s existing seed data
  (its own confirmed-interview application stays as-is, just outside the
  primary guided sequence).
- Persisting guided-demo progress across browser sessions/devices, or for
  more than one concurrent presenter — `sessionStorage`-scoped state is
  sufficient and appropriately ephemeral for a live demo tool.

## The guided scenario

One claimant, one application, beginning to end:

1. **Claimant** (logs in as `claimant@example.com`, "Seed Claimant") →
   `/claim/applications`. *"Seed Claimant applied to Warehouse Associate at
   Riverbend Logistics. The employer has proposed two interview times —
   accept one below."* The presenter clicks Accept live (or, on a replay
   before reset, sees it's already confirmed — the page itself already
   renders that state correctly, so the instruction text is written to read
   sensibly either way without the widget needing to duplicate that check).
2. **Employer** (logs in as `employer@example.com`) → the Warehouse
   Associate posting's detail page. *"See the interview status reflect what
   the claimant just chose."*
3. **Employer** (same login, same page — no navigation on this
   transition). *"Click Hire to complete the process — watch what happens
   to Seed Claimant's benefit claim next."*
4. **Claimant** (logs back in as `claimant@example.com`) →
   `/claim/dashboard`. *"Seed Claimant's claim was Active — see it flip to
   Restricted the moment they were hired."*
5. **Caseworker** (logs in as `caseworker@example.com`) → Seed Claimant's
   case page (`/staff/claimants/[claimantProfileId]`). *"See how a
   caseworker reviews the resulting record: the hire event, claim status,
   wage records, certifications, and the audit trail behind every automated
   decision."*

Every step's header names the currently-active account explicitly (e.g.
"Now viewing as: Seed Claimant, claimant@example.com") so an account switch
never appears unexplained.

## Data flow

**Starting the demo:** the homepage's "Start Guided Demo" button writes
step `1` to `sessionStorage` under a single key
(`emplement-guided-demo-step`), signs in as `claimant@example.com` via the
same `signIn('credentials', { redirect: false })` call the existing demo
buttons use, and navigates to `/claim/applications`.

**`GuidedDemoWidget`** (mounted once in `src/app/layout.tsx`, so it persists
across every page navigation without remounting): on mount, reads the
sessionStorage step key. If unset, renders nothing. If set, it fetches
`GET /api/demo/scenario-links` once (cached in component state for the rest
of the session) to resolve the two IDs it needs — the Warehouse Associate
posting's id and Seed Claimant's `claimantProfileId` — then renders the
current step's title, the "now viewing as" line, and the instruction text
from `src/lib/demoScenario.ts`'s step data. Rendered as a fixed-position
panel in the bottom-right corner (`className="fixed"`, the same CSS
mechanism `SessionTimeoutWarning` already uses for its own always-on-top
overlay, though this is the first persistent *corner* panel in the app
rather than a full-screen modal), so it never displaces a page's own
content or interferes with the page-level `main` landmark's tab order. Its
Next/Finish button follows the same disabled-while-pending pattern the
homepage's existing demo buttons already use, so a slow `signIn` or
navigation can't be double-clicked into a second in-flight transition.

**Advancing a step** ("Next" / "Hire, then continue" / "Finish" — button
label follows the step): looks up the next step's role.
- Same role as the current step (step 2 → 3): just increments the
  sessionStorage step and re-renders; no login or navigation.
- Different role (steps 1→2, 3→4, 4→5): calls `signIn('credentials', {
  redirect: false, email, password })` for that role's seeded account, then
  `router.push` to that step's target page (built from the resolved IDs
  where needed), then increments the sessionStorage step.
- Step 5's button reads "Finish" — clears the sessionStorage step (ending
  guided mode; the widget unmounts itself) rather than advancing further.
- An "Exit demo" control is available on every step, also just clearing the
  sessionStorage key.

**`GET /api/demo/scenario-links`**: unauthenticated (the IDs it returns —
a `JobPosting` id and a `ClaimantProfile` id — aren't sensitive; this app
already treats posting ids as freely visible via `/claim/browse-postings`).
Looks up the Warehouse Associate posting by `title` + owning employer's
`companyName`, and Seed Claimant's `claimantProfileId` via their known seed
email, both by well-known fixture identity rather than a hardcoded id.
Returns `404` with a clear message if either lookup fails (e.g. demo data
was never seeded in this environment) — the widget shows that message
in place of the step content rather than crashing.

**`POST /api/demo/reset`**: requires *some* authenticated session (any of
the 4 demo roles — this is a demo-utility guard, not a business-permission
one; `getServerAuthSession()` returning null is the only check). Reverts
exactly what steps 1–3 can mutate, resolved the same way as
`scenario-links` (by known seed identity, not a hardcoded id):

- `Interview` (Seed Claimant × Warehouse Associate): `status` → `PROPOSED`,
  `confirmedSlot` → `null`. `InterviewSlot` rows are never touched by
  Accept in the first place, so they need no changes.
- `JobApplication`: `status` → `PENDING`.
- `JobPosting` (Warehouse Associate): `status` → `OPEN`.
- `Claim` (Seed Claimant's): `status` → `ACTIVE`.
- `EmploymentEvent` where `matchedClaimantProfileId` = Seed Claimant's
  profile and `type` = `HIRE`: deleted (this can only exist as a result of
  the guided demo's own Hire step — the seed data's other unmatched event,
  "Pat Reyes", has no `matchedClaimantProfileId` and is untouched).
- `Message` to Seed Claimant with subject `"Your claim status has
  changed"`: deleted.

`AuditLog` entries created along the way are deliberately left alone —
they're an appropriate permanent record even in a demo, and nothing in the
walkthrough's own visibility depends on them being absent. If any of the
expected seed records don't exist at all (unseeded environment), the route
returns a clear `404` rather than a silent no-op, so a failed reset isn't
mistaken for a successful one.

**`/demo/tools`** (unlinked, no link from the homepage — reached only by
typing the URL): a plain page offering a "Log in as Seed Claimant Two"
button (same `enterDemo`-style flow, existing account, existing dashboard)
and a "Reset guided demo data" button that calls the reset route and shows
its result. The page itself has no additional access gate beyond being
unlinked, matching the "internal tool, not a public feature" intent — the
reset action is still gated by the reset route's own auth check.

## Error handling

- A failed `signIn` during any step transition shows the same inline error
  message pattern the existing homepage demo buttons use ("The demo login
  is temporarily unavailable. Please try again.") and does not advance the
  step.
- A failed `scenario-links` fetch replaces the step content with a plain
  explanation that demo data isn't available in this environment, with no
  further action offered (there's nothing productive to retry without
  re-seeding).
- The reset route's `404` (missing seed records) is surfaced verbatim on
  `/demo/tools` as the result message.

## Testing

- Unit: `POST /api/demo/reset` — seed a state matching what steps 1–3 would
  produce (Interview CONFIRMED, Application HIRED, Posting FILLED, Claim
  RESTRICTED, the generated EmploymentEvent and Message present), call the
  route, assert every field listed above reverts exactly and that
  `AuditLog` rows are untouched. Also: calling reset against a clean
  (never-hired) state is a harmless no-op-equivalent (fields already at
  their target values).
- Unit: `GET /api/demo/scenario-links` — returns the correct posting id and
  claimant profile id for known seed data; `404` when the expected posting
  or claimant doesn't exist.
- Component: `GuidedDemoWidget` renders nothing with no sessionStorage step
  set; renders the correct step's title/instruction/button label for a
  given step number; a failed mocked `signIn` shows the error and does not
  advance the stored step.
- E2E: a full walkthrough — start the guided demo from the homepage, click
  through all 5 steps' buttons, and assert each page's expected state
  (proposed → confirmed interview, Hire button → hired status, claim
  Active → Restricted, the hire event appears on the caseworker's case
  page). Then call reset and confirm the walkthrough can be run a second
  time from the same starting state. Also: an accessibility scan of the
  widget itself (present across a couple of representative pages) and of
  `/demo/tools`.

## Success criteria

A presenter clicks "Start Guided Demo" once and, using only the widget's
step buttons plus the two real actions already built into the app (Accept,
Hire), walks a viewer through the complete apply-to-benefit-status story
for one claimant across all three roles — then resets and repeats it for
the next presentation, without needing to know which of four accounts to
log into or which page holds the next piece of the story.
