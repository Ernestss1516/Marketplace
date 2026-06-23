# Contratos de la API — Marketplace

> **Fuente de verdad navegable:** Swagger en `http://localhost:3001/api/docs`
> (auto-generado desde controladores y DTOs de NestJS). Este documento es el
> **resumen de diseño de alto nivel**: qué recursos y operaciones existen y para qué
> sirven, más las decisiones que no son obvias leyendo solo las rutas. Para el detalle
> de campos, validaciones y tipos de respuesta exactos, consultar Swagger.

## Convenciones generales

- **Base URL:** `/api` (p. ej. `https://api.tudominio.es/api`).
- **Formato:** JSON en peticiones y respuestas, salvo subida de archivos (multipart).
- **Autenticación:** JWT en cabecera `Authorization: Bearer <token>`. Los endpoints
  marcados *(auth)* la requieren; *(propietario)* exige además ser el dueño del recurso.
- **Paginación:** `?page=1&perPage=24`. Respuesta: `{ items, total, page, perPage }`
  (búsqueda: `{ hits, totalHits, page, hitsPerPage }`).
- **Errores:** formato estándar de NestJS — `{ statusCode, message, error }`.

---

## Auth

Cinco operaciones. Flujo principal: `register → verify-email → login`.

- **`POST /auth/register`** — Crea la cuenta (no verificada) y envía el email de
  verificación.
- **`POST /auth/login`** — Devuelve `{ accessToken, user }`. El objeto `user` incluye
  `emailVerified` (añadido tras el diseño inicial para que el frontend pueda mostrar el
  aviso de verificación sin llamadas adicionales).
- **`POST /auth/verify-email`** — Marca el email como verificado y devuelve
  `{ verified: true, accessToken }` con un nuevo token ya firmado con
  `emailVerified: true`, evitando que el usuario tenga que volver a hacer login.
- **`POST /auth/forgot-password`** — Siempre responde `{ ok: true }` aunque el email
  no exista (nunca revela si una cuenta existe).
- **`POST /auth/reset-password`** — Invalida el token tras su uso (`usedAt`).

---

## Users

- **`GET /users/me`** *(auth)* — Perfil completo del usuario autenticado.
- **`PATCH /users/me`** *(auth)* — Actualiza nombre, teléfono, bio, ubicación y avatar.
- **`GET /users/:slug`** — Perfil público del vendedor (nombre, bio, ubicación, fecha de
  registro). Sin datos privados.
- **`GET /users/:slug/listings`** — Anuncios activos del vendedor, paginados.
- **`GET /users/me/listings`** *(auth)* — Mis anuncios (todos los estados), paginados.
  Acepta `?status=` para filtrar.

---

## Categories

- **`GET /categories`** — Árbol jerárquico completo (una sola llamada; sin paginación).
- **`GET /categories/:slug`** — Detalle con `attributeSchema`, que el frontend usa para
  renderizar el formulario de publicación y los filtros dinámicos por categoría.
- **`GET /categories/:slug/listings`** — Listado paginado de anuncios activos de esa
  categoría. Acepta `?sort=publishedAt:desc|price:asc|price:desc`.

---

## Listings (anuncios)

Ciclo de vida: `DRAFT → ACTIVE → RESERVED → SOLD` (y `EXPIRED` por caducidad automática
a los 60 días). Los anuncios `RESERVED` no caducan automáticamente.

- **`POST /listings`** *(auth)* — Crea en `DRAFT`. Acepta `imageIds` (IDs de imágenes ya
  subidas) y coordenadas opcionales. Si no se proporcionan coordenadas, el servicio las
  geocodifica desde ciudad/provincia con timeout de 1,5 s; un fallo de geocoding nunca
  bloquea la creación.
- **`PATCH /listings/:id`** *(auth, propietario)* — Edición parcial. Re-geocodifica si
  cambia algún campo de ubicación sin coordenadas explícitas.
- **`POST /listings/:id/publish`** *(auth, propietario)* — Pasa a `ACTIVE`, fija
  `publishedAt` y `expiresAt` (publishedAt + 60 días) e indexa en Meilisearch.
- **`POST /listings/:id/renew`** *(auth, propietario)* — Disponible en estado `ACTIVE` o
  `EXPIRED`. Reinicia `publishedAt` y `expiresAt` desde el momento actual.
