# Estado técnico del proyecto — Marketplace

> Fecha: 2026-06-30 · Rama: `main` · Último commit: RC5.5 post-fixes — seed.ts cardAttribute, search controller spread, exact:true en Playwright
> Plan vigente: `docs/Hoja_de_ruta_rafagas_Hito5-9.docx` (Hitos 5–9). Hitos 5–6 firmes; 7–9 boceto a re-detallar al llegar.

Documento de referencia para retomar el proyecto. Recoge qué hay implementado,
qué decisiones se tomaron respecto al diseño original y qué queda pendiente.

---

## 1. Estado de implementación por módulo

### Backend (`apps/api` — puerto 3001)

| Módulo | Estado | Notas |
|---|---|---|
| **Infra: Prisma** | ✅ Completo | Schema con todos los modelos; PostGIS habilitado; **13 migraciones aplicadas** (las de billing RF.2–RF.6 añaden Subscription, Transaction, Wallet, Entitlement, CreditLedger, GatewayEvent, Price…; **RF.7** añade **`add_entitlement_revoked_at`**: columna nullable `Entitlement.revokedAt DateTime?` + índice; **Bonus Pro** añade **`add_pro_bonus`**: valor `PRO_BONUS` al enum `CreditLedgerType` + columna nullable `Transaction.bonusCreditAmount Int?`; **RC5.2** añade **`rename_itemtype_normalize_size`**: renombra `type→itemType` en `Listing.attributes` JSONB + normaliza `calzado.size` de número a string) |
| **Infra: Redis** | ✅ Completo | `RedisService` global; caché de fichas de anuncio (TTL 5 min) |
| **Infra: BullMQ** | ✅ Colas activas | 4 colas registradas con processors reales: `image-processing`, `indexing`, `notifications`, `billing`, `redsys` |
| **Infra: Meilisearch** | ✅ Completo | `SearchService.onModuleInit()` crea el índice `listings` y aplica searchable/filterable/sortable attrs, ranking rules y typo tolerance al arrancar |
| **Infra: MinIO/R2** | ✅ Completo | Dev: MinIO vía docker-compose (bucket `marketplace` con lectura pública, creado por el contenedor `createbuckets`). Prod: Cloudflare R2 vía `R2Service` |
| **Auth** | ✅ Completo | register, login, verify-email, forgot-password, reset-password; `JwtAuthGuard`, `RolesGuard`, `@CurrentUser`; login devuelve `emailVerified` (fix fase 5) |
| **Users** | ✅ Completo | `GET /users/me`, `PATCH /users/me`, `GET /users/:slug` (perfil público) |
| **Categories** | ✅ Completo (RC5.2) | `GET /categories` (árbol público, incluye `cardAttributeKeys[]` por categoría calculado desde el schema efectivo), `GET /categories/:slug` (devuelve schema efectivo: herencia padre→hijo, hijo sobreescribe campo con mismo `name`). Helper `resolveEffectiveSchema` en `category.types.ts` (compartido con AdminService). Profundidad máxima 2 niveles (hoja → padre), congruente con `categoryPath` e `INDEX_INCLUDE`. |
| **Listings** | ✅ Completo | CRUD completo + ciclo de vida (publish, reserve, sold, delete, **renew**) + `expiresAt` fijado al publicar (publishedAt + 60 días) + caché por slug + encolado de reindexado; `GET /listings/mine/:id` para edición; `thumbnailUrl` resuelto en `findMine` y `findBySellerSlug`; geocoding automático al crear y al editar cuando cambia la ubicación. **RF.7-A**: `publish()` y `renew()` verifican el límite de activos del plan (free: 5, pro: 20, leídos de `Setting`; 403 si superado). **Fix RF.7**: `renew()` preserva `publishedAt` original y no lo resetea (resetear era un bump gratuito que vaciaba de sentido el bump de pago de RF.6). **RF.11**: `findMine` y `findBySlug` devuelven `featuredUntil` y `bumpedAt` para el propietario autenticado (necesario para ocultar el botón "Destacar" reactivamente y mostrar estado del bump). **RC5.2**: `SELECT_SUMMARY` incluye `attributes` y `category.slug`; `toSummary()` los expone como `attributes` y `categorySlug` (preparatorio para RC5.5 ListingCard con cardAttributes) |
| **Expiration** | ✅ Completo | `ExpirationService`: cron 02:00 — marca EXPIRED los anuncios ACTIVE con `expiresAt ≤ now`, invalida caché Redis y encola reindexado (RESERVED excluidos intencionalmente). **RF.7-B**: `EntitlementExpirationService`: cron 03:00 con **dos expiraciones en paralelo** — **B.1** `expireFeaturedListings`: selecciona entitlements `FEATURED_LISTING` caducados sin `revokedAt`, los marca en batch (`updateMany → revokedAt = now`, crash-safe), encola reindex con `boostScore:0`; deduplicación BullMQ por `jobId = feat-exp-${id}-${fecha}`. **B.2** `downgradeExpiredPro`: usuarios con `PRO_SUBSCRIPTION` expirado hace > 7 días (periodo de gracia), sin suscripción activa renovada; mueve los listings en exceso a DRAFT ordenado por `publishedAt asc` (más antiguos primero); **purga caché Redis + encola reindex** para cada listing drafteado → Meilisearch los elimina del índice. `runExpirationSweep()` público para tests sin necesidad de reloj real |
| **Geocoding** | ✅ Completo | `GeocodingService` con proveedor configurable (`nominatim` por defecto, `maptiler`). Timeout de 1 500 ms con `AbortSignal.timeout()`; retorna `null` en cualquier fallo sin bloquear la publicación. Script `geocode-backfill` para anuncios sin coordenadas existentes (cursor-based, 1 req/s para respetar la política de Nominatim) |
| **Media** | ✅ Upload | `POST /media/upload` → R2/MinIO → crea `ListingImage` huérfana → encola procesado con sharp; **sin DELETE** |
| **Search** | ✅ Completo (RC5.2) | `GET /search` con texto libre, filtros core, atributos variables (brand, fuel, rooms, gender, size, **itemType**…), **filtro por proximidad** (`lat` + `lng` + `radius` en km → `_geoRadius` en Meilisearch) y **orden por distancia** cuando no hay sort explícito, facetas, paginación y ordenación; `IndexingProcessor` real con jobs `index`/`remove`. **RF.8**: `boostScore` (0/1) en el documento — 1 si el listing tiene un `FEATURED_LISTING` vigente (`revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now)`) al reindexar. `sortDate = max(publishedAt, bumpedAt)` en el documento — bump sube sortDate, renew no (cierra el republish-gratis a nivel de búsqueda). `rankingRules`: `[words, typo, proximity, attribute, boostScore:desc, sort, exactness, sortDate:desc]` — boostScore tras relevancia textual (no contamina queries irrelevantes), antes de sort (destacados suben en cualquier ordenación), sortDate:desc tiebreaker final. `sortDate:desc` disponible en `?sort=sortDate:desc`. **VERIFICADO (204/204, 6 tests nuevos)**: boost en búsquedas relevantes, no contaminación de búsquedas irrelevantes, expirado→boostScore 0, bump sube sortDate · renew no. **RC5.2**: `VARIABLE_ATTRIBUTE_KEYS` ampliado con `itemType`; `FACET_ATTRIBUTES` ampliado con `itemType`; `SearchQueryDto` declara `itemType?: string`; deuda `type` (colisión con ListingType) resuelta. |
| **Script reindex** | ✅ Completo (RF.9 fix) | `pnpm reindex` — reconstruye el índice en batches de 100; `ReindexModule` mínimo (sin BullMQ) para cierre limpio. **RF.9 fix**: antes hacía `addDocuments` sin vaciar (documentos huérfanos de listings borrados sobrevivían al reindexado); ahora llama `clearAll()` + `waitForTask` antes de repoblar → idempotente respecto a borrados |
| **Messaging** | ✅ Completo | REST: `GET /conversations`, `POST /conversations`, `GET /conversations/:id` (cursor), `POST /conversations/:id/messages`. WebSocket gateway `/ws`: auth en handshake, rooms de conversación y de usuario, emit tras el POST REST |
| **AuditLog** | ✅ Completo | `AuditLogService.log()` inyectable; captura explícita `before`/`after` dentro del método de service que muta el recurso, antes de llamar a Prisma; nunca vía interceptor (ver §2). **RF.12b**: `log(dto, tx?)` admite segundo parámetro `tx: Prisma.TransactionClient` opcional; si se pasa, el `prisma.auditLog.create` corre dentro de la transacción del llamador; backward-compat con todos los callers existentes (Fase 7) |
| **Moderation** | ✅ Completo | Reportes CRUD + cola (GET con filtros status/reason/page); acciones sobre listings (approve, reject, deactivate, restore); `BadWordService` con fallback silencioso al publicar; AuditLog en todas las mutaciones; roles MODERATOR + ADMIN |
| **Admin** | ✅ Completo (RC5.2) | Listings (list, detail, PATCH status); Users (list, detail, suspend, ban, reinstate, role); Categories CRUD + batch reorder; Settings GET + PATCH con whitelist; `GET /admin/stats` con 7 métricas + Meilisearch null-fallback; todos los endpoints con `@Roles(ADMIN)` y AuditLog. **RF.7**: whitelist de settings ampliada con `freeActiveListingLimit` y `proActiveListingLimit`; ambos configurables desde el backoffice sin redeploy. **RC5.2**: `createCategory` y `updateCategory` validan que el schema efectivo (propio + heredado del padre) tenga ≤ 2 atributos con `cardAttribute: true` (→ 400 si supera). `GET /admin/categories/searchable-keys` (ADMIN-only) → `{ keys: VARIABLE_ATTRIBUTE_KEYS }` para que RC5.3 pueda deshabilitar el checkbox `filterable` en atributos no listados. |
| **Blog** | ✅ Completo | Modelo `Post` (enum `PostStatus { DRAFT, PUBLISHED }`, body Markdown raw, `tags String[]`, `coverUrl`, campos SEO opcionales `metaTitle`/`metaDescription`). `BlogController`: `GET /blog` (solo PUBLISHED, paginado, filtro `?tag=`) y `GET /blog/:slug` (404 si no existe o es DRAFT). `BlogAdminController` (`@Roles(ADMIN)`): CRUD completo + `POST /admin/blog/:id/publish` + `POST /admin/blog/:id/unpublish`. AuditLog en todas las mutaciones (`POST_CREATE`, `POST_UPDATE`, `POST_PUBLISH`, `POST_UNPUBLISH`, `POST_DELETE`). Revalidación ISR on-demand fire-and-forget al publicar/despublicar/editar/borrar posts publicados (el blog es el **primer productor del webhook** desde el backend; el webhook en sí existía desde Fase 5). `BlogModule` importa `PrismaModule` + `AuditLogModule`; autónomo, no modifica `AdminModule` |
| **Favorites** | ✅ Completo | `POST /favorites/:listingId` (marcar), `DELETE /favorites/:listingId` (desmarcar), `GET /favorites` (paginado), `GET /favorites/:listingId` (check), `POST /favorites/batch-check` (máx. 100 ids → `{ favoritedIds }`). Todos idempotentes y con `JwtAuthGuard`. Suite `favorites.e2e-spec.ts` (12 tests) |
| **Reviews** | ✅ Completo | `POST /reviews` (crear; guard de elegibilidad vía `Conversation`), `GET /reviews/eligibility?listingId=&targetId=` (check antes de mostrar el formulario), `PATCH /reviews/:id` (editar en ventana 72 h; persiste `editedAt`), `DELETE /reviews/:id` (borrar en ventana 72 h). Listado público via `GET /users/:slug/reviews` (cursor paginado + aggregate on-the-fly: average, count, distribución 1–5). Unicidad `(authorId, targetId, listingId)` — una reseña por par de usuarios por anuncio. `FAKE_REVIEW` añadido a `ReportReason`; `Report.reviewId` FK con CASCADE para moderar reseñas. Suite `reviews.e2e-spec.ts` (20 tests) |
| **BillingModule (Stripe)** | ✅ RF.3 Completo | Checkout Pro (Stripe Checkout), `StripeWebhookGuard`, `BillingProcessor` (5 eventos), `EntitlementService`. Verificado con Stripe CLI. Pendiente: renovación (segunda factura) |
| **RedsysModule** | ⚠️ RF.5/RF.10 — firma ✅ · ciclo notificación ❌ | `RedsysService` (checkout credits-pack / featured-pay, Ds_Order YYYYMMDD+4random con retry). **Bonus Pro en `createCreditPackCheckout`**: llama a `EntitlementService.isProActive(userId)`, lee `proExtraCreditsPercent` de `Setting` (fallback 20), calcula `Math.ceil(creditAmount × pct / 100)` y lo persiste en `Transaction.bonusCreditAmount`; el importe, el IVA y el `amountGross` NO se tocan. `RedsysWebhookGuard` (HMAC vía `redsys-easy`, idempotencia doble capa, enqueue / FAILED). `RedsysProcessor` — `handlePackPurchase`: acreditación wallet atómica en `$transaction`: wallet upsert con `balance += base + bonus` (una sola escritura); entrada `CreditLedger PACK_PURCHASE` (+base); si `transaction.bonusCreditAmount != null`, segunda entrada `CreditLedger PRO_BONUS` (+bonus, misma `referenceId = transactionId`); `Transaction.status = SUCCEEDED`. Validación importe `Ds_Amount` vs `amountGross×100`; idempotencia capa 2 por `status≠PENDING`. El processor **no inyecta `EntitlementService` ni lee `Setting`** — solo lee el entero ya congelado en la Transaction. Endpoints: `POST /billing/checkout/credits-pack`, `POST /billing/checkout/featured-pay`, `POST /webhooks/redsys`. **RF.10**: URLs de retorno cambiadas a `/mis-creditos/exito|error` (en `buildForm`), separadas del flujo Pro. Modo: REDIRECCIÓN (ver §2). **VERIFICADO (e2e, 22 tests — 220/220, 18/18 Playwright)**: acreditación wallet (no-Pro), acumulación de balance, idempotencia ×2 (GatewayEvent P2002 + status≠PENDING), cálculo IVA sin descuadre (4,99 / 9,99 / 19,99 €), validación importe (mismatch → FAILED sin tocar wallet), unicidad de 1.000 Ds_Order. **Bonus Pro (5 tests nuevos)**: checkout congela bonusCreditAmount (Pro=10, non-Pro=null), ceil con creditAmount=51→bonus=11 (10.2 redondeado), processor Pro→wallet=60 con dos entradas ledger, processor non-Pro→solo base. **RF.10 — verificado con clave pública Redsys** (sq7HjrUO…, 999008881): `Ds_Signature` 44 chars genuinos, `Ds_MerchantParameters` correcto, aceptado por TPV sandbox. **NO VERIFICADO — deuda pendiente**: (1) pago con tarjeta de prueba, (2) notificación online vía túnel público, (3) acreditación E2E wallet (webhook → BullMQ → processSuccess). `featuredByRedsys`: completado en RF.6; sin ciclo notificación real (misma deuda). |
| **EntitlementService (RF.7)** | ✅ Actualizado | Validez de un entitlement: `revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now)`. Un entitlement con `revokedAt` seteado **no** cuenta como vigente aunque `expiresAt` sea futuro (permite revocación manual desde backoffice en el futuro). Helper `activeFilter()` centraliza el predicado en `isProActive`, `isFeaturedActive` y `findActiveForUser` |
| **BillingModule RF.6** | ✅ Completo | **`grantFeaturedListing(params)`** — punto único de concesión de `FEATURED_LISTING`; valida ACTIVE + propietario (→403) + sin entitlement activo (→400); crea `Entitlement` con `expiresAt = now + durationDays`; encola reindexado. No conoce la vía de pago. **`featuredByCredits`** — `POST /billing/featured-by-credits { priceId, listingId }`: debit atómico (`UPDATE Wallet WHERE balance >= cost`, affected=0 → 402) + `CreditLedger FEATURED_DEBIT` + entitlement, todo en una `$transaction`; rollback automático si la concesión falla. **`bump`** — `POST /listings/:id/bump`: cooldown 1h (→429 Retry-After); debit atómico + `CreditLedger BUMP_DEBIT` + `Listing.bumpedAt`, todo en una `$transaction`; fallos 402/403/400 no consumen cooldown. **`GET /billing/wallet`** — saldo + ledger paginado. **Dependencia `ListingsModule → BillingModule`**: unidireccional, sin circular, NestJS arranca limpio. **VERIFICADO (batería e2e completa, 181/181, 15 casos nuevos)**: grantFeaturedListing como punto único; débito atómico con rollback (saldo restaurado + sin `CreditLedger` huérfano); cooldown no consumido en fallos; convergencia de vías (featuredByCredits y featuredByRedsys producen mismo entitlement: tipo, priceId, `|expiresAt_A − expiresAt_B| < 60s`). **DEUDA HEREDADA de RF.5**: camino featuredByRedsys implementado pero sin ejercicio E2E contra Redsys real (firma/notificación pendientes de tooling). |
| **BillingModule — catalog (RF.9/RF.10)** | ✅ Completo | `GET /billing/catalog` — endpoint público (sin auth); DTO sin `gatewayPriceId`; devuelve los planes del catálogo de BD. **RF.10**: cada precio de pack incluye ahora `creditPackId` (`CreditPack.id`, lo que necesita `POST /billing/checkout/credits-pack`) y `packName` (`CreditPack.name`, p. ej. "Pack Básico") para que el frontend pueda renderizar una tarjeta por pack individual sin una llamada adicional |
| **AdminBillingModule (RF.12)** | ✅ RF.12a+RF.12b | `AdminBillingController` + `AdminBillingService` con `@Roles(ADMIN)` explícito (no MODERATOR). **RF.12a**: `GET /admin/billing/transactions` (paginado, filtros por userId/status/gateway) y `GET /admin/billing/users/:userId` (saldo + historial + entitlements activos); DTO de salida con Prisma `select` explícito que excluye 9 campos sensibles (`gatewayPaymentIntentId`, `subscriptionId`, `taxAmount`, `invoiceNumber`, `gatewayEventId`, `stripeCustomerId`, `refundedAt`, `refundAmount`, `invoiceUrl`); respuestas `Cache-Control: no-store`; filtro de entitlements activos: `revokedAt null AND (expiresAt null OR > now)`. **RF.12b**: `POST /admin/billing/credits/:userId` — acreditación manual; tres writes atómicos en `$transaction` (wallet upsert + `CreditLedger ADMIN_CREDIT` + `AuditLog` vía `log(dto, tx)`); NO crea `Transaction` (no hecho imponible); NO aplica bonus Pro; `CreditLedger.note = "Créditos añadidos por el equipo"` (genérico, visible al usuario en su historial); `AuditLog.after.reason` = motivo real del admin (solo backoffice); `amount @Min(1)@Max(10000)`, `reason @MinLength(5)@MaxLength(500)` |

