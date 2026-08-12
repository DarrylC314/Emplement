import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: 'CLAIMANT' | 'CASEWORKER' | 'ADMIN';
      claimantProfileId?: string;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string;
    role: 'CLAIMANT' | 'CASEWORKER' | 'ADMIN';
    claimantProfileId?: string;
  }
}
