import type { NextAuthConfig } from 'next-auth';
import type { JWT } from 'next-auth/jwt';

export const authConfig: NextAuthConfig = {
  providers: [],
  callbacks: {
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
