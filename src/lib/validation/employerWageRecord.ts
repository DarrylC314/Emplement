import { z } from 'zod';

export const employerWageRecordUpdateSchema = z.object({
  disputeNote: z.string().min(1).optional(),
});

export type EmployerWageRecordUpdateInput = z.infer<typeof employerWageRecordUpdateSchema>;
