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

**CORS del gateway (R9):** el handshake solo se autoriza desde `APP_URL` (el origen del
frontend), en forma de **array de un elemento** — con `origin` como cadena, el paquete `cors`
emite la cabecera sin comparar; con array, la omite cuando el origen no casa.

Antes era `origin: '*'` con un `TODO(prod)`. **Sin vender más de lo que es:** es defensa en
profundidad, **no** el control de acceso. Quien autoriza es el token del handshake y, por ser un
token explícito y no una cookie, este gateway nunca fue vulnerable a *cross-site WebSocket
hijacking*. Además el protocolo WebSocket no pasa por CORS (solo el polling y el handshake) y el
propio frontend conecta con `transports: ['websocket']`, así que en la práctica el CORS **no está
ni en el camino vivo** de esta aplicación. Cerrarlo es higiene —quita el `*` del inventario y
cierra el camino fácil—, no el cierre de un exploit.

**Salas y eventos de TICKETS (R9), en el mismo namespace `/ws`:**

- **`ticket:join`** (cliente → servidor, `{ ticketId }`) — Pide entrar en la sala del hilo.
  El servidor **verifica el acceso contra la base de datos antes de unir** (molde
  `conversation:join`): entra el dueño del ticket, o un agente — con la puerta ADMIN-only de
  facturación aplicada, así que un `MODERATOR` **no** entra en la sala de un ticket con
  `invoiceId`. Un hilo ajeno y un hilo inexistente reciben el mismo `error: Forbidden`, sin
  distinguirlos (mismo criterio anti-oráculo que el guard de enlace de R2).
- **`ticket:message`** (servidor → cliente) — Mensaje nuevo en un hilo. Llega a la sala
  `ticket:<id>`, a la sala personal `user:<id>` del dueño (para que su lista se mueva sin
  tener el hilo abierto) y a la sala de rol `staff` (bandeja).
- **Sala de rol `staff`** — Los agentes entran al conectar, con el rol **leído de la base de
  datos**, no del token: los JWT duran 7 días y un rol revocado seguiría viajando en uno
  válido.

> **UNA NOTA INTERNA NO SALE DE LA SALA `staff`.** Es la invariante §10.3 aplicada al canal
> de tiempo real: `ticket:<id>` contiene al usuario y al agente a la vez, así que una nota
> emitida ahí se le entregaría al usuario. El agente que mira el hilo la recibe igualmente
> por la sala `staff`.

> **El WebSocket es ADICIONAL, no sustituye a la `Notification`.** El socket es para quien
> tiene la pantalla delante ahora; la notificación in-app y el email son para quien no está
> mirando, y quedan como registro. Los dos canales se disparan en la misma acción.

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
- **`GET /tickets/topics`** *(auth)* — Motivos ofrecibles al abrir un ticket:
  `ContactReason` activos con `scope` `TICKET` o `BOTH`. **No** es `GET /contacto/motivos`
  (ese sirve el ámbito contrario, `PUBLIC`+`BOTH`) ni `GET /admin/contact-reasons`
  (ADMIN-only y devuelve también los inactivos). Declarado **antes** de `:id` en el
  controlador, o Nest buscaría un ticket con id `"topics"`.
- **`GET /tickets/:id`** *(auth, propietario)* — El hilo, mensajes **más recientes
  primero** con cursor `?before=<messageId>` (mismo contrato que `GET /conversations/:id`).
  Marca como leídos los mensajes del staff pendientes. `403` si no es tuyo.
- **`POST /tickets/:id/messages`** *(auth, propietario)* — Responder. **Reabrir es
  escribir**: si el ticket estaba `RESOLVED` y no ha vencido la ventana de reapertura
  (`Setting.ticketAutoCloseWindowDays`, por defecto 14 días desde `resolvedAt`), responder
  lo devuelve a `IN_PROGRESS` (no hay endpoint `/reopen` aparte). Fuera de esa ventana →
  `400 REOPEN_WINDOW_EXPIRED`. Sobre un ticket `CLOSED` → `400`.
  El body **no admite `internal`** (ver más abajo).
  **Acepta `multipart/form-data` además de JSON** (R5): campo `body` + hasta 5 ficheros en
  `files`. JSON sigue funcionando exactamente igual.
- **`GET /tickets/:id/attachments/:attachmentId`** *(auth, propietario)* — Descarga un
  adjunto. `403` si el ticket no es tuyo; **`404` si el adjunto es de una nota interna** del
  staff (para el usuario, una nota interna no existe — un `403` confirmaría que hay algo) o
  si no pertenece a ese ticket.
