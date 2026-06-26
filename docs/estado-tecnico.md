# Estado técnico del proyecto — Marketplace

> Fecha: 2026-06-27 · Rama: `main` · Último commit: RF.7 completo (límites por plan + cron de expiración de entitlements)
> Plan vigente para la siguiente fase: `docs/Hoja_de_ruta_rafagas_Hito2.docx`.

Documento de referencia para retomar el proyecto. Recoge qué hay implementado,
qué decisiones se tomaron respecto al diseño original y qué queda pendiente.

---

## 1. Estado de implementación por módulo

### Backend (`apps/api` — puerto 3001)

| Módulo | Estado | Notas |
|---|---|---|
| **Infra: Prisma** | ✅ Completo | Schema con todos los modelos; PostGIS habilitado; **11 migraciones aplicadas** hasta RF.7 (las de billing RF.2–RF.6 añaden Subscription, Transaction, Wallet, Entitlement, CreditLedger, GatewayEvent, Price…; **RF.7** añade **`add_entitlement_revoked_at`**: columna nullable `Entitlement.revokedAt DateTime?` + índice) |
| **Infra: Redis** | ✅ Completo | `RedisService` global; caché de fichas de anuncio (TTL 5 min) |
| **Infra: BullMQ** | ✅ Colas activas | 4 colas registradas con processors reales: `image-processing`, `indexing`, `notifications`, `billing`, `redsys` |
| **Infra: Meilisearch** | ✅ Completo | `SearchService.onModuleInit()` crea el índice `listings` y aplica searchable/filterable/sortable attrs, ranking rules y typo tolerance al arrancar |
| **Infra: MinIO/R2** | ✅ Completo | Dev: MinIO vía docker-compose (bucket `marketplace` con lectura pública, creado por el contenedor `createbuckets`). Prod: Cloudflare R2 vía `R2Service` |
| **Auth** | ✅ Completo | register, login, verify-email, forgot-password, reset-password; `JwtAuthGuard`, `RolesGuard`, `@CurrentUser`; login devuelve `emailVerified` (fix fase 5) |
| **Users** | ✅ Completo | `GET /users/me`, `PATCH /users/me`, `GET /users/:slug` (perfil público) |
| **Categories** | ✅ Completo | `GET /categories` (árbol público), `GET /categories/:slug` (con `attributeSchema`) |
| **Listings** | ✅ Completo | CRUD completo + ciclo de vida (publish, reserve, sold, delete, **renew**) + `expiresAt` fijado al publicar (publishedAt + 60 días) + caché por slug + encolado de reindexado; `GET /listings/mine/:id` para edición; `thumbnailUrl` resuelto en `findMine` y `findBySellerSlug`; geocoding automático al crear y al editar cuando cambia la ubicación. **RF.7-A**: `publish()` y `renew()` verifican el límite de activos del plan (free: 5, pro: 20, leídos de `Setting`; 403 si superado). **Fix RF.7**: `renew()` preserva `publishedAt` original y no lo resetea (resetear era un bump gratuito que vaciaba de sentido el bump de pago de RF.6) |
| **Expiration** | ✅ Completo | `ExpirationService`: cron 02:00 — marca EXPIRED los anuncios ACTIVE con `expiresAt ≤ now`, invalida caché Redis y encola reindexado (RESERVED excluidos intencionalmente). **RF.7-B**: `EntitlementExpirationService`: cron 03:00 con **dos expiraciones en paralelo** — **B.1** `expireFeaturedListings`: selecciona entitlements `FEATURED_LISTING` caducados sin `revokedAt`, los marca en batch (`updateMany → revokedAt = now`, crash-safe), encola reindex con `boostScore:0`; deduplicación BullMQ por `jobId = feat-exp-${id}-${fecha}`. **B.2** `downgradeExpiredPro`: usuarios con `PRO_SUBSCRIPTION` expirado hace > 7 días (periodo de gracia), sin suscripción activa renovada; mueve los listings en exceso a DRAFT ordenado por `publishedAt asc` (más antiguos primero); **purga caché Redis + encola reindex** para cada listing drafteado → Meilisearch los elimina del índice. `runExpirationSweep()` público para tests sin necesidad de reloj real |
| **Geocoding** | ✅ Completo | `GeocodingService` con proveedor configurable (`nominatim` por defecto, `maptiler`). Timeout de 1 500 ms con `AbortSignal.timeout()`; retorna `null` en cualquier fallo sin bloquear la publicación. Script `geocode-backfill` para anuncios sin coordenadas existentes (cursor-based, 1 req/s para respetar la política de Nominatim) |
| **Media** | ✅ Upload | `POST /media/upload` → R2/MinIO → crea `ListingImage` huérfana → encola procesado con sharp; **sin DELETE** |
| **Search** | ✅ Completo | `GET /search` con texto libre, filtros core, atributos variables (brand, fuel, rooms, gender, size…), **filtro por proximidad** (`lat` + `lng` + `radius` en km → `_geoRadius` en Meilisearch) y **orden por distancia** cuando no hay sort explícito, facetas, paginación y ordenación; `IndexingProcessor` real con jobs `index`/`remove` |
| **Script reindex** | ✅ Completo | `pnpm reindex` — reconstruye el índice en batches de 100; `ReindexModule` mínimo (sin BullMQ) para cierre limpio |
| **Messaging** | ✅ Completo | REST: `GET /conversations`, `POST /conversations`, `GET /conversations/:id` (cursor), `POST /conversations/:id/messages`. WebSocket gateway `/ws`: auth en handshake, rooms de conversación y de usuario, emit tras el POST REST |
| **AuditLog** | ✅ Completo | `AuditLogService.log()` inyectable; captura explícita `before`/`after` dentro del método de service que muta el recurso, antes de llamar a Prisma; nunca vía interceptor (ver §2) |
| **Moderation** | ✅ Completo | Reportes CRUD + cola (GET con filtros status/reason/page); acciones sobre listings (approve, reject, deactivate, restore); `BadWordService` con fallback silencioso al publicar; AuditLog en todas las mutaciones; roles MODERATOR + ADMIN |
| **Admin** | ✅ Completo | Listings (list, detail, PATCH status); Users (list, detail, suspend, ban, reinstate, role); Categories CRUD + batch reorder; Settings GET + PATCH con whitelist; `GET /admin/stats` con 7 métricas + Meilisearch null-fallback; todos los endpoints con `@Roles(ADMIN)` y AuditLog. **RF.7**: whitelist de settings ampliada con `freeActiveListingLimit` y `proActiveListingLimit`; ambos configurables desde el backoffice sin redeploy |
| **Blog** | ✅ Completo | Modelo `Post` (enum `PostStatus { DRAFT, PUBLISHED }`, body Markdown raw, `tags String[]`, `coverUrl`, campos SEO opcionales `metaTitle`/`metaDescription`). `BlogController`: `GET /blog` (solo PUBLISHED, paginado, filtro `?tag=`) y `GET /blog/:slug` (404 si no existe o es DRAFT). `BlogAdminController` (`@Roles(ADMIN)`): CRUD completo + `POST /admin/blog/:id/publish` + `POST /admin/blog/:id/unpublish`. AuditLog en todas las mutaciones (`POST_CREATE`, `POST_UPDATE`, `POST_PUBLISH`, `POST_UNPUBLISH`, `POST_DELETE`). Revalidación ISR on-demand fire-and-forget al publicar/despublicar/editar/borrar posts publicados (el blog es el **primer productor del webhook** desde el backend; el webhook en sí existía desde Fase 5). `BlogModule` importa `PrismaModule` + `AuditLogModule`; autónomo, no modifica `AdminModule` |
| **Favorites** | ✅ Completo | `POST /favorites/:listingId` (marcar), `DELETE /favorites/:listingId` (desmarcar), `GET /favorites` (paginado), `GET /favorites/:listingId` (check), `POST /favorites/batch-check` (máx. 100 ids → `{ favoritedIds }`). Todos idempotentes y con `JwtAuthGuard`. Suite `favorites.e2e-spec.ts` (12 tests) |
| **Reviews** | ✅ Completo | `POST /reviews` (crear; guard de elegibilidad vía `Conversation`), `GET /reviews/eligibility?listingId=&targetId=` (check antes de mostrar el formulario), `PATCH /reviews/:id` (editar en ventana 72 h; persiste `editedAt`), `DELETE /reviews/:id` (borrar en ventana 72 h). Listado público via `GET /users/:slug/reviews` (cursor paginado + aggregate on-the-fly: average, count, distribución 1–5). Unicidad `(authorId, targetId, listingId)` — una reseña por par de usuarios por anuncio. `FAKE_REVIEW` añadido a `ReportReason`; `Report.reviewId` FK con CASCADE para moderar reseñas. Suite `reviews.e2e-spec.ts` (20 tests) |
| **BillingModule (Stripe)** | ✅ RF.3 Completo | Checkout Pro (Stripe Checkout), `StripeWebhookGuard`, `BillingProcessor` (5 eventos), `EntitlementService`. Verificado con Stripe CLI. Pendiente: renovación (segunda factura) |
| **RedsysModule** | ⚠️ RF.5 — verificación PARCIAL | `RedsysService` (checkout credits-pack / featured-pay, Ds_Order YYYYMMDD+4random con retry), `RedsysWebhookGuard` (HMAC vía `redsys-easy`, idempotencia doble capa, enqueue / FAILED), `RedsysProcessor` (acreditación wallet atómica: Wallet + CreditLedger + Transaction en `$transaction`, validación importe `Ds_Amount` vs `amountGross×100`, idempotencia capa 2 por `status≠PENDING`). Endpoints: `POST /billing/checkout/credits-pack`, `POST /billing/checkout/featured-pay`, `POST /webhooks/redsys`. **VERIFICADO (e2e, 12 tests)**: acreditación wallet, acumulación de balance, idempotencia ×2 (GatewayEvent P2002 + status≠PENDING), cálculo IVA sin descuadre (4,99 / 9,99 / 19,99 €), validación importe (mismatch → FAILED sin tocar wallet), unicidad de 1.000 Ds_Order generados. **NO VERIFICADO — pendiente de tooling Redsys**: (1) firma HMAC real contra Redsys, (2) generación correcta del form de pago y que Redsys lo acepte, (3) recepción de notificación online real. Requiere: túnel público (ngrok/cloudflared) + credenciales sandbox Redsys + tarjetas de prueba Redsys. RF.5 **no está verificada de punta a punta** hasta eso — análogamente a RF.3 antes del CLI de Stripe. **PENDIENTE InSite vs Redirección**: el diseño asume Redirección (SAQ A); confirmar con quien impone el requisito antes de arrancar el frontend RF.10. `featuredByRedsys`: TODO completado en RF.6 — `RedsysProcessor.handleFeaturedPay` ya llama a `grantFeaturedListing`; camino end-to-end sin firma/notificación Redsys real pendiente de tooling (deuda heredada). |
| **EntitlementService (RF.7)** | ✅ Actualizado | Validez de un entitlement: `revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now)`. Un entitlement con `revokedAt` seteado **no** cuenta como vigente aunque `expiresAt` sea futuro (permite revocación manual desde backoffice en el futuro). Helper `activeFilter()` centraliza el predicado en `isProActive`, `isFeaturedActive` y `findActiveForUser` |
| **BillingModule RF.6** | ✅ Completo | **`grantFeaturedListing(params)`** — punto único de concesión de `FEATURED_LISTING`; valida ACTIVE + propietario (→403) + sin entitlement activo (→400); crea `Entitlement` con `expiresAt = now + durationDays`; encola reindexado. No conoce la vía de pago. **`featuredByCredits`** — `POST /billing/featured-by-credits { priceId, listingId }`: debit atómico (`UPDATE Wallet WHERE balance >= cost`, affected=0 → 402) + `CreditLedger FEATURED_DEBIT` + entitlement, todo en una `$transaction`; rollback automático si la concesión falla. **`bump`** — `POST /listings/:id/bump`: cooldown 1h (→429 Retry-After); debit atómico + `CreditLedger BUMP_DEBIT` + `Listing.bumpedAt`, todo en una `$transaction`; fallos 402/403/400 no consumen cooldown. **`GET /billing/wallet`** — saldo + ledger paginado. **Dependencia `ListingsModule → BillingModule`**: unidireccional, sin circular, NestJS arranca limpio. **VERIFICADO (batería e2e completa, 181/181, 15 casos nuevos)**: grantFeaturedListing como punto único; débito atómico con rollback (saldo restaurado + sin `CreditLedger` huérfano); cooldown no consumido en fallos; convergencia de vías (featuredByCredits y featuredByRedsys producen mismo entitlement: tipo, priceId, `|expiresAt_A − expiresAt_B| < 60s`). **DEUDA HEREDADA de RF.5**: camino featuredByRedsys implementado pero sin ejercicio E2E contra Redsys real (firma/notificación pendientes de tooling). |

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
**preserva el `publishedAt` original** (no lo resetea — resetear sería un bump gratuito
que vaciaría de sentido el bump de pago de RF.6), extiende `expiresAt` 60 días desde
`now`, no toca `bumpedAt`, y encola reindexado inmediato.

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