### Frontend (`apps/web` — puerto 3000)

| Página / Componente | Estado | Notas |
|---|---|---|
| **Home** `/` | ✅ Completo | Hero, buscador, grid de categorías, últimos anuncios (8); Server Component con fetch paralelo |
| **Ficha anuncio** `/anuncio/[slug]` | ✅ Completo | Galería, precio con `priceType`, atributos de categoría, ubicación, anuncios relacionados, metadata OG; `ContactButton` integrado; **`ReportButton`** (solo autenticados) para reportar el anuncio. **RF.11**: `ListingOwnerActions` en la ficha — mismos botones Destacar/Bump que en mis-anuncios; `featuredUntil` consultado **sin caché** (bypass del Redis de 5 min) porque es estado del propietario, no contenido público; tras Destacar exitoso se oculta el botón reactivamente vía `router.refresh()` |
| **Categoría** `/[categoria]` | ✅ Completo | Listado paginado con ordenación (fecha/precio) |
| **Publicar** `/publicar` | ✅ Completo | Wizard 5–6 pasos; crea borrador + publica; tras publicar **ramifica por status**: ACTIVE → navega a la ficha, PENDING_REVIEW → panel informativo con enlace a mis-anuncios (no navega a la ficha, que daría 404) |
| **Login / Registro** | ✅ Completo | Formularios con next-auth v5 CredentialsProvider |
| **Verificar email** `/verificar-email` | ✅ Completo | Llama a `POST /auth/verify-email`; emite nuevo JWT con `emailVerified: true` |
| **Recuperar contraseña** | ✅ Completo | forgot-password + reset-password enlazado por email |
| **Mis anuncios** `/mis-anuncios` | ✅ Completo | Listado de anuncios propios + acciones de estado (publicar, reservar, vender, eliminar, **renovar**); filtro "En revisión" para `PENDING_REVIEW`; muestra `expiresAt` en la tarjeta. **RF.11**: `ListingOwnerActions` integrado — botones Destacar (vía créditos o tarjeta Redsys) y Bump (vía créditos); la cobertura de errores es completa: 400 `ALREADY_FEATURED` (mapeado por `err.code`, no por texto), 402 saldo insuficiente, 429 cooldown con cuenta atrás formateada (`formatRetryAfter`); `featuredUntil`/`bumpedAt` leídos de `findMine` y actualizados vía `router.refresh()` |
| **Editar anuncio** `/mis-anuncios/[id]/editar` | ✅ Completo | Wizard de edición (`EditarWizard`) precargado con datos del backend vía `GET /listings/mine/:id`; categoría bloqueada |
| **Vendedor** `/vendedor/[slug]` | ✅ Completo | Perfil del vendedor (avatar, bio, ubicación, fecha de registro) + grid paginado de anuncios activos |
| **Búsqueda** `/busqueda` | ✅ Completo | Server Component con fetch paralelo a Meilisearch; sidebar `FilterPanel` con categorías, tipo, estado, rango de precio, ordenación, facetas dinámicas, **control "cerca de mí"** (solicita `navigator.geolocation`, fija `lat`/`lng`/`radius` en la URL, selector de radio 5–50 km, orden por distancia automático); paginación; estados de error y vacío |
| **Perfil propio** `/perfil` | ✅ Completo | Ruta protegida por middleware; muestra avatar, nombre, email, ubicación y aviso de email no verificado; `PerfilForm` con campos nombre, teléfono, bio, ciudad, provincia, código postal; accesos rápidos a mis-anuncios, mensajes y favoritos; botón de cerrar sesión |
| **Favoritos** `/favoritos` | ✅ Completo | Ruta protegida. SSR paginado; `FavoritosClient` gestiona lista visible con eliminación/rollback optimista. Botón corazón en `ListingCard` (`FavoriteCardButton` leaf client) visible en **todas las vistas con grid**: home, búsqueda, categoría, vendedor, anuncios relacionados en ficha y la propia `/favoritos`. Resolución en lote: `POST /favorites/batch-check` → 1 request por grid. `FavoritesGridProvider` context en cada página SSR, sin romper SSR. En `/favoritos` la tarjeta desaparece al desmarcar y reaparece si el DELETE falla |
| **Bandeja mensajes** `/mensajes` | ✅ Completo | `BandejaMensajesClient`: lista de conversaciones con thumbnail, contador de no leídos y tiempo relativo; actualización en vivo vía WebSocket |
| **Chat** `/mensajes/[id]` | ✅ Completo | `ChatClient`: mensajes en orden cronológico, auto-scroll, carga de mensajes anteriores (cursor-based), envío vía POST REST, recepción en tiempo real vía WebSocket con deduplicación idempotente |
| **Admin shell** | ✅ Completo | Layout Server Component + `<AdminNav>` (active state vía `usePathname`; ítems filtrados por `session.user.role` — MODERATOR ve solo "Reportes") + `<AdminUserBar>` (nombre del admin + `signOut`); middleware con `MODERATOR_ALLOWED_PATHS` — ADMIN acceso total, MODERATOR solo `/admin/reportes`, resto → redirect `/`; toda la carpeta `(admin)/` es client-side sin SSR |
| **Admin dashboard** `/admin` | ✅ Completo | Fetch a `GET /admin/stats`; KPIs en 3 secciones (anuncios, usuarios/moderación, índice de búsqueda); skeleton de carga y estado de error |
| **Admin anuncios** `/admin/anuncios` | ✅ Completo | Tabla paginada con chips de filtro por estado; cambio de estado inline (select + razón + confirmar) vía `PATCH /admin/listings/:id/status`; reportes recibidos visibles en la fila |
| **Admin usuarios** `/admin/usuarios` | ✅ Completo | Tabla con buscador (nombre/email), chips status y rol; acciones suspend/ban/reinstate contextuales al estado; panel de detalle expandible (últimos anuncios + reportes recibidos + auditlog); no muestra botones de acción para usuarios ADMIN |
| **Admin reportes** `/admin/reportes` | ✅ Completo | Cola de reportes paginada con filtro de estado; acciones resolve/dismiss/retirar anuncio |
| **Admin categorías** `/admin/categorias` | ✅ Completo (RC5.3) | Árbol de categorías con CRUD inline (crear raíz/subcategoría, editar, borrar); reordenación ↑↓ con `PATCH /admin/categories/reorder`; editor VISUAL de atributos (reemplaza el textarea JSON): filas por atributo, heredados read-only separados de los propios, miniform por atributo (type→options condicional, required/filterable/cardAttribute), guardado de solo los atributos propios; errores 400 propagados bajo la fila. |
| **Admin ajustes** `/admin/ajustes` | ✅ Completo | 3 settings con controles tipo-específicos: `badWordList` (textarea una palabra por línea), `listingExpiryDays` (number input), `contactRequiresVerification` (checkbox); save por setting con estado de carga / ✓ éxito / error inline; timestamp de última actualización |
| **Blog público** `/blog` | ✅ Completo | `export const revalidate = 3600`; Server Component ISR; listado paginado de posts PUBLISHED con tarjetas (portada, título, excerpt, fecha, autor, tags); filtro `?tag=`; estados de vacío; paginación; breadcrumb. Portada: solo se renderiza con `<Image>` si `isSafeSrc()` pasa (ver §2 y §3) |
| **Blog detalle** `/blog/[slug]` | ✅ Completo | `export const revalidate = 3600`; Server Component ISR; `notFound()` si slug no existe o es DRAFT; body Markdown renderizado con `react-markdown` + `remark-gfm` + `rehype-sanitize` (sin `rehype-raw` — **regla invariante de seguridad**, ver §2); clase `prose` de `@tailwindcss/typography`; `generateMetadata()` con `og:type: 'article'`, `publishedTime`, `authors`, imagen OG; JSON-LD `BlogPosting` embebido; breadcrumb |
| **Sitemap** `/sitemap.xml` | ✅ Actualizado | Convertido a `async`; incluye `/blog` + un slug por cada post PUBLISHED (`getPostList({ perPage: 500 })`). Los posts DRAFT nunca aparecen porque el endpoint público `GET /blog` filtra por `status = PUBLISHED` en Prisma |
| **Admin blog** `/admin/blog` | ✅ Completo | Tabla paginada (todos los estados) con chips Todos / Borrador / Publicado; acciones Editar / Publicar / Despublicar / Eliminar (con confirmación) inline por fila; client-side |
| **Admin nuevo post** `/admin/blog/nuevo` | ✅ Completo | Formulario `PostForm` compartido: title, slug (editable; si se deja vacío el backend lo genera del título), excerpt, body (textarea Markdown + toggle preview), tags (coma-separadas), portada (solo upload a `/media/upload`, sin campo de URL libre), campos SEO colapsables (metaTitle, metaDescription); al guardar redirige a la página de edición |
| **Admin editar post** `/admin/blog/[id]/editar` | ✅ Completo | Mismo `PostForm` precargado desde `GET /admin/blog/:id`; cabecera con badge de estado + botones Publicar/Despublicar/Eliminar + enlace "Ver en blog ↗" cuando está publicado; banner de éxito al guardar |
| **Admin facturación** `/admin/facturacion` | ✅ RF.12 | Listado de transacciones con filtros (userId, status, gateway); panel de detalle de usuario (saldo, historial de ledger, entitlements activos). **RF.12b**: formulario de acreditación manual — campo `amount` (1–10 000) + `reason` (5–500 chars); llama a `POST /admin/billing/credits/:userId`; muestra saldo actualizado tras la operación. Ningún campo sensible expuesto (DTO backend con `select` explícito) |
| **Plan Pro — Catálogo** `/planes` | ✅ RF.9 | Server Component; consume `GET /billing/catalog` (endpoint público); muestra planes free/pro con precios y CTAs de upgrade. Reutiliza `apiFetch` y shadcn/ui |
| **Plan Pro — Éxito** `/planes/exito` | ✅ RF.9 | Solo UI; maneja el estado asíncrono del webhook — no concede acceso, informa al usuario de que el pago está en proceso |
| **Plan Pro — Cancelado** `/planes/cancelado` | ✅ RF.9 | Solo UI; página de retorno tras cancelar el flujo de checkout de Stripe |
| **Suscripción** `/perfil/suscripcion` | ✅ RF.9 | Ruta protegida; muestra estado de suscripción activa + botón de cancelación (`cancel_at_period_end`). Reutiliza Next-Auth v5 y shadcn/ui |
| **Wallet y packs** `/mis-creditos` | ✅ RF.10 | Server Component; ruta protegida (añadida a `accountPrefixes` en middleware y al sidebar de cuenta). Fetcha en paralelo `GET /billing/wallet` (saldo + historial paginado con etiquetas legibles por tipo de movimiento: "Compra de pack", "Destacado", "Bump", "Crédito manual", "Ajuste", "Bonus Pro") y `GET /billing/catalog` (packs ONE_TIME con `creditAmount`). `PackList` (client component): renderiza una tarjeta por pack individual — itera `product.prices` en vez de `products`, usa `price.packName` y `price.creditPackId`. `handleBuy(creditPackId)` llama `createPackCheckout`, monta `RedsysRedirectForm` al recibir el form firmado. `RedsysRedirectForm`: form `method="POST"` con `Ds_MerchantParameters`, `Ds_SignatureVersion`, `Ds_Signature` como hidden inputs + `data-testid="redsys-redirect-form"` (Playwright), auto-submit via `useEffect`. Gestión de sesión stale vía `useApiAction` (igual que RF.9). |
| **Retorno pago de packs (éxito)** `/mis-creditos/exito` | ✅ RF.10 | Client Component (`'use client'`). **INVARIANTE DE SEGURIDAD**: no concede créditos ni ejecuta lógica de negocio; el wallet lo acredita exclusivamente la notificación online de Redsys (`POST /webhooks/redsys`), no esta página (ver `diseno-facturacion.md §7.5`). Muestra mensaje "procesando", consulta `GET /billing/wallet` para mostrar el saldo actual si está disponible, y ofrece un botón "Actualizar saldo" que re-consulta el wallet manualmente. |
| **Retorno pago de packs (error)** `/mis-creditos/error` | ✅ RF.10 | Server Component estático. Solo UI: "El pago no se completó", "No se te ha cobrado ningún importe", enlace de vuelta a `/mis-creditos`. |

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
400. Por eso los atributos variables de categoría (brand, fuel, rooms, gender, size,
**itemType**…) están **declarados explícitamente** como campos del DTO en lugar de
leerse como mapa genérico. `VARIABLE_ATTRIBUTE_KEYS` en `search.service.ts` es la
fuente de verdad compartida; el DTO y el service deben mantenerse en sync al añadir
atributos nuevos. El atributo `itemType` fue añadido en RC5.2 para reemplazar `type`
(colisión con el enum `ListingType`).

