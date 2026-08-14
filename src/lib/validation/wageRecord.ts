import { z } from 'zod';

export const wageRecordUpdateSchema = z.object({
  confirmed: z.boolean(),
  disputeNote: z.string().min(1).optional(),
  employerName: z.string().min(1).optional(),
  fein: z.string().min(1).optional(),
  workLocation: z.string().min(1).optional(),
  jobTitle: z.string().min(1).optional(),
  wageRate: z.number().min(0).optional(),
  hoursPerWeek: z.number().min(0).optional(),
  separationReason: z.string().min(1).optional(),
  firstDayWorked: z
    .string()
    .refine((v) => !isNaN(Date.parse(v)), 'Invalid date')
    .optional(),
  lastDayWorked: z
    .string()
    .refine((v) => !isNaN(Date.parse(v)), 'Invalid date')
    .nullable()
    .optional(),
  recallDate: z
    .string()
    .refine((v) => !isNaN(Date.parse(v)), 'Invalid date')
    .nullable()
    .optional(),
});

export type WageRecordUpdateInput = z.infer<typeof wageRecordUpdateSchema>;
