# Estado técnico del proyecto — Marketplace

> Fecha: 2026-06-24 · Rama: `main` · Último commit: Fase B completa (blog)
> Plan vigente para la siguiente fase: `docs/Hoja_de_ruta_rafagas_Hito2.docx`.

Documento de referencia para retomar el proyecto. Recoge qué hay implementado,
qué decisiones se tomaron respecto al diseño original y qué queda pendiente.

---

## 1. Estado de implementación por módulo

### Backend (`apps/api` — puerto 3001)

| Módulo | Estado | Notas |
|---|---|---|
| **Infra: Prisma** | ✅ Completo | Schema con todos los modelos; PostGIS habilitado; **7 migraciones aplicadas**: `init`, `add_auth_tokens`, `media_listing_image_nullable`, `add_price_type`, `backfill_expires_at`, `add_audit_log_and_settings`, **`add_blog_post`** |
| **Infra: Redis** | ✅ Completo | `RedisService` global; caché de fichas de anuncio (TTL 5 min) |
| **Infra: BullMQ** | ✅ Colas activas | 3 colas registradas con processors reales (ver §2 para el fix de ioredis) |
| **Infra: Meilisearch** | ✅ Completo | `SearchService.onModuleInit()` crea el índice `listings` y aplica searchable/filterable/sortable attrs, ranking rules y typo tolerance al arrancar |
| **Infra: MinIO/R2** | ✅ Completo | Dev: MinIO vía docker-compose (bucket `marketplace` con lectura pública, creado por el contenedor `createbuckets`). Prod: Cloudflare R2 vía `R2Service` |
| **Auth** | ✅ Completo | register, login, verify-email, forgot-password, reset-password; `JwtAuthGuard`, `RolesGuard`, `@CurrentUser`; login devuelve `emailVerified` (fix fase 5) |
| **Users** | ✅ Completo | `GET /users/me`, `PATCH /users/me`, `GET /users/:slug` (perfil público) |
| **Categories** | ✅ Completo | `GET /categories` (árbol público), `GET /categories/:slug` (con `attributeSchema`) |
| **Listings** | ✅ Completo | CRUD completo + ciclo de vida (publish, reserve, sold, delete, **renew**) + `expiresAt` fijado al publicar (publishedAt + 60 días) + caché por slug + encolado de reindexado; `GET /listings/mine/:id` para edición; `thumbnailUrl` resuelto en `findMine` y `findBySellerSlug`; geocoding automático al crear y al editar cuando cambia la ubicación |
| **Expiration** | ✅ Completo | `ExpirationService` con cron diario a las 02:00 (`@nestjs/schedule`): marca EXPIRED los anuncios ACTIVE con `expiresAt ≤ now`, invalida caché Redis y encola reindexado. Los RESERVED quedan excluidos intencionalmente |
| **Geocoding** | ✅ Completo | `GeocodingService` con proveedor configurable (`nominatim` por defecto, `maptiler`). Timeout de 1 500 ms con `AbortSignal.timeout()`; retorna `null` en cualquier fallo sin bloquear la publicación. Script `geocode-backfill` para anuncios sin coordenadas existentes (cursor-based, 1 req/s para respetar la política de Nominatim) |
| **Media** | ✅ Upload | `POST /media/upload` → R2/MinIO → crea `ListingImage` huérfana → encola procesado con sharp; **sin DELETE** |
| **Search** | ✅ Completo | `GET /search` con texto libre, filtros core, atributos variables (brand, fuel, rooms, gender, size…), **filtro por proximidad** (`lat` + `lng` + `radius` en km → `_geoRadius` en Meilisearch) y **orden por distancia** cuando no hay sort explícito, facetas, paginación y ordenación; `IndexingProcessor` real con jobs `index`/`remove` |
| **Script reindex** | ✅ Completo | `pnpm reindex` — reconstruye el índice en batches de 100; `ReindexModule` mínimo (sin BullMQ) para cierre limpio |
| **Messaging** | ✅ Completo | REST: `GET /conversations`, `POST /conversations`, `GET /conversations/:id` (cursor), `POST /conversations/:id/messages`. WebSocket gateway `/ws`: auth en handshake, rooms de conversación y de usuario, emit tras el POST REST |
| **AuditLog** | ✅ Completo | `AuditLogService.log()` inyectable; captura explícita `before`/`after` dentro del método de service que muta el recurso, antes de llamar a Prisma; nunca vía interceptor (ver §2) |
| **Moderation** | ✅ Completo | Reportes CRUD + cola (GET con filtros status/reason/page); acciones sobre listings (approve, reject, deactivate, restore); `BadWordService` con fallback silencioso al publicar; AuditLog en todas las mutaciones; roles MODERATOR + ADMIN |
| **Admin** | ✅ Completo | Listings (list, detail, PATCH status); Users (list, detail, suspend, ban, reinstate, role); Categories CRUD + batch reorder; Settings GET + PATCH con whitelist; `GET /admin/stats` con 7 métricas + Meilisearch null-fallback; todos los endpoints con `@Roles(ADMIN)` y AuditLog |
| **Blog** | ✅ Completo | Modelo `Post` (enum `PostStatus { DRAFT, PUBLISHED }`, body Markdown raw, `tags String[]`, `coverUrl`, campos SEO opcionales `metaTitle`/`metaDescription`). `BlogController`: `GET /blog` (solo PUBLISHED, paginado, filtro `?tag=`) y `GET /blog/:slug` (404 si no existe o es DRAFT). `BlogAdminController` (`@Roles(ADMIN)`): CRUD completo + `POST /admin/blog/:id/publish` + `POST /admin/blog/:id/unpublish`. AuditLog en todas las mutaciones (`POST_CREATE`, `POST_UPDATE`, `POST_PUBLISH`, `POST_UNPUBLISH`, `POST_DELETE`). Revalidación ISR on-demand fire-and-forget al publicar/despublicar/editar/borrar posts publicados (el blog es el **primer productor del webhook** desde el backend; el webhook en sí existía desde Fase 5). `BlogModule` importa `PrismaModule` + `AuditLogModule`; autónomo, no modifica `AdminModule` |
| **Favorites** | ✅ Completo | `POST /favorites/:listingId` (marcar), `DELETE /favorites/:listingId` (desmarcar), `GET /favorites` (paginado), `GET /favorites/:listingId` (check), `POST /favorites/batch-check` (máx. 100 ids → `{ favoritedIds }`). Todos idempotentes y con `JwtAuthGuard`. Suite `favorites.e2e-spec.ts` (12 tests) |
| **Reviews** | ❌ Stub vacío | Ídem |