Las **14 suites e2e de Jest** suman **198 casos**: smoke (1), auth (15), listings (10),
messaging (7), search (8), favorites (12), reviews (20), moderation (23), admin (34),
blog (24), redsys (12), billing-rf6 (15), rf7-limits (8), rf7-expiration (9).
Las suites se ejecutan en paralelo (sin `--runInBand`); el diseño de `cleanDb` — que
solo trunca `User` CASCADE y nunca toca `Category` ni `Setting` — garantiza que no
haya contención entre los workers de Jest.

### Helpers y fixtures de test compartidos (Fase T)

Todos los helpers viven en `apps/api/test/helpers/`:

- `create-app.ts` — `createTestApp()`: arranca el `AppModule` completo con NestJS
  Testing (incluyendo los workers BullMQ), configurado igual que `main.ts`. Permite
  que los tests e2e ejerzan el ciclo completo publish → BullMQ → Meilisearch.
- `db.ts` — `cleanDb()`: emite `TRUNCATE "User" CASCADE`, que elimina en cascada todas
  las filas FK-dependientes (Listing, Conversation, Message, Favorite, Review, Report,
  ListingImage, tokens, Post, AuditLog…). `Category` y `Setting` quedan **excluidos** —
  son datos estáticos sembrados una sola vez en `globalSetup` vía upsert idempotente.
  Truncarlos en `cleanDb` provocaría race conditions cuando Jest ejecuta suites en
  paralelo sobre la misma BD.
