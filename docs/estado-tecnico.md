# Estado técnico del proyecto — Marketplace

> Fecha: 2026-08-09 · Rama: `main` · Último commit: 842ea24 — cierre del vídeo Pro.
>
> **Tres proyectos cerrados desde el ancla anterior** (2026-08-04, `ff333ab`): la **zona de
> gestión del vendedor** (UXV.1–UXV.6, documentada en sus propias secciones más abajo, más la
> ráfaga `fix-planes`), el **bump automático** y el **vídeo Pro**. Los dos últimos son features
> nuevas de punta a punta —modelo, backend y superficies— y tienen sección propia al final del
> §2. La zona de vendedor ya se iba documentando ráfaga a ráfaga, así que aquí solo se añadió lo
> que faltaba.
> Plan vigente: `docs/Hoja_de_ruta_rafagas_Hito5-9.docx` (Hitos 5–9). Hitos 5–8 cerrados (incluye el
> bloque de blog — rol EDITOR, editor de markdown, páginas informativas, footer — y el Hito 8
> ampliado completo: H8.1–H8.6 + Bloques C/D/E). **Hito 9: la fase 9.3 (deuda transversal) está
> arrancada por partes** — CORS del gateway restringido a `APP_URL`, AuditLog atómico (RF.12b),
> reintento de slug ante P2002, reintentos del job `geocode` y Playwright corriendo en CI ya están
> cerrados, igual que **la saga del CI** (ver «🏁 La saga del CI — estado final» más abajo: corrida
> `30930395538`, SHA `e4df671`, `conclusion=success` en los dos jobs del runner — 1476/1476 backend,
> 378/378 unit web, 247 Playwright de señal sin fallos). **Las fases 9.1 (navegación) y 9.2
> (interfaz y estilo) no se han empezado**, y quedan abiertos varios ítems de 9.3 (`app.enableCors()`
> sin argumentos, `allowedDevOrigins`, paginación de home/categorías, preparación de producción).
> **La lista viva y accionable de todo lo que queda por construir está en `docs/pendientes.md`.**
> **RC.1+RC.2 — Formulario de contacto público cerrado** (ver
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
| **InvoicingModule (RF.13)** | ✅ Completo a nivel de PLATAFORMA (R1–R5) · **falta conectar un proveedor homologado real** (usa StubInvoicingProvider = NO VÁLIDO FISCALMENTE) | **EMISIÓN de facturas fiscales — capa SEPARADA de cobros.** La emisión VÁLIDA se DELEGA en un proveedor homologado externo (aún sin elegir) tras el puerto `InvoicingProvider`; el sistema NO afirma conformidad fiscal por sí mismo. **R1 (modelo)**: campos fiscales en `User` (`fiscalTaxId/fiscalName/fiscalEntityType/fiscalAddress/…`, congelables), `Setting fiscalIssuer` (emisor), modelos `Invoice` (append-only) + `InvoiceLine` (relación 1:N con `Transaction` vía `InvoiceLine.transactionId @unique` = guard duro anti-doble-facturación; `Invoice.idempotencyKey @unique` = guard de la emisión automática); validador de formato NIF/DNI/NIE/CIF (`common/validators/spanish-tax-id.ts`) en back y front; formulario `/perfil/facturacion`. **R2 (puerto + stub + inmutabilidad)**: interfaz `InvoicingProvider.emitInvoice(input) → { number, pdf, verifactu, providerRef }` con token DI `INVOICING_PROVIDER` (seleccionado por `config invoicing.provider` / env `INVOICING_PROVIDER`, hoy solo `stub`). `StubInvoicingProvider` — **NO emite facturas válidas**: número de prueba `DEV-YYYY-NNNNNN` (contador local), PDF (pdf-lib, dependencia nueva) sellado «NO VÁLIDO FISCALMENTE», verifactu ficticio, idempotente por `idempotencyKey`. **Guard de INMUTABILIDAD a nivel de BD** (migración `20260727000001_invoice_immutability_guard`): triggers Postgres que RECHAZAN cualquier UPDATE/DELETE de una `Invoice` ISSUED y cualquier INSERT/UPDATE/DELETE de sus `InvoiceLine` (solo se permite el latch DRAFT→ISSUED). Ejercido con SQL directo en `test/invoice-immutability.e2e-spec.ts` (incluye sanity-check desactivando el trigger). **R3 (elegibilidad + emisión manual)**: `InvoicingService` + `InvoicingController` (bajo `/billing`, owner-scoped). `getFacturables` = Transactions `SUCCEEDED`, gateway plataforma (STRIPE/REDSYS), **sin `InvoiceLine`** (relación `invoiceLine: { is: null }`), dentro de la **ventana** (`Setting fiscalSelfServiceWindow`, meses, default 6 provisional — plazo exacto pendiente del asesor), con **concepto derivado** (subscriptionId→Pro, baseCreditAmount→pack créditos, baseBumpAmount→pack bumps, listingId→destacado, si no `Price.product.name`). `getEligibility` = datos fiscales completos + ≥1 facturable (con motivo si false). `requestInvoice` (`POST /billing/facturas`): valida elegibilidad → crea `Invoice` DRAFT **congelando** emisor (`Setting fiscalIssuer`) + receptor (User fiscal) + totales + líneas (snapshot) → `provider.emitInvoice(idempotencyKey=invoice.id)` → **PDF a R2 PRIVADO** (`facturas/<id>.pdf`) → latch DRAFT→ISSUED. Manual usa `idempotencyKey` null (el guard real es `InvoiceLine.transactionId @unique`; el cron de R4 usará `userId:periodKey`); doble-submit concurrente → P2002 → devuelve la existente; secuencial → 409 (nada facturable). Si el proveedor/R2 fallan, se **borra el DRAFT** (no-ISSUED → el trigger permite DELETE) liberando las Transactions. Endpoints: `GET /billing/facturables`, `GET /billing/eligibility`, `POST /billing/facturas`, `GET /billing/my-invoices`, `GET /billing/invoices/:id/pdf` (descarga **autenticada** vía `StreamableFile` + `R2.download`, solo el dueño → 403 si no). Front: `/perfil/facturacion` muestra facturables + "Solicitar factura" + lista de facturas con descarga (blob con token). **Verificado e2e** (`test/invoicing-manual.e2e-spec.ts`): flujo completo (facturables→ISSUED N líneas→facturados), idempotencia (2º POST no duplica), sin datos fiscales→400, sin facturables→409, descarga dueño 200 / ajeno 403, **congelación** (cambiar NIF tras emitir no altera la factura). **R4 (cron automático + cola idempotente)**: `InvoicingScheduleService` — `@Cron('0 4 * * *')` fino → `runScheduledInvoicing(today)` público/testeable (molde `entitlement-expiration`). **OPCIÓN A** (confirmada con el asesor: periodicidad TRIMESTRAL, configurable en caliente vía `Setting fiscalInvoicingPeriodicity`, también soporta MONTHLY): el cron se despierta A DIARIO y, en vez de "¿hoy es día 1?", pregunta "¿hay periodos cerrados sin facturar?" comparando la marca `Setting fiscalInvoicingLastPeriod` con el periodo cerrado más reciente (`period.ts`: `previousClosedPeriodKey`/`periodsToProcess`) → **RECUPERACIÓN**: si el servidor estuvo caído en uno o varios cierres, al arrancar detecta y emite todos los pendientes en orden. Para cada periodo pendiente selecciona usuarios con facturables de ese rango (`periodRange`); los elegibles (datos fiscales completos, helper `hasCompleteFiscalData`) → **encola** un job `emit-period {userId, periodKey}` en `QUEUE_INVOICING` (`retryQueue`, `jobId` estable); los que tienen movimientos pero **sin datos fiscales** → aviso in-app `INVOICING_PENDING_FISCAL_DATA` (sus Transactions siguen facturables para emisión manual R3 — BORDE si la ventana cierra sin datos: decisión de negocio, marcada). Trabajo pesado NUNCA inline. `InvoiceProcessor` (`WorkerHost`) invoca `InvoicingService.emitForPeriod(userId, periodKey)` — reutiliza el núcleo `emitInvoiceCore` de R3. **Idempotencia triple** (documentos fiscales): (1) `idempotencyKey=userId:periodKey` @unique → job reintentado no duplica, corta si ya ISSUED; (2) `InvoiceLine.transactionId` @unique; (3) `idempotencyKey=invoice.id` al proveedor. Fallo proveedor/R2 → rollback del DRAFT (libera Transactions) → el job reintenta (retryQueue). **Verificado**: `period.spec.ts` (decisión pura: día-emisión/no-toca/recuperación mono y multi-periodo/config MONTHLY) + `test/invoicing-cron.e2e-spec.ts` (chain cron→cola→processor→factura; día que no toca; recuperación; idempotencia doble disparo y nivel emisión; sin datos fiscales→notifica+no factura; configurable MONTHLY; rollback en fallo del proveedor con reintento, app con provider sobrescrito). **R5 (panel admin)**: `AdminInvoicingController` (`@Controller('admin')`, `@Roles(ADMIN)` + `RolesGuard`) + `AdminInvoicingService`. `GET /admin/invoices` (paginado; filtros status/origin/periodKey/userId/userQuery email-nombre/rango issuedAt; orden issuedAt desc) — TODAS las facturas de TODOS los usuarios. `GET /admin/invoices/:id` (detalle con líneas + emisor/receptor congelados + verifactu/providerRef). `GET /admin/invoices/:id/pdf` (descarga admin de CUALQUIER factura vía `StreamableFile` — contraste con el owner-scope del usuario en R3). **Configuración del emisor**: `GET /admin/fiscal-issuer` (lee `Setting fiscalIssuer`), `PUT /admin/fiscal-issuer` — valida taxId con el mismo validador NIF/CIF + campos obligatorios (400 si inválido/incompleto), guarda el Setting y registra `AuditLog FISCAL_ISSUER_UPDATE` (before/after, dato sensible). **NO retroactivo**: el emisor se congela en cada factura al emitir; cambiarlo solo afecta a las futuras (la UI lo avisa explícitamente). Front: `/admin/facturas` (tabla+filtros+descarga, aviso si el emisor no está configurado) + `/admin/facturas/emisor` (formulario con validación en vivo y aviso de no-retroactividad); entrada "Facturas" en `AdminNav`. **Verificado** (`test/admin-invoicing.e2e-spec.ts`): listado multi-usuario, filtros (origin+periodKey), permisos (USER/MODERATOR→403, sin auth→401), descarga admin de factura ajena→200 (vs. usuario→403), PUT emisor válido→200+Setting+AuditLog / NIF inválido→400 / campo ausente→400, y **NO-RETROACTIVIDAD** (cambiar el emisor no altera las ya emitidas; solo las nuevas). **ÚLTIMO PASO PENDIENTE (fuera de estos hitos, decisión de Ernest con su asesor):** elegir y conectar un **proveedor homologado real** — una clase que implemente `InvoicingProvider` + un `case` en `InvoicingModule` + config de credenciales/env. Hasta entonces el sistema de emisión está COMPLETO a nivel de plataforma pero usa el `StubInvoicingProvider`: los PDF van marcados **NO VÁLIDOS FISCALMENTE** y NO se factura de verdad. |
| **Contact** | ✅ Completo (RC.1+RC.2) | Formulario público de contacto — endpoint sin autenticación, superficie de ataque nueva; **5 defensas** (ver «RC.1 — Formulario de contacto público» en §2). `GET /contacto/token` (token firmado del time-trap), `GET /contacto/motivos` (**RC.2** — motivos activos, ordenados), `POST /contacto` (público; honeypot y time-trap fallidos → `200` silencioso sin persistir; rate limit superado → `429`). Modelos `ContactMessage` (sin columna de IP — decisión RGPD; `motivoId` FK a `ContactReason`) + `ContactReply` (historial 1:N) + **`ContactReason`** (RC.2 — motivo configurable por el admin, sustituye al enum `ContactMotivo`; sin DELETE, solo desactivación). `AdminContactMessagesController` (`@Roles(ADMIN)`, molde de `BannersService`: listado paginado+filtros por estado/motivoId, detalle con auto `NUEVO→LEIDO`, `PATCH :id/estado` **libre entre cualquier par de estados** + AuditLog, `POST :id/responder` — crea `ContactReply`, encola email, `→RESPONDIDO`; sin DELETE). `AdminContactReasonsController` (RC.2 — CRUD + reorder de motivos, guard: no se puede desactivar el último activo). Notifica a los admins por fan-out: una `Notification` `CONTACT_MESSAGE` (segundo tipo de B1, confirma que el modelo era extensible sin migración; snapshot guarda el nombre del motivo ya resuelto) + un email `SEND_CONTACT_NOTIFICATION` por cada `User role=ADMIN`. Ver «RC.2» en §2 para el detalle de la migración enum→datos. |
| **Tickets (atención al usuario)** | ✅ Completo — sin incrementos pendientes | Canal bidireccional usuario↔administración con máquina de estados; **la conversación in-app es la fuente de verdad**, la notificación y el email solo avisan. Modelos `Ticket` / `TicketMessage` / `TicketAttachment` + enums `TicketStatus`/`TicketOrigin`/`TicketAuthorSide` + `ContactReasonScope`; migración `add_ticketing` (aditiva). `TicketsController` (usuario, owner-scoped: crear con enlace validado, listar, topics, hilo con cursor, responder/reabrir, cerrar) + `AdminTicketsController` (`@Roles(MODERATOR, ADMIN)`: bandeja con filtros, take, responder **o nota interna**, resolve, close, reassign, flujo (b) y `from-report/:reportId` para el flujo (c)) + `TicketNotificationsService` (3 tipos de `Notification` + 3 jobs de Resend; fan-out in-app al staff pero **un solo email** a `Setting.supportEmail`) + `TicketsScheduleService` (cron 05:00 de auto-cierre, ventana `Setting.ticketAutoCloseWindowDays` default 14). Los tres flujos: (a) usuario→admin, (b) admin→usuario, (c) desde un `Report` **sin modificarlo**. **INVARIANTE DE PRIVACIDAD**: las notas internas (`TicketMessage.internal`) no salen nunca por ninguna ruta de usuario — **siete superficies** (hilo, contador, DTO, avisos, `lastMessageAt`, adjuntos y el canal de tiempo real), ver «Sistema de atención al usuario (tickets) — ESTADO CONSOLIDADO» en §2, que es la referencia completa y la lista que hereda cualquier canal nuevo. Adjuntos con **molde FACTURA** (R2 privado + descarga autenticada, sin URL pública) y **tiempo real** (salas `ticket:<id>` y `staff` en `MessagingGateway`, con su CORS ya restringido a `APP_URL`). |

| **BumpScheduleModule (bump automático)** | ✅ Completo | Programar bumps que se aplican solos. `BumpScheduleService` = el cron (`@Cron('10 * * * *')`, zona `Europe/Madrid` declarada, reloj inyectado en `runDueSchedules(now)`); `BumpAutoProcessor` = el consumidor de `QUEUE_BUMP_AUTO` que cobra vía `BillingService.bump` y traduce el resultado a política; `BumpScheduleCrudService` + `BumpScheduleController` (`/bump-schedules`, owner-scoped) = la cara de usuario; `BumpAutoNotificationsService` = los avisos de incidencia (in-app + email). `next-run.ts` es una función pura con los dos cambios de hora cubiertos. Ajustes: `bumpAutoEnabled` (sembrado a `true`, interruptor de emergencia) y `maxBumpSchedulesPerUser` (sin sembrar, default 10). Ver «Bump automático» en §2 |
| **VideoModule (vídeo Pro)** | ✅ Completo | Subida de vídeo por el vendedor, **sin que los bytes pasen por la API**: `POST /video/upload-url` valida y firma una URL de subida (`R2Service.presignUpload`), el navegador hace el `PUT` directo al almacenamiento y `POST /video/listings/:id/confirm` comprueba con `HEAD` lo que aterrizó antes de enlazarlo. `GET /video/config` publica límites y el flag. Módulo propio y NO dentro de `MediaModule`: ese es el camino de imágenes, con su `memoryStorage` y su cola de miniaturas, y no se toca. Ajuste `videoEnabled` **sin sembrar en producción = apagada**. Ver «Vídeo Pro» en §2 |

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
| **Mis tickets** `/mis-tickets` (+ `/nuevo`, `/[id]`) | ✅ Completo (R6) | Área de cuenta, owner-scoped. Lista con filtro abiertos/todos, badge de no leídos, motivo y entidad enlazada; alta con motivo (`GET /tickets/topics`, ámbito TICKET/BOTH) y **entidad prefijada por query param** desde el contexto de origen; hilo con burbujas por lado y paginación por cursor (`?before`, molde `ChatClient`). Acciones según §7.2: "Reabrir y responder" solo dentro de la ventana (que **manda el servidor** en `reopenWindowDays`, no cableada), "Ya no lo necesito" solo si `origin=USER`, y aviso "abre uno nuevo" si está cerrado. **Nunca pinta notas internas** — ni las espera. `middleware.ts`: `accountPrefixes` += `/mis-tickets`. |
| **Entradas contextuales a tickets** | ✅ Completo (R6) | Botón "¿Necesitas ayuda?" en `MyListingCard` (`?listingId=`), en cada fila de `FacturasPanel` (`?invoiceId=`) y en `ReviewsSection` (`?reviewId=`) — este último **solo con `esMiPerfil`**, porque es un componente PÚBLICO y ofrecérselo a cualquier visitante sería ofrecer una acción que el backend rechaza con 422. El id del query param es solo una sugerencia: el backend revalida la propiedad al crear. |
| **Admin tickets** `/admin/tickets` (+ `/nuevo`, `/[id]`) | ✅ Completo (R7 + notas internas) | Backoffice client-side. Bandeja con filtros (estado, origen, motivo, agente con centinelas `me`/`none`) y paginación; hilo completo **incluidas las notas internas**, marcadas y diferenciadas visualmente; acciones (tomar, responder, resolver, cerrar, asignármelo) según `resolveStaffActions()` — función pura extraída para poder probar la matriz estado×rol×asignación entera sin clics. `/nuevo` = flujo (b) con el buscador `GET /users/search` **que ya existía**. **Toggle de nota interna** en la caja de respuesta: cambia el destinatario, así que el recuadro cambia de color, el botón de texto e icono, y **se resetea tras cada envío** (un modo pegajoso acaba mandando al usuario lo que era para el equipo). El MODERATOR no ve aquí los tickets con factura: **no se filtra en el cliente**, el backend simplemente no se los lista. `ROLE_ALLOWED_PATHS.MODERATOR` + `AdminNav` (los dos a la vez, o la sección queda inaccesible o invisible). |
| **Admin reportes — flujo (c)** `/admin/reportes` | ✅ Completo (R7) | Botón "Contactar al reportado" por fila → `POST /admin/tickets/from-report/:reportId`; si el reporte ya tiene hilo, se enlaza en vez de ofrecer abrir otro (`Report.tickets`, include de solo lectura). **El `Report` no se modifica**: abrir el hilo no cambia su estado. |

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
  ListingImage, tokens, Post, AuditLog… y **Invoice/InvoiceLine**). `Category` y `Setting`
  quedan **excluidos** — son datos estáticos sembrados una sola vez en `globalSetup` vía
  upsert idempotente. Truncarlos en `cleanDb` provocaría race conditions cuando Jest
  ejecuta suites en paralelo sobre la misma BD. **RF.13 — inmutabilidad de facturas
  (Decisión Opción A, 2026-07-27)**: el `TRUNCATE` de `cleanDb` NO dispara los triggers
  `BEFORE UPDATE/DELETE` que hacen inmutables las `Invoice` ISSUED (los triggers de fila
  no se disparan con TRUNCATE), así que la limpieza funciona aun con facturas ISSUED
  presentes. Esto es coherente con el alcance decidido: la inmutabilidad local cubre las
  **vías-de-aplicación** (UPDATE/DELETE), no TRUNCATE — que exige un superusuario/owner que
  la app NO tiene en producción, y contra quien ningún trigger protege (puede desactivarlo);
  la fuente de verdad fiscal definitiva será el proveedor homologado. Ver el doc-comment del
  modelo `Invoice` en `schema.prisma` (la decisión NO se documenta dentro del `.sql` de la
  migración — ese fichero ya está aplicado y es inmutable por checksum).
- `meili.ts` — `waitForIndex(client, indexName, docId, timeoutMs = 15 000 ms)` y
  `waitForRemoval(client, indexName, docId, timeoutMs = 15 000 ms)`: polling hasta que
  el documento aparece / desaparece en Meilisearch. Necesarios porque la indexación es
  asíncrona (BullMQ worker); sin ellos los tests de búsqueda y de eliminación fallan
  intermitentemente. El timeout de 15 s cubre los service containers de CI, que tardan
  más que el entorno local.

**Batería e2e intermitente — RESUELTA (2026-07-27, causa confirmada):** la batería daba
resultados distintos entre corridas (a veces 0 rojos, a veces 14/28/68), siempre con síntoma
401 en operaciones autenticadas de suites NO relacionadas. **Causa raíz (confirmada, no
asumida):** el login (`auth.service.ts`) aplica un rate limit `INCR`+`EXPIRE` en Redis (db 1
en test) con ventana larga (~15min/1h) por IP/email (`auth:login:ip:*`, etc.). La corrida
serial (`--runInBand`) dura ~140s y hace CIENTOS de logins desde la misma IP (localhost); el
contador se **acumulaba dentro de la corrida** y, como la ventana no expira en 140s, en algún
punto cruzaba el límite → las suites posteriores recibían 401. `flushRedisTestDb()` solo
corría UNA vez, en `globalSetup` (al arrancar), así que no limpiaba esa acumulación
intra-corrida. **Arreglo:** `test/reset-redis-between-suites.ts` registrado en
`setupFilesAfterEnv` (jest-e2e.json) hace `flushRedisTestDb()` en un `beforeAll` de nivel raíz
= **una vez por suite, ANTES de cada archivo**. Así cada suite arranca con el contador limpio
y ninguna hereda la acumulación de las anteriores. El reset es ENTRE suites, nunca entre tests:
dentro de una suite el contador sigue acumulando, para que `auth-security.e2e-spec` pueda
ejercer el límite (el rate limit sigue ACTIVO y probado). Seguro flushear toda la db entre
suites: en el hueco la app anterior ya cerró (workers BullMQ parados) y nada en Redis se
siembra de forma persistente. **Prueba de que murió:** dos corridas seguidas de `test:e2e`
sin tocar nada dan el mismo verde (antes divergían).

**Nota operativa — recrear la BD de test (Postgres):** concern SEPARADO del flake anterior (que
era Redis, ya resuelto). El `seed`/`globalSetup` no limpia Postgres entre corridas (solo
re-upserta `Category`/`Setting`; `cleanDb` corre por-suite). Una corrida interrumpida puede
dejar residuo; para partir de cero de verdad: `DROP DATABASE marketplace_test` + recrearla
(`pnpm --filter @marketplace/api test:setup:db`), y `globalSetup` re-aplica migraciones y
siembra. Ya NO es necesario para el flake de auth (eso lo cubre el reset de Redis por suite).

**Práctica (2026-07-27) — una migración APLICADA es INMUTABLE:** nunca se edita el `.sql`
de una migración ya aplicada, ni siquiera un comentario. Prisma guarda un checksum del
contenido; cualquier cambio (incluido texto de comentario) rompe el checksum y hace fallar
`prisma migrate deploy`/`status` con *"migration modified after applied"* — que a su vez
tumba el `globalSetup` de la batería e2e. La documentación de decisiones de diseño va en
`estado-tecnico.md`, en `schema.prisma` (doc-comments `///`) o en el código del módulo,
**nunca** editando un `.sql` aplicado. (Incidente que originó la regla: se añadió la
decisión Opción A del TRUNCATE dentro de `20260727000001_invoice_immutability_guard/migration.sql`
tras aplicarla; se revirtió el fichero a su estado aplicado con `git checkout HEAD --` y la
decisión se movió al doc-comment del modelo `Invoice`.)

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

`ActiveListingLimitRule` — una regla de la **puerta de validación**
(`apps/api/src/modules/listing-gate/`, diseño en `docs/diseno-puerta-validacion.md`) — consulta
`ProStatusService.isProActive()` para determinar el plan del usuario, lee la clave
`freeActiveListingLimit` o `proActiveListingLimit` de la tabla `Setting` (con valor por defecto
como fallback si la key no existe aún) y cuenta los anuncios ACTIVE del vendedor con
`prisma.listing.count`. Si el conteo ≥ límite, la puerta responde `403` con el número de límite
en el mensaje (para que el frontend pueda mostrarlo sin hardcodear el valor).

**Dónde se aplica.** Ya no la "llama" nadie: la heredan todos los caminos que pasan por la
puerta, es decir, los cuatro de vendedor —`publish()` (solo cuando el estado destino es ACTIVE,
es decir, sin BadWord), `renew()`, `reactivate()` y `undoDeal()`—. Un usuario free con 5 activos
no puede renovar un EXPIRED hasta liberar una plaza: la renovación convierte un EXPIRED en ACTIVE
y cuenta contra el límite igual que una publicación nueva.

**Staff está exento**, y desde la puerta es una decisión declarada (`appliesTo` devuelve `false`
para `actor: 'staff'`) en vez de la ausencia de facto que era antes: `approveListing`,
`restoreListing` y `changeListingStatus` pasan por la puerta pero esta regla no les aplica, para
que el trabajo de moderación no quede rehén de la cuota de un tercero. Tampoco aplica a
`bump`/`featured`, que operan sobre un anuncio que ya está ACTIVE y ya ocupa plaza.

Hasta la ráfaga 1 de la puerta esto vivía en `ListingsService.checkActiveListingLimit()`, un
método **privado**: Moderation y Admin no podían usarlo ni queriendo, y cada camino nuevo tenía
que acordarse de llamarlo. Ese método ya no existe.

Ambos settings son editables desde `PATCH /admin/settings/:key` sin redeploy; el efecto es
inmediato en la siguiente request de publish/renew.

### Correo verificado para publicar (puerta, regla #2) — nace APAGADA, y DEGRADA

`User.emailVerified` existía desde el principio pero **no era puerta en ningún sitio**. Esta regla
lo convierte en condición de **publicación**, y con un desenlace que la puerta no tenía:

- **Degrada, no rechaza.** Al publicar sin el correo verificado el anuncio **se queda en `DRAFT`
  exactamente como estaba** —sin `publishedAt`, sin `expiresAt`, sin un campo tocado— y la respuesta
  es `200` con un campo aditivo `publishBlocked: { code, message }`. No se pierde nada y no hay
  ningún estado a medias que limpiar: la publicación no llega a ocurrir.
- **Sólo al PUBLICAR.** Crear y editar siguen libres: quien se acaba de registrar puede redactar su
  anuncio entero y guardarlo. Renovar, reactivar y las acciones de staff no la miran — un anuncio
  que ya estuvo en el mercado no se retira por esto.
- **Dónde vive la degradación:** en `ListingsService.publish`, no en la puerta. La puerta sigue
  siendo binaria; el camino que sabe degradar reconoce ese motivo con `unicoMotivo()` y sólo cuando
  es el **único** del rechazo. El razonamiento completo está en `docs/diseno-puerta-validacion.md`
  (addendum de la regla #2) y en la cabecera de `publish`.
- **El aviso es accionable** y lo escribe el backend: sale en el wizard de publicación y en la
  tarjeta de «Mis anuncios», inline y con enlace a `/verificar-email`. Cuando el anuncio no se
  publica, el toast de éxito **no** se emite.
- **Nace apagada:** `Setting.emailVerifiedToPublishEnabled`, sin fila = apagada, editable desde el
  backoffice.

### Límite TOTAL de anuncios (puerta, regla #1) — nace APAGADO

Segundo límite, **regla aparte** de la de activos y con universo distinto: cuenta todo lo que el
vendedor todavía «tiene» —`DRAFT`, `PENDING_REVIEW`, `ACTIVE`, `RESERVED`, `PAUSED`, `EXPIRED`,
`REJECTED`— y deja fuera `ARCHIVED` y `SOLD`. El de activos limita el **escaparate**; éste, la
**acumulación**.

- **Topes:** `freeTotalListingLimit` / `proTotalListingLimit`, por defecto **el doble** de los de
  activos (10 y 40). Editables desde el backoffice, con lector real en la regla.
- **Invariante `total > activos`**, comprobada en las dos direcciones al editar cualquiera de las
  cuatro claves (`AdminService.assertLimitesCoherentes`) y también sobre los valores por defecto en
  `listing-limits.spec.ts`. Un total ≤ activos prometería plazas de escaparate imposibles de crear.
- **Cobra al CREAR, no al publicar.** El tope limita cuántos anuncios existen y un `DRAFT` ya
  existe; publicarlo no añade ninguno. Publicar lo frena la otra regla, la de activos.
- **Es un límite de ENTRADA: no marca ni expulsa nada.** Un vendedor por encima del tope conserva
  todo; sólo no puede sumar otro hasta bajar archivando o vendiendo — la salida va escrita en el
  mensaje del rechazo (403, `TOTAL_LIMIT_REACHED`).
- **Staff exento** (`appliesTo`), coherente con la cuota de activos. Hoy es inalcanzable desde HTTP
  —no hay alta de staff— y está fijado en un test unitario, no e2e.
- **Nace apagada:** `Setting.totalListingLimitEnabled`, sin fila = apagada.

Los cuatro topes y la lista de estados que cuentan viven juntos en
`listing-gate/listing-limits.ts`, porque su relación es una invariante.

### `needsRevalidation` — marcar sin expulsar (puerta, ráfaga 2)

Un cambio en el `attributeSchema` de una categoría puede dejar fuera de norma a anuncios ya
publicados sin que su dueño toque nada (renombrar un atributo, exigir uno nuevo, quitar opciones a
un `select`). Hasta esta ráfaga eso era **silencioso**: no pasaba absolutamente nada.

**La política: se MARCA, no se expulsa.** El anuncio sigue `ACTIVE`, sigue en el índice y sigue
siendo editable; lo que gana es un aviso para su dueño en «Mis anuncios» **con los motivos
concretos**, y —cuando la regla esté encendida— un freno en su siguiente transición.

- **El flag.** `Listing.needsRevalidation Boolean @default(false)` + índice. Migración aditiva, sin
  backfill.
- **El marcado.** `PATCH /admin/categories/:id` con `attributeSchema` encola `mark-stale` en
  `QUEUE_REVALIDATION` (cola propia, no la de indexado). El worker recorre **la categoría y toda su
  descendencia** —el schema se hereda— en lotes de 500, revalida con el schema efectivo N y marca a
  los que fallan, excluyendo `ARCHIVED` y `SOLD`.
- **No toca la búsqueda**, y son tres hechos verificados: un `listing.update` nunca reindexa por sí
  solo (el reindexado es siempre un `indexingQueue.add` explícito), el flag no entra en
  `ListingDocument`, y el anuncio sigue `ACTIVE` y por tanto en el índice. Hay un test que lo fija.
- **El freno** lo aplica `AttributeRevalidationRule`, que **nace apagada**
  (`Setting.attributeRevalidationEnabled`, sin fila = apagada, molde `videoEnabled`). Se enciende
  con el número de `pnpm gate-impact-report` delante.
- **La limpieza.** La puerta, al pasar, retira el flag de un anuncio que ya cumple; y editar
  también, porque editar es la vía de salida y por eso **nunca** se frena.

Qué depende de `enabled` y qué no está en la tabla de coherencia de
`docs/diseno-puerta-validacion.md` (addendum de implementación) y en la cabecera de
`RevalidationService`.

**Los tres validadores de atributos son ahora compartidos.** Vivían como `private` de
`ListingsService` y el comando de medición tuvo que replicarlos; están en
`categories/attribute-validation.ts` (fichero puro), junto con `applicableSchemaFor` —el par
«plegar la herencia + filtrar por tipo»—. El alta/edición, la puerta y M2 leen el mismo código; lo
único que cada uno pone es cómo falla (el alta lanza al primer problema con su 422 de siempre, la
puerta devuelve todos los motivos, la medición sólo cuenta).

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
    de la primera», ver «CI verde repetido» más abajo). **Actualización 2026-07-27:** el flush de
    `globalSetup` (una sola vez) NO bastaba — el contador se acumulaba DENTRO de la corrida serial
    (~140s, cientos de logins/IP) y envenenaba suites posteriores con 401. Ahora
    `test/reset-redis-between-suites.ts` (`setupFilesAfterEnv`) hace el flush una vez por SUITE
    (`beforeAll` raíz); ver «Batería e2e intermitente — RESUELTA» en la sección de helpers de test.
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

## Sistema de atención al usuario (tickets) — ESTADO CONSOLIDADO

> **Esta es la referencia de qué hay construido.** Las entradas por ráfaga que siguen
> (R1…notas internas) son el histórico de *cómo* se llegó aquí y por qué se decidió cada
> cosa; esta sección es el *qué*. El diseño aprobado vive en
> `docs/diseno-atencion-usuario.md` — donde diverjan, **manda el código y manda esta
> sección**. Los contratos de endpoint, en `docs/contratos-api.md`.

### Qué es

Canal de comunicación **bidireccional y trazable** entre usuarios y administración, sobre
cualquier tema de gestión: dudas, quejas, cuestiones con anuncios, valoraciones o facturas.

**La conversación in-app es la FUENTE DE VERDAD.** La `Notification` y el email son vías
AUXILIARES: avisan y reenganchan, pero no transportan el hilo ni transicionan nada. El
correo lleva un extracto de ≤140 caracteres y un enlace, y cierra con "no respondas a este
correo" — que además es literal: **no existe email entrante en el proyecto**.

**Los TRES FLUJOS:**

| Flujo | Origen | Cómo se modela |
|---|---|---|
| (a) usuario → admin | `origin = USER` | El usuario abre su ticket. Nace `OPEN`, sin asignar. |
| (b) admin → usuario | `origin = ADMIN` | `POST /admin/tickets`. Nace `WAITING_USER` y asignado al agente. |
| (c) reporte → admin → usuario | `origin = REPORT` | `POST /admin/tickets/from-report/:reportId`. **Se apoya en la moderación existente**: lee el `Report` para resolver al destinatario y lo referencia con `Ticket.reportId`. **`Report` no se modifica** — resolver la denuncia y cerrar el hilo son acciones independientes. |

El flujo (c) no reinventa la cola de denuncias: el *triaje* ya existía y estaba probado; lo
que faltaba era el *canal de comunicación*, que es lo que este sistema aporta.

### Modelo

Migración **`20260729084926_add_ticketing`**, 100% aditiva (3 tablas, 4 enums, 1 columna con
default, relaciones inversas; cero DROP/RENAME/backfill).

- **`Ticket`** — asunto, estado, origen, motivo (`ContactReason`), usuario dueño, quién lo
  abrió, agente asignado, enlaces, `linkedLabel`, `lastMessageAt`, `resolvedAt`,
  `closedAt`/`closedById`.
- **`TicketMessage`** — hilo append-only. `side` **congelado al escribir** (nunca derivado
  de `author.role` al leer), `internal`, acuses `readByUserAt`/`readByStaffAt`.
- **`TicketAttachment`** — ⚠️ **el modelo existe, la funcionalidad NO.** Ver «Lo que no
  está» al final.

Enums: `TicketStatus`, `TicketOrigin`, `TicketAuthorSide`, y `ContactReasonScope`
(`PUBLIC`/`TICKET`/`BOTH`, que reparte la taxonomía única de motivos entre `/contacto` y los
tickets).

**Enlaces polimórficos — patrón A** (FKs nullables, molde `Report`), no `referenceType`+id:
`listingId`/`reviewId`/`invoiceId`/`reportId`, **todos `onDelete: SetNull`** más el snapshot
`linkedLabel`. Borrar el anuncio no puede llevarse por delante el hilo que hablaba de él.

### Máquina de estados — las 11 transiciones, todas con disparador

Guards como **arrays estáticos privados** en `TicketsService` (molde
`ListingsService.ARCHIVABLE_STATUSES`); no se introdujo ninguna abstracción de máquina de
estados, porque el proyecto no tiene ninguna.

| # | Transición | Disparador | Quién |
|---|---|---|---|
| T1 | — → `OPEN` | `POST /tickets` | usuario |
| T1' | — → `WAITING_USER` | `POST /admin/tickets` · `/from-report` | staff (flujos b/c) |
| T2 | `OPEN` → `IN_PROGRESS` | `POST /admin/tickets/:id/take` | staff |
| T3 | `IN_PROGRESS` → `WAITING_USER` | `POST /admin/tickets/:id/messages` | staff |
| T4 | `OPEN` → `WAITING_USER` (+asigna) | idem, sin haber tomado el ticket | staff |
| T5 | `WAITING_USER` → `IN_PROGRESS` | `POST /tickets/:id/messages` | usuario |
| T6 | `OPEN` → `OPEN` | idem (solo mueve `lastMessageAt`) | usuario |
| T7 | `IN_PROGRESS`/`WAITING_USER` → `RESOLVED` | `POST /admin/tickets/:id/resolve` | staff |
| T8 | `RESOLVED` → `IN_PROGRESS` | **responder ES reabrir** (no hay `/reopen`) | usuario |
| T9 | `RESOLVED` → `CLOSED` | **cron diario** `TicketsScheduleService` | sistema |
| T10 | cualquiera vivo → `CLOSED` | `POST /admin/tickets/:id/close` | staff |
| T11 | cualquiera vivo → `CLOSED` | `POST /tickets/:id/close`, solo `origin=USER` | usuario |

**`CLOSED` es irreversible POR CONSTRUCCIÓN**, no por un `if`: no aparece como estado ORIGEN
en ninguno de los cuatro arrays de transición (molde `ListingStatus.ARCHIVED`). Hay un test
de comportamiento que ejerce las seis puertas de salida y otro **estructural** que afirma que
`CLOSED` no está en ninguno de los arrays.

**Auto-cierre (T9).** Cron diario a las 05:00 → `runTicketAutoClose(now)` con la fecha
inyectada (molde `InvoicingScheduleService`). Cierra los `RESOLVED` cuya ventana venció, con
`closedById = null`.
- **Ventana configurable en caliente:** `Setting.ticketAutoCloseWindowDays`, default 14.
  **UN SOLO valor para dos cosas** — el guard de reapertura (T8) y el cron (T9) lo leen del
  mismo punto (`TicketsService.getReopenWindowDays`). No está duplicado: si divergieran
  habría un limbo (un ticket que ya no se puede reabrir pero que nunca se cierra).
- **Frontera inclusiva** (`resolvedAt <= now - ventana`): a los 14 días exactos ya cierra,
  justo cuando el guard de reapertura deja de permitir reabrir. Sin hueco entre ambos.
- **Condición anti-carrera en el propio UPDATE** (`WHERE status = 'RESOLVED'`, molde del
  débito de `Wallet`): entre la query del cron y el UPDATE, el usuario puede haber reabierto
  el ticket, y `assertClosable` no protege de eso porque `IN_PROGRESS` también es cerrable.
- **Idempotencia natural, sin marca de última corrida**: un ticket cerrado deja de casar
  `status = RESOLVED`. El estado de la fila ES la marca.
- Todas las vías de cierre (T9/T10/T11) pasan por el mismo `closeCore()`.

### Autorización

**Usuario — owner-scope.** 403 explícito tras leer (molde `InvoicingService.getInvoicePdf`).
`GET /tickets` filtra siempre por `userId` del JWT; **ninguna ruta acepta un `userId`**.

**Staff — `@Roles(MODERATOR, ADMIN)`**, con **TRES puertas ADMIN-only**. Las dos primeras
dependen del CONTENIDO de la fila, así que el `RolesGuard` no puede decidirlas y viven en el
servicio:

1. **Ticket con `invoiceId` enlazada.** La facturación es ADMIN-only en todo el proyecto. La
   puerta cubre **TODOS los verbos** (ver, responder, tomar, resolver, cerrar, reasignar,
   nota interna), no solo ver/responder: poder cerrar a ciegas lo que no puedes leer sería
   una puerta trasera. Además **no se listan** en la bandeja del MODERATOR.
2. **Reasignar el ticket de OTRO agente.** Un MODERATOR sí puede coger uno sin asignar o
   mover el suyo.
3. **Cambio de rol de usuario** (`PATCH /admin/users/:id/role`) — ya era ADMIN-only, sigue
   siéndolo; regla de oro innegociable.

**El oráculo de ids, bloqueado.** Enlazar una entidad **ajena** y una **inexistente**
devuelven exactamente la misma respuesta (`422 LINKED_ENTITY_NOT_ALLOWED`, mismo cuerpo). Un
404 para lo primero y un 403 para lo segundo habría convertido el campo en un sondeador de
ids ajenos. En el **flujo (b) los enlaces se validan contra el usuario DESTINATARIO**, no
contra el agente: `linkedLabel` se le sirve a él, así que enlazar ahí la factura de un
tercero sería filtrarle un dato ajeno.

### INVARIANTE DE PRIVACIDAD — las SIETE superficies donde se sostiene

`TicketMessage.internal` guarda lo que el equipo escribe **sobre** un usuario. Es el dato más
sensible del sistema y su fuga es el modo de fallo que más caro sale. Las primeras defensas se
construyeron **antes** de que existiera la vía de escritura (precedente: `Listing.phone`), y al
abrirla se **re-verificaron todas con notas creadas por el endpoint real**, no sembradas en BD.

**LEER ESTO ANTES DE AÑADIR CUALQUIER CANAL NUEVO POR EL QUE UN MENSAJE LLEGUE AL USUARIO.**
La lista creció de cinco a siete porque cada ráfaga que abrió una superficie nueva
—adjuntos en R5, tiempo real en R9— tuvo que cerrarla también: la invariante no vive en un
sitio, vive en todos los sitios por los que un `TicketMessage` puede salir. Un canal futuro
(exportar el hilo, un resumen por email, una API pública, un webhook) hereda la obligación.

| # | Superficie | Cómo se sostiene | Desde |
|---|---|---|---|
| 1 | **El hilo** | `getForUser` filtra `internal: false` **en la query** — las notas no llegan ni a memoria. Cubre la paginación con `?before`. | R1 |
| 2 | **El contador de no leídos** | El `_count` filtra `internal`. Si contara, el usuario sabría que el equipo escribió algo que no ve: fuga por canal lateral, no por contenido. | R2 |
| 3 | **El DTO de usuario** | `SendStaffMessageDto extends SendTicketMessageDto`: `internal` vive SOLO en la subclase de staff. Las dos rutas compartían DTO; añadirlo al compartido habría abierto la vía de usuario en el mismo commit. El `forbidNonWhitelisted` global da 400 sin que ningún `if` tenga que acordarse. | notas internas |
| 4 | **Los avisos (in-app y email)** | Una nota interna no dispara ninguno: `userStaffWrote` sale por la puerta al ver `message.internal`. | R4 |
| 5 | **`lastMessageAt`** | Una nota NO lo mueve. Es el campo que el usuario lee como "último movimiento": moverlo mostraría actividad fechada sin mensaje que la explique, y de ahí se deduce la nota. Tampoco transiciona ni asigna el ticket. | notas internas |
| 6 | **Los adjuntos** | El adjunto hereda la privacidad de su mensaje: la descarga de usuario responde **404** (no 403 — un 403 confirmaría que hay algo). | R5 |
| 7 | **El canal de TIEMPO REAL** | `emitTicketMessage` emite la nota **solo** a la sala `staff`, y el `return` corta **antes** de nombrar `ticket:<id>`. Ver abajo. | R9 |

**La séptima merece su propio párrafo, porque cambia el tipo de defensa.** Las seis primeras
son filtros: se pregunta `internal` y se calla. La séptima es **por diseño de salas**: la sala
`ticket:<id>` contiene al usuario y al agente **a la vez**, así que emitir ahí una nota se la
entrega al usuario en la cara — no hay filtro posible después del emit. Por eso el corte va
antes de nombrar la sala, y por eso el agente que está mirando el hilo recibe la nota por la
sala `staff` y no por la del hilo. El único sitio donde se comprueba `internal` es ese `return`;
todo lo demás lo hace la pertenencia a salas, que se decide con el rol leído de la BD al
conectar. Ejercido en `tickets-realtime.e2e-spec.ts` con sockets reales (cuatro casos, incluido
uno que escucha **todos** los eventos del socket del usuario con `onAny` y comprueba que el
texto de la nota no aparece en ninguno).

Guard estructural adicional: `internal: true` con `side: 'USER'` lanza — sería un mensaje del
usuario que el propio usuario no puede ver. Auditoría propia: `TICKET_INTERNAL_NOTE`, no
`TICKET_REPLY`.

**Trazabilidad del cierre:** `closedById` distingue quién cerró — un id de agente (T10), el
del usuario (T11), o **`null` = el sistema** (T9). Por eso la columna es nullable desde R1:
no es un hueco, es el discriminante. **El auto-cierre no escribe `AuditLog`** porque
`AuditLog.actorId` es NOT NULL con FK a `User` y no hay actor humano: habría que inventar
uno, envenenando el registro que sirve para pedir cuentas. Queda un log de resumen por
corrida.

### Avisos auxiliares

**Tres tipos de `Notification`, cero migraciones** (`type` es `String` a propósito):
`TICKET_MESSAGE` y `TICKET_OPENED` al usuario, `TICKET_STAFF_NEW` en fan-out al staff. Los
`data` son snapshots autocontenidos con **nombres ya resueltos**, nunca ids.

**Fan-out in-app SÍ, email NO.** La notificación va a cada agente (`Notification` es `userId`
1:1, no hay buzón de rol); el email va a **UNA** dirección, `Setting.supportEmail` — contraste
deliberado con `ContactService`, que sí manda uno por administrador. **Sin `supportEmail`
configurado se omite SOLO el correo** (con warning); la notificación in-app se crea igual, así
que no se pierde ningún aviso.

Tres jobs de Resend (`SEND_TICKET_MESSAGE`, `SEND_TICKET_STAFF_NOTIFICATION`,
`SEND_TICKET_RESOLVED`), todos `text:` plano, nunca `html:`.

### Frontend

- **Usuario:** `/mis-tickets`, `/mis-tickets/nuevo`, `/mis-tickets/[id]`.
- **Staff:** `/admin/tickets`, `/admin/tickets/nuevo` (flujo b), `/admin/tickets/[id]` (con
  el toggle de nota interna), y el botón de **flujo (c)** en cada fila de `/admin/reportes`.
- **Entradas contextuales** que prefijan la entidad enlazada: `MyListingCard`
  (`?listingId=`), `FacturasPanel` (`?invoiceId=`) y `ReviewsSection` (`?reviewId=`, solo
  con `esMiPerfil` — es un componente público y ofrecérselo a todo visitante sería ofrecer
  una acción que el backend rechaza).
- **Navegación:** `middleware.ts` (`accountPrefixes` += `/mis-tickets`;
  `ROLE_ALLOWED_PATHS.MODERATOR` += `/admin/tickets`) y `AdminNav` (`Tickets`, ADMIN+MODERATOR).
  **Los dos ficheros a la vez**: sin el path la sección es inaccesible, sin el ítem es invisible.

**Principio del frontend: la UI RESTRINGE, el backend GARANTIZA.** El frontend decide qué
*ofrecer* según el estado y el rol; no reimplementa validación. Donde discrepen, manda el
backend — por eso los errores se muestran en vez de ocultarse.

### LO QUE NO ESTÁ

**Nada.** El sistema está completo respecto al diseño aprobado: núcleo (R1-R3), avisos (R4),
frontend (R6-R7), cron de auto-cierre (R8), notas internas, los dos huecos de moderación
(§14.5), adjuntos (R5) y tiempo real (R9). Esta sección se conserva porque las ráfagas la
fueron vaciando por orden, y ese orden es información: lo último que quedaba —R9— exigía
cerrar antes el `TODO(prod)` del CORS del gateway, y así se hizo (dos pasos verificados por
separado; ver «R9 — tiempo real»).

### Deuda de test conocida asociada

- **`queue-retry › "Retry real"` es flaky por timing de indexación de Meilisearch** (el
  `attempts` recibido oscila entre 0, 1 y 2 según la carga). Los **14 estructurales de esa
  misma suite son fiables** y sí detectan un `registerQueue()` que se salte `retryQueue()`.
  No es regresión de este sistema: ya fallaba antes.
- **✅ RESUELTO (R9) — Playwright y la batería de backend ya no pueden correr a la vez.**
  Comparten `marketplace_test` y Redis db 1: el `globalSetup` de Playwright resiembra los
  `Setting` y el `cleanDb` de Jest trunca `User CASCADE` a mitad del otro, con síntomas que
  engañan (`rf7-limits` con `expected 403, got 200`; logins que "no establecen sesión").
  Estaba anotado como deuda de tooling con la nota de que "acordarse" no es un mecanismo —
  y en efecto se incumplió tres veces. Ahora hay un **candado compartido**
  (`apps/api/test/e2e-lock.js`): la segunda corrida **aborta inmediatamente** con un mensaje
  que dice qué está en marcha y desde cuándo. Detalles de la implementación en la sección
  «R9 — tiempo real» (§2).
- **`admin-roles.spec.ts` afirma el número EXACTO de ítems del nav.** Es frágil por diseño
  (obliga a mirar el test al añadir una sección), pero solo funciona si se actualiza: llegó a
  estar desactualizado en 2 ítems sin que nadie lo notara. Al añadir una entrada a
  `AdminNav`, actualizar las tres cuentas (ADMIN / MODERATOR / EDITOR).
- **Rate limit de apertura (10 tickets/día por usuario) en los e2e de navegador:** dos specs
  que usen el mismo usuario sembrado agotan la cuota entre ambos. `tickets-usuario.spec.ts`
  usa `seller-e2e` y `tickets-admin.spec.ts` usa `buyer-e2e` justo por eso. **El límite de
  producción no se toca para acomodar los tests.**

---

### Atención al usuario R1 — modelo de datos + máquina de estados (sin API)

Cimiento del sistema de tickets. Diseño aprobado en `docs/diseno-atencion-usuario.md`.
R1 entrega **solo** el modelo y `TicketsService`; **sin controladores, sin
notificaciones, sin frontend y sin subida de adjuntos** (R2+).

**Modelo (migración `add_ticketing`, 100% aditiva).** 3 enums (`TicketStatus`,
`TicketOrigin`, `TicketAuthorSide`) + `ContactReasonScope`, 3 tablas (`Ticket`,
`TicketMessage`, `TicketAttachment`), 1 columna nueva (`ContactReason.scope`
`@default(PUBLIC)`) y relaciones inversas en `User`/`Listing`/`Review`/`Invoice`/
`Report`. **Cero DROP, cero RENAME, cero ALTER COLUMN, cero backfill** — verificado
con `prisma migrate diff` ANTES de aplicar (4 `CREATE TYPE`, 3 `CREATE TABLE`,
7 `CREATE INDEX`, 12 `ADD CONSTRAINT`, 1 `ADD COLUMN`).

**`ContactReason.scope` — por qué una columna y no una tabla gemela (§14.1 del
diseño).** Los motivos del formulario público y los de un ticket no coinciden
(«consulta general» vs. «problema con mi factura»), pero sí comparten el CRUD de
admin ya construido (`/admin/motivos-contacto`, con reorden y sin DELETE). El
`@default(PUBLIC)` preserva exactamente el comportamiento de `/contacto` —
comprobado replicando en una BD sombra el estado pre-migración (6 motivos
insertados sin la columna) y aplicando la sentencia real: los 6 salen `PUBLIC`
sin una sola sentencia de backfill. Mismo criterio que
`Category.allowedListingType @default(BOTH)`.

**Enlaces polimórficos: patrón A (FKs nullables, molde `Report`), no
`referenceType`/`referenceId`.** El conjunto de entidades enlazables es cerrado
(anuncio/valoración/factura/reporte) y la vista del hilo necesita `include`. Los
cuatro van con **`onDelete: SetNull` + snapshot `linkedLabel`**: borrar el anuncio
no puede llevarse por delante el hilo de atención al usuario que hablaba de él
(mismo criterio que `Review.listingId`/`Deal.listingId`). Ejercido en test.

**Máquina de estados — arrays estáticos privados, sin abstracción nueva.**
`STAFF_REPLYABLE`, `USER_REPLYABLE`, `RESOLVABLE`, `CLOSABLE`, molde
`ListingsService.ARCHIVABLE_STATUSES`. No se introdujo ninguna clase
`StateMachine`: el proyecto no tiene ninguna (ni `Listing`, ni `Invoice`, ni
`Report`) y R1 no era el sitio para inventarla.

**`CLOSED` es irreversible por AUSENCIA, no por un `if`.** No aparece como estado
origen en ninguno de los cuatro arrays — exactamente el mecanismo de
`ListingStatus.ARCHIVED`. Sin triggers de BD a propósito: ese refuerzo está
reservado a lo fiscal (`Invoice`), no es higiene general. Dos tests lo vigilan: uno
de comportamiento (las SEIS puertas de salida rechazan y la fila queda intacta, sin
mensajes ni auditoría de más) y uno **estructural** que afirma que `CLOSED` no está
en ninguno de los arrays — así, añadirlo rompe la suite aunque el comportamiento
tardara en notarse.

**`TicketMessage.side` congelado al escribir.** Lo fija el método que crea el
mensaje (`replyAsUser` → `USER`, `replyAsStaff` → `STAFF`), nunca se deriva de
`author.role` al leer. Probado en ambos sentidos: se degrada al agente a `USER`
tras responder y su mensaje sigue siendo `STAFF`; y al revés.

**AuditLog solo en transiciones de STAFF**, dentro de la misma `$transaction`
(`auditLog.log(dto, tx)`): `TICKET_OPEN_BY_ADMIN`, `TICKET_ASSIGN`, `TICKET_REPLY`,
`TICKET_RESOLVE`, `TICKET_CLOSE`. Las acciones del usuario **no** se auditan — su
rastro es el propio hilo. **Consecuencia a decidir en R3:** `TICKET_REOPEN`, que el
diseño §7.3 listaba entre las acciones de auditoría, **no tiene emisor**: la única
reapertura de la matriz aprobada (T8) es del usuario, y las de usuario no se
auditan. O se añade una reapertura de staff, o la acción sobra.

**Notas internas: columna sin vía de escritura (decisión §14.3).**
`TicketMessage.internal` existe con `@default(false)`; ningún método del servicio la
escribe y `writeMessage()` ni siquiera acepta el parámetro. Lo que **sí** está puesto
desde R1 es la primera capa de la invariante de privacidad: `getForUser` filtra
`internal: false` **en la query**, y es un método SEPARADO de `getForStaff` (no uno
con flag booleano — un flag se pasa mal una vez y el fallo es silencioso).
Precedente que lo justifica: `Listing.phone`. Test: se siembra la nota interna
directamente en BD (saltándose el servicio, que no tiene vía) y se busca la cadena
**en crudo** en el payload serializado, molde `listing-phone.e2e-spec.ts`.

**Verificación — `test/tickets-state-machine.e2e-spec.ts`, 41 tests, contra Postgres
real.** Vive en `test/` y no como `.spec.ts` unitario a propósito: una transición es
guard → UPDATE → AuditLog dentro de una `$transaction`, y con Prisma mockeado se
estaría probando el `if`, no la transición. Cubre las 11 transiciones válidas y sus
rechazos. **Los tests se validaron por mutación**, no solo por verlos en verde:
añadir `CLOSED` a `CLOSABLE` pone 2 en rojo; quitar el filtro `internal: false` de
`getForUser` pone 1 en rojo.

**Pendiente explícito para R2 (anotado en el código):** `createByUser` **no** valida
la propiedad de la entidad enlazada. Sin controlador no hay entrada no confiable que
validar, pero R2 debe rechazar enlazar un anuncio/valoración/factura ajenos — si no,
el enlace se convierte en un oráculo de existencia de ids ajenos.

**Observación planteada al cerrar R1 — RESUELTA en R2 (ver más abajo):** un ticket
abierto por el staff nacía en `OPEN` y sin asignar. Se cambió a `WAITING_USER` +
asignado al agente que lo abre.

---

### Atención al usuario R2 — API de usuario (owner-scoped)

Expone por HTTP la parte de usuario del sistema de tickets: abrir, listar, ver el hilo,
responder y cerrar. `TicketsController` (`@Controller('tickets')`, `JwtAuthGuard` a nivel
de clase). La API de staff es R3 y vivirá en un controlador SEPARADO bajo
`/admin/tickets` — mismo reparto que `ContactModule` (público +
`AdminContactMessagesController`), no más métodos en este.

**Ajuste sobre R1 (cambio de producto deliberado, decidido tras entregarla).** Un hilo
abierto por el staff nace en `WAITING_USER`, no en `OPEN`: su primer mensaje ya es del
staff, así que la pelota está en el usuario desde el minuto uno y dejarlo `OPEN` lo metía
en la bandeja de "sin atender" estando atendido. **Corolario necesario:** se asigna al
agente que lo abre — `take()` solo acepta `OPEN` (T2), así que un ticket nacido en
`WAITING_USER` sin asignar habría quedado inasignable para siempre. Dos aserciones de
`tickets-state-machine.e2e-spec.ts` se actualizaron (cambio de producto, no regresión —
mismo criterio que los 3 tests que pasaron de 403 a 200 en RR5.1-ext).

**El guard del ORÁCULO DE IDS — lo que R2 venía a cerrar.** `assertLinkable()` valida que
la entidad enlazada sea del usuario: anuncio propio (`sellerId`), valoración donde es
**autor o receptor** (ambos lados tienen motivos legítimos para preguntar), o factura
propia. Lo importante no es que rechace, sino **CÓMO**: "no existe" y "no es tuya" caen en
el MISMO `throw` — `422 LINKED_ENTITY_NOT_ALLOWED`, cuerpo idéntico. Un `404` para lo
primero y un `403` para lo segundo habría convertido el campo en un oráculo con el que
sondear ids ajenos. El test lo ejerce comparando los dos cuerpos de respuesta con
`toEqual`, no solo los status.

También se rechaza enlazar **dos entidades a la vez** (`422 MULTIPLE_LINKED_ENTITIES`):
`linkedLabel` es un único snapshot y quedaría ambiguo.

**`linkedLabel` lo deriva el SERVIDOR**, del título/número real de la entidad. No está en
el DTO: si se aceptara del cliente, el snapshot podría mentir sobre a qué apunta el hilo.

**Notas internas — segunda y tercera capa de la invariante.** R1 puso el filtro en la
query de `getForUser`. R2 añade: (a) el filtro `internal: false` también en el **contador
de no leídos** de `GET /tickets` — sin él, el usuario sabría que el staff escribió algo
que no puede ver (fuga por canal lateral, no por contenido); (b) los DTOs de usuario **no
declaran `internal`**, así que el `forbidNonWhitelisted: true` del `ValidationPipe` global
lo rechaza con 400 sin que el servicio tenga que ignorarlo a mano. Ejercido: `{ internal:
true }` en el body → 400, y `COUNT(internal=true) === 0` en BD.

**Sin `POST /tickets/:id/reopen`.** La matriz aprobada (§7.2) modela T8 como EFECTO de
responder, no como transición propia. Un endpoint aparte devolvería el ticket a la bandeja
del agente sin nada nuevo que leer, y crearía un segundo camino a `IN_PROGRESS` que
mantener en sincronía. **Reabrir es escribir.** La ventana de 14 días
(`TICKET_REOPEN_WINDOW_DAYS`) se hace cumplir aquí; el cierre automático de los vencidos
es R8, y el cron deberá leer **esa misma constante**.

**Paginación del hilo:** cursor `before` sobre `createdAt` con `limit + 1` para detectar
`hasMore`, molde exacto de `MessagingService.getConversation`. El orden pasó a **DESC**
(más reciente primero) por el mismo motivo que en mensajería: un hilo se abre por el final
y se sube. Guard propio: un cursor de OTRO hilo se **ignora** en vez de aplicarse — si no,
un id ajeno serviría para desplazar la ventana y, con ella, inferir cronología ajena.

**Rate limit:** 10 tickets/día por usuario (`RateLimitService`, ya genérico desde RC.1),
comprobado **antes** de tocar la BD. Constante, no `Setting`: a diferencia de
`freeActiveListingLimit` (palanca de negocio), es una defensa antiabuso sin valor
comercial, y meterla en `Setting` obligaba a tocar la whitelist de `AdminService`, el seed
y la UI de ajustes a cambio de nada. **Nota de test:** el contador vive en Redis y `cleanDb`
solo trunca tablas — la suite lo limpia en su `beforeEach`, o envenenaría a las siguientes.

**Verificación — `tickets-user.e2e-spec.ts`, 33 tests por HTTP.** A diferencia de R1 (capa
de servicio), aquí se entra por la red: es la única forma de ejercer guards,
`whitelist`/`forbidNonWhitelisted` y el payload EXACTO que se sirve. **Validado por
mutación, cuatro veces:** distinguir 404 de 422 en el enlace → rojo el test del oráculo;
quitar `internal: false` del contador → rojo el del canal lateral; quitarlo del hilo →
rojo el de privacidad; quitar el check de `sellerId` → rojo el del anuncio ajeno.

---

### Atención al usuario R3 — API de staff (bandeja, transiciones y los tres flujos)

`AdminTicketsController` (`/admin/tickets`, `@Roles(MODERATOR, ADMIN)`, molde
`ModerationController`). Controlador SEPARADO del de usuario: sus payloads difieren en lo
esencial (este incluye notas internas y datos del usuario), y tenerlos en clases distintas
es lo que impide servir uno por la puerta del otro.

**`StaffActor { userId, role }` — cambio de firma en todos los métodos de staff.** Antes
recibían `actorId: string`. Ahora llevan el ROL porque **dos puertas del sistema no las
puede decidir el `RolesGuard`: dependen del CONTENIDO de la fila, no de la ruta**. Es un
parámetro OBLIGATORIO, no opcional con default permisivo — un guard que se desactiva con
solo olvidar un argumento es el mismo modo de fallo silencioso que se evitó separando
`getForUser`/`getForStaff`. Las llamadas de las suites de R1 y R2 se actualizaron
mecánicamente (cambio de FIRMA); **ninguna aserción cambió**.

**Puerta 1 — ticket con `invoiceId` enlazada es ADMIN-only.** La facturación lo es en todo
el proyecto. Aplicada en **TODOS los verbos**, no solo en ver y responder (que es lo que
pedía la letra de la ráfaga): un MODERATOR que pudiera `resolve`/`close`/`reassign` un hilo
que no puede LEER estaría cerrando a ciegas una reclamación de facturación — la regla es
"este hilo no es tuyo" y eso no admite excepciones por verbo. Además se excluyen de la
BANDEJA, no solo del detalle: listar lo que no se puede abrir enseñaría el asunto y el
usuario de un hilo de facturación a quien no tiene acceso a facturación.

**Puerta 2 — reasignar el ticket de OTRO agente es ADMIN-only.** Un MODERATOR sí puede
coger uno sin asignar o mover el suyo. Guard adicional no pedido pero necesario: no se
puede asignar a alguien que no sea ADMIN/MODERATOR — el ticket quedaría en manos de quien
no puede abrirlo, el mismo callejón sin salida que motivó el corolario de R2.

**Flujo (c) — `Report` intacto, verificado con la fila entera.** Se LEE para resolver el
destinatario (`reportedUserId` → `listing.sellerId` → `review.authorId`) y se referencia
desde `Ticket.reportId`. `ModerationService`/`ModerationController`/`Report` **no se
tocaron**, y `moderation.e2e-spec.ts` sigue verde SIN editarlo. Dos tests comparan el
`Report` con `toEqual` antes y después, y otro ejerce las dos direcciones: cerrar el ticket
no toca el reporte, y resolver el reporte por la vía de moderación no toca el ticket.

El destinatario lo resuelve el SERVIDOR. El DTO **no declara `userId`**, así que un intento
de elegirlo se rechaza con 400 (`forbidNonWhitelisted`) en vez de ignorarse en silencio —
falla ruidosamente, que es mejor. Sin este guard, la ruta sería la vía para abrir un hilo
"oficial", con la autoridad que da venir de moderación, contra cualquiera.

**Enlaces en el flujo (b): se validan contra el USUARIO DESTINATARIO, no contra el agente.**
No estaba pedido y es necesario: `linkedLabel` (que puede llevar el número de una factura)
SE LE SIRVE AL USUARIO en `GET /tickets/:id`. Enlazar ahí la factura de un tercero no sería
un descuido administrativo — sería filtrarle a un usuario el dato de otro.

**Notas internas: siguen sin vía de escritura.** El DTO de staff tampoco declara `internal`
(§14.3). En R3 el staff solo escribe mensajes normales. Lo que sí se ejerce es el CONTRASTE:
sembrando la nota en BD, `GET /admin/tickets/:id` la devuelve y `GET /tickets/:id` no.

**Sin notificaciones ni email** — eso es R4. R3 solo transiciones y `AuditLog`.
`TICKET_REOPEN` sigue sin emisor, y un test lo vigila explícitamente.

**Verificación — `tickets-admin.e2e-spec.ts`, 32 tests por HTTP.**

*Sanity-check del andamiaje (lección de R5 de facturación, no repetida):* el ADMIN entra por
`/auth/admin-login`, **no** por `/auth/login` (que rechaza admins con 403
`ADMIN_MUST_USE_ADMIN_LOGIN` y devolvería `accessToken: undefined` — con token vacío toda
ruta da 401 y un test de permisos "pasaría" por el motivo equivocado). Hay tres tests
dedicados a que el contraste 403-vs-200 sea real: que el token del ADMIN **funciona**, que
el del MODERATOR **funciona**, y que `/auth/login` efectivamente rechaza a un ADMIN.

*Hallazgo de infraestructura:* la suite crea y loguea 5 usuarios por test y
`/auth/admin-login` tiene un límite por IP más estricto que el público (es la puerta del
panel). Desde localhost todos los logins comparten IP, así que la suite se estrangulaba a sí
misma a mitad de camino y los fallos salían como 429 en el `beforeEach`. Se limpian las
claves `auth:*` antes de cada test — mismo principio que `reset-redis-between-suites.ts`,
con grano más fino porque una sola suite ya agota la ventana. El rate limit se sigue
probando donde le toca (`auth-security.e2e-spec.ts`).

**Validado por mutación, tres veces:** desactivar `assertCanHandle` en `loadForStaff` → rojo
el test de "la puerta cubre todos los verbos"; quitar el filtro por rol de la bandeja → rojo
el de "el MODERATOR tampoco lo ve en la bandeja"; anular el guard de reasignación → rojo el
de "no puede quitarle el ticket a otro agente".

---

### Atención al usuario R4 — notificaciones in-app + email auxiliar

Cierra el NÚCLEO del sistema: con R4 los tickets son usables de punta a punta vía API.
Falta solo el frontend (R6/R7) y los incrementos (R5 adjuntos, R8 cron, R9 tiempo real).

**Tres tipos de `Notification` nuevos, CERO migraciones** — `Notification.type` es `String` a
propósito. `TICKET_MESSAGE` y `TICKET_OPENED` al usuario, `TICKET_STAFF_NEW` en fan-out al
staff. Tercera validación de que B1 era extensible sin tocar la BD (la primera fue
`CONTACT_MESSAGE`).

**`TicketNotificationsService` — servicio propio, no más métodos en `TicketsService`.** Aquí
vive el "a quién se le cuenta qué", que es una preocupación distinta de "qué transición es
válida". Mismo reparto que `ListingActivationService`, que agrupa los efectos colaterales de
que un anuncio pase a ACTIVE.

**Fan-out in-app SÍ, email NO (§14.4).** La `Notification` va a cada agente porque
`Notification` es `userId` 1:1 y no existe buzón de rol (RC.1); el email va a **UNA**
dirección, `Setting.supportEmail`. Contraste deliberado con `ContactService`, que sí manda
un correo por administrador: con el volumen que se espera de tickets eso no escala, y la
campana ya cubre el "a cada uno le consta".

**`supportEmail` sin configurar → warning + se omite SOLO el correo.** Se descartó caer en
fan-out a los admins: es justo el comportamiento que §14.4 quiso evitar, y reintroducirlo
por la puerta de atrás en el estado de "mal configurado" es la peor forma de tenerlo. **No
se pierde ningún aviso** — la notificación in-app a cada agente se crea siempre. No se
siembra en el seed: "sin configurar" es un estado válido y explícito. Sí se añadió a
`SETTING_KEYS` para que el admin pueda ponerlo desde el backoffice.

**§11 hecho mecanismo, no eslogan.** `TICKET_EXCERPT_MAX_CHARS = 140`: ni la notificación ni
el email transportan la conversación, solo extracto + enlace. Para leer el hilo hay que
entrar. Los tres emails cierran con *"No respondas a este correo: responde desde tu ticket
en el enlace de arriba"* — y no es solo copy: **no existe email entrante en el proyecto**
(auditoría §1.4), así que una respuesta no llegaría a ninguna parte.

**El aviso es EFECTO, nunca CAUSA.** Ningún método del notificador escribe en el ticket. Se
invoca **tras el commit** de la `$transaction`, nunca dentro: si la transacción falla no se
avisa de un ticket que no existe (molde `ContactService.submit`, que persiste y luego
notifica). Hay dos tests dedicados: uno comprueba que el estado tras cada transición es el
que dicta la máquina, y otro que una transición RECHAZADA no deja ni una notificación ni un
job encolado.

**Snapshots con NOMBRES resueltos** (`userName`, `topic`), nunca ids — la notificación debe
pintarse sin una consulta extra y seguir siendo legible si el motivo se renombra (mismo
criterio que hizo que `ContactService.notifyAdmins` reciba el nombre y no el `motivoId`).
`status` va congelado en el instante del aviso.

**Defensa preparada:** un mensaje `internal` no dispara ningún aviso. Hoy nada los crea
(§14.3), pero avisar de una nota interna delataría su existencia al usuario — la fuga por
canal lateral que R2 ya cerró en el contador de no leídos, aquí cerrada en el aviso.

**Frontend: CUATRO `case` nuevos** en `notification-content.ts`. Los tres de tickets, más el
de **`INVOICING_PENDING_FISCAL_DATA`**, que existía en el backend desde RF.13 R4 pero nunca
tuvo el suyo y caía al default genérico "Nueva notificación" (detectado en la auditoría
§1.3). La unión `NotificationItem` de `types/index.ts` ganó los cuatro miembros — sin ellos
TypeScript ni siquiera admite el `case`, que es exactamente por qué el de facturación llevaba
tanto tiempo sin cerrarse.

**Verificación — `tickets-notifications.e2e-spec.ts`, 16 tests.** Se observan los DOS lados
del efecto: las filas `Notification` en Postgres y los jobs encolados (espía sobre
`queue.add`, en vez de levantar un worker: lo que R4 garantiza es QUÉ se encola, CUÁNTOS y
con qué cuerpo — que Resend entregue no es de esta ráfaga).

**Validado por mutación, cuatro veces:** email en fan-out por admin → rojos los tres tests
del "un solo email"; `excerpt()` devolviendo el body entero → rojos los dos de §11; quitar el
guard de `internal` → rojo el de la nota interna; guardar ids en vez de nombres → rojo el del
snapshot autocontenido.

---

### Atención al usuario R6 — frontend de usuario

`/mis-tickets` (lista + filtro abiertos/todos + paginación), `/mis-tickets/nuevo` (con
entidad enlazada prefijada) y `/mis-tickets/[id]` (el hilo, con cursor y acciones por
estado). `middleware.ts` gana el prefijo `/mis-tickets`.

**Principio aplicado literalmente: la UI RESTRINGE, el backend GARANTIZA.** El frontend
decide qué OFRECER según la matriz §7.2; no reimplementa ninguna validación. Cuando
discrepan manda el backend — por eso los errores se muestran en vez de ocultarse, y por eso
`toCreateTicketMessage`/`toTicketActionMessage` traducen los `code` del servidor (422, 429,
`REOPEN_WINDOW_EXPIRED`) en vez de precomprobar nada.

**Dos huecos del backend que R6 destapó y hubo que cerrar antes de poder construir el
selector:**

1. **`ContactReasonsService.listActive()` nunca filtró por `scope`.** La columna se añadió
   en R1 pero este método seguía devolviendo TODOS los activos, así que `/contacto` habría
   acabado ofreciendo motivos de ámbito TICKET en cuanto se creara el primero. No había
   mordido porque hasta ahora todos eran `PUBLIC` (el `@default`). Ahora recibe los ámbitos:
   el endpoint público pide `PUBLIC + BOTH`.
2. **No existía endpoint de motivos para el usuario.** Nuevo `GET /tickets/topics`
   (autenticado) → `TICKET + BOTH`. **Declarado ANTES que `@Get(':id')`**: si fuera después,
   Nest resolvería `/tickets/topics` contra la ruta dinámica y buscaría un ticket con id
   "topics" (mismo motivo que `reorder` antes de `:id` en `FooterAdminController`).
   `ContactModule` exporta `ContactReasonsService` para esto — los motivos siguen siendo UNA
   taxonomía con columna de ámbito (§14.1), no dos tablas.

**Entradas contextuales.** Botón en `MyListingCard` (`?listingId=`), en cada fila de
`FacturasPanel` (`?invoiceId=`) y en la valoración recibida (`?reviewId=`). `/nuevo` resuelve
la ETIQUETA best-effort para que el usuario vea con qué relaciona el ticket; si falla (id
manipulado, entidad ajena) NO bloquea: sigue con etiqueta genérica y es el backend quien
rechaza con 422 al crear. El `linkedLabel` real lo deriva siempre el servidor.

**Matiz en la entrada de valoraciones.** `ReviewsSection` es un componente PÚBLICO servido a
cualquier visitante de `/vendedor/[slug]`. Enseñar ahí el botón a todo el mundo ofrecería una
acción que el backend rechaza (422) a todos salvo al protagonista — justo lo contrario del
principio. Se añadió la prop `esMiPerfil` (default `false`, así las llamadas existentes no
cambian), que la página calcula comparando la sesión con el slug del perfil.

**Verificación.**

- **`TicketThreadClient.test.tsx`, 15 tests (Jest + Testing Library).** Cubre la única
  lógica de decisión real del frontend: la matriz de 5 estados × 3 orígenes que determina qué
  acciones se ofrecen. En Playwright esa matriz sería lenta; aquí es instantánea. Incluye el
  caso `RESOLVED` sin `resolvedAt` (dato incoherente → se trata como fuera de ventana, la
  opción segura). **Validado por mutación:** quitar `origin === 'USER'` del gate de cerrar →
  2 rojos; ignorar la ventana de reapertura → 2 rojos.
- **`e2e/tickets-usuario.spec.ts`, 7 tests (Playwright), verdes.** Flujo real en navegador:
  abrir desde cero, entrada contextual con anuncio, hilo con burbujas por lado, responder y
  ver la transición, ticket de la administración sin botón de cerrar, cerrado sin caja, y
  reapertura desde RESOLVED.

**Dos hallazgos de proceso (míos, anotados para no repetirlos):**

1. **Playwright y la batería de backend NO pueden correr a la vez.** Comparten
   `marketplace_test` y Redis db 1; el `global-setup` de Playwright resiembra los `Setting`
   a mitad de la batería y `rf7-limits`/`rf7-expiration` se ponen rojos con el
   `expected 403, got 200` ya documentado en la deuda de test/CI. Verificado: en aislamiento
   pasan las dos.
2. **El `page` por defecto de Playwright NO está autenticado.** Las sesiones vienen de los
   contextos con `storageState` del fixture (`sellerContext.newPage()`), como en
   `mensajeria-unificada.spec.ts`. Usar `page` a secas hace que todo redirija a `/login` y
   los fallos aparezcan como "no encuentro el campo del formulario".

---

### Atención al usuario R7 — frontend de staff (CIERRA EL NÚCLEO)

`/admin/tickets` (bandeja con filtros), `/admin/tickets/[id]` (hilo + acciones + panel
lateral) y `/admin/tickets/nuevo` (flujo b). Client-side y sin SEO, regla del backoffice.
Con R7 el sistema es usable por los dos lados; lo que queda son incrementos (R5 adjuntos,
R8 cron, R9 tiempo real).

**La matriz de acciones, extraída a función pura.** `resolveStaffActions()`
(`components/tickets/staff-actions.ts`) decide qué se ofrece según estado × rol ×
asignación × factura. Es la única lógica de decisión real del frontend de R7 y la que sería
más cara de cubrir a clics (5 estados × 2 roles × 3 situaciones de asignación): sacada a una
función, se prueba entera en milisegundos (`staff-actions.test.ts`, 14 tests) y Playwright
solo comprueba que la pantalla la USA.

**La UI no replica el filtrado por rol de la bandeja, a propósito.** El backend (R3) NO
LISTA a un MODERATOR los tickets con factura; la bandeja pinta lo que le llega. Replicar el
filtro en el cliente daría la falsa impresión de que la protección vive ahí — vive en el
`where` del servidor.

**Navegación: los dos ficheros a la vez.** `ROLE_ALLOWED_PATHS.MODERATOR += '/admin/tickets'`
y `NAV_ITEMS += Tickets`. Sin el path la sección es inaccesible; sin el ítem, invisible.

**Flujo (c) cerrado de punta a punta.** Botón "Contactar al reportado" en cada fila de
`/admin/reportes` (no hay ruta `[id]`: la ficha es la propia lista). Si el reporte ya tiene
hilo, se enlaza en vez de ofrecer abrir otro. Para eso `ModerationService.listReports` gana
un `include` de `tickets: { id, status }` — **solo lectura, dos campos**; ni el modelo, ni
los estados, ni los endpoints de `Report` cambian, y `moderation.e2e-spec.ts` sigue verde
(45/45) **sin editarlo**. Verificado además en el navegador: abrir el hilo NO cambia el
estado de la denuncia (sigue `PENDING`).

**Notas internas: se VEN, no se CREAN.** El hilo de staff las pinta diferenciadas si
existieran (contraste con la vista de usuario, que las filtra). R7 **no** añade UI para
crearlas: siguen aplazadas (§14.3) y no hay vía de escritura en ninguna capa.

**Verificación.**

- `staff-actions.test.ts` — 14 tests. Incluye que la puerta de facturación cubre TODOS los
  verbos (no solo ver/responder) y las tres situaciones de la puerta de reasignación.
- `e2e/tickets-admin.spec.ts` — 5 tests Playwright, verdes. Ciclo completo del ADMIN
  (tomar → responder → resolver → cerrar, comprobando que CLOSED no deja ninguna acción),
  filtros, la puerta de facturación **con el contraste completo** (MODERATOR no lo ve en la
  bandeja + 403 al forzar la URL; ADMIN sí lo ve y lo abre), flujo (b) verificado hasta que
  el usuario lo ve en `/mis-tickets`, y flujo (c) con el `Report` intacto.
- `admin-roles.spec.ts` actualizado (cuentas de nav) — ver el hallazgo de abajo.

**HALLAZGO — `admin-roles.spec.ts` ya estaba rojo antes de R7.** Afirmaba 14 ítems de nav
para el ADMIN cuando `NAV_ITEMS` ya tenía **16** en HEAD (comprobado con
`git show HEAD:…AdminNav.tsx`): la cuenta se quedó desactualizada en alguna ráfaga anterior
que añadió ítems sin tocar el test. Corregido a **17** (16 + Tickets), y añadidas las
aserciones de `Tickets` visible para ADMIN/MODERATOR y NO visible para EDITOR. La cuenta
exacta es frágil por diseño (es su gracia: obliga a mirar el test al añadir una sección),
pero solo funciona si se actualiza — dos ráfagas la dejaron pasar.

**Cambio en `seed-playwright.ts` (aditivo).** Para ejercer la puerta de facturación en el
navegador hacía falta una factura real, y emitir una exige datos fiscales + una Transaction
`SUCCEEDED` sin facturar, que el seed no tenía. Se siembran ambos para `seller-e2e`, de
forma idempotente. Comprobado que ningún otro spec depende del estado fiscal de ese usuario,
y las suites e2e de backend truncan `User CASCADE` en su `cleanDb`, así que no las alcanza.

**Corrección de un texto que mentía:** el placeholder del buscador de usuarios decía "Nombre
o email…", pero `UsersService.search` casa por `name` o `slug`, nunca por email — buscar un
email no devolvía nada. Ahora dice "Nombre o identificador…".

---

### Atención al usuario R8 — cron de auto-cierre (COMPLETA LA MÁQUINA DE ESTADOS)

`TicketsScheduleService`: `@Cron('0 5 * * *')` → `runTicketAutoClose(now)`. Cierra los
RESOLVED cuya ventana venció (T9), que era **la única transición de la matriz §7.2 sin
disparador**: hasta ahora la ventana solo la hacía cumplir el guard de reapertura y los
RESOLVED se acumulaban indefinidamente. Con R8, todas las transiciones tienen quien las
dispare.

**Molde `InvoicingScheduleService`:** el `@Cron` es fino y delega en un método público que
RECIBE la fecha. La lógica nunca llama a `new Date()` por dentro, y por eso se prueba el día
13, el 14 exacto y el 15 en la misma corrida, sin esperar al reloj.

**Núcleo de cierre compartido, no reimplementado.** Se extrajo `closeCore()`: el ÚNICO sitio
donde un ticket pasa a CLOSED. Las tres vías (T10 staff, T11 usuario, T9 cron) pasan por él,
así que el guard `CLOSABLE` y la escritura de `closedAt`/`closedById` viven en un solo lugar
(molde `emitInvoiceCore`).

**Guard atómico contra una carrera real.** `closeCore` acepta `requireStatus`, que el cron
usa con `'RESOLVED'`. Entre que la query selecciona los vencidos y llega el UPDATE, el
usuario puede haber REABIERTO el ticket (T8 → IN_PROGRESS) — y `assertClosable` NO protege
de eso, porque IN_PROGRESS también es cerrable. Sin la condición en el propio UPDATE (molde
del débito de Wallet, `WHERE balance >= N`), el cron cerraría un hilo que el usuario acaba de
resucitar, con su mensaje dentro.

**IDEMPOTENCIA NATURAL, sin marca de "última corrida"** — a diferencia del cron de
facturación, que sí la necesita porque su unidad de trabajo es un PERIODO que no deja rastro
en la fila. Aquí un ticket cerrado pasa a `CLOSED` y deja de casar `status = RESOLVED`: **el
estado de la fila ES la marca**. Un Setting de "último día procesado" sería estado redundante
que puede desincronizarse del único dato que manda.

**Frontera inclusiva (`<=`), y no por capricho:** a los 14 días exactos el cron ya cierra,
porque el guard de reapertura exige `now <= resolvedAt + ventana` para dejar reabrir. En el
instante del vencimiento el usuario ya no puede reabrir, así que el cron sí puede cerrar — no
queda ningún hueco entre los dos.

**UN SOLO valor para dos cosas.** `Setting.ticketAutoCloseWindowDays` (default 14, sin
sembrar) gobierna **a la vez** el guard de reapertura (T8) y el cron (T9), leído desde un
único punto (`TicketsService.getReopenWindowDays`). Si divergieran habría un limbo: un ticket
que ya no se puede reabrir pero que nunca se cierra, o al revés. Hay un test dedicado a esa
coherencia, y es el que se pone rojo si alguien vuelve a cablear la constante en el guard.

**Efecto colateral que R8 obliga a corregir en el frontend:** al volverse configurable, el
`REOPEN_WINDOW_DAYS = 14` que R6 tenía cableado en `TicketThreadClient` pasó a poder mentir
(ofrecer "reabrir" fuera de plazo, o negarlo dentro, en cuanto el admin tocara el Setting).
La ventana viaja ahora en el payload de `GET /tickets/:id` (`reopenWindowDays`) y la UI usa
ese número. Dos tests nuevos usan el MISMO ticket con ventanas servidas distintas: si alguien
vuelve a cablear el 14, uno falla.

**DOS DECISIONES, justificadas (no inventadas en silencio):**

1. **SIN AuditLog por ticket auto-cerrado.** No es solo el ruido de 200 filas por corrida: es
   que **no se puede escribir sin mentir**. `AuditLog.actorId` es NOT NULL con FK a `User`, y
   este cierre no tiene actor humano — habría que inventar un "usuario sistema" o colar el id
   de un admin que no hizo nada, envenenando justo el registro que sirve para pedir cuentas
   ("cada acción ADMINISTRATIVA sensible"). La trazabilidad la lleva la propia fila:
   `closedAt` dice cuándo y `closedById = null` dice "lo cerró el sistema" — ese es el
   discriminante frente al cierre de staff (su id) o del usuario (el suyo). Por eso la
   columna es nullable desde R1: no es un hueco, es el diseño. Queda un log de resumen por
   corrida.
2. **SIN notificación al usuario.** Ya se le avisó en T7 (R4, `SEND_TICKET_RESOLVED`) y ese
   aviso incluía la ventana. El auto-cierre es el vencimiento de un plazo del que ya se le
   informó — no es información nueva, y no habría nada que hacer con ella: pasada la ventana
   no se puede reabrir, y la única salida (abrir uno nuevo) ya se la ofrece la pantalla del
   hilo cerrado (R6).

**Anomalía vigilada:** un RESOLVED sin `resolvedAt` (que `resolve()` nunca produce) no se
cierra — el `lte` lo excluye por semántica SQL — pero se CUENTA y se avisa por `logger.warn`,
en vez de barrerse. Un ticket así no se cerraría jamás solo, y eso hay que poder verlo
(mismo criterio de "falla alto, no autocorrijas" del resto del proyecto).

**Verificación — `tickets-cron.e2e-spec.ts`, 16 tests.** Ventana default y configurable,
las dos fronteras (14 días exactos cierra; un milisegundo antes no), que solo toca RESOLVED,
idempotencia por doble disparo, que no pisa el `closedById` de un cierre manual, la anomalía,
la coherencia guard↔cron, que CLOSED sigue siendo irreversible tras el auto-cierre, y que no
escribe AuditLog ni notifica.

**Validado por mutación, dos veces:** cambiar `lte` por `lt` → rojo el test de la frontera
exacta; hacer que el guard de reapertura vuelva a leer la constante en vez del Setting → rojos
los dos tests de coherencia.

---

### Atención al usuario — NOTAS INTERNAS (activación de la escritura, §10.3/§14.3)

La última pieza del diseño aprobado. El staff ya puede escribir notas internas; el usuario
sigue sin poder verlas ni crearlas. **Es la funcionalidad de máximo riesgo del sistema**: el
campo guarda lo que el equipo escribe SOBRE un usuario.

**Las cinco defensas NO se reconstruyeron — se verificaron en el código y se re-probaron con
notas creadas por el ENDPOINT REAL** (hasta ahora todos los tests las sembraban en BD, que es
lo único que se podía hacer sin vía de escritura). Esa es la diferencia que aporta esta
ráfaga: saber que la vía recién abierta pasa por los mismos filtros y no por un atajo.

**LO MÁS IMPORTANTE DE ESTA RÁFAGA — DTO SEPARADO, no un campo añadido.** Las rutas de
usuario y de staff **compartían** `SendTicketMessageDto`. Añadir `internal` ahí, que es lo
que pedía la lectura literal del encargo, habría abierto el campo TAMBIÉN en
`POST /tickets/:id/messages` — es decir, habría dejado que el usuario marcase sus propios
mensajes como internos, destruyendo la defensa 4 en el mismo commit que abría la
funcionalidad. Se creó `SendStaffMessageDto extends SendTicketMessageDto` con el campo en la
SUBCLASE: la herencia solo propaga hacia el lado seguro, y el `forbidNonWhitelisted` global
sigue rechazando con 400 un `internal` en la ruta de usuario sin que ningún `if` tenga que
acordarse. Hay un test que manda el MISMO cuerpo a las dos rutas: staff 201, usuario 400.

**Una nota interna NO TOCA LA FILA DEL TICKET.** Ni estado, ni asignación, ni `lastMessageAt`.
Lo de `lastMessageAt` no es preferencia: **ese campo SE LE SIRVE AL USUARIO** (va en cada fila
de `GET /tickets` como "último movimiento" y en el payload del hilo). Si una nota lo moviera,
el usuario vería actividad fechada sin ningún mensaje nuevo que la explique y podría deducir
que el equipo escribió algo oculto — exactamente la fuga por canal lateral que R2 cerró en el
contador de no leídos, con otro campo. **Se descartó por eso**, no por simplicidad; el coste
(la bandeja de staff no reordena por notas internas) es real y asumido. Si algún día se
quiere, pide una columna propia (`lastInternalNoteAt`), no reutilizar una que el usuario lee.
Tiene test propio.

**Guard estructural nuevo en `writeMessage`:** `internal: true` con `side: 'USER'` lanza. Sería
un mensaje del usuario que el propio usuario no puede ver — un estado sin sentido que además
rompería los filtros, que combinan `side` e `internal`. Ninguna vía actual puede producirlo;
esto lo hace imposible también para las futuras.

**AuditLog distinto:** `TICKET_INTERNAL_NOTE` en vez de `TICKET_REPLY`. Mezclarlos haría
imposible distinguir en la auditoría "le respondimos al usuario" de "anotamos algo entre
nosotros". Cierra además el hueco que dejó §7.3, donde esa acción estaba prevista y no tenía
emisor.

**El aviso se sigue llamando SIEMPRE, también con una nota** — `userStaffWrote` sale por la
puerta al ver `message.internal` (defensa 5). Es deliberado no evitar la llamada desde el
servicio: así el guard está en el camino vivo, y el test que lo muta lo ve fallar de verdad
en vez de pasar por un atajo que lo esquiva.

**Frontend (única superficie nueva):** un toggle en la caja de respuesta del hilo de staff.
Cambia el DESTINATARIO de lo que se escribe, así que el recuadro cambia de color, el botón
cambia de texto e icono, y **el toggle se resetea tras cada envío** — un modo pegajoso es
justo el que acaba mandándole al usuario lo que era para el equipo, o dejándolo sin responder
creyendo que se le respondió.

**Verificación — `tickets-internal-notes.e2e-spec.ts`, 20 tests por HTTP.** Las cinco
defensas con notas reales, incluido recorrer TODO el hilo paginado hacia atrás con `?before`
buscando el secreto en cada página, que la nota no marca `readByUserAt`, que no mueve
`lastMessageAt`, que no transiciona ni asigna, y que la puerta ADMIN-only de R3 cubre también
este verbo. Cada defensa tiene además su contraparte "y el caso normal SÍ funciona", para que
un filtro que lo bloquee todo no pase por defensa.

**Validación por mutación de las CUATRO defensas mutables, revertidas byte-idéntico:**
quitar el filtro de `getForUser` → 3 rojos; quitar el del contador → 2; abrir `internal` en el
DTO de usuario → 2; quitar el guard de los avisos → 1.

**Playwright:** un test recorre el circuito completo por navegador — el agente escribe la nota
con el toggle, la ve marcada en su hilo, el toggle se resetea, y el usuario no la encuentra ni
en su hilo, ni en el HTML servido, ni en la lista.

**Dos hallazgos de infraestructura de test (míos):**

1. **`tickets-usuario` y `tickets-admin` compartían `seller-e2e` y juntas superaban el rate
   limit real de 10 tickets/día**, así que la segunda recibía 429 en su propio setup. Los
   tickets de la suite de staff los abre ahora `buyer-e2e`. Repartir el usuario es más honesto
   que subir el límite o flushear Redis a mitad de corrida: **el límite de producción se queda
   como está**.
2. **El guard de idempotencia que añadí al seed en R7 estaba mal**: comprobaba "¿hay alguna
   Transaction SUCCEEDED?" cuando debía comprobar "¿queda alguna FACTURABLE?". Como el test
   EMITE una factura en cada corrida, la Transaction quedaba enlazada a una `InvoiceLine` y la
   segunda corrida fallaba con 409 — el clásico "verde la primera vez, rojo al repetir sin
   resetear la BD". Corregido con `invoiceLine: { is: null }`.

### Atención al usuario R9 — TIEMPO REAL (§12), EN DOS PASOS

**Se hizo en DOS PASOS VERIFICADOS POR SEPARADO, y esa es la decisión de método que importa.**
El paso 1 tocaba código que YA FUNCIONABA (el gateway de mensajería y sus e2e verdes); el paso
2 añadía lo nuevo. Juntos, un fallo no habría dicho cuál de los dos fue. Separados sí — y de
hecho hizo falta: al verificar el paso 1 apareció un rojo en el Playwright de mensajería, y
poder aislarlo (volver el CORS a `'*'` y ver que seguía rojo, y luego verlo rojo en HEAD
limpio) fue lo que evitó pasar horas "arreglando" un CORS que no era el culpable.

#### Paso 1 — el `TODO(prod)` del CORS, cerrado

`cors: { origin: '*' }` → `cors: { origin: [appOrigin()] }`. Auditoría previa: **un solo
gateway** en todo el proyecto y **un solo** `cors: '*'` en él (más el `app.enableCors()` de
HTTP, que se reporta como deuda aparte en §3 y NO se tocó, por la misma lógica de los dos
pasos).

**`appOrigin()` y no `ConfigService`**: un decorador se evalúa al cargar la clase, antes de que
exista el contenedor de inyección. La función vive en `config/app-origin.ts` y es **la misma
que alimenta `config.appUrl`**, así que no hay dos lecturas del origen que puedan divergir — la
alternativa era repetir `process.env.APP_URL ?? 'http://localhost:3000'` en el decorador, con su
default duplicado.

**UN ARRAY DE UNO, no la cadena suelta, y se descubrió ejerciéndolo.** Con `origin: 'x'` el
paquete `cors` emite `Access-Control-Allow-Origin: x` **sin comparar** con el `Origin` de la
petición: protege igual (el navegador compara), pero la respuesta es idéntica para todos, y el
test del origen ajeno seguía recibiendo la cabecera. Con un array, el servidor compara y
**omite** la cabecera cuando no casa — comportamiento observable y por tanto verificable.

**Qué protege y qué no, dicho sin adornos.** El CORS de socket.io es defensa en profundidad, no
la puerta: quien autoriza es el token del handshake, y por ser un token **explícito** y no una
cookie, este gateway nunca fue vulnerable a *cross-site WebSocket hijacking*. Además el
protocolo WebSocket no pasa por CORS (solo el polling y el handshake) y **el propio frontend
usa `transports: ['websocket']`**, así que en la práctica el CORS no está ni en el camino vivo
de esta aplicación. Cerrarlo sigue siendo correcto —quita el `*` del inventario y cierra el
camino fácil—, pero decir que "cierra un agujero explotable" habría sido falso.

**Verificación del paso 1**: `messaging.e2e-spec.ts` **verde sin editarlo** (requisito de oro) y
suite nueva `messaging-cors.e2e-spec.ts` (4 casos). Esta última existe porque la de mensajería
conecta con `transports: ['websocket']` y **por tanto seguiría verde con el CORS puesto,
quitado o mal**: donde el CORS decide es en el handshake de polling, y ahí se ataca (origen
permitido → cabecera con el origen concreto; origen ajeno → sin cabecera; preflight igual; sin
`Origin` —cliente que no es navegador— sigue funcionando). Nota de implementación: el namespace
`/ws` **no es una ruta**; el handshake va por `/socket.io/`.

#### Paso 2 — salas de tickets

- **`ticket:join`**, molde exacto de `conversation:join`: acceso verificado **contra la BD**
  antes de unir. Entra el dueño (siempre, incluso con factura enlazada — mismo criterio que la
  descarga de adjuntos de R5) o el staff, reutilizando `assertCanHandleTicket` para la puerta
  ADMIN-only de facturación en vez de recopiar la condición. Hilo ajeno e hilo inexistente
  comparten respuesta: sin oráculo de ids.
- **Sala de rol `staff`**, al conectar, con el **rol leído de la BD y no del token**: los JWT
  duran 7 días, así que un MODERATOR degradado seguiría llevando su rol viejo en un token
  válido — y esta sala recibe la actividad de TODOS los tickets. `JwtStrategy` ya hace lo mismo
  en cada request HTTP.
- **`emitTicketMessage`**, gemelo de `emitNewMessage`, cableado en los CUATRO puntos que crean
  mensajes, **siempre tras el commit** y **siempre junto al aviso de R4, nunca en su lugar**:
  el socket es para quien tiene la pantalla delante ahora, la `Notification` y el email para
  quien no. Envuelto en `catch`: el tiempo real es un extra y no puede tumbar la petición de un
  mensaje ya guardado.
- **UN SOLO emit con los `to()` ENCADENADOS**, no tres emits seguidos. socket.io deduplica la
  unión de salas, así que cada socket recibe el evento una vez aunque esté en varias (el usuario
  está en `ticket:<id>` **y** en `user:<id>`). Con emits separados —como hace `emitNewMessage`,
  que por eso obliga al cliente a deduplicar— llegaban dos copias. También salió al probarlo.

**★ LA INVARIANTE §10.3 EN EL CANAL DE TIEMPO REAL — lo más importante de la ráfaga.** El
WebSocket es una **superficie nueva** por la que una nota interna podía filtrarse: las defensas
anteriores viven en las consultas (`getForUser` filtra `internal: false`), en los contadores, en
el DTO y en los avisos de R4, y **ninguna protege un canal que empuja el mensaje al navegador**.
Aquí la defensa es el propio diseño de salas: una nota interna se emite **solo** a `staff`, y el
`return` corta antes de nombrar `ticket:<id>` — que es la sala donde están el usuario y el
agente a la vez. Un agente que mire el hilo la recibe igualmente, por `staff`.

**Frontend**: `useTicketSocket` (molde `useMessagingSocket`: mismo namespace, token en el
handshake, re-`join` en cada `connect` porque también se dispara al reconectar), usado en los
dos hilos. Deduplicación por id en el cliente —el mensaje propio vuelve por el socket y ya se
añadió con la respuesta del POST—, y en el hilo de staff se **inserta** el mensaje en vez de
recargar el hilo entero: un `load()` por mensaje perdería la posición de lectura del agente.
**La bandeja de staff en vivo se deja fuera a propósito**: era opcional en §12 y su propio
argumento es que el badge al navegar basta.

**Verificación del paso 2**: `tickets-realtime.e2e-spec.ts` (**20 casos**, sockets de verdad
contra la app escuchando en un puerto real — no espías sobre el gateway, que probarían que
llamamos al método y no que el mensaje no llega). Cubre: llegada en vivo en las dos direcciones,
bandeja de staff sin estar en el hilo, sala personal del usuario, **ataque de `ticket:join` a un
hilo ajeno** (rechazado *y* comprobando que no recibe los mensajes de esa sala), ticket
inexistente, puerta de facturación en las dos direcciones, **rol degradado con token válido**,
idempotencia del join, y los cuatro casos de la nota interna. Más 1 caso de navegador con **dos
sesiones** (`e2e/tickets-tiempo-real.spec.ts`), que es lo que el e2e de gateway no puede probar:
que el hook se suscribe y el mensaje se **pinta** sin recargar, una sola vez.

**Mutación (3/3 en rojo, revertidas):** emitir la nota interna también a la sala del hilo → 3
rojos; quitar la verificación de acceso de `ticket:join` → 2; leer el rol del token en vez de la
BD → 1.

#### La deuda de tooling que arrastraba tres incumplimientos: cerrada

**`apps/api/test/e2e-lock.js`** — candado compartido por el `globalSetup` de Jest y el de
Playwright. La segunda corrida **aborta al instante** con un mensaje que dice qué está en marcha,
con qué PID y desde cuándo, en vez de producir rojos falsos veinte minutos después. Detalles:

- El candado es un **directorio** (`mkdir` es atómico; "comprobar y luego crear" tiene ventana
  de carrera).
- Guarda el PID: un candado **huérfano** (Ctrl-C, crash) se detecta con `process.kill(pid, 0)`
  y se rompe solo — si no, el remedio sería peor que la enfermedad.
- `release` solo suelta **si el candado es nuestro**.
- Es un `.js` sin TypeScript porque el `globalSetup` de Jest no pasa por ts-jest; Playwright lo
  carga con `require` desde `apps/api`, exactamente como ya comparte `flush-redis-test-db.js`.
  Se añadió `globalTeardown` a `playwright.config.ts` para liberarlo.
- **Probado ejerciéndolo**, no solo compilado: coger → bloquear la segunda → liberar →
  readquirir, y el caso del candado huérfano con un PID inexistente.

Nota menor de ruido: ts-jest avisa (`allowJs`) al compilar el `globalTeardown` en `.js`. Es
cosmético, no falla nada, y `setup-e2e.js` tiene la misma forma desde siempre; no se toca la
clave `transform` del Jest compartido para silenciarlo, porque su radio de explosión es toda la
batería.

### Atención al usuario R5 — ADJUNTOS (§14.7 / §3.5)

**LA DECISIÓN QUE DEFINE LA RÁFAGA: molde FACTURA, no molde media.** No es una preferencia de
estilo, son dos productos distintos:

| | `MediaService` (fotos de anuncio) | R5 (adjuntos de ticket) |
|---|---|---|
| Qué se guarda | `url` pública (`getPublicUrl`) en `ListingImage` | solo la **clave** en `TicketAttachment.key` |
| Cómo se sirve | el bucket, a cualquiera con la URL | endpoint **autenticado** que revalida en cada descarga |
| Revocar acceso | imposible (la URL es compartible y no caduca) | dejar de pasar el control |
| Efectos | fila `ListingImage` + job de procesado | ninguno |

Un pantallazo de ticket puede llevar un DNI, un importe o una conversación privada. Con molde
media, quien tuviera la URL —reenviada, cacheada, indexada— tendría el fichero para siempre.
Así que `TicketAttachmentsService` **usa `R2Service` directamente y no `MediaService`**, y **en
todo R5 no se llama a `getPublicUrl` ni una vez**. Lo único compartido con media son DOS
CONSTANTES (whitelist MIME y tamaño máximo), importadas en `tickets.constants.ts` para que no
existan dos listas de tipos permitidos divergiendo en paralelo. `media.e2e-spec.ts` sigue verde
sin editarse.

**Superficie**: los dos endpoints de mensaje (`POST /tickets/:id/messages` y
`POST /admin/tickets/:id/messages`) aceptan ahora **multipart además de JSON** —el interceptor
de multer solo actúa sobre multipart, así que un cuerpo JSON llega igual que antes y las suites
de R2/R3 no notan el cambio—, más dos rutas de descarga (`GET …/attachments/:attachmentId`,
una de usuario y una de staff). JPEG/PNG/WebP + PDF, 10 MB, 5 por mensaje.

**La clave no lleva NADA del cliente**: `tickets/<ticketId>/<randomBytes(16)>.<ext>`, molde
`MediaService`. El nombre original se guarda en su columna, que es donde un dato del cliente
puede vivir sin ser una ruta. Y el `key` **no viaja en el payload del hilo** (`ATTACHMENT_SELECT`
lo excluye): el frontend pide el fichero por su id.

**ORDEN DE OPERACIONES, y cada paso está probado:**
1. **Autorizar primero.** `prepare()` se llama DESPUÉS de los guards de propiedad, puerta de
   facturación y estado. Subir antes convertiría el endpoint en almacenamiento gratuito
   escribible por cualquiera con un id ajeno — hay un test que espía `R2Service.upload` y exige
   que no se llame en el 403.
2. **Validar todo antes de subir nada.** Un lote con un fichero inválido no deja los válidos a
   medias en el bucket.
3. **R2 no es transaccional.** Los ficheros ya están arriba cuando empieza la transacción del
   mensaje; si esta falla, `persistOrDiscard` los borra. Al revés (escribir y luego subir)
   dejaría filas apuntando a objetos inexistentes: un adjunto que el usuario ve y que da error.

**DOS LÍMITES POR CADA REGLA, y la distinción importa**: la regla de negocio la aplica el
servicio con un 422 que dice cuál se ha pasado (`ATTACHMENT_TOO_LARGE`,
`ATTACHMENT_TYPE_NOT_ALLOWED`, `TOO_MANY_ATTACHMENTS`); los `limits` de multer son un TOPE DE
MEMORIA holgado por encima, porque multipart no pasa por el límite de body de Express y sin
ellos una petición de 1 GB se buffearía entera antes de que ningún código nuestro opinara.

**DEFENSA 6 de la invariante de notas internas — el adjunto hereda la privacidad del mensaje.**
El endpoint de usuario responde **404** al adjunto de una nota interna, no 403: un 403
confirmaría que ahí hay algo, y la EXISTENCIA de una nota es precisamente lo que el usuario no
puede llegar a saber (§10.3). Misma razón por la que una nota no toca `lastMessageAt` ni el
contador de no leídos. Para un ticket ajeno sí es 403 «este ticket no es tuyo», que es la
respuesta que ya daban `getForUser` y `getInvoicePdf`.

**El guard de facturación se EXTRAJO a `tickets.guards.ts`** (`assertCanHandleTicket`) porque
el servicio de adjuntos también lo aplica: un MODERATOR no descarga el fichero de un hilo que no
puede abrir. Una autorización copiada en dos sitios diverge en uno de los dos;
`TicketsService.assertCanHandle` ahora delega, con el mismo code, mensaje y 403 que en R3.

**El nombre original es ENTRADA HOSTIL, y esto es nuevo respecto a la factura**: `getInvoicePdf`
compone su nombre en el servidor, así que nunca tuvo el problema; aquí lo elige quien sube y
acaba en una cabecera HTTP. Dos capas: se sanea al ENTRAR (fuera separadores de ruta,
caracteres de control y comillas — un `\r\n` es inyección de cabeceras) y se codifica al SALIR
(`filename=` ASCII + `filename*=UTF-8''` RFC 5987, siempre `attachment`, nunca `inline`).

**BORRADO (punto abierto del encargo): no aplica hoy, y queda documentado.** No existe ningún
endpoint que borre un `Ticket` ni un `TicketMessage` —comprobado: cero `@Delete` en el módulo y
cero llamadas a `delete` sobre esas tablas—, así que no hay camino por el que un adjunto
desaparezca en uso normal. El único borrado posible es en cascada al borrar un `User`, que
tampoco tiene endpoint. Si algún día se añade cualquiera de los dos, **el fichero de R2 habrá
que borrarlo explícitamente** (`r2.delete`, como ya hace `persistOrDiscard`): la cascada de
Prisma limpia las filas, no el bucket. Se deja **inventariado y no resuelto** a propósito —
inventar un recolector de basura para un borrado que no existe sería código sin caso de uso, y
el proyecto ya tiene esta misma deuda con `media` (ninguna imagen de anuncio se borra de R2
tampoco). Anotado en §3.

**Frontend**: selector de ficheros en las dos cajas de respuesta, adjuntos en las burbujas del
hilo, y descarga por `fetch` autenticado → blob → click sintético (molde exacto de la descarga
de facturas en `FacturasPanel`). **No hay `<img src>` ni `<a href>` al fichero, y no es un
olvido**: no existe URL que poner ahí. El coste —no se pueden pintar miniaturas sin
descargar— es real y asumido a cambio de que un adjunto no sea un enlace reenviable. La
validación de cliente (`components/tickets/attachments.ts`, 22 tests unitarios) refleja los tres
límites del backend y traduce sus tres `code` con los MISMOS textos, para que forzar la petición
no produzca un mensaje distinto del que ya se habría visto sin salir del navegador.

**Verificación** — `tickets-attachments.e2e-spec.ts`, **29 casos, fichero nuevo**, contra MinIO
de verdad: se sube, se baja y se compara byte a byte. Ataques ejercidos: adjuntar a un hilo
ajeno (403 + `upload` no llamado), descargar el adjunto de otro (403), colgar un id de adjunto
ajeno de un ticket propio (404 — sin esa comprobación el control de propiedad miraría mi ticket
y serviría el fichero de otro), descargar el adjunto de una nota interna (404), y la puerta de
facturación en las dos direcciones (MODERATOR 403 / ADMIN 200). Más 2 casos de navegador
(`e2e/tickets-adjuntos.spec.ts`, con `pro-e2e` para no gastar el cupo de tickets de
`seller-e2e`) y 22 unitarios de la validación de cliente.

**Mutación (5/5 en rojo, revertidas):** quitar la revalidación de dueño en la descarga → 1;
servir el adjunto de una nota interna al usuario → 1; construir la clave con el nombre del
cliente → 2; exponer `key` en el payload del hilo → 2; subir antes de autorizar → 1.

**DOS HALLAZGOS DE LA RÁFAGA, los dos por hacer el trabajo de verdad:**

1. **Un test mío pasaba por mérito ajeno.** El caso de *path traversal* (`../../../etc/passwd.png`)
   pasaba... porque la librería cliente de multipart recorta el nombre a su basename antes de
   enviarlo: el nombre hostil no llegaba nunca a nuestro código. Se detectó al mutar la
   construcción de la clave y ver que ese test **no** enrojecía. Reescrito para llamar a
   `prepare()` con un `Multer.File` fabricado a mano, y entonces sí muerde. Lección
   reutilizable: un test de saneado que pasa por una librería intermedia puede estar
   comprobando la librería, no la defensa.
2. **Un fallo real de producto que solo vio el navegador.** Tras enviar, el usuario no veía su
   propio adjunto hasta recargar: `writeMessage` devolvía el mensaje sin `include` de
   adjuntos, y el frontend añade al hilo exactamente lo que responde el POST. Por HTTP y en
   base de datos todo estaba correcto — los 29 e2e de backend estaban verdes. Corregido con el
   `include` en la creación.

### Notificaciones de moderación (§14.5) — CIERRA LOS DOS HUECOS QUE NO ERAN DE TICKETS

Los dos huecos que destapó la auditoría inicial del sistema de atención al usuario y que
**no** se resolvían con tickets: la moderación **no avisaba a nadie**. Al denunciante no se le
decía en qué acabó su denuncia, y a un vendedor le retiraban el anuncio del marketplace sin
una palabra — simplemente desaparecía.

**Servicio aparte: `ModerationNotificationsService`**, mismo molde que
`TicketNotificationsService`. "A quién se le cuenta qué" es una preocupación distinta de "qué
decide la moderación", y mantenerla fuera es lo que permite que `ModerationService` conserve
su lógica **literalmente intacta**: su diff es de **30 líneas añadidas y 0 tocadas** (un
import, un parámetro de constructor y seis llamadas `await this.notify.*`, todas DESPUÉS de
que la acción persista). Sus 45 tests e2e siguen verdes **sin editarse**.

**Seis avisos, tres tipos de `Notification`, cero migraciones** (`type` es `String`):

| Acción | Destinatario | Tipo | Email |
|---|---|---|---|
| `resolveReport` / `dismissReport` | denunciante | `REPORT_RESOLVED` (`outcome`) | no |
| `rejectListing` / `deactivateListing` / `restoreListing` | vendedor | `LISTING_MODERATED` (`action`) | **sí** |
| `deleteReview` | autor de la valoración | `REVIEW_MODERATED` | no |

**Dos avisos van más allá de lo auditado, y a propósito.** `restoreListing` porque avisar solo
de lo malo es media conversación: si al vendedor se le dijo que le retiraban el anuncio, hay
que decirle también que vuelve. Y `deleteReview` porque es un borrado **físico e irreversible**
de algo que el usuario escribió; el aviso se construye con la fila cargada ANTES del `delete`,
que es la única forma de tener el dato.

**Solo `LISTING_MODERATED` lleva email.** Es el único caso en que el usuario pierde (o
recupera) presencia en el marketplace y tiene algo que hacer — corregir y reenviar —, y puede
tardar días en entrar. Los otros dos son informativos y no admiten réplica: un correo de
"hemos borrado lo que escribiste" invita a discutir algo que ya no tiene vuelta atrás.

**La regla de supresión, y su límite exacto: a nadie se le avisa de SU PROPIA acción**
(`esSuPropiaAccion`, comparación destinatario == actor). Es la única supresión. Denunciar tu
propio anuncio y que **otro** admin lo retire sí genera los dos avisos: son eventos distintos,
de acciones distintas y con enlaces distintos, y fundirlos ocultaría información.

**Snapshot autocontenido, igual que en tickets:** nombres **ya resueltos** y títulos
congelados, nunca ids ni punteros. El aviso de moderación sobrevive al borrado posterior del
anuncio; probado.

**Verificación** — `moderation-notifications.e2e-spec.ts`, **18 casos, fichero NUEVO**
(`moderation.e2e-spec.ts` no se tocó). Los tres tipos de denuncia (anuncio / valoración /
usuario), las tres acciones sobre anuncio, los dos destinatarios sin cruzarse, la supresión y
su límite, y que un guard de estado que rechaza la acción **no** deja notificación.
**Mutación (4/4 en rojo, revertidas):** guardar el id en vez del nombre resuelto → 1 rojo;
quitar la supresión de acción propia → 1; id en vez de nombre en el aviso de valoración → 1;
mover el aviso ANTES del guard de estado → **4 rojos**.

**Trampa de test encontrada, y es reutilizable.** Varios módulos (`contact`, `tickets` y ahora
`moderation`) registran la **misma cola por nombre**, y cada `registerQueue` crea su propia
instancia de `Queue`. `app.get(getQueueToken(QUEUE_NOTIFICATIONS))` devuelve *la primera que
encuentra*, que aquí **no** era la de moderación: el espía no veía los emails y —lo peligroso—
los asserts en negativo ("no se manda email") **pasaban vacíos, sin probar nada**. La suite
espía la cola que el servicio tiene **inyectada**. Cualquier suite futura que verifique emails
de un módulo con cola compartida debe hacer lo mismo.

---

## 3. Limitaciones conocidas y deuda técnica

### Atención al usuario — incrementos pendientes y deuda de test

Detalle completo en «Sistema de atención al usuario (tickets) — ESTADO CONSOLIDADO» (§2).
Resumen para no perderlo de vista:

**Deuda inventariada y NO resuelta (R5):** un adjunto de ticket que desapareciera de la base de
datos dejaría su objeto huérfano en R2. Hoy no puede pasar —no hay endpoint que borre tickets,
mensajes ni usuarios—, pero si se añade cualquiera de los tres habrá que borrar también del
bucket (`r2.delete`). Es la misma deuda que ya tiene `media` con las fotos de anuncio, y por eso
no se ha inventado un recolector para un borrado que no existe. Detalle en §2.

**Incrementos pendientes: NINGUNO.** R5 (adjuntos) y R9 (tiempo real, con el CORS del gateway
cerrado de paso) fueron las dos últimas; los huecos de §14.5 también están cerrados. El sistema
de atención al usuario está **COMPLETO** respecto a su diseño — ver §2.

**Deuda REAL que sí queda, NINGUNA de tickets — las tres anotaciones vivas:**
- **`app.enableCors()` sin argumentos en `main.ts` (y en `createTestApp`) abre la API HTTP a
  cualquier origen.** Es la otra mitad del mismo problema que R9 cerró en el gateway, y salió
  en su auditoría. **No se tocó a propósito**: su radio de explosión es toda la API (no un
  gateway), y meterlo en la misma ráfaga habría roto justo la lección de los dos pasos —si algo
  se cae, no sabrías cuál de los dos cambios fue. Merece su propia ráfaga con su propia
  verificación. Nota: como en el gateway, no es el control de acceso (que es el JWT), y el CORS
  no protege de un cliente que no sea un navegador.
- **`mensajeria-unificada.spec.ts` tiene un caso ROJO PREEXISTENTE** (línea ~241: el badge de
  no leídos no llega a mostrar `4` tras recibir un mensaje estando en la bandeja). Verificado
  en HEAD limpio, con y sin el CORS restringido: **no es de R9**. El resto del test —incluida
  la llegada de mensajes por socket en tiempo real, líneas 225-226— pasa, así que la conexión y
  el transporte funcionan; lo que falla es el contador. Sin diagnosticar ni arreglar aquí:
  toca semántica de no leídos de mensajería, ajena a esta ráfaga.

**Deuda de test/tooling asociada:**
- **`queue-retry › "Retry real"` es flaky** por timing de indexación de Meilisearch; los 14
  estructurales de esa suite sí son fiables. Preexistente, no es regresión de tickets.
- **✅ RESUELTA en R9 — Playwright y la batería e2e de backend ya no pueden correr a la vez.**
  Comparten `marketplace_test` y Redis db 1, y cada uno resiembra o trunca a mitad del otro,
  con síntomas que engañan (403→200 en `rf7-limits`, "sesión no establecida" en el
  `globalSetup`). Fue el fallo que más veces se repitió en este sistema — tres— porque la
  mitigación era "acordarse", que no es un mecanismo. Ahora hay un **candado compartido**
  (`apps/api/test/e2e-lock.js`, cogido por los dos `globalSetup` y liberado en los dos
  `globalTeardown`): la segunda corrida **aborta al instante** diciendo qué está en marcha, con
  qué PID y desde cuándo. Un candado huérfano (Ctrl-C, crash) se detecta por el PID y se rompe
  solo, así que nunca deja el proyecto bloqueado. Detalle en «R9 — tiempo real» (§2).
- **`admin-roles.spec.ts` afirma el número exacto de ítems del nav**: frágil por diseño, pero
  llegó a estar desactualizado en 2 sin que nadie lo notara. Al tocar `AdminNav`, actualizar
  las tres cuentas.

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

### Auditoría — Mensajería, ciclo de vida (producto/servicio) y reputación (2026-07-16)

**Diagnóstico, sin arreglar.** Verificado ejerciendo (2 usuarios, 1 anuncio PRODUCT, 1
anuncio SERVICE, conversaciones y valoraciones reales) sobre los tres sistemas que se
condicionan entre sí en este orden: **mensajería → ciclo de vida → reputación → cómo se
muestra**. El cambio Producto/Servicio (R0-R5, ver «Cambio cerrado — Producto/Servicio»
más abajo) fue deliberadamente acotado a atributos: *"precio, envío, estado y flujos de
publicación siguen igual"*. Esta auditoría es el mapa de dónde ese trato único (mismo
ciclo de vida para ambos tipos) empieza a fallar para servicio.

**Hallazgo central (incoherencia producto/servicio):** marcar un anuncio SERVICE como
`SOLD` es un callejón sin salida. Verificado en vivo: `markAsSold()` no distingue tipo,
saca el anuncio de la búsqueda pública, `CONTACTABLE_STATUSES` bloquea nuevas
conversaciones sobre él, y ninguna transición existente (`reserve()` solo acepta
`ACTIVE`, `renew()` solo `ACTIVE`/`EXPIRED`) puede reactivarlo. Un fontanero que cierra
un cliente y pulsa "Marcar vendido" (mismo botón, mismo label que en un producto —
`MyListingCard.tsx`) pierde el anuncio entero para el resto de clientes, sin forma de
deshacerlo. No existe ningún concepto de "cerrar un trato con este cliente sin
despublicar" — el modelo de datos sí soportaría varios compradores por anuncio
(`Conversation` es única por `[listingId, buyerId]`, no por `listingId`), pero esa
capacidad queda anulada porque la única acción de cierre disponible es global.

**Bug independiente:** `markAsSold()` no comprueba el estado previo del anuncio —
verificado marcando `SOLD` un anuncio `DRAFT` nunca publicado. Aplica a ambos tipos.

**Reputación — funciona, pero por un atajo que tiene coste propio:** la elegibilidad
para valorar (`ReviewsService`) no depende de `Listing.status`, solo de que exista una
`Conversation` entre autor y objetivo. Esto es lo que salva a los servicios (si
exigiera `SOLD`, nunca serían valorables dado el punto anterior), pero verificado en
vivo: un solo mensaje de "¿sigue disponible?" sobre un anuncio `ACTIVE` nunca vendido ya
deja `canReview: true` — cero prueba de trato real. Autovaloración, doble valoración y
valorar sin conversación previa sí están correctamente bloqueados (verificado). No hay
notificación que pida la valoración al cerrar un trato — es 100% self-serve desde el
chat (`ChatClient.tsx`).

**Escaparate:** el perfil público (`/vendedor/[slug]`) muestra media/conteo/distribución
correctos, con estado vacío (0 valoraciones) bien manejado — verificado. Las cards de
listado y la ficha de anuncio (`SellerCard`) **no muestran rating en ningún punto**, solo
el badge "de confianza" (flag manual de admin, no derivado de reviews) — la reputación
solo es visible si el comprador visita el perfil por separado.

**Mensajería:** funciona de punta a punta (verificado con envío bidireccional, bandeja
con `unreadCount`, marcado de leído implícito al abrir). Estructura actual de cara a
"unificar bandeja y chat": hoy son dos rutas Next.js separadas (`/mensajes` lista,
`/mensajes/[id]` chat), navegación de página completa, sin split-view. Sin endpoint de
borrado de mensaje/conversación (incompleto, no bloqueante).

**Orden recomendado para las próximas ráfagas** (por dependencia, no arreglar fuera de
orden):
1. **Ciclo de vida primero.** Definir semántica de "cerrar un trato" por tipo — producto
   conserva su flujo actual; servicio necesita una acción que no despublique ni bloquee
   nuevas conversaciones. Incluye el fix de la guarda de estado ausente en `markAsSold()`.
2. **Reputación después.** Con una señal real de "trato cerrado" desde (1), endurecer la
   elegibilidad de valorar más allá de "hubo conversación" — hacerlo antes rompería la
   reputación de los servicios.
3. **Escaparate al final.** Mostrar rating en cards solo tiene sentido una vez que (2)
   garantiza que el agregado refleja tratos reales, no simples preguntas de
   disponibilidad.
4. **Mensajería no bloquea** — única precaución: si se unifica bandeja+chat, preservar el
   hook de elegibilidad que hoy vive en `ChatClient.tsx`, del que depende el botón
   "Valorar".

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

## Ciclo de vida — RÁFAGA 1: entidad `Deal` (cerrada)

**✅ CERRADA** (2026-07-16, diseño e implementación en la misma sesión, verificada
ejerciendo — no solo tests). Continúa
donde el cambio Producto/Servicio (R0-R5, arriba) se detuvo a propósito: aquel cambio solo
tocó atributos, dejando explícito que *"precio, envío, estado y flujos de publicación
siguen igual"*. La auditoría de mensajería/ciclo de vida/reputación (§3, "Auditoría —
Mensajería, ciclo de vida...") encontró que ese trato único rompe a los SERVICE: marcar
`SOLD` los saca del catálogo, bloquea conversaciones nuevas y no tiene transición de
vuelta. Esta ráfaga cierra ese hueco.

**Decisiones de producto (Ernest):** PRODUCTO se agota al vender (un comprador, anuncio →
`SOLD`, desaparece). SERVICIO cierra VARIOS tratos, cada uno con su comprador, y
**nunca** llega a `SOLD` por cerrar un trato — sigue `ACTIVE`. Ambos registran quién fue
el comprador/cliente (hoy no existe ese dato en ningún sitio).

**Entidad nueva — `Deal`** (no reutiliza `Transaction`, que es solo facturación de
plataforma): `listingId` nullable + `onDelete: SetNull` + `listingTitle` snapshot —
mismo molde que `Review`, porque un `Deal` es evidencia de reputación para la ráfaga 2 y
no debe desaparecer si el anuncio se borra después. `sellerId`/`buyerId` denormalizados
(mismo criterio que `Conversation.sellerId`, ya derivable pero guardado aparte). Sin
constraint de unicidad — un mismo cliente puede repetir trato con el mismo servicio.
`conversationId` opcional: **el backend lo determina buscando `Conversation.findFirst({
listingId, buyerId })` — nunca lo acepta del cliente**, para que no pueda fabricarse un
`Deal` con apariencia de "verificable" adjuntando una conversación arbitraria.

**Acción de cierre — `POST /listings/:id/deals { buyerId }`**, ramificada por
`ListingType` en el servicio (mismo criterio que `validateListingTypeAllowed` en
creación): PRODUCTO → `Deal` + `status = SOLD`; SERVICIO → `Deal`, `status` siempre
`ACTIVE` (también si venía de `RESERVED` — "reservado" no tiene un significado claro de
"no acepto más clientes" para un servicio). Guarda de estado añadida: solo desde
`ACTIVE`/`RESERVED` — cierra el bug confirmado en la auditoría (`markAsSold()` no
comprobaba el estado previo; un `DRAFT` podía marcarse `SOLD` directamente).
**Sustituye a `POST /listings/:id/sold`** (retirado — una acción, un camino, no dos en
paralelo).

**Selector de comprador — cualquier usuario, no solo contactos.** Decisión explícita de
Ernest: además de los contactos del anuncio (`GET /listings/:id/contacts`, quick-pick,
el caso común), un buscador (`GET /users/search?q=`, rate-limited, solo devuelve
`{id,name,slug,avatarUrl}` ya públicos) permite elegir a cualquier usuario — cubre tratos
cerrados por teléfono o en persona. Consecuencia anotada para la ráfaga 2: un `Deal` sin
`conversationId` es una afirmación del vendedor, no una interacción verificable — si la
ráfaga 2 exige `Deal` para valorar, puede querer distinguir ambos casos.

**Deshacer — ventana de 72h**, mismo molde que editar/borrar `Review`.
`DELETE /listings/:id/deals/:dealId`, solo el vendedor, solo dentro de 72h desde
`createdAt`. Para PRODUCTO revierte `status → ACTIVE` en la misma transacción que borra
el `Deal` (si no, el anuncio queda fuera del catálogo sin ningún `Deal` que lo explique).

**Sin contactos → fallback explícito** "marcar vendido/cerrado sin comprador
registrado" (no crea `Deal`) — evita bloquear anuncios sin conversaciones.

**Migración:** aditiva, sin backfill. Los `SOLD` históricos quedan sin `Deal` (no se sabe
a quién se vendieron) — documentado como límite aceptado, no como deuda.

**Fuera de alcance, señalado para la ráfaga siguiente:** no existe ningún estado
`PAUSED`/`ARCHIVED` — la única forma de retirar un anuncio sin vender es el borrado
físico (`remove()`), destructivo (borra también las conversaciones vía
`Conversation.listing onDelete: Cascade`). Sin un estado de pausa, un SERVICIO no tiene
ningún offramp no destructivo una vez que "vender" deja de despublicarlo. Prioridad alta
para la próxima ráfaga.

**Implementado y verificado ejerciendo** (2 vendedores/compradores reales, un PRODUCT y
un SERVICE reales, contra la API en marcha — no solo tests):
- Migración aditiva `20260716183829_deal_entity` — modelo `Deal`, sin backfill.
- `POST /listings/:id/deals` `{ buyerId? }`, `GET /listings/:id/deals`,
  `DELETE /listings/:id/deals/:dealId`, `GET /listings/:id/contacts`,
  `GET /users/search?q=` (rate-limited, 30/h). `POST /listings/:id/sold` retirado.
- **Bug de guarda de estado cerrado**: un `DRAFT` nunca publicado ya no puede cerrar un
  trato (antes se marcaba `SOLD` sin más) — verificado, 400.
- **PRODUCTO**: `closeDeal` con comprador de una conversación real → `Deal` con
  `conversationId` enlazado, anuncio → `SOLD`, desaparece de la búsqueda pública
  (verificado 404). Deshacer dentro de 72h revierte a `ACTIVE` y borra el `Deal`
  (verificado); fuera de la ventana (`createdAt` forzado a 73h), 403 (verificado).
- **SERVICIO**: 3 tratos consecutivos con 3 clientes distintos sobre el mismo anuncio →
  siempre `ACTIVE`, sigue indexado (200 público) y sigue aceptando conversaciones nuevas
  de un 4º cliente (verificado) — cierra el callejón sin salida encontrado en la
  auditoría. Cerrar un trato desde `RESERVED` también deja el status en `ACTIVE`
  (verificado). Sin `buyerId` → 400 (verificado).
- **El backend enlaza `conversationId`, nunca el cliente**: verificado en dos capas —
  enviar `conversationId` en el body es rechazado (400, `whitelist` del DTO no lo admite)
  y, con un comprador sin conversación real (elegido por `GET /users/search`), el `Deal`
  queda con `conversationId: null` en vez de aceptar cualquier valor.
- Suites e2e actualizadas y en verde: `listings.e2e-spec.ts` (34/34, incluye 7 tests
  nuevos de `Deal`), `alert-matching.e2e-spec.ts`, `messaging.e2e-spec.ts`,
  `reviews.e2e-spec.ts` (65 tests en total, sin tocar estos dos últimos — verificación de
  no regresión).
- Frontend: `MyListingCard` ramifica el botón por `listing.type` ("Marcar vendido" /
  "Registrar cliente") con `CloseDealDialog` (contactos + buscador libre). Verificado con
  un render SSR real y autenticado de `/mis-anuncios` (sesión next-auth real, no mock):
  ambos labels aparecen correctamente para un PRODUCT y un SERVICE de prueba, sin errores
  de aplicación.

---

## Ciclo de vida — RÁFAGA 2: pausar y archivar (cerrada)

**✅ CERRADA** (2026-07-16, misma sesión que RÁFAGA 1 — diseño, implementación y
verificación ejerciendo, no solo tests). Cierra el hueco que dejó abierto la ráfaga
anterior: "marcar vendido" dejó de despublicar un SERVICE, y la única forma de retirar
un anuncio sin vender seguía siendo `remove()` — borrado físico que además destruye las
conversaciones (`Conversation.listing onDelete: Cascade`).

**Estados nuevos** (migración aditiva `20260716191816_pause_archive_states`, sin
backfill): `PAUSED` (temporal, reactivable, ambos tipos) y `ARCHIVED` (permanente,
irreversible, ambos tipos, no destructivo — conserva conversaciones/tratos/valoraciones).

**Hallazgo clave de la fase de diseño, confirmado en vivo antes de escribir código**: casi
toda la superficie que esta ráfaga "necesitaba" ya excluía por construcción cualquier
`status` que no fuera `ACTIVE`/`RESERVED` — la cuota de 5 activos
(`checkActiveListingLimit`, cuenta `status: 'ACTIVE'` literal), el índice de Meilisearch
(`indexListing` saca cualquier `status !== 'ACTIVE'`), las conversaciones nuevas
(`CONTACTABLE_STATUSES`) y `closeDeal()`. Verificado en vivo con la cuota llena (5
activos): reservar uno la libera sin tocar código — confirma que `PAUSED`/`ARCHIVED` la
liberarían igual, sin ningún cambio en `checkActiveListingLimit`.

**Grafo de transiciones:**
```
ACTIVE  →(pause)→      PAUSED
PAUSED  →(reactivate)→ ACTIVE   [recalcula expiresAt, exige cuota — igual que renew()]
{ACTIVE, PAUSED, SOLD, EXPIRED, REJECTED} →(archive)→ ARCHIVED   [irreversible]
```
`pause()` solo desde `ACTIVE` (ni `RESERVED` — negociación abierta, ni
`DRAFT`/`PENDING_REVIEW` — nunca publicado). `reactivate()` solo desde `PAUSED`,
recalcula `expiresAt` desde el momento de reactivar (el cron de expiración solo consulta
`status='ACTIVE'`, así que un `PAUSED` es invisible para él por construcción — no hace
falta "congelar" nada, solo recalcular al volver) y llama a `listingBecameActive()`
(reindexa + alimenta el matching de alertas, ahora en la lista de 4 caminos junto a
publish/renew/restore). `archive()` excluye `DRAFT`/`PENDING_REVIEW` (nada publicado
aún) y `RESERVED` (dejaría un trato colgado sin resolver).

**Endpoints** (owner-only, molde de `reserve`/`closeDeal`, sin `AuditLog` — reservado a
acciones de admin sobre recursos ajenos, no a acciones del dueño sobre lo suyo):
`POST /listings/:id/pause`, `POST /listings/:id/reactivate`, `POST /listings/:id/archive`.

**`/mis-anuncios`**: "Todos" (sin filtro) ahora excluye `ARCHIVED` explícitamente en
`findMine()` — un archivado ya está cerrado para el vendedor, solo aparece en su propia
pestaña. `PAUSED` sí sigue apareciendo en "Todos". Dos pestañas nuevas ("Pausados",
"Archivados"), mismo patrón que las 6 ya existentes.

**Implementado y verificado ejerciendo** (usuarios reales contra la API en marcha):
- **Pausar**: `ACTIVE → PAUSED`, sale del índice (404 público) — verificado. Con la cuota
  de 5 activos llena, pausar uno permitió publicar un 6º — verificado. Conversación
  existente sigue accesible y se le puede seguir escribiendo estando pausado (verificado);
  un tercero no puede iniciar una nueva (400, verificado).
- **Reactivar**: `PAUSED → ACTIVE`. Con `expiresAt` forzado a 5 días en el pasado (simula
  "llevaba tiempo pausado"), reactivar lo recalculó a ~60 días desde ahora — NO expira en
  &lt;24h (verificado). Con la cuota llena, reactivar devolvió 403 (verificado); liberada
  la cuota, reactivar funcionó y el anuncio volvió a ser público (200, verificado).
- **Archivar**: irreversible — intentar `pause`/`reactivate`/`archive` de nuevo sobre un
  `ARCHIVED` devuelve 400 en los tres casos (verificado). Aceptado desde `ACTIVE`,
  `PAUSED`, `SOLD`, `EXPIRED` y `REJECTED` (verificado los 5); rechazado desde `DRAFT` y
  `RESERVED` (verificado ambos).
- **`undoDeal` tras archivar**: un PRODUCTO vendido (`SOLD`) y luego archivado, al
  deshacer el trato dentro de 72h, borra el `Deal` pero el status se queda en `ARCHIVED`
  (NO revive a `ACTIVE`) — verificado. Archivar ya es la decisión final del vendedor;
  deshacer el trato después solo "olvida" al comprador.
- Suites e2e en verde: `listings`, `alert-matching`, `messaging`, `reviews` (65 tests,
  sin tocar los dos últimos — no regresión).
- Frontend: badges "Pausado"/"Archivado", botones "Pausar"/"Reactivar"/"Archivar" (este
  último con confirmación vía `AlertDialog`, mismo componente que ya usaba "Eliminar"),
  pestañas "Pausados"/"Archivados", "Editar" ahora también disponible en `PAUSED`.
  Verificado con un render SSR autenticado real de `/mis-anuncios` (sesión next-auth
  real): los 6 textos nuevos aparecen, sin errores de aplicación.

**Deuda conocida documentada, NO resuelta en esta ráfaga** (hallazgos colaterales de la
observación, señalados para no sorprender más adelante):
- **`RESERVED` no tiene ninguna salida hacia `ACTIVE`** salvo `closeDeal()` — y para
  PRODUCTO `closeDeal()` siempre fuerza `SOLD`. Si un trato se cae estando reservado, no
  hay forma de cancelar la reserva y volver a publicarlo. Pre-existente a esta ráfaga (no
  la introduce `PAUSED`/`ARCHIVED`); candidato a una futura ráfaga menor.
- **Archivar un `REJECTED` deja a la moderación sin `restoreListing()`** — esa acción de
  admin exige `status === 'REJECTED'` para restaurar; si el dueño archiva primero, el
  admin ya no lo encuentra ahí. Comportamiento aceptado (el dueño ya pasó página), pero es
  una interacción nueva entre acción de dueño y moderación que no existía antes de esta
  ráfaga — documentado para que no sorprenda.

---

## Reputación — RÁFAGA 3: elegibilidad basada en Deal (cerrada)

**✅ CERRADA** (2026-07-16, misma sesión que RÁFAGA 1/2 — auditoría, diseño,
implementación y verificación ejerciendo). Cierra el desajuste que dejaron las dos
ráfagas de ciclo de vida: la elegibilidad de valorar seguía mirando `Conversation`
(anterior a que existiera `Deal`), así que un trato real y cerrado (declarado, sin
conversación) **no** habilitaba valorar, mientras que un simple "¿sigue disponible?" sin
ningún trato **sí** lo hacía. Verificado en vivo antes de tocar código, ambos sentidos.

**Campo nuevo — `Review.verified`** (migración aditiva, `@default(true)`: grandfathering
automático de las reseñas existentes, sin backfill manual). Congelado al crear, nunca
recalculado — ni por `edit()`, ni por ningún otro endpoint. `true` si en el momento de
crear existía al menos un `Deal` verificable (`conversationId != null`) entre autor y
objetivo sobre ese listing.

**Elegibilidad migrada de `Conversation` a `Deal`** en `ReviewsService.create`/
`getEligibility` — cualquier `Deal` (verificable o declarado) habilita valorar;
`wouldBeVerified` se expone en la elegibilidad para que la UI lo anticipe antes de enviar.

**Relación Review↔Deal — decisión de diseño clave, evaluada y descartada la alternativa
más obvia**: NO se añadió `dealId` a `Review`. Se mantiene
`@@unique([authorId, targetId, listingId])` tal cual (una review por par por listing,
sin importar cuántos `Deal` haya entre ellos) — anclar a un `Deal` concreto (`dealId` +
`unique[authorId, dealId]`) habría permitido a un cliente recurrente valorar cada trato
por separado, pero `Deal` no tiene límite de repetición (RÁFAGA 1: "un mismo cliente
puede repetir trato con el mismo servicio"), así que esa alternativa abría la puerta a
multiplicar el peso de una review repitiendo tratos con el mismo par. Verificado en vivo:
un segundo `Deal` sobre el mismo par no habilita una segunda review (409).

**Media/count/distribution solo cuentan `verified: true`**; `items` (la lista pública)
muestra todas, cada una con su `verified`, con `unverifiedCount` aparte para no mezclarlas
con la puntuación de confianza. Verificado: sockpuppet con `Deal` declarado consigo mismo
no mueve la media del vendedor (sigue en la misma cifra, solo sube `unverifiedCount`).

**Notificación + email al cerrar un `Deal`** — `REVIEW_REQUEST` (in-app,
`NotificationsService.createNotification`) + email (Resend, cola `QUEUE_NOTIFICATIONS`,
mismo patrón que `ContactService.submitMessage()`), bidireccional a ambas partes, sin
deduplicar entre `Deal`s distintos del mismo par (cada trato es un evento real nuevo).
El fallback "sin comprador" de PRODUCTO no dispara nada (no hay a quién avisar).

**Punto de entrada nuevo en el frontend, no anticipado en el diseño original**: un `Deal`
declarado no tiene ninguna `Conversation` asociada, así que el botón "Valorar" que ya
vivía dentro de `ChatClient.tsx` nunca podría mostrarse para ese caso. Se añadió
`ValorarDesdePerfil` en `/vendedor/[slug]`, activado solo por el deep-link que manda la
notificación (`?valorar=<listingId>&target=<userId>`) — mismo patrón de 3 estados
(Valorar / Editar valoración / Ya valoraste) que `ChatClient`, reutilizando `ReviewModal`
tal cual.

**Implementado y verificado ejerciendo** (5 usuarios reales, un SERVICE real, contra la
API en marcha):
- Desajuste arreglado: `Deal` declarado (sin conversación) → `canReview: true`,
  `wouldBeVerified: false`; conversación sin ningún `Deal` → `canReview: false` (inverso
  del hallazgo original de la auditoría).
- `verified` congelado: review sobre `Deal` verificable → `true`, cuenta para la media;
  sobre `Deal` declarado → `false`, aparece en la lista etiquetada pero no cuenta. Una
  review ya creada como `false` cuya autora luego SÍ conversa con el vendedor sigue
  `false` — no se recalcula (verificado creando la conversación después y releyendo la
  fila).
- Media solo verificadas, `unverifiedCount` refleja el resto; el intento de un vendedor
  de fabricar un `Deal` declarado con una cuenta cómplice no subió su media (verificado).
- Una review por par pese a `Deal`s repetidos: segundo `Deal` con el mismo comprador →
  `alreadyReviewed: true`, segundo intento de crear review → 409 (verificado).
- Bidireccional: comprador y vendedor se valoraron mutuamente sobre el mismo `Deal`
  (verificado, ya funcionaba desde antes de esta ráfaga).
- Notificación + email verificados en ambas direcciones para cada `Deal` cerrado (3
  tratos distintos → 3 notificaciones al vendedor, sin deduplicar); el fallback de
  PRODUCTO sin comprador no generó ninguna. 6 emails reales enviados vía Resend,
  confirmados en el log del processor.
- Suites e2e actualizadas y en verde: `reviews.e2e-spec.ts` (con un bloque nuevo
  específico de esta ráfaga), `listings`, `alert-matching`, `messaging` (74 tests).
- Frontend: `ReviewsSection`/`ReviewCard` muestran el badge "No verificada" y el aviso de
  `unverifiedCount`; `ReviewModal` anticipa si la review será verificada o no antes de
  enviarla. Verificado con un render SSR autenticado real de `/vendedor/[slug]`.

**Deuda conocida documentada, NO resuelta en esta ráfaga**: **sesgo de represalia** en la
valoración bidireccional — sin revisión ciega (ocultar las reseñas hasta que ambas partes
hayan valorado, o hasta un plazo), cada parte puede ver la review de la otra antes de
escribir/editar la suya y ajustarla en consecuencia (p. ej. bajar la puntuación tras ver
una mala reseña recibida). Pre-existente a esta ráfaga (la bidireccionalidad ya existía),
no se introduce aquí ni se resuelve — candidato a una ráfaga futura si se decide que
merece la pena el coste de una revisión ciega.

---

## Escaparate — RÁFAGA 4: reputación donde el comprador decide (cerrada)

**✅ CERRADA** (2026-07-16, misma sesión que RÁFAGA 1/2/3 — medición, decisión de
arquitectura, implementación y verificación ejerciendo). Último punto del mapa de la
auditoría original: la reputación solo vivía en `/vendedor/[slug]`; ni las cards de
listado ni la ficha del anuncio mostraban una estrella — invisible justo en el momento en
que el comprador decide. Ahora que la media solo cuenta reviews **verificadas** (RÁFAGA
3), tenía sentido mostrarla donde se decide, no solo en el perfil.

**Medición ANTES de elegir arquitectura** (regla ya fijada por Ernest: ruido → on-the-fly;
caro → desnormalizar). Candidato medido: una única consulta `Review.groupBy(['targetId'])`
agrupada por los `sellerId` distintos de una página de listado (nunca N+1 por card — mismo
molde que `featuredMap`/`favoritesCountMap` ya usados en `findMine`).
- Volumen inicial: 150 vendedores, 5.877 reviews sintéticas → **~1.05ms** de media para una
  página de 32 vendedores distintos.
- Volumen 15× más pesado: 1.000 vendedores, 88.372 reviews (10% "power sellers" con 200-500
  reviews cada uno) → **~1.15ms** para 32 vendedores normales.
- **Peor caso adversarial**: los 40 vendedores más pesados de ese volumen (385-498 reviews
  cada uno) → **~2.83ms** de media (Prisma), **2.25ms** de ejecución real en Postgres
  (`EXPLAIN ANALYZE`), vía `Index Scan` sobre `Review_targetId_idx` — el índice ya
  existente, sin tabla nueva.
- Comparado con queries ya aceptadas como gratis en este mismo listado (`findRecent`-
  equivalente: ~0.59ms; el propio molde `favoritesCount` groupBy: ~0.55ms) — incluso en el
  peor caso, la nueva consulta es una milésima de segundo más, no un orden de magnitud más.

**Decisión: on-the-fly, sin desnormalizar** — ruido incluso 15× por encima del volumen
real y con vendedores adversarialmente pesados. Una sola fuente de verdad (la misma que ya
usa el perfil), cero riesgo de desincronización, cero test de invariante que mantener.

**Dónde se conecta la consulta** (todas comparten `ReviewsService.getRatingSummaries()`,
la misma función, sin duplicar la lógica de agregación):
- `SearchController.search()` — el choke point único de `/busqueda`, `/[categoria]`, la
  portada y los bloques de contenido (`resolve-listings.ts`), todos pasan por aquí. La
  media se mezcla DESPUÉS de leer los hits de Meilisearch, nunca dentro del propio
  documento indexado — a diferencia de `sellerName`/`sellerSlug`/`trusted` (que sí viven en
  el documento porque casi nunca cambian), la media cambiaría con cada review nueva y
  habría obligado a reindexar TODOS los anuncios de un vendedor en cada valoración — un
  coste de propagación de una naturaleza completamente distinta que se evita quedándose
  fuera del índice.
- `ListingsService.findRecent/findByCategory/findBySellerSlug` — mismo patrón Postgres
  (`SELECT_SUMMARY` ahora incluye `sellerId` para poder agrupar).
- `ListingsService.findBySlug` (ficha) — igual que `featuredUntil`: **siempre fresca,
  nunca dentro de la caché de 5 min de Redis** de la ficha (mismo criterio ya usado ahí).

**Frontend**: `SellerRatingInline` (`listing-card-shared.tsx`), un componente compacto
reutilizado en `ListingCard`, `ListingCardWide` y `SellerCard` — `count` en 0 (o `average`
null) → "Nuevo", nunca ★0,0. En la card, sin detalle (solo ★ + media); en la ficha,
`detailed` añade "· N valoraciones" — mismo dato, más contexto.

**Implementado y verificado ejerciendo** (3 vendedores — uno con review verificada, uno
con SOLO review no verificada, uno nuevo sin ninguna — reales contra la API en marcha):
- Vendedor con review verificada → `average: 5, count: 1` idéntico en perfil, ficha
  (`seller.ratingAverage`) y card (`GET /search`, `sellerRatingAverage`) — verificado en
  las tres respuestas.
- **El caso que conecta con la ráfaga anterior**: vendedor con SOLO una review NO
  verificada (trato declarado) → `ratingAverage: null, ratingCount: 0` en la ficha —
  verificado que NO se cuela como ★2,0 (su media cruda sin filtrar habría sido 2.0); el
  frontend lo interpreta como "Nuevo".
- Vendedor sin ninguna review → `null`/`0` en los tres sitios — "Nuevo".
- **Sin reindexar nada**: los tres anuncios se consultaron por Meilisearch (`GET /search`)
  inmediatamente después de publicarse, y la media ya aparecía correcta — confirma que no
  desnormalizar en el documento fue la decisión correcta (cero latencia de propagación).
- Suites e2e en verde: `search`, `search-images`, `search-facets-by-type`,
  `search-dynamic-attributes`, `search-card-attributes-not-filterable`, `reviews`,
  `listings`, `alert-matching`, `messaging` (109 tests, sin regresiones).

**Cierra el mapa de dependencias de la auditoría original** (mensajería → ciclo de vida →
reputación → escaparate): los cuatro puntos quedan cerrados.

---

## Mensajería — RÁFAGA 5: bandeja + chat unificados en split-view (cerrada)

**✅ CERRADA** (2026-07-17, misma sesión que RÁFAGA 1/2/3/4). Reestructuración de UI, no
arreglo de bug — la auditoría original ya había encontrado la mensajería sana. `/mensajes`
(bandeja) y `/mensajes/[id]` (chat) eran dos páginas independientes, cada una con su propia
conexión WebSocket; ahora son una sola vista de dos columnas (escritorio) o una columna con
navegación nativa (móvil, <768px), con una única conexión WebSocket compartida.

**Riesgo señalado explícitamente antes de implementar**: `ChatClient.fetchEligibility()` (el
botón "Valorar" de la RÁFAGA 3) no podía dejar de dispararse al cambiar de conversación.
Resuelto de forma **estructural**, no manual: `layout.tsx` de `/mensajes` vive por encima de
`page.tsx`/`[id]/page.tsx`, así que Next.js nunca lo remonta al navegar entre ambas rutas (la
lista y el socket sobreviven), mientras que `[id]/page.tsx` sigue siendo una ruta dinámica
distinta por cada `id` — se remonta con cada selección, así que el `useEffect(() => {
fetchEligibility() }, [])` ya existente de `ChatClient` se re-dispara solo, sin código nuevo
para ese caso concreto.

**Piezas nuevas**:
- `useMessagingSocket` (reescrito): conexión persistente keyed solo en `token` (no en
  `conversationId`) + `joinConversation(id)` imperativo que no fuerza reconexión — recuerda
  todas las salas unidas en la sesión para re-unirlas tras un reconnect.
- `MessagingSocketContext` + `MessagingSocketProvider`: única forma de cruzar la conexión
  compartida desde `MensajesShell` (Client Component) hacia `ChatClient`, que Next.js renderiza
  como Server Component hijo de `{children}` — Context no está bloqueado por ese límite RSC,
  paso directo de props sí.
- `MensajesShell`: grid responsive (`selectedId` derivado de `usePathname()`, no de props —
  un layout no recibe el segmento `[id]` de sus páginas hijas). Sin conversaciones,
  colapsa a un único panel a ancho completo en vez de dejar una columna de 22rem vacía.
- `ConversationList` (antes `BandejaMensajesClient`): consume `latestMessage` del Context en
  vez de abrir su propio socket; la fila seleccionada siempre muestra `unreadCount: 0` sin
  esperar ningún round-trip (cálculo puramente de presentación, el valor guardado real no se
  toca hasta que el servidor confirma el marcado como leído).
- `ChatClient`: el GET de fondo "marcar como leído" (para el caso de un mensaje que llega por
  socket con la conversación ya abierta) va **debounced 1200ms** y se omite por completo si la
  pestaña no está enfocada (`document.visibilityState`) — instrucción explícita de Ernest: una
  ráfaga de varios mensajes seguidos debía disparar una sola llamada, no una por mensaje.

**Bug real encontrado y arreglado durante la verificación** (no en el diseño, en el CSS):
`MensajesShell` combinaba una clase `flex` incondicional con `hidden`/`flex` condicional en el
mismo string de clases, para la misma propiedad `display`, a igual especificidad — en
escritorio no se notaba porque `md:flex` (con media query) siempre ganaba, pero en móvil (sin
esa media query de por medio) el orden interno del CSS generado por Tailwind decidía, y el
panel de chat podía quedar visible a la vez que la lista. Arreglado quitando el `flex`
incondicional de la clase base y dejándolo solo en la rama condicional — patrón a evitar en
el resto del proyecto: no mezclar una utilidad de `display` fija con una condicional para la
misma propiedad en el mismo nivel de especificidad.

**Verificado ejerciendo con navegador real** (Playwright, dos sesiones seller/buyer,
`e2e/mensajeria-unificada.spec.ts` — nuevo spec, permanente, no solo de esta sesión):
- `fetchEligibility`/"Valorar" con un `Deal` real, en la primera apertura y tras dos ciclos de
  ida-y-vuelta a la bandeja.
- Una sola conexión WebSocket real (contada vía `page.on('websocket')`) a lo largo de todo el
  recorrido — abrir, volver a la bandeja, reabrir, dos veces — confirma que
  `joinConversation` nunca reconecta.
- Refrescar (F5) se queda en la conversación abierta, no vuelve a la bandeja.
- Tiempo real: ráfaga de 3 mensajes seguidos visible en el seller con la conversación abierta;
  un 4º mensaje con la conversación cerrada actualiza el badge de la lista sin round-trip, y
  se pone a 0 al reabrir sin esperar ninguna llamada de red.
- El GET de fondo de "marcar leído" se disparó **exactamente una vez** para los 3 mensajes de
  la ráfaga (contado vía `page.on('request')`), confirmando el debounce.
- Móvil (375px): una sola columna a la vez, el botón atrás nativo del navegador vuelve a la
  bandeja sin código adicional (es una navegación real, no estado de cliente).
- Estado vacío sin conversaciones: a ancho completo, sin columna fija de 22rem sin sentido.
- Batería e2e de backend sin regresiones: `messaging` (7), `reviews` + `listings` (48) — cero
  cambios de backend en esta ráfaga, así que era una confirmación, no una sorpresa esperada.

**Deuda conocida, pre-existente y fuera de alcance**: `(account)/layout.tsx` (el menú lateral
de toda el área privada) no tiene ninguna clase responsive — el sidebar de 224px se mantiene
fijo incluso en móvil, comiéndose una fracción grande del viewport. La mensajería unificada
hereda esa limitación tal cual (no la agrava, no la corrige); en anchos muy estrechos (375px)
deja poco margen a la columna de conversaciones. Corregirlo es un cambio a nivel de todo el
área de cuenta, no específico de mensajería.

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

### Monetización — ráfaga 2: saldo de bumps, pack de bumps y cupones de bump (CERRADO)

Diseñado y aprobado explícitamente antes de implementar — documentación completa del diseño en
`diseno-facturacion.md` §17. Resumen de lo construido:

- **Saldo de bumps** (`Wallet.bumpBalance`, moneda separada de los créditos: gratuita,
  intransferible, específica de bumps). Ledger propio (`BumpLedger`/`BumpLedgerType`), mismo molde
  que `CreditLedger`. NO caduca (misma decisión que los créditos, con la puerta documentada si algún
  día hace falta). Débito atómico con el mismo patrón `UPDATE ... WHERE bumpBalance >= N` que ya
  usaba `balance` — sin lock nuevo.
- **Prioridad de consumo** en `BillingService.bump()`: se intenta primero `bumpBalance` (gratis,
  inmune a descuentos de campaña), y solo si no hay se cae a créditos (comportamiento previo
  intacto, con descuento de campaña si lo hay). La respuesta ahora incluye `paidWith` (
  `'BUMP_BALANCE' | 'CREDITS'`) y `cost`, para que la UI confirme sin ambigüedad qué se gastó.
- **Pack de bumps — Opción B** (decidida explícitamente: NO es una moneda nueva). Es un `CreditPack`
  normal (`highlightBumps: true`) que acredita créditos, no bumpBalance. El catálogo añade
  `bumpEquivalent = floor(creditAmount / bumpCreditCost)` calculado EN VIVO — nunca un texto fijo
  que pueda desincronizarse si `bumpCreditCost` cambia después. Un Pro que lo compra recibe el mismo
  +20% (§2.5) que cualquier otro pack, sin casuística especial. Sembrado en `seed.ts`/`seed-test.ts`
  ("Pack de bumps", 60 créditos / 4,99 €, mismo precio que el Pack Básico pero más créditos).
- **Cupones de bump**: `CouponRewardType.BUMP` + `Coupon.bumpAmount`, mismo molde exacto que
  `CREDITS`. Canje atómico dentro de la `$transaction` ya existente de `CouponsService.redeem()`.
  Disponible para cualquier usuario (Pro o no) — el sistema de cupones nunca ha distinguido plan.
  Admin CRUD ampliado (`/admin/coupones`, formulario con el campo condicional al tipo).
- **Histórico sin ambigüedad** (corrección incorporada al diseño antes de implementar): tanto
  `BumpLedger` como `CreditLedger` usan siempre `referenceType='Listing'` + `referenceId=<id>` para
  los débitos de bump — consultable por referencia, nunca por cercanía a `Listing.bumpedAt` (que
  solo guarda el último bump). Verificado con un test que bumpea el mismo anuncio dos veces, una vez
  por cada moneda, y localiza cada pago sin ambigüedad.
- **UI**: `MyListingCard` — el botón "Bump" anuncia de antemano si va a ser gratis ("Bump gratis (te
  quedan N)") leyendo el wallet; tras bumpear, confirma con qué se pagó. `/mis-creditos` — saldo de
  bumps SIEMPRE visible (aunque sea 0, mismo principio que el saldo de créditos), con su propio
  historial en una lista separada (decisión explícita: fusionar dos ledgers paginados de modelos
  distintos en una sola vista cronológica exigiría una consulta `UNION` a mano; con los volúmenes
  reales de esta moneda, dos listas independientes es la opción simple sin sacrificar corrección).
- **Deuda inventariada, no tocada**: la carrera de cooldown de bump (`listing.bumpedAt` leído fuera
  de la `$transaction`) sigue ahí, preexistente a esta ráfaga — señalada de nuevo al diseñar,
  deliberadamente fuera de alcance.
- **Fuera de esta ráfaga** (diferido explícitamente): pago con tarjeta para bump directo, reglas de
  cupón más ricas, bumps gratis automáticos para Pro.

**Verificado**: nuevo fichero `test/bump-balance.e2e-spec.ts` (12 tests) cubriendo, ejerciendo (no
declarando): atomicidad del débito bajo concurrencia real (dos bumps simultáneos con
`bumpBalance=1` compartido), idempotencia (reintento bloqueado por cooldown no debita dos veces;
canjear el mismo cupón BUMP dos veces no duplica el crédito), la prioridad de consumo en sus tres
variantes (con ambas monedas disponibles, solo créditos, saldo agotado a mitad de flujo), el
histórico sin ambigüedad por referencia, el cupón BUMP para un usuario no-Pro, la validación admin
del nuevo tipo de cupón, el bonus Pro del pack de bumps, y el recálculo en vivo de `bumpEquivalent`
al cambiar `bumpCreditCost`. Batería completa: 62 suites / 939 tests (1 test de un fichero no
relacionado —`redsys-featured-payment-e2e.e2e-spec.ts`— resultó flaky por timing de Meilisearch bajo
la carga de la pasada completa; 5/5 verde al re-ejecutarlo en aislado, no relacionado con esta
ráfaga). Typecheck de frontend limpio. QA en vivo con capturas Playwright: botón de bump consciente
del saldo en los dos estados (con/sin saldo), confirmación tras bumpear, saldo de bumps y pack de
bumps en `/mis-creditos`, canje de cupón en vivo, y el nuevo tipo de recompensa en el formulario de
cupones del backoffice.

### Monetización — ráfaga 3: cuota mensual de bumps para Pro (CERRADO)

Diseñado y aprobado explícitamente antes de implementar — documentación completa del diseño en
`diseno-facturacion.md` §18. Cierra el punto "bumps gratis automáticos para Pro" que la ráfaga 2
había diferido explícitamente. Réplica deliberada del molde de la cuota de destacados (H8.2/H8.3):

- **Nivel 1 de 3** en la prioridad de consumo del bump, insertado ANTES de `bumpBalance` (ráfaga
  2): cuota mensual Pro (gratis, se pierde si no se usa) → saldo de bumps por cupón (gratis,
  permanente) → créditos (de pago). Orden deliberado: se gasta primero lo más restringido.
- Setting `proMonthlyBumpQuota`, contada con el mismo mecanismo DERIVADO que
  `proMonthlyFeaturedQuota` (COUNT sin contador ni cron), pero sobre `BumpLedger{type:PRO_QUOTA}`
  en vez de `Entitlement` (los bumps no tienen entitlement propio). Las filas `PRO_QUOTA` llevan
  siempre `amount: 0` — marcador contable, no movimiento de `bumpBalance`; con `amount:-1` habrían
  roto el invariante `wallet.bumpBalance == SUM(BumpLedger.amount)`, verificado explícitamente.
- `EntitlementService.hasAvailableBumpQuota`, réplica literal de `hasAvailableFeaturedQuota`:
  mismo lock `SELECT ... FOR UPDATE` sobre la MISMA fila `Subscription` (las dos cuotas comparten
  periodo por construcción — un Pro tiene una sola suscripción). Verificado bajo solapamiento real
  forzado con la misma técnica del test determinista de destacados.
- `GET /billing/pro-status` gana `bumpQuota: { limit, used, remaining }` como campo hermano
  aditivo (decisión: una sola petición para pintar el estado mensual completo de Pro, no un
  endpoint separado).
- **Hueco de validación preexistente cerrado, no replicado**: `proMonthlyFeaturedQuota` llevaba
  desde H8.1 en la whitelist de `SETTING_KEYS` sin validación numérica en el backend (el 400 solo
  lo daba el `min` del frontend). Añadidas ambas claves (`proMonthlyFeaturedQuota` y
  `proMonthlyBumpQuota`) a `POSITIVE_INT_SETTING_KEYS` — ahora el backend exige entero ≥ 1 para
  las dos. Efecto secundario aceptado: `proMonthlyFeaturedQuota` ya no admite `0` (comportamiento
  nunca declarado como soportado); el editor de `/admin/ajustes` se actualizó (`min={0}` →
  `min={1}`).
- UX: botón de bump con 3 estados en el mismo orden de prioridad ("cuota: te quedan N este mes" →
  "guardado: te quedan N" → coste en créditos); confirmación tras bumpear distingue las tres
  monedas vía `paidWith` (gana el valor `'PRO_QUOTA'`).

**Verificado**: nuevo fichero `test/pro-bump-quota.e2e-spec.ts` (17 tests) — la matriz completa de
consumo (5 casos: Pro-con-cuota, Pro-sin-cuota-con-saldo, Pro-sin-cuota-sin-saldo, no-Pro-con-saldo,
no-Pro-sin-nada), concurrencia de la cuota bajo solapamiento real forzado (molde exacto del test
determinista de destacados), el invariante `bumpBalance == SUM(BumpLedger.amount)` explícitamente
tras mezclar una fila `PRO_QUOTA` y una `COUPON_REDEEM` en el mismo wallet, `wallet.upsert` para un
Pro sin fila `Wallet` previa, expiración de Pro sin gracia, y la validación nueva (negativo/decimal/
cero → 400, entero positivo → 200 con `AuditLog`) para ambas claves de cuota. Batería completa: 63
suites / 956 tests en verde (`--runInBand`, incluida una corrección a una aserción exacta
preexistente en `h8-featured-quota.e2e-spec.ts` que no contemplaba el nuevo campo `bumpQuota`
aditivo). Typecheck de frontend limpio. QA en vivo con capturas Playwright: botón de bump con
cuota disponible, confirmación "cuota mensual Pro" tras bumpear, botón cayendo a "guardado" con la
cuota agotada, y el editor nuevo en `/admin/ajustes`.

### Monetización — ráfaga 4: packs de bumps directos, retirada de la Opción B (CERRADO)

Diseñado y aprobado explícitamente antes de implementar (cambio de modelo con dinero de por medio,
retira algo existente) — documentación completa del diseño en `diseno-facturacion.md` §19.

- **`BumpPack`** — tabla nueva, paralela a `CreditPack` (se evaluó generalizar en una sola tabla
  `Pack{type}` y se descartó: el checkout/processor ramifican por moneda de todas formas —
  Setting de bonus distinta, ledger distinto, columna de Wallet distinta — así que unificar el
  catálogo no habría evitado esa rama, solo habría forzado un rename de gran radio de explosión
  sobre `Transaction.baseCreditAmount`/`bonusCreditAmount`). `Price.bumpPackId`, paralelo a
  `creditPackId`.
- **Compra por Redsys**: `RedsysService.createBumpPackCheckout`, espejo de
  `createCreditPackCheckout` — congela `Transaction.baseBumpAmount`/`bonusBumpAmount` en el
  checkout, nunca releídos en vivo por el processor. `RedsysProcessor.processSuccess()` gana una
  tercera vía de enrutado (`bumpPack` → `handleBumpPackPurchase`, espejo de `handlePackPurchase`,
  moneda distinta). Sin bonus de campaña (`CampaignsService` es específico de créditos, no
  extendido en esta ráfaga).
- **Bonus Pro — `proExtraBumpsPercent`**: Setting propia, NUNCA reutiliza
  `proExtraCreditsPercent`. Ledger con **dos filas separadas** (`BumpLedgerType.PACK_PURCHASE` +
  `PRO_BONUS`, decisión reconsiderada durante la aprobación — inicialmente propuesta como una fila
  combinada, cambiada para permitir reportar el coste del bonus Pro como métrica de negocio sin
  necesitar una migración de datos después). A diferencia de `PRO_QUOTA` (ráfaga 3, siempre
  `amount:0`), estas dos SÍ llevan `amount` real — verificado que el invariante
  `bumpBalance == SUM(BumpLedger.amount)` se mantiene.
- **Bordes verificados explícitamente**: cambiar `BumpPack.bumpAmount` o `proExtraBumpsPercent`
  DESPUÉS del checkout pero ANTES de confirmar el pago no altera lo que esa compra congeló (mismo
  patrón "el test que importa" que créditos); el bonus se aplica en el checkout, no se revalida en
  el webhook aunque el usuario deje de ser Pro entre medias (mismo criterio que créditos — cobrar
  sin dar lo prometido es peor que el caso contrario).
- **Hallazgo real durante el diseño**: desactivar solo `CreditPack.active` NO retira un pack del
  catálogo — `getCatalog()` filtra por `Product.active`/`Price.active`, nunca por
  `CreditPack.active`. Cerrado desactivando ambos. Migración en dos pasos, mismo patrón que
  `drop_contact_motivo_enum`/`drop_post_footer_fields`: dato (`...090500_deactivate_
  highlightbumps_pack`, desactiva `CreditPack` + `Price`, sin tocar histórico) → schema
  (`...100000_drop_highlightbumps_column`), aplicada solo después de retirar las 9 referencias de
  código (backend: schema, `admin-billing.service.ts`, DTO, `getCatalog()`, seeds; frontend:
  `admin-prices.ts`, `billing.ts`, `PriceListEditor.tsx`, `PackList.tsx`; más un describe de test
  que probaba el mecanismo retirado, eliminado — probar código muerto no aporta nada).
- **UI**: `/mis-creditos` renombrada "Mi saldo" en el título visible (URL histórica intacta), dos
  secciones separadas "Créditos"/"Bumps" con saldo, compra e historial propios. El botón de compra
  de un pack de bumps previsualiza "+N de regalo por ser Pro" (solo vista previa — lo acreditado se
  congela en el checkout). `/mis-creditos/exito` (compartida entre ambos tipos de pack, Redsys no
  distingue cuál se compró) muestra ambos saldos.

**Verificado**: nuevo fichero `test/bump-pack-purchase.e2e-spec.ts` (11 tests) — compra atómica con
bonus Pro correcto, no-Pro sin bonus, las dos filas de ledger separadas, idempotencia (reintento de
webhook sobre Transaction ya SUCCEEDED no duplica), congelado bajo cambio de pack y de Setting a
mitad de vuelo, el invariante del ledger con montos reales, y la retirada (pack desactivado
invisible + no comprable + histórico íntegro). Batería completa: 64 suites / 965 tests en verde.
Typecheck de frontend limpio (incluida una corrección al tipo `BumpLedgerType` del frontend, que no
tenía los dos valores nuevos). QA en vivo con capturas Playwright: página "Mi saldo" con las dos
secciones para un Pro (con preview de bonus +1/+3/+8 en los 3 packs) y para un no-Pro (sin
preview), y el editor nuevo en `/admin/ajustes` (Setting + los 3 `BumpPack` en Precios Redsys).

### Monetización — ráfaga 5: dos ajustes de catálogo (CERRADO)

Documentación completa en `diseno-facturacion.md` §20.

- **El "Pack de bumps" (highlightBumps) retirado en la ráfaga 4 NO se borra.** Antes de tocar nada
  se comprobó la BD (mismo criterio que "verificar entitlement origin IS NULL antes de cerrar
  Stripe"): cuántas `Transaction` referencian su `Price`. Resultado: **1 Transaction PENDING real**,
  de una cuenta de producción, no un fixture de prueba — borrar el `CreditPack`/`Price` la habría
  dejado con una FK rota. Decisión: no se borra, se deja desactivado (ya lo estaba desde la ráfaga
  4). En su lugar, `AdminBillingService.listPrices()` gana `active: true` en el `where` — los packs
  desactivados (créditos o bumps) desaparecen de la lista editable del backoffice sin tocar ninguna
  fila existente.
- **Orden de los packs — ascendente por cantidad, agrupado por tipo.** Antes, `listPrices()`
  ordenaba solo por `product.name` + `durationDays` (nunca por `creditAmount`/`bumpAmount` — el
  orden dentro de un producto era el de inserción, visto en vivo un pack de 40 bumps antes que uno
  de 15) y `getCatalog()` ordenaba por precio en €, no por cantidad. Fix: ambos `orderBy` ganan
  `creditPack.creditAmount`/`bumpPack.bumpAmount` ascendentes; la agrupación por tipo ya venía
  gratis (créditos y bumps son `Product`/relaciones distintas), así que el criterio de cantidad solo
  actúa dentro de cada grupo.

**Verificado**: nuevos tests en `admin-pricing.e2e-spec.ts` y `billing-catalog.e2e-spec.ts` — un
pack desactivado (créditos y bumps) no aparece en `/admin/billing/prices`; los packs sembrados
vienen en el orden exacto esperado (`[50,150,400]` créditos, `[5,15,40]` bumps) en admin y en
catálogo; un pack con más cantidad pero creado (o con precio en €) más bajo sale igualmente DESPUÉS
de uno más pequeño, para descartar que el orden dependa de inserción o de precio. Batería completa:
64 suites / 971 tests en verde. Typecheck de backend limpio.

---

### Auditoría campañas/banners — ráfaga A: XSS en `Banner.linkUrl` + tope a `CREDIT_BONUS` (CERRADO)

Cierra los dos hallazgos de seguridad/dinero de la auditoría de campañas/banners (motor de
descuentos verificado ejerciendo — bump/destacado por créditos, prioridad cuota→saldo→créditos,
ciclo de vida, solapamiento — todo coherente; el resto de huecos, incluida la falta de bonus de
campaña en packs de bumps directos, queda inventariado para otra ráfaga). Acotada a los dos fixes,
sin decisiones de producto nuevas.

- **XSS en `Banner.linkUrl` (bug real).** `linkUrl` no tenía ninguna validación de formato: un
  banner con `linkUrl: "javascript:alert(1)"` se guardaba y se servía tal cual por `GET /banners`
  (público), y el frontend (`BannerList.tsx`) lo renderizaba directo en `<Link href={banner.linkUrl}>`
  sin sanear. El propio proyecto ya tiene el validador — `common/validators/safe-url.ts`
  (`isSafeContentUrl`/`IsSafeContentUrl`), aplicado a `Footer` (url `EXTERNAL`) y a los bloques
  `cta`/`hub` del blog — pero nunca se enchufó a `Banner`. Fix: **mismo validador, no uno nuevo**.
  - Backend: `CreateBannerDto`/`UpdateBannerDto.linkUrl` gana `@IsSafeContentUrl()` (acepta ruta
    relativa `"/..."` o absoluta http/https; rechaza `javascript:`/`data:`/cualquier otro esquema).
    `@IsOptional()` sigue permitiendo omitir el campo o, en `UpdateBannerDto`, mandar `null`
    explícito para limpiar un link existente (`IsOptional` salta la validación en `null`/`undefined`,
    no en `""` — una cadena vacía ahora se rechaza; no era un valor con significado propio, solo un
    efecto colateral de la falta de validación).
  - Frontend (defensa en profundidad): `BannerList.tsx` reutiliza el mismo `isSafeContentUrl`
    (espejo cliente ya existente en `lib/blocks/validation.ts`, usado hasta ahora solo en los
    editores admin de bloques cta/hub) y solo renderiza el `<Link>` — y solo usa la URL real en el
    botón "Compartir" — si `isSafeContentUrl(linkUrl)` es cierto. Cubre el caso de un registro ya
    guardado con una URL peligrosa (p. ej. de antes de este fix): backend valida al entrar, frontend
    sanea al salir.
  - **Verificado ejerciendo** (servidor real en `:3001`, banner real): `linkUrl: "javascript:alert(1)"`
    y `"data:text/html,..."` → `400` en `POST` y en `PATCH` (edición de un banner válido existente
    queda intacta tras el rechazo); `"https://..."` y `"/ruta-interna"` → aceptados; `null` en
    `PATCH` sigue limpiando el link. Home real (`:3000`) servida contra la API real: un banner con
    link válido renderiza su `<a href>` correcto en el HTML SSR. Se insertó además un banner
    directamente en BD (bypaseando la API, simulando un registro ya existente con
    `linkUrl: "javascript:alert(1)"`) para probar la segunda capa: el título/texto del banner se
    siguen mostrando, pero no existe ningún `<a href="javascript:...">` real en el HTML — el string
    solo aparece de forma inerte dentro del payload de hidratación de RSC (nunca como atributo
    interpretado). **Auditoría de datos existentes:** la tabla `Banner` estaba vacía en el momento
    del fix (0 filas) — no había ningún `linkUrl` peligroso ya guardado que limpiar.
- **`CampaignParamsDto.value` de `CREDIT_BONUS` sin tope superior (bug real).** `ActionDiscountParamsDto.percent`
  tiene tope 90% (un descuento >100% no tiene sentido: regalarías el producto y encima pagarías),
  pero `CampaignParamsDto.value` (usado tanto para `kind:"PERCENT"` como `kind:"FIXED"`) solo tenía
  `@Min(1)` — se aceptaba `{"kind":"PERCENT","value":100000}` (bonus del 100.000%) sin rechazo. Un
  typo de admin (un cero de más) regalaría una cantidad absurda de créditos a quien comprara durante
  la campaña. A diferencia de un descuento, un bonus SÍ puede pasar de 100% de forma legítima
  ("compra 100 créditos, llévate 200" = 200% de bonus), así que el tope no podía ser 90% — tenía que
  ir más alto que el de `ACTION_DISCOUNT` pero seguir existiendo. `kind` no se validaba con un
  `@Max` en el DTO porque el límite depende de `kind` (mismo motivo, ya documentado en el código, por
  el que el DTO se elige por `type` con un switch manual en vez de por reflexión declarativa) — el
  tope se añadió como chequeo manual en `CampaignsService.validateParams`, después de la validación
  del DTO, con el mismo shape de error (`errors: [{property, constraints}]`) que ya devuelve
  class-validator, para que un consumidor de la API no note la diferencia.
  - **`kind:"PERCENT"` → tope 500%.** Dentro del rango de "promoción agresiva pero con techo" que
    pidió Ernest (200–500%); se eligió el extremo alto para no bloquear una campaña legítima futura
    y seguir atrapando un error de una o más órdenes de magnitud (10.000%, 100.000% — el caso real
    de la auditoría). Abierto a ajustar si Ernest prefiere un tope más conservador.
  - **`kind:"FIXED"` → tope 1.000.000 créditos.** No es un límite de negocio (los packs de créditos
    actuales van de 50 a 400) — es la misma valla de cordura que ya existe en
    `UpdateCreditPackDto.creditAmount` (`@Max(1000000)`), reutilizada en vez de inventar un número
    nuevo: ningún caso legítimo la alcanza, pero corta en seco un typo de varios ceros.
  - **Verificado ejerciendo** (servidor real, límite exacto probado en ambos sentidos):
    `PERCENT value:501` → `400`; `value:500` → `201` (aceptado); `value:100000` (repro original de
    la auditoría) → `400`. `FIXED value:1000001` → `400`; `value:1000000` → `201`; `value:50` (caso
    normal) → `201`. `PATCH` sobre una campaña `CREDIT_BONUS` existente con un valor por encima del
    tope → `400`, campaña sin modificar. `ACTION_DISCOUNT.percent` se re-probó igual que antes
    (tope 90% intacto, no tocado por este cambio).

**Verificado**: batería de backend completa en verde (12 suites / 110 tests) antes y después del
cambio — no existe test unitario dedicado a `CampaignsService`/`BannersService` (ninguno de los dos
módulos lo tenía ya antes de esta ráfaga), así que la verificación fue en vivo contra el servidor
real (`:3001` para la API, `:3000` para la home) en vez de una batería nueva — mismo método que el
resto de esta ráfaga y que la propia auditoría previa. Typecheck de backend y de frontend limpios
(los únicos errores de `tsc --noEmit` en `apps/web` son preexistentes en
`AttributeSchemaEditor.childrenImpact.test.tsx`, sin relación con este cambio — confirmado con
`git status` antes de tocar nada). Toda la BD de prueba (banners, campañas, usuario admin de
verificación) se limpió al terminar.

---

### Panel de admin de campañas (CIERRA el hueco "API-only" — CERRADO)

Hasta ahora `CampaignsService`/`/admin/campaigns` (H8 Bloque D fase 1/2) no tenía ninguna pantalla —
decisión deliberada de scope en su momento ("no pedido un panel visual"), documentada arriba en la
sección de fase 1. Se gestionaba solo por Swagger. Esta ráfaga añade el panel, **sin tocar backend**
(el CRUD ya estaba completo y probado) — molde exacto de `admin/cupones` (la pantalla hermana más
parecida: CRUD con tipo inmutable tras crear, ventana temporal, activar/desactivar sin `DELETE`).

- **Ruta:** `/admin/campaigns` (nombre en inglés, sin traducir — mismo criterio que
  `/admin/sponsored-ads`: coincide 1:1 con el path del backend y el nombre del modelo `Campaign`,
  evita el acento de "campañas" en la URL). Añadida a `AdminNav.tsx` junto al resto de herramientas
  promocionales (Cupones, Banners, Patrocinados).
- **Ficheros nuevos:** `lib/api/admin-campaigns.ts` (cliente HTTP — mismo molde que
  `admin-coupons.ts`: tipos, `getAdminCampaigns`/`createAdminCampaign`/`updateAdminCampaign`, y las
  constantes de tope de front — `ACTION_DISCOUNT_PERCENT_MAX=90`,
  `CREDIT_BONUS_PERCENT_MAX=500`, `CREDIT_BONUS_FIXED_MAX=1_000_000` — copiadas literalmente de
  `CampaignsService`, backend sigue siendo quien de verdad protege); `admin/campaigns/page.tsx`
  (listado, molde `cupones/page.tsx`: filtro activas/inactivas, tabla con columna "Efecto" — resumen
  legible de `params`, p. ej. "-20% en bumps" o "Bonus +50%" —, activar/desactivar, sin `DELETE`);
  `admin/campaigns/_components/CampaignFormDialog.tsx` (crear/editar, molde `CouponFormDialog.tsx`:
  `type` fijo tras crear igual que `rewardType` en cupones, campos condicionales por tipo).
- **Validación de front — espejo del backend, no una fuente nueva.** El formulario rechaza
  `percent`/`value` fuera de rango ANTES de llamar a la API (mismos topes que
  `CampaignsService.validateParams`/`ActionDiscountParamsDto`) — UX, no seguridad: el backend
  revalida igual y sigue siendo quien de verdad puede rechazar. Fechas: `endsAt > startsAt`
  comprobado en el front antes de enviar, igual que ya rechazaba el backend.
- **`CAMPAIGN_OVERLAP` traducido, no reimplementado.** El front NO recalcula solapamiento (una sola
  fuente: `CampaignsService.assertNoOverlap`) — captura el `code: 'CAMPAIGN_OVERLAP'` que ya
  devuelve el backend (`ApiError.code`, mismo mecanismo que `COUPON_CODE_TAKEN` en
  `CouponFormDialog`) y compone un mensaje en español con el tipo/acción que el admin tenía
  seleccionados en ese momento ("Ya existe una campaña de descuento en bumps activa que se solapa en
  esas fechas. Desactívala o ajusta las fechas de esta campaña.") en vez de dejar pasar el 400 crudo.
- **Vista previa del efecto — en vivo, con los números reales del catálogo, no inventados.**
  `lib/campaigns/effect-preview.ts` (nuevo, comentado explícitamente como espejo — igual que
  `lib/blocks/validation.ts` para `safe-url`: "si cambia la fórmula en el backend, cambiar aquí
  también") replica las dos fórmulas exactas de `BillingService`/`RedsysService`:
  `floor(base × (100-percent) / 100)` para `ACTION_DISCOUNT`, `ceil(pack × value / 100)` (o `value`
  tal cual si `kind=FIXED`) para `CREDIT_BONUS`. La `base` NO se reinventa: sale de `GET
  /billing/catalog` (público, ya existente) — `bumpOriginalCreditCost ?? bumpCreditCost` para bump,
  `originalCreditCost ?? creditCost` por duración para destacado, y los `creditAmount` reales de los
  packs de créditos sembrados para el bonus — así que si cambia un `Setting` de coste o el catálogo
  de packs, la vista previa lo seguiría automáticamente sin tocar código. Se recalcula en cada
  cambio de `percent`/`value`/`kind`/`action` (`useMemo`), antes de guardar.
- **Verificado ejerciendo — con navegador real (Playwright, script desechable, sin dejar rastro en
  el repo), no solo `curl`:** login como ADMIN vía `/admin/login` → clic en "Campañas" desde el nav →
  crear una campaña `ACTION_DISCOUNT` (BUMP, -20%, ventana ya vigente) desde el formulario → la vista
  previa mostró "Bump: 4 créditos (antes 5)" ANTES de guardar → aparece en la lista con badge
  "Vigente" → **se hizo un bump real contra un anuncio de prueba y costó exactamente 4 créditos** —
  la previsualización y el cobro real coinciden byte a byte. Editar reabre el diálogo con los valores
  correctos y `type` bloqueado. Crear una segunda campaña `ACTION_DISCOUNT`/BUMP solapada en fechas →
  el mensaje de `CAMPAIGN_OVERLAP` se mostró traducido, no un 400 crudo. Desactivar/activar desde la
  lista cambia el badge al instante. Crear una `CREDIT_BONUS` con `value=600` (`kind=PERCENT`,
  tope 500) → rechazado por el FRONT antes de disparar ninguna petición; con `value=50` la vista
  previa mostró "Pack Básico (50 créditos) → recibirá 75 créditos" (entre otros packs) → **se hizo un
  checkout real de ese pack y `Transaction.campaignBonusAmount` quedó en 25** (50 base + 25 = 75,
  igual que la previsualización). Typecheck y `next lint` limpios (mismo resultado de `tsc` que la
  entrada anterior: solo el error preexistente y no relacionado en
  `AttributeSchemaEditor.childrenImpact.test.tsx`); `jest` de frontend en verde (20 suites / 185
  tests, sin regresiones). Toda la BD de prueba (anuncio, wallet, transacción, campañas, usuario
  admin de verificación) y el script de Playwright desechable se limpiaron al terminar — no queda
  ningún fichero temporal en el repo.
- **Backend intacto:** cero cambios en `apps/api` en esta ráfaga — el CRUD, la validación de topes y
  `assertNoOverlap` son exactamente los que ya se habían verificado y documentado antes. Solo
  frontend consumiendo una API que ya funcionaba.

---

### Campaña #10 — `BUMP_BONUS`: bonus de campaña en packs de bumps (CERRADO)

Cierra el hallazgo #10 de la auditoría de campañas: `createBumpPackCheckout` tenía bonus Pro pero
**no** bonus de campaña, con un comentario explícito "no decidido en esta ráfaga". Se decidió: nuevo
`CampaignType.BUMP_BONUS`, espejo literal de `CREDIT_BONUS` — mismo shape de `params`
(`{kind, value}`), mismos topes, misma fórmula de acumulación, mismo criterio de filas separadas en
el ledger. Diseñado y aprobado antes de tocar código; verificado ejerciendo después.

- **Fórmula de acumulación — ADITIVA, copiada de créditos, no reinventada.** Confirmado leyendo
  `RedsysService.createCreditPackCheckout` antes de escribir una sola línea: el bonus Pro y el bonus
  de campaña se calculan cada uno **independientemente contra la base** (`pack.creditAmount`/
  `pack.bumpAmount`), ambos con `Math.ceil`, y se SUMAN — nunca uno sobre el resultado del otro
  (`N + ceil(N×proPct/100) + ceil(N×campaignPct/100)`, nunca `N×(1+proPct)×(1+campaignPct)`).
  `createBumpPackCheckout` replica exactamente ese cálculo para `campaignBonusBumpAmount`.
- **Schema (migración `20260716164351_campaign_bump_bonus`, puramente aditiva):**
  `CampaignType` +`BUMP_BONUS`; `BumpLedgerType` +`CAMPAIGN_BONUS` (espejo de
  `CreditLedgerType.CAMPAIGN_BONUS`); `Transaction` +`campaignBonusBumpAmount Int?`.
  **`Transaction.campaignId` se REUTILIZA** (no se añadió una segunda FK): su comentario ahora deja
  explícito que apunta a "la campaña APLICADA, sea CREDIT_BONUS o BUMP_BONUS — nunca ambas a la vez,
  una Transaction es de una moneda o de la otra" (nota de Ernest al aprobar el diseño, para que nadie
  lo lea como "solo créditos").
- **`CampaignsService`:** `getActiveBumpBonusCampaign()` nuevo, copia literal de
  `getActiveCreditBonusCampaign()`. El tope de cordura (antes `CREDIT_BONUS_PERCENT_MAX`/
  `CREDIT_BONUS_FIXED_MAX`) se **renombró** a `CAMPAIGN_BONUS_PERCENT_MAX`/`CAMPAIGN_BONUS_FIXED_MAX`
  — el nombre viejo ya mentía en cuanto lo empezó a usar también `BUMP_BONUS` (mismos valores: 500% /
  1.000.000). **`assertNoOverlap` NO se tocó** — hallazgo verificado antes de diseñar: el filtro
  `where: { type }` ya aísla `BUMP_BONUS` de `CREDIT_BONUS`/`ACTION_DISCOUNT` sin ningún cambio de
  código (dos `BUMP_BONUS` solapados bloquean por la misma rama `candidates[0]` que ya usa
  `CREDIT_BONUS`; `BUMP_BONUS` y `CREDIT_BONUS` nunca compiten, ni siquiera entran en `candidates`
  porque el `type` de la query los separa). Verificado con test e2e, no solo leído.
- **`RedsysService.createBumpPackCheckout`:** gana el bloque espejo de
  `createCreditPackCheckout` — consulta `getActiveBumpBonusCampaign()`, calcula
  `campaignBonusBumpAmount` (PERCENT `ceil`, FIXED tal cual) y lo congela en la `Transaction` junto a
  `campaignId`. El JSDoc que decía "no decidido en esta ráfaga" se reescribió.
- **`RedsysProcessor.handleBumpPackPurchase`:** gana un cuarto parámetro y una tercera fila de
  `BumpLedger` (`CAMPAIGN_BONUS`), con el mismo guard `!= null` que ya usa `PRO_BONUS` — **nunca una
  fila con `amount: 0`**. `totalBumps = bumpAmount + (bonusBumpAmount ?? 0) + (campaignBonusBumpAmount ?? 0)`.
- **Frontend:** `CampaignFormDialog.tsx` gana "Bonus de bumps" en el selector de tipo; los campos
  `kind`/`value` (antes solo para `CREDIT_BONUS`) se reutilizan sin duplicar — la condición pasó de
  `type === 'CREDIT_BONUS'` a `type !== 'ACTION_DISCOUNT'`. `effect-preview.ts`:
  `applyCreditBonus` se **renombró** a `applyBonus` — la fórmula nunca fue específica de créditos, el
  nombre viejo también mentía. La vista previa usa los packs de bumps reales del catálogo
  (`bumpAmount`, no `creditAmount`) cuando `type === 'BUMP_BONUS'`. `page.tsx` y
  `mis-creditos/page.tsx`/`admin/facturacion/usuarios/[id]` ganan la etiqueta "Bonus campaña" para la
  nueva entrada de `BumpLedger` (la etiqueta de la vista admin, con clave `Record<string,string>` no
  tipada por enum, ya cubría `CAMPAIGN_BONUS` gratis — comparte el nombre del tipo con créditos).

**Verificado ejerciendo — nueva batería `campaigns-bump-bonus.e2e-spec.ts` (13 tests, real Postgres
de test vía `test:e2e`, no mocks):**
- **Matriz de 4 casos, filas EXACTAS:** Pro+campaña → 3 filas (`PACK_PURCHASE`+`PRO_BONUS`+
  `CAMPAIGN_BONUS`); no-Pro+campaña → 2 (sin `PRO_BONUS`); Pro+sin campaña → 2 (sin `CAMPAIGN_BONUS`,
  comportamiento de hoy intacto); ni-ni → 1 (solo `PACK_PURCHASE`). Las cuatro verificadas con
  `wallet.bumpBalance` exacto y el listado de tipos de fila comparado, no solo el conteo.
- **Paridad con créditos, con un caso adversarial:** pack de 40, Pro 20% + campaña 33% (porcentaje
  impar a propósito, para que aditivo y compuesto den números DISTINTOS) → aditivo da 62
  (`40+8+14`), compuesto habría dado 64 (`ceil(40×1.2×1.33)`) — el test afirma expresamente
  `not.toBe(compoundTotal)`, no solo el valor esperado.
- **Invariante con las 3 filas:** `SUM(BumpLedger.amount) === wallet.bumpBalance`, y
  `bumpBalance > base` para descartar que la suma se quedara en 0 por error.
- **Congelado:** cambiar `BumpPack.bumpAmount` a 999 y el `%` de la campaña a 90 (vía
  `PATCH /admin/campaigns/:id`) DESPUÉS del checkout, ANTES de confirmar — el `bumpBalance` final usa
  los valores congelados en ambos casos, nunca los nuevos.
- **Idempotencia:** reintento de `processor.processSuccess` sobre una `Transaction` ya `SUCCEEDED` —
  `bumpBalance` sin cambios, 3 filas (no 6).
- **Solapamiento:** dos `BUMP_BONUS` activos solapados → `400 CAMPAIGN_OVERLAP`; un `BUMP_BONUS` y un
  `CREDIT_BONUS` solapados en las mismas fechas → ambos `201`, coexisten.
- **Tope:** `value=501` (`PERCENT`) → `400`; `value=500` (límite exacto) → `201`.
- **Pantalla, con navegador real (Playwright desechable, sin rastro en el repo):** campaña
  `BUMP_BONUS` PERCENT 40% creada desde el form → vista previa mostró, para los 3 packs de bumps
  reales sembrados, "Pack 5 bumps → recibirá 7 bumps / Pack 15 bumps → recibirá 21 bumps / Pack 40
  bumps → recibirá 56 bumps" ANTES de guardar → **se hizo un checkout real del pack de 15 y
  `Transaction.campaignBonusBumpAmount` quedó en 6** (15 base + 6 = 21, igual que la previsualización).
- **Batería completa, dos corridas:** primera corrida — 64/65 suites verdes, 1 suite
  (`admin-category-type-policy.e2e-spec.ts`, sin relación alguna con campañas/bumps) con 9 fallos
  `401` en cascada. Verificado como flake preexistente, no regresión: esa suite pasa 9/9 en solitario,
  y una SEGUNDA corrida completa de toda la batería dio **65/65 suites, 984/984 tests, todos verdes**
  — mismo patrón de "contadores de rate-limit heredados entre specs no relacionados" ya documentado
  en `setup-e2e.js`. Unit tests backend (12/12 suites, 110/110), typecheck de `apps/api` y
  `apps/web` limpios (mismo error preexistente y no relacionado de siempre en
  `AttributeSchemaEditor.childrenImpact.test.tsx`). Toda la BD de prueba (dev) y el script de
  Playwright se limpiaron al terminar.

---

## Búsqueda + Tags — RÁFAGA A1: URLs anidadas de categoría (cerrada)

**✅ CERRADA** (2026-08-01). Diseño: `docs/diseno-busqueda-y-tags.md` §3.1 (con la
sección de correcciones tras implementar).

**Qué cambia:** una categoría hija pasa de `/coches` a `/vehiculos/coches`. Las raíces
**no cambian** (`/vehiculos` sigue siendo `/vehiculos`). Toda URL vieja de hija responde
**308** a su canónica, con la query intacta.

**Rutas.** `[categoria]` (raíz) y `[categoria]/[subcategoria]` (hija), dos rutas
explícitas que comparten cuerpo en `components/categorias/CategoryListingPage.tsx`.
**No** un catch-all `[...ruta]`: se probó, y absorbía rutas profundas inexistentes
(`/a/b/c/d`) convirtiendo su 404 real en uno blando. Como el árbol tiene exactamente 2
niveles (`assertParentIsRoot`), dos rutas explícitas lo modelan sin residuo.

**El 308 lo emite el MIDDLEWARE, no la página** (`lib/category-canonical.ts`). Razón
medida sobre el servidor real: `app/loading.tsx` en la raíz envuelve toda ruta en
Suspense, así que Next manda la cabecera 200 antes de ejecutar la página y allí
`permanentRedirect()` solo puede degradar a un redirect de cliente sobre un 200 — para
un crawler, "la URL vieja sigue viva". El middleware corre antes de renderizar. Mapa
slug→padre memoizado 60 s, deduplicación de peticiones en vuelo, y *fail-open* (si la
API no responde no redirige, en vez de tumbar la navegación). La canonicalización de la
página se conserva como red de seguridad para cuando ese mapa esté frío.

**Regla única de canonicalización: manda el último segmento.** Se resuelve la categoría
por él y se compara con la URL pedida. Cubre de una vez la URL vieja plana (`/coches`),
el padre incoherente (`/inmuebles/coches`) y el padre inexistente (`/lo-que-sea/coches`),
sin ninguna tabla de redirects que mantener y siguiendo al día cualquier cambio de padre
que haga un admin.

**Un solo constructor de URLs:** `lib/category-url.ts` (`categoryPath`,
`categoryPathWithQuery`, `findCategoryUrlParts`). Los 11 generadores que había repartidos
por el front pasan por él. Regla de proyecto: **nadie construye `/${slug}` a mano**.

**Backend (todo aditivo):** `GET /categories/:slug` devuelve `parent {slug,name}|null`;
el árbol devuelve `parentSlug` en cada hija; la ficha del anuncio devuelve
`category.parent`. Antes la relación se cargaba solo para resolver herencia y no salía
en ninguna respuesta — por eso el breadcrumb no podía enseñar el padre. Además, guarda
`RESERVED_ROOT_SLUGS`: una categoría **raíz** no puede tener el slug de una ruta del
sitio (sería inalcanzable); una hija sí (vive bajo `/x/blog`). Cierra un hueco que ya
existía en silencio.

**SEO nuevo:** categorías en `sitemap.ts` (no estaban, ni antes), `canonical` explícita,
y JSON-LD `BreadcrumbList` en categoría y ficha, generado de la misma lista que la miga
visible.

**Verificación.** `e2e/categoria-urls-anidadas.spec.ts` es transversal, no una muestra:
recorre `GET /categories` y comprueba **las 648 hijas** (todas redirigen 308 a su
anidada) y **las 1.786 raíces** (ninguna gana prefijo). Las raíces se comprueban con una
sonda `/{sonda}/{raiz}` que lee la canónica vía redirect en lugar de renderizar 1.786
páginas. Backend: `test/category-parent-exposure.e2e-spec.ts` (9). Unitarios:
`category-url.test.ts`, `category-canonical.test.ts`.

**Deuda anotada, pre-existente y fuera de alcance** (medida contra la rama base antes de
tocar nada, para no atribuirla a A1):
- Un slug de categoría inexistente responde **200 + UI de 404** (404 blando) por el
  `loading.tsx` global. Igual antes de A1. Arreglarlo toca el loading de todo el sitio.
- `next build` falla por dos errores de lint pre-existentes en
  `CardPhotoCarousel.test.tsx` (`no-html-link-for-pages`). El build de esta ráfaga se
  verificó con `--no-lint`.
- La BD de test arrastra ~1.800 categorías y ~650 hijas de baterías anteriores que nunca
  se limpiaron: ralentiza toda la suite de Playwright y es lo que hace inviable
  renderizar una página por raíz.

---

## Búsqueda + Tags — RÁFAGA A2: unificación de /busqueda y /[categoria] (cerrada)

**✅ CERRADA** (2026-08-01). Diseño: `docs/diseno-busqueda-y-tags.md` §3.2.

**Qué cambia:** un ÚNICO selector de categoría en las dos páginas de resultados. Elegir
cualquier nodo del árbol —o "Todas las categorías"— navega a su ruta canónica
arrastrando los filtros. Antes había dos controles distintos con el mismo papel: el
"Categoría" de `/busqueda` (que solo cambiaba un query param y te dejaba allí) y el
"Subcategoría" de `/[categoria]` (que navegaba, pero solo un nivel hacia abajo). Desde
`/coches` no había forma de ir a `/pisos` ni de volver a la búsqueda global sin editar
la URL a mano.

**El eje de la ráfaga — la trampa del 400.** Desde RÁFAGA 1 el backend rechaza con 400
cualquier query param que no sea filtrable *en la categoría pedida* (defensa anti-leak
cross-categoría). Así que arrastrar la query tal cual al cambiar de categoría **rompe la
página**: `/busqueda?rooms=3` → "Coches" → 400. El tránsito padre→hija era seguro por
herencia (es lo que hacía el viejo selector), pero global→categoría y categoría→otra no.

Se resuelve **filtrando en cliente antes de navegar** (`lib/filter-carry.ts`): solo
sobreviven los atributos filtrables en el destino. **El 400 del backend no se toca** —
es la defensa, y sigue verificada en el spec nuevo. La regla completa: se descartan
`page` y `category`; se conservan los core; `condition` se descarta si el destino es
`SERVICE_ONLY` (un servicio no tiene estado de conservación); los atributos se filtran
por destino — hoja → sus filtrables (herencia ya resuelta por el backend), raíz → los
suyos ∪ los de sus hijas (porque `categoryPath = padre` mezcla los anuncios de las
hijas), "Todas" → no se filtra nada.

**Backend, aditivo (dos campos, uno más de lo diseñado):**
- `allAttributes[].filterable` en el árbol — sin él el cliente no sabe qué arrastrar, y
  un atributo `filterable:false` da 400 igual que uno ajeno.
- `allowedListingType` EFECTIVO en cada nodo del árbol — no estaba, y sin él no se puede
  aplicar la regla de `condition`. Misma resolución en dos pasos que `findBySlug`.

**`/busqueda?category=X` → 308** a la ruta canónica (P3), con el resto de la query
intacto, por el mismo middleware de A1. Se activó **después** de confirmar que ningún
flujo interno depende de que esa URL renderice en su sitio: no queda ningún generador en
el frontend (A1 los migró), no aparece en plantillas de email ni en enlaces guardados en
BD (footer, banners, patrocinados, bloques — auditadas las dos bases), y las alertas
solo renderizan texto.

**`q` deja de funcionar por accidente en la ruta de categoría.** No estaba en
`KNOWN_PARAMS`, así que caía en el bag de atributos y llegaba al backend como `q` de
casualidad. Filtraba de verdad, pero: no salía en el `<h1>` ni en el `<title>`, contaba
como filtro de atributo, y **"Limpiar filtros" lo borraba** (`clearAll` conserva
`currentFilters.q`, que esa página nunca rellenaba). Ahora es un filtro de primera.

**`CrearAlertaButton` también en la ruta de categoría** — con las dos páginas
unificadas, poder guardar la búsqueda en una y no en la otra era arbitrario.

**Verificación:** `e2e/busqueda-unificada.spec.ts` (17) ejerce la trampa en los dos
sentidos con datos reales del seed (`ram` vale en móviles y no en coches; `km` al revés),
los cuatro tránsitos, el redirect de P3, `q` formalizado y el descarte de `condition`
hacia una categoría `SERVICE_ONLY` creada por API de admin y borrada al terminar.
Unitarios: `filter-carry.test.ts` (17) cubre cada rama de la regla. Backend:
`category-tree-filter-metadata.e2e-spec.ts` (10), con las categorías creadas **antes de
`app.init()`** para que entren en el mapa memoizado de `FilterableAttributesResolver` —
si no, sus 400 saltarían por "categoría desconocida" y pasarían por el motivo
equivocado.

**Nota sobre el test de auditoría de filtros (BUG A):** el control que probaba
(selector "Subcategoría") ya no existe. Los casos se reescribieron contra el selector
nuevo conservando la garantía original —acotar a una hija arrastra los filtros, menos
`page`— y se ampliaron con los tránsitos que antes eran imposibles.

---

## Saneamiento de la base de test — barreras contra la degradación (cerrado)

**✅ CERRADO** (2026-08-02). No es una ráfaga de producto: **no se tocó ni un fichero de
`src/`**. Es deuda de entorno que había madurado hasta hacer la batería ilegible.

**El problema.** Ni el globalSetup de Jest ni el de Playwright borraban nada: hacían
`migrate deploy` + un seed de **upserts** sobre lo que hubiera. Y `cleanDb` (la limpieza
por suite) excluye `Category` y `Setting` a propósito — truncarlas destruiría el seed que
las demás suites necesitan. Resultado: **toda categoría creada por un spec sobrevivía para
siempre**. Medido: **2.901 categorías** donde el seed pone 4, y el índice de Meilisearch
con documentos huérfanos (21 de "coches" indexados frente a 12 anuncios ACTIVE). El
reparto por prefijo delataba a los culpables: 638 de `admin-price-units-policy`, 629 de
`admin-category-views`, 592 de `admin-category-type-policy`, 288 de
`categories-type-policy`, 252 de `categories-attribute-display`, 229 de
`producto-servicio-flujo`… La consecuencia práctica: el conjunto de rojos cambiaba entre
corridas, así que "verde" no significaba nada sin comparar con un baseline.

**BARRERA 1 — reseteo real en el globalSetup** (`test/reset-test-db.js` +
`test/flush-meili-test-index.js`, compartidos por las dos baterías, igual que
`flush-redis-test-db.js`): entre `migrate deploy` y el seed se vacía **toda** tabla del
esquema salvo `_prisma_migrations`, y se vacía el índice de test. Se truncan todas en vez
de una lista escrita a mano porque una lista hay que acordarse de actualizarla al añadir
un modelo. Guard por **nombre de base** (`marketplace_test`) y por **nombre de índice**
(nunca el `listings` de dev).

> **Ese guard salvó la base de desarrollo el primer día.** `reset-test-db.js` hace
> `require('@prisma/client')`, y Prisma carga por su cuenta el `.env` de dev en cuanto se
> importa; como `dotenv.config()` nunca pisa una variable ya puesta, requerirlo en la
> cabecera de `setup-e2e.js` dejaba `DATABASE_URL` apuntando a **dev** durante todo el
> globalSetup. El guard se negó a truncar y lo hizo evidente. Los `require` van ahora
> dentro de la función, después de cargar `.env.test`; queda anotado en el propio fichero
> para que nadie los "ordene" hacia arriba.

**BARRERA 2 — ninguna suite deja categorías detrás.** La auditoría encontró 22 specs de
backend que crean categorías y solo 6 que borraban algo. En vez de añadir un `afterAll` a
mano en los 16 restantes —que deja el problema resuelto hoy y abierto mañana, porque el
spec 91 volverá a olvidarlo—, se engancha en `setupFilesAfterEnv`
(`test/reset-categories-between-suites.ts`): fotografía los ids al empezar cada ARCHIVO y
borra la diferencia al terminar. Cubre las 90 suites que hay y las que se escriban después
**sin tocar ni una línea de ningún spec**. Playwright no tiene ese punto de enganche (sus
specs hablan por HTTP, no por Prisma), así que allí la simetría la da el globalTeardown
(`test/clean-categories-delta.js`).

**Resultado medido.** Base: **2.901 → 4** (exactamente el seed) tras tres corridas
completas de backend. Meilisearch: **77 → 0** documentos. La base de **desarrollo**,
intacta (24 categorías, 17 anuncios, 6 usuarios). Playwright dejaba ~20 categorías por
corrida; ahora **0**. Los 4 tests de `producto-servicio-flujo` que fallaban por
acumulación han dejado de fallar.

**Repetibilidad.** Tres corridas completas de backend seguidas, sin resembrar entre
medias: 1336 / **1335** / **1335**. La primera limpió las 2.901 heredadas y por eso salió
distinta; las dos siguientes son **idénticas**, que es el criterio.

**Playwright** (misma vía que CI: build de producción + `next start`): de **24 rojos** a
**20**, con `producto-servicio-flujo` y `busqueda-unificada` fuera de la lista, y la base
en 4 categorías al terminar. Los 20 que quedan son los mismos de siempre —verificados en
A1/A2 contra `HEAD` limpio— y ya NO cambian de composición entre corridas por
sedimentación; su causa es otra (flakes de navegación del App Router, specs que publican
por el wizard). Esa batería aún no es "verde", pero por fin es **legible**: la lista de
rojos es estable y comparable sin baseline.

**Lo que la limpieza destapó (no lo causó).**
1. **`tickets-realtime` — carrera de producto en `messaging.gateway.ts`.** Era el único
   rojo estable de la batería de backend. **✅ ARREGLADO** — ver la sección siguiente. `handleConnection` es `async`: fija
   `socket.data.userId` en el acto, pero `socket.data.role` solo **después** de ir a la
   base (`freshRole`). Socket.IO emite el `connect` del cliente en cuanto termina el
   handshake del transporte — no espera a que el handler async acabe. Así que un cliente
   que emite `ticket:join` inmediatamente puede llegar antes de que el rol esté puesto, y
   un ADMIN legítimo es tratado como no-staff → `error` → "forbidden". Encaja con todo lo
   observado: solo falla en la PRIMERA suite de la corrida (pool de Prisma más frío), las
   aserciones de "el dueño entra" nunca fallan (esa vía solo usa `userId`, que es
   síncrono), y la del MODERATOR tampoco porque la carrera produce justo la respuesta que
   espera. **No es de test: afecta a producción** (un ADMIN reconectando puede ver
   rechazado su primer join; el cliente re-emite los joins en cada reconexión). Arreglarlo
   —resolver el rol antes de aceptar mensajes, o encolar los que lleguen antes— es cambio
   de producto y queda fuera de una ráfaga de infraestructura.
2. **`busqueda-mapa`, "Mapa con filtro de categoría"** — marcado `test.fixme` con la
   explicación entera en el propio spec. Solo pasaba por los anuncios fantasma: en la ruta
   de categoría el mapa vive dentro de `total > 0`, mientras que `/busqueda` lo pinta
   aunque haya cero resultados. Con la base limpia no hay anuncios en "coches" y no se
   pinta. Su aserción de fondo (el mapa de atributos de card) tampoco se ejercía de verdad
   salvo por accidente. Dos salidas posibles, ambas decisión de producto: que el spec
   publique un anuncio primero, o igualar las dos páginas. **Esa asimetría es previa a
   A1/A2.**
3. **`busqueda-mapa`, "toggle Lista→Mapa→Lista"** — este sí se arregló, porque la fragilidad
   la introdujo A2: al redirigir `/busqueda?category=` se apuntó el test a la ruta de
   categoría y quedó dependiendo de que hubiera anuncios. Vuelve a `/busqueda` con
   `province` como filtro: protege exactamente lo mismo (alternar vista no pierde filtros)
   sin depender de datos.

**Nota de método.** Una comparación intermedia de esta sesión salió mal y conviene que
quede escrito: se comparó una corrida de Playwright contra un `.next` construido con el
código de A1 (había quedado así tras un `git stash` para medir un baseline, y no se
reconstruyó al recuperar A2). El resultado —15 rojos en el spec de A2— era del build viejo,
no de las barreras. **Tras cualquier `stash`/`pop` que toque `apps/web`, reconstruir antes
de leer un resultado de Playwright.**

---

## Fix — carrera en `handleConnection` del MessagingGateway (cerrado)

**✅ CERRADO** (2026-08-02). Bug de R9 que llegó a producción; lo destapó el saneamiento
de la base de test, que lo separó del ruido y lo dejó como el único rojo estable.

**El bug.** `handleConnection` es `async`: fija `socket.data.userId` en el acto (tras
verificar el JWT, que es síncrono) pero `socket.data.role` solo **después** de consultar la
base (`freshRole`). Socket.IO le da el `connect` al cliente en cuanto termina el handshake
del transporte — **no espera** a que el handler asíncrono acabe. Entre medias hay una
ventana en la que `userId` está puesto y `role` no. `ticket:join` leía `socket.data.role`
directamente, así que un **ADMIN o MODERATOR legítimo que emite el join en esa ventana era
tratado como no-staff y rechazado con `Forbidden`**.

**No era solo de test.** El cliente **re-emite sus joins en cada reconexión** (wifi,
suspensión del portátil, cambio de red), que es exactamente el patrón que dispara la
carrera. En la batería se veía como un rojo intermitente y se confundió dos veces con un
flake: solo fallaba en la primera suite de la corrida (pool de Prisma frío → ventana más
ancha), las vías que solo usan `userId` nunca fallaban, y la aserción del MODERATOR no lo
veía porque la carrera produce justo la respuesta que ella espera.

**Superficie real, acotada en la auditoría:** un solo gateway, dos `@SubscribeMessage`.
`conversation:join` solo lee `userId` (síncrono) → inmune. `ticket:join` era el **único**
lector de `socket.data.role` → el único afectado.

**El arreglo (opción A del plan, con un matiz).** `handleConnection` guarda la **promesa**
del rol en `socket.data.rolePromise` de forma **síncrona, antes del primer `await`**, y
`ticket:join` la espera vía `resolveRole(socket)` en vez de leer un campo a medio poner.
Invierte la dependencia: quien necesita el rol espera a que esté, en lugar de confiar en
que `handleConnection` ya haya terminado. Y como es la misma promesa compartida, **no cuesta
una consulta extra**: el join se engancha a la que ya está en vuelo.

Guardar la promesa y no hacer `socket.data.role ?? await freshRole(...)` importa: `null` es
un valor legítimo (usuario borrado entre el login y el join), y `??` lo confundiría con
"aún no resuelto", disparando una consulta de más en cada join de un socket sin rol. Hay
además un camino de respaldo —si no hubiera promesa, se resuelve contra la base— porque el
fallo por defecto de un problema de orden no puede ser denegar a quien sí tiene permiso.

**Las puertas de R9 siguen cerradas.** El arreglo solo cierra la ventana temporal; no
relaja ninguna verificación. Verificado ejerciendo: un MODERATOR sigue SIN entrar en un
ticket con `invoiceId`, un tercero sigue rechazado, y la nota interna sigue sin salir de
`staff`.

**Verificación — se ejerce la carrera, no el camino feliz.** Seis tests nuevos en
`tickets-realtime.e2e-spec.ts` que emiten `ticket:join` **dentro del handler de `connect`**
(mismo tick, sin esperas artificiales — el patrón del cliente real al reconectar) y repiten
**8 veces** cada escenario, porque una carrera es probabilística y un intento suelto puede
pasar por suerte. Incluyen un **contraste** (un tercero debe ser rechazado SIEMPRE en ese
mismo escenario) para que "no hubo rechazo" no pueda pasar por no observarse nunca.

**Validación por mutación**: revertido el fix a `socket.data.role`, los tests del ADMIN y
del MODERATOR se ponen **rojos** y el de la puerta de factura sigue verde. Es la prueba de
que ejercen la carrera y no el *timing*.

**Batería:** dos corridas completas consecutivas de backend e2e, **1342/1342 las dos**
(84/84 suites), y `tickets-realtime` 26/26 estable en tres corridas seguidas. Antes del fix
eran 1335/1336 con ese rojo yendo y viniendo.

**Residuo conocido, distinto y menor (no lo cubre este fix).** Sigue habiendo una ventana
—la que dura `freshRole`— en la que el socket está conectado pero **aún no está en la sala
`staff`**, porque a esa sala lo mete el propio `handleConnection`. No es un fallo de
autorización (nadie es rechazado): es que un `ticket:message` emitido justo en ese instante
no alcanza a ese socket. Cerrarla del todo exige resolver el rol en un **middleware de
Socket.IO** (`server.use()`), que corre antes del `connect` del cliente; eso cambia además
la semántica de error del handshake (`next(err)` → `connect_error` en vez de `disconnect`),
así que es un cambio de más superficie y se deja anotado en vez de colarlo aquí.

---

## Búsqueda + Tags — RÁFAGA A3: panel de filtros schema-driven (cerrada)

**✅ CERRADA** (2026-08-02). Diseño: `docs/diseno-busqueda-y-tags.md` §3.3.

**Qué cambia:** el panel de filtros deja de pintar las facetas **a ciegas**. Antes recibía
`Record<string, Record<string, number>>` —pares clave cruda → conteo, y nada más— sin
ninguna definición del atributo. De ahí seis síntomas; A3 cierra cinco:

| | Síntoma | Ahora |
|---|---|---|
| F1 | El título era el nombre CRUDO (`sqm`, `gearbox`) | Su `label` ("Metros cuadrados") |
| F2 | La unidad no se mostraba nunca | `Metros cuadrados (m²)` |
| F4 | Un booleano pintaba chips `true`/`false` | Chips **Sí/No** (el valor emitido sigue siendo `true`) |
| F5 | Los selects vinculados no se acotaban | Ocultos hasta que el padre tiene valor; opciones vía `resolveLinkedOptions` |
| F6 | Un filtrable **sin anuncios no aparecía nunca** | La sección aparece siempre; los valores muertos, deshabilitados con `(0)` |
| F3 | Un `number` se pinta como chips de valores sueltos | **Sigue igual — es A4** (exige `_min`/`_max` en parser + service) |

**El cambio de eje.** La lista de secciones la dictaba el RESULTADO: si Meilisearch no
devolvía la clave (porque ningún anuncio tenía ese atributo), el filtro no existía para el
usuario, por muy `filterable: true` que estuviera en la configuración. Ahora la dicta la
CONFIG (`lib/filterable-fields.ts`) y las facetas solo aportan **conteos**. Eso es F6, y
era el hueco conceptual del ajuste 3.

**Ámbito de los filtros**, replicando la regla del backend: una HOJA usa su
`attributeSchema` efectivo (herencia ya resuelta por `GET /categories/:slug`); una RAÍZ
además la unión con lo filtrable de sus hijas (navegar una raíz mezcla los anuncios de las
hijas vía `categoryPath`, así que "combustible" en `/vehiculos` es un filtro legítimo);
`/busqueda` sin categoría, la unión de todo el árbol.

**Solo frontend.** El único cambio de backend es aditivo: `toAttrDef` de `findTree` expone
`type`, `options`, `dependsOn` y `optionsByParent`. **Parser, service y DTO de búsqueda no
se tocan**, y sus specs pasan sin modificar. Las facetas NATIVAS (`priceUnit`, `province`,
`priceType`) siguen siendo facet-driven —no son atributos de categoría— y el bloque nuevo
excluye lo que ya pinta para no duplicar secciones.

**Un ajuste de tipo, sin cambio de comportamiento:** `resolveLinkedOptions` pasa a aceptar
`Pick<AttributeSchema, 'dependsOn'|'options'|'optionsByParent'>` en vez del schema entero.
Era la única razón por la que el panel no podía reutilizar la MISMA función que el wizard y
la validación del backend, y duplicar esa regla es garantizar que divergirá.

**Verificación.** `e2e/filtros-schema-driven.spec.ts` (12) ejerce los cinco síntomas contra
una categoría creada por API de admin **sin ni un anuncio** — precisamente el caso que
antes no pintaba nada— con atributos cuyo `name` y `label` difieren, con unidad, un
booleano, un select con opciones y un par vinculado marca→modelo, más un atributo
`filterable: false` de control que no debe aparecer. Incluye dos tests de que **el filtrado
real no cambia**: los hits con filtro siguen cumpliéndolo y un atributo ajeno a la
categoría **sigue dando 400** (la defensa anti-leak intacta). Unitarios:
`filterable-fields.test.ts` (14) y `FilterPanel.schema.test.tsx` (19).

**Batería:** backend 1342/1342 en dos corridas consecutivas idénticas; web 347/347;
`tsc` limpio en ambos; lint igual que el baseline.

---

## Búsqueda + Tags — RÁFAGA A4: rango numérico en filtros (cerrada) · **BLOQUE A COMPLETO**

**✅ CERRADA** (2026-08-02). Diseño: `docs/diseno-busqueda-y-tags.md` §3.3 (bloque de
rango) y §8 P4. Cierra **F3**, el sexto síntoma de la auditoría de filtros.

**El problema.** Los atributos de categoría se filtraban SOLO por igualdad
(`km = 120000`). Para kilómetros, metros o año eso no sirve de nada: nadie busca un valor
exacto. A3 les dio label y unidad correctos, pero seguían siendo chips de valores sueltos.

**La forma:** sufijos `_min`/`_max` sobre la clave base —
`km_min=50000&km_max=150000` → `km >= 50000 AND km <= 150000`. Se eligen sufijos (y no
una sintaxis tipo `km=50000..150000`) porque encajan con lo que ya hay: cada filtro sigue
siendo UN query param plano, así que el panel, `filter-carry` y las URLs compartidas no
tienen que entender ninguna gramática nueva.

**ADITIVO — la igualdad no se rompe.** `km=120000` sigue funcionando exactamente igual, y
un atributo puede recibir las dos cosas a la vez (se combinan con AND). El spec lo fija.

**Validación (todo 400, coherente con el anti-leak de RÁFAGA 1):** un rango sobre un
atributo que no es `number`; un rango sobre un atributo ajeno a la categoría; un valor no
numérico; y **`min > max`** — un rango invertido es un error del cliente, no una búsqueda
vacía, y devolver 0 hits en silencio escondería el fallo justo cuando hay que verlo. Los
extremos son **inclusivos** (`>=`/`<=`) y cualquiera de los dos puede faltar (`km_min`
suelto es "50000 o más").

**El DTO no cambia.** `SearchQueryDto` solo declara los params CORE; los de atributo se
validan dinámicamente en el parser contra el mapa del resolver. `_min`/`_max` entran por
ese mismo mecanismo — no había un patrón nuevo que inventar.

**Colisión de nombres, cerrada en la CONFIGURACIÓN** (`assertNoRangeSuffixCollision`): un
atributo no puede llamarse `X_min`/`X_max` si existe un `X` numérico en el mismo ámbito, ni
al revés. Si coexistieran, la misma clave querría decir dos cosas y el parser —que mira la
clave literal primero— resolvería a favor del atributo, dejando el rango en la sombra sin
que nadie se entere. Mismo criterio que `RESERVED_ROOT_SLUGS` (A1): el sitio de un choque
de nombres es el guardado, con un 400 que lo explica, no el tiempo de búsqueda. El ámbito
es el que ve el parser: propio + padre para una hoja, propio + hijas para un padre. El
sufijo por sí solo NO se veta: `presupuesto_min` es válido mientras no exista un
`presupuesto` numérico.

**Frontend:** un `number` pasa de chips a control de **rango mín/máx**, molde exacto del
filtro de precio que ya existía (dos inputs, estado local, aplicar en blur/Enter, la
unidad en el placeholder) — no un tercer patrón de rango. Y `filter-carry` (A2) reconoce
los sufijos: un `km_min` viaja donde viaje su atributo BASE. Sin eso se habría caído
siempre al cambiar de categoría, porque el set de permitidos contiene `km`, no `km_min`.

**Verificación — con anuncios a ambos lados del rango.** `search-attribute-range` (13)
publica tres anuncios (40k, 100k, 200k km) y comprueba el rango cerrado, los dos abiertos,
los extremos inclusivos, la igualdad intacta, la combinación de ambos y los cinco 400.
`admin-range-suffix-collision` (8) ejerce la colisión en las dos direcciones, la herencia
del padre, la edición, y que un sufijo inocente se sigue guardando.

**Validación por mutación (dos):** sustituir `>=`/`<=` por `=` en el service → **5 tests de
rango en rojo**; quitar la comprobación de "solo number" en el parser → **el test del
select con `_min` en rojo**. Los tests ejercen el mecanismo, no el camino feliz.

**Batería:** backend **1363/1363 en dos corridas consecutivas idénticas** (86 suites); web
357/357; `tsc` limpio en ambos; lint igual que el baseline.

**Nota de método (Playwright).** `page.waitForURL(predicado)` espera POR DEFECTO al evento
`load`, que una navegación de cliente del App Router **no dispara**: la URL casa y el wait
se queda colgado hasta el timeout. Hay que pasarle `{ waitUntil: 'commit' }`. Costó una
corrida entera diagnosticarlo y está aplicado en los tres sitios donde se espera un push
del router.

---

## Búsqueda + Tags — RÁFAGA B1: modelo Tag, herencia y CRUD admin (cerrada)

Diseño: `docs/diseno-busqueda-y-tags.md` §4.1–§4.4. El **cimiento** del sistema de tags:
modelo, herencia, endpoints y UI de configuración. **No toca anuncios (B2), ni búsqueda
(B3), ni portada (B4).**

### Qué se construyó

**Tres tablas nuevas** (`prisma/schema.prisma`), migración `20260802021723_add_tags`:

| Tabla | Clave | Notas |
|---|---|---|
| `Tag` | `id` cuid, `slug @unique` | Catálogo **global**: `name`, `orden`, `activo`. Sin DELETE duro (molde `ContactReason`). |
| `CategoryTag` | `@@id([categoryId, tagId])` | Qué tags se ofrecen en qué categoría. `onDelete: Cascade` en ambos lados. |
| `ListingTag` | `@@id([listingId, tagId])` | Qué tags lleva un anuncio. `Cascade` desde `Listing`, **`Restrict` desde `Tag`** — un tag no se borra nunca, así que la fila del anuncio no puede desaparecer bajo sus pies. |

La migración se verificó **puramente aditiva**: 3 `CREATE TABLE`, 4 índices, 4 FKs, **cero
`ALTER` sobre columnas existentes**. `ListingTag` se crea ya en B1 aunque nadie la escriba
hasta B2: el diseño la tenía cerrada y partirla habría costado una segunda migración.

**Herencia** — `apps/api/src/modules/tags/tag.types.ts`:

```ts
export function resolveEffectiveTags(own: TagRef[], parent: TagRef[]): TagRef[] {
  const propios = new Set(own.map((t) => t.id));
  return [...own, ...parent.filter((t) => !propios.has(t.id))];
}
```

Unión, **propios primero**, dedup por `id`, solo activos. A diferencia de
`resolveEffectiveSchema`, **no hay override**: un tag es identidad (una fila), no una
definición que la hija pueda redefinir — la hija solo **añade**. Quitar un heredado exigiría
una lista de exclusión; se edita en el padre. Hermano del sistema de atributos, **no
fusionado con él**: un atributo es clave→valor (`Listing.attributes` jsonb), un tag es
pertenece/no-pertenece (tabla puente).

**Caché** — `effectiveTagsForCategory` (Redis, prefijo `category-tags:`, TTL 300 s) resuelve
propios + heredados en **una sola query**. `setCategoryTags` invalida la clave propia **y la
de todas las hijas**: sin eso, cambiar el padre dejaría a las hijas sirviendo herencia vieja
hasta 5 minutos.

**Endpoints.** Público: `GET /categories/:slug/tags`. Admin (todos `@Roles(Role.ADMIN)`):
`GET/POST /admin/tags`, `PATCH /admin/tags/reorder` (**declarado antes de `:id`**, si no la
ruta estática la come el parámetro), `PATCH /admin/tags/:id` (**`slug` no viaja: es
inmutable** — es la URL de filtro y lo indexado), `GET /admin/tags/:id/usage`,
`GET/PUT /admin/categories/:id/tags`.

**UI.** `/admin/tags` — catálogo global (molde `/admin/motivos-contacto`: tabla, alta
inline, flechas ↑↓, toggle activo), con una confirmación que **nombra cuántos anuncios y
categorías afecta** antes de desactivar. `TagsEditorPanel` — panel en cada fila de
`/admin/categorias`, hermano de `SchemaEditorPanel`: multiselect con buscador sobre el
catálogo activo + bloque "Heredados del padre" en gris, solo lectura. Entrada de nav nueva
junto a Categorías.

**Seed de test** (`prisma/seed-test.ts`, `seedTags()`): `garantia` y `envio-incluido` en
`vehiculos`, `unico-dueno` en `coches`, `descatalogado` sin asignar — así la herencia queda
ejercitada de forma determinista (coches ve 3, vehiculos ve 2).

### ⚠️ Hallazgo — `maxTagsPerListing` no se podía editar (→ arreglado después)

B1 destapó que **`updateSetting` hacía `findUnique` + `NotFoundException`, no `upsert`**:
`PATCH /admin/settings/maxTagsPerListing` devolvía **404** mientras la fila no existiera. La
lectura sí funcionaba (`DEFAULT_MAX_TAGS_PER_LISTING = 5`); era solo la **escritura** la que
estaba rota, y de forma terminal. Preexistente y no exclusivo de los tags: `supportEmail` y
`ticketAutoCloseWindowDays` estaban igual. B1 lo documentó sin tocarlo (el diseño pedía no
sembrar la clave). **Arreglado en la ráfaga siguiente** — ver "Fix — `updateSetting` es
UPSERT" más abajo.

### Verificación

`tag.types.spec.ts` **9/9** (herencia pura: unión, orden, dedup, sin override).
`tags-b1.e2e-spec.ts` **30/30**: CRUD, slugify, 409 de slug duplicado, `reorder` antes de
`:id`, inmutabilidad del slug, `usage`, asignación por categoría, herencia efectiva,
**MODERATOR → 403** en todos los endpoints admin, la caché Redis (segunda llamada cacheada,
`PUT` la invalida) y el ajuste `maxTagsPerListing`.

**Batería:** backend **1393/1393 en dos corridas consecutivas idénticas** (87 suites; eran
1363/86 al cerrar A4 — exactamente los +30 de `tags-b1.e2e-spec.ts`), unitarios **159/159**
(16 suites), `tsc` limpio en api y web, lint igual que el baseline (6, ninguno en ficheros
nuevos).

**Requisito de oro cumplido:** tres tablas nuevas, ninguna columna existente tocada; el
sistema de atributos intacto; ningún test existente con lógica modificada.

**Nota de método (invocar la batería).** Hay que lanzarla con
`pnpm --filter @marketplace/api test:e2e`, **no** con `node ./node_modules/jest/bin/jest.js`
directamente: `multer` (que importa `admin-sponsored-ads.controller.ts`) no está declarado
como dependencia y solo resuelve por el `NODE_PATH` hoisteado que pone pnpm. Invocando jest
a pelo caen **86 de 87 suites** con `Cannot find module 'multer'`, que parece una regresión
enorme y no lo es.

---

## Fix — `updateSetting` es UPSERT, no `findUnique` + 404 (cerrado)

Bug **preexistente del sistema de settings**, destapado en B1. Se arregla la **causa**, no
se siembran filas.

### El catch-22

`updateSetting` buscaba la fila con `findUnique` y lanzaba `NotFoundException` si no estaba.
Pero varias claves del whitelist nacen **a propósito sin fila** — "sin configurar" es un
estado válido y la lectura cae a su `DEFAULT_*`. Resultado: para editarlas la fila tenía que
existir, y para que existiera había que editarlas. Eran ineditables **para siempre**:

| Clave | Default de lectura | Quién la necesita |
|---|---|---|
| `maxTagsPerListing` | `DEFAULT_MAX_TAGS_PER_LISTING` (5) | B1/B2 — el tope de tags por anuncio |
| `supportEmail` | sin configurar → warning y se omite solo el email | Tickets R4 |
| `ticketAutoCloseWindowDays` | `TICKET_REOPEN_WINDOW_DAYS` (14) | Tickets R8 |

Solo la **escritura** estaba rota: en lectura las tres funcionaban, que es por qué el fallo
sobrevivió tanto.

### El arreglo

`prisma.setting.upsert` en lugar de `findUnique` + `update`, con `updatedById: actorId`
**también en el `create`** — quien crea la fila queda registrado igual que quien la modifica.
Todo lo que corría antes sigue corriendo **antes** de tocar la base:

1. **El whitelist `SETTING_KEYS` sigue siendo la única puerta.** Corre primero, así que el
   upsert nunca puede crear una fila arbitraria. Cambiar a upsert **no relaja nada**: sin el
   whitelist, un `PATCH /admin/settings/loQueSea` crearía la fila (verificado por mutación).
2. **`POSITIVE_INT_SETTING_KEYS` y `PERCENT_SETTING_KEYS`** — un `0` en una clave numérica se
   rechaza con 400 exista la fila o no, y no deja una fila con el `0` dentro.
3. **AuditLog `SETTING_UPDATE`** se registra igual en el camino de creación, con el `actorId`
   del admin del PATCH. El `before` es `{ value: null }` cuando no había fila — mismo shape
   en ambos caminos, y el propio `schema.prisma` ya lo anticipaba
   (*"Null si no aplica (p.ej. primera escritura de un Setting)"*).

### Verificación

`settings-upsert.e2e-spec.ts` — **16 tests**: creación sin fila previa, el valor leído
después vía `GET /admin/settings`, segundo PATCH → update (no un segundo create), un setting
que ya tenía fila comportándose idéntico, `supportEmail` y `ticketAutoCloseWindowDays` por
fin editables, clave fuera del whitelist → 400 **sin fila basura** (y con el recuento total
de la tabla intacto), `POSITIVE_INT` con y sin fila, `PERCENT`, `updatedById`, la entrada de
audit en creación y en actualización, y que un 400 no deja rastro en el audit.

**Validación por mutación (dos), y lo que importa es cómo REPARTEN los rojos:**

| Mutación | Rojos | Verdes |
|---|---|---|
| Volver a `findUnique` + throw | **9** — todos los del camino de creación | los 7 de guardas: whitelist, ataque, `POSITIVE_INT` sin fila, `PERCENT`, fila existente, sin-audit-en-400 |
| Vaciar el whitelist | **2** — los dos del whitelist (llegan al upsert y devuelven 200) | los 14 restantes |

El reparto es la prueba: los tests de creación ejercen el upsert y **solo** el upsert, y los
de whitelist ejercen el whitelist y **solo** el whitelist. Ninguno pasa por accidente.

### Lo que este fix NO hizo (→ cerrado en la ráfaga siguiente)

El editor de `/admin/ajustes` seguía sin mostrar las tres claves: `ORDER` no las incluía y
`if (!setting) return null` se saltaba cualquier clave sin fila. La API ya las aceptaba, pero
un admin no podía tocarlas. Cerrado en "UI de ajustes" más abajo.

**Batería:** backend **1408/1408 en dos corridas consecutivas idénticas** (88 suites; eran
1393/87 al cerrar B1 → +16 del spec nuevo, −1 por los dos tests de B1 que se funden en uno).
`tsc` limpio en api y web. El upsert **no siembra nada**: el spec limpia sus tres claves en
`beforeEach` y en `afterAll`, así que el estado base no cambia entre corridas.

**Requisito de oro cumplido:** el whitelist sigue siendo la única puerta; los settings con
fila se comportan idéntico; ningún test preexistente con lógica modificada. El único test
retocado es el de B1 que **documentaba el bug** (`maxTagsPerListing … → 404`): ahora asserta
el contrato correcto (200 + fila creada), porque el bug que describía ya no existe.

---

## UI de ajustes — las tres claves sin fila, editables desde el backoffice (cerrado)

Última milla del fix del upsert. El PATCH ya las aceptaba; faltaba que el editor supiera que
existen.

### El bug tenía DOS capas, y hacían falta las dos para verlo

1. **`ORDER`** — la lista fija de claves que `/admin/ajustes` pinta no incluía ninguna de las
   tres.
2. **`if (!setting) return null`** — aunque estuvieran en `ORDER`, el editor se saltaba toda
   clave sin fila, que es exactamente su caso.

Arreglar solo una no habría cambiado nada visible. Está verificado por mutación: **matar
cualquiera de las dos capas por separado vuelve a dejar los ajustes invisibles.**

### El arreglo

**Backend (aditivo).** `getSettings()` devuelve ahora **toda** clave del whitelist, tenga
fila o no; las que no la tienen salen con su default y `configured: false`:

```ts
const SETTING_DEFAULTS: Readonly<Record<string, unknown>> = {
  maxTagsPerListing: DEFAULT_MAX_TAGS_PER_LISTING,
  ticketAutoCloseWindowDays: TICKET_REOPEN_WINDOW_DAYS,
  supportEmail: null,
};
```

Las constantes se **importan, no se copian**. Ese era el punto delicado: un `5` escrito a
mano en el front habría divergido en silencio de `DEFAULT_MAX_TAGS_PER_LISTING` la primera
vez que alguien lo cambiara. `supportEmail` no tiene constante a propósito — "sin configurar"
significa que no hay buzón. Las filas reales salen exactamente igual que antes (mismos
campos, mismo orden por clave); lo nuevo son las entradas sintéticas y el flag, y el test
preexistente de `GET /admin/settings` usa `toContain`, así que no se ve afectado.

**Frontend.** Las tres claves entran en `ORDER` **sin mover ninguna de las que ya estaban**
(`maxTagsPerListing` junto a la config de anuncios; el par de tickets al final, que se leen
juntas). `TextSettingEditor` nuevo para `supportEmail`; los dos numéricos reutilizan
`NumberSettingEditor` con `min={1}`. Cuando no hay fila, la cabecera dice **"Sin configurar —
se usa el valor por defecto"** en vez de formatear un `updatedAt` que no existe.

Una honestidad sobre la validación de cliente: en los numéricos **refleja** la del backend
(`POSITIVE_INT` rechaza `< 1` igual si se la salta). En `supportEmail` **no**: el backend no
valida el formato de esa clave, así que el aviso es UX y nada más. Está dicho en el código en
vez de dejar creer que hay una garantía que no existe.

### Verificación

**Backend:** `settings-upsert.e2e-spec.ts` pasa de 16 a **21 tests** — las claves sin fila
salen en el listado con `configured:false` y `updatedAt:null`, el default que viaja es
literalmente `DEFAULT_MAX_TAGS_PER_LISTING`/`TICKET_REOPEN_WINDOW_DAYS` (el test los importa,
así que sigue el cambio si alguien los toca), tras guardar pasa a `configured:true`, las
claves con fila salen igual que antes, y el listado sigue ordenado por clave.

**Playwright:** `admin-ajustes-sin-fila.spec.ts`, 3 tests. El primero recorre el ciclo entero
que antes era imposible — sin fila → se pinta con su default → guardar la crea → recargar
muestra el valor guardado — y comprueba contra la API que la fila existe de verdad, no que
sea estado de cliente. Los defaults esperados **se leen del backend al empezar**, no se
escriben en el spec. Los otros dos: la validación de cliente del `0`, y que un ajuste
preexistente (`listingExpiryDays`) se sigue editando igual.

El estado "sin fila" está garantizado porque `global-setup.ts` trunca la base antes de cada
corrida y ningún seed siembra estas tres claves; el spec las restaura a su valor por defecto
al terminar (no se pueden borrar por API) para no alterar las specs posteriores.

**Validación por mutación (dos), una por capa:**

| Mutación | Resultado |
|---|---|
| `getSettings` vuelve a devolver solo las filas existentes | **2 de 3 rojos** — las tres tarjetas desaparecen |
| Las tres claves fuera de `ORDER` | **2 de 3 rojos** — mismas tarjetas, mismo fallo |

En los dos casos el tercer test —el del ajuste preexistente— **sigue verde**, que es lo que
demuestra que el spec distingue entre "el editor está roto" y "estas tres claves no se ven".

**Batería:** backend **1413/1413 en dos corridas consecutivas idénticas** (88 suites; +5 del
spec ampliado). `tsc` limpio en api y web; lint igual que el baseline (6).

**Requisito de oro cumplido:** las claves que ya se editaban conservan input, validación y
guardado; el backend solo cambia de forma aditiva; ningún test existente con lógica
modificada.

---

## Búsqueda + Tags — RÁFAGA B2: tags en el anuncio (cerrada)

Diseño §4.5–§4.7. B1 construyó el vocabulario; B2 lo pone **en uso**: el usuario elige
etiquetas al publicar, se validan, se indexan y se ven en la ficha. **NADA filtra por tags
todavía** — eso es B3.

### Backend

**DTO.** `tags?: string[]` en create y update, por **SLUG** (no id): es lo que viajará en la
URL de búsqueda y lo que se indexa, así que un solo identificador para las tres cosas. El DTO
valida solo la FORMA (`@IsArray` + `@IsString({each:true})`), igual que `attributes` se queda
en `@IsObject`: qué slugs valen depende de la categoría y el tope depende de un Setting.
**Sin `@ArrayMaxSize`** a propósito — clavar el tope ahí crearía un segundo sitio donde vive
el mismo número.

**Validación** (`TagsService.resolveTagsForListing`) — el punto donde `maxTagsPerListing`
por fin se usa. Dos reglas, las dos con **422**: pertenencia al set EFECTIVO de la categoría
(propios + heredados, solo activos) y `length <= max`, con el tope en el mensaje. Deduplica
antes: el mismo tag dos veces no son dos tags, y sin deduplicar reventaría la clave compuesta
de `ListingTag` con un P2002 opaco.

**Disparador por-campo en `update()`** — la cuarta validación con disparador propio, junto a
atributos, tipo y formato de precio. La asimetría es deliberada:

| Qué llega en el PATCH | Qué pasa con los tags |
|---|---|
| `tags` presente | Validación ESTRICTA contra la categoría destino y el tope → 422 si algo falla. El usuario los eligió, puede corregirlos. |
| Solo cambia `categoryId` | Los que la categoría destino no ofrece se **podan en silencio**; la edición pasa. El usuario no eligió romperlos, movió el anuncio. |
| Ninguna de las dos | No se tocan. **Grandfathering**: un anuncio con 8 tags y un tope nuevo de 5 se sigue editando. |

`pruneTagsForCategory` **no** aplica el tope, a propósito: es una poda, nunca puede aumentar
el número de tags, así que un anuncio grandfathered sobrevive también a un cambio de
categoría.

**Escritura atómica.** `create` anida `tags: { create: [...] }` dentro de
`prisma.listing.create`, y `update` anida `deleteMany + create` dentro de
`prisma.listing.update`. Un write anidado de Prisma va en la misma transacción implícita que
la fila padre: o se guardan anuncio y tags, o no se guarda nada.

**Lectura.** `LISTING_INCLUDE` trae los tags ordenados por el `orden` del CATÁLOGO
(`ListingTag` no tiene orden propio), y tanto `findBySlug` como `findMineById` los **aplanan**
a `TagRef[]` — la tabla puente es un detalle de almacenamiento. Se aplanan en el mismo sitio
donde `phone` ya se descarta, así que la forma pública se decide en un punto. *Ojo con la
caché*: los blobs de Redis anteriores a B2 no llevan `tags`; se autocorrige en 5 min y el
front lo trata como opcional (precedente de `category.parent` en A1).

**`GET /categories/:slug` gana `tags` y `maxTags`.** El segundo es global, no de la
categoría, y viaja aquí por lo mismo que `allowedPriceUnits`: esta llamada es "todo lo que el
wizard necesita para configurarse". La alternativa era escribir un `5` en el front — la misma
divergencia con `DEFAULT_MAX_TAGS_PER_LISTING` que ya costó una ráfaga evitar.

### Indexación — los 6 pasos del §1.5

1. `INDEX_INCLUDE` += `tags: { select: { tag: { select: { slug, name } } } }` — **compartido**
   por el processor y `pnpm reindex`, como advierte su nota: si solo uno lo cargara, un mismo
   anuncio tendría documentos distintos según por qué camino se indexara.
2. `toDocument()` emite `tags` (slugs) y `tagNames` (nombres) **DESPUÉS del `...attributes`**.
3. `CORE_FILTERABLE_ATTRIBUTES` += `tags`. `tagNames` NO: es searchable y nada más.
4. `SEARCHABLE_ATTRIBUTES` += `tagNames`, **después de `title` y antes de `description`** — un
   tag es vocabulario que alguien eligió, pesa más que la prosa libre; menos que el título.
5. `NATIVE_FACET_ATTRIBUTES` += `tags` — una faceta más en la misma petición, sin viaje extra
   (razonamiento de `priceUnit`), para que B3 tenga los conteos listos.
6. `RESERVED_ATTRIBUTE_NAMES` += `tags`, `tagNames`; `CORE_SEARCH_QUERY_KEYS` += `tags`.

**El límite de B2, explícito:** añadir `tags` a `CORE_SEARCH_QUERY_KEYS` sin añadirlo a
`SearchQueryDto` hace que `?tags=x` choque con `forbidNonWhitelisted` y devuelva **400**. Es
lo que se quiere: el filtro llega en B3 y hasta entonces el parámetro se **rechaza** en vez de
ignorarse en silencio — que sería peor, porque un enlace con `?tags=` parecería filtrar sin
hacerlo. Verificado.

**Reindex:** no obligatorio (un documento sin `tags` no casa con `tags=x`, que es la semántica
correcta). `pnpm reindex` queda **recomendado** tras desplegar, para normalizar `tags: []` en
los documentos viejos.

### Frontend

Paso `StepTags` entre `atributos` y `ubicacion`, en los **dos** wizards. La regla de
desaparición se extrajo a `resolveActiveSteps(steps, data)`, compartida por ambos para que no
puedan divergir: sin schema desaparece `atributos`, sin tags efectivos desaparece `tags`, y
las dos reglas conviven. `StepCategoria` guarda `availableTags`/`maxTags` del mismo
`GET /categories/:slug` que ya pedía. Al cambiar de categoría, los tags que la nueva no
ofrece se descartan **en silencio** y los que siguen valiendo se conservan.
`validateStep('tags')` nunca bloquea por falta (no son obligatorios); solo por superar el
tope, situación que la UI ya impide pero que el estado puede alcanzar tras idas y venidas.
`EditarWizard` precarga los tags del anuncio, filtrados contra los efectivos (uno puede
haberse desactivado tras publicarse). La ficha los pinta como chips, con la misma regla de
desaparición; **sin enlace**, porque el destino filtrado no existe hasta B3.

### ⚠️ Hallazgo — `RESERVED_ATTRIBUTE_NAMES` no rechaza, solo ignora

El brief daba por hecho que crear un atributo de categoría llamado `tags` devolvería 400.
**No lo hace**: se ejerció y el `PATCH /admin/categories/:id` responde **200**.
`RESERVED_ATTRIBUTE_NAMES` no es una validación de escritura — vive en
`FilterableAttributesResolver.toMap`, que **salta** los nombres reservados al construir el
mapa de atributos filtrables. Es preexistente y afecta a todos los nombres core, no solo a los
de tags.

El requisito de oro se cumple igual, porque lo que pide es que **ningún atributo pueda
colisionar**, y hay dos barreras que sí funcionan: (1) un atributo llamado `tags` nunca llega
a ser filtro, y (2) aunque un anuncio lo lleve en su bag, el documento tiene los slugs, porque
los campos core se emiten después del spread. Las dos están verificadas. **Queda como decisión
abierta** si añadir un 400 al guardar: sería una validación nueva sobre un endpoint existente
que afectaría a todos los nombres reservados, no solo a los de B2, y el propio comentario del
resolver recuerda que ya hubo datos con nombres colisionantes (`type` vs `itemType` en el
seed) — así que el cambio necesita mirar antes qué hay en producción.

### Verificación

`tags-b2.e2e-spec.ts` **21 tests** y `search.service.todocument.spec.ts` **5**.

**Validación por mutación (tres):**

| Mutación | Rojos |
|---|---|
| Quitar la comprobación de pertenencia al set efectivo | **7** — tag ajeno, tag huérfano, tag desactivado, PATCH con categoría nueva (+3 arrastrados) |
| Quitar el tope de `resolveTagsForListing` | **3** — los tres del tope, incluido el configurable |
| Emitir `tags` ANTES del `...attributes` | **2** — las dos colisiones del spec unitario |

**Nota de método — una carrera que casi da un falso verde.** La tercera mutación se probó
primero en el e2e (crear → publicar → cola → Meilisearch → `getDocument`) y salía **VERDE**:
`waitForIndex` solo espera a que el documento EXISTA, y la aserción leía una versión que aún
podía cambiar. Se detectó porque añadir una consulta a Postgres antes de la lectura —unos
milisegundos— la volvía roja. El orden de las claves de un objeto literal es lógica pura y
determinista; medirlo a través de tres asíncronos mide los tiempos, no el código. Por eso esa
afirmación vive ahora en un test **unitario** de `toDocument`, donde la mutación falla siempre,
y el e2e conserva lo que sí es observable de punta a punta (que un atributo `tags` no filtra).

**Batería.** Backend e2e **1432/1434 en dos corridas consecutivas idénticas** (89 suites);
unitarios api **164/164** (17 suites, +5 del spec de `toDocument`); web 357/357; `tsc` limpio
en api y web; lint igual que el baseline (6).

Los **2 rojos son PREEXISTENTES**, y se midió para poder afirmarlo:

| | Tests | Suites | Rojos |
|---|---|---|---|
| HEAD limpio (con `git stash`) | 1413 | 88 | **6** |
| Con B2 | 1434 | 89 | **2** |

Los 21 tests y la suite de más son exactamente `tags-b2.e2e-spec.ts`. Los rojos caen siempre
en las mismas dos suites —`alert-matching` y `queue-retry`— y en HEAD son **más** (6) que con
B2 (2), así que no los introduce esta ráfaga.

### ⚠️ Test frágil que hay que reportar — `alert-matching` y `queue-retry`

Estas dos suites **eran verdes hace unas horas**: al cerrar la ráfaga anterior el mismo HEAD
daba 1413/1413 en dos corridas idénticas. Sin ningún cambio de código en ellas, ahora el mismo
commit da 1407/1413. Y en aislado la inestabilidad se mueve: corriendo `alert-matching` sola
tres veces fallan **tres tests distintos** del bloque `renew() vs reserve()/closeDeal()` en dos
corridas y ninguno en la tercera.

Es inestabilidad de TIEMPOS, no de lógica: ambas suites esperan a que un job de BullMQ pase por
Meilisearch y luego inspeccionan la cola (`getJobs(['completed','waiting','active','delayed'])`),
que es una foto de algo que se está moviendo. `queue-retry` además cuenta reintentos de un spy
que en la corrida fallida no se llegó a invocar (`attempts: 0`).

Siguiendo el criterio de la ráfaga de saneamiento —"si un test que pasaba se pone rojo, ESO ES
UN TEST FRÁGIL QUE HAY QUE REPORTAR, no un fallo del saneamiento"— **se reporta y no se
parchea**: arreglarlas es trabajo propio (esperar a un estado observable en vez de a un
instante de la cola), no algo que deba colarse dentro de B2.

**Requisito de oro cumplido:** el sistema de atributos intacto (`...attributes` sigue primero,
tags después); la búsqueda sin `?tags=` devuelve lo mismo; ningún test existente con lógica
modificada — los dos retocados lo son por FIRMA, no por lógica: `listings.service.spec.ts`
gana un mock para el parámetro nuevo del constructor y `EditarWizard.test.tsx` los campos
nuevos del estado.

---

## Búsqueda + Tags — RÁFAGA B3: filtrado por etiquetas (cerrada)

Diseño §4.7. B2 indexó el campo y dejó `?tags=` dando 400 a propósito; B3 lo activa. A
diferencia de B2 —que era aditivo— **esto cambia qué anuncios salen**.

### Backend

**Formato CSV** (`?tags=diesel,garantia`) y no multivalor, como decidía el diseño: todo el
frontend asume un valor por clave (`str()` se queda con el primero, `FilterPanel.update()`
usa `params.set()`), así que el multivalor obligaría a tocar todos esos helpers. El
`@Transform` del DTO parte por comas, normaliza y deduplica; también acepta un array por si
algún cliente manda `?tags=a&tags=b`, aplanándolo en vez de perder un filtro en silencio.

**Semántica AND** — una cláusula de filtro POR ETIQUETA, no una con `OR`:

```ts
for (const tag of params.tags ?? []) filters.push(`tags = "${this.escape(tag)}"`);
```

Cada elemento de `filters` se combina con AND, así que acumular etiquetas **acota**, igual
que acumular filtros de atributo. En Meilisearch `tags = "x"` sobre un array significa
"contiene x", de ahí que la igualdad baste.

**Sin categoría funciona.** `tags` está en `CORE_SEARCH_QUERY_KEYS`, y eso es justo lo que lo
mantiene **fuera** de la validación scoped-por-categoría de los atributos: un atributo
pertenece a una categoría (de ahí el 400 anti-leak de RÁFAGA 1, que **no se toca**), pero un
tag es vocabulario global. `/busqueda?tags=diesel` es una búsqueda legítima.

#### Decisión: un slug desconocido se descarta EN SILENCIO, no da 400

Es el punto que el brief pedía justificar. Se descarta, y la diferencia con los atributos no
es de rigor sino de qué significa cada cosa:

- un atributo ajeno a la categoría (`/coches?rooms=3`) es un **error de ámbito**: el 400
  existe para que no se filtre a través de categorías;
- un tag desconocido es casi siempre un **enlace viejo** — alguien compartió `?tags=diesel` y
  meses después un admin desactivó ese tag. Romper esa búsqueda castiga al visitante por una
  decisión de administración que no vio.

La tercera opción —pasar el slug a Meilisearch tal cual— daría **0 resultados**, que es peor:
"no hay nada" y "ese filtro ya no existe" son indistinguibles para el usuario. Descartándolo
ve el resto de la búsqueda. Y el panel no queda incoherente, porque solo pinta chips de tags
ofrecidos: un tag descartado tampoco aparece marcado.

El filtrado usa `TagsService.activeTagSlugs()`, cacheado en Redis (misma invalidación que el
resto del vocabulario: crear un tag o (des)activarlo la limpia).

**`GET /categories` (el árbol) gana `tags` por nodo**, efectivos y solo activos. Es lo que
permite que el cliente decida sin un viaje extra — exactamente el papel que `allAttributes`
juega desde A2. La herencia se resuelve en el backend, con `resolveEffectiveTags`, para que
viva en un solo sitio.

### Frontend

**Sección "Etiquetas"** en `FilterPanel`, la **única multi-selección** del panel: el resto de
facetas son toggles excluyentes (`toggleFacet`) porque un anuncio tiene una provincia o un
estado, pero puede tener varias etiquetas — y marcarlas acota. La lista la dicta la CONFIG
(`availableTags`), no las facetas, así que una etiqueta configurada sin anuncios se pinta con
`(0)` y deshabilitada (criterio F6 de A3); los conteos vienen de `facets.tags`, y las que
tienen resultados van primero. Con dos o más marcadas aparece un aviso de que se exigen
todas — el AND es contraintuitivo si no se dice.

**`lib/available-tags.ts`** — hermano de `filterable-fields.ts`, misma regla: hoja → sus
efectivos; raíz → los suyos ∪ los de sus hijas (navegar una raíz agrega los anuncios de las
hijas); `/busqueda` → la unión del árbol. Esa unión **no** es "el catálogo entero": un tag sin
asignar a ninguna categoría no lo puede llevar ningún anuncio, así que ofrecerlo sería un
callejón sin salida garantizado.

**Preservación al cambiar de categoría** (`filter-carry.ts`): las etiquetas se filtran **una a
una**, no se conserva o tira el parámetro entero. Si el usuario venía con `diesel,garantia` y
el destino solo ofrece `garantia`, lo útil es llegar filtrando por `garantia`.

**Los chips de la ficha ahora enlazan** (B2 los dejó sin `href` porque el destino no existía).
Reutilizan el `categoryHref` que ya calcula el breadcrumb, así que el enlace del tag y el de
la categoría no pueden divergir.

### Verificación

`tags-b3.e2e-spec.ts` **15 tests**, `tags-filtro.spec.ts` (Playwright) **5**, y
`src/lib/tags-filter.test.ts` **14** unitarios.

El reparto no es casual: el **AND** y el descarte de slugs se prueban en el backend, donde son
deterministas; la **regla de arrastre** al cambiar de categoría es lógica pura sobre el árbol,
así que va en el unitario (medirla en Playwright probaría el `router.push`); y en el navegador
queda solo lo que solo ahí se puede ver — que el segundo chip **acumula** en vez de sustituir.

Tres anuncios construidos justo para distinguir AND de OR: uno con cada etiqueta por separado
y uno con las dos. Con OR saldrían los tres.

**Validación por mutación (dos):**

| Mutación | Rojos |
|---|---|
| AND → OR (una cláusula con `OR` en vez de una por tag) | **3** — los tres del AND |
| Quitar el filtro de tags del service | **6** — todos los que dependen de que filtre |

**Batería:** backend **1449 tests, 90 suites** (+15 y +1 respecto a B2: exactamente el spec
nuevo). Dos corridas: **1448/1449** y **1447/1449**.

No son idénticas, y conviene decir por qué: `queue-retry` falla en las dos —rojo estable y
preexistente— y `alert-matching` falla en una sí y en otra no. Son los **mismos dos flakes ya
reportados al cerrar B2**, donde se midieron contra HEAD limpio (`git stash`): **6 rojos en
HEAD** frente a 2 con los cambios. Ninguna otra suite se mueve entre corridas.

Web 371/371 (31 suites, +14 del spec nuevo); Playwright de tags 5/5; `tsc` limpio en api y
web; lint igual que el baseline (6).

**Requisito de oro cumplido:** sin `?tags=` los hits son los mismos; el 400 anti-leak de
atributos sigue intacto (verificado con un test propio); los filtros existentes no cambian —
`tags` es una sección más.

**Dos tests de B2 SÍ se modificaron, y era obligatorio.** Los dos afirmaban el LÍMITE de B2
—que `?tags=` devolvía 400—, que es justo lo que B3 elimina. Un test que describe un
comportamiento retirado no se puede dejar en verde. `B2 NO filtra` pasa a comprobar lo que
sigue siendo suyo (que lo indexado es lo que el filtro encuentra), y el de nombres reservados
cambia su señal: antes el 400 probaba que un atributo `tags` no era filtro; ahora, que
`?tags=valor-del-atributo` no acota la búsqueda. Ningún otro test existente tocado.

### Nota — un endpoint que se escribió y se quitó

Se llegó a añadir un `GET /tags` público para alimentar el panel en `/busqueda`. Se eliminó
antes de cerrar: el árbol de categorías ya lleva los tags de cada nodo (necesarios para el
arrastre), y su unión es a la vez más barata —cero llamadas nuevas— y más correcta, porque
excluye los tags que no se ofrecen en ninguna categoría. Si B4 necesita el catálogo completo
para las sugerencias de portada, ese será su endpoint y su decisión.

---

## Búsqueda + Tags — RÁFAGA B4: buscador de portada con sugerencias (cerrada)

Diseño §4.8. **Última pieza del trabajo de Búsqueda + Tags.** El buscador de la home
sugiere etiquetas según texto + categoría; el texto libre sigue existiendo, pero
canalizado.

### `GET /tags/suggest?q=&category=&limit=` — POSTGRES-FIRST

La decisión de diseño y su motivo, que es lo que hace que esta ráfaga no sea trivial. Una
búsqueda de facetas (`searchForFacetValues`) sola **no sirve**, por tres razones:

1. **Nunca puede sugerir una etiqueta sin anuncios** — por definición solo devuelve
   valores presentes en el índice. Un catálogo recién configurado nacería mudo: el admin
   crea "Con garantía" y el buscador no la ofrece hasta que alguien publique con ella.
2. **No puede ordenar por criterio editorial** (`orden`), que es la razón de ser de un
   vocabulario controlado.
3. **Apareció al implementarlo:** `facetQuery` filtra por el valor INDEXADO, que es el
   **slug**. El usuario teclea el **nombre**, con acentos — "automático" no casa con
   `cambio-automatico`. Usarlo para SELECCIONAR descartaría candidatos legítimos en
   silencio.

Por eso: **candidatos** desde Postgres por nombre (`contains`, insensible a mayúsculas,
acotado por `CategoryTag` propio + del padre), **conteos** desde Meilisearch en UNA
llamada sin `facetQuery`, y fusión ordenando por `count desc` y, a igualdad, por el
`orden` del admin — con lo que los de 0 caen al final solos, sin una regla aparte (P6).

Se piden **50 candidatos** y se recorta al `limit` DESPUÉS de ordenar: quedarse con los
primeros por orden editorial descartaría el tag más popular si el admin lo hubiera puesto
abajo.

**`q` vacío:** con categoría se devuelven sus etiquetas efectivas por orden editorial —
abrir el desplegable y ver de qué se puede hablar es descubrimiento, y el vocabulario de
una categoría es corto. Sin categoría, nada: el catálogo global entero no es una
sugerencia, es un volcado.

**Meilisearch v1.10 — NO se llama a `updateFacetSearch`.** La búsqueda de facetas está
siempre disponible en esta versión; el ajuste `facetSearch` llegó en **1.12**, así que
llamarlo aquí daría 400. Verificado contra `docker-compose.yml`.

**Degradación:** si Meilisearch no responde, se devuelven conteos vacíos en vez de
romper. El buscador sigue sugiriendo el vocabulario, todo a (0) — preferible a que la
portada deje de sugerir.

**Inyección:** `contains` de Prisma viaja como parámetro. `%` y `_` sí actúan como
comodines de LIKE dentro del valor, lo que como mucho sugiere de más; evitarlo exigiría
SQL crudo con `ESCAPE`, cambiando una propiedad de seguridad real por una cosmética.

### Frontend — `SearchBar`

Debounce de 250 ms a partir de 2 caracteres, con `AbortController`: sin él, teclear
rápido puede hacer que una respuesta vieja llegue después de una nueva y pinte una lista
que ya no corresponde a lo escrito.

Desplegable en dos bloques, y **ese orden ES la decisión de producto**: las etiquetas
arriba y destacadas, el texto libre al final como salida de escape. Los conteos se
muestran siempre, también el `(0)` — es información honesta ("existe, pero todavía no hay
nada").

**Destino** — donde el bloque A y el B se tocan: elegir una etiqueta con categoría lleva a
`categoryPath(cat)?tags=slug` (URL anidada de A1 + filtro de B3), sin categoría a
`/busqueda?tags=slug`, y la provincia elegida viaja en los dos casos. Elegir una etiqueta
NO hace una búsqueda de texto: el usuario escribió "diesel" y acaba con un filtro exacto,
no con una coincidencia de texto. Eso es literalmente "el texto libre canalizado".

Teclado completo: flechas (que recorren la lista **y** la salida de escape), Enter, Esc y
clic fuera.

### ⚠️ Bug encontrado al ejercer — la caché de sugerencias no se invalidaba

`setCategoryTags` invalidaba los tags efectivos de la categoría y sus hijas, pero no las
sugerencias. Asignar una etiqueta al padre y sugerir en la hija seguía devolviendo la
lista vieja hasta que expirara el TTL. Lo mismo con renombrar o reordenar. Corregido: toda
mutación del vocabulario tira ahora también `tags:suggest:*`. Se detectó porque tres tests
fallaron por ello — no por revisión.

### Verificación

`tags-b4.e2e-spec.ts` **19 tests** y `buscador-sugerencias.spec.ts` (Playwright) **11**.

**Validación por mutación (dos):**

| Mutación | Rojos |
|---|---|
| Quitar el orden por conteo (solo criterio editorial) | **2** — el de orden y el de `limit` |
| Candidatos SOLO desde la faceta (sin Postgres) | **6**, incluido **el de P6** |

La segunda es la que justifica la arquitectura: con candidatos de faceta, el tag sin
anuncios desaparece. Ese test **es** el argumento de por qué Postgres-first, no un extra.

**Batería:** backend **1466/1468 en dos corridas consecutivas IDÉNTICAS** (91 suites; +19
y +1 respecto a B3, exactamente el spec nuevo). Los 2 rojos son los flakes preexistentes
de `alert-matching` y `queue-retry`, medidos en HEAD limpio al cerrar B2 (**6 rojos ahí**).
Unitarios api 164/164; web 371/371; Playwright de B4 11/11; `tsc` limpio en api y web;
lint igual que el baseline (6).

**Requisito de oro cumplido:** el submit de texto libre funciona exactamente como antes
—hay un test dedicado— y `/tags/suggest` es nuevo y aislado: no toca `/search` ni el
filtrado. Ningún test existente con lógica modificada.

---

## 🏁 BÚSQUEDA + TAGS — TRABAJO COMPLETO

| | Ráfaga | Qué cerró |
|---|---|---|
| **A1** | URLs anidadas de categoría | `/vehiculos/coches` + 308 desde las planas |
| **A2** | Unificación `/busqueda` ↔ `/[categoria]` | un selector, filtros que sobreviven |
| **A3** | Panel de filtros schema-driven | la config dicta las secciones, no las facetas |
| **A4** | Rango numérico | `_min`/`_max`, aditivo sobre la igualdad |
| **B1** | Modelo Tag + herencia + CRUD admin | vocabulario, `maxTagsPerListing` |
| **B2** | Tags en el anuncio | wizard, validación, indexación |
| **B3** | Filtrado por etiquetas | `?tags=` CSV con AND, sección multi-selección |
| **B4** | Buscador de portada | sugerencias Postgres-first, texto libre canalizado |

Más dos arreglos que salieron por el camino: la carrera de `handleConnection` en el
gateway y el `updateSetting` que hacía tres ajustes ineditables (con su UI).

### Deuda anotada, no cerrada

- ~~**`alert-matching` y `queue-retry` son frágiles**~~ → **cerrado en parte**: ver
  "Cómo se esperan estados asíncronos en los e2e" más abajo. `alert-matching` era
  fragilidad de espera y está resuelto. `queue-retry` resultó ser OTRA COSA (no un
  problema de espera) y sigue abierto — detalle en esa misma sección.
- **`RESERVED_ATTRIBUTE_NAMES` no rechaza, solo ignora** (ver la nota en B2). Añadir un
  400 al guardar afectaría a todos los nombres reservados, no solo a los de tags.
- **Reindex recomendado tras desplegar** (`pnpm reindex`) para normalizar `tags: []` en
  los documentos anteriores a B2. No obligatorio: un documento sin `tags` no casa con
  `tags=x`, que es la semántica correcta.

---

## 🏁 La saga del CI — estado final: el CI vuelve a ser SEÑAL

De **~32 rojos rotando ilegibles** (y un job que ni siquiera llegaba a veredicto: lo
cancelaba GitHub a los 30 min) a un pipeline **verde en el runner**, estructurado para que verde
signifique *"el producto funciona"*, con el ruido conocido marcado y aparte.

El objetivo nunca fue "cero rojos". Fue doble, y hasta la última ráfaga solo se había cumplido la
mitad: que el CI **distinga señal de ruido**, y que **su color diga la verdad**. Durante ráfagas
ejecutó bien la señal y la **reportó mal** — el pipeline estuvo rojo con el producto sano, no por
un test frágil sino porque el filtro que separaba las dos cosas **nunca llegó a aplicarse en el
runner**.

> **CERRADA — y por primera vez el veredicto NO es local: es del runner.**
>
> Corrida **`30930395538`**, SHA **`e4df671`**, leída con `gh` sobre la API de Actions.
> `conclusion = success` en los dos jobs.
>
> | En el RUNNER (Ubuntu) | Medición | Step |
> |---|---|---|
> | Backend e2e — Jest | **1476 pasados / 1476 · 92/92 suites** | success |
> | Frontend unit — Jest | **378 pasados / 378 · 32/32 suites** | success |
> | Playwright — **señal** (`--grep-invert @2b`) | **`Running 248`** → 247 pasados, 1 saltado, **0 fallos** (6,1 min) | success |
> | Playwright — **@2b** (tolerado) | **`Running 23`** → 16 pasados, 4 flaky, **3 fallidos** (6,7 min) | absorbido por `continue-on-error` |
> | **JOB `E2E Tests`** | — | **success** |
> | **JOB `Lint & Typecheck`** | — | **success** |
>
> Los `Running 248` / `Running 23` son la prueba de que **el split aplica en CI por primera
> vez desde que existe** (antes el step señal arrancaba con `Running 271`).
>
> El backend además tiene **dos corridas locales idénticas** previas (1476/1476, 658 s y 284 s;
> la diferencia es caché caliente de Docker/Meili, los recuentos son iguales).
>
> Nada abierto. Nada inferido: el verde se LEYÓ en el runner, no se dedujo de que las piezas
> compusieran.
>
> *Honestidad sobre el ruido tolerado:* el step @2b **falló 3 de 23** y otros 4 solo pasaron
> por `retries: 1`. Eso es lo esperado —es ruido conocido, por eso está aparte— pero conviene
> no leerlo como "los 23 pasan": no pasan, simplemente **no bloquean**.

### Añadido después del cierre: los unit del backend, que el CI no ejecutaba

La saga se cerró con el CI ejecutando `Backend e2e — Jest`, `Frontend unit — Jest` y los dos
pasos de Playwright — pero **sin los unit del backend**. Los 17 `*.spec.ts` de `apps/api/src/`
(lógica pura: el calendario del cron de facturación en `invoicing/period.spec.ts`, el validador
de NIF/DNI/NIE/CIF, el parser de la query de búsqueda, el resolver de atributos filtrables…)
solo corrían si alguien lanzaba `pnpm --filter @marketplace/api test` a mano. Eran **verdes que
nadie miraba**: podrían haber estado en rojo y el pipeline habría seguido dando verde, porque no
los ejecutaba.

Detectado en la auditoría de documentación de 2026-08-04 (`pendientes.md` §4.2, ahora cerrado) y
arreglado el 2026-08-05 con el paso **`Backend unit — Jest`** (`pnpm --filter @marketplace/api
test`), commit `b0c5916`.

**Verificados en verde ANTES de cablearlos**, no después: 17/17 suites, 164/164 tests en local.
Meter un test sin correr en el CI es cambiar "verde que nadie mira" por "rojo que aparece de
repente y parece regresión del cambio que lo añadió".

**Va ANTES del montaje de infraestructura** (espera de Meilisearch, MinIO, navegadores de
Playwright), no junto al e2e: son lógica pura, no tocan ningún contenedor de servicio, y ahí un
rojo tumba el job en ~20 s en vez de gastar ~5 min de setup primero. En el runner el paso tardó
**15 s**.

**No solapa con el e2e ni deja ningún unit fuera.** Los dos conjuntos son disjuntos por regex
*y* por `rootDir`: `test` es `jest` a secas (`rootDir: src`, `testRegex .*\.spec\.ts$`) y
`test:e2e` es `--config test/jest-e2e.json` (`rootDir: ..`, `testRegex test/.*\.e2e-spec\.ts$`).
Comprobado con `--listTests` sobre las dos configuraciones: 17 ficheros en el de unit, 0
intersección.

Verificado **en el runner**, no deducido: corrida `31028999515`, SHA `b0c5916` — step
`Backend unit — Jest` = `success`, y el resto de pasos sin cambio de comportamiento.

### La regla que queda

**Verde = el producto funciona.** El CI corre Playwright en dos pasos:

| Paso | Qué corre | Si falla |
|---|---|---|
| `Playwright (señal, sin @2b)` | `exec playwright test --grep-invert "@2b"` — **248 de 271** | **Tumba el pipeline.** El fallo es real. |
| `Playwright (@2b, known-issue)` | `exec playwright test --grep "@2b"` — **23** | `if: always()` + `continue-on-error: true`: corre siempre, informa, no bloquea. |

248 + 23 = 271. El complemento es exacto: ningún test se queda fuera de los dos sacos, y ningún
no-etiquetado cae en el tolerado. **Verificado en bash y confirmado en el runner** (`Running 248`
y `Running 23` en el log de la corrida) — no con un `--list` en PowerShell, que es justo lo que
falló durante ráfagas: ver la lección final más abajo.

**Se invoca con `exec`, nunca con `run <script> -- <args>`.** No es estilo: la forma con `--` es
sensible al shell y tuvo el split roto en CI desde que se creó.

**El split vive en el WORKFLOW, no en `playwright.config.ts`** — y es deliberado. En la config,
el conjunto tolerado sería invisible: se ensancharía en silencio, un `grepInvert` crece sin que
nadie lo note en un diff. En el workflow son dos pasos con nombre en la UI de Actions, cada uno
con su recuento. Lo tolerado se ve.

**`@2b` solo se pone sobre una firma `waitForURL … until "commit"` CONFIRMADA.** Etiquetar un
rojo de otra causa sería un `test.fixme` disfrazado — escondería un bug real, que es
exactamente lo que esta separación existe para impedir.

### Qué es 2b (el ruido tolerado)

La carrera de navegación del App Router bajo `next start`: un clic sobre un `<Link>` a veces
no completa la transición —la RSC payload responde 200 en <10 ms y el router **no conmuta**— y
la página queda con el router cliente **persistentemente wedged**. Bug conocido de Next 15
(firma de `vercel/next.js#57565`), **sin fix upstream**. Caracterizado en 5 rondas de
refutación (ver la sección propia más abajo) y mitigado hasta donde se puede:
`prefetch={false}` en las tarjetas (53 % → 20 % medido) y reintento del CLIC en
`e2e/helpers/nav.ts`. No se puede garantizar verde: esperar más no sirve (medido) y reintentar
tampoco siempre. Por eso se tolera **etiquetado y a la vista**, no escondido.

### Los TRES bugs de PRODUCCIÓN que desenterró el CI legible

Esta es la justificación entera de haber hecho el CI legible: **los tres afectaban a usuarios
reales y los tres eran invisibles mientras los rojos rotaban.** Cada uno tenía un test en rojo
señalándolo; ninguno se leía como "bug de producto", porque un rojo entre treinta y dos que
cambian de corrida en corrida no se lee como nada.

1. **`resolvePriceUnitSelection` — la página de editar anuncio CRASHEABA en producción.**
   *(commit `5b779ca`)* Función pura atrapada en un módulo `'use client'`, invocada desde un
   Server Component. `next dev` no lo detecta; `next start` sí. Funcionaba en local y estaba
   roto en producción — **el modo dev del CI lo estaba ocultando**. Curado extrayéndola a
   `src/lib/price-unit.ts` (módulo sin directiva, importable desde los dos lados) con sus
   pruebas unitarias.
2. **`perPage` por encima del tope del DTO, con el error tragado (SEO).** *(commit `8903dac`)*
   Los llamantes pedían 200 (selector de páginas del footer) y 500 (sitemap) contra un
   `@Max(50)` → **400** que un `.catch` silencioso convertía en lista vacía. Consecuencias: un
   admin **nunca** podía enlazar una página del CMS en el footer, y **el sitemap se generaba
   sin un solo post ni página** en un proyecto descrito como *"fuertemente dependiente del
   SEO"*. Curado con **dos remedios distintos según el volumen**: `@Max(50)` → `@Max(500)` para
   el footer (volumen acotado, cabe en una petición) y **paginación de verdad** para el sitemap
   (`POR_PAGINA = 200` + bucle `traerTodo`, porque el blog crece sin techo y un tope nuevo solo
   aplaza el mismo fallo). Y lo que iba **en cualquier caso**: quitar los silenciadores. Hoy el
   footer pinta un `role="alert"` visible (`item-page-select-error`) y el sitemap registra
   `console.error` diciendo que sale **INCOMPLETO** y con cuántas entradas.
3. **Sobre-conteo de no leídos en la bandeja.** *(commit `c43b5a4`)* `ConversationList`
   incrementaba `unreadCount + 1` cada vez que corría su efecto sobre `[latestMessage]`, **sin
   deduplicar por id de mensaje**: un remount volvía a contar el mismo mensaje. Medido:
   **UI = 8, servidor = 1**. La investigación previa fue la que decidió el arreglo — el
   incremento optimista **es intencionado** (el hermano `ChatClient` ya lo hacía bien,
   deduplicando), así que la cura no era quitar el incremento sino darle memoria: un
   `useRef<Set<string>>` de ids ya contados, sembrado con el `latestMessage` inicial.

**Los rojos que los señalaban eran centinelas correctos, no tests frágiles.** `footer-admin:11`
y `:113` llevaban tiempo en rojo tratados como ruido. Y en `mensajeria-unificada` estuve a punto
de "arreglar" la aserción de `4` a `1` leyendo un estado del servidor: **la aserción nunca
estuvo mal, el producto sí** — con el sobre-conteo curado el badge volvió a 4 solo.

*Nota para el historial:* los tres arreglos viajan en commits titulados `test CI 4/9/12`. Los
mensajes no dicen que ahí dentro hay tres bugs de producción; **este documento es el único
sitio donde esa correspondencia queda escrita.** Conviene no perderla.

### La lección de método (la más cara de aprender)

**Seis hipótesis murieron al medirlas.** Todas venían de leer código o comentarios: el tope de
anuncios activos, la sedimentación entre corridas, la latencia de indexación, la starvation de
`geocode`, el badge de mensajería, la revalidación eventual del footer. Ninguna sobrevivió al
contacto con una medición.

Lo que sí funcionó, siempre: **observar el fallo MIENTRAS ocurre**. La familia 2a estuvo cinco
ráfagas sin explicación porque toda la evidencia era *post mortem* —después de la corrida el
anuncio estaba en Postgres, en Meili, en la API y en las cuatro páginas—. Un instrumento que
sondeaba las cuatro capas EN CADA VUELTA lo resolvió en una corrida: la card estaba pintada y
el helper preguntaba `isVisible()` en el microsegundo en que el App Router la tenía dentro de
un `display:none`.

De ahí las dos reglas que quedan escritas en los helpers: **esperar al ESTADO, no muestrear el
instante** (`waitForCard`, `async-state.ts`, `esperarFooterPublico`) y **un comentario en el
código es una pista, no una medición**.

### Cómo se cerraron los últimos rojos

- **`footer-admin` — reordenar columnas.** La hipótesis "la revalidación es eventual, basta
  con esperar" se midió y era FALSA. La causa real: `listPublicNav` termina con
  `.filter((column) => column.items.length > 0)` — **una columna VACÍA no sale en el footer
  público, y es deliberado**. El test creaba las dos columnas sin ítems y esperaba verlas: el
  fallo era de su PREMISA. Se le añade un ítem a cada una; lo que el test prueba no cambia.
- **`mensajeria-unificada` — badge de no leídos.** Era el bug de producción #3 (ver abajo).
  Arreglado el sobre-conteo, el badge volvió a **4**, que es lo que el test esperaba desde
  siempre. *La aserción nunca estuvo mal; el producto sí.*
- **`blog-markdown-editor`** — parecía "el markdown no renderiza". Sondado en vivo: el
  `<h1>` faltaba porque **el clic no navegaba** y el test seguía en `/blog`. Era 2b. Con el
  reintento de clic: 6/6.
- **`tickets-adjuntos`** — mecanismo observado por fin: el fichero se queda EN EL INPUT
  (`files.length: 1`) y ni lista ni error aparecen → el `onChange` de React no llegó a
  engancharse. Carrera de hidratación. Se reintenta la ACCIÓN, vaciando el input antes de
  reponerlo (poner el mismo fichero no dispara otro `change`). 6/6.

### Etiquetado `@2b`: por PATRÓN, nunca por incidencia

La primera tanda se etiquetó a partir de los fallos de UNA corrida, y la siguiente sacó otros
cuatro tests del mismo spec con firma idéntica. **2b es estocástico**: no falla siempre el
mismo test, falla alguno de los que navegan con `waitForURL … 'commit'`. Etiquetar "el que
falló hoy" deja expuestos sin marcar, siempre.

Regla vigente: se etiqueta **todo test cuya ruta pasa por una navegación
`waitUntil: 'commit'`** (hoy: 12 en `busqueda-unificada` vía `elegirCategoria`, 6 en
`buscador-sugerencias`, 1 en `filtros-schema-driven`, más `busqueda-mapa`, `h8-d4-banners` y
2 en `tags-filtro`) — y **nada más**. Un `@2b` sobre un fallo de otra causa sería un
`test.fixme` disfrazado.

**Excepción medida:** `blog-markdown-editor` alcanza el vector pero NO lleva etiqueta, porque
va por `clicarYEsperarUrl` (que reintenta el clic) y mide 6/6 verde. Es el camino a seguir:
**mitigar el vector hace innecesaria la etiqueta**. Hoy el conjunto tolerado son 23 de 271
(~8,5 %) — bastante suite que no puede bloquear. Encauzar `elegirCategoria` y
`buscador-sugerencias` por el mismo reintento reduciría ese número; queda propuesto.

### La ÚLTIMA cabeza: el split nunca aplicó en CI (y es la más instructiva)

Durante toda la saga el pipeline estuvo **rojo mientras el producto estaba sano**, y la razón no
era ningún test: era **cómo el workflow invocaba Playwright**.

```
run: pnpm --filter @marketplace/web test:e2e -- --grep-invert "@2b"
```

`pnpm run <script> -- <args>` **reenvía el `--` al binario**, y ahí empieza el problema:
Playwright lo interpreta como **fin de opciones**, así que todo lo que va detrás queda
**inerte**. No es que filtrase mal: es que **no filtraba nada**.

Y lo que lo mantuvo escondido cinco ráfagas es que **diverge entre shells**:

| Shell | Comando que pnpm ejecuta de verdad | Resultado |
|---|---|---|
| PowerShell (local) | `playwright test "--list" "--grep-invert" "@2b"` | **248** ✔ |
| bash (el runner) | `playwright test "--" "--list" "--grep-invert" "@2b"` | **271** ✘ |

**PowerShell se COME el token `--`; bash lo pasa literal.** Mismo `pnpm` (11.8.0), mismo texto
de comando, resultado opuesto. Cada vez que se "verificó el filtro con `--list`" se verificó en
el shell que ya había reescrito el comando.

La cadena completa, confirmada con `gh` sobre la corrida real:

1. El step señal corría **los 271**, no 248.
2. Entre ellos los 23 `@2b`, que fallan por el router wedge.
3. El step señal salía **1** → **job en Failure**.
4. Y como el step `@2b` **no tenía `if:`**, quedaba **`skipped`**: nunca llegó a correr en CI.

O sea: el conjunto tolerado **jamás informó de nada**, y el `continue-on-error` que se dio por
bueno durante ráfagas **nunca llegó a entrar en juego**.

**El arreglo — `exec`, no "quitar el `--`":**

```yaml
run: pnpm --filter @marketplace/web exec playwright test --grep-invert "@2b"
```

`pnpm exec <bin> <args>` **no tiene la frontera**: los argumentos van al binario sin pasar por
el reenvío de `run`. Elimina la **clase** de bug (la frontera script/args sensible al shell), no
solo el caso de bash. Es equivalente directo porque `test:e2e` es exactamente `playwright test`,
sin hooks `pre`/`post` — comprobado en el `package.json`, no supuesto.

**Y `if: always()` en el step @2b, ADEMÁS del `continue-on-error`.** Son cosas distintas y
hacían falta las dos: `continue-on-error` impide que su fallo tumbe el job, pero **no hace que
el step corra**. Sin `if:`, se saltaba justo cuando su informe importa.

**Colateral arreglado en el mismo sitio:** los dos steps escribían en el mismo
`playwright-report/`, y como el upload va después de ambos, **el informe de la señal —el que
decide el pipeline— se perdía en cada corrida**. Ahora cada step tiene su carpeta
(`PLAYWRIGHT_HTML_OUTPUT_DIR`) y su artefacto (`playwright-report-senal` / `-2b`), los dos con
`if: always()` para que existan también cuando la señal cae, que es cuando hacen falta.

### Las BARRERAS estructurales que quedan

El criterio de toda la saga: **cada barrera convierte una convención-que-hay-que-recordar en una
imposibilidad.** Un helper compartido que hay que acordarse de usar no es una barrera; se elige
el diseño en el que hacerlo mal cuesta más que hacerlo bien.

| Barrera | Qué imposibilita |
|---|---|
| `apps/api/test/helpers/async-state.ts` | Muestrear el instante. Se espera al **ESTADO definitivo** con una sonda cuyo *throw* significa "aún no", backoff progresivo y **deadline finito** que escala local↔CI. Un bug real falla con diagnóstico; no cuelga. |
| `testTimeout: 120000` en `test/jest-e2e.json` | Que los deadlines sean **inertes**. Estaba en 30 s: un deadline de 60 s dentro de un test que Jest mata a los 30 no espera nada — el helper nunca llegaba a pronunciarse. Subirlo NO alarga las corridas verdes; solo deja que los rojos se expliquen. |
| `apps/web/e2e/helpers/wait-for-card.ts` | Preguntar `isVisible()` en un microsegundo. Se espera el **estado visible por iteración** (`card.waitFor({state:'visible'})`), deadline 45 s local / 90 s CI, sonda `DIAG_WAITFORCARD=1` opt-in conservada. Y el `Math.max(1, …)` del timeout por intento, que **no es cosmético**: en Playwright `timeout: 0` significa *esperar para siempre* — con `Math.max(0, …)` un deadline de 8 s colgó 147 s. |
| `apps/web/e2e/helpers/seed-listings.ts` | La sedimentación entre corridas. Limpieza **por prefijo** que sobrevive al descarte de worker de Playwright, y que borra vía `DELETE /listings/:id` para limpiar **Postgres Y Meili** (no solo la fila). |
| `apps/web/e2e/helpers/nav.ts` (`clicarYEsperarUrl`) | Esperar más a una espera que ya no va a resolverse. **Reintenta el CLIC**. Es la mitigación de 2b donde 2b es recuperable. |
| `apps/api/test/reset-redis-between-suites.ts` · `e2e-lock.js` | Que dos baterías compartan Redis o corran a la vez. |
| El split del workflow (2 pasos, no `playwright.config`) | Que el conjunto tolerado crezca **invisible**. |

### Las lecciones META (la más importante primero)

1. **En bugs de concurrencia y de *timing* bajo carga, el código se ve correcto y razonar DESDE
   él FALLA.** La causa solo aparece **observando el fallo mientras ocurre**. Más de seis
   hipótesis —del asesor y mías— murieron al medirlas: el tope de anuncios activos, la
   sedimentación entre corridas, la latencia de indexación, la *starvation* de `geocode`, el
   badge de mensajería en 1, la revalidación eventual del footer. **Ninguna** sobrevivió al
   contacto con una medición, y **cada diagnóstico ganador vino de una sonda que capturó el
   fallo en el acto.** La familia 2a estuvo cinco ráfagas sin explicación porque toda la
   evidencia era *post mortem*; un instrumento que sondeaba las cuatro capas en cada vuelta la
   resolvió en una sola corrida.
2. **2b es estocástico → se etiqueta el VECTOR, no los fallos observados.** Una muestra no es
   el conjunto: etiquetar "lo que falló hoy" deja expuestos sin marcar, siempre.
3. **Observar el MECANISMO antes de clasificar; la firma del error engaña.** `h8-d4-banners` y
   `blog-markdown-editor` parecían cosas distintas ("el banner no aparece", "el markdown no
   renderiza") y los dos eran *router wedge*: el clic no navegaba y el test seguía en la página
   anterior. La pregunta que clasifica bien no es *¿qué dice el error?* sino **¿el clic
   navegó?**
4. **Reintentar la ACCIÓN, no esperar más a la espera.** Convergieron ahí tres arreglos
   independientes: `clicarYEsperarUrl`, el envío de mensaje en `mensajeria-unificada` y el
   *picker* de ficheros de `tickets-adjuntos` (donde además hay que **vaciar el input antes de
   reponer el mismo fichero**, o no se dispara otro `change` y el reintento repite el estado
   roto).
5. **LECCIÓN FINAL — medir el comando exacto NO BASTA si no se mide en el ENTORNO exacto.**
   Esta corrige a la anterior versión de esta misma lista, que decía "el árbitro es
   `playwright test --list`, ejecutado en el momento". **Era falsa por incompleta.** El comando
   *en texto* no es el comando *en ejecución*: **el shell interviene**. Se ejecutó `--list`
   cuatro veces, en el momento, con la forma literal del workflow… **en PowerShell**, que se
   come el `--`. Dio 248 — cierto para PowerShell, **falso para el runner**, que corría 271.
   > **El `Running 271` no mintió ninguna de las cuatro veces.** Decía la verdad de Linux;
   > se estaba leyendo desde el shell equivocado. Se le llamó "log obsoleto" tres veces
   > seguidas para no tener que creerlo.

   Corolario doble:
   - **(a) El entorno de EJECUCIÓN es parte del comando.** Verificar siempre en el entorno del
     CI —bash/Linux, o el propio CI leído con `gh`—, nunca en el shell de desarrollo.
   - **(b) El entorno de MANIFESTACIÓN también importa.** La tasa de router wedge es ~3/271 en
     local y suficiente para tumbar el runner. Por eso local "parecía sano" mientras el
     pipeline llevaba ráfagas en rojo: no era un CI quisquilloso, era un entorno distinto.

   *Corolario de la misma familia:* verificar la **codificación** de lo que se escribe.
6. **No cerrar en falso sobre inferencia.** Los dos grupos se midieron verdes **en el runner**,
   leídos con `gh` sobre la corrida real. Habría sido cómodo deducir que componían; deducirlo no
   es medirlo. En esta misma saga una cadena de deducción impecable sobre el YAML concluyó que
   "ningún step puede tumbar el job" — y la corrida enseñaba el step señal en `failure` y el
   @2b en `skipped`. **Razonar desde el artefacto falló otra vez; leer la corrida acertó.**

### Aviso de herramienta (aprendido rompiendo dos ficheros)

**Nunca escribir ficheros fuente con `Set-Content` de PowerShell en este repo.** Al etiquetar
se usó `Set-Content -Encoding UTF8` y dejó los dos specs con UTF-8 doblemente codificado y BOM
(`BÚSQUEDA` → `BÃšSQUEDA`): 7 rojos que NO eran reales, en ficheros ya commiteados. Se
reparó invirtiendo el round-trip Windows-1252 y quitando el BOM (diff de solo encoding,
84↔84). Las ediciones con `perl -0pi` sí conservan UTF-8 correctamente.

**Segundo aviso de la misma familia, y el que más caro salió: PowerShell se come el `--` de
pnpm.** No es un detalle cosmético — invalidó cuatro verificaciones seguidas del filtro `@2b` y
mantuvo el pipeline en rojo durante ráfagas. **Cualquier comprobación de algo que va a correr en
el CI se hace en bash (o se lee del propio CI con `gh`), nunca en PowerShell.** El shell de
desarrollo no es un espejo del runner: es otro entorno, y reescribe la línea de comandos.

**Tercer aviso (RN.3, nav dinámico): `.next/cache/fetch-cache` SOBREVIVE al reinicio del dev
server.** Es caché en disco, no en memoria: matar `next dev` y volver a arrancarlo **no** la
limpia, así que un servidor "nuevo" puede servir el resultado cacheado de una corrida anterior.
Se descubrió depurando por qué la barra del nav aparecía con datos que ya no existían en la BD:
el árbol venía de `unstable_cache` sembrado en una ejecución previa. Costó varias vueltas de
diagnóstico porque el síntoma imita exactamente a una invalidación rota.

No afecta a producción: la invalidación por tag está bien cableada y se verificó a mano el ciclo
completo (crear → la barra aparece; borrar → desaparece; crear otra vez → aparece la nueva).
**Al depurar en local cualquier dato servido desde `unstable_cache`** (nav, footer, blog),
borrar `.next/cache/fetch-cache` antes de sacar conclusiones, o forzar la invalidación con un
`POST /api/revalidate?secret=…&tag=…`.

**Cuarto aviso, y es el mismo corolario (a) de la saga del CI aplicado a la batería local:
`next dev` lleva un watchdog de heap que reinicia el proceso al ~80 % de uso.** En baterías
Playwright largas (20-30 min) eso produce timeouts de `page.goto`/`waitForURL` **no
deterministas**: dos corridas del MISMO commit dieron 3 fallos y 10 fallos, con conjuntos
distintos, y entre ellos specs de `(admin)`/`(account)` que el cambio bajo prueba ni siquiera
tocaba. Todos pasaron al reejecutarse en aislado.

Esto ya estaba documentado en `playwright.config.ts` y en `ci.yml` —el CI usa `next start` sobre
un build de producción justo por esto—, pero faltaba decirlo como lección: **la batería completa
solo da señal fiable en modo producción/CI. Correrla contra `next dev` en local genera
no-determinismo que NO es una regresión**, y tratarlo como tal lleva a perseguir fantasmas.
Si hay que medir en local, `next build && next start`; si no, leer la corrida del CI.

### Barrido de `click()` + `waitForURL()` a pelo — y el criterio que lo acota

El último rojo del step SEÑAL era `nav-publico.spec.ts:110`. **Diagnosticado antes de tocarlo**, y
el diagnóstico importa porque el mensaje de Playwright despista:

- **Aislado, `--repeat-each=10 --retries=0`: 5 de 10 verdes.** Intermitente, no determinista → no
  era regresión de nada. Fallaron las repeticiones 0, 1, 2, 6 y 7; sin patrón monótono.
- **Con una sonda que mide `page.url()` a mano tras el clic, 12 intentos:** 10 navegaron a
  `/busqueda` (y `waitForURL` por defecto habría pasado), **2 dejaron la URL en `/` sin moverse**,
  y **0** casos de "navegó pero falta el evento `load`".

Ese último cero descarta la hipótesis intuitiva. El error dice `waiting for navigation until "load"`
y parece señalar al `waitUntil`, pero **no es el `waitUntil`**: cuando el router conmuta, el estado
`load` ya está satisfecho (una navegación de cliente no reemplaza el documento) y la espera por
defecto resuelve. Cuando falla, **la URL no cambia nunca**: es el wedge de 2b, sin más.

La diferencia real con los tests que no caen es **el reintento del CLIC**, que es lo que ya decía el
docblock de `helpers/nav.ts`. Tras migrar: **10 de 10 verdes**, y los tiempos enseñan el mecanismo —
7 corridas en ~0,6 s (el clic conmutó a la primera) y **3 en ~5,7 s**, que son tres wedges reales
recuperados por el segundo clic. El wedge no desapareció; se recupera. El spec entero repetido 10
veces: **50 de 50**.

### Los dos wedges, y por qué `nav-publico` lleva `recargarEntreIntentos`

El reclic no cubre todos los casos, y la diferencia se midió:

- **Wedge RECUPERABLE.** El segundo clic conmuta. Es la mayoría: en aislado, 7 de 10 a la primera
  y 3 a la segunda. Lo cubre el helper tal cual.
- **Wedge PERSISTENTE.** Una vez el router cliente entra en ese estado, **clicar otra vez sobre ESE
  MISMO documento no lo saca**: bajo la carga de la batería completa se vio agotarse el presupuesto
  entero —6 intentos, 30 s— sobre la misma página, y el test cayó en 2 de 3 corridas.

La hipótesis era que de ese segundo estado se sale con un **documento nuevo**, que trae un router
nuevo. Eso es `recargarEntreIntentos`: con la bandera puesta, cada reintento recarga antes de volver
a clicar.

**La recarga recupera, pero no es la cura.** Las dos mitades del dato:

- **Sí recupera.** Se ha visto imprimir `[clicarYEsperarUrl] recuperado tras 1 recarga(s)` en una
  corrida real (`nav-publico` aislado, repetición 5 de 10, 6,5 s frente a los ~0,6 s normales).
- **Y aun así no basta.** Cuatro baterías completas tras la migración y antes de tocar el producto:
  con la bandera, roja y roja; sin ella, roja y verde. En una de ellas el log no salió ni una vez —
  las recargas ocurrieron y ninguna sirvió: contra el wedge persistente, un documento nuevo tampoco
  saca.

O sea: la bandera es una **red útil con rastro**, no el arreglo. Lo que ataca la causa es lo de
abajo.

**Encendida solo en `nav-publico`, y el motivo es la seguridad, no el gusto.** La barra la pinta el
servidor y ese test no construye nada en cliente antes del clic, así que recargar no borra nada.
**Va apagada por defecto** porque en un test que teclee o seleccione antes del clic la recarga
vaciaría ese estado y el reintento actuaría en blanco — caso concreto: en `portada-bloques` el clic
sobre "Buscar" viene después de teclear "bicicleta"; con la bandera puesta el segundo intento
buscaría con la consulta vacía y el test pasaría a afirmar algo que no es. Está escrito en los dos
sitios (el docblock del helper y el punto de encendido) para que nadie lo copie a ciegas.

**La tolerancia es OBSERVABLE, y esa es la condición que la hace aceptable.** Cada recuperación
imprime `[clicarYEsperarUrl] recuperado tras N recarga(s)` —molde de `[waitForCard] found after N
reload(s)`—, así que "el test pasa" se lee siempre como "pasó, y recargó N veces". Si el wedge pasa
de ocasional a constante, el log lo delata en vez de un verde mudo escondiendo un router roto.
`e2e/helpers-nav.spec.ts` clava esa propiedad con dobles: que recarga, que cuenta bien y que lo
dice. Sin ese guard, alguien podría quitar el `console.log` y nadie se enteraría.

### Se atacó la causa en PRODUCTO: `prefetch={false}` en todo el nav

`MainNav` se pinta en **todas** las páginas públicas, así que en cada carga dispara una ráfaga de
prefetches concurrentes —uno por destino del árbol— que es el disparador conocido del wedge. La
mitigación es la misma que ya llevan las tarjetas de anuncio (`ListingCard.tsx`), y **no es un
parche de test: un usuario con el router wedged tampoco navega**, y su único remedio es recargar.

**Alcance: TODOS los enlaces del nav**, no solo el que el test clica (`TopLevelLink`, el enlace
propio del desplegable y sus hijos). El wedge no distingue destinos —lo dispara la ráfaga, no un
href concreto—, y dejar la mitad prefetchando sería quedarse con el problema y perder la mitad del
beneficio. Coste: el primer clic sobre una entrada del nav carga su destino sin precarga; en una
barra de 4-6 entradas el prefetch-on-viewport rinde poco de todos modos. `SmartLink` gana un prop
`prefetch` opcional para poder pasarlo (no cuela por `rest`: no es atributo de `<a>`).

**Y hay que decir lo que la medida NO muestra:** en los números de esta investigación
`prefetch={false}` **no produjo una mejora medible sobre el test**. El salto de 5/10 a 10/10 en
aislado ya lo había dado la migración al helper, antes de tocar el producto; y la batería completa
siguió cayendo con el cambio puesto. Se mantiene por su valor de PRODUCTO —el bug de usuario es
real y la mitigación tiene precedente—, no porque se le pueda atribuir el verde de ningún test.

### Y aun así queda residuo: `nav-publico:110` pasa a `@2b`

Con las tres palancas puestas —helper que reclica, recarga entre intentos y `prefetch={false}`— el
test **sigue cayendo en 4 de 5 baterías completas**, mientras en aislado da 10/10 y 50/50. El wedge
es de Next (#57565), sin fix upstream, y no queda nada nuestro que arreglar.

Por eso —y solo por eso, después de agotar lo atacable y no antes— el test se etiqueta `@2b`. Es lo
que le correspondía desde el principio: está fuera del grupo tolerado por omisión histórica (el
helper y la familia `@2b` nacieron en `8903dac`; el spec no se tocaba desde `0e2b6d8`, 26 commits
después, y aquel commit no lo revisó). **Lo que el test afirma no ha cambiado** —el `<Link>` del nav
lleva a `/busqueda`— y sigue corriendo: cae en el grupo tolerado, no en el señal. Cuando el wedge
deje de morder, quítese la etiqueta.

⚠ **Dos medidas que se descartaron por ser artefacto de la sonda, no del producto.** Un script
independiente que recreaba los ítems del nav en cada vuelta dio 9/9 y 0/8 sin navegar, y estuvo a
punto de leerse como "el wedge es determinista". No lo era: recrear el nav invalida su caché, obliga
a recargar la home y esos abortos envenenaban el prefetch — algo que el test real no hace nunca. La
lección: **cuando la sonda y el test discrepan, gana el test**; una sonda que monta su propio
escenario puede estar midiendo su propio escenario.

**El criterio del barrido: el helper REPITE el clic, así que solo es seguro donde el clic es
idempotente.** Ese es el filtro que hay que aplicar, y no está en el vector: reclicar
"Publicar ahora" publicaría dos anuncios, y reclicar "Guardar borrador" crearía dos páginas. De los
66 `waitForURL` de la batería:

| Clase | Sitios | Qué se hizo |
|---|---|---|
| Clic sobre `<Link>` o `router.push` **sin efecto colateral** | 14 | **Migrados** a `clicarYEsperarUrl` |
| `page.goto()` + redirect de middleware | 11 | No: no hay clic; es navegación de documento |
| Clic que dispara una **acción async** con efecto (publicar, guardar, enviar, login, checkout) | 30 | **No: el reintento duplicaría el efecto** |
| Clic dentro de un desplegable que **se cierra al pulsar** | 4 | No: en el reintento el locator ya no existe |
| `press('Enter')` | 2 | No: el helper clica un locator, no teclea |
| El propio helper | 2 | — |
| Ya con `waitUntil: 'commit'` sobre `selectOption`/`blur` | 3 | No: no es un clic |

Los 14 migrados: `nav-publico` (el enlace del nav), `footer-admin` (enlace del listado admin),
`mensajeria-unificada` (6 aperturas de conversación, unificadas en `abrirConversacion`),
`portada-bloques` (el botón del buscador — `SearchBar` navega con `router.push` y repetir una
búsqueda no tiene efecto), `listing-phone-share` y `planes` (los dos con guardia `useRequireAuth`,
que hace `router.push` y **sale antes** de llamar a la API), y `prefill-ubicacion` +
`wizard-herencia`, que ya escribían el patrón A MANO con el mismo razonamiento duplicado en un
comentario largo: ahora pasan por el helper y además ganan el `waitUntil: 'commit'`.

Dos casos que parecen candidatos y **no lo son**, por si vuelven a mirarse:

- `planes.spec.ts` tiene dos "Hazte Pro". El de **sin sesión** se migró; el del **401** no: allí sí
  hay sesión, la llamada a la API sale y el redirect viene del `signOut`. Reclicar repetiría la
  petición.
- `mis-creditos.spec.ts:212` es lo mismo — `useApiAction` maneja el 401 con `signOut` + redirect.

Ninguna aserción cambió en ningún test: solo el mecanismo de clic-y-espera.

### FOLLOW-UPS de la saga (no urgentes, anotados)

- **Encoger el conjunto tolerado — ahora con DATO, no con estimación.** 23 de 271 (~8,5 %) es
  bastante suite permanentemente no-bloqueante. Hasta esta corrida no se sabía cuántos fallan de
  verdad en el runner, porque **el step @2b nunca había llegado a correr**. Ya se sabe:
  **3 fallidos, 4 flaky, 16 pasados.** O sea: **16 de los 23 pasan limpios en CI** y otros 4 se
  recuperan con un reintento. Solo **3** justifican hoy la etiqueta.
  `blog-markdown-editor` demuestra el camino: alcanza el vector de 2b y **no lleva etiqueta**
  porque va por `clicarYEsperarUrl` y mide 6/6. Encauzar `elegirCategoria` (12 tests de
  `busqueda-unificada`) y `buscador-sugerencias` (6) por el mismo reintento de clic permitiría
  **devolver la mayoría al grupo señal**. Repetir la lectura varias corridas antes de decidir:
  2b es estocástico y un solo dato no es la tasa — pero por primera vez hay de dónde medirla.
- **Divergencia dev/prod en el webServer LOCAL de Playwright.** El CI se arregló en esta saga
  (`next start` + `nest start`, ambos en producción); **el local NO**: `playwright.config.ts`
  sigue usando `next dev` + `nest start --watch` fuera de CI (líneas 118-120 y 142-144). Es la
  MISMA clase de riesgo que ocultó el bug #1 durante meses: *lo que el modo dev perdona, el
  build de producción no*. Síntoma ya visto y no investigado: un error de `next/image` con host
  `example.com` en el arranque dev local, que **no tumbó la corrida**. `example.com` no está en
  `remotePatterns` (`apps/web/src/lib/image-domains.ts` solo admite `localhost` y
  `*.r2.cloudflarestorage.com`, y lo consume `next.config.ts`), así que conviene revisar si en
  producción se comporta distinto.
- **Comentario obsoleto detectado y NO corregido a ciegas:** `playwright.config.ts:99` habla de
  *"los 331 tests"*. El árbitro (`--list`) dice **271**. No se reescribe porque no consta a qué
  recuento se refería cuando se escribió; queda anotado para que nadie lo cite como dato.

### Bugs de PRODUCCIÓN detectados y NO tocados (cada uno pide su propia ráfaga)

Se documentan aquí en vez de arreglarse de pasada: son cambios de comportamiento de producto o
del arranque de producción, y colarlos en una ráfaga de CI habría sido exactamente lo que esta
saga existe para impedir.

- **`createSchemaHasActiveEdit` — guard sin consumidor** (`app/(admin)/admin/categorias/page.tsx:530`).
  En modo CREACIÓN del wizard de categorías, un atributo a medio editar **se descarta en
  silencio**. La variable existe y nadie la lee; borrarla enterraría el bug, arreglarla cambia
  el comportamiento del backoffice. TODO anotado en el propio fichero.
- **`pnpm start` / `start:prod` apuntan a un entry inexistente.** Los dos hacen
  `node dist/main`, pero `nest build` compila también `prisma/`, así que el `rootDir` inferido
  es la raíz del paquete y **el entry real es `dist/src/main.js`** (verificado: existe uno, no
  el otro). Los scripts de arranque de PRODUCCIÓN están rotos.
- **`multer` es dependencia FANTASMA.** Import **de valor** (`import { memoryStorage } from
  'multer'`) en **5 ficheros** —`media.controller`, `blog-admin.controller`,
  `admin-sponsored-ads.controller`, `tickets.controller`, `admin-tickets.controller`— y en
  `package.json` solo está declarado `@types/multer`. Llega de rebote por
  `@nestjs/platform-express`, y pnpm (que no aplana) **no la expone**: arrancar el `dist` con
  `node` a pelo revienta con `Cannot find module 'multer'`. Se combina con el punto anterior
  para hacer el arranque de producción doblemente inviable.
- **Prisma 6 → 7: aviso de deprecación.** La configuración vive en el bloque `"prisma"` de
  `apps/api/package.json` (con `seed`); Prisma 7 lo mueve a `prisma.config.ts`, que **no
  existe** en el repo. Hoy solo avisa; en el salto de major dejará de funcionar el `db seed`.

---

## `alert-matching:441` — no bastaba con esperar: la cola BORRA lo que se esperaba

Último flake anotado de la familia BullMQ. La comprobación miraba la cola buscando el job
`send-alert-email` y a veces lo encontraba `undefined`. Parecía "otra espera sin migrar", pero
al auditarlo eran **dos** problemas, y el segundo invalida el arreglo obvio:

1. **Carrera de orden.** `AlertMatchingService` escribe la fila de match (`:74`) ANTES de
   encolar el email (`:90`). El test esperaba a `hasMatch` y luego miraba la cola: `hasMatch`
   puede ser cierto con el email todavía sin encolar.
2. **Y la cola borra el job.** `RETRY_JOB_OPTIONS` lleva `removeOnComplete: true`, y el
   `NotificationProcessor` está vivo en los tests. O sea que el job se encola, se procesa y
   **desaparece**. Mirar la cola a posteriori es una ventana de DOS lados: demasiado pronto
   (aún no está) o demasiado tarde (ya se borró).

Por eso **envolver la comprobación en una espera no habría bastado**: arregla el lado
"pronto" y empeora el lado "tarde" — cuanto más se espera, más probable es que el job ya no
exista. No hay estado durable que sondear: `sendAlertEmail` solo llama al proveedor de correo,
sin rastro en la BD.

**La cura: capturar en el momento del `add`, y esperar a lo capturado.** Se registran los
encolados espiando el productor y se espera con `pollUntil` (async-state) a que aparezca el
`send-alert-email` de esa alerta. La captura elimina la ventana de borrado; la espera resuelve
la carrera de orden. Lo que el test prueba no cambia.

**Detalle que costó un intento:** hay que espiar la instancia de `Queue` **del servicio**, no
la de `app.get(getQueueToken(...))`. Cada `registerQueue()` crea su PROPIA instancia (la deuda
del "retry fantasma" de `queue-retry.e2e-spec.ts`): espiando la del token no se registraba ni
un `add`. Comparten la cola de Redis —por eso `getJobs` sí las veía— pero no el objeto.

*Validación de fallo real, obtenida sin buscarla:* ese primer intento fallido dejó la prueba
de que un fallo de verdad sigue siendo FINITO — `Timeout … 15000 ms (35 intentos). Último
valor observado: false`, con diagnóstico, sin colgarse.

## Cómo se esperan estados asíncronos en los e2e (barrera estructural)

**Regla, en una línea: se espera al ESTADO DEFINITIVO, nunca a la mera existencia, y
siempre con el helper compartido `test/helpers/async-state.ts`.**

### Por qué existe esta sección

Casi todo lo interesante del backend termina en un job de BullMQ: publicar encola la
indexación, un webhook de pago encola la concesión del entitlement. El test hace la
petición HTTP y el efecto llega DESPUÉS. Esperar mal producía rojos que ROTABAN entre
corridas (el CI, más lento, ensancha la ventana) y —peor— verdes falsos.

La auditoría encontró **tres formas distintas de esperar mal**, no una:

1. **Probe que lanza = fallo inmediato.** Tres copias locales de `pollUntil`
   (redsys-credits, redsys-featured, stripe-renewal) hacían `last = await fn()` **sin
   try/catch**. Con `getDocument()` de Meilisearch —que LANZA "Document not found" si el
   documento aún no está— el poll moría en la PRIMERA iteración. No agotaba el deadline:
   no llegaba a la segunda vuelta. *Subir el deadline no arreglaba nada*, porque el
   deadline nunca entraba en juego. Este era el fallo real de `redsys-featured`.
2. **Predicado de existencia, no de estado.** `waitForIndex` volvía en cuanto el
   documento existía. La primera versión escrita todavía puede cambiar (un job de
   geocode reindexa después), así que el test leía un documento en vuelo. Es la lección
   de B2. El caso extremo era un predicado literal `() => true` seguido de
   `expect(doc.boostScore).toBe(1)`.
3. **Deadline pensado para el caso feliz local.** 15 s fijos, más `testTimeout: 30000`,
   más `}, 20_000)` por test: en el CI no daba.

### Qué usar

| Situación | Helper |
|---|---|
| Vas a afirmar sobre el CONTENIDO de un documento indexado | `waitForDocumentWhere(...)` / `waitForDocumentField(...)` |
| Solo importa que el documento ESTÉ (aparece en `/search`) | `waitForIndex(...)` |
| El documento debe DESAPARECER del índice | `waitForRemoval(...)` |
| Un efecto asíncrono cualquiera (Postgres, contadores) | `pollFor(probe, predicado)` / `waitUntil(cond)` |
| Un plazo corto propio (websocket) que igual debe crecer en CI | `scaleForCi(ms)` |

```ts
// MAL — espera a que exista y luego afirma sobre un campo que aún puede cambiar
await waitForIndex(meili, INDEX, id);
expect((await meili.index(INDEX).getDocument(id)).boostScore).toBe(1);

// BIEN — espera a que el campo VALGA lo esperado
const doc = await waitForDocumentWhere<{ boostScore: number }>(
  meili, INDEX, id, (d) => d.boostScore === 1,
);
expect(doc.boostScore).toBe(1);
```

### Garantías del mecanismo

- Un **probe que lanza es "todavía no"**, no un fallo: se reintenta.
- **Backoff** (50 ms → 500 ms) en vez de un intervalo fijo.
- **Deadline que cubre el CI**: 20 s en local, 60 s en CI (`DEFAULT_TIMEOUT_MS`), con
  `testTimeout: 120000` en `jest-e2e.json` para que Jest no mate el test antes de que el
  plazo se agote. **Cuesta cero en el camino feliz**: el poll vuelve en cuanto el
  predicado se cumple.
- **Generoso pero FINITO**: un bug real (el documento no llega nunca) sigue poniendo el
  test en rojo. No hay ninguna vía de "esperar para siempre".
- El error dice **qué se esperaba y cuál fue el último valor visto**, para diagnosticar
  sin reproducir.

El propio mecanismo tiene pruebas: `test/async-state.e2e-spec.ts` cubre las dos mitades
—que aguanta una latencia muy superior al intervalo, y que un fallo real termina en rojo
en vez de colgarse—. No necesita infraestructura y corre en ~6 s.

**No escribas un `pollUntil` nuevo en un test.** Cada copia trae su propio deadline
arbitrario y su propio olvido del try/catch; eso es lo que había y es lo que rotaba.

### `rc1-contact` era otra cosa: saturación de conexiones

El `ECONNRESET` del test del límite global (200/hora) **no** es latencia asíncrona: es el
cliente del test saturándose a sí mismo. Supertest abre una conexión real por petición y
205 peticiones en lotes de 25 agotaban el pool de sockets del agente HTTP de Node. Se
bajó el lote a 5. **Se mantienen las 205 peticiones**: la cobertura del límite es la
misma, solo cambia cuántas van en vuelo a la vez.

### `queue-retry` sigue abierto — y NO es un problema de espera

Se investigó a fondo y **no** pertenece a esta clase. El test espía
`SearchService.indexListing` para forzar un fallo en el primer intento y comprobar que
BullMQ reintenta. Medido con diagnóstico:

- El documento **no** existe antes de `publish` (correcto).
- El espía **sí** está instalado, y `processor.search === search espiado` es `true`.
- Aun así: `waitForIndex` vuelve en **~80 ms** con `attempts = 0` — el documento se
  indexa **sin que el `indexListing` espiado se llegue a llamar**.

Es decir: el job lo procesa algo que no es el `IndexingProcessor` espiado de esta app.
Falla **de forma determinista y también contra HEAD limpio** (verificado con `git stash`:
mismo `Expected >= 2 / Received 0`), así que es **preexistente** y ajeno al saneamiento de
esperas. Arreglarlo es aislar quién consume la cola en los tests, no esperar mejor.

---

## El webServer de Playwright va en modo PRODUCCIÓN, nunca `--watch`

**Regla: en CI, los dos servidores que levanta Playwright arrancan compilados. `--watch`
(y `next dev`) están prohibidos en CI.**

### Qué pasaba

El job de Playwright se comía los **30 minutos** de `timeout-minutes` y GitHub lo
cancelaba: **sin veredicto y sin artefactos** (el `playwright-report` se sube en un paso
`if: always()`, pero un job cancelado no llega a subirlo). No era un flake ni una
regresión: era configuración que nunca estuvo bien, del mismo tipo que el `next lint`
roto — un "estado de fondo" que se daba por normal.

Tres causas sumando, no una:

1. **El backend arrancaba con `nest start --watch` TAMBIÉN en CI.** En
   `playwright.config.ts` el comando era `pnpm --filter @marketplace/api dev`
   —o sea `--watch`— de forma **incondicional**. El frontend sí distinguía CI de local
   tres líneas más abajo (`next start` vs `next dev`); el backend nunca lo hizo. Un
   compilador en modo vigilancia, residente, reaccionando a cambios que en CI no van a
   ocurrir jamás, compitiendo por la CPU del runner con los 271 tests que debe servir.
2. **Ninguna espera tenía plazo propio.** `playwright.config.ts` no definía
   `actionTimeout`, ni `navigationTimeout`, ni `expect.timeout`. Solo el `timeout: 90_000`
   del test entero. Consecuencia: cualquier espera que no resuelve **se come los 90 s**
   (marcador `×T`), y con `retries: 1` en CI son **180 s por test colgado**. Tres o cuatro
   así y la ventana se agota sola.
3. **105 llamadas a `waitForLoadState('networkidle')` sin plazo.** `networkidle` espera
   500 ms sin tráfico de red; si algo mantiene la red viva, no se cumple NUNCA. Es el
   mecanismo concreto de los `×T`. (Playwright desaconseja `networkidle` explícitamente;
   quedan 105 como deuda, ver abajo.)

### Qué se hizo

| Palanca | Antes | Ahora |
|---|---|---|
| Backend en CI | `nest start --watch` (siempre) | `nest start` sin watch, solo si `CI` |
| Frontend en CI | `next start` ✔ (ya estaba bien) | igual |
| `actionTimeout` | — (sin plazo) | 15 s |
| `navigationTimeout` | — (sin plazo) | 30 s |
| `expect.timeout` | — (5 s por defecto) | 10 s explícito |
| `workers` | 1 | **1 (a propósito, ver abajo)** |

Lo que antes colgaba 90 s (180 s con reintento) ahora **falla en 30 s señalando el paso
exacto**: un rojo legible en vez de un job cancelado. No se ha tocado ninguna aserción —
se arregla **cómo se espera**, no qué se verifica.

### `workers: 1` NO es una palanca pendiente de subir

Es un requisito, y conviene dejarlo escrito para que nadie "optimice" el CI subiéndolo:
las specs comparten **una** base (`marketplace_test`), **un** índice de Meili y **una** db
de Redis, y `globalSetup` siembra seis cuentas fijas que todas reutilizan. Nueve specs
además MUTAN estado global que otras leen (ajustes del backoffice, árbol de categorías,
páginas del footer). Paralelizar sin aislar antes cada spec cambiaría cuelgues por rojos
aleatorios — que es peor, porque parecen regresiones. El tiempo se recupera arrancando en
producción, no repartiendo tests que comparten estado.

### Deuda descubierta por el camino (NO tocada: es arranque de PRODUCCIÓN)

Al intentar arrancar el backend con el `dist/` compilado aparecieron dos cosas rotas que
nadie había notado porque **nada las ejercía** (el CI usaba `dev`):

- **`pnpm start` y `pnpm start:prod` del backend apuntan a una ruta que no existe.** Son
  `node dist/main`, pero `nest build` compila también `prisma/`, así que el rootDir
  inferido es la raíz del paquete y el entry real queda en **`dist/src/main.js`**.
- **`multer` es una dependencia FANTASMA.** Cinco ficheros hacen
  `import { memoryStorage } from 'multer'` (un import de VALOR, no de tipo), pero
  `package.json` solo declara `@types/multer`. multer llega de rebote por
  `@nestjs/platform-express` y pnpm no lo expone: `node dist/src/main` revienta con
  `Cannot find module 'multer'`. `nest start` sí lo resuelve, por eso el CI funciona.

Las dos afectan a cómo se arrancaría el backend **en producción real**, así que no se
arreglan en un cambio de CI. Anotadas aquí para que se traten aparte.

### Bug de PRODUCCIÓN destapado al pasar el CI a modo producción

Poner el CI en `next start` en vez de `next dev` destapó un bug real que llegaba a
usuarios: **la página de editar anuncio crasheaba en producción.**

```
⨯ Error: Attempted to call resolvePriceUnitSelection() from the server but
  resolvePriceUnitSelection is on the client.
  at .next/server/app/(account)/mis-anuncios/[id]/editar/page.js
```

`resolvePriceUnitSelection` es lógica **pura** (mira si un valor está en una lista; ni
hooks, ni estado, ni API de navegador), pero vivía en
`components/publicar/steps/StepDatos.tsx`, que lleva `'use client'` porque además pinta
el formulario. Eso la marcaba como función de CLIENTE. Y
`(account)/mis-anuncios/[id]/editar/page.tsx` es un **Server Component** que la llamaba
en el cuerpo del render.

`next dev` no lo detecta (frontera cliente/servidor laxa en desarrollo); `next start` sí.
Es decir: **funcionaba en local y estaba roto en producción**, que es la peor combinación
posible y la razón de que nadie lo viera.

**La cura** (caso "lógica pura arrastrada a un módulo cliente"): se extrajo a
`src/lib/price-unit.ts`, un módulo SIN `'use client'`, importable desde los dos lados. La
función devuelve exactamente lo mismo — solo cambia dónde vive y quién puede llamarla.
`src/lib/price-unit.test.ts` fija que el traslado no cambió el comportamiento. No se
re-exporta desde `StepDatos` a propósito: un único sitio de importación evita que alguien
la vuelva a arrastrar al lado cliente sin darse cuenta.

Auditado el resto del módulo y de las páginas: es la **única** violación de este tipo. Las
demás páginas server importan de módulos `'use client'`, pero importan **Componentes** para
renderizarlos, que es el patrón correcto y soportado.

### Familia 1 de rojos: drift de tests por features aprobadas (cerrada)

Con el CI cancelándose por timeout, el drift se sedimentó sin verse: había tests con
aserciones **congeladas antes de features que se aprobaron y funcionan**. No eran bugs;
eran tests que no se habían enterado.

**El paso "Etiquetas" (B2).** El wizard es
`Categoría → Fotos → Datos → Atributos → ETIQUETAS → Ubicación → Publicar`, pero los
specs hacían "Siguiente" tras Atributos y esperaban `heading "Ubicación"` — que ahora es
`"Etiquetas"`. Detalles que decidieron el arreglo:

- El paso **nunca bloquea**: `validateStep('tags', …)` solo se queja si se pasa del tope,
  jamás por no marcar nada. Se cruza con un "Siguiente" y el anuncio queda igual que
  antes — lo que cada test verifica no cambia.
- **Regla de desaparición**: el paso solo existe si la categoría tiene tags efectivos. En
  el seed, `coches` los tiene (hereda `garantia` + `envio-incluido` de `vehiculos`, más
  `unico-dueno`); `moviles` no. Por eso fallaban los specs de coches y no los de móviles.
- **No había ningún helper compartido de wizard** — nueve specs lo navegaban a mano. Se
  añadió `e2e/helpers/wizard.ts` con `cruzarPasoEtiquetas(page)`, que detecta si el paso
  está y lo cruza solo si está. El conocimiento frágil (¿existe el paso? ¿cómo se cruza?)
  vive en UN sitio; los specs solo lo llaman. **La aserción de "Ubicación" de cada spec se
  mantiene intacta**: el helper no la sustituye, se asegura de que se llegue hasta ahí.

**El conteo del nav (B1).** `admin-roles` esperaba 17 ítems; `NAV_ITEMS` de `AdminNav.tsx`
tiene 18 y todas incluyen `ADMIN`. El último en sumarse fue "Tags" (B1). El comentario del
test decía 14 — se había actualizado el número a trompicones sin tocar el comentario. Se
puso 18 y se quitó del comentario la lista de "qué ráfaga añadió cada ítem", que es justo
lo que se desincroniza: la fuente de verdad es `NAV_ITEMS`. (De paso, otro comentario de
cabecera decía 5 ítems para MODERATOR donde el test siempre afirmó 6.)

**PROPUESTA, no hecha:** un conteo exacto de ítems de nav es frágil por diseño — se rompe
cada vez que se añade una sección aunque el backoffice esté perfecto. Comprobar la
PRESENCIA de ítems clave (Dashboard, Tags, Ajustes…) lo haría robusto al próximo. No se
cambió porque eso altera lo que el test prueba, y esa es una decisión de producto.

**Lo que NO era familia 1** (se separó al auditar, en vez de arrastrarlo):
`flujo-critico` falla porque el `PhotoLightbox` abierto intercepta el click sobre la card,
y el cuarto caso de `listing-card-attrs` (Electrónica → Móviles, categoría SIN tags) falla
por un timeout de indexación en Meilisearch. Ninguno pasa por el paso Etiquetas.

### Deuda: los 105 `networkidle`

Sustituirlos por aserciones web (`expect(locator).toBeVisible()`) es lo correcto y lo que
recomienda Playwright, pero son 105 sitios en 44 specs: cambiar en bloque qué espera cada
test es un riesgo mayor que el que se estaba arreglando. Con los plazos finitos ya no
cuelgan el job; quedan como deuda de una ráfaga propia.

---

## Navegación dinámica — barra bajo la cabecera (RN.1-RN.4, cerrado)

Barra de menús y submenús configurable desde el backoffice, bajo el header del sitio público.
Diseño: `docs/diseno-nav-dinamico.md`. Todo lo de aquí está verificado contra el código, no
contra el diseño.

### Qué cerró cada ráfaga

| Ráfaga | Cierra |
|---|---|
| **RN.1** | Modelo (`NavItem` + enums `NavItemType`/`NavPageType`, migración `20260806085358_add_nav_items`), `NavService` de lectura y validación, y el gate recursivo como función pura con sus tests |
| **RN.2** | Endpoints público y de admin, auditoría, revalidación, caché por tipo, y las dos modificaciones cruzadas a `BlogService` |
| **RN.3** | Render público: `MainNav` + `NavDropdown`, los 9 layouts anidados, movimiento de la home a `(home)/` |
| **RN.4** | CRUD de admin en `/admin/nav` (ADMIN-only) |

### El modelo: un árbol, no dos tablas

`NavItem` es **auto-referencial** (`parentId` → `NavItem`), y esto es lo primero que sorprende a
quien venga del footer: el sistema hermano usa DOS tablas (`FooterColumn` + `FooterItem`). No se
reusó ese molde porque **es plano por construcción y no escala a submenús**: una `FooterColumn`
no tiene destino (solo `name String?`) y un `FooterItem` no puede tener hijos (no hay `parentId`).
El molde del árbol es `Category`.

Campos propios del nav, ninguno con equivalente en el footer:

- **`type NavItemType?` — NULLABLE.** El destino es OPCIONAL: un nodo puede ser solo-desplegable
  (abre sus hijos sin navegar). En `FooterItem`, `type` es obligatorio.
- **`active Boolean @default(true)`.** El footer no tiene interruptor; su única "desactivación"
  es indirecta (la página enlazada no está publicada). Precedente del flag explícito: `Banner.active`.
- **`visibleOn NavPageType[]`.** Array escalar, molde `Banner.placements`. **Vacío = se muestra en
  TODAS**, no en ninguna — diverge a propósito de `Banner.placements`, que prohíbe el vacío;
  aquí "en todas partes" es el caso mayoritario y debe ser el default. Mismo significado de
  "[] = no configurado" que `Category.allowedViews`.

**Profundidad máxima 2** (menú → submenú). Es una constante del servicio (`NAV_MAX_DEPTH` en
`nav.types.ts`), **no una restricción de schema** — mismo criterio que el tope de 2 niveles de
`Category`, que vive en `AdminService.assertParentIsRoot`. Subirlo es cambiar un número y hacer
el trabajo de render; bajarlo obligaría a migrar datos.

### Las tres decisiones que se apartaron de los moldes

Documentadas aparte porque un lector que conozca los moldes asumiría lo contrario:

1. **`parentId` con `onDelete: Cascade`, como el footer — NO `SET NULL` como `Category`.**
   Verificado en las migraciones: `NavItem_parentId_fkey … ON DELETE CASCADE` frente a
   `Category_parentId_fkey … ON DELETE SET NULL`. Borrar un menú se lleva su subárbol. El
   criterio es el que `FooterService.deleteColumn` razona: es una acción consciente del admin y
   la UI anuncia cuántos descendientes se van antes de confirmar. `Category` rechaza con 400 en
   su lugar porque de una categoría cuelgan terceros (anuncios de otros usuarios, patrocinados)
   que sí se sorprenderían; **de un `NavItem` no cuelga ninguno**.
2. **Se puede MOVER un nodo de padre; `Category` no lo permite.** Mover = `PATCH` con `parentId`
   (no hay endpoint aparte, mismo criterio que "mover de columna" en el footer). Esto no tenía
   molde: hubo que construir dos guardas de cero, `assertMaxDepth` y `assertNoCycle`. La primera
   lleva **dos** reglas donde `assertParentIsRoot` de `Category` lleva una: el padre destino no
   puede ser ya un hijo, **y** el nodo que se mueve no puede arrastrar hijos (caerían a un tercer
   nivel). La segunda no hace falta con profundidad 2, y se escribió genérica a propósito para
   que siga siendo correcta si el tope sube.
3. **El gate es recursivo; el del footer es plano de un nivel.** Ver abajo.

### El gate recursivo — lo único sin precedente

`pruneNavTree(roots, pageType)` en `nav.types.ts`. **Función pura**, sin BD ni stubs (molde: los
resolvers de `category.types.ts`), así que se prueba sobre estructuras en memoria.

Un nodo se muestra si y solo si se cumplen las tres: `active === true`, **y** `visibleOn` está
vacío o incluye el tipo de página actual, **y** tiene destino visible **o** al menos un hijo
visible tras podar. Se resuelve en post-orden —los hijos antes que el corte del padre—, que es lo
que hace que la poda sea de abajo arriba.

De la tercera condición sale lo que de verdad importa: **un desplegable cuyos hijos quedaron todos
ocultos se oculta él también**, y nunca queda un botón que abre un menú vacío. Un destino `PAGE`
solo cuenta si su `Post` está `PUBLISHED` (mismo criterio que el footer), pero con una diferencia:
en el footer el ítem desaparece, mientras que aquí un nodo con la página en borrador **sobrevive
como solo-desplegable** si tiene hijos visibles, porque sigue abriendo algo.

**El gate es TOTAL, más estricto que el del footer**: si la raíz queda vacía, `MainNav` devuelve
`null` y la barra no existe en el DOM — ni `<nav>`, ni contenedor, ni borde. El footer, en cambio,
conserva su copyright cuando no hay columnas visibles.

`nav.types.spec.ts` tiene 14 tests: los **10** casos de la tabla del §5.3 del diseño, uno a uno y
en orden, más resolución de href por tipo, ordenación en los dos niveles, no-mutación de la
entrada y un caso compuesto de poda en dos niveles.

### Visibilidad por tipo de página: 9 layouts, no el pathname

Patrón `BannerPlacement`: cada ruta declara su tipo como literal y el filtro corre server-side.
**No se deriva del `pathname`**, y las dos alternativas se descartaron por motivos concretos:
`usePathname()` obligaría a hacer la barra Client Component (y `(public)/[categoria]` es un
catch-all de un segmento, así que clasificar `/foo` exigiría saber si es categoría o 404); y leer
`headers()` inyectados por el middleware **forzaría render dinámico de todo `(public)`**, matando
el ISR ya configurado en `/blog` y `/paginas/[slug]`.

`(public)/layout.tsx` **no puede** montar la barra: un layout de servidor no sabe qué hijo está
renderizando. El montaje son **9 layouts anidados, mapeo 1:1 con el enum** — verificado: 9 valores
distintos de `pageType` en los `layout.tsx` de `(public)`.

| Ruta | Layout | `NavPageType` |
|---|---|---|
| `/` | `(public)/(home)/layout.tsx` | `HOME` |
| `/busqueda` | `busqueda/layout.tsx` | `BUSQUEDA` |
| `/[categoria]` · `/[categoria]/[subcategoria]` | `[categoria]/layout.tsx` | `CATEGORIA` |
| `/anuncio/[slug]` | `anuncio/layout.tsx` | `ANUNCIO` |
| `/blog` · `/blog/[slug]` | `blog/layout.tsx` | `BLOG` |
| `/paginas/[slug]` | `paginas/layout.tsx` | `PAGINA_CMS` |
| `/vendedor/[slug]` | `vendedor/layout.tsx` | `VENDEDOR` |
| `/contacto` | `contacto/layout.tsx` | `CONTACTO` |
| `/planes` (+ `/exito`, `/cancelado`) | `planes/layout.tsx` | `PLANES` |

**Por qué layouts y no una llamada por página** (que sería el calco literal de `getActiveBanners`):
un layout cubre por HERENCIA toda ruta que cuelgue de él, así que una futura `/blog/categoria/x`
recibe la barra sin que nadie se acuerde. Una página nueva que se olvidara de pedirla fallaría en
SILENCIO. El coste es que `(public)/page.tsx` tuvo que moverse a `(public)/(home)/page.tsx`, porque
la home no puede tener layout propio sin capturar a sus hermanas: **la URL no cambia**, el route
group es invisible.

`Header.tsx` y `(public)/layout.tsx` quedaron intactos. La barra es el primer hijo de `<main>`
(que no tiene padding), no es sticky —el header sí lo es, y pegar una segunda barra obligaría a
duplicar su altura como `top-16` en otro fichero— y va ENCIMA del `BannerList` de la home: chrome
sobre contenido, para que no baile verticalmente según haya banner.

El desplegable (`NavDropdown`) es el **único trozo cliente**, con Radix `DropdownMenu`; `MainNav`
sigue siendo Server Component. Mismo reparto que `Header` + `HeaderAuthNav`. Lleva `modal={false}`:
con el `modal` por defecto Radix marca `aria-hidden` todo lo que queda fuera del menú y bloquea el
scroll, que es correcto para un diálogo y deja el sitio inerte por desplegar un submenú.

### Caché: una entrada POR TIPO, un solo tag

Diverge del footer, que tiene una entrada con clave constante. Aquí el endpoint filtra por tipo,
así que la clave es `['main-nav', pageType]` y hay hasta 9 entradas. **Todas comparten el tag
`'main-nav'`, y `unstable_cache` invalida por TAG, no por clave**, así que un solo
`revalidateTag('main-nav')` las tumba las nueve. Verificado en la implementación instalada de Next
(`dist/server/web/spec-extension/unstable-cache.js`): la clave sale de `keyParts.join(',')` y los
tags viajan aparte hasta el `set` del caché.

**Por qué no la alternativa** (cachear el árbol entero una vez y filtrar en el render, que daría
una sola entrada): quitar un hijo por `visibleOn` puede vaciar a su padre, así que filtrar por tipo
obliga a ejecutar **el gate recursivo entero**. Eso metería la lógica de visibilidad en Next,
contra la regla de que el negocio vive solo en Nest.

Como en el footer, **Redis y Meilisearch no intervienen**: la caché es la de Next, y el backend
consulta Postgres solo cuando una entrada expira o se invalida.

### Borrado protegido cruzado — modificación de código vivo

`NavItem.pageId → Post` es `onDelete: Restrict`, igual que `FooterItem.page`. Eso obligó a tocar
`BlogService`, que ya funcionaba:

- **El precheck de `adminDelete` cuenta ahora las DOS tablas** (`footerItem` y `navItem`, en un
  `$transaction`). Sin esto, borrar una página enlazada **solo desde el nav** pasaba el chequeo y
  reventaba contra la constraint como un **500 sin controlar**. El mensaje distingue la
  procedencia (`"… enlazada desde 2 sitio(s) del footer y 1 sitio(s) del nav"`) para que el admin
  sepa dónde ir a desenlazar. Cubierto por unit y por e2e contra BD real (400, no 500).
- **`revalidatePostPaths` dispara los DOS tags**, `footer-nav` y `main-nav`: las dos navegaciones
  son cachés independientes y las dos pueden enlazar la misma página.

Lo que ya protegía al nav sin tocar nada: el slug de una `PAGE` publicada es inmutable
(`SLUG_IMMUTABLE`), así que un href `/paginas/{slug}` no se queda roto por un renombrado.

Nota de infraestructura de test: `test/helpers/db.ts` tuvo que añadir `"NavItem"` al `TRUNCATE`.
Solo los nodos con `pageId` cuelgan de `Post`; los de tipo `INTERNAL`/`EXTERNAL` o sin destino no
tienen camino de vuelta a `User` y habrían filtrado un árbol de nav entre suites — el mismo
motivo por el que `FooterColumn` ya estaba en la lista.

### CRUD de admin — `/admin/nav`

Solo ADMIN. **`AdminNav` pasó de 18 a 19 entradas** para ADMIN (`Navegación`, junto a `Footer`);
`admin-roles.spec.ts` actualizó el conteo a 19 — cambio deliberado, no rotura. MODERATOR (6) y
EDITOR (2) no cambian.

La página combina los dos moldes: el **editor de nodo** viene de `/admin/footer` (campos
condicionales por tipo que se limpian al cambiarlo, selector de páginas `PAGE`, badge "en borrador
— no se muestra", confirmación que anuncia el cascade con el número exacto) y la **gestión del
árbol** de `/admin/categorias` (dos niveles, crear hijo bajo un padre, reordenar hermanos con swap
de `order` + optimista + refetch si falla). Aquí el reorden se escribió como **una sola** función
parametrizada por la lista de hermanos; en el footer y en categorías es el mismo algoritmo escrito
dos veces.

Lo propio, que ningún molde cubría:

- **Selector de destino con CUATRO opciones**, no tres: la primera es "Sin destino (solo
  desplegable)". Un nodo así es válido al escribir aunque todavía no tenga hijos —rechazarlo haría
  imposible construir un desplegable, porque el padre nace antes que el primer hijo— y el gate lo
  poda al leer. La UI lo marca con un badge "sin destino y sin submenús — no se muestra" para que
  el admin vea el estado en lugar de sufrirlo.
- **`visibleOn`** como multi-select de los 9 tipos, con el vacío explicado con palabras ("se
  muestra en TODAS las páginas") porque una lista sin marcar se lee justo al revés.
- **MOVER = selector "Cuelga de"** en el editor. El desplegable solo ofrece raíces, excluye el
  propio nodo y **no ofrece ninguna si el nodo tiene hijos** (moverlo dejaría nietos a un tercer
  nivel). No duplica la validación del backend: la evita. El backend sigue validando lo mismo, y
  cuando rechaza, su mensaje se pinta legible dentro del formulario — con un test que recorre ese
  camino entero.

---

## Portada configurable — motor propio y hero rotativo (RP.1–RP.6, completo)

Configuración global de la home (`/`) editable desde el backoffice: un hero con título
parcialmente rotativo y un array ordenado de bloques. Diseño: `docs/diseno-portada.md`.
Motor **nuevo y separado** del sistema de bloques del blog (`Post.blocks`), no una extensión.
Todo lo de aquí está verificado contra el código.

### Estado por ráfaga

Las seis ráfagas están entregadas. **Desde RP.6 la portada la pinta entera el motor**, con dos
excepciones escritas: los banners (sistema propio y completo) y la rejilla de categorías como
fallback mientras no haya un carrusel configurado.

RP.1 entregó, además de su alcance de backend, la rodaja de RP.2 que cubre el hero
(`lib/api/homepage.ts`, `HomeHero`, el CSS del rotativo). RP.2 cerró el resto.

| Pieza | Estado |
|---|---|
| `HomepageConfig` (migración `20260806195038_add_homepage_config`) | ✔ RP.1 |
| DTOs de `cta` y `search` + `ValidHomeBlocksArray` | ✔ RP.1 (los otros 5 tipos: RP.4-RP.6) |
| `GET /homepage`, `GET/PATCH /admin/homepage`, `POST /admin/homepage/upload-image` | ✔ RP.1 |
| Caché `unstable_cache` + `revalidateTag('homepage-config')` | ✔ RP.1 |
| Hero SSR con rotativo CSS, a11y y `prefers-reduced-motion` | ✔ RP.1 |
| `HomeBlockRenderer` + renderizadores `cta` y `search` | ✔ RP.2 |
| `SmartLink` / `CtaButton` en `components/shared/` | ✔ RP.2 |
| Editor `/admin/portada` (hero + bloques + preview) | ✔ RP.3 |
| `grid` y `steps` + allowlist de iconos + upload de imagen | ✔ RP.4 |
| `listings` y `categoryCarousel` (los dinámicos) | ✔ RP.5 |
| `searchTable` + limpieza final de `(home)/page.tsx` | ✔ RP.6 |

### La fila única, y por qué NO es una `Setting`

`HomepageConfig` tiene `id String @id @default("singleton")`. `HomepageService` **solo hace
`findUnique` y `upsert`** sobre ese id, y no expone create ni delete: "exactamente una fila" no
depende de la disciplina de nadie.

Existía un precedente de config global —`Setting`, clave/valor— y **se rechazó a propósito**:
`Setting.value` es un `Json` opaco por construcción (el tipo depende de la clave, y **ningún
DTO lo valida campo a campo**). La portada guarda `href` y `src` que acaban en atributos reales
del DOM, que es justo lo que `@IsSafeContentUrl`/`@IsOwnStorageUrl` existen para vigilar. Mismo
criterio por el que `NavItem` no reusó `FooterItem`.

`get()` devuelve `DEFAULT_HOMEPAGE_CONFIG` si la fila no existe, **sin escribirla**: la ruta más
visitada del sitio no puede dar 404 porque alguien no corriera el seed.

### El hero es un CAMPO, no un bloque

`heroStaticTitle` / `heroRotatingOptions` / `heroRotationMs` / `heroSubtitle` viven fuera de
`blocks`. Es la decisión que **preserva la homogeneidad del motor**: ningún bloque conoce su
índice, así que el `switch` con `assertUnreachable` del renderizador se mantiene igual que en el
blog. Un `blocks[0]` con trato especial habría roto esa propiedad. Se paga con que el hero no se
puede reordenar, que es exactamente lo que se quiere. Y al no pasar por el motor, la página lo
envuelve en su propia `<section>` a sangre sin inventar un concepto de layout en el array.

### El rotativo: CSS puro, y el tope de 6 es su consecuencia

No había **ningún** precedente de texto animado en el repo (`grep` de
`typewriter|rotating|framer-motion|@keyframes` sobre `apps/web/src`: cero; lo único en
`tailwind.config.ts` era `accordion-down/up`, de Radix).

Se resolvió **sin JavaScript**. El `<h1>` servido lleva la parte fija y las N opciones apiladas
en un `inline-grid` (todas en `grid-area: 1/1`, así la caja mide lo que la más ancha y **no hay
salto de layout**); la velocidad viaja como custom property inline (`--rot-ms`), y cada opción
entra desfasada su índice.

**El tope de 6 opciones (`MAX_HERO_ROTATING_OPTIONS`) no es estético.** Los porcentajes de un
`@keyframes` no admiten `calc()`, así que el reparto del ciclo entre N opciones no se puede
parametrizar: hay **cinco reglas escritas a mano**, `hero-rot-2` … `hero-rot-6`. Subir el tope
sin añadir su regla dejaría el título congelado en la primera opción. El límite está validado en
el backend y comentado en los dos sitios.

**Dos desviaciones de lo que el diseño describía**, ambas por motivos verificados:

1. **Las reglas van fuera de `@layer utilities`**, no dentro. Tailwind purga el contenido de
   `@layer utilities` según lo que encuentra ESCRITO en el código, y la clase del contenedor se
   compone por N. Fuera de `@layer` nunca pasan por el purge. `HomeHero` usa además un mapa de
   literales estáticos (`ROTATION_CLASS`), que es cinturón y tirantes a propósito.
2. **`animation-fill-mode: backwards`** (el diseño no lo mencionaba). Sin él, las opciones 2…N
   mostrarían su opacidad base durante el primer ciclo y la primera parpadearía (1 de la base →
   0 del keyframe → 1).

### Accesibilidad: una frase, no una ristra

Las opciones 2…N llevan **`aria-hidden="true"`**. Verificado con el árbol de accesibilidad real
de Chromium: el `<h1>` se anuncia como `"Compra y vende coches"` mientras su `innerText` es
`"Compra y vende coches bicicletas muebles"`. Se descartaron `aria-live` (anunciar un cambio de
titular cada pocos segundos es hostil, y esto es un adorno) y sacar las opciones fuera del `<h1>`
(reintroduce el salto de layout).

**`prefers-reduced-motion: reduce` es obligatorio y no existía en ninguna parte del repo.** Con
la animación apagada manda la regla base y se ve la primera opción y solo la primera — medido:
opacidades `[1, 0, 0]` y `animation-name: none`. Es decir, **lo que se ve coincide exactamente
con lo que se oye**; quien pide movimiento reducido no recibe un titular mutilado.

### Caché: el molde del footer, no el del nav

`getCachedHomepageConfig` es `unstable_cache` con **una entrada, clave constante y un tag**
(`'homepage-config'`) — copia de `getCachedFooterNav`, y NO del nav, que necesita nueve entradas
porque su endpoint filtra por tipo de página. `GET /homepage` no filtra nada.

**La página sigue siendo dinámica**: el `await auth()` del layout raíz no se toca. Lo único
cacheado es la config, y `unstable_cache` la aísla de esa dinámica por completo.

Consecuencia limpia de cachear la CONFIG y no los datos resueltos: **ningún otro servicio tiene
que invalidar este tag**. Borrar una categoría o publicar una página no cambia la config; cambia
el mundo contra el que se resuelve, y eso se resuelve en cada render. Nada del acoplamiento
cruzado que `BlogService.revalidatePostPaths` sí necesita con `'footer-nav'` y `'main-nav'`.

### RP.2 — el motor, los 2 tipos reutilizados y la extracción a `shared/`

**`HomeBlockRenderer`** es el molde literal de `BlockRenderer.tsx` del blog: síncrono (para que
el preview client-side de RP.3 pueda usar el mismo componente que el SSR) y con `switch`
exhaustivo + `assertUnreachable`.

**No lleva `case` vacíos para los 5 tipos que faltan, y es deliberado.** Un `case` stub significa
"tipo ya tratado" y desactivaría justo la garantía que se busca. Además no compilaría: la unión
`HomeBlock` tiene hoy dos miembros, así que un `case 'grid':` es un error de TypeScript. El
mecanismo va al revés: **cuando RP.4 añada `grid` a la unión, `HomeBlockRenderer` deja de
compilar hasta que alguien escriba su `case`**. Y un tipo no registrado tampoco puede llegar
desde la BD: el discriminador del backend lo rechaza con 400 al guardar.

### Compartir entre los dos motores sin acoplarlos: la regla en la práctica

La regla (§4.0 del diseño) es *se comparte todo componente cuya firma NO mencione un tipo de
bloque*. Aplicada:

- **`components/shared/SmartLink.tsx`** — el reparto interno/externo. Props planas.
- **`components/shared/CtaButton.tsx`** — `{label, href, style}`. Lo llaman los renderizadores
  `cta` de los DOS motores, cada uno traduciendo SU tipo de bloque a esas props. `CtaBlock` (blog)
  y `HomeCtaBlock` (portada) no se importan entre sí: **cero acoplamiento de tipos**.

**Los cuatro usos NO eran copias idénticas** —el diseño decía "cuadruplicado literalmente" y era
inexacto—, y la diferencia es la que dicta la firma:

| Uso | Cómo decidía `external` |
|---|---|
| `CtaBlockRenderer`, `HubBlockRenderer` (blog) | **Derivado** del href: `!href.startsWith('/')` |
| `Footer`, `MainNav`, `NavDropdown` | **Recibido** del backend (`item.external`, `node.external`), que es quien conoce `FooterItemType`/`NavItemType` |

Por eso `external` es una prop **opcional**: pasarla gana, omitirla cae a la heurística. Ninguno
de los dos mundos cambia de comportamiento al unificarse.

**El caso difícil: `asChild` de Radix.** `NavDropdown` no estaba en la lista del diseño y llevaba
un aviso escrito: dentro de `DropdownMenuItem asChild`, Slot clona al hijo y le fusiona
`role="menuitem"`, los handlers de teclado y el ref; *un componente intermedio que no los
reenvíe se los traga en silencio*. Por eso `SmartLink` es `forwardRef` y hace spread de todo lo
que recibe — y con eso el caso difícil también se unifica. Verificado sobre la página real: el
`<a>` del menú sale con `role="menuitem"` **y con `data-radix-collection-item`** (la prueba de que
Slot fusionó), las flechas recorren los ítems y Escape devuelve el foco al disparador. Lo mismo
aplica al `<Button asChild>` que envuelve el CTA.

Resultado: **una sola definición del reparto interno/externo** donde había cinco copias
(`CtaBlockRenderer`, `HubBlockRenderer`, `Footer`, `MainNav`, `NavDropdown` ×2).

### El backfill del bloque `search` — una trampa del camino de actualización

RP.2 dejó de pintar el buscador a mano y lo pasó a bloque. Pero el seed era un `upsert` con
`update: {}` (para no pisar lo que un admin haya guardado), así que **una instalación que viniera
de RP.1 —con `blocks: []`— se habría quedado sin buscador al actualizar**: el código ya no lo
pinta y la config no lo trae.

`seedHomepageConfig` hace ahora un backfill **acotado**: si la fila existe y su array de bloques
está VACÍO, le escribe el bloque `search`. En cuanto hay un solo bloque configurado, no toca
nada. El array vacío es lo único que no puede ser una decisión del admin que merezca respetarse
—una portada sin un solo bloque no es una portada—, y es el estado exacto que deja RP.1. Mismo
espíritu que el `skipDuplicates` de `seedSettings`: rellenar lo que falta, nunca pisar lo que hay.
Comprobado idempotente: la segunda pasada informa "ya configurada, intacta".

### RP.3 — el editor `/admin/portada`

Va ANTES que los cinco tipos caros a propósito: a partir de aquí **ningún tipo puede nacer sin
forma de configurarlo**, y el compilador lo impone — el `switch` de `HomeBlockEditorRow` es
exhaustivo igual que el del renderizador, así que registrar `grid` en la unión rompe el build
hasta que tenga renderizador **y** editor.

**Dos zonas, y la separación no es de maquetación.** El hero es campo propio de la config, no un
bloque, y en el editor se ve: no se puede mover ni quitar. Los bloques sí. Es la misma decisión
que mantiene homogéneo el motor (§2.3 del diseño), hecha visible en la UI.

**Un solo botón de guardar** que manda la config entera — los bloques no son filas, son un Json
de una fila; mismo contrato que el submit de `PostForm`. Tras guardar, el estado se repuebla con
**lo que devolvió el servidor**, no con lo que se envió: si el backend normalizó algo (recortes,
opciones vacías descartadas), lo que el admin ve es lo que quedó guardado de verdad.

**El tope de 6 palabras rotativas es una BARRERA de UI, no un aviso.** Al llegar a 6 el botón
"Añadir palabra" se deshabilita y el `title` explica el motivo real: la animación es CSS y solo
hay reglas `@keyframes` para 2…6. Con una séptima no habría clase que aplicar y el titular se
quedaría **congelado en la primera palabra** — un fallo silencioso, que es la peor clase. El
backend valida lo mismo; la barrera evita que el admin lo descubra por un 400.

**El preview es obligatorio** porque la portada no tiene borrador: guardar es publicar. Reusa
`HomeHero` y `HomeBlockRenderer`, los MISMOS componentes del sitio público —por eso no puede
mentir—, y por eso `HomeBlockRenderer` es síncrono. Dos detalles que costaron pensarlos:

- La `key` del hero se deriva de `nº de palabras : velocidad`. Al cambiar cualquiera de las dos,
  el nodo se remonta y **el ciclo arranca de cero**; sin eso CSS reanudaría la animación a mitad
  y el preview no correspondería a lo configurado.
- Las opciones vacías se filtran antes de previsualizar, igual que hace el servicio al guardar.
  Con una vacía de por medio la clase sería la de N+1 y el preview mentiría.

**Rol: solo ADMIN**, como footer y nav (las tres son configuración del sitio; Blog y Páginas
abren a EDITOR porque son contenido). No hizo falta tocar el middleware: `ROLE_ALLOWED_PATHS` es
una **allowlist**, así que una ruta nueva bajo `/admin` es ADMIN-only por defecto. Verificado en
pantalla: MODERATOR y EDITOR acaban en `/`.

`admin-roles.spec.ts` pasa de 19 a 20 entradas de `AdminNav` — cambio deliberado, el mismo que
hizo RN.4 al añadir "Navegación".

### RP.4 — `grid` y `steps`, y la barrera del compilador funcionando

**Agrupados por NATURALEZA, no por dificultad** (§8): los dos son SSR puro y no consultan nada
externo. El carrusel, que necesita island y árbol de categorías, va en RP.5 con `listings`.

**La barrera se vio funcionar.** Al añadir los dos tipos a la unión `HomeBlock`, el build se cayó
con **cinco** errores, exactamente en los cinco sitios que hay que completar: los dos
`assertUnreachable` (renderizador y editor), `HOME_BLOCK_TYPE_META`, `createDefaultHomeBlock` y
`homeBlockHasContent`. Ninguno se puede eludir con un `case` vacío: el `Record<HomeBlockType, …>`
y los `switch` sobre `never` no lo permiten. Es la garantía que RP.2 y RP.3 montaron, cobrada.

**La allowlist de iconos es cerrada por una razón de bundle, no de gusto.** Un nombre libre de
lucide obligaría a resolver el icono en runtime y arrastraría la librería entera al bundle de la
ruta más visitada. Doce nombres, un `Record` estático en `components/home/home-icons.tsx` (que
además es exhaustivo: añadir un nombre a la lista sin su icono no compila) y `@IsIn` en el DTO.
El editor lo pinta como una **rejilla de iconos donde se pulsa**, no como un campo de texto.

**El discriminador anidado `image | icon` no es cosmético.** Son clases separadas, así que
`{ kind: 'icon', url: '…' }` se rechaza con 400 — con un objeto de campos opcionales habría
pasado y se habría guardado basura. Hay test.

**Las columnas son un conjunto {1,2,3,4,6}, no un rango**, porque el renderizador las mapea a
clases ESTÁTICAS de Tailwind. Un 5 no "casi funciona": no existiría la clase, porque Tailwind
purga lo que no ve escrito.

### La trampa de las dos allowlists: verificada de verdad (§7)

No basta con que el backend acepte la imagen; hay que ver que **se pinta**. Comprobado subiendo
una por el editor contra el build de producción:

```
S3_PUBLIC_URL = http://localhost:9000/marketplace   → hostname `localhost`
remotePatterns incluye { protocol: 'http', hostname: 'localhost' }   ✔ cubierto
URL devuelta por el upload: http://localhost:9000/marketplace/homepage/0af4…png
en la portada:  complete: true,  naturalWidth > 0
```

`naturalWidth > 0` es la prueba que importa: el navegador **descargó** el fichero, no es un roto
ni un hueco. (`isSafeSrc` compara hostname, no puerto, por eso `:9000` no estorba.)

Además, en la rejilla una imagen descartada por `isSafeSrc` **no borra la celda**: se pierde la
imagen y quedan el texto y el enlace. Es la diferencia deliberada con el bloque `image` del blog,
que desaparece entero — en un artículo una imagen menos se tolera; en una rejilla, un hueco
rompe la maquetación.

### El backfill, ahora con una señal exacta: `updatedById`

RP.2 lo condicionaba a "el array está vacío". Esa heurística ya no valía —tras RP.2 la fila tiene
un bloque— y además nunca supo distinguir "recién sembrada" de "un admin la vació a propósito".

La condición es ahora **`updatedById === null`**: el seed la deja a null y `HomepageService.update`
SIEMPRE escribe el id de quien guarda, así que es una señal exacta de *"esta portada no la ha
tocado nunca un admin"*. Comprobado en las dos direcciones: con la fila editada, el seed informa
"editada por un admin, intacta" y no toca nada; puesta a null, escribe los tres bloques de la
semilla y la segunda pasada es idempotente.

Hace falta en CADA ráfaga que pase algo de la portada a bloque: la página deja de pintarlo a mano
y, sin backfill, una instalación anterior se quedaría sin ese trozo.

### El andamio transitorio de la página (RETIRADO en RP.6)

Entre RP.2 y RP.5 la página repartía los bloques en dos sitios: los `search` dentro de la banda
del hero y el resto debajo de lo que aún estaba escrito a mano, porque las secciones pendientes de
migrar (Categorías, Recién publicados) iban EN MEDIO y con una sola llamada al renderizador no
había forma de intercalarlas sin reordenar la portada.

**RP.6 lo borró.** La página es hoy: banda del hero (solo el hero) y, debajo, el array entero en
una sola llamada. Con él se fueron el *eyebrow* escrito a mano, el buscador dentro de la banda y
el botón "Publica gratis" — los tres son ahora bloques de la semilla, en ese orden.

El motor nunca se enteró de nada de esto: ningún bloque conoce su índice ni entonces ni ahora.

### RP.5 — `listings` y `categoryCarousel`, los dos dinámicos

**`listings` recupera los dos providers, y esa es la razón de existir de la desviación.** El
bloque homónimo del BLOG renuncia a ellos a propósito
([`ListingsBlockRenderer.tsx:24-27`](../apps/web/src/components/blocks/ListingsBlockRenderer.tsx#L24-L27)):
sus tarjetas van sin corazón de favorito y sin la línea de atributos por categoría. En la portada
eso habría sido una **regresión visible**, porque la home escrita a mano sí los tenía. Aquí el
renderizador envuelve la rejilla en `CardAttributesProvider` + `FavoritesGridProvider`.

Y **no rompe el SSR**: los dos providers son `'use client'`, pero reciben los `ListingCard` como
`children` creados en un Server Component, así que las tarjetas se renderizan en servidor y su
HTML viaja en la respuesta; el cliente solo monta el contexto alrededor. Hay test que lo
comprueba en el navegador (corazón presente) y sobre el HTML crudo (las tarjetas, servidas).

**`categorySlug` es OPCIONAL**, al revés que en el blog: ausente = los recientes de todo el sitio,
que es el caso principal de una portada y lo que hacía la versión escrita a mano. El editor lo
ofrece como *"De todo el sitio"* y es lo que trae un bloque recién añadido.

**Los datos se resuelven antes del render.** `lib/home-blocks/resolve-listings.ts` —copia del
PATRÓN del blog, no de su código: la firma de aquel lleva un `Block[]` y eso es justo lo que la
regla de §4.0 prohíbe cruzar— resuelve TODOS los bloques `listings` en un `Promise.all` y el
renderizador recibe `data` ya hecha. Es lo que mantiene síncrono a `HomeBlockRenderer` (y por
tanto compartible con el preview del editor) y lo que evita el waterfall.

**El carrusel sirve TODAS sus categorías en el HTML**, no solo las visibles: son enlaces internos
y un crawler tiene que verlos. El island (`CarouselScroller`) solo hace `scrollBy`; la
funcionalidad vive en el CSS (`overflow-x-auto`), así que sin JS se sigue arrastrando. Medido: a
900 px de ancho el contenido (828 px) desborda el contenedor (736 px) y la flecha mueve
`scrollLeft` 0 → 92 → 0. Las flechas van con `aria-hidden` y `tabIndex={-1}` a propósito: no
añaden nada que no se pueda hacer ya tabulando por los propios enlaces, y anunciarlas solo metería
dos paradas de foco sin destino.

La imagen es **propia del bloque** (upload + `@IsOwnStorageUrl`), nunca `Category.iconUrl`. Si no
pasa `isSafeSrc`, el ítem **degrada a la inicial en un círculo** —lo mismo que hace `CategoryGrid`
sin icono— en vez de dejar un hueco; mismo criterio que la rejilla de RP.4. Y un slug colgado (una
categoría borrada) se **omite**: no hay FK que lo proteja, así que el renderizador aplica la
doctrina "se acepta al escribir, se oculta al leer" del nav.

### `CategoryGrid` se queda como FALLBACK (contradicción §8↔§4.2, ya resuelta en el diseño)

§8 pedía retirar en RP.5 tanto "Recién publicados" como `CategoryGrid`. Solo se retiró el primero,
y no por descuido: **el diseño chocaba consigo mismo**.

- §4.2 y la decisión 9 exigen que cada categoría del carrusel lleve una **foto propia subida**
  (`imageUrl` con `@IsOwnStorageUrl`). Es lo que separa el carrusel de la rejilla actual, que usa
  el `iconUrl` de 48 px.
- Una semilla **no puede subir ficheros**: `@IsOwnStorageUrl` rechaza cualquier URL inventada, y
  en una instalación nueva no hay nada en el bucket.

Retirar la rejilla sin poder sembrar el carrusel dejaría la portada **sin la sección de
categorías**.

**RP.6 lo cerró como decisión, no como deuda**, y corrigió `docs/diseno-portada.md` en los dos
sitios (§4.2 y §8): la rejilla **no es andamio pendiente de retirar, es el fallback de la
página**. Se pinta si —y solo si— no hay ningún bloque `categoryCarousel` configurado, y en el
sitio donde siempre estuvo: justo antes del primer bloque `listings` (si no hubiera ninguno, al
final). En cuanto un admin suba las fotos y configure el carrusel, deja de pintarse sola, sin
tocar código.

Es, junto con los banners, la única excepción al "la portada la pinta entera el motor". Las dos
están escritas en la cabecera de `(home)/page.tsx`.

### RP.6 — `searchTable`, y la portada pasa a ser el motor

**El bloque con más valor SEO del motor, y su propiedad central es una restricción de
implementación:** el contenido de TODAS las pestañas activas viaja en el HTML servido. Una tabla
con las dos pestañas sembradas son ~60 enlaces internos a búsquedas; de los tres paneles, el
usuario ve uno.

**Por eso las pestañas son propias y NO Radix.** `@radix-ui/react-tabs` no está instalado, y su
comportamiento por defecto es **desmontar el panel inactivo**: eso sacaría del HTML los enlaces de
dos de los tres paneles, que son literalmente el motivo de existir del bloque. Instalar una
dependencia para luego desactivar su comportamiento principal (`forceMount` + ocultar a mano) no
compensa frente a las ~45 líneas de `SearchTabs.tsx`, que hace exactamente una cosa: mover un
atributo `hidden`. Los paneles llegan como `ReactNode` ya renderizados por el Server Component;
**el island no genera ni un enlace**.

**Trade-off asumido:** los paneles inactivos se sirven CON `hidden` desde el servidor, no
visibles-y-luego-ocultos. El contenido está en el HTML y sus enlaces se rastrean; a cambio, Google
pondera algo menos lo que solo se ve tras interactuar. La alternativa —los tres paneles a la vez—
destruye la interfaz, que es el motivo de que haya pestañas. Y servirlos ocultos desde el servidor
evita el parpadeo de pintarlos todos y ocultarlos al hidratar.

Teclado completo (patrón `tablist` del APG): flechas ←/→ con vuelta circular, `Home`/`End`, y
*roving tabindex* — solo la pestaña activa es tabulable, así que el `Tab` no recorre las tres.

**Las tres clases de pestaña y sus URLs**, ninguna concatenada a mano:

| `kind` | Enlaces | Cómo se construye |
|---|---|---|
| `locations` | Las 52 provincias | `/busqueda?province=…`, el mismo destino al que navega el buscador sin categoría elegida |
| `categories` | El árbol, con o sin hijas | `categoryPath()` (la hija va anidada bajo su padre) |
| `combos` | Los pares que elige el admin | `categoryPathWithQuery()` |

**`province` se valida SOLO EN LA FORMA.** `PROVINCIAS` es una constante del FRONTEND —el backend
no tiene la lista y filtra `province` como coincidencia exacta contra Meilisearch—, así que
validarla en el DTO exigiría una segunda copia de 52 cadenas que mantener a mano. En su lugar: el
editor ofrece un `<select>` (un typo es casi imposible) y el **renderizador omite** la combinación
cuya provincia no esté en la lista. Misma doctrina "se acepta al escribir, se oculta al leer" que
el nav y que los slugs colgados del carrusel.

Reglas cruzadas del servicio: **máximo una tabla** (dos duplicarían cientos de enlaces internos y
en vez de sumar SEO lo diluyen) y **ninguna clase de pestaña repetida** — no es capricho: el id del
panel ES el `kind`, así que dos `locations` producirían dos elementos con el mismo id y
`aria-controls` apuntando a cualquiera de los dos. Los `categorySlug` de los combos entran en la
MISMA consulta que ya comprobaba los de `listings` y el carrusel.

**La página, después de la limpieza.** `(home)/page.tsx` es hoy: banners → banda del hero → array
entero. Las dos excepciones (banners y rejilla-fallback) están escritas en su cabecera. Y la
portada resultante es **la misma de antes, elemento a elemento y en el mismo orden**:

| Orden | Antes (escrito a mano) | Ahora |
|---|---|---|
| 1 | Banners | Banners (igual, sigue fuera del motor) |
| 2 | eyebrow "Miles de anuncios cerca de ti" | campo `eyebrow` del bloque `search` |
| 3 | `<h1>` + rotativo + subtítulo | hero (campo propio de la config) |
| 4 | `SearchBar` + chips "Populares" | bloque `search` |
| 5 | botón "¿Tienes algo que vender? Publica gratis" | bloque `cta` (`style: outline`) |
| 6 | sección "Categorías" (`CategoryGrid`) | igual, ahora como fallback de la página |
| 7 | "Recién publicados" | bloque `listings` |
| 8 | "Cómo funciona" | bloque `steps` |
| 9 | 4 señales de confianza | bloque `grid` |

**La semilla no añade NADA.** `searchTable` existe, funciona y es configurable, pero **no se
auto-siembra**: igual que el carrusel, aparece cuando un admin lo añade desde `/admin/portada`. La
diferencia entre los dos es el motivo —el carrusel *no puede* sembrarse (necesita fotos subidas),
la tabla *podría* pero no debe— y el resultado es el mismo: **una instalación nueva ve exactamente
la portada de siempre**. Los cinco bloques sembrados son los de la tabla de arriba, y la lista es
idéntica en los tres sitios que la escriben (`seed.ts`, `seed-test.ts`, `e2e/helpers/portada.ts`);
el backfill de `updatedById === null` usa esa misma lista, así que tampoco introduce la tabla en
una instalación anterior.

Los tests de `searchTable` —11 de API y 5 de navegador— **crean el bloque ellos mismos** antes de
comprobarlo, exactamente como los del carrusel y por el mismo motivo. La cobertura no depende de
lo que traiga la semilla.

**Los tres cambios visuales**, y ninguno añade ni quita contenido:

1. El *eyebrow* pasa de ir ENCIMA del `<h1>` a ir encima de la caja de búsqueda: es campo del
   bloque `search` (§4.1 del diseño) y el buscador ya no vive dentro de la banda del hero. Con él
   salen del fondo `bg-primary/5` y del `max-w-4xl` centrado el buscador y el botón.
2. **La banda del hero pasa de `py-14 md:py-20` a `py-10 md:py-14`**, y el `mb-8` del `<h1>` a
   `mb-8 last:mb-0`. Aquel aire estaba dimensionado para una banda que además llevaba buscador y
   botón; con solo el titular dentro dejaba un hueco que se leía como un fallo de maquetación. La
   variante `last:` hace lo correcto en los dos sitios sin que ninguno sepa del otro: en la portada
   el `<h1>` es el último hijo de su contenedor y pierde el margen; en el preview del editor los
   bloques se pintan a continuación dentro del MISMO contenedor, no es el último, y lo conserva.
3. **El rotativo se alinea con `justify-items: start`** — la decisión que quedaba abierta desde
   RP.3, ver más abajo.

**La barrera del compilador, cerrada.** `searchTable` era el séptimo y último tipo del diseño.
Registrarlo rompió, como los anteriores, los cinco sitios que exigen exhaustividad: el `switch` del
renderizador, el del editor, el `Record` de metadatos y los dos `switch` de `homeBlockDefaults`.
Con la unión completa **ya no queda ningún tipo del diseño sin registrar**, así que el test de API
que probaba "tipo aún no registrado → 400" se retiró en vez de dejarlo apuntando a un tipo que sí
existe: habría pasado en verde por el motivo equivocado. La garantía la sigue cubriendo el test de
tipo inexistente.

### Lo que cuesta ahora renderizar la portada, y qué pasa si la API falla

Desde RP.5 la semilla incluye un bloque `listings`, así que **cada render de la portada implica
una consulta a Meilisearch**. Está acotado por el `revalidate: 180` que `resolveHomeListingsData`
pasa a `search()` —solo el primer render de cada ventana de tres minutos la paga— y por el tope
de 4 bloques `listings` que valida el servicio. Pero es carga nueva en la ruta más visitada y
conviene saberlo.

Y el fallback tiene una consecuencia que hay que tener presente: si `getCachedHomepageConfig()`
falla, la página cae a `FALLBACK_HOMEPAGE_CONFIG`, que trae `blocks: []`. Es decir, **la portada
se sirve entera pero SIN NINGÚN bloque**: titular, cabecera y pie sí; buscador y secciones no.
Es deliberado —mejor una portada mínima que un 500—, y solo puede darse en la ventana en que la
caché no tiene valor (justo tras invalidarse por un guardado) Y la API no responde a la vez.

Se observó exactamente eso en una corrida completa de la batería: `buscador-sugerencias` falló
entero porque la portada llegó sin bloques, con el `<h1>` del fallback. No se pudo reproducir en
tres intentos dirigidos —el spec solo (11/11), con todos sus predecesores (67/67) y después de
`portada-hero` (19/19)—, y la corrida en la que ocurrió fue la más lenta registrada (18,2 min),
así que apunta a la API sin responder bajo saturación de la máquina, no a un defecto de lógica.
Queda anotado por si reaparece: el síntoma a buscar es **portada sin ningún bloque**, y lo que
hay que mirar entonces es la salud de la API, no el motor.

### La semilla de test, con FUENTE ÚNICA (`e2e/helpers/portada.ts`)

Los tres specs de portada mutan una fila estática compartida con toda la batería y la restauran
al terminar. Cada uno llevaba **su propia copia** de la semilla, y la copia se quedó atrás en
cuanto la semilla creció en RP.4: "restauraban" una portada **sin `steps` ni `grid`**, así que
todo lo que corriese después medía una página distinta de la que el seed promete.

Ahora la semilla vive en `e2e/helpers/portada.ts` y los tres la importan. Si cambia, cambia en
`seed-test.ts` y ahí, a la vez.

Dos tests hubo que reorientar por el mismo motivo:

- El que contaba filas del editor usaba un número ABSOLUTO (`toHaveCount(2)`), que caduca en
  silencio con cada ráfaga. Pasa a contar en relativo (`alEmpezar + 1`).
- El que comprobaba el orden afirmaba que un `cta` subido al principio precede al BUSCADOR.
  Con el andamio transitorio eso ya no podía ser cierto —el buscador se pintaba en la banda del
  hero y el resto debajo—, así que pasó a comparar contra el bloque de pasos, que iba en el mismo
  grupo. **RP.6 lo devolvió a su forma fuerte**: retirado el andamio, el `cta` sí precede al
  buscador y la afirmación vuelve a ser "la posición en el array manda sobre TODOS los bloques".

Y RP.6 añadió un tercer motivo de ajuste, este por el crecimiento de la propia semilla: al pasar
el botón "Publica gratis" a bloque, la semilla **ya trae un `cta`**, así que
`getByTestId('home-block-row-cta')` y los campos de dentro (`cta-label`, `cta-href`) resuelven dos
elementos. Los tres tests del editor que añadían un `cta` pasan a resolver la fila por POSICIÓN
(`filas.nth(i)`), nunca por tipo. Es la misma clase de caducidad silenciosa que el `toHaveCount(2)`
absoluto, y la misma lección: **nada en estos specs puede asumir que la semilla tiene un solo
bloque de un tipo**.

### El trade-off del rotativo — RESUELTO: `justify-items: start`

RP.1 lo anotó, RP.3 lo midió en el preview y el ajuste de RP.6 lo cerró. Esto es lo que se veía
con palabras de anchura dispar (`coches` / `motocicletas` / `bicis`):

- La caja del rotativo mide **181 px**, lo que ocupa la palabra más larga, y **no cambia** al
  rotar — es la propiedad que evita el salto de layout, y funciona.
- Con la palabra más larga el titular se lee perfecto: *"Compra y vende motocicletas"*.
- Con una corta, la palabra queda **centrada** dentro de esos 181 px y aparece un hueco visible:
  *"Compra y vende␣␣␣␣coches"*.

La palanca es una línea: `justify-items: start` en `.hero-rot`. Comparado en el navegador, con
esa línea el titular se lee con espaciado normal (*"Compra y vende coches"*) a cambio de que la
frase entera quede ligeramente descentrada, porque la caja sigue reservando el ancho de la
palabra más larga.

**Decisión: `justify-items: start`.** Era una elección de producto entre dos defectos pequeños
—hueco visible frente a frase algo descentrada— y se resuelve a favor del segundo por un motivo
concreto: **un margen no se lee como un error y un espacio doble sí**. Un lector que ve
*"Compra y vende␣␣␣␣coches"* piensa que alguien se dejó un espacio; uno que ve la frase pegada a
la izquierda con aire a la derecha no piensa nada.

La caja sigue midiendo lo que la opción más ancha, así que **la garantía anti-salto de layout no
se toca**: lo único que cambia es dónde queda el hueco. Está en `globals.css`, en la regla
`.hero-rot`, con el porqué escrito al lado. Anotado también en `docs/diseno-portada.md` §3.2.

### `getByRole` no sirve para sondear si una página ya se actualizó

El spec del motor de bloques salía rojo en un sitio muy concreto: el `beforeAll` que espera a que
la portada refleje un `cta` recién escrito. El componente estaba bien —la página devolvía 200 y el
`<a href="/publicar">` estaba en el HTML— pero el sondeo no lo veía.

Causa, medida en la página real: el sondeo hacía `goto(..., 'domcontentloaded')` y consultaba con
`getByRole('link', { name })`. **`getByRole` se apoya en el árbol de accesibilidad, y un elemento
sin caja de layout no está en él.** En ese instante el ancla daba `getBoundingClientRect()` de
**0×0** y `getByRole` devolvía **0**, mientras `getByText` ya la encontraba; con la página
cargada, **167×44** y `getByRole` = 1.

Regla que queda: en un predicado de espera, `waitUntil: 'load'` y locators PLANOS (`getByText`,
`locator`, `getByPlaceholder`). `getByRole` en los tests sí, donde `expect()` reintenta hasta que
el elemento está pintado — que es exactamente lo que allí faltaba. Y una espera de AUSENCIA debe
exigir además algo presente (el `<h1>`), o daría por buena una página que no ha renderizado nada.

**La misma trampa por otra puerta (RP.3): `boundingBox()`.** Dos tests comparaban posiciones
verticales para afirmar "este bloque va antes que aquel". `boundingBox()` devuelve `null` si el
elemento aún no está pintado y —a diferencia de `expect()`— **no auto-espera**, así que en la
batería completa reventaban con `Cannot read properties of null`. Se sustituyó por
`compareDocumentPosition`: el ORDEN EN EL DOM es además literalmente la propiedad bajo prueba (la
posición en el array es el orden, no hay campo `order`), así que el test quedó más directo y sin
depender del layout.

### La fila semilla reproduce la portada anterior

`seed.ts` siembra `heroStaticTitle: 'Compra y vende de segunda mano'` con `heroRotatingOptions:
[]` — el `<h1>` exacto que la home pintaba a mano — y, desde RP.2, el bloque `search` con
`popularCount: 6`, que es el valor que traía la constante `POPULAR_CATEGORY_COUNT`. **Estrenar el
motor no cambió una sola palabra de lo que ve el usuario**: comprobado en pantalla contra el build
de producción, el orden de la banda del hero sigue siendo eyebrow → `<h1>` → buscador → 6 chips →
CTA, con el mismo espaciado (el `space-y-8` del renderizador coincide con el `mt-8` que había).
`seed-test.ts` la resetea en cada corrida, como hace con `Setting`, porque es fila estática
compartida entre suites y excluida de `cleanDb` — y los dos specs que la mutan restauran ese mismo
valor, bloque `search` incluido: restaurar con `blocks: []` dejaría sin buscador a todo lo que
corriese después.

**Dos cosas siguen escritas a mano a propósito** hasta la limpieza final de RP.6, y las dos por
no hacer un cambio visual que no se pidió:

- **El *eyebrow*** ("Miles de anuncios cerca de ti"). El bloque `search` tiene su campo `eyebrow`
  y funciona, pero el bloque se pinta DEBAJO del `<h1>` y hoy ese texto va ENCIMA; sembrarlo
  reordenaría el titular.
- **El botón "Publica gratis"**. El bloque `cta` existe y renderiza, pero el `CtaButton`
  compartido es `size="lg"` (el del blog) y este botón es `size="sm"`. El modelo no tiene campo de
  tamaño y no se inventa uno para esto.

Y una estructura transitoria: `HomeBlockRenderer` se monta DENTRO de la banda del hero, porque
los dos únicos tipos que existen hoy viven ahí en la portada actual. En cuanto RP.4 traiga bloques
que no son del hero, sale de la `<section>` al sitio que fija §5.1.

### El fallo que solo aparecía en la batería completa: era un 429, no el hero

`portada-hero.spec.ts` pasaba aislado y fallaba en la batería. El síntoma engañaba —parecía que
el hero no reflejaba la config— pero el error real, leído en el `error-context.md` de Playwright,
era:

```
[loginAdminViaApi] login falló para admin-e2e@example.com: 429 {"retryAfter":900}
```

El helper `setConfig()` **volvía a autenticarse en cada escritura**. `/auth/admin-login` tiene
límite por ventana de 15 min y la batería entera comparte la cuenta `admin-e2e`, así que tres
logins de más bastaron para agotar el presupuesto. Arreglado memoizando el token: **un solo
login por fichero**.

**Hallazgo transversal que esto destapó — ya RESUELTO, ver la sección siguiente.**

Se mantiene además, por si acaso, **una sola escritura de config entre describes** (sin restore
intermedio): la invalidación es fire-and-forget, así que dos escrituras seguidas podrían
aterrizar en orden inverso. No fue la causa de este fallo, pero es un riesgo latente real y el
coste de evitarlo es cero.

### Lo que NO se comprueba con tests unitarios

Las tres propiedades del hero viven en el HTML servido, en el árbol de accesibilidad y en el
motor de CSS, así que `portada-hero.spec.ts` las mide donde ocurren:

- el `<h1>` se afirma sobre una **petición HTTP cruda sin navegador** (lo que ve un crawler): un
  `<h1>` rellenado por JS no pasaría de ahí;
- el nombre accesible, con `toHaveAccessibleName`;
- `prefers-reduced-motion`, con `page.emulateMedia()` **sobre el mismo documento** con y sin la
  preferencia. `test.use({ reducedMotion })` en un describe anidado **no llega a la página**
  (se comprobó: `matchMedia` devolvía `false` y la animación seguía corriendo).

---

## UXV.6 — PULIDO: los ocho remates que cierran la zona de vendedor

Última tanda de [`diseno-ux-vendedor.md`](diseno-ux-vendedor.md). No tiene raíz común: es lo
que queda cuando las cuatro raíces están cerradas, agrupado por superficie.

### M4 — el casi-bug: dos cobros por el mismo plan

`/planes` enseñaba «Hazte Pro» **también a un suscriptor**, y pulsarlo creaba una SEGUNDA
suscripción de Stripe sobre la misma cuenta. Nadie lo impedía: ni la interfaz ni el
servidor.

**El arreglo está en el backend**, no en el botón: `createCheckoutSession` rechaza ahora con
`ALREADY_SUBSCRIBED` si hay una suscripción `ACTIVE` o `CANCELING`. Esconder el botón
habría dejado el agujero abierto a cualquier POST directo, y lo que estaba en juego era
cobrar dos veces. En la interfaz, ese usuario ve «Ya eres Pro» + «Gestionar mi suscripción».

**El guard no atrapa a nadie**: `CANCELED` y `PAST_DUE` **no** bloquean —en el segundo el
cobro falló y hay que poder rehacerlo—, y hay una prueba por cada estado.

### M4 — la lista de beneficios, derivada

Estaba escrita a mano en el componente y desincronizada de lo que la app hace: prometía
«estadísticas» y «soporte prioritario» y **callaba los dos beneficios que más se notan**,
los destacados gratis al mes y la cuota de bumps. Un admin podía subir `proMonthlyBumpQuota`
y la página de precios seguía diciendo lo mismo.

Ahora sale de `GET /billing/catalog`, compuesta de los `Setting` que de verdad conceden cada
ventaja. **Cada línea solo se promete si el ajuste la concede** (una cuota a 0 no se
anuncia): la lista no puede volver a mentir.

**AQUÍ SE CONECTA EL VÍDEO PRO (proyecto 3)**: cuando exista su flag de admin será una
entrada condicional más de `buildProBenefits`, y `/planes` la mostrará sin enterarse.

**Lo que destapó al derivarla**: la tarjeta «Gratis» tenía el mismo defecto —decía «Hasta 5
anuncios activos» mientras `freeActiveListingLimit` valía otra cosa— y la comparación entre
las dos lo dejó a la vista. Se derivó también (`freeBenefits`). **Ojo, dato de negocio, no
de código**: en la BD de test `freeActiveListingLimit` = 100 y `proActiveListingLimit` = 20,
o sea el plan gratuito permite MÁS que el Pro. La lista hardcodeada lo tapaba; ahora se ve.
Conviene revisar esos ajustes en producción.

### El resto

| # | Antes | Ahora |
|---|---|---|
| **M12** | `isPro && remaining > 0`: al gastar el último destacado el aviso desaparecía y «no soy Pro» y «ya la gasté» se veían igual. La cuota de bumps no salía en ninguna parte. | Las DOS cuotas, también agotadas, en `/mis-anuncios` y en `/perfil/suscripcion`. |
| **M9** | La API devolvía `totalPages` desde el principio y la página pintaba 20 apuntes sin decir que había más. | `HistorialPaginado`, genérico para las dos monedas. Un fallo de red no vacía lo que el usuario mira. |
| **M8** | `success ? <mensaje> : <formulario>` y `success` no se limpiaba: un cupón por carga de página. | El resultado va ENCIMA del formulario, que sigue ahí. |
| **M11** | «contacta con soporte», sin enlace y sin decir dónde. | Enlaza a `/mis-tickets/nuevo`, como ya hacían la tarjeta y el panel de facturas. |
| **B1** | Tres nombres: menú, título y URL. | Los dos VISIBLES ya se unificaron en UXV.2. **La URL se queda**, y es decisión: renombrarla rompe enlaces de correos, tickets y marcadores a cambio de una coherencia que el usuario no ve. |
| **B5** | «(arriba)» sin enlace; el historial de bumps vacío no se renderizaba; facturas con una línea de texto. | Cada vacío dice qué pasa y ofrece salida. El de bumps existe aunque esté vacío: ocultarlo escondía que la función existe. |
| **B6** | El banner iba por delante del `<h1>`: lo primero en la pantalla de gestión era publicidad. | Debajo de la cabecera. Sigue estando — es un slot de negocio. |

### Dos pruebas que NO son e2e, y por qué

La paginación (M9) y la cuota agotada (M12) se prueban en jsdom, no en Playwright:
`/mis-creditos` y `/mis-anuncios` son Server Components y su render inicial lo resuelve el
servidor, así que `page.route` no puede fabricar ni un historial de tres páginas ni una
cuota a cero sin consumirla de verdad. Los componentes sí reciben ese estado por props. Es
la misma limitación que ya documentaba la cabecera de `e2e/mis-creditos.spec.ts`.

**Verificado**: `test/uxv6-pro-guard.e2e-spec.ts` (5), `e2e/pulido.spec.ts` (9),
`HistorialPaginado.test.tsx` (6), `quota-reminder.test.tsx` (5).

---

## UXV.5 — EL EDITOR: editar deja de ser un alta

Quinta tanda de [`diseno-ux-vendedor.md`](diseno-ux-vendedor.md). La edición reusaba el
wizard del alta: `StepIndicator` no era clicable y «Guardar cambios» **solo existía en el
último paso**, así que corregir una errata del título obligaba a pulsar «Siguiente» cuatro
veces —validando de paso todo lo que hubiera por medio— antes de poder guardar. Y no había
ni «Cancelar» ni aviso: salir descartaba en silencio.

### EDITOR-D1 — secciones, no wizard

`EditarWizard` → [`EditarForm`](../apps/web/src/components/publicar/EditarForm.tsx): una
página con las cinco secciones apiladas, un índice que lleva a cada una y **una barra de
guardado fija**. Los cinco `Step*` **se reusan tal cual** — ya eran componentes de
presentación que reciben `data`/`onChange`/`errors` y pintan su propio `<h2>`. No se ha
reescrito ninguno.

**Publicar sigue siendo un wizard, y es deliberado.** Son dos tareas distintas: el alta
guía porque el usuario no sabe qué falta; la edición no, porque sabe exactamente a qué
viene. Que compartieran UI era el defecto, no la virtud. Hay una prueba que falla si el
alta se convierte en el editor por accidente.

**La validación no se ha relajado.** Cada sección conserva sus reglas; lo único que cambia
es cuándo corren: antes al pulsar «Siguiente» de ese paso, ahora **todas al guardar**, con
salto automático a la primera sección con errores. Guardar envía el anuncio completo, así
que validar solo lo que el usuario abrió habría dejado que el backend rechazara lo demás.

### Salir sin guardar

[`useUnsavedChanges`](../apps/web/src/hooks/use-unsaved-changes.ts) cubre las dos formas de
irse: `beforeunload` (cerrar pestaña, recargar, salir del sitio) y **interceptación del
clic en fase de captura** para la navegación interna.

Es clic y no «evento de router» porque **el App Router no expone eventos de navegación**
(`router.events` era del Pages Router). No hay un punto oficial donde frenar una transición
en curso; lo que sí se puede es atajar el clic antes de que empiece.

Esto pasó de molestia a necesidad por UXV.2: el menú de la cuenta está ahora **siempre a la
vista**, a un clic de perder el trabajo. Hay una prueba que ejercita justo ese caso.

### El seam del VÍDEO PRO (proyecto 3)

Dos piezas, y las dos existen ya:

| Qué necesitará el vídeo | Dónde está |
|---|---|
| **Saber si el usuario es Pro** | La página de editar llama ahora a `getProStatus` —no lo hacía— y lo pasa a `EditarForm`. Falla en silencio: no saber el plan no puede impedir editar. |
| **Un sitio donde ponerse** | `resolveEditSections(data, proStatus)`. Hoy devuelve las mismas cinco secciones con o sin `proStatus`, y **eso es correcto**: el vídeo no existe. Lo que fija la prueba es que el CABLEADO existe, para que el proyecto 3 no tenga que abrirlo por tres ficheros. |
| **El molde del gate** | [`EstadisticasClient.tsx:164-176`](../apps/web/src/components/anuncios/EstadisticasClient.tsx#L164-L176) — card punteada + `Lock` + «Hazte Pro» → `/planes`. Identificado, no replicado aún. |

Es el mismo criterio que UXV.4 con el bump automático: la superficie preparada, la función
sin implementar.

### Nota de entorno

`jest.setup.ts` añade un stub de `Element.prototype.scrollIntoView`: jsdom no la implementa
(no tiene layout). El editor la usa para llevar al usuario a la primera sección con
errores, y sin el stub cualquier prueba que validara reventaba con un `TypeError` que no
decía nada del fallo real. Es una carencia del ENTORNO, así que se rellena ahí y no se
ensucia el componente con un `?.` defensivo.

**Verificado**: `e2e/editor.spec.ts` (7 pruebas en navegador real) + `EditarForm.test.tsx`
(14, heredando las seis de RP.3 sin relajar ninguna). `prefill-ubicacion` y
`wizard-herencia` migrados: lo que eran hasta cuatro clics en «Siguiente» es ahora una
espera al render.

---

## UXV.4 — LA TARJETA: jerarquía, y las dos superficies reconciliadas

Cuarta tanda de [`diseno-ux-vendedor.md`](diseno-ux-vendedor.md). Ataca el reparto del
espacio de `MyListingCard`, que era una fila `flex-wrap` con **hasta doce botones**
`variant="outline" size="sm"`: promocionar (ingreso), gestionar el ciclo de vida y
DESTRUIR de forma irreversible, todos con el mismo peso. En móvil, tres o cuatro filas de
botones por anuncio.

### La jerarquía (A6, TARJETA-D1)

```
[ Promocionar ]   Editar · Ver anuncio · <la acción de estado que toca>        ⋯
   primaria              secundarias (≤3)                                   menú
```

**Ninguna acción se ha perdido**: las mismas once, repartidas por peso. Lo que descarga la
fila es que la acción de estado sea **UNA según el estado** —un `ACTIVE` ofrece Pausar; un
`PAUSED`, Reactivar; un `DRAFT`, Publicar— en vez de todas a la vez. Archivar y Eliminar
salen de la fila al «⋯», **conservando su `AlertDialog`**: el menú no relaja ninguna
confirmación, solo deja de dar a lo irreversible el mismo peso que a lo cotidiano.

Qué va en cada nivel lo decide [`use-listing-actions.tsx`](../apps/web/src/components/anuncios/owner/use-listing-actions.tsx),
no la tarjeta: es la misma lista que consume la ficha, y dos inventarios mantenidos por
separado son lo que hizo divergir las dos superficies.

### Promocionar (TARJETA-D2), con el matiz que importa

Destacar y Bump eran dos botones sueltos y el usuario tenía que deducir en qué se
diferencian dos productos que se parecen. Ahora hay un punto de entrada y un diálogo con
los dos, su explicación y su precio.

**Pero el bump GRATIS sigue a un clic.** Cuando hay cuota Pro o saldo de bumps no hay nada
que elegir ni que cobrar, así que meterlo tras un diálogo sería cobrar un paso por nada. El
control primario es un **botón partido**:

```
[ Subir gratis │ ▾ ]      ▾ → «Destacar anuncio…»
```

y cuando el bump cuesta o está en cooldown, un botón único «Promocionar» que abre el
diálogo. En cooldown el primario **no se apaga**: destacar no depende del cooldown, y
apagarlo quitaría una capacidad.

### El enganche del bump automático, preparado sin diseñarlo

Dos sitios, y los dos existen ya con contenido real (no son huecos vacíos):

| Qué necesitará el bump-auto | Dónde entra |
|---|---|
| **Su punto de entrada** | El `▾` del botón partido, junto a «Destacar anuncio…». |
| **Su configuración** | Un `Producto` más en el selector del diálogo, con su bloque debajo donde hoy están duración y método de pago. |
| **Su estado** | [`PromotionStatus`](../apps/web/src/components/anuncios/owner/PromotionStatus.tsx): «Próximo bump: …» es UNA LÍNEA MÁS. Antes `featuredUntil` era un caso suelto entre los datos del anuncio; ahora es una ZONA que ya pinta dos líneas y admite N. |

Nada de eso se implementa aquí.

### Las dos superficies, reconciliadas (transversal 2)

`ListingOwnerActions` decía «Subir al inicio (bump)» donde la tarjeta decía «Bump 5 cr.»,
sin coste, sin tener en cuenta el saldo ni la cuota Pro. **UXV.1 unificó el dato del
cooldown; esto unifica lo que se le cuenta al usuario**: las dos montan el mismo
`PromocionarControl` con el mismo `BumpPricing`, así que comparten rótulo, coste, orden de
consumo de las monedas y feedback. Lo único que cambia es la forma (columna vs fila), que
es lo que parametriza `contexto`.

**Lo que UXV.1 dejó fuera y aquí sí entra: el coste en la ficha.** Se resuelve con
[`useBumpPricing`](../apps/web/src/hooks/use-bump-pricing.ts), que pide catálogo, saldo y
pro-status **desde el cliente y solo si quien mira es el dueño** — una ficha la ven sobre
todo visitantes anónimos, y no deben disparar nada. Por eso no rompe el SSR/ISR de la
página, que es la razón por la que UXV.1 lo aplazó.

**Lo que NO se trae a la ficha**: el ciclo de vida (pausar, archivar, eliminar…). La ficha
es donde el vendedor se ve como lo ve un comprador; duplicar allí un menú de once acciones
volvería a repartir la gestión en dos sitios.

### A5, M10 y B3

- **A5** — «Ver anuncio» en la tarjeta. El `slug` ya viajaba en `ListingSummary` y no se
  usaba: el vendedor no podía ver su propio anuncio publicado sin buscarlo a mano. Solo en
  los estados con página pública (`ACTIVE`/`RESERVED`); en un borrador no hay destino.
- **M10** — «Ver estadísticas» abre las de ESE anuncio (`?anuncio=<id>`), en vez de la
  pantalla global donde había que buscarlo en un `<Select>` de N. Un id ajeno no está en la
  lista y cae al primero: el comportamiento de siempre.
- **B3** — las nueve pestañas de filtro dicen cuántos anuncios contienen. El dato es un
  `groupBy` por estado sobre `sellerId` (indexado, nueve filas como mucho) **dentro de la
  transacción que `findMine` ya hacía**: ni una ida y vuelta más. `all` no es la suma —
  excluye `ARCHIVED`, la misma regla que la vista por defecto. Sin el dato (backend viejo)
  **no se pinta un 0**: un cero falso es peor que no decir nada.

**Verificado**: `e2e/tarjeta.spec.ts` (11 pruebas en navegador real, incluidas «ninguna
acción se perdió» y el bump gratis a un clic) + `bump-cooldown-surfaces.test.tsx`
reescrito a la estructura nueva sin perder lo que probaba.

---

## UXV.3 — FEEDBACK: el canal que la aplicación no tenía

Tercera tanda de [`diseno-ux-vendedor.md`](diseno-ux-vendedor.md). Tres pantallas
terminaban en silencio, y no por descuido de cada una: **no había dónde avisar**. La raíz
(M6) es que `useApiAction` solo tenía canal de error y no existía ningún toast en el
proyecto, así que cada pantalla se inventó el suyo — un `<p>` verde aquí, un
`router.refresh()` mudo allá, y en tres sitios nada.

### La infraestructura, primero (M6)

- **`sonner`** (FEEDBACK-D1), envuelto en [`components/ui/sonner.tsx`](../apps/web/src/components/ui/sonner.tsx)
  para fijar posición, duración y colores en UN sitio. Montado **una vez en el layout
  raíz** y **fuera de `AuthProvider`**: un toast no depende de la sesión y tiene que poder
  salir también en pantallas anónimas. Verificado en las tres zonas (pública, cuenta,
  backoffice).
- **Canal de éxito en `useApiAction`**: `successMessage` (texto o función del resultado) y
  `errorMessage` opcional. **Sin esas opciones el comportamiento es exactamente el de
  antes** — quien no las pasa no ve ningún toast. El aviso se emite ANTES de `onSuccess`,
  que suele cerrar un diálogo o navegar.
- **Regla de reparto (FEEDBACK-D2), aplicada y no solo escrita**: al toast van los éxitos
  de acciones puntuales; **se quedan inline** los errores que llevan enganchada una acción
  de recuperación (saldo insuficiente + «Comprar créditos») y el estado persistente. Hay
  una prueba que fija justo eso, para que el toast no se coma lo que no le toca.

### Los tres arreglos que la consumen

**M5 — destacar deja de completarse en silencio.** Las dos vías (cuota Pro y créditos)
confirman diciendo duración y con qué se pagó. Y **el bump migra al mismo canal**: era el
único sitio que ya avisaba, con un `<p>` verde propio; dejarlo inline mientras destacar usa
toast habría conservado la incoherencia de M5 al revés. Su ERROR sigue inline, a propósito.

**M7 — la factura se confirma antes y se anuncia después.** Emitir una `Invoice` es
irreversible por construcción (triggers de BD rechazan UPDATE/DELETE sobre las ISSUED y sus
líneas) y se disparaba con **un clic sin preguntar**, mientras archivar un anuncio sí
preguntaba. Ahora hay `AlertDialog` —mismo molde que archivar— que dice cuántas líneas, qué
total y que no se podrá anular; y un toast al emitir. Además, cuando el botón está
deshabilitado se dice **por qué** (se usa el `reason` que ya servía
`GET /billing/eligibility`), en vez de dejar un botón muerto.

**A7-flujo — quien sale a comprar puede volver a lo que iba a hacer.** UXV.1 arregló que la
página de éxito resolviera; esto arregla a dónde lleva. La intención viaja así:

```
tarjeta/ficha  →  /mis-creditos?volver=/anuncio/<slug>
                        ↓ (PackList la reenvía en el checkout)
                  POST /billing/checkout/credits-pack { returnTo }
                        ↓ (el backend la valida y la cuelga de DS_MERCHANT_URLOK)
                  TPV Redsys
                        ↓
                  /mis-creditos/exito?volver=...   →  botón «Volver a terminar»
```

Tiene que dar ese rodeo por el backend porque **lo único que sobrevive al salto al TPV es
lo que se firma en el formulario**, y `DS_MERCHANT_URLOK` lo construye el servidor. El
destino apunta a la FICHA del anuncio, no al listado: allí `ListingOwnerActions` tiene
Destacar y Bump de ese anuncio a un clic.

**El `returnTo` es superficie de seguridad, no un detalle de UX**, y se trata como tal
([`redsys/return-to.ts`](../apps/api/src/modules/redsys/return-to.ts)): llega del cliente y
acaba dentro de una petición de pago firmada. La validación es una **allowlist de formas
exactas**, no un `startsWith('/')` — que dejaría pasar `//evil.com`, que el navegador trata
como URL absoluta protocol-relative (redirección abierta de manual). Un destino inválido se
descarta en silencio y **nunca tumba el cobro**. 21 pruebas unitarias fijan los rechazos
(protocol-relative, `javascript:`, `data:`, travesía, querystring inyectada, rutas internas
no contempladas…). La página de éxito vuelve a comprobarlo antes de usarlo como `href`: no
debe ser el eslabón que confía por costumbre.

**B4** — comprar un pack ya no sustituye la sección por un spinner: el aviso de redirección
va ENCIMA de los packs, no en su lugar.

**Verificado**: `e2e/feedback.spec.ts` (9 pruebas en navegador real) + `return-to.spec.ts`
(21) + batería completa.

---

## UXV.2 — el SHELL de la zona de cuenta

Segunda tanda de [`diseno-ux-vendedor.md`](diseno-ux-vendedor.md). Ataca la raíz de cinco
hallazgos a la vez porque los cinco salían del MISMO fichero:
[`(account)/layout.tsx`](../apps/web/src/app/(account)/layout.tsx), que eran 34 líneas
—`<div flex><aside w-56><main>`— sin cabecera, sin responsive y sin estado.

### Qué cierra

| # | Antes | Ahora |
|---|---|---|
| **A1** | `<Header/>` se montaba en UN solo sitio de `apps/web`, el layout público. Desde `/mis-anuncios` no había ninguna vía de UI para volver a la portada. | La misma `Header` se monta también en `(account)`: logo, buscador, campana y avatar en las veinte pantallas. |
| **A3** | El `<aside>` no tenía un solo breakpoint: en 375 px se llevaba 224 px y dejaba ~87 px de contenido. | `hidden md:block` + drawer. El `<main>` ocupa el ancho completo en móvil. |
| **M1** | Nueve `<Link>` idénticos, sin `usePathname` ni `aria-current`; sin migas en toda la zona. | Estado activo (criterio de `AdminNav`) + migas derivadas del pathname. |
| **M2** | Estadísticas, Datos de facturación, Mis tickets y Planes no estaban en la navegación de su propia zona. | Trece entradas en cuatro grupos (SHELL-D4). |
| **M3** | Desde `/perfil/suscripcion` → «Ver planes» el shell desaparecía sin camino de vuelta. | `/planes` sigue pública (SHELL-D3) con retorno explícito **solo para quien tiene sesión**. |

### Decisiones aplicadas

- **SHELL-D1 — se REUSA la `Header` pública**, no una cabecera propia. Se pagan sus dos
  fetches (no leídas + avatar) también en cuenta; a cambio el usuario recupera la campana
  y el buscador, que era parte del desconcierto de A1. Un segundo componente de cabecera
  es lo que produjo los tres shells incompatibles. **Sin `Footer`**: la zona es una
  herramienta de trabajo.
- **SHELL-D2 — drawer**, sobre `@radix-ui/react-dialog` (ya instalado, cero dependencias
  nuevas). No se reusa `DialogContent` porque aquel centra un cuadro y esto es un panel
  anclado al borde: mismo primitivo, distinta geometría.
- **SHELL-D3 — `/planes` se queda en `(public)`**, con `VolverACuenta` en su layout (así
  lo heredan también `exito` y `cancelado`, que es donde quedarse varado molesta más).
- **SHELL-D4** — cuatro grupos por TAREA, no por forma de la URL: por eso «Datos de
  facturación», que cuelga de `/perfil`, vive con los pagos.
- **Transversal del nav dinámico: NO se toca.** `MainNav` sigue siendo solo de `(public)`
  — es la decisión #1 de [`diseno-nav-dinamico.md`](diseno-nav-dinamico.md), tomada con
  criterio. `NavPageType` no gana tipos de cuenta; queda documentado como deliberado.

### Fuente única: `config/account-nav.ts`

Las tres superficies —`<aside>` de escritorio, drawer de móvil y migas— salen de la misma
tabla. Es lo que impide que el menú diga una cosa y las migas otra. Las migas se resuelven
**en el shell** a partir del pathname, no en cada página: repartirlas por veinte ficheros
las condenaría a divergir del menú, que es el defecto que esta ráfaga cierra. En las
raíces de sección no se pintan (el menú ya marca dónde estás); aparecen en el tercer nivel,
que es donde el menú no llega.

### Dos cosas que se midieron y no se supusieron

**El desbordamiento horizontal en 375 px era de UNA pantalla, no de la zona.** Sondeadas
las dieciséis rutas: solo `/mis-anuncios` empujaba el documento a 480 px, por la fila
`h1 + [Ver estadísticas] [Publicar anuncio]` sin `flex-wrap`. Es un `flex-wrap`, no lógica.

**La altura de `MensajesShell` NO se pudo desacoplar del shell.** El `h-[calc(100vh-14rem)]`
pasa a `18rem` (los 4rem de la cabecera nueva). Se intentó sustituirlo por `flex-1 min-h-0`
sobre una columna con altura real —que sería inmune a futuros cambios del shell— y **no
funciona**: el contenedor de la zona tiene que crecer con su contenido (si no, «mis
anuncios» con muchas tarjetas se cortaría), así que la altura del panel resulta circular y
se resuelve al tamaño del contenido, desbordando el viewport 47 px. Medido. La constante
sigue cosida al shell; lo que la protege es que `shell-cuenta.spec.ts` falla si el panel
se sale del viewport.

### Efecto colateral asumido: la cabecera en móvil

`Header` se apelotonaba en 375 px (logo y «Buscar» pegados, «Publicar anuncio» partido en
dos líneas). Es un defecto **preexistente de la zona pública**, pero al montar la cabecera
en cuenta pasaba a verse en veinte pantallas más, así que se arregla aquí: `gap`
escalonado, `shrink-0`, `whitespace-nowrap` y rótulo corto («Publicar») por debajo de `sm`.
Ningún destino desaparece.

**Verificado en navegador real** (`e2e/shell-cuenta.spec.ts`, 15 pruebas): logo → portada
desde las dieciséis rutas y navegación real al pulsarlo; en 375 px el `<main>` mide >300 px
y no hay scroll horizontal; el drawer abre, lista las trece entradas, navega y se cierra;
`aria-current` único y en la entrada correcta (una subruta marca SU entrada, no la del
padre); migas en tercer nivel y ausentes en las raíces; el viaje cuenta → planes → cuenta;
el anónimo NO ve el retorno; y las dieciséis rutas responden con shell completo, contenido
propio y cero errores de JS.

---

## El reloj del guard de reapertura de tickets (RESUELTO — era una bomba de relojería)

`tickets-cron.e2e-spec.ts › "dentro de la ventana configurada, la reapertura SIGUE
funcionando"` pasó a rojo **permanente** el 2026-08-08 a las 05:00 UTC. No era flaky
(10 corridas aisladas, 10 rojos) ni un fallo de la ventana configurable.

**Asimetría de reloj.** `TicketsScheduleService.runTicketAutoClose(now)` recibía el
instante inyectado; `TicketsService.assertWithinReopenWindow` leía `Date.now()`. El spec
ancla todo a un `AHORA` fijo (`2026-07-29T05:00Z`) vía `resolvedHaceDias`, así que el
escenario y su juez vivían en instantes distintos: el test estuvo verde **por coincidencia
de calendario** hasta que el reloj real cruzó el deadline anclado a esa fecha. Con
`setVentana(30)` y un ticket de 20 días, el deadline caía en `2026-08-08T05:00Z` — a partir
de ahí, rojo para siempre, con el desfase creciendo un día por día.

La ventana configurable **funcionaba**: el mensaje de error decía «30 días», que es
exactamente lo configurado (el default de código es 14, no 30). Medido: el `Setting` se lee,
gobierna guard y cron, y respeta el valor en los dos sentidos.

**Arreglo de causa, no de números:** `replyAsUser` acepta ahora el mismo `now` que
`runTicketAutoClose`, con default `new Date()`. `assertWithinReopenWindow` lo exige como
parámetro **obligatorio** —sin default cómodo— para que ningún llamador futuro vuelva a
colar el reloj real sin querer; la decisión vive en la puerta pública. Producción no cambia:
`TicketsController` sigue llamando con cuatro argumentos.

**El segundo test también estaba roto, en verde.** «EL MISMO Setting gobierna el guard de
reapertura (T8)» esperaba un rechazo, y la deriva del reloj real se lo daba **sin mirar la
ventana**: habría pasado igual con la ventana ignorada. Verificado con una mutación temporal
(el guard forzado a ignorar el `Setting` y usar el default 14):

| Test | Bajo la mutación | Lectura |
|---|---|---|
| «EL MISMO Setting gobierna…» con reloj compartido | ✕ falla | recuperó la sensibilidad |
| «dentro de la ventana configurada…» | ✕ falla | también mide la ventana |
| su forma VIEJA (reloj real, sin `now`) | ✓ pasa | **era verde en falso**, confirmado |

**Verificado**: 10/10 corridas aisladas en verde, ya sin dependencia del reloj real (no hay
fecha de caducidad futura). Batería API completa 1559/1559.

**Anotado, NO tocado** (fuera del alcance de este arreglo): el comentario de
`tickets-schedule.service.ts` afirma que en el instante exacto del vencimiento el usuario ya
no puede reabrir, pero el guard rechaza con `now > deadline` — en ese tick exacto **sí** deja
reabrir mientras el cron ya cierra (`resolvedAt <= cutoff`, inclusivo). Es una ventana de un
instante y ningún test cubre esa frontera del guard.

---

## Un token de admin para toda la batería Playwright (RESUELTO)

Cierra el defecto que destapó RP.1: la batería agotaba el límite de `/auth/admin-login` a media
corrida y los specs del final del alfabeto recibían `429`.

### El defecto, medido

`ADMIN_LOGIN_RATE_LIMIT_IP_PER_WINDOW = 20` por IP cada 15 min
([`auth.constants.ts:17-18`](../apps/api/src/modules/auth/auth.constants.ts#L17-L18)). Contador
de Redis al terminar una corrida completa:

```
auth:admin-login:ip:::1  =  32      ← contra un tope de 20
```

`globalSetup` hace `FLUSHDB` al empezar, así que no era herencia de corridas previas: **una sola
corrida se pasaba en un 60 %**. Todo lo que se autenticase a partir del intento 20 recibía 429, y
como Playwright ordena los ficheros alfabéticamente siempre castigaba a los mismos. Peor: **cada
spec nueva que se autenticaba desplazaba a otra**, así que el conjunto de rojos bailaba entre
corridas y se leía como inestabilidad ambiental.

Confirmado con una corrida de línea base sobre el árbol intacto: **7 rojos, todos en specs que se
autentican**, y entre 11 y 21 tests que ni llegaban a ejecutarse.

### Por qué la causa era una laguna, no un exceso

`globalSetup` ya resolvía esto **para el navegador**: loguea las 6 cuentas una vez y guarda
`storageState`, que los specs consumen por fixture ([`fixtures/auth.ts`](../apps/web/e2e/fixtures/auth.ts)).
Por eso los specs de admin por UI no gastaban intentos.

Lo que no cubría era el **token bearer de API**: 11 ficheros llamaban cada uno a
`loginAdminViaApi` para hablar con el backend por HTTP. Ahí estaba todo el consumo. No sobraba
mecanismo: faltaba extender el que ya existía.

### La salida elegida — (a), y por qué no las otras dos

**Elegida: un token de admin obtenido UNA vez en `globalSetup`**, escrito en
`e2e/fixtures/admin.token.json` (mismo directorio, mismo ciclo de vida y mismo `.gitignore` que
los `storageState`) y leído por `adminApiToken()` en `helpers/api.ts`. Ataca la causa: los tests
dejan de gastar intentos en vez de pedir más. **No depende del tope** —funcionaría igual con 20
que con 5— y escala: las ráfagas de portada que vienen añadirán specs y ninguna gastará un login.

Descartadas:

- **Subir el tope solo en test.** Impedimento duro:
  [`admin-login.e2e-spec.ts:185-196`](../apps/api/test/admin-login.e2e-spec.ts#L185-L196) **prueba
  que el tope rechaza** iterando `ADMIN_LOGIN_RATE_LIMIT_IP_PER_WINDOW` veces y exigiendo un 429.
  Subir la constante en test no rompe ese test (lee la constante) pero lo convierte en cientos de
  peticiones y deja de probar el valor real de producción. Y no escala: hay que resubir la cifra
  cada vez que crece la batería.
- **Repetir el flush del contador.** Esconde el consumo en vez de reducirlo, y no hay punto de
  enganche natural entre ficheros (los specs hablan por HTTP, no hay hook por spec).

**El rate-limit de producción no se ha tocado.** Sigue en 20 y se sigue probando que rechaza.

### Resultado medido

| | Antes | Después |
|---|---|---|
| `auth:admin-login:ip:::1` tras una corrida completa | **32** (tope 20) | **4** (globalSetup: 1 login de UI + 1 de API; el resto, margen) |
| Fallos por 429 | 7-10 por corrida | **0** (`grep 429` sobre todos los `error-context.md`: cero) |
| Tests que pasan | 258-268 | **284** |
| Tests que no llegaban a correr | 11-21 | **0** |

Quedan 5 rojos, **los mismos que ya fallaban en la línea base** y ninguno por 429: cuatro
etiquetados `@2b` (`busqueda-unificada` ×2, `tags-filtro` ×2) y `nav-publico`, que muere en un
`page.waitForURL` de 30 s — la familia *wedge* del router cliente, no autenticación. Son deuda
aparte, anterior a todo esto.

### Regla para specs nuevas

Para el **setup** de un spec, `adminApiToken()`. Nunca `loginAdminViaApi`, que se mantiene
exportada solo para lo que la justifica: ejercitar el propio endpoint de login (credenciales
distintas, casos de rechazo). El aviso está escrito en su propio docblock.

El login público (`/auth/login`, tope 150/IP/15min) se midió en la misma corrida:
`auth:login:ip:::1 = 32`, un 21 % del presupuesto. No necesita el mismo tratamiento por ahora.

---

## UXV.1 — los dos bugs de la zona de gestión del vendedor (A2 y A7)

Primera tanda de [`diseno-ux-vendedor.md`](diseno-ux-vendedor.md). **No es rediseño**: son
dos defectos, separados a propósito del rediseño de UX que viene después (UXV.2–UXV.6).
Los hallazgos vienen de [`auditoria-ux-vendedor.md`](auditoria-ux-vendedor.md).

### A2 — el cooldown del bump tenía TRES verdades

`BillingService.bump` rechazaba por debajo de **3600 s**; `MyListingCard` deshabilitaba el
botón durante **24 h** (derivando `bumpedAt + 24h` en el cliente); `ListingOwnerActions`
(ficha pública, vista del dueño) **no bloqueaba nada** y dejaba contestar al 429. El botón de
la tarjeta quedaba muerto 23 horas de más —con un tooltip de fecha inventada— y las dos
superficies de propietario se contradecían.

**Fuente única:** `modules/billing/bump-cooldown.ts` — `BUMP_COOLDOWN_SECONDS` (la aplica
`bump()`) y `nextBumpAt(bumpedAt)`, que deriva el instante en que el anuncio vuelve a ser
bumpeable. Ese instante VIAJA ya resuelto y el frontend no recalcula ninguna ventana:

| Payload | Superficie | Frescura |
|---|---|---|
| `GET /users/me/listings` (`findMine`) | tarjeta de `/mis-anuncios` | Postgres, siempre fresco; enriquecido junto a `featuredUntil` |
| `GET /listings/:slug` (`findBySlug`) | ficha pública (`ListingOwnerActions`) | derivado FUERA del blob cacheado (como `featuredUntil`), así que los payloads guardados antes del despliegue también lo llevan |

En el front, `lib/bump-cooldown.ts` (`resolveBumpCooldown` + `bumpCooldownTitle`) es el único
lector: las dos superficies pasan por él, así que no pueden volver a contar cosas distintas.
Una fecha ilegible **no** bloquea el botón (nunca dejar al usuario sin poder bumpear).

**Efecto lateral necesario:** `bump()` ahora **invalida la ficha cacheada**
(`listing:${slug}`, TTL 5 min), que hasta hoy solo invalidaban `update`/`delete`. Sin eso, el
blob viviría 5 minutos con un `bumpedAt` viejo y la ficha diría "puedes bumpear" mientras la
tarjeta dice lo contrario — la discrepancia entre superficies que A2 cierra. El formato de la
clave se movió a `infra/redis/cache-keys.ts` porque ahora la escribe `ListingsService` y la
borra `BillingService`, y ninguno puede importar del otro sin invertir la dirección
`ListingsModule → BillingModule`.

**Lo que NO entra:** unificar el **coste** mostrado entre las dos superficies (la tarjeta dice
«Bump N cr.» con cuota/saldo/descuento; la ficha, «Subir al inicio (bump)» sin coste). Exige
`catalog` + `wallet` + `pro-status` en una página SSR/ISR pública y duplicar la lógica de las
tres monedas — es el componente compartido de acciones de propietario de **UXV.4**, no un
arreglo de bug.

**Verificado**: `test/uxv1-bump-cooldown.e2e-spec.ts` (la ventana es la real y no 24 h; las
dos superficies devuelven el MISMO `nextBumpAt`; el campo y el guard nunca discrepan —futuro
⇒ 429, pasado ⇒ 200—; tras bumpear la ficha refleja el cooldown nuevo de inmediato) +
`components/anuncios/bump-cooldown-surfaces.test.tsx` (los dos componentes reales, mismo
estado ante la misma entrada).

### A7 — la página de éxito de compra nunca resolvía

`/mis-creditos/exito` dejaba un `Loader2` girando **para siempre**: sin estado terminal, el
usuario tenía que pulsar «Actualizar saldo» a mano y comparar cifras. Se replica el molde de
`(public)/planes/exito` (detectar la condición terminal → ✔ → salidas), añadiendo el sondeo
que planes/exito promete en su copy pero no hace.

- **Condición terminal**: existe un apunte `PACK_PURCHASE` —de créditos o de bumps— con
  `createdAt` dentro de los últimos 15 min. No sirve comparar contra el saldo de la primera
  lectura: el redirect del TPV y el webhook llegan casi a la vez y en orden no garantizado, así
  que si el webhook fue rápido nunca veríamos "subir" nada. *Limitación conocida:* dos compras
  del mismo usuario en menos de 15 min hacen que la segunda resuelva con el apunte de la
  primera — ✔ prematuro, nunca un dato falso (los saldos mostrados son reales).
- **Sondeo acotado**: cada 3 s, hasta 60 s. Al agotarse hay un estado terminal de espera (deja
  de girar, explica que el pago sigue en curso y ofrece comprobar a mano), no un spinner eterno.
- **Salidas**: botones «Ver mi saldo» / «Ir a mis anuncios», no un enlace de texto suelto.

**Alcance**: solo el arreglo mecánico. A dónde debe volver quien llegó aquí desde un bump o un
destacado bloqueado por falta de saldo es **flujo**, y se diseña en UXV.3.

**Verificado**: `e2e/mis-creditos.spec.ts` — las dos pruebas de esta página fijaban el
comportamiento roto (botón manual + enlace de texto) y ahora fijan el arreglo: resuelve a
confirmado sin pulsar nada, y mientras el webhook no llega vuelve a preguntar por su cuenta sin
afirmar un éxito que no ha ocurrido.

---

## `fix-planes` — la línea de «anuncios activos» de /planes DERIVA de los dos límites

Remate posterior a UXV.6, sobre la lista de beneficios Pro que aquella ráfaga había hecho
derivar de los `Setting`.

**El defecto no era que mintiera: era que nada impedía que empezara a mentir.** UXV.6 derivó el
NÚMERO de la línea («Hasta N anuncios activos») pero seguía **listándola siempre**. Con la
configuración sembrada (gratuito 5, Pro 20) la frase es cierta, así que el fallo no se veía;
pero `freeActiveListingLimit` y `proActiveListingLimit` se editan desde `/admin/ajustes` y
pueden cruzarse. El día que el límite gratuito supere al Pro, la página de precios vendería
como ventaja algo que el plan gratuito da mejor, **sin que nadie hubiera tocado el código**.

**El arreglo** ([billing.service.ts](../apps/api/src/modules/billing/billing.service.ts),
`buildProBenefits`): la línea se emite solo si `pro > libres`, y entonces con los dos números
(«Hasta 20 anuncios activos (en el plan gratuito, 5)»). Es el mismo criterio que ya usaban las
cuotas de destacados y bumps —`if (destacados > 0)`, `if (bumps > 0)`—: lo que el ajuste no
concede, no se promete. **Los valores no se tocaron**, son decisión de negocio.

En [`planes/page.tsx`](../apps/web/src/app/(public)/planes/page.tsx) se retiró además «Más
anuncios activos» del respaldo estático: ese texto solo entra cuando la API no responde, y
entonces no se conoce el valor de ninguno de los dos límites.

**Verificado por mutación** (`test/planes-limite-anuncios.e2e-spec.ts`, 6 casos): con Pro=200 y
gratuito=5 la línea aparece con ambos números; con 100/20 se omite; con los dos iguales también;
y 30→31 demuestra que el número **sigue al ajuste** en vez de ser un texto que casualmente
encaje. Los `Setting` se restauran al terminar.

**Lo que este arreglo NO hace, a propósito:** avisar al admin de que su configuración es
incoherente. Está anotado en `pendientes.md`.

---

## Bump automático — programar bumps que se aplican solos

Proyecto completo en cuatro ráfagas, cada una verificable sola. La superficie de entrada la
había dejado preparada UXV.4 (el menú `▾` de `PromocionarControl`) y el hueco de estado, UXV.5.

### CAPA 1 — el reclamo atómico del cooldown (arreglo de BASE del bump manual)

Fue **la primera ráfaga y fue sola**, porque es deuda preexistente del bump manual y se valida
con los tests que ya existían.

**El defecto**, anotado en el propio código desde UXV.1: `BillingService.bump` comprobaba el
cooldown **leyendo `bumpedAt` fuera de la transacción**, y el `UPDATE` que lo marcaba era la
**última** sentencia de las tres ramas de cobro. Se cobraba primero y se marcaba después, así
que dos ejecuciones concurrentes podían leer ambas «no está en cooldown» antes de que ninguna
confirmara su escritura, y **cobrar las dos**. Con clics humanos hace falta una simultaneidad
casi imposible; con un scheduler en N instancias es el caso normal.

**El arreglo**: se invierte el orden. Un `UPDATE` condicional escribe `bumpedAt` **solo si la
ventana venció** y devuelve cuántas filas tocó — una fila, el turno es nuestro y se cobra; cero
filas, `429`. Va **dentro de la misma transacción** que el cobro: si el cobro falla, el reclamo
revierte con él, así que nunca queda un `bumpedAt` marcado sin cobro ni un cobro sin marcar.

**No es un patrón nuevo**: es el idioma con el que ese servicio ya mueve dinero
(`UPDATE "Wallet" SET balance = balance - N WHERE balance >= N` + «si afectó 0 filas, error»).
Correcto bajo `READ COMMITTED` —el nivel por defecto; el repo no fija `isolationLevel` en
ninguna `$transaction`— porque un `UPDATE` sobre una fila que otra transacción está modificando
espera a que confirme y **reevalúa su `WHERE` contra la versión nueva**. No queda ventana entre
comprobar y escribir porque son la misma sentencia.

`bumpedAt` salió también del `select` previo, y su ausencia es la señal: si alguien vuelve a
leerlo ahí para adelantar el rechazo, habrá dos verdades sobre la ventana otra vez.

**El contrato no cambió**, y esa es la prueba de que el arreglo es interno: los 6 casos de
`uxv1-bump-cooldown.e2e-spec.ts` pasan **sin tocarlos**. `capa1-bump-reclamo-atomico.e2e-spec.ts`
(8 casos) prueba lo nuevo, y está escrito para fallar contra el código anterior: verificado
revirtiendo el servicio — **4 rojos, los cuatro de concurrencia; 4 verdes, los secuenciales**.

### El modelo — `BumpSchedule` + `BumpRun`

Dos tablas (migraciones `add_bump_schedule` y `bump_run_outcome_nullable`).

**`BumpSchedule`** — la intención: `listingId` + `userId` (ambos `Cascade`), `intervalDays`,
`hourOfDay`, `status`, `nextRunAt`, `lastRunAt`. `@@unique([listingId])` porque dos
programaciones sobre el mismo anuncio competirían por el mismo cooldown y una no haría nada
nunca; `@@index([status, nextRunAt])` es *la* consulta del cron. `status` es enum y no un
`paused: boolean` porque **la razón determina la salida**: «recarga créditos» y «reactiva tu
anuncio» son mensajes distintos, y la reanudación automática de D9 solo puede existir si consta
que la pausa fue por esa causa.

**`BumpRun`** — un turno, se haya cobrado o no. `@@unique([scheduleId, slot])` es el guard de
idempotencia, molde de `Invoice.idempotencyKey`: **el guard que no se puede esquivar vive en la
base, no en el código**.

**La definición de `slot`, de la que depende todo**: es el valor que `nextRunAt` **tenía cuando
el turno se reclamó**, copiado tal cual — ni recalculado, ni truncado, ni derivado de `now()`.
Así dos instancias leen la misma fila, computan la misma `slot` y colisionan. Vive en el
comentario de la columna, para que no pueda separarse de lo que la base guarda. **Verificado por
mutación**: al hacerla no determinista fallan exactamente los dos tests que dependen de ella.

`outcome` es **nullable** (`NULL` = reclamado sin desenlace) porque el orden «reclamar antes de
cobrar» exige que la fila exista antes de conocer el resultado. Un `NULL` que sobrevive significa
que el proceso murió a mitad: el turno se perdió, pero nunca se cobró dos veces.

**`BumpRun` NO es el libro mayor**: es un registro paralelo que apunta al mismo hecho. Cierra de
paso el hueco de que ni `BumpLedgerType` ni `CreditLedger.referenceType` distinguen un bump
automático de uno manual, y lo hace **sin tocar el ledger**: el invariante
`wallet.bumpBalance == SUM(BumpLedger.amount)` queda intacto (hay test que escribe tres turnos y
comprueba que el monedero no se mueve).

### El scheduler

`BumpScheduleService`, molde `InvoicingScheduleService`: el `@Cron` es fino y delega en
`runDueSchedules(now)`, **que recibe la fecha**. Es la lección del cron de tickets, y aquí no es
opcional: los casos que hay que poder verificar —el turno en la frontera, dos instancias en el
mismo segundo, la pasada que llega tarde— son exactamente los que no se pueden provocar
esperando al reloj.

**Minuto 10, no 0**: los cuatro `@Cron` que ya existían corren todos en minuto 0 (02:00–05:00), y
un cron horario en minuto 0 se solaparía con ellos cuatro veces al día sin necesidad.

**El orden de una pasada, que es donde vive la garantía**: seleccionar (`status = ACTIVE AND
nextRunAt <= now`) → **tomar la slot** → **reclamar** creando el `BumpRun` (`P2002` = otro se lo
quedó, se aborta sin ruido) → **encolar** con `jobId` estable `bump-auto-{scheduleId}-{slot}`.
Reclamar antes de cobrar es lo que hace que quien no consigue insertar la fila no llegue a cobrar
nunca.

**Tope de 500 turnos por pasada**, con `truncated` en el resultado y en el log: no es un recorte
silencioso, y lo que sobra sale en la pasada siguiente porque la selección es por estado.

**Cola propia** (`QUEUE_BUMP_AUTO`, vía `retryQueue`) y no `QUEUE_BILLING`, para que un pico de
turnos programados no retrase los cobros de checkout, que sí tienen a alguien esperando.

`BumpAutoProcessor.runTurn(data, now)` también recibe el reloj, por la misma razón: el avance de
`nextRunAt` se ancla **al turno previsto y no a `now`**, que es la propiedad anti-deriva —si una
pasada llega tarde, «cada 3 días a las 9:00» sigue siendo a las 9:00— y lo que hace el cálculo
determinista entre instancias. `computeNextRunAt` es una función pura con 13 casos, **incluidos
los dos cambios de hora**, y no acumula turnos atrasados: tras cuatro días caído devuelve el
primer turno **futuro**, no cuatro cobros encadenados.

**Por qué no puede cobrar dos veces**, con tres guardas independientes: la clave única del turno
(base de datos), el `jobId` estable (cola) y el reclamo atómico del cooldown de la CAPA 1
(transacción). La tercera es la que convierte la garantía en propiedad del sistema: aunque las
dos primeras fallaran, un segundo cobro dentro de la hora es imposible.

### Las políticas (decisiones confirmadas)

Once decisiones de producto se confirmaron en bloque; las que dejan huella en el código:

| # | Decisión | Cómo se materializa |
|---|---|---|
| **D1** | Cada N días (1–30) + hora del día; mínimo **1 día** para lo automático | `intervalDays` + `hourOfDay`. El cooldown permite 24 bumps diarios (~120 créditos/día): el cooldown protege la plataforma, este mínimo al usuario |
| **D2** | Sin saldo → **pausar y avisar**; reanudación **manual** | `PAUSED_NO_FUNDS` + aviso. Manual a propósito: los créditos son bolsa común y recargarlos para otra cosa no debe reactivar un gasto que nadie ha vuelto a pedir |
| **D3** | Para todos con saldo · **una** por anuncio · tope por usuario configurable | `@@unique([listingId])` → 409; `maxBumpSchedulesPerUser` |
| **D4** | Hora **peninsular declarada**, sin zona por usuario | `timeZone: 'Europe/Madrid'` explícito en el `@Cron`; la UI dice «sobre las HH:00, hora peninsular» porque la pasada es horaria |
| **D5** | Colisión con el bump manual → **saltar el turno** | `429` → `SKIPPED_COOLDOWN`, sin cobro y sin aviso; el calendario NO se recalcula desde el bump manual |
| **D6** | **Solo incidencias** notifican (in-app + email) | Un bump aplicado no avisa; la trazabilidad vive en `BumpRun`, visible en `/mis-creditos` |
| **D7** | Flag de admin; apagarlo **no toca** las programaciones | `bumpAutoEnabled`, sembrado a `true` |
| **D9** | Anuncio no `ACTIVE` → pausar y avisar, **reanudar solo** al volver | `PAUSED_LISTING_INACTIVE`. Asimetría deliberada con D2: reactivar *ese* anuncio apunta al mismo objeto que la programación |
| **D10** | **Precio vigente**, no congelado | Congelarlo crearía una segunda verdad del precio y dejaría al usuario fuera de las rebajas de campaña. `BumpRun.cost` deja constancia de lo cobrado |
| **D11** | **Mismo orden de cobro** que el manual | La cuota Pro se pierde si no se usa; reservarla haría que caduque mientras el usuario paga créditos por lo mismo |

### La UI

**Configurar (D8)**: «Programar bumps» es un tercer producto de `PromocionarDialog`, donde UXV.4
escribió que entraría. El menú `▾` gana su entrada como **atajo, no como puerta**: solo se pinta
cuando el bump sale gratis, y quien paga —el que más querría programar— llega por el botón único
«Promocionar», que abre el mismo diálogo. El hallazgo de la auditoría no era que faltara una
entrada, era depender del `▾` como entrada única.

**Ver**: `PromotionStatus` ocupa el hueco que UXV.4 dejó comentado. Una pausa **se ve y dice por
qué**, con su salida cuando la hay: sin saldo → «Recargar»; anuncio inactivo → lo dice y **no**
ofrece recargar, porque no arreglaría nada. Es el defecto que UXV.6/M12 cerró con la cuota Pro.

**Gestionar**: «Bumps programados» en `/mis-creditos`, junto al saldo —donde el usuario viene
cuando la pregunta es de dinero— y **sin añadir una decimocuarta entrada** al menú que UXV.2
costó reducir a trece. Pausar, reanudar, cancelar con confirmación, e historial de turnos que
incluye **los que no cobraron**: uno que solo enseñara los cobros no explicaría los huecos.

**La programación viaja solo en el payload de propietario**, nunca en la ficha pública: es asunto
del vendedor, y la ficha se sirve de un blob cacheado donde ese estado envejecería. Hay test que
lo fija en ambas direcciones.

---

## Vídeo Pro — vídeo propio en el anuncio, como ventaja del plan Pro

Proyecto completo en tres ráfagas. **Decisión estructurante: fichero propio, no embed.** El
bloque `video` del CMS (`VideoBlockRenderer`, YouTube/Vimeo) es contenido editorial del
administrador y no sirve de molde de datos: exigiría al vendedor tener cuenta en un tercero.

### La infraestructura — los bytes NUNCA pasan por la API

El camino de imágenes usa `memoryStorage()`: el fichero entero vive en la RAM del proceso.
Inocuo con 10 MB; inaceptable con decenas de megas y varios vendedores a la vez.

**Subida directa navegador→R2 con URL prefirmada.** `R2Service.presignUpload` (dependencia nueva
`@aws-sdk/s3-request-presigner`; hubo que alinear `@aws-sdk/client-s3` a la misma línea porque
pnpm traía dos versiones de `@smithy/types` y `tsc` no compilaba). En dos tiempos:

1. **Firmar** — `POST /video/upload-url` comprueba flag, Pro, propiedad y estado del anuncio, y los límites; solo entonces emite el permiso.
2. **Confirmar** — `POST /video/listings/:id/confirm` hace `HEAD` contra el almacenamiento para distinguir «dijo que subió» de «subió», y solo entonces enlaza.

Entre ambos no hay estado guardado: **una subida abandonada deja un objeto huérfano que no se
muestra en ninguna parte** porque nadie lo referencia (ver `pendientes.md` §4.2).

**El tamaño es una garantía, no una comprobación**: viaja dentro de la firma (`ContentLength`),
así que un `PUT` con un cuerpo de otro tamaño lo rechaza el **almacenamiento**. Hay test que
declara 1 KB, intenta colar 1 MB por la misma URL y comprueba que no aterriza nada.

**Límites** en `video-limits.ts`, constante propia: **≤60 s, ≤50 MB, solo `video/mp4`**.
`MAX_FILE_SIZE` de las fotos sigue en 10 MB — subirlo en bloque las habría dejado sin techo. Solo
MP4 no es capricho: **es lo que hace innecesaria la transcodificación**, porque un móvil actual
graba exactamente en ese formato y todos los navegadores lo reproducen. **No hay `ffmpeg` en el
proyecto**, y es deliberado.

**El póster lo captura el cliente** (`<canvas>` sobre un frame) y se sube por el camino de
imágenes. Coherente con lo anterior: si no se trae ffmpeg para transcodificar, no tiene sentido
traerlo para un frame. Es manipulable —la misma capacidad que ya tiene para subir una foto
engañosa— y si falla, la ficha cae a la foto de portada.

**Endurecimiento de `isOwnStorageUrl`**: comparaba con `startsWith` **sin frontera**, así que con
`S3_PUBLIC_URL = https://cdn.ejemplo.com` habría aceptado `https://cdn.ejemplo.com.atacante.net`.
Nunca se explotó porque las URLs las produce siempre `getPublicUrl`, pero eso es casualidad del
flujo y no garantía de la comprobación. Se cerró **al añadir el vídeo** porque un `<video src>`
**no pasa por `remotePatterns`** de `next/image`, a diferencia de las imágenes: esta función pasa
a ser su única restricción de origen. Verificado por mutación (9 casos en `safe-url.spec.ts`).

### La edición

La sección **Vídeo** entra en `EditarForm` por el seam que UXV.5 dejó escrito —`proStatus` se
cableó hasta ahí antes de que hiciera falta, precisamente para esto—.

**Gate y flag son cosas distintas y deciden en sitios distintos.** El **gate Pro se ve**, dentro
de la sección: candado y «Hazte Pro» a `/planes`, porque esconderlo dejaría invisible el
beneficio a quien hay que convencer. El **flag** decide en `resolveEditSections`: apagado, la
sección no existe para nadie; y **sin configuración (la API no respondió) tampoco** — se falla
hacia «no existe», porque ofrecer una subida que luego no se podría completar sería peor.

**La coreografía**: leer la duración real en el navegador → capturar el póster → firmar → `PUT`
directo → confirmar. El anuncio queda marcado con vídeo en el último paso, **después** de una
subida completa. `XMLHttpRequest` y no `fetch` para el `PUT`, porque `fetch` no informa del
progreso de subida y en decenas de megas desde el móvil una barra que no se mueve es
indistinguible de una aplicación colgada.

El vídeo **no forma parte de `data` del formulario**: se guarda por su propio flujo, no con
«Guardar cambios». Mezclarlo haría que el aviso de cambios sin guardar mintiera.

### La visualización — cero bytes de vídeo en las listas

**El riesgo central de la auditoría era reproducir vídeo en listas**, y se evita por
construcción, no por disciplina:

- **Backend**: `toSummary` desestructura `videoUrl` **fuera** del resto para que no pueda colarse, y solo emite `hasVideo`. El documento de Meilisearch —de donde salen las tarjetas de búsqueda— lleva el booleano, nunca la dirección. Hay un test que hace un **barrido del JSON completo** del payload de lista buscando `listing-videos/`.
- **Frontend**: `CardPhotoCarousel` recibe **un booleano**, no una URL. Un test comprueba que en una tarjeta **no se monta ningún `<video>` ni `<source>`**: sin elemento no hay `preload`, ni metadatos, ni petición. El indicador es un SVG del bundle con `pointer-events-none`.

Un solo componente gobierna las once listas; `ListingGallery`, la ficha.

**La ficha no pide el `.mp4` hasta que se pulsa play**: el reproductor entra como una miniatura
más de la galería —**después** de la portada, que es la que el vendedor eligió y la que se ve en
las listas— con `preload="none"`, `poster` y sin `autoplay`. El coste de que un anuncio tenga
vídeo es **una imagen más** hasta que alguien decide verlo. La ficha es la página de SEO y
conversión y la mayoría solo mira fotos.

**Al cambiar el vídeo se invalida la ficha cacheada Y se reindexa** (`refrescarSuperficies`).
Solo lo primero habría dejado el icono de búsqueda viejo hasta que el anuncio se tocara por
cualquier otro motivo.

**`videoEnabled` está APAGADO sin fila**, al revés que `bumpAutoEnabled`: el vídeo cuesta
almacenamiento y ancho de banda desde el primer fichero, así que encenderlo debe ser un acto
explícito. Solo se siembra en `seed-test.ts`, para que las baterías puedan ejercitarlo.

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