### Frontend (`apps/web` — puerto 3000)

| Página / Componente | Estado | Notas |
|---|---|---|
| **Home** `/` | ✅ Completo | Hero, buscador, grid de categorías, últimos anuncios (8); Server Component con fetch paralelo |
| **Ficha anuncio** `/anuncio/[slug]` | ✅ Completo | Galería, precio con `priceType`, atributos de categoría, ubicación, anuncios relacionados, metadata OG; `ContactButton` integrado; **`ReportButton`** (solo autenticados) para reportar el anuncio |
| **Categoría** `/[categoria]` | ✅ Completo | Listado paginado con ordenación (fecha/precio) |
| **Publicar** `/publicar` | ✅ Completo | Wizard 5–6 pasos; crea borrador + publica; tras publicar **ramifica por status**: ACTIVE → navega a la ficha, PENDING_REVIEW → panel informativo con enlace a mis-anuncios (no navega a la ficha, que daría 404) |
| **Login / Registro** | ✅ Completo | Formularios con next-auth v5 CredentialsProvider |
| **Verificar email** `/verificar-email` | ✅ Completo | Llama a `POST /auth/verify-email`; emite nuevo JWT con `emailVerified: true` |
| **Recuperar contraseña** | ✅ Completo | forgot-password + reset-password enlazado por email |
| **Mis anuncios** `/mis-anuncios` | ✅ Completo | Listado de anuncios propios + acciones de estado (publicar, reservar, vender, eliminar, **renovar**); filtro "En revisión" para `PENDING_REVIEW`; muestra `expiresAt` en la tarjeta |
| **Editar anuncio** `/mis-anuncios/[id]/editar` | ✅ Completo | Wizard de edición (`EditarWizard`) precargado con datos del backend vía `GET /listings/mine/:id`; categoría bloqueada |
| **Vendedor** `/vendedor/[slug]` | ✅ Completo | Perfil del vendedor (avatar, bio, ubicación, fecha de registro) + grid paginado de anuncios activos |
| **Búsqueda** `/busqueda` | ✅ Completo | Server Component con fetch paralelo a Meilisearch; sidebar `FilterPanel` con categorías, tipo, estado, rango de precio, ordenación, facetas dinámicas, **control "cerca de mí"** (solicita `navigator.geolocation`, fija `lat`/`lng`/`radius` en la URL, selector de radio 5–50 km, orden por distancia automático); paginación; estados de error y vacío |
| **Perfil propio** `/perfil` | ✅ Completo | Ruta protegida por middleware; muestra avatar, nombre, email, ubicación y aviso de email no verificado; `PerfilForm` con campos nombre, teléfono, bio, ciudad, provincia, código postal; accesos rápidos a mis-anuncios, mensajes y favoritos; botón de cerrar sesión |
| **Favoritos** `/favoritos` | ✅ Completo | Ruta protegida. SSR paginado; `FavoritosClient` gestiona lista visible con eliminación/rollback optimista. Botón corazón en `ListingCard` (`FavoriteCardButton` leaf client) visible en **todas las vistas con grid**: home, búsqueda, categoría, vendedor, anuncios relacionados en ficha y la propia `/favoritos`. Resolución en lote: `POST /favorites/batch-check` → 1 request por grid. `FavoritesGridProvider` context en cada página SSR, sin romper SSR. En `/favoritos` la tarjeta desaparece al desmarcar y reaparece si el DELETE falla |
| **Bandeja mensajes** `/mensajes` | ✅ Completo | `BandejaMensajesClient`: lista de conversaciones con thumbnail, contador de no leídos y tiempo relativo; actualización en vivo vía WebSocket |
| **Chat** `/mensajes/[id]` | ✅ Completo | `ChatClient`: mensajes en orden cronológico, auto-scroll, carga de mensajes anteriores (cursor-based), envío vía POST REST, recepción en tiempo real vía WebSocket con deduplicación idempotente |
| **Admin shell** | ✅ Completo | Layout Server Component + `<AdminNav>` (active state vía `usePathname`) + `<AdminUserBar>` (nombre del admin + `signOut`); toda la carpeta `(admin)/` es client-side sin SSR |
| **Admin dashboard** `/admin` | ✅ Completo | Fetch a `GET /admin/stats`; KPIs en 3 secciones (anuncios, usuarios/moderación, índice de búsqueda); skeleton de carga y estado de error |
| **Admin anuncios** `/admin/anuncios` | ✅ Completo | Tabla paginada con chips de filtro por estado; cambio de estado inline (select + razón + confirmar) vía `PATCH /admin/listings/:id/status`; reportes recibidos visibles en la fila |
| **Admin usuarios** `/admin/usuarios` | ✅ Completo | Tabla con buscador (nombre/email), chips status y rol; acciones suspend/ban/reinstate contextuales al estado; panel de detalle expandible (últimos anuncios + reportes recibidos + auditlog); no muestra botones de acción para usuarios ADMIN |
| **Admin reportes** `/admin/reportes` | ✅ Completo | Cola de reportes paginada con filtro de estado; acciones resolve/dismiss/retirar anuncio |
| **Admin categorías** `/admin/categorias` | ✅ Completo | Árbol de categorías con CRUD inline (crear raíz/subcategoría, editar, borrar); reordenación por ↑↓ con `PATCH /admin/categories/reorder`; editor de `attributeSchema` como textarea JSON con validación previa al envío; errores 400 del backend (anuncios activos o subcategorías existentes) propagados con mensaje literal bajo la fila |
| **Admin ajustes** `/admin/ajustes` | ✅ Completo | 3 settings con controles tipo-específicos: `badWordList` (textarea una palabra por línea), `listingExpiryDays` (number input), `contactRequiresVerification` (checkbox); save por setting con estado de carga / ✓ éxito / error inline; timestamp de última actualización |
| **Blog público** `/blog` | ✅ Completo | `export const revalidate = 3600`; Server Component ISR; listado paginado de posts PUBLISHED con tarjetas (portada, título, excerpt, fecha, autor, tags); filtro `?tag=`; estados de vacío; paginación; breadcrumb. Portada: solo se renderiza con `<Image>` si `isSafeSrc()` pasa (ver §2 y §3) |
| **Blog detalle** `/blog/[slug]` | ✅ Completo | `export const revalidate = 3600`; Server Component ISR; `notFound()` si slug no existe o es DRAFT; body Markdown renderizado con `react-markdown` + `remark-gfm` + `rehype-sanitize` (sin `rehype-raw` — **regla invariante de seguridad**, ver §2); clase `prose` de `@tailwindcss/typography`; `generateMetadata()` con `og:type: 'article'`, `publishedTime`, `authors`, imagen OG; JSON-LD `BlogPosting` embebido; breadcrumb |
| **Sitemap** `/sitemap.xml` | ✅ Actualizado | Convertido a `async`; incluye `/blog` + un slug por cada post PUBLISHED (`getPostList({ perPage: 500 })`). Los posts DRAFT nunca aparecen porque el endpoint público `GET /blog` filtra por `status = PUBLISHED` en Prisma |
| **Admin blog** `/admin/blog` | ✅ Completo | Tabla paginada (todos los estados) con chips Todos / Borrador / Publicado; acciones Editar / Publicar / Despublicar / Eliminar (con confirmación) inline por fila; client-side |
| **Admin nuevo post** `/admin/blog/nuevo` | ✅ Completo | Formulario `PostForm` compartido: title, slug (editable; si se deja vacío el backend lo genera del título), excerpt, body (textarea Markdown + toggle preview), tags (coma-separadas), portada (solo upload a `/media/upload`, sin campo de URL libre), campos SEO colapsables (metaTitle, metaDescription); al guardar redirige a la página de edición |
| **Admin editar post** `/admin/blog/[id]/editar` | ✅ Completo | Mismo `PostForm` precargado desde `GET /admin/blog/:id`; cabecera con badge de estado + botones Publicar/Despublicar/Eliminar + enlace "Ver en blog ↗" cuando está publicado; banner de éxito al guardar |

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