- `meili.ts` — `waitForIndex(client, indexName, docId, timeoutMs = 15 000 ms)` y
  `waitForRemoval(client, indexName, docId, timeoutMs = 15 000 ms)`: polling hasta que
  el documento aparece / desaparece en Meilisearch. Necesarios porque la indexación es
  asíncrona (BullMQ worker); sin ellos los tests de búsqueda y de eliminación fallan
  intermitentemente. El timeout de 15 s cubre los service containers de CI, que tardan
  más que el entorno local.

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

**Frontend (servidor)**: `apps/web/src/instrumentation.ts` — `register()` inicia
Sentry en runtime `nodejs`; `onRequestError` captura errores de RSC anidados
(Next.js 15+). Cubre Server Components, Route Handlers, Server Actions y Middleware.

**Frontend (cliente/navegador)**: `instrumentation-client.ts` — init con
`NEXT_PUBLIC_SENTRY_DSN`; captura hydration failures, unhandled rejections, errores
de clic y navegaciones. `global-error.tsx` reporta React render errors que escapan
todos los `error.tsx` anidados. `next.config.ts` envuelto con `withSentryConfig` (sin
`authToken`, sin upload de source maps) para activar la inyección del SDK y eliminar
los avisos de build de `@sentry/nextjs`. DSN vacío → SDK desactivado sin errores.

