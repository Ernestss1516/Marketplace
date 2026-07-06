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

// Paths within /admin/ that each restricted role may access.
// ADMIN always has full access. Any role not listed here is always blocked.
// Add/extend entries here when a section is opened to a role.
const ROLE_ALLOWED_PATHS: Record<string, string[]> = {
  MODERATOR: ['/admin/reportes', '/admin/anuncios', '/admin/usuarios', '/admin/blog', '/admin/paginas'],
  EDITOR: ['/admin/blog', '/admin/paginas'],
};

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
    } else {
      const allowed = ROLE_ALLOWED_PATHS[role ?? '']?.some((p) => pathname.startsWith(p));
      if (!allowed) return Response.redirect(new URL('/', req.url));
    }
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
