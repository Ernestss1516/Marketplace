# apps/api — Backend (NestJS)

## Rol
**Única fuente de verdad de la lógica de negocio.** Expone la API que consume el
frontend. Aquí viven las reglas, la persistencia, la caché, las colas y la búsqueda.

## Estructura
- `modules/` — Dominio: un módulo por área (`auth`, `users`, `listings`,
  `categories`, `search`, `messaging`, `expiration`, `geocoding`, `favorites`,
  `reviews`, `media`, `moderation`, `admin`). Cada módulo: `controller`, `service`, `dto`.
- `commands/` — Scripts de administración: `reindex.ts`, `geocode-backfill.ts`.
- `common/` — Transversal: `guards/` (incl. `RolesGuard`), `interceptors/`,
  `filters/`, `decorators/`, `pipes/`, `dto/` base.
- `infra/` — Integraciones: `prisma/`, `redis/`, `queue/` (BullMQ + `processors/`),
  `meilisearch/`.
- `config/` — Configuración tipada y validación de variables de entorno.
- `prisma/` — `schema.prisma` (fuente de verdad de datos), `migrations/`, `seed.ts`.

## Reglas
- **Un módulo por dominio**; sigue el patrón de `listings.service.ts` como
  plantilla para los nuevos módulos.
- **Prisma es la única capa de acceso a datos.** El `schema.prisma` es la verdad.
  Usar `jsonb` (`Listing.attributes`) para los atributos variables por categoría.
- **El trabajo pesado se encola en BullMQ** (`infra/queue`) y se procesa en
  workers (`processors/`): imágenes, reindexado, notificaciones. Nunca inline.
- **Búsqueda:** el módulo `search` habla con Meilisearch. Al crear/editar un
  anuncio se **encola** el reindexado; **solo se indexan los ACTIVE**. Los
  documentos indexados incluyen todos los campos necesarios para la tarjeta
  (título, slug, precio, thumbnail, ubicación…), por lo que las consultas de
  búsqueda no requieren ninguna llamada adicional a Postgres.
- **Caché:** las fichas y listados más consultados se cachean en Redis; **invalidar
  la caché al actualizar** el anuncio.
- **Validación** siempre con DTOs (class-validator). **Autorización** con guards;
  rol admin para los endpoints de `admin`.
- `price` como `Decimal` (nunca `Float`). Slugs únicos para SEO.

## Comandos
- `dev` — servidor en watch mode
- `build` / `start` — producción
- `test` / `test:e2e` — pruebas
- `npx prisma migrate dev` — aplicar migraciones
- `npx prisma db seed` — sembrar datos iniciales
- `npx prisma studio` — inspeccionar la base de datos
- `pnpm reindex` — reconstruye el índice Meilisearch desde Postgres
- `pnpm geocode-backfill` — asigna coordenadas a anuncios sin `latitude` (1 req/s Nominatim)
- (Ajustar a los scripts reales del `package.json`.)

## Estado y plan vigente
MVP completado (fases 0-5). Estado detallado: `docs/estado-tecnico.md`.
Plan activo: `docs/Hoja_de_ruta_rafagas_Hito2.docx`.
