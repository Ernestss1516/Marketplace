# Estado técnico del proyecto — Marketplace

> Fecha: 2026-07-14 · Rama: `main` · Último commit: 9ee7b5d — Deuda diez tests cerrado; CI test.
> Plan vigente: `docs/Hoja_de_ruta_rafagas_Hito5-9.docx` (Hitos 5–9). Hitos 5–8 cerrados (incluye el
> bloque de blog — rol EDITOR, editor de markdown, páginas informativas, footer — y el Hito 8
> ampliado completo: H8.1–H8.6 + Bloques C/D/E). Hito 9 (navegación, interfaz, deuda transversal y
> testing) pendiente de arrancar. **RC.1+RC.2 — Formulario de contacto público cerrado** (ver
> módulo `Contact` más abajo): endpoint público sin autenticación con 5 defensas anti-bot/anti-XSS,
> gestión y respuesta desde `/admin/mensajes-contacto`, cambio de estado libre, y motivos
> configurables por el admin (`/admin/motivos-contacto`, enum → datos). **Teléfono en anuncios +
> Compartir cerrado** (ver «Teléfono en anuncios + Compartir anuncio» en §2): `Listing.phone`
> opcional publicado tras confirmación explícita del usuario, servido solo autenticado y con rate
> limit (nunca en el payload público de la ficha); `ShareButton` con Web Share API nativa y
> fallback (copiar/WhatsApp/Telegram/email). **Redsys — ambos caminos de pago con tarjeta cerrados
> E2E y contra el sandbox REAL** (ver «Redsys — ciclo notificación...» y «Redsys — verificación
> contra el sandbox real» más abajo): destacado (bug de retry encontrado y arreglado) y
> credits-pack (premisa de atomicidad CONFIRMADA, sin bug) ejercidos de punta a punta con firmas
> HMAC reales; verificado además con un pago real contra `sis-t.redsys.es` (túnel cloudflared,
> tarjeta de prueba) — sin discrepancias de formato en los campos que el código usa. **Stripe
> checkout + renovación cerrado E2E** (ver «Stripe — checkout + renovación...» más abajo): `.catch()`
> que tragaba errores arreglado, renovación envuelta en `$transaction`. Con esto, los tres canales
> de dinero del proyecto (Redsys destacado, Redsys credits-pack, Stripe suscripción) están
> verificados de punta a punta.

Documento de referencia para retomar el proyecto. Recoge qué hay implementado,
qué decisiones se tomaron respecto al diseño original y qué queda pendiente.

---

## 1. Estado de implementación por módulo

### Backend (`apps/api` — puerto 3001)

| Módulo | Estado | Notas |
|---|---|---|
| **Infra: Prisma** | ✅ Completo | Schema con todos los modelos; PostGIS habilitado; **15 migraciones aplicadas** (las de billing RF.2–RF.6 añaden Subscription, Transaction, Wallet, Entitlement, CreditLedger, GatewayEvent, Price…; **RF.7** añade **`add_entitlement_revoked_at`**: columna nullable `Entitlement.revokedAt DateTime?` + índice; **Bonus Pro** añade **`add_pro_bonus`**: valor `PRO_BONUS` al enum `CreditLedgerType` + columna nullable `Transaction.bonusCreditAmount Int?`; **RC5.2** añade **`rename_itemtype_normalize_size`**: renombra `type→itemType` en `Listing.attributes` JSONB + normaliza `calzado.size` de número a string; **Hito 7** añade **`review_survives_listing_delete`**: `Review.listingId` pasa de `Cascade` a `SetNull` (nullable) + columna `Review.listingTitle String?` + backfill de reseñas existentes cuyo anuncio todavía vive; y **`social_login_google`**: tabla `Account` (`provider`+`providerAccountId`) + `User.passwordHash` pasa a nullable) |
| **Infra: Redis** | ✅ Completo | `RedisService` global; caché de fichas de anuncio (TTL 5 min) |
| **Infra: BullMQ** | ✅ Colas activas | 6 colas registradas con processors reales: `image-processing`, `indexing`, `notifications`, `billing`, `redsys`, **`alert-matching`** (Sistema de Alertas B3). **Hallazgo/fix (B3)**: cada módulo que llama a `BullModule.registerQueue({name})` crea su **propia** instancia `Queue` (productor) — `defaultJobOptions` declarado solo en `queue.module.ts` no llega a un productor que vive en otro módulo (p. ej. `AuthService`, `AlertMatchingService`). `RETRY_JOB_OPTIONS` centralizado en `queue.constants.ts` y repetido explícitamente en cada `registerQueue()` que encola en `notifications` (`AuthModule`, `AlertsModule`, `queue.module.ts`) — ver «Sistema de Alertas» más abajo. |
| **Infra: Meilisearch** | ✅ Completo | `SearchService.onModuleInit()` crea el índice `listings` y aplica searchable/filterable/sortable attrs, ranking rules y typo tolerance al arrancar |
| **Infra: MinIO/R2** | ✅ Completo | Dev: MinIO vía docker-compose (bucket `marketplace` con lectura pública, creado por el contenedor `createbuckets`). Prod: Cloudflare R2 vía `R2Service` |
| **Auth** | ✅ Completo | register, login, verify-email, forgot-password, reset-password; `JwtAuthGuard`, `RolesGuard`, `@CurrentUser`; login devuelve `emailVerified` (fix fase 5). **Hito 7 (backend)**: `POST /auth/social/google` — login social Google; ver «Login social con Google» en §2 |
| **Users** | ✅ Completo | `GET /users/me`, `PATCH /users/me`, `GET /users/:slug` (perfil público) |
| **Categories** | ✅ Completo (RC5.2 + H6.5c) | `GET /categories` (árbol público, incluye `cardAttributes: [{key,label,unit?}]` y **`allAttributes: [{key,label,unit?}]`** por categoría — `cardAttributes` son 1-2 atributos destacados; `allAttributes` es el schema completo y se usa en el panel de mapa para mostrar todos los atributos sin fetch adicional), `GET /categories/:slug` (devuelve schema efectivo: herencia padre→hijo, hijo sobreescribe campo con mismo `name`). Helper `resolveEffectiveSchema` en `category.types.ts` (compartido con AdminService). Profundidad máxima 2 niveles (hoja → padre), congruente con `categoryPath` e `INDEX_INCLUDE`. |
| **Listings** | ✅ Completo | CRUD completo + ciclo de vida (publish, reserve, sold, delete, **renew**) + `expiresAt` fijado al publicar (publishedAt + 60 días) + caché por slug + encolado de reindexado; `GET /listings/mine/:id` para edición; `thumbnailUrl` resuelto en `findMine` y `findBySellerSlug`. **Teléfono en anuncios**: `Listing.phone String?` (publicado, opcional, distinto de `User.phone` que es privado) validado con `LISTING_PHONE_REGEX` (permisivo, 6-20 caracteres, vacío admitido para borrar). `findBySlug` **descarta `phone` del resultado antes de cachear/devolver** (destructuring explícito — no hay capa de serialización posterior que lo filtre) y expone solo `hasPhone: boolean`; el número real solo se sirve por `GET /listings/:id/phone` (`JwtAuthGuard` + rate limit 30/h por usuario y 60/h por IP vía `RateLimitService`, 404 si no hay teléfono o el anuncio no está ACTIVE). Ver «Teléfono en anuncios + Compartir anuncio» en §2. **H6 (cambio arquitectura)**: geocoding **asíncrono** — `createListing` ya no espera a Nominatim; guarda `lat/lng = null`, responde inmediato y encola dos jobs BullMQ en FIFO: `geocode` (escribe lat/lng en Postgres, sin tocar Meili) seguido de `index` (una sola escritura a Meili con `_geo` ya presente). Un anuncio recién publicado puede tardar unos segundos en aparecer en el mapa. Al editar con cambio de ubicación: mismo orden FIFO `[geocode, index]`. **RF.7-A**: `publish()` y `renew()` verifican el límite de activos del plan (free: 5, pro: 20, leídos de `Setting`; 403 si superado). **Fix RF.7**: `renew()` preserva `publishedAt` original y no lo resetea (resetear era un bump gratuito que vaciaba de sentido el bump de pago de RF.6). **RF.11**: `findMine` y `findBySlug` devuelven `featuredUntil` y `bumpedAt` para el propietario autenticado (necesario para ocultar el botón "Destacar" reactivamente y mostrar estado del bump). **RC5.2**: `SELECT_SUMMARY` incluye `attributes` y `category.slug`; `toSummary()` los expone como `attributes` y `categorySlug` (preparatorio para RC5.5 ListingCard con cardAttributes) |
| **Expiration** | ✅ Completo | `ExpirationService`: cron 02:00 — marca EXPIRED los anuncios ACTIVE con `expiresAt ≤ now`, invalida caché Redis y encola reindexado (RESERVED excluidos intencionalmente). **RF.7-B**: `EntitlementExpirationService`: cron 03:00 con **dos expiraciones en paralelo** — **B.1** `expireFeaturedListings`: selecciona entitlements `FEATURED_LISTING` caducados sin `revokedAt`, los marca en batch (`updateMany → revokedAt = now`, crash-safe), encola reindex con `boostScore:0`; deduplicación BullMQ por `jobId = feat-exp-${id}-${fecha}`. **B.2** `downgradeExpiredPro`: usuarios con `PRO_SUBSCRIPTION` expirado hace > 7 días (periodo de gracia), sin suscripción activa renovada; mueve los listings en exceso a DRAFT ordenado por `publishedAt asc` (más antiguos primero); **purga caché Redis + encola reindex** para cada listing drafteado → Meilisearch los elimina del índice. `runExpirationSweep()` público para tests sin necesidad de reloj real |
| **Geocoding** | ✅ Completo | `GeocodingService` con proveedor configurable (`nominatim` por defecto, `maptiler`). Timeout 3 000 ms; fallback sin postalCode si la query completa devuelve vacío (CP incorrecto → vacío en Nominatim, resuelto sin CP); logs INFO/WARN detallados (provider, ciudad, "resolved" o "TIMEOUT/HTTP xxx"); normalización de nombres de provincia bilinguales ("Alicante/Alacant" → "Alicante") antes de enviar a Nominatim. **Para activar MapTiler en producción: solo `GEOCODING_PROVIDER=maptiler` + `MAPTILER_API_KEY`, cero cambios de código.** Script `geocode-backfill` para anuncios sin coordenadas (cursor-based, 1 req/s). |
| **Media** | ✅ Upload + Avatar | `POST /media/upload` → R2/MinIO → crea `ListingImage` huérfana → encola procesado con sharp; **sin DELETE**. **RL5.1-C**: `POST /media/upload-avatar` (JwtAuthGuard) → sube a `avatars/` en R2/MinIO, devuelve `{ url }`, **NO crea ListingImage** (avatar no es una imagen de anuncio; tabla no crece). Mismos límites que `/upload`: 10 MB, solo JPEG/PNG/WebP (422 si otro tipo). Test e2e: `media.e2e-spec.ts` (4 tests: 401 sin auth, 422 no-imagen, 400 sin archivo, 201 + url + sin ListingImage creada). |
| **Search** | ✅ Completo (RC5.2 + H6.5 + RÁFAGA 1 + RÁFAGA 2 + RÁFAGA 3) | **RÁFAGA 3**: `AttributeField.showLabel`/`showUnit` — cómo se muestra cada atributo en card (nombre sí/no, unidad sí/no) es configurable por atributo, ya no una regla hardcodeada en el frontend; default reproduce el comportamiento anterior. Ver «Display de atributos en card» en §2. **RÁFAGA 2**: `ListingDocument.images: string[]` (todas las fotos, ordenadas — antes solo `thumbnailUrl`, requiere reindex tras deploy). Ver «3 vistas de resultados configurables por categoría» en §2. `GET /search` con texto libre, filtros core, atributos variables (brand, fuel, rooms, gender, size, **itemType**…), **filtro por proximidad** (`lat` + `lng` + `radius` en km → `_geoRadius` en Meilisearch) y **orden por distancia** cuando no hay sort explícito, facetas, paginación y ordenación; `IndexingProcessor` real con jobs `index`/`remove`. **RF.8**: `boostScore` (0/1) en el documento — 1 si el listing tiene un `FEATURED_LISTING` vigente al reindexar. `sortDate = max(publishedAt, bumpedAt)`. **RÁFAGA 1 (política de ordenación C)**: `rankingRules` ya NO incluye `boostScore:desc` — `[words, typo, proximity, attribute, sort, exactness, sortDate:desc]`; antes, al ir ANTES de `sort`, particionaba (no desempataba) y un destacado ganaba a cualquier no-destacado en cualquier orden (verificado ejecutando: precio asc devolvía un destacado de 333€ antes que uno de 7€ sin destacar). Ahora la lista (`hits`) respeta siempre el orden pedido; los destacados que cumplen los filtros actuales se devuelven ADEMÁS en `featured` (bloque "Promocionados", 4 máx., solo página 1 — mismo molde que el patrocinado H6.6, query aparte con `onlyBoosted`/`boostScore = 1`, ahora filterable). `totalHits` no se contamina con `featured` ni con el patrocinado. Ver «Política de ordenación C» en §2. **RÁFAGA 1 (filtros)**: `FilterableAttributesResolver.getAttributeTypesForCategory(slug)` (nuevo) fija el leak cross-categoría — antes `?category=coches&rooms=3` (`rooms` es de "pisos") pasaba validación y devolvía 0 resultados en silencio; ahora 400. Ver «Filtros: validación de atributos por categoría» en §2. **H6.5c**: `INDEX_INCLUDE` incluye `seller: { name, slug, avatarUrl }` → `ListingDocument` guarda `sellerName`, `sellerSlug`, `sellerAvatarUrl` para que el panel del mapa los muestre sin fetch por selección. **H6 (fix raíz flaky CI)**: `indexListing()` llama a `waitForTask(task.taskUid)` — el job BullMQ no completa hasta que el documento es **consultable** en Meilisearch (antes completaba cuando Meili lo recibía, provocando flaky en tests que buscaban el anuncio justo después de indexar). **RC5.2**: `VARIABLE_ATTRIBUTE_KEYS` ampliado con `itemType`; `FACET_ATTRIBUTES` ampliado con `itemType`; `SearchQueryDto` declara `itemType?: string`. **RÁFAGA 0 (producto/servicio) — atributos filtrables dinámicos**: `VARIABLE_ATTRIBUTE_KEYS` (hardcodeado) eliminado; `FilterableAttributesResolver` (nuevo) deriva `Map<name, type>` de `Category.attributeSchema` en todas las categorías (unión plana, guard estructural contra nombres reservados, conflicto de tipo entre categorías → se conserva el primero + `Logger.warn`), memoizado desde `onModuleInit()` (sin refresco en caliente — ver §3). `SearchQueryDto` reducido a los campos core; `search-query.parser.ts` (nuevo) valida los atributos variables contra el mapa dinámico reutilizando el propio `ValidationPipe` de Nest para los campos fijos (mismo 400 ante clave desconocida). `FACET_ATTRIBUTES` (lista curada, sin cambios) se intersecta con lo realmente filtrable en tiempo de consulta para no pedir a Meilisearch facetas sobre atributos ausentes en un entorno dado. Ver «Atributos filtrables dinámicos — RÁFAGA 0» en §2. |
| **Script reindex** | ✅ Completo (RF.9 fix) | `pnpm reindex` — reconstruye el índice en batches de 100; `ReindexModule` mínimo (sin BullMQ) para cierre limpio. **RF.9 fix**: antes hacía `addDocuments` sin vaciar (documentos huérfanos de listings borrados sobrevivían al reindexado); ahora llama `clearAll()` + `waitForTask` antes de repoblar → idempotente respecto a borrados |
| **Messaging** | ✅ Completo | REST: `GET /conversations`, `POST /conversations`, `GET /conversations/:id` (cursor), `POST /conversations/:id/messages`. WebSocket gateway `/ws`: auth en handshake, rooms de conversación y de usuario, emit tras el POST REST |
| **AuditLog** | ✅ Completo | `AuditLogService.log()` inyectable; captura explícita `before`/`after` dentro del método de service que muta el recurso, antes de llamar a Prisma; nunca vía interceptor (ver §2). **RF.12b**: `log(dto, tx?)` admite segundo parámetro `tx: Prisma.TransactionClient` opcional; si se pasa, el `prisma.auditLog.create` corre dentro de la transacción del llamador; backward-compat con todos los callers existentes (Fase 7) |
| **Moderation** | ✅ Completo | Reportes CRUD + cola (GET con filtros status/reason/page); acciones sobre listings (approve, reject, deactivate, restore); `BadWordService` con fallback silencioso al publicar; AuditLog en todas las mutaciones; roles MODERATOR + ADMIN |
| **Admin** | ✅ Completo (RC5.2) | Listings (list, detail, PATCH status); Users (list, detail, suspend, ban, reinstate, role); Categories CRUD + batch reorder; Settings GET + PATCH con whitelist; `GET /admin/stats` con 7 métricas + Meilisearch null-fallback; todos los endpoints con `@Roles(ADMIN)` y AuditLog. **RF.7**: whitelist de settings ampliada con `freeActiveListingLimit` y `proActiveListingLimit`; ambos configurables desde el backoffice sin redeploy. **RC5.2**: `createCategory` y `updateCategory` validan que el schema efectivo (propio + heredado del padre) tenga ≤ 2 atributos con `cardAttribute: true` (→ 400 si supera). `GET /admin/categories/searchable-keys` (ADMIN-only) → `{ keys }` para que RC5.3 pueda deshabilitar el checkbox `filterable` en atributos no listados; **RÁFAGA 0**: `keys` ahora viene de `FilterableAttributesResolver.getAttributeTypes()` (dinámico) en vez de la constante `VARIABLE_ATTRIBUTE_KEYS` (eliminada) — mismo contrato de respuesta, tooltip del editor actualizado en consecuencia. **Cierre Fase 5.2 (ráfaga de integridad)**: `deleteCategory` cuenta anuncios de **cualquier** `status` (antes solo `ACTIVE`), eliminando un 500 no controlado — ver «Mapa de integridad» más abajo; `GET /admin/categories/:id/attribute-usage?key=X` (ADMIN-only) cuenta anuncios con datos bajo una key concreta, usado por el editor para avisar antes de renombrar un atributo con datos. |
| **Blog** | ✅ Completo (Ráfaga 1 bloques + Ráfaga 2 editor + Ráfaga 3: 13 tipos) | Modelo `Post` (enum `PostStatus { DRAFT, PUBLISHED }`, `tags String[]`, `coverUrl`, campos SEO opcionales `metaTitle`/`metaDescription`; también cubre páginas informativas vía `type: PostType`). **Contenido en `blocks: Json` (sistema de bloques, 13 tipos discriminados por `type` — 12 estáticos + `listings`, el primer bloque DINÁMICO), YA NO `body: String` Markdown** — ver «Sistema de bloques — Ráfaga 1», «Ráfaga 2» y «Ráfaga 3» en §3 para el detalle completo (esquema, validación, renderizadores, el editor visual con el que un admin no técnico construye los 13 tipos desde `/admin`, y la decisión de caché del bloque dinámico — páginas con `listings` dejan de ser autocontenidas). `BlogController`: `GET /blog` (solo PUBLISHED, paginado, filtro `?tag=`) y `GET /blog/:slug` (404 si no existe o es DRAFT). `BlogAdminController` (`@Roles(ADMIN)`): CRUD completo + `POST /admin/blog/:id/publish` + `POST /admin/blog/:id/unpublish` + `POST /admin/blog/upload-image` (Ráfaga 2, molde sponsored-ads, prefijo `blocks/`). AuditLog en todas las mutaciones (`POST_CREATE`, `POST_UPDATE`, `POST_PUBLISH`, `POST_UNPUBLISH`, `POST_DELETE`). Revalidación ISR on-demand fire-and-forget al publicar/despublicar/editar/borrar posts publicados vía `RevalidateService` compartido (ver **Footer** más abajo — extraído de aquí). `BlogModule` importa `PrismaModule` + `AuditLogModule` + `RevalidateModule`; autónomo, no modifica `AdminModule`. **Ya NO gestiona la navegación del footer** (`showInFooter`/`footerOrder`/`footerGroup` retirados de `Post` — ver módulo **Footer**) |
| **Footer** | ✅ Completo | Navegación del footer como entidad propia (`FooterColumn`+`FooterItem`), independiente de `Post` — sustituye a `Post.showInFooter/footerOrder/footerGroup`. `type: FooterItemType (PAGE\|INTERNAL\|EXTERNAL)` con destino discriminado validado en `FooterService` (no en el DTO ni con un CHECK de schema); `pageId` FK a `Post` con `onDelete: Restrict` + precheck en `BlogService.adminDelete` (molde `deleteCategory`). `GET /footer` público (resuelto: `href`/`external`, páginas DRAFT omitidas). `GET|POST|PATCH|DELETE /admin/footer/{columns,items}` + `.../reorder` (molde `categories/reorder`), `@Roles(ADMIN)`. Ver «Navegación del footer como entidad propia» en §3 para el detalle completo (migración en dos pasos, `RevalidateService` compartido, molde de UI) |
| **Favorites** | ✅ Completo | `POST /favorites/:listingId` (marcar), `DELETE /favorites/:listingId` (desmarcar), `GET /favorites` (paginado), `GET /favorites/:listingId` (check), `POST /favorites/batch-check` (máx. 100 ids → `{ favoritedIds }`). Todos idempotentes y con `JwtAuthGuard`. Suite `favorites.e2e-spec.ts` (12 tests) |
| **Reviews** | ✅ Completo (H7) | `POST /reviews` (crear; guard de elegibilidad vía `Conversation`; snapshot de `listingTitle`), `GET /reviews/eligibility?listingId=&targetId=` (check antes de mostrar el formulario), `PATCH /reviews/:id` (editar en ventana 72 h; persiste `editedAt`), `DELETE /reviews/:id` (borrar en ventana 72 h). Listado público via `GET /users/:slug/reviews` (cursor paginado + aggregate on-the-fly: average, count, distribución 1–5). Unicidad `(authorId, targetId, listingId)` — una reseña por par de usuarios por anuncio. `FAKE_REVIEW` añadido a `ReportReason`; `Report.reviewId` FK con CASCADE para moderar reseñas. **H7**: `Review.listingId` es `onDelete: SetNull` (nullable) — la reseña sobrevive al borrado del anuncio con snapshot `listingTitle`; ver «H7 — La reseña sobrevive al borrado del anuncio» más abajo. Suite `reviews.e2e-spec.ts` (24 tests) |
| **BillingModule (Stripe)** | ✅ RF.3 Completo — checkout ✅ · renovación (2ª factura) ✅ | Checkout Pro (Stripe Checkout), `StripeWebhookGuard`, `BillingProcessor` (5 eventos), `EntitlementService`. Verificado con Stripe CLI y con E2E de firma real (checkout + renovación, ver «Stripe — checkout + renovación de suscripción Pro» más abajo). `handleCheckoutCompleted`/`handleInvoiceSucceeded` ya no tragan errores al guardar `stripeCustomerId`, y ambos envuelven Subscription+Entitlement(+Transaction) en una única `$transaction` |
| **RedsysModule** | ✅ RF.5/RF.10 — firma ✅ · ciclo notificación featured-pay ✅ · ciclo notificación credits-pack ✅ · sandbox real ✅ | `RedsysService` (checkout credits-pack / featured-pay, Ds_Order YYYYMMDD+4random con retry). **Bonus Pro en `createCreditPackCheckout`**: llama a `EntitlementService.isProActive(userId)`, lee `proExtraCreditsPercent` de `Setting` (fallback 20), calcula `Math.ceil(creditAmount × pct / 100)` y lo persiste en `Transaction.bonusCreditAmount`; el importe, el IVA y el `amountGross` NO se tocan. `RedsysWebhookGuard` (HMAC vía `redsys-easy`, idempotencia doble capa, enqueue / FAILED). `RedsysProcessor` — `handlePackPurchase`: acreditación wallet atómica en `$transaction`: wallet upsert con `balance += base + bonus` (una sola escritura); entrada `CreditLedger PACK_PURCHASE` (+base); si `transaction.bonusCreditAmount != null`, segunda entrada `CreditLedger PRO_BONUS` (+bonus, misma `referenceId = transactionId`); `Transaction.status = SUCCEEDED`. Validación importe `Ds_Amount` vs `amountGross×100`; idempotencia capa 2 por `status≠PENDING`. El processor **no inyecta `EntitlementService` ni lee `Setting`** — solo lee el entero ya congelado en la Transaction. Endpoints: `POST /billing/checkout/credits-pack`, `POST /billing/checkout/featured-pay`, `POST /webhooks/redsys`. **RF.10**: URLs de retorno cambiadas a `/mis-creditos/exito|error` (en `buildForm`), separadas del flujo Pro. Modo: REDIRECCIÓN (ver §2). **VERIFICADO (e2e, 22 tests — 220/220, 18/18 Playwright)**: acreditación wallet (no-Pro), acumulación de balance, idempotencia ×2 (GatewayEvent P2002 + status≠PENDING), cálculo IVA sin descuadre (4,99 / 9,99 / 19,99 €), validación importe (mismatch → FAILED sin tocar wallet), unicidad de 1.000 Ds_Order. **Bonus Pro (5 tests nuevos)**: checkout congela bonusCreditAmount (Pro=10, non-Pro=null), ceil con creditAmount=51→bonus=11 (10.2 redondeado), processor Pro→wallet=60 con dos entradas ledger, processor non-Pro→solo base. **RF.10 — verificado con clave pública Redsys** (sq7HjrUO…, 999008881): `Ds_Signature` 44 chars genuinos, `Ds_MerchantParameters` correcto, aceptado por TPV sandbox. **Ciclo de notificación featured-pay VERIFICADO E2E** (`redsys-featured-payment-e2e.e2e-spec.ts`): webhook con firma real → cola → entitlement → `boostScore` en Meilisearch; firma inválida rechazada; duplicado idempotente; rechazo marca FAILED; bug de retry encontrado y arreglado (`grantFeaturedListingAndSucceed`, ver sección "Redsys — ciclo notificación..."). **Ciclo de notificación credits-pack VERIFICADO E2E** (`redsys-credits-payment-e2e.e2e-spec.ts`, 6 tests): mismo patrón — webhook con firma real → cola → wallet acreditado con los créditos del pack; firma inválida rechazada (0 créditos regalados); duplicado idempotente; retry de BullMQ tras `SUCCEEDED` no duplica; rechazo marca FAILED; **fallo transitorio a mitad de la `$transaction` revierte TODO (wallet+ledger+status) y el retry acredita limpio una sola vez — sin bug, a diferencia del destacado**: `handlePackPurchase` ya envolvía wallet+ledger+status en una única `$transaction` desde que se escribió (RF.5), así que la premisa de que "créditos ya era atómico" queda **CONFIRMADA**, no solo asumida. **Verificado además contra el TPV sandbox REAL** (`sis-t.redsys.es`, comercio genérico 999008881, túnel cloudflared, tarjeta de prueba — ver «Redsys — verificación contra el sandbox real» más abajo): pago real de pack de créditos y de destacado, ambos aprobados, campos coincidentes con la simulación E2E en todo lo que el procesador lee; simulación enriquecida con los ~14 campos reales que no se probaban antes. `featuredByRedsys`: completado en RF.6, ciclo notificación ya verificado. |
| **EntitlementService (RF.7)** | ✅ Actualizado | Validez de un entitlement: `revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now)`. Un entitlement con `revokedAt` seteado **no** cuenta como vigente aunque `expiresAt` sea futuro (permite revocación manual desde backoffice en el futuro). Helper `activeFilter()` centraliza el predicado en `isProActive`, `isFeaturedActive` y `findActiveForUser` |
| **BillingModule RF.6** | ✅ Completo | **`grantFeaturedListing(params)`** — punto único de concesión de `FEATURED_LISTING`; valida ACTIVE + propietario (→403) + sin entitlement activo (→400); crea `Entitlement` con `expiresAt = now + durationDays`; encola reindexado. No conoce la vía de pago. **`featuredByCredits`** — `POST /billing/featured-by-credits { priceId, listingId }`: debit atómico (`UPDATE Wallet WHERE balance >= cost`, affected=0 → 402) + `CreditLedger FEATURED_DEBIT` + entitlement, todo en una `$transaction`; rollback automático si la concesión falla. **`bump`** — `POST /listings/:id/bump`: cooldown 1h (→429 Retry-After); debit atómico + `CreditLedger BUMP_DEBIT` + `Listing.bumpedAt`, todo en una `$transaction`; fallos 402/403/400 no consumen cooldown. **`GET /billing/wallet`** — saldo + ledger paginado. **Dependencia `ListingsModule → BillingModule`**: unidireccional, sin circular, NestJS arranca limpio. **VERIFICADO (batería e2e completa, 181/181, 15 casos nuevos)**: grantFeaturedListing como punto único; débito atómico con rollback (saldo restaurado + sin `CreditLedger` huérfano); cooldown no consumido en fallos; convergencia de vías (featuredByCredits y featuredByRedsys producen mismo entitlement: tipo, priceId, `|expiresAt_A − expiresAt_B| < 60s`). **DEUDA HEREDADA de RF.5 — CERRADA (ambos caminos)**: featuredByRedsys y el credits-pack tienen ahora ejercicio E2E completo (webhook con firma real, ver sección "Redsys — ciclo notificación..."); solo queda pendiente la prueba contra el TPV sandbox real. `grantFeaturedListingAndSucceed` (nuevo) sustituye a `grantFeaturedListing` específicamente en el camino Redsys de featured-pay — concede el entitlement y marca la Transaction `SUCCEEDED` en la misma `$transaction`, cerrando un bug real de retry (Transaction atascada en `PENDING` para siempre) encontrado por ese E2E; `handlePackPurchase` (credits-pack) ya tenía ese mismo patrón atómico desde RF.5 y quedó confirmado, sin bug, por el E2E equivalente. |
| **BillingModule — catalog (RF.9/RF.10)** | ✅ Completo | `GET /billing/catalog` — endpoint público (sin auth); DTO sin `gatewayPriceId`; devuelve los planes del catálogo de BD. **RF.10**: cada precio de pack incluye ahora `creditPackId` (`CreditPack.id`, lo que necesita `POST /billing/checkout/credits-pack`) y `packName` (`CreditPack.name`, p. ej. "Pack Básico") para que el frontend pueda renderizar una tarjeta por pack individual sin una llamada adicional |
| **AdminBillingModule (RF.12)** | ✅ RF.12a+RF.12b | `AdminBillingController` + `AdminBillingService` con `@Roles(ADMIN)` explícito (no MODERATOR). **RF.12a**: `GET /admin/billing/transactions` (paginado, filtros por userId/status/gateway) y `GET /admin/billing/users/:userId` (saldo + historial + entitlements activos); DTO de salida con Prisma `select` explícito que excluye 9 campos sensibles (`gatewayPaymentIntentId`, `subscriptionId`, `taxAmount`, `invoiceNumber`, `gatewayEventId`, `stripeCustomerId`, `refundedAt`, `refundAmount`, `invoiceUrl`); respuestas `Cache-Control: no-store`; filtro de entitlements activos: `revokedAt null AND (expiresAt null OR > now)`. **RF.12b**: `POST /admin/billing/credits/:userId` — acreditación manual; tres writes atómicos en `$transaction` (wallet upsert + `CreditLedger ADMIN_CREDIT` + `AuditLog` vía `log(dto, tx)`); NO crea `Transaction` (no hecho imponible); NO aplica bonus Pro; `CreditLedger.note = "Créditos añadidos por el equipo"` (genérico, visible al usuario en su historial); `AuditLog.after.reason` = motivo real del admin (solo backoffice); `amount @Min(1)@Max(10000)`, `reason @MinLength(5)@MaxLength(500)` |
| **ListingActivation** | ✅ Completo (B0) | `ListingActivationService.listingBecameActive(slug, listingId)` — único punto de enganche para toda transición de un `Listing` a `ACTIVE` (`publish` rama ACTIVE, `approveListing`, `restoreListing`, **`renew`**). Consolida el reindexado (antes duplicado en `ListingsService`/`ModerationService`) y, desde B3, encola el flag `triggerAlertMatch` en el job `index`. `reserve`/`markAsSold` usan el wrapper genérico `reindexListing()` sin el flag — no disparan matching. Ver «Sistema de Alertas» más abajo |
| **Notifications** | ✅ Completo (B1) | Canal in-app genérico. Modelo `Notification` (`type: String` — molde `AuditLog.action`, no enum, para tipos futuros sin migración; `data: Json` = snapshot autocontenido, no punteros). `GET /notifications` (paginado), `GET /notifications/unread-count`, `POST /notifications/:id/read` (idempotente, `updateMany` scoped por `userId` — nunca confía en el `:id` solo), `POST /notifications/read-all`. `createNotification(userId, type, data)` — sin cola, para que B3 lo invoque directamente. Solo el tipo `ALERT_MATCH` implementado. Ver «Sistema de Alertas» más abajo |
| **Alerts** | ✅ Completo (B2+B3) | Búsqueda guardada de un comprador con matching automático. Modelo `Alert`: columnas core (`q`, `categorySlug`, `type`, `condition`, `priceType`, `minPrice`/`maxPrice`, `province`, `city`, `lat`/`lng`/`radiusMeters`) + `attributes Json` — no un blob `SearchParams` completo, para que B3 pueda pre-filtrar con SQL. `alertToSearchParams()` reconstruye `SearchParams` desde una alerta (reusado por el preview de B2 y el matching de B3). `POST /alerts` (crea + devuelve `{alert, matches}` con preview inmediato), `GET /alerts`, `PATCH /alerts/:id` (criterios/`active`), `DELETE /alerts/:id`, `GET /alerts/:id/matches`; todo scoped por `(id, userId)`. Modelo `AlertMatch` (`@@unique([alertId,listingId])`) para deduplicación. Ver «Sistema de Alertas» más abajo |
| **Contact** | ✅ Completo (RC.1+RC.2) | Formulario público de contacto — endpoint sin autenticación, superficie de ataque nueva; **5 defensas** (ver «RC.1 — Formulario de contacto público» en §2). `GET /contacto/token` (token firmado del time-trap), `GET /contacto/motivos` (**RC.2** — motivos activos, ordenados), `POST /contacto` (público; honeypot y time-trap fallidos → `200` silencioso sin persistir; rate limit superado → `429`). Modelos `ContactMessage` (sin columna de IP — decisión RGPD; `motivoId` FK a `ContactReason`) + `ContactReply` (historial 1:N) + **`ContactReason`** (RC.2 — motivo configurable por el admin, sustituye al enum `ContactMotivo`; sin DELETE, solo desactivación). `AdminContactMessagesController` (`@Roles(ADMIN)`, molde de `BannersService`: listado paginado+filtros por estado/motivoId, detalle con auto `NUEVO→LEIDO`, `PATCH :id/estado` **libre entre cualquier par de estados** + AuditLog, `POST :id/responder` — crea `ContactReply`, encola email, `→RESPONDIDO`; sin DELETE). `AdminContactReasonsController` (RC.2 — CRUD + reorder de motivos, guard: no se puede desactivar el último activo). Notifica a los admins por fan-out: una `Notification` `CONTACT_MESSAGE` (segundo tipo de B1, confirma que el modelo era extensible sin migración; snapshot guarda el nombre del motivo ya resuelto) + un email `SEND_CONTACT_NOTIFICATION` por cada `User role=ADMIN`. Ver «RC.2» en §2 para el detalle de la migración enum→datos. |

### Frontend (`apps/web` — puerto 3000)

| Página / Componente | Estado | Notas |
|---|---|---|
| **Home** `/` | ✅ Completo (H6.4 — rediseño portada) | Server Component, fetch paralelo (`getCategories`, `search`, `getActiveBanners`). Héroe con fondo tintado (`bg-primary/5`): elemento de firma — `SearchBar` agrandado (h-14/h-16, `rounded-2xl`, `shadow-lg`) es tipográfica y visualmente más grande que el `<h1>`, que se reduce a `text-2xl/3xl` bajo un eyebrow en mayúsculas; invierte la jerarquía habitual titular>buscador para que el buscador sea literalmente lo más grande de la pantalla. Chips de categorías populares (primeras 6 de `getCategories()`, sin query nueva) prefiltran `/busqueda?category=`. `CategoryGrid` retocado: scroll horizontal en móvil, tap targets mayores (sin tocar lógica). **`SearchBar` extendido** (único consumidor: la home) con dos `<select>` simétricos (mismo patrón visual, mismo `<optgroup>` que `FilterPanel` para categorías): categoría, poblada con las `categories` ya cargadas por la página, y provincia, poblada con `PROVINCIAS` (`lib/provincias.ts`, ~52 nombres, orden alfabético `es`). Al enviar compone `/busqueda?q=&category=&province=` incluyendo solo los campos no vacíos — mismos nombres de parámetro que `FilterPanel`/`busqueda/page.tsx` ya interpretan, sin tocar la búsqueda. Contenedor del héroe ampliado a `max-w-4xl` (antes `max-w-2xl`) para que los campos + botón quepan sin truncar texto. **Provincia, no municipio (decisión de producto):** el buscador de portada es una entrada amplia; el municipio se afina ya dentro de `/busqueda`. Primer diseño (corrección previa) usaba `MunicipioAutocomplete` para capturar ciudad+provincia; se sustituyó por un `<select>` de solo provincia por simetría con el selector de categoría y para evitar cargar `/data/municipios.json` (8132 filas) en la página de mayor tráfico del sitio solo para resolver una provincia. `MunicipioAutocomplete` **no se tocó ni se eliminó** — sigue en uso en `StepUbicacion` (wizard de publicar) y `PerfilForm`. **Formato crítico verificado:** `SearchService` filtra `province` con match EXACTO (`province = "..."` en Meilisearch, `search.service.ts:319`) contra el valor guardado en `Listing.province`, que en el wizard llega tal cual de `/data/municipios.json` vía `MunicipioAutocomplete`. `PROVINCIAS` se copió 1:1 de los valores únicos de ese mismo dataset (mismo capitalizado, mismas grafías cooficiales — p. ej. `"Alicante/Alacant"`, `"Bizkaia"`) para garantizar que el `<select>` de portada herede la compatibilidad ya probada; el comentario en `lib/provincias.ts` deja constancia de que ambas listas deben regenerarse juntas si `/data/municipios.json` cambia. Verificado en vivo: `province=Barcelona` desde el selector de portada renderiza "18 anuncios" en `/busqueda`, igual que `GET /search?province=Barcelona` en el backend — no hay desajuste de formato. **Deuda menor inventariada (no resuelta aquí):** `/busqueda` (`FilterPanel.tsx:405-428`) sigue con inputs de texto plano para provincia/ciudad, sin restringir a los valores canónicos — inconsistencia con la portada (que ahora sí restringe a `PROVINCIAS`), pendiente de unificar en una ráfaga futura. **Falsa regresión reportada tras el cambio de provincia (no era código):** el `<select>` de categoría pareció haber desaparecido; `git diff` confirmó que `SearchBar.tsx`/`page.tsx` seguían intactos — la causa fue un servidor de desarrollo del frontend arrancado sin el backend levantado en `:3001`, con lo que `getCategories().catch(() => [])` devolvía `[]` y el guard `{categories.length > 0 && (...)}` ocultaba correctamente tanto el select de categoría como los chips "Populares" (ambos comparten el mismo guard). Con el backend arriba, ambos vuelven. Lección: ante un elemento condicional a datos que "desaparece" en dev, comprobar primero si la fuente de datos (aquí, `:3001`) está realmente sirviendo antes de sospechar del código — mismo espíritu que el susto de caché del footer (ver punto 4, `callRevalidateEndpoint`, dentro de «Deuda de test/CI consolidada tras BLOG-FOOTER-COLUMNAS», más abajo en este documento). Sección "Recién publicados" migrada de `getRecentListings()` (Postgres, sin `boostScore`) a `search({sort:'publishedAt:desc', hitsPerPage:8})` (Meilisearch) — así el badge "Destacado" (H6.3) aparece de forma natural cuando un anuncio destacado cae entre los recientes, sin sección aparte ni cambio de backend. Sección nueva "Cómo funciona": dos columnas (compradores/vendedores) con pasos numerados 1-2-3 (secuencia real del flujo) + fila de señales de confianza (moderación, mensajería, valoraciones, gratis). `getRecentListings()` se mantiene en `lib/api/anuncios.ts` sin consumidores en el frontend — no se eliminó (endpoint real, uso futuro no descartado). |
| **Ficha anuncio** `/anuncio/[slug]` | ✅ Completo | Galería, precio con `priceType`, atributos de categoría, ubicación, anuncios relacionados, metadata OG + **`alternates.canonical`**; `ContactButton` integrado; **`ReportButton`** (solo autenticados) para reportar el anuncio. **RF.11**: `ListingOwnerActions` en la ficha — mismos botones Destacar/Bump que en mis-anuncios; `featuredUntil` consultado **sin caché** (bypass del Redis de 5 min) porque es estado del propietario, no contenido público; tras Destacar exitoso se oculta el botón reactivamente vía `router.refresh()`. **Teléfono + Compartir (feature cerrada)**: `PhoneButton` ("Ver teléfono", solo si `listing.hasPhone`) y `ShareButton` (Web Share API nativa si `navigator.share` existe; si no, dropdown con copiar enlace/WhatsApp/Telegram/email) — ver «Teléfono en anuncios + Compartir anuncio» en §2 para el diseño completo (privacidad del payload, rate limit, prerrelleno). `opengraph-image.tsx` (fallback sin foto) ahora renderiza el título real del anuncio, no el slug en crudo. |
| **Categoría** `/[categoria]` | ✅ Completo (H6.2 + RÁFAGA 2) | **RÁFAGA 2**: 3 vistas (Lista/Ampliada/Mapa) configurables por categoría vía `category.allowedViews`/`defaultView` (efectivos, con herencia); `ViewSwitcher` ofrece solo las permitidas. Gana MAPA por primera vez (antes solo lista); en fallback Postgres se fuerza LISTA. Ver «3 vistas de resultados configurables por categoría» en §2. **Migrada a Meilisearch** (antes Postgres directo sin facetas). `GET /search?category=slug` con facetas, filtros de atributos variables (fuel, rooms, gender…), proximidad geográfica y sort. FilterPanel reutilizado de `/busqueda` (con `categories={[]}` para que la categoría quede fija en el path URL). Fallback a Postgres (`getListingsByCategory`) si Meili no responde — se muestra banner y resultados básicos sin filtros. Categorías padre muestran anuncios de sus hijas via `categoryPath` de Meilisearch. Tests: `categoria-meili.spec.ts` (4 casos Playwright). `FilterPanel.SKIP_FACETS` ampliado con `categorySlug`. Tests `listing-card-attrs.spec.ts` actualizados: timeout 8 s → 25 s para las páginas de categoría (ahora async Meili). |
| **ListingCard — badge Destacado** | ✅ Completo (H6.3) | Badge ámbar superpuesto top-left en la foto cuando `boostScore === 1`. `boostScore?: 0 \| 1` añadido a `ListingSummary` (viaja en hits de Meilisearch via spread del documento). Sin efecto en la ruta Postgres (campo ausente → badge no renderiza). |
| **Búsqueda — vista de mapa** `/busqueda` | ✅ Completo (H6.5a+b+c) | **H6.5a** — Toggle `?view=mapa`; botones Lista/Mapa en cabecera. `MapView` client-only (`dynamic({ ssr: false })`) con MapLibre GL JS + tiles vectoriales MapTiler `streets-v2`. Markers individuales; `fitBounds`; modo mapa: `hitsPerPage=200`. Skeleton `animate-pulse`. **H6.5b** — Clustering nativo MapLibre: fuente GeoJSON `cluster:true/maxZoom:14/radius:50`; clusters = círculos azules escalados + count, clic → `easeTo` zoom-in. `SelectedListingPanel` debajo del mapa: thumbnail, título, precio `es-ES`, ciudad, link "Ver anuncio →", X. Aviso cap ámbar si `totalHits > hits.length` (`data-testid="map-cap-warning"`). Aviso "sin ubicación" si hay hits sin `_geo`, link "Ver lista" (`data-testid="map-missing-geo"`). **H6.5c** — Tarjeta flotante compacta (`FloatingCard`) **anclada al marcador**: posicionada con `map.project(geo)` y actualizada en cada evento `move` del mapa (sigue al pin al arrastrar/zoomear); clamping horizontal + flip vertical en borde superior. Panel enriquecido: grid 2 columnas con **todos los atributos** del anuncio (labels de `allAttributes` de la categories tree, no solo 1-2 cardAttributes); descripción `line-clamp-3`; vendedor: avatar 28 px + nombre públicos (`sellerName`/`sellerAvatarUrl` en el índice Meili tras `pnpm reindex`). Panel es PREVIEW, no reconstruye la ficha (fotos completas y contacto viven en `/anuncio/[slug]`). `busqueda/page.tsx` pasa `attributeMap={buildFullAttributeMap(categories)}`. **Tests**: `busqueda-mapa.spec.ts` (13 casos — 5 H6.5a + 4 H6.5b + 4 H6.5c; WebGL no inspectable → todos negativos/estructurales). **Verificación manual requerida**: tarjeta flotante sigue al pin al arrastrar/zoomear, panel muestra todos los atributos con labels, avatar+nombre vendedor visibles. |
| **Publicar** `/publicar` | ✅ Completo | Wizard 5–6 pasos; crea borrador + publica; tras publicar **ramifica por status**: ACTIVE → navega a la ficha, PENDING_REVIEW → panel informativo con enlace a mis-anuncios (no navega a la ficha, que daría 404) |
| **Login / Registro** | ✅ Completo (Hito 7 — login social) | Formularios con next-auth v5 CredentialsProvider + **GoogleProvider** (botón "Continuar con Google" en ambas páginas). Ver «Login social con Google — frontend» en §2 |
| **Verificar email** `/verificar-email` | ✅ Completo | Llama a `POST /auth/verify-email`; emite nuevo JWT con `emailVerified: true` |
| **Recuperar contraseña** | ✅ Completo | forgot-password + reset-password enlazado por email |
| **Mis anuncios** `/mis-anuncios` | ✅ Completo | Listado de anuncios propios + acciones de estado (publicar, reservar, vender, eliminar, **renovar**); filtro "En revisión" para `PENDING_REVIEW`; muestra `expiresAt` en la tarjeta. **RF.11**: `ListingOwnerActions` integrado — botones Destacar (vía créditos o tarjeta Redsys) y Bump (vía créditos); la cobertura de errores es completa: 400 `ALREADY_FEATURED` (mapeado por `err.code`, no por texto), 402 saldo insuficiente, 429 cooldown con cuenta atrás formateada (`formatRetryAfter`); `featuredUntil`/`bumpedAt` leídos de `findMine` y actualizados vía `router.refresh()` |
| **Editar anuncio** `/mis-anuncios/[id]/editar` | ✅ Completo | Wizard de edición (`EditarWizard`) precargado con datos del backend vía `GET /listings/mine/:id`; categoría bloqueada |
| **Vendedor** `/vendedor/[slug]` | ✅ Completo | Perfil del vendedor (avatar, bio, ubicación, fecha de registro) + grid paginado de anuncios activos |
| **Búsqueda** `/busqueda` | ✅ Completo (RÁFAGA 2) | **RÁFAGA 2**: 3 vistas de resultados (Lista/Ampliada/Mapa, siempre las 3 aquí) vía `ViewSwitcher`, persistidas en `?view=`; `ListingCardWide` (vista Ampliada, hasta 6 atributos + descripción); `CardPhotoCarousel`/`PhotoLightbox` (fotos navegables en la card + visor a pantalla completa, carga perezosa por índice — ver detalle en §2); mapa con alto viewport-relativo (antes fijo 520px). Server Component con fetch paralelo a Meilisearch; sidebar `FilterPanel` con categorías, tipo, estado, rango de precio, ordenación, facetas dinámicas, **control "cerca de mí"** (solicita `navigator.geolocation`, fija `lat`/`lng`/`radius` en la URL, selector de radio 5–50 km, orden por distancia automático); paginación; estados de error y vacío |
| **Perfil propio** `/perfil` | ✅ Completo | Ruta protegida por middleware; muestra avatar, nombre, email, ubicación y aviso de email no verificado; `PerfilForm` con campos nombre, teléfono, bio, ciudad (`MunicipioAutocomplete`), provincia (auto-rellenada, editable), código postal; accesos rápidos a mis-anuncios, mensajes y favoritos; botón de cerrar sesión. **RL5.1-C**: sección de avatar con preview (shadcn `Avatar`), botón "Cambiar foto" → `<input type="file">` oculto → sube a `POST /media/upload-avatar` → preview optimista + URL real; spinner/deshabilitado durante la subida, mensaje de error si falla; `avatarUrl` guardado junto con el resto del perfil en `updateMe()`. El "Guardar cambios" se deshabilita mientras el avatar se está subiendo. **RL5.1-B**: `MunicipioAutocomplete` para el campo ciudad. **RL5.1-A**: prefill de ubicación del perfil → wizard de publicar. Playwright: 43/43 (2 nuevos: `avatar-upload.spec.ts`) |
| **Favoritos** `/favoritos` | ✅ Completo | Ruta protegida. SSR paginado; `FavoritosClient` gestiona lista visible con eliminación/rollback optimista. Botón corazón en `ListingCard` (`FavoriteCardButton` leaf client) visible en **todas las vistas con grid**: home, búsqueda, categoría, vendedor, anuncios relacionados en ficha y la propia `/favoritos`. Resolución en lote: `POST /favorites/batch-check` → 1 request por grid. `FavoritesGridProvider` context en cada página SSR, sin romper SSR. En `/favoritos` la tarjeta desaparece al desmarcar y reaparece si el DELETE falla |
| **Bandeja mensajes** `/mensajes` | ✅ Completo | `BandejaMensajesClient`: lista de conversaciones con thumbnail, contador de no leídos y tiempo relativo; actualización en vivo vía WebSocket |
| **Chat** `/mensajes/[id]` | ✅ Completo | `ChatClient`: mensajes en orden cronológico, auto-scroll, carga de mensajes anteriores (cursor-based), envío vía POST REST, recepción en tiempo real vía WebSocket con deduplicación idempotente |
| **Admin shell** | ✅ Completo | Layout Server Component + `<AdminNav>` (active state vía `usePathname`; ítems filtrados por `session.user.role` — MODERATOR ve 4 ítems: Anuncios, Usuarios, Reportes, Blog; EDITOR ve solo Blog) + `<AdminUserBar>` (nombre del admin + `signOut`); middleware con `ROLE_ALLOWED_PATHS` (mapa rol→paths) — ADMIN acceso total, MODERATOR `/admin/{reportes,anuncios,usuarios,blog}`, EDITOR solo `/admin/blog`, resto → redirect `/`; toda la carpeta `(admin)/` es client-side sin SSR |
| **Admin dashboard** `/admin` | ✅ Completo | Fetch a `GET /admin/stats`; KPIs en 3 secciones (anuncios, usuarios/moderación, índice de búsqueda); skeleton de carga y estado de error |
| **Admin anuncios** `/admin/anuncios` | ✅ Completo | Tabla paginada con chips de filtro por estado; cambio de estado inline (select + razón + confirmar) vía `PATCH /admin/listings/:id/status`; reportes recibidos visibles en la fila |
| **Admin usuarios** `/admin/usuarios` | ✅ Completo | Tabla con buscador (nombre/email), chips status y rol; acciones suspend/ban/reinstate contextuales al estado; **selector de rol** (USER/MODERATOR/EDITOR) por fila vía `PATCH /admin/users/:id/role` — ADMIN no ofrecido como valor, y no se muestra selector para filas ADMIN (evita auto-degradación); panel de detalle expandible (últimos anuncios + reportes recibidos + auditlog); no muestra botones de acción para usuarios ADMIN |
| **Admin reportes** `/admin/reportes` | ✅ Completo | Cola de reportes paginada con filtro de estado; acciones resolve/dismiss/retirar anuncio |
| **Admin categorías** `/admin/categorias` | ✅ Completo (RC5.3) | Árbol de categorías con CRUD inline (crear raíz/subcategoría, editar, borrar); reordenación ↑↓ con `PATCH /admin/categories/reorder`; editor VISUAL de atributos (reemplaza el textarea JSON): filas por atributo, heredados read-only separados de los propios, miniform por atributo (type→options condicional, required/filterable/cardAttribute), guardado de solo los atributos propios; errores 400 propagados bajo la fila. |
| **Admin ajustes** `/admin/ajustes` | ✅ Completo | 3 settings con controles tipo-específicos: `badWordList` (textarea una palabra por línea), `listingExpiryDays` (number input), `contactRequiresVerification` (checkbox); save por setting con estado de carga / ✓ éxito / error inline; timestamp de última actualización |
| **Blog público** `/blog` | ✅ Completo | `export const revalidate = 3600`; Server Component ISR; listado paginado de posts PUBLISHED con tarjetas (portada, título, excerpt, fecha, autor, tags); filtro `?tag=`; estados de vacío; paginación; breadcrumb. Portada: solo se renderiza con `<Image>` si `isSafeSrc()` pasa (ver §2 y §3) |
| **Blog detalle** `/blog/[slug]` | ✅ Completo | `export const revalidate = 3600`; Server Component ISR; `notFound()` si slug no existe, es DRAFT o no es `type=POST`; body Markdown renderizado vía `<MarkdownBody>` compartido (`react-markdown` + `remark-gfm` + `rehype-sanitize`, sin `rehype-raw` — **regla invariante de seguridad**, ver §2 y «Páginas informativas» más abajo); clase `prose` de `@tailwindcss/typography`; `generateMetadata()` con `og:type: 'article'`, `publishedTime`, `authors`, imagen OG; JSON-LD `BlogPosting` embebido; breadcrumb |
| **Página informativa** `/paginas/[slug]` | ✅ Completo (BLOG-PAGINAS) | Análogo a `/blog/[slug]` pero `type=PAGE`: sin fecha/autor/tags/prev-next, solo título + `<MarkdownBody>`; `og:type: 'website'` (no `'article'`), sin `publishedTime`/`authors`; JSON-LD `WebPage` (no `BlogPosting`), URL `/paginas/{slug}`. Ver «Páginas informativas» más abajo |
| **Sitemap** `/sitemap.xml` | ✅ Actualizado | `getPostList` (type=POST, filtrado backend-side) bajo `/blog/{slug}` + `getPageList` (type=PAGE) bajo `/paginas/{slug}`, en paralelo. Los DRAFT nunca aparecen porque ambos endpoints públicos filtran por `status = PUBLISHED` en Prisma |
| **Admin blog** `/admin/blog` | ✅ Completo | Tabla paginada (todos los estados, `type=POST` vía `GET /admin/blog?type=POST` — implícito, no se envía `type` para posts) con chips Todos / Borrador / Publicado; acciones Editar / Publicar / Despublicar / Eliminar (con confirmación) inline por fila; client-side |
| **Admin nuevo post** `/admin/blog/nuevo` | ✅ Completo | Formulario `PostForm` compartido: title, slug (editable; si se deja vacío el backend lo genera del título), excerpt, body (editor de markdown estilo GitHub `@uiw/react-md-editor` + toggle preview — ver «Editor de markdown en PostForm» más abajo), tags (coma-separadas), portada (solo upload a `/media/upload`, sin campo de URL libre), campos SEO colapsables (metaTitle, metaDescription); al guardar redirige a la página de edición |
| **Admin editar post** `/admin/blog/[id]/editar` | ✅ Completo | Mismo `PostForm` precargado desde `GET /admin/blog/:id`; cabecera con badge de estado + botones Publicar/Despublicar/Eliminar + enlace "Ver en blog ↗" cuando está publicado; banner de éxito al guardar |
| **Admin páginas** `/admin/paginas` | ✅ Completo (BLOG-PAGINAS) | Mismo patrón que `/admin/blog` (tabla, chips, acciones) pero `GET /admin/blog?type=PAGE`; sin columna de tags. `/admin/paginas/nueva` y `/admin/paginas/[id]/editar` reutilizan `PostForm` con `showTagsField={false}`; crear desde aquí envía `type: 'PAGE'` explícito; enlace "Ver página ↗" en vez de "Ver en blog ↗" |
| **Admin facturación** `/admin/facturacion` | ✅ RF.12 | Listado de transacciones con filtros (userId, status, gateway); panel de detalle de usuario (saldo, historial de ledger, entitlements activos). **RF.12b**: formulario de acreditación manual — campo `amount` (1–10 000) + `reason` (5–500 chars); llama a `POST /admin/billing/credits/:userId`; muestra saldo actualizado tras la operación. Ningún campo sensible expuesto (DTO backend con `select` explícito) |
| **Plan Pro — Catálogo** `/planes` | ✅ RF.9 | Server Component; consume `GET /billing/catalog` (endpoint público); muestra planes free/pro con precios y CTAs de upgrade. Reutiliza `apiFetch` y shadcn/ui |
| **Plan Pro — Éxito** `/planes/exito` | ✅ RF.9 | Solo UI; maneja el estado asíncrono del webhook — no concede acceso, informa al usuario de que el pago está en proceso |
| **Plan Pro — Cancelado** `/planes/cancelado` | ✅ RF.9 | Solo UI; página de retorno tras cancelar el flujo de checkout de Stripe |
| **Suscripción** `/perfil/suscripcion` | ✅ RF.9 | Ruta protegida; muestra estado de suscripción activa + botón de cancelación (`cancel_at_period_end`). Reutiliza Next-Auth v5 y shadcn/ui |
| **Wallet y packs** `/mis-creditos` | ✅ RF.10 | Server Component; ruta protegida (añadida a `accountPrefixes` en middleware y al sidebar de cuenta). Fetcha en paralelo `GET /billing/wallet` (saldo + historial paginado con etiquetas legibles por tipo de movimiento: "Compra de pack", "Destacado", "Bump", "Crédito manual", "Ajuste", "Bonus Pro") y `GET /billing/catalog` (packs ONE_TIME con `creditAmount`). `PackList` (client component): renderiza una tarjeta por pack individual — itera `product.prices` en vez de `products`, usa `price.packName` y `price.creditPackId`. `handleBuy(creditPackId)` llama `createPackCheckout`, monta `RedsysRedirectForm` al recibir el form firmado. `RedsysRedirectForm`: form `method="POST"` con `Ds_MerchantParameters`, `Ds_SignatureVersion`, `Ds_Signature` como hidden inputs + `data-testid="redsys-redirect-form"` (Playwright), auto-submit via `useEffect`. Gestión de sesión stale vía `useApiAction` (igual que RF.9). |
| **Retorno pago de packs (éxito)** `/mis-creditos/exito` | ✅ RF.10 | Client Component (`'use client'`). **INVARIANTE DE SEGURIDAD**: no concede créditos ni ejecuta lógica de negocio; el wallet lo acredita exclusivamente la notificación online de Redsys (`POST /webhooks/redsys`), no esta página (ver `diseno-facturacion.md §7.5`). Muestra mensaje "procesando", consulta `GET /billing/wallet` para mostrar el saldo actual si está disponible, y ofrece un botón "Actualizar saldo" que re-consulta el wallet manualmente. |
| **Retorno pago de packs (error)** `/mis-creditos/error` | ✅ RF.10 | Server Component estático. Solo UI: "El pago no se completó", "No se te ha cobrado ningún importe", enlace de vuelta a `/mis-creditos`. |
| **Header global** | ✅ Completo (B1) | Pasó de estático (siempre "Iniciar sesión") a consciente de sesión: `Header` (server, `auth()`) delega la parte de sesión a `HeaderAuthNav` (client, `useSession()`) — anónimo ve login sin cambios, logueado ve `NotificationBell` + menú de usuario nuevo (antes no existía ningún acceso al área privada desde el header público). Primer uso de `@radix-ui/react-dropdown-menu` en el proyecto (instalado para esto) |
| **Notificaciones** `/notificaciones` | ✅ Completo (B1) | Molde exacto de `/favoritos` (SSR + estado optimista). Campana con badge de no-leídas: SSR inicial + refetch al cambiar de ruta y al abrir el desplegable — sin polling por intervalo. Marcar leída al click (optimista); "Marcar todas como leídas". Solo renderiza `ALERT_MATCH` (`getNotificationContent` — `switch(type)`, listo para tipos futuros) |
| **Crear alerta** (en `/busqueda`) | ✅ Completo (B2) | Botón "Crear alerta" lee `alertCriteria` ya calculado por el server component de `/busqueda` (mismas variables que arman la llamada a `search()`, sin re-parseo) y abre un `Dialog` que solo pide el nombre; `POST /alerts` devuelve `{alert, matches}` y el diálogo muestra el preview de coincidencias al instante |
| **Mis alertas** `/mis-alertas` | ✅ Completo (B2) | Molde `/favoritos`: SSR + `MisAlertasClient` con pausar/reactivar (`PATCH active`) y borrar optimistas; "Ver coincidencias" expande inline bajo demanda (`GET /alerts/:id/matches`) |
| **Contacto** `/contacto` | ✅ Completo (RC.1+RC.2) | Público, sin auth. `'use client'` (no Server Component): el token del time-trap y **la lista de motivos activos** (`GET /contacto/motivos`, RC.2) se piden en cliente en el mismo `useEffect` al montar — evita el riesgo de caché ISR que ya mordió al footer en H6.4. Campos: motivo (select, poblado dinámicamente — ya no un enum fijo), email, teléfono opcional, mensaje; honeypot (`empresa`) oculto por CSS fuera de pantalla — **NUNCA** `display:none`/`visibility:hidden` (los bots que solo parsean el DOM filtran por esos atributos). Enlace desde el footer lo añade el admin desde `/admin/footer` (`FooterItemType.INTERNAL`), sin tocar código. |
| **Admin mensajes de contacto** `/admin/mensajes-contacto` | ✅ Completo (RC.1+RC.2) | Listado (filtros estado/motivoId — el filtro de motivo usa `GET /admin/contact-reasons`, TODOS incluidos inactivos, paginado) + detalle (auto `NUEVO→LEIDO` al abrir) + cambio de estado **libre** (selector, cualquier transición) + formulario de responder (envía a `ContactMessage.email`, inmutable — nunca un campo libre) + historial de respuestas. El mensaje se renderiza siempre como texto plano (React lo escapa por defecto); **prohibido `dangerouslySetInnerHTML`** en esta vista — el remitente no está autenticado (defensa XSS central del diseño). Botón "Motivos" enlaza a `/admin/motivos-contacto`. |
| **Admin motivos de contacto** `/admin/motivos-contacto` | ✅ Completo (RC.2) | CRUD de `ContactReason`: crear, renombrar (inline), reordenar (flechas ↑↓, molde `/admin/categorias` — swap optimista de 2 `orden` + rollback por refetch en error), activar/desactivar. Sin DELETE. Aviso explícito en la página: un motivo desactivado deja de ofrecerse en `/contacto` pero los mensajes históricos lo conservan intacto. |

---

## 2. Decisiones técnicas y desviaciones respecto al diseño original

Índice de esta sección (75 decisiones/desviaciones documentadas, orden cronológico por ráfaga;
enlaces ancla — funcionan en GitHub y en la vista previa de Markdown de VS Code):

- [Ruta `/vendedor/[slug]` en lugar de `/[vendedor]`](#ruta-vendedorslug-en-lugar-de-vendedor)
- [Campo `priceType` (enum `FIXED | FREE | NEGOTIABLE`)](#campo-pricetype-enum-fixed-free-negotiable)
- [Anuncios recientes vía Postgres; categorías vía Meilisearch (H6.2)](#anuncios-recientes-vía-postgres-categorías-vía-meilisearch-h62)
- [`categoryPath` jerárquico y sintaxis de filtro de array en Meilisearch](#categorypath-jerárquico-y-sintaxis-de-filtro-de-array-en-meilisearch)
- [Orden del spread en `toDocument` para no pisar campos core](#orden-del-spread-en-todocument-para-no-pisar-campos-core)
- [DTO explícito de atributos variables por el ValidationPipe estricto](#dto-explícito-de-atributos-variables-por-el-validationpipe-estricto)
- [Herencia de schema de atributos (RC5.2 + RC5.2b)](#herencia-de-schema-de-atributos-rc52-rc52b)
- [Editor visual de atributos: decisiones de diseño (RC5.3)](#editor-visual-de-atributos-decisiones-de-diseño-rc53)
- [Mapa de integridad ante borrados/ediciones (cierre Fase 5.2)](#mapa-de-integridad-ante-borradosediciones-cierre-fase-52)
- [ListingCard con cardAttributes: decisiones de diseño (RC5.5)](#listingcard-con-cardattributes-decisiones-de-diseño-rc55)
- [`allAttributes` en el árbol de categorías + `buildFullAttributeMap` (H6.5c)](#allattributes-en-el-árbol-de-categorías-buildfullattributemap-h65c)
- [Deuda `type` → `itemType` (RC5.2)](#deuda-type-itemtype-rc52)
- [Atributos filtrables dinámicos — RÁFAGA 0](#atributos-filtrables-dinámicos-ráfaga-0)
- [Modelo producto/servicio — RÁFAGA 1](#modelo-productoservicio-ráfaga-1)
- [Admin de categorías producto/servicio — RÁFAGA 2](#admin-de-categorías-productoservicio-ráfaga-2)
- [Wizard producto/servicio — RÁFAGA 3](#wizard-productoservicio-ráfaga-3)
- [Búsqueda y ficha producto/servicio — RÁFAGA 4](#búsqueda-y-ficha-productoservicio-ráfaga-4)
- [Fix ioredis en BullMQ](#fix-ioredis-en-bullmq)
- [Verificación de email: nuevo JWT en lugar de re-login](#verificación-de-email-nuevo-jwt-en-lugar-de-re-login)
- [Imágenes: upload pre-anuncio (huérfanas temporales)](#imágenes-upload-pre-anuncio-huérfanas-temporales)
- [Script reindex: `ReindexModule` mínimo y cierre limpio sin `process.exit()`](#script-reindex-reindexmodule-mínimo-y-cierre-limpio-sin-processexit)
- [Gateway WebSocket y modelo de rooms (Fase 5)](#gateway-websocket-y-modelo-de-rooms-fase-5)
- [Deduplicación idempotente por id en el cliente (Fase 5)](#deduplicación-idempotente-por-id-en-el-cliente-fase-5)
- [Fix de propagación de `emailVerified` desde login (Fase 5)](#fix-de-propagación-de-emailverified-desde-login-fase-5)
- [Caducidad automática y renovación de anuncios](#caducidad-automática-y-renovación-de-anuncios)
- [Geocoding configurable con fallback silencioso](#geocoding-configurable-con-fallback-silencioso)
- [Geocoding asíncrono y FIFO BullMQ (H6 — cambio de arquitectura)](#geocoding-asíncrono-y-fifo-bullmq-h6-cambio-de-arquitectura)
- [`waitForTask()` en `indexListing`: indexación determinista (H6 — fix raíz del flaky de CI)](#waitfortask-en-indexlisting-indexación-determinista-h6-fix-raíz-del-flaky-de-ci)
- [Búsqueda por proximidad: `_geoRadius` + `_geoPoint`](#búsqueda-por-proximidad-georadius-geopoint)
- [Testing e2e: aislamiento por identificadores (Fase T)](#testing-e2e-aislamiento-por-identificadores-fase-t)
- [Helpers y fixtures de test compartidos (Fase T)](#helpers-y-fixtures-de-test-compartidos-fase-t)
- [`global-setup.ts` de Playwright y seed de usuarios e2e (Fase T)](#global-setupts-de-playwright-y-seed-de-usuarios-e2e-fase-t)
- [webServer de Playwright y propagación de env vars en CI (Fase T)](#webserver-de-playwright-y-propagación-de-env-vars-en-ci-fase-t)
- [CI: workflow de GitHub Actions (Fase T — RT.5)](#ci-workflow-de-github-actions-fase-t-rt5)
- [Observabilidad: Sentry (Fase T — RT.6)](#observabilidad-sentry-fase-t-rt6)
- [Observabilidad: logging estructurado con pino (Fase T — RT.6)](#observabilidad-logging-estructurado-con-pino-fase-t-rt6)
- [Markdown del blog: `rehype-sanitize` sin `rehype-raw` (Fase B — regla invariante)](#markdown-del-blog-rehype-sanitize-sin-rehype-raw-fase-b-regla-invariante)
- [Valoraciones (Reviews): elegibilidad, unicidad, edición y agregado (Hito 3)](#valoraciones-reviews-elegibilidad-unicidad-edición-y-agregado-hito-3)
- [`@tailwindcss/typography`: import ESM, no `require()` (Fase B)](#tailwindcsstypography-import-esm-no-require-fase-b)
- [Portadas del blog: solo upload a nuestro almacenamiento (Fase B)](#portadas-del-blog-solo-upload-a-nuestro-almacenamiento-fase-b)
- [`@IsUrl` en DTOs: `require_tld: false, require_protocol: true` (Fase B / Hito 3)](#isurl-en-dtos-requiretld-false-requireprotocol-true-fase-b-hito-3)
- [AuditLog: captura explícita en el service, nunca vía interceptor (Fase 7)](#auditlog-captura-explícita-en-el-service-nunca-vía-interceptor-fase-7)
- [BadWordService: filtro con fallback silencioso al publicar (Fase 7)](#badwordservice-filtro-con-fallback-silencioso-al-publicar-fase-7)
- [Separación de roles ADMIN / MODERATOR en el backoffice (RR5.1 + RR5.1-ext)](#separación-de-roles-admin-moderator-en-el-backoffice-rr51-rr51-ext)
- [Rol EDITOR — blog (BLOG-EDITOR)](#rol-editor-blog-blog-editor)
- [UI de asignación de roles en /admin/usuarios (BLOG-ADMIN-ROLE-UI)](#ui-de-asignación-de-roles-en-adminusuarios-blog-admin-role-ui)
- [Editor de markdown en PostForm (`@uiw/react-md-editor`)](#editor-de-markdown-en-postform-uiwreact-md-editor)
- [Páginas informativas (BLOG-PAGINAS) — cierra el bloque de blog](#páginas-informativas-blog-paginas-cierra-el-bloque-de-blog)
- [Footer semi-dinámico + slug inmutable para páginas (BLOG-FOOTER-DINAMICO)](#footer-semi-dinámico-slug-inmutable-para-páginas-blog-footer-dinamico)
- [Footer estructurado en columnas por grupos (BLOG-FOOTER-COLUMNAS)](#footer-estructurado-en-columnas-por-grupos-blog-footer-columnas)
- [Navegación del footer como entidad propia (FooterColumn/FooterItem) — retira BLOG-FOOTER-DINAMICO/COLUMNAS](#navegación-del-footer-como-entidad-propia-footercolumnfooteritem-retira-blog-footer-dinamicocolumnas)
- [Sistema de bloques — Ráfaga 1: modelo + validación + los 9 renderizadores (SIN editor)](#sistema-de-bloques-ráfaga-1-modelo-validación-los-9-renderizadores-sin-editor)
- [Sistema de bloques — Ráfaga 2: el editor completo (cierra el sistema de contenido)](#sistema-de-bloques-ráfaga-2-el-editor-completo-cierra-el-sistema-de-contenido)
- [Sistema de bloques — Ráfaga 3: 4 tipos nuevos (3 estáticos + el primer bloque DINÁMICO) — 13 tipos](#sistema-de-bloques-ráfaga-3-4-tipos-nuevos-3-estáticos-el-primer-bloque-dinámico-13-tipos)
- [CI: `footer-paginas.spec.ts` fallaba consistentemente — causa raíz real (`APP_URL` equivocado, no el secret)](#ci-footer-paginasspects-fallaba-consistentemente-causa-raíz-real-appurl-equivocado-no-el-secret)
- [Protección anti-degradación de ADMIN en cambio de rol (Fase 7)](#protección-anti-degradación-de-admin-en-cambio-de-rol-fase-7)
- [Límites de anuncios activos por plan y configuración en caliente (RF.7-A)](#límites-de-anuncios-activos-por-plan-y-configuración-en-caliente-rf7-a)
- [`revokedAt` en Entitlement: patrón de expiración idempotente (RF.7-B.1)](#revokedat-en-entitlement-patrón-de-expiración-idempotente-rf7-b1)
- [boostScore y sortDate en Meilisearch (RF.8)](#boostscore-y-sortdate-en-meilisearch-rf8)
- [Política de ordenación C: boostScore deja de particionar la lista (RÁFAGA 1, 2026-07-13)](#política-de-ordenación-c-boostscore-deja-de-particionar-la-lista-ráfaga-1-2026-07-13)
- [Filtros: validación de atributos por categoría (RÁFAGA 1 — fix del leak cross-categoría)](#filtros-validación-de-atributos-por-categoría-ráfaga-1--fix-del-leak-cross-categoría)
- [Provincia: select cerrado en FilterPanel (RÁFAGA 1 — cierra la inconsistencia con la portada)](#provincia-select-cerrado-en-filterpanel-ráfaga-1--cierra-la-inconsistencia-con-la-portada)
- [`/[categoria]/[subcategoria]` — ruta muerta eliminada (RÁFAGA 1)](#categoriasubcategoria--ruta-muerta-eliminada-ráfaga-1)
- [3 vistas de resultados configurables por categoría (RÁFAGA 2, 2026-07-13)](#3-vistas-de-resultados-configurables-por-categoría-ráfaga-2-2026-07-13)
- [Display de atributos en card: showLabel/showUnit configurables (RÁFAGA 3, 2026-07-13)](#display-de-atributos-en-card-showlabelshowunit-configurables-ráfaga-3-2026-07-13)
- [Dos bugs de RÁFAGA 2 encontrados y corregidos de raíz (2026-07-13)](#dos-bugs-de-ráfaga-2-encontrados-y-corregidos-de-raíz-2026-07-13)
- [Atributos en card: respetar producto/servicio (2026-07-13)](#atributos-en-card-respetar-productoservicio-2026-07-13)
- [Auditoría — herencia de atributos en categorías + dos bugs de filtros (2026-07-13)](#auditoría--herencia-de-atributos-en-categorías--dos-bugs-de-filtros-2026-07-13)
- [Filtros — cerrando dos hallazgos de la auditoría + guarda de profundidad (2026-07-14)](#filtros--cerrando-dos-hallazgos-de-la-auditoría--guarda-de-profundidad-2026-07-14)
- [Dos bugs de atributos en card: no-filtrables ausentes + contadores sin herencia (2026-07-14)](#dos-bugs-de-atributos-en-card-no-filtrables-ausentes--contadores-sin-herencia-2026-07-14)
- [Contadores de atributos de card — resuelto el desacuerdo con hechos, añadido "impacto en hijas" (2026-07-14)](#contadores-de-atributos-de-card--resuelto-el-desacuerdo-con-hechos-añadido-impacto-en-hijas-2026-07-14)
- [Pro downgrade con des-indexado de Meilisearch (RF.7-B.2 — bug detectado y corregido)](#pro-downgrade-con-des-indexado-de-meilisearch-rf7-b2-bug-detectado-y-corregido)
- [Settings: whitelist explícita en el service (Fase 7)](#settings-whitelist-explícita-en-el-service-fase-7)
- [Migración `add_audit_log_and_settings` (Fase 7)](#migración-addauditlogandsettings-fase-7)
- [UserStatus aplicado en login y en el guard JWT (Fase 7 — deuda cerrada)](#userstatus-aplicado-en-login-y-en-el-guard-jwt-fase-7-deuda-cerrada)
- [Stripe v22: subscription de la primera factura en `invoice.parent` (RF.3)](#stripe-v22-subscription-de-la-primera-factura-en-invoiceparent-rf3)
- [Stripe — checkout + renovación de suscripción Pro (e2e), CERRADO](#stripe--checkout--renovación-de-suscripción-pro-e2e-cerrado)
- [Redsys — verificación contra el sandbox real (CERRADO)](#redsys--verificación-contra-el-sandbox-real-cerrado)
- [Modo de pago Redsys: REDIRECCIÓN (no InSite) (RF.10)](#modo-de-pago-redsys-redirección-no-insite-rf10)
- [Bonus Pro: congelar el bonus calculado, no la condición Pro (RF.10)](#bonus-pro-congelar-el-bonus-calculado-no-la-condición-pro-rf10)
- [Manejo centralizado de sesión stale: hook `useApiAction` (RF.9)](#manejo-centralizado-de-sesión-stale-hook-useapiaction-rf9)
- [`FavoritesGridContext`: omisión deliberada de `listingIds` en el `useEffect` (RF.9)](#favoritesgridcontext-omisión-deliberada-de-listingids-en-el-useeffect-rf9)
- [RF.11: código estructural `ALREADY_FEATURED` en lugar de match de substring (RF.11)](#rf11-código-estructural-alreadyfeatured-en-lugar-de-match-de-substring-rf11)
- [RF.11: `apiFetch` endurecido — body-first parsing con soporte de 2xx vacíos](#rf11-apifetch-endurecido-body-first-parsing-con-soporte-de-2xx-vacíos)
- [RF.11: `featuredUntil` y `bumpedAt` servidos frescos para el propietario](#rf11-featureduntil-y-bumpedat-servidos-frescos-para-el-propietario)
- [RF.11: `ApiError` extendida con `retryAfter`, `isCooldownError`, `isCreditError`](#rf11-apierror-extendida-con-retryafter-iscooldownerror-iscrediterror)
- [RF.11: matriz de cobertura acción × vía × ubicación × error](#rf11-matriz-de-cobertura-acción-vía-ubicación-error)
- [RF.12: `AdminBillingController` — select explícito y filtro de entitlements activos](#rf12-adminbillingcontroller-select-explícito-y-filtro-de-entitlements-activos)
- [RF.12b: acreditación manual atómica y separación de nota vs. motivo](#rf12b-acreditación-manual-atómica-y-separación-de-nota-vs-motivo)
- [RF.12b: `AuditLogService.log(dto, tx?)` — parámetro de transacción opcional](#rf12b-auditlogservicelogdto-tx-parámetro-de-transacción-opcional)
- [Lecciones de método: la saga del flaky del CI (H6 — las más valiosas del proyecto)](#lecciones-de-método-la-saga-del-flaky-del-ci-h6-las-más-valiosas-del-proyecto)
- [Login social con Google — backend (Hito 7, parte 1)](#login-social-con-google-backend-hito-7-parte-1)
- [Login social con Google — frontend (Hito 7, parte 2 — cierra el Hito 7)](#login-social-con-google-frontend-hito-7-parte-2-cierra-el-hito-7)

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

### Anuncios recientes vía Postgres; categorías vía Meilisearch (H6.2)

`GET /listings` (recientes) se resuelve directamente contra Postgres (`prisma.listing.findMany`).

**H6.2**: los listados por categoría (`/[categoria]`) se migraron a Meilisearch (`GET /search?category=slug`).
El cambio unifica el motor de búsqueda y añade facetas, filtros de atributos variables y proximidad
geográfica a las páginas de categoría, que antes no los tenían. El filtro funciona por `categoryPath`
(array en el documento Meili), permitiendo que una categoría padre devuelva anuncios de sus hijas.
Si Meilisearch no responde, la página degrada automáticamente a Postgres sin facetas (fallback
silencioso con banner informativo). El endpoint `GET /categories/:slug/listings` (backend) y la
función `getListingsByCategory` (frontend) se conservan como fallback.

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

**✅ SUPERADO (RÁFAGA 0 — producto/servicio):** `SearchQueryDto` ya no declara un campo
por atributo variable; `search-query.parser.ts` valida esas claves contra el mapa dinámico
de `FilterableAttributesResolver` (ver «Atributos filtrables dinámicos — RÁFAGA 0»). El
párrafo original queda por contexto histórico: por qué el DTO llegó a declarar cada
atributo explícitamente.

El backend arranca con `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`.
Cualquier query parameter que no esté declarado en `SearchQueryDto` era rechazado con
400. Por eso los atributos variables de categoría (brand, fuel, rooms, gender, size,
**itemType**…) estaban **declarados explícitamente** como campos del DTO en lugar de
leerse como mapa genérico. `VARIABLE_ATTRIBUTE_KEYS` en `search.service.ts` era la
fuente de verdad compartida; el DTO y el service debían mantenerse en sync al añadir
atributos nuevos. El atributo `itemType` fue añadido en RC5.2 para reemplazar `type`
(colisión con el enum `ListingType`).

**✅ RESUELTO (RÁFAGA 0 — producto/servicio):** la tensión dinámico-vs-estático descrita en este
párrafo (atributos filtrables hardcodeados en `VARIABLE_ATTRIBUTE_KEYS`/`SearchQueryDto` frente al
resto de usos, dinámicos desde BD) ya no existe: `FilterableAttributesResolver` deriva el conjunto
filtrable de `Category.attributeSchema` para toda la aplicación, incluida la búsqueda. Un atributo
guardado con `filterable: true` es filtrable en `GET /search` sin tocar código — solo requiere
reiniciar el proceso (memoizado una vez al arrancar, sin refresco en caliente; ver §3). Detalle
completo en «Atributos filtrables dinámicos — RÁFAGA 0» más abajo. Texto original conservado por
contexto histórico: los atributos filtrables en búsqueda seguían hardcodeados (`VARIABLE_ATTRIBUTE_KEYS`
+ `SearchQueryDto`); los demás usos (wizard, ficha de anuncio, tarjeta RC5.5) eran dinámicos desde BD.
Un atributo guardado con `filterable: true` cuyo `name` no estuviera en `VARIABLE_ATTRIBUTE_KEYS` se
almacenaba y se mostraba en el wizard y la ficha, pero el parámetro `?name=valor` en `GET /search` era
rechazado con 400 (campo no declarado en `SearchQueryDto`).

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
`GET /admin/categories/searchable-keys` expone el conjunto filtrable (desde RÁFAGA 0,
`FilterableAttributesResolver` — antes `VARIABLE_ATTRIBUTE_KEYS` hardcodeado) para que el
editor de atributos (RC5.3) desactive el checkbox `filterable` para atributos cuyo
nombre no esté (todavía) en ese conjunto.

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

### Mapa de integridad ante borrados/ediciones (cierre Fase 5.2)

Auditoría exhaustiva de qué pasa con los datos dependientes cuando se borra o edita
una categoría, un anuncio, un atributo de schema o un usuario. Dos fixes salieron de
esta auditoría (ver más abajo); el resto queda documentado tal cual está, con la
deuda anotada donde aplica.

| Acción | Protección | Dato dependiente | Resultado |
|---|---|---|---|
| Borrar categoría con **cualquier** anuncio (no solo ACTIVE) | Chequeo explícito en servicio → 400 | `Listing.categoryId` | **Bloqueado** — `No se puede eliminar: la categoría tiene N anuncio(s)` |
| Borrar categoría con subcategorías | Chequeo explícito en servicio → 400 | `Category.parentId` (hijas) | **Bloqueado** — `No se puede eliminar: la categoría tiene N subcategoría(s)` |
| Borrar anuncio | Solo `assertOwnership` | `ListingImage`, `Favorite`, `Conversation`→`Message`, `Report` | **HARD delete en cascada** (`onDelete: Cascade` en las cuatro relaciones) |
| Borrar anuncio | — | `Entitlement`, `Transaction`, `Review` | Sobreviven con `listingId → NULL` (`onDelete: SetNull`) — registros que no deben desaparecer: `Entitlement`/`Transaction` son de facturación, `Review` es reputación (H7: no debe ser borrable por el vendedor borrando el anuncio; snapshot en `Review.listingTitle`) |
| Admin borra un atributo del `attributeSchema` de una categoría | Ninguna sobre datos existentes | `Listing.attributes[key]` | **Se conserva** en el JSONB del anuncio; solo deja de listarse/mostrarse (sin FK entre `attributes` y `attributeSchema`) |
| Admin renombra la `name` de un atributo existente | Aviso en el editor (ráfaga actual) | `Listing.attributes[oldKey]` | **No se migra.** El anuncio viejo conserva `oldKey` (huérfano, invisible) y el campo `newKey` sale vacío. El editor avisa con el recuento real antes de guardar; la decisión final es del admin |
| Publicar/editar anuncio tras cambiar el schema | `validateAttributes` contra el schema **actual** | — | Anuncios nuevos solo ven el schema vigente; no piden atributos ya borrados |
| Borrar usuario (físico) | No existe endpoint | `Listing` del usuario (`onDelete: Cascade` en el schema) | **No aplicable en la API** — la cascada es teórica; solo existe BAN (`PATCH /admin/users/:id/ban` → `status: BANNED`) |

**Constraints físicas en Postgres** (relevantes para el FIX 1, ver abajo):
`Listing_categoryId_fkey` es `ON DELETE RESTRICT` (bloquea el DELETE si existe
*cualquier* Listing en la categoría, sea cual sea su `status`);
`Category_parentId_fkey` es `ON DELETE SET NULL` (a nivel de BD, borrar un padre
con hijos los convertiría en categorías raíz — es el chequeo explícito del
servicio, no la constraint física, lo que realmente bloquea este caso).

**FIX 1 — 500 no controlado al borrar categoría con anuncios no-ACTIVE (resuelto):**
`deleteCategory` contaba únicamente `status: ACTIVE` para decidir el 400, pero la
constraint física es `RESTRICT` sobre cualquier `Listing`. Una categoría con solo
anuncios `DRAFT`/`SOLD`/`EXPIRED`/etc. pasaba el chequeo del servicio y el `DELETE`
físico posterior chocaba con `RESTRICT`, devolviendo un 500 sin controlar. Fix
(Opción A pura): el `count` ya no filtra por `status` — cuenta todos los anuncios
de la categoría, cualquiera que sea su estado, así el 400 legible cubre exactamente
los mismos casos que bloquearía la constraint física y nunca se llega al `RESTRICT`.
Tests: `admin.e2e-spec.ts` — categoría vacía → 204, con anuncio `ACTIVE` → 400, con
anuncio `DRAFT` → 400 (antes daba 500), con subcategoría → 400.

**FIX 2 — aviso al renombrar una key de atributo con datos (resuelto, nivel medio: avisar, no migrar):**
Como el renombrado de una `name` en el `attributeSchema` nunca migra
`Listing.attributes` (ver fila de la tabla de arriba), se añadió
`GET /admin/categories/:id/attribute-usage?key=X` (`AdminService.getAttributeUsage`,
ADMIN-only) que cuenta anuncios de esa categoría con datos bajo `key` en su JSON
`attributes`, vía el operador jsonb `?` de Postgres
(`SELECT COUNT(*) FROM "Listing" WHERE "categoryId" = $1 AND "attributes" ? $2`,
con `$queryRaw` parametrizado — mismo patrón que los `$executeRaw` de
`billing.service.ts`). En `AttributeSchemaEditor.tsx`, `commitDraft()` detecta que
se está **renombrando una fila existente** (no creando una nueva) comparando el
`name` viejo con el nuevo; si hay `checkAttributeUsage` (solo se pasa en modo
edición — una categoría en creación no puede tener anuncios) y el count es > 0,
muestra un `window.confirm()` con el número real de anuncios afectados antes de
aplicar el cambio. Cancelar el diálogo aborta el renombrado sin tocar `rows`. Si
la llamada al endpoint falla, el check se abre en fallo (`fail-open`): nunca
bloquea el guardado por un problema de red. **No migra nada** — es puramente
informativo, coherente con la deuda anotada en la fila de arriba (migración real
queda pendiente, ver §3). Tests: `admin.e2e-spec.ts` (count correcto por key, 404
si la categoría no existe) + `AttributeSchemaEditor.test.tsx` (primer test unitario
de componente del proyecto, Jest + Testing Library sobre jsdom — `fireEvent`/`act`
en vez de `@testing-library/user-event`, que no está en las devDependencies):
renombrar con datos → `confirm()` con el count real; cancelar → no llama a
`onChange`; renombrar sin datos (count 0) → sin `confirm()`; crear atributo nuevo →
nunca llama a `checkAttributeUsage`; editar solo el label (sin cambiar `name`) →
tampoco la llama. Wired en CI como paso `Frontend unit — Jest` (`pnpm --filter
@marketplace/web test:unit`), independiente del `Frontend e2e — Playwright` que sí
necesita el stack completo.

### ListingCard con cardAttributes: decisiones de diseño (RC5.5)

`findTree()` en el backend ahora devuelve `cardAttributes: [{key, label, unit?}]` (antes `cardAttributeKeys: string[]`) para que la card tenga label y unit sin necesidad de otro fetch. El search controller normaliza los hits planos de Meilisearch (`hit.brand`, `hit.year`…) a `{ attributes: { brand, year, … } }` para que el componente use la misma ruta de datos (`listing.attributes[key]`) tanto desde Postgres como desde Meilisearch. La card consume los defs de un `CardAttributesContext` (context ligero, sin efectos, análogo a `FavoritesGridContext`) que cada página SSR alimenta con un map `categorySlug → defs`; para páginas con árbol de categorías ya disponible se usa `buildCardAttributeMap(categories)`; para páginas con solo una categoría (categoría, ficha) se usa `buildCardAttributeMapFromSchema(slug, schema)`. Los favoritos añaden `getCategories()` en paralelo y extraen `categorySlug` en `normalize()`. La card omite silenciosamente cualquier atributo sin valor (opcional no rellenado) y no muestra "label: undefined". El formato es "Marca: Toyota · Año: 2022"; unidades se añaden como "30000 km".

### `allAttributes` en el árbol de categorías + `buildFullAttributeMap` (H6.5c)

El endpoint `GET /categories` ya calculaba el schema efectivo de cada categoría (`resolveEffectiveSchema`) para derivar `cardAttributes` (1-2 atributos destacados para la tarjeta). El panel de mapa de H6.5c necesita **todos** los atributos del anuncio con sus labels para mostrar, por ejemplo, "Marca: Toyota · Año: 2022 · Km: 30 000 km · Combustible: Gasolina" sin una llamada al backend por selección.

**Cambio**: `findTree()` ahora devuelve `allAttributes: [{key, label, unit?}]` junto a `cardAttributes`. Es la lista completa del schema efectivo (sin filtrar por `cardAttribute`), usando la misma lógica de `resolveEffectiveSchema`. No añade ninguna query a BD — los datos ya estaban en memoria; solo se exponen en la respuesta.

**`buildFullAttributeMap(categories): CardAttributeMap`** (nueva función en `card-attributes.ts`): construye el mapa `slug → allAttributes` para todas las categorías del árbol. Fallback a `cardAttributes` para categorías que no tengan `allAttributes` (retrocompatibilidad). Usada en `busqueda/page.tsx` para pasar `attributeMap` al `MapViewClient`.

**`buildCardAttributeMap`** sigue existiendo y se usa en el `CardAttributesProvider` de la vista de lista (sin cambio).

Los atributos del anuncio viajan en `listing.attributes` en los hits de Meilisearch (normalizados desde los campos planos del documento por el `SearchController`). Los labels los aporta `allAttributes` del árbol de categorías. Sin fetch adicional por selección.

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

### Atributos filtrables dinámicos — RÁFAGA 0

Ráfaga de saneamiento previa al cambio producto/servicio (ver «Cambio en curso —
Producto/Servicio» más abajo, antes de §4). Objetivo: derivar los atributos filtrables de
búsqueda de `Category.attributeSchema` en vez de la lista hardcodeada
`VARIABLE_ATTRIBUTE_KEYS`, para que añadir un atributo filtrable a una categoría no
requiera tocar código de búsqueda — necesario porque producto/servicio multiplicará los
atributos por tipo. Refactorización pura: **comportamiento observable idéntico**,
verificado sobre BD de test limpia (571 tests e2e en verde).

**`FilterableAttributesResolver`** (nuevo, `modules/search/filterable-attributes.resolver.ts`):
consulta `Category.attributeSchema` de **todas** las categorías (unión plana — no
`resolveEffectiveSchema` — porque la pregunta es "qué claves existen como filtrables en
todo el sistema", no "qué schema aplica a una categoría concreta"), se queda con las
entradas `filterable: true`, y excluye estructuralmente cualquier `name` que coincida con
un campo reservado (core de Meilisearch o campo core del DTO de búsqueda) — esto convierte
la antigua convención humana (renombrar `type` → `itemType` a mano en el seed, ver deuda
de arriba) en una regla del código. Si dos categorías declaran el mismo `name` con `type`
distinto, se conserva el primero y se emite `Logger.warn` (tolerante, no rompe el
arranque). El resultado (`Map<name, type>`) se memoiza la primera vez que se pide —
efectivamente una vez por arranque del proceso, **sin refresco en caliente** (ver deuda en
§3): cambiar `filterable` en el admin de categorías no tiene efecto hasta reiniciar,
comportamiento idéntico al de la lista hardcodeada anterior.

**Los 4 usos reales de `VARIABLE_ATTRIBUTE_KEYS`** (constante eliminada) migrados al mapa
dinámico: (1) `filterableAttributes` de Meilisearch en `onModuleInit()`; (2) extracción de
atributos válidos desde el query string en `SearchController`; (3) normalización de los
hits planos de Meilisearch al objeto `attributes` anidado que lee `ListingCard`; (4)
`AdminService.getSearchableAttributeKeys()` (`GET /admin/categories/searchable-keys`) —
este último no estaba en el plan original de la ráfaga, se descubrió al grepear todas las
referencias antes de borrar la constante.

**Validación dinámica del query string:** `SearchQueryDto` se redujo a los campos core;
`search-query.parser.ts` (nuevo) separa el query crudo en campos core (validados
reutilizando el propio `ValidationPipe` de Nest con las mismas opciones que `main.ts`, sin
reimplementar su lógica) y atributos variables (validados/coeraccionados contra el mapa
dinámico — `number` → `Number()` + `isFinite`, `boolean` → `'true'`/`true` literal o
`false` sin rechazar nunca, `text`/`select` → debe ser string). Una clave que no es ni
campo core ni atributo filtrable conocido sigue devolviendo 400, igual que antes con
`forbidNonWhitelisted`.

**Fix derivado, no anticipado en el diseño:** `FACET_ATTRIBUTES` (lista curada a mano,
independiente de lo filtrable) pedía facetas sobre atributos (`gearbox`, `gender`,
`modality`, `rooms`…) que en el entorno de test (`prisma/seed-test.ts`, fixture mínimo, sin
relación con `prisma/seed.ts` de producción) no existen — Meilisearch rechaza con 500 pedir
una faceta sobre un atributo no filtrable. La lista estática anterior enmascaraba esto
porque declaraba esos nombres como filtrables sin importar si algún dato real los usaba.
Solución: `SearchService.search()` intersecta `FACET_ATTRIBUTES` con el conjunto realmente
filtrable en tiempo de consulta antes de pedirlo a Meilisearch. `FACET_ATTRIBUTES` en sí no
se tocó.

**Efecto colateral en dos tests e2e (no comportamiento, orden de setup):** `rc5-attributes.e2e-spec.ts`
y `rc5b-vehiculos.e2e-spec.ts` crean categorías propias con `prisma.category.create(...)`
**después** de `app.init()` en su `beforeAll` — con la lista estática esto no importaba
(hardcodeada, ajena al momento de creación de la categoría); con el resolver memoizado al
arrancar, una categoría creada después del arranque no es filtrable en esa misma corrida.
Se reordenó el `beforeAll` de ambos specs (categorías antes de `app.init()`) y se quitó una
aserción de `rc5-attributes.e2e-spec.ts` (`toContain('fuel')`) que solo pasaba porque la
lista estática global siempre incluía `fuel`, sin relación con las categorías propias de
ese test. Verificado repitiendo la batería con `Category` truncada entre pasadas (no solo
antes de la primera) para descartar falsos verdes por residuos de corridas anteriores.

### Modelo producto/servicio — RÁFAGA 1

Base del cambio producto/servicio (ver «Cambio en curso — Producto/Servicio» más abajo,
antes de §4). Objetivo: la categoría configura qué tipo(s) de anuncio admite, cada atributo
del esquema se etiqueta con a qué tipo(s) aplica, y `Listing.type` se valida contra esa
política. Migración deliberadamente suave: mismo comportamiento observable hasta que un
admin configure algo (verificado con 584 tests e2e en verde sobre BD limpia).

**Política de tipo en `Category`**: `enum ListingTypePolicy { PRODUCT_ONLY, SERVICE_ONLY,
BOTH }` + `Category.allowedListingType ListingTypePolicy @default(BOTH)`. Columna propia
(no vive en el canal Json de `attributeSchema`/`Listing.attributes`) y nombre
`allowedListingType` — deliberadamente ni `type` ni `itemType` ni `ListingType`, para no
repetir la colisión ya sufrida (ver «Deuda `type` → `itemType`» arriba). Migración sin
backfill: Prisma escribe el default `BOTH` en las categorías existentes al aplicar
`20260707201127_add_category_allowed_listing_type`.

**Conexión tipo↔atributos**: `AttributeField` gana `appliesTo?: ('PRODUCT'|'SERVICE')[]`
(opcional; ausente = aplica a ambos). Solo cambia la forma del objeto TS dentro del mismo
`Json`, no la columna — cero migración de datos, todo atributo existente en el seed sigue
aplicando a ambos tipos sin tocarlo.

**Funciones puras en `category.types.ts`** (mismo patrón de separación merge/validación que
`resolveEffectiveSchema` + `validateCardAttributeLimit`):
- `resolveEffectivePolicy(own, parentEffective)`: `BOTH` es el elemento neutro (hijo `BOTH`
  → hereda la política ya resuelta del padre; padre `BOTH` → manda la política propia del
  hijo). Si ambos restringen a un tipo *distinto* — contradicción real — la función nunca
  lanza: gana el padre, defensivamente. Misma profundidad de 2 niveles (hoja → padre) que
  `resolveEffectiveSchema`.
- `isListingTypeAllowed(policy, type)`: si la política efectiva permite ese `ListingType`.
- `filterSchemaByType(schema, type)`: filtra un schema ya resuelto por `appliesTo` —
  compuesta **sobre** `resolveEffectiveSchema` (primero heredar, luego filtrar por tipo), no
  la sustituye.

**Validación de `Listing.type`**: `ListingsService.create()` añade `allowedListingType` al
`select` que ya traía `category` + `category.parent` (sin round-trip extra), resuelve la
política efectiva y valida `dto.type` — `UnprocessableEntityException` (422, mismo estilo
que `validateAttributes` hermana) si no está permitido. `update()` repite la misma
comprobación cuando cambia `categoryId`, contra `existing.type` (inmutable, ver debajo) —
cierra el vector de mover un anuncio a una categoría cuya política ya no lo admite.

**`Listing.type` inmutable tras crear** — decisión consciente, no trivial: `type` retirado
de `UpdateListingDto` (mismo patrón y comentario explícito que `UpdatePostDto.type`), pero a
diferencia de `Post.type` esto **sí retiró una capacidad real y activa**: `EditarWizard.tsx`
reutilizaba `StepDatos` (con su `RadioGroup` Producto/Servicio) y enviaba `type` en cada
PATCH; ningún test e2e lo protegía, pero la UI lo ejercitaba en cada edición. `StepDatos.tsx`
gana un modo lectura (`readOnlyType`) para cuando lo usa `EditarWizard`; este ya no envía
`type` en el payload. De paso cierra una grieta preexistente: `update()` no revalidaba
`attributes` cuando el único campo que cambiaba era `type` — al ser ahora inmutable, ese
camino deja de existir.

**Migración indolora — verificación**: batería completa (35 suites, 584 tests) en verde
sobre `Category` truncada (BD limpia, no solo antes de la primera pasada). Único ajuste:
`listings.service.spec.ts` (unitario) simulaba a mano una fila de `Category` sin
`allowedListingType` — hueco de fixture (la BD real siempre devuelve ese campo, `NOT NULL
DEFAULT 'BOTH'`), no cambio de comportamiento; se completó el mock.

### Admin de categorías producto/servicio — RÁFAGA 2

Cierra el backend del cambio producto/servicio (con R0 y R1 ya cerradas — ver «Cambio en
curso — Producto/Servicio» más abajo, antes de §4): los admins pueden configurar la
política de tipo por categoría y etiquetar atributos por tipo, y editar el schema refresca
la búsqueda sin reiniciar. `CreateCategoryDto`/`UpdateCategoryDto` ganan
`allowedListingType?: ListingTypePolicy`; selector en el formulario básico de categoría
(junto a `order`).

**Validación de escritura bidireccional** (el matiz central de esta ráfaga):
- **Hacia arriba** — `assertPolicyConsistentWithParent(own, parentId)`: guard explícito que
  **lanza** `BadRequestException` si la política propia contradice la ya persistida del
  padre. Deliberadamente **no** reutiliza `resolveEffectivePolicy` (R1) — esa función es
  defensiva y nunca lanza, pensada para la lectura en tiempo de creación de anuncios, no
  para rechazar una escritura. Árbol de 2 niveles (`parentId` inmutable): la política del
  padre es directamente su valor propio, sin resolución recursiva.
- **Hacia abajo** — `assertPolicyChangeDoesNotBreakChildren(categoryId, newPolicy)`: mismo
  molde que `deleteCategory` (conteos exactos en `$transaction`, 400 con el número/nombre,
  nunca "avisar y permitir" ni "permitir en silencio" — postura elegida siguiendo ese
  precedente). Se ejecuta **solo cuando `allowedListingType` cambia de verdad** respecto al
  valor persistido (editar nombre/schema sin tocar la política no paga el coste de
  consultar hijos/anuncios). Rechaza si (a) un hijo con política propia contradictoria ya
  existe, o (b) hay anuncios del tipo prohibido en la categoría o cualquiera de sus hijos.
  **Caso crítico verificado en test**: el conteo de anuncios incluye a los hijos `BOTH` —
  heredan la nueva restricción del padre, así que sus anuncios del tipo ahora prohibido
  quedarían igual de incoherentes. Ensanchar a `BOTH` nunca se rechaza (nunca rompe nada).

**`appliesTo` por atributo en `AttributeSchemaEditor.tsx`**: dos checkboxes
Producto/Servicio por fila (mismo patrón que `filterable`/`required`/`cardAttribute`).
`fromDraft()` omite `appliesTo` del payload cuando ambos están marcados — `attributeSchema`
byte-idéntico para quien no toca estos checkboxes. Regla de validación: "selecciona al
menos un tipo" (simétrica a la de `select`). **Coherencia con la política de la categoría
deliberadamente no validada**: un atributo `appliesTo:['SERVICE']` en una categoría
`PRODUCT_ONLY` es inerte (ningún anuncio de esa categoría es nunca `SERVICE`, así que
`filterSchemaByType` nunca lo mostrará) — configuración muerta, no dato corrupto; no
amerita el mismo rigor que la política de tipo, que si protege contra datos incoherentes
reales.

**Refresco en caliente vía cola** (regla de `apps/api/CLAUDE.md`: trabajo pesado a colas
BullMQ, nunca inline en la petición HTTP): `FilterableAttributesResolver.invalidate()`
(`this.cache = null`) + `SearchService.refreshFilterableAttributes()` (invalida, recalcula,
`index.updateSettings(...)`) — cuerpo de `onModuleInit` extraído a un método privado
compartido. Nuevo job `refresh-filterable-attributes` en `QUEUE_INDEXING`, encolado desde
`createCategory`/`updateCategory` **solo cuando el payload toca `attributeSchema`** (no
cuando solo cambia `allowedListingType`, que no afecta a Meilisearch). Resuelve el diferido
de RÁFAGA 0 — ver nota actualizada en «Deuda nueva abierta por RÁFAGA 0» en §3, con el
limitante nuevo de caché-por-proceso inventariado allí.

**Migración indolora — verificación**: 53 tests unitarios + 9 e2e nuevos
(`admin-category-type-policy.e2e-spec.ts`) + batería completa (36 suites, 593 tests) en
verde sobre `Category` truncada, sin tocar ningún test existente.

### Wizard producto/servicio — RÁFAGA 3

Cierra la cara de **creación** del cambio producto/servicio (backend R0+R1+R2 ya cerrado —
ver «Cambio en curso — Producto/Servicio» más abajo, antes de §4): el wizard pregunta el
tipo solo cuando corresponde y muestra únicamente los atributos del tipo elegido.

`CategoriesService.findBySlug()` expone `allowedListingType` ya resuelto, mismo patrón que
`attributeSchema` (reutiliza `resolveEffectivePolicy` de R1, sin round-trip extra — el
padre ya se traía en la misma query para el schema). `StepDatos` recibe
`readOnlyType = data.allowedListingType !== 'BOTH'` en `PublicarWizard` (reutilizando el
prop ya construido en R1 para `EditarWizard`): el `RadioGroup` Producto/Servicio se oculta
y el tipo queda fijo cuando la política no es `BOTH`.

**`filterSchemaByType`** — nuevo helper en `apps/web/src/lib/attribute-schema.ts`, espejo
del backend (`category.types.ts`) — se aplica en los **tres puntos de consumo**, no uno
solo: `StepAtributos` (render), `validateStep('atributos')` (un requerido del tipo apagado
no bloquea el avance) y `buildAttributes` en el envío. **Caso crítico verificado**:
`buildAttributes` itera el **schema filtrado** y lee sus valores de `data.attributes` — no
al revés — así que un atributo del tipo ya no elegido queda excluido del body enviado
aunque siga en memoria tras varias idas y venidas del usuario entre tipos.

**Transiciones de estado** (el matiz central de la ráfaga):
- **Cambio de categoría**: `handleCategoryComplete` ya limpiaba `attributes: {}`; se
  amplió para derivar también `type`/`condition` de la política de la nueva categoría
  (`PRODUCT_ONLY`/`SERVICE_ONLY` fuerza el tipo; `BOTH` conserva la elección previa).
- **Cambio de tipo, misma categoría `BOTH`**: `data.attributes` **no se toca** — se
  conserva en memoria y se filtra en cada punto de consumo. Si el usuario cambia de tipo y
  vuelve al anterior, sus respuestas siguen ahí; los campos del tipo no elegido nunca se
  muestran, exigen ni envían mientras tanto.

`EditarWizard` aplica el mismo `filterSchemaByType` al schema que ya recibía — sin matiz de
transición (tipo y categoría inmutables ahí desde R1).

**Migración indolora — verificación**: 5 tests e2e nuevos
(`categories-type-policy.e2e-spec.ts`) + 6 tests RTL nuevos (`PublicarWizard.test.tsx`,
incluido el caso crítico del payload) + batería completa (37 suites, 598 tests) en verde
sobre `Category` truncada + 4 suites/23 tests de Jest en el frontend, sin tocar ningún test
existente.

**Deuda/nota nueva**: `filterSchemaByType` está **duplicado** — backend
(`category.types.ts`) y frontend (`attribute-schema.ts`) no comparten código entre paquetes
del monorepo, así que es un espejo deliberado, no un descuido. Si `appliesTo` gana
complejidad en el futuro (p. ej. más de dos tipos, reglas de combinación), ambas copias
deben actualizarse juntas — inventariado, no urgente mientras la lógica siga siendo un
filtro tan simple.

**✅ RESUELTO EN RÁFAGA 4**: `wizard-herencia.spec.ts` corrió en real (13/13 verde, incluidos
sus 5 casos) al levantar el stack completo para R4 — confirma por corrida real, no solo por
inspección, que es un no-op. Texto original conservado por contexto histórico: se había
revisado solo por inspección (sin ejecutar), porque requería levantar todo el stack
(Postgres/Redis/Meilisearch/MinIO + backend + frontend); el análisis de código ya indicaba
que sería un no-op (sus categorías de test — Vehículos/Coches, Electrónica/Móviles — no usan
`allowedListingType` ni `appliesTo`).

### Búsqueda y ficha producto/servicio — RÁFAGA 4

Cierra la **presentación pública** del cambio producto/servicio (R0-R3 ya cerradas — ver
«Cambio en curso — Producto/Servicio» más abajo, antes de §4). Con R4, el cambio
producto/servicio es **funcional de punta a punta**: un admin configura la política de una
categoría, un usuario publica con el tipo forzado o elegido según corresponda, la búsqueda
filtra y presenta facetas conscientes del tipo, y la ficha muestra solo los atributos
aplicables — sin ningún tramo del flujo ajeno a la dimensión de tipo.

**Hallazgo clave de esta ráfaga**: al observar antes de diseñar, la mayor parte de lo que R4
"necesitaba" **ya existía** o salía gratis de ráfagas anteriores:
- El filtro por tipo (Producto/Servicio) en `FilterPanel` **ya existía desde H6.2** —
  `Listing.type` siempre fue un campo core de dominio, indexado y filtrable en Meilisearch
  desde antes de este cambio, ajeno a la política de categoría.
- Las facetas conscientes del tipo salen **gratis por construcción**: `SearchService.search()`
  ya incluye `type` en el mismo array `filters` que se usa como base de `facets` en la misma
  llamada a Meilisearch (la facetDistribution se calcula sobre el resultado ya filtrado), y
  `FilterPanel` ya omite renderizar una faceta sin valores. Ningún atributo `appliesTo`-restringido
  llega nunca a un anuncio del tipo que no le aplica (R1/R3), así que su faceta
  simplemente no tiene valores que mostrar cuando se filtra por el otro tipo.
- "Condición" ya se oculta en fichas de servicio sin tocar nada — el campo es nullable y el
  wizard (R1) ya lo limpia al elegir `SERVICE`.

Con esto, R4 se redujo a **2 piezas de código** + verificar (no reconstruir) lo demás — la
observación previa evitó reconstruir un filtro y un mecanismo de facetas que ya funcionaban.

**Código**:
- Ficha: `filterSchemaByType(schema, listing.type)` aplicado antes de `AttributeList`. El
  `schema` **sin filtrar** se conserva aparte para el mapa de atributos de tarjeta de los
  anuncios relacionados (`buildCardAttributeMapFromSchema`), que pueden ser de un tipo
  distinto al de este anuncio — caso borde cubierto explícitamente, no una omisión.
- `FilterPanel`: nuevo prop `allowedListingType?: ListingTypePolicy` — si se pasa y no es
  `BOTH`, oculta la sección "Tipo" en vez de ofrecer una opción que siempre daría 0
  resultados (mismo criterio que `readOnlyType` en el wizard, R3). `/[categoria]` ya pasa la
  política efectiva de su categoría (disponible desde R3); `/busqueda` no la pasa → sin
  cambios, sigue mostrando "Tipo" siempre.

**Verificado, no construido** (lo que R4 heredaba de antes):
- Filtro por tipo end-to-end: confirmado con Playwright real (`categoria-meili.spec.ts`,
  caso "Filtro de tipo: type=PRODUCT muestra el coche; type=SERVICE no lo muestra").
- Facetas conscientes del tipo: confirmado **empíricamente** con un e2e nuevo
  (`search-facets-by-type.e2e-spec.ts`, 5/5) — categoría `BOTH` con `gearbox` (solo-PRODUCT)
  y `modality` (solo-SERVICE): filtrar por tipo hace desaparecer la faceta del otro tipo.
- Condición oculta en servicios: confirmado, sin cambios de código.

**Migración indolora — verificación**: 5 tests e2e nuevos (`search-facets-by-type.e2e-spec.ts`)
+ 2 suites Jest nuevas en frontend (`attribute-schema.test.ts`, `FilterPanel.test.tsx`) +
batería completa (38 suites, 603 tests) en verde sobre `Category` truncada + 6 suites/32
tests de Jest en el frontend + **13/13 Playwright real** (`wizard-herencia`,
`categoria-meili`, `listing-card-attrs`), sin tocar ningún test existente.

### Orden por flechas (categorías + atributos)

Se retiró el input numérico de `order` de `CategoryForm` — era la "puerta trasera" que
permitía introducir empates o huecos que el mecanismo de flechas (intercambio atómico de
pareja, ya existente para categorías) no puede producir por construcción. Al crear una
categoría, `order` se calcula automáticamente: `max(hermanos del mismo nivel) + 1`, o `0` si
es la primera de su nivel (`nextOrderFor(parentId)`). El campo `order` sigue existiendo en
el modelo y el DTO (`CreateCategoryDto.order` sigue siendo opcional) — solo se retira de la
UI de edición manual.

**Atributos** (novedad — antes no tenían mecanismo de reordenación): flechas
`ChevronUp`/`ChevronDown` por atributo **propio** en `AttributeSchemaEditor` (los heredados
no son reordenables — se editan desde la categoría padre). El orden es la posición del
atributo en el array `attributeSchema` — no hay campo `order` separado ni endpoint nuevo:
`moveRow(idx, dir)` hace un swap de posiciones en el array y se persiste con el guardado ya
existente del schema. Intrínsecamente robusto: al no depender de un campo numérico, no puede
generar el mismo tipo de empate/hueco que el input retirado.

**Dato verificado, no asumido**: antes de decidir si migrar datos existentes, se consultó la
base de datos de desarrollo real y se encontró **1 empate genuino** preexistente (categorías
Vehículos/Inmuebles, ambas con `order = 2`). Decisión: **no migrar** — es cosmético (afecta
solo el orden relativo de esas dos categorías en un empate), y las flechas lo toleran y lo
autocorrigen en cuanto un admin mueva cualquiera de las dos.

### Selects vinculados (Marca/Modelo) — mecanismo

Nuevo mecanismo genérico para atributos `select` cuyas opciones dependen del valor elegido
en otro `select` de la misma categoría (caso de uso: Marca → Modelo). Aditivo y de un solo
nivel (A independiente, B depende de A — sin cadenas); demostrado con un caso mínimo (2
marcas, 2-3 modelos cada una), **no** el catálogo real Marca/Modelo — eso es un paso de
contenido/seed posterior, fuera de esta ráfaga.

**Modelo** (`category.types.ts` / `types/index.ts`, espejo backend-frontend como
`filterSchemaByType`): `AttributeField` gana `dependsOn?: string` (name del atributo padre) y
`optionsByParent?: Record<string, string[]>`. Si `dependsOn` está presente, `optionsByParent`
es la **única** fuente de opciones — `options` (plano) se ignora. `resolveLinkedOptions(field,
parentValue)` resuelve `optionsByParent[parentValue] ?? []` (select plano: devuelve `options`
directamente). Ortogonal a `appliesTo` — ambos ejes se componen sin interferir (verificado con
test dedicado: un campo vinculado con `appliesTo` restringido conserva su
`dependsOn`/`optionsByParent` intactos tras `filterSchemaByType`).

**Wizard** (`StepAtributos.tsx`): el select dependiente se deshabilita hasta que el padre
tenga valor; al cambiar el padre, recalcula las opciones del hijo y lo resetea si su valor ya
no es válido para el nuevo valor del padre (un solo nivel — no hay propagación en cascada).
Validación client-side en `validateStep` (`PublicarWizard`/`EditarWizard`): un valor de campo
vinculado que ya no encaja con el padre bloquea el avance.

**Backend** (`ListingsService.validateLinkedSelects`, junto a `validateAttributes`, en
`create()` y `update()`): para cada campo con `dependsOn` en el schema efectivo, si el payload
trae valor para el hijo, debe estar en `optionsByParent[valor del padre en el MISMO payload]`
→ si no, `422`. Caso borde con mensaje explícito: hijo presente sin padre → "requiere
seleccionar primero «Marca»" (no un genérico "valor inválido"). **Asimetría consciente**: el
guard solo se acota a campos con `dependsOn` — los atributos planos siguen con la validación
débil preexistente (ver nota actualizada en «Validación débil de atributos» en §3).

**Búsqueda**: sin cambios — se mantiene plana (Meilisearch filtra por igualdad normal); las
facetas de RÁFAGA 4 ya podan por construcción las combinaciones sin resultados, sin necesidad
de que la búsqueda conozca el vínculo entre ambos atributos.

**Admin** (`AttributeSchemaEditor.tsx`): selector "Depende de" que solo ofrece como candidatos
otros `select` (propios excluyendo el propio + heredados) que **no tengan ya su propio
`dependsOn`** — la cadena de vínculos es imposible **por construcción** (la UI nunca la
ofrece), no solo por convención documentada. Editor de `optionsByParent`: un sub-editor de
chips por cada opción actual del padre, precargado con sus valores para no obligar a
recordarlos. `dependsOn` roto (el padre referenciado ya no existe entre los candidatos —
borrado o cambiado de tipo) se trata como select plano, tolerante: no bloquea el guardado,
solo avisa.

**Migración indolora — verificación**: 3 tests nuevos en `category.types.spec.ts` (incluida
la composición con `appliesTo`) + `linked-select-attributes.e2e-spec.ts` (9 tests: guard en
create/update, ambos casos 422, plano no afectado) + 3 suites Jest nuevas en frontend
(`StepAtributos.test.tsx`, `AttributeSchemaEditor.dependsOn.test.tsx`, extensión de
`attribute-schema.test.ts`) + batería completa (39 suites, 610 tests e2e backend; 10 suites,
53 tests frontend) en verde, sin tocar ningún test existente.

**Pendiente (contenido, no mecanismo)**: convertir el atributo real `model` (hoy `text` en
las categorías de vehículos del seed) a `select` y poblar `optionsByParent` con el catálogo
real Marca/Modelo — paso de datos/seed posterior, a hacer desde el editor admin o un script
de seed. El mecanismo ya es genérico y queda demostrado y probado con el caso mínimo.

### Verificación integral producto/servicio — RÁFAGA 5 (cierra el cambio)

R0-R4 ya habían cerrado el cambio producto/servicio pieza por pieza, cada una con su
propia batería en aislamiento (búsqueda dinámica, modelo, admin, wizard, ficha). R5 no
repite esas baterías — verifica las **costuras**: los flujos que cruzan varias ráfagas a
la vez y la coherencia entre backend y frontend (la lógica duplicada deliberadamente,
`filterSchemaByType` / `resolveLinkedOptions`, nunca antes contrastada contra un backend
real, solo contra mocks en RTL o vía API directa en aislamiento).

**Inventario previo** (antes de escribir ningún test): ninguna categoría
`PRODUCT_ONLY`/`SERVICE_ONLY` había pasado nunca por un navegador real; la UI admin de
`/admin/categorias` nunca se había ejercitado en Playwright para `allowedListingType`,
`appliesTo` ni `dependsOn` (RC5.3 es anterior a todas estas features); las transiciones
del wizard (R3) y la composición `appliesTo`+`dependsOn` (selects vinculados) solo se
habían probado con RTL mockeado. Esos eran los huecos reales, no los que ya cubrían R0-R4.

**2 specs Playwright nuevos**, corridos en real (no por inspección), cada uno una costura
distinta para que un fallo sea diagnosticable:
- `admin-categorias-tipo.spec.ts` — **costura D** (la más importante: UI admin real vs.
  backend). Un ADMIN configura por navegador una categoría `SERVICE_ONLY` con un atributo
  `appliesTo: ['SERVICE']` y un par vinculado Marca→Modelo (`dependsOn`/`optionsByParent`);
  se confirma por API que el backend persistió exactamente eso, y un `POST /listings`
  crudo construyendo un `PRODUCT` en esa categoría confirma el mismo límite con `422`
  (control positivo con `SERVICE` → `201`).
- `producto-servicio-flujo.spec.ts` — **costuras A, B, C, E, F**: `SERVICE_ONLY` sin
  preguntar tipo (A); herencia de política (R1) ejercida en flujo real, no solo en
  unit/API aislada (B); transición de tipo **y** de categoría a mitad del wizard, con
  aserción explícita de que el resultado final no arrastra ningún atributo del estado
  intermedio (C — el equivalente end-to-end del test unitario "excluye atributos del tipo
  apagado" de R3); `appliesTo`+`dependsOn` compuestos en el wizard real, con reactividad
  completa (deshabilitado→opciones→selección) (E); facetas por tipo (R4) + selects
  vinculados + Meilisearch juntos (F). Categorías de prueba creadas vía API admin directa
  (rápido; la UI admin ya la cubre el spec D).

**Hallazgo de factibilidad, no un hueco de R5**: `FACET_ATTRIBUTES` en
`search.service.ts` es una lista **curada a mano**, independiente del mecanismo dinámico
de R0 — un nombre de atributo nuevo (p. ej. uno inventado para un test) nunca aparece
como faceta aunque sea `filterable: true`, por diseño deliberado y preexistente. El spec F
usa `gearbox`/`fuel` (ya en esa lista, mismo patrón que `search-facets-by-type.e2e-spec.ts`)
en vez de nombres arbitrarios.

**Bug real encontrado por la costura C (no un ajuste de test)**:
`ListingsService.validateAttributes()`/`validateLinkedSelects()`, en `create()` y
`update()`, comprobaban `required`/vínculos contra el schema efectivo **sin filtrar por
tipo** — a diferencia del wizard, que sí filtra (`filterSchemaByType`) antes de decidir
qué es obligatorio y qué atributos enviar. Consecuencia real: cualquier categoría con un
atributo `required: true` restringido a un tipo (`appliesTo: ['SERVICE']`, por ejemplo)
rechazaba **siempre** con `422` los anuncios del tipo contrario, aunque el wizard
construyera el payload correctamente (nunca envía ese campo para el tipo que no aplica).
Nadie lo había detectado porque R1/R3 solo probaron esta combinación con RTL mockeado,
nunca contra un backend real de punta a punta — exactamente el tipo de hueco que R5 existe
para encontrar. **No es la deuda ya documentada de "validación débil"** (esa es sobre
aceptar de más; esta es rechazar de más).

Fix (aprobado tras reportar el hallazgo, antes de tocar nada): ambos métodos ahora
filtran el schema efectivo por el tipo del anuncio (`dto.type` en `create()`; el tipo ya
fijado — inmutable — en `update()`) antes de validar, igual que ya hacía el wizard.
Cambio acotado, mismo sitio que el guard de selects vinculados. Test de regresión
dedicado: `listing-attributes-applies-to.e2e-spec.ts` (5 tests: cada tipo omite
correctamente el `required` del tipo contrario, cada tipo sigue exigiendo el suyo propio,
y `update()` respeta el mismo filtro).

**Migración indolora — verificación**: los 2 specs Playwright corridos varias veces en
real (incluida una reinicialización de Docker Desktop a mitad de sesión) hasta 6/6 en
verde repetido; batería backend completa (39 suites, 615 tests: 610 + 5 del test de
regresión) en verde tras el fix, sin tocar ningún test existente.

**Cierra el cambio producto/servicio**: con R5, R0-R5 quedan cerradas. El cambio funciona
como un TODO coherente de punta a punta — las costuras entre ráfagas y la coherencia
backend/frontend confirmadas por flujos reales, no solo asumidas por baterías aisladas.

### Refuerzo de validación de atributos — cierra la deuda de "validación débil"

Cierra la deuda inventariada desde RÁFAGA 0 (ver «Validación débil de atributos» en §3):
`validateAttributes` solo comprobaba `required`; los selects planos, los tipos de dato y
las claves desconocidas no se validaban en absoluto. Medición previa a diseñar (mismo
principio que las medidas de empates de orden y anuncios huérfanos): **8 de 22 anuncios**
"sucios" en la BD de dev, **todos basura de prueba** en `brand`/Coches (0 tipos malos,
0 claves desconocidas) — refuerzo de bajo riesgo, sin volumen real que proteger, pero con
un vector de riesgo real: `EditarWizard` reenvía el bag de atributos completo en cada
guardado, así que validar de más rompería la edición de anuncios viejos sucios por campos
que el usuario ni toca.

**División de responsabilidades** (`ListingsService`):
- `validateRequired` — igual que la antigua `validateAttributes`, sin cambios de
  comportamiento (bag completo, tanto en `create()` como en `update()`).
- `validateAttributeValues` (nueva) — claves desconocidas → 422; select plano (sin
  `dependsOn`) con valor fuera de `options` → 422; `number`/`boolean` mal tipado → 422.
  Sobre el schema ya filtrado por tipo (`filterSchemaByType`, el fix de R5) — no
  reintroduce su bug. Cierra la asimetría con `validateLinkedSelects`: los selects
  **planos** ahora validan su valor con el mismo rigor que los **vinculados** desde R5.

**El DELTA — la pieza central de `update()`:** `computeAttributesDelta(existing, incoming)`
compara por `JSON.stringify` (primitivos planos, sin anidamiento — suficiente y cubre
null/undefined sin casos especiales); una clave reenviada con el mismo valor **no** es
delta. `create()` valida el bag completo (no hay "existing" con el que comparar);
`update()` valida `required` sobre el bag completo (sin cambios, invariante de
completitud del anuncio) pero acota `validateAttributeValues`/`validateLinkedSelects`
al delta — grandfathering **por construcción**, sin migrar los 8 sucios: se toleran
mientras no se edite el campo concreto que los ensucia.

**`validateLinkedSelects` extendido con `deltaKeys?: Set<string>`** — si ni el campo ni
su `dependsOn` cambiaron en esta petición, no se re-valida el par, aunque ya fuera
inválido. Ausente en `create()` (comportamiento intacto: valida siempre). **Esto arregla
un bug PRESENTE, no solo teórico**: tras poblar el catálogo real Marca/Modelo, el anuncio
"Cotce" (medido antes, `brand="Hyndai"` — inválido para el catálogo nuevo, `model="i20"`
ya no resoluble) habría devuelto 422 en **cualquier** edición suya (aunque fuera solo el
precio) sin este delta — el guard de vinculados de R5 nunca había sido delta-aware,
porque nunca se había probado contra un anuncio *existente* con datos ya inconsistentes.

**Verificación**: `listing-attributes-strict-validation.e2e-spec.ts` (15 tests nuevos) —
`create()` completo (positivo, select/number/boolean/clave-desconocida/required, y la
coherencia con R5: un select solo-PRODUCT ni se exige ni se valida en SERVICE), `update()`
delta en planos (reenvío idéntico + cambio de precio → 200, caso central) y en vinculados
(reproduce "Cotce" exacto: reenvío idéntico → 200; tocar el campo → si sigue inválido,
422). Batería completa: **630/630** (615 preexistentes + 15 nuevos), sin tocar ninguno
existente.

**Deuda relacionada, no resuelta aquí** (registrada en §3): la colisión Redis dev/test
(ya inventariada en Hito 7) se manifestó de forma concreta durante la verificación de
esta ráfaga — un backend de dev vivo en el puerto 3001 competía por la cola BullMQ
`bull:indexing` con la suite de test, robándole jobs de indexado y produciendo falsos
negativos de Meilisearch ajenos a este cambio. Y un hallazgo nuevo: el teardown de los
tests e2e deja handles asíncronos abiertos (Jest fuerza el `exit`); inofensivo hoy, pero
podría colgar un runner de CI que no fuerce salida.

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

Timeout 3 000 ms vía `AbortSignal.timeout()`. Si la query con CP devuelve vacío,
reintenta sin CP (CP incorrecto → Nominatim no encuentra el municipio aunque exista).
Cualquier error devuelve `null` sin lanzar excepción.
**Activar MapTiler en producción:** solo `GEOCODING_PROVIDER=maptiler` + `MAPTILER_API_KEY` en el entorno. Cero cambios de código, la implementación ya existe.

### Geocoding asíncrono y FIFO BullMQ (H6 — cambio de arquitectura)

Antes de H6, `createListing` llamaba al geocoding de forma **síncrona** (esperaba la respuesta de Nominatim antes de responder). En CI, el runner de GitHub Actions no tiene acceso a Nominatim → el geocoding fallaba → el anuncio se publicaba sin `_geo` → no aparecía en el mapa. En producción, un servicio externo (1 req/s) bloqueaba la petición HTTP del wizard.

**Cambio**: `createListing` ya no espera al geocoding. Guarda el anuncio con `latitude/longitude = null`, responde inmediatamente (el wizard redirige a la ficha), y encola **dos jobs BullMQ en FIFO** dentro del mismo worker:

1. `geocode` — llama a Nominatim/MapTiler, escribe `latitude`/`longitude` en Postgres. **No toca Meilisearch.**
2. `index` — lee el anuncio actualizado de Postgres (ya con `lat/lng`) y escribe UNA sola vez en Meilisearch con `_geo` presente.

Al **editar** con cambio de ubicación: mismo orden `[geocode, index]` (antes era `[index, geocode]` → el index se ejecutaba sin las coordenadas nuevas). La corrección también eliminó una segunda escritura doble: `handleGeocode` ya no llama inline a `handleIndex`; el job `index` en cola es la única escritura a Meili.

**Consecuencia para el usuario**: un anuncio recién publicado puede tardar unos segundos (duración del job BullMQ) en tener coordenadas y aparecer en el mapa. Aceptable: es el mismo comportamiento que cualquier indexación asíncrona.

**Logs de diagnóstico**: el `IndexingProcessor` emite líneas `[TIMING] index/geocode start/done listingId=... queueWait=...ms` para detectar cuellos de botella futuros.

**Resuelto en Hito 9** (ver «Reintentos del job `geocode`» más abajo): el job SÍ tenía `attempts`/backoff configurados a nivel de cola — lo que faltaba era que `GeocodingService.geocode()` dejara de tragarse los fallos transitorios como `null`.

### `waitForTask()` en `indexListing`: indexación determinista (H6 — fix raíz del flaky de CI)

`SearchService.indexListing()` llama a `this.index.addDocuments([doc])`, que devuelve una `Task` de Meilisearch. Hasta H6, el job BullMQ completaba cuando Meilisearch **recibía** la petición; el documento no era necesariamente **consultable** aún (Meilisearch procesa la task de forma interna de manera asíncrona).

Resultado: el job `index` completaba, el test continuaba, pero `GET /search` devolvía el índice sin el documento. El flaky dependía del timing del worker de Meilisearch — reproducible principalmente en CI (recursos limitados).

**Fix**: `indexListing()` añade `await this.meili.client.waitForTask(task.taskUid)` tras `addDocuments`. El job BullMQ no completa hasta que Meilisearch confirma que el documento es consultable. Determinista por construcción — sin depender de timeouts arbitrarios.

Este era el bug raíz del flaky de `listing-card-attrs.spec.ts` arrastrado desde RC5.5 (aunque con múltiples capas encima que lo hacían difícil de aislar — ver §Lecciones de método del CI).

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

Las **20 suites e2e de Jest** suman **319 casos**: smoke (1), auth (15), listings (10),
messaging (7), search (8), favorites (12), reviews (20), moderation (23), admin (37),
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
**Cierre Fase 5.2 (ráfaga de integridad)** añadió 3 casos a `admin.e2e-spec.ts` (34→37: categoría con anuncio DRAFT no-ACTIVE → 400 en vez de 500, `attribute-usage` count correcto por key, `attribute-usage` 404 si la categoría no existe) y el primer suite de **tests unitarios de componente** del proyecto —
`AttributeSchemaEditor.test.tsx` (Jest + Testing Library sobre jsdom, 5 casos) — que no cuenta dentro de las 20 suites e2e de Jest (corre con `pnpm --filter @marketplace/web test:unit`, wired en CI como paso propio, separado de Playwright).
**34/34 Playwright** (flujo-critico: 1, planes+suscripción: 8, mis-creditos: 9, admin-categorias: 7, wizard-herencia: 5, listing-card-attrs: 4).
**Fase 5.2 — Categorías con atributos y herencia: COMPLETA.** RC5.1 (diseño y contratos de API), RC5.2 (backend: herencia, cardAttributeKeys, validación max-2, deuda itemType/size), RC5.2b (seed Vehículos reorganizado), RC5.3 (editor visual de atributos), RC5.4 (herencia en wizard verificada), RC5.5 (ListingCard con cardAttributes en las 6 vistas), **cierre (ráfaga de integridad): FIX 1 (500→400 legible al borrar categoría con anuncios no-ACTIVE), FIX 2 (aviso al renombrar atributo con datos), mapa de integridad completo documentado** — todas completadas y verificadas.
**RL5.1-B** añadió `municipio-autocomplete.spec.ts` (4 casos Playwright) y actualizó `flujo-critico.spec.ts` (paso Ubicación usa el combobox): filtrado normalizado "sant boi" → "Sant Boi de Llobregat" + provincia "Barcelona"; fallback texto libre para localidades fuera del dataset (aldeas, urbanizaciones); wizard avanza en ambas vías; PerfilForm city autocomplete rellena province al seleccionar. **38/38 Playwright esperados** (flujo-critico: 1, planes+suscripción: 8, mis-creditos: 9, admin-categorias: 7, wizard-herencia: 5, listing-card-attrs: 4, municipio-autocomplete: 4).
**RL5.1-B — Autocompletado de municipios (Fase 5.3): COMPLETO.** Dataset INE (8 132 municipios, 52 provincias, 372 KB), licencia Ley 37/2007; generado por `apps/web/scripts/generate-municipios.mjs` (parseCSV con campos entre comillas, reparación mojibake doble-UTF-8, normalización "Coruña, A" → "A Coruña"); `MunicipioAutocomplete` combobox accesible (`role=combobox/listbox/option`, `aria-activedescendant`, teclado completo), ordenación startsWith-primero + longitud-tiebreak (Madrid antes que Humanes de Madrid); lazy-load del JSON al escribir; CP no auto-rellenado; province editable y auto-rellenada al seleccionar; integrado en wizard `StepUbicacion` y `PerfilForm`.
**RL5.1-A — Prefill perfil→wizard (Fase 5.3): COMPLETO.** `publicar/page.tsx` llama a `getMe()` en paralelo con `getCategories()` (Promise.all); pasa `initialLocation` a `PublicarWizard`; wizard inicializa `useState` con los valores del perfil como sugerencia editable. Si el perfil tiene la ubicación vacía el wizard arranca vacío. El `EditarWizard` no se toca — sigue usando los datos del anuncio. `seed-playwright.ts` resetea la ubicación del seller en cada ejecución de CI. 3 tests Playwright nuevos: usuario sin ubicación → vacío; usuario con ubicación → prefill + editable; editar anuncio → muestra ubicación del anuncio (Madrid), no del perfil (Sabadell). **41/41 Playwright esperados** (flujo-critico: 1, planes+suscripción: 8, mis-creditos: 9, admin-categorias: 7, wizard-herencia: 5, listing-card-attrs: 4, municipio-autocomplete: 4, prefill-ubicacion: 3). Pendiente: RL5.1-C (avatar upload UI).
**RL5.1-C** añadió `avatar-upload.spec.ts` (2 casos Playwright): **43/43 Playwright**.
**H6.2** añadió `categoria-meili.spec.ts` (4 casos Playwright): búsqueda Meilisearch en /[categoria] con filtros de atributos, fallback Postgres, badge `boostScore`, cardAttributes visibles.
**H6.5 (a+b+c)** añadió `busqueda-mapa.spec.ts` (13 casos Playwright: 5 H6.5a — toggle lista/mapa, SSR, FilterPanel, filtro preservado; 4 H6.5b — panel de detalle antes de click, avisos cap/missing-geo, href de lista; 4 H6.5c — tarjeta flotante antes de click, panel antes de click, filtro de categoría sin romper, verificación estructura sin errores JS). **60/60 Playwright totales** (flujo-critico: 1, planes+suscripción: 8, mis-creditos: 9, admin-categorias: 7, wizard-herencia: 5, listing-card-attrs: 4, municipio-autocomplete: 4, prefill-ubicacion: 3, avatar-upload: 2, categoria-meili: 4, busqueda-mapa: 13).
**`listing-card-attrs.spec.ts`** (4 casos, contados desde RC5.5): timeouts pasivos `toBeVisible(25s)` reemplazados por el helper `waitForCard` (polling activo). Este cambio es la resolución final del flaky de indexación arrastrado desde RC5.5 — ver §Lecciones de método del CI más abajo.
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

**`waitForCard` — helper de espera determinista de indexación (H6, `e2e/helpers/wait-for-card.ts`):** reemplaza los `toBeVisible(Ns)` pasivos que esperaban a Meilisearch con un timeout arbitrario. El helper recarga la URL cada 1,5 s hasta que el `<a>` del anuncio (por título) es visible, o lanza un error descriptivo tras 45 s. Reutilizable en cualquier test que espere indexación async. Logs: `[waitForCard] found after N reload(s): "..."`. **Regla**: cualquier test futuro que publique un anuncio y luego busque su aparición en Meili debe usar `waitForCard`, no timeouts pasivos.

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

**`REVALIDATE_SECRET` (añadido tras BLOG-FOOTER-COLUMNAS):** faltaba por completo del
`env:` del job `e2e` — no estaba en ningún step, ni como `secrets.*`, ni generado por
ningún paso. Como `.env`/`.env.test`/`.env.local` están en `.gitignore`, CI nunca lo
había tenido en ningún lado. Efecto: `BlogService.callRevalidateEndpoint()` corta con
`if (!secret) return` antes de llamar a `/api/revalidate`, así que
`revalidateTag('footer-pages')` nunca se disparaba en CI — el footer servía la caché
`unstable_cache` vieja hasta expirar el TTL (1h), muy por encima de lo que esperan los
tests. Esto rompía los 6 tests de `footer-paginas.spec.ts` de forma **consistente**
(no flaky) en los 5 CI corridos tras esa ráfaga, mientras pasaban siempre en local
(donde `.env.test`/`.env.local` sí tienen el valor, gitignorados). Fix: añadido
`REVALIDATE_SECRET: change_me_same_as_web` al `env:` de job — valor de test, igual
tratamiento que `JWT_SECRET`, sin necesidad de GitHub Secrets. Ya estaba documentado
en ambos `.env.example` desde BLOG-FOOTER-DINAMICO; solo faltaba en `ci.yml`.

**`test:e2e` sin aislamiento de paralelismo — mitigado, no resuelto:** el script
`apps/api/package.json#test:e2e` corría `jest --config ./test/jest-e2e.json` **sin**
`--runInBand`, así que en CI Jest lanzaba varios workers en paralelo sobre la misma
`marketplace_test` compartida. Varias suites hacen `TRUNCATE`/`cleanDb()` en su propio
`beforeAll` — con workers concurrentes pisándose sobre la misma BD, eso produce FK
violations, deadlocks y aserciones 401/404 espurias. Este gap llevaba oculto porque
las pasadas locales de verificación siempre se lanzaban a mano con `--runInBand`
explícito (nunca se usó el script `test:e2e` tal cual para esas comprobaciones);
CI sí ejecutaba el script canónico, sin la flag. **Fix aplicado:** `--runInBand`
añadido al script — determinista, pero el backend e2e ahora corre más lento (serie en
vez de paralelo). **Esto es una mitigación, no la cura real:** el problema de fondo
(suites sin aislamiento de base de datos entre sí) sigue existiendo; la solución
correcta — una BD o schema por worker (p. ej. vía `JEST_WORKER_ID` en el nombre de la
BD/schema) — queda pendiente para el **Hito 9**.

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

**Frontend — middleware.ts:** `ROLE_ALLOWED_PATHS` (mapa `role → path[]`) controla
qué rutas `/admin/*` puede visitar cada rol acotado. El ADMIN tiene acceso total.
Cualquier rol no listado en el mapa es redirigido a `/`. (Generalizado desde la
constante `MODERATOR_ALLOWED_PATHS` original al añadir el rol EDITOR — ver
«Rol EDITOR — blog» más abajo.)

```typescript
// Actualizado en BLOG-PAGINAS: ambos roles ganan /admin/paginas junto a /admin/blog.
const ROLE_ALLOWED_PATHS: Record<string, string[]> = {
  MODERATOR: ['/admin/reportes', '/admin/anuncios', '/admin/usuarios', '/admin/blog', '/admin/paginas'],
  EDITOR: ['/admin/blog', '/admin/paginas'],
};
```

**Frontend — AdminNav:** el array `NAV_ITEMS` tiene un campo `roles: string[]` por
ítem. El MODERATOR ve 5 ítems (Anuncios, Usuarios, Reportes, Blog, Páginas); el ADMIN
ve los 11; el EDITOR ve 2 (Blog, Páginas).

**Frontend — Botones ADMIN-only ocultos al MODERATOR:**
- `/admin/usuarios`: "Banear" y "Desbanear" solo visibles con `role === 'ADMIN'`.
  El MODERATOR ve "Suspender" y "Reactivar" (suspend/unsuspend). Nunca ve "Banear".
- `/admin/blog`: "Eliminar" solo visible con `role === 'ADMIN'` (también oculto para EDITOR).

**Tabla rol × acción (MODERATOR/ADMIN de RR5.1-ext; columna EDITOR añadida en la
ráfaga "Rol EDITOR — blog"; filas de páginas informativas añadidas en
"Páginas informativas (BLOG-PAGINAS)", ver más abajo):**

| Sección / Acción | MODERATOR | EDITOR | ADMIN |
|---|---|---|---|
| Dashboard / Stats | ❌ | ❌ | ✅ |
| Reportes (listar, start-review, resolve, dismiss, crear) | ✅ | ❌ | ✅ |
| Moderación de anuncios (approve, reject, deactivate, restore) | ✅ | ❌ | ✅ |
| Gestión anuncios: listar, ver, cambiar estado | ✅ | ❌ | ✅ |
| Gestión usuarios: listar, ver | ✅ | ❌ | ✅ |
| Gestión usuarios: **suspender** (`/suspend`) | ✅ | ❌ | ✅ |
| Gestión usuarios: **reactivar suspensión** (`/unsuspend`) | ✅ | ❌ | ✅ |
| Gestión usuarios: **banear** (`/ban`) | ❌ | ❌ | ✅ |
| Gestión usuarios: **desbanear** (`/reinstate`) | ❌ | ❌ | ✅ |
| Gestión usuarios: **cambiar rol** (`/role`) | ❌ **innegociable** | ❌ | ✅ |
| Categorías | ❌ | ❌ | ✅ |
| Settings | ❌ | ❌ | ✅ |
| Facturación / Créditos | ❌ | ❌ | ✅ |
| Campañas / Cupones / Banners | ❌ | ❌ | ✅ |
| Blog: listar, ver, crear, editar, publicar, despublicar | ✅ | ✅ | ✅ |
| Blog: **eliminar** (`DELETE`, borrado físico) | ❌ | ❌ | ✅ |
| Páginas informativas: listar, ver, crear, editar, publicar, despublicar | ✅ | ✅ | ✅ |
| Páginas informativas: **eliminar** (`DELETE`, borrado físico) | ❌ | ❌ | ✅ |
| Subir imágenes (`POST /media/upload`) | ✅ (cualquier autenticado) | ✅ (cualquier autenticado) | ✅ |

**✅ RESUELTO (RÁFAGA 3, ver «Paquete de seguridad de auth» más abajo) — sesión stale tras
cambio de rol:** antes, si un ADMIN degradaba a MODERATOR a otro usuario, el JWT de ese usuario
permanecía válido con el rol viejo hasta su expiración (7 días) — el middleware Next.js leía el rol
del JWT (stale), no de la DB. Cerrado leyendo `role`/`emailVerified` frescos de la BD en
`JwtStrategy.validate()` (que ya consultaba la BD para `status`/`tokenVersion`, coste cero) en vez
de confiarlos al payload firmado — un cambio de rol tiene efecto en la siguiente request del
backend. **Nota:** el middleware de Next.js sigue confiando en el rol de la cookie de NextAuth
(hasta 7 días, tras alinear su `maxAge` en la misma ráfaga) para decidir qué ve el usuario en el
navegador — el backend (RolesGuard) es la barrera real y ya es fresca; el frontend puede mostrar
temporalmente una UI stale hasta el siguiente login, pero nunca una acción que el backend permita
de más.

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

### Rol EDITOR — blog (BLOG-EDITOR)

Nuevo rol acotado exclusivamente a la gestión del blog (contenido reversible:
crear/editar/publicar/despublicar), pensado para extenderse a "contenido editorial"
en general cuando existan páginas informativas. **No** tiene acceso a usuarios,
facturación, categorías, ajustes, moderación/reportes, campañas, cupones ni banners
— nada de dinero ni de gestión de plataforma. Mismo patrón asimétrico que MODERATOR
en blog: gestiona todo lo reversible, nunca el borrado físico (`DELETE`), que sigue
siendo ADMIN-only.

**Schema:** `enum Role { USER MODERATOR ADMIN EDITOR }` — migración
`20260706124203_add_editor_role` (`ALTER TYPE "Role" ADD VALUE 'EDITOR'`, sin
backfill de datos).

**Backend — `BlogAdminController`:** se añadió `Role.EDITOR` a los `@Roles()` de
método en `findAll`, `findById`, `create`, `update`, `publish` y `unpublish` (ahora
`@Roles(EDITOR, MODERATOR, ADMIN)`). `remove` (`DELETE`, borrado físico) no se tocó
— sigue heredando `@Roles(ADMIN)` de la clase. Ningún otro controller de `/admin/*`
ni `/moderation/*` cambia: al ser `RolesGuard` una lista blanca
(`required.includes(user.role)`), EDITOR queda excluido de todo lo demás por
defecto, sin necesidad de excluirlo activamente en cada controller.

**Backend — asignación del rol:** `ChangeUserRoleDto` pasa de
`@IsIn([USER, MODERATOR])` a `@IsIn([USER, MODERATOR, EDITOR])`. El guard de
servicio (`AdminService.changeUserRole()`, que bloquea target/value `ADMIN`) no
cambia — EDITOR cae en el mismo "bucket seguro" que MODERATOR. Sigue siendo
ADMIN-only quién puede cambiar el rol de otro usuario (`@Roles(ADMIN)` de clase en
`AdminController`, sin override de método).

**Frontend — middleware.ts:** la constante `MODERATOR_ALLOWED_PATHS` se generalizó
a `ROLE_ALLOWED_PATHS` (mapa `role → path[]`, ver snippet en la sección RR5.1
anterior) para añadir `EDITOR: ['/admin/blog']` sin duplicar la rama condicional por
rol. MODERATOR conserva exactamente sus paths previos (ni gana ni pierde acceso).

**Frontend — AdminNav:** el ítem `/admin/blog` pasa de `roles: ['ADMIN', 'MODERATOR']`
a `roles: ['ADMIN', 'MODERATOR', 'EDITOR']`. Ningún otro ítem cambia — un EDITOR ve
un único ítem en el nav (Blog).

**Frontend — `/admin/usuarios`:** `ROLE_FILTERS` y `ROLE_LABELS` incluyen la opción
"Editor" para filtrar/mostrar usuarios con ese rol. En la ráfaga BLOG-ADMIN-ROLE-UI
(ver más abajo) se cerró el gap de que no existía un control de asignación de rol
en la UI — ahora sí lo hay.

**Media:** `POST /media/upload` no tiene `RolesGuard` (solo `JwtAuthGuard`) — ya
estaba abierto a cualquier usuario autenticado antes de este cambio, así que EDITOR
puede subir imágenes de portada sin tocar el controller.

**Tests (BLOG-EDITOR):**
- `editor-role.e2e-spec.ts` (backend, 55 casos): matriz negativa completa (403 en
  cada endpoint de usuarios, listings, categorías, settings, billing, banners,
  cupones, campañas y moderación/reportes, incluyendo `POST /moderation/reports`
  que sí acepta USER/MODERATOR/ADMIN pero no EDITOR, y `DELETE /admin/blog/:id`);
  matriz positiva (crear/listar/ver/editar/publicar/despublicar post + subir imagen,
  todo 2xx); asignación de rol EDITOR por ADMIN (200) y bloqueo de auto-asignación
  por el propio EDITOR (403).
- `admin-roles.spec.ts` (Playwright, +12 tests): EDITOR carga `/admin/blog` y
  `/admin/blog/nuevo`; redirigido desde `/admin` y de los 8 paths no-blog
  (`usuarios, facturacion, categorias, reportes, cupones, banners, ajustes,
  anuncios`); nav muestra exactamente 1 ítem (Blog); botón "Eliminar" no visible.
- `seed-playwright.ts` / `global-setup.ts` / `fixtures/auth.ts`: usuario
  `editor-e2e@example.com` (EDITOR) con `storageState` y fixture `editorContext`.

### UI de asignación de roles en /admin/usuarios (BLOG-ADMIN-ROLE-UI)

Cierra el gap pre-existente detectado durante la ráfaga EDITOR: `PATCH
/admin/users/:id/role` existía en el backend (con DTO ya validado para
USER/MODERATOR/EDITOR) pero no estaba conectado a ningún control en el frontend —
la asignación de rol solo era posible por API directa. Con esta ráfaga, **EDITOR
(y cualquier rol no-ADMIN) es asignable desde el backoffice**, no solo por API.

**Frontend — `lib/api/admin.ts`:** nueva función `changeUserRole(token, id, role)`
→ `PATCH /admin/users/:id/role`.

**Frontend — `/admin/usuarios`:** en la celda de rol de cada fila, un `<select>`
nativo con las opciones `USER | MODERATOR | EDITOR` (ADMIN nunca se ofrece como
valor — coherente con que el DTO/service ya lo rechazan). El `<select>` **no se
muestra** en absoluto para:
- filas con `user.role === 'ADMIN'` (el service ya bloquea `target === ADMIN`;
  la UI no ofrece un control que siempre fallaría, y de paso impide que un ADMIN
  se degrade a sí mismo desde su propia fila — no hace falta lógica extra: su
  propia fila también tiene `role === 'ADMIN'`).
- si el usuario que mira la página no es ADMIN — **corrección relevante:**
  `/admin/usuarios` NO es ADMIN-only (MODERATOR ya tiene acceso a esa ruta desde
  RR5.1-ext, vía `ROLE_ALLOWED_PATHS`), así que el gate correcto es
  `currentUserIsAdmin`, no "solo ADMIN llega a esta página". Sin este gate un
  MODERATOR vería un selector que siempre devuelve 403 al usarlo.

El cambio reutiliza `handleAction()` (mismo patrón que suspend/ban/trusted): marca
`pendingId` (deshabilita el `<select>` durante la petición), hace refetch de la
lista al éxito (el `<select>` refleja el nuevo rol porque es un componente
controlado ligado a `user.role`), y muestra `alert(mensaje)` legible del backend
en caso de error — mismo patrón de error que el resto de acciones de esta página,
no uno nuevo.

**Tests:**
- `admin-roles.spec.ts` (Playwright, +2 tests): ciclo completo USER→EDITOR→
  MODERATOR→USER sobre un usuario dedicado (`role-target-e2e@example.com`,
  reseteado a USER en cada seed) — cada cambio se verifica tanto en el `<select>`
  del backoffice como en el acceso real tras un **re-login** del usuario afectado
  (nueva sesión con el rol ya reflejado en el JWT); y confirmación de que el
  `<select>` no existe para la fila de `admin-e2e@example.com` (ADMIN).
- Backend: sin tests nuevos — ya cubierto por `editor-role.e2e-spec.ts`
  (`role: EDITOR` → 200) y `admin.e2e-spec.ts` (`role: ADMIN` → 400 por DTO,
  `target` ADMIN → 403 por service).

**Verificación manual:** ciclo completo confirmado a mano además del test
automatizado — un usuario ascendido a EDITOR por la UI, tras re-login, entra a
`/admin/blog` y a ningún otro `/admin/*`; el mismo patrón se confirmó para
MODERATOR y la vuelta a USER.

### Editor de markdown en PostForm (`@uiw/react-md-editor`)

El `<textarea>` plano de `body` en `PostForm.tsx` se reemplazó por un editor
estilo GitHub (toolbar de atajos de sintaxis + preview, NO WYSIWYG con
contentEditable real) — el buffer sigue siendo el mismo string markdown de
siempre, sin capa de conversión HTML↔Markdown ni cambio en el almacenamiento ni
en el payload de `createAdminPost`/`updateAdminPost` (`body` sigue siendo un
`string` plano). Ningún post existente necesitó migración.

**Librería:** `@uiw/react-md-editor@4.1.1` (`peerDependencies: react/react-dom
>=16.8.0` — compatible con React 19, verificado en el registro de npm antes de
instalar, per Paso 0 innegociable de esta ráfaga).

**SECURITY — hallazgo crítico durante la integración:** el modo de preview
integrado de esta librería (`preview="live"` / `"preview"`, vía
`@uiw/react-markdown-preview`) incluye **`rehype-raw` de forma incondicional**
en su pipeline interno (confirmado leyendo el JS compilado del paquete) — no
hay ninguna prop pública para quitarlo, solo para añadir plugins después de él.
Si se hubiera habilitado ese modo, un `<script>` escrito en el editor se
parsearía como HTML real dentro del propio preview del admin, reabriendo
exactamente el vector que la regla invariante del blog mantiene cerrado (ver
`/blog/[slug]`: react-markdown + remark-gfm + rehype-sanitize, SIN rehype-raw).
Por eso `MarkdownEditor.tsx`:
1. Fija `preview="edit"` **siempre** — en ese modo el componente de preview de
   `@uiw/react-markdown-preview` no llega a montarse en absoluto (confirmado
   leyendo `Editor.factory.js`: el pane de preview solo se renderiza cuando
   `state.preview` matchea `/(live|preview)/`).
2. Quita del toolbar los 3 comandos que cambian de modo en caliente
   (`codeEdit`/`codeLive`/`codePreview`, los tres comparten
   `keyCommand: 'preview'`) vía `commandsFilter` — sin esto, el propio usuario
   podría reactivar el modo peligroso con un clic o un atajo de teclado
   (`ctrl+9` para preview), sin pasar por la prop `preview`.

El preview renderizado real sigue siendo el toggle "Ver preview" que ya existía
en `PostForm.tsx` (sin cambios) — usa su propia instancia de `react-markdown` +
`remark-gfm` + `rehype-sanitize`, la misma tubería que `/blog/[slug]`, no la de
esta librería. Se mantiene porque con un editor de sintaxis (no WYSIWYG real)
el preview renderizado sigue aportando valor.

**Integración:** `MarkdownEditor.tsx` (lógica real) + `MarkdownEditorClient.tsx`
(wrapper `'use client'` con `dynamic(..., { ssr: false })`) — mismo patrón que
`MapViewClient.tsx`/`MapView.tsx`. Componente controlado: `value`/`onChange`
con el mismo contrato que el resto de `PostForm`.

**Imágenes:** el comando "insertar imagen" del toolbar se sobrescribe vía
`commandsFilter` (mismo icono/atajo, nuevo `execute`) para abrir un selector de
archivo y subir con `uploadMedia()` (el mismo cliente que ya usa la portada) en
vez de insertar un placeholder `![]()` vacío; al resolver, inserta
`![nombre](url)` en el cursor vía `TextAreaTextApi.replaceSelection()`.

**Tests:** `blog-markdown-editor.spec.ts` (Playwright, 2 casos) — ciclo completo
crear/guardar/publicar con formato variado (títulos, negrita, cursiva, lista,
cita, enlace) y verificación de que `/blog/[slug]` renderiza exactamente lo
mismo; y un caso dedicado de `<script>` literal que confirma que nunca se
ejecuta, ni en el preview del admin ni en la página pública. Backend sin
cambios — `body` sigue siendo un string plano, sin tocar DTOs ni el módulo
`blog`.

### Páginas informativas (BLOG-PAGINAS) — cierra el bloque de blog

Tercera y última feature del bloque de blog: contenido estático institucional
(términos, privacidad, manual...) reutilizando el mismo modelo, editor,
renderizado seguro y rol EDITOR que los posts. El riesgo central era una fuga —
una PAGE apareciendo en el feed/detalle de blog, o un POST sirviéndose desde
`/paginas/`.

**Schema:** `Post` gana `type: PostType @default(POST)` (`enum PostType { POST
PAGE }`, migración `20260706160322_add_post_type`, sin backfill — el default
cubre todas las filas existentes). `slug` sigue `@unique` global (un post y una
página no pueden compartir slug). Índice `@@index([status, publishedAt])` →
`@@index([type, status, publishedAt])`. **`type` es inmutable tras crear** —
`UpdatePostDto` no tiene ese campo; con `ValidationPipe({ forbidNonWhitelisted:
true })` global, un intento de `PATCH .../role` con `type` en el body → 400, no
se ignora silenciosamente.

**Backend — inventario completo de filtros `type` (verificado exhaustivo: todo
`prisma.post.*` del backend vive en `blog.service.ts`):**
- `listPublished`/`findBySlug` (`GET /blog`, `GET /blog/:slug`, **incluye** el
  filtro `?tag=` porque comparte la misma query que el feed) — ahora fuerzan
  `type: POST`.
- `listPublishedPages`/`findPageBySlug` (nuevos, usados por `PagesController`)
  — fuerzan `type: PAGE`. Los cuatro métodos públicos son wrappers finos sobre
  dos métodos privados (`listPublishedByType`/`findByTypeAndSlug`) — una sola
  implementación de "cómo consultar Post de forma segura", no dos copias que
  puedan divergir.
- `adminFindAll` (`GET /admin/blog`) — filtro `type` opcional en
  `ListAdminPostsDto` (`?type=PAGE` para `/admin/paginas`, sin `type` o
  `type=POST` para `/admin/blog`).
- `adminCreate` — `CreatePostDto.type` opcional, default `PostType.POST` en el
  service (los callers de "crear post" existentes no cambian).
- **Acoplamiento de revalidación ISR (encontrado durante la implementación, no
  parte del schema en sí):** `adminUpdate`/`adminPublish`/`adminUnpublish`/
  `adminDelete` llamaban a `revalidate()` con `/blog` y `/blog/${slug}`
  hardcodeados. Ahora ramifican por `post.type` vía el helper
  `revalidatePostPaths()`: `PAGE` revalida solo `/paginas/${slug}` (sin feed que
  revalidar); `POST` conserva el comportamiento original.

**Endpoints públicos — `PagesController`** (`@Controller('paginas')`, sin
guards, mismo patrón que `BlogController`, inyecta el mismo `BlogService`):
`GET /paginas/:slug` (404 si no existe, no `PUBLISHED`, o no `type=PAGE`);
`GET /paginas` (fino, solo lo consume el sitemap — no hay listado de páginas en
la UI, se enlazan manualmente).

**Frontend — `/paginas/[slug]`:** carpeta de ruta separada de `/blog/[slug]`,
pero ambas usan el mismo componente compartido `<MarkdownBody>`
(`apps/web/src/components/blog/MarkdownBody.tsx` — `react-markdown` +
`remark-gfm` + `rehype-sanitize`, sin `rehype-raw`) — un único sitio del
frontend que renderiza Markdown no confiable, usado también por el preview de
`PostForm`. Presentación de página, no de artículo: solo título + contenido,
sin fecha/autor/tags/anterior-siguiente. `generateMetadata`: `og:type:
'website'` (no `'article'`), sin `publishedTime`/`authors`. JSON-LD `WebPage`
(no `BlogPosting`), URL `/paginas/{slug}`.

**Frontend — admin `/admin/paginas`:** reutiliza `PostForm` con la nueva prop
`showTagsField={false}` (tags no aplica a páginas). Listado llama
`getAdminPosts(token, { type: 'PAGE' })`. Crear desde `/admin/paginas/nueva`
envía `type: 'PAGE'` explícito; crear desde `/admin/blog/nuevo` no envía `type`
en absoluto (default `POST`). `AdminNav` gana el ítem "Páginas"
(`roles: ['ADMIN', 'MODERATOR', 'EDITOR']`, igual que Blog); middleware añade
`/admin/paginas` a `ROLE_ALLOWED_PATHS` de MODERATOR y EDITOR.

**Footer:** en esta ráfaga eran enlaces manuales estáticos a `/paginas/terminos`
y `/paginas/privacidad`. **Actualizado en BLOG-FOOTER-DINAMICO** (ver más abajo)
— ya no existen, sustituidos por un bloque dinámico leído de la BD.

**Sitemap:** `getPostList` (ya filtrado a `type=POST` backend-side, sin cambio
en esa llamada) + nuevo `getPageList` (`GET /paginas`) en paralelo, mapeado a
`/paginas/{slug}`.

**Tests:**
- `pages.e2e-spec.ts` (backend, 16 casos): matriz no-fuga completa (PAGE
  publicada ausente del feed, de `/blog/:slug`, y del filtro `?tag=` — incluso
  con un tag asignado directamente a la PAGE vía Prisma para probar que ni así
  se cuela; un POST ausente de `/paginas/:slug`); positivo end-to-end (EDITOR
  crea/edita/publica una página, se sirve en público); migración (un `Post`
  creado sin `type` explícito cae en `POST` por el default del schema y sigue
  en el feed); inmutabilidad (`PATCH` con `type` → 400); permisos (EDITOR
  gestiona páginas, `DELETE` → 403 para EDITOR, 204 para ADMIN).
- `paginas.spec.ts` (Playwright, 4 casos): ciclo completo ADMIN
  crear→publicar→ver en público con presentación de página correcta y ausencia
  en el feed del blog; `<script>` literal nunca se ejecuta; EDITOR ve el nav,
  puede crear una página, no ve "Eliminar" en el listado. (El caso de "footer
  enlaza correctamente" que existía aquí se retiró en BLOG-FOOTER-DINAMICO —
  probaba los enlaces hardcodeados que esa ráfaga eliminó; su sucesor vive en
  `footer-paginas.spec.ts`.)
- `admin-roles.spec.ts`: contadores de `AdminNav` actualizados (ADMIN 11,
  MODERATOR 5, EDITOR 2) + nuevas comprobaciones de acceso a `/admin/paginas`
  para MODERATOR y EDITOR.

### Footer semi-dinámico + slug inmutable para páginas (BLOG-FOOTER-DINAMICO)

Hace robustos los enlaces legales del footer: antes eran `<Link>` hardcodeados
sin garantía de que la página existiera/estuviera publicada (un enlace roto a
"Términos" es un problema de cumplimiento, no solo estético), y una página
nueva quedaba huérfana si no se recordaba añadir su enlace a mano. Ahora el
footer lee de la BD — fuente única — pero **cacheado agresivamente, nunca una
query por request** (el footer está en todas las páginas públicas).

**Schema:** `Post.showInFooter Boolean @default(false)`, `Post.footerOrder
Int?` (migración `20260706182850_add_post_footer_fields`, sin backfill).
Semánticamente solo aplican a `PAGE` — validado en el **servicio**, no en el
schema ni el DTO (ver más abajo por qué). Índice
`@@index([type, status, showInFooter])` — barato, no load-bearing (la query
está cacheada, casi nunca corre de verdad).

**Slug inmutable mientras una PAGE está `PUBLISHED`:** protege URLs legales ya
enlazadas externamente (footer, emails). Check en runtime dentro de
`adminUpdate` (no una regla de DTO — depende del **estado actual de la fila**,
no de la forma del payload):
```typescript
if (post.type === PostType.PAGE && wasPublished && dto.slug !== undefined && dto.slug !== post.slug) {
  throw new BadRequestException({ message: '...', code: 'SLUG_IMMUTABLE' });
}
```
Un `POST` puede cambiar de slug publicado o no (sin cambio de comportamiento);
una `PAGE` en `DRAFT` también (nadie la ha enlazado aún) — congelado solo
mientras `PUBLISHED`. Despublicar → cambiar slug → republicar sigue siendo
posible (despublicar es una acción deliberada que asume ese riesgo).

**Cacheo del footer — el punto crítico:** `Footer.tsx` (Server Component,
vive en `(public)/layout.tsx`, compartido por rutas con dinamismo muy distinto:
`/blog` es ISR a 3600s, `/busqueda` es esencialmente dinámica por
`searchParams`) **no** reutiliza el `revalidate` de ninguna página — lo haría
depender del modo de renderizado de rutas ajenas al footer. En su lugar,
`getCachedFooterPages` (`apps/web/src/lib/api/blog.ts`) usa `unstable_cache`,
que cachea la *función de datos* en sí, desacoplada por completo de qué tan
dinámica sea la página que la invoca:
```typescript
export const getCachedFooterPages = unstable_cache(
  () => getFooterPages(), ['footer-pages'], { revalidate: 3600, tags: ['footer-pages'] },
);
```
El TTL de 1h es una **red de seguridad**, no la vía principal — la
invalidación por evento (`revalidateTag`) es la vía principal, disparada desde
`BlogService.revalidatePostPaths()` cuando `type === PAGE`, **incondicionalmente**
(no solo si `showInFooter` es true — un condicional por slug/status se perdería
el toggle de `showInFooter` en sí; incondicional-pero-scoped-a-PAGE es más
simple y no pierde casos, y la llamada es fire-and-forget y barata). Se dispara
desde los mismos call sites ya gated por `wasPublished`
(`adminUpdate`/`publish`/`unpublish`/`delete`).

**Extensión del mecanismo existente, no uno nuevo:** `/api/revalidate/route.ts`
gana un parámetro `tag` — si está presente, `revalidateTag(tag)` en vez de
`revalidatePath(path)`. `BlogService` gana `revalidateTag()` privado, mismo
patrón fire-and-forget que `revalidate()` (ambos pasan ahora por un
`callRevalidateEndpoint()` compartido).

**Hallazgo real durante la implementación — no introducido por esta ráfaga,
pero descubierto al verificarla:** `apps/web/.env.example` y `.env.local`
**nunca habían tenido `REVALIDATE_SECRET`** configurado en el frontend. Como
`BlogService.revalidate()`/`revalidateTag()` son fire-and-forget con errores
silenciados, esto significa que la invalidación on-demand de ISR para
`/blog`/`/paginas` **nunca ha funcionado** en este entorno — enmascarado porque
el TTL de cada página (`revalidate = 3600`) igual auto-corregía el contenido
en como mucho una hora, sin que nadie lo notara. Corregido: `REVALIDATE_SECRET`
añadido a `.env.example` (documentado) y `.env.local` (valor real, coincide
con `apps/api/.env`/`.env.test`). Sin este fix, el footer (y el resto del blog)
seguirían funcionando, pero solo tras el TTL, nunca al instante — verificado
end-to-end en Playwright tras aplicar el fix.

**Endpoint:** `GET /paginas/footer` (dedicado, no un filtro de `GET /paginas`
— orden `footerOrder asc` y filtro `showInFooter` no tienen sentido para el
listado público genérico). `select` mínimo: solo `title`+`slug`. **Gotcha de
ordering de rutas** (ya conocido en este codebase, ver `categories/reorder` en
`AdminController`): `@Get('footer')` declarado ANTES de `@Get(':slug')` en
`PagesController`, o `/paginas/footer` se trataría como `findPageBySlug('footer')`.

**Admin:** `PostForm` gana `showFooterControls?: boolean` (activado junto a
`showTagsField={false}` desde `/admin/paginas/*`) — checkbox "Mostrar en el
footer" + input numérico "Orden en el footer" (con `htmlFor`/`id` asociados
correctamente, a diferencia de algunos labels pre-existentes del formulario).
Validación cruzada en el **servicio** (`adminCreate`/`adminUpdate`), no en el
DTO — el DTO valida antes de resolver `type ?? POST`, así que no puede ver el
tipo final: `resolvedType !== PAGE && (showInFooter || footerOrder != null)` →
400 con rechazo duro (no se ignora en silencio).

**Footer render:** `Footer.tsx` pasa a `async`, llama
`getCachedFooterPages().catch(() => [])` (si el backend falla, el footer sigue
funcionando con los enlaces estáticos — nunca rompe el sitio) y renderiza un
`<Link href="/paginas/{slug}">{title}</Link>` por página, en el orden devuelto
por el endpoint. Los enlaces estáticos no-página (Buscar/Publicar/Acceder) no
cambiaron. Sin páginas marcadas → el footer no muestra esa sección, sin
placeholder.

**Tests:**
- `pages.e2e-spec.ts` (backend, +18 casos): slug inmutable en PAGE PUBLISHED
  (400 `SLUG_IMMUTABLE`) vs. editable en DRAFT vs. siempre editable en POST;
  rechazo cruzado de `showInFooter`/`footerOrder` en POST (create y update);
  aceptación en PAGE; `GET /paginas/footer` — solo PUBLISHED+showInFooter,
  orden correcto, excluye DRAFT y no-footer, `select` mínimo, y verificación
  explícita de que el ordering de rutas no confunde `/footer` con un slug.
- `footer-paginas.spec.ts` (Playwright, 3 casos): marcar+publicar → aparece en
  el footer; despublicar → desaparece; dos páginas con `footerOrder` distinto
  salen en el orden correcto (creadas deliberadamente en orden inverso, para
  probar que depende del campo y no del orden de creación); desmarcar
  `showInFooter` en una página YA PUBLICADA la quita del footer sin
  despublicarla (la página sigue accesible directamente).
- `paginas.spec.ts`: test obsoleto de enlaces hardcodeados retirado (ver arriba).

Con esto, las páginas informativas (y el bloque de blog completo — rol EDITOR,
editor rico de markdown, páginas informativas, footer semi-dinámico) quedan
robustas de punta a punta.

### Footer estructurado en columnas por grupos (BLOG-FOOTER-COLUMNAS)

Extiende el footer semi-dinámico anterior: en vez de una lista plana de
enlaces, el footer agrupa las páginas en **columnas** (estilo Milanuncios) —
"Legal", "Ayuda", etc. **Extiende el mecanismo existente, no lo rehace**:
mismo `showInFooter`/`footerOrder`, mismo `getCachedFooterPages`
(`unstable_cache` + tag `footer-pages`), misma invalidación por evento. Solo
cambia la **forma** de los datos cacheados (agrupada en vez de plana) y el render.

**Schema:** `Post.footerGroup String?` (migración
`20260706193828_add_post_footer_group`, sin backfill, sin índice — la query
está cacheada). Texto libre, no enum ni modelo separado (deliberadamente
simple). Validado en el **servicio** junto a `showInFooter`/`footerOrder`
(`assertFooterFieldsAllowed`) — solo aplica a `PAGE`. Trim aplicado en el DTO
vía `@Transform` (higiene de datos, no regla de negocio): `"  Legal  "` →
`"Legal"`, blank → `undefined`. **Sin normalización de mayúsculas** — el admin
controla el casing visible del encabezado de columna; la defensa contra
duplicados tipo "Ayuda"/"ayuda" es el `<datalist>` de sugerencias, no reescribir
lo que el admin escribió.

**`footerGroup=null` con `showInFooter=true`:** la página NUNCA desaparece —
forma su propia columna, sin encabezado (`<h3>` omitido si `group` es falsy),
en vez de caer en un grupo "General" inventado. Mismo principio que ya guiaba
el resto de este bloque: nada se pierde en silencio por un campo sin rellenar.

**Orden de columnas — un solo campo hace ambos trabajos:** las páginas dentro
de un grupo se ordenan por `footerOrder` (como antes); los **grupos entre sí**
se ordenan por el `footerOrder` **mínimo** de sus páginas — sin un segundo
campo de "orden de grupo", que sería redundante si se repite por cada página
del mismo grupo. Empate en el mínimo → desempate alfabético por nombre de
grupo (determinista, no una señal de orden real). `BlogService.listFooterPages()`:
```typescript
const byGroup = new Map<string | null, typeof pages>(); // agrupa preservando el orden por footerOrder
return Array.from(byGroup.entries())
  .map(([group, groupPages]) => ({ group, minOrder: Math.min(...groupPages.map(p => p.footerOrder ?? 0)), pages: ... }))
  .sort((a, b) => a.minOrder - b.minOrder || (a.group ?? '').localeCompare(b.group ?? ''))
```

**Agrupado en el BACKEND, no en el frontend:** `GET /paginas/footer` devuelve
`Array<{ group: string | null; pages: Array<{title, slug}> }>`, ya agrupado y
ordenado — el frontend solo mapea columnas→páginas. El backend es la única
fuente de la semántica `footerOrder`/`footerGroup`, igual que ya es la única
fuente de "cómo se consulta `Post` de forma segura" en el resto de este
bloque; evita que un futuro segundo consumidor (p. ej. una vista de preview en
el admin) tenga que reimplementar el agrupado.

**Nuevo endpoint admin `GET /admin/blog/footer-groups`** (`@Roles(EDITOR,
MODERATOR, ADMIN)`): valores `footerGroup` distintos ya usados en páginas
existentes, para el `<datalist>` de sugerencias en `PostForm`. Ruta estática
declarada ANTES de `@Get(':id')` en `BlogAdminController` (mismo gotcha de
ordering ya documentado varias veces en este archivo). **Deliberadamente sin
caché** — a diferencia del footer público, un grupo recién creado debe
sugerirse de inmediato en el siguiente formulario, no esperar a un TTL.

**Render (`Footer.tsx`):** grid CSS responsive (`grid-cols-1` en móvil →
`md:grid-cols-4` en desktop), sin acordeón — un acordeón necesitaría estado de
cliente y convertiría `Footer` en Client Component, perdiendo el diseño
cache-friendly de Server Component que tenía. Cada columna: `<h3>` con el
nombre del grupo (omitido si `group` es `null`) + lista de `<Link>` debajo. Los
enlaces estáticos de navegación (Buscar/Publicar/Acceder + copyright) se
quedan en su propia barra, separados de la grilla de columnas — son
navegación de app, no contenido informativo agrupable. Sin columnas → la
grilla no se renderiza (sin placeholder), igual que el footer plano anterior.

**Admin (`PostForm.tsx`):** input de texto `footerGroup`, mismo gate que
`footerOrder` (`showFooterControls && values.showInFooter`), con `<datalist>`
poblado desde `getFooterGroups(token)` (fetch en un `useEffect`, solo cuando el
bloque de footer es relevante; falla en silencio si el fetch falla).

**Tests:**
- `pages.e2e-spec.ts` (backend, +19 casos): agrupado por `footerGroup` y orden
  de columnas por `footerOrder` mínimo; orden dentro de una columna; grupo
  `null` como columna sin encabezado (la página no desaparece); exclusión de
  no-publicadas/no-footer de todas las columnas; `select` mínimo; desempate
  alfabético entre grupos con el mismo mínimo; rechazo cruzado de
  `footerGroup` en POST (create y update); trim y blank→null; `GET
  /admin/blog/footer-groups` — valores distintos, sin duplicados, 401 sin
  token, ordering de rutas correcto.
- `footer-paginas.spec.ts` (Playwright, +5 casos): columna con encabezado
  correcto y el enlace dentro de esa columna; página sin grupo en columna sin
  encabezado; columnas ordenadas por `footerOrder` mínimo del grupo (no por
  orden de creación); datalist sugiere grupos existentes. El test existente de
  "dos páginas con `footerOrder` distinto" se corrigió para buscar enlaces en
  todo `<footer>` en vez de solo `<footer nav>` — los enlaces de página ya no
  viven en el `<nav>` de navegación estática, sino en la grilla de columnas.

Verificado manualmente contra servidores de desarrollo reales: páginas creadas
en distintos grupos aparecen en columnas separadas y ordenadas correctamente,
una página sin grupo aparece en una columna sin título, y el datalist sugiere
los grupos ya existentes de inmediato.

### Navegación del footer como entidad propia (FooterColumn/FooterItem) — retira BLOG-FOOTER-DINAMICO/COLUMNAS

**Mini-hito posterior** que sustituye por completo los dos bloques anteriores
(BLOG-FOOTER-DINAMICO, BLOG-FOOTER-COLUMNAS): el footer dejó de derivarse de
`Post.showInFooter`/`footerOrder`/`footerGroup` — esa asunción ("todo ítem del
footer ES una página") se rompía en cuanto se quería enlazar una ruta interna
(`/busqueda`) o una URL externa. El footer es ahora una **estructura propia**,
independiente del contenido.

**Modelo:** `FooterColumn` (`id`, `name String?` — null = sin encabezado,
`order`) y `FooterItem` (`id`, `columnId` FK `onDelete: Cascade`, `label`
—independiente de `Post.title`, editable sin tocar la página—, `order`, `type:
FooterItemType` enum `PAGE|INTERNAL|EXTERNAL`, `pageId String?` FK a `Post`
`onDelete: Restrict`, `url String?`). Destino discriminado por `type`,
validado en `FooterService.assertItemDestination` (**en el servicio, no con
un CHECK de schema** — mismo estilo que el retirado
`Post.assertFooterFieldsAllowed`): `PAGE` → `pageId` obligatorio + `url`
ausente + el `Post` referenciado debe ser `type=PAGE` (nunca un `POST` de
blog); `INTERNAL` → `url` obligatorio empezando por `/` + `pageId` ausente
(**sin registro de rutas reales** — una ruta inexistente solo se descubre en
runtime como 404, aceptado conscientemente); `EXTERNAL` → `url` obligatorio
como URL absoluta (`new URL(value).protocol` ∈ `http:`/`https:`) + `pageId`
ausente.

**Qué pasa si la página enlazada se borra o se despublica (decidido, no un
empate):** borrar la página → `BlogService.adminDelete` precomprueba
`prisma.footerItem.count({where:{pageId}})` **antes** del `delete` (molde
`AdminService.deleteCategory`) y devuelve 400 con el conteo exacto
("enlazada desde N sitio(s) del footer") en vez de dejar que la constraint
física `onDelete: Restrict` reviente con un 500 sin controlar. Despublicar
(`status → DRAFT`) → el `FooterItem` **sigue existiendo**, pero
`FooterService.listPublicNav()` hace `include: {page}` y filtra
`item.type !== PAGE || item.page.status === PUBLISHED` — el ítem desaparece
del footer público sin borrarse (mismo comportamiento implícito que el
sistema anterior, no una regresión). `GET /admin/footer` devuelve el `status`
de la página enlazada para que la UI pinte un badge "en borrador — no se
muestra" — el admin sabe por qué el ítem no aparece, en vez de tener que
adivinarlo.

**Migración de las 7 páginas existentes (dos migraciones, no una — orden
importa):** migración 1 (`20260711081900_add_footer_nav`) solo AÑADE
`FooterColumn`/`FooterItem`/`FooterItemType`, sin tocar `Post` — las columnas
legacy (`showInFooter`/`footerOrder`/`footerGroup`) siguen vivas. Script
`pnpm footer-backfill` (molde `reindex.ts`/`geocode-backfill.ts`, comando
standalone con `NestFactory.createApplicationContext`) lee esas columnas
legacy vía `$queryRaw` (no el `PrismaClient` tipado — para que el build no
falle una vez el modelo ya no las declara), agrupa por `footerGroup` (una
`FooterColumn` por grupo distinto, orden = `footerOrder` mínimo del grupo,
desempate alfabético — mismo cálculo que el retirado
`listFooterPages()`) y crea un `FooterItem type=PAGE` por página
(`label = title`, `order = footerOrder`); idempotente (aborta si ya existe
alguna `FooterColumn`, para no duplicar en una segunda ejecución accidental).
Solo **después** de correr el backfill, migración 2
(`20260711082727_drop_post_footer_fields`) retira las 3 columnas de `Post` —
generada con `prisma migrate diff` + `migrate resolve`/`deploy` en vez de
`migrate dev` porque el entorno no-interactivo de este agente no puede
confirmar el prompt de pérdida de datos que Prisma exige ante un `DROP
COLUMN` con filas no-nulas. Backfill verificado contra la BD dev: 7 páginas →
4 columnas (`Aux`, `Medio`, `Legal`, `Aux1`) con el mismo orden que producía
`listFooterPages()`.

**API (nuevo módulo `modules/footer/`, fuera de `blog`):** `GET /footer`
(público, ya resuelto: `{name, items: [{label, href, external}]}` — `PAGE` →
`/paginas/{slug}`, `INTERNAL`/`EXTERNAL` → `url` tal cual). `GET
/admin/footer` (estructura completa + `page.status` en ítems `PAGE`). CRUD +
reorder de columnas e ítems bajo `/admin/footer/columns` y
`/admin/footer/items` (rutas estáticas `.../reorder` declaradas ANTES de
`.../:id` — mismo gotcha ya documentado para `categories/reorder` y el
retirado `paginas/footer`), `@Roles(ADMIN)` en todo el controller. Reorder:
mismo molde que `AdminService.reorderCategories` — el frontend calcula el
swap de 2 elementos con las flechas ↑↓ y envía la lista `{id,order}[]`
completa en una `$transaction`, sin lógica de swap en el backend. "Mover de
columna" = `PATCH items/:id {columnId}` (no hay drag&drop ni endpoint
aparte); tocar `type`/`pageId`/`url` exige mandar la combinación **completa**
del nuevo destino en el mismo payload (no se mezcla con lo ya guardado en
BD) — el formulario de edición del admin siempre envía el destino entero de
una vez, así que esto nunca es una limitación real.

**Revalidación — extraída a un servicio compartido:** el fetch
fire-and-forget hacia `/api/revalidate` (con su logging de observabilidad,
ya instrumentado desde Hito 9 — ver más abajo) vivía como método privado de
`BlogService`. Se extrajo a `RevalidateService`
(`common/revalidate/`, `revalidatePath`/`revalidateTag`, mismo
`AbortSignal.timeout(3000)` y mismo `logger.warn` en `!res.ok` y en fallo de
red) para que tanto `FooterService` como `BlogService` lo inyecten — "reutilizar
`callRevalidateEndpoint`" (instrucción explícita del mini-hito) significaba
literalmente eso, no una segunda copia-pega del mismo fetch. Tag renombrado
`footer-pages` → `footer-nav`. `BlogService` ya no revalida el footer en
`adminUpdate` (el footer no depende de ningún campo de `Post` — label/orden/
columna viven en `FooterItem`, y el slug es inmutable mientras la PAGE está
publicada); solo `adminPublish`/`adminUnpublish`/`adminDelete` revalidan
`footer-nav`, porque son los únicos que pueden cambiar si un `FooterItem`
que referencia esa página se renderiza o no.

**Frontend:** `Footer.tsx` consume `getCachedFooterNav()`
(`lib/api/footer.ts`, mismo `unstable_cache`/TTL 3600s/tag `footer-nav` que
antes). Enlaces `EXTERNAL` → `target="_blank" rel="noopener noreferrer"`
(seguridad); `INTERNAL`/`PAGE` → `<Link>` normal. `PostForm.tsx` pierde por
completo `showFooterControls`/`showInFooter`/`footerOrder`/`footerGroup` — la
navegación del footer ya no se gestiona página por página. Nueva pantalla
`/admin/footer` (molde `admin/categorias`): columnas con flechas ↑↓
(deshabilitadas en extremos, swap optimista), nombre renombrable de golpe
(resuelve una carencia real del sistema anterior: antes había que editar cada
página para cambiar el `footerGroup`), borrado con `window.confirm` avisando
cuántos ítems se van (cascade explícito, consciente); ítems con flechas ↑↓
scoped a su columna, badge ámbar si la página enlazada está en `DRAFT`,
selector de destino (página del CMS —buscador sobre `Post type=PAGE`
reutilizando `getAdminPosts`, sin endpoint nuevo— / ruta interna / URL
externa) que prerrellena el `label` con el título de la página elegida
(editable después).

**Tests:** `footer.service.spec.ts` (unit, destino discriminado × 3 tipos +
cruces inválidos, `updateItem` exige combinación completa al tocar el
destino, reorder/delete-cascade); `test/footer.e2e-spec.ts` (e2e, +23 casos:
permisos ADMIN-only, CRUD+reorder de columnas e ítems, los 3 destinos válidos
e inválidos, `pageId` apuntando a un POST → 400, borrado de página enlazada →
400 con conteo, despublicar → omitido del público pero visible en admin con
badge, mover de columna, `GET /footer` resuelto con `external` correcto).
`pages.e2e-spec.ts` perdió los ~19 casos de footer (movidos/reemplazados por
lo anterior). `e2e/footer-admin.spec.ts` (Playwright, sustituye a
`footer-paginas.spec.ts`, retirado): crear columna+ítem página → aparece en
el footer público; ítems `INTERNAL`/`EXTERNAL` con `href`/`target`/`rel`
correctos; despublicar → desaparece del público, badge en admin; reordenar
columnas con las flechas cambia el orden público; borrar columna se lleva sus
ítems. `test/helpers/db.ts`: `cleanDb` pasa a `TRUNCATE "User",
"FooterColumn" CASCADE` — `FooterColumn` no cuelga de `User` por FK (solo
`FooterItem.page → Post → User` lo hace), así que sin este cambio quedaba
huérfana entre suites y filtraba columnas/orden de un test a otro.

Verificado en vivo contra servidores de desarrollo reales (`pnpm dev` en
ambos, backfill ya corrido): `GET /api/footer` devuelve la estructura
migrada; `/admin/footer` renderiza las 4 columnas con sus ítems; crear una
columna nueva con un ítem `INTERNAL` (`/busqueda`) y comprobar que aparece de
inmediato en el `<footer>` de `/` tras la revalidación; limpieza posterior
confirmada contra la API (`GET /api/footer` ya no la incluye).

### Sistema de bloques — Ráfaga 1: modelo + validación + los 9 renderizadores (SIN editor)

**Corte limpio**: `Post.body String` (Markdown raw) se sustituye por
`Post.blocks Json @default("[]")` — un array ORDENADO (la posición en el
array es el orden; no hay un campo `order` por bloque, a diferencia de
`FooterItem`, porque no son filas separadas, viven todas en el Json de una
única fila `Post`). Sin backfill: las 8 filas placeholder de dev (texto tipo
`sdfsdfsdf`) quedaron con `blocks: []` — contenido reconocido como basura, no
merecía ni un script de envoltura. Migración generada con el mismo workaround
ya usado en el mini-hito de footer (`prisma migrate diff` → editar
`migration.sql` a mano → `migrate deploy`, porque el entorno no-interactivo
no puede confirmar el prompt de pérdida de datos que exige un `DROP COLUMN`
con filas no-nulas).

**Los 9 tipos** (unión discriminada por `type`, espejo exacto entre DTOs del
backend — `modules/blog/dto/blocks/*.dto.ts` — y `apps/web/src/types/blocks.ts`
en el frontend): `text{markdown}`, `faq{title?, items[{question, answer}]}`,
`hub{title?, links[{label, href, description?}]}`, `image{url, alt, caption?,
position?, width?}`, `cta{label, href, style?}`, `quote{text, author?}`,
`video{provider, videoId}`, `separator{}`, `table{headers[], rows[][]}`.
`BaseBlock{id}` — `id` generado en cliente con `generateId()`
(`lib/utils.ts`, ya existente — `crypto.randomUUID` con fallback, mismo uso
que en `StepFotos.tsx`), persistido tal cual, nunca regenerado por el
backend.

**Validación profunda — `class-transformer` discriminator, sin zod (no está
en el stack; class-validator+class-transformer es exclusivo en todo el
proyecto)**: `ValidBlocksArray()` (`dto/blocks/block.dto.ts`) empaqueta con
`applyDecorators` (`@nestjs/common`) un `@Type(() => BaseBlockDto,
{discriminator: {property:'type', subTypes:[...9 clases...]}})` — cada
elemento del array se valida contra SU PROPIA clase DTO según `type`,
reutilizado tal cual en `CreatePostDto`/`UpdatePostDto`. `ValidationPipe`
global (`whitelist:true, forbidNonWhitelisted:true`) rechaza `type`
desconocido y propiedades extra sin decorador.

**Contraste consciente con un precedente existente que NO se siguió**:
`Category.attributeSchema` solo valida `@IsArray()` superficialmente (cast a
`unknown[]`) — tolerable ahí porque nunca se interpola en un atributo HTML
real. Los bloques sí lo hacen (`image.url`, `cta.href`, `hub.links[].href`
acaban en `href`/`src`), así que aquí la validación es profunda por campo,
no superficial.

**Validador de URL compartido** (`common/validators/safe-url.ts`) — extraído
del footer mini-hito, ahora con dos consumidores (`FooterService` Y los DTOs
de bloques): `isSafeContentUrl`/`@IsSafeContentUrl()` (ruta relativa `/...` O
absoluta http/https, nunca `javascript:`/`data:`) para `cta.href` y
`hub.links[].href`; `isOwnStorageUrl`/`@IsOwnStorageUrl()` (debe empezar por
`process.env.S3_PUBLIC_URL`, leído directo — mismo estilo que
`RevalidateService` con `APP_URL`) para `image.url`, restringida a nuestro
propio storage (mismo criterio que `coverUrl` — "upload-only, no external
URLs").

**Vídeo — nunca una URL cruda ni un iframe libre**: solo se guarda
`{provider, videoId}`. El cliente (Ráfaga 2) parseará la URL pegada por el
admin; el backend REVALIDA el formato de `videoId` independientemente vía un
`ValidatorConstraint` que lee el campo hermano `provider` por
`args.object` — el ejemplo canónico de class-validator para "un campo
depende de otro del mismo objeto" (su propio ejemplo de referencia es un
password-confirm). Nota de diseño: se descartó apilar dos `@ValidateIf` (uno
por provider) porque sus condiciones se combinan con AND — con `provider`
fijo en un único valor, una de las dos siempre sería falsa y el decorador
emparejado nunca correría (lección ya aprendida en el diseño del destino de
`FooterItem`, donde por eso esa regla vive en el servicio en vez del DTO).

**Tabla — la única regla que SÍ vive en el servicio**:
`rows[i].length === headers.length` depende de dos campos del mismo bloque Y
es una regla de negocio, no de forma — `BlogService.assertTableBlocksValid`,
mismo estilo que el ya retirado `assertFooterFieldsAllowed` /
`FooterService.assertItemDestination`. (Técnicamente también sería
expresable como un `ValidatorConstraint` con `args.object`, igual que el de
vídeo — se dejó en el servicio porque así se acordó explícitamente en el
diseño aprobado, no porque no hubiera alternativa a nivel de DTO.)

**Renderizador** (`components/blocks/`): `BlockRenderer.tsx` hace un `switch`
exhaustivo sobre el union — un `assertUnreachable(block: never)` en el
`default` hace que el build falle si se añade un 10º tipo sin su `case` (el
compilador ES la validación de que el esquema y el renderizador nunca
divergen). `text`/`faq.items[].answer` reutilizan `MarkdownBody` sin tocar
(misma tubería auditada `react-markdown`+`remark-gfm`+`rehype-sanitize`, sin
`rehype-raw`) — es el ÚNICO sitio del sistema de bloques que interpreta texto
como Markdown; todo lo demás es texto React auto-escapado o una URL ya
validada. `faq`/`table` usan componentes shadcn nuevos (`accordion`, `table`
— instalados en esta ráfaga, `npx shadcn add accordion table`). `video` usa
`aspect-video` (utilidad nativa de Tailwind, sin dependencia) + iframe
construido server-side hacia `youtube-nocookie.com/embed/{videoId}` o
`player.vimeo.com/video/{videoId}`. `image` usa un `<img>` plano (no
`next/image`: el bloque no guarda dimensiones, solo un `width` en %, así que
no hay como fijar el `width`/`height`/`fill` que `next/image` exige) con el
mismo guard `isSafeSrc()` que ya protegía `coverUrl`. `cta`/`hub` reutilizan
el patrón interno/externo (`target="_blank" rel="noopener noreferrer"` en
externos) recién construido para `FooterItem`. `separator` reutiliza
`separator.tsx` (ya instalado).

**Admin — el editor queda TEMPORALMENTE desconectado**: `PostForm.tsx` pierde
por completo el `MarkdownEditor`/preview de `body` (`Post.body` ya no
existe) — se sustituye por una nota fija ("el editor de contenido por
bloques llega en la próxima ráfaga…"); el formulario sigue editando
metadatos (título, slug, excerpt, cover, tags, SEO) sin tocar `blocks` en
absoluto (`UpdatePostPayload` sin `blocks` → el backend no lo toca,
`dto.blocks !== undefined` es la guarda). El componente `MarkdownEditor.tsx`
NO se tocó ni se eliminó — la Ráfaga 2 lo reconecta tal cual como editor del
bloque `text`.

**Tests**:
- `test/blocks.e2e-spec.ts` (backend, 25 casos): los 9 tipos válidos +
  1 post con los 9 a la vez; inválidos (faq sin items, tabla con fila de
  longitud ≠ headers, cta/hub con `href` `javascript:`/`data:`, image con
  URL externa, image sin `alt`, video con `videoId` basura o `provider`
  desconocido, `type` desconocido, propiedad extra no declarada); seguridad
  (un POST/PATCH rechazado no crea fila ni muta la existente).
- `src/components/blocks/BlockRenderer.test.tsx` (frontend, 10 casos): los 9
  tipos se renderizan sin lanzar (smoke test del switch exhaustivo) +
  aserciones específicas por tipo (href/target/rel de `hub`, src del iframe
  de `video`, filas de `table`…). `MarkdownBody` se mockea aquí — su cadena
  de dependencias (`react-markdown` v10 → `devlop`, ESM-only) no la
  transforma `next/jest`, mismo motivo por el que ningún test de este repo
  ejercitaba `MarkdownBody` directamente antes de esta ráfaga.
- `e2e/paginas.spec.ts`: el test "`<script>` literal nunca se ejecuta" se
  reescribió para crear el post vía API directa (`loginViaApi`/`authedPost`,
  sin pasar por la UI del editor, que ya no existe) — sigue siendo la
  cobertura real, sin mocks, de que el bloque `text` escapa HTML literal.
  `e2e/blog-markdown-editor.spec.ts` (batería dedicada al editor de
  Markdown) se marcó `test.describe.skip` con una nota — se reactivará
  cuando la Ráfaga 2 reconecte el editor al bloque `text`.
- Script `pnpm seed-blocks-demo` (molde `reindex.ts`/`footer-backfill.ts`):
  crea/actualiza una PAGE (`/paginas/blocks-demo`) y un POST
  (`/blog/blocks-demo-post`) PUBLISHED con los 9 tipos rellenos de contenido
  de ejemplo — el bloque `image` reutiliza la URL de un `ListingImage` real
  ya subido, para pasar también `isOwnStorageUrl` si se reedita desde el
  admin. Usado para el QA visual, no para tests automatizados.

Verificado en vivo contra servidores de desarrollo reales tras
`pnpm seed-blocks-demo`: los 9 bloques se renderizan correctamente en
`/paginas/blocks-demo` y `/blog/blocks-demo-post` (capturas desktop 900px y
mobile 390px), incluido el iframe de vídeo (confirmado por HTML servido —
`src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"` — en blanco en la
captura solo por falta de red saliente en el entorno de verificación, no un
bug); `/admin/blog/nuevo` muestra la nota de "editor en la próxima ráfaga" y
el resto del formulario de metadatos funciona con normalidad.

### Sistema de bloques — Ráfaga 2: el editor completo (cierra el sistema de contenido)

Sustituye la nota placeholder de `PostForm.tsx` por un editor visual completo
— un admin no técnico puede construir un post/página con los 9 tipos sin
tocar JSON ni Markdown crudo (salvo el bloque `text`, que sigue siendo
Markdown por decisión ya aprobada en R1, pero con toolbar de botones).

**Andamiaje** (`admin/blog/_components/block-editor/`): `BlockEditor.tsx` es
el contenedor — el estado es simplemente el array `blocks` de `PostForm`,
igual que título/slug/excerpt. Añadir/reordenar/borrar son manipulaciones
del array EN CLIENTE, sin ningún endpoint propio — a diferencia de
categorías/footer (filas separadas, con `PATCH .../reorder` y transacción
multi-fila), los bloques viven en un único array Json de una sola fila
`Post`, así que el "guardado" real es el mismo `POST`/`PATCH
/admin/blog[/:id]` que ya existía desde R1, con el array completo dentro.
`BlockTypePicker.tsx` — panel de tarjetas (no un `<select>` compacto): cada
tipo necesita espacio para nombre Y descripción en lenguaje claro ("FAQ:
preguntas desplegables", no "faq") — es el requisito central de "usable por
no técnicos". `BlockEditorRow.tsx` — switch exhaustivo sobre el union
(`assertUnreachable`, mismo patrón que `BlockRenderer.tsx`) con flechas ↑↓
(deshabilitadas en extremos) y borrado con confirmación SOLO si el bloque ya
tiene contenido (`blockHasContent()` por tipo — un bloque recién añadido y
vacío se quita sin fricción). El preview reutiliza el **mismo**
`BlockRenderer` de R1 — "lo que ve el admin es lo que se publica", literal.

**Los 9 formularios**, construidos en orden simple→caro:
- `separator`/`quote`/`cta`: triviales (0-3 inputs). `cta.href` valida en
  vivo con `isSafeContentUrl()` (`lib/blocks/validation.ts` — espejo
  deliberado del validador del backend, `common/validators/safe-url.ts`: da
  feedback inmediato sin esperar el 400, el backend sigue siendo la fuente
  de verdad) y muestra el error junto al campo ("El enlace debe empezar por
  `/`... o por `https://`"), nunca un 400 críptico.
- `text`: **reuso literal** de `MarkdownEditor.tsx`/`MarkdownEditorClient.tsx`
  — cero líneas nuevas en esos archivos, el hallazgo de seguridad sobre el
  preview de `@uiw/react-md-editor` (documentado en R0/R1) sigue aplicando
  sin cambios.
- `image`: **nuevo endpoint** `POST /admin/blog/upload-image`
  (`BlogService.uploadBlockImage`) — molde `SponsoredAdsService.uploadImage`
  calcado: sube directo a R2 con prefijo `blocks/`, NO crea `ListingImage`.
  `alt` es obligatorio (no opcional) en el formulario, igual que en el DTO.
- `faq`/`hub`: **`SubItemList.tsx`** — patrón "lista repetible de
  sub-ítems" extraído una sola vez y compartido entre ambos (única pareja de
  bloques con arrays de objetos anidados), con las mismas flechas ↑↓ y un
  "Quitar" deshabilitado cuando solo queda 1 ítem (backend exige
  `ArrayMinSize(1)` — mejor deshabilitar el botón que dejar que el guardado
  falle con un 400 evitable). La respuesta de `faq` usa un `<textarea>`
  simple, NO el `MarkdownEditor` completo — una respuesta típica son 1-2
  frases, montar un editor con toolbar por ítem sería más fricción que
  ayuda; sigue pasando por `MarkdownBody`/`rehype-sanitize` al renderizar,
  así que no pierde la sanitización por no tener toolbar.
- `video`: el admin pega la URL tal cual la copia de YouTube/Vimeo;
  `parseVideoUrl()` (mismo archivo `lib/blocks/validation.ts`) la convierte a
  `{provider, videoId}` con una regex por proveedor — si no la reconoce,
  error claro ("No reconocemos esta URL..."), sin guardar nada roto. El
  preview reutiliza el propio `VideoBlockRenderer` de R1 (mismo iframe
  controlado hacia `youtube-nocookie.com`). El backend re-valida el formato
  de `videoId` de forma independiente (R1) — nunca confía en el parseo del
  cliente.
- `table`: la pieza más cara — grid dinámico. La invariante
  `rows[i].length === headers.length` (exigida por
  `BlogService.assertTableBlocksValid` desde R1) se mantiene **por
  construcción**: añadir/quitar columna siempre toca `headers` Y todas las
  filas en la MISMA llamada a `onChange`, así que nunca existe un estado
  intermedio inconsistente — no hace falta validación adicional en el
  cliente para esto, es estructuralmente imposible producir una tabla
  inconsistente desde el editor.

**Tests**:
- `BlockEditor.test.tsx` (frontend, 32 casos — RTL, `fireEvent` no
  `userEvent`, que no está entre las devDependencies del workspace, mismo
  molde que `AttributeSchemaEditor.test.tsx`): andamiaje completo (añadir
  cada uno de los 9 tipos, flechas deshabilitadas en extremos, reordenar,
  borrar con/sin confirmación, preview con `BlockRenderer` real) + por tipo
  (`cta`/`hub` con `href` inválido → error inline; `table` añadir/quitar
  fila y columna mantiene la coherencia; `video` URL válida/basura). Detalle
  de arnés de test importante: el primer intento usaba un `onChange` mock
  "hueco" (`jest.fn()` sin actualizar estado) — los inputs controlados
  quedaban congelados tras `fireEvent.change` porque React nunca los
  re-renderizaba con el valor nuevo; arreglado con un wrapper de test con
  `useState` real, igual que haría `PostForm` en producción.
- `test/blocks.e2e-spec.ts` (backend, +5 casos sobre R1 → 30 totales):
  `POST /admin/blog/upload-image` — 401 sin auth, 422 no-imagen, 400 sin
  archivo, 201 con prefijo `blocks/` y sin crear `ListingImage`, y que la URL
  devuelta pasa la validación `isOwnStorageUrl` al crear un post con ella.
- `e2e/blog-markdown-editor.spec.ts` — **reactivado** (estaba `skip` desde
  R1): mismos 2 casos de antes (formato variado se publica igual, `<script>`
  literal nunca se ejecuta), adaptados para añadir primero un bloque `text`
  vía el picker antes de interactuar con `.w-md-editor-text-input`.
- `e2e/block-editor-full.spec.ts` (nuevo) — la prueba de fuego pedida: un
  admin construye una página con los 9 tipos (incluye upload real de imagen
  vía `setInputFiles` + fixture `test-image.png`, y añadir fila/columna en la
  tabla), guarda, publica, y se verifica cada bloque en la página pública
  (incluido el `iframe` de vídeo por `src`, y `href`/`target`/`rel` de
  `cta`/`hub`). `data-testid` añadidos donde hacía falta desambiguar en el
  DOM real (`block-type-picker`, `block-row-{type}`, `block-image-input`) —
  no existían en R1 porque no había UI que los necesitara.
- `e2e/paginas.spec.ts` — el test de `<script>` (ya adaptado a API directa en
  R1, sin depender del editor) sigue verde sin cambios adicionales.

**Hallazgo operativo durante la verificación** (no es un bug de código): la
batería completa de Jest e2e falló ~80 tests con "not indexed in
Meilisearch" de forma reproducible, en módulos totalmente ajenos a blog/
bloques (search, rc5b-vehiculos, sponsored-ads...). Ni reiniciar
Meilisearch/Redis ni limpiar el índice lo arregló. Causa real: un proceso
`pnpm dev` suelto seguía escuchando en `:3001` desde una verificación manual
anterior (`Stop-Process` sobre el wrapper de `nest start --watch` no mató al
hijo) — `.env`/`.env.test` comparten el mismo `REDIS_URL` y los mismos
nombres de cola BullMQ (sin prefijo por entorno), así que ese worker de dev
competía por los jobs de indexado del run de test y los escribía en el
índice de **dev**, no en `listings_test`. Matar ese proceso resolvió el 100%
de los fallos al instante. Ver [[feedback_e2e_zombie_dev_process]] en
memoria — antes de sospechar de Meilisearch/Redis/BullMQ, comprobar
`Get-NetTCPConnection -LocalPort 3001`. **Causa raíz cerrada 2026-07-12** —
dev/test ya están en dbs Redis separadas, ver «Colisión Redis dev/test en
local» en la sección de Hito 7.

**Hallazgo aparte, fuera de alcance de esta ráfaga**: al correr por primera
vez la batería Playwright COMPLETA (antes solo se había verificado
`footer-admin.spec.ts` con un script manual de capturas, nunca con
`npx playwright test`), 3 de sus 5 casos fallan de forma reproducible — el
selector de "página del CMS" en `/admin/footer` no encuentra la página recién
creada. No investigado a fondo (pertenece a la ráfaga de footer, no a esta);
ver [[project_footer_admin_e2e_broken]] en memoria.

Verificado en vivo (Playwright real, no mocks): `block-editor-full.spec.ts`
construye una página con los 9 bloques desde `/admin/paginas/nueva`
(incluida una subida de imagen real a R2/MinIO y edición de la tabla),
publica, y confirma cada bloque en `/paginas/[slug]` — 3/3 tests verdes
(este + los 2 de `blog-markdown-editor.spec.ts`) en ejecuciones repetidas
con estado limpio.

### Sistema de bloques — Ráfaga 3: 4 tipos nuevos (3 estáticos + el primer bloque DINÁMICO) — 13 tipos

Prueba deliberada de que el esquema de R1/R2 hace barato añadir tipos: los 3
estáticos (`imageText`, `steps`, `profile`) son pura composición de piezas ya
existentes, y el cuarto (`listings`) introduce la primera pieza de contenido
que NO vive en el propio bloque sino que se resuelve contra el estado vivo
del marketplace (Postgres + Meilisearch) en cada render — el diseño tenía
que absorber esto sin romper el contrato "BlockRenderer es síncrono y se
comparte entre SSR público y el preview client-side del editor".

**Los 3 tipos estáticos** — cero pieza nueva, solo reagrupar:
- `imageText` (`{image:{url,alt,caption?}, markdown, layout}`): el editor
  reusa literalmente el botón de subida de `image` (mismo
  `POST /admin/blog/upload-image`) operando sobre el sub-objeto `image`, y el
  `MarkdownEditorClient` de `text` sin cambios. El renderizador es un grid de
  2 columnas (`imageLeft`/`imageRight`, se apila en móvil).
- `steps` (`{title?, items:[{title, description, image?}]}`) y `profile`
  (`{image?, name?, attributes:[{label, value}]}`): ambos reutilizan
  `SubItemList<T>` (extraído en R2 para faq/hub) **sin tocarlo** — ya era
  genérico, confirmando que la extracción de R2 fue la correcta. La imagen
  opcional de cada paso de `steps` necesitó su propio estado de
  subida/error por ítem (`StepItemFields`, subcomponente con `useState`
  propio dentro de `renderItem`), porque `SubItemList` no gestiona estado
  por-ítem — el resto (añadir/quitar/reordenar) es gratis.
- Backend: 3 DTOs nuevos (`image-text-block.dto.ts`, `steps-block.dto.ts`,
  `profile-block.dto.ts`), registrados en `ValidBlocksArray()`
  (`block.dto.ts`) — el único punto de registro de tipos, sin tocar
  `CreatePostDto`/`UpdatePostDto`. Sin reglas cruzadas nuevas en el service
  (a diferencia de `table`): la forma de estos 3 tipos es válida campo a
  campo, sin invariantes entre hermanos.

**El bloque `listings` (primer bloque dinámico)** —
`{title?, categorySlug, limit:4|6|8|12, sort?:'recent'|'featured',
showAllLink?}` — no guarda contenido, guarda una **consulta**:
- **Fuente única**: `ListingsBlockRenderer` (público) y `ListingsBlockEditor`
  (admin, para el aviso de categoría vacía y el preview) llaman los dos a
  `search()` de `lib/api/busqueda.ts` — la MISMA función que usan
  `/busqueda`, `/[categoria]` y la portada. Cero query nueva en el backend.
  `sort:'recent'` mapea a `sort:'publishedAt:desc'` (igual que la portada);
  `sort:'featured'` mapea a `sort:'sortDate:desc'`
  (`sortDate = max(publishedAt, bumpedAt)`, favorece re-impulsados) — en
  ambos casos `boostScore:desc` sigue siendo la rankingRule que manda
  primero en Meilisearch (RF.8), así que el badge "Destacado" en
  `ListingCard` aparece solo, sin lógica adicional.
- **Render**: grid con `ListingCard` (mismo componente que búsqueda/portada,
  `prefetch={false}` ya incluido en el propio componente). Grid, no
  carrusel. Deliberadamente **sin** `FavoritesGridProvider` ni
  `CardAttributesProvider` — `ListingCard` degrada con gracia sin ellos
  (`FavoriteCardButton`/`CardAttrsDisplay` leen contexto vía `useContext`
  con default vacío, nunca lanzan) a cambio de no acoplar el sistema de
  bloques a la resolución de `attributeSchema` por categoría; el coste es
  que las tarjetas del bloque no muestran el corazón de favorito ni la
  línea de atributo variable (p. ej. "45.000 km"). Los hits patrocinados se
  filtran (`isSponsoredAdHit`) — un bloque de contenido editorial no debe
  convertirse en inventario publicitario sin pedirlo explícitamente (mismo
  criterio que "recientes" en la portada).
- **Contrato síncrono preservado**: `BlockRenderer` NO se volvió async. Su
  única concesión es una prop nueva y opcional, `listingsData?: Record<
  blockId, SearchResponse>`, resuelta por QUIEN LLAMA antes de renderizar.
  En público, `lib/blocks/resolve-listings.ts` (`resolveListingsBlocksData`)
  se ejecuta en el server component de la página (`/paginas/[slug]`,
  `/blog/[slug]`) con `Promise.all` sobre todos los bloques `listings` de
  esa página. En el editor, `BlockEditor.tsx` hace lo mismo en un efecto
  cliente (mismo `search()`, misma fuente) solo cuando el preview está
  abierto, con una clave de dependencia derivada (`id:categorySlug:limit:
  sort` de los bloques `listings`, no el array `blocks` completo) para no
  relanzar la consulta en cada tecla de un campo ajeno. Se documenta como
  una divergencia CONSCIENTE y acotada de "el preview es literalmente el
  mismo BlockRenderer": el mecanismo de *resolución* de datos difiere
  (SSR vs. efecto cliente) por necesidad técnica (Server Component async vs.
  Client Component), pero el *renderizado* — mismo `ListingsBlockRenderer`,
  mismos datos, mismo `ListingCard` — es idéntico en ambos sitios.
- **Estado vacío**: si la categoría no tiene anuncios, `ListingsBlockRenderer`
  devuelve `null` — el bloque entero desaparece, título incluido, sin dejar
  un hueco. El editor avisa aparte: un `useEffect` en
  `ListingsBlockEditor` llama a `search({categorySlug, hitsPerPage:1})` al
  cambiar de categoría y muestra "esta categoría no tiene anuncios activos
  ahora mismo" si `totalHits === 0` — mismo `search()`, una llamada más
  barata, cero fuente nueva.
- **Validación** (`BlogService.assertListingsBlocksValid`, mismo criterio que
  `assertTableBlocksValid`/`FooterService.assertItemDestination`: reglas
  cruzadas o que dependen de estado externo viven en el service, no en el
  DTO): `categorySlug` debe existir en `Category` (lookup real contra
  Postgres); máximo **4** bloques `listings` por página/post — guardarraíl
  contra que una página dispare N consultas a Meilisearch en cada render;
  `limit` restringido a `{4,6,8,12}` vía `@IsIn` en el DTO (forma, no
  cruzado).

**LA DECISIÓN CLAVE — caché**: observado el estado actual antes de diseñar
— `/paginas/[slug]` y `/blog/[slug]` usan `export const revalidate = 3600`
(ISR de 1h a nivel de ruta) más invalidación on-demand
(`RevalidateService.revalidatePath`) disparada SOLO cuando el propio `Post`
cambia, nunca cuando cambia un `Listing`. Next 15 además cambió el default
de la Data Cache (`fetch()`) a no-cacheado — lo que gobierna la frescura de
una página estática/ISR es la Full Route Cache, y su intervalo efectivo para
una URL concreta es el MÍNIMO `revalidate` entre todos los `fetch()`
usados para generarla (no solo el `export const revalidate` del segmento).
Se aprovechó esto directamente: `resolveListingsBlocksData` pasa
`next: { revalidate: 180 }` (3 min, `LISTINGS_BLOCK_REVALIDATE_SECONDS` en
`lib/blocks/resolve-listings.ts`) a su llamada a `search()` — como cada
`/paginas/<slug>` es una entrada de caché independiente, SOLO las páginas
que de verdad incluyen un bloque `listings` bajan su TTL efectivo a 3 min;
el resto de páginas conserva la 1h intacta sin tocar el `revalidate` global
de la ruta. Cero infraestructura nueva, cero PPR experimental. Alternativas
descartadas (documentadas para que la decisión no se repita sin motivo):
bajar `revalidate` a un valor corto para TODA la ruta (más simple, pero
penaliza páginas 100% estáticas sin necesidad); resolver los anuncios en el
cliente (frescura total, pero deja de ser SSR — mal para SEO y contradice
la petición explícita de resolver "en el server component de la página").

**Consecuencia documentada, a propósito**: una página con un bloque
`listings` **deja de ser autocontenida** — su contenido visible depende de
estado externo (Postgres + índice de Meilisearch) con una ventana de hasta
180 s de posible desajuste (p. ej. un anuncio vendido puede seguir
apareciendo hasta 3 minutos). Es una propiedad que se rompe conscientemente,
no un descuido — antes de esta ráfaga, publicar una página o post
garantizaba que su contenido no cambiaría hasta la siguiente edición
explícita; ahora eso solo es cierto para páginas SIN bloques `listings`.

**Tests**:
- `test/blocks.e2e-spec.ts` (backend, +19 casos → 45 totales): los 3
  estáticos válidos/inválidos (`imageText` con `image.url` externa → 400,
  `layout` desconocido → 400; `steps`/`profile` sin sub-ítems → 400
  `ArrayMinSize`); `listings` válido con categoría real, categoría
  inexistente → 400, `limit` fuera del enum → 400, `sort` desconocido →
  400, más de 4 bloques `listings` → 400 (y exactamente 4 → 201, límite
  inclusive), un PATCH que supera el límite NO muta el post existente
  (mismo molde que el PATCH-rechazado de `table`); post con los 13 tipos a
  la vez → 201.
- `BlockRenderer.test.tsx` (frontend, +9 casos): los 3 estáticos renderizan;
  `listings` con datos resueltos pinta las tarjetas y el badge "Destacado"
  si `boostScore:1`; sin `listingsData` (aún no resuelto) y con
  `totalHits:0` ambos no renderizan nada; patrocinados excluidos; enlace
  "Ver todos" con el href correcto; los 13 tipos combinados no lanzan.
  Mock nuevo de `next-auth/react` (ESM-only, mismo problema que
  react-markdown documentado en R1/R2) — lo arrastra `ListingCard` vía
  `FavoriteCardButton`, solo necesario desde que el bloque `listings` reusa
  ese componente.
- `BlockEditor.test.tsx` (frontend, +14 casos): reuso de `SubItemList`
  confirmado para `steps`/`profile`; `listings` — categorías reales
  cargadas vía `getCategories()` (mockeado), cambiar categoría/límite/orden
  actualiza el bloque, aviso de categoría vacía cuando `totalHits:0`, y el
  preview resuelve datos vía `search()` client-side y pinta con el mismo
  `BlockRenderer`.
- `resolve-listings.test.ts` (nuevo, 5 casos): mapeo `recent`→
  `publishedAt:desc`/`featured`→`sortDate:desc`, el TTL corto se pasa
  siempre como `next.revalidate`, resolución en paralelo de varios bloques
  por `Promise.all`, bloques no-`listings` ignorados.
- `e2e/block-listings.spec.ts` (nuevo, Playwright, datos reales — Postgres +
  Meilisearch, sin mocks): crea un anuncio real vía API en una categoría
  propia (creada al vuelo, nunca "electronica" — ver nota de flakiness más
  abajo), construye una página con DOS bloques `listings` (una categoría
  con contenido y una vacía recién creada), publica, y verifica que la
  categoría poblada pinta el anuncio real y la vacía OCULTA el bloque
  entero (título incluido) en la página pública. El TTL de 180 s no se
  verifica esperando en tiempo real (lento y fràgil sin aportar cobertura
  que `resolve-listings.test.ts` no dé ya sobre el mecanismo) — se
  considera cubierto por el test unitario del mapeo a `search()`.
- `e2e/block-editor-full.spec.ts` (actualizado, prueba de fuego): ahora
  construye una página con los **13** tipos (9 de R2 + 4 de R3) desde
  `/admin/paginas/nueva`, incluido un anuncio real para el bloque
  `listings`, publica, y verifica los 13 en `/paginas/[slug]`.

**Hallazgo de flakiness (corregido, no del código de producción)**: la
suite Playwright NO trunca la base de datos entre specs (a diferencia de la
batería Jest e2e, que sí lo hace en cada `beforeAll` vía `cleanDb`) — así
que categorías compartidas como "electronica" acumulan anuncios de otras
specs a lo largo de sucesivas ejecuciones locales, algunos posiblemente
destacados. Como `boostScore:desc` es siempre la primera rankingRule de
Meilisearch (por delante de cualquier `sort` pedido), un anuncio recién
creado en una categoría "sucia" puede quedar fuera de `hitsPerPage` si ya
hay ≥ `limit` anuncios destacados acumulados — un test que asumiera
"electronica" como categoría de prueba sería flaky sin ninguna relación con
el código del bloque. Fix: `block-listings.spec.ts` y
`block-editor-full.spec.ts` crean su propia categoría al vuelo
(`POST /admin/categories`, slug con timestamp) para cualquier assertion que
dependa de que el anuncio recién creado sea visible — la categoría nueva
garantiza que es el único candidato posible. Segundo hallazgo relacionado:
`blog-markdown-editor.spec.ts` localizaba el post publicado con
`new RegExp(title.slice(0,20))` — una carrera de timestamps de milisegundo
con ejecuciones anteriores en la misma sesión podía hacer que ese prefijo
truncado matchee DOS posts distintos (`strict mode violation`); corregido a
un match exacto del título completo (`{ exact: true }`), sin relación con
el sistema de bloques pero descubierto y arreglado en esta ráfaga al
re-ejecutar la suite repetidamente.

Verificado en vivo (Playwright real, datos reales de Postgres/Meilisearch,
sin mocks): `block-editor-full.spec.ts` (13 tipos) y `block-listings.spec.ts`
(datos reales + categoría vacía) — 2/2 verdes, junto con el resto de la
suite de bloques/páginas (7/7 en conjunto). Backend: 47/47 suites, 746/746
tests (+15 sobre R2). Puertos 3000/3001 comprobados limpios antes y después.

### CI: `footer-paginas.spec.ts` fallaba consistentemente — causa raíz real (`APP_URL` equivocado, no el secret)

Tras cerrar BLOG-FOOTER-COLUMNAS, los 6 tests de `footer-paginas.spec.ts`
fallaban de forma **consistente** (no flaky) en CI mientras pasaban siempre en
local. Primer diagnóstico — `REVALIDATE_SECRET` ausente del `env:` del job
`e2e` — era **correcto pero incompleto**: se corrigió (commit `97e548a`) y los
6 tests siguieron fallando idénticos. Investigación más profunda encontró la
causa real: `APP_URL` en `ci.yml` apuntaba a `http://localhost:3001` — el
puerto del **propio backend**, no el del frontend.

`BlogService.callRevalidateEndpoint()` usa `APP_URL` para llamar a `POST
{APP_URL}/api/revalidate` (el Route Handler de Next.js que ejecuta
`revalidateTag('footer-pages')`). Con `APP_URL=:3001`, la petición se
golpeaba a sí misma — Nest tiene `setGlobalPrefix('api')` pero ninguna ruta
`/revalidate`, así que respondía 404 (`"Cannot POST /api/revalidate"`). Como
`fetch()` no rechaza en un 404 (solo en fallos de red) y la llamada es
fire-and-forget sin comprobar `response.ok`, el error se tragaba en
silencio — `revalidateTag` nunca se ejecutaba en CI, así que el footer servía
la caché `unstable_cache` vieja indefinidamente (hasta el TTL de 1h), muy por
encima de lo que esperan los tests.

**Confirmado con evidencia real, no teoría:**
- `curl -X POST http://localhost:3001/api/revalidate?...` → `404 Cannot POST`.
- `curl -X POST http://localhost:3000/api/revalidate?...` → `200
  {"revalidated":true,"tag":"footer-pages"}`.
- Repro end-to-end aislando la variable única: build de producción + `next
  start` (igual que CI) + backend con `APP_URL=:3001` → los 6 tests fallan
  idénticos a CI. Mismo `next start`, mismo build, solo `APP_URL=:3000` → 7/7
  pasan, la revalidación se resuelve en 1-2s sin necesidad de reintentos.
- Esto también descarta las hipótesis alternativas evaluadas: no es timing
  (con `APP_URL` correcto no hace falta esperar más), no es `next start` vs
  `next dev` (el repro usó `next start`, idéntico a CI, y pasó limpio).

**Fix:** `APP_URL: http://localhost:3000` en el `env:` del job `e2e`.

### Protección anti-degradación de ADMIN en cambio de rol (Fase 7)

`PATCH /admin/users/:id/role` acepta `USER`, `MODERATOR` y `EDITOR` como valor
destino (validado en `ChangeUserRoleDto` vía `@IsIn`; `ADMIN` explícitamente excluido
de la lista). Además, `AdminService.changeUserRole()`
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

**`rankingRules`** (actualizado en RÁFAGA 1 — ver política de ordenación C más abajo):
```
[words, typo, proximity, attribute, sort, exactness, sortDate:desc]
```
- `boostScore:desc` **ya no está aquí** (estaba en posición 5, antes de `sort`) — ver
  «Política de ordenación C: boostScore deja de particionar la lista (RÁFAGA 1)».
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

### Política de ordenación C: boostScore deja de particionar la lista (RÁFAGA 1, 2026-07-13)

**Antecedente — decisión implícita, nunca ratificada:** `boostScore:desc` llevaba en
`rankingRules` desde RF.8 (billing), colocado ANTES de `sort`. En Meilisearch cada regla de
`rankingRules` **particiona** los resultados (no solo desempata) — así que, en la práctica, un
destacado quedaba SIEMPRE por delante de cualquier no-destacado, en cualquier ordenación,
incluida "precio: menor a mayor". **Verificado ejecutando** contra el índice real (auditoría
RÁFAGA 0): ordenar por precio ascendente devolvía un destacado de 333 € antes que anuncios sin
destacar de 0 € y 7 €. Esto nunca se decidió conscientemente como política de negocio — fue un
efecto lateral de cómo se implementó el binario `boostScore` en RF.8.

**Decisión tomada (Ernest, 2026-07-13) — Política C, híbrida:**
- La LISTA (`hits`) respeta siempre el orden pedido por el usuario (o la relevancia/recencia por
  defecto). `boostScore` ya NO figura en `rankingRules` — no particiona ni desempata.
- Los destacados que además cumplen los filtros actuales se muestran ADEMÁS en un bloque
  marcado "Promocionados" (`featured` en la respuesta de `GET /search`), arriba de la lista.
  Tamaño fijo: 4 (`FEATURED_BLOCK_SIZE` en `search.controller.ts`). Solo página 1 (mismo criterio
  que el patrocinado H6.6 — un bloque de promoción no tiene sentido en la página 7).
- Los destacados del bloque **se repiten** en su posición natural dentro de `hits` (no se
  excluyen de la lista) — el bloque es la vitrina de pago, la lista es la lista real. Decisión
  consciente, no efecto colateral.

**Cómo (mismo molde que H6.6 patrocinados):** `SearchController.search()` resuelve `hits` con
una query normal (sort del usuario, sin `boostScore` en las ranking rules) y, si `page === 1`,
lanza una SEGUNDA query con los mismos filtros (`baseParams`) + `onlyBoosted: true` (nuevo filtro
`boostScore = 1`, para lo cual `boostScore` pasó a formar parte de `filterableAttributes`) +
`hitsPerPage: FEATURED_BLOCK_SIZE`. El resultado va en `featured`, separado de `hits` — el
conteo (`totalHits`) sale solo de la query principal, así que ni el bloque ni el patrocinado
contaminan el estado vacío ("sin resultados"), igual que ya se cuidaba con el patrocinado.

**Efecto colateral corregido de paso:** la sección "Recién publicados" de la portada
(`search({ sort: 'publishedAt:desc' })`) podía mostrar un destacado publicado hace días por
delante de un anuncio genuinamente nuevo — con `boostScore` fuera de las ranking rules, la
sección vuelve a ser literalmente cierta.

**Frontend:** `FeaturedBlock` (nuevo, `components/busqueda/FeaturedBlock.tsx`) — sección con
icono + "Promocionados" y grid de `ListingCard`, usada en `/busqueda` y `/[categoria]` (ambas
comparten `FavoritesGridProvider` con la unión de ids de `featured` + `hits` para que el corazón
de favoritos funcione también en el bloque). No se añadió a la portada (no pedido en RÁFAGA 1).

**Tests actualizados:** `rf8-meilisearch.e2e-spec.ts` — el caso "destacado aparece primero"
pasó a comprobar que el destacado entra en `featured` sin reordenar `hits` (el desempate ahora
lo decide `sortDate:desc`, así que el más reciente de los dos gana la lista aunque el otro esté
destacado).

**Transparencia P2B — pendiente, no resuelto en esta ráfaga:** sigue sin existir ningún texto o
enlace junto al selector "Ordenar por" que explique que el pago influye en qué aparece en el
bloque "Promocionados". El badge "Destacado" (H6.3) identifica el anuncio, pero no explica el
mecanismo. Inventariado en la auditoría RÁFAGA 0, no forma parte del alcance de esta ráfaga.

### Filtros: validación de atributos por categoría (RÁFAGA 1 — fix del leak cross-categoría)

**Bug encontrado en la auditoría RÁFAGA 0:** `FilterableAttributesResolver` calculaba una unión
plana GLOBAL de los atributos `filterable` de TODAS las categorías, sin distinguir de cuál era
cada uno. Consecuencia: `GET /search?category=coches&rooms=3` (`rooms` es un atributo de
"pisos", no de "coches") pasaba la validación igualmente, se traducía a un filtro Meilisearch
válido, y devolvía 0 resultados **sin explicación** — indistinguible de "no hay coches a ese
precio" para quien lo depure.

**Fix:** `FilterableAttributesResolver` gana `getAttributeTypesForCategory(slug)`, además del
`getAttributeTypes()` global (que se sigue usando para `/busqueda` sin categoría — la unión
global sigue siendo correcta ahí, nada la acota). Ambos comparten una única caché memoizada
(`loadCategories()`, misma invalidación de siempre — sin query extra a Postgres por request, se
mantiene el invariante "búsqueda no toca Postgres"). Resolución:
- **Categoría hoja** (sin hijas): su propio schema + el heredado del padre —
  `resolveEffectiveSchema()`, la misma función que ya resuelve la herencia en
  `CategoriesService.findBySlug`.
- **Categoría padre** (con hijas): unión de su propio schema + el schema efectivo de CADA hija —
  porque `categoryPath = "parentSlug"` en Meilisearch mezcla los anuncios de todas las hijas al
  navegar por el padre (ej. `/vehiculos` mezcla coches+motos+furgonetas), así que un atributo
  propio de una hija (`fuel` de coches) es un filtro legítimo también ahí.
- **Slug desconocido:** mapa vacío — ningún atributo es válido para una categoría que no existe.

`search-query.parser.ts` resuelve el `categorySlug` del núcleo de la query ANTES de validar los
atributos variables, y usa el mapa correspondiente (global o por categoría). Un atributo ajeno a
la categoría pedida da **400** (`property X should not exist`) — se decidió reutilizar
exactamente el mismo camino de error que ya existía para atributos totalmente desconocidos, en
vez de introducir un modo "ignorar con aviso": mantiene un único comportamiento de error en toda
la API y prioriza un fallo honesto sobre uno silencioso (coherente con la auditoría RÁFAGA 0).

**Verificado (e2e):** `rc5-attributes.e2e-spec.ts` — `category=rc5-calzado-test&itemType=...`
(atributo de otra categoría) → 400; el mismo `itemType=...` sin `category` → 200 (unión global);
`category=rc5-tech-parent&itemType=...` (categoría padre, atributo de su hija) → 200. Verificado
también en vivo contra el índice real: `GET /search?category=coches&rooms=3` → 400 antes
devolvía 200 con `totalHits: 0`.

### Provincia: select cerrado en FilterPanel (RÁFAGA 1 — cierra la inconsistencia con la portada)

`FilterPanel.tsx` (usado por `/busqueda` y `/[categoria]`) usaba un `<input type="text">` libre
para provincia; la portada (`SearchBar`) ya usaba un `<select>` con `PROVINCIAS`
(`lib/provincias.ts`). El filtro de provincia es un `=` exacto contra `Listing.province` en
Meilisearch — una errata o variación de mayúsculas/tildes en el texto libre daba 0 resultados
sin ninguna pista. Fix: `FilterPanel` usa ahora el mismo `<select>` con `PROVINCIAS`, aplicando
el cambio inmediatamente (mismo patrón que el selector de categoría/condición, sin estado local
de blur/Enter — ese patrón se conserva solo para "Ciudad", que sigue sin lista canónica). Cierra
la deuda inventariada en H6.4 (`FilterPanel.tsx:405-428`).

### `/[categoria]/[subcategoria]` — ruta muerta eliminada (RÁFAGA 1)

Era un stub sin implementar (`TODO: Listado — {categoria}/{subcategoria}`) desde antes de esta
ráfaga. La navegación real de categorías es plana (`CategoryGrid`/selects enlazan siempre
`/${slug}`, sea la categoría padre o hija — nunca anidan `/padre/hija`); confirmado que nada en
el código enlazaba a esa ruta. Eliminada por ser código muerto que podía confundir al leer el
árbol de rutas; visitarla ahora da 404 (comportamiento correcto para una URL que nunca existió
funcionalmente).

### 3 vistas de resultados configurables por categoría (RÁFAGA 2, 2026-07-13)

**Modelo — `Category.allowedViews`/`defaultView`:** nuevo enum `ListingViewMode` (LISTA |
AMPLIADA | MAPA). `allowedViews ListingViewMode[] @default([])` y `defaultView ListingViewMode?`
— `[]`/`null` significan "no configurado". Mismo criterio de herencia que `allowedListingType`
(no fusión parcial: una config propia reemplaza ENTERA a la del padre) — `resolveEffectiveViews()`
en `category.types.ts`: si `own.allowedViews` no está vacío, manda tal cual (con `defaultView`
por defecto al primer elemento si no se especifica); si está vacío, hereda la del padre ya
resuelto; si tampoco el padre configura nada, cae a `DEFAULT_EFFECTIVE_VIEWS` (las 3, LISTA por
defecto). `CategoriesService.findBySlug` expone `allowedViews`/`defaultView` ya resueltos.
`/busqueda` general no pasa por esta resolución — siempre ofrece las 3 (no hay una categoría
única que las acote).

**Validación de escritura (`admin.service.ts`):** `validateViewsConfig(finalAllowedViews,
finalDefaultView)` — con `allowedViews` vacío, `defaultView` debe ser `null` (400 si no); con
`allowedViews` no vacío, `defaultView` es obligatorio y debe estar entre ellos (400 si no).
Valida el estado FINAL (lo persistido + lo que cambia el PATCH), no solo el body — un PATCH que
solo toca `defaultView` se valida contra el `allowedViews` ya guardado, y viceversa. Caso
especial en `updateCategory`: vaciar `allowedViews` a `[]` sin tocar `defaultView` explícitamente
LIMPIA también `defaultView` a `null` (si no, quedaría huérfano apuntando a una vista ya no
permitida) — sin este auto-clear, un PATCH `{allowedViews: []}` con un `defaultView` previo
persistido fallaba con 400 (encontrado durante el testing de esta ráfaga).

**Admin UI:** `AdminCategoriasPage` — checkboxes de `allowedViews` (al desmarcar la vista que era
la por defecto, la limpia también en el formulario) + select de `defaultView` (solo opciones
marcadas), en el mismo `CategoryForm` que ya edita `allowedListingType`.

**Vista AMPLIADA — atributos:** nuevo flag `wideCardAttribute` en `AttributeField`, INDEPENDIENTE
de `cardAttribute` (que sigue limitado a 2 para la card compacta) — tope de 6, validado con
`validateWideCardAttributeLimit` (mismo mecanismo que `validateCardAttributeLimit`, mismo patrón
de herencia vía `resolveEffectiveSchema`). `CategoriesService` expone `wideCardAttributes` en
`findTree()` (para `/busqueda`, que mezcla categorías) y `findBySlug()` (para `/[categoria]`).
Frontend: segundo contexto/provider independiente (`WideCardAttributesContext`/
`WideCardAttributesProvider`/`WideCardAttrsDisplay`) en el mismo archivo que el existente — dos
mapas separados es más simple de razonar que un contexto con un "modo" parametrizado.
`AttributeSchemaEditor` gana un segundo checkbox (`wideCardAttribute`, tope 6) junto al de
`cardAttribute` (tope 2).

**Vista AMPLIADA — layout:** `ListingCardWide` (nuevo) — foto fija 256px a la izquierda en
desktop (arriba en móvil, `flex-col sm:flex-row`), contenido a la derecha: título, precio,
ubicación, hasta 6 atributos (`WideCardAttrsDisplay`, grid de 2-3 columnas en vez de una línea
truncada), descripción (`TruncatedDescription`, corte a 280 caracteres con "Leer más"/"Leer
menos" expandible — un client island aparte, mismo patrón que `CardAttrsDisplay`, para no forzar
toda la card a ser cliente). Reutiliza `CardPhotoCarousel`/`FavoriteCardButton`/badges/
`formatListingPrice`/`ListingStatusBadge` extraídos a `listing-card-shared.tsx` — `ListingCard`
(estándar) y `ListingCardWide` comparten esa capa, sin duplicar precio/estado/resolución de fotos.

**Fotos en las cards — `CardPhotoCarousel` + `PhotoLightbox` (nuevos, compartidos):**
- **Dato:** `ListingDocument.images: string[]` (nuevo campo, `search.service.ts`) — URLs
  ordenadas de TODAS las fotos (antes solo `thumbnailUrl`, la primera). Requiere **reindexar**
  (`pnpm reindex`) tras desplegar para que los documentos existentes lo tengan — hecho en dev
  durante esta ráfaga. Coste de payload: son solo strings (~100 bytes cada una), no las
  imágenes en sí — el peso real (las fotos) no se paga hasta que el navegador realmente
  solicita una, ver más abajo.
- **RENDIMIENTO (el punto central):** `CardPhotoCarousel` mantiene un `index` de estado y monta
  UN SOLO `<Image>`, el de `images[index]`. En el render inicial `index=0`, así que solo se pide
  la primera foto de cada anuncio — las demás no aparecen en el DOM (ni en el `src` de ningún
  `<img>`) hasta que el usuario pulsa una flecha/punto, momento en el que React monta el
  `<Image>` de ese índice por primera vez y el navegador la pide. No hay ninguna bandera
  "hasInteracted" que gestionar — la pereza sale gratis de renderizar por índice en vez de
  renderizar el array entero con `display:none`. **Verificado en vivo**: se insertaron 3 fotos
  reales a un anuncio de dev, se reindexó, y se inspeccionó el HTML servido por SSR — de los 3
  `<img src>` en la página, los 3 apuntaban a la foto #1; ninguna referencia a las fotos #2/#3
  en ningún sitio del HTML (ni siquiera en `srcSet`) hasta interactuar.
- **Navegación en la card:** flechas (aparecen al hover, mismo `group` del `<Link>` que ya
  envolvía la card — sin grupo anidado) + puntos indicadores. `e.preventDefault()` +
  `e.stopPropagation()` en cada control (mismo patrón que `FavoriteCardButton`) para no disparar
  la navegación del `<Link>` que envuelve toda la card.
- **Visor a pantalla completa:** `PhotoLightbox` — overlay oscuro, Escape/backdrop cierran,
  flechas de teclado, contador "N / total", monta también un único `<Image>` por vez (mismo
  criterio de pereza que la card).
- **`sizes`/`priority`:** `ListingCard`/`ListingCardWide` reciben un `priority` opcional; las
  páginas lo pasan como `i < 4` (primera fila de la parrilla) al iterar `hits`.

**Selector de vista — `ViewSwitcher` (nuevo) + persistencia en URL:** ofrece solo las
`allowedViews` de la categoría (o las 3 en `/busqueda`) — la categoría define el menú, el
usuario elige del menú. La vista viaja en `?view=lista|ampliada|mapa` (`lib/view-mode.ts`:
`resolveCurrentView()` cae a `defaultView` si el parámetro es inválido, ausente, o no está
permitido — nunca se acepta en silencio una vista fuera del menú). Decisión: URL, no
localStorage — coherente con el resto de filtros, y un enlace compartido conserva la vista con
la que se miró el resultado. `/[categoria]` ganó soporte de mapa por primera vez en esta ráfaga
(antes solo tenía lista); en modo fallback (Meilisearch caído) se fuerza LISTA — mapa/ampliada
dependen de datos (`images`, `_geo`) que el fallback a Postgres no garantiza igual.

**Mapa más grande:** `MapView.tsx` — alto fijo 520px → `sm:h-[calc(100vh-260px)]
sm:min-h-[520px] sm:max-h-[900px]` (viewport-relativo con suelo = tamaño anterior y techo para
pantallas muy altas; sin cambios en escritorio pequeño/móvil, que se queda en 520px). Solo
layout — el clustering de marcadores (H6.5b) no cambia.

**Bug pre-existente encontrado y arreglado — `pnpm reindex` roto:** `ReindexModule` (módulo
mínimo del comando standalone, sin BullMQ) nunca importaba `RedisModule`/`R2Module`. Desde H6.6,
`SearchController` inyecta `SponsoredAdsService`, que depende de `RedisService` (caché) y
`R2Service` (subida de banner) — ambos `@Global()` pero nunca importados aquí, así que
`createApplicationContext` fallaba con "Nest can't resolve dependencies of SponsoredAdsService"
(Nest instancia igual el controller declarado por `SearchModule` aunque el script solo use
`SearchService`). No se detectó hasta esta ráfaga porque nadie había re-ejecutado `pnpm reindex`
desde H6.6. Fix: importar ambos módulos + apagar explícitamente el cliente ioredis
(`RedisService.client.quit()`) al final de `bootstrap()` — el script nunca llama a
`app.close()` (ver comentario ya existente sobre el crash de Prisma/libuv en Windows), así que
el hook `OnApplicationShutdown` de `RedisService` no se dispara solo; sin el `quit()` explícito
el proceso se habría quedado colgado por la conexión TCP abierta. `R2Service` no necesitó nada
análogo (cliente S3 sobre HTTP, sin socket persistente).

**Tests:** `category.types.spec.ts` (5 casos `resolveEffectiveViews`), `admin-category-views.e2e-spec.ts`
(18 casos: guards de escritura, tope wideCardAttribute con herencia, resolución efectiva con
herencia vía `GET /categories/:slug`), `search-images.e2e-spec.ts` (2 casos: orden de `images`
por `order` no por inserción, anuncio sin fotos → `[]`). Batería completa verificada: 55 suites
backend / 860 tests, suite frontend (13 suites — los 3 fallos existentes en `BlockEditor`/
`BlockRenderer`/`PublicarWizard` son pre-existentes, confirmados con `git stash` sobre archivos
anteriores a esta ráfaga, no causados por ella). QA visual con Playwright (headless, sin
`chromium-cli` disponible): las 3 vistas, carrusel con flechas+puntos, visor a pantalla completa,
mobile 390px sin overflow horizontal — cero errores de consola/página en todo el recorrido.

### Display de atributos en card: showLabel/showUnit configurables (RÁFAGA 3, 2026-07-13)

**Regla hardcodeada sustituida:** antes de esta ráfaga, `CardAttrsDisplay`/`WideCardAttrsDisplay`
(frontend) decidían el formato con una regla implícita fija: si el atributo tenía `unit`, se
mostraba solo "valor unidad" (sin nombre); si no tenía, "Label: valor". No era configurable ni
estaba en el schema — vivía como lógica de renderizado.

**Diseño — dos ejes independientes, no un enum de 3 modos:** `showLabel` (¿se antepone el
nombre?) y `showUnit` (¿se añade la unidad al valor?) son ortogonales — la unidad no es una
alternativa al nombre, es parte del valor formateado. Con dos booleanos salen las 4
combinaciones (las 3 pedidas + "nombre y unidad juntos", que probablemente también se quiere):
"Kilometraje: 150.000 km" / "150.000 km" / "Habitaciones: 3" / "3". Validado contra el modelo
actual antes de implementar: `unit` ya vivía como campo independiente de `cardAttribute` en
`AttributeField` — nada en el modelo desaconsejaba el diseño de dos flags.

**Modelo — mismo sitio que `cardAttribute`/`wideCardAttribute`:** `AttributeField.showLabel?:
boolean` y `showUnit?: boolean` (`category.types.ts`). Ausentes → default calculado, NO
booleanos planos con default `false` (a diferencia de `cardAttribute`): `resolveShowLabel(field)
= field.showLabel ?? !field.unit` y `resolveShowUnit(field) = field.showUnit ?? true` —
reproduce EXACTAMENTE la regla hardcodeada anterior, así que los ~50 atributos ya configurados
en las 17 categorías con schema (7 de ellas con unidad: casas, coches, locales, motos, pisos,
vehiculos, + una duplicada) no cambian de aspecto sin que nadie los toque.

**Dónde se resuelve:** `CategoriesService.toAttrDef()` (ambas instancias, `findTree` y
`findBySlug`) aplica `resolveShowLabel`/`resolveShowUnit` al construir `cardAttributes`/
`wideCardAttributes`/`allAttributes` — igual que ya resolvía `key`/`label`/`unit`. El campo
`attributeSchema` (schema efectivo crudo, sin pasar por `toAttrDef`) NO lleva estos valores
resueltos — ausentes ahí si no se configuraron, exactamente como ya pasaba con `cardAttribute`/
`wideCardAttribute` antes de esta ráfaga (encontrado escribiendo el e2e: un primer intento de
test comprobaba `showLabel`/`showUnit` sobre `attributeSchema` directamente y fallaba con
`undefined` — la resolución solo vive en las listas derivadas, no en el schema crudo).
`/[categoria]/page.tsx` construye sus mapas desde `attributeSchema` crudo (no desde una lista
pre-resuelta) → `card-attributes.ts` (frontend) duplica el mismo cálculo de default en un
`toAttrDef` local, mismo patrón de duplicación ya existente para `cardAttribute`/`unit` sin
paquete compartido entre `apps/api`/`apps/web`.

**Frontend — reemplazo de la regla:** `formatAttrValue(value, unit, showUnit)` ya no decide "con
unidad, sin nombre" — el join final decide `showLabel ? "Label: valor" : valor` leyendo el flag
resuelto. Aplica igual a `CardAttrsDisplay` (card estándar) y `WideCardAttrsDisplay` (ampliada,
RÁFAGA 2) — es config del atributo, no de la vista. El panel de atributos del mapa
(`MapView.tsx`'s `getAllAttrs`) tiene su PROPIA regla, distinta y siempre fija ("Label: valor",
nunca omite el nombre) — no tocado, fuera del alcance pedido ("aplica a AMBAS cards").

**Admin UI:** `AttributeSchemaEditor` — dos checkboxes nuevos (`showLabel`, `showUnit`) junto a
`cardAttribute`/`wideCardAttribute`; `showUnit` solo se muestra si el atributo tiene unidad
(moot sin ella). Vista previa en vivo bajo los checkboxes ("Vista previa: Kilometraje: 150.000
km") con un valor de ejemplo, actualizada en cada toggle. Serialización: mismo patrón que
`appliesTo` (RÁFAGA 1) — `showLabel`/`showUnit` solo se escriben en el JSON si DIFIEREN del
default calculado a partir de la unidad actual del draft; si el admin nunca toca los checkboxes,
el atributo se guarda byte-idéntico a antes de esta ráfaga.

**Tests:** `category.types.spec.ts` (+6 casos `resolveShowLabel`/`resolveShowUnit`),
`CardAttributesContext.test.tsx` (nuevo — 11 casos: las 4 combinaciones en ambas cards + atributo
sin unidad con showUnit:true no rompe + valor ausente no renderiza), `AttributeSchemaEditor.
showLabelUnit.test.tsx` (nuevo — 5 casos: defaults por atributo con/sin unidad, byte-identidad al
no tocar los checkboxes, las 4 combinaciones vía preview, dato preexistente tolerado),
`categories-attribute-display.e2e-spec.ts` (nuevo — 5 casos: default con/sin unidad, overrides
explícitos de cada flag, herencia). Batería completa: 56 suites backend / 865 tests, frontend 15
suites (mismos 3 fallos pre-existentes de RÁFAGA 2, no relacionados). **QA en vivo — la prueba
central de esta ráfaga:** se comparó la categoría real `casas` (con atributos `sqm` con unidad y
`rooms` sin unidad) antes/después — captura de pantalla de `/busqueda` PIXEL-IDÉNTICA a la de
RÁFAGA 2 ("casota 2" sigue mostrando "3 m² · Habitaciones: 3", byte por byte); confirmado también
consultando `GET /categories` en vivo que `sqm` resuelve a `showLabel:false, showUnit:true` y
`rooms` a `showLabel:true, showUnit:true` sin haber tocado ningún dato existente.

### Dos bugs de RÁFAGA 2 encontrados y corregidos de raíz (2026-07-13)

**BUG 1 — el visor de fotos (lightbox) navegaba a la ficha con cualquier click:**
`ListingCard`/`ListingCardWide` envuelven TODA la card en un `<Link>` a `/anuncio/[slug]`;
`PhotoLightbox` se montaba como hijo normal de ese árbol (dentro de `CardPhotoCarousel`, dentro
del `<Link>`). Aunque los botones del visor ya llamaban a `stopPropagation()`, eso no bastaba: la
navegación de un `<a>` al hacer click es la acción POR DEFECTO del NAVEGADOR, gobernada por
`preventDefault()` — no por si el evento sigue burbujeando — y ningún botón del visor lo llamaba.
**Confirmado en vivo con Playwright** antes de tocar nada: click en "Cerrar" navegaba igual a
`/anuncio/...` pese al `stopPropagation()`.

**La cura (no el parche):** `PhotoLightbox` ahora se monta con `createPortal` en
`document.body` — fuera del `<a>` a efectos del DOM real, así que el navegador ya no tiene
ninguna relación de ancestro/descendiente que le haga considerar "esto es un click dentro de un
enlace" y su navegación NATIVA queda eliminada de raíz.

**Matiz encontrado escribiendo el test (no solo con la QA en vivo):** React vuelve a
"reenganchar" un portal AL ÁRBOL DE REACT (no al del DOM) para el burbujeo de sus eventos
sintéticos — un test unitario con `fireEvent.click` directamente sobre el backdrop demostró que,
pese al portal, el `onClick` de React del `<a>` (el que usa `next/link` para navegar
programáticamente vía `router.push`) SEGUÍA disparándose, porque el backdrop pasaba `onClick=
{onClose}` directo, sin `stopPropagation()`. Se corrigió envolviéndolo igual que el resto de
controles del visor. Conclusión correcta y completa: el portal elimina el riesgo de navegación
NATIVA del navegador (la causa más visible y la que motivó el reporte); `stopPropagation()` en
cada manejador (ya presente en X/prev/next, añadido al backdrop) elimina el riesgo de navegación
PROGRAMÁTICA vía React/Next — hacen falta las dos cosas, no una sola. Verificado también con
`document.elementFromPoint` en vivo: el visor deja de tener un `<a href>` en su cadena de
ancestros; el right-click sobre la foto ahora da el menú contextual normal del navegador (antes,
al estar la imagen dentro de un enlace, podía mezclar opciones de "abrir enlace").

**Carrusel DENTRO de la card (flechas para pasar foto sin ampliar) — evaluado, no tenía el
bug:** ya llamaba a `preventDefault()` + `stopPropagation()` en el mismo `go()` (ver
`CardPhotoCarousel.tsx`) — confirmado en vivo (Playwright) y con test unitario que las flechas/
puntos de la card NO navegan. No necesitaba cambios; vive dentro de la card a propósito (las
flechas deben posicionarse sobre la foto, no tiene sentido un portal ahí).

**BUG 2 — los atributos no se veían en las cards de /[categoria] (categorías PADRE):**
confirmado que NO reproducía en categorías hoja (`/casas`, `/coches` mostraban los atributos
correctamente) — reproducía específicamente al navegar una categoría PADRE (p. ej. `/vehiculos`,
que mezcla anuncios de sus hijas coches/motos/furgonetas vía `categoryPath` de Meilisearch).
Causa: `/[categoria]/page.tsx` construía el mapa de atributos con
`buildCardAttributeMapFromSchema(categoria, category.attributeSchema)` — una entrada ÚNICA,
keyeada por el slug de la URL ("vehiculos"). Cada listing mostrado trae su PROPIO `categorySlug`
de hoja ("coches", "motos"...), que no existía como clave en ese mapa de una sola entrada →
`CardAttrsDisplay` no encontraba nada → sin atributos. `/busqueda` no tenía este problema porque
ya construye el mapa desde el ÁRBOL COMPLETO (`getCategories()` + `buildCardAttributeMap`), con
una entrada por CADA categoría (padres y hojas) — dos caminos de datos para lo mismo, uno se
quedó corto.

**Arreglo — unificado a una sola fuente, no dos espejos:** `/[categoria]/page.tsx` ahora también
llama a `getCategories()` (en paralelo, propia promesa fuera del try/catch de búsqueda para que
esté disponible también en el modo fallback a Postgres) y usa
`buildCardAttributeMap`/`buildWideCardAttributeMap`/`buildFullAttributeMap` — EXACTAMENTE los
mismos builders y la misma fuente de datos que `/busqueda`. Verificado en vivo: comparación
byte-a-byte entre `/vehiculos` y `/busqueda?category=vehiculos` — el mismo listado de atributos
(mismos conteos de "Marca: X", "N km", etc.), confirmando que ambos caminos convergen.
`buildCardAttributeMapFromSchema`/`buildWideCardAttributeMapFromSchema`/
`buildFullAttributeMapFromSchema` (los builders de una sola entrada) quedaron sin uso en esta
página tras el cambio — `buildWideCardAttributeMapFromSchema` y `buildFullAttributeMapFromSchema`
se ELIMINARON de `card-attributes.ts` (código muerto); `buildCardAttributeMapFromSchema` se
CONSERVÓ porque `/anuncio/[slug]` (ficha + relacionados) sigue usándola legítimamente — ahí todos
los listings mostrados (el actual y sus relacionados, pedidos filtrando por
`listing.category.slug`) comparten SIEMPRE la misma categoría, así que no hay riesgo de mezcla de
categorías como el que sí había en `/[categoria]`.

**Otras posibles divergencias revisadas (pedido explícito de la ráfaga) — ninguna más
encontrada:** destacados del bloque "Promocionados" (`featured`), patrocinados
(`isSponsoredAdHit`), conteo (`totalHits`) — los tres vienen de la MISMA respuesta de
`GET /search` en ambas páginas, sin caminos separados. La única divergencia real de "vistas"
(`/busqueda` ofrece las 3 siempre; `/[categoria]` usa `category.allowedViews`) es intencional
(RÁFAGA 2 — la categoría define el menú), no un bug.

**Tests:** `CardPhotoCarousel.test.tsx` (nuevo — 9 casos: el visor se monta en `document.body`
sin ser descendiente del `<a>`; abrir/cerrar (X, backdrop, Escape)/navegar (flechas, teclado) no
disparan el `onClick` del `<a>` padre; el carrusel de la card tampoco lo dispara). `card-
attributes.test.ts` (nuevo — 5 casos: el árbol da una entrada independiente por cada categoría,
padre Y cada hija, con `buildCardAttributeMap`/`buildWideCardAttributeMap`/
`buildFullAttributeMap`). Batería completa: frontend 17 suites (mismos 3 fallos pre-existentes de
RÁFAGA 2, no relacionados — 147 tests propios en verde); sin cambios en backend, no se re-ejecutó
la suite completa de e2e (`git status` confirma que ningún archivo de `apps/api` cambió). **QA en
vivo (Playwright, ambos bugs):** reproducidos ANTES del fix (navegación real a `/anuncio/...` al
cerrar el visor; `/vehiculos` sin atributos) y verificados DESPUÉS (visor usable de punta a
punta incl. botón derecho; `/vehiculos` con atributos idénticos a `/busqueda?category=vehiculos`).

### Atributos en card: respetar producto/servicio (2026-07-13)

**El mecanismo ya existía, faltaba que los topes y el renderizado lo respetaran.**
`appliesTo?: ListingType[]` en `AttributeField` (backend) y en `AttributeSchemaEditor`
(checkboxes "Producto"/"Servicio", RÁFAGA 1 del wizard) ya distinguía qué atributos aplican a
qué tipo de anuncio; `filterSchemaByType()` ya lo usaba en `/anuncio/[slug]` (ficha) y en el
wizard de publicar. Lo que faltaba: (1) que la VALIDACIÓN del tope de card (2 estándar / 6
ampliada) contara POR TIPO en vez de globalmente, y (2) que las CARDS (no la ficha) filtraran qué
atributos mostrar según el tipo del anuncio — hasta ahora, `CardAttrsDisplay`/
`WideCardAttrsDisplay` mostraban TODOS los atributos configurados para la categoría, sin mirar
`appliesTo` ni el `type` del anuncio.

**El problema central — el tope no se puede validar globalmente:** 2 atributos marcados
`cardAttribute:true` con `appliesTo:['PRODUCT']` + 2 con `appliesTo:['SERVICE']` son 4 en total,
pero NINGÚN anuncio ve más de 2 (uno de producto ve 2, uno de servicio ve 2). La validación
correcta es "máx. 2 que apliquen a PRODUCT" Y "máx. 2 que apliquen a SERVICE" por separado; un
atributo sin `appliesTo` (aplica a ambos) cuenta en las dos cuentas. Igual para el máx. 6 de la
card ampliada.

**Backend — validación por tipo:** nueva `countAttributesByType(schema, flag)` en
`category.types.ts` (con tests en `category.types.spec.ts`), que cuenta por separado
`PRODUCT`/`SERVICE` para `cardAttribute`/`wideCardAttribute`. `admin.service.ts` unificó
`validateCardAttributeLimit`/`validateWideCardAttributeLimit` en una única
`validateCardAttributeLimitByType(schema, parentId, flag, limit)` que usa esta cuenta y lanza un
`BadRequestException` nombrando el tipo que excede (p. ej. "El schema efectivo tiene 3 atributos
de tipo producto con cardAttribute:true pero el máximo permitido es 2") — mismo formato que el
mensaje anterior (conserva `cardAttribute:true`/`máximo...N` para no romper los e2e existentes que
matcheaban ese texto), con el tipo insertado. 5 tests e2e nuevos en `rc5-attributes.e2e-spec.ts`:
2 PRODUCT + 2 SERVICE (4 en total) → 201; 3 de PRODUCT → 400 nombrando "producto"; un atributo
"ambos" sumando al tercero de producto → 400; el mismo mecanismo para `wideCardAttribute` (3+3=6
en total) → 201.

**Backend — `appliesTo` se perdía en el camino API→card:** `categories.service.ts` construye
`cardAttributes`/`wideCardAttributes`/`allAttributes` (los que consume el frontend) con una
función `toAttrDef()` que resuelve `showLabel`/`showUnit` pero NUNCA propagaba `appliesTo` —
así que aunque el schema crudo lo tuviera, la card no tenía forma de saber a qué tipo aplicaba
cada atributo. Corregido en `findTree()` (árbol de `/categories`) y `findBySlug()` (schema
efectivo de una categoría) para incluir `appliesTo` cuando está presente. Nuevo test e2e
confirma que `GET /categories` (árbol) expone `appliesTo` en `cardAttributes`.

**Backend — el fallback a Postgres no traía el `type` del anuncio:** `SELECT_SUMMARY` en
`listings.service.ts` (usado por `findByCategory`/`findBySellerSlug`/`findRecent`/etc., el
fallback cuando Meilisearch no está disponible) no incluía `type`. Añadido `type: true` — el
documento de Meilisearch YA lo indexaba (`toDocument()`, sin cambios), pero el camino de Postgres
se había quedado corto, sería una divergencia latente entre ambos caminos si Meili cae. `type`
fluye ahora igual en ambos.

**Frontend — filtrado en las cards por tipo del anuncio:** `CardAttributeDef` (tipo) y
`ListingSummary` ganan `appliesTo`/`type` respectivamente. Nueva `filterDefsByListingType(defs,
listingType)` en `lib/card-attributes.ts` (ausente `appliesTo` en el def = aplica a ambos;
ausente `listingType` en el anuncio = no filtra, defensivo). `CardAttrsDisplay`/
`WideCardAttrsDisplay` (`CardAttributesContext.tsx`) y `getAllAttrs()` (panel de detalle del
mapa, `MapView.tsx`) la aplican antes de formatear. `ListingCard`/`ListingCardWide` pasan
`listingType={listing.type}`. Cubre los 3 sitios que muestran atributos de card: estándar,
ampliada y el panel de la vista Mapa.

**Admin UI — cuentas por tipo, no un tope global:** `AttributeSchemaEditor.tsx` dejó de
deshabilitar `cardAttribute`/`wideCardAttribute` por una cuenta global (`inheritedCardCount +
otherOwnCard >= 2`); ahora `countByType()` (mismo cálculo que el backend, duplicado por la
ausencia de paquete compartido api/web) cuenta solo los tipos a los que aplica el atributo EN
EDICIÓN (`draft.appliesTo`) — marcar un atributo SERVICE-only nunca se bloquea porque PRODUCT ya
llegó al tope. Nueva línea siempre visible bajo los checkboxes: "Card estándar — Producto: X/2 ·
Servicio: Y/2 · Card ampliada — Producto: X/6 · Servicio: Y/6", verificada en vivo editando la
categoría de prueba (ver QA abajo). No se implementó la simplificación opcional para categorías
de un solo tipo (`allowedListingType` PRODUCT_ONLY/SERVICE_ONLY) — las cuentas del tipo no
aplicable simplemente se quedan en 0/N, informativo pero no confuso; queda como posible pulido
futuro, no bloqueaba el cierre de esta ráfaga.

**Hallazgo colateral (NO corregido, fuera de alcance) — `normalizeHit()` en
`search.controller.ts` solo incluye en `attributes` los campos FILTRABLES.** Encontrado
verificando en vivo: una categoría de prueba con `km`/`specialty` marcados `cardAttribute:true`
pero `filterable:false` mostraba `attributes: {}` en los hits de `/search` — el bucle que
construye `attrs` en `normalizeHit()` itera `attributeTypes.keys()` (el mapa de
`FilterableAttributesResolver`, que solo incluye atributos con `filterable:true`). Un atributo
puramente decorativo (cardAttribute sin necesidad de ser también filtro) nunca llegaría a
mostrarse en `/busqueda`/`/[categoria]` aunque SÍ se vería en `/anuncio/[slug]` (que lee
`listing.attributes` directo de Postgres, sin pasar por `normalizeHit`). No se reprodujo con
datos reales del seed (todo cardAttribute existente ya era también filterable), así que es un
bug latente, no uno con síntoma visible hoy — anotado aquí para no perderlo, corrección fuera del
alcance de esta ráfaga.

**Tests:** `category.types.spec.ts` (+4 casos `countAttributesByType`), `rc5-attributes.e2e-spec.ts`
(+5 casos validación por tipo +1 caso `appliesTo` en el árbol), `card-attributes.test.ts` (+3 casos
`filterDefsByListingType`), `CardAttributesContext.test.tsx` (+4 casos listingType en ambas
cards), `AttributeSchemaEditor.cardLimitByType.test.tsx` (nuevo, 5 casos: tope por tipo no
global, incl. el caso central del bug con 4 marcados/2+2 por tipo, y las cuentas mostradas).
Batería completa: backend 56 suites / 870 tests e2e (`npm run test:e2e`, serial —
**importante: sin `--runInBand` los workers en paralelo corrompen estado compartido de
Postgres/Redis entre suites**, confirmado al reproducir 765 fallos espurios con `jest
--config test/jest-e2e.json` a secas antes de usar el script correcto) + 102 tests unitarios,
todos verdes; frontend 18 suites / 169 tests (159 verdes, mismos 10 fallos pre-existentes
confirmados idénticos vía `git stash` contra la rama base — "invariant expected app router to be
mounted" en tests de `BlockRenderer`/`BlockEditor`/`PublicarWizard`, no relacionados con este
cambio). **QA en vivo:** categoría de prueba con `km` (solo PRODUCTO, cardAttribute+
wideCardAttribute), `specialty` (solo SERVICIO, ídem) y `brand` (ambos, wideCardAttribute); un
anuncio de cada tipo. Confirmado con Playwright que la card de PRODUCTO muestra "85000 km" y
NUNCA "Especialidad", y la de SERVICIO muestra "Especialidad: Fontanería" y NUNCA el
kilometraje — en vista estándar Y ampliada, en `/busqueda?category=X` Y `/X` (mismo HTML,
confirma que los caminos siguen convergiendo tras el bug 2 de la ráfaga anterior). Editor de
atributos del admin verificado en vivo mostrando "Card estándar — Producto: 1/2 · Servicio: 1/2 ·
Card ampliada — Producto: 2/6 · Servicio: 2/6" para la categoría de prueba.

### Auditoría — herencia de atributos en categorías + dos bugs de filtros (2026-07-13)

**Encargo:** mapear TODOS los sitios donde la herencia padre→hija de atributos debería
aplicar y verificar cada uno EJECUTANDO (categoría padre con atributo propio `fuel` +
categoría hija con atributo propio `gearbox`, un anuncio real publicado en la hija), sin
tocar código en esta parte. Aparte, arreglar dos bugs acotados de filtros si eran limpios.

#### Parte 1 — mapa de la herencia (auditoría, sin cambios de código)

**El algoritmo de fusión NO está duplicado — `resolveEffectiveSchema()` (category.types.ts)
es la única función que fusiona schema propio + del padre, y la reutilizan sin excepción:**
`admin.service.ts` (validación de topes), `categories.service.ts` (`findTree`/`findBySlug`,
lo que consume `/busqueda`, `/[categoria]`, el wizard y la ficha), `listings.service.ts`
(`create`/`update`, validación de atributos al guardar) y
`filterable-attributes.resolver.ts` (validación de query params). Lo que SÍ está duplicado
es la construcción del INPUT de esa función: 5 sitios independientes hacen su propia
consulta Prisma para obtener "schema propio + schema del padre" (mismo patrón que
reindexado ×3 / concesión de destacado ×4 mencionados en la sesión) — hoy consistentes
porque los 5 asumen exactamente 1 nivel, pero es un punto de fricción si el modelo de
profundidad cambia (ver hallazgo de 3 niveles más abajo).

Tabla de verificación (todo ejecutado en vivo, categoría padre `audit-vehiculos` con
`fuel`, hija `audit-coches` con `gearbox`, un anuncio PRODUCT publicado en la hija con
`{fuel:'diesel', gearbox:'manual'}`):

| Punto | ¿Hereda correctamente? | Evidencia / causa |
|---|---|---|
| (a) Formulario de publicar | ✅ Sí | `GET /categories/:slug` (`findBySlug`) devuelve `attributeSchema` ya fusionado (`["fuel","gearbox"]`); el wizard lo consume tal cual. |
| (b) Filtros en `/[categoria-hija]` | ✅ Sí, **con matiz importante** | El FilterPanel no lee `attributeSchema` en absoluto: renderiza un control por cada *facet* que devuelve Meilisearch. La inherencia en sí funciona (confirmado con `fuel`/`gearbox`, ambos aparecieron), pero **`facets` viene de `FACET_ATTRIBUTES`, una lista editorial fija en `search.service.ts`** (`categorySlug, type, condition, priceType, province, fuel, gearbox, rooms, gender, modality, itemType`) — NO derivada del schema. Un atributo definido por un admin fuera de esa lista (probado con `km`: `filterable:true`, propio Y heredado) nunca genera facet, así que el FilterPanel JAMÁS ofrece un control para él — el backend SÍ acepta `?km=50000` (200), pero no hay forma de que el usuario lo escriba desde la UI. Esto no es un bug de herencia: afecta IGUAL a un atributo propio que a uno heredado, y es probablemente la causa real detrás de "no parece funcionar demasiado bien" para cualquier categoría con atributos fuera del seed original. |
| (c) Validación de query params | ✅ Sí | `?category=audit-coches&fuel=diesel` → 200 (heredado); `&gearbox=manual` → 200 (propio); `?category=audit-vehiculos&gearbox=manual` (atributo de la HIJA, navegando el PADRE) → 200 (unión correcta vía `getAttributeTypesForCategory`); `?category=audit-coches&rooms=3` (ajeno) → 400. Los 4 casos correctos. |
| (d) Cards en `/busqueda` y `/[categoria]` | ✅ Sí | `GET /categories` (árbol) da a la hija su propia entrada `cardAttributes:["fuel","gearbox"]` (no solo las suyas). Confirmado en vivo en las 4 combinaciones (`/busqueda?category=hija`, `/hija`, `/busqueda?category=padre`, `/padre`): las 4 muestran "Combustible: diesel · Cambio: manual". |
| (e) Ficha `/anuncio/[slug]` | ✅ Sí | Misma fuente que (a) (`findBySlug` + `filterSchemaByType`), confirmado en vivo. |
| (f) Alertas | ❌ **No — bug real, no relacionado con herencia** | `AlertsService.create()`/`update()` llaman a `attributesResolver.getAttributeTypes()` (mapa GLOBAL, plano, de TODAS las categorías) en vez de `getAttributeTypesForCategory(dto.categorySlug)` — a pesar de que `dto.categorySlug` está disponible. Confirmado en vivo: crear una alerta con `categorySlug: 'audit-coches'` y `attributes: {rooms: 3}` (atributo de "pisos", sin ninguna relación con vehículos) devuelve **201** — la MISMA combinación en `/search` devuelve 400. Es exactamente el "cross-category leak" que RÁFAGA 1 arregló para `/search` (`getAttributeTypesForCategory` en vez del mapa plano) pero nunca se replicó en alertas. No corregido en esta ráfaga (no es "herencia rota", es "falta aplicar el mismo fix de RÁFAGA 1 en un segundo sitio") — recomendado para una ráfaga futura, cambio pequeño y acotado. |
| (g) Admin UI (config. de la hija) | ✅ Sí | `AttributeSchemaEditor` muestra "HEREDADOS DE {padre}" con `fuel` (badge "heredado") y "PROPIOS" con `gearbox`, verificado en vivo con captura de pantalla. |

**Profundidad — el modelo permite N niveles, la resolución solo cubre 2 (bug latente,
no alcanzable desde la UI normal):** `Category.parentId` es una auto-relación sin
límite de profundidad en el schema de Prisma ni en `create-category.dto.ts`/
`admin.service.ts` (nada valida que `parentId` no apunte a una categoría que YA
tiene padre). La UI del admin (`admin/categorias/page.tsx`) SÍ impone 2 niveles
estructuralmente — el botón "Nueva subcategoría" solo se renderiza para categorías
raíz, nunca para una fila de hijo — así que un admin normal no puede crear un nieto.
Pero un POST directo a `/admin/categories` con `parentId` = el id de una hija YA
creada lo consigue sin ningún error (probado en vivo: 201). Consecuencias
confirmadas: (1) `GET /categories` (`findTree`) solo recorre raíces + `children` de
un nivel — el nieto **desaparece por completo** del árbol, sin entrada en
`cardAttributes`/`wideCardAttributes`/`allAttributes` en ningún nodo — cualquier
anuncio publicado ahí no mostraría NINGÚN atributo de card, reproduciendo el bug de
"/vehiculos sin atributos" de la ráfaga anterior pero a un nivel invisible para el
fix ya aplicado (que asume 2 niveles). (2) `findBySlug` (usado por el wizard y la
ficha) SÍ resuelve el nieto, pero solo 1 nivel hacia arriba (fusiona con el
schema PROPIO del padre inmediato, no con el schema YA EFECTIVO del padre) — el
nieto pierde los atributos del ABUELO por completo (`attributeSchema` del nieto
salió `["gearbox","km","turbo"]`, sin `fuel`). No es un crash ni un 500: los datos
simplemente se pierden en silencio. No corregido (fuera de alcance explícito de
esta ráfaga — "la herencia no se arregla en esta ráfaga"); recomendación: o bien
prohibir explícitamente `parentId` de un padre que ya tiene padre (mantener 2
niveles como invariante real, no solo de UI), o generalizar `resolveEffectiveSchema`
a N niveles si el negocio necesita 3+ algún día. Dado que la UI ya impone 2 niveles
en la práctica, la opción barata es la validación defensiva en el backend.

**Recomendación de unificación (no implementada, para una futura ráfaga):** el
algoritmo de fusión ya está unificado (`resolveEffectiveSchema`); lo que vale la pena
centralizar es (1) el FETCH de "propio + padre" — hoy 5 consultas Prisma
independientes podrían pasar por un único `CategorySchemaResolver.getEffective(id)`
que además prohíba profundidad > 2 en el mismo sitio; (2) derivar `FACET_ATTRIBUTES`
del schema real (unión de todos los `filterable:true`) en vez de mantener una lista
editorial que se queda corta en cuanto un admin define un atributo nuevo; (3)
replicar en `AlertsService` el fix de RÁFAGA 1 (`getAttributeTypesForCategory`).

#### Parte 2 — dos bugs acotados (código SÍ tocado)

**BUG A — sin forma de acotar de una categoría padre a una hija.** La navegación de
categorías es plana (`CategoryGrid` enlaza `/{slug}` tanto para padres como para
hijas; el stub `/[categoria]/[subcategoria]` ya se había borrado en RÁFAGA 1) y
`FilterPanel` en `/[categoria]` se invocaba con `categories={[]}` (comentario
explícito: "la categoría ya está fija en la URL"), ocultando también el selector de
categoría que en `/busqueda` SÍ ofrece las hijas vía `<optgroup>`. **Arreglado** con
un selector de "Subcategoría" nuevo y separado (no reutiliza el selector de
categoría) en `FilterPanel.tsx`: aparece solo cuando la categoría fija de la página
tiene hijas (prop `subcategories`, calculada en `/[categoria]/page.tsx` a partir del
árbol de `getCategories()` que la página ya pedía para el bug de atributos de la
ráfaga anterior — sin fetch nuevo). Elegir una hija navega con `router.push` a
`/{slug de la hija}` **arrastrando los filtros ya aplicados** (mismos query params,
`page` descartado) — decidido así en vez de un query param porque una hija siempre
tiene al menos los atributos heredados del padre, así que ningún filtro se invalida
al navegar hacia abajo en la jerarquía. Verificado en vivo: desde
`/audit-vehiculos?province=Madrid`, elegir "Audit Coches" navega a
`/audit-coches?province=Madrid` (filtro conservado); una categoría hoja (sin hijas)
no muestra la sección. `/busqueda` no necesitaba cambios — su propio selector de
categoría ya ofrecía las hijas (confirmado, sin bug ahí).

**BUG B — el filtro "Condición" (estado de conservación) aparece para servicios,
donde no aplica.** Mismo patrón que el bug de atributos de card de la ráfaga
anterior, pero para un filtro NATIVO en vez de uno de categoría. Revisada la lista
completa de filtros nativos de `FilterPanel`: orden, proximidad, categoría, tipo,
condición, precio, ubicación — **condición es el único que no aplica a servicios**
(un servicio no tiene estado de conservación físico). `priceType` (FIXED/FREE/
NEGOTIABLE) SÍ aplica igual a ambos tipos (un servicio puede ser gratuito, de precio
fijo o a convenir, igual que un producto) — no necesitaba cambio. **Arreglado**: (1)
`FilterPanel.tsx` oculta "Condición" cuando `allowedListingType === 'SERVICE_ONLY'`
(categoría fija de solo-servicio) O cuando `currentFilters.type === 'SERVICE'`
(categoría mixta o `/busqueda` general, con el usuario filtrando explícitamente por
servicios) — decidido cubrir ambos casos, no solo el de categoría fija. El radio
"Servicios" también limpia `condition` de la URL al seleccionarse (mismo
comportamiento que `StepDatos.tsx` en el wizard de publicar, que ya limpiaba
`condition` al cambiar el tipo a SERVICE). (2) **Coherencia en el backend**:
`search-query.parser.ts` rechaza con 400 la combinación `type=SERVICE&condition=X`
("condition no aplica a anuncios de tipo SERVICE") en vez de devolver 0 resultados
en silencio — mismo criterio que el rechazo ya existente para atributos
cross-categoría. Verificado en vivo: `/busqueda` con "Servicios" seleccionado ya no
muestra "Condición"; vuelve a aparecer al seleccionar "Productos"; `GET /search?
type=SERVICE&condition=NEW` → 400 en el servidor real (no solo en el test).

**Tests:** `search-query.parser.spec.ts` (nuevo, 4 casos unitarios del guard
`type=SERVICE+condition`), `search-facets-by-type.e2e-spec.ts` (+3 casos e2e:
rechazo 400, `type=PRODUCT+condition` sigue permitido, `condition` sin `type` sigue
permitido), `FilterPanel.audit.test.tsx` (nuevo, 9 casos: selector de subcategoría
—ausente/presente/navega/arrastra filtros— y ocultar "Condición" —por política de
categoría, por `type` del usuario, limpieza al cambiar a Servicios—). Batería
completa: backend 12 suites/106 tests unitarios + 56 suites/873 tests e2e (con
`npm run test:e2e`, serial), todos verdes; frontend 19 suites/179 tests (169 verdes,
mismos 10 fallos pre-existentes no relacionados). **QA en vivo:** categoría padre
`audit-vehiculos` (atributo propio `fuel`) + hija `audit-coches` (atributo propio
`gearbox`) + un anuncio real publicado en la hija, usada para las 7 verificaciones
de la Parte 1 Y para el bug A (navegación padre→hija arrastrando `province=Madrid`).
Bug B verificado en `/busqueda` con Playwright: aparece/desaparece "Condición" al
cambiar Productos↔Servicios; `curl` directo al servidor de desarrollo confirma el
400 del backend. Categoría, anuncio y alerta de prueba eliminados al cerrar.

### Filtros — cerrando dos hallazgos de la auditoría + guarda de profundidad (2026-07-14)

Cierra los tres hallazgos NO corregidos que dejó la auditoría de la sesión anterior.

**1. FACET_ATTRIBUTES (lista editorial fija) → facetas derivadas del schema.**
Antes, `search.service.ts` pedía a Meilisearch las facetas de una lista escrita a
mano (`FACET_ATTRIBUTES`) — un atributo marcado `filterable:true` en el schema de
una categoría (la ÚNICA config que un admin puede tocar) no aparecía como filtro en
la UI a menos que alguien también recordara añadir su nombre a esa constante. Dos
fuentes de verdad para "¿esto se puede filtrar?", y la que mandaba en la UI no era
la que el admin configuraba. **Arreglado:** `SearchController` ya resolvía
`attributeTypes` (vía `FilterableAttributesResolver.getAttributeTypesForCategory`/
`getAttributeTypes`, scoped por categoría cuando hay una) para validar los query
params — ahora esas mismas claves (`attributeTypes.keys()`) se pasan a
`SearchService.search()` como `attributeFacetNames`, que las une a un `
NATIVE_FACET_ATTRIBUTES` reducido (`categorySlug, type, condition, priceType,
province` — los únicos que NO vienen del schema). Una fuente, no dos. La faceta de
`onlyBoosted` (la query interna del bloque "Promocionados", cuyo resultado nunca se
expone al frontend) se omite por completo — coste gratis ahorrado ahora que la
lista puede ser mucho más larga que antes.

**Medido antes de decidir (no asumido), como se pidió:** hoy hay 21 nombres de
atributo filtrable ÚNICOS en total (30 categorías, máx. 5 por schema propio de una
categoría). Comparado en vivo contra el índice real de Meilisearch (33 documentos,
20 repeticiones por caso): pedir las 11 facetas de la lista vieja tarda de media
0.95ms; pedir las 27 (todas las de hoy + nativas) tarda 1.10ms; sin pedir ninguna,
0.85ms — diferencia dentro del ruido de medición a este volumen. La opción de
acotar por categoría cuando hay una (la inmensa mayoría de las búsquedas, vía
`/[categoria]` o el filtro de categoría en `/busqueda`) YA estaba implementada de
antes (`getAttributeTypesForCategory` nunca devuelve más de lo propio + heredado de
una categoría, hoy máx. ~6) — es el caso general (`/busqueda` sin categoría) el
único que pide la unión completa (hoy 21). Si el catálogo crece a un punto donde
eso importe, la opción documentada es acotar ese caso general también (nativas +
las N más comunes, o requerir categoría) — no implementado porque medir hoy no lo
justifica.

**2. Alertas — mismo cross-category leak que RÁFAGA 1 arregló en `/search`.**
`AlertsService.create()`/`update()` usaban `getAttributeTypes()` (mapa global
plano) en vez de `getAttributeTypesForCategory(dto.categorySlug)` — confirmado
antes de tocar código: una alerta con `categorySlug:'coches'` y
`attributes:{sqm:80}` (atributo de pisos/casas, nada que ver con coches) se
aceptaba (201) donde `/search` con la misma combinación ya daba 400. Consecuencia
real: el usuario crea una alerta con un criterio imposible y nunca le salta nada,
sin ningún aviso. **Arreglado** reusando la MISMA función que `/search` (no una
copia): `create()` resuelve `attributeTypes` por `dto.categorySlug` cuando lo hay;
`update()` usa el `categorySlug` que llegue en el propio PATCH, o si el PATCH solo
toca `attributes`, el YA guardado en la alerta (una lectura extra puntual, solo en
ese caso) — un PATCH que no toca la categoría no debe relajar la validación de
qué categoría es. El código de error sigue siendo 422 (`UnprocessableEntityException`,
el que `coerceAttributes` ya usaba) — no se cambió a 400 porque el pedido era
igualar el ALCANCE de la validación (misma función), no el código HTTP, y no hay
ningún consumidor del frontend que dependa de un código concreto para alertas.
**Alertas ya existentes con criterios imposibles:** comprobado con un script
puntual (no persistido en el repo) que replica `getAttributeTypesForCategory`
sobre todas las alertas con `attributes` no vacío en la base de datos de
desarrollo — **0 encontradas**. No hace falta limpieza ni aviso al usuario en este
entorno; el mismo script puede correrse contra producción antes de desplegar este
fix si se quiere el conteo real ahí.

**3. Profundidad de la jerarquía — opción A (barata) implementada.** El modelo
(`Category.parentId`, autorreferencial) permitía N niveles sin que ningún DTO ni
servicio lo impidiera; toda la lógica de herencia asume exactamente 2. **Arreglado**
con una guarda en `admin.service.ts::createCategory()`
(`assertParentIsRoot`): si `dto.parentId` apunta a una categoría que YA tiene
padre, 400 con mensaje claro ("ya es una subcategoría — el árbol admite solo 2
niveles"). `UpdateCategoryDto` no tiene `parentId` en absoluto (ya era inmutable
tras crear), así que la guarda en `createCategory` cierra el único punto de
entrada. La UI del admin ya lo impedía estructuralmente (sin botón "Nueva
subcategoría" en una fila de hijo); esto cierra el hueco para cualquier llamada
directa a la API. Opción B (generalizar `resolveEffectiveSchema` a N niveles)
queda documentada como la alternativa si el negocio necesita 3+ niveles algún día.

**Tests:** `search-facets-schema-derived.e2e-spec.ts` (nuevo, 6 casos — LA prueba
pedida: un atributo nunca antes visto en la lista editorial vieja, marcado
`filterable:true`, aparece como faceta sin tocar código; uno `filterable:false` no
aparece; facetas por categoría no se filtran entre sí; sin categoría → unión
global; nativos siempre presentes). `alerts.e2e-spec.ts` (+4 casos: atributo
cross-categoría → 422, el mismo atributo válido en su categoría real → 201, sin
categoría → sigue permitido, PATCH que solo toca `attributes` valida contra la
categoría ya guardada). `rc5-attributes.e2e-spec.ts` (+2 casos: crear un nieto →
400, crear una categoría normal bajo una raíz → 201 sin cambios). Batería completa:
backend 12 suites/106 tests unitarios + 57 suites/885 tests e2e (`npm run
test:e2e`, serial), todos verdes — sin cambios en frontend, no hacía falta
re-ejecutar esa batería. **QA en vivo** contra el servidor de desarrollo real (no
solo el de test): categoría nueva con un atributo `torque` (nunca configurado
antes) marcado `filterable:true` → apareció como faceta en `GET /search`
inmediatamente; intento de crear un nieto bajo "Coches" → 400 con el mensaje
exacto; alerta con atributo cruzado sobre "Coches" → 422; alerta con atributo
válido → 201. Medición de rendimiento contra el índice de Meilisearch real (ver
arriba). Datos de prueba eliminados al cerrar.

### Dos bugs de atributos en card: no-filtrables ausentes + contadores sin herencia (2026-07-14)

Ambos partían de hipótesis concretas de rondas anteriores — comprobadas antes de tocar código.

**BUG 1 — los atributos de card de SERVICIOS (y de PRODUCTO no-filtrables en general) no
se mostraban en `/busqueda`/`/[categoria]`.** Hipótesis confirmada mirando la BD de
desarrollo real: los atributos de servicio que Ernest había configurado (`serv`/`other`
en "Coches", `material` en "Muebles"...) eran `cardAttribute:true` pero `filterable:false`
— exactamente el hallazgo colateral "latente" documentado en la ráfaga de producto/
servicio, activado por el patrón real de configurar atributos de servicio como
decorativos. Confirmado que NO es un bug específico de servicio: "Muebles" tenía también
un atributo `prod` (solo-PRODUCTO) igual de afectado — es un bug de "no filtrable", que
solo se manifiesta más en servicios porque sus atributos (tarifa, modalidad...) rara vez
necesitan ser un filtro de búsqueda.

Comprobado ANTES de tocar código, con un anuncio real: el documento de Meilisearch
(`toDocument()`, sin cambios) SÍ tenía los campos no-filtrables indexados como raw fields
— el problema no era el índice, era `normalizeHit()` en `SearchController`, que
reconstruía `hit.attributes` iterando SOLO `attributeTypes.keys()` (el mapa FILTRABLE de
`FilterableAttributesResolver`). Arreglado separando las dos preguntas, que son
independientes: "¿es un filtro válido?" (sigue siendo `getAttributeTypes(ForCategory)`,
sin cambios) vs. "¿es un atributo de esta categoría, se muestre donde se muestre?" (nuevo
`getAllAttributeNames(ForCategory)` en `FilterableAttributesResolver` — mismo merge
padre/hija que ya usaba `getAttributeTypesForCategory`, extraído a un método privado
compartido `mergeSchemasForCategory`, sin el filtro `filterable` final). `normalizeHit()`
ahora usa el segundo. No hizo falta tocar `toDocument()` ni reindexar nada — el dato ya
estaba ahí.

**BUG 2 — los contadores de card no contaban la herencia; el hueco real estaba en el
padre, no en la hija.** Comprobado en vivo con un padre + una hija reales antes de
arreglar nada: (a) crear una hija con sus propios `cardAttribute` cuando el padre YA
tiene 2 → **ya rechazaba con 400** (`validateCardAttributeLimit` ya fusiona con el padre
al crear/editar la hija — esto NUNCA estuvo roto); (b) el contador del admin
(`AttributeSchemaEditor`, "Card estándar — Producto: X/2...") YA contaba correctamente
lo heredado — verificado abriendo el editor de una hija con 2 propios + 2 heredados: el
contador mostraba **"4/2"**, no "2/2" — el mecanismo de conteo (`otherFields()` +
`countByType()`, de la ráfaga de producto/servicio) ya incluía `inheritedFields`. **El
hueco real:** editar el PADRE para AÑADIR cardAttribute nunca comprobaba si eso rompía a
una HIJA que ya tenía los suyos — confirmado en vivo: padre vacío + hija con 2 propios
(válido, 2/2) → PATCH al padre añadiendo 2 más → **201, aceptado sin más** — la hija
quedó con un schema efectivo de 4 (`GET /categories` tree lo mostraba tal cual, sin
truncar a 2 ni avisar).

**Arreglado validando en el padre (no truncando en render)** — decisión explícita, más
honesta que cortar en silencio: nuevo `assertCardAttributeChangeDoesNotBreakChildren()`
en `admin.service.ts`, llamado desde `updateCategory()` junto a la validación existente
(que mira hacia el padre) cada vez que se edita `attributeSchema`. Por cada hija DIRECTA,
recalcula su schema efectivo con el schema NUEVO propuesto para el padre (mismo
`resolveEffectiveSchema` + `countAttributesByType` de siempre — ninguna lógica de merge
nueva) y rechaza con 400 nombrando la hija, el tipo y el conteo exacto si excede. Sin
hijas, el chequeo es un no-op inmediato (no paga ningún coste). Comprobado que no hay
categorías YA rotas en la base de datos de desarrollo real (script puntual, no
persistido en el repo) — solo mis propias categorías de prueba, limpiadas al cerrar.

**Tests:** `filterable-attributes.resolver.spec.ts` (+4 casos: `getAllAttributeNames(ForCategory)`
incluye lo no-filtrable, hoja/padre con el mismo criterio de merge, slug desconocido).
`search-card-attributes-not-filterable.e2e-spec.ts` (nuevo, 4 casos: LA prueba —
cardAttribute no-filtrable aparece en `hit.attributes`; un filtrable sigue igual; sin
categoría también aparece; el bloque `featured` no rompe con el `Set` nuevo).
`rc5-attributes.e2e-spec.ts` (+4 casos: crear hija que rompe el tope del padre seguía
rechazando — regresión cubierta; **el bug** — editar el padre que rompe una hija ya
existente → 400 nombrando la hija, la hija no se toca; editar el padre con un cambio que
SÍ cabe (1+1) → 201; categoría sin hijas nunca paga el coste extra). Una prueba unitaria
existente (`admin.service.category-policy.spec.ts`) se actualizó: ya no podía afirmar
"`category.findMany` nunca se llama al editar name+schema sin tocar la política" — ahora
SÍ se llama, por el nuevo chequeo (motivo distinto, mismo método de Prisma); `listing.count`
(exclusivo del chequeo de política) sigue sin llamarse ahí, que es lo que la prueba
realmente necesitaba proteger. Batería completa: backend 12 suites/110 tests unitarios +
58 suites/893 tests e2e (`npm run test:e2e`, serial), todos verdes — sin cambios en
frontend, no hacía falta re-ejecutar esa batería. **QA en vivo** contra el servidor de
desarrollo real con una jerarquía padre+hija real y un anuncio de cada tipo: el padre
con un atributo decorativo (`notes`, ambos tipos, no filtrable) y la hija con `tariff`
(solo SERVICIO, no filtrable) y `km` (solo PRODUCTO, filtrable) — la card de PRODUCTO
mostró "Notas: ... · 85000 km" y la de SERVICIO "Notas: ... · Tarifa: ..." en las 4
combinaciones (`/[categoria]` hija, `/busqueda`, `/[categoria]` padre), confirmando que
el bug 1 y la herencia funcionan juntos correctamente. Datos de prueba eliminados al
cerrar.

### Contadores de atributos de card — resuelto el desacuerdo con hechos, añadido "impacto en hijas" (2026-07-14)

**El desacuerdo:** la ráfaga anterior reportó el contador de la hija correcto ("4/2" al
abrir, no "2/2"); Ernest observó que "al editar cualquier atributo, los contadores
siguen sin contar los heredados de la hija o el padre". Antes de tocar código, se montó
en vivo la jerarquía real pedida (padre con `cardAttribute` de producto Y de servicio +
hija con los suyos) y se reprodujeron 7 escenarios explícitos: abrir un atributo
existente para editar, tocar un campo no relacionado (`required`) mientras se edita,
abrir "Añadir atributo", alternar los checkboxes Producto/Servicio, marcar
`cardAttribute` en el nuevo, **guardar y reabrir** otro atributo, y abrir el contador
del padre. **Los 7 dieron el número correcto** — el contador de la HIJA (`Card estándar
— Producto: X/2 · Servicio: Y/2`, ya implementado en la ráfaga de producto/servicio
combinando `inheritedFields` + `rows` en `otherFields()`/`countByType()`) nunca perdió
lo heredado, ni al editar, ni tras guardar y volver a abrir.

**Lo único que el contador NO hacía:** al editar el PADRE, su propio contador solo
mostraba SUS atributos (p. ej. "1/2 · 1/2"), sin reflejar el impacto en las hijas ya
existentes — consultado directamente con Ernest (era la ambigüedad marcada en el
encargo, punto 2): confirmó que SÍ quiere ver ese impacto al editar el padre, no solo el
error de validación al guardar (`assertCardAttributeChangeDoesNotBreakChildren`, ya
implementado en la ráfaga anterior).

**Arreglado — nueva sección "Impacto en subcategorías" en `AttributeSchemaEditor`,**
visible solo cuando se edita una categoría RAÍZ que ya tiene hijas: `admin/categorias/
page.tsx` pasa `cat.children` (con su `attributeSchema` propio, ya disponible en el
árbol que la página ya cargaba — sin fetch nuevo) como prop `childCategories`. Por cada
hija, se recalcula EN VIVO (en cada render, mientras se edita/añade un atributo del
padre — no solo al guardar) su schema efectivo con el schema del padre TAL COMO
quedaría con el draft actual: `mergeEffective()` en el frontend replica exactamente
`resolveEffectiveSchema` (el mismo criterio "la hija gana en caso de mismo `name`"), y
`countByType()` (ya existente) hace el resto — ninguna lógica de merge nueva que pueda
divergir de la que ya valida el backend. Cada hija se muestra con sus 4 números (Card
Producto/Servicio, Ampliada Producto/Servicio) y un `⚠` + estilo de aviso cuando
CUALQUIERA excede su tope — antes de intentar guardar.

**Tests:** `AttributeSchemaEditor.childrenImpact.test.tsx` (nuevo, 6 casos): sin
`childCategories` no aparece la sección; con una hija, el impacto inicial es correcto
(coincide con lo ya guardado); el impacto se recalcula en vivo al marcar `cardAttribute`
en el nuevo atributo del padre (antes de guardar); exceder el tope de una hija marca
`⚠`; varias hijas se muestran cada una con lo suyo; el impacto de card ampliada
(`wideCardAttribute`) se calcula independiente del estándar. Batería completa: frontend
20 suites/185 tests (175 verdes, mismos 10 fallos pre-existentes no relacionados) — sin
cambios en backend, no hacía falta re-ejecutar esa batería. **QA en vivo** contra el
servidor de desarrollo real: padre con `cardAttribute` de producto ya heredado por una
hija que también tiene el suyo (efectivo 2/2) — añadir un tercer `cardAttribute` de
producto en el padre muestra en vivo, ANTES de guardar, "⚠ ... Producto 3/2" en rojo; al
intentar guardar, el error de validación (ya existente) se sigue mostrando igual.
Categorías de prueba eliminadas al cerrar.

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
`9,99 = 8,26 base + 1,73 IVA` + idempotencia confirmada con evento reenviado). **La
renovación (segunda factura) quedó verificada E2E** con firma real — ver «Stripe —
checkout + renovación de suscripción Pro (e2e), CERRADO» más abajo; ya no es deuda.

### Stripe — checkout + renovación de suscripción Pro (e2e), CERRADO

**Contexto:** con los dos caminos de Redsys ya cerrados de punta a punta (destacado y
credits-pack — ver secciones anteriores), quedaba el TERCER y último canal de dinero
del proyecto sin ejercer: Stripe. Ningún test llamaba al endpoint HTTP real
`POST /webhooks/stripe` — `billing.service.spec.ts` mockea el SDK de Stripe a nivel
unitario, y no había ningún test de `BillingProcessor` en absoluto. La renovación (2ª
factura) — el negocio real de una suscripción, no solo la adquisición — nunca se había
ejercido ni siquiera de forma indirecta. Cerrado con
`stripe-subscription-renewal-e2e.e2e-spec.ts` (8 tests, mismo molde que Redsys).

**Cómo se firma un webhook de Stripe sin sandbox real:** el propio SDK expone
`stripe.webhooks.generateTestHeaderString({ payload, secret })` — construye la cabecera
`stripe-signature` real (HMAC-SHA256 sobre `${timestamp}.${payload}`) con la misma
`STRIPE_WEBHOOK_SECRET` que usa `StripeWebhookGuard`. Equivalente exacto de
`serializeAndSignJSONRequest` de `redsys-easy` en el molde de Redsys.

**RAW BODY — hallazgo de infraestructura de test:** `createTestApp()`
(`test/helpers/create-app.ts`) NO habilitaba `rawBody: true` al crear la app de test, a
diferencia de `main.ts`. La verificación de firma de Stripe es sobre los BYTES exactos
del cuerpo (`request.rawBody`) — sin esa opción, `request.rawBody` nunca llega a
`StripeWebhookGuard` y CUALQUIER firma, válida o no, se rechaza con "Missing
stripe-signature or body". Este hueco llevaba ahí desde que existe el helper — nunca se
había notado porque ningún test anterior ejercía el webhook HTTP real. Corregido
añadiendo `{ rawBody: true }` a `createNestApplication()`; afecta a TODOS los tests e2e
(mirror de `main.ts`, sin efectos secundarios — se verificó con la batería completa).

**Qué quedó verificado (8 tests, todos pasando):**
1. Camino feliz: `checkout.session.completed` → `invoice.payment_succeeded` (1ª
   factura) → **`invoice.payment_succeeded` (2ª factura, la renovación real)** →
   `Subscription.currentPeriodEnd` y `Entitlement.expiresAt` extendidos al periodo de
   la 2ª factura, 2 `Transaction` (una por factura), `Subscription.status = ACTIVE`.
2. Firma inválida en la renovación → `400`, ni `Subscription`/`Entitlement` se
   extienden ni se crea `Transaction`, ni siquiera se registra `GatewayEvent`.
3. Notificación duplicada (mismo `event.id` dos veces) → segunda respuesta
   `{ duplicate: true }`, una sola `Transaction` para esa factura.
4. Reintento espurio de BullMQ tras la renovación ya procesada con éxito (llamada
   directa a `processor.process()` simulando un job redespachado) → no duplica nada:
   cada escritura de `handleInvoiceSucceeded` es un SET/upsert idempotente, así que
   recomputar sobre datos ya aplicados converge al mismo estado.
5. **Pago fallido de la renovación** (`invoice.payment_failed`) → `Subscription
   PAST_DUE`, pero el `Entitlement` Pro **no se revoca** — el usuario mantiene acceso
   hasta que `expiresAt` (fijado por la última factura pagada) expire de forma natural.
   No hay periodo de gracia explícito ni aviso al usuario — degradación pasiva, no
   activa. Comportamiento razonable (no corta a nadie de golpe por un pago fallido
   puntual — Stripe reintenta automáticamente) pero sin aviso proactivo: mejora de
   producto pendiente, no bug.
6. **Cancelación** (`customer.subscription.deleted`) → `Subscription CANCELED`, pero el
   `Entitlement` Pro tampoco se revoca de inmediato: el periodo ya pagado se respeta
   (`expiresAt` intacto). Correcto — el usuario ya pagó ese periodo.

**Bug de dinero encontrado — el `.catch()` que tragaba errores (PARTE 1 del encargo):**
`handleCheckoutCompleted` hacía `.catch(() => undefined)` al persistir
`stripeCustomerId` (`prisma.user.update(...)`), tragando **cualquier** error, no solo el
caso "ya estaba puesto" que sugería el comentario. Si ese guardado fallaba de verdad, el
resto del handler seguía como si nada — el usuario podía acabar con acceso Pro sin que
su `stripeCustomerId` quedara vinculado, y su SIGUIENTE pago creaba OTRO cliente en
Stripe (clientes duplicados, sin forma limpia de reconciliar; una factura que llega
meses después en forma de datos inconsistentes). **Arreglado:** ya no se traga — se deja
propagar. Evaluado el efecto secundario antes de aplicarlo: el fallo ocurre ANTES de
tocar `Subscription`/`Entitlement` (nada parcial que limpiar), y el resto del handler
(`Subscription.upsert`, `ensureProEntitlement`) ya era idempotente — así que dejar que
el job falle y BullMQ reintente (`QUEUE_BILLING`, `attempts:3`) es seguro, no duplica
nada. Verificado EJERCIENDO (test 8): se fuerza el fallo del guardado → el job
propaga el error (antes se habría tragado) → el reintento se recupera limpio, sin
cliente Stripe duplicado ni `Subscription` huérfana.

**Hallazgo de atomicidad (PARTE 2, reportado ANTES de arreglar):** el E2E encontró que
`handleInvoiceSucceeded` (la renovación) NO envolvía extender
`Subscription`/`Entitlement` y registrar la `Transaction` en una única `$transaction` —
a diferencia de AMBOS caminos de Redsys (`grantFeaturedListingAndSucceed`,
`handlePackPurchase`). Forzando un fallo justo antes de crear la `Transaction`
(spy sobre `prisma.$transaction`, mismo truco que el molde de Redsys: dejar correr la
transacción real y lanzar desde el callback para forzar un ROLLBACK genuino), se
comprobó que el entitlement quedaba extendido SIN `Transaction` — estado a medias, sin
rollback posible con el código original. El reintento sí convergía sin duplicar nada
(cada escritura era un SET/upsert idempotente, no un create+guarda como el bug
original del destacado), así que no era el MISMO bug, pero sí el mismo patrón de
riesgo. **Reportado al usuario antes de tocar código; decisión: envolver en
`$transaction` igualmente**, por consistencia con Redsys y defensa en profundidad. Se
aplicó a los TRES puntos de escritura de `BillingProcessor` que tenían la misma forma
(`handleSubscriptionCheckout`, `handleInvoiceSucceeded` completo — ambas ramas, primera
factura y renovación). `ensureProEntitlement` ahora acepta un `tx?: Prisma.TransactionClient`
opcional (mismo patrón que `AuditLogService.log(dto, tx?)`) para poder participar en la
`$transaction` del llamador. Verificado tras el fix: el mismo test de fallo forzado
ahora demuestra ROLLBACK real (nada queda a medias) y el reintento extiende limpio.

**Hallazgo de test, no de producto — colisión de reruns locales:** al reejecutar este
archivo varias veces en la misma sesión para depurar, TODAS las ejecuciones tras la
primera empezaron a fallar con timeouts de `pollUntil` (job nunca procesado, pero el
webhook devolvía 200). Costó una ronda completa de descarte (caché de ts-jest, estado
de la cola en Redis, `console.log` directo en el processor) antes de encontrar la causa
real: `GatewayEvent` no tiene FK a `User`, así que `cleanDb()` nunca lo trunca — los
`event.id` fabricados a mano por el test (`evt_e2e_checkout_1`, etc.) colisionaban con
filas de la ejecución anterior, y el guard los trataba como duplicados (200 OK, pero
sin volver a encolar el job). Arreglado con un `RUN_ID = Date.now()` incluido en todos
los ids sintéticos del archivo. Ver [[feedback_gatewayevent_rerun_collision]] en
memoria — aplica a cualquier test futuro de webhook que fabrique su propio id de
idempotencia en vez de dejar que el servidor lo genere (los tests de Redsys se libran
de esto porque `Ds_Order` lo genera `RedsysService.generateDsOrder()`, aleatorio).

Verificado sin regresión: batería completa (ver resultado al cierre de esta ráfaga).

**Deuda restante (menor, no bloqueante):** igual que con Redsys, la prueba contra el
entorno de Stripe con un test clock real / segundo ciclo de facturación genuino no se
ha hecho — este E2E fabrica la 2ª factura con `serializeAndSignJSONRequest`-equivalente
en vez de esperar a un ciclo real de facturación. Con esto, **los tres canales de
dinero del proyecto (Redsys destacado, Redsys credits-pack, Stripe suscripción) quedan
ejercidos de punta a punta con firmas reales y sus caminos de fallo caracterizados.**

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

### Lecciones de método: la saga del flaky del CI (H6 — las más valiosas del proyecto)

El flaky de `listing-card-attrs.spec.ts` estuvo presente desde RC5.5, se "resolvió" varias veces con parches parciales, y no se cerró hasta H6. Las lecciones aplican a todos los tests futuros con async:

**"Verde repetido, no verde a secas."** Un flaky de ~25% tiene ~42% de probabilidad de dar 3 verdes seguidos por azar. Un solo verde no valida el fix. Criterio adoptado: **5+ re-runs verdes consecutivos** para considerar un test estable. Confirmado con 7/7 tras el fix real.

**"Los tests nunca esperan a reloj un proceso async."** `toBeVisible(25_000)` sobre una página SSR (que renderiza un snapshot estático) nunca reflejará el resultado de indexación async — la página no se re-renderiza sola. El patrón correcto es **espera activa**: el helper `waitForCard` recarga la URL cada 1,5 s hasta que el anuncio es visible, o agota el tiempo con un error descriptivo. Aplicable a cualquier test que espere indexación Meilisearch.

**"Observar antes de deducir."** El bug de CI (tests fallando solo en runners, no en local) se diagnosticó publicando un anuncio a mano en el navegador — funcionaba. El problema era CI-específico: Nominatim inaccesible en el runner → geocoding síncrono bloqueaba y fallaba → el wizard no redirigía en tiempo. Varias rondas de parchear tests por deducción; la observación manual distinguió "bug de producto" de "fragilidad de entorno" y apuntó directamente a la causa.

**"Pelar capas."** El flaky tenía **4 causas apiladas**: (1) faltaba `condition` en un helper, (2) límite de 5 listings activos por usuario alcanzado dentro de la ejecución de CI (distintos specs publicando anuncios → settings con `freeActiveListingLimit: 5` en seed), (3) geocoding síncrono dependiente de Nominatim (inaccesible en CI), (4) `addDocuments()` fire-and-forget — el job BullMQ completaba antes de que el documento fuera consultable. Cada fix era real pero el test seguía fallando (menos). No conformarse con "ya falla menos" hasta llegar al fondo.

**"Tests que publican por el wizard son frágiles."** El wizard completo depende del flujo entero: datos, ubicación (geocoding), atributos, límite de plan, indexación. Un fallo en cualquier capa hace fallar el test sin indicar cuál. Para tests de setup (publicar un anuncio para luego verificarlo), preferir `POST /listings` + `POST /listings/:id/publish` directamente por API. El wizard solo debe ejercerse en tests que prueben **el wizard** explícitamente. Pendiente de aplicar en Hito 9.

### Login social con Google — backend (Hito 7, parte 1)

> Nota de nomenclatura: la etiqueta «H7» usada en «H7 — La reseña sobrevive al borrado del
> anuncio» (más abajo, en el mapa de deuda) es la **otra pieza de este mismo Hito 7 enfocado**,
> entregada primero — no un ítem de Hito 6 ni una coincidencia de numeración.

**Diseño (aprobado antes de implementar):** Next-Auth (frontend, parte 2 pendiente) hace el
intercambio OAuth con Google y reenvía al backend el **`id_token` crudo** (no el `profile`
JSON) recibido de Google. El backend nunca confía en campos JSON que el cliente pudiera
falsear — verifica la firma del `id_token` él mismo.

- **Endpoint**: `POST /auth/social/google { idToken }` → misma forma de respuesta que
  `/auth/login` (`{ accessToken, user }`). `AuthController.socialGoogle` → `AuthService.loginWithGoogle`.
- **Verificación criptográfica**: `google-auth-library` (`OAuth2Client.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID })`).
  Solo se usan `sub`, `email`, `email_verified`, `name`, `picture` del payload **ya verificado**
  por la librería — nunca de un campo recibido tal cual. Fallo de verificación → 401.
- **Modelo de datos**: nueva tabla `Account` (`provider`, `providerAccountId`, `userId` FK
  `onDelete: Cascade`, `@@unique([provider, providerAccountId])`) — no un `googleId` suelto en
  `User`, precisamente para poder añadir Facebook/Apple más adelante sin migración nueva.
  `User.passwordHash` pasa a `String?` (nullable): un usuario solo-Google no tiene contraseña.
  Migración `20260704163552_social_login_google`.
- **Política de vinculación** (`AuthService.linkOrCreateSocialUser`, método privado compartido):
  1. `Account` ya existe (mismo `provider` + `providerAccountId`) → re-login, mismo `User`.
  2. No existe `Account` pero sí un `User` con ese email:
     - `email_verified === true` (según Google) → se **vincula**: crea `Account`, y si el
       `User` no tenía `emailVerified`, lo pone a `true` (Google certifica el email; salta el
       flujo `/verify-email`). El `passwordHash` existente no se toca — sigue pudiendo
       entrar con contraseña.
     - `email_verified === false` → **403**, no vincula. Cierra el hueco de seguridad: nunca
       se vincula una cuenta por igualdad de string de email, solo bajo prueba de Google.
  3. Ningún `User` con ese email → se **crea** (`passwordHash: null`, `emailVerified: true`,
     `avatarUrl` del `picture` de Google, `slug` vía `generateUniqueSlug`) + su `Account`, en
     una `$transaction`. También exige `email_verified === true` (mismo criterio que en 2).
  Nunca se crean dos `User` con el mismo email — constraint única + esta lógica.
- **Gate de estado**: SUSPENDED/BANNED se comprueba igual que en `login()`, después de
  identificar/crear el usuario y antes de emitir el JWT.
- **JWT**: `signToken()` sin cambios — reutilizado tal cual; un usuario social y uno de
  contraseña son indistinguibles para el resto de la API tras autenticar.
- **Ajustes en métodos existentes por `passwordHash` nullable**: `login()` rechaza con 401
  (sin llamar a `bcrypt.compare` contra `null`) si el usuario no tiene `passwordHash`.
  `forgotPassword()` no envía email ni crea token si `passwordHash` es `null`, pero sigue
  devolviendo `{ ok: true }` — no revela si un email es de cuenta social o inexistente.
- **`generateUniqueSlug`**: acepta ahora un `fallbackSeed` (el email) — si el `name` de Google
  viene vacío, solo emojis, o sin caracteres latinos, cae al local-part del email, y si tampoco
  sirve, a `'usuario'`. La lógica de sufijo ante colisión (`-1`, `-2`…) no cambia.
- **Config**: `GOOGLE_CLIENT_ID` (`configuration.ts` → `google.clientId`, `env.validation.ts`
  opcional). El backend **solo** verifica firmas — nunca intercambia código con Google, así que
  no necesita el client secret (ese vive en Next-Auth, parte 2). Vacío en dev/test es válido.
- **Tests**: `test/social-auth.e2e-spec.ts` (9 tests) — `google-auth-library` mockeado
  (`jest.mock`, nunca llama a Google real): id_token inválido → 401 sin crear usuario; usuario
  nuevo (passwordHash null, emailVerified true, avatarUrl, Account creada); vinculación de
  usuario existente sin duplicar; `email_verified=false` → 403 sin vincular; re-login sin
  duplicar; `login()` con contraseña sobre cuenta solo-Google → 401; `forgotPassword` sobre
  cuenta solo-Google → `{ ok: true }` sin enviar email; usuario BANNED → 403; nunca dos `User`
  con el mismo email. Suite completa (336 e2e) verificada en verde tras el cambio.
### Login social con Google — frontend (Hito 7, parte 2 — cierra el Hito 7)

- **Provider**: `Google()` de `next-auth/providers/google` añadido junto a `Credentials` en
  `lib/auth/index.ts` (`apps/web/src/lib/auth/index.ts`). Recoge `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET`
  por convención de Auth.js (ya presentes en `.env.local`; placeholders en `.env.example`). Scopes
  por defecto (`openid email profile`), sin `allowDangerousEmailAccountLinking`: no hay `adapter`
  configurado, así que la vinculación-por-email nativa de Auth.js nunca se ejecuta — toda la
  vinculación pasa por nuestro backend (`/auth/social/google`), que ya exige email verificado.
- **Punto clave — el exchange vive en el callback `signIn`, no en `jwt`** (`auth.config.ts`):
  se detectó, leyendo el propio código de `@auth/core` (`lib/actions/callback/index.js` /
  `handleAuthorized`), que cualquier error lanzado dentro del callback `jwt` se colapsa siempre en
  el mismo código genérico `CallbackRouteError` al redirigir — no hay forma de distinguir "email no
  verificado por Google" de cualquier otro fallo. El callback `signIn`, en cambio, puede **devolver
  un string** que Auth.js usa tal cual como URL de redirección, lo que permite mandar al usuario a
  `/login?error=google_unverified_email` o `/login?error=google_error` según el caso. Como no hay
  adapter, el objeto `user` que recibe `signIn` es la misma referencia que luego recibe `jwt`
  (confirmado en `handleLoginOrRegister`: `if (!adapter) return { user: _profile, account: _account }`),
  así que mutar `user` dentro de `signIn` (rellenando `id`, `slug`, `role`, `accessToken`,
  `emailVerified` con la respuesta de `/auth/social/google`) es exactamente lo que el `jwt`
  callback ya esperaba de la rama de Credentials — mismo shape, sin tocar `jwt`.
- **Manejo de errores**: `signIn` callback llama a `POST /auth/social/google { idToken: account.id_token }`;
  éxito → rellena `user` y devuelve `true`. 403 (email no verificado) → devuelve
  `'/login?error=google_unverified_email'`. Cualquier otro fallo → `'/login?error=google_error'`. Ambas
  páginas (`/login`, `/registro`) leen `?error=` y muestran el mensaje correspondiente
  (`GOOGLE_ERROR_MESSAGES`); como el error de Google siempre resuelve en `/login` (tanto por nuestro
  string explícito como por `authConfig.pages.error`), `/registro` no necesita leer ese parámetro.
- **Botón**: `GoogleSignInButton` (`components/auth/GoogleSignInButton.tsx`) — shadcn `Button`
  `variant="outline"` + logo SVG oficial + `signIn('google', { callbackUrl })`; usado en `/login` y
  `/registro` con un separador ("o") entre el formulario y el botón. `callbackUrl` viene del query
  param (`?callbackUrl=`) con fallback a `/mis-anuncios`, igual que el flujo de Credentials.
- **Perfil vacío tras alta social**: deliberado, sin paso de completar-perfil forzado — el wizard de
  publicar no depende de datos de ubicación precargados (fuera de alcance, ver mini-diseño aprobado).
- **Tests**: `e2e/login-social-google.spec.ts` (Playwright, 3 casos) — el botón existe en ambas
  páginas y, al pulsarlo, `signIn('google')` efectivamente arranca el intercambio OAuth (se
  intercepta y aborta la navegación real a `accounts.google.com` con `page.route()`, para no
  depender de la red ni de una cuenta Google real en CI); y que el formulario de email/contraseña
  sigue intacto. El flujo OAuth completo (crear cuenta nueva / vincular a una existente) **no es
  testeable con Playwright sin una cuenta Google real** — pendiente de verificación manual antes de
  dar el Hito 7 por cerrado del todo.
- Suite Playwright completa verificada en verde (88/89; el único fallo — aviso de geo faltante en
  `busqueda-mapa.spec.ts` — es una flakiness preexistente de datos de Meilisearch, no relacionada
  con este cambio, reproducible en aislamiento sin tocar código de auth).

### RÁFAGA 3 — Paquete de seguridad de auth

Motivado por una auditoría previa (RC.2, puramente diagnóstica, sin tocar código) que encontró
el sistema de login/signup **sin ninguna protección básica**: login fuerza-bruteable, sin
lockout, el reset de contraseña no cerraba sesiones, y un ADMIN podía entrar por Google. Todo lo
de abajo vive en `apps/api/src/modules/auth/` salvo donde se indique.

- **Rate limiting — `RateLimitService` genérico** (`infra/redis/rate-limit.service.ts`): el
  limitador Redis (INCR+EXPIRE) que RC.1 construyó solo para `/contacto` se extrajo a un servicio
  reutilizable, parametrizado por clave/límite/ventana. `ContactRateLimitService` ahora es un
  wrapper fino sobre él (mismo comportamiento, sin cambios de interfaz — sus tests siguen en
  verde tal cual). Registrado en `RedisModule` (`@Global`), disponible en cualquier módulo sin
  import explícito.
  - **Login** (`auth.constants.ts`): por IP (150/15min) y por email (5/15min) — el límite por
    email es la defensa real contra fuerza bruta sobre UNA cuenta (protege aunque el atacante
    rote de IP); el de IP es una red de flood-control más gruesa y deliberadamente generosa,
    porque un umbral bajo penaliza tráfico legítimo detrás de NAT/proxy compartido — incluida la
    propia batería e2e, que reutiliza una única IP de loopback para ~70 logins de setup
    repartidos en decenas de specs no relacionados con auth (se probó primero con 10/15min: rompió
    38 suites en cascada).
  - **Register**: 3/hora por IP (anti-spam de cuentas).
  - **Forgot-password**: por IP (5/hora) y por email (3/hora) — anti-abuso de envío de correos,
    sin romper el `{ok:true}` no-enumerable existente.
  - **Change-password**: 5/hora por usuario (autenticado, así que la clave es el userId, no la IP).
  - Los contadores usan la clave `auth:*` en Redis; el `globalSetup` de Jest e2e
    (`test/setup-e2e.js`) los limpia ANTES de toda la batería — no basta con que un spec los limpie
    en su propio `beforeAll`, porque `/auth/login` es infraestructura de setup para casi todos los
    specs, no solo para los de auth (mismo principio que «resetear entre cada pasada, no solo antes
    de la primera», ver «CI verde repetido» más abajo).
- **Lockout** (`User.failedLoginAttempts`, `User.lockedUntil`): a partir del 5º fallo consecutivo,
  la cuenta se bloquea con backoff exponencial (`computeLockoutMinutes`: 15min → 30min → 60min…,
  techo 24h). Login correcto resetea el contador. **Sin romper la no-enumerabilidad**: una cuenta
  bloqueada devuelve el mismo 401 genérico que un email inexistente o una contraseña incorrecta —
  ni siquiera se compara la contraseña si `lockedUntil` está en el futuro (evita además el coste
  de un bcrypt.compare innecesario).
- **Invalidación de sesiones — `User.tokenVersion`**: el JWT del backend ahora lleva
  `tokenVersion` en el payload; `JwtStrategy.validate()` (que YA releía `status` de la BD en cada
  request) lo compara contra el valor en BD — si difiere, 401 inmediato, sin esperar a que el
  token caduque. `resetPassword()`, `changePassword()` y `setPassword()` incrementan
  `tokenVersion` (`{ increment: 1 }`), invalidando así TODOS los tokens previos al instante.
  Verificado con un token real en tests (login → token → reset → el MISMO token pasa a dar 401),
  no solo asumido.
- **Rol y `emailVerified` frescos — cierra la deuda de «sesión stale» documentada arriba**:
  ya que `JwtStrategy.validate()` consulta la BD en cada request (para `status` y `tokenVersion`),
  ahora también devuelve `role`/`emailVerified` **de la BD, no del payload firmado** — coste cero
  (mismo query). Un cambio de rol tiene efecto en la SIGUIENTE request de ese usuario, sin esperar
  7 días ni forzar un logout. La mitigación "forzar logout tras cambio de rol" que la deuda
  original proponía ya no hace falta.
- **`POST /auth/change-password`** (autenticado): exige la contraseña actual + la nueva:
  incrementa `tokenVersion` y devuelve un `accessToken` fresco (para que el propio llamante no se
  quede desconectado por su propia acción) — cierra otras sesiones abiertas en otros dispositivos.
  Rechaza con 400 si la cuenta no tiene contraseña (`passwordHash: null`), remitiendo a
  `set-password`.
- **`POST /auth/set-password`** (autenticado) — **cierra la deuda «usuarios solo-Google no
  pueden fijar contraseña»** documentada más abajo: mismo mecanismo que `change-password` pero sin
  exigir una contraseña actual (no la hay). Solo funciona si `passwordHash` es `null`; si la cuenta
  ya tiene contraseña, 409 (usa `change-password` en su lugar). También incrementa `tokenVersion`.
- **ADMIN solo con contraseña (decidido)**: `loginWithGoogle()` rechaza con 403
  (`code: ADMIN_GOOGLE_LOGIN_BLOCKED`) si el `User` resuelto tiene `role: ADMIN` — el `Account` de
  Google puede quedar vinculado (la vinculación ocurre antes del bloqueo), pero no sirve para
  entrar. **Precondición verificada antes de aplicar el bloqueo**: no había ningún ADMIN con
  `passwordHash: null` en la BD de desarrollo en el momento del cambio — de haberlo habido, habría
  quedado sin poder entrar. **Pendiente antes de desplegar a producción**: repetir la misma
  comprobación contra la BD de producción. El frontend distingue este 403 del de "email no
  verificado por Google" vía el `code` de la respuesta (`auth.config.ts`, página `/login`) para no
  decirle a un admin bloqueado que el problema es su email.
  - **Promoción a ADMIN**: no evaluado en código porque no hace falta — `ChangeUserRoleDto`
    (`admin/dto/change-user-role.dto.ts`) ya restringe el rol destino a `USER|MODERATOR|EDITOR`
    (regla de oro anti-escalada de privilegios, ver «Separación de roles ADMIN/MODERATOR» arriba);
    hoy no existe NINGÚN endpoint que promueva a alguien a ADMIN — ese rol solo se asigna
    directamente en BD/seed. Si en el futuro se añade un camino de promoción a ADMIN por API,
    debe comprobar que el usuario tiene `passwordHash` no nulo (o forzar `set-password` primero).
- **Expiración de sesión alineada (frontend)**: `session.maxAge` de NextAuth
  (`apps/web/src/lib/auth/auth.config.ts`) pasa de su default (30 días) a 7 días explícitos,
  igualando el TTL del `accessToken` del backend (`auth.module.ts`, hardcodeado). Antes, la cookie
  de NextAuth podía sobrevivir hasta 23 días más que el token que lleva dentro, dejando sesiones
  "medio muertas" y, sobre todo, dejando que el gate de `/admin` en el navegador (que confía en
  esa cookie) sobreviviera más que el propio accessToken que el backend valida en cada request.
- **Enumeración en `register()` — decisión consciente, no arreglada**: `register()` sigue
  devolviendo 409 si el email ya existe (filtra existencia de cuenta), a diferencia de
  `login()`/`forgot-password()` que son no-enumerables. Es un trade-off de UX vs seguridad
  aceptado deliberadamente (la mayoría de sitios devuelven este 409 por claridad de UX —
  "ese email ya está registrado" — en vez de forzar al usuario a adivinar por qué el registro no
  avanza); documentado aquí para que quede como decisión, no como descuido.
- **Tests**: `test/auth-security.e2e-spec.ts` (15 tests nuevos) — rate limiting (login IP+email,
  register IP, forgot-password IP+email, change-password), lockout (bloqueo tras N fallos,
  no-enumerable, reset de contador en login correcto), invalidación de sesión real tras
  reset-password, rol fresco sin re-login (vía `GET /moderation/reports`, gateado
  `MODERATOR|ADMIN`), change-password y set-password (incl. cierre de otras sesiones). Más 2 tests
  nuevos en `social-auth.e2e-spec.ts` (ADMIN bloqueado vía Google, usuario normal sigue entrando
  bien). Suite completa verificada en verde (49/49 suites, 794/794 tests).

### RÁFAGA 4 — Fricción de login en flujos con acción (Nivel 1: vuelve a la página)

Motivado por la auditoría RC.2, que mapeó cada punto donde un usuario anónimo topa con un muro de
login: sin mecanismo compartido (cada componente escribía su propia cadena `/login?...` a mano, de
ahí la inconsistencia `redirect=` vs `callbackUrl=`), un bug real en `ContactButton` (usaba la
clave que `/login` no lee → el usuario perdía el anuncio y el mensaje escrito), el middleware sin
`callbackUrl` en su punto de entrada más frecuente, y los favoritos invisibles para anónimos
(oportunidad de conversión perdida). **Nivel 1** = vuelve a la página correcta; retomar la acción en
sí (reabrir el checkout, conservar el mensaje escrito, marcar el favorito automáticamente) queda
para un Nivel 2 a evaluar después.

- **Mecanismo único — causa raíz de la inconsistencia**:
  - `apps/web/src/lib/auth/callback-url.ts` — funciones puras (sin `'use client'`/`'use server'`,
    usables desde Server Components, Client Components y `middleware.ts` por igual):
    `isSafeCallbackUrl()` (la puerta anti-open-redirect, ver abajo), `buildLoginUrl(path)` (arma
    `/login?callbackUrl=...` con `encodeURIComponent`, cayendo al default si el path no es seguro),
    `resolveCallbackUrl(raw)` (para consumir el query param de `/login` sin confiar en él).
  - `apps/web/src/hooks/use-require-auth.ts` — `useRequireAuth()` para Client Components: expone
    `loginUrl` (siempre `buildLoginUrl(usePathname())`, la página actual) y `requireAuth()` (si no
    hay sesión, `router.push(loginUrl)` y devuelve `false` para que el llamante corte la acción).
    Un solo hook cubre los dos patrones que existían sueltos: el pre-check antes de una acción
    (`if (!requireAuth()) return`) y el fallback de `useApiAction()` para el caso "la sesión caducó
    a media acción" (`callbackUrl: loginUrl`).
  - Todos los puntos del mapa de la auditoría migrados a este mecanismo — ninguno escribe
    `/login?...` a mano: `ContactButton`, `FavoriteButton`, `FavoriteCardButton`, `CheckoutButton`,
    `PackList`, `SuscripcionActions`, `ReportButton`, `ReviewReportButton`, `ReviewModal`,
    `DestacadoDialog`, `MyListingCard`, `EditarWizard`, `PublicarWizard`, `ListingOwnerActions`,
    `/planes/exito`. Como `useRequireAuth()` deriva el destino de `usePathname()`, varios de estos
    quedaron además MÁS PRECISOS que antes (p. ej. `ListingOwnerActions`/`EditarWizard` ahora
    devuelven a la ficha/edición concreta, no a `/mis-anuncios` genérico) — y se pudieron retirar
    props que solo existían para construir esa URL a mano (`ContactButton.listingSlug`,
    `ListingOwnerActions.listingSlug`).
  - Los `redirect('/login')` de Server Components (12 páginas bajo `(account)/`) pasan a
    `redirect(buildLoginUrl('/ruta'))` — antes no llevaban `callbackUrl` en absoluto.
- **El bug de `ContactButton` (arreglado)**: usaba `redirect=`, una clave que `/login` nunca leyó
  (solo lee `callbackUrl=`) — el usuario aterrizaba siempre en `/mis-anuncios`, perdiendo el
  anuncio y cualquier mensaje ya escrito. Ahora usa el hook — vuelve al anuncio exacto.
- **`middleware.ts` con `callbackUrl`**: el redirect a `/login` (para `accountPrefixes` y
  `adminPrefixes`) ahora incluye `buildLoginUrl(pathname + search)` — antes no llevaba ningún
  parámetro, y es el punto de entrada MÁS FRECUENTE (nav directa, bookmark, enlace del menú) a
  login desde una acción. De paso, `accountPrefixes` gana `/mis-alertas` y `/notificaciones`
  (estaban fuera del array por lo visto un descuido — sus páginas ya hacían el mismo check a mano
  sin `callbackUrl`, ahora las cubre el middleware Y llevan `callbackUrl` en su propio fallback).
- **Favoritos descubribles para anónimos**: `FavoriteButton` (ficha) y `FavoriteCardButton`
  (tarjetas de listado) ya no hacen `if (!token) return null` — el corazón SIEMPRE se renderiza; al
  pulsarlo sin sesión, `requireAuth()` redirige con retorno a la página actual. Nivel 1: no marca el
  favorito automáticamente al volver, el usuario lo pulsa de nuevo — pero ahora al menos descubre
  que la función existe. (`FavoriteButton` tenía además un bug latente propio: su `ready` state
  nunca pasaba a `true` para un anónimo porque el `useEffect` que lo hacía dependía de tener token
  — arreglado de paso, aunque era invisible mientras el botón nunca se renderizaba para ellos.)
- **Cierre del open-redirect — el hallazgo de seguridad de esta ráfaga**: `/login` (y `/registro`)
  hacían `router.push(callbackUrl)`/pasaban `callbackUrl` a `GoogleSignInButton` con el query param
  **sin validar** — un enlace a `/login?callbackUrl=https://evil.com` (o `//evil.com`,
  protocol-relative, incluso más furtivo por parecer una ruta relativa) habría logueado a la
  víctima y la habría mandado a un dominio ajeno: vector de phishing real ("inicia sesión, luego te
  mando a tu banco" en un enlace que en realidad manda a un clon). `isSafeCallbackUrl()` exige que
  el path empiece por `/` y explícitamente rechaza `//` y `/\` — ambas páginas resuelven el query
  param con `resolveCallbackUrl()` UNA vez, y ese valor ya seguro es lo único que se usa tanto para
  el submit de credentials como para el botón de Google. Probado explícitamente (e2e y a mano, ver
  abajo): un `callbackUrl` externo cae al default (`/mis-anuncios`) tras loguearse, nunca navega
  fuera del sitio.
- **Hallazgo colateral durante la verificación — colisión con el rate limit de RÁFAGA 3**: correr la
  batería Playwright completa (no solo el spec nuevo) reveló que el límite de login "5
  intentos/email/15min" de RÁFAGA 3 contaba TODOS los intentos, no solo los fallidos como pedía el
  diseño original — y `/auth/login` es infraestructura de setup compartida por casi toda la
  batería e2e (varios specs llaman a `loginViaApi` con `admin-e2e@example.com`, y el propio
  `global-setup.ts` de Playwright loguea 6 cuentas para guardar su `storageState`); sumado a los
  logins de este spec nuevo, una cuenta podía superar 5 usos legítimos en una sola corrida y
  quedar bloqueada — el mismo patrón se daría en producción con alguien logueado en varios
  dispositivos. **Corregido de raíz, no parcheado**: se retiró el contador de rate-limit por email
  (redundante con el lockout, que ya cubre "5 fallos por cuenta" con más matices —backoff
  creciente— y sin ese falso positivo, porque solo cuenta fallos, nunca éxitos). Ver el comentario
  en `auth.constants.ts`. De paso, se extrajo `apps/api/test/flush-redis-test-db.js` (compartido
  entre el `globalSetup` de Jest y el de Playwright; renombrado y ampliado a `FLUSHDB` completo al
  cerrar la colisión Redis dev/test — ver «Colisión Redis dev/test en local» más abajo) para que
  ninguna corrida repetida en local herede contadores de la anterior.
- **Tests**: `apps/web/e2e/auth-friction.spec.ts` (10 tests) — el bug de `ContactButton` arreglado
  (vuelve al anuncio, no a `/mis-anuncios`), el middleware devolviendo a `/publicar`/`/mensajes`/
  `/favoritos`/`/mis-creditos`, favoritos visibles y con retorno correcto (ficha y tarjeta), Comprar
  Pro sigue funcionando, y **dos tests de seguridad** que ejercen el open-redirect de verdad
  (`callbackUrl` externo y protocol-relative, ambos verificados con un login real completo — no
  solo inspeccionando la URL construida). Los logins de este spec se reparten entre las 6 cuentas
  ya sembradas (máx. 2 usos por cuenta en el archivo) para no agotar el cupo de ninguna. Suite
  Playwright completa verificada en verde (171/171 tests en aislamiento; los 2 fallos vistos en una
  corrida larga de la batería completa —`prefill-ubicacion.spec.ts`,
  `producto-servicio-flujo.spec.ts` B— fueron un `ECONNREFUSED` transitorio del backend en modo
  watch bajo carga sostenida, no reproducible corriendo esos archivos solos; el fallo de
  `admin-roles.spec.ts` —"12 ítems" cuando el nav ya tiene 14— es una aserción desactualizada
  preexistente, sin relación con esta ráfaga, igual que los 3 de `footer-admin.spec.ts` ya
  documentados más abajo). Además, QA en vivo (no solo e2e) contra el stack de desarrollo real:
  capturas del flujo completo (anónimo → clic en Contactar/Guardar → `/login?callbackUrl=...` →
  login → de vuelta en la misma ficha) y del open-redirect cayendo al default en vez de navegar a
  un dominio externo.

### RÁFAGA 5 — `/admin/login` separada (superficie de login administrativa independiente)

Motivado por una decisión de diseño explícita: un `ADMIN` ya no puede entrar por el `/login`
público en absoluto — solo por `/admin/login`, una página propia sin Google y con estilo
distinto. El riesgo central del diseño era el **auto-bloqueo**: si `/login` rechaza admins y
`/admin/login` queda mal protegida o rota, no hay vía de entrada al panel. Los tres puntos de
abajo se diseñaron con ese riesgo por delante y se verificaron en vivo, no solo con e2e.

- **Backend — `AuthService` (`apps/api/src/modules/auth/auth.service.ts`)**: `login()` se
  descompuso extrayendo `validateCredentials(dto)` (lookup, lockout, `bcrypt.compare`, checks de
  `SUSPENDED`/`BANNED` — nunca decide sobre el rol). `login()` llama a `validateCredentials()` y,
  **solo si tiene éxito**, comprueba `role === ADMIN` → `403 ADMIN_MUST_USE_ADMIN_LOGIN` con el
  mensaje "Las cuentas de administración deben iniciar sesión en /admin/login." Nuevo
  `adminLogin(dto, ip)` — mismo `validateCredentials()`, rechaza con `403
  ADMIN_LOGIN_NOT_ADMIN` si el usuario resuelto NO es `ADMIN`. **El rechazo por rol ocurre
  siempre DESPUÉS de validar credenciales**, nunca antes — es la misma disciplina que ya regía el
  lockout de RÁFAGA 3: comparar la contraseña primero evita que el propio mensaje de error sirva
  de oráculo de enumeración de administradores. Verificado con un test que compara el 401 de un
  ADMIN con contraseña incorrecta contra el 401 de un email inexistente **campo por campo**
  (`Object.keys().sort()`) — deben ser bit a bit idénticos, y lo son.
- **Rate limiting propio, más estricto** (`ADMIN_LOGIN_RATE_LIMIT_IP_PER_WINDOW = 20` / 15 min,
  `auth.constants.ts`) — mismo `RateLimitService` de RÁFAGA 3, pero con un techo menor que el
  login público (150/15min): es la puerta del panel, no infraestructura de tráfico general.
- **`POST /auth/admin-login`** (`auth.controller.ts`) — mismo `LoginDto`, sin cambios de forma
  respecto al login público.
- **Frontend — exclusión del guard, no un caso especial dentro de él**
  (`apps/web/src/middleware.ts`): `isAdminRoute` ahora es `pathname !== '/admin/login' &&
  adminPrefixes.some(...)` — `/admin/login` queda completamente fuera tanto del redirect
  `!session` como del bloqueo por rol, así que un anónimo la abre sin ningún salto. Se verificó
  explícitamente que esto no degenera en bucle: la condición se evalúa ANTES de cualquier chequeo
  de sesión, no como una excepción dentro de la rama que sí redirige.
- **Página propia, aislada por construcción** — `apps/web/src/app/admin/login/page.tsx` vive
  **fuera** tanto de `app/(admin)/` como de `app/(public)/` (carpeta literal `admin/login/`, sin
  paréntesis): en el App Router de Next.js eso la convierte en un árbol físico distinto, así que
  no hereda `(admin)/layout.tsx` (que trae `AdminNav`/`AdminUserBar`, ambos gateados por sesión —
  justo la dependencia circular que habría causado el auto-bloqueo) ni ningún chrome de
  `(public)`. Solo hereda el `app/layout.tsx` raíz. Estilo propio (paleta oscura, sin Google),
  sin coincidencia visual deliberada con `/login` público — refuerza que es una superficie
  distinta, no una variante.
- **`next-auth` — segundo provider `Credentials`, no una rama del existente**
  (`apps/web/src/lib/auth/index.ts`): `id: 'admin-credentials'` llama a `/auth/admin-login`; el
  provider público sigue llamando a `/auth/login` y ahora captura el nuevo `403
  ADMIN_MUST_USE_ADMIN_LOGIN` para relanzarlo como un `CredentialsSignin` con `code:
  'admin_must_use_admin_login'`. El mecanismo de paso de `code` (subclase de `CredentialsSignin`
  de `next-auth`, propiedad `code` propia) se confirmó leyendo el código fuente real de
  `@auth/core`/`next-auth` en `node_modules` en vez de asumir por memoria de framework, dado que
  era una pieza crítica del flujo ("si falla, no hay forma de mostrar el mensaje correcto"): el
  `code` llega intacto a `signIn(..., {redirect:false})` como `result.code` en el cliente.
  `/login` público lo intercepta y muestra el mensaje de redirección a `/admin/login`; el
  provider `admin-credentials` hace lo simétrico con `403 ADMIN_LOGIN_NOT_ADMIN` →
  `admin_login_not_admin`.
- **Redirección tras login** — `/admin/login` reutiliza `resolveCallbackUrl()` de RÁFAGA 4
  (generalizada para aceptar un `fallback` explícito en vez de tener el default de `/mis-anuncios`
  hardcodeado) con fallback `/admin`, así que respeta un `callbackUrl` legítimo sin reabrir el
  open-redirect que RÁFAGA 4 cerró.
- **`AdminUserBar` — corregido de paso, encontrado por revisión propia, no por un fallo
  reportado**: el botón de logout tenía `signOut({ callbackUrl: '/login' })` hardcodeado. Esa
  barra la comparten `ADMIN`/`MODERATOR`/`EDITOR`, pero solo `ADMIN` está atado a
  `/admin/login` — con el hardcode, un `MODERATOR`/`EDITOR` que cerrara sesión habría aterrizado
  en `/admin/login` y habría sido rechazado ahí también (no es `ADMIN`), un mini-auto-bloqueo de
  UX para dos de los tres roles del panel. Corregido a condicional por rol:
  `session.user.role === 'ADMIN' ? '/admin/login' : '/login'`.
- **Impacto en la batería de tests — cambio de contrato esperado, no una regresión**: `ADMIN`
  se usaba de forma masiva como infraestructura de setup vía el login público, tanto en Playwright
  (`global-setup.ts`, `helpers/api.ts::loginViaApi`) como en ~18 suites Jest e2e del backend (una
  duplicaba `loginUser(app, email, password)` por archivo, sin helper compartido). Todo ese código
  de setup ahora usa `/auth/admin-login`/`loginAdminViaApi` para las cuentas `ADMIN` específicamente
  — el resto de logins (USER/MODERATOR/EDITOR/seller) no cambian. `loginViaApi` documentado
  explícitamente como "ya no sirve para ADMIN".
- **Hallazgo colateral durante la verificación — assertion desactualizada preexistente,
  encontrada y arreglada de paso**: correr la batería Playwright completa (no solo el spec nuevo)
  reveló `admin-roles.spec.ts` fallando con `esperado 12, recibido 14` en el conteo de ítems del
  nav — `AdminNav.tsx` ya tenía 14 ítems (Footer de R.3 y "Mensajes de contacto" de RC.2 se
  añadieron sin actualizar esta aserción), sin relación alguna con este cambio de admin-login
  (confirmado con `git log` sobre ambos archivos). Corregido aquí ya que se tenía el contexto
  completo a mano: aserción y comentario del test actualizados a 14. Los otros 3 fallos vistos en
  la misma corrida (`footer-admin.spec.ts`) son la flakiness preexistente ya documentada aparte
  (`project_footer_admin_e2e_broken.md`), sin relación con esta ráfaga tampoco.
- **Tests**: `apps/api/test/admin-login.e2e-spec.ts` (7 tests nuevos) — `ADMIN` con contraseña
  correcta en `/login` público → 403 sin `accessToken`; misma contraseña incorrecta → 401
  idéntico byte a byte al de un email inexistente; `USER` normal sin cambios; `ADMIN` vía
  `/admin-login` → 200, token verificado funcional contra `GET /api/admin/stats`; no-admin vía
  `/admin-login` → 403 (tras confirmar que contraseña incorrecta da 401 primero); rate limit
  propio; lockout también aplicable vía `/admin-login`. Suite backend completa verde (51/51
  suites, 814/814 tests, tras adaptar las ~18 suites afectadas). Suite Playwright completa verde
  (171/171, tras el fix de `admin-roles.spec.ts`; los 3 fallos de `footer-admin.spec.ts` son la
  flakiness preexistente ya conocida). **QA en vivo contra el stack de desarrollo real** (no solo
  e2e, con `admin@marketplace.es` real y un usuario no-admin creado ad hoc): anónimo abre
  `/admin/login` sin redirect y sin botón de Google; `ADMIN` entra por `/admin/login` y llega a
  `/admin`; `ADMIN` con contraseña correcta en `/login` público es rechazado con el mensaje
  específico, permanece en `/login`; `ADMIN` con contraseña incorrecta en `/login` público recibe
  el mismo mensaje genérico que cualquier fallo (sin pista de que es admin); usuario no-admin con
  contraseña correcta en `/admin/login` es rechazado y permanece ahí. 8/8 comprobaciones en
  navegador real, más las mismas rutas confirmadas por `curl` directo contra el backend.

### RC.1 — Formulario de contacto público (endpoint sin autenticación, 5 defensas)

Primer endpoint de escritura del proyecto alcanzable sin JWT (aparte de `/auth/register`) —
superficie de ataque nueva. Diseño aprobado y documentado en memoria de proyecto antes de
implementar (`project_contact_form_design.md`), con requisito central de seguridad. Las 5
defensas, todas en `ContactService.submit()` (`modules/contact/contact.service.ts`):

1. **Honeypot** — campo señuelo `empresa` en `CreateContactMessageDto`, oculto por CSS
   (`position:absolute; left:-9999px`) en el frontend, **nunca `display:none`/`visibility:hidden`**
   (los bots que solo parsean el DOM, sin renderizar CSS, filtran precisamente por esos atributos
   y evitan rellenar el campo — usar `display:none` sería contraproducente). Si llega relleno →
   `200 OK` con el mismo payload de éxito, **sin persistir nada y sin notificar** — silencio
   deliberado para no enseñarle a un bot qué detección lo detuvo.
2. **Time-trap firmado** (`ContactTimeTrapService`) — `GET /contacto/token` emite
   `issuedAt` + `HMAC-SHA256(issuedAt, CONTACT_FORM_SECRET)` (secreto **dedicado**, nunca
   `JWT_SECRET`); verificación con `crypto.timingSafeEqual` (comparación en tiempo constante) y
   ventana `[3s, 2h)` desde la emisión. Fuera de ventana o firma inválida → mismo `200` silencioso
   que el honeypot. El frontend (`ContactForm.tsx`) pide el token en un **client component**, no
   en un Server Component con `fetch` cacheable — evita a propósito el mismo riesgo de caché ISR
   que ya mordió al footer en H6.4 (un token cacheado compartiría `issuedAt` entre visitantes y
   rompería el time-trap para todos).
3. **Rate limit** (`ContactRateLimitService`, Redis `INCR`+`EXPIRE`, sin dependencia nueva —
   reutiliza el cliente que ya usa BullMQ) — 5/hora por IP + 200/hora global, ambos contadores
   incrementados siempre (incluso si el de IP ya excede) para que un ataque con IPs rotando
   también agote el global. Supera cualquiera de los dos → `429` explícito con `retryAfter` (mismo
   patrón que el cooldown de bump en `billing.service.ts`) — aquí sí es ruidoso a propósito: no
   ayuda a un bot a evadir el honeypot, y el cliente necesita saber que debe esperar.
   **Depende de que `app.set('trust proxy', N)` (`main.ts`, config `trustProxyHops`,
   `TRUST_PROXY_HOPS` env var, default 1) refleje la topología REAL de despliegue — confirmado
   con el usuario: 1 proxy en producción.** Esto solo es fiable si ese proxy **sobrescribe**
   `X-Forwarded-For` en vez de reenviar la cabecera del cliente tal cual; no verificado contra el
   proxy real de producción, ver «Limitaciones» más abajo.
4. **XSS contra el admin** (el vector más grave, ya que un desconocido escribe el mensaje y un
   admin con sesión lo lee) — el mensaje se guarda y se sirve como texto plano; el panel admin
   (`/admin/mensajes-contacto`) lo interpola directamente en JSX (React escapa por defecto),
   **`dangerouslySetInnerHTML` prohibido** en esa vista. Los emails de aviso (`SEND_CONTACT_NOTIFICATION`)
   y de respuesta (`SEND_CONTACT_REPLY`) usan `text:` en Resend, nunca `html:` — mismo patrón que
   ya seguía `NotificationProcessor` para verificación/reset/alertas, sin necesidad de sanitizado
   nuevo porque nunca se genera HTML a partir de contenido no confiable.
5. **Email header injection** — `@IsEmail()` estricto en el DTO de entrada; la respuesta del
   admin (`POST /admin/contact-messages/:id/responder`) envía siempre a `ContactMessage.email`
   (inmutable, leído del propio registro), nunca a un campo del body — `whitelist:true` del
   `ValidationPipe` global rechaza con `400` cualquier intento de colar un `to`/`email` alternativo
   en el DTO de respuesta. `@MaxLength` en todos los campos (`mensaje` ≤ 5000, `telefono` ≤ 20…)
   contra relleno de BD.

**Notificación a admins — fan-out, no buzón de rol.** `Notification` (B1) es estrictamente
`userId` 1:1; no existe (ni se construyó) un mecanismo de "notificar a un rol". `ContactService`
resuelve esto con fan-out: `prisma.user.findMany({where:{role:'ADMIN'}})` + una `Notification`
`CONTACT_MESSAGE` y un job `SEND_CONTACT_NOTIFICATION` por cada admin. Confirma que B1 era
extensible sin migración (`Notification.type` es `String`, no enum) — objetivo explícito del
diseño. **Limitación conocida y aceptada** (no resuelta aquí): cuando un admin atiende el
mensaje, las notificaciones de los demás admins no se marcan como leídas — exigiría consultar
dentro de `Notification.data` (Json), justo lo que este diseño evita. Ruido tolerable con pocos
admins; revisar si el equipo de admins crece mucho.

**Modelo (histórico, ver RC.2 más abajo — `ContactMotivo` ya no es un enum):** `ContactMessage`
(enum `ContactEstado` `NUEVO|LEIDO|RESPONDIDO|CERRADO`, **sin columna de IP** — decisión RGPD, la
IP solo vive en Redis para el rate limit, con TTL de 1 h) + `ContactReply` (1:N, no un campo
mutable — permite responder más de una vez y deja rastro auditable de qué se envió).
`AdminContactMessagesController` sigue el molde de `BannersService`: `AuditLog` dentro de
`$transaction`, sin `DELETE` (`CERRADO` no es terminal — el estado se cambia libremente entre
cualquier par, ver RC.2 «Ajuste 1»). Migración `add_contact_message`.

**Hallazgo durante la verificación (no producto, sí entorno):** dev y test comparten la misma
instancia Redis sin namespace separado (`REDIS_URL` idéntica en `.env` y `.env.test`) — correr la
suite e2e de contacto deja contadores `contact:rate:*` en Redis que también bloquean al servidor
`dev` durante QA manual inmediatamente después. Sin fix de producto (no aplica en producción, un
solo entorno); anotado como fricción de flujo de trabajo local, no como bug. **Causa raíz cerrada
2026-07-12** — dev/test ya están en dbs Redis separadas (db 0 / db 1), ver «Colisión Redis dev/test
en local» en la sección de Hito 7.

### RC.2 — Cambio manual de estado (confirmado, sin código) + motivos de contacto configurables

Dos ajustes sobre RC.1, el mismo día.

**Ajuste 1 — cambio manual de estado.** Se observó antes de tocar nada: tanto el endpoint
(`PATCH /admin/contact-messages/:id/estado`) como la UI (selector de estado en la página de
detalle) **ya existían** de RC.1 — no fue necesario código nuevo. `updateEstado()` no tenía (ni
tiene ahora) restricciones de transición: cualquier estado admite cambiar a cualquier otro, con
`AuditLog CONTACT_MESSAGE_STATUS_CHANGE` en cada salto — decisión de diseño confirmada explícitamente
("el admin sabe lo que hace"). El automatismo de RC.1 (`NUEVO→LEIDO` al abrir, `→RESPONDIDO` al
responder) sigue intacto — el cambio manual lo complementa, no lo sustituye. Se amplió la
cobertura de tests para probar una cadena arbitraria de transiciones
(`NUEVO→CERRADO→LEIDO→RESPONDIDO→NUEVO`), no solo un salto.

**Ajuste 2 — motivos configurables (enum → datos).** `ContactMotivo` (enum Prisma) sustituido por
el modelo `ContactReason` (`nombre`, `orden`, `activo`, timestamps) para que el admin pueda
crear/renombrar/reordenar/desactivar motivos sin migración. `ContactMessage.motivo` pasa de enum a
relación (`motivoId` FK, `onDelete: Restrict`). Mismo molde que Banner/SponsoredAd: **sin DELETE,
solo desactivación** — un motivo desactivado deja de ofrecerse en `/contacto` pero los mensajes
históricos conservan su `motivoId` intacto (nunca se borra), lo que resuelve de raíz "¿qué pasa
con los mensajes de un motivo borrado?" al no permitir que se borren. Guard explícito en
`ContactReasonsService.update()`: no se puede desactivar el último motivo activo (`400` — el
formulario público se quedaría sin opciones).

**Migración en dos pasos (molde `footer-backfill.ts` — nunca borrar el origen antes de migrar
los datos):**
1. `add_contact_reason` — crea `ContactReason` + columna `ContactMessage.motivoId` nullable,
   **conserva** la columna/enum `motivo` legacy.
2. `pnpm contact-reason-backfill` (`src/commands/contact-reason-backfill.ts`) — crea los 6 motivos
   con nombres legibles (no el `SCREAMING_SNAKE_CASE` del enum: "Consulta general", "Problema
   técnico"…) y mapea cada `ContactMessage.motivo` (leído vía `$queryRaw`, mismo motivo que en
   footer-backfill: el cliente Prisma tipado no debe depender de que la columna siga viva) a su
   `motivoId`. Idempotente — aborta si ya existe algún `ContactReason`.
3. `drop_contact_motivo_enum` — retira la columna `motivo` y el enum `ContactMotivo`, `motivoId`
   pasa a `NOT NULL`. Autorada a mano (SQL generado con `prisma migrate diff --script`, ya que
   `prisma migrate dev` exige confirmación interactiva ante una columna con datos — no soportado en
   este entorno no interactivo) y aplicada con `prisma migrate deploy`.

**Notification.data (fan-out, B1) guarda el NOMBRE ya resuelto, no el `motivoId`** — mismo
principio de "snapshot autocontenido, no punteros" que ya regía el diseño (ver RC.1): el
snapshot de una notificación debe sobrevivir aunque el motivo se renombre o se desactive después.
`ContactService.notifyAdmins()` recibe el nombre resuelto como parámetro, no el id.

**Endpoints nuevos:** `GET /contacto/motivos` (público, solo activos ordenados — puebla el
`<select>` del formulario; sin riesgo de caché stale porque el formulario ya es fetch de cliente,
no SSR, por el time-trap de RC.1). `GET|POST|PATCH /admin/contact-reasons` +
`PATCH /admin/contact-reasons/reorder` (`@Roles(ADMIN)`, molde `FooterAdminController`: ruta
estática `reorder` declarada antes de `:id`). El filtro por motivo del listado de mensajes
(`/admin/mensajes-contacto`) usa `GET /admin/contact-reasons` (TODOS, incluidos inactivos —
hay mensajes históricos con motivos ya desactivados), no el endpoint público.

**Frontend:** nueva página `/admin/motivos-contacto` (CRUD + reorder con flechas ↑↓, molde
`/admin/categorias`: swap optimista de 2 `orden` + rollback por refetch en error). El formulario
público (`ContactForm.tsx`) pide `GET /contacto/motivos` en el mismo `useEffect` que ya pedía el
token del time-trap.

---

### Teléfono en anuncios + Compartir anuncio (feature cerrada)

Dos features sobre la ficha del anuncio, la (A) con decisiones de privacidad ya tomadas antes
de implementar.

**A — "Ver teléfono".** `User.phone` ya existía (privado, dato de cuenta, editable en `/perfil`
desde antes de esta feature). Se añade `Listing.phone String?` — el teléfono **PUBLICADO** de
ese anuncio en concreto, independiente del de perfil. Reutiliza el patrón exacto del prefill de
ubicación (perfil → `/publicar` vía `getMe()` en el Server Component, valor inicial de
`useState`, un único momento de prefill — no sync continuo): `StepUbicacion` (compartido por
`PublicarWizard` y `EditarWizard`) gana un campo `phone` con el aviso explícito "Este número
será visible para usuarios registrados que pulsen 'Ver teléfono'" — nunca se publica sin que el
usuario lo vea. Al editar, el campo muestra el teléfono **del anuncio**, no el del perfil (mismo
comportamiento que city/province/postalCode — `EditarAnuncioPage` siembra desde `listing.phone`).
Vacío admitido (mismo convenio que `postalCode`): borra el teléfono publicado sin afectar al del
perfil.

**Privacidad — el punto crítico.** `ListingsService.findBySlug()` usa
`prisma.listing.findUnique({ include: LISTING_INCLUDE })` sin `select` de nivel superior, así
que **todas** las columnas escalares de `Listing` viajan por defecto — si `phone` fuera una
columna más, se filtraría en el JSON público de la ficha sin que ninguna capa de serialización
lo detuviera (este proyecto no tiene una `ListingResponseDto`/mapper; el shape del `include` ES
la respuesta). La solución: un destructuring explícito (`const { phone, ...publicListing } =
listing`) justo antes de cachear en Redis y de devolver — el único punto donde se garantiza que
el número nunca llega ni al caché ni al cliente. Solo se expone `hasPhone: boolean` (pinta o no
el botón). El número real se sirve por `GET /listings/:id/phone` (`JwtAuthGuard`), que hace su
propia query `select: { phone, status }` — 404 si el anuncio no existe, no está `ACTIVE` o no
tiene teléfono. Rate limit (reutiliza `RateLimitService`, ya genérico desde RC.1): 30/hora por
usuario + 60/hora por IP (Redis INCR+EXPIRE, mismo patrón que el formulario de contacto),
comprobado **antes** de tocar la BD — un scraper que insiste con ids inválidos también agota su
propio cupo. Test de privacidad explícito en `listing-phone.e2e-spec.ts`: busca el número en
crudo dentro del JSON servido a un anónimo y confirma que **no está**.

**Validación:** `LISTING_PHONE_REGEX` (`listing-phone.constants.ts`) — permisivo (dígitos,
espacios, `+`, `-`, paréntesis; 6-20 caracteres) más una excepción explícita para cadena vacía
(borrar el teléfono). Aplicado en `CreateListingDto`/`UpdateListingDto`; el frontend replica la
misma regex para feedback inmediato antes de tocar el backend.

**B — Compartir anuncio.** `ShareButton.tsx`: en móvil, si `navigator.share` existe (detectado
en un `useEffect` — nunca en el render inicial, para no desajustar la hidratación SSR/cliente),
un único botón dispara el share nativo del sistema. Si no, un `DropdownMenu` (shadcn) con
Copiar enlace / WhatsApp (`wa.me`) / Telegram (`t.me/share/url`) / Email (`mailto:`), todos con
la URL canónica de la ficha y el título escapados (`encodeURIComponent`). **Hallazgo Radix**: el
item "Copiar enlace" necesitaba `onSelect={e => e.preventDefault()}` — por defecto Radix cierra
el `DropdownMenu` al seleccionar un item, lo que desmontaba el feedback "Enlace copiado ✓" antes
de que se llegara a ver (encontrado por el test Playwright, no por inspección visual). La ficha
no tenía `alternates.canonical` — se añadió en `generateMetadata` (`SITE_URL` + `/anuncio/:slug`,
mismo valor que usa `ShareButton`, una sola fuente). El fallback `opengraph-image.tsx` (solo se
ve en anuncios sin fotos — `generateMetadata` ya pone su propia `openGraph.images` con la foto
real cuando existe, y esa gana) renderizaba el slug en crudo; ahora hace `getListing(slug)` y
muestra el título real.

**Tests:** `listing-phone.e2e-spec.ts` (backend, 15 casos — privacidad de payload en cache
hit/miss, 401/404/429, creación/edición con validación, teléfono de perfil nunca en el perfil
público del vendedor) + `listing-phone-share.spec.ts` y `prefill-telefono.spec.ts` (Playwright —
botón ausente sin teléfono, HTML anónimo sin el número en crudo, redirect a login con
`callbackUrl`, enlace `tel:` tras revelar, canonical, copiar/WhatsApp/Telegram/Email, prefill
perfil→wizard y anuncio-no-perfil al editar). **Nota de proceso**: `seed-playwright.ts` reseteaba
`city/province/postalCode` de `seller-e2e` en cada seed pero no `phone` — sin ese reset, una
repetición local de la batería sin reiniciar la BD hereda el teléfono de perfil de una pasada
anterior y el test "sin teléfono en perfil" da un falso negativo (mismo principio que
`feedback_ci_verde_repetido`: resetear entre CADA pasada, no solo antes de la primera). Corregido
añadiendo `phone: null` al mismo `update` que ya reseteaba la ubicación.

---

## 3. Limitaciones conocidas y deuda técnica

### RC.1 — Rate limit por IP no verificado contra el proxy real de producción

El rate limit por IP del formulario de contacto (`ContactRateLimitService`, 5/h) depende de que
`app.set('trust proxy', 1)` (`TRUST_PROXY_HOPS=1`) coincida con la topología real de despliegue Y
de que ese proxy **sobrescriba** `X-Forwarded-For` con la IP real del cliente en vez de reenviar
lo que el cliente le mande. Ninguno de los dos supuestos está verificado contra la infraestructura
de producción real todavía — si el proxy reenvía la cabecera del cliente sin más, un atacante
puede rotar su propia IP declarada y evadir el límite por IP sin esfuerzo. El **límite global**
(200/h, no depende de la IP) es la red de seguridad mientras esto no se verifique: sigue
protegiendo aunque el de IP resulte falsificable. Acción pendiente: confirmar el comportamiento
exacto de `X-Forwarded-For` en el proxy/CDN de producción antes o justo después del primer
despliegue de esta feature.

### ✅ Flaky de indexación Meilisearch — RESUELTO (H6, causa raíz: `waitForTask`)

El flaky arrastrado desde RC5.5 (tests de `listing-card-attrs.spec.ts` y `categoria-meili.spec.ts` fallando intermitentemente) ha sido cerrado en su causa raíz: `addDocuments()` completaba el job BullMQ antes de que el documento fuera consultable en Meilisearch. Fix: `waitForTask(task.taskUid)` en `indexListing()`. Había capas adicionales (geocoding síncrono, límite de listings en seed, condition faltante en helper) también resueltas. Ver §Lecciones de método del CI.

### Deuda de test/CI consolidada tras BLOG-FOOTER-COLUMNAS (pendiente para el Hito 9)

Investigación de los fallos de CI durante el cierre de BLOG-FOOTER-COLUMNAS dejó
varios hallazgos de deuda técnica en la suite de tests, deliberadamente NO resueltos
de raíz ahora (fuera de alcance de esa ráfaga) — consolidados aquí para el Hito 9:

**1. Aislamiento dev/test de BD — mitigado con `--runInBand`, cura real pendiente.**
`--runInBand` fuerza a Jest a correr las suites `*.e2e-spec.ts` en serie, evitando que
varios workers paralelos truncaran/limpiaran la misma `marketplace_test` a la vez (FK
violations, deadlocks, 401/404 espurios — visto de forma consistente en CI sin la
flag). El script canónico `apps/api/package.json#test:e2e` ya la lleva. Es una
**mitigación**, no la cura: el backend e2e ahora es más lento (serie en vez de
paralelo) y el problema de fondo — suites sin BD/schema propio, todas comparten
`marketplace_test` — sigue sin resolverse. **Cura real**: aislar cada worker de Jest
en su propia BD o schema (p. ej. derivando el nombre de `JEST_WORKER_ID`), lo que
permitiría volver a correr en paralelo sin las condiciones de carrera.

**Resuelto en Hito 9 (mini-diseño de aislamiento dev/test):** se investigó el mapa real
(33 suites `*.e2e-spec.ts`, 564 tests, 110 s en serie con `--runInBand`) y se evaluaron
tres opciones: schema-por-worker (`JEST_WORKER_ID`), BD-por-worker, y quedarse en
`--runInBand` arreglando solo el seed. **Decisión: no aislar por worker todavía.**
Razón: la suite es corta (110 s), y el paralelismo real ahorraría ~60-70 s a cambio de
una orquestación no trivial — `JEST_WORKER_ID` no existe en `globalSetup` (solo dentro
de cada worker), así que schema-por-worker obligaría a crear/migrar los schemas con
idempotencia propia en otro punto del ciclo de vida de Jest. La Opción B
(BD-por-worker) se descarta sin más análisis: estrictamente más cara que la A sin más
aislamiento útil, porque Redis/Meilisearch seguirían compartidos igual. Si la suite
crece sustancialmente (p. ej. supera los 600 s en serie), reconsiderar la Opción A.

Más importante: **el bug de contaminación que motivó esta investigación no era un
problema de aislamiento entre workers — era contaminación entre corridas.** Reproducido
en vivo: `freeActiveListingLimit` quedó en `100` (residual de una sesión anterior de
`apps/web/e2e/admin-ajustes-numeric.spec.ts`, que edita ese ajuste vía Playwright
compartiendo la misma `marketplace_test`) y `rf7-limits.e2e-spec.ts` +
`rf7-expiration.e2e-spec.ts` fallaban (6 tests, `expected 403, got 200`) porque
`prisma/seed-test.ts#seedSettings()` usaba `createMany({ skipDuplicates: true })`:
si la fila `Setting` ya existía, el seed nunca la reseteaba a su default.
`--runInBand` nunca iba a arreglar esto (es un solo worker igual). **Fix real:**
`seedSettings()` ahora hace `upsert` por clave forzando el valor en `update`
(mismo patrón que `seedCategories()` ya usaba en el mismo archivo). Verificado sobre
estado sucio real (no solo en BD limpia): con `freeActiveListingLimit=100` en la BD,
correr el seed lo resetea a `5` y las 33 suites (564 tests) pasan limpias.
`--runInBand` se mantiene, pero ahora como decisión informada (suite corta, no
compensa aislar) y no como parche de un bug que en realidad vivía en el seed.

**2. Carrera de navegación del App Router bajo `next start` — CARACTERIZADA y mitigada parcialmente
(causa residual sin cerrar).** Mismo bug de fondo documentado de forma independiente al menos 5 veces a
lo largo de varias ráfagas, cada vez como si fuera un hallazgo nuevo — consolidado aquí. Una
investigación dedicada de 5 rondas (fuera del ciclo de ráfagas de producto, cada ronda con su propia
hipótesis medida y confirmada o refutada con datos) llevó esto de "sin caracterizar" a "caracterizado +
mitigado parcialmente, causa residual conocida pero no identificada".

**Qué es:** bajo `next start` (nunca reproducido bajo `next dev`), un click sobre un `<Link>` del App
Router a veces no completa la transición de navegación — el elemento registra el click, la RSC payload
y los assets de la página destino se piden y responden con 200, pero el router nunca confirma la
transición (sin `history.pushState`, sin cambio de DOM, sin error de consola). No es una ventana
transitoria: reintentar el click no recupera el estado roto — la página queda con el router cliente
**persistentemente wedged** el resto de su vida. Confirmado instrumentando `flujo-critico.spec.ts` real:
tras el primer fallo, 5 reintentos consecutivos fallan todos igual de limpio, con la request RSC
respondiendo 200 en <10 ms cada vez — no es un problema de red ni de latencia, es el router que no
conmuta pese a tener ya la respuesta.

**Causa identificada:** condición de carrera en la contabilidad de prefetch/caché del router cliente del
App Router de Next 15, disparada por navegación/prefetch concurrente hacia el mismo patrón de ruta
dinámica (`/anuncio/[slug]`) cuando hay un grid grande de tarjetas (`ListingCard`/`MyListingCard`) en
pantalla — cada `<Link>` visible dispara su propio prefetch, y con un grid lleno (`hitsPerPage: 24`, el
techo real de producción, no un caso extremo de test) son hasta ~24 prefetches concurrentes al mismo
patrón dinámico. Bug conocido de Next.js sin fix upstream a fecha de esta investigación (misma firma que
vercel/next.js discussion #57565, persiste en 15.5.x). **No es un problema de test — afecta a usuarios
reales**: cualquier categoría o búsqueda con una página de resultados llena está en la misma condición.

**Descartado por la investigación** (orden cronológico de las 5 rondas; cada hipótesis medida y
refutada con datos, no supuesta por lectura de código):
1. **Hidratación incompleta** (click antes de que React enganche el handler del `Link`) — refutada: el
   sitio "más frío" (un solo click tras un solo `goto`, sin navegación previa en la página) falló MENOS
   que los sitios con más actividad previa, justo lo contrario de lo que predice la hipótesis.
2. **Repro sintético mínimo de navegación acumulada** (N ciclos de `goto`/`reload`/navegación-por-Link a
   una página trivial antes de un click, N hasta 50) — 180 trials, 0 fallos. Refuta que sea pura "cuenta
   de navegaciones del cliente" sobre una página sin más contenido.
3. **Agotamiento de recurso del servidor** (heap de `next start`/`nest start`, backlog de la cola BullMQ
   `indexing`) — refutado instrumentando en vivo sobre `flujo-critico.spec.ts` real: heap plano (76-138
   MB sin tendencia en 15 repeats), cola BullMQ en `waiting=0, active=0` en el 100% de las muestras. El
   hallazgo de que el estado del CLIENTE se destruye entre repeats (los fixtures abren `newContext()` +
   `close()` por test) pero la degradación persiste sí apuntó correctamente a que la causa vive del lado
   servidor/página, no del navegador — solo que no es memoria, CPU ni cola, es el punto 4.
4. **Repro controlado por nº de tarjetas** (N=1,5,10,15,20 anuncios reales sembrados vía API, con
   imágenes reales subidas, con sesión autenticada) — 0 fallos incluso a N=20, pese a variar en teoría la
   única variable que parecía explicarlo. Este repro sintético nunca reprodujo el fallo pese a varios
   intentos de ajuste — indica que hay al menos un ingrediente más, no capturado por un grid sintético
   aislado, y que el banco de pruebas fiable sigue siendo el escenario real (`flujo-critico.spec.ts` en
   loop), no un repro minimal.
5. **Prefetch por viewport Y por hover de `next/link`** — `prefetch={false}` en `ListingCard`/
   `MyListingCard` sí suprime ambos (confirmado instrumentando: un hover explícito sobre una tarjeta de
   un grid de 24 no dispara ninguna request; un click "natural" que recorre el grid con el cursor solo
   dispara la request de su propio destino, ninguna de las 23 tarjetas restantes). Aun así la carrera
   **persiste al 20-50%** tras aplicar el arreglo → el prefetch de `<Link>` no es la única fuente; algo
   más en un grid grande sigue corrompiendo el router, sin identificar.

**Mitigación aplicada** (`ListingCard.tsx`, `MyListingCard.tsx` — comentario en código referenciando
#57565): `prefetch={false}` en el `<Link>` de tarjeta en contextos de listado (grids). Coste cero, sin
regresiones. **Medida contra el mismo banco de pruebas antes/después** (no un verde suelto):
`flujo-critico.spec.ts` en loop de 15 pasadas, mismo build y mismo entorno — **53% → 20% de fallo**
(8/15 → 3/15). Reducción real y sustancial, pero no cierre: `busqueda-mapa.spec.ts` (toggle Lista/Mapa)
se mantuvo en ~30% y `prefill-ubicacion.spec.ts` (enlace "Editar", grid de `mis-anuncios` más grande por
el orden de ejecución de esa suite) en ~50% tras el mismo arreglo, sin mejora medible. `wizard-herencia.
spec.ts` (mismo tipo de enlace, grid más pequeño en ese punto de la suite) sí quedó limpio (0/10). Todos
los fallos residuales muestran la misma firma exacta de siempre — no es una regresión ni un bug nuevo,
es la misma carrera a menor incidencia según el tamaño del grid.

**`toPass` mitigadores del lado del test: MANTENIDOS, no retirar.** La carrera sigue viva en los sitios
con grids grandes; quitar el reintento-de-click reintroduciría flaky real en CI.

**`loginAs` (`admin-roles.spec.ts`) queda FUERA de esta familia.** Mecanismo de navegación distinto (un
submit de formulario + `goto` real, no un click sobre `<Link>` del App Router) — carrera de hidratación
propia, ya documentada aparte (ver nota de feedback sobre el login), sin relación con esto.

**Punto de retoma si se persigue el residual** (madriguera nueva, no una continuación barata de lo ya
hecho — rendimiento decreciente ya señalado, conscientemente no perseguido más allá de esto): qué otra
cosa, además del prefetch de `<Link>` (ya descartado con datos), corrompe el estado del router bajo un
grid grande. El repro controlado por N de la ronda 4 (aunque no reprodujo el fallo en su forma actual) y
el banco de pruebas real (`flujo-critico.spec.ts` en loop, con `--retries=0`) quedan como punto de
partida reutilizable para medir cualquier hipótesis futura de forma cuantitativa, sin depender de un
verde suelto.

**Método:** 5 rondas de refutación sistemática (hidratación → acumulación de cliente → recurso de
servidor → nº de tarjetas → prefetch viewport/hover), cada hipótesis confirmada o refutada con datos
medidos, con un criterio de parada explícito por ronda para evitar la madriguera cuando el rendimiento de
seguir investigando se volvió incierto. Vale como plantilla para cualquier flaky futuro de este tipo:
caracterizar el patrón común antes de tocar nada, reproducir de forma controlada y medir una tasa base,
aislar una variable por ronda, y parar cuando una ronda refuta limpiamente en vez de forzar la siguiente
hipótesis.

**3. Indexación de Meilisearch en CI — dos problemas distintos, no confundir.**

**3a. RESUELTO — la asunción "el índice empieza vacío" en `busqueda-mapa.spec.ts` era falsa
siempre en CI, no una cuestión de velocidad.** Diagnosticado y corregido en H8 Bloque D fase 4 (ver
«Historial de ráfagas — Hito 8», sección «Ráfaga de estabilización», punto 1 — «`busqueda-mapa.spec.ts`
— la asunción "Meilisearch está vacío" es FALSA siempre en CI real»): el job `e2e` ejecuta primero la suite Jest del backend, que indexa anuncios reales como
parte de probar el propio módulo de búsqueda, compartiendo el mismo contenedor de Meilisearch con
Playwright — el índice nunca está vacío cuando arranca Playwright. No era lentitud de indexación;
era un test que asumía un estado inicial que la propia arquitectura del job de CI nunca produce. Las
dos pruebas afectadas se corrigieron para usar una query sin coincidencias garantizadas en vez de
depender de un índice vacío.

**3b. RESUELTO — la indexación (BullMQ + Meilisearch) sí era lenta de verdad en CI, no solo el test
impaciente. Hipótesis de `concurrency=1` confirmada con datos (local) y arreglada.** Este era un
problema distinto de 3a: `listing-card-attrs.spec.ts` y similares necesitaban hasta 20-28 recargas de
`waitForCard` (~30-42 s sobre un timeout de 45 s, `intervalMs=1500`) antes de encontrar la card recién
publicada.

*Confirmación empírica (repro local, no logs de CI reales):* con la instrumentación `[TIMING]` ya
existente en `indexing.processor.ts`, una ráfaga de 20 anuncios de 20 usuarios distintos publicándose
a la vez (mismo patrón que varias suites Playwright publicando en la misma ventana) mostró
concurrencia observada = 1 sin excepción (ningún `index start` solapa con el `index done` anterior) y
`queueWaitMs` creciendo lineal y monótonamente con la posición en la ráfaga (3ms → 2154ms sobre 20
jobs), mientras `indexTimeMs` se mantenía estable (~92-126ms, sin tendencia). Confirma que el cuello
de botella era la cola (concurrency=1 por omisión — ningún `@Processor(...)` de los 5 processors del
proyecto declaraba la opción), no Meilisearch en sí.

*Antes de subir `concurrency` se encontró una dependencia de orden real* (no solo el descuido de la
opción no declarada): en `update()`, cuando cambiaba la ubicación en texto sin coordenadas explícitas,
se encolaban `geocode` e `index` para el mismo `listingId` uno detrás de otro, confiando en que
concurrency=1 los procesara en ese orden exacto (comentario explícito en el código: "Do NOT call
handleIndex here... FIFO... one single Meilisearch write instead of two"). Con concurrency>1 esto
podía indexar coordenadas viejas sin ningún job posterior que lo corrigiera. Arreglado:
`handleGeocode()` ahora reindexa directamente al terminar (éxito o fallo permanente de geocoding) en
la misma ejecución del job — sin depender del orden de otro job separado — y `update()` ya no encola
un `index` adicional cuando encola `geocode` (evita el duplicado que podía re-introducir la misma
carrera). `SearchService.indexListing()` ya maneja ACTIVE/no-ACTIVE internamente, así que la llamada
extra es segura también para anuncios DRAFT (no-op vía `removeListing`).

*Riesgo residual, más general y más estrecho, documentado y NO arreglado (deuda nueva aceptada):*
dos jobs `index`/`geocode` para el MISMO `listingId` procesados en paralelo (p. ej. dos ediciones casi
simultáneas del mismo anuncio) pueden completarse fuera de orden — el que leyó Postgres primero podría
escribir en Meilisearch después, dejando datos viejos sin corrección posterior. A concurrency=1 esto
era estructuralmente imposible; a concurrency>1 es una ventana real pero estrecha (requiere edición
concurrente del mismo anuncio, no anuncios distintos — el caso común de la ráfaga de CI). No se
implementó un lock por `listingId` (Redis, ya disponible en el proyecto) por ser mayor alcance del
necesario para cerrar el síntoma de CI; candidato si en el futuro se observa este patrón en producción.

*`concurrency` elegido: 5* (`INDEXING_CONCURRENCY` en `queue.constants.ts`, constante literal —
**no** env var: `@Processor(...)` evalúa sus opciones en tiempo de decoración de clase, cuando
`QueueModule` se importa desde `app.module.ts` ANTES de que `ConfigModule.forRoot()` —más abajo en el
mismo archivo— cargue `.env`; leer `process.env` ahí vería `undefined` en silencio). Barrido local
sobre el mismo repro de 20 anuncios:

| concurrency | concurrencia observada | queueWaitMs último job | indexTimeMs avg | totalFromEnqueue último job |
|---|---|---|---|---|
| 1 | 1 | 2154ms | 110.3ms | 2266ms |
| 3 | 3 | 667ms | 106.8ms | 766ms |
| 5 | 5 | 301ms | 94.5ms | 393ms |
| 8 | 8 | 306ms | 117.6ms | 402ms |

5 es el punto óptimo local: ~5.8x más rápido que concurrency=1 sin degradar `indexTimeMs`; 8 no mejora
la latencia de cola (mismo `totalFromEnqueue` que 5) y `indexTimeMs` empieza a subir — señal temprana
de contención, no de beneficio. El número correcto depende del runner, no solo de Meilisearch —
re-medir si CI sigue mostrando el síntoma tras este cambio.

*Verificación:* batería e2e backend completa verde (41 suites, 630 tests) y batería Playwright
completa verde (157 tests) tras el cambio, ambas sin backend de dev fantasma en :3001 (parado antes de
correr, ver deuda "Colisión Redis dev/test en local" más abajo). Confirmación directa del síntoma
original: en la corrida verde, cada línea `[waitForCard]` de `categoria-meili.spec.ts` y
`listing-card-attrs.spec.ts` mostró `found after 1 reload(s)` — antes hasta 20-28.

**4. Observabilidad de `callRevalidateEndpoint` — errores tragados en silencio, ya ocultaron 3 bugs reales.**
El fire-and-forget (`fetch(...).catch(() => {})`, sin comprobar `response.ok`) ha
enmascarado, en una sola sesión de trabajo: `REVALIDATE_SECRET` ausente en el
frontend (footer semi-dinámico), `REVALIDATE_SECRET` ausente en CI, y `APP_URL`
apuntando al puerto equivocado en CI (ver sección anterior) — los tres silenciosos,
los tres solo detectados al investigar fallos de test, nunca por un log de error.
**Resuelto en Hito 9.** `BlogService` tiene ahora `Logger` de clase. Los tres
silencios se cerraron sin tocar el fire-and-forget (`revalidate`/`revalidateTag`/
`callRevalidateEndpoint` siguen `void`, sin `await` en los callers, sin propagar,
sin reintentos):
- Secret ausente: `Logger.warn` **una sola vez, en el constructor** (el servicio es
  singleton de Nest) — no por request, porque es un modo soportado en dev (el ISR
  sigue revalidando por su propio TTL), no necesariamente una config rota.
- Respuesta no-ok: tras el `fetch`, `if (!res.ok) this.logger.warn(...)` con el
  status y el `target` (`path` o `tag:...`) — cubre el 404 de `APP_URL` mal
  configurado, que antes se colaba como "éxito" porque `fetch()` solo rechaza en
  fallo de red, nunca en 4xx/5xx.
- Excepción/fallo de red: el `.catch(() => {})` mudo ahora loguea
  `this.logger.warn(...)` con el mensaje del error, mismo `target`.
- El `target` se construye aparte de la URL real y es lo único que se loguea — la
  URL lleva `secret` en la query string y nunca debe aparecer en logs.
- Test unitario (`blog.service.spec.ts`, sin Nest boot ni Postgres): fetch mockeado
  para las 4 rutas (no-ok, red, ok, secret ausente) + verificación explícita de que
  el caso ok NO loguea (sin falso positivo). Verificado además que 33/33 suites e2e
  (564/564 tests) siguen verdes tras el cambio.

**Deuda relacionada, CERRADA en la ráfaga «Stripe — checkout + renovación» (2026-07-14):**
`billing.processor.ts` hacía `.catch(() => undefined)` al persistir `stripeCustomerId`
tras un webhook de Stripe (`prisma.user.update(...)`), comentado como "idempotent;
ignore if already set". A diferencia de ese comentario, el `catch` tragaba
**cualquier** error, no solo el de fila duplicada esperado — un fallo real de Postgres a
mitad del webhook quedaba igual de silencioso (el usuario pagaba pero el `customerId`
no quedaba vinculado, y el siguiente pago creaba OTRO cliente en Stripe sin forma de
reconciliar). Arreglado: ya no se traga — ver sección "Stripe — checkout + renovación
de suscripción Pro (e2e), CERRADO" más abajo para el detalle y la verificación.
Distinto de `search.service.ts:225` (`.catch(() => undefined)` con comentario
`// index already exists — that's fine`): ahí el swallow está bien acotado a un caso
esperado y documentado — nunca fue deuda.

**Confirmación en vivo de esta deuda (H6.4, rediseño portada):** durante la verificación de la
portada, el footer apareció sin sus columnas dinámicas de `/paginas`. Investigado antes de tocar
nada: `git diff` sobre `Footer.tsx`/`layout.tsx`/`lib/api/blog.ts` estaba vacío (la portada no los
toca) y `GET /paginas/footer` respondía con las columnas reales. Causa: `.next/cache/fetch-cache`
tenía una entrada `body:"[]"` bajo el tag `footer-pages` (TTL 3600s) — quedó cacheado un resultado
vacío porque el `revalidateTag('footer-pages')` fire-and-forget de `BlogService` (línea 445 de
este mismo punto 4) no llegó a tiempo al frontend. Confirmado disparando `POST
/api/revalidate?tag=footer-pages` a mano: las columnas reaparecieron de inmediato. **No fue
necesario ningún cambio de código** — es exactamente el patrón "error tragado en silencio" ya
descrito arriba, esta vez con el síntoma en un tercer sitio (footer en desarrollo, no solo tests/CI).
No cambia la prioridad de la deuda (sigue sin reintentos ni verificación activa), pero confirma que
sigue viva y que puede reaparecer como "algo se rompió" en cualquier sesión de desarrollo con el
frontend recién arrancado.

**5. `REVALIDATE_SECRET`/`APP_URL` deben estar configurados en TODOS los entornos.**
Añadidos a `.env.example` (backend y frontend) como documentación — evita que una
máquina nueva o un futuro CI repita este mismo fantasma. **Pendiente**: verificar
que la otra máquina de desarrollo del equipo también los tiene configurados
correctamente (no solo esta).

**6. Seed de test no resetea `Setting` entre corridas locales — `freeActiveListingLimit` (y
cualquier otro setting) queda contaminado entre suites.** Mecanismo real (documentado aquí por
primera vez con detalle — antes solo había una alusión de pasada en «Lecciones de método» §2 y una
referencia rota que apuntaba al sitio equivocado): `seed-test.ts#seedSettings()` siembra los
`Setting` con `prisma.setting.createMany({ data: [...], skipDuplicates: true })` — `skipDuplicates`
hace que una fila cuya `key` ya existe se **salte silenciosamente**, sin tocar su valor. Si un
test de una suite (p. ej. `rf7-limits.e2e-spec.ts` o `rf7-expiration.e2e-spec.ts`) hace
`PATCH /admin/settings/freeActiveListingLimit` a un valor de prueba (p. ej. `100`) para ejercer un
caso límite, ese valor **sobrevive** en la BD `marketplace_test` local después de que el test
termina — el siguiente test, o la siguiente ejecución completa de la suite en la misma BD, arranca
con `freeActiveListingLimit = 100` en vez del default (`5`), y cualquier aserción que dependa del
límite real falla o pasa por razones equivocadas. Causó **6 fallos** en una ejecución local reciente
(specs de `rf7-limits`/`rf7-expiration`). **No afecta a CI**: cada job arranca con contenedores de
Postgres nuevos (BD limpia), así que nunca hereda un `Setting` mutado por una ejecución anterior —
por eso este problema es invisible en CI y solo aparece corriendo la suite repetidas veces en local
sobre la misma BD, el mismo patrón de "contaminación local" ya visto con Meilisearch (ver más
abajo). **Cura**: el seed de test debería **resetear** los `Setting` a sus defaults en cada corrida
(`upsert` con `update: { value: default }` explícito, no solo `create`), en vez de respetar
residuales de ejecuciones previas. Deuda para el Hito 9 (mismo saco que el resto de aislamiento
dev/test de esta lista).

**7. Duplicación del punto de concesión de destacados — CERRADA (H8 Bloque D fase 4,
2026-07-12).** Historial: anotada en H8.1/H8.5a, parcialmente saldada en H8 Bloque D fase 3a
(extracción de `grantFeaturedListingTx`, usada por Redsys y cupones) pero sin cubrir
`featuredByCredits`. La observación previa a este cierre encontró que no eran 3 caminos sino
**4**: además de `grantFeaturedListingTx` (Redsys/cupón) y las dos ramas inline de
`featuredByCredits` (cuota Pro, créditos), `BillingProcessor.handleOneTimePayment` creaba un
`Entitlement FEATURED_LISTING` para compras vía Stripe checkout (`POST /billing/checkout` con
`listingId`) — un camino no inventariado en la deuda original. Ese cuarto camino no revalidaba
ownership/ACTIVE/duplicado en el momento de conceder (solo al crear la sesión de Stripe, antes del
pago), no seteaba `origin`, no encolaba reindexado (el processor ni inyectaba la cola), y no estaba
en la misma `$transaction` que el `Transaction.upsert` — sin nada que impidiera una doble concesión
si el job se reprocesaba tras un commit exitoso con ack fallido (justo el escenario que abrió el
retry de `QUEUE_BILLING`). **Comprobación de datos antes de tocar nada** (BD local): 0 filas
`Entitlement` `FEATURED_LISTING` con `origin IS NULL` (el único origen que no seteaba `origin`) sobre
9 totales, y 0 listings con más de un `FEATURED_LISTING` activo simultáneo — el bug era teórico en
este entorno, nadie completó nunca esa compra por Stripe (el frontend actual solo llama a
`/billing/checkout/featured-pay`, Redsys, para destacar). No hizo falta reparación de datos.

**Decisiones tomadas y aplicadas:**
- **Stripe destacado, cerrado.** Redsys es el único canal de tarjeta para destacados.
  `BillingProcessor.handleOneTimePayment` eliminado; `handleCheckoutCompleted` ahora registra un
  `warn` y no hace nada si le llega un `session.mode === 'payment'` (solo podría pasar por una
  sesión creada antes de este cierre). `CheckoutDto` ya no tiene `listingId` — el `ValidationPipe`
  global (`forbidNonWhitelisted`) lo rechaza con 400 si algún cliente lo manda. Y
  `BillingService.createCheckoutSession` rechaza explícitamente cualquier `Price` de tipo
  `ONE_TIME` con un 400 con mensaje claro, antes de tocar Stripe — la puerta queda cerrada, no
  entornada. El checkout de Plan Pro (RECURRING) no se tocó.
- **`@@unique([transactionId, type])` en `Entitlement`** (migración
  `20260712193902_entitlement_transaction_type_unique`) — red de seguridad en BD contra el vector de
  retry: una misma `Transaction` no puede generar dos `Entitlement` del mismo tipo. Se evaluó
  `@@unique([listingId, type])` (descartado: bloquearía renovar un destacado tras expirar, caso
  legítimo) y un índice único parcial sobre "activos" (inviable: Postgres no permite `now()` en el
  predicado de un índice). `NULL` no colisiona consigo mismo (semántica estándar de `UNIQUE` en
  Postgres): esto protege el camino con retry automático de infraestructura (Redsys, vía BullMQ) pero
  **no** a cuota Pro/créditos/cupón, que no llevan `transactionId` — esos siguen dependiendo solo del
  check en aplicación (`assertFeaturable`/`grantFeaturedListingTx`, sin `SELECT ... FOR UPDATE` sobre
  el listing, a diferencia del lock que sí toma `hasAvailableFeaturedQuota` sobre la `Subscription`).
  Riesgo residual aceptado, no cerrado: una carrera concurrente genuina (dos requests simultáneas
  sobre el mismo listing por cuota/créditos/cupón) podría en teoría colar una doble concesión antes de
  que cualquiera de las dos commitee — igual que ya podía pasar antes de este cierre. Si se quiere
  cerrar del todo, el arreglo sería un `SELECT ... FOR UPDATE` sobre el `Listing` dentro de
  `grantFeaturedListingTx`, no implementado aquí.
- **`featuredByCredits` unificado sobre `grantFeaturedListingTx`.** Las dos ramas (cuota Pro,
  créditos) ya no hacen su propio `tx.entitlement.create` — llaman a `grantFeaturedListingTx` pasando
  su propia `durationDays` (Setting fijo para cuota, `Price.durationDays` para créditos — la duración
  sigue divergiendo por canal deliberadamente, es la parte legítima). Cada rama conserva su propio
  `assertFeaturable` como pre-check síncrono (mismo patrón que ya usaba `RedsysService` al crear el
  checkout): sirve para devolver el código estructural `{code: 'ALREADY_FEATURED'}` que el frontend
  (`apps/web/src/lib/api/client.ts`) usa para mostrar "Este anuncio ya está destacado" —
  `grantFeaturedListingTx` internamente solo lanza un `BadRequestException` de texto plano, así que
  quitar el pre-check habría roto ese mensaje. La revalidación duplicada dentro de la misma tx/snapshot
  es intencional (defensa en profundidad), no descuido.
- **Comentarios corregidos.** El de `grantFeaturedListingTx` ahora sí es cierto: es la única
  implementación que escribe un `Entitlement FEATURED_LISTING`, con la lista real de quién la llama
  (siempre dentro de una `$transaction`). El de `grantFeaturedListing` deja de reclamar ser el único
  sitio y pasa a describirse correctamente como wrapper standalone para callers sin tx propia
  (Redsys).

Ahora sí son **1** implementación de concesión (`grantFeaturedListingTx`) + 3 canales de cobro
(Redsys, créditos/cuota, cupón) que la llaman. Tests nuevos: unit (`billing.service.spec.ts`, Stripe
mockeado) para "ONE_TIME rechazado sin llamar a Stripe" / "RECURRING sigue llegando a Stripe"; e2e en
`billing-rf6.e2e-spec.ts` para el `@@unique` (P2002 en colisión, insert libre en renovación con
`transactionId` distinto) y el cierre de Stripe (400 con `listingId`, 400 explícito en `ONE_TIME` sin
`listingId`); e2e en `h8-featured-quota.e2e-spec.ts` con `jest.spyOn(billingService,
'grantFeaturedListingTx')` verificando que ambas ramas delegan de verdad (no solo que el resultado
final tiene la misma forma) y que ambas encolan reindexado.

**8. Solapamiento check-then-act en campañas — ACTIVA, riesgo aceptado.** (H8 Bloque D fase 1,
`CampaignsService.assertNoOverlap`.) La validación de solapamiento es check-then-act (lee, luego
escribe fuera de la misma sección crítica) — dos activaciones concurrentes de campañas `INACTIVE`
solapadas del mismo `type` podrían ambas superar la validación antes de que ninguna confirme su
escritura. Riesgo bajo (acción de admin, un único actor, clics deliberados). Cierre robusto si el
negocio lo exige: `EXCLUDE` constraint de Postgres (GiST sobre `type` + `tsrange(startsAt, endsAt)`);
no implementado.

**9. Caché de 5 min no se invalida al cambiar `trusted` del vendedor — ACTIVA.** (H8 Bloque E,
`ListingsService.LISTING_INCLUDE.seller`.) `findBySlug` de `ListingsService` cachea la ficha completa
del anuncio (incluido el sub-objeto `seller`) en Redis 5 minutos (`CACHE_TTL`); desmarcar a un
vendedor como "de confianza" no invalida esa caché, así que una ficha ya cacheada puede seguir
mostrando el badge hasta que expire. Mismo lag que ya tenían `avatarUrl`/`name` ahí — no es una
regresión del bloque de "Vendedor de confianza", es una característica preexistente que ahora es más
visible por tener un campo administrable con efecto inmediato esperado por el admin. Mejora futura:
invalidar la caché del listing al cambiar `trusted` del vendedor.

### Reintentos del job `geocode` (H6 → resuelto en Hito 9)

**Hallazgo real, distinto de lo asumido:** el job `geocode` comparte `QUEUE_INDEXING` con `index`/`remove`, que **ya tenía** `attempts: 3` + `backoff: { type: 'exponential', delay: 2_000 }` configurado a nivel de cola ([queue.module.ts](../apps/api/src/infra/queue/queue.module.ts)) — no faltaba config de reintento. El problema real: `GeocodingService.geocode()` estaba documentado como "*always resolves — returns null on any error, timeout, or empty result*", así que timeout/fallo de red/HTTP no-ok/sin-resultados colapsaban TODOS a `null` sin lanzar nunca — el job de BullMQ "tenía éxito" siempre, así que `attempts`/`backoff` no tenían nada que reintentar.

**Fix**: `geocode()` ahora distingue transitorio de permanente:
- **Transitorio → lanza `TransientGeocodingError`** (timeout/`AbortError`, fallo de red, HTTP 429, HTTP 5xx): timeout y fallo de red se detectan envolviendo el propio `fetch()` en try/catch; 429/5xx se detectan tras comprobar `res.ok`.
- **Permanente → sigue devolviendo `null`** (como antes): HTTP 4xx que no sea 429, o respuesta válida sin resultados.

**Nada más cambió en la maquinaria de reintento** — no hizo falta: `IndexingProcessor.process()` ya envolvía cada job en un `try/catch` que hace `Sentry.captureException(err); throw err;` para cualquier excepción de cualquier job. En cuanto `geocode()` empezó a lanzar en el caso transitorio, ese `throw` ya propaga tal cual hasta BullMQ (que aplica `attempts`/backoff, ya configurados) y hasta Sentry (visibilidad tras agotar los 3 intentos, sin código nuevo).

Ajustes acompañantes:
- `IndexingProcessor.handleGeocode()`: el log de "sin resultado" (caso permanente) subió de `debug` a `warn` — visible, no silencioso, coherente con la ráfaga de observabilidad de `callRevalidateEndpoint`.
- `geocode-backfill.ts`: como su loop asumía "`geocode()` nunca lanza", ahora envuelve la llamada en try/catch por listing — un `TransientGeocodingError` se loguea (`warn`) y se pasa al siguiente listing (queda con `latitude: null`, así que el `WHERE` del backfill lo recoge en la siguiente ejecución) en vez de abortar el backfill completo.
- Idempotencia confirmada: `handleGeocode` solo escribe `latitude`/`longitude`, sin efectos colaterales — reintentar (BullMQ o backfill) es seguro.
- Sin cola dedicada ni `attempts` distintos para `geocode` — sigue compartiendo `QUEUE_INDEXING` con `index`/`remove`, sin evidencia de necesitar valores propios.
- Tests unitarios en `geocoding.service.spec.ts` (13 casos: Nominatim + MapTiler, transitorio/permanente/reintento-sin-postalCode/idempotencia).

### Slug de anuncio sin reintento ante P2002 (Hito 9 — resuelto)

`ListingsService.buildSlug()` genera el slug con normalización del título + sufijo aleatorio de 3 bytes hex (`randomBytes(3).toString('hex')`, keyspace de 16,7M) — visible en la URL pública (`/anuncio/{slug}`, `Listing.slug @unique`), pero **no elegido por el usuario**. `create()` llamaba a `prisma.listing.create(...)` directamente, sin ningún manejo de P2002; sin filtro global de excepciones (`common/filters/index.ts` seguía siendo un `// TODO` vacío), una colisión real habría sido el 500 genérico por defecto de Nest.

**Fix**: `ListingsService.createWithUniqueSlug(title, data)` — loop con tope `MAX_SLUG_ATTEMPTS = 5`; cada vuelta genera un sufijo aleatorio NUEVO (no incremental — coherente con que ya era aleatorio, y evita la carrera de un esquema incremental); ante P2002 reintenta; si agota los 5 intentos, `logger.error` (visible) + `ConflictException({ code: 'SLUG_GENERATION_FAILED' })`; cualquier otro error de Prisma se relanza sin reintentar. `create()` usa este método. Regenerar-y-reintentar es **silencioso** para el usuario salvo agotar los intentos — el slug no es un valor que el usuario haya elegido, así que un P2002 no es un conflicto suyo que resolver (contraste con `Coupon.code`, elegido por un admin, donde `ConflictException` inmediato sí es la respuesta correcta).

**`isP2002` centralizado**: existían ya dos convenciones para detectar P2002 en el repo — un helper local duck-typed en `coupons.service.ts` y checks inline `instanceof Prisma.PrismaClientKnownRequestError && code === 'P2002'` en `admin.service.ts` (×2), `reviews.service.ts` y `favorites.service.ts`. Con esta pieza siendo la 5ª duplicación, se extrajo a `common/prisma/is-p2002.ts` (estilo type-safe, `instanceof Prisma.PrismaClientKnownRequestError`) y las cinco instancias se reemplazaron por el import compartido — comportamiento idéntico, verificado con la suite e2e existente de esos módulos.

Tests unitarios en `listings.service.spec.ts`: reintento exitoso al 2º intento, agotar los 5 intentos → `ConflictException` + `logger.error` (una vez), y un error de Prisma distinto de P2002 se relanza sin reintentar.

**Deuda inventariada, NO tocada**: `BlogService.buildSlug()` (para `Post.slug`, también `@unique`, también visible en `/blog/{slug}` y `/paginas/{slug}`) usa el **algoritmo idéntico** (mismo `buildSlug`, mismo riesgo) y **tampoco reintenta en P2002** — misma vulnerabilidad, contexto distinto (slug editable por rol EDITOR, inmutable tras publicar — ver rol EDITOR / BLOG-PAGINAS más arriba). Cuando se aborde, puede reutilizar `createWithUniqueSlug`/`isP2002` ya extraídos aquí.

### MapTiler: claves frontend y backend separadas; restringir por dominio en producción

`NEXT_PUBLIC_MAPTILER_KEY` (frontend, tiles vectoriales del mapa) y `MAPTILER_API_KEY` (backend, geocoding cuando `GEOCODING_PROVIDER=maptiler`) son claves distintas. En producción, la clave de frontend debe restringirse por dominio en el panel de MapTiler (evitar uso fraudulento del bundle público). La clave de backend no necesita restricción de dominio pero sí de IP si el proveedor lo soporta.

### H6.6 — Anuncios patrocinados (hecho. Cierra el Hito 6 y el plan de descubrimiento A+B+C)

El diseño H6.1 (categorySlugs[], posiciones 3/7, cobro por impresión/clic) quedó **descartado tras observar el terreno real**: no hay precedente de "categoría o hijas" más allá de 2 niveles (mismo límite que `categoryPath`), no existe upload de imagen reutilizable en `Banner` (es texto puro), y el ensamblado de búsqueda no toca Postgres — el diseño final se ajustó a esas realidades en vez de forzarlas.

- **Es un banner PUBLICITARIO EXTERNO gestionado por admin, NO un `Listing` promocionado.** Sin billing: gestión 100 % manual (decisión de negocio tomada, cierra la pregunta abierta del diseño original).
- **Schema — `SponsoredAd`:** `imageUrl`, `title`, `description`, `targetUrl` (enlace externo), `categoryId` (FK singular a `Category`, **no** `categorySlugs[]` — la propagación a hijas se resuelve en query, no en el dato), `order` (desempate, no posición en la parrilla), `active`+`startsAt`/`endsAt` **opcionales** (a diferencia de `Banner`, puede no tener ventana y permanecer activo indefinidamente). `onDelete` de la FK a `Category` es el default (RESTRICT) — igual que `Listing.categoryId` — con el mismo patrón de chequeo explícito en `AdminService.deleteCategory` (conteo + 400 legible) en vez de dejar que el DELETE físico falle en crudo.
- **Subida de imagen:** `POST /admin/sponsored-ads/upload-image` (admin-only) llama a `R2Service` **directamente**, molde `uploadAvatar()` — key `sponsored/${randomBytes}${ext}`, devuelve `{url}`, no toca `ListingImage`. `MIME_TO_EXT` se exportó de `media.service.ts` para reutilizarlo sin duplicar la tabla mime→ext.
- **Inyección en búsqueda:** en `search.controller.ts`, tras normalizar `hits` y antes del `return`, si `page===1` y hay `category`, se resuelve `[categoría, su padre]` (mismo límite de 2 niveles que `categoryPath`) y se busca 1 `SponsoredAd` activo y vigente por fechas, ordenado por `order` asc → más reciente. Se splicea en `hits` en la posición fija 3 con un discriminador `{ __sponsored: true, ... }`. **Esto rompe conscientemente el invariante documentado "la búsqueda no toca Postgres"** — mitigado con caché Redis por categoría (`sponsored-ad:search:{slug}`, TTL 5 min, cachea también el resultado negativo) e **invalidación inmediata** en create/update/desactivar (propia + de los hijos si la categoría tiene). Solo página 1; páginas siguientes nunca inyectan.
- **CRUD admin:** calco exacto de `Banner` (`AdminSponsoredAdsController`, ADMIN-only, sin `DELETE` — solo desactivar, status derivado `upcoming/live/ended` tolerante a fechas nulas, `AuditLog` `SPONSORED_AD_CREATE/EDIT/ACTIVATE/DEACTIVATE`).
- **Frontend:** `/admin/sponsored-ads` + `SponsoredAdFormDialog` (selector de categoría con `SelectGroup` por raíz + hijas, upload de imagen antes de enviar la URL). `SponsoredCard` (esqueleto de `ListingCard` pero `<a target="_blank" rel="noopener noreferrer">` en vez de `Link` interno, badge "Publicidad" gris — deliberadamente distinto del ámbar "Destacado" — sin precio/atributos/favoritos). Integrado en `/busqueda`, `/[categoria]` (H6.2 ya usa el mismo endpoint) y defensivamente filtrado fuera de la home (`recent`, que nunca pasa `category`) y del modo mapa (`MapView` solo recibe `ListingSummary[]`, nunca el hit patrocinado).
- **Tests:** `h6-6-sponsored-ads.e2e-spec.ts` (23 casos: CRUD, auth, upload, inyección por categoría/hijas, página 2 sin inyección, inactivo/fuera-de-ventana, invalidación de caché, posición fija) + `h6-6-sponsored-ads.spec.ts` (Playwright: admin crea con imagen real → aparece en `/coches` como "Publicidad" → atributos `href`/`target`/`rel` correctos y el click abre pestaña nueva → propagación padre→hija → desactivar lo quita de inmediato). Batería completa del backend (45 suites/698 tests) verde en dos pasadas.
- **Nota de proceso:** `SponsoredAd` no cuelga de `User` (a diferencia de `Listing`/`AuditLog`), así que `cleanDb()` (`TRUNCATE "User" CASCADE`) no lo alcanza — el spec e2e limpia explícitamente en `afterAll` los patrocinados que crea, para no dejar filas con `imageUrl` de prueba (dominio no configurado en `next.config.js`) que rompan `next/image` en cualquier sesión que abra `/admin/sponsored-ads` contra la misma BD compartida (así se detectó, rompiendo la suite Playwright).

### H7 — La reseña sobrevive al borrado del anuncio (resuelto; cierra deuda de Fase 5.2)

Decisión de producto: la reputación **no** debe ser borrable por el vendedor borrando
el anuncio. Hasta H7, `Review.listing` tenía `onDelete: Cascade`, así que borrar un
anuncio borraba también las valoraciones ligadas a él (ver «Mapa de integridad ante
borrados/ediciones», Fase 5.2) — un vendedor podía borrar un anuncio para eliminar
reseñas negativas asociadas.

**Fix:** `Review.listingId` pasa a `onDelete: SetNull` (nullable), el mismo patrón que
ya usan `Entitlement`/`Transaction` — el registro sobrevive con `listingId → NULL` en
vez de desaparecer. Se añade `Review.listingTitle` (snapshot del título del anuncio en
el momento de crear la reseña, en `ReviewsService.create`) para que el listado público
siga dando contexto aunque el anuncio desaparezca después. Migración
`20260702201453_review_survives_listing_delete` incluye un backfill que rellena
`listingTitle` para reseñas existentes cuyo anuncio todavía vive; las reseñas cuyo
anuncio ya se había borrado en cascada antes de este fix no se pueden recuperar (no
hay forma) y quedan con `listingTitle` `NULL`.

- **Unicidad**: la constraint `@@unique([authorId, targetId, listingId])` sigue
  intacta para anuncios vivos — Postgres no compara `NULL` como igual a `NULL`, así
  que varias reseñas huérfanas (`listingId` `NULL`) nunca chocan entre sí ni bloquean
  nada. En la práctica tampoco se pueden crear reseñas nuevas sobre un anuncio ya
  borrado: `Conversation.listing` sigue en `onDelete: Cascade`, así que la
  conversación (requisito de elegibilidad) desaparece junto con el anuncio.
- **Listado público** (`GET /users/:slug/reviews`): el `aggregate` (media, count,
  distribución) sigue contando las reseñas huérfanas sin cambios — la reputación se
  conserva íntegra. El frontend (`ReviewCard` en `ReviewsSection.tsx`) muestra
  "Sobre: {listingTitle} (anuncio ya no disponible)" cuando `listingId` es `NULL`, o
  "Anuncio ya no disponible" si tampoco hay `listingTitle`; nunca intenta enlazar a
  `/anuncio/[slug]` de un anuncio borrado.
- **Moderación**: `Report.reviewId` sigue en `onDelete: Cascade` sin cambios — borrar
  una reseña (vía moderación) sigue borrando sus denuncias asociadas.

Tests: `reviews.e2e-spec.ts`, bloque «borrado de anuncio: la reseña sobrevive (H7)» —
crear reseña copia `listingTitle`; borrar el anuncio deja `listingId` `NULL` y
conserva `listingTitle` sin borrar la fila; el aggregate del vendedor no cambia;
el listado público expone la reseña huérfana con su snapshot; la unicidad sigue
bloqueando duplicados sobre anuncios vivos.

### ✅ Hito 7 enfocado — CERRADO

Con el fix de reseñas de arriba y el login social con Google (backend §2 «Login social con Google
— backend», frontend §2 «Login social con Google — frontend»), el Hito 7 enfocado queda **cerrado**.

**Diferido conscientemente del Hito 7 original** (`Hoja_de_ruta_rafagas_Hito5-9.docx` preveía
mensajería enriquecida + blog enriquecido + registro social para este hito): al llegar, se evaluó
el estado real de mensajería (bandeja unificada + chat WebSocket ya completos desde Fase 5) y blog
(público + admin ya completos desde Fase B) — ambas bases ya cubren el caso de uso completo;
"enriquecerlas" (indicadores de escritura, reacciones, categorías/relacionados del blog…) es
backlog de pulido de UI, no una brecha funcional. Se difiere a **Hito 9** o backlog general — medir
antes de asumir: el roadmap sobreestimaba el alcance real de Hito 7.

**Deuda nueva abierta por este hito:**

- **✅ RESUELTO (RÁFAGA 3) — Usuarios solo-Google no pueden fijar una contraseña.** Cerrado con
  `POST /auth/set-password` (autenticado, sin exigir contraseña actual) — ver «Paquete de
  seguridad de auth» más abajo. `forgotPassword()` sigue siendo un no-op silencioso para cuentas
  solo-Google (sigue sin poder recuperar lo que nunca tuvieron), pero ahora tienen un camino
  explícito para fijar una por primera vez.
- **✅ RESUELTO (2026-07-12) — Colisión Redis dev/test en local.** `REDIS_URL` no llevaba
  namespace/prefijo por entorno; si un proceso `pnpm dev` (BullMQ apuntando al Redis local) quedaba
  corriendo mientras se ejecutaba la suite de test (mismo Redis, sin DB ni prefijo distintos para
  las colas), los workers de dev podían robar jobs encolados por los tests. Solo afectaba a
  desarrollo local con ambos procesos vivos a la vez; CI ya usaba `REDIS_URL: redis://localhost:6379/1`
  en su Redis de servicio, pero **ese `/1` era decorativo**: `QueueModule` reconstruía la conexión de
  BullMQ manualmente a partir de `host`/`port`/`password` y descartaba el `pathname` de la URL, así
  que las colas siempre se conectaban a la db 0 sin importar lo que dijera `REDIS_URL` — el propio CI
  nunca estuvo realmente aislado en BullMQ, solo en `RedisService` (que sí usa `new Redis(url)` y por
  tanto sí respetaba el path).

  **Manifestación concreta (refuerzo de validación de atributos, 2026-07-08):** con un backend de
  dev vivo en el puerto 3001 (`node dist/src/main`) durante la verificación de la batería completa,
  varios suites no relacionados (`search`, `rc5-attributes`, `rc5b-vehiculos`,
  `search-facets-by-type`, `listings`, `admin`, `moderation`) fallaron con "not indexed in
  Meilisearch within 15000ms" — el worker de dev competía por `bull:indexing` y se quedaba los jobs
  de los tests. Confirma el riesgo ya inventariado, no es un bug del código bajo prueba; se resolvió
  deteniendo el proceso de dev antes de la corrida final.

  **Arreglo de raíz:** separación por db lógica de Redis (dev = db 0, test = db 1), no por
  prefijo de claves — se descartó prefijar cada consumidor (`contact:rate:*`, `auth:*`,
  `listing:*`, `sponsored-ad:*`, `view:dedup:*`, colas BullMQ…) por el riesgo real de olvidar uno
  (había 6 definiciones duplicadas de la clave de caché `listing:{slug}` en otros tantos archivos).
  En su lugar, `apps/api/src/infra/redis/redis-connection.ts` (`parseRedisConnection`) resuelve
  host/puerto/password/db a partir de `REDIS_URL` una sola vez, y es el ÚNICO punto por el que pasan
  las dos conexiones reales del proceso (`RedisService` y `QueueModule`/BullMQ) — un futuro
  consumidor no puede "olvidar" el namespace porque no construye su propia conexión, inyecta
  `RedisService` (ya `@Global()`) como todos los demás. `.env.test` pasa a `REDIS_URL="redis://localhost:6379/1"`;
  `env.validation.ts` exige (Joi, mismo patrón que `DATABASE_URL`/`_test`) que en `NODE_ENV=test`
  `REDIS_URL` termine en una db no-cero, o el backend no arranca. El flush de Jest/Playwright
  (`apps/api/test/flush-redis-test-db.js`, antes `flush-auth-rate-limits.js`) pasó de borrar solo
  `auth:*` a un `FLUSHDB` completo — seguro porque la db de test ya está aislada — con un guard que
  lanza si `REDIS_URL` resolviera a db 0, para que una `.env.test` mal configurada nunca pueda
  vaciar el Redis de un desarrollador. Verificado ejerciendo la colisión: servidor dev corriendo +
  batería e2e completa en paralelo sin afectar sus colas/rate limits, y dos corridas seguidas de la
  suite sin heredar contadores entre sí.

- **✅ RESUELTO — "Teardown de tests e2e deja handles asíncronos abiertos" era un falso positivo.**
  El aviso "Force exiting Jest: Have you considered using `--detectOpenHandles`" que aparecía en cada
  corrida de la suite e2e nunca fue evidencia de una conexión sin cerrar — era el mensaje boilerplate
  que Jest imprime SIEMPRE que `forceExit: true` está en la config, incluso cuando no hace falta.
  Confirmado diagnosticando en vez de asumir: corriendo la suite con `--detectOpenHandles` y
  `--no-forceExit` (override de CLI), tanto un único spec trivial (`smoke.e2e-spec.ts`, exit limpio en
  2.5s) como la batería completa (41 suites/630 tests, exit limpio en ~76s) terminan **solos**, sin
  handles reportados. `git log --follow` sobre `jest-e2e.json` confirma que `forceExit: true` estaba
  desde el commit de scaffolding inicial (`R0.2`) — nunca añadido en respuesta a un colgado real
  observado, boilerplate heredado. **Arreglo:** `forceExit` eliminado de `apps/api/test/jest-e2e.json`.
  Como red de seguridad — el job `e2e` de CI no tenía `timeout-minutes` (default de GitHub Actions:
  360 min) — se añadió `timeout-minutes: 30` al job en `ci.yml`: si alguna vez se introduce un colgado
  real, falla en 30 min en vez de colgar horas.

  **Hallazgo colateral durante la verificación, más relevante que la propia deuda:** al re-correr la
  batería completa para confirmar el arreglo, aparecieron 7 suites fallando de forma consistente y
  reproducible (`admin`, `moderation`, `listings`, `search`, `rc5-attributes`, `rc5b-vehiculos`,
  `search-facets-by-type`) con "not indexed in Meilisearch within 15000ms" — en 3 corridas seguidas,
  contenedores fríos y calientes por igual, y también reproducido a `concurrency=1` (descartando que
  fuera el arreglo de concurrency de la deuda anterior). Causa real: un proceso `nest start --watch`
  huérfano (arrancado como `webServer` de Playwright en una sesión de trabajo anterior sobre este mismo
  repo, y que sobrevivió — junto con un hijo `node dist/src/main` — pese a que un chequeo de puerto
  después de esa sesión no mostraba nada escuchando) seguía compitiendo por `bull:indexing` contra los
  tests, con el mismo síntoma que "Colisión Redis dev/test en local" arriba, pero en su variante más
  insidiosa: el proceso zombi no aparece con un simple check de puerto si no está activamente
  escuchando en ese instante — hace falta `tasklist`/`Get-CimInstance Win32_Process` para encontrarlo
  por línea de comandos. Confirmado con la tabla de tareas de Meilisearch (`GET /tasks`): sin el
  zombi, la batería completa vuelve a pasar limpia (41/41, 630/630, 60.7s, sin `Force exiting`).
  **Lección de método:** un checkeo de puerto (`netstat`/`lsof`) no es suficiente para descartar un
  backend fantasma local — el proceso watcher puede seguir vivo sin tener nada bindeado en el momento
  exacto del check. Verificar por proceso (`nest start`, `dist/src/main`), no solo por puerto.
- **Patrón `waitForCard` pendiente de aplicar a specs anteriores a su introducción.** La regla
  vigente («cualquier test futuro que espere indexación Meili debe usar `waitForCard`», ver
  §Lecciones de método del CI) no se ha auditado retroactivamente contra todos los specs previos a
  H6 — puede quedar algún `toBeVisible(Ns)` pasivo sin migrar. Revisar en Hito 9.
- **Job `geocode` sin reintentos**: resuelto en Hito 9 — ver «Reintentos del job `geocode`» más arriba.

### Deuda nueva abierta por RÁFAGA 0 (producto/servicio — dinamización de búsqueda)

- **✅ RESUELTO EN RÁFAGA 2.** Refresco en caliente de `filterableAttributes` implementado
  (`FilterableAttributesResolver.invalidate()` + `SearchService.refreshFilterableAttributes()`
  + job `refresh-filterable-attributes` en `QUEUE_INDEXING`). Ver «Admin de categorías
  producto/servicio — RÁFAGA 2» en §2. Texto original conservado por contexto histórico:
  `FilterableAttributesResolver` memoizaba el mapa de atributos filtrables una vez por
  arranque del proceso; cambiar `filterable` en el editor de categorías del admin no se
  propagaba a Meilisearch ni a la validación del query string hasta reiniciar —
  comportamiento preservado de la lista hardcodeada anterior, no una regresión. Mejora
  diferida a la ráfaga del admin de categorías de producto/servicio (R2 del plan), donde
  ese admin se iba a tocar de todas formas para añadir la política de tipo por categoría.

  **Limitante nuevo, inventariado (no resuelto en R2):** la caché es en memoria por
  proceso — el job de refresco solo invalida el proceso que lo ejecuta. Con una sola
  instancia de API (el caso actual) esto refresca todo; si el proyecto escala a varias
  instancias, cada una necesitaría su propio refresco (pub/sub sobre Redis) para que
  todas queden al día. Fuera de alcance hasta que la infraestructura lo requiera.
- **✅ CERRADA — Validación débil de atributos.** Ver «Refuerzo de validación de
  atributos — cierra la deuda de "validación débil"» en §2. Texto original conservado
  por contexto histórico: `ListingsService.validateAttributes()` solo comprobaba que las
  keys marcadas `required: true` estuvieran presentes (`hasOwnProperty`); no validaba que
  el tipo del valor coincidiera con el `type` del schema (`number`/`boolean`/`select`), no
  validaba que un valor `select` estuviera entre las `options` declaradas, y no rechazaba
  claves desconocidas no declaradas en el schema efectivo de la categoría.

  La asimetría con `validateLinkedSelects()` (que sí validaba en profundidad, solo para
  campos `dependsOn`) queda cerrada: `validateAttributeValues` (nueva) da a los selects
  planos el mismo rigor. `update()` valida solo el delta (grandfathering por
  construcción, sin migrar los 8 anuncios sucios medidos); `create()` sigue exigiendo el
  bag completo. De paso, se arregló un bug presente en `validateLinkedSelects` (no era
  delta-aware — rompía la edición de cualquier anuncio con un par vinculado ya
  inconsistente, como "Cotce" tras poblar el catálogo real).

## Historial de ráfagas — Hito 8 (cerrado)

Registro cronológico de las ráfagas que implementaron el Hito 8 (Pro/facturación ampliado: cuota
mensual de destacados, badge Pro, Vendedor de confianza, estadísticas de anuncio, campañas,
descuentos, cupones y banners). Movido aquí desde §3 en la reorganización de 2026-07-08 — no es
deuda técnica, es el changelog de features ya cerradas. Los ítems de deuda real que estaban
intercalados en este historial se extrajeron a §3 antes del movimiento (ver ítems 7, 8 y 9 de la
lista «Deuda de test/CI consolidada», y las notas «(Ocurrencia consolidada en §3...)» dentro de
este historial para la carrera de navegación del App Router).

### Hito 8 — en curso: cuota mensual de destacados Pro

Mini-diseño aprobado: consolidar las ventajas de Pro y añadir "N destacados gratis/mes" como
beneficio nuevo, distinguiendo dos bolsas (cuota Pro, caduca por periodo de facturación; adquiridos
por créditos/Redsys, no caducan). Documentación completa en `diseno-facturacion.md` al cerrar el
hito (H8.6); mientras tanto, el detalle de las decisiones vive en el hilo de diseño.

**H8.1 (cimiento, sin lógica de negocio todavía) — hecho:**

- Migración `add_featured_origin`: enum `FeaturedOrigin { CREDITS, REDSYS, PRO_QUOTA }` +
  `Entitlement.origin` (nullable, solo relevante para `FEATURED_LISTING`) + backfill de filas
  existentes (`transactionId` presente → `REDSYS`, ausente → `CREDITS`) + índice
  `[userId, type, origin, createdAt]` (soporta la query derivada de cuota que llegará en H8.2).
  Verificada sobre BD fresca (`migrate deploy`, 16 migraciones) y sobre BD con datos.
- Setting `proMonthlyFeaturedQuota` (por defecto 4), sembrado en `seed.ts` y `seed-test.ts`,
  añadido a la whitelist de `SETTING_KEYS` (`admin.service.ts`).
- Fix de deuda hallado al diseñar H8: `freeActiveListingLimit` y `proActiveListingLimit` estaban
  en la whitelist del backend desde RF.7 pero no se exponían en `/admin/ajustes` (faltaban en
  `ORDER`/`SETTING_TITLES`/`SETTING_DESCRIPTIONS`, y en el seed de test). Corregido junto con
  `proMonthlyFeaturedQuota`: los tres son ahora editables desde el backoffice. El editor numérico
  de la página se generalizó (`ExpiryDaysEditor` → `NumberSettingEditor` parametrizable) en vez de
  triplicar el componente.
**H8.2 (query derivada de cuota + `origin` propagado) — hecho:**

- `EntitlementService.getFeaturedQuotaStatus(userId)`: para no-Pro devuelve
  `{ isPro: false, limit: 0, used: 0, remaining: 0 }`. Para Pro, obtiene el periodo desde la
  `Subscription` **vinculada al `Entitlement PRO_SUBSCRIPTION` vigente** (`subscriptionId`, no un
  `findFirst` genérico sobre `Subscription` — evita ambigüedad con suscripciones canceladas
  residuales), y cuenta (`COUNT`, sin cron) los `Entitlement FEATURED_LISTING` con
  `origin=PRO_QUOTA` y `createdAt >= currentPeriodStart`. El reseteo es puramente derivado: en
  cuanto Stripe avanza `currentPeriodStart` en una renovación, los `PRO_QUOTA` del periodo anterior
  dejan automáticamente de contar, sin tocar ningún estado.
- `GET /billing/pro-status` (JWT): punto único donde el frontend consultará la cuota (lo usará
  H8.5). Un no-Pro recibe `isPro:false`.
- `origin` propagado en **todos** los `entitlement.create` de `FEATURED_LISTING` — ninguno queda
  `null` desde esta ráfaga: `grantFeaturedListing` (ahora recibe `origin` obligatorio; el caller de
  Redsys pasa `REDSYS`) y la copia inline de `featuredByCredits` (pasa `CREDITS` — sigue sin llamar
  a `grantFeaturedListing`, ver deuda de diseño en H8.1/H8 mini-diseño; la bifurcación cuota-primero
  que unificará esto parcialmente es H8.3).
- Tests nuevos: `h8-featured-quota.e2e-spec.ts` (no-Pro, Pro sin uso, Pro con uso parcial, y el caso
  clave — `PRO_QUOTA` de un periodo anterior al `currentPeriodStart` no cuenta, probando el reseteo
  derivado sin cron) + assertions de `origin` añadidas a `billing-rf6.e2e-spec.ts`
  (`grantFeaturedListing unified`).
**H8.3 (bifurcación cuota-primero — consume la cuota) — SUPERADO por H8.5a, ver más abajo.**

- `featuredByCredits` probaba la cuota Pro ANTES que los créditos, automáticamente (el usuario
  no elegía): si había cuota disponible, concedía `Entitlement { origin: PRO_QUOTA }` sin tocar el
  wallet ni crear `CreditLedger`; si no (no-Pro, o cuota agotada), caía al flujo de créditos de
  siempre, sin cambios. La respuesta incluye `viaQuota: boolean` (lo consume la UI en H8.5b).
  **Cambio de producto en H8.5a: ya no es automático — el usuario elige la vía explícitamente.**
  Se deja constancia de la decisión y el mecanismo de concurrencia (sigue vigente, solo cambia
  quién decide entrar por cuota) porque el lock y el test que lo prueba no cambiaron de fondo.
- **Concurrencia (el punto crítico de esta ráfaga):** la cuota es derivada (un `COUNT`, no un saldo
  decrementable como el `Wallet`), así que dos peticiones simultáneas del mismo usuario podrían leer
  "remaining=1" antes de que ninguna cree su `Entitlement`, y ambas pasarían por cuota. Se resuelve
  con `EntitlementService.hasAvailableFeaturedQuota(tx, userId)`: bloquea la fila de la `Subscription`
  vinculada (`SELECT ... FOR UPDATE`) dentro de la misma transacción que luego crea el
  `Entitlement PRO_QUOTA` — la segunda petición concurrente se queda esperando ese lock hasta que la
  primera confirma, y al reanudar su propio `COUNT` ya ve el grant recién creado. Mismo lock protege
  también contra una renovación de Stripe concurrente que intentara avanzar `currentPeriodStart` a
  mitad de la operación.
- **Verificación deliberada de que el test de concurrencia no es un falso positivo:** al escribir el
  test se comprobó a mano que un test "ingenuo" (disparar dos `POST` con `Promise.all` y comprobar el
  resultado) pasaba igual de bien **con el lock quitado** — en Postgres local, ambas transacciones son
  tan rápidas que rara vez llegan a solaparse de verdad, así que ese test no demostraba nada. El test
  que sí cierra la ráfaga con confianza (`h8-featured-quota.e2e-spec.ts`, caso "determinista") envuelve
  el método real con `jest.spyOn` para insertar una espera DESPUÉS de adquirir el lock y ANTES de que
  la transacción confirme, forzando un solapamiento real y verificable (se mide que el `Promise.all`
  tarda al menos lo que dura esa espera, prueba de que el segundo bloqueó de verdad). Con el lock
  quitado, este test falla de forma reproducible con `[true, true]` — el bug exacto que preocupaba
  (dos destacados gratis con cupo para uno). Con el lock puesto, pasa siempre. Se mantiene además el
  test "best-effort" con timing real como red adicional, pero el determinista es el que prueba la
  ausencia de la condición de carrera.
**H8.5a (vía elegida por el usuario + duración fija de cuota) — hecho:**

- **Cambio de producto:** ya no hay "cuota-primero automático". `featuredByCredits` recibe un nuevo
  campo `useQuota?: boolean` en el DTO (`FeaturedByCreditsDto`) y el usuario elige explícitamente:
  - `useQuota: true` → gratis, duración FIJA (`Setting proQuotaFeaturedDurationDays`, default 7),
    ignora cualquier `priceId` recibido (no hay variante que elegir). Si no hay cuota disponible,
    **error explícito** (`400 { code: 'QUOTA_UNAVAILABLE' }`) — nunca cae a créditos en silencio,
    porque el usuario pidió cuota a propósito. `priceId` queda `null` en el `Entitlement` (no hubo
    variante elegida).
  - `useQuota: false` / omitido (default) → flujo de créditos de siempre, duración elegida vía
    `priceId` (7/14/30d). **La cuota queda intacta aunque el usuario la tuviera disponible** — puede
    reservarla deliberadamente para otro anuncio. `priceId` es obligatorio en este camino
    (`ValidateIf` en el DTO).
- Nuevo `Setting proQuotaFeaturedDurationDays` (default 7): sembrado en `seed.ts`/`seed-test.ts`,
  en la whitelist de `admin.service.ts`, y editable en `/admin/ajustes` (mismo patrón
  `NumberSettingEditor` de H8.1).
- La concurrencia de H8.3 (`EntitlementService.hasAvailableFeaturedQuota` + `SELECT ... FOR UPDATE`
  sobre la `Subscription`) sigue exactamente igual — solo cambia que ahora se invoca cuando el
  usuario pide `useQuota: true`, no automáticamente. El test determinista (fuerza solapamiento real
  vía `jest.spyOn` + delay tras adquirir el lock) se reejecutó quitando el `FOR UPDATE` a mano:
  sin lock, las dos peticiones concurrentes de cuota devuelven `[201, 201]` (dos destacados gratis
  para una cuota de uno); con lock, siempre `[201, 400]`. Confirma que el cambio de firma no rompió
  la protección atómica.
- Refactor pequeño: la validación común (ownership + `ACTIVE` + sin destacado activo) se extrajo a
  `assertFeaturable(tx, userId, listingId, now)`, reutilizada por ambos caminos (antes solo existía
  dentro del bloque único de créditos).
- Tests reescritos en `h8-featured-quota.e2e-spec.ts` (describe `H8.5a`): cuota disponible (gratis,
  duración fija, `priceId` ignorado incluso si se envía uno de 30d), cuota agotada (error explícito,
  sin efectos secundarios), créditos con cuota disponible (cuota intacta), créditos sin cuota (igual
  que siempre), el Setting de duración cambia el resultado, y los dos tests de concurrencia
  (best-effort + determinista) adaptados a la elección explícita.
- **Deuda de diseño (heredada, anotada, no se tocó en su momento):** `featuredByCredits` seguía sin
  llamar a `grantFeaturedListing`. **Cerrada en H8 Bloque D fase 4** — ver «Duplicación del punto de
  concesión de destacados» en §3 (ahora marcada CERRADA).

**H8.5b (UX: selector de vía al destacar + visibilidad de cuota Pro) — hecho:**

- **Pequeño añadido de backend** (contradice ligeramente "frontend puro" del encargo, pero es
  imprescindible): `GET /billing/pro-status` ahora incluye `quotaDurationDays` (leído del mismo
  `Setting proQuotaFeaturedDurationDays` que ya usaba `featuredByCredits`). Sin esto, el frontend no
  tenía forma de saber qué número mostrar en "Destacar gratis — N días" sin duplicar el valor por
  defecto (7) y arriesgarse a que quedara desincronizado si un admin cambia el ajuste. Campo
  opcional, no rompe la forma de la respuesta para no-Pro (queda `undefined`, `toEqual` en los tests
  existentes lo ignora).
- **`DestacadoDialog`** (usado tanto desde `/mis-anuncios` como desde `/anuncio/[slug]` vía
  `ListingOwnerActions`): añade una tercera dimensión de elección, "Cómo destacar", SOLO visible
  cuando `isPro && remaining > 0` (fetch propio de `getProStatus`, igual patrón que `getCatalog`/
  `getWallet` ya existente — `.catch(() => null)` si falla):
  - "Destacar gratis — N días" (cuota Pro, muestra `remaining`) — preseleccionada por defecto para
    quien es elegible. Al enviar: `useQuota: true`, sin `priceId`.
  - "Destacar con créditos o tarjeta" — revela el flujo de Duración + Método de pago **sin ningún
    cambio** respecto al existente (Redsys incluido, intacto).
  - `remaining === 1` → aviso ámbar "Este es tu último destacado gratis de este mes" antes de
    confirmar.
  - Error `QUOTA_UNAVAILABLE` (nueva `isQuotaUnavailableError` en `client.ts`, mismo patrón que
    `isCreditError`/`isCooldownError`): no es un error genérico — cambia automáticamente el selector
    a "paid" (revela duración/pago in-place, sin cerrar el diálogo) y muestra "Ya no tienes cuota
    disponible este mes. Puedes destacar con créditos o tarjeta:". Cubre el caso raro de carrera o
    estado stale sin dejar al usuario atascado.
  - No-Pro: cero cambios visuales — nunca se muestra el selector "Cómo destacar" (verificado con
    Playwright, ver abajo).
- **Recordatorio en `/mis-anuncios`**: banner ámbar (mismo patrón visual ya usado en
  `ContactButton`/`MapView`/páginas de categoría) "Te quedan N destacados gratis este mes", visible
  sin abrir el diálogo. Dato inicial vía SSR (`getProStatus` en `page.tsx`, en paralelo con
  `getMyListings`); `MisAnunciosClient` lo guarda en estado y lo **refresca tras cualquier acción**
  (`handleAction` ahora también llama `getProStatus`) para que el contador baje sin recargar la
  página tras destacar por cuota.
- **`/perfil/suscripcion`**: nueva sección dentro de la card de Plan Pro — "Destacados gratis: N de
  LIMIT restantes este mes" + "Se renueva: fecha" (de `periodEnd`), gated en `proStatus.isPro`
  (fetch propio, en paralelo con `getMySubscriptions`/`getMyEntitlements` que ya estaban).
- **Fixture E2E nuevo**: `seed-playwright.ts` gana un listing ACTIVE para `pro-e2e@example.com`
  (`listing-pro-e2e`) — no existía ningún anuncio de ese usuario, así que no había forma de abrir
  `DestacadoDialog` como Pro en un test real sin él.
- **Tests nuevos** (`destacado-cuota-pro.spec.ts`, 11 casos, `proContext`/`sellerContext`): Pro ve
  las dos opciones y sus textos exactos; elegir la vía de pago revela duración/método sin romper
  nada; el POST real lleva `useQuota:true` sin `priceId`; aviso de "último gratis"; manejo de
  `QUOTA_UNAVAILABLE` con fallback in-place; cuota agotada oculta la opción gratis; no-Pro no ve el
  selector; `/perfil/suscripcion` muestra/oculta la sección según `isPro`; el banner de
  `/mis-anuncios` aparece/no aparece según corresponda. Todos los tests que abren/envían el diálogo
  mockean `pro-status`/`featured-by-credits` — nunca consumen la cuota real de `pro-e2e` (los tests
  de `/perfil/suscripcion` y el banner, que son Server Components no interceptables, leen el estado
  real pero solo lo verifican con regex, sin consumirlo). `destacado.spec.ts` (RF.11, no-Pro)
  verificado sin cambios: 13/13 siguen en verde.
- Verificación manual real (capturas de pantalla en un navegador contra los servidores dev):
  confirmado visualmente el selector con las dos opciones, el cambio a la vía de pago, el banner en
  `/mis-anuncios` y la sección de cuota en `/perfil/suscripcion`.

**H8.4 (badge "Pro" en el perfil público del vendedor) — hecho. Con esto quedan implementadas las
cuatro ventajas Pro consolidadas en el mini-diseño de H8 (límite de anuncios, bonus de créditos,
cuota de destacados, badge).**

- Backend: `UsersService.findBySlug` (sirve `GET /users/:slug`, el endpoint de `/vendedor/[slug]`)
  ahora calcula `isPro` con `EntitlementService.isProActive(seller.id)` — una sola llamada por
  perfil, sin N+1 (es un vendedor, no un listado). `UsersModule` importa `BillingModule` para poder
  inyectar `EntitlementService` (mismo patrón que `ListingsModule`, que ya lo hacía para los límites
  de anuncios; sin dependencia circular). El `id` interno se usa para el cálculo pero se excluye de
  la respuesta pública (mismo patrón de desestructuración que ya usaba `createdAt`→`memberSince`).
- Frontend: `<Badge>` con icono `Crown` junto al nombre en `/vendedor/[slug]/page.tsx`, solo cuando
  `seller.isPro`. Variant `default` (fondo primary) — deliberadamente un color distinto del ámbar ya
  usado para "Destacado" en `MyListingCard`, para no confundir "este anuncio está destacado" con
  "este vendedor es Pro". Reutiliza el lenguaje visual ya establecido en `/perfil/suscripcion`
  (icono `Crown` = Pro).
- **Alcance deliberadamente acotado, tal como pedía el encargo:** NO se toca la card de anuncio en
  listados/búsqueda/categoría/home — requeriría denormalizar `isPro` del vendedor en el documento de
  Meilisearch (mismo mecanismo que `boostScore`) para evitar N+1 al pintar una lista de anuncios de
  vendedores distintos. Anotado como mejora futura opcional, no implementada aquí.
- Tests: `h8-4-seller-pro-badge.e2e-spec.ts` (backend, 5 casos — Pro activo, no-Pro, `PRO_SUBSCRIPTION`
  caducado, revocado, y que el `id` interno no se filtra) + `vendedor-pro-badge.spec.ts` (Playwright,
  2 casos — Pro ve badge, no-Pro no ve nada). Verificado con captura de pantalla real. La suite
  `avatar-upload.spec.ts`, que también visita `/vendedor/vendedor-e2e`, sigue en verde sin cambios.

**H8 Bloque E ("Vendedor de confianza") — hecho. Con esto cierra el Bloque E; queda H8.6 (docs) para
cerrar el Hito 8 enfocado.**

- **Schema:** `User.trusted Boolean @default(false)` (migración `add_user_trusted`, sin backfill —
  default seguro). Campo propio del `User`, independiente de `isProActive`: no se deriva de Pro ni
  al revés — un usuario puede ser Pro, de confianza, ambos o ninguno.
- **Backend admin:** `PATCH /admin/users/:id/trusted { trusted: boolean }` — ADMIN-only (hereda
  `@Roles(Role.ADMIN)` de la clase, sin override a `MODERATOR`, a diferencia de
  `suspend`/`unsuspend` que sí son `MODERATOR`+`ADMIN`). Decisión deliberada: otorgar confianza es
  decisión de plataforma, no moderación — mismo criterio que baneo/rol, coherente con Fase 5.1.
  `AuditLogService.log` con acción `USER_TRUST`/`USER_UNTRUST` (before/after `{trusted}`), mismo
  patrón que `changeUserStatus`/`changeUserRole`. `trusted` añadido a los `select` de `listUsers` y
  `getUserById`.
- **Exposición pública en dos sitios, ambos con Postgres (sin Meili, sin denormalización):**
  - `UsersService.findBySlug` (`/vendedor/[slug]`): `trusted` es un campo directo del `select`, no
    requiere cálculo (a diferencia de `isPro`, que sí necesita `isProActive`).
  - `ListingsService.LISTING_INCLUDE.seller`: se añadió `trusted: true` al `select` del vendedor en
    la ficha del anuncio (`/anuncio/[slug]`, vía `SellerCard`). **Caveat real, no arreglado aquí**
    (detalle e ítem de deuda activa — ver «Caché de 5 min no se invalida al cambiar `trusted` del
    vendedor» en §3).
- **Frontend — tres badges visualmente distintos y coexistentes:** Pro (`Crown`, fondo primary
  sólido), Destacado (ámbar, ya existente en `MyListingCard`), de confianza (`BadgeCheck`, `outline`
  verde — `border-green-300 bg-green-50 text-green-700`). En `/vendedor/[slug]` ambos badges (Pro +
  confianza) conviven en la misma fila `flex flex-wrap gap-2` junto al nombre, sin amontonarse
  (verificado visualmente). `SellerCard.tsx` (ficha del anuncio) gana un `trusted?: boolean`
  opcional y renderiza el mismo badge debajo del bloque de nombre/fecha — sin tocar `isPro` ahí (no
  pedido para la ficha, mantiene el alcance exacto del encargo).
- **Admin UI:** nueva columna "Confianza" en `/admin/usuarios` — badge de estado + botón
  Marcar/Quitar, visible únicamente para `currentUserIsAdmin` (oculto para MODERATOR, igual que
  Banear/Desbanear). Reutiliza `handleAction` existente (refetch tras la acción).
- **Tests:** `h8-user-trusted.e2e-spec.ts` (backend, 12 casos — marcar/desmarcar + AuditLog, 403 para
  USER y explícitamente para MODERATOR, 401, 404, visibilidad en perfil y ficha, y el caso clave de
  independencia Pro+confianza en ambas direcciones) + `vendedor-trusted-badge.spec.ts` (Playwright,
  3 casos — flujo completo marcar→verificar en perfil y ficha→desmarcar→verificar vía admin real,
  perfil normal sin badge, ficha normal sin badge). El test de Playwright documenta explícitamente
  en un comentario por qué NO reintenta comprobar la desaparición del badge en la ficha del anuncio
  tras desmarcar (el caveat de caché de arriba) en vez de ocultar el problema con un `waitFor` o
  reintento que enmascararía el comportamiento real.
- Verificación manual con capturas de pantalla reales: el toggle en `/admin/usuarios` marca/desmarca
  correctamente, y el perfil de `pro-e2e` muestra ambos badges (Pro + confianza) lado a lado sin
  chocar visualmente.

**H8.6 (documentación) — hecho. Hito 8 enfocado CERRADO.** Ráfaga solo de documentación, sin cambios
de código. `docs/diseno-facturacion.md` (revisión 3) consolida todo el hito: resuelve la
contradicción §1.4 vs §2.5 (la frase "Pro no regala créditos" era falsa desde H8's §2.5; el
principio real es "Pro nunca altera el precio ni el hecho imponible"), añade la tabla canónica de
las 4 ventajas Pro con su estado real, la mecánica completa de la cuota (§1.4.1), el badge Pro
(§1.4.2) y Vendedor de confianza (§1.5) como nuevas secciones, corrige §3 para reflejar que
`grantFeaturedListing` ya NO es el punto único de concesión (deuda, no como se diseñó
originalmente), actualiza la tabla de ráfagas (§14) y decisiones (§15), y cierra con un §16 nuevo
que separa explícitamente deuda (duplicación de concesión, caché Redis 5 min, sin badges en cards
de listados, aislamiento dev/test) de lo diferido a propósito (Bloque C/D → Hito 8b, Redsys E2E
bloqueado por falta de túnel). Con esto el Hito 8 enfocado queda cerrado.

**Nota de proceso (full suite local vs. CI):** al ejecutar `jest --config test/jest-e2e.json` en
paralelo (workers por defecto) contra una base de datos de test local compartida, varias suites
fallan por deadlocks de Postgres y violaciones de FK — cada spec hace `cleanDb` (trunca `User`
CASCADE) en su `beforeAll`, y si dos suites corren a la vez sobre la misma BD, una puede borrar los
usuarios que la otra está usando a mitad de test. Con `--runInBand` (serie) sobre BD fresca, las 367
pruebas pasan limpias (confirmado de nuevo en H8 Bloque E). No es un problema introducido por H8 — es una
característica preexistente de la suite (solo es segura en serie, o en paralelo si cada worker
tuviera su propia BD); documentado aquí porque solo se hizo visible al ejecutar la suite completa en
local con varios núcleos libres. Revisar en Hito 9 si conviene aislar por base de datos por worker
(`jest --maxWorkers` + BD por worker) en vez de depender de la serialización.

**Revisado en Hito 9:** ver "Deuda de test/CI consolidada tras BLOG-FOOTER-COLUMNAS" más arriba —
decisión de no aislar por worker todavía (suite corta, 110 s en serie) y fix real del bug de
contaminación de `Setting` (no era un problema de paralelismo, sino de seed).

**H8 Bloque C (estadísticas de anuncios: vistas + me gusta, free vs Pro) — hecho.** Diferido en H8.6
a "Hito 8b"; se retoma y cierra en esta ráfaga (C1 backend + C2 frontend).

- **C1 (backend) — tracking + modelo + lectura:**
  - `Listing.viewCount` ya existía y ya se incrementaba en `findBySlug` (ambos ramales cache
    hit/miss de la caché Redis de 5 min) — pero "ingenuo": contaba al dueño, sin protección
    anti-recarga, sin granularidad temporal. **Sustituido** (no complementado) por un mecanismo
    dedicado: `POST /listings/:slug/view`, público con auth opcional (`OptionalJwtAuthGuard`, nuevo
    en `common/guards/` — nunca rechaza, `req.user` queda `null` sin token). El cliente lo llama al
    montar la ficha, desacoplado del render cacheado.
  - Exclusión del dueño: si el `userId` del token coincide con `sellerId`, no cuenta nada (ni marca
    dedup). Anti-recarga: `SET view:dedup:{listingId}:{visitorKey} 1 NX EX 1800` en Redis (30 min);
    `visitorKey` es `user:{userId}` si hay sesión o `anon:sha256(ip+userAgent)` si es anónimo (sin
    cookies nuevas, sin IP en claro, expira sola).
  - Modelo `ListingViewDaily` (agregado diario, no evento por vista: `{listingId, date, count}` con
    `@@unique([listingId, date])`) para la serie temporal Pro; `Listing.viewCount` se mantiene como
    total O(1) para el free.
  - `GET /listings/mine/:id/stats`: básico (`viewCount`, `favoritesCount` — `COUNT` en vivo sobre
    `Favorite`, sin denormalizar) para todos los dueños; si `isProActive`, además `dailyViews`
    (últimos 30 días) y `likeRatio`. Mismo endpoint, respuesta enriquecida — no un 403 en la parte
    Pro. `GET /listings/mine/stats/summary`: agregado del vendedor, 403 si no es Pro (sin
    equivalente free).
  - Tests: `h8-c1-listing-stats.e2e-spec.ts` (14 casos — anónimo cuenta, dueño excluido, dedup,
    visitantes distintos cuentan por separado, `findBySlug` ya no incrementa, gating free/Pro/403).
- **C2 (frontend) — UI:**
  - `ListingViewTracker` (client, en la ficha `/anuncio/[slug]`): dispara el POST en un `useEffect`
    que espera a que `useSession()` resuelva (`status !== 'loading'`) antes de disparar — si se
    envía mientras la sesión aún no se sabe, el backend no podría excluir al dueño (llegaría sin
    token aunque esté logueado). Fire-and-forget, errores ignorados.
  - Cifras básicas en `/mis-anuncios`: en vez de N+1 (una llamada de stats por card), se
    incluyeron `viewCount` y `favoritesCount` directamente en `GET /users/me/listings`
    (`ListingsService.findMine`) con el mismo patrón ya usado para `featuredUntil` — una query
    batch (`favorite.groupBy`) para todas las cards de la página, no una por anuncio.
  - Página nueva `/mis-anuncios/estadisticas` (`EstadisticasClient`): selector de anuncio, cifras
    básicas siempre, y si Pro: gráfica de vistas por día (recharts — instalado en esta ráfaga, no
    estaba en el proyecto), ratio me-gusta/vistas y tarjeta de agregado. Si no es Pro: mismas cifras
    básicas + CTA "Hazte Pro" (sin llamar al endpoint de summary, que es 403 para no-Pro — se evita
    la llamada en vez de manejar el error).
  - Tests estructurales: `h8-c2-listing-stats.spec.ts` (Playwright) — el tracking dispara el POST
    real, cifras visibles en cards, gating Pro/free en la página de estadísticas.
  - Verificación manual con capturas reales (usuario Pro y no-Pro, `pro-e2e`/`seller-e2e`): cifras
    en cards, gráfica (o estado vacío "aún no hay datos" cuando no hay vistas todavía), CTA de
    upgrade para free, y confirmación de que el dueño visitando su propio anuncio no altera sus
    propias estadísticas (antes/después idéntico).
  - Batería completa verde de verdad: 381/381 backend (serie), 111/111 frontend Playwright, 0 fallos
    — ver investigación de los 3 problemas encontrados por el camino en la nota de proceso de abajo
    (dos preexistentes con causa raíz confirmada, uno arreglado en este bloque).

**Nota de proceso — CI rojo tras el primer push de C2: investigación de 3 fallos, no aceptados como
"preexistentes" sin confirmar (lección explícita del Hito 6 sobre flakys).**

1. **`prefill-ubicacion.spec.ts` ("editar anuncio: usa la ubicación DEL ANUNCIO") — FALLO REAL,
   determinista, no flaky. Causa raíz confirmada:** el fixture `listing-rf11-e2e`
   (`seed-playwright.ts`) es `type: PRODUCT` pero **nunca** ha tenido `condition` seteado desde su
   creación (commit `8cf97c6`, RF.11) — confirmado con `git log -p` sobre todo el historial del
   archivo. `EditarWizard.validateStep('datos')` exige `condition` para `PRODUCT` desde antes de
   RF.11. Capturas de pantalla del wizard confirman el mecanismo exacto: al llegar al paso "Datos"
   aparece "⚠ Indica el estado del artículo." y "Siguiente" nunca avanza — el test nunca llega al
   paso "Ubicación" que busca. Es decir: **este test concreto lleva roto desde el día en que se
   escribió** (commit `87d1802`, RL5.1-A, que ya reutilizaba este mismo listing sin fijarle
   `condition`) — nadie lo detectó porque no se veía forzado a fallar hasta que el CI se miró con
   lupa en esta ráfaga. Arreglado: `seed-playwright.ts` fija `condition: 'GOOD'` en el `create` y el
   `update` del listing. Verificado 2 veces limpio tras el fix.
2. **`vendedor-trusted-badge.spec.ts` ("ADMIN marca/desmarca...") — FLAKY real, introducido en H8
   Bloque E.** Fallaba con timeout de 90s en `page.goto('/admin/usuarios')` ("Target page has been
   closed"), pasaba en el retry. Causa: es el único `goto` de este archivo que **no** seguía la
   convención ya establecida en el resto de specs de `/admin/*` (`admin-roles.spec.ts`): esperar
   explícitamente tras la navegación en vez de fiarse del evento `load` por defecto de `goto()`
   (que espera a que asiente TODA la actividad de red, no solo a que el contenido esté listo).
   Arreglado: `goto(..., { waitUntil: 'domcontentloaded' })` + espera determinista sobre el input de
   búsqueda concreto (`toBeVisible({ timeout: 15_000 })`) antes de interactuar, en vez de encadenar
   `.fill()` directamente. Aplicado también a los demás `goto` del archivo por consistencia.
   Verificado 5 veces seguidas sin fallo (antes fallaba de forma intermitente).
3. **`busqueda-mapa.spec.ts` ("Aviso de geo faltante") — descartado como fallo real: pura
   contaminación del Meilisearch local del desarrollador.** El test asume que Meilisearch empieza
   vacío en ese punto de la suite (comentario explícito en el propio test); en CI el contenedor de
   Meilisearch es efímero por job (`services:` en `ci.yml`) y arranca vacío siempre, así que el test
   nunca lo vio fallar en el CI real (el reporte de esta ráfaga no lo mencionaba). Localmente, en
   cambio, el índice `listings_test` es un Docker persistente que no se limpia entre ejecuciones
   sueltas de `npx playwright test` — tras las múltiples ejecuciones manuales de esta sesión
   acumulaba 32 documentos (14 sin `_geo`, el mismo "14 ×" que aparecía en el error). Confirmado
   vaciando el índice (`DELETE /indexes/listings_test/documents`) y volviendo a correr la suite
   completa: 111/111 verde. No requiere ningún cambio de código — es un artefacto de repetir
   Playwright en local sin resetear Meilisearch entre corridas (mismo patrón que la contaminación de
   `freeActiveListingLimit` en la BD de test compartida — ver «Seed de test no resetea `Setting` entre
   corridas locales» en §3).

**H8 Bloque D fase 1 (motor de campañas + bonus de créditos promocional) — hecho.** Mini-diseño
aprobado previamente; una sola ráfaga (schema + admin CRUD + aplicación en checkout).

- **Schema:** `enum CampaignType { CREDIT_BONUS }` (extensible sin migración por tipo futuro:
  `ACTION_DISCOUNT`/`COUPON`/`BANNER` documentados como comentario en el enum). `model Campaign` con
  `params Json` para los parámetros del bonus (`{kind: 'PERCENT'|'FIXED', value}`) — mismo patrón que
  `Setting.value`/`Listing.attributes`, evita añadir columnas nuevas por cada tipo de campaña futuro;
  validado en el DTO (`CampaignParamsDto`), no en BD. `CreditLedgerType` +`CAMPAIGN_BONUS`.
  `Transaction` +`campaignBonusAmount Int?` +`campaignId String?` (mismo patrón de congelado que
  `bonusCreditAmount` del Bonus Pro). Índice `[type, active, startsAt, endsAt]` para la query de
  campaña activa y la validación de solapamiento.
- **Decisión de producto (simultaneidad):** no se permiten dos campañas `ACTIVE` del mismo `type` con
  fechas solapadas — validado al crear/editar (`CampaignsService.assertNoOverlap`). Así nunca hay
  ambigüedad de "cuál aplicar": a lo sumo una `CREDIT_BONUS` está vigente en un instante dado
  (`getActiveCreditBonusCampaign`, derivado por fechas, sin caché — mismo criterio que
  `EntitlementService.isProActive`). Se permite crear/mantener campañas `INACTIVE` que solapan (para
  prepararlas); la validación solo bloquea si el resultado quedaría `active: true`.
- **Admin CRUD** (`CampaignsModule`, `/admin/campaigns`, ADMIN-only — como `admin-billing`, no
  `MODERATOR`): crear, editar (`name`/fechas/`params`/`active`; `type` no editable tras crear — sería
  otra campaña), listado con `status` derivado (`upcoming`|`live`|`ended`, comparado con `now`, no
  persistido). Sin `DELETE`: las campañas no se borran, solo se desactivan (registro histórico).
  `AuditLog` con `CAMPAIGN_CREATE`/`CAMPAIGN_EDIT`/`CAMPAIGN_ACTIVATE`/`CAMPAIGN_DEACTIVATE` (acción
  derivada del cambio real de `active`, no solo del endpoint llamado).
- **Deuda conocida, documentada y aceptada (no resuelta en esta fase):** la validación de
  solapamiento de campañas es check-then-act. (Detalle e ítem de deuda activa — ver «Solapamiento
  check-then-act en campañas» en §3.)
- **Checkout** (`RedsysService.createCreditPackCheckout`): el bonus de campaña se calcula y congela
  igual que el Bonus Pro, **antes** de crear la `Transaction` — el bonus vigente es el del instante
  del checkout, no el de la confirmación del pago (documentado explícitamente; mismo criterio que ya
  regía para el Bonus Pro). **Se suma al Bonus Pro, no lo sustituye**: un Pro comprando durante una
  campaña recibe ambos (decisión de producto — ambos son "créditos regalados en wallet, sin IVA", el
  patrón ya soporta múltiples entradas de `CreditLedger` por la misma `Transaction`).
- **Processor** (`RedsysProcessor.handlePackPurchase`): acredita `creditAmount + bonusCreditAmount +
  campaignBonusAmount` en una sola escritura de `Wallet`, con una entrada `CreditLedger` por
  componente (`PACK_PURCHASE`, `PRO_BONUS` si aplica, `CAMPAIGN_BONUS` si aplica) — nunca relee
  `Campaign` ni recalcula: si la campaña se desactiva entre el checkout y la confirmación del pago, el
  bonus congelado sigue aplicándose (verificado explícitamente en test).
- **Frontend:** `CAMPAIGN_BONUS` añadido a los mapas de etiquetas del historial de créditos
  (`/mis-creditos` y `/admin/facturacion/usuarios/[id]`) como "Bonus campaña", junto a "Bonus Pro".
  Sin UI pública ni de admin nueva más allá de eso — el CRUD de campañas es API-only en esta fase (no
  pedido un panel visual, coherente con el alcance del encargo).
- **No en esta fase** (documentado como extensión futura, motor ya diseñado para soportarlo sin
  rediseño): descuentos en acciones (bump/destacar), cupones canjeables, difusión/banners, límite de
  usos por campaña, caducidad de créditos de campaña (si se necesita, la nota ya existente de
  `CreditLedger` — añadir `expiresAt` + cron — sigue siendo el camino).
- **Tests:** `h8-d1-campaigns.e2e-spec.ts` (backend, 25 casos — auth ADMIN-only incl. 403 explícito
  para `MODERATOR`, validación de `params`/fechas, solapamiento en create/activate, no-revalidación en
  edición simple, `status` derivado, congelado PERCENT/FIXED en checkout, suma con Bonus Pro,
  acreditación en el processor con y sin campaña, y el caso de la campaña desactivada entre checkout y
  processor). Batería completa verde: 27/27 suites backend (406 tests) y 111 tests de Playwright, con
  el único fallo de `busqueda-mapa.spec.ts` (aviso de geo faltante) siendo la misma contaminación local
  de Meilisearch ya investigada y documentada en la nota de proceso de H8 Bloque C — reproducido de
  nuevo aquí, no relacionado con campañas, no un problema de código.

**Nota de proceso — CI rojo tras H8 Bloque D: dos causas distintas, ninguna era el fixture de C2
(verificado primero, sin asumir).** El mismo test que se arregló en C2 (`prefill-ubicacion.spec.ts`)
volvió a aparecer en el CI, pero con un síntoma totalmente distinto — señal explícita de investigar
la causa real en vez de re-aplicar el fix anterior a ciegas.

1. **Verificación previa: el fixture de C2 (`condition: 'GOOD'` en `seed-playwright.ts`) SÍ estaba
   pusheado.** `git log -p` confirmó el commit `9b7811b` en `origin/main`, y `git rev-parse HEAD` /
   `origin/main` coincidían exactamente — nada pendiente de subir. Esto descartó de raíz la hipótesis
   más barata ("el fix nunca llegó al CI") antes de investigar nada más.

2. **Causa real #1 — `next dev` se reinicia solo por memoria a mitad de la suite Playwright (9,6
   min), matando el test que estuviera navegando en ese instante.** El log de CI mostraba "⚠ Server is
   approaching the used memory threshold, restarting..." justo antes del fallo. Leyendo el propio
   código fuente de Next.js (`server/lib/start-server.ts`, `next@15.5.19`):
   ```
   if (isDev) {
     if (v8.getHeapStatistics().used_heap_size > 0.8 * heap_size_limit) {
       Log.warn('Server is approaching the used memory threshold, restarting...');
       process.exit(RESTART_EXIT_CODE);
     }
   }
   ```
   Ese watchdog está gateado por `isDev` — **solo existe en `next dev`, nunca en `next start`**. El
   dev server retiene mucho más en memoria (caché de módulos de webpack HMR, source maps) que un build
   de producción, y los ~9 minutos / 111 tests de la suite en un runner con memoria limitada bastaban
   para cruzar el umbral del 80% del heap de V8 a mitad de ejecución. **Arreglo**: Playwright's
   `webServer` para el frontend ahora ejecuta `next start` (producción) en CI en vez de `next dev`
   (`playwright.config.ts`, condicional por `process.env.CI`; local sigue en `next dev` para iteración
   rápida). Requiere un build previo — nuevo step "Build frontend for e2e" en `ci.yml` antes de lanzar
   Playwright. Verificado que `next build` no depende del backend levantado: no hay
   `generateStaticParams` en el proyecto, y el único fetch en build-time (`sitemap.ts` vía
   `getPostList`) ya tenía un `.catch(() => ({items: []}))` defensivo.

3. **Causa real #2 — carrera intermitente de navegación del App Router de Next.js, específica de
   `next start`, en `flujo-critico.spec.ts`.** Tras cambiar a producción, este test empezó a fallar con
   un síntoma nuevo: `page.waitForURL` nunca resolvía tras un click en un resultado de búsqueda
   (`"Target page, context or browser has been closed"` al agotar el timeout de 90s). Investigación
   sistemática (instrumentación temporal con `page.on('console'|'pageerror'|'framenavigated'|'request'|
   'response')`, capturas de pantalla, comparación aislada dev vs. producción):
   - Descartado dato/fixture: reproducido de forma idéntica con la BD y el índice de Meilisearch
     completamente limpios (drop+create de la BD, borrado del índice).
   - Descartado la página de destino: `page.goto(href)` directo al mismo slug funciona instantáneamente,
     siempre — la ficha, el backend y los datos están bien.
   - Descartado un error real: cero eventos `console`/`pageerror`/`crash` en todas las repeticiones. El
     click SÍ registra en el elemento correcto (estado `[active]`, `href` correcto vía
     `getAttribute`), y la RSC payload + el chunk JS de la página destino + la imagen del anuncio se
     piden y responden con 200 (confirmado con logging de `request`/`response`) — pero el router de
     App Router nunca confirma la transición: sin `history.pushState`, sin cambio de DOM, sin error.
   - Descartado que fuera solo cuestión de esperar más: `waitForLoadState('networkidle')`, +5s extra, e
     incluso un `reload()` limpio justo antes del click NO deshacen el problema una vez que ocurre —
     no es una carrera de "aún no ha terminado de asentarse", es un estado que ya quedó mal.
   - Aislado el disparador aproximado: un `click()` fresco (sin bucle de recarga previo) siempre
     funciona; el fallo solo aparece tras el bucle de `toPass` que recarga la página de búsqueda
     repetidamente mientras espera a que Meilisearch indexe el anuncio recién publicado. Cambiar ese
     bucle de `page.reload()` a `page.goto(url)` reduce la incidencia pero **no la elimina al 100%**
     (confirmado con `--repeat-each`, con el matiz de que `repeat-each` comparte un único
     `globalSetup`/BD entre repeticiones, así que repeticiones tardías acumulan anuncios de
     repeticiones anteriores — se verificó explícitamente que el anuncio correcto seguía
     encontrándose y clicándose pese al ruido, así que esa acumulación no era la causa del fallo).
   - **Conclusión honesta**: es una carrera intermitente del lado del cliente en la navegación del App
     Router bajo `next start`, no reproducible bajo `next dev`, sin una causa determinista única
     identificada pese a varias rondas de aislamiento. **Mitigación aplicada** (la respuesta correcta
     para una carrera fuera del control directo del test): además de cambiar el bucle de sondeo a
     `goto()`, el propio click se reintenta dentro de un `toPass` (click + `expect(url).toHaveURL(...)`
     con timeout corto; si no navega, vuelve a clicar) en vez de clicar una vez y solo reintentar la
     espera. Verificado con 5 ejecuciones limpias independientes (BD y Meilisearch reseteados entre
     medias) — 5/5 en verde.
   - Pendiente si reaparece con más incidencia: reportar upstream a Next.js con un caso mínimo
     reproducible (no se abrió aquí — no se logró una reproducción 100% determinista fuera del propio
     test, requisito habitual para un issue accionable).
   - (Ocurrencia consolidada en §3, «Carrera de navegación del App Router».)

**Suite completa verde de verdad tras ambos arreglos** (verificado sobre BD y Meilisearch limpios,
no solo repitiendo con datos ya calientes): 27/27 suites backend (406/406 tests), 2/2 suites unitarias
de frontend (12/12 tests), 111/111 Playwright — incluido `busqueda-mapa.spec.ts`, que pasa limpio con
el índice sin contaminar, confirmando de nuevo que su fallo intermitente es puramente de datos locales
acumulados, no de código.

**Ráfaga de estabilización — suite Playwright flaky en CI real (~6 re-pushes sin verde estable).
Causa raíz, no parcheo del test del día.** El objetivo era verde DETERMINISTA y repetido (5+ runs
limpios), no verde por suerte. Se encontraron y arreglaron tres bugs deterministas distintos — ninguno
era en realidad "el runner está saturado" (esa hipótesis de partida no se pudo confirmar ni fue
necesaria para explicar los fallos observados).

1. **`busqueda-mapa.spec.ts` — la asunción "Meilisearch está vacío" es FALSA siempre en CI real, no
   solo a veces.** El test original decía en un comentario "busqueda-mapa runs first — Meilisearch
   has no listings yet". Revisando `ci.yml`: el job `e2e` ejecuta el step "Backend e2e — Jest" ANTES
   que "Frontend e2e — Playwright", **compartiendo el mismo contenedor de servicio de Meilisearch**
   (no uno efímero por step). El suite de Jest indexa anuncios reales como parte de probar el propio
   módulo de búsqueda (`rf8-meilisearch.e2e-spec.ts`, `search.e2e-spec.ts`, etc.), así que el índice
   **nunca** está vacío cuando arranca Playwright — con o sin orden de ejecución de archivos, con o
   sin acumulación de datos locales. Esto es distinto (y más fundamental) que la contaminación local
   ya documentada arriba (esa era sobre repetir `npx playwright test` a mano sin resetear Meilisearch
   entre ejecuciones; esta es sobre la arquitectura del propio job de CI). **Arreglo**: las dos
   pruebas que verificaban "sin avisos cuando totalHits=0" ahora buscan con una query garantizada sin
   coincidencias (`zzz-sin-resultados-{Date.now()}`) en vez de depender de que el índice esté vacío.
   Verificado con `categoria-meili.spec.ts` (que indexa varios anuncios reales) ejecutándose
   **inmediatamente antes** en el mismo comando — las pruebas arregladas siguen en verde con el índice
   lleno.
2. **`prefill-ubicacion.spec.ts` y `wizard-herencia.spec.ts` — el selector para "la fila de ESTE
   anuncio" nunca matcheaba nada, y el fallback silencioso clicaba el anuncio equivocado según el
   orden de ejecución.** Ambos tests usaban
   `page.locator('li, article, [data-testid="listing-item"], tr').filter({ hasText: TITLE })` para
   localizar la card del anuncio y su enlace "Editar". `MyListingCard.tsx` renderiza un `<Card>` de
   shadcn — un `<div>` plano, sin `li`/`article`/`tr` ni ningún `data-testid="listing-item"` — así que
   ese locator **siempre** resolvía a cero elementos. El código tenía un `.or(page.getByRole('link',
   { name: /editar/i }).first())` como "fallback", que en la práctica era el ÚNICO camino que se
   ejecutaba nunca: **clicaba el primer enlace "Editar" de TODA la página** — el anuncio actualizado
   más recientemente por CUALQUIER test anterior en la suite, no necesariamente el anuncio que el test
   pretendía editar. `prefill-ubicacion.spec.ts` depende de un fixture sembrado una sola vez al
   principio (`listing-rf11-e2e`, Madrid); si algún test anterior (p. ej. `wizard-herencia.spec.ts`,
   que publica anuncios en Barcelona) tocaba un anuncio más recientemente, el fallback clicaba ESE
   anuncio en su lugar y la aserción de ciudad fallaba con un valor distinto según qué test hubiera
   corrido antes — exactamente el patrón "falla con síntomas distintos según la ejecución" reportado.
   **Arreglo**: `MyListingCard` gana un `data-testid={`listing-card-${listing.id}`}` estable; ambos
   tests ahora localizan con `page.locator('[data-testid^="listing-card-"]').filter({ hasText: TITLE
   })` y el `.or()` de fallback se elimina por completo (ya no hace falta, y mantenerlo dejaría la
   misma trampa silenciosa para la próxima vez que el selector primario falle por cualquier otro
   motivo). Verificado ejecutando `wizard-herencia.spec.ts` (publica anuncios en Madrid y Barcelona)
   **inmediatamente antes** de `prefill-ubicacion.spec.ts` en el mismo comando — el tercer test de
   prefill sigue encontrando y editando `listing-rf11-e2e` correctamente pese al ruido.
3. **El toggle Lista↔Mapa de `/busqueda` — misma carrera intermitente de navegación del App Router ya
   aislada para `flujo-critico.spec.ts` en la ráfaga anterior, otro punto de click distinto.** Tras
   arreglar los dos bugs de arriba, una ronda de 5 ejecuciones limpias de la suite completa dio 4/5 en
   verde y 1 fallo nuevo: `toggle Lista→Mapa→Lista cambia la vista y preserva filtros`, con el mismo
   síntoma de fondo (clic en un `<Link>` que a veces no completa la transición bajo `next start`, sin
   error de consola/página). Mismo mecanismo, punto de click distinto (el toggle mapa/lista, no una
   card de resultado de búsqueda) — refuerza que es una carrera genuina del propio App Router bajo
   producción, no algo específico de un test. **Mitigación**: mismo patrón que en H8 Bloque D —
   reintentar el click dentro de un `toPass`, en vez de clicar una vez y solo reintentar la espera.
   Verificado con `--repeat-each=5` sobre el archivo completo (65/65 en verde).
   (Ocurrencia consolidada en §3, «Carrera de navegación del App Router».)

**Cierre verificado con el estándar exigido — 5+ runs consecutivos limpios, no "pasó una vez tras
varios intentos":** dos rondas separadas de 5 ejecuciones completas de la suite (111/111 tests cada
una, sin un solo retry) tras aplicar los tres arreglos, además de las verificaciones dirigidas
anteriores (orden adverso de archivos, índice de Meilisearch no vacío, `--repeat-each` sobre los
archivos tocados). Los tres arreglos son deterministas — no dependen de la velocidad del runner ni de
"esperar más" — así que deberían sostenerse igual de bien en el CI real que en local.

**H8 Bloque D fase 2 (descuentos porcentuales en bump/destacar vía campañas) — hecho.** Construye
sobre el motor de campañas de fase 1 (mini-diseño aprobado); una sola ráfaga.

- **Schema:** `CampaignType` +`ACTION_DISCOUNT` (sin migración de datos). `params` para
  `ACTION_DISCOUNT`: `{ action: 'BUMP'|'FEATURED', percent: number }`, `percent` topado a 90 en el
  DTO (`@Max(90)`) — lo gratis del todo es solo vía cuota Pro, nunca vía descuento de campaña.
- **Validación de `params` — cambio de mecanismo respecto a fase 1.** Fase 1 validaba `params` con
  `@ValidateNested() @Type(() => CampaignParamsDto)` directamente en `CreateCampaignDto`, asumiendo
  un único shape posible. Con dos shapes posibles (`CampaignParamsDto` para `CREDIT_BONUS`,
  `ActionDiscountParamsDto` nuevo para `ACTION_DISCOUNT`) eso deja de funcionar: class-validator no
  soporta declarativamente "elige la clase anidada según un campo hermano" (el discriminador nativo
  de class-transformer exige la clave discriminadora *dentro* del objeto anidado, no en el padre).
  Se sustituyó por un switch manual en `CampaignsService.validateParams(type, params)`: `params` pasa
  a validarse como `Record<string, unknown>` a nivel de DTO (`@IsObject()` solamente) y el service
  elige la clase DTO correcta (`plainToInstance` + `validate()` de class-validator, invocados a mano)
  según `type`. Reutiliza los mismos DTOs de siempre — ninguna regla de validación se duplica, solo
  cambia dónde se dispara. Cubierto con una prueba de regresión explícita (`CREDIT_BONUS` con params
  inválidos sigue devolviendo 400 igual que en fase 1).
- **`CampaignsService.getActiveActionDiscount(action)`:** mismo criterio que `getActiveCreditBonusCampaign`
  de fase 1 — derivado, sin caché, sin query JSON en Postgres (sin precedente en el proyecto: se
  hace `findMany` acotado por el índice `[type, active, startsAt, endsAt]` y se filtra `params.action`
  en JS; a lo sumo dos filas pueden coincidir en el `findMany` — una por acción, BUMP y FEATURED
  conviven — volumen bajo, filtrar en JS es proporcionado).
- **Aplicación — solo la rama de créditos, calculado en vivo, floor:** `BillingService.featuredByCredits`
  (rama `useQuota:false`) y `.bump` consultan `getActiveActionDiscount` antes de leer el coste base de
  `Setting`, y aplican `Math.floor(base * (100-percent) / 100)` — floor, no ceil, redondeo a favor del
  usuario en una promoción. Sin checkout que congelar (a diferencia del bonus de créditos de fase 1):
  destacar-con-créditos y bump ya eran débitos atómicos instantáneos, así que "en vivo" es
  simplemente parte de la misma llamada. **La rama de cuota Pro (`useQuota:true`) no se toca en
  absoluto** — devuelve antes de llegar al cálculo de coste; verificado con una prueba dedicada (Pro
  destacando gratis durante una campaña `FEATURED` activa sigue gratis, sin `CreditLedger`, sin
  wallet creado).
- **Redsys directo, verificado sin cambios (principio fiscal):** `createFeaturedPayCheckout` /
  `RedsysProcessor.handleFeaturedPay` siguen usando `Price.amount` en EUR + `redsysTaxBreakdown`, un
  camino completamente separado de `getCreditCostForFeatured`/`getActiveActionDiscount` — nunca se
  descontó nada ahí, y una prueba dedicada lo confirma explícitamente (`Transaction.amountGross`
  idéntico al precio del `Price`, con y sin campaña activa). Descontar el pago con tarjeta habría
  alterado la base imponible del IVA — por eso el diseño lo prohibía desde el principio.
- **Trazabilidad — `note` en el `CreditLedger`:** a diferencia de fase 1 (donde el bonus es una
  entrada de `CreditLedger` *adicional*), aquí el descuento reduce el importe de la misma entrada de
  débito (`FEATURED_DEBIT`/`BUMP_DEBIT`) — no hay entrada nueva que crear. Para que soporte pueda ver
  "por qué este bump costó menos de lo normal", se rellena `note` (campo ya existente, nullable, sin
  migración) con `Campaña "${nombre}" (-${percent}%)` cuando hay descuento activo; `null` si no —
  igual que hoy.
- **Solapamiento refinado por acción:** `assertNoOverlap` de fase 1 pasaba solo `type`; ahora acepta
  también una `action` opcional. Para `ACTION_DISCOUNT` el conflicto exige `type` **y** la misma
  `params.action` — dos descuentos de `FEATURED` solapados bloquean (400 `CAMPAIGN_OVERLAP`), uno de
  `FEATURED` y otro de `BUMP` solapados conviven (201), y un `CREDIT_BONUS` solapado con un
  `ACTION_DISCOUNT` conviven (types distintos, como ya era). `update()` gana un tercer disparador de
  re-validación (además de activar y mover fechas): cambiar la `action` de una campaña `ACTION_DISCOUNT`
  ya activa — verificado con una prueba que cambia `BUMP`→`FEATURED` en una campaña que pasa a
  solapar con otra `FEATURED` activa y confirma el 400.
- **Catálogo (`GET /billing/catalog`):** `creditCost`/`bumpCreditCost` siguen siendo el coste
  *efectivo* (ya con descuento si lo hay, igual que antes de esta fase); se añaden
  `originalCreditCost`/`discountPercent` (destacar) y `bumpOriginalCreditCost`/`bumpDiscountPercent`
  (bump) — campos opcionales, **solo presentes cuando hay una campaña activa**, sin romper el shape
  para clientes que no los conozcan.
- **Frontend — mínimo, tal como pedía el alcance de la fase:** `DestacadoDialog` muestra el coste
  tachado + efectivo + badge `-N%` por duración cuando `originalCreditCost` está presente (el precio
  en EUR de la opción de tarjeta nunca se toca — coherente con que Redsys no se descuenta). El botón
  "Bump" de `MyListingCard` gana el mismo patrón tachado+efectivo+badge cuando hay descuento; sin
  campaña, el botón es idéntico al de siempre (sin coste alguno visible, como ya era). El coste de
  bump se resuelve server-side una vez en `mis-anuncios/page.tsx` (mismo patrón ya usado para
  `proStatus`) y se pasa por props a través de `MisAnunciosClient` — no una llamada a `/billing/catalog`
  por card. Tipo compartido `BumpPricing` en `src/types` (no en un componente, para evitar que
  `MyListingCard` y `MisAnunciosClient` se importen tipos entre sí).
- **Tests:** `h8-d2-action-discount.e2e-spec.ts` (backend, 16 casos — descuento en destacar con
  créditos con nota de campaña, sin campaña con nota null, Pro-con-cuota-sigue-gratis, Redsys-sin-
  descontar, descuento en bump, floor exacto (10 créditos, -33% → 6, no 7), solapamiento por acción en
  sus tres combinaciones, tope de `percent`, regresión de validación de `CREDIT_BONUS`, catálogo con y
  sin descuento). Sin regresiones en `h8-d1-campaigns`, `billing-rf6`, `h8-featured-quota` ni
  `billing-catalog` (61/61 verdes). Batería completa verde y REPETIDA sobre entorno limpio (BD +
  Meilisearch reseteados entre corridas, sin retries): 3 ejecuciones consecutivas del pipeline
  completo — 28/28 suites backend (422/422 tests) y 111/111 Playwright cada vez.

**H8 Bloque D fase 3a (canje de cupones — backend, con concurrencia) — hecho.** Mini-diseño
aprobado; el CRUD admin y el frontend quedan para fase 3b. Es dinero + concurrencia real (límite de
usos que se agota) — mismo rigor que la cuota Pro de H8.3.

- **Schema:** `Coupon` (`code` único normalizado a MAYÚSCULAS, `rewardType: CREDITS|FEATURED`,
  `creditAmount`/`featuredDurationDays` como **columnas explícitas nullable** — no `params` Json
  como `Campaign` — porque el espacio de recompensas es cerrado y no se prevén más tipos
  heterogéneos, así que columnas son más claras y no necesitan el switch de validación manual que sí
  hace falta en `Campaign`) y `CouponRedemption` (`couponId`, `userId`, `referenceType`/`referenceId`
  polimórfico hacia lo que se otorgó). `CreditLedgerType` +`COUPON_REDEEM`, `FeaturedOrigin` +`COUPON`.
- **`onePerUser` simplificado a SIEMPRE true** (recorte de alcance explícito, aprobado en el mini-
  diseño): un `@@unique([couponId, userId])` en `CouponRedemption` lo hace cumplir a nivel de BD sin
  configurabilidad. Soportar cupones reutilizables por el mismo usuario habría exigido o bien un
  índice único parcial vía SQL crudo (denormalizando un flag en cada fila), o bien un check-then-act
  sin red de BD — reintroduciendo la misma clase de carrera que este diseño evita para el límite
  total. Documentado como extensión futura si el negocio la pide.
- **Concurrencia del límite total — incremento atómico condicional, NO el lock de la cuota Pro.**
  `Coupon.redemptionCount` es un **contador físico** (como `Wallet.balance`), a diferencia del "usado
  este periodo" de la cuota Pro, que es un **COUNT derivado** sobre filas de `Entitlement` sin una
  sola fila que decrementar — por eso la cuota Pro necesita `SELECT ... FOR UPDATE` sobre
  `Subscription` para serializar el check-then-create, y los cupones NO lo necesitan:
  ```sql
  UPDATE "Coupon" SET "redemptionCount" = "redemptionCount" + 1
  WHERE id = ? AND ("maxRedemptions" IS NULL OR "redemptionCount" < "maxRedemptions")
  ```
  mismo patrón que el débito de `Wallet`. Postgres serializa el `UPDATE` a nivel de fila: dos
  transacciones concurrentes nunca pueden ambas leer `redemptionCount = maxRedemptions - 1` y ambas
  incrementar por encima del límite.
- **Verificación empírica de que el test de concurrencia realmente detecta el bug** (no solo que
  "pasa"): se sustituyó temporalmente el `UPDATE` condicional por un check-then-act ingenuo
  (`findUnique` + `update` sin `WHERE` atómico) y se confirmó que el test de "dos usuarios canjean el
  último uso a la vez" **falla** (ambos reciben 200, `redemptionCount` se pasa del límite) — luego se
  revirtió al `UPDATE` atómico y el test vuelve a pasar. Mismo rigor exigido para la cuota Pro en
  H8.3: un test de concurrencia que nunca se ha visto fallar no demuestra nada.
- **Un uso por usuario bajo concurrencia:** el chequeo explícito (`findUnique` antes de crear
  `CouponRedemption`) da un 409 legible en el caso normal; el `@@unique` de BD es la red de seguridad
  dura si dos peticiones del MISMO usuario compiten — el segundo `create` lanza P2002, capturado y
  traducido a `409 COUPON_ALREADY_REDEEMED` (mismo patrón que el P2002 de `Ds_Order` en Redsys), en
  vez de dejarlo burbujear como 500.
- **Refactor `grantFeaturedListing` → `grantFeaturedListingTx`** (salda parte de la deuda de
  duplicación de H8.1, anotada desde entonces): se extrajo la validación (ACTIVE + propietario + sin
  destacado activo) + `entitlement.create` a un método que opera sobre una `tx` recibida en vez de
  `this.prisma`. El wrapper público `grantFeaturedListing(params)` ahora abre su propia
  `$transaction` llamando a la versión `Tx` y encola el reindexado DESPUÉS de que la transacción
  confirma (igual que siempre — un job de BullMQ para un destacado que podría haber hecho rollback es
  peor que no encolar nada). **Firma y comportamiento sin cambios para su caller actual**
  (`RedsysProcessor.handleFeaturedPay`) — verificado sin regresión (`billing-rf6.e2e-spec.ts` sigue en
  verde). `priceId` pasa a opcional en `GrantFeaturedParams` (la columna ya era nullable, como en la
  rama de cuota Pro, que tampoco pasa `priceId`). Esto permite que `CouponsService.redeem` componga
  la concesión del destacado DENTRO de su propia transacción de canje. (La deuda de duplicación que
  este refactor solo salda en parte — verificado en código, sigue activa — está consolidada en §3,
  «Duplicación del punto de concesión de destacados».)
- **Rollback limpio en cupón FEATURED sobre anuncio inválido:** si `grantFeaturedListingTx` lanza
  (anuncio no ACTIVE, ya destacado, o no es del usuario) dentro de la transacción de canje, TODA la
  transacción revierte — incluido el incremento de `redemptionCount` del paso (a). El cupón no se
  consume si el usuario eligió mal el anuncio; verificado con un test dedicado que compara
  `redemptionCount` antes/después y confirma que no se crea `CouponRedemption`.
- **Tests:** `h8-d3a-coupons.e2e-spec.ts` (12 casos — canje CREDITS y FEATURED válidos, normalización
  de código a mayúsculas, sin `listingId` para FEATURED, rollback sobre anuncio ya destacado, código
  inexistente/inactivo/caducado/agotado/ya-canjeado, y los DOS tests de concurrencia obligatorios).
  Sin regresión en `billing-rf6`/`h8-d1-campaigns`/`h8-d2-action-discount`/`h8-featured-quota`
  (69/69 verdes).
- **Hallazgo incidental al verificar esta ráfaga — una instancia más de la carrera de navegación del
  App Router ya conocida.** Una ronda de verificación encontró `wizard-herencia.spec.ts` fallando en
  el click al enlace "Editar" (`page.waitForURL('**/editar**')` nunca resolvía) — el mismo mecanismo
  ya aislado y documentado arriba en la nota de proceso de estabilización (clic que registra pero la
  transición del App Router a veces no confirma bajo `next start`), esta vez en un punto de clic
  distinto (el enlace de editar de `wizard-herencia`/`prefill-ubicacion`, no el toggle de mapa ni la
  card de búsqueda). Mismo arreglo ya establecido: reintentar el clic dentro de un `toPass`, aplicado
  a ambos archivos. Verificado con `--repeat-each=5`: sin más fallos de este tipo (los 4 fallos que sí
  aparecieron en esa tanda eran otra cosa — ver nota siguiente). Confirmado limpio con rondas
  adicionales de la suite completa en pasada única. (Ocurrencia consolidada en §3, «Carrera de
  navegación del App Router».)
- **Nota de proceso — artefacto de `--repeat-each` distinto de un fallo real:** al verificar el
  arreglo anterior con `--repeat-each=5`, `prefill-ubicacion.spec.ts` falló 4/5 veces en su PRIMER
  test ("usuario SIN ubicación → campos vacíos"), esperando que el perfil de `seller-e2e` tuviera
  `city=null`. Causa: el SEGUNDO test del mismo archivo actualiza el perfil de `seller-e2e` a
  "Sabadell" vía `/perfil`; con `--repeat-each`, `globalSetup` (y por tanto el estado sembrado) NO se
  resetea entre repeticiones dentro de una misma invocación — así que a partir de la 2ª repetición el
  perfil ya no tiene `city=null`. Es el mismo tipo de confusión ya documentado para
  `flujo-critico.spec.ts` en la nota de estabilización: `--repeat-each` comparte BD entre
  repeticiones, algo que NUNCA ocurre en un run normal de CI (una sola pasada por job). No es un bug
  de producto ni de test — es una limitación de la propia herramienta de verificación, y no requiere
  ningún cambio de código. Confirmado ejecutando la suite en pasada única (sin `--repeat-each`)
  repetidas veces: siempre en verde.
- **Cierre:** 5 ejecuciones consecutivas limpias de la suite completa de Playwright (111/111, sin
  retries) tras el arreglo del clic, más 29/29 suites backend (434/434 tests) en entorno limpio.

**H8 Bloque D fase 3b (admin CRUD de cupones + frontend del canje) — hecho.** Cierra la fase 3
(cupones) del Bloque D; solo queda la fase 4 (difusión) para completar el bloque. Sin lógica de
concurrencia nueva — eso ya quedó cerrado en fase 3a; esta ráfaga es admin + frontend.

- **`AdminCouponsController`** (`/admin/coupons`, ADMIN-only — como `admin-campaigns`, no
  `MODERATOR`). `POST` crea con `code` normalizado a MAYÚSCULAS y duplicado → `409
  COUPON_CODE_TAKEN`; `endsAt` debe ser posterior a `startsAt`. `PATCH` edita fechas, `active`,
  `maxRedemptions` (`null` explícito quita el límite) y el valor de la recompensa
  (`creditAmount`/`featuredDurationDays`) — **`code` y `rewardType` inmutables tras crear** (mismo
  criterio que `type` en `Campaign`: cambiarlos sería otro cupón, no una edición; además un cupón ya
  distribuido con un código no puede cambiar de identidad sin romper lo que ya se repartió). `GET`
  lista paginada con `redemptionCount`/`maxRedemptions` visibles y `status` derivado
  (`upcoming`|`live`|`ended`, comparado con `now`, sin persistir — mismo patrón que `Campaign`). Sin
  `DELETE`: los cupones no se borran, solo se desactivan (registro histórico, igual que campañas).
  `AuditLog` con `COUPON_CREATE`/`COUPON_EDIT`/`COUPON_ACTIVATE`/`COUPON_DEACTIVATE` (acción derivada
  del cambio real de `active`, no del endpoint llamado — mismo mecanismo que `CampaignsService`).
- **Validación cruzada de la recompensa — mitad declarativa, mitad en servicio.** class-validator
  expresa bien la dirección "requerido si": `@ValidateIf(o => o.rewardType === CREDITS) @IsInt()
  @Min(1)` sobre `creditAmount`, simétrico para `featuredDurationDays`/`FEATURED`. La dirección
  contraria — "prohibido si el otro tipo" — no tiene forma declarativa limpia en class-validator, así
  que se comprueba en `CouponsService.assertRewardFieldsMatchType` (mismo precedente que
  `CampaignsService.validateParams` en fase 2, donde ya hizo falta un chequeo manual además del DTO).
- **`maxRedemptions` opcional-o-null sin `@ValidateIf` extra:** `@IsOptional()` de class-validator ya
  trata `undefined` (omitido → "no cambiar" en `PATCH`) y `null` (explícito → "quitar el límite") como
  casos que saltan la validación de tipo/rango — el tipo del DTO (`number | null`) y el spread
  condicional en Prisma (`...(dto.maxRedemptions !== undefined && {...})`) bastan sin lógica nueva.
- **Frontend admin** (`/admin/cupones`, solo `ADMIN` en `AdminNav`): listado con código, tipo,
  usos `N/max` (`∞` si no hay límite), vigencia, badge de estado derivado + badge "Inactivo"
  independiente, activar/desactivar inline, formulario crear/editar (`CouponFormDialog`) con `code` y
  tipo de recompensa bloqueados en modo edición. Añadir un 9º ítem a `AdminNav` **rompía
  `admin-roles.spec.ts`**, que tenía `toHaveCount(8)` cableado — encontrado leyendo el test antes de
  escribir los nuevos, no en un CI rojo posterior; corregido a 9 con el spot-check de "Cupones"
  añadido (el conteo de 4 ítems del `MODERATOR` no cambia: "Cupones" es `ADMIN`-only).
- **Frontend canje** (`/mis-creditos`, `RedeemCouponForm`): flujo de dos pasos aprobado en el
  mini-diseño — se intenta canjear solo con el código; si el backend responde `400
  LISTING_REQUIRED` (cupón `FEATURED`), se muestra el selector de anuncios activos del usuario
  (`getMyListings(status: 'ACTIVE')`) y se reintenta con `{code, listingId}`. Nunca hay una llamada
  previa de "vista previa" del cupón — evita una superficie nueva de "probar códigos" antes de
  canjear. Mensaje de éxito específico por tipo de recompensa; errores mapeados a español legible
  (`toCouponMessage`): `COUPON_NOT_FOUND`/`COUPON_INACTIVE`/`COUPON_EXHAUSTED`/
  `COUPON_ALREADY_REDEEMED`. Antes de escribir el mapeo se confirmó empíricamente (contrastando con
  `toFeaturedByCreditsMessage`, ya en producción) que el body de error de NestJS es **plano**
  (`{message, code}` a nivel raíz, no anidado) — evita un bug silencioso de `err.code` siempre
  `undefined`.
- **Tests:** backend `h8-d3b-coupons-admin.e2e-spec.ts` (18 casos — auth ADMIN-only incl. 403
  explícito para `MODERATOR` y `USER` en `GET`/`POST`, validación cruzada en ambas direcciones,
  normalización de código y 409 en duplicado, `PATCH` con activar/desactivar y su `AuditLog`,
  `maxRedemptions` a `null`, 404 en cupón inexistente, listado con `status` derivado y filtros). Sin
  regresión en `h8-d3a-coupons.e2e-spec.ts` (30/30 verdes juntos). Playwright
  `h8-d3-coupons.spec.ts` (6 casos — admin crea cupón CREDITS y lo ve en el listado con sus usos,
  activar/desactivar, canje CREDITS con mensaje de éxito, código inválido, cupón ya canjeado por el
  mismo usuario, canje FEATURED con selector de anuncio y destacado real).
- **Cierre:** 452/452 tests backend (30 suites) en BD limpia. Suite completa de Playwright: 3
  ejecuciones consecutivas sin retries — `h8-d3-coupons.spec.ts` y `admin-roles.spec.ts` en verde
  100% las 3 veces (117/117, 117/117, 116/117). El único fallo, en las 2 de esas 3 pasadas donde
  apareció, fue siempre el mismo test preexistente y no relacionado:
  `busqueda-mapa.spec.ts` → "toggle Lista→Mapa→Lista" (ver nota de proceso siguiente).
- **Nota de proceso — el toggle de mapa vuelve a ser intermitente, con un matiz nuevo frente a su
  cierre en fase 3a.** `busqueda-mapa.spec.ts` ya usa el patrón de reintentar el clic dentro de un
  `toPass` (misma mitigación de la carrera de navegación del App Router documentada arriba), y en el
  cierre de fase 3a había quedado verde 5/5. Al verificar esta ráfaga volvió a fallar en 2 de 3
  pasadas completas — siempre el mismo test, a veces en el clic a "Mapa", a veces en el clic a
  "Lista". Aislado sin tocar nada de `git status` en el área de mapa/búsqueda (cero archivos
  modificados ahí en esta ráfaga), así que no es una regresión de cupones. Caracterización adicional:
  ejecutado solo (`-g "toggle Lista"`, sin los otros tests del archivo) pasa de forma consistente;
  ejecutado junto con sus tests hermanos del mismo archivo, falla de forma consistente (3/3) — indica
  que algo del estado acumulado por los tests anteriores del archivo (cache de router/RSC del
  servidor Next.js, no aislamiento de test) incrementa la probabilidad de la carrera ya conocida, más
  de lo que ocurría en el cierre de fase 3a. **No abordado en esta ráfaga** (fuera del alcance de
  "admin CRUD de cupones + canje"; decisión explícita del usuario tras reportarlo). Pendiente como
  seguimiento: investigar por qué el orden/acumulación dentro del archivo afecta la tasa de fallo del
  reintento ya existente. (Ocurrencia consolidada en §3, «Carrera de navegación del App Router».)

**H8 Bloque D fase 4 (banners de difusión + enlaces compartibles) — hecho. Cierra el Bloque D
completo.** Mini-diseño aprobado; presentación, sin dinero ni concurrencia — la fase tranquila.
Campañas (fase 1/2) y cupones (fase 3) existían pero eran invisibles para el usuario; esta fase los
hace visibles con banners configurables desde admin.

- **Schema — `Banner`:** sigue el patrón ya establecido de `Campaign`/`Coupon` (modelo propio,
  `active` + fechas, `status` derivado, sin `DELETE`). Diferencias deliberadas: `placements
  BannerPlacement[]` es un **array escalar** (mismo patrón que `Post.tags`), no filas separadas por
  ubicación — un banner con el mismo contenido en HOME y MIS_ANUNCIOS es una sola entidad. **Sin FK a
  Campaign/Coupon** (decisión tomada en el mini-diseño): `linkUrl` de texto libre basta, evita una FK
  opcional que solo ahorraría teclear una ruta. **Ningún campo es inmutable tras crear** — a
  diferencia de `Coupon.code`, un banner no se distribuye fuera de la app, así que editar
  título/texto/`placements` no rompe nada externo.
- **Sin restricción de solapamiento** (a diferencia de `Campaign.assertNoOverlap`): varios banners
  activos conviven en la misma ubicación sin ambigüedad — son avisos, no dinero.
  `getActiveBanners(placement)` devuelve el array completo (`active AND now∈[startsAt,endsAt] AND
  placement ∈ placements`, `ORDER BY createdAt DESC`), no uno solo.
- **Primera lectura pública en este dominio de "promo management":** `GET /banners?placement=...`
  sin guard (la home es pública) — ni `Campaign` ni `Coupon` habían necesitado nunca un endpoint de
  lectura sin autenticación.
- **Admin CRUD** (`AdminBannersController`, `/admin/banners`, ADMIN-only — como campañas/cupones):
  `POST` valida `endsAt > startsAt` y `placements` no vacío; `PATCH` permite editar TODO, incluidos
  `placements` y `linkUrl` (ver justificación arriba); `GET` lista paginada con `status` derivado.
  `AuditLog` con `BANNER_CREATE`/`BANNER_EDIT`/`BANNER_ACTIVATE`/`BANNER_DEACTIVATE` (acción derivada
  del cambio real de `active`, mismo mecanismo que `CampaignsService`/`CouponsService`).
- **Frontend — home y mis-anuncios:** `getActiveBanners('HOME')`/`getActiveBanners('MIS_ANUNCIOS')`
  añadidos al `Promise.all` ya existente de cada Server Component (cero cambio de arquitectura).
  `BannerList` (Client Component) recibe los banners ya resueltos por SSR — el contenido está en el
  HTML inicial para SEO/crawlers independientemente de lo que haga el JS de cliente después.
- **Descarte permanente por id en `localStorage`** (aprobado en el mini-diseño, con el matiz
  explícito del usuario de que esto SÍ es la app real, no un artifact): el primer render del cliente
  coincide con el SSR (ningún id descartado todavía) para no romper la hidratación; el filtro real
  contra `localStorage` corre en un `useEffect` tras montar. Esto acepta un flash breve para banners
  YA descartados en visitas anteriores — el propio mini-diseño autorizó este trade-off ("si complica
  demasiado, aceptar el flash") en vez de un script de bloqueo síncrono pre-hidratación (patrón
  `next-themes`), que habría añadido complejidad real para un elemento de UI de bajísimo riesgo.
- **Compartir:** `navigator.share` si existe, con fallback a `navigator.clipboard.writeText`. Enlaces
  internos (`linkUrl` relativo) se resuelven a absolutos con `new URL(linkUrl, location.origin)` antes
  de compartir — nunca se comparte una ruta rota fuera del origen. Gate explícito por `shareable`
  (no "compartir siempre"): un banner `WARNING` de mantenimiento no tiene sentido compartirlo.
- **Tests:** backend `h8-d4-banners.e2e-spec.ts` (20 casos — auth ADMIN-only incl. 403 `MODERATOR` en
  `GET`/`POST` admin y 200 público sin auth, validación de `placements` vacío/inválido, `endsAt`,
  activar/desactivar con `AuditLog`, edición completa sin inmutabilidad, listado con `status`
  derivado y filtros, y la lógica de `getActiveBanners`: solo activos+vigentes+con el placement
  pedido, varios banners conviviendo en el mismo placement, un banner con ambos placements
  apareciendo en los dos). Sin regresión junto a campañas/cupones (91/91 verdes juntos). Playwright
  `h8-d4-banners.spec.ts` (5 casos — admin crea banner y lo ve en el listado, desactivar lo quita de
  la web, aislamiento por placement con un banner en ambas ubicaciones, descarte persistente tras
  recargar, enlace + compartir con fallback a portapapeles forzado de forma determinista
  sobrescribiendo `navigator.share` vía `addInitScript` — sin depender de si el Chromium de CI expone
  la Web Share API real).
- **Añadir "Banners" a `AdminNav` (10º ítem)** rompía de nuevo `admin-roles.spec.ts`
  (`toHaveCount(9)` cableado desde el cierre de fase 3b) — corregido a 10 antes de que llegara a
  fallar en CI, mismo patrón de verificación preventiva ya aplicado en fase 3b. El conteo de 4 ítems
  del `MODERATOR` no cambia (`Banners` es `ADMIN`-only).
- **Cierre:** 472/472 tests backend (31 suites) en BD limpia. Suite completa de Playwright: 3
  ejecuciones consecutivas sin retries, cada una sobre BD + índice de Meilisearch reseteados desde
  cero (para replicar fielmente un job de CI aislado, no una maratón acumulada) — 122/122 las 3
  veces, incluida la instancia conocida y ya documentada del toggle de mapa. **Con esta fase se
  cierra la fase 4, el Bloque D completo (campañas, descuentos, cupones, banners) y el Hito 8
  ampliado entero.**
- **Nota de proceso — un "fallo" de 4 tests en una pasada intermedia no era un fallo real.** Al
  encadenar una segunda pasada completa de Playwright inmediatamente después de la primera, sin
  resetear BD/Meilisearch entre medias, fallaron 4 tests de indexación (`categoria-meili.spec.ts`,
  `listing-card-attrs.spec.ts`) por timeout esperando una card vía Meilisearch, y esa segunda pasada
  tardó 7.1 min frente a los 2.7 min de la primera — consistente con acumulación de trabajo en la cola
  BullMQ de reindexado a través de las pasadas (cada pasada publica más anuncios sobre el mismo índice
  sin limpiar), no con un bug de producto ni de banners. Un job real de CI siempre arranca con un
  contenedor de Meilisearch/Postgres recién creado — nunca acumula así entre "pasadas" —, así que
  repetir localmente sin resetear entre cada una no reproduce fielmente ese entorno. Confirmado
  reseteando BD + índice antes de cada repetición: 122/122 limpio las 3 veces.

### Renombrar la key de un atributo no migra `Listing.attributes` (aviso, no migración)

`Listing.attributes` no tiene FK con `Category.attributeSchema`; renombrar la `name`
de un atributo existente en el editor deja huérfana la key vieja en los anuncios ya
publicados (el dato se conserva en el JSONB pero deja de mostrarse). El cierre de
Fase 5.2 añadió un aviso en el editor (`GET /admin/categories/:id/attribute-usage`)
que informa al admin del número de anuncios afectados antes de guardar, pero **no
migra los datos**. Pendiente (nivel superior, no abordado en esta ráfaga): migración
real del JSONB (`UPDATE ... attributes - 'oldKey' || jsonb_build_object('newKey', ...)`,
mismo patrón que la migración `rename_itemtype_normalize_size` de RC5.2) al confirmar
un renombrado con datos, en vez de solo avisar.

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

### Redsys — ciclo notificación + acreditación E2E, ambos caminos de pago con tarjeta (CERRADO)

**Contexto:** los dos caminos por los que un usuario paga CON TARJETA (Redsys) —
destacar un anuncio y comprar un pack de créditos — nunca se habían ejercido de punta
a punta — todos los tests existentes (`redsys.e2e-spec.ts`, `billing-rf6.e2e-spec.ts`)
llamaban a `RedsysProcessor.processSuccess()` directamente, saltándose la verificación
HMAC real, el endpoint `POST /webhooks/redsys` y (para el destacado) la visibilidad
resultante en Meilisearch. Cerrado en dos ráfagas: `redsys-featured-payment-e2e.e2e-spec.ts`
(destacado) y `redsys-credits-payment-e2e.e2e-spec.ts` (créditos).

**Cómo se simula Redsys sin sandbox real:** la librería `redsys-easy` firma requests y
verifica notificaciones con el mismo algoritmo simétrico (`HMAC_SHA256_V1` derivado de
`Ds_Order`). Su función exportada `serializeAndSignJSONRequest(secretKey, params)` —
la misma que usa `createRedirectForm` — sirve para construir una notificación firmada
que `RedsysWebhookGuard` acepta como genuina, usando la `REDSYS_SECRET_KEY` real de
`.env.test`. Esto ejercita la verificación de firma de verdad (no un mock), pero
**sigue sin sustituir** una prueba contra el TPV sandbox real con tarjeta de prueba y
túnel público (`ngrok`/`cloudflared`) — esa pieza (red real, servidor de Redsys real)
queda como deuda menor, no bloqueante: la lógica de firma/idempotencia/routing ya está
verificada de extremo a extremo con la clave real.

**Qué quedó verificado (5 tests, todos pasando):**
1. Camino feliz completo: `POST /billing/checkout/featured-pay` → notificación firmada
   real → `RedsysWebhookGuard` la acepta → job en `QUEUE_REDSYS` → `Transaction.status =
   SUCCEEDED` → `Entitlement FEATURED_LISTING` (origin `REDSYS`, `transactionId` correcto,
   `expiresAt` ≈ `durationDays`) → el anuncio aparece con `boostScore: 1` en el documento
   de Meilisearch (el resultado que le importa al usuario, no solo el estado en Postgres).
2. Firma inválida → `400`, ni `GatewayEvent` ni `Entitlement` se crean, `Transaction`
   sigue `PENDING` (cierra la pregunta de seguridad: una firma no verificada no puede
   conceder destacados gratis).
3. Notificación duplicada (mismo `Ds_Order` dos veces, vía HTTP real, no solo el
   `GatewayEvent.create()` a nivel de BD que ya cubría `redsys.e2e-spec.ts`) → segunda
   respuesta `{ duplicate: true }`, un solo `Entitlement`.
4. `Ds_Response` de rechazo (código `0180`) → `Transaction FAILED` síncronamente en el
   guard, nada concedido.
5. Retry de BullMQ tras un fallo transitorio a mitad del proceso — ver bug y fix abajo.

**Bug de dinero encontrado y arreglado — Transaction atascada en PENDING para siempre:**
`RedsysProcessor.handleFeaturedPay` concedía el `Entitlement` primero (en su propia
`$transaction`) y solo después marcaba `Transaction.status = SUCCEEDED` en un segundo
paso separado, con un comentario que razonaba "así, si esto falla, la Transaction queda
PENDING y BullMQ puede reintentar" — pero ese retry **nunca se había ejercido**. El test 5
fuerza exactamente ese fallo transitorio (justo después de conceder el entitlement) y
demuestra que el reintento de BullMQ no podía recuperarse: el propio guard de
`grantFeaturedListingTx` ("listing ya tiene un destacado activo") rechaza el segundo
intento porque el entitlement del primer intento ya existe — el job fallaba para
siempre tras 3 intentos (dead job), dejando la `Transaction` en `PENDING` permanentemente
pese a que el usuario ya había pagado y el anuncio ya estaba destacado. No duplicaba el
cobro (la comprobación sí protegía eso), pero la contabilidad quedaba rota sin ninguna
vía de recuperación automática.

**Fix aplicado:** `BillingService.grantFeaturedListingAndSucceed` (nuevo método, usado
solo por el camino Redsys) concede el entitlement Y marca `Transaction.status =
SUCCEEDED` en la MISMA `$transaction` de Postgres — el mismo patrón que ya usaba
`handlePackPurchase` para los packs de créditos. Si cualquiera de los dos pasos falla,
Postgres revierte ambos; el siguiente retry de BullMQ arranca desde un `PENDING` limpio,
sin entitlement previo que bloquee el segundo intento. El reindexado se encola tras el
commit, igual que antes. `grantFeaturedListing` (el método original, sin el update de
Transaction) se mantiene para `featuredByCredits` y `CouponsService.redeem`, que no
tienen una `Transaction` de pasarela que actualizar.

Verificado sin regresión: `redsys.e2e-spec.ts`, `billing-rf6.e2e-spec.ts`,
`queue-retry.e2e-spec.ts`, `h8-featured-quota.e2e-spec.ts`, `h8-d3a-coupons.e2e-spec.ts`
(89 tests, todos en verde) — los caminos de créditos/cuota/cupón usan `grantFeaturedListing`
sin cambios.

**Segunda ráfaga — mismo molde aplicado a credits-pack (`redsys-credits-payment-e2e.e2e-spec.ts`, 6 tests, todos pasando):**
la ráfaga del destacado dejó una premisa sin verificar: que el camino de créditos "ya
usaba el mismo patrón atómico" que el fix de `grantFeaturedListingAndSucceed` (se leyó
del código, no se ejerció). Esta ráfaga lo comprueba de verdad:
1. Camino feliz: `POST /billing/checkout/credits-pack` → notificación firmada real →
   `Transaction.status = SUCCEEDED` → `Wallet.balance` incrementado en el `creditAmount`
   exacto del pack, `CreditLedger PACK_PURCHASE` con `referenceId = transactionId`.
2. Firma inválida → `400`, cero créditos regalados, sin `Wallet` creado — el hallazgo
   crítico de esta ráfaga es de seguridad: sin esta verificación cualquiera podría
   forjar una notificación y regalarse créditos.
3. Notificación duplicada (mismo `Ds_Order` dos veces vía HTTP real) → segunda respuesta
   `{ duplicate: true }`, un solo abono.
4. Reintento de BullMQ tras `Transaction` ya `SUCCEEDED` (llamada directa a
   `processSuccess()` simulando un job espurio) → la guarda de idempotencia capa 2
   (`status ≠ PENDING`) lo bloquea, no duplica.
5. `Ds_Response` de rechazo (`0180`) → `Transaction FAILED` síncronamente, wallet
   intacto (`null`).
6. **El escenario que rompió el destacado, reproducido aquí:** fallo transitorio forzado
   a mitad de la `$transaction` de `handlePackPurchase` (mismo truco que el test 5 del
   destacado — dejar correr la transacción real hasta el final y lanzar desde el
   callback para forzar un `ROLLBACK` genuino de Postgres). Resultado: revierte TODO
   (wallet no creado, ledger vacío, `Transaction` sigue `PENDING`); el retry de BullMQ
   parte de cero y acredita limpio, una sola vez, sin ni un céntimo de más.

**Premisa CONFIRMADA, no solo asumida:** `handlePackPurchase` envuelve el `Wallet.upsert`,
las escrituras de `CreditLedger` (base + bonus Pro + bonus de campaña) y el
`Transaction.status = SUCCEEDED` en una única `prisma.$transaction` desde que el método
se escribió en RF.5 (`git log -S "handlePackPurchase"` → un solo commit, nunca tocado
por el fix de atomicidad del destacado). A diferencia del destacado, aquí **no apareció
ningún bug de dinero** — el test 6 pasó en verde a la primera. La lección de esta sesión
("el código parece correcto" no basta, hay que ejercerlo) se aplicó y esta vez el
resultado fue una confirmación, no un hallazgo — vale la pena registrar el caso negativo
para no repetir la verificación sin necesidad en el futuro.

**Deuda cerrada:** con ambos caminos (destacado y credits-pack) ejercidos de punta a
punta con firmas HMAC reales, solo quedaba la prueba contra el TPV sandbox real de
Redsys — ver siguiente sección, CERRADA el mismo día.

### Redsys — verificación contra el sandbox real (CERRADO)

**Contexto:** todo lo anterior (`redsys-featured-payment-e2e.e2e-spec.ts`,
`redsys-credits-payment-e2e.e2e-spec.ts`) prueba el código contra NUESTRA
simulación de Redsys — firmada con HMAC real vía `redsys-easy`, pero construida por
nosotros. Si nuestra comprensión del formato tenía un error, la simulación tendría el
MISMO error y los tests pasarían igual. Esta ráfaga cierra ese hueco: un pago real con
tarjeta de prueba contra `sis-t.redsys.es` (el sandbox de verdad), con el comercio
genérico público de Redsys (`999008881` — Ernest confirmó que no tiene todavía un
comercio propio asignado por el banco; el genérico sigue apuntando al sandbox real, no
a una simulación nuestra, así que sirve igual para este propósito).

**Procedimiento (repetible):**
1. **Túnel público hacia `:3001`** — Redsys necesita poder llamar a
   `POST /api/webhooks/redsys` desde internet. Probado `localtunnel` primero
   (`npx localtunnel --port 3001`, cero instalación) — **se cayó dos veces en la misma
   sesión** (un `503` tras el intento real de pago, un `502` justo después de
   reiniciarlo) sin que el proceso diera ningún aviso de error. Cambiado a
   **`cloudflared`** (`winget install --id Cloudflare.cloudflared -e`, luego
   `cloudflared tunnel --url http://localhost:3001` — no requiere cuenta para un
   "quick tunnel"): mucho más estable, con pre-checks de conectividad explícitos al
   arrancar. **Recomendación para la próxima vez: usar cloudflared directamente, no
   localtunnel.**
2. **`REDSYS_NOTIFICATION_URL`** en `apps/api/.env` → `https://<túnel>/api/webhooks/redsys`.
   Las URLs de retorno OK/KO (`APP_URL`) se dejan en `http://localhost:3000` — las
   redirige el navegador del propio usuario, no Redsys, así que no necesitan túnel
   (invariante de seguridad ya documentada: la URL OK nunca ejecuta lógica de negocio).
   **Reiniciar el backend** tras cambiar `.env` — `nest start --watch` no recarga
   variables de entorno solo (no son un archivo fuente vigilado), hay que matar el
   proceso y volver a `npm run dev`.
3. **Instrumentación temporal** en `RedsysWebhookGuard.canActivate`: loguear el body
   crudo tal cual llega (antes de cualquier interpretación) y, tras verificar la firma,
   el objeto `notification` COMPLETO en runtime — no solo los 3 campos
   (`Ds_Order`/`Ds_Amount`/`Ds_Response`) que deja ver el cast de TypeScript. Revertida
   íntegramente al cerrar (nunca debe quedar en el código real).
4. **Verificar el túnel con un `curl -X POST` antes de que el usuario pague** — coste
   cero, y es la única forma de detectar un túnel caído (como pasó aquí) sin gastar un
   intento real de pago para descubrirlo.
5. El pago con tarjeta de prueba lo hace el humano a mano en el navegador — un E2E no
   puede sustituir esta parte (no hay forma de automatizar el formulario real de
   Redsys ni la redirección 3DS).

**Qué llegó de verdad — comparado campo a campo con la simulación:**

Notificación real (pack de créditos, 19,99 €, aprobado):
```json
{
  "Ds_Date": "14/07/2026", "Ds_Hour": "19:49", "Ds_SecurePayment": "1",
  "Ds_Card_Number": "454881******0004", "Ds_Card_Country": "724",
  "Ds_Amount": "1999", "Ds_Currency": "978", "Ds_Order": "20260714WHN9",
  "Ds_MerchantCode": "999008881", "Ds_Terminal": "001", "Ds_Response": "0000",
  "Ds_MerchantData": "", "Ds_TransactionType": "0", "Ds_ConsumerLanguage": "1",
  "Ds_AuthorisationCode": "167157", "Ds_Card_Brand": "1",
  "Ds_Card_Typology": "CONSUMO", "Ds_ProcessedPayMethod": "78",
  "Ds_Control_1784051352308": "1784051352308", "Ds_ECI": "05",
  "Ds_Response_Description": "OPERACION AUTORIZADA"
}
```

- **Los campos que nuestro código SÍ lee** (`Ds_Order`, `Ds_Amount`, `Ds_Response`,
  `Ds_Currency`, `Ds_MerchantCode`) coinciden EXACTAMENTE en formato con lo que la
  simulación ya construía: `Ds_Order` de 12 caracteres (`YYYYMMDD`+4 alfanumérico,
  igual que genera `RedsysService.generateDsOrder()`), `Ds_Amount` en céntimos como
  string, `Ds_Response: "0000"` para aprobado. **Ningún bug de formato** en lo que el
  procesador realmente consume.
- **`DS_MERCHANT_ORDER` no viene en la notificación real** (solo `Ds_Order`, dentro del
  JSON decodificado) — nuestra simulación lo incluye porque `serializeAndSignJSONRequest`
  lo necesita como parámetro de FIRMA (deriva la clave del pedido), mientras que
  `deserializeAndVerifyJSONResponse` deriva esa misma clave leyendo `Ds_Order` DESDE
  el JSON decodificado. Confirmado en vivo: la notificación real, que nunca trae
  `DS_MERCHANT_ORDER`, verificó su firma sin problema con nuestro código — la asimetría
  es del propio protocolo de Redsys, no un error nuestro.
- **~14 campos que la notificación real SIEMPRE trae y que nuestra simulación no incluía
  ni el procesador lee hoy:** fecha/hora, tarjeta enmascarada + país + marca + tipología,
  código de autorización, ECI, método de pago procesado, idioma del consumidor, tipo de
  transacción, descripción del response, y una clave dinámica `Ds_Control_<timestamp>`.
  Ninguno de estos causa un bug (el procesador solo desestructura los 3 campos que
  necesita, así que los extra se ignoran sin más), pero es la evidencia de que la
  simulación era un SUBCONJUNTO artificial. **Actualizado:** ambos `buildSignedNotification()`
  (destacado y credits-pack) ahora incluyen estos campos con los valores reales
  observados — la clave dinámica `Ds_Control_*` se dejó fuera a propósito (no aporta
  nada fijar un timestamp arbitrario). Batería re-verificada tras el cambio: 11/11 en
  verde.

**Camino feliz verificado de punta a punta, contra Redsys real:**
- Pack de créditos (19,99 €, `Ds_Order=20260714WHN9`): `Transaction SUCCEEDED`,
  `GatewayEvent` creado, `Wallet` acreditado (créditos base + bonus Pro congelado en el
  checkout), timestamps del `Wallet.updatedAt` y `Transaction.updatedAt` prácticamente
  idénticos (confirma que la acreditación ocurrió dentro de la misma `$transaction` que
  marca `SUCCEEDED`, igual que en el E2E).
- Destacado (2,99 €, `Ds_Order=20260714JMP1`): `Transaction SUCCEEDED`, `Entitlement
  FEATURED_LISTING` creado (`origin: REDSYS`, `expiresAt` = +7 días exactos), y el
  anuncio reindexado en Meilisearch con `boostScore: 1` — confirmado con una consulta
  directa al índice tras el pago.

**Camino de fallo no ejercido esta vez:** no se probó un pago RECHAZADO contra el
sandbox real (Ernest no tenía a mano la tarjeta/importe concretos que el manual de
pruebas de Redsys usa para forzar un rechazo). El camino de rechazo YA está cubierto
por los E2E con firma real simulada (`Ds_Response` distinto de `0000` → `Transaction
FAILED` síncronamente) — lo único que falta de verificación real es que Redsys, ante
un rechazo genuino, efectivamente llame al webhook con ese mismo formato de
`Ds_Response`. Deuda menor, no bloqueante: el manejo de esa rama ya no depende de
suposiciones sobre CÓMO llega (eso se acaba de confirmar campo a campo arriba), solo de
qué valor concreto trae `Ds_Response` en el caso de rechazo, que es una constante
documentada por Redsys, no un formato distinto.

**Hallazgo operativo, no de producto:** `localtunnel` no es fiable para esta clase de
verificación — se cayó dos veces sin aviso durante una sesión de menos de 30 minutos.
Costó un ciclo completo perdido (Ernest completó un pago real que nunca llegó a
procesarse, y solo se detectó revisando la base de datos, no por ningún error visible
en el navegador). **Para la próxima vez: arrancar con cloudflared directamente.**

**Cierre:** túnel apagado (verificado con un `curl` tras matar el proceso — `502`,
confirmando que ya no hay nada detrás), `REDSYS_NOTIFICATION_URL` revertido a vacío en
`.env`, instrumentación temporal retirada del guard, servidores de dev parados. Con
esto, **Redsys queda verificado tanto contra nuestra simulación (E2E) como contra el
sandbox real** — el último hueco de verificación de los tres canales de dinero del
proyecto (Redsys destacado, Redsys credits-pack, Stripe suscripción) queda cerrado.

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

### ✅ Deuda de señal en tests de frontend: 10 rojos permanentes — RESUELTA (2026-07-14)

**Contexto.** Varias ráfagas acumulaban "los mismos 10 de siempre" en rojo en la batería de
frontend (`pnpm --filter @marketplace/web test:unit`), confirmados preexistentes vía `git
stash`. Un test siempre rojo deja de ser señal: el próximo rojo real habría pasado
desapercibido porque el rojo ya era "lo normal".

**Inventario y causa raíz.** Los 10 eran, en realidad, una única causa raíz repetida en 3
suites — no 10 problemas distintos:

- `PublicarWizard.test.tsx` (6 tests): `TypeError: useSession is not a function`. El mock de
  `next-auth/react` en el test solo exponía `signOut`; le faltaba `useSession`.
- `BlockRenderer.test.tsx` (3 tests, bloque `listings`) y `BlockEditor.test.tsx` (1 test,
  preview del bloque `listings`): `invariant expected app router to be mounted`. Ninguno de
  los dos mockeaba `next/navigation` (`useRouter`/`usePathname`).

**Clasificación:** los 10 son tipo **(a) test desactualizado** — no bug real ni test mal
escrito de origen. `useRequireAuth()` (que llama incondicionalmente a `useSession()`,
`useRouter()` y `usePathname()`) se fue conectando a más componentes en ráfagas sucesivas
(`PublicarWizard` desde el commit `7552259` "Nav Login SingUp User-Admin 2"; `ListingCard` →
`FavoriteCardButton` desde `ce0f675` "Sistema bloques R.3", al montar tarjetas reales de
anuncio en el bloque dinámico `listings`) sin que los mocks de los tests preexistentes se
actualizaran para cubrir esas nuevas llamadas a hooks. `PublicarWizard.test.tsx` sí mockeaba
`next/navigation`, pero solo `useRouter` — le faltaba `usePathname`, la misma familia de gap.

**Fix.** Completar los mocks en los 3 ficheros de test (`useSession: () => ({ data: null
})` y/o `usePathname: () => '/...'` junto al `useRouter` ya existente), sin tocar código de
producción — el comportamiento de los componentes en producción siempre fue correcto, el
`SessionProvider`/`AppRouterContext` real de Next.js siempre estuvieron presentes fuera de
tests.

**Verificación.** Batería completa en verde: `185/185`. Sanity-check (mismo criterio que el
guard de retry de Redsys): se rompió deliberadamente una aserción trivial
(`BlockRenderer.test.tsx`, caso `faq`) y la batería lo cazó (`1 failed, 184 passed`); se
revirtió y volvió a quedar en `185/185`. Un rojo en la batería de frontend vuelve a
significar "algo se ha roto".

---

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

## Cambio cerrado — Producto/Servicio (R0-R5)

**✅ CERRADO** (2026-07-08). Las 6 ráfagas (R0-R5) están completas; el cambio funciona de
punta a punta y sus costuras entre ráfagas están verificadas, no solo asumidas. Sección
conservada como registro histórico del plan y su ejecución.

**Objetivo:** los anuncios diferencian producto/servicio; la categoría configura qué
tipos permite (solo producto / solo servicio / ambos); cuando permite ambos, el anuncio
elige y se aplican atributos distintos según el tipo elegido. Alcance deliberadamente
acotado: **solo cambian los atributos** — precio, envío, estado y flujos de publicación
siguen igual. Los atributos propios de servicio son filtrables en búsqueda igual que los
de producto.

**Estado del terreno** (del mapa hecho antes de diseñar, y de RÁFAGA 0 ya cerrada):
`Listing.type` (`PRODUCT`/`SERVICE`) ya existe como enum de dominio, elegido libremente en
el wizard, hoy sin ninguna restricción por categoría — cualquier categoría admite ambos
tipos. `Category.attributeSchema` con herencia de 2 niveles (hoja → padre,
`resolveEffectiveSchema`) ya modela atributos por categoría. La búsqueda ya deriva sus
atributos filtrables dinámicamente del schema (RÁFAGA 0), lo que evita que producto/servicio
tenga que volver a tocar el mecanismo de búsqueda al multiplicar atributos por tipo.

**Plan de ráfagas — R0-R5 CERRADAS.** El cambio producto/servicio es FUNCIONAL DE PUNTA A
PUNTA y verificado como tal: un admin configura la política de una categoría → un usuario
publica con el tipo forzado o elegido según corresponda → la búsqueda filtra y presenta
facetas conscientes del tipo → la ficha muestra solo los atributos aplicables — y R5
confirmó con flujos reales (no solo baterías aisladas) que las piezas encajan entre sí:

- **R0 — Dinamización de búsqueda.** ✅ **CERRADA.** Ver «Atributos filtrables dinámicos —
  RÁFAGA 0» en §2 y «Deuda nueva abierta por RÁFAGA 0» en §3.
- **R1 — Modelo.** ✅ **CERRADA.** Política de tipo en `Category` (`ListingTypePolicy`,
  `allowedListingType @default(BOTH)`), conexión tipo↔atributos (`AttributeField.appliesTo`),
  validación e inmutabilidad de `Listing.type`. Migración indolora verificada (584 tests
  e2e en verde). Ver «Modelo producto/servicio — RÁFAGA 1» en §2.
- **R2 — Admin de categorías.** ✅ **CERRADA.** Selector `allowedListingType` + validación de
  escritura bidireccional (`assertPolicyConsistentWithParent` hacia arriba,
  `assertPolicyChangeDoesNotBreakChildren` hacia abajo — molde `deleteCategory`, rechaza en
  vez de avisar o permitir en silencio); checkboxes `appliesTo` por atributo; refresco en
  caliente de `filterableAttributes` vía cola (resuelve el diferido de R0). Migración
  indolora verificada (593 tests e2e en verde). Ver «Admin de categorías producto/servicio
  — RÁFAGA 2» en §2.
- **R3 — Wizard.** ✅ **CERRADA.** El tipo se pregunta solo si la política efectiva es
  `BOTH` (`readOnlyType` reutilizado de R1); `filterSchemaByType` en los 3 puntos de
  consumo (render, validación, envío); transiciones — cambio de categoría deriva
  `type`/`condition` de la nueva política, cambio de tipo conserva en memoria y filtra en
  consumo. Migración indolora verificada (598 tests e2e + 23 tests Jest frontend en
  verde). Ver «Wizard producto/servicio — RÁFAGA 3» en §2.
- **R4 — Búsqueda y ficha.** ✅ **CERRADA.** Ficha filtra atributos por tipo
  (`filterSchemaByType`, con el caso borde de los relacionados cubierto); `FilterPanel`
  oculta "Tipo" en categorías single-type. **Hallazgo clave**: casi todo lo que R4
  "necesitaba" ya existía o salía gratis — el filtro por tipo desde H6.2, las facetas
  conscientes del tipo por construcción (Meilisearch + `FilterPanel` ya existentes),
  "condición" ya oculta en servicios (campo nullable). R4 fue 2 piezas de código +
  verificación de lo demás. Deuda de R3 cerrada: `wizard-herencia.spec.ts` corrido en real
  (13/13). Migración indolora verificada (603 tests e2e + 32 Jest frontend + 13/13
  Playwright real). Ver «Búsqueda y ficha producto/servicio — RÁFAGA 4» en §2.
- **R5 — Verificación integral.** ✅ **CERRADA.** No repitió las baterías de R1-R4 —
  verificó las **costuras**: 2 specs Playwright nuevos (`admin-categorias-tipo.spec.ts`,
  `producto-servicio-flujo.spec.ts`) cubriendo 6 flujos transversales reales (UI admin ↔
  backend, herencia en flujo real, transiciones sin residuo, `appliesTo`+`dependsOn`
  compuestos en el wizard, facetas+vínculos+Meilisearch). Encontró y corrigió un bug real
  (no la deuda de validación débil, que sigue diferida): `validateAttributes`/
  `validateLinkedSelects` no filtraban por tipo antes de exigir `required`, rechazando
  siempre los anuncios del tipo contrario en categorías con un `required` restringido por
  `appliesTo`. Ver «Verificación integral producto/servicio — RÁFAGA 5» en §2.

**El cambio producto/servicio queda cerrado.** Próximo trabajo relacionado (fuera de este
cambio): el refuerzo de la validación débil de `attributes` (`validateAttributes` solo
comprueba `required`, no tipo/opciones/claves desconocidas) sigue diferido como mejora
ortogonal — ver «Validación débil de atributos» en §3.

---

## Sistema de Alertas — cerrado (B0-B3)

**✅ CERRADO** (2026-07-09). Las 4 ráfagas (B0-B3) están completas y verificadas de punta a
punta: el comprador guarda una búsqueda como alerta, y al publicarse/aprobarse/restaurarse/
renovarse un anuncio que encaja, recibe una notificación in-app + email automáticamente, sin
carreras y sin ruido de re-notificación.

**Objetivo:** cerrar el círculo comprador — hoy un comprador solo puede volver manualmente a
`/busqueda` para ver si hay algo nuevo. Una alerta invierte eso: guarda los criterios una vez
y el sistema avisa cuando aparece un anuncio que encaja.

**Estado del terreno** (del mapa hecho antes de diseñar B0): tres caminos llevan un `Listing`
a `ACTIVE` (`publish`, `approveListing`, `restoreListing`), cada uno con su propio reindexado
duplicado; no existía canal de notificación in-app; `SearchService.search()` ya era reutilizable
para "¿qué encaja con estos criterios?"; el patrón de email (`QUEUE_NOTIFICATIONS`,
`NOTIFICATION_JOB`) ya existía para verificación/reset.

**Plan de ráfagas — B0-B3 CERRADAS:**

- **B0 — Saneamiento previo (hook único).** ✅ **CERRADA.** Los 2 reindexados duplicados
  (`ListingsService.invalidateAndReindex` / `ModerationService.invalidateAndIndex`, idénticos
  byte a byte) se consolidaron en `ListingActivationService.listingBecameActive(slug, listingId)`
  — nuevo módulo neutral, importado por `ListingsModule` y `ModerationModule` sin dependencia
  circular (la relación existente Listings→Moderation no cambia). Es el único punto que las 3
  transiciones a ACTIVE llaman; las transiciones en sí (ownership, guards, badword/límite,
  AuditLog) se dejaron intactas — unificar solo el reindexado, no las transiciones (habría sido
  abstracción prematura con ramas por caller). **Hallazgo aparcado para B3**: `renew()` también
  lleva un anuncio a ACTIVE y no estaba en los "3 caminos" originales — resuelto en B3 una vez
  la deduplicación lo hizo seguro. Migración indolora (630/630 tests e2e).
- **B1 — Canal de notificaciones in-app.** ✅ **CERRADA.** Infraestructura nueva desde cero
  (molde `Favorite`): modelo `Notification` (`type: String` — mismo patrón que `AuditLog.action`,
  no enum, para tipos futuros sin migración; `data: Json` = **snapshot autocontenido**, no
  punteros — sobrevive aunque el anuncio o la alerta se borren después). `GET /notifications`
  paginado, `GET /notifications/unread-count`, `POST /notifications/:id/read` (idempotente,
  `updateMany` scoped por `userId` — nunca confía en el `:id` solo, evita IDOR), `POST
  /notifications/read-all`. `createNotification(userId, type, data)` sin cola ni efectos
  secundarios, listo para que B3 lo invoque. **Hallazgo real de UI**: el `Header` público era
  estático (siempre "Iniciar sesión", sin reflejar sesión) y no existía ningún dropdown en el
  proyecto — se instaló `@radix-ui/react-dropdown-menu` y el `Header` pasó a ser
  session-aware. Verificado con el test crítico de Playwright (login anónimo + navegación
  logueada) además de 41 suites e2e / 630 tests backend.
- **B2 — Modelo `Alert` + creación.** ✅ **CERRADA.** Columnas core (`q`, `categorySlug`,
  `type`, `condition`, `priceType`, `minPrice`/`maxPrice`, `province`, `city`,
  `lat`/`lng`/`radiusMeters`) + `attributes Json` — **no** un blob `SearchParams` completo,
  decisión simétrica a la de `Notification` pero en sentido contrario: aquí el conjunto de
  criterios es estable (no crece con tipos nuevos) y sí se necesita consultar por columna (B3
  pre-filtra con SQL). `alertToSearchParams(alert)` reconstruye `SearchParams` desde una
  alerta — la misma función que usa el preview de creación y, luego, el matching de B3.
  Coacción de tipos de `attributes` al persistir (reutiliza `coerceAttributeValue`, exportado
  de `search-query.parser.ts`) para que lo guardado y lo que Meili filtra nunca diverjan en
  tipo. `POST /alerts` crea y devuelve `{alert, matches}` en una sola llamada (preview
  inmediato). Creación desde `/busqueda`: el botón lee `alertCriteria` ya calculado por el
  server component, sin re-parsear la URL. Todo scoped por `(id, userId)`. Migración indolora
  (43 suites e2e / 656 tests).
- **B3 — Matching inverso (el corazón de la feature).** ✅ **CERRADA.** Ver detalle completo
  más abajo.

### B3 — Matching inverso: arquitectura de 2 fases

**Fase 1 (SQL, candidatas)**: al confirmarse la indexación de un anuncio, `AlertMatchingService`
relee el listing y consulta `Alert.findMany({ active: true, AND: [...] })` con un `OR
[campo=null, campo=valor-del-listing]` por cada columna core (`categorySlug`, `type`,
`condition`, `priceType`, `minPrice≤precio`, `maxPrice≥precio`, `province`, `city`).
Deliberadamente **no** filtra `attributes`/`q`/geo en SQL — sobre-aproximación segura, nunca
excluye un match real; solo reduce "todas las alertas activas" a "las plausibles".

**Fase 2 (Meilisearch, confirmación — ruta A)**: por cada candidata,
`search({...alertToSearchParams(alert), listingId, hitsPerPage:1})` — si el anuncio aparece,
el match es real, con la MISMA semántica (atributos, geo-radio, tolerancia) que una búsqueda
de verdad. Evita reimplementar el filtrado en JS ("el espejo divergente").

**Sin carrera (hook encadenado, no paralelo)**: `listingBecameActive()` pasa
`triggerAlertMatch: true` en el payload del job `'index'` (no un segundo job en paralelo).
`IndexingProcessor`, tras confirmar `waitForTask` y releer `listing.status === 'ACTIVE'`
fresco de Postgres, **solo entonces** encola `'match-alerts'` en la cola dedicada
`QUEUE_ALERT_MATCHING`. El matching arranca con Meili ya poblado, por construcción — mismo
principio que `handleGeocode` ya aplicaba (encadenar en el mismo job, no encolar en paralelo).

**Deduplicación**: tabla `AlertMatch` (`@@unique([alertId, listingId])`). Antes de notificar,
`prisma.alertMatch.create()` — si P2002 (ya existe), se salta. Doble función: evita ruido
(un `renew()` no re-notifica lo ya notificado) y hace el job **idempotente frente a
reintentos de BullMQ** (necesario ahora que `QUEUE_ALERT_MATCHING` tiene retry). Misma
decisión arquitectónica que `Alert` (columnas, no Json) aplicada por tercera vez: se necesita
consultar/insertar por `(alertId, listingId)` con índice único.

**`renew()` dispara matching**: habilitado por la dedup — un anuncio EXPIRED que vuelve a
ACTIVE no re-notifica a quien ya lo vio, pero sí notifica a alertas creadas *después* de la
publicación original. `renew()` pasó de llamar al wrapper genérico a llamar
`activation.listingBecameActive()` directamente, igual que `publish()` — cierra el hallazgo
aparcado en B0. `reserve()`/`markAsSold()` siguen sin disparar matching (no llevan el anuncio
a ACTIVE).

**Moderación**: confirmado sin cambios — `PENDING_REVIEW` nunca dispara nada; `approveListing()`
sí, al llamar al mismo hook.

**Hallazgo real (no solo de B3): retry de cola "roto" entre módulos.** Cada módulo que llama
`BullModule.registerQueue({name})` crea su **propia** instancia `Queue` (productor) — el
`defaultJobOptions` declarado en `queue.module.ts` nunca llegaba a un productor que vive en
otro módulo. Esto significa que el retry de `QUEUE_NOTIFICATIONS` para
`SEND_VERIFICATION_EMAIL`/`SEND_RESET_EMAIL` (`AuthService`, registrado en `AuthModule`)
**nunca estuvo realmente activo**, pese a que `queue.module.ts` lo declaraba — un bug
preexistente a B3, descubierto al escribir el test "retry de `QUEUE_NOTIFICATIONS` presente"
para `AlertMatchingService`. Fix inicial: `RETRY_JOB_OPTIONS` centralizado en
`queue.constants.ts`, repetido explícitamente en cada `registerQueue()` real (`AuthModule`,
`AlertsModule`, `queue.module.ts`).

**Deuda "retry fantasma de QUEUE_INDEXING" — CERRADA (ráfaga aparte).** Confirmado en
ejecución (no solo por inspección) el mismo patrón, y con alcance mayor del previsto:

- `QUEUE_INDEXING` sin `defaultJobOptions` en **7** módulos (no 6): `ListingsModule`,
  `ModerationModule`, `AdminModule`, `CouponsModule`, `ExpirationModule`,
  `ListingActivationModule` **y `BillingModule`** (este último no estaba en la lista original
  de la deuda).
- `QUEUE_BILLING` — hallazgo nuevo: `BillingModule` se re-registraba **a sí mismo** sin
  `defaultJobOptions`, tapando el retry ya declarado en `queue.module.ts` — mismo patrón
  exacto, dentro del propio módulo que lo sufre.
- `QUEUE_REDSYS` — sin retry en ningún sitio (`RedsysModule` es su único registro; ni
  siquiera está en `queue.module.ts`). Especialmente grave: `RedsysProcessor.handleFeaturedPay()`
  tiene un comentario explícito ("Transaction stays PENDING on failure so BullMQ can retry")
  que **asumía** un retry que nunca existió.
- `QUEUE_IMAGE` — sin retry en ningún sitio, tampoco en el registro central de
  `queue.module.ts`. Los tres procesadores (`RedsysProcessor`, `ImageProcessor`,
  `IndexingProcessor`) son idempotentes (upserts, checks de estado antes de escribir,
  overwrite de la misma key en R2), así que el retry es seguro en los tres.

**Fix**: helper `retryQueue(name)` en `queue.constants.ts` (envuelve
`{ name, defaultJobOptions: RETRY_JOB_OPTIONS }`), aplicado en **todos** los `registerQueue()`
reales del backend — los 7 de `QUEUE_INDEXING`, `QUEUE_BILLING` (2 sitios), `QUEUE_REDSYS`,
`QUEUE_IMAGE` (2 sitios) y, por consistencia, también los ya arreglados de
`QUEUE_NOTIFICATIONS` (`AuthModule`, `AlertsModule`, `ContactModule`, `queue.module.ts`).

**Guard estructural** (el proyecto prefiere esto a una convención humana):
`test/queue-retry.e2e-spec.ts` escanea todos los `*.module.ts` de `src/` y falla si alguno
llama `registerQueue({ name: ... })` a pelo, saltándose el helper — un módulo nuevo no puede
reintroducir el bug en silencio.

**Verificado ejerciendo un fallo real, no solo por inspección** (la deuda lo pedía
explícitamente): el mismo spec (a) lee la instancia de `Queue` real inyectada en cada
servicio/guard productor (`ListingsService.indexingQueue`, `StripeWebhookGuard.billingQueue`,
`RedsysWebhookGuard.redsysQueue`, `MediaService.imageQueue`, etc. — 12 casos) y confirma
`attempts:3` + backoff exponencial; se comprobó a mano que este test **falla** si se revierte
el fix en cualquiera de esos módulos (sanity check deshaciendo temporalmente el de
`ListingsModule`); y (b) publica un anuncio de verdad, fuerza que
`SearchService.indexListing()` falle en el primer intento (mock lanzando una vez), y confirma
que BullMQ reintenta y el anuncio **sí** acaba apareciendo en Meilisearch — el síntoma real
del bug (anuncio ACTIVE invisible en búsqueda, en silencio) no se reproduce.

**Verificado (19 tests e2e nuevos en `alert-matching.e2e-spec.ts` + suite completa)**: Fase 1
(categoría null/coincide/distinta, precio fuera de rango), Fase 2 (atributo y geo confirmados
o descartados exactamente por Meili, no por SQL), dedup (reintento del job no duplica),
`renew()` notifica solo a alertas nuevas sin re-notificar las ya vistas, `reserve`/`markAsSold`
nunca disparan matching, moderación (`PENDING_REVIEW` no dispara, `approveListing` sí), flujo
completo real por HTTP (crear alerta → publicar → notificación in-app + email encolado, sin
llamar a `matchListing()` directamente — prueba la cadena async real, no solo la lógica).
Migración indolora: **44 suites e2e / 675 tests backend**, 53 tests frontend, Playwright
crítico (login → publicar → buscar → contactar) en verde.

### Monetización configurable: costes en créditos + precios en euros de Redsys (CERRADO)

**Alcance decidido con el usuario**: costes en créditos (bump, destacado) + precios en
euros de Redsys (packs de créditos, destacado por tarjeta), editables desde
`/admin/ajustes → Monetización`, sin tocar código. **Stripe queda fuera**: sus `Price`
son inmutables en Stripe, cambiarlos exige crear objetos nuevos vía API y decidir el
grandfathering de suscriptores — se deja como otra ráfaga. Reforzado en el backend, no
solo por omisión en la UI: `AdminBillingService.updatePrice()` rechaza con 400 cualquier
`Price` con `interval != null` (Plan Pro recurrente).

**Lo que ya existía y no se tocó**: los costes en créditos de bump/destacado ya eran
`Setting` (JSON en Postgres, leídos en vivo, **sin caché** — confirmado, ni Redis ni
`unstable_cache` del frontend tocan `Setting` ni el catálogo de `Price`), pero no estaban
en la whitelist `SETTING_KEYS` de [`admin.service.ts`](#settings-whitelist-explícita-en-el-service-fase-7)
ni en la UI — en la práctica solo editables con un `UPDATE` manual en Postgres. Se
añadieron `bumpCreditCost`, `featuredCreditCost7d/14d/30d` a la whitelist, con validación
de entero ≥ 1 (0 no se permite: las promociones ya tienen su propio mecanismo,
`CampaignService`, un coste en 0 desde ajustes sería una vía paralela confusa). La
escritura de `Setting` se envolvió en `$transaction` (antes no era atómica con el
`AuditLog`, a diferencia del resto de mutaciones sensibles).

**Precios en euros**: `Price.amount` (packs de créditos y destacado por tarjeta) y
`CreditPack.creditAmount` pasan a ser editables vía dos endpoints nuevos en
`AdminBillingService`/`AdminBillingController` — `GET /admin/billing/prices` (lista los
`Price` con `durationDays != null` o `creditPackId != null`, excluyendo de raíz los
recurrentes de Stripe) y `PATCH /admin/billing/prices/:id` /
`PATCH /admin/billing/credit-packs/:id`. Mismo molde atómico que `grantCredits`
(`$transaction` con `AuditLog` dentro, acciones `PRICE_UPDATE`/`CREDIT_PACK_UPDATE`).
`Price.durationDays` **NO** es editable — los Setting `featuredCreditCost7d/14d/30d`
usan el número de días como parte del nombre de la clave; cambiar la duración de un tier
desincronizaría el nombre del coste asociado sin un rediseño de esas claves, así que se
dejó fuera de alcance deliberadamente.

**El histórico**: verificado que `Transaction.amountGross/amountNet/taxAmount/taxRate`
se congelan en el checkout (`redsysTaxBreakdown(price.amount)` en
`RedsysService.createCreditPackCheckout`/`createFeaturedPayCheckout`) y ningún punto de
lectura (transacciones del usuario, panel admin, validación del webhook) vuelve a leer
`Price` — todos muestran lo que de verdad se guardó. Confirmado con un test e2e que sube
el precio después de una compra `SUCCEEDED` y comprueba que esa `Transaction` no cambia.

**Bug cerrado (encontrado en la investigación, no reportado antes)**: al confirmar la
compra de un pack, `RedsysProcessor.processSuccess()` leía `CreditPack.creditAmount` **en
vivo** en el momento en que Redsys confirmaba el pago, a diferencia de
`bonusCreditAmount`/`campaignBonusAmount`, que sí se congelan en el checkout. Era
inofensivo mientras nadie podía editar `creditAmount` — pero esta ráfaga lo hace
editable, así que un admin subiendo los créditos de un pack entre el checkout y la
confirmación del pago habría alterado silenciosamente lo que esa compra concreta otorga.
Cerrado añadiendo `Transaction.baseCreditAmount Int?` (migración
`transaction_base_credit_amount`), congelado en `createCreditPackCheckout` igual que los
bonus, y leído por el processor con `transaction.baseCreditAmount ?? creditPack.creditAmount`
— el fallback cubre únicamente `Transaction` `PENDING` creadas antes de desplegar la
migración, es transitorio.

**Verificado**: `test/admin-pricing.e2e-spec.ts` (13 tests) — cambio de coste en créditos
aplica al siguiente `bump()`; cambio de precio/créditos de un pack aplica al siguiente
checkout (importe firmado a Redsys y créditos otorgados); **el test que importa**: una
`Transaction` ya `SUCCEEDED` con el precio viejo no cambia tras subir el precio, ni su
`CreditLedger` asociado; validación de mínimos (≤ 0 → 400); guard de precios de Stripe;
`AuditLog` con `before`/`after` en cada cambio. Aislamiento: como `Setting`/`Price`/
`CreditPack` son datos estáticos globales que `cleanDb()` no trunca (se comparten entre
todos los ficheros e2e de la misma pasada `--runInBand`), el spec crea su propio
`Product`/`Price`/`CreditPack` dedicados en vez de mutar los sembrados (p. ej. "Pack
Básico", del que dependen los specs de Redsys con su valor original), y restaura
`bumpCreditCost` en `afterAll`. Suite completa verde tras el cambio.

### Monetización — ráfaga 1: huecos de coherencia + verificación + claridad de coste (CERRADO)

Punto de partida: auditoría completa de monetización (2026-07-15) que construyó la matriz
precio/coste/créditos/duración de packs, destacado y bump para Pro vs. no-Pro, verificando cada
celda ejecutando (no deduciendo del código) contra las 8 suites e2e relevantes. La auditoría no
encontró ningún caso de "Pro paga más que no-Pro" ni ningún coste leyendo un valor hardcodeado, y
confirmó que gran parte de lo que esta ráfaga se proponía cerrar **ya estaba hecho** por ráfagas
previas (H8.1 dejó `proMonthlyFeaturedQuota`/`proQuotaFeaturedDurationDays`/límites de anuncios
activos editables desde `/admin/ajustes`; RF.10 §2.5 ya congelaba el bonus Pro en `Transaction.
bonusCreditAmount`, verificado en `redsys.e2e-spec.ts`). El trabajo real de esta ráfaga fue más
acotado de lo previsto:

- **Hueco de coherencia cerrado**: `proExtraCreditsPercent` (el bonus de créditos Pro, §2.5) era
  la única Setting de monetización fuera de la whitelist de `admin.service.ts` — solo editable con
  un `UPDATE` manual en Postgres, a diferencia de sus hermanas (`bumpCreditCost`,
  `featuredCreditCost*d`). Añadida a `SETTING_KEYS`, con una nueva categoría de validación
  `PERCENT_SETTING_KEYS` (entero en `[0,100]`; 0 es válido y desactiva el bonus sin quitar la
  ventaja de la whitelist; >100 se rechaza porque regalaría más créditos de los que cuesta el pack).
  Editor nuevo en `/admin/ajustes` (`NumberSettingEditor` con `suffix="%"` y `max`), agrupado junto
  a las otras dos Settings de Plan Pro.
- **Huecos de verificación cerrados** (caracterización, no cambio de comportamiento):
  - `admin-pricing.e2e-spec.ts`, describe `'Bonus Pro configurable (proExtraCreditsPercent)'`:
    admin-editable + `AuditLog` + validación (negativo/>100/decimal → 400, 0 → 200), y el test que
    importa (mismo patrón que el resto del fichero): un checkout de pack ya hecho por un Pro no
    cambia su `bonusCreditAmount` si el admin sube el % **después** del checkout pero **antes** de
    que Redsys confirme el pago — el `RedsysProcessor` solo lee lo ya congelado.
  - `h8-featured-quota.e2e-spec.ts`: test de caracterización "alta día 1 vs alta día 15 del mismo
    mes calendario → misma cuota completa (4), sin prorrateo" — blinda el comportamiento ya
    documentado (`Subscription.currentPeriodStart` = instante de alta, no día de calendario) contra
    una regresión futura que introdujera prorrateo sin querer.
- **Claridad de coste**: la investigación encontró que `DestacadoDialog` ya mostraba con claridad
  la cuota disponible, el coste en créditos y en euros por cada opción (implementado en H8.5b) — no
  hizo falta rediseñarlo. Se añadió solo una nota ("El descuento aplica solo al pagar con
  créditos") cuando hay un descuento de campaña activo, para que el usuario entienda la asimetría
  sin tener que leer este documento. **Hueco real encontrado en QA en vivo** (con capturas Playwright
  contra la app corriendo, tres usuarios: Pro con cuota, Pro con cuota agotada, no-Pro): el botón
  "Bump" de `MyListingCard` no mostraba coste alguno salvo que hubiera un descuento de campaña
  activo — un bump normal decía literalmente "Bump", sin créditos. Corregido para mostrar siempre
  `bumpCreditCost` (ya venía en `BumpPricing`, solo no se renderizaba en el caso sin descuento).
- **Decisiones documentadas como tales** (no cambiadas): añadidas tres filas nuevas a la tabla de
  §15 de `diseno-facturacion.md` — cuota Pro con duración fija que ignora el `priceId` adjunto (es
  un regalo acotado, no un vale canjeable por más duración), descuentos de campaña solo sobre
  créditos y nunca sobre Redsys directo (motivo fiscal: el cobro por Redsys es un hecho imponible,
  los créditos no), y la gracia asimétrica al expirar Pro (cuota sin gracia, anuncios activos con 7
  días — dos mecanismos con distinta urgencia, no una inconsistencia).
- Fuera de esta ráfaga (explícitamente diferido a otra): pago con tarjeta para bump, cupones de
  bump, bumps gratis para Pro.

**Verificado**: batería e2e completa — 61 suites / 927 tests en verde (`--runInBand`), incluidos
los 2 ficheros nuevos/ampliados de esta ráfaga. QA en vivo con capturas de pantalla reales
(Playwright headless) para los tres estados de usuario en `/mis-anuncios` (destacar y bump) y para
el editor nuevo en `/admin/ajustes` (validación de rango + guardado real).

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

# Backfill de navegación del footer (solo one-off, ver migración en dos pasos en §3)
pnpm --filter @marketplace/api footer-backfill

# Sembrar contenido de ejemplo con los 9 tipos de bloque, para QA visual
pnpm --filter @marketplace/api seed-blocks-demo
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