### Anuncios recientes y por categoría vía Postgres (no Meilisearch)

`GET /listings` (recientes) y los listados por categoría (`/[categoria]`) se
resuelven directamente contra Postgres con `prisma.listing.findMany`. Meilisearch
está operativo pero se usa exclusivamente para búsqueda de texto libre (`GET /search`).
Con los índices de `(status, publishedAt)` y `(categoryId, status)` el rendimiento
es suficiente para el volumen del MVP; si el catálogo crece y se necesitan filtros
facetados en los listados por categoría, habría que migrar esas rutas a Meilisearch.

### `categoryPath` jerárquico y sintaxis de filtro de array en Meilisearch

El campo `categoryPath` en el documento indexado es un array de slugs: `[slugHoja,
slugPadre]`. Esto permite filtrar tanto por categoría hoja como por categoría padre
con una sola expresión. La sintaxis de filtro de Meilisearch para comprobar si un
valor pertenece a un array es **`campo = valor`** (no `IN`); se usa
`categoryPath = "slug"` y Meilisearch lo evalúa como "¿contiene el array este valor?".

Limitación actual: `INDEX_INCLUDE` en `search.service.ts` solo incluye un nivel de
padre (`category.parent`), por lo que `categoryPath` soporta como máximo 2 niveles
(hoja → padre). Un árbol de 3+ niveles requeriría recorrer `parent.parent…` en el
include y adaptar `toDocument`.

### Orden del spread en `toDocument` para no pisar campos core

Los atributos variables de categoría (extraídos de `listing.attributes`) se extienden
**antes** de los campos core en la función `toDocument`. Esto garantiza que ningún
atributo del seed pueda sobreescribir campos como `type` (que en algunos seeds de
categoría colisiona con `ListingType`) o `id`. El spread de atributos tiene prioridad
de definición inferior porque los campos core van después.

### DTO explícito de atributos variables por el ValidationPipe estricto

El backend arranca con `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`.
Cualquier query parameter que no esté declarado en `SearchQueryDto` es rechazado con
400. Por eso los atributos variables de categoría (brand, fuel, rooms, gender, size…)
están **declarados explícitamente** como campos del DTO en lugar de leerse como mapa
genérico. `VARIABLE_ATTRIBUTE_KEYS` en `search.service.ts` es la fuente de verdad
compartida; el DTO y el service deben mantenerse en sync al añadir atributos nuevos.

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

El flujo de publicación sube las fotos a R2/MinIO antes de crear el anuncio.
`ListingImage` se crea con `listingId: null`; al crear el anuncio se vincula vía
`linkImages`. Este diseño permite el wizard multistep pero deja imágenes huérfanas
si el usuario abandona el proceso (ver §3).

### Script reindex: `ReindexModule` mínimo y cierre limpio sin `process.exit()`

El script `apps/api/src/commands/reindex.ts` arranca un contexto NestJS con un
módulo propio (`ReindexModule`) que solo importa `PrismaModule` y `SearchModule`,
sin BullMQ ni Redis. Al no haber workers con handles persistentes en libuv,
`app.close()` cierra todo limpiamente. No se llama a `process.exit()` en el
camino feliz porque en Windows + Prisma 6.x el query-engine thread puede seguir
vivo y llamar a `uv_async_send()` sobre un handle ya cerrado (`UV_HANDLE_CLOSING`),
produciendo un volcado de memoria aunque el trabajo haya terminado correctamente.
En su lugar se llama a `prisma.$disconnect()` y se deja drenar el event loop.
El tsconfig dedicado (`tsconfig.scripts.json`) fuerza `"module": "CommonJS"` e
`"incremental": false` para que `ts-node` compile el script de forma portátil.
El script `geocode-backfill` sigue el mismo patrón (ver §Geocoding backfill).