**Tensión dinámico-vs-estático en atributos filtrables:** los atributos filtrables en búsqueda siguen hardcodeados (`VARIABLE_ATTRIBUTE_KEYS` + `SearchQueryDto`); los demás usos (wizard, ficha de anuncio, tarjeta RC5.5) son dinámicos desde BD. Un atributo guardado con `filterable: true` cuyo `name` no esté en `VARIABLE_ATTRIBUTE_KEYS` se almacena y se muestra en el wizard y la ficha, pero el parámetro `?name=valor` en `GET /search` es rechazado con 400 (campo no declarado en `SearchQueryDto`). El endpoint `GET /admin/categories/searchable-keys` expone esa lista para que el editor visual (RC5.3) deshabilite el checkbox `filterable` para esos nombres, haciendo inalcanzable desde la UI el estado incoherente `{ filterable: true, name no buscable }`. Un PATCH directo a la API sí puede crear ese estado; el backend no lo valida (es metadato del wizard, no un campo de Meilisearch).

### Herencia de schema de atributos (RC5.2 + RC5.2b)

`CategoriesService.findBySlug()` resuelve el schema efectivo fusionando el schema del
padre con el del hijo (`resolveEffectiveSchema` en `category.types.ts`). El hijo
sobreescribe campos del padre con el mismo `name`; los campos exclusivos del padre se
heredan. La profundidad está limitada a 2 niveles (hoja → padre), congruente con
`categoryPath` e `INDEX_INCLUDE` en `search.service.ts`.

