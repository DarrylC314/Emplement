import crypto from 'crypto';

function getHashKey(): string {
  const key = process.env.SSN_HASH_KEY;
  if (!key) {
    throw new Error('SSN_HASH_KEY must be set');
  }
  return key;
}

/**
 * Deterministic, one-way HMAC-SHA256 of a plaintext SSN, for equality
 * matching only (e.g. an employer-reported hire/separation event against an
 * existing claimant record) — never used for display or reversed. Uses a
 * separate secret from SSN_ENCRYPTION_KEY: encryption (reversible, for
 * display) and hashing (one-way, for matching) are different security
 * properties and shouldn't share a key.
 */
export function hashSSN(plain: string): string {
  const key = getHashKey();
  return crypto.createHmac('sha256', key).update(plain).digest('hex');
}
