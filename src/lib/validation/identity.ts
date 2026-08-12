import { z } from 'zod';

export const identityVerificationSchema = z.object({
  legalName: z.string().min(1, 'Legal name is required'),
  dateOfBirth: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid date'),
  ssn: z.string().regex(/^\d{3}-\d{2}-\d{4}$/, 'SSN must be in 123-45-6789 format'),
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  mailingAddress: z.string().min(1, 'Mailing address is required'),
});

export type IdentityVerificationInput = z.infer<typeof identityVerificationSchema>;