**RC5.2b** da a la herencia su primer caso real en el seed: los atributos `year` y `km`
(comunes a Coches, Motos y Furgonetas) se han subido al padre `Vehículos`. `listing.attributes`
(datos) no cambia; solo se mueve la *definición* del schema. `ListingsService.create()` y
`update()` usan `resolveEffectiveSchema` (parent incluido) al validar atributos requeridos,
por lo que `required: true` en el padre se sigue enforcing en los hijos.

El admin backoffice (create/update category) valida que el schema **efectivo** (propio +
heredado) no supere 2 atributos con `cardAttribute: true`. Este flag marca los atributos
que se mostrarán en la tarjeta de anuncio (RC5.5). El endpoint
`GET /admin/categories/searchable-keys` expone `VARIABLE_ATTRIBUTE_KEYS` para que el
editor de atributos (RC5.3) desactive el checkbox `filterable` para atributos cuyo
nombre no esté en la lista hardcodeada.

### Editor visual de atributos: decisiones de diseño (RC5.3)

**Ajuste 1 — preservar la intención de `filterable` durante renombrados transitorios:**
Renombrar un campo a un nombre no buscable deshabilita visualmente el checkbox `filterable`
pero no muta el valor interno. Si el admin corrige el nombre de vuelta a uno buscable, el
checkbox recupera el valor previo sin pérdida. La reconciliación (`filterable → false` para
nombres no buscables) ocurre únicamente en `serializeAttributeSchema()`, llamado justo antes
del PATCH. Evita descartar la intención del admin por un renombrado transitorio.

**Ajuste 2 — indicador de cambios sin guardar + bloqueo de guardado cruzado:**
«• Sin guardar» aparece en el panel de atributos cuando hay cambios no persistidos. Si el
admin intenta guardar nombre/slug con atributos pendientes, el botón «Guardar» se bloquea con
un aviso: los dos PATCH (nombre y atributos) son independientes al mismo endpoint — enviarlos
sin sincronizar sobreescribiría uno al otro.

**Ajuste 3 — round-trip de campos desconocidos:**
`parseAttributeSchema()` captura en `_extra` los campos no reconocidos en un `attributeSchema`
existente (editado manualmente como JSON en el pasado). `serializeAttributeSchema()` los
restaura en el payload del PATCH, con los campos conocidos ganando en caso de colisión. Los
datos JSON manuales no se descartan silenciosamente.

**Guardado de solo los atributos propios (invariante de herencia):**
«Guardar atributos» envía únicamente los campos `ownSchema` de la categoría en edición. Los
heredados del padre no se reenvían: materializarlos en la hija duplicaría la definición y
rompería la herencia — si el padre cambia, la copia en la hija quedaría desactualizada e
invisible desde el editor.

### ListingCard con cardAttributes: decisiones de diseño (RC5.5)

`findTree()` en el backend ahora devuelve `cardAttributes: [{key, label, unit?}]` (antes `cardAttributeKeys: string[]`) para que la card tenga label y unit sin necesidad de otro fetch. El search controller normaliza los hits planos de Meilisearch (`hit.brand`, `hit.year`…) a `{ attributes: { brand, year, … } }` para que el componente use la misma ruta de datos (`listing.attributes[key]`) tanto desde Postgres como desde Meilisearch. La card consume los defs de un `CardAttributesContext` (context ligero, sin efectos, análogo a `FavoritesGridContext`) que cada página SSR alimenta con un map `categorySlug → defs`; para páginas con árbol de categorías ya disponible se usa `buildCardAttributeMap(categories)`; para páginas con solo una categoría (categoría, ficha) se usa `buildCardAttributeMapFromSchema(slug, schema)`. Los favoritos añaden `getCategories()` en paralelo y extraen `categorySlug` en `normalize()`. La card omite silenciosamente cualquier atributo sin valor (opcional no rellenado) y no muestra "label: undefined". El formato es "Marca: Toyota · Año: 2022"; unidades se añaden como "30000 km".

