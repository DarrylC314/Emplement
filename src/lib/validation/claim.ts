import { z } from 'zod';

export const claimInitiationSchema = z.object({
  reasonForSeparation: z.enum(['LAYOFF', 'FIRED', 'QUIT', 'CONTRACT_ENDED', 'OTHER']),
  benefitYearStart: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid date'),
});

export type ClaimInitiationInput = z.infer<typeof claimInitiationSchema>;
