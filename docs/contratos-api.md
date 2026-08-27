# Contratos de la API — Marketplace

> **Referencia ACTUAL, verificada endpoint a endpoint contra los `*.controller.ts` reales el
> 2026-08-04** (rama `main`, commit `ff333ab`). Ningún endpoint de este documento se ha escrito
> sin haberlo visto en su controlador.
>
> **Donde este documento y el código difieran, gana el código.** Si encuentras una discrepancia,
> corrige el documento, no el código.
>
> **Fuente de verdad navegable:** Swagger en `http://localhost:3001/api/docs` (auto-generado
> desde controladores y DTOs). Este documento es el **resumen de diseño de alto nivel**: qué
> recursos y operaciones existen, para qué sirven, y las decisiones que no son obvias leyendo
> solo las rutas. Para el detalle de campos, validaciones y tipos de respuesta exactos, Swagger.
>
> **Estado de lo implementado:** `docs/estado-tecnico.md`. **Lo que falta por construir:**
> `docs/pendientes.md`.

<details>
<summary><strong>Qué cambió en la revisión del 2026-08-04</strong> (auditoría de documentación)</summary>

La versión anterior se leía como referencia vigente y llevaba tiempo sin serlo. Se corrigió:

- **Endpoint muerto retirado:** `POST /listings/:id/sold` ya no existe. El paso a vendido se
  hace declarando un `Deal` — ver «Ciclo de vida y tratos».
- **Geocoding:** decía «timeout de 1,5 s» de forma síncrona. Es **asíncrono** en cola BullMQ
  desde H6, y el timeout es de **3 000 ms**.
- **`renew`:** decía que reinicia `publishedAt`. **No lo reinicia** — preservarlo es
  deliberado.
- **Atributos de búsqueda:** estaban como lista fija cableada. Son **dinámicos por categoría**
  desde RÁFAGA 0, con rangos `_min`/`_max`, y `type` se renombró a `itemType`.
- **Cobertura:** el documento cubría 8 recursos de los 29 módulos del backend. Ahora están los
  **25 con API HTTP**, más los 4 internos declarados como tales.

</details>

---

## Convenciones generales

- **Base URL:** `/api` (`app.setGlobalPrefix('api')` en `main.ts`). Las rutas de este documento
  se escriben **sin** ese prefijo: `POST /auth/login` es `POST /api/auth/login`.
- **Formato:** JSON en peticiones y respuestas, salvo subida de archivos (`multipart/form-data`).
- **Autenticación:** JWT en cabecera `Authorization: Bearer <token>`. Los endpoints marcados
  *(auth)* la requieren; *(propietario)* exige además ser el dueño del recurso.
- **Roles:** `USER | MODERATOR | ADMIN | EDITOR`. Donde un endpoint exige rol se indica
  *(ADMIN)*, *(MODERATOR+)*, etc. **El guard de rol y el middleware del frontend son dos capas
  distintas**: el middleware protege la UI, el guard protege los datos.
- **Paginación:** `?page=1&perPage=24`. Respuesta: `{ items, total, page, perPage }`
  (búsqueda: `{ hits, totalHits, page, hitsPerPage }`).
- **Errores:** formato estándar de NestJS — `{ statusCode, message, error }`. Los errores de
  negocio con reacción específica en el cliente llevan además un `code` estable
  (p. ej. `ALREADY_FEATURED`, `TICKET_BILLING_ADMIN_ONLY`) — **mapear por `code`, nunca por el
  texto del mensaje.**
- **Orden de declaración de rutas:** en varios controladores las rutas literales se declaran
  **antes** que las paramétricas (`GET /tickets/topics` antes de `GET /tickets/:id`,
  `GET /admin/categories/searchable-keys` antes de `PATCH /admin/categories/:id`). No es
  cosmético: al revés, Nest capturaría el segmento literal como parámetro.

---

## Auth

- **`POST /auth/register`** — Crea la cuenta (no verificada) y envía el email de verificación.
- **`POST /auth/login`** — Devuelve `{ accessToken, user }`. `user` incluye `emailVerified`,
  para que el frontend pueda mostrar el aviso sin una llamada adicional.
- **`POST /auth/admin-login`** — Login del backoffice, separado del público.
- **`POST /auth/verify-email`** — Marca el email como verificado y devuelve
  `{ verified: true, accessToken }` con un token nuevo ya firmado con `emailVerified: true`,
  evitando un segundo login.
- **`POST /auth/forgot-password`** — Siempre responde `{ ok: true }` aunque el email no exista
  (nunca revela si una cuenta existe).
- **`POST /auth/reset-password`** — Invalida el token tras su uso (`usedAt`).
- **`POST /auth/social/google`** — Login social con Google. Vincula con una cuenta existente del
  mismo email vía la tabla `Account` (`provider` + `providerAccountId`); `User.passwordHash` es
  nullable, así que una cuenta puede nacer solo con Google.
- **`POST /auth/change-password`** *(auth)* — Cambiar contraseña conociendo la actual.
- **`POST /auth/set-password`** *(auth)* — Fijar contraseña por primera vez. Es el caso de quien
  entró por Google y todavía no tiene `passwordHash`.

`register`, `login`, `admin-login` y `forgot-password` reciben la IP para el rate limit.

---

## Users

- **`GET /users/me`** *(auth)* — Perfil completo del usuario autenticado.
- **`PATCH /users/me`** *(auth)* — Actualiza nombre, teléfono, bio, ubicación, avatar y datos
  fiscales.
- **`GET /users/me/listings`** *(auth)* — Mis anuncios (todos los estados), paginados. Acepta
  `?status=`. Cada ítem lleva, además del resumen público, los campos de gestión que solo ve el
  propietario: `featuredUntil`, `favoritesCount` y **`nextBumpAt`** (ver «Promoción»).
- **`GET /users/search`** *(auth)* — Buscador de usuarios. Lo usa el backoffice para elegir
  destinatario al abrir un ticket con un usuario concreto (flujo (b)).
- **`GET /users/:slug`** — Perfil público del vendedor (nombre, bio, ubicación, fecha de
  registro, y los distintivos `trusted` / Pro). Sin datos privados.
- **`GET /users/:slug/listings`** — Anuncios activos del vendedor, paginados.
- **`GET /users/:slug/reviews`** — Reseñas recibidas: cursor paginado + agregado calculado al
  vuelo (media, total y distribución 1–5).

> `GET /users/search` se declara **antes** que `GET /users/:slug`, o `search` se interpretaría
> como un slug de usuario.

---

## Categories

- **`GET /categories`** — Árbol jerárquico completo (una sola llamada, sin paginación). Incluye
  por categoría `cardAttributes` (1-2 atributos destacados de la tarjeta) y `allAttributes`
  (el esquema completo, para que el panel del mapa pinte todos los atributos sin un fetch
  extra).
- **`GET /categories/:slug`** — Detalle con el **esquema efectivo**: herencia padre→hijo, donde
  el hijo sobreescribe el campo con el mismo `name`. Incluye también los ejes configurables por
  categoría: `allowedViews`/`defaultView` (vistas de resultados) y `allowedPriceUnits`
  (formatos de precio). El frontend lo usa para el wizard de publicación y los filtros.
- **`GET /categories/:slug/tags`** — Etiquetas asociadas a la categoría (con herencia), para el
  panel de filtros y el paso de etiquetas del wizard.
- **`GET /categories/:slug/listings`** — Listado paginado de anuncios activos de la categoría.
  Acepta `?sort=`. **Es la ruta de respaldo**: la página de categoría usa normalmente
  `GET /search?category=`, y solo cae aquí si Meilisearch no responde (entonces se muestran
  resultados básicos sin facetas ni filtros).

> **El árbol tiene exactamente 2 niveles.** El backend lo garantiza (`assertParentIsRoot`) y
> toda la resolución de herencia lo asume.

---

## Listings (anuncios)

### Ciclo de vida

```
DRAFT ──publish──▶ ACTIVE ──reserve──▶ RESERVED
                     │  ▲                  │
                     │  └──reactivate──┐   │
              pause  ▼                 │   │
                   PAUSED ─────────────┘   │
                     │                     │
                     └── deals ────────────┘
                          │
     PRODUCT → SOLD  ·  SERVICE → sigue ACTIVE

ACTIVE ──(cron, expiresAt)──▶ EXPIRED ──renew──▶ ACTIVE
cualquiera ──archive──▶ ARCHIVED   (permanente, irreversible)
PENDING_REVIEW / REJECTED: estados de moderación
```

`ListingStatus` real: `DRAFT | PENDING_REVIEW | ACTIVE | RESERVED | SOLD | EXPIRED | REJECTED |
PAUSED | ARCHIVED`. Caducidad a 60 días desde `publishedAt`; los `RESERVED` **no** caducan (el
cron solo mira `ACTIVE`), y los `PAUSED` tampoco — al reactivar se recalcula `expiresAt`.

### CRUD y estado

- **`POST /listings`** *(auth)* — Crea en `DRAFT`. Acepta `imageIds` (imágenes ya subidas),
  `tags` y coordenadas opcionales. **El geocoding NO bloquea la petición**: se guarda
  `lat/lng = null`, se responde de inmediato y se encolan dos jobs BullMQ en orden FIFO —
  `geocode` (escribe las coordenadas en Postgres) y después `index` (una sola escritura a
  Meilisearch con `_geo` ya presente). Un anuncio recién publicado puede tardar unos segundos
  en aparecer en el mapa. Timeout del proveedor de geocoding: **3 000 ms**.
- **`PATCH /listings/:id`** *(auth, propietario)* — Edición parcial. Si cambia la ubicación sin
  coordenadas explícitas, re-encola la misma pareja `[geocode, index]` en el mismo orden.
