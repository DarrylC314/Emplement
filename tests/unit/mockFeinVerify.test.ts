import { describe, it, expect } from 'vitest';
import { verifyFein } from '@/lib/mockFeinVerify';

describe('verifyFein', () => {
  it('succeeds for a well-formed FEIN and a non-empty company name', () => {
    expect(verifyFein('43-1234567', 'Acme Corp')).toEqual({ verified: true });
  });

  it('fails for a malformed FEIN', () => {
    expect(verifyFein('not-a-fein', 'Acme Corp')).toEqual({ verified: false });
  });

  it('fails for an empty company name', () => {
    expect(verifyFein('43-1234567', '   ')).toEqual({ verified: false });
  });
});
