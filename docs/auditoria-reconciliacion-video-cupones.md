# Auditoría de reconciliación — VÍDEO PRO y CUPONES/CRÉDITOS DE BUMP Y DESTACADO

> Fecha: 2026-09-18 · Rama: `main` · Commit medido: `fa632b5`
>
> **Qué es este documento.** Una MEDICIÓN del estado real, hoy, de dos beneficios Pro:
> (1) el vídeo en anuncios y (2) los créditos/cupones mensuales de bump y destacado.
> **Cero cambios de código.** Todo se ha verificado leyendo el código de `fa632b5`, fichero
> a fichero. Las auditorías y diseños previos (`c69bc08` y anteriores) se han usado **solo**
> como referencia de qué se diseñó; **ninguna de sus conclusiones se ha copiado** — cada
> afirmación se ha vuelto a medir.
>
> **El veredicto en una línea:** casi todo lo que los docs viejos daban por inexistente
> **está construido y cableado**. Lo que queda abierto no es infraestructura: son tres
> decisiones de producto y un puñado de huecos de borde.

---

## 0. La distinción que no se puede confundir

Hay **dos vídeos** en el producto, de especies distintas, y uno solo es el de esta auditoría:

| | Bloque `video` del CMS | Bloque `videoUpload` del CMS | **Vídeo de anuncio Pro** |
|---|---|---|---|
| Qué guarda | `{provider, videoId}` | fichero propio en R2 | **fichero propio en R2** |
| Dónde vive | portada / blog | portada / blog | **el anuncio (`Listing`)** |
| Código | [VideoBlockRenderer.tsx](../apps/web/src/components/blocks/VideoBlockRenderer.tsx) | [block-media/](../apps/api/src/modules/block-media/) + [VideoUploadField.tsx](../apps/web/src/components/media/VideoUploadField.tsx) | [video/](../apps/api/src/modules/video/) + [StepVideo.tsx](../apps/web/src/components/publicar/steps/StepVideo.tsx) |
| ¿Es el de esta auditoría? | **No** | **No** | **Sí** |

**Novedad respecto al doc viejo:** ya no son dos especies, son **tres**. Desde `c69bc08` nació
un tercer camino —`block-media`, subida de fichero propio para bloques de CMS— que el doc viejo
no podía conocer. Comparte la coreografía (presign → PUT → confirm) con el vídeo de anuncio
pero **no comparte ni el servicio, ni el gate, ni el prefijo de claves**. Confundirlos al leer
el código es fácil: `VideoUploadField.tsx` **no** es el editor de vídeo del anuncio.

---

# PARTE 1 — VÍDEO EN ANUNCIOS PRO

## 1.1 Tabla de estado por capa

