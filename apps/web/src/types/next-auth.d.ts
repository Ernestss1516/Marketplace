import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      slug: string;
      role: string;
      accessToken: string;
      emailVerified: boolean;
    } & Omit<DefaultSession['user'], 'emailVerified'>;
  }

  interface User {
    slug?: string;
    role?: string;
    accessToken?: string;
    emailVerified?: boolean;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    slug?: string;
    role?: string;
    accessToken?: string;
    emailVerified?: boolean;
  }
}
