import { prisma } from '@/lib/prisma';

/**
 * Creates a User row and its role-specific profile row (ClaimantProfile or
 * EmployerProfile) atomically, inside a single transaction.
 *
 * Both /api/signup and /api/employer/signup used to make these as two
 * separate, unwrapped `prisma.create` calls. If the second create failed for
 * any reason, the first was left orphaned: a user row with no profile.
 * Every profile-scoped route then 404s "profile not found" for that account,
 * and re-signup with the same email 409s ("already exists") — a permanently
 * broken account with no way to recover except manual DB intervention.
 * Wrapping both creates in `prisma.$transaction` means either both rows are
 * written or neither is, so a failed signup can simply be retried.
 */
export async function createUserWithProfile(
  email: string,
  passwordHash: string,
  role: 'CLAIMANT' | 'EMPLOYER'
) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { email, passwordHash, role } });
    if (role === 'CLAIMANT') {
      await tx.claimantProfile.create({ data: { userId: user.id } });
    } else {
      await tx.employerProfile.create({ data: { userId: user.id } });
    }
    return user;
  });
}