La captura de cliente se ha verificado en desarrollo (silenciosa). La integración real
queda por confirmar en staging con DSN activo. El DSN es seguro de exponer en el bundle
público: solo permite enviar eventos, no da acceso de lectura ni admin.

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

### Valoraciones (Reviews): elegibilidad, unicidad, edición y agregado (Hito 3)

**Elegibilidad anti-fraude por Conversation:** Solo puede crear una reseña quien haya
tenido una `Conversation` activa sobre ese anuncio con el usuario destinatario.
`ReviewsService.create()` hace un `findFirst` buscando la conversación y lanza `403` si
no existe. El mismo check en `getEligibility` permite que el frontend muestre u oculte
el formulario sin enviar una petición condenada a fallar.

**Bidireccionalidad:** La condición `OR [{ buyerId: authorId, sellerId: targetId },
{ sellerId: authorId, buyerId: targetId }]` permite que tanto el comprador como el
vendedor valoren al otro a partir de una sola `Conversation`.

**Unicidad `(authorId, targetId, listingId)`:** Constraint UNIQUE en Postgres
(migración 8.ª `add_review_fields`). Una reseña por par de usuarios por anuncio.
La colisión se captura como `P2002` y se relanza como `409 Conflict`.

**Ventana de edición de 72 h:** `PATCH /reviews/:id` y `DELETE /reviews/:id`
comprueban `Date.now() > review.createdAt + 72 h`. Fuera del plazo → `403`. Al
editar se persiste `editedAt: new Date()`. La constante `EDIT_WINDOW_MS` vive en el
service para no repetirla en ambas rutas.

