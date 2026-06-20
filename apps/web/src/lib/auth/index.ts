import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { apiFetch, ApiError } from '../api/client';
import { authConfig } from './auth.config';

interface LoginResponse {
  accessToken: string;
  user: { id: string; name: string; email: string; slug: string; role: string };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
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
          };
        } catch (error) {
          if (error instanceof ApiError && error.statusCode === 401) return null;
          return null;
        }
      },
    }),
  ],
});