### Gateway WebSocket y modelo de rooms (Fase 5)

El gateway (`MessagingGateway`) vive en el namespace `/ws` y usa socket.io vía
`@nestjs/websockets` + `@nestjs/platform-socket.io`. La autenticación se hace en
`handleConnection`: se extrae `socket.handshake.auth.token`, se verifica con
`JwtService.verify()` directamente (Passport no aplica en WebSocket), y si falla se
desconecta el socket. Si es válido, el socket se une automáticamente a la room
`user:${userId}`, que es el canal de la bandeja (`/mensajes`).

Para el chat (`/mensajes/[id]`), el cliente emite `conversation:join` con
`{ conversationId }` y el gateway verifica en Prisma que el usuario es participante
(buyerId o sellerId) antes de unirlo a la room `conv:${conversationId}`. La comprobación
de participante vive en el gateway (no en el controller) para mantener la autorización
cerca del recurso WebSocket. `socket.join` es idempotente, así que re-emitir
`conversation:join` en cada reconexión no genera efectos secundarios.

El POST REST sigue siendo la única vía de persistencia y validación. Tras persistir,
el controller llama a `gateway.emitNewMessage(conversationId, message, buyerId, sellerId)`,
que emite `message:new` a tres rooms: `conv:${conversationId}` (para los ChatClients de
ambos participantes) y `user:${buyerId}` + `user:${sellerId}` (para las bandejas de
cada uno). El canal de usuario evita que la bandeja tenga que unirse a todas las rooms
de conversación del usuario.

### Deduplicación idempotente por id en el cliente (Fase 5)

Existe una condición de carrera entre la respuesta del POST REST y el evento
`message:new` del socket: el WebSocket es una conexión persistente sin el overhead
HTTP, por lo que el evento del servidor puede llegar al cliente antes de que el
navegador reciba la respuesta HTTP. Si el socket llega primero, añade el mensaje al
estado de React; si luego llega el REST también lo añade, el mensaje aparece duplicado.

La solución aplica la guarda `prev.some(m => m.id === incoming.id)` **dentro del
actualizador funcional** de `setMessages` en ambas rutas de inserción:

```ts
// En el handler del socket (onMessage en useMessagingSocket):
setMessages(prev => prev.some(m => m.id === incoming.id) ? prev : [...prev, incoming]);

// En handleSend tras la respuesta del POST REST:
setMessages(prev => prev.some(m => m.id === msg.id) ? prev : [...prev, msg]);
```

Usar el actualizador funcional es imprescindible: garantiza que la comparación se
hace contra el estado real en el momento en que React aplica la actualización, no
contra un snapshot capturado por el closure cuando se definió la función.

### Fix de propagación de `emailVerified` desde login (Fase 5)

`POST /auth/login` no incluía `emailVerified` en el objeto `user` de la respuesta.
El `ContactButton` en la ficha de anuncio necesita este valor para decidir si mostrar
el formulario de contacto o el aviso de verificación pendiente.

Fix: se añadió `emailVerified: user.emailVerified` al objeto devuelto por
`AuthService.login`, y se actualizó la interfaz `LoginResponse` en `apps/web/src/lib/auth/index.ts`
para incluir el campo.

### Caducidad automática y renovación de anuncios

Los anuncios caducan 60 días tras su publicación (`EXPIRY_DAYS = 60` en
`ExpirationService`). El campo `expiresAt` se calcula en el momento de la
publicación con `ExpirationService.expiresAt(publishedAt)` y se persiste junto con
el cambio de estado a ACTIVE.

El cron `@Cron(CronExpression.EVERY_DAY_AT_2AM)` busca todos los anuncios ACTIVE
con `expiresAt ≤ now`, los marca EXPIRED en una sola llamada `updateMany`, y por
cada uno invalida la caché Redis y encola un job `index` para que Meilisearch los
retire del índice. Los anuncios RESERVED quedan excluidos del cron.

El endpoint `POST /listings/:id/renew` acepta anuncios en estado ACTIVE o EXPIRED,
reinicia `publishedAt` a la fecha actual y extiende `expiresAt` otros 60 días, con
reindexado inmediato.

### Geocoding configurable con fallback silencioso

`GeocodingService` resuelve coordenadas a partir de ciudad + provincia + código
postal. El proveedor se selecciona con la variable `GEOCODING_PROVIDER`:

- **`nominatim`** (por defecto): sin API key. 1 req/s; adecuado para dev y backfill.
- **`maptiler`**: requiere `MAPTILER_API_KEY`. Sin límite de tasa relevante en planes de pago.

Ambas rutas comparten un timeout de 1 500 ms vía `AbortSignal.timeout()`. Cualquier
error devuelve `null` sin lanzar excepción.

### Búsqueda por proximidad: `_geoRadius` + `_geoPoint`

`SearchQueryDto` expone `lat`, `lng` y `radius` (km). Cuando los tres están presentes,
el service aplica el filtro `_geoRadius(lat, lng, radiusMeters)` de Meilisearch y,
si no hay `sort` explícito, ordena por `_geoPoint(lat, lng):asc`. El frontend
implementa el control "cerca de mí" en `FilterPanel` con `navigator.geolocation`.

### Testing e2e: aislamiento por identificadores (Fase T)

La estrategia de testing (fuente de verdad: `docs/estrategia-testing.md`) usa
servicios reales sin mocks para detectar incompatibilidades de contrato. El
aislamiento entre entornos se consigue por convención de nombres, sin instancias
separadas:

| Recurso | Dev | Test |
|---|---|---|
| Postgres DB | `marketplace` | `marketplace_test` |
| Redis DB | `0` | `1` |
| Meilisearch índice | `listings` | `listings_test` (`MEILI_INDEX_NAME`) |
| MinIO/S3 bucket | `marketplace` | `marketplace-test` |