**Aggregate on-the-fly:** `ReviewsService.listForUser()` (expuesto como
`GET /users/:slug/reviews`) ejecuta en paralelo `review.findMany` (cursor paginado) +
`review.aggregate({ _avg, _count })` + `review.groupBy(['rating'])`. El resultado
incluye `average` (redondeado a 1 decimal), `count`, `distribution` (mapa 1–5 con 0
por defecto) e `items`. El promedio no se almacena; se recalcula en cada petición
(volúmenes bajos en el MVP; cacheable en Redis cuando crezca).

**Moderación de reseñas:** `ReportReason` extendido con `FAKE_REVIEW` y
`Report.reviewId` (FK nullable con CASCADE). El flujo de moderación existente
(`ModerationService`) cubre también las valoraciones sin ningún cambio en ese módulo.

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

### `@IsUrl` en DTOs: `require_tld: false, require_protocol: true` (Fase B / Hito 3)

`CreatePostDto` y `UpdatePostDto` validan `coverUrl` con
`@IsUrl({ require_tld: false, require_protocol: true })`.

- **`require_tld: false`** (Fase B): sin esta opción, `validator.js` rechaza
  `http://localhost:9000/...` con 400 porque `localhost` no tiene TLD
  (`require_tld: true` por defecto). El mismo problema afectó a `RESEND_FROM` con
  dominios `.local` en la Fase T.
- **`require_protocol: true`** (Hito 3 — bug corregido): sin esta opción, el validador
  aceptaba como URL válida cualquier cadena sin protocolo (p.ej. `"texto libre"`).
  El campo admitía valores arbitrarios que luego causaban errores al renderizar
  `<Image>`. **Regla general:** cualquier campo de URL en un DTO debe declarar
  explícitamente `require_protocol: true`; omitirlo es una fuente silenciosa de bugs.

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

### Límites de anuncios activos por plan y configuración en caliente (RF.7-A)

`ListingsService.checkActiveListingLimit()` consulta `EntitlementService.isProActive()` para
determinar el plan del usuario, lee la clave `freeActiveListingLimit` o `proActiveListingLimit`
de la tabla `Setting` (con valor por defecto como fallback si la key no existe aún) y cuenta
los anuncios ACTIVE del vendedor con `prisma.listing.count`. Si el conteo ≥ límite, lanza
`403 ForbiddenException` con el número de límite en el mensaje (para que el frontend pueda
mostrarlo sin hardcodear el valor).