- **`POST /listings/:id/publish`** *(auth, propietario)* — Pasa a `ACTIVE` (o a
  `PENDING_REVIEW` si la moderación automática lo retiene), fija `publishedAt` y
  `expiresAt = publishedAt + 60 días` e indexa. **Verifica el límite de anuncios activos del
  plan** (free y pro, leídos de `Setting`) → `403` si se supera.
- **`POST /listings/:id/reserve`** *(auth, propietario)* — Pasa a `RESERVED`.
- **`POST /listings/:id/pause`** *(auth, propietario)* — Pasa a `PAUSED`: retirada **temporal y
  reactivable**. No cuenta para la cuota de activos y no se indexa.
- **`POST /listings/:id/reactivate`** *(auth, propietario)* — `PAUSED → ACTIVE`, recalculando
  `expiresAt`.
- **`POST /listings/:id/archive`** *(auth, propietario)* — Pasa a `ARCHIVED`: retirada
  **permanente e irreversible**, alternativa no destructiva a borrar.
- **`POST /listings/:id/renew`** *(auth, propietario)* — Reinicia `expiresAt` desde ahora.
  **NO reinicia `publishedAt`**: preservarlo es deliberado — resetearlo sería un bump gratuito
  que vaciaría de sentido el bump de pago. También verifica el límite de activos del plan.
- **`DELETE /listings/:id`** *(auth, propietario)* — Elimina y retira del índice. `204`.

### Tratos (`Deal`) — cómo se marca vendido hoy

**`POST /listings/:id/sold` ya no existe.** Lo sustituye la declaración de un trato: una acción,
un camino, y a la vez el registro que habilita valorar.

- **`POST /listings/:id/deals`** *(auth, propietario)* — Cierra un trato. Body: `{ buyerId? }`.
  `201`. Reglas verificadas en el servicio:
  - Solo desde `ACTIVE` o `RESERVED` (si no, `400`).
  - **Un `SERVICE` exige `buyerId`**; un `PRODUCT` puede cerrarse sin comprador (venta a alguien
    de fuera de la plataforma).
  - `buyerId` no puede ser el propio vendedor.
  - **Efecto en el estado según el tipo:** `PRODUCT → SOLD`; **`SERVICE` sigue `ACTIVE`** —un
    servicio se puede prestar muchas veces, y por eso `Deal` no tiene restricción de unicidad.
  - Si hay `buyerId`, crea el `Deal` y **el servidor enlaza por sí mismo la `Conversation`** que
    ya exista entre esas dos partes sobre ese anuncio. **Nunca acepta un `conversationId` del
    cliente**: admitirlo permitiría fabricar un trato con apariencia de «verificable» adjuntando
    una conversación arbitraria, que es justo el hueco que `Deal` existe para cerrar.
  - Dispara aviso de valoración **a las dos partes** (`Notification REVIEW_REQUEST` + email).
- **`GET /listings/:id/deals`** *(auth, propietario)* — Tratos cerrados de ese anuncio.
- **`DELETE /listings/:id/deals/:dealId`** *(auth, propietario)* — Deshace un trato.
- **`GET /listings/:id/contacts`** *(auth, propietario)* — Contactos del anuncio; alimenta el
  selector rápido de comprador/cliente al cerrar un trato.

> `Deal.listingId` es `SetNull` con `listingTitle` congelado: **un trato sobrevive al borrado del
> anuncio**, porque es evidencia de reputación. Mismo molde que `Review.listingId`.

### Promoción

- **`POST /listings/:id/bump`** *(auth, propietario)* — Sube el anuncio actualizando `bumpedAt`.
  Cooldown de 1 h → `429` con `Retry-After`. Se paga con la cuota gratuita mensual de Pro si
  queda, y si no con créditos, en una transacción atómica. Los fallos `402`/`403`/`400` **no**
  consumen el cooldown. Invalida la caché de la ficha (`listing:${slug}`) al terminar, para que
  `nextBumpAt` no quede viejo 5 min.

> **`nextBumpAt` — la ventana de cooldown es del backend, el frontend no la deriva (UXV.1/A2).**
> `GET /users/me/listings` (tarjeta de «mis anuncios») y `GET /listings/:slug` (ficha, vista del
> dueño) devuelven `nextBumpAt`: el instante en que el anuncio vuelve a ser bumpeable, derivado
> de `bumpedAt` + `BUMP_COOLDOWN_SECONDS` (`modules/billing/bump-cooldown.ts`, la misma constante
> que aplica el guard del `429`). `null` = nunca bumpeado. El cliente **solo lo compara con el
> reloj**: cuando cada superficie calculaba su propia ventana, la tarjeta bloqueaba 24 h contra
> la 1 h real del backend.
- **`GET /listings/:id/phone`** *(auth)* — Devuelve el teléfono publicado del anuncio.
  Rate limit **30/h por usuario y 60/h por IP**; `404` si el anuncio no está `ACTIVE` o no tiene
  teléfono.

> **Privacidad del teléfono — es un contrato, no un detalle.** `Listing.phone` (publicado,
> opcional) es distinto de `User.phone` (privado). `GET /listings/:slug` **descarta el teléfono
> antes de cachear y de responder** —con un destructuring explícito, no hay una capa de
> serialización posterior que lo filtre— y expone únicamente `hasPhone: boolean`. El número real
> solo sale por este endpoint, autenticado y limitado. El email **nunca** se expone.

### Lectura

- **`GET /listings`** — Anuncios recientes (solo `ACTIVE`), paginados.
- **`GET /listings/:slug`** — Ficha pública (solo `ACTIVE`). Servida con caché Redis de 5 min.
  Sin el teléfono (ver arriba). `featuredUntil` y `nextBumpAt` se calculan **fuera** del blob
  cacheado, así que son siempre frescos (y los payloads guardados antes del despliegue también
  los llevan).
- **`GET /listings/mine/:id`** *(auth, propietario)* — Ficha completa para precargar el wizard de
  edición. Incluye `featuredUntil` y `bumpedAt`, que el propietario necesita y el payload público
  no lleva.
- **`POST /listings/:slug/view`** *(auth opcional)* — Registra una visita. `204`. Auth
  **opcional** a propósito: cuenta visitantes anónimos, pero necesita saber si hay sesión para
  **excluir al propio dueño**. El cliente lo llama al montar la ficha, desacoplado del render
  cacheado.
- **`GET /listings/mine/stats/summary`** *(auth)* — Resumen de estadísticas de todos mis
  anuncios.
- **`GET /listings/mine/:id/stats`** *(auth, propietario)* — Estadísticas de un anuncio.
  **Respuesta de forma variable según el plan**, no un 403 en la parte Pro: todo dueño
  recibe `{ viewCount, favoritesCount }`; si es Pro, además `dailyViews`,
  `dailyImpressions` («veces listado», A2), `impressionCount`, `likeRatio` y `ctr`.
  - **Los DOS ratios llevan el mismo tratamiento de muestra pequeña**, y por tanto la
    misma forma: `ctr` y `likeRatio` son objetos con un `value` que puede ser `null`
    («aún no hay muestra»), los dos conteos y el umbral. Nunca deben pintarse como
    porcentaje sin comprobar `value`.
  - **`likeRatio`** es `{ value, favorites, views, minViews }` — me gusta ÷ visitas, sobre
    los TOTALES del anuncio. `minViews` es hoy **30**, mucho más bajo que el umbral del
    CTR porque una visita exige un clic y una aparición no (ver `sample-threshold.ts`).
  - **`ctr`** es `{ value, views, impressions, minImpressions }`. `value: null` **no es un
    error**: significa que aún no hay apariciones suficientes (`minImpressions`, hoy 100)
    para que el porcentaje signifique algo — la interfaz debe decir cuántas faltan, nunca
    pintar un porcentaje sobre una muestra menor. `views`/`impressions` son los de la
    **ventana comparable** (desde el primer día con apariciones), no los totales del
    anuncio: dividir los dos totales daría cifras absurdas mientras `viewCount` acumule
    desde antes de que existieran las impresiones. `value > 1` es legítimo — el anuncio
    recibe visitas por vías que no son la búsqueda.

---

> **`GET /admin/listings` y el vídeo (#13).** Cada ítem trae **`hasVideo`** (booleano
> derivado) y **nunca `videoUrl`** — la lista dice SI hay vídeo, jamás dónde está. Es el
> mismo trato exacto que `ipFlagged` recibe con `lastOwnerIp`, y sostiene el contrato de
> cero bytes desde el payload: sin dirección, ninguna tabla puede montar un `<video>`. Se
> filtra con **`?conVideo=`** (tri-estado: ausente no acota, `false` es «los que NO llevan»).
> Va a Postgres y no reusa el `conVideo` de `/search`, que filtra en Meilisearch — allí solo
> hay ACTIVE, y el moderador trabaja sobre todo con los otros ocho estados.

---

