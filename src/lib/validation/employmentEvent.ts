import { z } from 'zod';

export const employmentEventSchema = z.object({
  employeeName: z.string().min(1, 'Employee name is required'),
  ssn: z.string().regex(/^\d{3}-\d{2}-\d{4}$/, 'SSN must be in 123-45-6789 format'),
  type: z.enum(['HIRE', 'SEPARATION']),
  eventDate: z.string().refine((v) => !isNaN(Date.parse(v)), 'Invalid date'),
});

export type EmploymentEventInput = z.infer<typeof employmentEventSchema>;
