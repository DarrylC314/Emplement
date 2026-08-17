import { z } from 'zod';
import { TAG_CATEGORY_VALUES } from '@/lib/tagOptions';

// Central Time, matching centralTimeEndOfDayToUtc's own interpretation of
// what "today" means for this business — a posting's effective start date
// is the day it's created, and an employer setting a fixed-term end date
// earlier than that (in the same timezone the date itself is interpreted
// in) is always a mistake, not a valid input.
function todayInCentralTime(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export const jobPostingSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  location: z.string().min(1, 'Location is required'),
  tags: z.array(z.enum(TAG_CATEGORY_VALUES)).optional().default([]),
  expectedEndDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected end date must be in YYYY-MM-DD format')
    .refine(
      // YYYY-MM-DD strings compare correctly with a plain string comparison.
      (value) => value >= todayInCentralTime(),
      'Expected end date cannot be before the posting\'s start date (today)'
    )
    .optional(),
});

export type JobPostingInput = z.infer<typeof jobPostingSchema>;