| Capa | Estado | Evidencia |
|---|---|---|
| **Modelo de datos** | **IMPLEMENTADO** | [schema.prisma:958-993](../apps/api/prisma/schema.prisma#L958-L993) — 5 columnas en `Listing`: `videoUrl`, `videoPosterUrl`, `videoPreviewUrl`, `videoDurationSeconds`, `videoUploadedAt`. Sin tabla aparte (decisión: un vídeo por anuncio). `hasVideo` **no es columna**: se deriva de `videoUrl != null` |
| **Almacenamiento (R2)** | **IMPLEMENTADO** | Prefijos propios `listing-videos/` y `listing-previews/`, con `tmp/` arriba para la regla de caducidad ([video-limits.ts:50,71](../apps/api/src/modules/video/video-limits.ts#L50)). Subida directa navegador→R2 por URL prefirmada: los bytes **no pasan por la API** |
| **Endpoints de subida** | **IMPLEMENTADO** | [video.controller.ts](../apps/api/src/modules/video/video.controller.ts) — `GET /video/config`, `POST /video/upload-url`, `POST /video/preview-url`, `POST /video/listings/:id/confirm`, `DELETE /video/listings/:id` |
| **Gate Pro (servidor)** | **IMPLEMENTADO** | [video.service.ts:416-423](../apps/api/src/modules/video/video.service.ts#L416-L423) `assertPro` → `EntitlementService.isProActive` → `ProStatusService.isProActive`. **Pagando y manual pasan igual** (ver §1.3) |
| **Interruptor de admin** | **IMPLEMENTADO** | Setting `videoEnabled`, **apagado sin fila** ([video.service.ts:393-399](../apps/api/src/modules/video/video.service.ts#L393-L399)); editable en backoffice ([admin.service.ts:251](../apps/api/src/modules/admin/admin.service.ts#L251), [ajustes-organizacion.ts:42](../apps/web/src/app/(admin)/admin/ajustes/ajustes-organizacion.ts#L42)) |
| **SUBIR — editor de anuncio** | **IMPLEMENTADO** | [StepVideo.tsx](../apps/web/src/components/publicar/steps/StepVideo.tsx), montado en [EditarForm.tsx:382-390](../apps/web/src/components/publicar/EditarForm.tsx#L382-L390). Ciclo completo: validar → leer duración → capturar póster y sprite → firmar → PUT con barra de progreso → confirmar. Con **sustituir** y **quitar** |
| **SUBIR — asistente de publicar** | **NO EXISTE, Y ES DELIBERADO** | [AvisoVideo.tsx](../apps/web/src/components/publicar/AvisoVideo.tsx) montado en [PublicarWizard.tsx:420](../apps/web/src/components/publicar/PublicarWizard.tsx#L420). El anuncio no existe aún cuando se publica, y `StepVideo` necesita un `listingId`; en su lugar se **avisa** (dos mensajes: Pro / no-Pro) |
| **Póster (frame de portada)** | **IMPLEMENTADO** | Capturado **en el cliente** (`captureVideoPoster`, [lib/media/upload.ts](../apps/web/src/lib/media/upload.ts)). Opcional de verdad: si falla, el vídeo se guarda igual y la ficha cae a la foto de portada |
| **Transcodificación / ffmpeg** | **NO EXISTE, Y ES LA DECISIÓN** | No hay ffmpeg en `apps/api/package.json` (solo `sharp@0.35.2`); las únicas apariciones de la palabra en el repo son comentarios que explican por qué no está. Se evita restringiendo a **MP4/H.264 únicamente** ([video-limits.ts:41](../apps/api/src/modules/video/video-limits.ts#L41)) |
| **VER EN LISTAS — indicador** | **IMPLEMENTADO** | [VideoIndicator.tsx](../apps/web/src/components/anuncios/VideoIndicator.tsx), pintado desde [CardPhotoCarousel.tsx:155](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx#L155), [MyListingCard.tsx:108](../apps/web/src/components/anuncios/MyListingCard.tsx#L108) y las dos tarjetas del mapa ([MapCards.tsx:114,172](../apps/web/src/components/busqueda/MapCards.tsx#L114)) |
| **VER EN LISTAS — previsualización** | **IMPLEMENTADO** (sprite animado al hover) | [VideoHoverPreview.tsx](../apps/web/src/components/anuncios/VideoHoverPreview.tsx) + `CardPhotoCarousel` monta la capa **solo al entrar el ratón** (`onPointerEnter` con `pointerType === 'mouse'`). El sprite son 5 fotogramas en **una imagen fija** de 20-45 KB; la animación la pone el CSS (`steps(5)` en `globals.css`) |
| **VER EN LISTAS — reproducir en el carrusel** | **NO EXISTE, Y ES LA GARANTÍA CENTRAL** | `CardPhotoCarousel` recibe `hasVideo: boolean`, **nunca la URL** ([CardPhotoCarousel.tsx:18-26](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx#L18-L26)). Sin dirección no hay `<video>` posible. El documento de Meilisearch tampoco lleva `videoUrl` ([search.service.ts:807](../apps/api/src/modules/search/search.service.ts#L807)). Hay e2e que lo fija (`video-visualizacion.e2e-spec.ts`) |
| **VER EN FICHA** | **IMPLEMENTADO** | [ListingGallery.tsx](../apps/web/src/components/anuncios/ListingGallery.tsx) — el vídeo es una miniatura más de la tira (`selected === -1`), después de la portada; reproduce con [VideoPlayer](../apps/web/src/components/media/VideoPlayer.tsx), `preload="none"`, póster propio o primera foto. Cableado en [anuncio/[slug]/page.tsx:187-188](../apps/web/src/app/(public)/anuncio/[slug]/page.tsx#L187-L188) |
| **Filtro «solo con vídeo»** | **IMPLEMENTADO** | `hasVideo` es filtrable en Meilisearch ([search.service.ts:195,662](../apps/api/src/modules/search/search.service.ts#L195)); expuesto en `/busqueda` (`conVideo`) y en el backoffice ([FiltrosAnuncios.tsx:263](../apps/web/src/app/(admin)/admin/anuncios/_components/FiltrosAnuncios.tsx#L263)) |
| **Ciclo de vida / limpieza** | **IMPLEMENTADO** | `borrarLoQueSeVa` borra los **tres** objetos (mp4 + póster + sprite) al sustituir y al quitar ([video.service.ts:533-541](../apps/api/src/modules/video/video.service.ts#L533-L541)); huérfanas por `tmp/` + regla de ciclo de vida; `media-keys.ts` conoce las tres referencias |
| **Invalidación de superficies** | **IMPLEMENTADO** | `refrescarSuperficies`: borra la caché Redis de la ficha y **encola reindexado** para que `hasVideo` llegue a las tarjetas ([video.service.ts:574-577](../apps/api/src/modules/video/video.service.ts#L574-L577)) |

## 1.2 Lo que falta para que el vídeo Pro esté «completo»

Casi nada es infraestructura. Ordenado por lo que un Pro notaría:

1. **La previsualización no existe en móvil.** El sprite se anima bajo `@media (hover: hover)`,
   así que en táctil una tarjeta con vídeo enseña portada + icono y nada más. Es coherente
   (no bajar bytes que nadie va a animar), pero significa que **en el dispositivo mayoritario
   el vídeo casi no se anuncia en listas**. Decisión pendiente, no defecto.
2. **Los vídeos anteriores al sprite no tienen previsualización y no se pueden regenerar**
   sin decodificar (o sea, sin ffmpeg). `videoPreviewUrl = null` es un estado normal y está
   bien pintado, pero hoy es el caso **mayoritario** del histórico.
3. **La duración es un límite de cortesía.** Se valida la duración *declarada* por el cliente;
   el tamaño (50 MB) sí es infranqueable porque viaja en la firma. Frontera conocida,
   documentada y aceptada ([video-limits.ts:14-31](../apps/api/src/modules/video/video-limits.ts#L14-L31)).
4. **No se puede añadir vídeo al publicar**, solo al editar un anuncio ya activo. Está
   explicado al usuario, pero sigue siendo un paso extra en el momento de mayor intención.
5. **Solo anuncios `ACTIVE`.** Un anuncio en `PENDING_REVIEW` o pausado no admite vídeo
   ([video.service.ts:446-452](../apps/api/src/modules/video/video.service.ts#L446-L452)); quitar sí se puede siempre.
6. **Si `videoEnabled` está apagado, la sección no existe para nadie** — conviene confirmar
   que la fila está puesta a `true` en producción, o el beneficio es invisible aunque esté
   todo construido.

## 1.3 Pro pagando vs. Pro manual (vídeo)

| | Pro pagando | Pro manual (concedido desde admin) |
|---|---|---|
| ¿Puede subir vídeo? | **Sí** | **Sí** — `isProActive` mira `Entitlement PRO_SUBSCRIPTION` vigente, sin exigir `subscriptionId` ([pro-status.service.ts:70-76](../apps/api/src/modules/listing-gate/pro-status.service.ts#L70-L76)) |
| ¿Ve la sección en el editor? | Sí | Sí (`proStatus` viaja a `EditarForm`) |

**Paridad total en vídeo.** Es el único de los dos beneficios auditados donde pagando y manual
reciben exactamente lo mismo.

---

# PARTE 2 — CUPONES / CRÉDITOS DE BUMP Y DESTACADO

## 2.0 La confusión de vocabulario que hay que deshacer primero

El encargo habla de «cupones mensuales». En el código de hoy eso **no existe con ese nombre**,
y no porque falte: porque son **dos mecanismos distintos** que el vocabulario funde en uno.

| | **Cuota mensual Pro** | **Cupón (`Coupon`)** |
|---|---|---|
| Qué es | Derecho mensual a N bumps y M destacados gratis | Código canjeable (`SAVE10`) |
| Cómo se obtiene | Automático por tener suscripción Pro vigente | El usuario teclea el código en `/mis-creditos` |
| Cómo se cuenta | **Derivado**: un `COUNT` desde `Subscription.currentPeriodStart` — no hay contador ni cron de reseteo | Acredita saldo real (`Wallet.balance` / `Wallet.bumpBalance`) |
| ¿Se renueva? | Sí, sola, cuando avanza `currentPeriodStart` | No se renueva; es de un solo uso por usuario |
| ¿Se acumula? | **No** — lo no usado se pierde al cambiar de periodo | **Sí** — el saldo no caduca |
| Modelo | `Entitlement{origin: PRO_QUOTA}` (destacados) · `BumpLedger{type: PRO_QUOTA, amount: 0}` (bumps) | `Coupon` + `CouponRedemption` + `CreditLedger`/`BumpLedger` |

**Lo que el encargo llama «cupones mensuales de bump/destacado» es la CUOTA MENSUAL PRO, y
está implementada.** Los `Coupon` son otra cosa que también existe, y también está implementada.

## 2.1 Tabla de estado por capa

| Capa | Estado | Evidencia |
|---|---|---|
| **Modelo — monedas** | **IMPLEMENTADO** | `Wallet.balance` (créditos) + `Wallet.bumpBalance` (bumps, moneda separada e intransferible) — [schema.prisma:2413-2444](../apps/api/prisma/schema.prisma#L2413-L2444). Invariante `bumpBalance == SUM(BumpLedger.amount)` |
| **Modelo — libros mayores** | **IMPLEMENTADO** | `CreditLedger` + `BumpLedger`, inmutables, con `referenceType`/`referenceId` (`'Listing'` + id) para poder auditar con qué se pagó **cada** bump ([schema.prisma:2479-2510](../apps/api/prisma/schema.prisma#L2479-L2510)) |
| **Modelo — cuota mensual Pro** | **IMPLEMENTADO (derivado, sin tabla)** | Destacados: `Entitlement{type: FEATURED_LISTING, origin: PRO_QUOTA}`. Bumps: `BumpLedger{type: PRO_QUOTA, amount: 0}` — fila marcador que **no mueve saldo**, solo sirve para el `COUNT` ([schema.prisma:322-327](../apps/api/prisma/schema.prisma#L322-L327)) |
| **Modelo — cupones canjeables** | **IMPLEMENTADO** | `Coupon` + `CouponRedemption`, `rewardType ∈ {CREDITS, FEATURED, BUMP}`, `@@unique([couponId, userId])` ([coupons.service.ts](../apps/api/src/modules/coupons/coupons.service.ts)) |
| **ASIGNACIÓN MENSUAL** | **IMPLEMENTADO — sin cron** | `getFeaturedQuotaStatus` cuenta lo usado desde `Subscription.currentPeriodStart` ([entitlement.service.ts:247-341](../apps/api/src/modules/billing/entitlement.service.ts#L247-L341)). **Reseteo derivado**: cuando Stripe/Redsys avanza el periodo, lo del periodo anterior deja de contar solo |
| **Cantidades configurables** | **IMPLEMENTADO** | Settings `proMonthlyFeaturedQuota` (def. 4), `proMonthlyBumpQuota` (def. 4), `proQuotaFeaturedDurationDays` (def. 7) — editables en backoffice ([admin.service.ts:207-218](../apps/api/src/modules/admin/admin.service.ts#L207-L218)) |
| **GASTAR EN BUMP** | **IMPLEMENTADO — 3 bolsas en cascada** | [billing.service.ts:680-864](../apps/api/src/modules/billing/billing.service.ts#L680-L864) — `bump()` en una sola `$transaction`: **1)** cuota Pro (lock `FOR UPDATE` sobre `Subscription`) → **2)** `bumpBalance` (`UPDATE … WHERE bumpBalance >= 1`) → **3)** créditos. Devuelve `paidWith` y `cost` |
| **GASTAR EN DESTACADO** | **IMPLEMENTADO** | `featuredByCredits(userId, {listingId, useQuota})` ([billing.service.ts:512-560](../apps/api/src/modules/billing/billing.service.ts#L512-L560)) — con `useQuota` reserva atómicamente el hueco (`hasAvailableFeaturedQuota`) y crea el `Entitlement` con `origin: PRO_QUOTA`; si no, débito de créditos |
| **UI — gastar en bump** | **IMPLEMENTADO** | [PromocionarDialog.tsx](../apps/web/src/components/anuncios/owner/PromocionarDialog.tsx) + [PromocionarControl.tsx](../apps/web/src/components/anuncios/owner/PromocionarControl.tsx), en `/mis-anuncios` **y** en la ficha propia. `resolveBumpOffer` ([promocion.ts:42-73](../apps/web/src/components/anuncios/owner/promocion.ts#L42-L73)) replica el orden del backend para **anunciarlo antes del clic**: «Gratis · te quedan N este mes» |
| **UI — gastar en destacado** | **IMPLEMENTADO** | Mismo diálogo: botón de cuota Pro con mensaje «destacado N días con tu cuota Pro», y degradación a créditos/tarjeta si la cuota se agotó entre el render y el clic ([PromocionarDialog.tsx:342-354](../apps/web/src/components/anuncios/owner/PromocionarDialog.tsx#L342-L354)) |
| **Bump automático ↔ cuota** | **IMPLEMENTADO** | `BumpSchedule` + `BumpRun` + cron [bump-auto.processor.ts:92-105](../apps/api/src/modules/bump-schedule/bump-auto.processor.ts#L92-L105) → llama a **`BillingService.bump`**, la misma función, así que hereda las tres bolsas y guarda `paidWith`/`cost` en el `BumpRun`. Sin fondos: `FAILED_NO_FUNDS` + `PAUSED_NO_FUNDS` |
| **Rotación de destacados ↔ cuota** | **IMPLEMENTADO (y desacoplado, correctamente)** | La rotación reparte turnos entre destacados vigentes; **no le importa cómo se pagó**. Un destacado por cuota Pro crea el mismo `Entitlement` que uno pagado, así que **entra en la rotación igual** ([featured-rotation](../apps/api/src/modules/search/featured-rotation.ts), `cuotaDeVitrina`) |
| **VISIBILIDAD — `/mis-creditos`** | **IMPLEMENTADO** | [ResumenSaldo.tsx](../apps/web/src/app/(account)/mis-creditos/_components/ResumenSaldo.tsx) — las **tres bolsas juntas y en orden de consumo**: créditos (con equivalencias), bumps gratis, y tarjeta Pro con «N de M bumps» + «y X de Y destacados» |
| **VISIBILIDAD — renovación** | **IMPLEMENTADO** | La fecha («Se renueva: …») se pinta en [/perfil/suscripcion](../apps/web/src/app/(account)/perfil/suscripcion/page.tsx#L149-L153), desde `periodEnd`. `/mis-creditos` enlaza allí |
| **VISIBILIDAD — otras superficies** | **IMPLEMENTADO** | `/mis-anuncios` recuerda la cuota ([MisAnunciosClient.tsx:145](../apps/web/src/components/anuncios/MisAnunciosClient.tsx#L145)), el diálogo la usa antes de cobrar, y a un **no**-Pro se le dice qué se pierde con la cifra real configurada |
| **Historial / trazabilidad** | **IMPLEMENTADO** | `Historiales.tsx` + `HistorialPaginado.tsx` (créditos y bumps), `BumpsProgramados.tsx` (turnos automáticos con su resultado) |
| **Admin: dar bumps/créditos a mano** | **IMPLEMENTADO** | `grantBumps` / ajuste de saldo con auditoría `ADMIN_BUMP_GRANT` ([admin-billing.service.ts:407-464](../apps/api/src/modules/admin/admin-billing.service.ts#L407-L464)) |

## 2.2 Pro pagando vs. Pro manual (cuota mensual) — **aquí sí hay asimetría**

| | Pro pagando | Pro manual (desde admin) |
|---|---|---|
| ¿Es Pro? | Sí | Sí |
| Ventajas Pro no monetarias (vídeo, insignia, cuotas de anuncios) | Sí | **Sí** |
| **Cuota mensual de bumps** | **Sí** | **NO** |
| **Cuota mensual de destacados** | **Sí** | **NO** |
| Por qué | `Subscription.currentPeriodStart` existe | **No hay ciclo de facturación desde el que contar** |

Esto **no es un defecto: está decidido, implementado con cuidado y dicho al usuario.**
`quotaSource: 'SUBSCRIPTION' | 'NONE'` existe precisamente para no volver a confundir «no es
Pro» con «no tiene ciclo» ([entitlement.service.ts:85-101](../apps/api/src/modules/billing/entitlement.service.ts#L85-L101)), y `ResumenSaldo` le pinta a un Pro manual
«Activo · la cuota mensual va con la suscripción, así que a un Pro concedido por el equipo no
le aplica» en vez de un falso «0 de 0».

**La decisión D-1 sigue abierta:** si algún día se quiere que una concesión manual traiga
cuota, el hueco está dejado (un tercer valor de `quotaSource`). Mientras tanto, la vía para
compensar a un Pro manual es `grantBumps` desde admin, que sí funciona.

## 2.3 Lo que falta en cupones/créditos

1. **El bump automático NO es un beneficio Pro** — está abierto a todo el mundo, con tope
   por usuario (`maxBumpSchedulesPerUser`, def. 10) y pagando de las tres bolsas
   ([bump-schedule-crud.service.ts:17-19](../apps/api/src/modules/bump-schedule/bump-schedule-crud.service.ts#L17-L19)). Si la intención era que fuese una ventaja Pro, **hoy no lo es**.
2. **La cuota Pro no tiene un aviso de «se te van a caducar»**. Lo no usado se pierde al
   cambiar de periodo y nada se lo recuerda al vendedor a final de ciclo.
3. **Un Pro manual no tiene ninguna vía de auto-servicio** para obtener cuota: depende de que
   alguien le acredite bumps a mano.
4. **No hay cuota mensual de vídeo** (ni hace falta: el vídeo no se consume, se tiene).

---

# PARTE 3 — RECONCILIACIÓN CON LOS DOCS VIEJOS

## 3.1 Lo que los docs viejos daban por inexistente y **HOY EXISTE**

| Doc viejo decía | Hoy |
|---|---|
| `auditoria-video-pro`: «el modelo de datos del vídeo NO EXISTE» | **Falso hoy** — 5 columnas en `Listing` ([schema.prisma:958-993](../apps/api/prisma/schema.prisma#L958-L993)) |
| «el póster NO EXISTE» | **Falso hoy** — `videoPosterUrl`, capturado en cliente; y además un **sprite** (`videoPreviewUrl`) que ningún doc viejo contemplaba |
| «no hay endpoint de subida de vídeo de anuncio» | **Falso hoy** — módulo `video/` completo, presign + confirm + delete |
| «el editor no tiene campo de vídeo» | **Falso hoy** — `StepVideo` en `EditarForm` |
| «la ficha no reproduce vídeo de anuncio» | **Falso hoy** — `ListingGallery` + `VideoPlayer` |
| «las listas no dicen nada del vídeo» | **Falso hoy** — indicador en las 4 familias de tarjeta + previsualización animada al hover |
| `auditoria-bump-automatico`: «no existe modelo de programación» | **Falso hoy** — `BumpSchedule` + `BumpRun` + cron + UI |
| `diseno-bump-automatico`: «el scheduler no sabe cobrar, llama a `BillingService.bump`» | **Se cumplió al pie de la letra** ([bump-auto.processor.ts:92](../apps/api/src/modules/bump-schedule/bump-auto.processor.ts#L92)) |
| `diseno-rotacion-destacados`: rotación temporal con ventana de 15 min | **Implementada** (`featured-rotation`, `cuotaDeVitrina`), y desacoplada de cómo se pagó el destacado |
| `auditoria-mis-creditos`: «el formulario de cupón ocupa el sitio de la cifra que todos vienen a ver» | **Corregido** — `ResumenSaldo` es lo primero, con las tres bolsas |
| `auditoria-pro-video` hueco #11: «el asistente no menciona el vídeo» | **Corregido** — `AvisoVideo`, con dos mensajes |
| `auditoria-pro-video` hueco V-3: «el mapa no pinta el indicador» | **Corregido** — `MapCards` lo pinta en sus dos tarjetas |

## 3.2 Lo que los docs viejos decían y **SIGUE VIGENTE**

- **«El vídeo se sube una vez y se ve en un sitio; en los otros doce es un icono»**
  (`diseno-video-pro`, principio rector) — **vigente y protegido por tipos**: `CardPhotoCarousel`
  recibe un `boolean`, no una URL, y hay e2e que lo fija. Con un matiz nuevo: desde el póster
  animado, en las listas también viaja una **imagen fija** de 20-45 KB, cargada perezosamente.
  El principio no se rompió; se afinó.
- **D2 «fichero propio, no embed»** — vigente para el anuncio. (El bloque de CMS siguió siendo
  embed **y además** ganó un hermano de fichero propio: `videoUpload`.)
- **«Sin ffmpeg»** — vigente, y sostenido restringiendo a MP4/H.264.
- **«La duración solo se valida declarada»** — vigente, documentado como frontera aceptada.
- **«Pro manual no tiene cuota mensual» (D-1)** — vigente y ahora explícito en el contrato
  (`quotaSource`).
- **«El bloque `video` del CMS es de otra especie»** — vigente, y ahora hay **tres** especies.

## 3.3 Lo que los docs viejos **NO PODÍAN SABER** (nació después)

1. El **póster animado** (sprite de 5 fotogramas + animación CSS) — P1 y P2.
2. El camino **`block-media`** (vídeo de fichero propio para bloques de CMS).
3. El tratamiento de **huérfanas H2** (prefijo `tmp/` + regla de ciclo de vida) y el cierre de
   **H-2** (el póster que quedaba huérfano al quitar el vídeo).
4. El filtro **«solo con vídeo»** (V-4) en búsqueda pública y en backoffice.
5. Los **packs de bumps** (`BumpPack`) y el bonus Pro/campaña congelado en `Transaction`.
6. La distinción **`quotaSource`** y el eje **`hasActiveSubscription`** (paridad del Pro manual).

**Conclusión de la reconciliación:** los siete docs viejos son **útiles como registro de
decisiones y como explicación del porqué**, pero **su inventario de estado está caducado**.
No deberían usarse para decidir qué construir sin contrastar con este documento.

---

# PARTE 4 — DECISIONES Y PRÓXIMOS PASOS

No hay ninguna funcionalidad «en papel». Lo que queda son **decisiones de producto**, y
conviene resolverlas antes de escribir código, porque tres de ellas no cuestan casi nada y
una es cara.

### Primero: comprobar, no construir

| # | Qué | Coste |
|---|---|---|
| **0.1** | **Confirmar que `videoEnabled` está a `true`** en producción. Si está apagado, todo el vídeo Pro es invisible aunque esté completo | 1 minuto |
| **0.2** | Confirmar los valores vivos de `proMonthlyBumpQuota` y `proMonthlyFeaturedQuota` (defaults 4 y 4) | 1 minuto |

### Después: las decisiones abiertas, por relación valor/coste

| # | Decisión | Recomendación | Coste |
|---|---|---|---|
| **D-A** | **¿El bump automático debe ser un beneficio Pro?** Hoy lo tiene todo el mundo | Decidir explícitamente. Si sí: un `assertPro` en `BumpScheduleCrudService.create` y un gate visible (molde `ProGate`). Si no: **decirlo en `/planes`**, porque hoy no se vende | Bajo |
| **D-B** | **Aviso de cuota Pro a punto de caducar** («te quedan 3 bumps y el periodo acaba el día X») | Hacerlo. Es la mayor ganancia de valor percibido por línea de código: el dato ya está en `getFeaturedQuotaStatus` (`remaining` + `periodEnd`), solo falta pintarlo | Bajo |
| **D-C** | **D-1: ¿el Pro manual recibe cuota mensual?** | Recomendado **no cambiarlo**. El hueco está dejado (`quotaSource`), y la vía de compensación (`grantBumps`) ya funciona y queda auditada | Nulo (statu quo) |
| **D-D** | **Previsualización de vídeo en móvil** — hoy no existe (`hover: hover`) | Es la única laguna real de producto en vídeo. Opción barata: enseñar el **primer fotograma del sprite fijo** con una marca de «vídeo» en táctil, sin animar. No reabre el coste de bytes | Medio |
| **D-E** | **Vídeos históricos sin sprite** | Aceptar. Regenerar exige ffmpeg, que es la dependencia que el proyecto ha rechazado tres veces por escrito. Se resuelve solo según se re-suban vídeos | Nulo |
| **D-F** | **Vídeo en el asistente de publicar** | No hacerlo. Exigiría subida en dos tiempos con su propia clase de huérfanas, para ahorrar un clic. El aviso ya cubre el hueco de comunicación | — |

### Orden sugerido

1. **0.1 y 0.2** (comprobaciones).
2. **D-B** — el aviso de caducidad de cuota. Barato, visible, cierra el único punto donde el
   producto deja que el Pro pierda algo que ya pagó sin avisarle.
3. **D-A** — decidir el estatus del bump automático. Es una decisión de **monetización**, no
   técnica, y hoy está tomada por omisión.
4. **D-D** — la previsualización en táctil, si se quiere empujar el vídeo como argumento de
   venta de Pro.
5. **D-C, D-E, D-F** — dejar como están, documentadas.

---

## Anexo — método

Verificado contra `fa632b5` leyendo: `schema.prisma` (modelos `Listing`, `Wallet`,
`CreditLedger`, `BumpLedger`, `BumpSchedule`, `BumpRun`, `Coupon`, `CouponRedemption`,
`Entitlement`, `Subscription`, `CreditPack`, `BumpPack`); el módulo `video/` completo
(controller, service, limits, DTOs); `entitlement.service.ts`, `pro-status.service.ts`,
`billing.service.ts` (`bump`, `featuredByCredits`), `coupons.service.ts`,
`admin-billing.service.ts`, `bump-auto.processor.ts`, `bump-schedule-crud.service.ts`,
`search.service.ts`, `listing-summary.ts`; y en el frontend `StepVideo`, `EditarForm`,
`AvisoVideo`, `PublicarWizard`, `ListingGallery`, `VideoPlayer`, `CardPhotoCarousel`,
`VideoHoverPreview`, `VideoIndicator`, `MapCards`, `MyListingCard`, `ResumenSaldo`,
`promocion.ts`, `PromocionarDialog`, `MisAnunciosClient`, `mis-creditos/page.tsx`,
`perfil/suscripcion/page.tsx`, `ajustes-organizacion.ts`.

Las ausencias se han comprobado con búsquedas, no por omisión: `ffmpeg` (sin dependencia en
ningún `package.json`; solo comentarios), `videoUrl` en el documento de Meilisearch (no viaja),
y URL de vídeo en las props de tarjeta (solo `hasVideo: boolean` y `videoPreviewUrl`).