> **`GET /admin/tickets` y el «soporte prioritario» (#15).** Cada ítem trae **`userIsPro`**
> — el autor es cliente Pro **AHORA**, no cuando abrió el ticket—, y la bandeja lo pinta
> como insignia. Se filtra con **`?soloPro=true`** para aislar esa cola. **No reordena
> nada**: el orden sigue siendo `lastMessageAt desc`. El sistema marca; priorizar lo hace
> una persona, y por eso `/planes` promete que la consulta «destaca», nunca un plazo.

---

## Admin — estadísticas (B1)

Controlador **propio** (`admin/stats`) con piso **MODERATOR**, separado del `GET /admin/stats`
del dashboard, que es EDITOR y **no se amplía**: aquél mide inventario, éstos miden tráfico
(ver `docs/diseno-estadisticas.md` §3.5). Sólo LEEN `ListingViewDaily` y
`ListingImpressionDaily` — no hay ningún contador nuevo.

- **`GET /admin/stats/listings/:id?days=`** *(MODERATOR)* — Actividad de un anuncio:
  `dailyViews` y `dailyImpressions` (series SUELTAS, no fusionadas — el componente de
  gráfica las une), totales, `favoritesCount`, y `ctr` / `likeRatio` con el mismo
  tratamiento de muestra pequeña que ve el vendedor Pro. **Sin gate Pro**: aquí decide el
  rol, no el plan del vendedor.
- **`GET /admin/stats/users/:id?days=`** *(MODERATOR)* — Lo mismo agregado sobre **todos**
  los anuncios del usuario (cualquier estado, no sólo `ACTIVE`), más `listingCount`,
  `mostViewed` y `mostListed`. La suma es un `GROUP BY date` sobre las mismas tablas
  diarias: **no hay tabla de agregado por usuario**.

- **`GET /admin/stats/categories/:id?days=&subtree=`** *(MODERATOR)* — Lo mismo agregado
  sobre los anuncios de una categoría. **`subtree` es `true` por defecto**, y no es un
  detalle: `Listing.categoryId` apunta siempre a la HOJA, así que una raíz sin plegar
  daría casi cero. Con `subtree=false` da la categoría exacta. Devuelve además
  `descendantCount` (cuántas subcategorías se están sumando).
- **`GET /admin/stats/platform?days=`** *(MODERATOR)* — El pulso del sitio: `totals`,
  las dos series diarias globales y `categories` — una entrada por categoría **raíz**, con
  `children` desglosadas, y en cada una `activeListings`, `views`, `impressions`, `ctr`
  (con su `ctrMinImpressions`; `null` = sin muestra) y `viewsDelta`/`impressionsDelta`
  contra el periodo anterior (`null` cuando aquél fue cero — «infinito %» no es una
  variación). Todo sale de **una** agregación por tabla sobre una ventana del doble de
  ancho; el desglose y la delta se pliegan en memoria.

`days` ∈ **{7, 30, 90}**, por defecto 30. Cualquier otro valor es `400` — no es un rango
libre: cada valor es una agregación distinta y el techo acota el coste por construcción.

---

## Search (búsqueda)

- **`GET /search`** — Búsqueda de texto completo resuelta por Meilisearch. Devuelve datos
  suficientes para pintar la tarjeta **sin ninguna consulta adicional a Postgres**.

**Filtros core:** `q`, `category` (slug), `type`, `condition`, `priceType`, `priceUnit`,
`minPrice`, `maxPrice`, `province`, `city`, `tags` (separadas por comas, en **AND**).

**Atributos variables de categoría — DINÁMICOS.** No hay lista cableada. `FilterableAttributesResolver`
deriva el mapa `nombre → tipo` del `attributeSchema` de las categorías reales; cuando la consulta
trae `category`, se validan **contra el esquema de esa categoría**. Consecuencia deliberada:
`?category=coches&rooms=3` (donde `rooms` es de pisos) devuelve **`400`**, no cero resultados en
silencio. Cualquier parámetro no reconocido —ni core ni atributo filtrable de esa categoría— se
rechaza con `400`.

**Rangos:** cualquier atributo numérico admite sufijos `_min` y `_max` —
`?km_min=50000&km_max=150000`. Cada cota puede ir suelta (`km_min` solo = «50 000 o más»). La
clave literal manda: un atributo que de verdad se llame `km_min` sigue funcionando como tal.

> **`type` → `itemType`.** El atributo de producto/servicio se renombró en la migración
> `rename_itemtype_normalize_size` (`Listing.attributes` JSONB), que además normalizó
> `calzado.size` de número a cadena. `type` como parámetro *core* sigue existiendo y es otra cosa
> (`ListingType`); el atributo variable es `itemType`.

**Proximidad:** `lat` + `lng` + `radius` (en **kilómetros**, 1–500). Con los tres presentes
aplica `_geoRadius`; los anuncios sin coordenadas quedan excluidos. Sin `sort` explícito, ordena
por distancia ascendente.

**Ordenación:** `sort` ∈ `price:asc | price:desc | publishedAt:desc | sortDate:desc`, donde
`sortDate = max(publishedAt, bumpedAt)`.

**Respuesta:** `{ hits, featured, totalHits, page, hitsPerPage, facets? }`.

> **`hits` y `featured` son dos bloques distintos, y esto es el contrato importante.**
> `boostScore` **NUNCA** reordena `hits`: la lista respeta siempre el orden pedido. Los
> destacados que además cumplen los filtros actuales se devuelven **aparte** en `featured`
> (hasta 4, solo en página 1 — el bloque «Promocionados»), mediante una consulta propia.
> `totalHits` no se contamina ni con `featured` ni con el patrocinado. Es la «política de
> ordenación C»: antes `boostScore:desc` iba **delante** de `sort` en las ranking rules, así que
> particionaba en vez de desempatar y un destacado de 333 € ganaba a uno de 7 € ordenando por
> precio ascendente.

> **`skipFeatured` (H9)** — opcional, `true` para que la respuesta NO resuelva el bloque
> `featured` (llega `[]`). Lo manda quien sabe que no lo va a pintar: hoy, la **vista mapa**,
> que no monta el bloque pero fuerza `page=1` y por eso lo pagaba igual. Es un **opt-out**: quien
> no lo manda recibe el bloque como siempre, y sólo el `true` explícito cuenta
> (`?skipFeatured=false` no salta nada).

> **`GET /billing/featured-competition/:listingId` (R4)** — lo que el diálogo de compra le
> enseña al vendedor antes de cobrarle: `{ categoria, vigentes, cuota }`, donde `vigentes` son
> los destacados vivos que YA hay en la categoría del anuncio (sin contarlo a él) y `cuota` es
> el reparto que habría **con él dentro** (`candidatos = vigentes + 1`): `grupos`, `siempre`,
> `minutosDeVitrinaAlDia`, `cicloMinutos`. La calcula el servidor con la MISMA aritmética que
> reparte los turnos, no el frontend. Requiere sesión y ser el dueño del anuncio.

> **Rotación R2 — el bloque `featured` SE TURNA.** Ya no son «los 4 primeros del orden pedido»
> sino el grupo que le toca a la ventana de 15 min en curso: los destacados vigentes se reparten
> en grupos de 4 por fecha de concesión y van saliendo por turnos, de modo que **dos peticiones
> en ventanas distintas devuelven grupos distintos** y en un ciclo (`ceil(N/4)` ventanas) han
> salido todos. Dentro de una misma ventana el bloque es estable. Dos consecuencias del
> contrato: (1) el bloque tiene **orden propio** y NO sigue el `sort` pedido —los **filtros** sí
> se respetan enteros—; (2) un destacado cuyo periodo ha vencido desaparece del bloque de
> inmediato, aunque su `boostScore` siga a 1 hasta que pase el cron. `hits`, `totalHits` y la
> política de ordenación C no cambian.

> **Rotación R1 — dos campos nuevos en cada hit.** `featuredStartsAt` y `featuredExpiresAt`
> (**segundos UNIX**, `null` si el anuncio no está destacado) viajan en `hits` y en `featured`
> como ya lo hacían `boostScore` o `_geo`. Son la base de la rotación del bloque
> (`docs/diseno-rotacion-destacados.md`) y **hoy no cambian ningún comportamiento**. Ojo al
> nombre: **no son `featuredUntil`**, que es otra cosa —un ISO string que sólo sirve la vista del
> propietario— y por eso se llaman distinto.

> **Excepción a «la búsqueda no toca Postgres»:** en página 1 con `category`, el controlador sí
> consulta Postgres para intercalar un **anuncio patrocinado**, mitigado con caché Redis por
> categoría (TTL 5 min). Ver «Sponsored ads».

**Cabecera `x-visitor-hash`** *(opcional, la manda el BFF)* — la identidad del visitante, para
deduplicar las impresiones de «veces listado» (estadísticas A1). `/busqueda` y `/[categoria]` son
Server Components, así que sin ella la API vería siempre la IP del servidor de Next y todos los
visitantes serían el mismo. Su ausencia **no cambia la respuesta**: sólo hace que se cuente de
menos. Contar una impresión no añade ninguna escritura a Postgres ni latencia a esta ruta — se
acumula en Redis fuera de la respuesta y un cron lo vuelca cada 15 min (ver
`docs/diseno-estadisticas.md` parte A).

---

## Media (imágenes)

- **`POST /media/upload`** *(auth)* — Sube la imagen a R2/MinIO (`multipart/form-data`), crea un
  `ListingImage` huérfano y encola el procesado con sharp. Devuelve `{ id, url }` para incluirlo
  en el wizard antes de crear el anuncio.
- **`POST /media/upload-avatar`** *(auth)* — Sube a `avatars/` y devuelve `{ url }`. **No crea
  `ListingImage`** (un avatar no es una imagen de anuncio; la tabla no crece).

Límites en ambos: 10 MB, solo JPEG/PNG/WebP (`422` con otro tipo), `400` sin fichero.

> *Deuda: no existe `DELETE /media/:id`. Las imágenes de wizards abandonados permanecen huérfanas
> en almacenamiento y en la tabla `ListingImage` (ver `docs/pendientes.md` §4.2).*

---

## Vídeo Pro

Ninguna de estas rutas recibe el fichero: los bytes van del navegador al almacenamiento por una
URL prefirmada. **Todas** llevan el mismo gate — feature encendida (`videoEnabled`), usuario Pro,
anuncio propio y `ACTIVE`.

- **`GET /video/config`** *(auth)* — Si está encendida y con qué límites (50 MB, 60 s, solo MP4).
- **`POST /video/upload-url`** *(auth)* — Firma un PUT a `listing-videos/tmp/<anuncio>/`. El
  tamaño declarado viaja **dentro de la firma**: el límite lo aplica el almacenamiento.
- **`POST /video/preview-url`** *(auth)* — Igual, para el **sprite** del póster animado:
  `listing-previews/tmp/<anuncio>/`, máximo 512 KB, solo `image/webp` o `image/jpeg`
  (**ningún formato animado** — el artefacto es una imagen fija que anima el CSS). Prefijo
  propio: ni el del vídeo ni el de las imágenes de anuncio.
- **`POST /video/listings/:id/confirm`** *(auth)* — Comprueba contra el almacenamiento lo que
  aterrizó, lo saca de `tmp/` y lo enlaza. Acepta `posterUrl` (imagen ya subida) y `previewKey`
  (la clave temporal del sprite) — **los dos opcionales**: si fallaron, el vídeo se confirma
  igual con esas columnas a `null`. El sprite viaja en **este mismo** confirm porque un sprite
  sin su vídeo no significa nada; una clave de otro anuncio da `400`.
- **`DELETE /video/listings/:id`** *(auth)* — Quita el vídeo y **borra los tres objetos**:
  `.mp4`, póster y sprite.

---

## Favorites

Todos *(auth)*, todos idempotentes.

- **`POST /favorites/:listingId`** — Marcar.
- **`DELETE /favorites/:listingId`** — Desmarcar.
- **`GET /favorites`** — Mis favoritos, paginados.
- **`GET /favorites/:listingId`** — Comprobar uno.
- **`POST /favorites/batch-check`** — Máximo 100 ids → `{ favoritedIds }`. **Es el que importa
  para el rendimiento**: resuelve el estado de un grid entero con una sola petición en vez de
  una por tarjeta.

---

## Reviews (valoraciones)

- **`POST /reviews`** *(auth)* — Crear. Guard de elegibilidad, snapshot de `listingTitle`.
- **`GET /reviews/eligibility?listingId=&targetId=`** *(auth)* — Comprobar antes de mostrar el
  formulario. Devuelve además `wouldBeVerified`, para que la UI lo anticipe antes de enviar.
- **`PATCH /reviews/:id`** *(auth, autor)* — Editar dentro de la ventana de 72 h; persiste
  `editedAt`.
- **`DELETE /reviews/:id`** *(auth, autor)* — Borrar dentro de la ventana de 72 h.

El listado público es **`GET /users/:slug/reviews`** (ver «Users»).

> **Elegibilidad: `Deal`, no `Conversation`.** Puede valorar quien tenga **al menos un `Deal`**
> con la otra parte sobre ese anuncio. Antes el gate era la existencia de una conversación, lo
> que producía los dos errores simétricos: un trato real cerrado sin haber chateado **no**
> habilitaba valorar, y un simple «¿sigue disponible?» sin ningún trato **sí**.
>
> **`Review.verified`** se congela al crear (`true` si en ese momento existía un `Deal`
> verificable, es decir con `conversationId != null`) y **nunca se recalcula**, ni al editar.
>
> **Unicidad `(authorId, targetId, listingId)`** — una reseña por par de usuarios por anuncio,
> sin importar cuántos tratos haya entre ellos. Anclarla a un `dealId` concreto se evaluó y se
> descartó: como `Deal` no tiene límite de repetición, habría permitido multiplicar el peso de
> una reseña repitiendo tratos con el mismo par.
>
> `Review.listingId` es `SetNull` con `listingTitle` congelado: **la reseña sobrevive al borrado
> del anuncio.** Para moderarlas existen `FAKE_REVIEW` en `ReportReason` y
> `DELETE /moderation/reviews/:id`.

---

## Messaging (mensajería)

REST:

- **`GET /conversations`** *(auth)* — Conversaciones con resumen (último mensaje, no leídos,
  thumbnail del anuncio).
- **`POST /conversations`** *(auth)* — Abre (o recupera) la conversación entre comprador y
  vendedor de un anuncio y envía el primer mensaje.
- **`GET /conversations/:id`** *(auth, participante)* — Mensajes en orden cronológico con cursor.
  **Marca la conversación como leída al abrirla.**
- **`POST /conversations/:id/messages`** *(auth, participante)* — Persiste el mensaje y emite el
  evento WebSocket correspondiente.

WebSocket en `/ws` *(autenticación JWT en el handshake)*:

- **`conversation:join`** (cliente → servidor) — Entrar en la sala de una conversación; el
  servidor verifica el acceso contra la base de datos.
- **`message:new`** (servidor → cliente) — Nuevo mensaje en cualquier conversación del usuario,
  tanto en el chat abierto como en la bandeja.
- *`conversation:read` (servidor → cliente) está en el diseño original pero **sigue sin
  implementar**: el gateway no emite ningún evento de lectura, y el marcado ocurre solo por REST
  al abrir la conversación. Consecuencia visible: el contador de no leídos de la bandeja no baja
  hasta recargar. Ver `docs/pendientes.md` §4.2.*

> Los mensajes se envían **únicamente por REST**. No existe un evento `message:send` de cliente a
> servidor.

**CORS del gateway (R9):** el handshake solo se autoriza desde `APP_URL`, en forma de **array de
un elemento** — con `origin` como cadena, el paquete `cors` emite la cabecera sin comparar; con
array, la omite cuando el origen no casa.

Antes era `origin: '*'` con un `TODO(prod)`. **Sin vender más de lo que es:** es defensa en
profundidad, **no** el control de acceso. Quien autoriza es el token del handshake y, por ser un
token explícito y no una cookie, este gateway nunca fue vulnerable a *cross-site WebSocket
hijacking*. Además el protocolo WebSocket no pasa por CORS (solo el polling y el handshake) y el
propio frontend conecta con `transports: ['websocket']`, así que en la práctica el CORS **no está
ni en el camino vivo** de esta aplicación. Cerrarlo es higiene, no el cierre de un exploit.

> **La otra mitad sigue abierta:** `app.enableCors()` **sin argumentos** en `main.ts:40` deja la
> API HTTP accesible desde cualquier origen. Se dejó fuera de R9 a propósito. Ver
> `docs/pendientes.md` §4.2.

---

## Tickets (atención al usuario) — rutas de USUARIO

Canal bidireccional usuario ↔ administración. Todas *(auth)* y **owner-scoped**: ninguna acepta
un `userId`; el scope sale siempre del JWT. La API de STAFF vive aparte, más abajo.

- **`POST /tickets`** *(auth)* — Abre un hilo (estado `OPEN`) con el primer mensaje. Puede
  enlazar **una** entidad: un anuncio propio, una valoración escrita o recibida, o una factura
  propia. `linkedLabel` (el snapshot legible del contexto) lo deriva el **servidor** del
  título/número real; nunca se acepta del cliente. `topicId` debe ser un `ContactReason` activo
  con `scope` `TICKET` o `BOTH`. Límite de 10 al día por usuario (`429` con `retryAfter`).
- **`GET /tickets`** *(auth)* — Mis tickets, orden por último movimiento, paginado
  (`page`/`perPage`), con `unreadCount` por hilo.
- **`GET /tickets/topics`** *(auth)* — Motivos ofrecibles al abrir un ticket: `ContactReason`
  activos con `scope` `TICKET` o `BOTH`. **No** es `GET /contacto/motivos` (ese sirve el ámbito
  contrario, `PUBLIC`+`BOTH`) ni `GET /admin/contact-reasons` (ADMIN-only y devuelve también los
  inactivos). Declarado **antes** de `:id` en el controlador, o Nest buscaría un ticket con id
  `"topics"`.
- **`GET /tickets/:id`** *(auth, propietario)* — El hilo, mensajes **más recientes primero** con
  cursor `?before=<messageId>` (mismo contrato que `GET /conversations/:id`). Marca como leídos
  los mensajes del staff pendientes. `403` si no es tuyo.
- **`POST /tickets/:id/messages`** *(auth, propietario)* — Responder. **Reabrir es escribir**: si
  el ticket estaba `RESOLVED` y no ha vencido la ventana de reapertura
  (`Setting.ticketAutoCloseWindowDays`, por defecto 14 días desde `resolvedAt`), responder lo
  devuelve a `IN_PROGRESS` (no hay endpoint `/reopen` aparte). Fuera de esa ventana →
  `400 REOPEN_WINDOW_EXPIRED`. Sobre un ticket `CLOSED` → `400`. El body **no admite `internal`**
  (ver más abajo). **Acepta `multipart/form-data` además de JSON** (R5): campo `body` + hasta 5
  ficheros en `files`. JSON sigue funcionando exactamente igual.
- **`GET /tickets/:id/attachments/:attachmentId`** *(auth, propietario)* — Descarga un adjunto.
  `403` si el ticket no es tuyo; **`404` si el adjunto es de una nota interna** del staff (para
  el usuario, una nota interna no existe — un `403` confirmaría que hay algo) o si no pertenece a
  ese ticket.
- **`POST /tickets/:id/close`** *(auth, propietario)* — Cerrar el propio, **irreversible**. Solo
  tickets de `origin=USER`: un hilo iniciado por la administración → `403`.

> **Enlace a entidades — decisión de seguridad.** Enlazar una entidad **ajena** y enlazar una
> **inexistente** devuelven exactamente la misma respuesta (`422 LINKED_ENTITY_NOT_ALLOWED`,
> mismo cuerpo). Es deliberado: un `404` para "no existe" y un `403` para "no es tuya"
> convertirían el campo en un oráculo con el que sondear la existencia de ids ajenos.

> **Notas internas del staff — la vía de usuario está CERRADA.** El staff sí puede escribir notas
> internas (ver la ruta de staff), pero **ninguna ruta de usuario las devuelve ni las acepta**: no
> salen en el hilo, no cuentan en `unreadCount`, no mueven `lastMessageAt`, y un `internal` en el
> body de `POST /tickets` o `POST /tickets/:id/messages` se rechaza con `400`. El campo solo
> existe en el DTO de staff (`SendStaffMessageDto`), que extiende al de usuario — la herencia solo
> propaga hacia el lado seguro. **Los ADJUNTOS de una nota interna heredan su privacidad**: el
> endpoint de descarga del usuario responde `404`.

> **ADJUNTOS (R5) — NO HAY URL PÚBLICA, y es la garantía central.** A diferencia de
> `POST /media/upload`, que devuelve una URL servida por el bucket, de un adjunto de ticket solo
> se guarda la **clave** de R2 (`TicketAttachment.key`), que **ni siquiera viaja en el payload del
> hilo**: el fichero existe únicamente detrás del endpoint autenticado de descarga, que revalida
> el acceso en CADA petición (molde `GET /billing/invoices/:id/pdf`). Límites: JPEG/PNG/WebP +
> PDF, 10 MB por fichero, 5 por mensaje. Rechazos con `422` y `code`:
> `ATTACHMENT_TYPE_NOT_ALLOWED`, `ATTACHMENT_TOO_LARGE`, `TOO_MANY_ATTACHMENTS`. La clave se
> compone con bytes aleatorios, nunca con el nombre subido; ese nombre solo se usa para mostrar y
> para el `Content-Disposition`.

---

## Tickets — rutas de STAFF

`@Roles(MODERATOR, ADMIN)` a nivel de clase (molde `ModerationController`). Controlador SEPARADO
del de usuario: los payloads difieren en lo esencial (este incluye las notas internas y los datos
del usuario), y tenerlos en clases distintas es lo que impide servir uno por la puerta del otro.

- **`GET /admin/tickets`** — La bandeja. Filtros `status`, `origin`, `topicId` y `assignedTo`
  (un id de agente, o `me` / `none`). Orden por último movimiento, paginado.
- **`GET /admin/tickets/:id`** — El hilo completo, **incluidas las notas internas** (contraste
  exacto con `GET /tickets/:id`). Marca como leídos los mensajes del usuario.
- **`POST /admin/tickets/:id/take`** — T2: `OPEN → IN_PROGRESS`, auto-asignación.
- **`POST /admin/tickets/:id/messages`** — T3/T4, **o una NOTA INTERNA**. `side=STAFF` siempre.
  · Con `internal: false` (o ausente): respuesta al usuario. `OPEN`/`IN_PROGRESS` →
    `WAITING_USER`, y asigna el ticket al autor si no lo llevaba nadie.
  · Con `internal: true`: **nota interna**. Se guarda en el hilo, la ve solo el equipo, y **no
    toca el ticket** (ni estado, ni asignación, ni `lastMessageAt` — ese campo lo lee el usuario)
    **ni dispara ningún aviso**. Auditada como `TICKET_INTERNAL_NOTE`, no como `TICKET_REPLY`.
  · **Acepta `multipart/form-data`** (R5), igual que la ruta de usuario. En multipart `internal`
    viaja como la cadena `"true"`/`"false"` y el DTO convierte **solo** esos dos valores exactos;
    cualquier otro sigue dando `400`.
- **`GET /admin/tickets/:id/attachments/:attachmentId`** — Descarga un adjunto desde el lado del
  staff. Las notas internas **sí** se sirven aquí (el staff es su destinatario), y se aplica la
  puerta ADMIN-only de facturación: un `MODERATOR` no descarga el adjunto de un ticket con factura
  enlazada, igual que no puede abrirlo (`403 TICKET_BILLING_ADMIN_ONLY`).
- **`POST /admin/tickets/:id/resolve`** — T7: `IN_PROGRESS`/`WAITING_USER` → `RESOLVED`.
- **`POST /admin/tickets/:id/close`** — T10. **Irreversible.**
- **`POST /admin/tickets/:id/reassign`** — Cambia el agente asignado.
- **`POST /admin/tickets`** — **Flujo (b)**: abrir un hilo con un usuario concreto. `origin=ADMIN`,
  nace en `WAITING_USER` y asignado al agente. El usuario se elige con `GET /users/search`.
- **`POST /admin/tickets/from-report/:reportId`** — **Flujo (c)**: contactar con el usuario
  reportado. `origin=REPORT` + `reportId`.

> **Dos puertas ADMIN-only que el `RolesGuard` no puede vigilar** — dependen del CONTENIDO de la
> fila, no de la ruta, así que viven en el servicio:
> 1. **Ticket con `invoiceId` enlazada → ADMIN-only.** La facturación lo es en todo el proyecto.
>    El MODERATOR ni lo ve en la bandeja ni puede operarlo por **ningún** verbo
>    (`403 TICKET_BILLING_ADMIN_ONLY`): poder cerrar a ciegas lo que no puedes leer sería una
>    puerta trasera, no una excepción menor.
> 2. **Reasignar el ticket de OTRO agente → ADMIN-only** (`403 TICKET_REASSIGN_ADMIN_ONLY`). Un
>    MODERATOR sí puede coger uno sin asignar o mover el suyo.

**Salas y eventos de TICKETS (R9), en el mismo namespace `/ws`:**

- **`ticket:join`** (cliente → servidor, `{ ticketId }`) — Pide entrar en la sala del hilo. El
  servidor **verifica el acceso contra la base de datos antes de unir** (molde
  `conversation:join`): entra el dueño del ticket, o un agente — con la puerta ADMIN-only de
  facturación aplicada, así que un `MODERATOR` **no** entra en la sala de un ticket con
  `invoiceId`. Un hilo ajeno y un hilo inexistente reciben el mismo `error: Forbidden`, sin
  distinguirlos (mismo criterio anti-oráculo que el guard de enlace de R2).
- **`ticket:message`** (servidor → cliente) — Mensaje nuevo en un hilo. Llega a la sala
  `ticket:<id>`, a la sala personal `user:<id>` del dueño (para que su lista se mueva sin tener el
  hilo abierto) y a la sala de rol `staff` (bandeja).
- **Sala de rol `staff`** — Los agentes entran al conectar, con el rol **leído de la base de
  datos**, no del token: los JWT duran 7 días y un rol revocado seguiría viajando en uno válido.

> **UNA NOTA INTERNA NO SALE DE LA SALA `staff`.** Es la invariante §10.3 aplicada al canal de
> tiempo real: `ticket:<id>` contiene al usuario y al agente a la vez, así que una nota emitida
> ahí se le entregaría al usuario. El agente que mira el hilo la recibe igualmente por la sala
> `staff`.

> **El WebSocket es ADICIONAL, no sustituye a la `Notification`.** El socket es para quien tiene
> la pantalla delante ahora; la notificación in-app y el email son para quien no está mirando, y
> quedan como registro. Los dos canales se disparan en la misma acción.

> **Avisos (R4) — vía auxiliar, nunca el canal.** Las transiciones disparan `Notification` in-app
> (`TICKET_MESSAGE` y `TICKET_OPENED` al usuario; `TICKET_STAFF_NEW` en fan-out al staff) y un
> email por Resend. **Ni la notificación ni el email llevan la conversación**: solo un extracto de
> ≤140 caracteres y el enlace al hilo, y los correos cierran con *"no respondas a este correo"*
> (no existe email entrante en el proyecto). El email al staff va a **una sola** dirección,
> `Setting.supportEmail`, no uno por administrador; sin configurar, se omite el correo y quedan
> los avisos in-app. Ningún aviso transiciona nada: el estado solo cambia por la acción HTTP.

> **Flujo (c) — el `Report` NO se modifica.** Se LEE para resolver el destinatario (usuario
> reportado → vendedor del anuncio → autor de la valoración) y se referencia desde
> `Ticket.reportId`. La cola de moderación sigue siendo la única dueña de su ciclo de vida:
> resolver el reporte y cerrar el ticket son acciones **independientes**. El destinatario lo
> resuelve el **servidor**; el body no puede elegirlo (no existe el campo, así que un intento se
> rechaza con 400).

---

## Tags (etiquetas)

- **`GET /tags/suggest`** — Sugerencias de etiquetas para el buscador de portada y el paso de
  etiquetas del wizard.

Las etiquetas asociadas a una categoría se leen por `GET /categories/:slug/tags`, y se filtra por
ellas con `GET /search?tags=a,b` (AND). El tope por anuncio lo fija `Setting.maxTagsPerListing`
(por defecto 5).

Gestión en «Backoffice → Tags».

---

## Blog y páginas informativas

Públicos, sin auth:

- **`GET /blog`** — Posts `PUBLISHED` (`type=POST`), paginado, con filtro `?tag=`.
- **`GET /blog/:slug`** — Un post. `404` si no existe o es `DRAFT`.
- **`GET /paginas`** — Páginas informativas `PUBLISHED` (`type=PAGE`), paginado.
- **`GET /paginas/:slug`** — Una página. `404` si no existe o es `DRAFT`.

> **El cuerpo es `blocks: Json`, no Markdown.** El contenido se guarda como un sistema de
> **13 tipos de bloque** discriminados por `type` — 12 estáticos y `listings`, el primero
> **dinámico**. Consecuencia de contrato: una página con un bloque `listings` **deja de ser
> autocontenida** y su caché ya no puede tratarse como estática. Los `DRAFT` nunca aparecen
> tampoco en el sitemap, porque ambos endpoints públicos filtran por `status = PUBLISHED` en
> Prisma.

> *Deuda: el filtrado por etiqueta existe solo como query param; **no hay una URL propia por
> etiqueta** (`/blog/tag/:tag`), que para un proyecto cuyo canal principal es el SEO es una página
> de aterrizaje que falta. Ver `docs/pendientes.md` §4.2.*

---

## Footer

- **`GET /footer`** — Navegación pública del footer, ya resuelta (`href`/`external`). Las páginas
  en `DRAFT` se omiten.

Es una entidad propia (`FooterColumn` + `FooterItem`), independiente de `Post`. `FooterItemType`
es `PAGE | INTERNAL | EXTERNAL`, con el destino discriminado validado en el servicio (no en el
DTO ni con un CHECK). `pageId` es FK a `Post` con `onDelete: Restrict` **más** un precheck al
borrar el post, para que el error sea legible en vez de una violación de FK.

Gestión en «Backoffice → Footer».

---

## Contact (formulario público)

**Endpoint sin autenticación: superficie de ataque propia**, con cinco defensas.

- **`GET /contacto/token`** — Token firmado del *time-trap*.
- **`GET /contacto/motivos`** — Motivos activos, ordenados (`ContactReason` con `scope`
  `PUBLIC` o `BOTH`).
- **`POST /contacto`** — Envía el mensaje.

> **Comportamiento de las defensas, que es contrato:** honeypot o *time-trap* fallidos →
> **`200` silencioso sin persistir nada** (no se le dice al bot que ha fallado); rate limit
> superado → `429`. `ContactMessage` **no guarda la IP** (decisión RGPD). Notifica a los admins
> por fan-out: una `Notification CONTACT_MESSAGE` + un email por cada `User role=ADMIN`.

Gestión en «Backoffice → Mensajes de contacto».

---

## Alerts (búsquedas guardadas)

Todas *(auth)*, todas scoped por `(id, userId)`.

- **`POST /alerts`** — Crea la alerta y devuelve `{ alert, matches }`: el **preview inmediato** de
  coincidencias, para que el usuario vea al instante qué le habría llegado.
- **`GET /alerts`** — Mis alertas.
- **`PATCH /alerts/:id`** — Editar criterios o pausar/reactivar (`active`).
- **`DELETE /alerts/:id`** — Borrar.
- **`GET /alerts/:id/matches`** — Coincidencias acumuladas.

> Los criterios se guardan en **columnas propias** (`q`, `categorySlug`, `type`, `condition`,
> `priceType`, `minPrice`/`maxPrice`, `province`, `city`, `lat`/`lng`/`radiusMeters`) más un
> `attributes Json` — deliberadamente **no** un blob opaco de `SearchParams`, para que el
> matching pueda pre-filtrar en SQL antes de reconstruir la consulta. La deduplicación de avisos
> la garantiza `AlertMatch` con `@@unique([alertId, listingId])`.

El disparo es asíncrono: al pasar un anuncio a `ACTIVE` se encola el flag `triggerAlertMatch` en
el job `index` (cola `alert-matching`). `reserve` y los tratos **no** disparan matching.

---

## Notifications

Todas *(auth)*. Canal in-app genérico.

- **`GET /notifications`** — Paginado.
- **`GET /notifications/unread-count`** — Contador de no leídas.
- **`POST /notifications/:id/read`** — Marcar leída. Idempotente, y con `updateMany` **scoped por
  `userId`** — nunca confía solo en el `:id` de la URL.
- **`POST /notifications/read-all`** — Marcar todas.

> `type` es `String`, no un enum (molde `AuditLog.action`): añadir un tipo nuevo no requiere
> migración. `data` es un **snapshot autocontenido**, no punteros — una notificación sigue
> siendo legible aunque el recurso al que se refiere cambie o desaparezca. Tipos en uso:
> `ALERT_MATCH`, `CONTACT_MESSAGE`, `REVIEW_REQUEST`, `TICKET_MESSAGE`, `TICKET_OPENED`,
> `TICKET_STAFF_NEW`, `INVOICING_PENDING_FISCAL_DATA` y los avisos de moderación.

---

## Billing (Stripe, wallet y créditos)

- **`GET /billing/catalog`** — **Público, sin auth.** Catálogo de productos y precios. Cada
  precio de pack incluye `creditPackId` y `packName`, para que el frontend pinte una tarjeta por
  pack sin una llamada extra. El DTO **no expone `gatewayPriceId`**.
- **`POST /billing/checkout`** *(auth)* — Inicia el checkout de Stripe del Plan Pro.
- **`POST /billing/cancel-subscription/:id`** *(auth)* — Cancela al final del periodo
  (`cancel_at_period_end`).
- **`GET /billing/my-subscriptions`** *(auth)* — Mis suscripciones.
- **`GET /billing/my-entitlements`** *(auth)* — Mis permisos vigentes.
- **`GET /billing/my-transactions`** *(auth)* — Mis transacciones, paginadas.
- **`GET /billing/pro-status`** *(auth)* — Estado Pro, incluida la **cuota mensual de destacados**
  (`limit` / `used` / `remaining`).
- **`POST /billing/featured-by-credits`** *(auth)* — Destaca un anuncio pagando con créditos.
  Débito atómico (`UPDATE Wallet WHERE balance >= cost`; si no afecta filas → `402`) +
  `CreditLedger` + concesión del entitlement, todo en una `$transaction` con rollback automático.
- **`GET /billing/wallet`** *(auth)* — Saldo de créditos + historial paginado.
- **`GET /billing/bump-ledger`** *(auth)* — Historial de la **moneda de bumps**, separada de los
  créditos (gratuita e intransferible).

> **Validez de un entitlement:** `revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now)`.
> Uno con `revokedAt` no cuenta como vigente **aunque `expiresAt` sea futuro** — es lo que
> permitirá revocar a mano desde el backoffice sin tocar fechas.

---

## Redsys (pago con tarjeta)

- **`POST /billing/checkout/credits-pack`** *(auth)* — Compra de un pack de créditos.
- **`POST /billing/checkout/bump-pack`** *(auth)* — Compra de un pack de bumps.
- **`POST /billing/checkout/featured-pay`** *(auth)* — Pago directo de un destacado.
- **`POST /webhooks/redsys`** — Notificación online de Redsys. Protegido por `RedsysWebhookGuard`
  (verificación HMAC), **no** por JWT.

Los tres checkouts devuelven un **formulario firmado** (`Ds_MerchantParameters`,
`Ds_SignatureVersion`, `Ds_Signature`) que el frontend auto-envía por POST: el modo es
**REDIRECCIÓN**, no iframe.

> **INVARIANTE DE SEGURIDAD — las páginas de retorno no conceden nada.** `/mis-creditos/exito` y
> equivalentes son solo UI. **Quien acredita el wallet o concede el destacado es exclusivamente la
> notificación online** (`POST /webhooks/redsys`), con idempotencia en dos capas (unicidad de
> `GatewayEvent` + comprobación de `status ≠ PENDING`) y validación de que `Ds_Amount` coincide
> con el importe esperado. Un usuario que recargue la página de éxito no obtiene créditos dos
> veces; uno que nunca la visite los obtiene igual.

> **Bonus Pro:** al comprar un pack, si el usuario es Pro se congela `Transaction.bonusCreditAmount`
> en el momento del checkout. El importe, el IVA y el `amountGross` **no se tocan** — el bonus vive
> en créditos, que no son hecho imponible (el IVA ya tributó al comprar el pack). El processor solo
> lee el entero ya congelado; no recalcula ni consulta ajustes.

---

## Invoicing (facturación fiscal) — rutas de USUARIO

Bajo `/billing`, todas *(auth)* y owner-scoped.

- **`GET /billing/facturables`** *(auth)* — Transacciones facturables: `SUCCEEDED`, de pasarela de
  plataforma, **sin `InvoiceLine`** y dentro de la ventana de autoservicio
  (`Setting.fiscalSelfServiceWindow`).
- **`GET /billing/eligibility`** *(auth)* — Si se puede facturar (datos fiscales completos + al
  menos un facturable), con el motivo cuando es `false`.
- **`POST /billing/facturas`** *(auth)* — Emite. Crea la `Invoice` en `DRAFT` **congelando**
  emisor, receptor, totales y líneas; llama al proveedor; sube el PDF a R2 **privado**; y hace el
  latch `DRAFT → ISSUED`. Doble envío concurrente → devuelve la existente; secuencial sin nada que
  facturar → `409`.
- **`GET /billing/my-invoices`** *(auth)* — Mis facturas.
- **`GET /billing/invoices/:id/pdf`** *(auth, propietario)* — Descarga autenticada vía
  `StreamableFile`. `403` si la factura no es tuya. **No hay URL pública.**

> **La inmutabilidad no se confía al código de aplicación:** hay **triggers de PostgreSQL** que
> rechazan cualquier `UPDATE`/`DELETE` de una `Invoice` `ISSUED` y cualquier
> `INSERT`/`UPDATE`/`DELETE` de sus `InvoiceLine`. Lo único permitido es el latch `DRAFT→ISSUED`.
> Anti-doble-facturación: `InvoiceLine.transactionId` es `@unique`.

> **⚠️ HOY NO SE FACTURA DE VERDAD.** El proveedor conectado es `StubInvoicingProvider`: emite
> números `DEV-YYYY-NNNNNN` y PDFs sellados **«NO VÁLIDO FISCALMENTE»**. La emisión válida se
> delega, por diseño, en un proveedor homologado externo detrás del puerto `InvoicingProvider`,
> todavía sin elegir. Ver `docs/pendientes.md` §5.

---

## Coupons

- **`POST /coupons/redeem`** *(auth)* — Canjea un cupón.

Gestión en «Backoffice → Cupones».

---

## Banners

- **`GET /banners`** — Banners activos de la barra promocional. Público, alimenta la barra sobre
  el header.

> Es **solo presentación de marketing**: los banners y campañas **no aplican descuentos al cobro
> de packs, destacados ni Pro**. Los descuentos de campaña (`ACTION_DISCOUNT`) solo existen al
> pagar **con créditos** (bump y destacado-por-créditos), **nunca** en el pago directo por Redsys
> — descontar ahí obligaría a recalcular y refacturar el IVA de cada campaña.

---

## Moderation

`@Roles(MODERATOR, ADMIN)` a nivel de clase, **salvo la creación de reportes**, abierta a
cualquier usuario autenticado.

- **`POST /moderation/reports`** *(auth, cualquier rol)* — Crear un reporte. `ReportReason`
  incluye `FAKE_REVIEW` para reportar valoraciones. **Toma el snapshot de lo denunciado al
  crear**: `listingTitle` del anuncio, y `reviewComment` / `reviewAuthorName` de la
  valoración.

> `Report.listingId` y `Report.reviewId` son **`SetNull` con snapshot congelado**: la denuncia
> sobrevive al borrado del anuncio *y* a la desaparición de la valoración, y sigue diciendo de
> qué iba. Ver `docs/diseno-borrado.md` §2.4 y §3.3.
- **`GET /moderation/reports`** *(MODERATOR+)* — Cola de reportes, con filtros de estado/motivo y
  paginación.
- **`GET /moderation/reports/:id`** *(MODERATOR+)* — Detalle.
- **`PATCH /moderation/reports/:id/start-review`** *(MODERATOR+)* — `PENDING → REVIEWING`.
- **`PATCH /moderation/reports/:id/resolve`** *(MODERATOR+)* — Resolver, con `resolvedBy` y
  `resolvedAt`.
- **`PATCH /moderation/reports/:id/dismiss`** *(MODERATOR+)* — Desestimar.
- **`POST /moderation/listings/:id/approve`** *(MODERATOR+)* — Aprueba un `PENDING_REVIEW`.
- **`POST /moderation/listings/:id/reject`** *(MODERATOR+)* — Rechaza.
- **`POST /moderation/listings/:id/deactivate`** *(MODERATOR+)* — Retira un anuncio.
- **`POST /moderation/listings/:id/restore`** *(MODERATOR+)* — Lo restaura.
- **`DELETE /moderation/reviews/:id`** *(MODERATOR+)* — Retira una valoración abusiva.

Todas las mutaciones quedan en `AuditLog`, y las que afectan al usuario disparan además su
`Notification`.

---

## Admin — gestión general

`@Controller('admin')`, `JwtAuthGuard + RolesGuard`. **La clase es `@Roles(ADMIN)`; los endpoints
que además admiten `MODERATOR` lo declaran explícitamente.** Esa es la frontera de la separación
de roles: lo que no lleva anotación propia es ADMIN-only por herencia.

**Métricas**

- **`GET /admin/stats`** *(ADMIN)* — 7 métricas del dashboard, con *fallback* a `null` si
  Meilisearch no responde (el panel no se cae por eso).

**Anuncios**

- **`GET /admin/listings`** *(MODERATOR+)* — Listado con filtros.
- **`GET /admin/listings/:id`** *(MODERATOR+)* — Detalle.
- **`PATCH /admin/listings/:id/status`** *(MODERATOR+)* — Cambio de estado con motivo.

**Usuarios**

- **`GET /admin/users`** *(MODERATOR+)* · **`GET /admin/users/:id`** *(MODERATOR+)* — Listado con
  búsqueda y detalle.
- **`PATCH /admin/users/:id/suspend`** *(MODERATOR+)* · **`.../unsuspend`** *(MODERATOR+)* —
  Suspensión temporal.
- **`PATCH /admin/users/:id/ban`** *(ADMIN)* · **`.../reinstate`** *(ADMIN)* — Baneo permanente y
  su reverso. **ADMIN-only**, a diferencia de la suspensión.
  **Banear PAUSA sus anuncios** `ACTIVE`/`RESERVED` (fuera del índice, sin ficha, liberan cuota):
  devuelve `anunciosPausados`. **Reinstaurar NO los restaura** —levantar el ban devuelve el acceso,
  no la visibilidad; el usuario los reactiva él mismo— y devuelve `anunciosSinReactivar`.
- **`PATCH /admin/users/:id/role`** *(ADMIN)* — Cambio de rol.
- **`PATCH /admin/users/:id/trusted`** *(ADMIN)* — Distintivo «Vendedor de confianza».

> **`trusted` es un campo independiente, no derivado de `isProActive`:** «de confianza» es una
> decisión de la plataforma y Pro es una compra. Mezclarlos impediría que alguien fuera ambos,
> ninguno o solo uno — que es el caso real que el negocio quería permitir.

**Categorías** *(todas ADMIN)*

- **`GET /admin/categories`** · **`POST /admin/categories`** · **`PATCH /admin/categories/:id`** ·
  **`DELETE /admin/categories/:id`** — CRUD del árbol.
- **`PATCH /admin/categories/reorder`** — Reordenación.
- **`GET /admin/categories/searchable-keys`** — Claves realmente filtrables, derivadas
  dinámicamente; el editor las usa para deshabilitar el check `filterable` donde no aplica.
- **`GET /admin/categories/:id/attribute-usage?key=`** — Cuántos anuncios tienen datos bajo esa
  clave. Sirve para **avisar antes de renombrar un atributo con datos**: renombrar la clave **no**
  migra `Listing.attributes`.

> `createCategory`/`updateCategory` validan que el esquema **efectivo** (propio + heredado) no
> supere **2 atributos con `cardAttribute: true`** → `400`. `deleteCategory` cuenta anuncios de
> **cualquier** estado, no solo `ACTIVE`.

**Ajustes**

- **`GET /admin/settings`** *(ADMIN)* · **`PATCH /admin/settings/:key`** *(ADMIN)* — Con
  **whitelist** de claves; una clave fuera de ella se rechaza. `updateSetting` es un **UPSERT**:
  una clave sin fila todavía se puede editar desde el backoffice sin sembrarla antes.

Claves en la whitelist: `badWordList`, `listingExpiryDays`, `contactRequiresVerification`,
`freeActiveListingLimit`, `proActiveListingLimit`, `proMonthlyFeaturedQuota`,
`proQuotaFeaturedDurationDays`, `bumpCreditCost`, `featuredCreditCost7d`, `featuredCreditCost14d`,
`featuredCreditCost30d`, `proExtraCreditsPercent`, `proMonthlyBumpQuota`, `proExtraBumpsPercent`,
`supportEmail`, `ticketAutoCloseWindowDays`, `maxTagsPerListing`.

---

## Admin — facturación y catálogo

`@Controller('admin/billing')`, **`@Roles(ADMIN)` explícito, no MODERATOR.**

- **`GET /admin/billing/transactions`** — Paginado, con filtros por `userId`/`status`/`gateway`.
- **`GET /admin/billing/wallets`** — Wallets de todos los usuarios.
- **`GET /admin/billing/users/:userId`** — Saldo, historial y entitlements activos de un usuario.
- **`POST /admin/billing/users/:userId/credits`** — Acreditación manual. Tres escrituras atómicas
  (wallet + `CreditLedger ADMIN_CREDIT` + `AuditLog` dentro de la misma transacción).
  **No crea `Transaction`** (no es hecho imponible) y **no aplica bonus Pro**. El motivo real del
  admin va al `AuditLog`; lo que ve el usuario en su historial es una nota genérica.
- **`GET /admin/billing/prices`** · **`PATCH /admin/billing/prices/:id`** — Catálogo de precios.
- **`PATCH /admin/billing/credit-packs/:id`** — Créditos que otorga un pack.
- **`PATCH /admin/billing/bump-packs/:id`** — Bumps que otorga un pack.

> El DTO de salida usa `select` explícito para **excluir 9 campos sensibles**
> (`gatewayPaymentIntentId`, `subscriptionId`, `taxAmount`, `invoiceNumber`, `gatewayEventId`,
> `stripeCustomerId`, `refundedAt`, `refundAmount`, `invoiceUrl`) y las respuestas van con
> `Cache-Control: no-store`.

---

## Admin — facturas fiscales

`@Roles(ADMIN)`.

- **`GET /admin/invoices`** — TODAS las facturas de TODOS los usuarios. Filtros por
  `status`/`origin`/`periodKey`/`userId`/`userQuery` (email o nombre) y rango de `issuedAt`.
- **`GET /admin/invoices/:id`** — Detalle con líneas, emisor y receptor congelados, `verifactu` y
  `providerRef`.
- **`GET /admin/invoices/:id/pdf`** — Descarga de **cualquier** factura. Contraste deliberado con
  el owner-scope del usuario, que recibe `403` con una ajena.
- **`GET /admin/fiscal-issuer`** · **`PUT /admin/fiscal-issuer`** — Datos del emisor. Valida el
  NIF/CIF con el mismo validador que el resto y audita como `FISCAL_ISSUER_UPDATE`.

> **Cambiar el emisor NO es retroactivo:** se congela en cada factura al emitirla, así que solo
> afecta a las futuras. La UI lo avisa explícitamente.

---

## Admin — contenidos y marketing

**Blog y páginas** — `@Controller('admin/blog')`. La clase es `@Roles(ADMIN)`, pero **casi todos
los verbos amplían a `EDITOR` y `MODERATOR`**; el borrado permanente se queda en ADMIN-only.

- **`GET /admin/blog`** *(EDITOR+)* — Listado de todos los estados. `?type=POST|PAGE` filtra;
  **sin `type` devuelve posts y páginas mezclados**, así que el frontend siempre lo envía
  explícito.
- **`GET /admin/blog/:id`** *(EDITOR+)* · **`POST /admin/blog`** *(EDITOR+)* ·
  **`PATCH /admin/blog/:id`** *(EDITOR+)* — CRUD.
- **`POST /admin/blog/:id/publish`** *(EDITOR+)* · **`POST /admin/blog/:id/unpublish`**
  *(EDITOR+)* — Publicar y despublicar.
- **`POST /admin/blog/upload-image`** *(EDITOR+)* — Sube imágenes de bloque (prefijo `blocks/`).
  JPEG/PNG/WebP, `422` con otro tipo.
- **`DELETE /admin/blog/:id`** *(**ADMIN**)* — Borrado permanente.

Publicar, despublicar, editar o borrar un contenido publicado dispara revalidación ISR
*fire-and-forget*; que falle **no** bloquea la respuesta al admin.

**Footer** *(ADMIN)* — `GET /admin/footer` (estructura completa);
`POST|PATCH|DELETE /admin/footer/columns[/:id]` y `.../items[/:id]`, más
`PATCH /admin/footer/columns/reorder` y `PATCH /admin/footer/items/reorder`.

**Tags** *(ADMIN)* — `GET|POST /admin/tags`, `PATCH /admin/tags/:id`,
`PATCH /admin/tags/reorder`, `GET /admin/tags/:id/usage` (cuántos anuncios la usan, antes de
tocarla). Asignación por categoría en un controlador aparte: `GET|PUT /admin/categories/:id/tags`.

**Sponsored ads** *(ADMIN)* — `GET|POST /admin/sponsored-ads`, `PATCH /admin/sponsored-ads/:id`,
`POST /admin/sponsored-ads/upload-image`. **No tienen endpoint público propio**: se inyectan desde
`SearchController` en la página 1 de una categoría. El clic va a un enlace **externo**
(`rel="sponsored noopener"`), no a una ficha — es la diferencia con un destacado.

**Banners** *(ADMIN)* — `GET|POST /admin/banners`, `PATCH /admin/banners/:id`.

**Campañas** *(ADMIN)* — `GET|POST /admin/campaigns`, `PATCH /admin/campaigns/:id`.

**Cupones** *(ADMIN)* — `GET|POST /admin/coupons`, `PATCH /admin/coupons/:id`.

**Mensajes de contacto** *(ADMIN)* — `GET /admin/contact-messages` (filtros por estado y motivo),
`GET /admin/contact-messages/:id` (auto `NUEVO→LEIDO` al abrir),
`PATCH /admin/contact-messages/:id/estado` (**cualquier transición**, sin máquina de estados),
`POST /admin/contact-messages/:id/responder` (envía a `ContactMessage.email`, **inmutable** —
nunca a un campo libre del formulario de respuesta). **Sin DELETE.**

**Motivos de contacto** *(ADMIN)* — `GET|POST /admin/contact-reasons`,
`PATCH /admin/contact-reasons/:id`, `PATCH /admin/contact-reasons/reorder`. **Sin DELETE**: solo
desactivación, y no se puede desactivar el último activo. Un motivo desactivado deja de ofrecerse,
pero los mensajes históricos lo conservan.

> El mensaje de contacto se renderiza siempre como texto plano; **`dangerouslySetInnerHTML` está
> prohibido en esa vista** — el remitente no está autenticado. Es la defensa XSS central del
> diseño, y es un contrato del consumidor, no del backend.

---

## Webhooks

- **`POST /webhooks/stripe`** — Protegido por `StripeWebhookGuard` (verificación de firma).
  Maneja 5 eventos y delega el trabajo en la cola `billing`.
- **`POST /webhooks/redsys`** — Protegido por `RedsysWebhookGuard` (HMAC vía `redsys-easy`).

Ninguno lleva JWT: **la autenticación es la firma**. Ambos son idempotentes por `GatewayEvent` y
encolan el trabajo en BullMQ en vez de hacerlo en la petición.

---

## Módulos internos — sin API HTTP

Cuatro de los 29 módulos no exponen ningún controlador. No tienen endpoints; documentarlos como
si los tuvieran sería inventarlos.

| Módulo | Qué es |
|---|---|
| **`expiration`** | Dos crons. 02:00 marca `EXPIRED` los `ACTIVE` vencidos, invalida caché y reindexa. 03:00 caduca los destacados y degrada a los Pro vencidos tras 7 días de gracia, moviendo a `DRAFT` los anuncios en exceso (los más antiguos primero). |
| **`geocoding`** | `GeocodingService`, con proveedor configurable (`nominatim` por defecto, `maptiler`). Timeout 3 000 ms. Se invoca desde el job `geocode`, nunca desde un controlador. |
| **`listing-activation`** | Punto único de enganche de **toda** transición a `ACTIVE` (`publish`, `approve`, `restore`, `renew`). Consolida el reindexado y es quien decide si se dispara el matching de alertas. |
| **`audit-log`** | `AuditLogService.log(dto, tx?)`, inyectable. La captura de `before`/`after` es **explícita dentro del servicio que muta**, nunca vía interceptor: un interceptor no puede ver el estado previo. |

También sin controlador propio, por vivir dentro de otros módulos: los 6 **processors** de BullMQ
(`image-processing`, `indexing`, `notifications`, `billing`, `redsys`, `alert-matching`) y el
`InvoiceProcessor` con su cron trimestral de facturación.

---

## Resumen de recursos

**Público / usuario autenticado**

| Recurso | Operaciones principales |
|---|---|
| Auth | register · login · admin-login · verify-email · forgot/reset-password · social/google · change/set-password |
| Users | GET/PATCH me · me/listings · search · GET /:slug · /:slug/listings · /:slug/reviews |
| Categories | árbol · detalle (esquema efectivo) · /:slug/tags · /:slug/listings (respaldo) |
| Listings | create · edit · publish · reserve · pause · reactivate · archive · renew · delete · **deals (sustituye a sold)** · contacts · bump · phone · view · mine/:id · mine stats · GET /:slug |
| Search | texto + filtros core + **atributos dinámicos por categoría** + rangos `_min`/`_max` + tags + proximidad + facetas · `hits` y `featured` separados |
| Media | upload · upload-avatar *(sin DELETE — deuda)* |
| Favorites | marcar · desmarcar · listar · check · **batch-check** |
| Reviews | create · eligibility · edit/delete (72 h) · listado en /users/:slug/reviews |
| Messaging | conversations REST (+cursor) · WS `/ws` (`message:new`; `conversation:read` **no implementado**) |
| Tickets (usuario) | create (enlace validado) · list · topics · hilo+cursor · reply/reopen (multipart) · adjunto autenticado · close |
| Tags | suggest |
| Blog / Páginas | GET /blog · /blog/:slug · /paginas · /paginas/:slug — contenido por **bloques** |
| Footer | GET /footer |
| Contact | token · motivos · submit (5 defensas anti-bot) |
| Alerts | create (+preview) · list · edit/pause · delete · matches |
| Notifications | list · unread-count · read · read-all |
| Billing | catalog *(público)* · checkout · cancel-subscription · my-subscriptions/entitlements/transactions · pro-status · featured-by-credits · wallet · bump-ledger |
| Redsys | checkout credits-pack / bump-pack / featured-pay (formulario firmado, redirección) |
| Invoicing | facturables · eligibility · facturas · my-invoices · pdf autenticado |
| Coupons | redeem |
| Banners | GET /banners |

**Backoffice**

| Recurso | Rol | Operaciones principales |
|---|---|---|
| Moderation | MODERATOR+ (crear reporte: cualquiera) | reports (cola, start-review, resolve, dismiss) · listings (approve/reject/deactivate/restore) · delete review |
| Admin general | ADMIN, con excepciones MODERATOR | stats · listings · users (suspend MODERATOR+, ban/role/trusted ADMIN) · categories + reorder + searchable-keys + attribute-usage · settings (whitelist, upsert) |
| Admin billing | ADMIN | transactions · wallets · detalle de usuario · acreditación manual · prices · credit-packs · bump-packs |
| Admin invoicing | ADMIN | invoices · detalle · pdf de cualquiera · fiscal-issuer (no retroactivo) |
| Admin blog | EDITOR+ (delete: ADMIN) | CRUD · publish/unpublish · upload-image |
| Admin footer | ADMIN | columns · items · reorder |
| Admin tags | ADMIN | CRUD · reorder · usage · tags por categoría |
| Admin sponsored-ads | ADMIN | CRUD · upload-image (sin endpoint público: se inyecta en /search) |
| Admin banners / campaigns / coupons | ADMIN | CRUD |
| Admin contacto | ADMIN | mensajes (listar, detalle, estado libre, responder) · motivos (CRUD + reorder, sin DELETE) |
| Tickets (staff) | MODERATOR+ | bandeja · take · reply/nota interna · adjuntos · resolve · close · reassign · flujo (b) · from-report (c) |
| Tickets (tiempo real) | — | WS `/ws` · ticket:join (acceso verificado en BD) · ticket:message · sala `staff` · **una nota interna NO sale de la sala staff** |
| Webhooks | firma, no JWT | stripe · redsys |

**Sin API HTTP:** `expiration`, `geocoding`, `listing-activation`, `audit-log`.
