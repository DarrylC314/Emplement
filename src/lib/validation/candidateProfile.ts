import { z } from 'zod';

export const candidateProfileSchema = z.object({
  headline: z.string().min(1, 'Headline is required'),
  skills: z.string().min(1, 'Skills are required'),
  bio: z.string().optional(),
  availability: z.string().min(1, 'Availability is required'),
});

export type CandidateProfileInput = z.infer<typeof candidateProfileSchema>;
