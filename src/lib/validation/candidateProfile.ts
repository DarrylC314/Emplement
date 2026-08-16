import { z } from 'zod';
import { TAG_CATEGORY_VALUES } from '@/lib/tagOptions';

export const candidateProfileSchema = z.object({
  headline: z.string().min(1, 'Headline is required'),
  skills: z.string().min(1, 'Skills are required'),
  bio: z.string().optional(),
  availability: z.string().min(1, 'Availability is required'),
  tags: z.array(z.enum(TAG_CATEGORY_VALUES)).optional().default([]),
});

export type CandidateProfileInput = z.infer<typeof candidateProfileSchema>;
