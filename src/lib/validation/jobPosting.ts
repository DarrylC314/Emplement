import { z } from 'zod';
import { TAG_CATEGORY_VALUES } from '@/lib/tagOptions';

export const jobPostingSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  location: z.string().min(1, 'Location is required'),
  tags: z.array(z.enum(TAG_CATEGORY_VALUES)).optional().default([]),
});

export type JobPostingInput = z.infer<typeof jobPostingSchema>;
