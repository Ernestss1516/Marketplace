# Auditoría — Funcionalidades Pro: paridad, vídeo y cómo se explican los beneficios

> Fecha: 2026-08-24 · Rama: `main` · Último commit: `8bafe18`
>
> **Qué es este documento.** Un INVENTARIO del estado real, verificado contra el código,
> fichero a fichero. **No diseña nada.** Es el mapa que hay que tener delante antes de
> decidir qué construir. Cada afirmación lleva su ubicación en el código; donde una
> hipótesis previa era falsa, se dice que era falsa.

---

## Cómo se ha verificado

Se ha leído el código, no la documentación. Cuando `docs/estado-tecnico.md` decía «✅
Completo» se ha ido a comprobarlo al fichero. Lo verificado:

- Los **8 puntos del backend** que preguntan «¿es Pro?» (búsqueda exhaustiva de
  `isProActive` y de todo acceso directo a `Subscription`).
- Las **13 superficies** que pintan una tarjeta o una ficha de anuncio, y de qué endpoint
  sale el dato de cada una.
- El **whitelist de ajustes** del backend contra la **lista de ajustes** que pinta el
  backoffice.
- Los **tests** que fijan las garantías (cero bytes de vídeo en listas, `preload="none"` en
  la ficha) — porque un rediseño tiene que saber qué tests va a tener que tocar.

---

## Resumen ejecutivo — las tres preguntas rectoras

**¿La paridad pagado/manual se cumple hoy?**
**Sí en el backend, sin excepciones.** Los ocho beneficios Pro pasan todos por
`isProActive`, que lee el `Entitlement` y no sabe nada de Stripe. La concesión manual desde
backoffice **existe y está completa** (endpoint + UI + auditoría). La única asimetría —las
cuotas mensuales de destacados y bumps— es **deliberada y está documentada** (D-1): cuelgan
de un ciclo de facturación que en una concesión manual no existe. Lo que sí falla son **dos
huecos de interfaz** (§1.5): `/perfil/suscripcion` deja al Pro manual mirando una tarjeta
vacía, y `/planes` le impide convertirse en Pro de pago.

**¿Qué está de verdad incompleto en el vídeo?**
La hipótesis «no parece 100% implementado» era **correcta, pero no por donde se pensaba**.
El flujo del vendedor, la ficha, el indicador en las listas y el reproductor del backoffice
**están construidos y funcionan** (el backoffice sí muestra el vídeo — hipótesis refutada,
§2.4). Lo que falta es más grave y más barato de arreglar: **la feature está apagada y no
hay ningún interruptor en el backoffice para encenderla** (§2.0). Además: dos superficies de
tarjeta no pintan el indicador (`/favoritos` y `/mis-anuncios`), `hasVideo` no es filtrable
en la búsqueda, y el vídeo **no se anuncia en `/planes`** aunque el enganche está escrito y
comentado.

**¿El hover-preview es viable o «muy complicado»?**
**Viable, pero no barato, y hay una vía que es mucho más barata que las dos que se
plantearon.** Reproducir un trozo del `.mp4` completo en hover es la opción **más peligrosa**
(§3.3): los MP4 grabados con el móvil normalmente llevan el índice al final del fichero y sin
`ffmpeg` no hay forma de arreglarlo, así que «los primeros 3 segundos» pueden costar
**descargar los 50 MB enteros**. Generar un clip aparte exige `ffmpeg`, que el proyecto ha
rechazado dos veces por escrito. La tercera vía —un **póster animado** de unos pocos
fotogramas, capturado en el navegador al subir, igual que ya se captura el póster fijo— cuesta
decenas de KB, no monta ningún `<video>` en la tarjeta y **no traiciona ninguna de las dos
garantías existentes**. Veredicto en §3.5.

---

## §1 — Paridad Pro pagado vs Pro manual

### 1.1 Cómo se lee «es Pro»: un solo lector, sin excepciones

