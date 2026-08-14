// Deterministic, simulated FEIN verification — no real business-registry
// integration (a later-phase concern). Mirrors the existing MockIDProof
// pattern: this app's mocked external services model the happy path
// consistently rather than simulating failure branches with no real backing
// service to fail against — the format/presence checks below exist as a
// defensive fallback behind the same checks Zod already performs, not as a
// meaningful "verification" of business legitimacy.
export function verifyFein(fein: string, companyName: string): { verified: boolean } {
  return { verified: /^\d{2}-\d{7}$/.test(fein) && companyName.trim().length > 0 };
}
