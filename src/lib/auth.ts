import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, clearRateLimit } from '@/lib/rateLimit';

export async function authorizeCredentials(email: string, password: string) {
  // Basic login rate limiting (spec: "Basic rate limiting on login and
  // identity-verification endpoints"). Keyed by email so one account cannot be
  // brute-forced from many addresses; returning null surfaces to the client as
  // the same 401 as a bad password, which also avoids telling an attacker
  // whether the account exists.
  const rateLimitKey = `login:${email.toLowerCase()}`;
  if (!checkRateLimit(rateLimitKey).allowed) return null;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;
  // Successful login: clear the window so failed attempts before this one
  // don't keep counting against the account. Without this, a legitimate
  // user (or a shared demo account) who mistypes a password a few times
  // before succeeding, repeated over normal use, could eventually trip the
  // limiter even though every login has ultimately been valid.
  clearRateLimit(rateLimitKey);
  const claimantProfile = await prisma.claimantProfile.findUnique({ where: { userId: user.id } });
  return { id: user.id, email: user.email, role: user.role, claimantProfileId: claimantProfile?.id };
}

export const authOptions: NextAuthOptions = {
  // 30 minutes, in seconds (NextAuth's unit). Without an explicit maxAge
  // NextAuth defaults to a 30-DAY session, which is far too long for a benefits
  // portal handling SSNs — and it left SessionTimeoutWarning warning about an
  // expiry that was never going to happen. The warning component now derives
  // its timing from the real `session.expires` this produces.
  session: { strategy: 'jwt', maxAge: 30 * 60 },
  pages: { signIn: '/claim/login' },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        return authorizeCredentials(credentials.email, credentials.password);
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.role = (user as unknown as { role: 'CLAIMANT' | 'CASEWORKER' | 'ADMIN' }).role;
        token.claimantProfileId = (user as { claimantProfileId?: string }).claimantProfileId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as 'CLAIMANT' | 'CASEWORKER' | 'ADMIN';
        session.user.claimantProfileId = token.claimantProfileId as string | undefined;
      }
      return session;
    },
  },
};

export function getServerAuthSession() {
  return getServerSession(authOptions);
}
