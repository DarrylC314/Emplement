import type { NextAuthOptions } from 'next-auth';
import { getServerSession } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

export async function authorizeCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;
  const claimantProfile = await prisma.claimantProfile.findUnique({ where: { userId: user.id } });
  return { id: user.id, email: user.email, role: user.role, claimantProfileId: claimantProfile?.id };
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
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