El índice de test se controla con `MEILI_INDEX_NAME` leído en tiempo de módulo:
`const LISTINGS_INDEX = process.env.MEILI_INDEX_NAME ?? 'listings'` en
`search.service.ts`. Esto garantiza que los tests de búsqueda nunca tocan el índice
de producción/desarrollo.

Los tests de Jest usan `setupFiles: ['test/load-env.ts']` (carga `.env.test` con
`dotenv.config()` sin sobreescribir `process.env`) y `globalSetup: 'test/setup-e2e.js'`
(ejecuta `prisma migrate deploy` + `seed-test.ts` una vez antes de todas las suites).

### Helpers y fixtures de test compartidos (Fase T)

Todos los helpers viven en `apps/api/test/helpers/`:

- `create-app.ts` — `createTestApp()`: arranca el `AppModule` completo con NestJS
  Testing (incluyendo los workers BullMQ), configurado igual que `main.ts`. Permite
  que los tests e2e ejerzan el ciclo completo publish → BullMQ → Meilisearch.
- `db.ts` — `cleanDb()`: trunca las tablas de dominio en el orden correcto (respetando
  FK) antes de cada suite.
- `meili.ts` — `waitForIndex(client, indexName, docId, timeoutMs)`: polling hasta que
  el documento aparece en Meilisearch. Necesario porque la indexación es asíncrona
  (BullMQ worker); sin él el test de búsqueda falla intermitentemente.

Para Playwright, `apps/web/e2e/fixtures/auth.ts` define los fixtures `sellerContext` y
`buyerContext` que cargan los `storageState` generados por `global-setup.ts`.

### `global-setup.ts` de Playwright y seed de usuarios e2e (Fase T)

El `global-setup.ts` de Playwright (`apps/web/e2e/global-setup.ts`) corre después de
que los webServers estén listos y hace:
1. Carga `.env.test` (no-op en CI donde las vars ya están en el entorno).
2. Guarda con un safety-check que `DATABASE_URL` apunte a `marketplace_test`.
3. `prisma migrate deploy` (idempotente tras las suites Jest).
4. `seed-test.ts` (categorías mínimas para el wizard: Electrónica → Móviles).
5. `seed-playwright.ts` (crea `seller-e2e@example.com` y `buyer-e2e@example.com`).
6. Abre Chromium, hace login con cada usuario y guarda el `storageState` en
   `e2e/fixtures/` (gitignoreado). Los tests del recorrido crítico reaprovechan
   estas sesiones sin volver a pasar por el UI de login.

### webServer de Playwright y propagación de env vars en CI (Fase T)

`playwright.config.ts` declara dos `webServer`: backend (`pnpm dev` en puerto 3001)
y frontend (`pnpm dev` en puerto 3000). `reuseExistingServer: !process.env.CI`
garantiza que en CI siempre se arranquen servidores frescos.

El backend webServer recibe `env: { ...testEnv, PORT: '3001' }`. `testEnv` se
parsea de `apps/api/.env.test` (fichero comprometido en git con valores para el
entorno de test, incluida `MEILI_MASTER_KEY`). Playwright mezcla internamente
`webServer.env` con `process.env` del proceso padre; dado que `testEnv` va en el
objeto explícito, sus valores sobreescriben cualquier variable homónima del entorno
del job CI. Esto asegura que el backend use la misma clave de Meilisearch que el
contenedor CI (`masterKey_dev_change_me`), que coincide con el valor de `.env.test`.

### CI: workflow de GitHub Actions (Fase T — RT.5)

`.github/workflows/ci.yml` define dos jobs:

**Job `lint`** (sin contenedores de servicio):
- `actions/checkout@v7`, `pnpm/action-setup@v6` (pnpm 11.8.0), `actions/setup-node@v6` (Node 22, caché pnpm).
- `pnpm install --frozen-lockfile`
- `pnpm --filter @marketplace/api prisma:generate` (necesario antes de cualquier typecheck — sin el cliente generado, los tipos de Prisma no existen).
- `npx tsc --noEmit` en `apps/api`, `next lint` y `tsc --noEmit` en `apps/web`.

**Job `e2e`** (necesita `lint`):
- Service containers: `postgis/postgis:16-3.5` (con health-cmd `pg_isready`), `redis:7-alpine` (con health-cmd `redis-cli ping`), `getmeili/meilisearch:v1.10` (sin health-cmd — se usa polling en su lugar; ver más abajo).
- MinIO **no** puede ser service container porque `minio/minio` requiere el CMD `server /data`, que los service containers de GitHub Actions no soportan. Se arranca con `docker run -d` en un step, se espera con polling a `/minio/health/live` y se crea el bucket + política de lectura pública con AWS CLI.
- El step **"Wait for Meilisearch"** hace polling a `GET /keys` con `Authorization: Bearer <masterKey>` en lugar de `GET /health`. `/health` devuelve 200 en cuanto el servidor HTTP levanta, pero el subsistema de gestión de claves puede tardar unos milisegundos más; si el backend arrancaba en esa ventana obtenía 401.
- `pnpm install`, `prisma:generate`, Playwright browsers, suites Jest (`pnpm test:e2e`), Playwright (`pnpm test:e2e`), upload del report como artifact.

Las variables de entorno del job CI coinciden con los valores de `apps/api/.env.test`
para que las suites Jest (que cargan ese fichero) y el backend de Playwright (que lo
recibe vía `testEnv`) usen exactamente las mismas claves.

### Observabilidad: Sentry (Fase T — RT.6)

**Backend**: `Sentry.init()` en `main.ts` antes de `NestFactory.create()` con
`@sentry/nestjs`. Cuando `SENTRY_DSN` es vacío (desarrollo, test) el SDK se
desactiva silenciosamente sin errores ni warnings. Los tres processors BullMQ
(`IndexingProcessor`, `ImageProcessor`, `NotificationProcessor`) envuelven su
`process()` en try/catch con `Sentry.captureException(err)` + re-throw, de modo
que BullMQ sigue gestionando reintentos igual que antes.

