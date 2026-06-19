# Contratos de la API — MVP

> **Alcance:** endpoints del MVP (fases 0-5). Quedan fuera favoritos, valoraciones,
> backoffice y moderación (fases 6-7).
>
> **Nota:** este documento es la guía de diseño de la API. Una vez construida, la
> fuente de verdad navegable será la documentación **OpenAPI/Swagger** que NestJS
> genera automáticamente a partir de los controladores y DTOs (`/api/docs`).

## Convenciones generales

- **Base URL:** `/api` (p. ej. `https://api.tudominio.es/api`). Versionado opcional con `/api/v1`.
- **Formato:** JSON en peticiones y respuestas (`Content-Type: application/json`), salvo subida de archivos (multipart).
- **Autenticación:** JWT en cabecera `Authorization: Bearer <token>`. Los endpoints marcados *(auth)* la requieren; *(propietario)* exige además ser el dueño del recurso.
- **Paginación:** parámetros `?page=1&perPage=24`. Respuesta: `{ items: [...], total, page, perPage }`.
- **Errores:** formato estándar de NestJS — `{ statusCode, message, error }`.
- **Códigos:** `200` OK · `201` Creado · `400` Petición inválida · `401` No autenticado · `403` Sin permiso · `404` No encontrado · `409` Conflicto (p. ej. email ya registrado) · `422` Error de validación.

---

## Auth

**`POST /auth/register`** — Registro
Crea un usuario en estado no verificado y envía el email de verificación.
- Body: `{ name, email, password }`
- Response `201`: `{ id, name, email, slug, emailVerified: false }`
- Errores: `409` email ya registrado · `422` validación (email/contraseña)

**`POST /auth/login`** — Inicio de sesión
- Body: `{ email, password }`
- Response `200`: `{ accessToken, user: { id, name, email, slug, role } }`
- Errores: `401` credenciales incorrectas

**`POST /auth/verify-email`** — Verificar email
- Body: `{ token }`
- Response `200`: `{ verified: true }`
- Errores: `400` token inválido o caducado

**`POST /auth/forgot-password`** — Solicitar recuperación
Envía un email con el enlace de restablecimiento. Responde `200` aunque el email no exista (para no revelar cuentas).
- Body: `{ email }`
- Response `200`: `{ ok: true }`

**`POST /auth/reset-password`** — Restablecer contraseña
- Body: `{ token, newPassword }`
- Response `200`: `{ ok: true }`
- Errores: `400` token inválido o caducado

---

## Users

**`GET /users/me`** — Perfil propio *(auth)*
- Response `200`: `{ id, name, email, slug, phone?, avatarUrl?, bio?, city?, province?, role }`

**`PATCH /users/me`** — Actualizar perfil propio *(auth)*
- Body (campos opcionales): `{ name?, phone?, avatarUrl?, bio?, city?, province?, postalCode? }`
- Response `200`: usuario actualizado

**`GET /users/:slug`** — Perfil público de un vendedor
- Response `200`: `{ name, slug, avatarUrl?, bio?, city?, province?, memberSince }`
- Errores: `404` no encontrado

---

## Categories

**`GET /categories`** — Árbol de categorías
- Response `200`: lista jerárquica `[{ id, name, slug, iconUrl?, children: [...] }]`

**`GET /categories/:slug`** — Detalle de una categoría
Incluye el `attributeSchema`, que el frontend usa para pintar el formulario de publicación y los filtros.
- Response `200`: `{ id, name, slug, attributeSchema: [{ name, label, type, unit?, options?, filterable, required }] }`
- Errores: `404` no encontrada

---

## Listings (anuncios)

**`POST /listings`** — Crear anuncio *(auth)*
Nace en estado `DRAFT`.
- Body: `{ title, description, price, currency?, type, condition?, categoryId, attributes, city, province, postalCode?, latitude?, longitude?, imageIds? }`
- Response `201`: `{ id, slug, status: "DRAFT", ... }`
- Errores: `422` validación (incl. atributos requeridos de la categoría)

**`PATCH /listings/:id`** — Editar anuncio *(auth, propietario)*
- Body: campos parciales del anuncio
- Response `200`: anuncio actualizado
- Errores: `403` no es el propietario · `404` no existe

**`POST /listings/:id/publish`** — Publicar *(auth, propietario)*
Pasa el anuncio a `ACTIVE`, fija `publishedAt` y encola el indexado en Meilisearch.
- Response `200`: `{ id, slug, status: "ACTIVE", publishedAt }`

**`POST /listings/:id/reserve`** — Marcar reservado *(auth, propietario)*
- Response `200`: `{ id, status: "RESERVED" }`

