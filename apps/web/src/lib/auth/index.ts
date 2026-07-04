import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { apiFetch, ApiError } from '../api/client';
import { authConfig } from './auth.config';

interface LoginResponse {
  accessToken: string;
  user: { id: string; name: string; email: string; slug: string; role: string; emailVerified: boolean };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    // Auth.js picks up AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET by convention.
    // No adapter is configured, so Auth.js's own account-linking-by-email never
    // runs; all linking happens in our signIn callback (auth.config.ts) against
    // our backend, which only links after verifying Google's email_verified claim.
    Google({}),
    Credentials({
      credentials: {
        email: { type: 'email' },
        password: { type: 'password' },
      },
      async authorize(credentials) {
        try {
          const res = await apiFetch<LoginResponse>('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email: credentials.email, password: credentials.password }),
          });
          return {
            id: res.user.id,
            name: res.user.name,
            email: res.user.email,
            slug: res.user.slug,
            role: res.user.role,
            accessToken: res.accessToken,
            emailVerified: res.user.emailVerified,
          };
        } catch (error) {
          if (error instanceof ApiError && error.statusCode === 401) return null;
          return null;
        }
      },
    }),
  ],
});
