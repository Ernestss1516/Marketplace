# Estado técnico del proyecto — Marketplace

> Fecha: 2026-06-21 · Rama: `main` · Último commit: `3e89dac`

Documento de referencia para retomar el proyecto. Recoge qué hay implementado,
qué decisiones se tomaron respecto al diseño original y qué queda pendiente.

---

## 1. Estado de implementación por módulo

### Backend (`apps/api` — puerto 3001)

| Módulo | Estado | Notas |
|---|---|---|
| **Infra: Prisma** | ✅ Completo | Schema con todos los modelos; PostGIS habilitado; migración `init` + `add_price_type` aplicadas |
| **Infra: Redis** | ✅ Completo | `RedisService` global; caché de fichas de anuncio (TTL 5 min) |
| **Infra: BullMQ** | ✅ Colas activas | 3 colas registradas con processors reales (ver §2 para el fix de ioredis) |
| **Infra: Meilisearch** | ⚠️ Módulo stub | `MeilisearchService` y `MeilisearchModule` existen pero no configuran índices; `IndexingProcessor` tiene un TODO vacío |
| **Infra: R2 (Cloudflare)** | ✅ Completo | `R2Service` con `upload`, `download`, `getPublicUrl` |
| **Auth** | ✅ Completo | register, login, verify-email, forgot-password, reset-password; `JwtAuthGuard`, `RolesGuard`, `@CurrentUser` |
| **Users** | ✅ Completo | `GET /users/me`, `PATCH /users/me`, `GET /users/:slug` (perfil público) |
| **Categories** | ✅ Completo | `GET /categories` (árbol), `GET /categories/:slug` (con `attributeSchema`) |
| **Listings** | ✅ Completo | CRUD completo + ciclo de vida (publish, reserve, sold, delete) + caché por slug + encolado de reindexado |
| **Media** | ✅ Upload | `POST /media/upload` → R2 → crea `ListingImage` huérfana → encola procesado con sharp; **sin DELETE** |
| **Search** | ❌ Sin implementar | `SearchService` vacío; endpoint `GET /search` no existe aún |
| **Messaging** | ❌ Stub vacío | Módulo y controller existen, sin lógica |
| **Favorites** | ❌ Stub vacío | Ídem |
| **Reviews** | ❌ Stub vacío | Ídem |
| **Moderation** | ❌ Stub vacío | Ídem |
| **Admin** | ❌ Stub vacío | Ídem |

### Frontend (`apps/web` — puerto 3000)

| Página / Componente | Estado | Notas |
|---|---|---|
| **Home** `/` | ✅ Completo | Hero, buscador, grid de categorías, últimos anuncios (8); Server Component con fetch paralelo |
| **Ficha anuncio** `/anuncio/[slug]` | ✅ Completo | Galería, precio con `priceType`, atributos de categoría, ubicación, anuncios relacionados, metadata OG |
| **Categoría** `/[categoria]` | ✅ Completo | Listado paginado con ordenación (fecha/precio) |
| **Publicar** `/publicar` | ✅ Completo | Wizard 5–6 pasos (categoría, fotos, datos, atributos opcionales, ubicación, preview); subida a R2 vía `POST /media/upload`; crea borrador + publica |
| **Login / Registro** | ✅ Completo | Formularios con next-auth v5 CredentialsProvider |
| **Verificar email** `/verificar-email` | ✅ Completo | Llama a `POST /auth/verify-email`; emite nuevo JWT con `emailVerified: true` |
| **Recuperar contraseña** | ✅ Completo | forgot-password + reset-password enlazado por email |
| **Mis anuncios** `/mis-anuncios` | ⚠️ Ruta protegida | Middleware redirige correctamente; página en blanco (sin implementar) |
| **Editar anuncio** `/mis-anuncios/[id]/editar` | ❌ Sin implementar | Ruta existe en el router pero no hay página real |
| **Mensajes, Favoritos, Perfil** | ❌ Sin implementar | Rutas protegidas por middleware; páginas vacías |
| **Vendedor** `/vendedor/[slug]` | ⚠️ Ruta registrada | Página no implementada; consume `GET /users/:slug` del backend |
| **Búsqueda** `/busqueda` | ❌ Sin implementar | El `SearchBar` lleva a esta ruta pero el endpoint backend no existe |
| **Admin** `/admin/*` | ❌ Sin implementar | Protegido por rol ADMIN en middleware; páginas vacías |

---

## 2. Decisiones técnicas y desviaciones respecto al diseño original

### Ruta `/vendedor/[slug]` en lugar de `/[vendedor]`

El diseño original situaba el perfil del vendedor en `/{slug}` directamente en la
raíz. En Next.js App Router eso colisiona con `[categoria]` (ambos serían
segmentos dinámicos en el mismo nivel). La solución adoptada fue el prefijo fijo
`/vendedor/[slug]`, que elimina la ambigüedad sin coste SEO significativo.

### Campo `priceType` (enum `FIXED | FREE | NEGOTIABLE`)

El diseño original modelaba solo un campo `price: Decimal`. Se añadió el enum
`PriceType` como campo separado para representar de forma explícita "Gratis" y
"A convenir" sin trucos de valor nulo o cero. La migración correspondiente es
`20260620211233_add_price_type`. El frontend expone esto como tres radio buttons
(`priceMode`) y la función `priceTypeFromMode` en `StepDatos` traduce al enum.

### Anuncios recientes vía Postgres (no Meilisearch)

