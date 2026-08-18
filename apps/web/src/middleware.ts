import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/lib/auth/auth.config';
import { buildLoginUrl } from '@/lib/auth/callback-url';
import {
  isUnknownCategoryPath,
  resolveCategoryRedirect,
  resolveSearchCategoryRedirect,
} from '@/lib/category-canonical';
import { ADMIN_LOGIN_PATH, ADMIN_ROOT, canAccessAdminPath } from '@/config/backoffice-sections';

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

// ROLES RÁFAGA 1 — `ROLE_ALLOWED_PATHS` VIVÍA AQUÍ Y HA DESAPARECIDO.
//
// Era una de las tres listas a mano que decidían el acceso al backoffice, y la
// que obligaba a recordar la otra: su propio comentario decía «sin el path la
// sección es inaccesible; sin el ítem del nav, invisible». Ahora las rutas, el
// piso de rol y las etiquetas del nav salen de UN sitio —`config/backoffice-
// sections.ts`— y este fichero solo pregunta.
//
// `ADMIN_LOGIN_PATH` y `ADMIN_ROOT` también salen de allí: la exclusión de
// `/admin/login` del gate es una propiedad del mapa (no es una sección), no de
// este middleware.

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

  // A2 (P3) — /busqueda?category=X es la otra forma, heredada, de pedir una categoría.
  // Se canonicaliza a su ruta propia por el mismo motivo y con el mismo mecanismo.
  // Aquí la query SÍ se transforma (se quita `category`), así que la ruta destino ya
  // viene con su querystring montada.
  const fromSearch = await resolveSearchCategoryRedirect(pathname, req.nextUrl.searchParams);
  if (fromSearch) {
    return Response.redirect(new URL(fromSearch, req.url), PERMANENT_REDIRECT);
  }

  // PROFUNDIDAD N — RÁFAGA 3. Un 404 REAL para las rutas que ahora CASAN con una
  // ruta de categoría (1..4 segmentos) pero no son ninguna categoría.
  //
  // Antes de esta ráfaga sólo existían las rutas de 1 y 2 segmentos, así que
  // `/a/b/c` no casaba con nada y el router daba un 404 de verdad. Con las rutas
  // de nivel 3 y 4 eso deja de ser cierto, y en el componente `notFound()` sólo
  // puede producir un 404 BLANDO (200 + UI) por el `app/loading.tsx` de la raíz
  // — el mismo motivo por el que el 308 vive aquí y no en la página.
  //
  // `rewrite` y no un `Response(null, {status: 404})`: así el usuario sigue
  // viendo la página de 404 con su diseño, y el crawler recibe el 404 de verdad.
  // El destino no casa con ninguna ruta a propósito.
  if (await isUnknownCategoryPath(pathname)) {
    return NextResponse.rewrite(new URL('/_categoria-inexistente', req.url), { status: 404 });
  }

  const isAccountRoute = accountPrefixes.some((p) => pathname.startsWith(p));
  const isAdminRoute =
    pathname !== ADMIN_LOGIN_PATH &&
    (pathname === ADMIN_ROOT || pathname.startsWith(`${ADMIN_ROOT}/`));

  if ((isAccountRoute || isAdminRoute) && !session) {
    // RÁFAGA 4 — el punto de entrada más frecuente a /login (nav directa,
    // bookmark, enlace del menú) antes no llevaba callbackUrl: tras loguearse
    // el usuario aterrizaba siempre en el default, nunca en la ruta que pedía.
    return Response.redirect(new URL(buildLoginUrl(pathname + search), req.url));
  }

  // ROLES RÁFAGA 1 — el gate del backoffice, DERIVADO del mapa de secciones.
  //
  // ADMIN deja de ser un caso especial: antes había una rama `if (role ===
  // 'ADMIN')` con acceso total y otra para «los demás». Con la escalera, ADMIN
  // pasa por la MISMA comparación que EDITOR y MODERATOR (`atLeast` lo resuelve),
  // así que hay una sola ruta de decisión en vez de dos.
  //
  // `canAccessAdminPath` es fail-closed ante una ruta sin sección — ver su
  // comentario en config/backoffice-sections.ts.
  if (isAdminRoute && !canAccessAdminPath(session?.user.role, pathname)) {
    return Response.redirect(new URL('/', req.url));
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