- **`POST /tickets/:id/close`** *(auth, propietario)* — Cerrar el propio, **irreversible**.
  Solo tickets de `origin=USER`: un hilo iniciado por la administración → `403`.

> **Enlace a entidades — decisión de seguridad.** Enlazar una entidad **ajena** y enlazar
> una **inexistente** devuelven exactamente la misma respuesta
> (`422 LINKED_ENTITY_NOT_ALLOWED`, mismo cuerpo). Es deliberado: un `404` para "no existe"
> y un `403` para "no es tuya" convertirían el campo en un oráculo con el que sondear la
> existencia de ids ajenos.

> **Notas internas del staff — la vía de usuario está CERRADA.** El staff sí puede escribir
> notas internas (ver la ruta de staff), pero **ninguna ruta de usuario las devuelve ni las
> acepta**: no salen en el hilo, no cuentan en `unreadCount`, no mueven `lastMessageAt`, y
> un `internal` en el body de `POST /tickets` o `POST /tickets/:id/messages` se rechaza con
> `400`. El campo solo existe en el DTO de staff (`SendStaffMessageDto`), que extiende al de
> usuario — la herencia solo propaga hacia el lado seguro. **Los ADJUNTOS de una nota interna
> heredan su privacidad**: el endpoint de descarga del usuario responde `404`.

> **ADJUNTOS (R5) — NO HAY URL PÚBLICA, y es la garantía central.** A diferencia de
> `POST /media/upload`, que devuelve una URL servida por el bucket, de un adjunto de ticket
> solo se guarda la **clave** de R2 (`TicketAttachment.key`), que **ni siquiera viaja en el
> payload del hilo**: el fichero existe únicamente detrás del endpoint autenticado de
> descarga, que revalida el acceso en CADA petición (molde `GET /billing/invoices/:id/pdf`).
> Límites: JPEG/PNG/WebP + PDF, 10 MB por fichero, 5 por mensaje. Rechazos con `422` y
> `code`: `ATTACHMENT_TYPE_NOT_ALLOWED`, `ATTACHMENT_TOO_LARGE`, `TOO_MANY_ATTACHMENTS`. La
> clave se compone con bytes aleatorios, nunca con el nombre subido; ese nombre solo se usa
> para mostrar y para el `Content-Disposition`.

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
- **`POST /admin/tickets/:id/messages`** — T3/T4, **o una NOTA INTERNA**. `side=STAFF`
  siempre.
  · Con `internal: false` (o ausente): respuesta al usuario. `OPEN`/`IN_PROGRESS` →
    `WAITING_USER`, y asigna el ticket al autor si no lo llevaba nadie.
  · Con `internal: true`: **nota interna**. Se guarda en el hilo, la ve solo el equipo, y
    **no toca el ticket** (ni estado, ni asignación, ni `lastMessageAt` — ese campo lo lee
    el usuario) **ni dispara ningún aviso**. Auditada como `TICKET_INTERNAL_NOTE`, no como
    `TICKET_REPLY`.
  · **Acepta `multipart/form-data`** (R5), igual que la ruta de usuario. En multipart
    `internal` viaja como la cadena `"true"`/`"false"` y el DTO convierte **solo** esos dos
    valores exactos; cualquier otro sigue dando `400`.
- **`GET /admin/tickets/:id/attachments/:attachmentId`** — Descarga un adjunto desde el lado
  del staff. Las notas internas **sí** se sirven aquí (el staff es su destinatario), y se
  aplica la puerta ADMIN-only de facturación: un `MODERATOR` no descarga el adjunto de un
  ticket con factura enlazada, igual que no puede abrirlo (`403 TICKET_BILLING_ADMIN_ONLY`).
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
| Messaging | conversations REST (CRUD + cursor) · WebSocket /ws (message:new, CORS restringido a APP_URL) |
| Tickets (usuario) | create (con enlace validado) · list mine · topics · thread+cursor · reply/reopen (multipart con adjuntos) · descarga de adjunto autenticada · close |
| Tickets (staff) | bandeja+filtros · take · reply/nota interna (multipart) · descarga de adjunto · resolve · close · reassign · flujo (b) · from-report (c) |
| Tickets (tiempo real) | WebSocket /ws · ticket:join (acceso verificado en BD) · ticket:message · sala de rol staff · **una nota interna NO sale de la sala staff** |
