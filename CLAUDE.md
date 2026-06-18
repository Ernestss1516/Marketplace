# Marketplace — Plataforma de compraventa de segunda mano

## Propósito
Marketplace C2C (entre particulares) tipo Milanuncios: publicar, buscar y
contactar para comprar/vender productos y servicios. Es una plataforma
**intensiva en lectura (read-heavy)** y fuertemente dependiente del **SEO**.

## Stack
- **Frontend:** Next.js (App Router) + React + TypeScript + Tailwind + shadcn/ui
- **Backend:** NestJS + TypeScript
- **Datos:** PostgreSQL + Prisma
- **Caché:** Redis
- **Búsqueda:** Meilisearch
- **Colas:** BullMQ (sobre Redis)

## Estructura del monorepo
- `apps/web/` — Frontend Next.js (ver su propio CLAUDE.md)
- `apps/api/` — Backend NestJS (ver su propio CLAUDE.md)
- `docs/` — Documentación del proyecto (informe, estructuras, hojas de ruta)

## Reglas de arquitectura (INNEGOCIABLES)
- **NestJS es la única fuente de verdad de la lógica de negocio.** Ninguna regla
  de negocio vive en Next.
- **Next.js es solo presentación + BFF.** Consume la API de Nest; no implementa
  negocio.
- **PostgreSQL es la fuente de verdad de los datos.** Meilisearch solo para
  búsqueda; Redis solo para caché y colas.
- **El trabajo pesado va a colas BullMQ**, nunca inline en la petición HTTP
  (procesado de imágenes, reindexado, notificaciones).
- **Solo los anuncios en estado ACTIVE se indexan** en Meilisearch.

## Convenciones de código
- TypeScript en modo estricto en todo el monorepo.
- **Código en inglés** (nombres, comentarios). **Contenido de cara al usuario y
  rutas públicas en español** (p. ej. `/anuncio`, `/busqueda`, `/publicar`).
- Validación de entrada siempre vía DTOs en el backend.

## Comandos
- Infraestructura local: `docker-compose up -d` (Postgres, Redis, Meilisearch)
- Frontend: trabajar dentro de `apps/web` (ver su CLAUDE.md)
- Backend: trabajar dentro de `apps/api` (ver su CLAUDE.md)
- (Ajustar según el gestor de paquetes del workspace.)

## Flujo de Git
- Ramas cortas por fase o ráfaga (p. ej. `fase-2-auth`); fusionar a `main` al
  completar.
- **`git pull` al empezar cada sesión, `git commit` + `git push` al terminar.**
- Nunca dejar trabajo sin commitear si se va a continuar en otra máquina.

## Avisos
- Mantener Next.js actualizado (parches de seguridad del App Router).
- Los secretos (`.env`) **nunca** se suben a Git; hay un `.env.example` como
  plantilla y cada máquina tiene su `.env` local.

## Documentación de referencia
Para el detalle de arquitectura, modelo de datos y hoja de ruta, consultar la
carpeta `docs/` (no se carga automáticamente; ábrela cuando necesites el detalle).