### Deuda `type` → `itemType` (RC5.2)

Cuatro categorías del seed (ordenadores, electrodomésticos, accesorios, muebles) usaban
`name: 'type'` en su `attributeSchema`. Ese nombre colisionaba con el campo `type`
(`ListingType` enum) de los documentos de Meilisearch: el spread `{ ...attributes,
...coreFields }` enmascaraba silenciosamente el atributo de categoría. La migración
`20260630000001_rename_itemtype_normalize_size` renombra la clave en `Listing.attributes`
JSONB con un `UPDATE … || jsonb_build_object('itemType', …)`. El seed fue actualizado
para usar `itemType` en el nuevo campo. `VARIABLE_ATTRIBUTE_KEYS`, `SearchQueryDto` y
`FACET_ATTRIBUTES` incluyen ahora `itemType`.

La misma migración normaliza `calzado.size` de número JSON a string JSON para que el
filtro `?size=38` (string) coincida con el valor almacenado. El seed cambia el campo a
`type: 'select'` con opciones `['35', …, '45']`.

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

Las **20 suites e2e de Jest** suman **316 casos**: smoke (1), auth (15), listings (10),
messaging (7), search (8), favorites (12), reviews (20), moderation (23), admin (34),
blog (24), redsys (22), billing-rf6 (15), rf7-limits (8), rf7-expiration (9),
billing-catalog (6), rf8-meilisearch (6), admin-billing (≈20), admin-billing-rf12b (≈8),
rc5-attributes (12), rc5b-vehiculos (11). **RF.10** añadió 3 casos al suite de redsys.
**Bonus Pro** añadió 5 casos más al suite de redsys. **RC5.2** añadió `rc5-attributes.e2e-spec.ts`
(12 casos): búsqueda por `itemType`, búsqueda por `size` string en calzado, herencia de schema
(parent→child), `cardAttributeKeys[]` en árbol, max-2 `cardAttribute` en create/update,
`searchable-keys` ADMIN/MODERATOR. **RC5.2b** añadió `rc5b-vehiculos.e2e-spec.ts` (11 casos):
schema efectivo por las tres hijas de Vehículos, year/km en schema propio del hijo ausentes,
camino peligroso (listing existente conserva attributes), validación 422 sin year/km,
búsqueda Meili por year/km, summary con `categorySlug` + `attributes`.
**RC5.3** añadió `admin-categorias.spec.ts` (7 casos Playwright): carga de página ADMIN, redirección MODERATOR, añadir atributo text, filterable disabled para name no-buscable, filterable enabled para name buscable, Ajuste 1 (renombrado brand→colour→brand recupera la intención), cardAttribute disabled al 2º marcado, options editor para type=select.
**RC5.4** añadió `wizard-herencia.spec.ts` (5 casos Playwright): campos heredados (year *, km *) y propios (brand) visibles en el paso Atributos; required heredado bloquea el wizard cliente; flujo completo guardar+publicar+ficha muestra Características con unidades (30000 km); EditarWizard precarga valores de los atributos heredados; regresión sin herencia (Móviles). Seed de test extendido: jerarquía `vehiculos (year/km required) → coches (brand optional)`. **No se requirió ningún cambio de código:** la herencia en el wizard funcionaba desde RC5.2 vía `GET /categories/:slug` que devuelve el schema efectivo mergeado padre→hijo.
**RC5.5** añadió `listing-card-attrs.spec.ts` (4 casos Playwright): card de coche en categoría muestra "Marca: Toyota · Año: 2022" (Postgres); atributo opcional sin valor se omite sin "undefined"; búsqueda Meilisearch muestra mismos valores (con timeout 25 s para indexación async); categoría sin cardAttributes no rompe la card. Cambios: `findTree()` devuelve `cardAttributes:[{key,label,unit?}]` en lugar de `cardAttributeKeys:string[]`; `search.controller.ts` normaliza los hits planos de Meili a `{..., attributes:{brand,year,...}}` para unificar las dos fuentes; `CardAttributesContext` (nuevo) + `ListingCard` permanece RSC con `CardAttrsDisplay` como client island; helper `buildCardAttributeMap`/`buildCardAttributeMapFromSchema`; las 6 vistas (home, búsqueda, categoría, vendedor, relacionados, favoritos) envuelven sus grids con `CardAttributesProvider`; `favoritos.ts` extrae `categorySlug` en `normalize()`; seed-test actualiza vehiculos/coches con `update` para que los flags cardAttribute sean idempotentes. **Bugs corregidos post-RC5.5:** (a) `search.controller.ts` normalization stripeaba `categoryPath` y `_geo` del response (2 tests fallando); fix: spread de `hit` primero (`...hit`) para preservar todos los campos y sobreescribir solo `status`, `thumbnailUrl` y `attributes`; (b) `seed.ts` (dev) no tenía `cardAttribute: true` en ningún campo → `findTree()` devolvía `cardAttributes:[]` para todas las categorías → cards nunca mostraban atributos; fix: añadidos flags en Vehículos (`year`), Coches (`brand`), Motos (`brand`), Pisos/Casas (`sqm`+`rooms`), Móviles (`brand`+`storage`), Ordenadores (`itemType`+`ram`), Electrodomésticos (`itemType`), Ropa/Calzado (`gender`+`size`); requiere ejecutar `pnpm --filter @marketplace/api prisma:seed` para actualizar la DB de desarrollo; (c) tests Playwright `wizard-herencia.spec.ts` y `listing-card-attrs.spec.ts` usaban `getByRole('button',{name:'Vehículos'})` que coincidía con "Vehículos RC5B" (categoría creada en beforeAll de `rc5b-vehiculos.e2e-spec.ts` y persistente en la DB durante la ejecución de Playwright); fix: `exact:true` en todos los selectores afectados.
**34/34 Playwright** (flujo-critico: 1, planes+suscripción: 8, mis-creditos: 9, admin-categorias: 7, wizard-herencia: 5, listing-card-attrs: 4).
**Fase 5.2 — Categorías con atributos y herencia: COMPLETA.** RC5.1 (diseño y contratos de API), RC5.2 (backend: herencia, cardAttributeKeys, validación max-2, deuda itemType/size), RC5.2b (seed Vehículos reorganizado), RC5.3 (editor visual de atributos), RC5.4 (herencia en wizard verificada), RC5.5 (ListingCard con cardAttributes en las 6 vistas) — todas completadas y verificadas.
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

### Separación de roles ADMIN / MODERATOR en el backoffice (RR5.1 + RR5.1-ext)

**Regla de oro (innegociable):** `PATCH /admin/users/:id/role` es y permanecerá
ADMIN-only siempre. Un MODERATOR con acceso a ese endpoint podría auto-promoverse
a ADMIN (escalada de privilegios). La protección es triple: `RolesGuard` bloquea
en el controlador; el DTO `ChangeUserRoleDto` solo permite `USER|MODERATOR` como
valor destino (rechaza `ADMIN`); el servicio lanza 403 si el objetivo es ADMIN.

**Backend (RR5.1):** la separación base ya estaba correctamente implementada desde
Fase 7. Todos los endpoints `/admin/*` llevan `@Roles(ADMIN)` en la clase; los
endpoints `/moderation/*` llevan `@Roles(MODERATOR, ADMIN)`.

**Backend (RR5.1-ext):** se añadieron decoradores `@Roles(MODERATOR, ADMIN)` a
nivel de método en `AdminController` y `BlogAdminController` para abrir al MODERATOR
acceso a listings, usuarios y blog (a excepción de las acciones destructivas/permanentes
que siguen heredando `@Roles(ADMIN)` de la clase). Además se creó el endpoint
`PATCH /admin/users/:id/unsuspend` (MODERATOR+ADMIN) para revertir una suspensión
sin otorgar al MODERATOR la capacidad de desbanear usuarios baneados (que requiere
`/reinstate`, ADMIN-only).

**Frontend — middleware.ts:** `MODERATOR_ALLOWED_PATHS` controla qué rutas `/admin/*`
puede visitar un MODERATOR. El ADMIN tiene acceso total. Cualquier otro rol es
redirigido a `/`.

```typescript
const MODERATOR_ALLOWED_PATHS = [
  '/admin/reportes',
  '/admin/anuncios',
  '/admin/usuarios',
  '/admin/blog',
];
```

**Frontend — AdminNav:** el array `NAV_ITEMS` tiene un campo `roles: string[]` por
ítem. El MODERATOR ve 4 ítems (Anuncios, Usuarios, Reportes, Blog); el ADMIN ve los 8.

**Frontend — Botones ADMIN-only ocultos al MODERATOR:**
- `/admin/usuarios`: "Banear" y "Desbanear" solo visibles con `role === 'ADMIN'`.
  El MODERATOR ve "Suspender" y "Reactivar" (suspend/unsuspend). Nunca ve "Banear".
