import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth/auth.config';

const { auth } = NextAuth(authConfig);

const accountPrefixes = [
  '/mis-anuncios',
  '/publicar',
  '/mensajes',
  '/favoritos',
  '/perfil',
];

const adminPrefixes = ['/admin'];

export default auth((req) => {
  const session = req.auth;
  const { pathname } = req.nextUrl;

  const isAccountRoute = accountPrefixes.some((p) => pathname.startsWith(p));
  const isAdminRoute = adminPrefixes.some((p) => pathname.startsWith(p));

  if ((isAccountRoute || isAdminRoute) && !session) {
    return Response.redirect(new URL('/login', req.url));
  }

  if (isAdminRoute && session?.user.role !== 'ADMIN') {
    return Response.redirect(new URL('/', req.url));
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
