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

## Tickets (atención al usuario) — rutas de USUARIO

Canal bidireccional usuario ↔ administración. Todas *(auth)* y **owner-scoped**: ninguna
acepta un `userId`; el scope sale siempre del JWT. La API de STAFF (bandeja, tomar,
resolver, cerrar, abrir hilo) es otra cosa y vive aparte — ver R3.

- **`POST /tickets`** *(auth)* — Abre un hilo (estado `OPEN`) con el primer mensaje.
  Puede enlazar **una** entidad: un anuncio propio, una valoración escrita o recibida, o
  una factura propia. `linkedLabel` (el snapshot legible del contexto) lo deriva el
  **servidor** del título/número real; nunca se acepta del cliente. `topicId` debe ser un
  `ContactReason` activo con `scope` `TICKET` o `BOTH`. Límite de 10 al día por usuario
  (`429` con `retryAfter`).
- **`GET /tickets`** *(auth)* — Mis tickets, orden por último movimiento, paginado
  (`page`/`perPage`), con `unreadCount` por hilo.
- **`GET /tickets/:id`** *(auth, propietario)* — El hilo, mensajes **más recientes
  primero** con cursor `?before=<messageId>` (mismo contrato que `GET /conversations/:id`).
  Marca como leídos los mensajes del staff pendientes. `403` si no es tuyo.
- **`POST /tickets/:id/messages`** *(auth, propietario)* — Responder. **Reabrir es
  escribir**: si el ticket estaba `RESOLVED` y no han pasado 14 días desde `resolvedAt`,
  responder lo devuelve a `IN_PROGRESS` (no hay endpoint `/reopen` aparte). Fuera de esa
  ventana → `400 REOPEN_WINDOW_EXPIRED`. Sobre un ticket `CLOSED` → `400`.
- **`POST /tickets/:id/close`** *(auth, propietario)* — Cerrar el propio, **irreversible**.
  Solo tickets de `origin=USER`: un hilo iniciado por la administración → `403`.

> **Enlace a entidades — decisión de seguridad.** Enlazar una entidad **ajena** y enlazar
> una **inexistente** devuelven exactamente la misma respuesta
> (`422 LINKED_ENTITY_NOT_ALLOWED`, mismo cuerpo). Es deliberado: un `404` para "no existe"
> y un `403` para "no es tuya" convertirían el campo en un oráculo con el que sondear la
> existencia de ids ajenos.

> **Notas internas del staff.** El modelo tiene `TicketMessage.internal`, pero está
> **aplazado**: no hay ninguna vía de escritura, y ninguna ruta de usuario las devuelve
> (ni en el hilo ni en el contador de no leídos).

---

## Tickets — rutas de STAFF

`@Roles(MODERATOR, ADMIN)` a nivel de clase (molde `ModerationController`). Controlador
SEPARADO del de usuario: los payloads difieren en lo esencial (este incluye las notas
internas y los datos del usuario), y tenerlos en clases distintas es lo que impide servir
uno por la puerta del otro.

- **`GET /admin/tickets`** — La bandeja. Filtros `status`, `origin`, `topicId` y
  `assignedTo` (un id de agente, o `me` / `none`). Orden por último movimiento, paginado.
- **`GET /admin/tickets/:id`** — El hilo completo, **incluidas las notas internas**
  (contraste exacto con `GET /tickets/:id`). Marca como leídos los mensajes del usuario.
- **`POST /admin/tickets/:id/take`** — T2: `OPEN → IN_PROGRESS`, auto-asignación.
- **`POST /admin/tickets/:id/messages`** — T3/T4. `OPEN`/`IN_PROGRESS` → `WAITING_USER`;
  responder sin haber tomado el ticket lo asigna de paso. El mensaje sale siempre con
  `side=STAFF` e `internal=false`.
- **`POST /admin/tickets/:id/resolve`** — T7: `IN_PROGRESS`/`WAITING_USER` → `RESOLVED`.
- **`POST /admin/tickets/:id/close`** — T10. **Irreversible.**
- **`POST /admin/tickets/:id/reassign`** — Cambia el agente asignado.
- **`POST /admin/tickets`** — **Flujo (b)**: abrir un hilo con un usuario concreto.
  `origin=ADMIN`, nace en `WAITING_USER` y asignado al agente. El usuario se elige con
  `GET /users/search`.
- **`POST /admin/tickets/from-report/:reportId`** — **Flujo (c)**: contactar con el usuario
  reportado. `origin=REPORT` + `reportId`.

> **Dos puertas ADMIN-only que el `RolesGuard` no puede vigilar** — dependen del CONTENIDO
> de la fila, no de la ruta, así que viven en el servicio:
> 1. **Ticket con `invoiceId` enlazada → ADMIN-only.** La facturación lo es en todo el
>    proyecto. El MODERATOR ni lo ve en la bandeja ni puede operarlo por **ningún** verbo
>    (`403 TICKET_BILLING_ADMIN_ONLY`): poder cerrar a ciegas lo que no puedes leer sería
>    una puerta trasera, no una excepción menor.
> 2. **Reasignar el ticket de OTRO agente → ADMIN-only**
>    (`403 TICKET_REASSIGN_ADMIN_ONLY`). Un MODERATOR sí puede coger uno sin asignar o
>    mover el suyo.

> **Avisos (R4) — vía auxiliar, nunca el canal.** Las transiciones disparan
> `Notification` in-app (`TICKET_MESSAGE` y `TICKET_OPENED` al usuario;
> `TICKET_STAFF_NEW` en fan-out al staff) y un email por Resend. **Ni la notificación ni
> el email llevan la conversación**: solo un extracto de ≤140 caracteres y el enlace al
> hilo, y los correos cierran con *"no respondas a este correo"* (no existe email entrante
> en el proyecto). El email al staff va a **una sola** dirección, `Setting.supportEmail`,
> no uno por administrador; sin configurar, se omite el correo y quedan los avisos in-app.
> Ningún aviso transiciona nada: el estado solo cambia por la acción HTTP.

> **Flujo (c) — el `Report` NO se modifica.** Se LEE para resolver el destinatario
> (usuario reportado → vendedor del anuncio → autor de la valoración) y se referencia desde
> `Ticket.reportId`. La cola de moderación sigue siendo la única dueña de su ciclo de vida:
> resolver el reporte y cerrar el ticket son acciones **independientes**. El destinatario lo
> resuelve el **servidor**; el body no puede elegirlo (no existe el campo, así que un intento
> se rechaza con 400).

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
| Tickets (usuario) | create (con enlace validado) · list mine · thread+cursor · reply/reopen · close |
| Tickets (staff) | bandeja+filtros · take · reply · resolve · close · reassign · flujo (b) · from-report (c) |