**Frontend**: `apps/web/src/instrumentation.ts` exporta `register()` que inicia
Sentry solo cuando `process.env.NEXT_RUNTIME === 'nodejs'`. Cubre errores de Server
Components, Route Handlers, Server Actions y Middleware. **Los errores de componentes
cliente (navegador) están fuera de alcance de RT.6**: requieren un init separado con
`NEXT_PUBLIC_SENTRY_DSN` y un fichero de configuración de cliente, que no se ha
implementado todavía.

### Observabilidad: logging estructurado con pino (Fase T — RT.6)

`nestjs-pino` reemplaza el logger por defecto de NestJS. `LoggerModule.forRoot()` en
`AppModule` con:
- `level: 'error'` en `NODE_ENV=test` → la salida de Jest solo muestra errores reales.
- `transport: { target: 'pino-pretty' }` únicamente en `NODE_ENV=development` → el
  worker thread de pino-pretty no existe en test ni en producción, eliminando una
  fuente conocida de fallos de arranque en entornos e2e.
- En producción: salida JSON cruda (sin transport), nivel `info`.

`main.ts` llama a `app.useLogger(app.get(Logger))` con `bufferLogs: true` para que
todos los `new Logger()` existentes en los services queden enrutados por pino y los
mensajes del bootstrap no se pierdan antes de que el logger esté listo.

### Markdown del blog: `rehype-sanitize` sin `rehype-raw` (Fase B — regla invariante)

El body de los posts se almacena en Markdown raw y se renderiza con
`react-markdown` + `remark-gfm` + `rehype-sanitize`. **`rehype-raw` no se
incluye y no debe añadirse nunca.**

Sin `rehype-raw`, cualquier HTML literal en el cuerpo (p.ej. `<script>`) se
renderiza como texto escapado, no se ejecuta. Con `rehype-sanitize` como segunda
capa se eliminan además atributos peligrosos (`onclick`, `href=javascript:`, etc.)
de los elementos que `react-markdown` sí genera legítimamente (links, imágenes…).

La doble capa importa aunque la autoría sea solo-admin: si una cuenta admin fuera
comprometida, un payload XSS en `body` afectaría a todos los lectores del blog
(el contenido se sirve públicamente vía SSR). La regla es invariante: si en el
futuro se necesita soporte de HTML embebido, `rehype-sanitize` sigue siendo
obligatorio y `rehype-raw` requiere una revisión de seguridad explícita.

Los tres paquetes (`react-markdown` v10, `remark-gfm` v4, `rehype-sanitize` v6)
son ESM-only. Se añadieron a `transpilePackages` en `next.config.ts` para que
Webpack los empaquete sin errores de tipo de módulo.

### `@tailwindcss/typography`: import ESM, no `require()` (Fase B)

El plugin se importa en `tailwind.config.ts` con `import typography from '@tailwindcss/typography'`
y se referencia como `plugins: [typography]`. El proyecto usa `"type": "module"`,
por lo que `tailwind.config.ts` se evalúa como ES Module y `require()` no existe
en ese contexto. El error de runtime es `ReferenceError: require is not defined`
en la línea del plugin. La regla general: cualquier plugin de Tailwind en este
proyecto debe importarse con `import`, no con `require()`.

### Portadas del blog: solo upload a nuestro almacenamiento (Fase B)

`Post.coverUrl` almacena la URL resultante de `POST /media/upload`, que devuelve
`${S3_PUBLIC_URL}/${key}` — siempre una URL de nuestro almacenamiento
(`http://localhost:9000/...` en dev, `https://*.r2.cloudflarestorage.com/...` en
prod). El formulario de backoffice solo expone un botón de upload; no hay campo de
texto libre para pegar URLs externas.

Las páginas públicas del blog usan el helper `isSafeSrc(url)` para decidir si
renderizar `<Image>` de Next.js o el placeholder muted (ver §3 para la deuda de
sincronización con `remotePatterns`). Una `coverUrl` de dominio externo en BD
degrada silenciosamente a placeholder, sin crashear la página.

### `@IsUrl({ require_tld: false })` en el DTO del blog (Fase B)

`CreatePostDto` y `UpdatePostDto` validan `coverUrl` con
`@IsUrl({ require_tld: false })`. Sin la opción, `validator.js` rechaza
`http://localhost:9000/...` con 400 porque `localhost` no tiene TLD
(`require_tld: true` por defecto). El mismo patrón aplica a cualquier campo de URL
que pueda contener hostnames sin TLD en desarrollo. Es el mismo problema que
afectó a `RESEND_FROM` con dominios `.local` en la Fase T.

### AuditLog: captura explícita en el service, nunca vía interceptor (Fase 7)

**Decisión innegociable** (diseño: `docs/diseno-backoffice.md` §2): el AuditLog se
captura llamando a `AuditLogService.log()` explícitamente dentro del método del service
de dominio que va a mutar el recurso, después de leer el estado `before` y antes de
devolver la respuesta.

Un interceptor de NestJS tiene acceso al `ExecutionContext` (petición y respuesta HTTP)
pero **no al estado de Prisma antes de la mutación**. Para que `AuditLog.before` sea
útil (y es el motivo principal del modelo) hay que capturarlo en el momento exacto en
que el service ya sabe qué va a cambiar. Un interceptor que lea la respuesta solo conoce
el estado posterior; el anterior requeriría una query adicional desacoplada del contexto
de negocio, frágil de mantener y fuera del control del service.

Patrón aplicado uniformemente en `AdminService` y `ModerationService`:
```ts
const before = { status: resource.status };
await this.prisma.resource.update({ ... });
await this.auditLog.log({ action, actorId, resourceType, resourceId, before, after, ip });
```

### BadWordService: filtro con fallback silencioso al publicar (Fase 7)

`BadWordService.check(title, description)` lee `Setting.badWordList` de BD (con caché
Redis de TTL corto). Si la lista está vacía o el servicio falla, el flujo de publicación
continúa hacia `ACTIVE` sin excepción. Si hay match → el estado destino pasa a
`PENDING_REVIEW` en lugar de `ACTIVE`.

