# Claimant Identity Fields (Prefix, Suffix, Gender) — Design

## Purpose

Adds three optional identity fields — name prefix, name suffix, and gender — to
`ClaimantProfile`. This is the first of two related sub-projects identified while
scoping the next phase of the Employer Portal: the second (a staff-facing queue for
manually resolving employer-reported hire/separation events that didn't
automatically match any claimant) wants to let staff search claimants by these
fields, cross-referenced with existing ones (legal name, date of birth), to help
disambiguate between similarly-named claimants. That second sub-project is deferred
to its own design once this one ships.

These fields are collected once here and are independently useful — this is not a
speculative addition kept alive only by a future consumer.

## Background / relationship to existing work

`ClaimantProfile` currently collects identity data (`legalName`, `dateOfBirth`,
`ssnEncrypted`/`ssnHash`, `phone`, `mailingAddress`) during the identity-verification
flow (`/claim/verify-identity` → `POST /api/identity-verification/callback`), not at
bare signup (signup is email/password only, matching the pattern later reused for
employer signup). This addition follows that same placement.

## Scope

**In scope:**

- `NamePrefix` enum (`MR | MRS | MS | DR | MX`) and `NameSuffix` enum
  (`JR | SR | II | III | IV`) — fixed lists, no free-text "Other" escape hatch (a
  deliberate choice: keeps every stored value one of a known few, which is what
  makes the field useful for the future search feature it exists to support)
- `gender: String?` — free text, no fixed list (unlike prefix/suffix, gender is
  sensitive enough that constraining it to a maintained enum isn't appropriate)
- All three fields optional at every stage: not required to complete identity
  verification, distinct from the existing required `legalName`/`dateOfBirth`/SSN
- Collected via the identity-verification form, alongside the existing fields
- Displayed on the staff case-detail page (`/staff/claimants/[id]`) next to the
  existing legal name display

**Out of scope (explicitly deferred):**

- The staff search/matching feature that motivated this — its own future spec
- Any change to `legalName` itself (e.g. splitting it into first/middle/last) —
  prefix/suffix are additive to the existing single combined field, not a
  restructuring of it
- Displaying these fields to the claimant themselves (their own dashboard) — they
  exist for staff-side identification, not claimant-facing profile display
- Editing these fields after initial identity verification — same lifecycle as
  `legalName`/`dateOfBirth` today (set once via the verification flow; no separate
  edit UI exists for those either, so none is added here)

## Data model

```prisma
enum NamePrefix {
  MR
  MRS
  MS
  DR
  MX
}

enum NameSuffix {
  JR
  SR
  II
  III
  IV
}

model ClaimantProfile {
  // ...existing fields unchanged...
  prefix NamePrefix?
  suffix NameSuffix?
  gender String?
}
```

No changes to any other model. No new relations, no new tables.

## Flows

### Claimant: identity verification

1. `/claim/verify-identity` form gains two new optional dropdowns (prefix, suffix)
   and one new optional text field (gender), alongside the existing required
   legal-name/DOB/SSN/phone/address fields.
2. `POST /api/identity-verification/callback` accepts all three as optional in its
   Zod schema and passes them through to the `ClaimantProfile` update alongside the
   existing fields — no new validation logic beyond "if present, must be a valid
   enum value" for prefix/suffix.
3. Omitting any of the three is a normal, valid submission — no different from how
   the route already needs to handle genuinely-absent optional data elsewhere.

### Staff: viewing claimant identity

- `/staff/claimants/[id]` renders prefix/suffix next to the existing legal name
  display, built as: `[prefix label] legalName[, suffix label]` — prefix and its
  trailing space are omitted entirely if unset; the suffix and its leading comma are
  omitted entirely if unset. E.g. all three set → "Dr. Jane Smith, Jr."; only suffix
  set → "Jane Smith, Jr."; only prefix set → "Dr. Jane Smith"; neither set → "Jane
  Smith" (identical to today's display). `gender`, if set, renders as its own
  separate labeled field ("Gender: <value>") near the name, not folded into the name
  string — it's free text and doesn't belong inside a formatted name the way a
  prefix/suffix does.

## Error handling

- Prefix/suffix: Zod enum validation rejects any value outside the fixed list —
  same pattern as every other enum-backed field already validated in this codebase.
- Gender: no format validation beyond normal string length/sanitization already
  applied to other free-text fields in this form (e.g. `mailingAddress`).
- All three being absent is not an error at any layer.

## Testing

- Unit: `NamePrefix`/`NameSuffix` enum values round-trip through Prisma correctly.
- Integration: `POST /api/identity-verification/callback` — one test with all three
  fields provided (confirms they're stored), one test with all three omitted
  (confirms the callback still succeeds and the profile ends up with `null`s, not an
  error).
- Accessibility: the two new dropdowns and one new text field on
  `/claim/verify-identity` get the same visible-label + `aria-describedby`
  treatment as every other field on that form, covered by the existing axe-core scan
  of that route (no new scan needed — the route is already covered, this just adds
  fields to what's scanned).

## Success criteria

A claimant completing identity verification can optionally provide a name prefix,
name suffix, and gender. Staff viewing that claimant's case-detail page see whichever
of those three were provided, displayed alongside the claimant's legal name. Omitting
all three works exactly as it does today for every other optional field in this app.
