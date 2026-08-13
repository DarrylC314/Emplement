import { expect } from 'vitest';

const FORBIDDEN_KEYS = ['passwordHash', 'ssnEncrypted'] as const;

/** Collects every object key appearing anywhere in a JSON-shaped value. */
function collectKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, acc);
  } else if (value !== null && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      acc.add(key);
      collectKeys(nested, acc);
    }
  }
  return acc;
}

/**
 * Shared regression guard for the staff routes' PII hygiene.
 *
 * Both `/api/staff/claimants` and `/api/staff/queue` previously used
 * `include: { ... claimant: true }` / `include: { user: true }`, which ships the
 * whole User row (passwordHash) and the whole ClaimantProfile (ssnEncrypted,
 * dateOfBirth, phone, mailingAddress) to the browser. Those were replaced with
 * explicit `select`s. This asserts the leak cannot silently come back: neither
 * the key nor the actual stored secret value may appear anywhere in the body.
 */
export function expectNoSensitiveFields(payload: unknown, sentinelValues: string[] = []): void {
  const keys = collectKeys(payload);
  for (const forbidden of FORBIDDEN_KEYS) {
    expect(
      keys.has(forbidden),
      `response body must not contain a "${forbidden}" field anywhere`
    ).toBe(false);
  }

  const serialized = JSON.stringify(payload);
  for (const sentinel of sentinelValues) {
    expect(
      serialized.includes(sentinel),
      'response body must not contain the stored secret value'
    ).toBe(false);
  }
}
