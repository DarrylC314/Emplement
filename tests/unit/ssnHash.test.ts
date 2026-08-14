import { describe, it, expect } from 'vitest';
import { hashSSN } from '@/lib/ssnHash';

describe('hashSSN', () => {
  it('is deterministic: the same SSN always produces the same hash', () => {
    const first = hashSSN('123-45-6789');
    const second = hashSSN('123-45-6789');
    expect(first).toBe(second);
  });

  it('produces different hashes for different SSNs', () => {
    const a = hashSSN('123-45-6789');
    const b = hashSSN('987-65-4321');
    expect(a).not.toBe(b);
  });

  it('produces a hex-encoded SHA-256-length string', () => {
    const hash = hashSSN('123-45-6789');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