- `/admin/blog`: "Eliminar" solo visible con `role === 'ADMIN'`.

**Tabla rol × acción (implementada tras RR5.1-ext):**

| Sección / Acción | MODERATOR | ADMIN |
|---|---|---|
| Dashboard / Stats | ❌ | ✅ |
| Reportes (listar, start-review, resolve, dismiss) | ✅ | ✅ |
| Moderación de anuncios (approve, reject, deactivate, restore) | ✅ | ✅ |
| Gestión anuncios: listar, ver, cambiar estado | ✅ | ✅ |
| Gestión usuarios: listar, ver | ✅ | ✅ |
| Gestión usuarios: **suspender** (`/suspend`) | ✅ | ✅ |
| Gestión usuarios: **reactivar suspensión** (`/unsuspend`) | ✅ | ✅ |
| Gestión usuarios: **banear** (`/ban`) | ❌ | ✅ |
| Gestión usuarios: **desbanear** (`/reinstate`) | ❌ | ✅ |
| Gestión usuarios: **cambiar rol** (`/role`) | ❌ **innegociable** | ✅ |
| Categorías | ❌ | ✅ |
| Settings | ❌ | ✅ |
| Facturación / Créditos | ❌ | ✅ |
| Blog: listar, ver, crear, editar, publicar, despublicar | ✅ | ✅ |
| Blog: **eliminar** (`DELETE`) | ❌ | ✅ |

**Deuda técnica — sesión stale tras cambio de rol:** si un ADMIN degrada a MODERATOR
a otro usuario, el JWT de ese usuario permanece válido hasta su expiración (7 días).
Durante ese período, el middleware Next.js lee el rol del JWT (stale), no de la DB.
Mitigación pendiente: forzar logout tras cambio de rol o reducir TTL del JWT para roles
privilegiados.

**Tests (RR5.1 + RR5.1-ext):**
- `moderation.e2e-spec.ts`: 45 casos. Los 8 tests de frontera añadidos en RR5.1 se
  actualizaron en RR5.1-ext (3 cambian de 403→200 como cambio de producto deliberado).
  Añadidos 19 nuevos tests: acceso abierto al MODERATOR (listings, users, blog), acciones
  ADMIN-only bloqueadas (ban, reinstate, blog delete) y dos tests críticos de no-escalada
  (MODERATOR → 403 al intentar cambiar su propio rol o el de otro usuario).
- `admin-roles.spec.ts` (Playwright): 12 tests — ADMIN ve 8 ítems en el nav; MODERATOR
  es redirigido desde /admin, /admin/ajustes y /admin/facturacion; MODERATOR carga
  /admin/anuncios, /admin/usuarios, /admin/blog y /admin/reportes sin redirect; el nav
  muestra exactamente 4 ítems; "Banear" y "Eliminar" no son visibles para el MODERATOR;
  desestimar reporte funciona sin 403.
- `seed-playwright.ts` / `global-setup.ts` / `fixtures/auth.ts`: usuarios
  `admin-e2e@example.com` (ADMIN) y `moderator-e2e@example.com` (MODERATOR) con
  `storageState`; seed crea un reporte PENDING por cada ejecución.

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

### boostScore y sortDate en Meilisearch (RF.8)

`toDocument()` en `SearchService` calcula dos campos nuevos al reindexar:

**`boostScore` (0 | 1):** `INDEX_INCLUDE` carga los entitlements `FEATURED_LISTING` con
`revokedAt IS NULL` (excluye revocados). En `toDocument()`, `boostScore = 1` si alguno tiene
`expiresAt IS NULL OR expiresAt > now`; 0 en caso contrario. `expiresAt IS NULL` = destacado
permanente (nunca caduca). La comprobación temporal se hace al indexar, no en Meilisearch.

**`sortDate` (epoch ms):** `max(publishedAt, bumpedAt)`. Un bump (RF.6) setea `bumpedAt = now`
y encola reindex → `sortDate` sube al momento del bump. La renovación (`renew`) preserva ambos
timestamps → `sortDate` no cambia. Cierra el "republish-gratis" a nivel de búsqueda (complementa
el fix de `publishedAt` de RF.7-A que lo cerraba a nivel de Postgres).

**`rankingRules`:**
```
[words, typo, proximity, attribute, boostScore:desc, sort, exactness, sortDate:desc]
```
- `boostScore:desc` en posición 5: tras relevancia textual (no eleva resultados irrelevantes),
  antes de `sort` (los destacados suben en cualquier ordenación del usuario).
- `sortDate:desc` al final: tiebreaker determinista para búsquedas sin sort explícito;
  reemplaza el antiguo `publishedAt:desc`.

**`sortDate` como dimensión de sort explícito:** `?sort=sortDate:desc` disponible en la API y
en el DTO (`SearchQueryDto`). El feed/categoría del frontend debe migrar a este sort en RF.10.

**DECISIÓN — expiración best-effort diaria:** `boostScore` es un valor congelado en el documento
Meilisearch al reindexar; Meilisearch no reevalúa `expiresAt > now` por su cuenta. El cron B.1
(03:00) revoca el entitlement y encola el reindex → `boostScore` baja a 0 con hasta ~23 h de
retraso. Aceptado: a la escala actual del proyecto la granularidad diaria es suficiente. Si en
el futuro se requiere expiración horaria, la solución sería un cron más frecuente o un job
BullMQ con delay calculado (`expiresAt - now`).

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

### Modo de pago Redsys: REDIRECCIÓN (no InSite) (RF.10)

El frontend de compra de packs usa el modo **Redirección** de Redsys: el backend firma
los parámetros con HMAC-SHA256 y devuelve `{ redsysFormData: { Ds_MerchantParameters,
Ds_SignatureVersion, Ds_Signature, tpvUrl } }`; el frontend monta un `<form method="POST">`
con esos campos como `hidden inputs` y lo auto-submite vía `useEffect`. El browser navega
al TPV de Redsys, que renderiza la página de pago, y devuelve al usuario a
`/mis-creditos/exito` (OK) o `/mis-creditos/error` (KO).

Razones de la elección frente a InSite (iframe):
- **PCI SAQ A**: el navegador del usuario nunca maneja datos de tarjeta — los introduce
  directamente en el dominio de Redsys. SAQ A es el nivel PCI más simple.
- **Coherencia con Stripe Checkout**: mismo patrón de redirección que la suscripción Pro.
- **Facilidad de verificación**: el form firmado se puede probar sin disponer de credenciales
  sandbox propias (clave pública de pruebas de Redsys: `sq7HjrUO…`, comercio `999008881`).
- InSite requiere un dominio HTTPS válido registrado en Redsys y es más complejo de depurar.

**Separación de rutas de retorno respecto a `/planes`:** las URLs de retorno de packs
apuntan a `/mis-creditos/exito|error` (no a `/planes/exito-redsys|error-redsys`) para
mantener separados los flujos de suscripción Pro (Stripe) y compra de créditos (Redsys).

### Bonus Pro: congelar el bonus calculado, no la condición Pro (RF.10)

El diseño original (§2.5 de `diseno-facturacion.md`) describía congelar "la condición Pro" en la
`Transaction`. La implementación congela directamente el **número entero de créditos bonus ya
calculado** (`bonusCreditAmount Int?` en `Transaction`), no un booleano `isPro`.

**Por qué el número, no la condición:**
- Elimina una condición de carrera con cambios del `Setting proExtraCreditsPercent`: si un admin
  modifica el porcentaje entre que el usuario inicia el checkout y Redsys notifica el pago, el
  usuario recibe el bonus que correspondía **en el momento de pagar**, no el vigente al confirmar.
- El processor queda trivial: lee un `Int?` y lo suma; no inyecta `EntitlementService` ni accede
  a `Setting`. La decisión ya está tomada y persistida.
