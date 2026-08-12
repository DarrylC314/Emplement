import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

function getKey(): Buffer {
  const hex = process.env.SSN_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      'SSN_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)'
    );
  }
  return Buffer.from(hex, 'hex');
}

/** Encrypts a plaintext SSN. Returns "iv:authTag:ciphertext", all hex-encoded. */
export function encryptSSN(plain: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/** Decrypts a value produced by encryptSSN. */
export function decryptSSN(ciphertext: string): string {
  const key = getKey();
  const [ivHex, authTagHex, dataHex] = ciphertext.split(':');
  if (!ivHex || !authTagHex || !dataHex) {
    throw new Error('Malformed SSN ciphertext');
  }
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

/** Masks a plaintext SSN to "***-**-1234" for display. */
export function maskSSN(plain: string): string {
  const digits = plain.replace(/\D/g, '');
  const last4 = digits.slice(-4);
  return `***-**-${last4}`;
}