La comprobación se aplica en `publish()` (solo cuando el estado destino es ACTIVE, es decir,
sin BadWord) **y** en `renew()`. Un usuario free con 5 activos no puede renovar un EXPIRED
hasta liberar una plaza — comportamiento correcto: la renovación convierte un EXPIRED en ACTIVE
y cuenta contra el límite igual que una publicación nueva.

Ambos settings son editables desde `PATCH /admin/settings/:key` sin redeploy; el efecto es
inmediato en la siguiente request de publish/renew.

### `revokedAt` en Entitlement: patrón de expiración idempotente (RF.7-B.1)

El campo `Entitlement.revokedAt DateTime?` se añade para marcar entitlements procesados por
el cron, de forma que cada expiry de destacado se procese **exactamente una vez** aunque el
sweep corra varias veces.

Semántica: un entitlement está **vigente** cuando `revokedAt IS NULL AND (expiresAt IS NULL OR
expiresAt > now)`. Un `revokedAt` seteado invalida el entitlement aunque `expiresAt` sea futuro
(útil para revocación manual desde backoffice en el futuro sin borrar la fila).

El cron B.1 hace un `updateMany` en batch que marca `revokedAt = now` para **todos** los
entitlements encontrados **antes** de entrar al loop de encolado. Así, si el proceso crashea
a mitad del loop, los entitlements ya están marcados y no se reprocesarán en la siguiente
ejecución (crash-safe con idempotencia garantizada). Alternativa descartada: marcar uno a uno
dentro del mismo try/catch del enqueue — más granular pero introduce race con crash mid-update.

Dentro del día, BullMQ deuplica por `jobId = feat-exp-${entitlementId}-${YYYY-MM-DD}`, de modo
que si `runExpirationSweep()` se llama dos veces en el mismo día por restart del scheduler, no
se encolan jobs duplicados.

### Pro downgrade con des-indexado de Meilisearch (RF.7-B.2 — bug detectado y corregido)

`processProDowngrade()` mueve a DRAFT los listings en exceso del límite free, ordenados por
`publishedAt asc` (más antiguos primero, para conservar los más recientes con mayor tasa de
conversión). La primera versión llamaba `updateMany` y retornaba — los listings quedaban DRAFT
en Postgres pero seguían indexados en Meilisearch como ACTIVE.

**Fix**: el método fetcha los slugs antes de `updateMany`; después itera los listings
drafteados y para cada uno: `redis.client.del(cacheKey(slug))` (invalida caché) +
`indexingQueue.add('index', { listingId })`. El `IndexingProcessor` llama a
`searchService.indexListing(listing)`, que al ver `status !== 'ACTIVE'` llama a
`removeListing()` → el listing desaparece del índice. Test de regresión añadido en
`rf7-expiration.e2e-spec.ts`: verifica que tras el sweep se encolan ≥ N jobs para los
listings drafteados.

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

### Stripe v22: subscription de la primera factura en `invoice.parent` (RF.3)

En Stripe API versión `2026-06-24.dahlia` (v22), para la **primera factura** de una
suscripción nueva, el subscription ID **no** está en `invoice.lines.data[0].subscription`
(sale `undefined`), sino en `invoice.parent.subscription_details.subscription`.

El handler `handleInvoiceSucceeded` de `BillingProcessor` tenía un bug por esto: al no
encontrar el subscription ID en los line items hacía un early return sin crear la
`Transaction`. El resultado era que el acceso Pro se concedía (Subscription + Entitlement)
pero faltaba la traza contable con desglose de IVA. Corregido en RF.3:

```typescript
// Interfaz local — invoice.parent no está en el tipo Invoice del SDK v22.
interface InvoiceParentV22 {
  type?: string;
  subscription_details?: { subscription?: string | null; metadata?: Record<string, string> | null } | null;
}

const parent = (invoice as unknown as { parent?: InvoiceParentV22 }).parent;
const parentSubscriptionId = parent?.subscription_details?.subscription ?? undefined;
const lineSubscriptionId   = firstLine ? subscriptionIdFromLine(firstLine) : undefined;
// Primera factura → parentSubscriptionId. Renovaciones → lineSubscriptionId.
const gatewaySubscriptionId = parentSubscriptionId ?? lineSubscriptionId;
```