- **`POST /listings/:id/reserve`** *(auth, propietario)* — Pasa a `RESERVED`.
- **`POST /listings/:id/sold`** *(auth, propietario)* — Pasa a `SOLD` y retira del índice.
- **`DELETE /listings/:id`** *(auth, propietario)* — Elimina y retira del índice. `204`.
- **`GET /listings`** — Anuncios recientes (solo `ACTIVE`), paginados. Usado en el home.
- **`GET /listings/:slug`** — Ficha pública (solo `ACTIVE`). Incrementa el contador de
  visitas; servida con caché Redis de 5 min.
- **`GET /listings/mine/:id`** *(auth, propietario)* — Ficha completa con todas las
  imágenes, para precargar el wizard de edición.

---

## Search (búsqueda)

- **`GET /search`** — Búsqueda de texto completo resuelta por Meilisearch. Devuelve datos
  suficientes para pintar la tarjeta sin ir a Postgres.
  - Filtros core: `q`, `category` (slug), `type`, `condition`, `priceType`, `minPrice`,
    `maxPrice`, `province`, `city`.
  - Atributos de categoría variables: `brand`, `fuel`, `gearbox`, `year`, `km`,
    `displacement`, `sqm`, `rooms`, `bathrooms`, `elevator`, `garage`, `pool`, `storage`,
    `ram`, `gender`, `size`, `specialty`, `subject`, `modality`.
  - **Proximidad:** `lat` + `lng` + `radius` (en **kilómetros**). Cuando los tres están
    presentes aplica `_geoRadius` en Meilisearch; los anuncios sin coordenadas quedan
    excluidos del resultado. Sin `sort` explícito, ordena por distancia ascendente.
  - `sort`: `price:asc | price:desc | publishedAt:desc`.
  - Devuelve facetas (`facets`) para alimentar el panel de filtros.

---

## Media (imágenes)

- **`POST /media/upload`** *(auth)* — Sube la imagen a R2/MinIO (`multipart/form-data`),
  crea un `ListingImage` huérfano y encola el procesado con sharp. Devuelve `{ id, url }`
  para incluir en el wizard antes de crear el anuncio.

> *Deuda: no existe `DELETE /media/:id`. Las imágenes de wizards abandonados permanecen
> huérfanas en almacenamiento y en la tabla `ListingImage` (ver `docs/estado-tecnico.md`).*

---

## Messaging (mensajería)

REST:

- **`GET /conversations`** *(auth)* — Lista de conversaciones con resumen (último mensaje,
  no leídos, thumbnail del anuncio).
- **`POST /conversations`** *(auth)* — Abre (o recupera) la conversación entre comprador y
  vendedor de un anuncio y envía el primer mensaje.
- **`GET /conversations/:id`** *(auth, participante)* — Mensajes en orden cronológico con
  cursor. Marca la conversación como leída al abrirla.
- **`POST /conversations/:id/messages`** *(auth, participante)* — Persiste el mensaje y
  emite el evento WebSocket correspondiente.

WebSocket en `/ws` *(autenticación JWT en el handshake)*:

- **`message:new`** (servidor → cliente) — Nuevo mensaje en cualquier conversación del
  usuario, tanto en el chat abierto como en la bandeja.
- *`conversation:read` (servidor → cliente) está definido en el diseño original pero
  **no está implementado** todavía; el contador de no leídos solo se actualiza al
  reabrir la conversación.*

> Los mensajes se envían únicamente por REST (`POST /conversations/:id/messages`).
> No existe un evento `message:send` de cliente a servidor por WebSocket.

---

## Resumen de recursos

| Recurso | Operaciones principales |
|---|---|
| Auth | register · login · verify-email · forgot-password · reset-password |
| Users | GET/PATCH me · me/listings · GET /:slug (perfil) · /:slug/listings |
| Categories | árbol · detalle+attributeSchema · listings por categoría |
| Listings | create · edit · publish · renew · reserve · sold · delete · recent · /:slug · mine/:id |
| Search | texto+filtros+facetas+proximidad (lat/lng/radius en km) |
| Media | upload |
| Messaging | conversations REST (CRUD + cursor) · WebSocket /ws (message:new) |
