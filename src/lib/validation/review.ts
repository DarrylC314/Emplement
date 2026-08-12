import { z } from 'zod';

export const reviewActionSchema = z.object({
  action: z.enum(['APPROVED', 'DENIED', 'FLAGGED_FOR_FRAUD', 'AMOUNT_ADJUSTED']),
  reason: z.string().min(1, 'A reason is required for every review action'),
  newValue: z.string().optional(),
});

export type ReviewActionInput = z.infer<typeof reviewActionSchema>;
