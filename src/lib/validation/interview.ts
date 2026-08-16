import { z } from 'zod';

export const proposeInterviewSchema = z.object({
  slots: z
    .array(z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid date/time'))
    .min(2, 'Propose at least 2 time slots')
    .max(3, 'Propose at most 3 time slots'),
  location: z.string().optional(),
});

export type ProposeInterviewInput = z.infer<typeof proposeInterviewSchema>;
