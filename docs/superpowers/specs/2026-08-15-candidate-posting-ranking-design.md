# Automated Candidate/Posting Ranking Design

## Purpose

Builds the second sub-project of "Phase 3: employer marketplace" — automated ranking,
named in the first slice's roadmap as: *"surfacing likely-fit candidates to employers
and likely-fit postings to candidates, instead of requiring manual browse for both
directions."* This closes the gap between "everything is a flat, unfiltered list" (the
first slice's deliberate v1 simplicity) and actually helping both sides find good
matches faster.

## Background / relationship to existing work

The first marketplace slice
(`docs/superpowers/specs/2026-08-15-employer-marketplace-slice-design.md`, merged to
`master` at commit `fe25df8`) built `CandidateProfile` and `JobPosting` with only
free-text fields — `headline`/`skills`/`bio`/`availability` on one side,
`title`/`description`/`location` on the other. There is no structured vocabulary to
match on, and no ranking of any kind: `GET /api/job-postings` and
`GET /api/employer/candidates` both return a plain, unfiltered, most-recent-first list.

This sub-project adds a fixed tag taxonomy to both models and uses tag overlap to
surface a "Recommended for you" section ahead of the existing full list — the full
list itself is untouched.

## Scope

**In scope:**

- A fixed `TagCategory` enum (25 values, modeled on the U.S. Bureau of Labor
  Statistics' Standard Occupational Classification major groups, plus a `GIG_ECONOMY`
  category for rideshare/delivery/task-based/brand-ambassador work) — broad enough to
  cover every profession a claimant or employer might represent, not just the
  blue-collar-skewed roles implied by the first slice's own test data.
- Optional, multi-select tags on both `CandidateProfile` and `JobPosting`.
- A new reusable multi-select `CheckboxGroup` UI component (this codebase's existing
  `Fieldset` component is single-select/radio only).
- Claimant-side ranking: a "Recommended for you" section on `/claim/browse-postings`,
  above the existing full list, showing postings that share at least one tag with the
  claimant's own `CandidateProfile.tags`.
- Employer-side ranking: a posting selector on `/employer/browse-candidates` (reusing
  the selector the existing reach-out form already needs) driving a "Recommended for
  [posting title]" section, showing candidates that share at least one tag with the
  *selected posting's* tags.
- Extending four existing Prisma `select` blocks to include `tags` — no new API
  routes. Ranking is computed client-side from data these pages already fetch.

**Out of scope for this sub-project:**

- Live interview scheduling (the roadmap's third named sub-project — separate work).
- Any change to the existing full, unranked list — it stays exactly as the first
  slice built it, just with a new section above it.
- Editing tags after profile/posting creation (matches the first slice's own
  create-only precedent for both models).
- Any tag vocabulary beyond the fixed 25 — extending the list later is a normal
  schema migration, not a runtime-configurable admin feature.
- Weighting or scoring beyond a simple overlap count (e.g. no per-tag importance,
  no recency decay, no machine-learned relevance).

## Data model

```prisma
enum TagCategory {
  MANAGEMENT
  BUSINESS_FINANCIAL
  COMPUTER_MATHEMATICAL
  ARCHITECTURE_ENGINEERING
  SCIENCE
  COMMUNITY_SOCIAL_SERVICE
  LEGAL
  EDUCATION_TRAINING
  ARTS_DESIGN_MEDIA
  SPORTS_ENTERTAINMENT
  HEALTHCARE_PRACTITIONER
  HEALTHCARE_SUPPORT
  PROTECTIVE_SERVICE
  FOOD_SERVICE
  BUILDING_GROUNDS_MAINTENANCE
  PERSONAL_CARE_SERVICE
  SALES
  OFFICE_ADMINISTRATIVE
  FARMING_FISHING_FORESTRY
  CONSTRUCTION
  INSTALLATION_MAINTENANCE_REPAIR
  PRODUCTION_MANUFACTURING
  TRANSPORTATION_MATERIAL_MOVING
  MILITARY_SPECIFIC
  GIG_ECONOMY
}
```

`CandidateProfile` gains `tags TagCategory[] @default([])`. `JobPosting` gains the
same. Both are Postgres native array columns — no join table, no cardinality limit
enforced at the schema level (the UI caps selection at all 25, i.e. no artificial
limit; nothing stops someone from selecting every tag, though the UI won't encourage
it).

Existing rows (if any exist in a given environment) get `tags: []` by default via the
migration — they simply never appear in a "Recommended" section until edited, but
remain fully visible in the existing full lists, matching the "optional" design
decision below.

## Tag selection UI

New component `src/components/ui/CheckboxGroup.tsx`, a multi-select sibling to the
existing single-select `Fieldset` (`src/components/ui/Fieldset.tsx`) — same props
shape adapted for an array value instead of a single string, same accessible
`<fieldset>`/`<legend>` structure, same error-association pattern.

Added as an optional field (no `required` marker, no validation minimum) to:
- The candidate-profile creation form (`src/app/claim/candidate-profile/page.tsx`) —
  label "Tags (optional)".
- The job-posting creation form (`src/app/employer/job-postings/page.tsx`) — label
  "Tags (optional)".

Both forms' Zod schemas (`src/lib/validation/candidateProfile.ts`,
`src/lib/validation/jobPosting.ts`) gain `tags: z.array(z.nativeEnum(TagCategory)).optional().default([])`.

