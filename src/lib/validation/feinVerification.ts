import { z } from 'zod';

export const feinVerificationSchema = z.object({
  fein: z.string().regex(/^\d{2}-\d{7}$/, 'FEIN must be in 12-3456789 format'),
  companyName: z.string().min(1, 'Company name is required'),
});

export type FeinVerificationInput = z.infer<typeof feinVerificationSchema>;
