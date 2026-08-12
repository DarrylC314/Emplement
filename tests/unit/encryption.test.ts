import { describe, it, expect, beforeAll } from 'vitest';
import { encryptSSN, decryptSSN, maskSSN } from '@/lib/encryption';

beforeAll(() => {
  process.env.SSN_ENCRYPTION_KEY =
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
});

describe('SSN encryption', () => {
  it('round-trips plaintext through encrypt and decrypt', () => {
    const plain = '123-45-6789';
    const ciphertext = encryptSSN(plain);
    expect(ciphertext).not.toBe(plain);
    expect(decryptSSN(ciphertext)).toBe(plain);
  });

  it('produces different ciphertext for the same input on repeated calls', () => {
    const plain = '123-45-6789';
    expect(encryptSSN(plain)).not.toBe(encryptSSN(plain));
  });

  it('masks an SSN to show only the last 4 digits', () => {
    expect(maskSSN('123-45-6789')).toBe('***-**-6789');
  });

  it('rejects tampered ciphertext (auth tag mismatch)', () => {
    const plain = '123-45-6789';
    const ciphertext = encryptSSN(plain);
    const [iv, authTag, data] = ciphertext.split(':');

    // Tamper with the auth tag by flipping a hex character
    const tamperedAuthTag = authTag
      .split('')
      .map((c, i) => (i === 0 ? (parseInt(c, 16) ^ 1).toString(16) : c))
      .join('');
    const tamperedCiphertext = `${iv}:${tamperedAuthTag}:${data}`;

    expect(() => decryptSSN(tamperedCiphertext)).toThrow();
  });
});
