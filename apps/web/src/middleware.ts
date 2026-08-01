import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth/auth.config';
import { buildLoginUrl } from '@/lib/auth/callback-url';
import { resolveCategoryRedirect } from '@/lib/category-canonical';

const { auth } = NextAuth(authConfig);

const accountPrefixes = [
  '/mis-anuncios',
  '/publicar',
  '/mensajes',
  '/favoritos',
  '/perfil',
  '/mis-creditos',
  '/mis-alertas',
  '/notificaciones',
  '/mis-tickets',
];

const adminPrefixes = ['/admin'];

// /admin/login es la puerta de entrada al panel — NO puede caer bajo el guard
// de /admin/* (exige rol ADMIN + sesión), o nadie podría llegar a ella nunca
// (bucle: para entrar necesitas estar ya dentro). Excluida explícitamente de
// isAdminRoute; su propia página/endpoint controlan el acceso (ver
// AuthService.adminLogin — rechaza tras validar credenciales, nunca antes).
const ADMIN_LOGIN_PATH = '/admin/login';

// Paths within /admin/ that each restricted role may access.
// ADMIN always has full access. Any role not listed here is always blocked.
// Add/extend entries here when a section is opened to a role.
const ROLE_ALLOWED_PATHS: Record<string, string[]> = {
  // '/admin/tickets' (atención al usuario R7) va junto a la entrada de AdminNav:
  // sin el path la sección es inaccesible; sin el ítem del nav, invisible.
  MODERATOR: ['/admin/reportes', '/admin/anuncios', '/admin/usuarios', '/admin/blog', '/admin/paginas', '/admin/tickets'],
  EDITOR: ['/admin/blog', '/admin/paginas'],
};

// A1 (URLs anidadas) — código del redirect permanente de categoría. 308 y no 301:
// es la decisión aprobada (P1); Google los consolida igual y el 308 preserva el
// método. Va en una constante para que el número no quede suelto en el cuerpo.
const PERMANENT_REDIRECT = 308;

export default auth(async (req) => {
  const session = req.auth;
  const { pathname, search } = req.nextUrl;

  // A1 — canonicalización de URLs de categoría (/coches → /vehiculos/coches).
  // Va PRIMERO: son rutas públicas, no dependen de la sesión, y el redirect debe
  // salir antes de que se renderice nada.
  //
  // Vive aquí y no en la página porque `app/loading.tsx` (raíz) hace que Next
  // envuelva toda ruta en Suspense y mande la cabecera 200 antes de ejecutar el
  // componente: allí `permanentRedirect()` degrada a un redirect de cliente sobre
  // un 200, que para un crawler es "la URL vieja sigue viva". Comprobado sobre el
  // servidor real — ver el comentario largo en lib/category-canonical.ts.
  //
  // `resolveCategoryRedirect` devuelve null (y aquí no se hace nada) cuando la
  // ruta ya es canónica, no es una categoría, o el mapa no se pudo resolver.
  const canonical = await resolveCategoryRedirect(pathname);
  if (canonical) {
    const target = new URL(canonical + search, req.url);
    return Response.redirect(target, PERMANENT_REDIRECT);
  }

  const isAccountRoute = accountPrefixes.some((p) => pathname.startsWith(p));
  const isAdminRoute =
    pathname !== ADMIN_LOGIN_PATH && adminPrefixes.some((p) => pathname.startsWith(p));

  if ((isAccountRoute || isAdminRoute) && !session) {
    // RÁFAGA 4 — el punto de entrada más frecuente a /login (nav directa,
    // bookmark, enlace del menú) antes no llevaba callbackUrl: tras loguearse
    // el usuario aterrizaba siempre en el default, nunca en la ruta que pedía.
    return Response.redirect(new URL(buildLoginUrl(pathname + search), req.url));
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
