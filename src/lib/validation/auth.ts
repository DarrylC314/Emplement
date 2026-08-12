import { z } from 'zod';

export const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(10, 'Password must be at least 10 characters'),
});

export type SignupInput = z.infer<typeof signupSchema>;