## Ranking mechanics

**Why no new API routes:** every list this ranks over is already fetched in full by
the existing pages (`GET /api/job-postings` for claimants, `GET /api/employer/candidates`
for employers, plus `GET /api/candidate-profile` and `GET /api/employer/job-postings`
for each viewer's own tags). Given this pilot's scale — the same scale that justified
"plain, unfiltered list, no pagination" in the first slice — adding parallel
ranking-specific backend routes would duplicate data these pages already have in
memory. Instead, four existing routes' `select` blocks gain a `tags: true` field, and
a small, pure, unit-testable scoring function does the ranking client-side:

```ts
// src/lib/ranking.ts
function scoreByTagOverlap<T extends { tags: TagCategory[] }>(
  viewerTags: TagCategory[],
  items: T[]
): T[] {
  return items
    .map((item) => ({
      item,
      score: item.tags.filter((t) => viewerTags.includes(t)).length,
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score) // ties keep original (createdAt desc) order
    .slice(0, 5)
    .map(({ item }) => item);
}
```

**Claimant side** (`/claim/browse-postings`): on load, the page already fetches the
full `GET /api/job-postings` list; it additionally fetches the claimant's own
`GET /api/candidate-profile` (already exists, extended to return `tags`). If the
claimant has a profile with at least one tag, a "Recommended for you" section renders
above the full list, populated by `scoreByTagOverlap(myTags, allPostings)`. If the
claimant has no candidate profile yet, or their profile has zero tags, or nothing
matches, the section is omitted entirely — no empty-state placeholder, since the full
list directly below already serves that purpose.

**Employer side** (`/employer/browse-candidates`): the page already fetches the
employer's own open postings (`GET /api/employer/job-postings`, extended to return
`tags`) to populate the existing reach-out posting selector. That same selector now
also drives a "Recommended for [posting title]" section, populated by
`scoreByTagOverlap(selectedPosting.tags, allCandidates)` against the already-fetched
`GET /api/employer/candidates` list (extended to return `tags`). Recomputes
(client-side, no refetch) whenever the selector changes. If the employer has no open
postings, or the selected posting has zero tags, or nothing matches, the section is
omitted — same reasoning as the claimant side.

## Security & RBAC

No new routes means no new RBAC surface. The four extended `select` blocks add only
`tags` — already-established PII-minimal exposure on the two browse routes is
unaffected, since `tags` carries no PII (it's derived from the acting user's own
choices, same category as `headline`/`skills`/`availability`).

## Error handling

- No new error paths: tag selection is optional and unvalidated beyond "must be a
  member of `TagCategory`" (enforced by `z.nativeEnum`), so an omitted or empty `tags`
  array is never an error case, on either creation form.
- Client-side ranking has no failure mode of its own — if either underlying fetch
  (postings/candidates, or the viewer's own tags) fails, the existing `loadError`
  handling on each page already covers it; the "Recommended" section simply doesn't
  render if its inputs aren't available, same as the omitted-empty-state cases above.

## Testing

- Integration: each of the four extended routes returns `tags` correctly (a
  regression-style assertion added to each route's existing test file, not a new
  file).
- Unit: `scoreByTagOverlap` — no overlap excluded, ties keep insertion order, cap at
  5, empty input arrays handled.
- E2E: extend the existing full-flow spec
  (`tests/e2e/employer-marketplace-flow.spec.ts`) to tag both the candidate profile
  and the job posting with an overlapping tag, and assert each side's "Recommended"
  section shows the other.
- Accessibility: axe-core scan of `/claim/browse-postings` and
  `/employer/browse-candidates` in their new state (with a "Recommended" section
  rendered), extending the existing scans rather than adding new ones.

## Success criteria

A claimant who has tagged their candidate profile sees a short, ranked "Recommended
for you" list of postings sharing at least one tag, above the existing full list. An
employer who selects one of their own postings sees a short, ranked "Recommended for
[posting]" list of candidates sharing at least one tag with that posting, above the
existing full list. Neither section appears, with no error, when there's nothing to
recommend. The full, unranked lists both directions already had are unchanged.