El principio es el mismo que el geocoding: la moderación automática es una capa de
ayuda, no un bloqueante. Un error en `BadWordService` no puede impedir que un usuario
publique su anuncio.

El wizard del frontend refleja el resultado real: si el backend devuelve
`status: 'PENDING_REVIEW'`, muestra un panel informativo en lugar de navegar a la
ficha del anuncio (que daría 404 porque los anuncios en PENDING_REVIEW no son públicos).

### Protección anti-degradación de ADMIN en cambio de rol (Fase 7)

`PATCH /admin/users/:id/role` acepta solo `USER` y `MODERATOR` como valor destino
(validado en `ChangeUserRoleDto` vía `@IsIn`). Además, `AdminService.changeUserRole()`
aplica una segunda comprobación: si el usuario objetivo tiene `role === ADMIN`, lanza
`403 Forbidden`. La doble validación (DTO + service) garantiza que la regla no sea
bypasseable llamando directamente al service.

El frontend no muestra botones de acción (suspend/ban/role) para usuarios con `role ===
ADMIN`, lo que evita llegar al 403 en el caso normal. Pero el guard del service es la
línea de defensa real.

### Settings: whitelist explícita en el service (Fase 7)

`PATCH /admin/settings/:key` lleva una whitelist en el service:
`['badWordList', 'listingExpiryDays', 'contactRequiresVerification']`. Cualquier otra
clave recibe un `400 Bad Request` con el listado de claves válidas. Esto previene la
creación accidental de settings arbitrarios desde la API. La whitelist vive en el
service (no en el DTO) porque la clave llega como path param, no como body.

El tipo del `value` es `unknown` en el DTO (con `@Allow()` de class-validator para
sobrevivir al `whitelist: true` del `ValidationPipe`) y se castea a
`Prisma.InputJsonValue` al persistir. La validación del shape concreto (array de
strings, número, booleano) la hace el frontend con controles tipo-específicos.

### Migración `add_audit_log_and_settings` (Fase 7)

Una sola migración añade los modelos `AuditLog` y `Setting`. Detalles relevantes:
- `AuditLog.before` y `.after` son `Json?` — permiten capturar cualquier shape sin
  un schema rígido.
- `AuditLog` indexado por `actorId`, por `(resourceType, resourceId)` y por `createdAt`
  para consultas eficientes en el backoffice.
- `Setting.key` es la clave primaria (`@id String`). No existe un endpoint para crear
  keys arbitrarias; el seed crea las tres keys conocidas.
- `Setting.updatedById` registra el admin que actualizó el ajuste; puede ser `null`
  en el seed inicial.

### UserStatus aplicado en login y en el guard JWT (Fase 7 — deuda cerrada)