`GET /listings` (recientes) y `GET /listings?category=...` (por categoría) se
resuelven directamente contra Postgres con `prisma.listing.findMany`. Meilisearch
estaba previsto para estas consultas en el diseño original, pero dado que el
`IndexingProcessor` aún no indexa y que Postgres con los índices de
`(status, publishedAt)` y `(categoryId, status)` es suficiente para el volumen
del MVP, se optó por no añadir una dependencia de un servicio no operativo.
**Cuando Meilisearch esté activo**, estos endpoints deberán migrarse a él para
soportar filtros complejos y búsqueda de texto libre.

### Fix ioredis en BullMQ

`@nestjs/bullmq` usa `ioredis@5.10.x` internamente. Pasar una instancia
`new Redis()` construida con la versión `5.11.x` del paquete raíz generaba un
error de tipos en TypeScript. Solución: en `queue.module.ts` se parsea la
`REDIS_URL` con `new URL(...)` y se pasan opciones planas
`{ host, port, maxRetriesPerRequest: null }` en lugar de una instancia Redis.
`maxRetriesPerRequest: null` es obligatorio en BullMQ v3+ para evitar que el
worker rechace jobs al primer fallo de conexión.

### Verificación de email: nuevo JWT en lugar de re-login

Al verificar el email (`POST /auth/verify-email`), el backend emite directamente
un nuevo access token con `emailVerified: true` en el payload. El cliente lo
recibe y puede actualizar la sesión de next-auth sin obligar al usuario a
volver a introducir sus credenciales. El campo `emailVerified` viaja en el JWT
para evitar una query a la base de datos en cada request autenticado.

### Imágenes: upload pre-anuncio (huérfanas temporales)

El flujo de publicación sube las fotos a R2 antes de crear el anuncio.
`ListingImage` se crea con `listingId: null`; al crear el anuncio se vincula vía
`linkImages`. Este diseño permite el wizard multistep pero deja imágenes huérfanas
si el usuario abandona el proceso (ver §3).

---

## 3. Limitaciones conocidas y deuda técnica

### Sin `DELETE /media`

No existe endpoint para eliminar imágenes de R2 ni su registro en base de datos.
Las imágenes subidas en un wizard abandonado permanecen en R2 y en la tabla
`ListingImage` con `listingId: null` indefinidamente. Pendiente: endpoint
`DELETE /media/:id` que verifique propiedad (`uploadedById`), borre de R2 y
elimine el registro.

### Meilisearch sin configurar

`IndexingProcessor.process()` es un TODO vacío. Los anuncios se encolan para
indexación pero nunca se indexan. El módulo `MeilisearchModule` existe pero no
configura índices ni mappings. Consecuencia directa: `GET /search` no existe,
el `SearchBar` del frontend lleva a una página sin implementar.

### Notificaciones de email: Resend configurado, sin verificar en producción

`NotificationProcessor` usa la SDK de Resend y está completamente implementado.
Sin embargo, requiere que `RESEND_API_KEY` y `RESEND_FROM` estén configurados en
`.env` y que el dominio remitente esté verificado en el panel de Resend. Si estas
variables no están presentes el worker lanza una excepción en cada job de email.

### Frontend: gestión de anuncios propios sin implementar

`/mis-anuncios` (listado), `/mis-anuncios/[id]/editar` (edición) y las acciones
de cambio de estado (reservar, marcar vendido, eliminar) están protegidas por
el middleware pero las páginas no están implementadas. El backend ya expone todos
los endpoints necesarios (`PATCH /listings/:id`, `POST /listings/:id/publish`,
`POST /listings/:id/reserve`, `POST /listings/:id/sold`, `DELETE /listings/:id`,
`GET /listings/mine`).

### Módulos stub: mensajería, favoritos, valoraciones, moderación, admin

Los controllers y services existen con cuerpos vacíos. Ninguno tiene lógica real.
La estructura de base de datos para todos ellos está completa en el schema.

### Sin paginación en categorías ni en el home

`GET /categories` devuelve el árbol completo en una sola llamada. Mientras el
número de categorías sea reducido (< 200) esto es aceptable; a escala habría que
añadir paginación o cachear la respuesta en Redis.

### Slug de anuncio con sufijo aleatorio, sin unicidad garantizada vía índice único

`buildSlug` en `ListingsService` genera `{base}-{6-char-hex}`. El campo
`slug` tiene `@unique` en el schema (índice único en Postgres), por lo que una
colisión lanzaría una `PrismaClientKnownRequestError P2002`. No hay lógica de
reintento. En la práctica la probabilidad es despreciable, pero en un volumen alto
convendría añadir un bucle de reintento similar al de `generateUniqueSlug` en auth.

---

## 4. Documentación de la API

Swagger está disponible en **`http://localhost:3001/api/docs`** cuando el backend
está corriendo. Es la fuente de verdad del contrato de endpoints: recoge todos los
DTOs con sus validaciones, los tipos de respuesta y los endpoints protegidos por
`@ApiBearerAuth`. Para el detalle de la arquitectura prevista y la hoja de ruta del
MVP, ver la carpeta `docs/` (`.docx` + `.md`).

---

## 5. Cómo arrancar el proyecto

```bash
# Infraestructura (Postgres, Redis, Meilisearch)
docker compose up -d

# Backend
pnpm --filter @marketplace/api dev      # http://localhost:3001/api

# Frontend
pnpm --filter @marketplace/web dev      # http://localhost:3000
```

Variables de entorno necesarias: `apps/api/.env` y `apps/web/.env.local`.
Ver los respectivos `.env.example` como plantilla.