El metadata `{ userId, priceId }` también vive en
`invoice.parent.subscription_details.metadata` (propagado de `subscription_data.metadata`
al crear la sesión de checkout). `invoice.parent` requiere cast doble
(`as unknown as { parent?: InvoiceParentV22 }`) porque el SDK no lo expone todavía.

**Patrón a recordar en v22:** los datos de suscripción de la primera factura están en
`invoice.parent`, no en los line items. Las facturas de renovación siguen usando
`line.subscription`.

**Estado de RF.3:** implementada y **verificada con Stripe CLI** (checkout real →
webhooks → Subscription + Entitlement + Transaction con IVA 21 % correcto:
`9,99 = 8,26 base + 1,73 IVA` + idempotencia confirmada con evento reenviado).
**Pendiente de verificar:** la renovación de suscripción (segunda factura, fallback a
`line0.subscription`) — no ejercida aún; requiere test clock de Stripe o esperar al
segundo ciclo de facturación.

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

### Sin paginación en categorías ni en el home

`GET /categories` devuelve el árbol completo. Aceptable con < 200 categorías.

### Slug de anuncio sin reintento ante colisión

`buildSlug` genera `{base}-{6-char-hex}`. Una colisión lanzaría `P2002`. No hay
lógica de reintento.

### Sentry cliente: validación pendiente en staging

La captura de errores de cliente está implementada (`instrumentation-client.ts`,
`global-error.tsx`) y verificada en desarrollo (silenciosa con DSN vacío). La
integración real queda por confirmar en staging con `NEXT_PUBLIC_SENTRY_DSN` activo
(ver §2 — Observabilidad: Sentry). Ambas variables documentadas en `.env.example`.

### `Definicion_MVP`: regla "sin límite de anuncios activos" obsoleta (RF.7)

El documento `docs/Definicion_MVP` (o equivalente histórico) establecía que no había límite
en el número de anuncios que un usuario podía tener activos. **Esto ya no es cierto desde
RF.7**: free: 5, pro: 20, ambos configurables. Si se genera documentación de producto a partir
de ese documento, revisar y actualizar esa sección.

### SINCRONIZACIÓN CATÁLOGO ↔ STRIPE: falta comando de bootstrap (prioridad media-alta)

Los `Price` sembrados por el seed de RF.2 tienen `gatewayPriceId = null`. El checkout
de Stripe falla con `"must provide one of price"` hasta que el campo se rellena con el
Price ID real de Stripe (`price_...`, creado en el dashboard). Para verificar RF.3 se
hizo a mano.

No es sostenible: cada entorno (dev local, otro portátil, staging, producción) tiene el
mismo problema desde cero. Falta un comando/script idempotente (`sync-stripe-catalog` o
equivalente) que:

1. Lee los `Product` y `Price` de BD (sembrados por el seed).
2. Los crea en Stripe vía API (`stripe.products.create`, `stripe.prices.create`) si no
   existen aún para ese entorno.
3. Escribe el `gatewayPriceId` resultante de vuelta en BD. Idempotente: si `gatewayPriceId`
   ya está relleno, no crea un duplicado en Stripe.

Candidato a ráfaga corta antes de RF.9 (frontend Pro) o como parte del pulido de billing.
Los `Price` de Redsys (RF.4/RF.5) no necesitan `gatewayPriceId` del mismo modo (Redsys
no tiene catálogo de productos en su API), pero sí requieren que `CreditPack` y sus
`Price` estén sembrados correctamente en cada entorno antes de lanzar cualquier pago.

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
| `SENTRY_DSN` | api + web (server) | `""` (vacío) | DSN de Sentry servidor; vacío desactiva el SDK sin errores |
| `NEXT_PUBLIC_SENTRY_DSN` | web (cliente) | `""` (vacío) | DSN de Sentry cliente (bundle público); vacío desactiva el SDK |
| `GEOCODING_PROVIDER` | api | `nominatim` | Proveedor de geocoding; `maptiler` para producción |
| `MAPTILER_API_KEY` | api | — | Solo si `GEOCODING_PROVIDER=maptiler` |
