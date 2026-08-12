import { z } from 'zod';

export const jobSearchActivitySchema = z.object({
  employerName: z.string().min(1),
  contactMethod: z.string().min(1),
  contactDate: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid date'),
  position: z.string().min(1),
});

export const weeklyCertificationSchema = z.object({
  weekEndingDate: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid date'),
  ableAndAvailable: z.boolean(),
  workedThisWeek: z.boolean(),
  earnings: z.number().min(0, 'Earnings cannot be negative'),
  refusedWork: z.boolean(),
  jobSearchActivities: z.array(jobSearchActivitySchema),
});

export type WeeklyCertificationInput = z.infer<typeof weeklyCertificationSchema>;