**`POST /listings/:id/sold`** — Marcar vendido *(auth, propietario)*
Pasa a `SOLD` y se retira del índice de búsqueda.
- Response `200`: `{ id, status: "SOLD" }`

**`DELETE /listings/:id`** — Eliminar *(auth, propietario)*
- Response `204`: sin contenido

**`GET /listings/:slug`** — Ficha pública de anuncio
Solo anuncios `ACTIVE`. Incrementa el contador de visitas.
- Response `200`: `{ id, title, slug, description, price, currency, type, condition?, attributes, city, province, latitude?, longitude?, images: [{ url, alt? }], category: { name, slug }, seller: { name, slug, avatarUrl? }, publishedAt }`
- Errores: `404` no encontrado o no activo

**`GET /categories/:slug/listings`** — Listado por categoría
Paginado. Para navegación directa por categoría (la búsqueda con filtros va por `/search`).
- Query: `?page=1&perPage=24&sort=publishedAt:desc`
- Response `200`: `{ items: [ResumenAnuncio], total, page, perPage }`

**`GET /users/me/listings`** — Mis anuncios *(auth)*
- Query: `?status=ACTIVE&page=1`
- Response `200`: `{ items: [ResumenAnuncio], total, page, perPage }`

*`ResumenAnuncio`*: `{ id, title, slug, price, currency, thumbnailUrl?, city, province, status, publishedAt }`

---

## Search (búsqueda)

**`GET /search`** — Búsqueda de anuncios
Resuelta por Meilisearch. Devuelve resumen de anuncio para pintar la tarjeta sin volver a la base de datos.
- Query:
  - `q` — texto de búsqueda
  - `category` — slug de categoría
  - `type` — `PRODUCT` | `SERVICE`
  - `minPrice`, `maxPrice`
  - `province`, `city`
  - atributos variables (p. ej. `fuel=Diésel`, `year=2018`)
  - `lat`, `lng`, `radius` — búsqueda por proximidad (metros)
  - `sort` — `price:asc` | `price:desc` | `publishedAt:desc`
  - `page`, `hitsPerPage`
- Response `200`: `{ hits: [ResumenAnuncio], totalHits, page, hitsPerPage, facets? }`

---

## Media (imágenes)

**`POST /media/upload`** — Subir imagen *(auth)*
Sube la imagen a Cloudflare R2 (vía API S3) y encola el procesado de miniaturas. Petición `multipart/form-data`.
- Body: campo `file` (imagen)
- Response `201`: `{ id, url, width?, height? }`
- Errores: `422` tipo o tamaño no válidos

> *Alternativa recomendada a escala:* `POST /media/presign` devuelve una URL firmada para subir el archivo directamente a R2 desde el cliente, descargando al backend del tráfico de subida. Para el MVP, la subida directa al backend es suficiente.

---

## Messaging (mensajería)

**`GET /conversations`** — Mis conversaciones *(auth)*
- Response `200`: `{ items: [{ id, listing: { id, title, slug, thumbnailUrl? }, otherUser: { name, slug }, lastMessageAt, unreadCount }] }`

**`POST /conversations`** — Iniciar conversación *(auth)*
Crea (o recupera, si ya existe) la conversación entre el comprador y el vendedor de un anuncio, con el primer mensaje.
- Body: `{ listingId, message }`
- Response `201`: `{ id, listingId, messages: [...] }`
- Errores: `404` anuncio no existe

**`GET /conversations/:id`** — Mensajes de una conversación *(auth, participante)*
- Query: `?page=1&perPage=50`
- Response `200`: `{ id, listing, otherUser, messages: [{ id, senderId, body, readAt?, createdAt }] }`
- Errores: `403` no participa en la conversación

**`POST /conversations/:id/messages`** — Enviar mensaje *(auth, participante)*
- Body: `{ body }`
- Response `201`: `{ id, senderId, body, createdAt }`

**WebSocket `/ws`** *(auth)* — Tiempo real
Canal de eventos para la mensajería instantánea.
- Eventos servidor → cliente: `message:new` `{ conversationId, message }`, `conversation:read` `{ conversationId }`
- Eventos cliente → servidor: `message:send` `{ conversationId, body }`, `conversation:markRead` `{ conversationId }`

---

## Resumen de endpoints (MVP)

| Recurso | Endpoints |
|---|---|
| Auth | register · login · verify-email · forgot-password · reset-password |
| Users | GET/PATCH /users/me · GET /users/:slug |
| Categories | GET /categories · GET /categories/:slug |
| Listings | POST · PATCH · publish · reserve · sold · DELETE · GET /:slug · listados |
| Search | GET /search |
| Media | POST /media/upload |
| Messaging | conversations (CRUD) · WebSocket /ws |