- `Int?` es directamente queryable para analytics ("cuántos créditos bonus se han concedido este
  mes") sin parsear JSON.

**Implementación:**
- `createCreditPackCheckout` llama a `EntitlementService.isProActive(userId)`, lee
  `proExtraCreditsPercent` del `Setting` (fallback a 20 si la key no existe), calcula
  `Math.ceil(creditAmount × pct / 100)` (redondeo hacia arriba, a favor del usuario) y guarda el
  resultado en `Transaction.bonusCreditAmount`. Si el usuario no es Pro: `null`.
- `handlePackPurchase` en `RedsysProcessor`: dentro del mismo `$transaction` que ya existía,
  incrementa el wallet en `base + bonus` (una sola escritura de wallet) y crea DOS entradas
  `CreditLedger` separadas — `PACK_PURCHASE` (+base) y `PRO_BONUS` (+bonus) — ambas con
  `referenceType = "Transaction"` y `referenceId = transactionId`. Si `bonusCreditAmount` es
  `null`, solo se crea la entrada base (comportamiento idéntico a antes del bonus).

**Invariante fiscal:** el Pro paga el **mismo importe** que un free por el mismo pack. El
`amountGross`, el `taxAmount` y el `taxRate` de la `Transaction` no se tocan en ningún caso.
El bonus son créditos internos del wallet — no son un hecho imponible separado y no generan IVA
adicional. `createCreditPackCheckout` tiene una restricción explícita: no tocar el bloque de IVA.

**Configuración:** `Setting.proExtraCreditsPercent = 20` sembrado en `seed.ts` y en `seed-test.ts`.
El fallback a `20` en código protege contra el caso en que el Setting sea borrado accidentalmente
del backoffice. Con los packs actuales (50 / 150 / 400 créditos) y 20 %, el resultado siempre es
entero; el `Math.ceil` está para cuando el porcentaje sea fraccionario (`ceil` verificado en e2e
con `creditAmount = 51 × 20 % = 10.2 → 11`).

### Manejo centralizado de sesión stale: hook `useApiAction` (RF.9)

`lib/api/use-api-action.ts` (`'use client'`): hook que envuelve cualquier llamada a
`apiFetch` en un componente de cliente. Centraliza el manejo de sesión expirada:

- **401 → sesión stale**: `isAuthError` detecta exclusivamente 401 (JWT inválido o
  usuario inexistente en BD). Respuesta: `signOut()` + redirect a login. El mensaje
  crudo de `ApiError` nunca llega al usuario final.
- **403 → regla de negocio**: no interceptado por el hook. 403 es una decisión de
  dominio (límite de plan, sin permiso sobre el recurso, etc.); lo gestiona cada
  componente con su propio mensaje contextual.
- **Otros errores**: se llama al callback `onError` con un mensaje legible
  (`toUserMessage`), nunca con `ApiError.message` crudo.

Aplicado a 12 componentes que antes repetían el patrón try/catch + redirect manualmente.
Usar el hook ES tener el manejo correcto: los futuros componentes no pueden olvidarse
del caso sin esfuerzo extra.

> **Lección:** La verificación manual en navegador destapó el "User not found" de
> sesión stale — JWT válido pero usuario borrado de BD → el backend devolvía 401 y el
> frontend mostraba un error genérico sin redirigir al login. Los tests e2e existentes
> no cubrían ese caso (crean el usuario en el fixture y nunca lo borran con sesión
> activa). Tests verdes ≠ flujo real verificado.

### `FavoritesGridContext`: omisión deliberada de `listingIds` en el `useEffect` (RF.9)

`FavoritesGridProvider` sincroniza el set de favoritos con el servidor al montarse.
El `useEffect` que inicializa el set **omite `listingIds` en sus dependencias**
(marcado con `// eslint-disable-next-line`). La omisión es correcta por dos razones:

1. El efecto reemplaza el set completo. Incluir `listingIds` como dep haría que cada
   toggle optimista (que modifica `listingIds`) disparara una re-sincronización desde
   servidor, machacando el cambio optimista del usuario.
2. El provider se remonta en cada navegación RSC, así que el efecto de inicialización
   ya corre una vez por navegación — equivalente a `componentDidMount`.

**Invariante:** este diseño solo es válido mientras la paginación sea por navegación
completa (cada página monta un `FavoritesGridProvider` nuevo). Con scroll infinito o
load-more sin desmontaje del provider habría que replantear el diseño.

### RF.11: código estructural `ALREADY_FEATURED` en lugar de match de substring (RF.11)

`billing.service` y `redsys.service` lanzan `BadRequestException({ code: 'ALREADY_FEATURED', message: '...' })`
cuando se intenta destacar un listing que ya tiene un entitlement `FEATURED_LISTING` vigente.
El frontend (`ListingOwnerActions`) distingue este error comprobando `err.code === 'ALREADY_FEATURED'`,
no por substring del campo `message` (frágil ante cambios de wording, internacionalización o
refactorizaciones). `ApiError` ganó el campo `code?: string`, mapeado desde el body JSON del
error cuando el servidor lo incluye.

**Principio generalizable:** cualquier error de dominio distinguible (429 con cooldown, 402 saldo
insuficiente, 400 con razón de negocio) debe viajar en un campo estructural (`code`, `retryAfter`),
nunca solo en el texto del mensaje.

### RF.11: `apiFetch` endurecido — body-first parsing con soporte de 2xx vacíos

`apiFetch` en `apps/web/src/lib/api/fetch.ts` lee el body con `text()` antes de intentar
`JSON.parse()`. Cualquier respuesta 2xx con body vacío (o solo whitespace) devuelve `undefined`
sin lanzar `SyntaxError`. Causa raíz: `POST /listings/:id/bump` devolvía `201` con body vacío;
la llamada a `.json()` lanzaba `SyntaxError: Unexpected end of JSON input`, el cliente capturaba
la excepción como un error y mostraba un mensaje de fallo aunque el bump había sido exitoso.

Defensa en profundidad: futuros endpoints que devuelvan 2xx sin body no rompen el cliente.

### RF.11: `featuredUntil` y `bumpedAt` servidos frescos para el propietario

`GET /listings/mine` (`findMine`) y `GET /listings/:slug` (`findBySlug`, solo para el propietario
autenticado) devuelven `featuredUntil` y `bumpedAt`. En la ficha de anuncio, `featuredUntil` se
consulta **sin usar la caché Redis de 5 min** del anuncio público, porque es estado del
propietario y debe reflejar la acción inmediata de destacar. `ListingOwnerActions` recibe
`featuredUntil` y oculta el botón "Destacar" reactivamente tras `router.refresh()` cuando el
destacado acaba de activarse — sin necesidad de un estado local adicional.

### RF.11: `ApiError` extendida con `retryAfter`, `isCooldownError`, `isCreditError`

`ApiError` (`apps/web/src/lib/api/errors.ts`) ganó:

- `code?: string` — campo estructural de error de negocio (p. ej. `'ALREADY_FEATURED'`).
- `retryAfter?: number` — segundos preservados del header `Retry-After` en respuestas 429.
- `isCooldownError()` — `true` si la respuesta fue 429 (bump en cooldown).
- `formatRetryAfter()` — formatea `retryAfter` como `"Xm Ys"` legible para el usuario.
- `isCreditError()` — `true` si la respuesta fue 402 (saldo insuficiente).

Patrón aplicado en todos los `onError` de RF.11: se comprueba primero el caso específico
(402 → "Saldo insuficiente", 429 → "Espera Xm Ys", 400 con `code` conocido → mensaje de
negocio); el genérico (`toUserMessage`) es solo el último recurso. Esto evita que un error
429 muestre "Algo salió mal" en lugar de la cuenta atrás real.

### RF.11: matriz de cobertura acción × vía × ubicación × error

Todas las combinaciones implementadas y verificadas:

| Acción | Vía | Ubicación | Éxito | 400 | 402 | 429 |
|---|---|---|---|---|---|---|
| Destacar | Créditos | Mis-anuncios | ✅ | `ALREADY_FEATURED` | Saldo | — |
| Destacar | Tarjeta (Redsys) | Mis-anuncios | ✅ | `ALREADY_FEATURED` | — | — |
| Destacar | Créditos | Ficha | ✅ | `ALREADY_FEATURED` | Saldo | — |
| Destacar | Tarjeta (Redsys) | Ficha | ✅ | `ALREADY_FEATURED` | — | — |
| Bump | Créditos | Mis-anuncios | ✅ | — | Saldo | Cooldown+timer |
| Bump | Créditos | Ficha | ✅ | — | Saldo | Cooldown+timer |

Todos los errores de negocio tienen mensajes específicos en la UI. El genérico es solo fallback.

### RF.12: `AdminBillingController` — select explícito y filtro de entitlements activos

`AdminBillingController` y `AdminBillingService` llevan `@Roles(ADMIN)` explícito; MODERATOR
no tiene acceso a datos de facturación. El DTO de salida de transacciones usa un `select` de
Prisma explícito que excluye 9 campos sensibles: `gatewayPaymentIntentId`, `subscriptionId`,
`taxAmount`, `invoiceNumber`, `gatewayEventId`, `stripeCustomerId`, `refundedAt`,
`refundAmount`, `invoiceUrl`. Nunca se serializa el modelo `Transaction` completo de Prisma.
Todos los endpoints añaden `Cache-Control: no-store`.

El filtro de entitlements activos para el panel de usuario reutiliza el mismo predicado de
`EntitlementService.activeFilter()`: `revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now)`.

### RF.12b: acreditación manual atómica y separación de nota vs. motivo

`POST /admin/billing/credits/:userId` aplica los siguientes invariantes:

- **Solo suma:** `amount @Min(1)` — negativo rechazado por el DTO antes de llegar al service.
- **Tres writes atómicos** en `$transaction`: wallet `upsert` con `balance += amount`,
  entrada `CreditLedger` de tipo `ADMIN_CREDIT`, `AuditLog` vía `log(dto, tx)`.
- **NO crea `Transaction`:** la acreditación manual no es un hecho imponible; no hay IVA,
  no hay nota fiscal, no hay entrada en la tabla de transacciones de pago.
- **NO aplica bonus Pro:** `amount` es el importe literal solicitado por el admin, sin
  multiplicador ni porcentaje.
- **Separación de datos:** `CreditLedger.note = "Créditos añadidos por el equipo"` (genérico,
  visible al usuario en su historial de wallet); `AuditLog.after.reason` = motivo real del
  admin (texto libre, solo accesible desde el backoffice de AuditLog). El usuario nunca ve
  el motivo interno del admin.

### RF.12b: `AuditLogService.log(dto, tx?)` — parámetro de transacción opcional

El método `AuditLogService.log(dto, tx?)` admite ahora un segundo parámetro opcional
`tx: Prisma.TransactionClient`. Si se pasa, el `create` del AuditLog se ejecuta dentro
de la transacción del llamador (haciendo los tres writes atómicos). Si no se pasa, usa
`this.prisma` directamente — comportamiento idéntico al anterior.

Todos los callers existentes (Fase 7: `AdminService`, `ModerationService`, `BlogAdminService`)
no pasan `tx` → backward-compatible sin cambios. RF.12b pasa la transacción → el AuditLog
queda atómico con el wallet upsert y el CreditLedger (ver §3 — deuda gap Fase 7 para
contexto de por qué Fase 7 no lo hace y es aceptable).

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

### SINCRONIZACIÓN CATÁLOGO ↔ STRIPE: ✅ resuelta (ráfaga previa a RF.9)

Comando `pnpm sync-stripe-catalog` implementado en
`apps/api/src/commands/sync-stripe-catalog.ts`.

- Solo sincroniza los `Price` con `interval IS NOT NULL` (Plan Pro mensual/anual).
  Los precios de Redsys (Destacado, Packs de créditos) no necesitan `gatewayPriceId`.
- Idempotente: si `gatewayPriceId` ya está relleno, salta ese Price.
- Si un hermano del mismo `Product` ya tiene `gatewayPriceId`, recupera el Stripe
  Product desde ese Price (no crea duplicado). Si no hay ninguno, busca por nombre en
  Stripe y crea solo si no existe.
- Falla inmediatamente si `STRIPE_SECRET_KEY` no está definida.
- Tests unitarios en `sync-stripe-catalog.spec.ts` (helpers `toCents`/`toStripeInterval`).

Flujo recomendado en cada entorno nuevo:
1. `pnpm prisma:seed` — siembra el catálogo en BD.
2. `pnpm sync-stripe-catalog` — crea los Price en Stripe y escribe los IDs de vuelta.
3. Checkout Pro funciona sin intervención manual en el dashboard.

### ✅ Variables de entorno de TEST: validación Joi — RESUELTA (RF.11 / commit ced718e)

El `.env.test` sin validación causó **tres incidentes** antes de resolverse:

1. **RF.8** — `.env.test` perdió `MEILI_INDEX_NAME`. El backend usó `'listings'` por defecto
   (índice de dev). Los tests de búsqueda fallaban con timeouts de 15 s: `waitForIndex`
   esperaba el documento en `listings_test`, pero estaba en `listings`.
2. **Pre-RF.9** — `.env.test` apuntaba a la BD de dev (`marketplace` en vez de `marketplace_test`).
   Tests que pasaban limpiaban datos de desarrollo sin previo aviso.
3. **RF.10** — `REDSYS_SECRET_KEY` vacía en `.env.test` obligó a mockear `buildForm`, ocultando
   la verificación de firma HMAC real.

**Causa raíz común de los tres:** commit `ce34d52` (RF.8) reescribió `.env.test` desde la
plantilla de dev, arrastrando `NODE_ENV=development`, borrando `MEILI_INDEX_NAME` y poniendo
`DATABASE_URL=marketplace`. Un solo commit descuidado causó las tres degradaciones.

**Hallazgo sobre `NODE_ENV=development` en `.env.test`:** el valor era muerto en runtime —
Jest fija `NODE_ENV=test` antes de que `load-env.ts` cargue dotenv, y dotenv no sobreescribe
variables ya definidas. Se corrigió a `test` igualmente (necesario para arranques manuales
vía dotenv sin Jest; commit `df435f5`).

**Solución implementada (`env.validation.ts` — reglas Joi condicionales):**
Las reglas aplican `.when('NODE_ENV', { is: 'test', then: ..., otherwise: ... })`:
- `DATABASE_URL` debe contener `_test` cuando `NODE_ENV=test`.
- `MEILI_INDEX_NAME` debe contener `_test` cuando `NODE_ENV=test`.
- `REDSYS_SECRET_KEY` no puede estar vacía en ningún entorno.

El bloque `otherwise` replica la regla de dev/prod exacta → los entornos de producción no
cambian. Verificado rompiendo los tres a propósito: cada ausencia hace fallar el arranque del
módulo NestJS con un mensaje descriptivo antes de ejecutar cualquier test.

### Deuda Redsys: ciclo notificación + acreditación E2E (RF.10)

La firma HMAC y la aceptación del form por el TPV sandbox de Redsys están verificadas
desde RF.10 (test con clave pública de pruebas). Lo que queda sin ejercer es el ciclo
completo de notificación y acreditación:

1. **Completar el pago** con una tarjeta de prueba Redsys en el TPV sandbox.
2. **Recibir la notificación online** (`POST /webhooks/redsys` desde el servidor de Redsys)
   — requiere un túnel público (`ngrok` o `cloudflared`) y configurar `REDSYS_NOTIFICATION_URL`.
3. **Acreditación E2E**: verificar que el webhook pasa la validación HMAC del
   `RedsysWebhookGuard`, encola el job en BullMQ, y `RedsysProcessor.processSuccess`
   crea `Wallet` + `CreditLedger` + marca `Transaction` como `SUCCEEDED`.

La lógica de `processSuccess` está cubierta por tests unitarios del suite de redsys
(acreditación, idempotencia, validación de importe). Lo que falta es el detonador real
(la notificación del servidor de Redsys). Esta deuda aplica por igual a credits-pack y
a featured-pay (mismo ciclo, misma pendiente). Analogía con RF.3 (Stripe): allí se
cerró con el Stripe CLI; aquí se cerrará con el sandbox de Redsys + túnel.

### `reindex`: ventana breve de índice vacío durante la repoblación

El fix de RF.9 (`clearAll` + `waitForTask` + repoblación en batches) introduce una
ventana en la que el índice está vacío. En desarrollo es irrelevante. En producción
con tráfico real los usuarios verían resultados de búsqueda vacíos durante esos segundos.

**No urgente** a la escala actual. La solución production-grade sería un swap atómico:
repoblar en un índice temporal y renombrarlo con la API de Meilisearch
(`/indexes/{uid}/swap`) de forma instantánea sin downtime de búsqueda. Aparcado para
cuando el volumen lo justifique.

> **Nota:** el bug original (sin `clearAll`) habría afectado silenciosamente a producción:
> ejecutar `pnpm reindex` para "arreglar" la búsqueda habría dejado los documentos
> huérfanos intactos. Fue detectado al investigar "anuncios fantasma en /busqueda" en
> vez de aceptar "es la caché".

### AuditLog de Fase 7: gap mutación/auditlog no atómico

Los flujos de Fase 7 (`suspendUser`, `banUser`, `changeUserRole`, `changeListingStatus`)
registran el AuditLog **fuera** de la transacción de la mutación que describen: primero
commitean el cambio en Postgres y luego llaman a `auditLog.log()` sin `tx`. Si el log falla
después del commit, la acción queda ejecutada pero sin traza en el AuditLog.

**Por qué es aceptable:** las acciones afectadas son reversibles y observables. Un ban es
visible en `User.status`; un cambio de estado en `Listing.status`. El fallo de log no
corrompe ni el usuario ni el anuncio; el estado incorrecto se puede auditar por otras vías
(consulta directa a BD, logs del servidor). La probabilidad de fallo del propio `INSERT`
en AuditLog es muy baja.

**RF.12b no hereda el gap:** la acreditación manual crea dinero en el wallet, que es un
estado financiero; los tres writes (wallet, CreditLedger, AuditLog) son atómicos en una
`$transaction`.

**Cerrable fácilmente:** pasar el `tx` de la transacción de la mutación a `auditLog.log(tx)`
en los callers de Fase 7. El parámetro `tx?` opcional ya está disponible en
`AuditLogService.log()` tras el refactor de RF.12b — ningún caller existente requiere cambio
de firma.

### Editor de atributos: `searchableKeys` no cargado → todos los `filterable` deshabilitados sin distinguir causa

Si `GET /admin/categories/searchable-keys` falla (API caída, error de red), la llamada es
silenciada y `searchableKeys` permanece como array vacío. El editor deshabilita entonces
**todos** los checkboxes `filterable` — incluyendo los de nombres genuinamente buscables
como `brand` o `fuel`. El resultado es correcto desde el punto de vista de integridad de
datos (evita marcar como filterable algo que no filtrará), pero confuso para el admin que
no entiende por qué `brand` aparece como no filterable.

Mejora futura: mostrar un banner «No se pudo cargar la lista de atributos buscables» en
lugar de deshabilitar silenciosamente todos los checkboxes.

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
- **Hoja de ruta (Hitos 5–9)**: `docs/Hoja_de_ruta_rafagas_Hito5-9.docx` — programa por ráfagas hacia un producto completo: Hito 5 (separación de roles admin/moderador, categorías/atributos con herencia, localización estructurada), Hito 6 (descubrimiento: búsqueda, mapa, portada, patrocinados), Hito 7 (mensajería, blog enriquecido, registro social), Hito 8 (Pro/facturación, barra promocional), Hito 9 (navegación, interfaz, deuda transversal y testing). Reglas de ejecución y reparto de deuda técnica por hito incluidos. Redsys E2E y RF.13 quedan "en el aire", desbloqueables al obtener credenciales.

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
