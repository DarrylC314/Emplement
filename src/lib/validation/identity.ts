import { z } from 'zod';

// Empty-string inputs (an unselected dropdown, an empty text field) are
// treated as "not provided," not as an invalid enum value or a stored empty
// string — these three fields are optional everywhere, and the client always
// sends every form key regardless of whether the user filled it in. Explicit
// JSON `null` is treated the same way, so a future caller that encodes "not
// provided" as `null` (rather than omitting the key or sending '') isn't
// rejected with a type error.
const optionalEnum = <const T extends [string, ...string[]]>(values: T) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), z.enum(values).optional());

export const identityVerificationSchema = z.object({
  legalName: z.string().min(1, 'Legal name is required'),
  dateOfBirth: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid date'),
  ssn: z.string().regex(/^\d{3}-\d{2}-\d{4}$/, 'SSN must be in 123-45-6789 format'),
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  mailingAddress: z.string().min(1, 'Mailing address is required'),
  prefix: optionalEnum(['MR', 'MRS', 'MS', 'DR', 'MX']),
  suffix: optionalEnum(['JR', 'SR', 'II', 'III', 'IV']),
  gender: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().optional()),
});

export type IdentityVerificationInput = z.infer<typeof identityVerificationSchema>;
