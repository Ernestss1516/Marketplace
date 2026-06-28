import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth/auth.config';

const { auth } = NextAuth(authConfig);

const accountPrefixes = [
  '/mis-anuncios',
  '/publicar',
  '/mensajes',
  '/favoritos',
  '/perfil',
  '/mis-creditos',
];

const adminPrefixes = ['/admin'];

// Paths within /admin/ that a MODERATOR may access.
// ADMIN always has full access. Any other role is always blocked.
// Add new paths here when a section is opened to moderators.
const MODERATOR_ALLOWED_PATHS = ['/admin/reportes'];

export default auth((req) => {
  const session = req.auth;
  const { pathname } = req.nextUrl;

  const isAccountRoute = accountPrefixes.some((p) => pathname.startsWith(p));
  const isAdminRoute = adminPrefixes.some((p) => pathname.startsWith(p));

  if ((isAccountRoute || isAdminRoute) && !session) {
    return Response.redirect(new URL('/login', req.url));
  }

  if (isAdminRoute) {
    const role = session?.user.role;
    if (role === 'ADMIN') {
      // Full access — continue
    } else if (role === 'MODERATOR') {
      const allowed = MODERATOR_ALLOWED_PATHS.some((p) => pathname.startsWith(p));
      if (!allowed) return Response.redirect(new URL('/', req.url));
    } else {
      return Response.redirect(new URL('/', req.url));
    }
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
