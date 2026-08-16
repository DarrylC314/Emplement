import { z } from 'zod';

export const jobPostingSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.string().min(1, 'Description is required'),
  location: z.string().min(1, 'Location is required'),
});

export type JobPostingInput = z.infer<typeof jobPostingSchema>;