Hay **una única implementación** de la pregunta, en
[`pro-status.service.ts:51`](../apps/api/src/modules/listing-gate/pro-status.service.ts#L51):

```ts
async isProActive(userId: string): Promise<boolean> {
  const row = await this.prisma.entitlement.findFirst({
    where: { userId, type: EntitlementType.PRO_SUBSCRIPTION, ...activeFilter() },
    select: { id: true },
  });
  return row !== null;
}
```

`activeFilter()` = `revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now)`. **No mira
`Subscription`, no mira Stripe, no mira `subscriptionId`.** Un entitlement concedido a mano
es indistinguible de uno de pago para esta función, que es exactamente lo que la paridad
exige.

`EntitlementService.isProActive`
([`entitlement.service.ts:117`](../apps/api/src/modules/billing/entitlement.service.ts#L117))
**delega** en la anterior: no hay una segunda copia que pueda divergir. El propio comentario
del fichero explica por qué se mantuvo así.

### 1.2 Inventario completo de beneficios Pro y cómo comprueban el estado

Barrido exhaustivo de todos los llamantes de `isProActive` en `apps/api/src`:

| # | Beneficio | Dónde se decide | Cómo comprueba Pro | ¿Paridad? |
|---|---|---|---|---|
| 1 | **Límite de anuncios ACTIVOS** (5 gratis / 20 Pro) | [`active-listing-limit.rule.ts:64`](../apps/api/src/modules/listing-gate/rules/active-listing-limit.rule.ts#L64) | `proStatus.isProActive` | ✅ |
| 2 | **Límite TOTAL de anuncios** (regla apagable) | [`total-listing-limit.rule.ts:85`](../apps/api/src/modules/listing-gate/rules/total-listing-limit.rule.ts#L85) | `proStatus.isProActive` | ✅ |
| 3 | **Vídeo en el anuncio** | [`video.service.ts:299`](../apps/api/src/modules/video/video.service.ts#L299) (`assertPro`) | `entitlements.isProActive` | ✅ |
| 4 | **Bonus de créditos al comprar packs** (+20%) | [`redsys.service.ts:306`](../apps/api/src/modules/redsys/redsys.service.ts#L306) (`computeProBonus`) | `entitlements.isProActive` | ✅ |
| 5 | **Bonus de bumps al comprar packs** (+20%) | mismo `computeProBonus`, otra `Setting` | `entitlements.isProActive` | ✅ |
| 6 | **Estadísticas por anuncio** (vistas/día, ratio) | [`listings.service.ts:1595`](../apps/api/src/modules/listings/listings.service.ts#L1595) | `entitlementService.isProActive` | ✅ |
| 7 | **Estadísticas agregadas del vendedor** | [`listings.service.ts:1620`](../apps/api/src/modules/listings/listings.service.ts#L1620) | `entitlementService.isProActive` | ✅ |
| 8 | **Insignia Pro en el perfil público** | [`users.service.ts:194`](../apps/api/src/modules/users/users.service.ts#L194) | `entitlements.isProActive` | ✅ |
| — | *(lectura de staff)* Insignia Pro en la ficha de usuario del backoffice | [`admin.service.ts:1468`](../apps/api/src/modules/admin/admin.service.ts#L1468) | `proStatus.isProActive` | ✅ |
| 9 | **Cuota mensual de destacados gratis** | [`entitlement.service.ts:161`](../apps/api/src/modules/billing/entitlement.service.ts#L161) / `:263` | `proConPeriodoFilter` → exige `subscriptionId != null` | ⚠️ **deliberado** |
| 10 | **Cuota mensual de bumps gratis** | [`entitlement.service.ts:313`](../apps/api/src/modules/billing/entitlement.service.ts#L313) | idem | ⚠️ **deliberado** |
| 11 | **«Soporte prioritario»** | — | **no existe mecanismo** (ver §4.4) | n/a |

**Ningún beneficio consulta Stripe ni la tabla `Subscription` para decidir si conceder.** El
único acceso directo a `Subscription` en toda la ruta de beneficios es el guard
`ALREADY_SUBSCRIBED` de
[`billing.service.ts:130`](../apps/api/src/modules/billing/billing.service.ts#L130), que **no
concede nada**: impide abrir un segundo checkout de Stripe a quien ya tiene una suscripción
viva. Que mire `Subscription` y no el entitlement es lo correcto —lo que evita es un segundo
cobro recurrente— y está escrito en su comentario. Consecuencia lateral, sin embargo: un Pro
manual **sí puede** suscribirse de verdad por API (§1.5).

### 1.3 La única asimetría: las cuotas mensuales, y por qué es a propósito

`getFeaturedQuotaStatus` y sus dos hermanas piden desde el principio un entitlement PRO
vigente **con suscripción** (`proConPeriodoFilter`,
[`entitlement.service.ts:37`](../apps/api/src/modules/billing/entitlement.service.ts#L37)).
Un Pro manual no la tiene, así que su cuota mensual es 0.

Esto **no es un descuido**, y el código lo dice con todas las letras:

- La cuota es un **COUNT desde `Subscription.currentPeriodStart`**. Sin ciclo de facturación
  no hay desde dónde contar: no es que se le niegue, es que la operación no está definida.
- El campo `quotaSource: 'SUBSCRIPTION' | 'NONE'` existe precisamente para no confundir «no
  hay ciclo» con «no es Pro»
  ([`entitlement.service.ts:96`](../apps/api/src/modules/billing/entitlement.service.ts#L96)).
  Antes de la ráfaga U1 se devolvía `isPro: false` a un Pro manual, **y eso sí era un fallo
  de paridad real** — ya está corregido.
- `proConPeriodoFilter` también arregla el caso inverso: un Pro manual concedido a alguien
  que **ya paga** es más reciente y, con el `findFirst` antiguo, **tapaba la cuota que ese
  cliente estaba pagando**.
- El comentario deja abierta la puerta a un tercer valor si algún día se decide que una
  concesión manual traiga cuota (decisión D-1, `docs/diseno-ficha-usuario.md` §7).

**Lectura para el diseño posterior:** si Ernest quiere paridad *también* en las cuotas
mensuales, es una decisión de producto ya identificada y con su hueco preparado, no un bug
que reparar.

### 1.4 La concesión manual: existe y está completa

**Hipótesis a verificar: «¿está construida o es un hueco?» → Está construida, entera.**

| Pieza | Ubicación | Estado |
|---|---|---|
| Endpoint conceder | `POST /admin/billing/users/:userId/pro` — [`admin-billing.controller.ts:75`](../apps/api/src/modules/admin/admin-billing.controller.ts#L75) | ✅ |
| Endpoint revocar | `POST /admin/billing/users/:userId/pro/revoke` — [`admin-billing.controller.ts:86`](../apps/api/src/modules/admin/admin-billing.controller.ts#L86) | ✅ |
| Lógica | [`admin-billing.service.ts:212`](../apps/api/src/modules/admin/admin-billing.service.ts#L212) y `:278` | ✅ |
| DTO | [`grant-pro.dto.ts`](../apps/api/src/modules/admin/dto/grant-pro.dto.ts) — `expiresAt` **obligatorio**, `reason` obligatorio (5–500) | ✅ |
| Autorización | `@MinRole(Role.ADMIN)` de clase — un MODERATOR no puede | ✅ |
| Auditoría | `AuditLog` `PRO_GRANT` / `PRO_REVOKE`, con motivo, dentro de la misma transacción | ✅ |
| UI backoffice | [`BloqueDinero.tsx:195`](../apps/web/src/app/(admin)/admin/usuarios/[id]/_components/BloqueDinero.tsx#L195) — fecha + motivo + botón | ✅ |
| Distinción visual | Insignias «Pro de pago» / «Pro concedido por el equipo», partidas por `subscriptionId === null` | ✅ |
| Aviso de la asimetría | Texto `pro-sin-cuota`: «Sin cuota mensual: las gratuidades … cuelgan de un ciclo de facturación» | ✅ |

Detalles de diseño ya resueltos y verificados:
- `subscriptionId: null` **es** la marca de procedencia — no hay columna `source`.
- `revokePro` solo toca los manuales (`subscriptionId: null` en el `where`): revocar el de
  alguien que paga le quitaría lo comprado sin parar el cobro.
- Revocar escribe `revokedAt`, no borra: `activeFilter` lo excluye en el acto y la historia
  se conserva.
- **No** crea `Subscription`, así que el flujo de pago real queda intacto.

Cubierto por tests e2e: [`usuario-acciones.e2e-spec.ts`](../apps/api/test/usuario-acciones.e2e-spec.ts),
[`pro-sin-periodo.e2e-spec.ts`](../apps/api/test/pro-sin-periodo.e2e-spec.ts).

### 1.5 Los dos huecos de paridad que sí existen — y los dos están en la interfaz

**H-1 · `/perfil/suscripcion` dejaba al Pro manual con una tarjeta vacía** — **CERRADO** (2026-08-24, rama `fix-paridad-pro-manual`).
[`page.tsx:81`](../apps/web/src/app/(account)/perfil/suscripcion/page.tsx#L81) — **todo** el
`CardContent` está condicionado a `activeSubscription`. Un Pro manual ve la cabecera «Plan
Pro · Acceso a todas las funciones Pro» y **nada más**: ni hasta cuándo lo tiene, ni de dónde
sale, ni por qué no ve cuota. El backoffice sí se lo dice al admin; al usuario, nadie. Y como
`isPro` es true, tampoco entra la tarjeta «No tienes ningún plan activo» (línea 159), así que
la página se queda literalmente en blanco por debajo del título.

**H-2 · `/planes` impedía al Pro manual convertirse en Pro de pago** — **CERRADO** (2026-08-24).
[`CheckoutButton.tsx:75`](../apps/web/src/app/(public)/planes/_components/CheckoutButton.tsx#L75)
— si `getProStatus().isPro` es true pinta «Ya eres Pro» **deshabilitado** y enlaza a
«Gestionar mi suscripción», que para un Pro manual es la página vacía de H-1. Pero el backend
**sí le dejaría** suscribirse: el guard `ALREADY_SUBSCRIBED` mira `Subscription`, no
entitlements. Interfaz y servidor discrepan, y quien pierde es el caso de negocio más
deseable: el que tuvo Pro de regalo y quiere pagarlo.

### 1.6 Conclusión de la sección

> **La paridad se cumple en el backend.** Los 8 beneficios reales pasan todos por
> `isProActive` → `Entitlement`. Ninguno discrimina por vía de pago. La vía de concesión
> manual existe, está auditada y tiene interfaz.
>
> Las dos únicas asimetrías son (a) las **cuotas mensuales**, deliberada y documentada, y (b)
> **dos huecos de interfaz** (H-1, H-2) que dejan al Pro manual sin información y sin salida
> hacia el pago.

> **§1 CERRADA** (2026-08-24, rama `fix-paridad-pro-manual`). Los dos huecos de interfaz
> tenían la misma causa: el frontend fundía «es Pro» (un `Entitlement`) y «tiene suscripción
> de pago» (una `Subscription`) en un solo `isPro`. El backend nunca los confundió, pero sólo
> publicaba uno de los dos ejes. `GET /billing/pro-status` sirve ahora también
> `hasActiveSubscription`, calculado con el MISMO predicado que el guard del checkout
> ([`subscription-vigente.ts`](../apps/api/src/modules/billing/subscription-vigente.ts)) —
> así la interfaz ofrece exactamente lo que el servidor acepta.
>
> Queda en pie sólo la asimetría (a), que es una decisión de producto, no un defecto.

---

## §2 — El vídeo, superficie por superficie

Se distingue en todo momento **«muestra que HAY vídeo»** (un indicador) de **«REPRODUCE el
vídeo»**.

### 2.0 El hecho que domina toda la sección: la feature está apagada y no hay interruptor

Esto no estaba en el encargo y es, con diferencia, el hueco más importante que ha aparecido.

1. El interruptor es la `Setting` **`videoEnabled`**, y **sin fila está APAGADA** a propósito
   ([`video.service.ts:275`](../apps/api/src/modules/video/video.service.ts#L275): «la feature
   cuesta almacenamiento y ancho de banda desde el primer vídeo, así que lo prudente es que
   encenderla sea un acto explícito»).
2. **La semilla de producción no la crea.** [`seed.ts:452-479`](../apps/api/prisma/seed.ts#L452)
   siembra 15 ajustes; `videoEnabled` **no está** entre ellos. Solo la siembra
   [`seed-test.ts:94`](../apps/api/prisma/seed-test.ts#L94).
3. La clave **sí** está en el whitelist del backend
   ([`admin.service.ts:194`](../apps/api/src/modules/admin/admin.service.ts#L194)), así que
   `GET /admin/settings` la devuelve y `PATCH /admin/settings/videoEnabled` la escribe.
4. **Pero el backoffice no la pinta.** La página de ajustes recorre un array `ORDER` escrito a
   mano ([`ajustes/page.tsx:914-948`](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L914))
   y **`videoEnabled` no aparece** ni ahí ni en `MONETIZATION_SETTING_KEYS`.

**Consecuencia verificada: hoy no existe ninguna forma de encender el vídeo Pro desde la
interfaz de administración.** Hace falta una llamada directa a la API con token de ADMIN o
una fila insertada en la base de datos. Con el flag apagado, `assertEnabled` rechaza firmar
y confirmar (`VIDEO_DISABLED`) y `resolveEditSections` ni siquiera pinta la sección — es
decir, **toda la feature es inalcanzable para el usuario final**.

> Nota colateral del mismo hallazgo: `bumpAutoEnabled`, `maxBumpSchedulesPerUser` y
> `attributeRevalidationEnabled` están igual — en el whitelist del backend y ausentes de la
> página de ajustes. No es objeto de esta auditoría, pero es el mismo defecto y probablemente
> el mismo arreglo.

### 2.1 La subida y la edición — completa, con una frontera de producto

**Backend** ([`video.service.ts`](../apps/api/src/modules/video/video.service.ts)) — completo:

| Pieza | Estado |
|---|---|
| `GET /video/config` (flag + límites) | ✅ |
| `POST /video/upload-url` — gate (flag, Pro, anuncio propio y ACTIVE) + límites + firma | ✅ |
| `POST /video/listings/:id/confirm` — `HEAD` contra el almacenamiento, copia `tmp/` → definitivo, idempotente | ✅ |
| `DELETE /video/listings/:id` — borra fila y objeto | ✅ |
| Límites: **50 MB**, **60 s**, **solo `video/mp4`**, TTL de firma 10 min | ✅ [`video-limits.ts`](../apps/api/src/modules/video/video-limits.ts) |
| El tamaño viaja **dentro de la firma** → el almacenamiento aplica el límite, no el cliente | ✅ |
| Un vídeo por anuncio; el anterior se borra del almacenamiento | ✅ |
| Al cambiar: invalida la caché de la ficha **y** reindexa (`refrescarSuperficies`) | ✅ |
| Huérfanas H2: se firma contra `listing-videos/tmp/<id>/`, sale de ahí al confirmar | ✅ |

**Frontend** ([`StepVideo.tsx`](../apps/web/src/components/publicar/steps/StepVideo.tsx)) —
completo: validación temprana en cliente, lectura de la duración real, captura del póster en
`<canvas>`, `PUT` directo con barra de progreso (`XMLHttpRequest`, no `fetch`, para tener
progreso), confirmación, sustituir y quitar.

**Lo que falta del flujo del vendedor:**

- **F-1 · No se puede añadir vídeo al publicar, solo al editar.** `StepVideo` **solo** está
  cableado en [`EditarForm.tsx:383`](../apps/web/src/components/publicar/EditarForm.tsx#L383);
  el asistente [`PublicarWizard.tsx`](../apps/web/src/components/publicar/PublicarWizard.tsx)
  no lo monta. Es **coherente con el backend**, que exige `status === ACTIVE`
  ([`video.service.ts:318`](../apps/api/src/modules/video/video.service.ts#L318)) — un borrador
  no puede tener vídeo. Pero **nada se lo dice al vendedor**: publica, no ve vídeo por ningún
  lado, y tiene que descubrir por su cuenta que aparece al editar.
- **F-2 · La duración es una frontera conocida y aceptada.** Sin `ffmpeg`, el servidor valida
  la duración **declarada**. Está escrito y razonado en
  [`video-limits.ts:21-29`](../apps/api/src/modules/video/video-limits.ts#L21). No es un hueco:
  es una decisión. Se anota porque **condiciona la §3**.

### 2.2 La ficha (`/anuncio/[slug]`) — REPRODUCE, y está bien resuelta

[`ListingGallery.tsx`](../apps/web/src/components/anuncios/ListingGallery.tsx), cableada desde
[`anuncio/[slug]/page.tsx:167`](../apps/web/src/app/(public)/anuncio/[slug]/page.tsx#L167).

- El vídeo es **una miniatura más** de la tira, **después** de las fotos (para no romper la
  continuidad con la portada que el usuario vio en la lista). `selected === -1` es el vídeo.
- La miniatura usa el **póster** (una imagen): seleccionarla no descarga vídeo.
- El `<video>` se monta **solo** al elegirlo, y con `preload="none"`, `controls`, **sin**
  `autoPlay`. El coste de que un anuncio tenga vídeo es **una imagen más** hasta que alguien
  pulsa play.
- **Validación de origen propia** (`isSafeSrc`): un `<video src>` no pasa por
  `remotePatterns` de `next/image`, así que ésta es su única restricción de dominio.
- Sin póster cae a la foto de portada, nunca a un rectángulo negro.

**¿Funciona en móvil?** Sí, y está previsto: **`playsInline`** está puesto (sin él iOS abriría
el reproductor a pantalla completa al pulsar play), `controls` nativos, contenedor
`aspect-video` con `object-contain`, y la tira de miniaturas es `overflow-x-auto`. No hay nada
condicionado a `hover` ni a puntero fino. **No se ha ejecutado en un dispositivo real** — lo
que se afirma aquí es que el marcado es el correcto para móvil.

Fijado por tests: [`video-visualizacion.test.tsx:49-123`](../apps/web/src/components/anuncios/video-visualizacion.test.tsx#L49)
(cinco casos: sin vídeo no cambia nada, la miniatura va después, `preload="none"` y sin
`autoplay`, origen ajeno no se pinta, fallback de póster).

### 2.3 Las listas y las tarjetas — el indicador, y las dos superficies que no lo pintan

**El contrato.** [`CardPhotoCarousel`](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx)
recibe **`hasVideo?: boolean`, nunca la URL**. Pinta un `<span>` con un icono `Play` del bundle
y la palabra «Vídeo» (`data-testid="card-tiene-video"`, abajo a la derecha,
`pointer-events-none`). **Cero peticiones.**

La garantía es **estructural, no disciplinaria**, y está cerrada en tres capas:
1. `toSummary` desestructura `videoUrl` **fuera** del `...rest` para que no pueda colarse
   ([`listings.service.ts:1508`](../apps/api/src/modules/listings/listings.service.ts#L1508)).
2. El documento de Meilisearch indexa `hasVideo: listing.videoUrl != null`, nunca la URL
   ([`search.service.ts:616`](../apps/api/src/modules/search/search.service.ts#L616)).
3. Tests: unitario «CERO BYTES DE VÍDEO: no se monta ningún `<video>` en una tarjeta»
   ([`video-visualizacion.test.tsx:32`](../apps/web/src/components/anuncios/video-visualizacion.test.tsx#L32))
   y e2e de barrido «el payload entero de la lista no contiene la URL por ningún lado»
   ([`video-visualizacion.e2e-spec.ts:111`](../apps/api/test/video-visualizacion.e2e-spec.ts#L111)).

**Inventario superficie por superficie:**

| # | Superficie | Componente | Fuente del dato | ¿Llega `hasVideo`? | ¿Pinta el indicador? |
|---|---|---|---|---|---|
| 1 | `/busqueda` — rejilla | `ListingCard` | Meilisearch | ✅ | ✅ |
| 2 | `/busqueda` — lista ampliada | `ListingCardWide` | Meilisearch | ✅ | ✅ |
| 3 | `/busqueda` — bloque **«Promocionados»** | [`FeaturedBlock`](../apps/web/src/components/busqueda/FeaturedBlock.tsx) → `ListingCard` | Meilisearch (`boostScore`) | ✅ | ✅ |
| 4 | `/busqueda` — **mapa**, tarjeta flotante | `MapView.FloatingCard` | Meilisearch | ✅ (en el dato) | ❌ **marcado propio** |
| 5 | `/busqueda` — **mapa**, panel del seleccionado | `MapView.SelectedListingPanel` | Meilisearch | ✅ (en el dato) | ❌ **marcado propio** |
| 6 | `/[categoria]` — rejilla y ampliada | `CategoryListingPage` | Meili (fallback Postgres `toSummary`) | ✅ | ✅ |
| 7 | **Portada** — bloques de anuncios | `ListingsHomeBlockRenderer` → `ListingCard` | `SearchResponse` | ✅ | ✅ |
| 8 | **Blog** — bloque `listings` | `ListingsBlockRenderer` → `ListingCard` | `SearchResponse` | ✅ | ✅ |
| 9 | `/anuncio/[slug]` — **relacionados** | `ListingCard` | `findByCategory` → `toSummary` | ✅ | ✅ |
| 10 | `/vendedor/[slug]` | `ListingCard` | `findBySellerSlug` → `toSummary` | ✅ | ✅ |
| 11 | **`/favoritos`** | `ListingCard` | `FavoritesService` (**no pasa por `toSummary`**) | ❌ | ❌ **hueco** |
| 12 | **`/mis-anuncios`** | [`MyListingCard`](../apps/web/src/components/anuncios/MyListingCard.tsx) | `findMine` → `toSummary` | ✅ | ❌ **hueco** |
| 13 | Backoffice `/admin/anuncios/[id]` | página propia | `admin.service` | ✅ **URL completa** | ✅ **REPRODUCE** (§2.4) |

**V-1 · `/favoritos` nunca puede pintar el indicador.**
[`FAVORITE_INCLUDE`](../apps/api/src/modules/favorites/favorites.service.ts#L6) es un
`include` crudo del `Listing`; el frontend
([`lib/api/favoritos.ts`](../apps/web/src/lib/api/favoritos.ts), `normalize()`) mapea a mano y
**no deriva `hasVideo`**. `ListingCard` lee `listing.hasVideo` → `undefined` → sin indicador.
Es la única lista pública que no pasa por `toSummary`, y por eso es la única que se quedó
fuera.

**V-2 · `/mis-anuncios` tiene el dato y no lo usa.** `findMine` va por `toSummary`, así que
`hasVideo` **sí** viaja — el e2e lo comprueba precisamente contra `/users/me/listings`
([`video-visualizacion.e2e-spec.ts:90`](../apps/api/test/video-visualizacion.e2e-spec.ts#L90)).
Pero `MyListingCard` pinta su propio `<Image src={listing.thumbnailUrl}>`
([`MyListingCard.tsx:88`](../apps/web/src/components/anuncios/MyListingCard.tsx#L88)) sin pasar
por `CardPhotoCarousel`. **El vendedor Pro no puede ver desde su panel cuáles de sus anuncios
llevan vídeo** — que es justo la persona a la que más le interesa saberlo.

**V-3 · Las dos tarjetas del mapa** son marcado propio (`<img>` a pelo) y tampoco lo pintan.
Menos grave, pero es el mismo defecto: tarjetas que no reutilizan `CardPhotoCarousel`.

**V-4 · `hasVideo` no era filtrable en la búsqueda** — **CERRADO** (2026-08-24, rama `feat-filtro-video`): está en `CORE_FILTERABLE_ATTRIBUTES` y `/busqueda` tiene su casilla «Solo con vídeo». Está en el documento indexado pero **no**
en `CORE_FILTERABLE_ATTRIBUTES`
([`search.service.ts:101`](../apps/api/src/modules/search/search.service.ts#L101)). No existe
un filtro «solo con vídeo» ni puede existir sin tocar los ajustes del índice. Para un beneficio
que se vende como diferenciador, es una vía de descubrimiento cerrada.

### 2.4 El backoffice — hipótesis refutada: **sí muestra el vídeo**

La hipótesis del encargo («probablemente NO lo muestra») es **falsa**. Verificado:

- El backend lo sirve: `admin.service.ts` selecciona y devuelve `videoUrl`, `videoPosterUrl`,
  `videoDurationSeconds`, `videoUploadedAt`
  ([`admin.service.ts:1206`](../apps/api/src/modules/admin/admin.service.ts#L1206) y `:1260`).
- El frontend lo **reproduce**:
  [`admin/anuncios/[id]/page.tsx:719-734`](../apps/web/src/app/(admin)/admin/anuncios/[id]/page.tsx#L719)
  monta un `<video src controls poster>` bajo el epígrafe «Vídeo», con la duración y la fecha
  de subida debajo.
- La cola de moderación enlaza a esa misma ficha
  ([`admin/moderacion/page.tsx:212`](../apps/web/src/app/(admin)/admin/moderacion/page.tsx#L212)),
  así que **el moderador sí puede ver el vídeo que modera**.

Dos matices menores, no huecos — **los dos CERRADOS el 2026-08-25** (huecos #13 y #14):
- ~~El reproductor del backoffice **no** lleva `preload="none"`~~. Se dijo aquí que era «una
  decisión razonable —una sola ficha, y el moderador ha ido ahí a mirar—», y al implementarlo
  **esa lectura no se sostuvo**: la ficha del backoffice se abre para cambiar el estado, leer
  denuncias o mirar la IP, y el vídeo es una de esas veces. Precargar megabytes en cada
  apertura para servir a unas pocas es el mismo cálculo que la ficha pública ya resolvió al
  revés. Hoy hay UN `VideoPlayer` para las dos, así que no hay dónde volver a separarlas —y
  de paso el backoffice ganó la validación de origen que le faltaba, que era la divergencia
  seria y no el `preload`.
- ~~El **listado** de `/admin/anuncios` no marca qué anuncios llevan vídeo~~. Ahora lo marca
  con el mismo indicador, y además **se puede filtrar**: sin el filtro se ve fila a fila,
  con él se despacha el lote.

### 2.5 Patrocinados — no comparten nada con el vídeo, y la razón importa

Hay que separar dos cosas que el encargo agrupaba:

**(a) El bloque «Promocionados» (H6.6 / política de ordenación C)** — son **anuncios reales
destacados**, no publicidad. [`FeaturedBlock`](../apps/web/src/components/busqueda/FeaturedBlock.tsx)
usa `ListingCard`, así que **hereda el indicador** (✅) y **hereda el veto al vídeo** — no
monta ningún `<video>`, igual que cualquier otra tarjeta. Se configura como cualquier
destacado (cuota Pro o pago), no hay nada específico que configurar en backoffice.

**(b) `SponsoredAd` — la publicidad de verdad.** Es **otra entidad**, no un anuncio:

```prisma
model SponsoredAd {
  imageUrl String   // UNA imagen, y nada más
  title, description, targetUrl  // enlace EXTERNO, pestaña nueva
  categoryId, order, active, startsAt, endsAt
}
```
([`schema.prisma:2269`](../apps/api/prisma/schema.prisma#L2269))

- **No tiene campo de vídeo, ni relación con `Listing`.**
- [`SponsoredCard.tsx`](../apps/web/src/components/anuncios/SponsoredCard.tsx) es marcado
  propio: `<Image>` + insignia gris «Publicidad», deliberadamente distinta del ámbar
  «Destacado». **No** usa `CardPhotoCarousel`.
- El formulario del backoffice
  ([`SponsoredAdFormDialog.tsx`](../apps/web/src/app/(admin)/admin/sponsored-ads/_components/SponsoredAdFormDialog.tsx))
  pide: imagen, título, descripción, URL destino, categoría, orden, vigencia.
  **No hay forma de señalar un vídeo** — el campo no existe en el modelo.

> **Conclusión:** «poner vídeo en los patrocinados» **no es heredar un veto, es un modelo de
> datos nuevo**. `SponsoredAd` tendría que ganar un campo de vídeo, una vía de subida (hoy solo
> sube imágenes por el camino de `/media/upload`) y una decisión de reproducción en una
> superficie donde hoy no hay ningún `<video>`. Es trabajo aparte del vídeo Pro, no una
> extensión suya.

---

## §3 — El hover-preview en tarjetas: viabilidad y veredicto

**No se diseña nada aquí. Se mide el coste.**

### 3.1 Qué exactamente está en colisión

Tres cosas, y conviene tenerlas separadas porque no todas cuestan lo mismo romperlas:

1. **La decisión de rendimiento.** Una página de búsqueda pinta ~24 tarjetas (`perPage` por
   defecto). Montar 24 `<video>` con URL —aunque fuera con `preload="metadata"`— son 24
   peticiones antes de que el usuario decida nada, sobre ficheros de hasta 50 MB. Es
   literalmente el riesgo que el diseño existente nombra como «el riesgo central de la
   auditoría».
2. **La garantía estructural.** Las tarjetas **no reciben la URL** — no por disciplina, sino
   porque `toSummary` la desestructura fuera y el documento de Meili no la lleva. Ese es el
   diseño: *sin dirección, no hay nada que descargar*.
3. **Los dos tests que lo fijan.** El unitario (`container.querySelector('video')` debe ser
   `null`) y el e2e de barrido (`JSON.stringify(res.body)` no debe contener
   `'listing-videos/'`). Cualquier hover-preview que entregue la URL en el payload de lista
   **rompe el e2e**, y cualquiera que monte un `<video>` en la tarjeta **rompe el unitario**.

Un dato relevante que descarta un malentendido posible: las URLs de vídeo son **públicas**
(`R2Service.getPublicUrl`, sin firma de lectura). Ocultarlas en el payload de lista es una
decisión de **rendimiento**, no de seguridad. Entregarlas por otra vía no abre ningún agujero.

### 3.2 Lo que haría falta, sea cual sea la vía

| Pieza | ¿Existe hoy? |
|---|---|
| Entregar *algo* reproducible a la tarjeta sin meterlo en el payload de lista | ❌ — haría falta un endpoint por anuncio o un campo nuevo |
| Restringir a escritorio (el hover no existe en móvil) | ❌ — no hay ninguna detección de puntero en el proyecto |
| Un artefacto ligero que reproducir | ❌ — solo existe el `.mp4` completo y el póster fijo |
| Generar ese artefacto en servidor | ❌ — **no hay `ffmpeg`** (verificado: las dependencias de `apps/api` son `sharp` para imágenes y nada más) |
| Generar artefactos en el navegador al subir | ✅ **parcialmente** — `captureVideoPoster` ya captura un fotograma con `<canvas>` |

### 3.3 Las tres vías, con su coste real

**Vía A — reproducir los primeros N segundos del `.mp4` completo en hover.**
Parece la simple. **Es la más peligrosa, y por un motivo que no se ve en el código.**

Un `<video>` no puede empezar a reproducir hasta encontrar el índice del fichero (el átomo
`moov`). Los MP4 **grabados con un móvil** lo escriben normalmente **al final**, porque
durante la grabación no se conoce el tamaño final. Con el índice al final, el navegador tiene
que recorrer el fichero para encontrarlo: en el peor caso, **descargar los 50 MB para
reproducir 3 segundos**. La solución estándar es reescribir el fichero con
`ffmpeg -movflags +faststart` — **y no hay `ffmpeg`**. Tampoco hay nada en `confirmUpload` que
reordene el fichero: solo hace `HEAD` y `CopyObject`
([`video.service.ts:162-185`](../apps/api/src/modules/video/video.service.ts#L162)).

*Esto es una propiedad de los ficheros, no del código, así que hay que medirlo con vídeos
reales antes de darlo por cierto en ambos sentidos.* Pero es exactamente el tipo de coste que
no aparece en la maqueta y aparece en producción, con la factura de ancho de banda que la
feature ya cuesta. **Coste: bajo de implementar, alto e impredecible en ejecución.**

**Vía B — generar un clip-resumen aparte al subir, en el servidor.**
Exige `ffmpeg`: nueva dependencia binaria, un procesador de cola nuevo, un segundo objeto en
almacenamiento por vídeo, y su limpieza en el borrado (`listingMediaKeys` tendría que
conocerlo). El proyecto ha rechazado `ffmpeg` **por escrito dos veces** —
[`video-limits.ts:28`](../apps/api/src/modules/video/video-limits.ts#L28) y
[`lib/api/video.ts:131`](../apps/web/src/lib/api/video.ts#L131) («extraer un frame exige
ffmpeg, y ffmpeg es justo la dependencia que este proyecto evita»). Traerlo para el hover
reabre esa decisión entera, y de paso resolvería F-2 y la Vía A. **Coste: alto. Decisión de
arquitectura, no una ráfaga.**

**Vía C — un póster animado, capturado en el navegador al subir.**
Es la vía que el encargo no contemplaba y la que el propio código ya insinúa. `captureVideoPoster`
ya hace exactamente esta operación para **un** fotograma: `<video>` oculto → `seek` →
`canvas.drawImage` → `toBlob`. Capturar **cuatro o seis** fotogramas repartidos por el vídeo es
el mismo bucle. El artefacto resultante (una animación corta o un sprite de fotogramas) pesa
**decenas de KB**, se sirve como imagen, **no monta ningún `<video>`** y por tanto:

- **no rompe el test unitario** (sigue sin haber `<video>` en la tarjeta);
- **no rompe el e2e** si lo que viaja en la lista es una URL de *imagen*, no de vídeo — aunque
  esto sí exige decidir si se mete en el payload de lista (una imagen más por tarjeta, que es
  lo que ya cuesta el `thumbnailUrl`) o se pide en hover;
- funciona en móvil también (donde el hover no existe, se puede simplemente no animar);
- no necesita `ffmpeg` ni toca el `.mp4`.

Lo que sí cuesta: un campo nuevo en `Listing`, un tercer objeto en almacenamiento por vídeo con
su limpieza, ampliar el flujo de subida (y el de confirmación) y una migración para los vídeos
ya subidos. **Coste: medio, y todo el trabajo está en terreno ya conocido.**

### 3.4 El detalle que hay que decidir antes de nada, valga la vía que valga

**Solo escritorio.** El hover no existe en táctil. Hoy el proyecto no distingue: haría falta
`@media (hover: hover) and (pointer: fine)` o equivalente. Es barato, pero es una decisión
consciente — significa que **el beneficio que se le vende al vendedor Pro no lo ve la mitad
del tráfico** de un marketplace, que es móvil.

### 3.5 Veredicto

> **No es imposible, y no es «muy complicado» — pero la vía que parecía obvia (reproducir un
> trozo del mp4) es la que hay que descartar**, porque sin `ffmpeg` no hay ninguna garantía de
> que «los primeros 3 segundos» no cuesten los 50 MB enteros, y eso es exactamente lo que la
> arquitectura actual se construyó para evitar.
>
> **La vía viable es la C (póster animado capturado en el navegador).** Cuesta un campo, un
> artefacto de almacenamiento más y una ampliación del flujo de subida, y a cambio **no
> traiciona ninguna de las dos garantías** ni obliga a tocar los tests que las fijan. Es la
> única de las tres que no exige reabrir una decisión de arquitectura ya tomada por escrito.
>
> **Recomendación de prioridad: no es lo primero.** Es pulido sobre una feature que **hoy no
> se puede ni encender** (§2.0) y que **no se anuncia en `/planes`** (§4.1). Cerrar esos dos
> huecos cuesta una fracción y hace que el vídeo Pro exista de verdad para un cliente. El
> hover viene después, y entonces la pregunta que Ernest dejó abierta —«si es muy complicado,
> lo descartamos»— se responde con un coste ya conocido en vez de con una intuición.

---

## §4 — Cómo se explican los beneficios Pro

### 4.1 `/planes` — la lista es honesta, y el vídeo no está en ella

La lista **ya no está escrita a mano**: se deriva en el backend de los `Setting` que de verdad
conceden cada ventaja (`buildProBenefits`,
[`billing.service.ts:1054`](../apps/api/src/modules/billing/billing.service.ts#L1054)), y la
página solo la pinta ([`planes/page.tsx:65`](../apps/web/src/app/(public)/planes/page.tsx#L65)),
con un respaldo mínimo por si la API no responde. El diseño es bueno: cada línea se emite
**solo si el ajuste la concede de verdad** (una cuota a 0 no se anuncia; el límite de anuncios
solo se promete si el de Pro supera al gratuito).

**Lo que lista hoy:**

| Beneficio anunciado | ¿Existe en código? |
|---|---|
| «Hasta N anuncios activos (en el plan gratuito, M)» | ✅ (solo si `pro > libres`) |
| «N destacados gratis al mes, de D días cada uno» | ✅ (solo si `> 0`) |
| «N bumps gratis al mes» | ✅ (solo si `> 0`) |
| «N% de créditos extra en cada pack» | ✅ |
| «N% de bumps extra en cada pack» | ✅ |
| «Estadísticas avanzadas: vistas por día, ratio de me gusta y agregados» | ✅ |
| «Soporte prioritario» | ❌ **no hay mecanismo** (§4.4) |
| **VÍDEO EN LOS ANUNCIOS** | ❌ **NO SE ANUNCIA** |

**E-1 · El vídeo no aparece en `/planes`, y el enganche está escrito y sin conectar.** El
comentario de `buildProBenefits` lo dice literalmente
([`billing.service.ts:1049`](../apps/api/src/modules/billing/billing.service.ts#L1049)):

> «AQUÍ SE CONECTARÁ EL VÍDEO PRO (proyecto 3): cuando exista su flag de admin, será una
> entrada condicional más de esta lista — `...(settingMap['proVideoEnabled'] ? [...] : [])` — y
> `/planes` la mostrará sin enterarse. Ese es todo el enganche.»

El flag existe (`videoEnabled`, no `proVideoEnabled`), la feature está construida — y la línea
nunca se añadió. **La ventaja que Ernest considera prioritaria es la única que la página de
precios no menciona.**

**E-2 · Las estadísticas sí están.** Contradice la duda del encargo: la línea «Estadísticas
avanzadas: vistas por día, ratio de me gusta y agregados» se emite siempre.

### 4.2 Los gates en uso — dos bien hechos, el resto ausentes

> **§4.2 CERRADA** (2026-08-24, rama `feat-gates-pro`). Los cinco sitios mudos (E-3 a E-6)
> cuentan ya el beneficio en el punto de fricción y con enlace a `/planes`. El molde de los
> dos gates que estaban bien hechos se extrajo a
> [`ProGate.tsx`](../apps/web/src/components/pro/ProGate.tsx) —`ProGate` para la pantalla
> bloqueada, `ProHint` para la pista de una línea— y ahora los siete usan el mismo, así que
> la próxima ventaja Pro no volverá a inventarse su forma.
>
> Dos hallazgos que aparecieron al arreglarlo y que la auditoría no había visto:
> **los mensajes de la puerta no llegaban a nadie** (`toUserMessage` los sustituía todos por
> «Ha ocurrido un error», así que ni el texto que sí existía se leía), y **la previsualización
> del bonus repetía la fórmula del checkout** — dos copias que podían prometer un número y
> acreditar otro.

El molde correcto —**el gate se VE, no se esconde**— está aplicado en dos sitios:

| Beneficio | Gate | Estado |
|---|---|---|
| **Vídeo** | [`StepVideo.tsx:62`](../apps/web/src/components/publicar/steps/StepVideo.tsx#L62) — cabecera + candado + «Añadir un vídeo a tus anuncios es una ventaja del plan Pro» + botón → `/planes` | ✅ **ejemplar** |
| **Estadísticas** | [`EstadisticasClient.tsx:176`](../apps/web/src/components/anuncios/EstadisticasClient.tsx#L176) — candado + «Disponibles con Pro: vistas por día, ratio de me gusta y el agregado» + «Hazte Pro» | ✅ |

**Son los dos únicos enlaces a `/planes` desde un gate en toda la aplicación.** El resto de
beneficios no explica nada:

**E-3 · El límite de anuncios activos no dice que Pro lo sube ni enlaza a `/planes`.** El
mensaje es «Has alcanzado el límite de N anuncios activos de tu plan»
([`active-listing-limit.rule.ts:80`](../apps/api/src/modules/listing-gate/rules/active-listing-limit.rule.ts#L80)).
«De tu plan» insinúa que hay otro plan, pero no lo dice ni ofrece la salida. Es **el momento
exacto** en que un vendedor gratuito descubre que le hace falta más sitio, y es el momento en
que menos se le cuenta. (Compárese con el mensaje del límite total, que sí «dice la salida»:
archivar o marcar como vendido.)

**E-4 · El bonus de créditos/bumps solo se ve si ya eres Pro.**
[`BumpPackList.tsx:86`](../apps/web/src/app/(account)/mis-creditos/_components/BumpPackList.tsx#L86):
`const bonusPreview = isPro ? … : 0`, y la línea «+ N de regalo por ser Pro» se pinta solo si
`bonusPreview > 0`. **Un no-Pro comprando bumps no ve en ningún sitio que como Pro le habrían
regalado un 20% más.** El dato está a mano (`catalog.proExtraBumpsPercent` ya llega a la
página) y no se usa para convencer a nadie.

**E-5 · Los packs de CRÉDITOS no previsualizan el bonus para nadie.**
[`PackList.tsx`](../apps/web/src/app/(account)/mis-creditos/_components/PackList.tsx) no recibe
`isPro` ni menciona `proExtraCreditsPercent`. El bonus **sí se aplica** al cobrar
(`computeProBonus`), pero ni un Pro ve el «+20%» antes de comprar, ni un no-Pro sabe que
existe. Es asimétrico con los packs de bumps, que sí lo hacen a medias.

**E-6 · Las cuotas mensuales solo se cuentan a quien ya las tiene.**
[`MisAnunciosClient.tsx:103`](../apps/web/src/components/anuncios/MisAnunciosClient.tsx#L103)
pinta el recordatorio de destacados y bumps gratis **dentro de un `proStatus.isPro &&`**. El
`PromocionarDialog` ofrece «Destacar gratis — cuota Pro» solo si hay cuota. Un no-Pro que abre
el diálogo de promocionar ve únicamente el precio, sin ninguna señal de que Pro incluiría
varios gratis al mes — que es, según la propia `buildProBenefits`, «el beneficio que más se
nota».

### 4.3 Dónde se explica bien lo que el Pro manual no tiene

Justo es reconocerlo: en el backoffice, la asimetría de la cuota **se explica con su nombre**
(«Sin cuota mensual: las gratuidades … cuelgan de un ciclo de facturación, y una concesión del
equipo no lo tiene», `BloqueDinero`, `data-testid="pro-sin-cuota"`). Al **admin** se le cuenta.
Al **usuario** no se le cuenta nada (H-1, §1.5).

### 4.4 Una promesa sin mecanismo — **CERRADA** (2026-08-25)

> **Ya hay mecanismo.** Los tickets de un cliente Pro llegan **marcados** a la bandeja del
> staff, que además puede **aislar esa cola** con un filtro; y el texto de `/planes` se
> ajustó a lo que eso cumple —«tus consultas destacan»— en vez de a un plazo que nadie
> puede garantizar en código. Sigue sin haber SLA **a propósito**: marcar se puede
> garantizar, responder en X horas depende de cuánta gente haya. Lo de abajo queda como
> estaba el día de la auditoría.


«**Soporte prioritario**» se anuncia en `/planes` incondicionalmente
([`billing.service.ts:1101`](../apps/api/src/modules/billing/billing.service.ts#L1101)), y el
propio comentario admite que no sale de un `Setting` sino de «política de soporte». Verificado:
**el módulo de tickets no consulta `isProActive` ni los entitlements en ningún punto** — no hay
prioridad, ni orden, ni SLA, ni marca de Pro en la cola de tickets. Es una promesa que hoy solo
puede cumplir una persona acordándose. No es urgente arreglarla en código, pero conviene saber
que se está prometiendo.

---

## Lista priorizada de huecos

Ordenada por **(daño real) ÷ (coste de cerrarlo)**. Cada uno con su ubicación.

> **Privacidad: las dos fugas están CERRADAS** (24-08-2026). El «Hallazgo colateral» (`phone`
> por `GET /favorites`) y el «Hallazgo NUEVO y MÁS GRAVE» (`phoneNormalized` y `lastOwnerIp`
> por la ficha pública, sin sesión) se arreglaron por la raíz, en ese orden, antes de tocar
> nada de Pro. Los dos están al final de este documento. **El siguiente en la lista es el
> hueco #1: encender el vídeo.**

### Bloqueantes — el vídeo Pro hoy no existe para un cliente

| # | Hueco | Dónde | Por qué primero |
|---|---|---|---|
| **1** | **No hay interruptor de `videoEnabled` en el backoffice** — la clave está en el whitelist del backend pero no en la lista que pinta la página de ajustes, y la semilla de producción no la crea | [`ajustes/page.tsx:914`](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L914) vs. [`admin.service.ts:194`](../apps/api/src/modules/admin/admin.service.ts#L194); [`seed.ts:452`](../apps/api/prisma/seed.ts#L452) | Toda la feature es inalcanzable. Es una entrada en un array |
| ~~**2**~~ | ~~**El vídeo no se anuncia en `/planes`**~~ — **CERRADO** (2026-08-24, rama `feat-video-visible`). El enganche comentado llevaba el flag EQUIVOCADO (`proVideoEnabled`; el real es `videoEnabled`), así que copiarlo tal cual habría fallado en silencio. La línea se emite ahora sólo si la feature está encendida, con la duración que el servidor valida de verdad | [`billing.service.ts`](../apps/api/src/modules/billing/billing.service.ts) · [`planes-anuncia-video.e2e-spec.ts`](../apps/api/test/planes-anuncia-video.e2e-spec.ts) | — |

### Altos — el beneficio existe pero no se ve donde importa

| # | Hueco | Dónde |
|---|---|---|
| ~~**3**~~ | ~~**`/mis-anuncios` no marca qué anuncios llevan vídeo**~~ — **CERRADO** (2026-08-24): el indicador se extrajo a [`VideoIndicator`](../apps/web/src/components/anuncios/VideoIndicator.tsx) y esta tarjeta lo pinta | [`mis-anuncios-indicador-video.test.tsx`](../apps/web/src/components/anuncios/mis-anuncios-indicador-video.test.tsx) |
| ~~**4**~~ | ~~**`/favoritos` no puede pintar el indicador**: es la única lista que no pasa por `toSummary`~~ — **CERRADO** (2026-08-24, rama `fix-fuga-favoritos`): al arreglar la fuga de privacidad por la raíz, `/favorites` pasa a servir `toSummary` y gana `hasVideo`; `ListingCard` ya lo consumía, así que el indicador se pinta solo. Ver «Hallazgo colateral» | [`listing-summary.ts`](../apps/api/src/modules/listings/listing-summary.ts) |
| ~~**5**~~ | ~~**El Pro manual ve una página de suscripción vacía**~~ — **CERRADO** (2026-08-24): la página tenía dos ramas y el caso se caía por el hueco; ahora las tres se deciden en [`plan-actual.ts`](../apps/web/src/app/(account)/perfil/suscripcion/_components/plan-actual.ts) | [`plan-actual.test.tsx`](../apps/web/src/app/(account)/perfil/suscripcion/_components/plan-actual.test.tsx) |
| ~~**6**~~ | ~~**El Pro manual no puede pasarse a Pro de pago**~~ — **CERRADO** (2026-08-24): el botón miraba `isPro` y ahora mira `hasActiveSubscription`, calculado con el MISMO predicado que el guard del checkout | [`CheckoutButton.test.tsx`](../apps/web/src/app/(public)/planes/_components/CheckoutButton.test.tsx) · [`pro-manual-paridad.e2e-spec.ts`](../apps/api/test/pro-manual-paridad.e2e-spec.ts) |
| ~~**7**~~ | ~~**El límite de anuncios no explica ni enlaza a `/planes`**~~ — **CERRADO** (2026-08-24, rama `feat-gates-pro`): el mensaje dice ahora cuánto da Pro (sólo a un no-Pro, y sólo si de verdad da más), y la tarjeta añade el enlace. De paso, los mensajes de la puerta ya LLEGAN al usuario: `toUserMessage` los sustituía todos por «Ha ocurrido un error» | [`gates-pro-explican.e2e-spec.ts`](../apps/api/test/gates-pro-explican.e2e-spec.ts) |

### Medios — descubrimiento y conversión

| # | Hueco | Dónde |
|---|---|---|
| ~~**8**~~ | ~~**El bonus de packs solo se le enseña a quien ya es Pro**~~ — **CERRADO** (2026-08-24): las dos monedas simétricas, y el número lo sirve el catálogo con la MISMA función que congela el checkout ([`pro-bonus.ts`](../apps/api/src/modules/billing/pro-bonus.ts)) — se acabó la fórmula duplicada | [`gates-pro.test.tsx`](../apps/web/src/components/pro/gates-pro.test.tsx) |
| ~~**9**~~ | ~~**Las cuotas gratis no se anuncian a quien no las tiene**~~ — **CERRADO** (2026-08-24): se anuncian en /mis-anuncios y en el diálogo de promocionar, con la cifra configurada y el texto honesto con D-1 («suscribiéndote», porque un Pro concedido no tiene cuota). De paso, a un Pro manual ya no se le dice «has usado tus destacados gratis» sobre unos que nunca tuvo | [`gates-pro.test.tsx`](../apps/web/src/components/pro/gates-pro.test.tsx) |
| ~~**10**~~ | ~~**`hasVideo` no es filtrable** en Meilisearch~~ — **CERRADO** (2026-08-24): filtro OPCIONAL (`?conVideo=true`) con casilla en el panel; comprobado contra el índice REAL, no contra la constante. De paso quedó una barrera ESTRUCTURAL del `waitForTask` de los settings: era una carrera que ningún e2e podía cazar (en local Meili la gana siempre) | [`busqueda-filtro-video.e2e-spec.ts`](../apps/api/test/busqueda-filtro-video.e2e-spec.ts) · [`search.service.settings.spec.ts`](../apps/api/src/modules/search/search.service.settings.spec.ts) |
| ~~**11**~~ | ~~**Nada avisa de que el vídeo se añade al editar, no al publicar**~~ — **CERRADO** (2026-08-25): el asistente lo dice en el paso de Fotos, y con dos voces — al Pro **dónde** (información, sin enlace a `/planes`: a quien ya paga, un CTA sugiere que le falta algo); al que no lo es, la ventaja con su salida (`ProHint`). **El paso de vídeo NO se añade al asistente, y no por pereza**: `StepVideo` sube contra un `listingId` y en el asistente el anuncio aún no existe — meterlo exigiría una subida en dos tiempos con su propia clase de huérfanas. El backend era coherente; lo que faltaba era decirlo | [`AvisoVideo.tsx`](../apps/web/src/components/publicar/AvisoVideo.tsx) · [`video-flecos.test.tsx`](../apps/web/src/components/anuncios/video-flecos.test.tsx) |

### Bajos — conocidos, acotados o cosméticos

| # | Hueco | Nota |
|---|---|---|
| ~~**12**~~ | ~~Las dos tarjetas del **mapa** no pintan el indicador~~ — **CERRADO** (2026-08-24). Vivían dentro de `MapView` (importa `maplibre-gl`), así que ninguna prueba podía alcanzarlas: se extrajeron a `MapCards.tsx` y ahora tienen barrera propia | [`MapCards.test.tsx`](../apps/web/src/components/busqueda/MapCards.test.tsx) |
| ~~**13**~~ | ~~El **listado** de `/admin/anuncios` no marca qué anuncios llevan vídeo~~ — **CERRADO** (2026-08-25): el MISMO `VideoIndicator`, en variante `inline` (la tabla no tiene foto sobre la que superponerlo, y escribir un cuarto `<span>` a mano era el defecto que la extracción cerró). **Y con filtro**: `?conVideo=` tri-estado, porque con la píldora se ve el vídeo fila a fila y con el filtro se despacha el lote — que es lo que pedía el hueco («priorizar o filtrar desde la cola»). No reusa el `conVideo` de `/search`: aquél filtra en Meili, que sólo indexa ACTIVE. El servidor sirve `hasVideo` derivado y **borra `videoUrl` del payload**, molde exacto de `ipFlagged` | [`video-fleco-listado-admin.e2e-spec.ts`](../apps/api/test/video-fleco-listado-admin.e2e-spec.ts) |
| ~~**14**~~ | ~~El reproductor del backoffice **no** lleva `preload="none"`~~ — **CERRADO** (2026-08-25), y la divergencia **no era deliberada**: al mirarla de cerca, el argumento a favor de precargar («el moderador ha ido ahí a mirar») no se sostiene, porque esa ficha se abre para mil cosas y el vídeo es una. Se extrajo `VideoPlayer`, que usan las dos superficies. **La divergencia que de verdad importaba era la otra**: la ficha pública validaba el origen con `isSafeSrc` y el backoffice pintaba la URL en crudo — y un `<video src>` no pasa por `remotePatterns`, así que era su única barrera de dominio en el cliente | [`video-flecos.test.tsx`](../apps/web/src/components/anuncios/video-flecos.test.tsx) |
| ~~**15**~~ | ~~«**Soporte prioritario**» se promete sin ningún mecanismo en código~~ — **CERRADO** (2026-08-25): la bandeja del staff MARCA los tickets de clientes Pro y esa cola se puede aislar con un filtro. La marca refleja «es Pro **AHORA**», no «lo era al abrir»: quien dejó de pagar deja de destacar, y quien se hizo Pro hoy destaca en su ticket de ayer. **Marcar NO es reordenar** —el orden por defecto sigue siendo `lastMessageAt desc`—, y el texto de `/planes` se ajustó a lo que el mecanismo cumple: «tus consultas destacan», nunca un plazo. Un SLA es operativa (depende de cuánta gente haya) y el código no puede garantizarlo | [`pro-marca-tickets.e2e-spec.ts`](../apps/api/test/pro-marca-tickets.e2e-spec.ts) |
| **16** | La **duración** se valida declarada, no medida (sin `ffmpeg`) | frontera **aceptada y escrita**, no un hueco |

### Decisiones de producto pendientes (no son bugs)

- **¿Un Pro manual debe tener cuota mensual de destacados y bumps?** Hoy no (D-1). El hueco
  para un tercer valor de `quotaSource` ya está previsto.
- **¿Se hace el hover-preview?** Ver el veredicto de §3.5.
- **¿Se trae `ffmpeg`?** Es la decisión que desbloquearía a la vez la Vía B del hover, la
  validación real de duración y el `faststart`. Hoy está rechazada por escrito dos veces.

---

## Hallazgo colateral — **CERRADO** (2026-08-24, rama `fix-fuga-favoritos`)

Al verificar el hueco #4 se vio que `GET /favorites` devolvía el `Listing` con un `include`
crudo, es decir **todos los escalares de la fila**: `videoUrl`, `videoPosterUrl`,
`phoneNormalized`, `lastOwnerIp`, `triage`, `watched`, `needsRevalidation` — y **`phone`**, el
teléfono publicado del anuncio, que la ficha descarta explícitamente con un comentario
«PRIVACIDAD — CRÍTICO» y que sólo debe salir por `GET /listings/:id/phone`, **autenticado,
limitado por hora (por usuario y por IP) y sólo para anuncios ACTIVE**. Por la puerta de
favoritos salía sin límite, sin registro, veinte por página y fuera cual fuera el estado del
anuncio: marcar favoritos era un recolector de teléfonos que esquivaba el rate limit hecho
para impedirlo. La misma fuga estaba en `POST /favorites/:listingId`, que compartía el
`include`.

**Se cerró por la RAÍZ, no quitando `phone` a mano.** «Lo que una tarjeta puede ver»
(`SELECT_SUMMARY` + `toSummary`) era privado de `ListingsService`, así que la undécima lista
no tenía nada que reutilizar; ahora vive en
[`listing-summary.ts`](../apps/api/src/modules/listings/listing-summary.ts), un fichero sin
módulo, y `FavoritesService` pide el MISMO `select` de lista blanca y pasa por la MISMA
función. Un campo sensible nuevo en `Listing` ya no puede salir por ahí porque **no se
selecciona**. De paso, favoritos ganó `hasVideo` (hueco #4) y la media del vendedor. El
barrido e2e que cazaba URLs de vídeo, que sólo corría contra `/users/me/listings` —por eso no
cazó esto—, cubre ahora también `/favorites` y comprueba explícitamente la ausencia del
teléfono.

---

## Hallazgo NUEVO y MÁS GRAVE — **CERRADO** (2026-08-24, rama `fix-fuga-ficha-publica`)

**Descubierto al cerrar el anterior, y era peor: no requería autenticación.**

`GET /api/listings/:slug` usa `include: LISTING_INCLUDE` y sólo descarta dos campos
(`const { phone, tags, ...publicListing } = listing`,
[`listings.service.ts:1188`](../apps/api/src/modules/listings/listings.service.ts#L1188)). Todo
lo demás sale. **Verificado empíricamente** contra el endpoint real (anuncio de prueba con
teléfono `600999888` e IP `198.51.100.7`):

```
phone:             undefined   ← el destructuring «PRIVACIDAD — CRÍTICO» funciona…
phoneNormalized:   '600999888' ← …y el MISMO número sale por la columna hermana
lastOwnerIp:       '198.51.100.7'
triage:            'NEW'
watched:           true
needsRevalidation: false
lastOwnerInteractionAt, latitude, longitude, updatedAt… también
```

Por qué es más grave que el de favoritos:

- **Es público.** Sin sesión, sin rate limit, sin registro. El de favoritos al menos exigía
  estar autenticado y marcar el anuncio.
- **La protección existe y está derrotada por una columna hermana.** `phoneNormalized` es el
  mismo teléfono «sin prefijo ni separadores» (schema.prisma): filtrar `phone` y dejar pasar
  `phoneNormalized` no protege nada.
- **`lastOwnerIp` es la IP del vendedor**, y el propio backoffice la trata como dato de staff
  que no se sirve («la lista enseña si está marcada, no cuál es», `AdminService`).
- **Va a la caché de Redis.** El blob de la ficha se guarda ya con estos campos dentro, así
  que arreglarlo exige invalidar (o esperar el TTL de 5 min).
- `triage` y `watched` son **etiquetas internas de moderación** expuestas al denunciado.

**Cómo se cerró.** El mismo movimiento que en favoritos, y la fuga era más ancha de lo que
parecía: al medirla endpoint por endpoint resultó vivir en **siete** rutas, no en dos. Además
de la ficha pública, las nueve acciones del ciclo de vida del dueño (editar, publicar,
reservar, pausar, reactivar, archivar, renovar, cerrar y deshacer un trato) y `POST /listings`
devolvían la fila cruda que acababan de escribir, con `triage` y `watched` dentro — notas del
equipo servidas a la persona sobre la que se han tomado.

`LISTING_INCLUDE` desaparece y lo sustituyen dos listas blancas en
[`listing-summary.ts`](../apps/api/src/modules/listings/listing-summary.ts), junto a la de la
tarjeta: `LISTING_PUBLIC_SELECT` (visitante) y `LISTING_OWNER_SELECT` (dueño: su teléfono sí,
las notas del equipo no). Las acciones del ciclo de vida NO estrechan su `select` —su lógica
interna lee campos que el cliente no debe ver— sino que aplican la lista blanca al SALIR, en
un único envoltorio del controlador (`gestionDeAnuncio`). La caché de fichas se purga sola al
arrancar (`ListingsService.onModuleInit`), así que un blob guardado con la forma vieja no
sobrevive al despliegue.

El barrido vive ahora en
[`privacidad-payloads.e2e-spec.ts`](../apps/api/test/privacidad-payloads.e2e-spec.ts): la
matriz entera de superficies × campos prohibidos, con asercion doble (por nombre y por valor)
y un requisito de oro que recorre las seis puertas que sirven anuncios.

---

## Lo que NO entra en esta auditoría (pero está en el encargo)

Dos features que Ernest ha mencionado y que son **diseño nuevo**, no inventario de lo
existente:

1. **La estadística «veces listado» para Pro** (impresiones en resultados de búsqueda). No
   existe nada parecido hoy: `viewCount` cuenta visitas a la ficha (con dedup en Redis,
   `trackView`) y `ListingViewDaily` guarda el diario, pero **nadie cuenta apariciones en una
   lista**. Contar impresiones en una plataforma read-heavy con caché de búsqueda es un diseño
   con enjundia propia (dónde se cuenta, cómo se agrega, qué coste tiene en la ruta caliente).
   **Diseño aparte.**
2. **El backoffice de estadísticas** (anuncios / usuarios / categorías / monitoreo). Feature
   grande y nueva. **Diseño aparte.**

Ninguna de las dos cambia nada de lo inventariado aquí; se anotan para que consten como
pendientes reconocidos y no se confundan con huecos de lo ya construido.
