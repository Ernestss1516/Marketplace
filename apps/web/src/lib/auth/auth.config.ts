import type { NextAuthConfig } from 'next-auth';
import type { JWT } from 'next-auth/jwt';
import { apiFetch, ApiError } from '../api/client';

interface SocialLoginResponse {
  accessToken: string;
  user: { id: string; name: string; email: string; slug: string; role: string; emailVerified: boolean };
}

export const authConfig: NextAuthConfig = {
  providers: [],
  callbacks: {
    // Runs once, right after Google (or any OAuth provider) returns control to us — before
    // the session/JWT is created. We exchange the Google id_token for our own backend JWT
    // here (not in the jwt callback) because returning a string from this callback lets us
    // redirect to a specific error page with a specific message (e.g. email not verified by
    // Google); throwing from the jwt callback instead collapses every error into the same
    // generic Auth.js error code, which can't carry that distinction.
    async signIn({ user, account }) {
      if (account?.provider !== 'google') return true;
      if (!account.id_token) return '/login?error=google_error';

      try {
        const res = await apiFetch<SocialLoginResponse>('/auth/social/google', {
          method: 'POST',
          body: JSON.stringify({ idToken: account.id_token }),
        });
        // Mutating `user` here is safe: Auth.js passes this same object on to the jwt
        // callback below for the initial sign-in, exactly like Credentials' authorize() does.
        user.id = res.user.id;
        user.name = res.user.name;
        user.email = res.user.email;
        user.slug = res.user.slug;
        user.role = res.user.role;
        user.accessToken = res.accessToken;
        user.emailVerified = res.user.emailVerified;
        return true;
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 403) {
          return '/login?error=google_unverified_email';
        }
        return '/login?error=google_error';
      }
    },
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = user.id;
        token.slug = (user as { slug?: string }).slug;
        token.role = (user as { role?: string }).role;
        token.accessToken = (user as { accessToken?: string }).accessToken;
        token.emailVerified = (user as { emailVerified?: boolean }).emailVerified ?? false;
      }
      if (trigger === 'update' && session) {
        const s = session as { accessToken?: string; emailVerified?: boolean };
        if (s.accessToken) token.accessToken = s.accessToken;
        if (s.emailVerified !== undefined) token.emailVerified = s.emailVerified;
      }
      return token as JWT;
    },
    session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: token.id as string,
          slug: token.slug as string,
          role: token.role as string,
          accessToken: token.accessToken as string,
          emailVerified: Boolean(token.emailVerified),
        },
      };
    },
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
};