Tanto SUSPENDED como BANNED bloquean el acceso con el mismo comportamiento técnico
(403 Forbidden), diferenciado únicamente en el mensaje al usuario. No se distingue
semánticamente en la API porque añadiría edge cases (p.ej. "SUSPENDED puede leer pero
no escribir") sin un requisito de negocio concreto para el MVP.

**Bloqueo en login** (`AuthService.login()`): tras verificar la contraseña, se
comprueba `User.status`. Si es SUSPENDED o BANNED se lanza `ForbiddenException` con
mensaje específico antes de emitir el token. Se usa 403 y no 401 porque las
credenciales son correctas — el problema es el estado de la cuenta.

**Bloqueo en el guard** (`JwtStrategy.validate()`): convertida a `async`; hace un
`findUnique` por `userId` (clave primaria indexada) en cada petición autenticada.
Si el usuario no existe → 401; si SUSPENDED o BANNED → 403. Esto garantiza que un
token emitido antes del baneo queda inoperativo en la siguiente petición, sin
necesidad de invalidar el JWT.

Se eligió la query a Postgres sobre las alternativas:
- **Status en el JWT payload**: inútil con TTL de 7 días; el usuario baneado opera
  durante todo ese período.
- **Blacklist en Redis**: bloqueo inmediato sin query por request, pero requiere
  mantener el blacklist al suspender/banear/reinstaurar y aumenta la complejidad
  operativa. Es la evolución natural si el tráfico crece y la query de Postgres
  se convierte en un cuello de botella.

---

## 3. Limitaciones conocidas y deuda técnica

### CORS del gateway WebSocket: `origin: '*'` a restringir en producción

El gateway está decorado con `cors: { origin: '*' }`. En producción debe restringirse
al origen del frontend (valor de `APP_URL`). El TODO está anotado en `messaging.gateway.ts`.

### `allowedDevOrigins` en Next.js si se accede por IP en desarrollo

En Next.js 15, si el frontend se sirve por IP en lugar de `localhost`, el App Router
genera advertencias de CORS para los preloads de scripts. Se puede suprimir añadiendo
la IP a `allowedDevOrigins` en `next.config.ts`.

### `conversation:read` (mark-as-read) no implementado vía WebSocket

El contrato define el evento `conversation:markRead` (cliente → servidor) y
`conversation:read` (servidor → cliente) para señalizar la lectura en tiempo real.
Por ahora los mensajes se marcan como leídos en `GET /conversations/:id` (al abrir
el chat), pero el contador de no leídos de la bandeja del otro participante solo
baja al recargar. Pendiente: añadir el evento en el gateway.

### Nominatim en producción: límite de 1 req/s

En producción, bajo cualquier carga real, es necesario cambiar a `GEOCODING_PROVIDER=maptiler`
+ `MAPTILER_API_KEY` o a una instancia propia de Nominatim.

### Geolocalización del navegador solo en contexto seguro (HTTPS)

`navigator.geolocation` solo está disponible en orígenes seguros. El botón "cerca de
mí" de `FilterPanel` quedará inoperativo si el frontend se sirve por HTTP en una IP
de red local.

### Renombrar atributo `type` → `itemType` en el seed

Varias categorías del seed usan un atributo `type` que colisiona con el campo `type`
de nivel de anuncio (`ListingType`). El orden del spread en `toDocument` previene la
sobreescritura, pero el atributo no se indexa. Pendiente renombrarlo a `itemType`.

### `size`: inconsistencia de tipo string/number entre categorías

En ropa `size` se almacena como cadena; en calzado como número. Necesita normalización
en el seed antes de que el filtro funcione de forma fiable en todas las categorías.

### Sin `DELETE /media`

No existe endpoint para eliminar imágenes. Las imágenes subidas en wizards abandonados
permanecen en almacenamiento con `listingId: null`. Pendiente: `DELETE /media/:id`.

### Notificaciones de email: Resend configurado para desarrollo

En producción hay que verificar el dominio remitente en el panel de Resend y
actualizar `RESEND_FROM`.

### `isSafeSrc` duplica los `remotePatterns` de `next.config.ts` (Fase B)

Las páginas públicas del blog (`/blog` y `/blog/[slug]`) contienen la función
`isSafeSrc(url)` que valida el hostname de la `coverUrl` antes de pasarla a
`<Image>` de Next.js. La lógica replica manualmente los `remotePatterns` definidos
en `next.config.ts`:

```ts
// isSafeSrc — debe mantenerse en sync con next.config.ts remotePatterns
if (protocol === 'http:' && hostname === 'localhost') return true;
if (protocol === 'https:' && hostname.endsWith('.r2.cloudflarestorage.com')) return true;
```

Si en producción se migra a otro proveedor de almacenamiento (p.ej. un dominio
personalizado en R2 o un CDN propio), hay que actualizar **ambos** sitios:
`next.config.ts` (para que Next.js sirva la imagen) y `isSafeSrc` en los dos
ficheros de página del blog (para que no la degrade a placeholder). Si solo se
actualiza uno, la imagen no carga pero sin error visible, lo que dificulta el
diagnóstico.

Evolución natural: extraer `isSafeSrc` a un helper compartido en `src/lib/`
que importe las `remotePatterns` desde la configuración de Next.js, eliminando
la duplicación.

### Módulo stub pendiente: valoraciones

El controller y service de `reviews` existe con cuerpo vacío.
La estructura de BD está completa. No planificado en el Hito 2.

### Sin paginación en categorías ni en el home

`GET /categories` devuelve el árbol completo. Aceptable con < 200 categorías.

### Slug de anuncio sin reintento ante colisión

`buildSlug` genera `{base}-{6-char-hex}`. Una colisión lanzaría `P2002`. No hay
lógica de reintento.

### Captura de errores de cliente (navegador) pendiente en Sentry

`instrumentation.ts` cubre únicamente el runtime Node.js del servidor de Next.js.
Los errores de componentes cliente (React hydration, clics, fetch fallidos en el
navegador) no se capturan todavía. Requiere un init separado con
`NEXT_PUBLIC_SENTRY_DSN` y un fichero `sentry.client.config.ts`. Pendiente para
una iteración futura de observabilidad.

### Sentry activo solo en staging/producción

Con `SENTRY_DSN=` vacío en dev y test, Sentry no envía eventos en esos entornos.
Para verificar que la integración funciona correctamente antes de producción, se
recomienda configurarlo en un entorno de staging con un DSN real de Sentry.

---

## 4. Documentación de la API y el diseño

- **Swagger**: `http://localhost:3001/api/docs` cuando el backend está corriendo.
  Fuente de verdad del contrato de endpoints.
- **Estrategia de testing**: `docs/estrategia-testing.md`.
- **Diseño del backoffice (Fase 7)**: `docs/diseno-backoffice.md` — decisiones de
  arquitectura, modelos AuditLog y Setting, flujo de moderación, endpoints admin,
  estructura de páginas del backoffice, orden de ráfagas.
- **Diseño del blog (Fase B)**: `docs/diseno-blog.md` — modelo Post, migración,
  decisión de renderizado Markdown (rehype-sanitize sin rehype-raw), estrategia SEO
  (OG, JSON-LD, sitemap, ISR), endpoints públicos y admin, orden de ráfagas RB.2–RB.4.

---

## 5. Cómo arrancar el proyecto

```bash
# Infraestructura (Postgres, Redis, Meilisearch, MinIO)
docker compose up -d

# Backend
pnpm --filter @marketplace/api dev      # http://localhost:3001/api

# Frontend
pnpm --filter @marketplace/web dev      # http://localhost:3000

# Reconstruir el índice de búsqueda
pnpm --filter @marketplace/api reindex

# Geocodificar anuncios sin coordenadas
pnpm --filter @marketplace/api geocode-backfill
```

### Correr los tests

```bash
# ── Backend e2e (Jest + Supertest) ──────────────────────────────────────────
# Prerrequisito único (local): crear la base de datos de test
docker exec marketplace-postgres psql -U marketplace -c "CREATE DATABASE marketplace_test"

# Ejecutar todas las suites
pnpm --filter @marketplace/api test:e2e

# Ejecutar una suite específica
pnpm --filter @marketplace/api test:e2e -- --testPathPattern=auth

# ── Frontend e2e (Playwright) ────────────────────────────────────────────────
# El backend debe estar corriendo en modo test (puerto 3001) antes de lanzar:
#   $env:NODE_ENV="test"; pnpm --filter @marketplace/api dev
# O dejar que playwright.config.ts lo arranque automáticamente (reuseExistingServer=false en CI)
pnpm --filter @marketplace/web test:e2e
```

### Variables de entorno

Ficheros de referencia: `apps/api/.env.example` y `apps/web/.env.example`.

Variables relevantes para testing y observabilidad (respecto a fases anteriores):

| Variable | App | Valor en test | Descripción |
|---|---|---|---|
| `MEILI_INDEX_NAME` | api | `listings_test` | Índice Meilisearch de test; `listings` en dev/prod |
| `SENTRY_DSN` | api + web | `""` (vacío) | DSN de Sentry; vacío desactiva el SDK sin errores |
| `GEOCODING_PROVIDER` | api | `nominatim` | Proveedor de geocoding; `maptiler` para producción |
| `MAPTILER_API_KEY` | api | — | Solo si `GEOCODING_PROVIDER=maptiler` |
