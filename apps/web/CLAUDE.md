# apps/web — Frontend (Next.js)

## Rol
Capa de **presentación + BFF**. **Ninguna regla de negocio vive aquí.** Toda la
lógica se consume desde la API de NestJS a través de `lib/api/`.

## Estructura (App Router)
- `app/(public)/` — Páginas públicas en **SSR/ISR** (home, fichas, listados,
  búsqueda). SEO crítico.
- `app/(auth)/` — Login, registro, recuperación (client-side).
- `app/(account)/` — Área privada del usuario (protegida por sesión).
- `app/(admin)/` — Backoffice **client-side, sin SSR ni SEO** (protegido por rol).
- `app/api/` — Route handlers **solo para BFF** (revalidación ISR, imágenes OG,
  proxies). Nunca lógica de negocio.
- `components/` — UI reutilizable (`ui/` con shadcn, `anuncios/`, `busqueda/`…).
- `lib/api/` — Cliente HTTP hacia NestJS (única vía de acceso al negocio).
- `lib/`, `hooks/`, `types/`, `config/` — utilidades, hooks, tipos y configuración.
- `middleware.ts` — Protección de rutas (sesión para `(account)`, rol admin para
  `(admin)`).

## Reglas
- Las fichas de anuncio y los listados van en **SSR** por SEO; el backoffice va
  **client-side** (no necesita SEO).
- Rutas de cara al usuario **en español** (`/anuncio/[slug]`, `/busqueda`,
  `/publicar`).
- Estilos con **Tailwind + shadcn/ui**; evitar CSS suelto.
- Mantener `sitemap.ts`, `robots.ts` y los metadatos de las fichas al día (SEO).
- No usar localStorage/sessionStorage para estado crítico; preferir estado de
  servidor o de React.

## Comandos
- `dev` — servidor de desarrollo
- `build` / `start` — build y arranque de producción
- `lint` / `typecheck` — calidad de código
- (Ajustar a los scripts reales del `package.json`.)

## Estado y plan vigente
El MVP está completado. Estado implementado: `docs/estado-tecnico.md`.
Plan de trabajo activo: `docs/Hoja_de_ruta_rafagas_Hito2.docx`.
