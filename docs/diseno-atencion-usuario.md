# Diseño del sistema de atención al usuario (tickets) — revisión 1

> ## ⚠️ ESTADO: APROBADO E IMPLEMENTADO, salvo dos incrementos
>
> **Este documento es el DISEÑO, no el estado.** Se conserva tal como se aprobó (2026-07-28)
> porque explica el *porqué* de cada decisión; para saber qué hay construido de verdad, la
> referencia es **`estado-tecnico.md` → «Sistema de atención al usuario (tickets) — ESTADO
> CONSOLIDADO»**. Donde este documento y el código difieran, **manda el código**.
>
> **Implementado** (ráfagas R1, R2, R3, R4, R6, R7, R8 + notas internas): modelo, máquina de
> estados completa (las 11 transiciones con disparador), API de usuario y de staff, los tres
> flujos, avisos in-app + email auxiliar, frontend de usuario y de staff, cron de auto-cierre,
> y las notas internas con sus cinco defensas.
>
> **NO implementado, y por tanto lo que este documento describe ahí es plan, no realidad:**
> - **§14.7 / R5 — ADJUNTOS.** El modelo `TicketAttachment` existe en el schema; la subida y
>   la descarga **no están construidas**. No hay endpoint, ni UI, ni escritura en R2.
> - **§12 / R9 — TIEMPO REAL.** No se ha tocado. Sigue en pie la recomendación de no hacerlo
>   antes de cerrar el `TODO(prod)` del `cors: { origin: '*' }` de `MessagingGateway`.
> - **§14.5 — los dos huecos de notificación de moderación** (avisar al denunciante del
>   desenlace de su denuncia; avisar al vendedor cuando le rechazan un anuncio). Se dejaron
>   fuera de alcance a propósito: se resuelven con `Notification`, no con tickets.
>
> **Decisiones que la implementación cambió respecto a lo aprobado aquí** (detalle y motivo
> en `estado-tecnico.md`):
> - Un ticket abierto por el staff (flujos b/c) nace en **`WAITING_USER` y asignado** al
>   agente, no en `OPEN` sin asignar como decía §7.2 T1.
> - La ventana de reapertura de §14.2 es un **`Setting` configurable en caliente**
>   (`ticketAutoCloseWindowDays`), no una constante; el guard de T8 y el cron de T9 la leen
>   del mismo sitio.
> - `TICKET_REOPEN` (§7.3) **no tiene emisor**: la única reapertura de la matriz es del
>   usuario, y las acciones de usuario no se auditan.
> - La puerta ADMIN-only de los tickets con factura (§10.2) cubre **todos los verbos**, no
>   solo ver y responder.
>
> **Fecha del diseño:** 2026-07-28
> **Alcance:** canal de comunicación bidireccional y trazable usuario ↔ administración,
> con máquina de estados, enlace a entidades del marketplace (anuncio / valoración /
> factura), y reutilización de `Notification` + Resend como vías auxiliares.
>
> Este documento se divide en dos mitades: **§1–§4 son AUDITORÍA** (lo que hay HOY en el
> código real, verificado leyendo los ficheros — no lo que se supone que hay), y
> **§5–§14 son PROPUESTA**. Donde la auditoría contradice una premisa de partida, se dice
> explícitamente.

---

# PARTE A — AUDITORÍA

## 1. Sistemas existentes que podrían solaparse

### 1.1 `ContactMessage` — qué es HOY

Ficheros: `apps/api/src/modules/contact/` (8 ficheros + 7 DTOs), modelos `ContactMessage`,
`ContactReply`, `ContactReason` en `schema.prisma:1659-1728`. Migraciones
`add_contact_message`, `add_contact_reason`, `drop_contact_motivo_enum`.
Test: `test/rc1-contact.e2e-spec.ts`.

**Es un formulario de contacto público, anónimo y de una sola dirección dentro de la
plataforma.** Los hechos:

| Aspecto | Realidad en el código |
|---|---|
| Autenticación | **Ninguna.** `POST /contacto` no lleva guard (`contact.controller.ts`). Es el único endpoint de escritura sin JWT junto a `/auth/register`. |
| Relación con `User` | **No existe.** `ContactMessage` no tiene `userId`. El comentario del schema lo dice: *"Sin relación a User: el remitente no está autenticado"*. Solo guarda `email` + `telefono?` sueltos. |
| Hilo | **No hay hilo bidireccional.** Hay `ContactReply` (1:N), pero es **solo del admin**: `adminUserId`, `asunto`, `cuerpo`. El remitente no tiene forma de responder dentro de la plataforma — no tiene cuenta ni vista. |
| Vía de respuesta | **Email saliente.** `ContactService.reply()` encola `SEND_CONTACT_REPLY` con `to: message.email`. La plataforma **no** es la fuente de verdad de la conversación: es un buzón + un email. |
| Estado | `ContactEstado { NUEVO, LEIDO, RESPONDIDO, CERRADO }`. |
| Máquina de estados | **No hay.** `updateEstado()` (`contact.service.ts:187`) no valida ninguna transición: cualquier estado → cualquier otro. Decisión explícita y documentada en `estado-tecnico.md` (RC.2, Ajuste 1): *"el admin sabe lo que hace"*. `CERRADO` **no es terminal**. Hay dos automatismos: `NUEVO→LEIDO` al abrir (`findOne`), `→RESPONDIDO` al responder. |
| Consumo en admin | `AdminContactMessagesController`, **`@Roles(ADMIN)` a nivel de clase — el MODERATOR no entra**. Frontend `/admin/mensajes-contacto` + `/[id]`. No está en `NAV_ITEMS` para MODERATOR. |
| Defensas | 5, todas en `submit()`: honeypot silencioso, time-trap HMAC firmado, rate limit Redis (5/h IP + 200/h global), texto plano anti-XSS, `to` inmutable anti header-injection. Documentadas en `estado-tecnico.md` §RC.1. |
| Motivos | `ContactReason` (`nombre`, `orden`, `activo`) — configurable por admin, sin DELETE (solo desactivación), guard "no desactivar el último activo". CRUD en `/admin/motivos-contacto`. |

**¿Podría un ticket nacer de un `ContactMessage`?** Técnicamente sí, pero hay una brecha
de identidad real: un `ContactMessage` solo tiene un `email` en texto, sin verificar y sin
`User`. Convertirlo en ticket exige resolver `email → User` (puede no existir, puede
existir y no ser el remitente real — nadie verificó ese email). **Son cosas distintas por
construcción**: `ContactMessage` es el canal *pre-cuenta / anónimo*; un ticket exige una
cuenta para poder hacer owner-scope, notificar y mantener un hilo. Ver §10.2 para la
recomendación de coexistencia.

### 1.2 Moderación y reportes — qué está y qué NO está cubierto

Ficheros: `apps/api/src/modules/moderation/` (`moderation.service.ts` 370 líneas,
`moderation.controller.ts`). Modelo `Report` en `schema.prisma:817-846`.
Test: `test/moderation.e2e-spec.ts` (45 casos).

**El modelo `Report`:**

```prisma
model Report {
  id, reason ReportReason, description String?, status ReportStatus @default(PENDING)
  reporterId String                          // quién denuncia
  listingId  String?                         // denuncia SOBRE un anuncio
  reportedUserId String?                     // denuncia SOBRE un usuario
  reviewId   String?                         // denuncia SOBRE una valoración
  resolvedById String?  resolvedAt DateTime? // auditoría de resolución
  @@index([status]) @@index([listingId]) @@index([reviewId])
}
```

- `ReportReason { SPAM, FRAUD, INAPPROPRIATE, PROHIBITED_ITEM, WRONG_CATEGORY, FAKE_REVIEW, OTHER }`
- `ReportStatus { PENDING, REVIEWING, RESOLVED, DISMISSED }`

**Sí tiene máquina de estados con guards reales** (a diferencia de `ContactMessage`):
`startReview()` exige `PENDING`; `resolveReport()`/`dismissReport()` exigen
`PENDING | REVIEWING` (`'El reporte ya está cerrado'`). `RESOLVED`/`DISMISSED` son
terminales de facto — ninguna transición sale de ellos.

**Acciones que el admin/moderador puede tomar:** aprobar / rechazar / desactivar /
restaurar un anuncio, y borrar una valoración. Con `AuditLog`
(`REPORT_RESOLVE`, `REPORT_DISMISS`, `LISTING_*`, `REVIEW_DELETE`).
Roles: `@Roles(MODERATOR, ADMIN)` en la clase; `createReport` se abre a
`@Roles(USER, MODERATOR, ADMIN)` a nivel de método.

**HALLAZGO CRÍTICO para el flujo (c): la moderación NO comunica con nadie.**
`moderation.service.ts` no inyecta `NotificationsService`, no inyecta ninguna cola de
notificaciones, y no crea ni una sola `Notification` ni un solo email. Verificado leyendo
el fichero completo. En consecuencia, HOY:

- El **usuario reportado** no se entera nunca de que existe una denuncia sobre él.
- Al que **denuncia** no se le dice nunca en qué acabó su denuncia.
- A los **admins** no les llega aviso de que hay una denuncia nueva (a diferencia de
  `ContactMessage`, que sí hace fan-out). La cola de `/admin/reportes` hay que mirarla.
- Cuando se **rechaza o desactiva un anuncio** (`rejectListing`, `deactivateListing`), el
  vendedor tampoco recibe aviso alguno: el anuncio simplemente desaparece del marketplace.

**Respuesta honesta a la pregunta de Ernest** ("¿el flujo (c) ya está cubierto por la
moderación?"): **el flujo (c) tiene dos mitades, y están en extremos opuestos.**

1. **Triaje de la denuncia (recepción, estados, decisión, acción sobre el contenido,
   auditoría): YA ESTÁ, y está bien hecho.** Reinventarlo en el sistema de tickets sería
   duplicación pura y crearía dos colas de moderación incoherentes.
2. **Comunicación con el usuario reportado: NO EXISTE EN ABSOLUTO.** Ni siquiera un aviso.
   Este es exactamente el hueco que el sistema nuevo debe llenar.

Recomendación derivada (detalle en §8.3): **no tocar `Report`**; añadir un enlace
`Ticket.reportId` y una acción de admin *"abrir hilo con el usuario reportado"* desde la
ficha del reporte. Moderación sigue siendo la cola de triaje; tickets es el canal de
comunicación. Cero duplicación, cero riesgo sobre `moderation.e2e-spec.ts`.

*(Hallazgo menor colateral: `startReview()` es la única transición de `Report` que **no**
escribe `AuditLog`. Inconsistencia con `resolve`/`dismiss`. No bloquea nada; anotado.)*

### 1.3 `Notification` — encaje

Modelo en `schema.prisma:569-598`. Servicio: `notifications.service.ts` (66 líneas).
Tipos: `notification.types.ts`. Frontend: `components/notifications/NotificationBell.tsx`,
`notification-content.ts`, `/notificaciones`.

```prisma
model Notification {
  id, userId (Cascade), type String, data Json, read Boolean, readAt, createdAt
  @@index([userId, createdAt])  @@index([userId, read])
}
```

Puntos que importan para el diseño:

- **`type` es `String`, no enum — a propósito**, para añadir tipos sin migración. El
  comentario del schema lo dice y `estado-tecnico.md` §RC.1 lo confirma como objetivo
  explícito del diseño de B1, ya validado una vez al añadir `CONTACT_MESSAGE`.
- **`data` es un snapshot autocontenido, NO punteros.** Regla invariante del proyecto:
  la notificación debe renderizarse sin consultas adicionales y sobrevivir al borrado de
  la entidad que la originó. `ContactService.notifyAdmins` recibe el *nombre* del motivo
  ya resuelto, no el `motivoId`, precisamente por esto.
- **Tipado en TS sin tocar la BD:** `NotificationType` (unión de literales) + una
  `interface` de `data` por tipo + el mapa `DataByType` en `notifications.service.ts`, y
  un `case` en `getNotificationContent()` (frontend). Añadir un tipo = 4 puntos de
  edición, **cero migraciones**.
- **Es estrictamente `userId` 1:1. No hay buzón de rol.** El patrón establecido para
  avisar a la administración es el **fan-out** de `ContactService.notifyAdmins()`:
  `findMany({where:{role:'ADMIN'}})` + una `Notification` y un job de email por admin.
  Con su limitación ya aceptada y documentada: cuando un admin atiende, las
  notificaciones de los demás no se marcan leídas.
- Marcado como leída: `markRead()` usa `updateMany({ where: { id, userId, read: false } })`
  — **scoped por `userId`, nunca confía en el `:id` solo**, e idempotente.

**Encaja perfectamente** para "tienes un mensaje nuevo en tu ticket". Lo que hay que
añadir: los tipos nuevos (§9.1). Sin migración.

*(Hallazgo menor: `INVOICING_PENDING_FISCAL_DATA` existe en el backend
(`notification.types.ts:5`) pero **no** tiene `case` en `notification-content.ts` — cae
al `default` genérico "Nueva notificación". No es de este sistema, pero confirma que el
`case` del frontend es un paso fácil de olvidar; lo incluyo explícitamente en las ráfagas.)*

### 1.4 Email (Resend) — encaje

`infra/queue/processors/notification.processor.ts` + `infra/queue/notification.types.ts`.

- **Resend**, instanciado con `resend.apiKey` / `resend.from` (`getOrThrow`), dentro de un
  `@Processor(QUEUE_NOTIFICATIONS)` de BullMQ. Nunca inline en la request.
- 6 jobs hoy: `SEND_VERIFICATION_EMAIL`, `SEND_RESET_EMAIL`, `SEND_ALERT_EMAIL`,
  `SEND_CONTACT_NOTIFICATION`, `SEND_CONTACT_REPLY`, `SEND_REVIEW_REQUEST_EMAIL`.
- **Regla invariante: `text:` siempre, `html:` nunca.** Los 6 la cumplen. Está documentada
  como defensa nº4 de RC.1 y es la razón de que no haga falta sanitizado.
- Errores → `Sentry.captureException` + rethrow (para que BullMQ reintente).
- Reintentos: `retryQueue(name)` en `queue.constants.ts` (3 intentos, backoff exponencial).
  Hay un test estructural (`queue-retry.e2e-spec.ts`) que **grepea `src/` y falla la suite**
  si algún `registerQueue()` no pasa por ese helper. Un módulo nuevo con cola debe usarlo.
- Un job por destinatario, nunca un job con lista de destinatarios (así un email que falla
  solo reintenta el suyo).

**Encaja para el aviso auxiliar.** Y hay un dato decisivo para §11: **no existe ninguna
vía de email ENTRANTE.** No hay webhook de Resend inbound, ni parser de respuestas, ni
verificación de remitente. Responder por email hoy no llega a ninguna parte.

---

## 2. Entidades enlazables y el patrón polimórfico del proyecto

IDs: `Listing.id`, `Review.id`, `Invoice.id` son todos `String @id @default(cuid())`.

**El proyecto usa DOS patrones polimórficos distintos, y ya ha elegido cuál va en cada
sitio:**

**Patrón A — FKs nullables múltiples (integridad referencial real).**
Es lo que usa `Report`: `listingId?`, `reportedUserId?`, `reviewId?`, con la validación
"al menos uno" en el service (`UnprocessableEntityException`), no en la BD. Ventaja:
`include` directo de Prisma, `onDelete` gestionado, sin ids huérfanos.

**Patrón B — `referenceType: String` + `referenceId: String` (sin FK).**
Lo usan `CreditLedger`, `BumpLedger` y `CouponRedemption`. Ventaja: abierto a entidades
futuras sin migración. Coste: cero integridad, cero `include`.

**Recomendación para el ticket: patrón A (molde `Report`).** El conjunto de entidades
enlazables es cerrado y conocido (anuncio / valoración / factura / reporte), la vista del
hilo necesita mostrar la tarjeta de la entidad enlazada (eso es un `include`, no una
segunda query manual), y el patrón A es exactamente el que el proyecto ya eligió para el
caso gemelo (`Report`, que también enlaza "un anuncio O un usuario O una valoración").

Complemento obligatorio: **snapshot del título**, molde `Deal.listingTitle` /
`Review.listingTitle` — el ticket debe seguir siendo legible aunque el anuncio se borre.
Con `onDelete: SetNull`, no `Cascade`: **borrar un anuncio no puede borrar el hilo de
atención al usuario que hablaba de él** (mismo criterio que `Review.listingId`).

---

## 3. Patrones del proyecto a reutilizar

### 3.1 Máquinas de estado: cómo se implementan hoy

**No hay ninguna abstracción compartida** — ni una clase `StateMachine`, ni un mapa de
transiciones común, ni un decorador. Verificado. El patrón real es, en orden de
sofisticación creciente:

1. **Guard inline en el service** (el más usado). `ListingsService`:
   ```ts
   const existing = await this.assertOwnership(id, userId);
   if (existing.status !== 'ACTIVE') {
     throw new BadRequestException('Solo se pueden pausar anuncios en estado ACTIVE');
   }
   ```
   Idéntico en `publish` (DRAFT), `renew` (ACTIVE|EXPIRED), `reserve` (ACTIVE),
   `reactivate` (PAUSED), `closeDeal` (ACTIVE|RESERVED), y en `ModerationService`
   (`approve`/`reject` exigen PENDING_REVIEW, `restore` exige REJECTED).
2. **Array estático privado cuando el origen admite varios estados.**
   `ListingsService.ARCHIVABLE_STATUSES: ListingStatus[] = ['ACTIVE','PAUSED','SOLD','EXPIRED','REJECTED']`
   + `if (!ARCHIVABLE_STATUSES.includes(existing.status)) throw ...`.
3. **Irreversibilidad = simplemente ninguna transición sale del estado.** `ARCHIVED` es
   irreversible porque no hay ningún método que lo tome como origen. El schema lo documenta
   en el enum: *"Ninguna transición sale de este estado"*.
4. **Latch reforzado en BD cuando el dato es fiscal.** `Invoice` DRAFT→ISSUED: además del
   guard de aplicación, hay triggers `BEFORE UPDATE/DELETE`
   (migración `20260727000001_invoice_immutability_guard`). Es el único caso; se justifica
   por conformidad fiscal, no por higiene general.

**El ticket debe seguir 1 + 2 + 3, no 4.** Un ticket no es un documento fiscal; los
triggers de BD serían sobreingeniería y un coste de migración innecesario.

### 3.2 Autorización admin

- `RolesGuard` (`common/guards/roles.guard.ts`): 21 líneas, lee `@Roles(...)` con
  `getAllAndOverride([handler, class])` → **un `@Roles` de método sobreescribe el de
  clase** (así `createReport` se abre a `USER` dentro de un controlador
  `@Roles(MODERATOR, ADMIN)`).
- El rol se lee del `JwtUser` de la request, y `JwtStrategy.validate()` lo lee **fresco de
  la BD** (no del payload firmado) — un cambio de rol tiene efecto en la request siguiente.
- Frontend: `middleware.ts` con `ROLE_ALLOWED_PATHS` (`MODERATOR`, `EDITOR`); ADMIN
  acceso total; rol no listado → redirect a `/`. Y `NAV_ITEMS[].roles` en `AdminNav.tsx`.
  Advertencia ya documentada: **el middleware confía en el rol de la cookie (hasta 7 días);
  la barrera real es el `RolesGuard` del backend.**
- Reparto vigente (`estado-tecnico.md` §RR5.1): moderación y usuarios → MODERATOR+ADMIN;
  facturación, categorías, ajustes, campañas, cupones, banners y **mensajes de contacto** →
  ADMIN-only. Regla de oro innegociable: `PATCH /admin/users/:id/role` es ADMIN-only siempre.

### 3.3 Owner-scope

Tres variantes en uso, todas válidas:

- **403 explícito tras leer** — `InvoicingService.getInvoicePdf`:
  `if (inv.userId !== userId) throw new ForbiddenException('Esta factura no es tuya')`.
- **`assertOwnership(id, userId)`** — helper privado de `ListingsService`.
- **Scope en el `where`** — `NotificationsService.markRead`:
  `updateMany({ where: { id, userId, read:false } })`. Idempotente, no distingue
  "no existe" de "no es tuyo".
- Mensajería usa la primera:
  `if (conv.buyerId !== userId && conv.sellerId !== userId) throw new ForbiddenException`.

### 3.4 Tiempo real (WebSocket)

`MessagingGateway` (`messaging.gateway.ts`, 86 líneas):

- `@WebSocketGateway({ namespace: '/ws', cors: { origin: '*' } })` sobre socket.io.
  *(Lleva un `TODO(prod)` pendiente: restringir el CORS al `APP_URL` en producción.)*
- Autenticación en `handleConnection`: `socket.handshake.auth.token` → `jwtService.verify`
  → `socket.data.userId`, y auto-join a la sala personal `user:<id>`. Token inválido →
  `disconnect(true)`.
- `@SubscribeMessage('conversation:join')` verifica participación contra la BD **antes**
  de unir a `conv:<id>`. `socket.join` es idempotente (seguro en reconexión).
- Emisión: `emitNewMessage()` publica en la sala de la conversación **y** en la sala
  personal de cada participante (para la bandeja).
- Frontend: `MessagingSocketProvider` es el **único dueño** de la conexión para toda la
  sesión de `/mensajes`; vive en el layout, no se remonta al cambiar de conversación.

**Es reutilizable casi tal cual** (añadir salas `ticket:<id>` y un `emitTicketMessage`),
pero ver la recomendación de §12: no es necesario para la primera entrega.

### 3.5 Adjuntos y subida de ficheros

Existen **dos** patrones, y la diferencia es exactamente la que importa aquí:

| | Molde "media" (público) | Molde "factura" (privado) |
|---|---|---|
| Dónde | `MediaService.upload()` | `InvoicingService.emitInvoiceCore` + `getInvoicePdf` |
| Clave R2 | `media/<32 hex>.<ext>` | `facturas/<invoiceId>.pdf` |
| Acceso | `r2.getPublicUrl(key)` → URL pública directa | **No hay URL.** Se guarda solo `pdfKey`; el endpoint autenticado hace `r2.download(key)` y devuelve el buffer |
| Autorización | Ninguna tras subir | 403 si `inv.userId !== userId` |
| Efecto lateral | Crea una fila **`ListingImage`** y encola `image.process` | Ninguno |

`R2Service` (S3 API sobre R2/MinIO) expone `upload / download / delete / getPublicUrl`.
Validación de `MediaService`: whitelist `image/jpeg|png|webp` (`MIME_TO_EXT`), 10 MB
(`MAX_FILE_SIZE`), nombre aleatorio con `randomBytes(16)` — nunca el nombre del cliente.

**Para adjuntos de ticket hay que usar el molde FACTURA, no el molde media.** Dos razones
concretas: (a) el pantallazo de un problema puede contener datos personales, DNI, importes
o conversaciones — una URL pública de R2 es compartible y no revocable; (b) `MediaService`
crea filas `ListingImage`, un efecto lateral que no tiene ningún sentido para un adjunto de
ticket. Se reutiliza `R2Service` y la whitelist MIME; **no** se reutiliza `MediaService`.

---

## 4. Impacto y riesgos

### 4.1 Qué NO debe romperse

| Sistema | Por qué es sensible | Verificación |
|---|---|---|
| `ContactMessage` / `/contacto` | 5 defensas de seguridad calibradas (honeypot, time-trap, rate limit, texto plano, `to` inmutable). Cualquier refactor toca superficie sin autenticar. | `rc1-contact.e2e-spec.ts` verde sin tocarlo |
| Moderación | 45 casos e2e, incluidos 2 de no-escalada de privilegios (MODERATOR no cambia roles). | `moderation.e2e-spec.ts` verde sin tocarlo |
| `Notification` | Contrato "`data` autocontenido"; `getNotificationContent` con `default`. Añadir tipos es aditivo, pero un tipo sin `case` degrada en silencio. | `notifications.e2e-spec.ts` + `case` nuevo obligatorio |
| `RolesGuard` / `ROLE_ALLOWED_PATHS` | Añadir una sección admin exige tocar `middleware.ts` **y** `AdminNav.tsx`; olvidar uno deja la sección inaccesible o invisible. | `admin-roles.spec.ts` (Playwright) |
| `queue-retry.e2e-spec.ts` | Grepea el código: una cola nueva registrada sin `retryQueue()` **rompe la suite**. | Usar `retryQueue(QUEUE_TICKETS)` si se añade cola propia |

### 4.2 Volumen y rendimiento

- **`TicketMessage` es la tabla que crece.** Índice obligatorio `[ticketId, createdAt]`
  (molde exacto de `Message`).
- **Paginación del hilo:** cursor `before` sobre `createdAt`, molde
  `MessagingService.getConversation` (fetch `limit + 1` para detectar `hasMore`,
  `nextCursor` = el más antiguo del lote). **No** `skip/take` — con hilos largos degrada.
- **Bandeja de admin:** `[status, lastMessageAt]` y `[assignedToId, status]`.
  Paginación `page/perPage` + `$transaction([findMany, count])`, molde
  `ContactService.list` / `ModerationService.listReports`.
- **`lastMessageAt` denormalizado en `Ticket`** (molde `Conversation.lastMessageAt`):
  ordenar la bandeja por "último movimiento" sin un `MAX()` sobre los mensajes.
- **Riesgo del fan-out a admins:** un ticket nuevo genera `N_admins` notificaciones +
  `N_admins` emails. Con 2-3 admins es lo mismo que ya hace `ContactMessage`. Si el volumen
  de tickets es 10× el de mensajes de contacto, esto es ruido real → ver pregunta abierta
  §14.4.

---

# PARTE B — PROPUESTA DE DISEÑO

## 5. Veredicto sobre "sistema nuevo e independiente"

**CONFIRMADO, con dos matices, y con el dato que lo sostiene.**

- **Frente a `ContactMessage`: independiente, confirmado.** El dato decisivo es que
  `ContactMessage` **no tiene `userId`** y su flujo de respuesta es un email saliente.
  Convertirlo en un hilo con estado y owner-scope exigiría añadirle identidad, hilo
  bidireccional, autorización y notificaciones — es decir, reescribirlo entero, tocando de
  paso las 5 defensas de un endpoint sin autenticar. Coexisten (§10.2).
- **Frente a `Report`: independiente en el modelo, ACOPLADO por enlace.** `Report` no se
  toca ni se absorbe; el ticket lo referencia (`reportId`) y lo complementa. Ver §8.3.
- **Frente a `Conversation`/`Message` (mensajería): independiente.** La mensajería está
  anclada a `[listingId, buyerId]` con `@@unique` y a los roles comprador/vendedor. Un
  ticket no tiene anuncio obligatorio ni comprador/vendedor. Reutilizarla exigiría hacer
  `listingId` nullable y romper ese unique — un cambio de mucho radio sobre código verde.
- **Único punto compartido propuesto:** `ContactReason` como taxonomía de motivos, con una
  columna `scope` nueva. Es la relajación deliberada de "independiente" y está en las
  preguntas abiertas (§14.1) por si Ernest prefiere una tabla propia.

---

## 6. Modelo de datos

### 6.1 Enums

```prisma
/// Ciclo de vida de un ticket de atención al usuario. Ver §7 para la matriz de
/// transiciones. CLOSED es IRREVERSIBLE (molde ListingStatus.ARCHIVED: ninguna
/// transición sale de él).
enum TicketStatus {
  OPEN          // Abierto, sin atender aún
  IN_PROGRESS   // Un agente lo ha tomado (assignedToId != null)
  WAITING_USER  // La administración respondió; la pelota está en el usuario
  RESOLVED      // La administración lo da por resuelto. Reabrible por el usuario.
  CLOSED        // Cerrado definitivamente. IRREVERSIBLE.
}

/// Cuál de los TRES FLUJOS originó el ticket. Columna propia (no derivada de
/// openedById == userId) porque REPORT y ADMIN se distinguen entre sí solo por
/// reportId, y derivarlo obligaría a un OR en cada consulta de bandeja.
enum TicketOrigin {
  USER    // (a) el usuario abrió el ticket
  ADMIN   // (b) la administración inició el hilo
  REPORT  // (c) derivado de un Report de moderación
}

/// Lado del que habla un mensaje del hilo. NO se deriva de author.role: un ADMIN
/// también puede abrir un ticket COMO usuario sobre su propia cuenta, y el rol
/// puede cambiar después — el lado del mensaje debe quedar congelado en el momento
/// de escribirlo (mismo principio que Review.verified o los importes congelados
/// de Invoice).
enum TicketAuthorSide {
  USER
  STAFF
}
```

### 6.2 `Ticket`

```prisma
/// Hilo de atención al usuario. La CONVERSACIÓN AQUÍ ES LA FUENTE DE VERDAD:
/// Notification y email solo avisan (ver §11).
model Ticket {
  id      String       @id @default(cuid())
  subject String
  status  TicketStatus @default(OPEN)
  origin  TicketOrigin

  /// Motivo/tema, molde ContactReason: configurable por admin, sin DELETE.
  /// Nullable porque un ticket de flujo ADMIN/REPORT puede no encajar en ninguno.
  topicId String?
  topic   ContactReason? @relation("TicketTopic", fields: [topicId], references: [id], onDelete: Restrict)

  /// EL USUARIO del hilo — siempre hay exactamente uno, sea quien sea que lo abrió.
  /// Es la clave del owner-scope (§10.1) y el destinatario de las notificaciones.
  userId String
  user   User   @relation("TicketUser", fields: [userId], references: [id], onDelete: Cascade)

  /// Quién lo abrió: el propio user (flujo a) o un miembro del staff (flujos b/c).
  /// Restrict, no Cascade: borrar la cuenta de un admin no puede borrar los hilos
  /// que abrió con usuarios (mismo criterio que Report.reporterId).
  openedById String
  openedBy   User   @relation("TicketOpener", fields: [openedById], references: [id])

  /// Agente que lo lleva. SetNull: si el agente deja de existir el hilo sigue vivo
  /// y vuelve a la bandeja sin asignar.
  assignedToId String?
  assignedTo   User?   @relation("TicketAssignee", fields: [assignedToId], references: [id], onDelete: SetNull)

  // --- Enlaces polimórficos (patrón A, molde Report — ver §2) ---
  // TODOS opcionales y TODOS SetNull: el hilo sobrevive al borrado de la entidad.
  listingId String?
  listing   Listing? @relation(fields: [listingId], references: [id], onDelete: SetNull)
  reviewId  String?
  review    Review?  @relation(fields: [reviewId], references: [id], onDelete: SetNull)
  invoiceId String?
  invoice   Invoice? @relation(fields: [invoiceId], references: [id], onDelete: SetNull)
  /// Flujo (c): el Report de moderación que originó este hilo. NO duplica el
  /// reporte — lo referencia. Ver §8.3.
  reportId  String?
  report    Report?  @relation(fields: [reportId], references: [id], onDelete: SetNull)

  /// Snapshot del contexto enlazado, molde Deal.listingTitle / Review.listingTitle:
  /// el hilo debe seguir siendo legible si la entidad se borra (los SetNull de
  /// arriba dejarían el ticket sin contexto sin esto).
  linkedLabel String?

  /// Denormalizado (molde Conversation.lastMessageAt): ordena la bandeja sin MAX().
  lastMessageAt DateTime @default(now())

  resolvedAt DateTime?
  closedAt   DateTime?
  closedById String?
  closedBy   User?     @relation("TicketCloser", fields: [closedById], references: [id], onDelete: SetNull)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  messages TicketMessage[]

  @@index([userId, lastMessageAt])      // "mis tickets"
  @@index([status, lastMessageAt])      // bandeja de admin filtrada por estado
  @@index([assignedToId, status])       // "mis tickets asignados"
  @@index([reportId])
  @@index([listingId])
}
```

**Por qué NO hay un `unique` de "un ticket abierto por usuario y entidad":** a diferencia
de `Conversation` (`@@unique([listingId, buyerId])`), un usuario puede legítimamente tener
dos dudas distintas sobre el mismo anuncio. Mismo criterio que `Deal`, que tampoco lleva
unique constraint y lo documenta.

### 6.3 `TicketMessage`

```prisma
model TicketMessage {
  id       String @id @default(cuid())
  ticketId String
  ticket   Ticket @relation(fields: [ticketId], references: [id], onDelete: Cascade)

  authorId String
  author   User   @relation("TicketMessageAuthor", fields: [authorId], references: [id])
  /// Congelado al escribir — NUNCA derivado de author.role en lectura (ver enum).
  side     TicketAuthorSide

  body String @db.Text

  /// NOTA INTERNA del staff: visible solo para ADMIN/MODERATOR, nunca para el
  /// usuario del hilo. Ver la INVARIANTE DE PRIVACIDAD en §10.3 — es el campo más
  /// peligroso de todo este diseño.
  internal Boolean @default(false)

  /// Acuse de lectura por lado. Dos columnas y no un único readAt: el hilo tiene
  /// dos lados con badges independientes ("sin leer" del usuario vs. de la bandeja).
  readByUserAt  DateTime?
  readByStaffAt DateTime?

  createdAt DateTime @default(now())

  attachments TicketAttachment[]

  @@index([ticketId, createdAt])   // molde exacto de Message — paginación por cursor
}
```

### 6.4 `TicketAttachment`

```prisma
/// Adjunto de un mensaje. Molde FACTURA (R2 PRIVADO), no molde media (R2 público):
/// se guarda la CLAVE, nunca una URL — el fichero se sirve por un endpoint
/// autenticado que revalida el acceso al ticket. Ver §3.5.
model TicketAttachment {
  id              String        @id @default(cuid())
  ticketMessageId String
  message         TicketMessage @relation(fields: [ticketMessageId], references: [id], onDelete: Cascade)

  /// Clave privada en R2: `tickets/<ticketId>/<randomBytes(16)>.<ext>`.
  /// NUNCA el nombre original del cliente (molde MediaService).
  key String

  /// Nombre original, solo para mostrar y para el Content-Disposition. Nunca se usa
  /// para construir la clave ni ninguna ruta.
  filename  String
  mimeType  String
  sizeBytes Int
  createdAt DateTime @default(now())

  @@index([ticketMessageId])
}
```

### 6.5 Cambios en modelos existentes (todos aditivos)

```prisma
// User: 5 relaciones inversas nuevas (tickets, ticketsOpened, ticketsAssigned,
//       ticketsClosed, ticketMessages). Sin columnas nuevas.
// Listing / Review / Invoice / Report: una relación inversa `tickets Ticket[]` cada uno.
//       Sin columnas nuevas.
// ContactReason: + relación inversa `tickets Ticket[]` y la columna `scope` de §14.1.
```

**Ninguna columna existente cambia de tipo, se renombra ni se borra.** Una sola migración
`add_ticketing`, puramente aditiva, sin backfill.

---

## 7. Máquina de estados

### 7.1 Diagrama

```
                       (usuario abre)              (admin abre / desde Report)
                             │                              │
                             ▼                              ▼
                        ┌────────┐                     ┌────────┐
              ┌────────►│  OPEN  │                     │  OPEN  │
              │         └───┬────┘                     └───┬────┘
              │             │ take (staff)                 │
              │             ▼                              │
              │      ┌─────────────┐◄──────────────────────┘
              │      │ IN_PROGRESS │
              │      └──┬───────┬──┘
              │         │       │ reply (staff)
              │         │       ▼
              │         │  ┌──────────────┐
              │         │  │ WAITING_USER │
              │         │  └──────┬───────┘
              │         │         │ reply (usuario) ─► vuelve a IN_PROGRESS
              │         └─────────┤
              │                   │ resolve (staff)
              │                   ▼
              │             ┌──────────┐
              └─────────────┤ RESOLVED │   reopen (usuario, ventana de N días)
                            └────┬─────┘
                                 │ close (staff, usuario, o cron tras N días)
                                 ▼
                            ┌────────┐
                            │ CLOSED │  ◄── IRREVERSIBLE
                            └────────┘
```

### 7.2 Matriz de transiciones

| # | Transición | Disparador | Quién | Automática |
|---|---|---|---|---|
| T1 | — → `OPEN` | crear ticket | usuario (a) / staff (b, c) | — |
| T2 | `OPEN` → `IN_PROGRESS` | `take` (auto-asignación) | STAFF | manual, o **implícita** al responder |
| T3 | `IN_PROGRESS` → `WAITING_USER` | mensaje del staff | STAFF | **sí**, al enviar |
| T4 | `OPEN` → `WAITING_USER` | mensaje del staff sin `take` previo | STAFF | **sí** (asigna al autor de paso) |
| T5 | `WAITING_USER` → `IN_PROGRESS` | mensaje del usuario | USUARIO | **sí**, al enviar |
| T6 | `OPEN` → `OPEN` | mensaje del usuario sobre ticket no tomado | USUARIO | (sin cambio; solo `lastMessageAt`) |
| T7 | `IN_PROGRESS` \| `WAITING_USER` → `RESOLVED` | `resolve` | STAFF | manual |
| T8 | `RESOLVED` → `IN_PROGRESS` | reapertura (mensaje del usuario dentro de la ventana) | USUARIO | **sí**, al enviar |
| T9 | `RESOLVED` → `CLOSED` | `close` | STAFF, o cron tras N días | manual + cron |
| T10 | `OPEN` \| `IN_PROGRESS` \| `WAITING_USER` \| `RESOLVED` → `CLOSED` | `close` | STAFF | manual |
| T11 | `OPEN` \| `IN_PROGRESS` \| `WAITING_USER` → `CLOSED` | "ya no lo necesito" | USUARIO (solo si `origin = USER`) | manual |

**`CLOSED` es irreversible.** Ninguna fila de la tabla lo tiene como origen. Se implementa
igual que `ARCHIVED`: simplemente no existe ningún método que lo acepte como estado de
partida. Un mensaje sobre un ticket `CLOSED` se rechaza con `400`; la UI ofrece "abrir un
ticket nuevo" (y el nuevo puede llevar un enlace al anterior vía `linkedLabel`).

**Qué NO puede hacer el usuario:** `take`, `resolve`, asignar, escribir notas internas, ni
cerrar un ticket de flujo `ADMIN`/`REPORT` (T11 solo aplica a `origin = USER` — si la
administración abrió el hilo, el usuario no puede cerrarlo unilateralmente).

**Diferencia deliberada con `ContactMessage`:** allí no hay guards *a propósito* ("el admin
sabe lo que hace"). Aquí sí los hay, porque el estado del ticket es visible para el usuario
y dispara notificaciones — un salto arbitrario le mandaría un aviso incoherente. Es un
cambio de criterio consciente, no una inconsistencia por descuido.

### 7.3 Implementación de los guards (patrón del proyecto, §3.1)

```ts
// tickets.service.ts — arrays estáticos privados, molde ARCHIVABLE_STATUSES.
private static readonly STAFF_REPLYABLE: TicketStatus[] = ['OPEN','IN_PROGRESS','WAITING_USER'];
private static readonly USER_REPLYABLE:  TicketStatus[] = ['OPEN','IN_PROGRESS','WAITING_USER','RESOLVED'];
private static readonly RESOLVABLE:      TicketStatus[] = ['IN_PROGRESS','WAITING_USER'];
private static readonly CLOSABLE:        TicketStatus[] = ['OPEN','IN_PROGRESS','WAITING_USER','RESOLVED'];
// CLOSED no aparece como ORIGEN en ninguno de los cuatro → irreversible por construcción.

async resolve(id: string, actorId: string, ip?: string) {
  const ticket = await this.getForStaff(id);
  if (!TicketsService.RESOLVABLE.includes(ticket.status)) {
    throw new BadRequestException('Solo se pueden resolver tickets en curso o esperando respuesta');
  }
  // ... update + AuditLog dentro de $transaction (molde ContactService.updateEstado)
}
```

Cada transición de staff escribe `AuditLog` con `before`/`after` dentro de la misma
`$transaction` (`auditLog.log(dto, tx)` — la firma ya soporta el `tx` opcional desde
RF.12b). Acciones nuevas, convención SCREAMING_SNAKE_CASE:
`TICKET_OPEN_BY_ADMIN`, `TICKET_ASSIGN`, `TICKET_REPLY`, `TICKET_RESOLVE`, `TICKET_CLOSE`,
`TICKET_REOPEN`, `TICKET_INTERNAL_NOTE`. `resourceType: 'Ticket'`.
Las acciones del **usuario** no van a `AuditLog` (que es el registro de acciones
*administrativas*) — su rastro es el propio hilo.

---

## 8. Los tres flujos

### 8.1 Flujo (a) usuario → admin

`origin = USER`, `userId = openedById = <el usuario>`, `status = OPEN`.

`POST /tickets` con `{ subject, topicId?, body, listingId?|reviewId?|invoiceId?, attachments? }`.
El servicio **valida la propiedad de la entidad enlazada**: solo se puede enlazar un
anuncio propio, una valoración recibida o emitida, o una factura propia. (Si no, un usuario
podría usar el enlace como oráculo de existencia de ids ajenos.) `linkedLabel` se rellena
con el título/número en ese momento.

Puntos de entrada en la UI: botón "¿Necesitas ayuda?" en `/mis-anuncios/[id]`,
`/perfil/facturacion` y la ficha de una valoración recibida — cada uno prefija la entidad
enlazada. Más la entrada genérica desde `/mis-tickets`.

Aviso: fan-out a staff (§9.2).

### 8.2 Flujo (b) admin → usuario

`origin = ADMIN`, `openedById = <admin>`, `userId = <el usuario destinatario>`,
`status = OPEN`.

`POST /admin/tickets` con `{ userId, subject, body, topicId?, ...enlaces }`. El admin elige
al usuario con el buscador que **ya existe**: `GET /users/search`
(`users.controller.ts:63`) — el mismo que usa el selector de comprador al cerrar un Deal.
Cero código nuevo de búsqueda.

Aviso: `Notification` + email **al usuario** (no fan-out).

### 8.3 Flujo (c) reporte → admin → usuario — **recomendación**

**RECOMENDACIÓN: apoyarse en la moderación existente. No reinventarla.**

Justificación con el dato auditado (§1.2): la mitad de *triaje* ya está construida, probada
(45 casos e2e) y auditada; la mitad de *comunicación* no existe en absoluto. Duplicar la
primera crearía **dos colas de denuncias** que un moderador tendría que mirar por separado,
con dos estados divergentes sobre el mismo hecho — el peor resultado posible.

Diseño concreto:

1. `Report` **no se toca**. Ni el modelo, ni los estados, ni los endpoints, ni la UI de
   `/admin/reportes`. `moderation.e2e-spec.ts` sigue verde sin editarlo.
2. En la ficha de un reporte se añade **un botón**: *"Contactar con el usuario reportado"*.
   Llama a `POST /admin/tickets` con `origin = REPORT`, `reportId = <el reporte>`,
   `userId = report.reportedUserId ?? report.listing.sellerId ?? report.review.authorId`
   (resuelto en el servidor, nunca aceptado del cliente).
3. El ticket resultante es un ticket de flujo (b) normal: mismo hilo, mismos estados,
   mismas notificaciones. Lo único distinto es `origin` y el enlace `reportId`.
4. La ficha del reporte muestra "Hilo abierto: #xxxx (estado)" — un `include` por
   `Ticket.reportId`. Resolver el reporte y cerrar el ticket son **acciones
   independientes**: un reporte puede resolverse sin hablar con nadie (el caso mayoritario:
   spam evidente), y un hilo puede seguir abierto después de resolver el reporte.

**Lo que este diseño NO hace, deliberadamente:** no notifica al *denunciante* del desenlace
de su denuncia, y no avisa automáticamente al vendedor cuando le rechazan o desactivan un
anuncio. Ambos son huecos reales detectados en la auditoría (§1.2) y ambos se resuelven con
`Notification`, no con tickets. Los dejo **fuera de alcance** y anotados como pregunta
abierta §14.5 — meterlos aquí ensancharía la ráfaga sin necesidad.

---

## 9. Reutilización de `Notification` y de Resend

### 9.1 Tipos de notificación nuevos (sin migración)

En `notification.types.ts`, `DataByType` (backend) y `notification-content.ts` (frontend):

```ts
export type NotificationType =
  | 'ALERT_MATCH' | 'CONTACT_MESSAGE' | 'REVIEW_REQUEST' | 'INVOICING_PENDING_FISCAL_DATA'
  | 'TICKET_MESSAGE'    // al USUARIO: hay respuesta nueva en su ticket
  | 'TICKET_OPENED'     // al USUARIO: la administración ha abierto un hilo contigo
  | 'TICKET_STAFF_NEW'; // fan-out al STAFF: ticket nuevo o respuesta del usuario

/** Snapshot AUTOCONTENIDO — regla invariante del proyecto (ver §1.3). Nada de punteros:
 *  `subject` y `extracto` van copiados, no se releen del Ticket al renderizar. */
export interface TicketMessageData {
  ticketId: string;
  subject: string;
  extracto: string;              // primeros 140 chars, molde ContactService
  status: string;                // congelado en el instante del aviso
}
export interface TicketOpenedData  { ticketId: string; subject: string; extracto: string; }
export interface TicketStaffNewData {
  ticketId: string; subject: string; extracto: string;
  userName: string; topic: string | null;   // NOMBRE resuelto, nunca topicId (molde RC.2)
}
```

`href` en `getNotificationContent()`: `/mis-tickets/<id>` para los dos primeros,
`/admin/tickets/<id>` para el tercero. **Tres `case` nuevos** — el paso que ya se olvidó una
vez con `INVOICING_PENDING_FISCAL_DATA` (§1.3), así que va explícito en la ráfaga R4.

### 9.2 Jobs de email nuevos

En `NOTIFICATION_JOB` + `NotificationProcessor` (`text:` plano SIEMPRE, nunca `html:`):

| Job | Destinatario | Cuándo |
|---|---|---|
| `SEND_TICKET_MESSAGE` | el usuario del ticket | el staff responde (T3/T4) o abre un hilo (b/c) |
| `SEND_TICKET_STAFF_NOTIFICATION` | cada admin/moderador (fan-out, **un job por persona**) | ticket nuevo de usuario, o respuesta del usuario en `WAITING_USER` |
| `SEND_TICKET_RESOLVED` | el usuario del ticket | T7, con el aviso de la ventana de reapertura |

Sin cola nueva: se reutiliza `QUEUE_NOTIFICATIONS`. Si `TicketsModule` registra la cola,
**debe** hacerlo con `retryQueue(QUEUE_NOTIFICATIONS)` o `queue-retry.e2e-spec.ts` rompe la
suite (§4.1).

El cuerpo del email **nunca lleva el mensaje completo**: solo un extracto de 140 caracteres
+ el enlace. Es lo que hace que "la conversación in-app es la fuente de verdad" sea cierto
y no un eslogan (§11).

---

## 10. Autorización

### 10.1 Usuario (owner-scope)

Patrón: **403 explícito tras leer** (molde `InvoicingService.getInvoicePdf`), porque
distinguir 404 de 403 aquí no filtra nada sensible y da mejor diagnóstico:

```ts
const ticket = await this.prisma.ticket.findUnique({ where: { id } });
if (!ticket) throw new NotFoundException('Ticket no encontrado');
if (ticket.userId !== userId) throw new ForbiddenException('Este ticket no es tuyo');
```

`GET /tickets` filtra **siempre** por `where: { userId }`; nunca acepta un `userId` del
query. El acuse de lectura usa el molde `markRead`: `updateMany` con el scope en el `where`.

### 10.2 Staff: ¿ADMIN-only o también MODERATOR?

**Recomendación: `@Roles(MODERATOR, ADMIN)` para el grueso, con tres acciones ADMIN-only.**

Razonamiento sobre el reparto vigente (§3.2): el MODERATOR ya ve `/admin/reportes`,
`/admin/anuncios` y `/admin/usuarios`. Si el flujo (c) nace de un reporte y el moderador no
puede continuar la conversación que él mismo inició, el flujo se rompe en el punto exacto
donde aporta valor. En cambio, la facturación es ADMIN-only en todo el proyecto y no hay
razón para abrir una excepción por la puerta de atrás de un ticket.

| Acción | USUARIO (owner) | MODERATOR | ADMIN |
|---|---|---|---|
| Abrir ticket propio (a) | ✅ | ✅ (como usuario) | ✅ |
| Ver "mis tickets" / el hilo propio | ✅ | ✅ | ✅ |
| Responder en su propio ticket | ✅ | ✅ | ✅ |
| Reabrir (`RESOLVED`→`IN_PROGRESS`) | ✅ | — | — |
| Cerrar el propio (T11, `origin=USER`) | ✅ | — | — |
| Bandeja `/admin/tickets`, ver cualquier hilo | ❌ | ✅ | ✅ |
| `take` / asignarse | ❌ | ✅ | ✅ |
| Responder como staff | ❌ | ✅ | ✅ |
| Notas internas (`internal = true`) | ❌ | ✅ | ✅ |
| `resolve` / `close` | ❌ (salvo T11) | ✅ | ✅ |
| Abrir hilo con un usuario (flujo b) | ❌ | ✅ | ✅ |
| Contactar al reportado desde un `Report` (c) | ❌ | ✅ | ✅ |
| **Tickets con `invoiceId` enlazada** | ✅ (el suyo) | ❌ **403** | ✅ |
| **Reasignar el ticket de OTRO agente** | ❌ | ❌ | ✅ |
| **Descargar adjuntos** | ✅ (los suyos) | ✅ | ✅ |

Las dos filas ADMIN-only marcadas se implementan como guard en el service (el `RolesGuard`
no puede decidir por el contenido de la fila): `if (ticket.invoiceId && actor.role !== 'ADMIN')
throw new ForbiddenException(...)`. Coherente con "facturación = ADMIN-only".

Frontend, los dos sitios que hay que tocar juntos o la sección queda rota (§4.1):
`ROLE_ALLOWED_PATHS.MODERATOR` += `/admin/tickets`, y `NAV_ITEMS` += `{ href:'/admin/tickets',
label:'Tickets', roles:['ADMIN','MODERATOR'] }`.

### 10.3 INVARIANTE DE PRIVACIDAD — notas internas

**`TicketMessage.internal = true` NUNCA puede llegar al usuario.** Es el punto más
peligroso del diseño, y el proyecto ya tiene un precedente exacto de cómo se filtra un
campo sin querer: `Listing.phone`, donde `findUnique({ include })` sin `select` de nivel
superior habría publicado el teléfono en el JSON público de la ficha, y se resolvió con un
destructuring explícito antes de cachear y devolver.

Reglas, todas obligatorias:

1. La ruta de usuario **nunca** hace `include: { messages: true }`. Filtra en la query:
   `messages: { where: { internal: false }, orderBy: { createdAt: 'asc' } }`.
2. La ruta de usuario y la de staff son **métodos distintos del service**
   (`getForUser` / `getForStaff`), no un método con un flag booleano. Un flag se pasa mal
   una vez y el fallo es silencioso.
3. `POST /tickets/:id/messages` (ruta de usuario) **no acepta el campo `internal`** en el
   DTO — el `whitelist: true` del `ValidationPipe` global lo rechaza con 400 solo. Marcar
   una nota interna vive únicamente en el DTO de la ruta de staff.
4. **Test e2e obligatorio, molde `listing-phone.e2e-spec.ts`:** crear una nota interna,
   pedir el hilo como el usuario dueño, y buscar la cadena en crudo en el JSON servido
   confirmando que **no está**. Sin ese test, la invariante es una intención.
5. Un email/notificación disparado por una nota interna: **ninguno.** Una nota interna no
   avisa al usuario ni cambia `lastMessageAt`.

*(Si Ernest prefiere no correr este riesgo en la primera entrega, las notas internas se
pueden aplazar a una ráfaga posterior sin coste de rediseño — el campo se queda en el
schema con `@default(false)` y sin ninguna vía de escritura. Ver §14.3.)*

---

## 11. Auxiliares vs. principal — cómo se garantiza

**Decisión: la conversación in-app es la fuente de verdad. El email NO es un canal de
respuesta. NO se soportará responder por email, ni ahora ni como extensión.**

Se sostiene en tres patas, dos de ellas estructurales (no dependen de la disciplina de
nadie):

1. **Estructural — no existe email entrante.** Auditado en §1.4: Resend está integrado
   solo como saliente; no hay webhook inbound, ni parser, ni verificación de remitente. Una
   respuesta por email hoy no llega a ninguna parte. Construir ese canal exigiría además
   resolver la suplantación (el `From` de un email es trivialmente falsificable) — es decir,
   un problema de autenticación entero para un canal secundario.
2. **Estructural — el email no lleva la conversación.** El cuerpo es siempre
   `extracto (≤140) + enlace`, nunca el mensaje completo ni el historial. Quien quiera leer
   el hilo tiene que entrar. Molde exacto de `SEND_CONTACT_NOTIFICATION`, que ya hace esto.
3. **De producto — el remitente y el copy lo dicen.** `resend.from` sigue siendo el de
   siempre, y cada email de ticket cierra con *"No respondas a este correo: responde desde
   tu ticket en <enlace>"*.

**El estado del ticket solo lo cambian acciones dentro de la plataforma.** Ningún email ni
notificación transiciona nada. Esa es la definición operativa de "fuente de verdad": el
único sitio donde `TicketStatus` se escribe es `TicketsService`, disparado por un endpoint
HTTP autenticado.

**Consecuencia aceptada:** un usuario que responda por email verá su respuesta caer en el
vacío (o rebotar, según cómo esté configurado el `from`). Es el mismo comportamiento que ya
tiene `SEND_CONTACT_REPLY` hoy. Mitigación: el copy explícito del punto 3.

---

## 12. Tiempo real — recomendación

**RECOMENDACIÓN: request/response + `Notification` en la primera entrega. WebSocket
diferido a una ráfaga opcional al final, y solo si Ernest lo quiere.**

Razones, con lo auditado:

- **La naturaleza del canal es distinta.** La mensajería es comprador↔vendedor negociando
  en minutos: sin tiempo real la experiencia se rompe. Un ticket lo responde un agente en
  horas o días; el usuario no está mirando la pantalla esperando. Un badge que se actualiza
  al navegar cubre el 100% del valor.
- **El coste no es "reutilizar el gateway".** Además del emit hay que resolver: quién se
  une a `ticket:<id>` (un moderador debería ver la bandeja en vivo → hace falta una sala de
  rol `staff`, que hoy **no existe** — el gateway solo tiene `user:<id>` y `conv:<id>`); y
  quién es dueño de la conexión en el frontend (`MessagingSocketProvider` está montado en
  el layout de `/mensajes`, no es global — habría que montar otro proveedor, o subirlo).
- **Hay una deuda abierta en esa superficie:** el `TODO(prod)` de `cors: { origin: '*' }`
  en `MessagingGateway`. Ampliar el uso del gateway antes de cerrarla ensancha el problema.

Si se hace después, encaja limpio: sala `ticket:<id>` con la misma verificación de
participación que `conversation:join`, sala `staff` para la bandeja, y un
`emitTicketMessage()` gemelo de `emitNewMessage()`. El diseño de datos no cambia nada.

---

## 13. Frontend (alto nivel)

### 13.1 Usuario — `app/(account)/`

- **`/mis-tickets`** — lista: asunto, estado (badge de color por `TicketStatus`), motivo,
  entidad enlazada, último movimiento, badge de no leídos. Filtro "abiertos / todos".
  Botón "Abrir ticket".
- **`/mis-tickets/nuevo`** — asunto, motivo (`<select>` de topics activos), mensaje,
  adjuntos, y un selector opcional de entidad enlazada (prefijado si se llega desde un
  anuncio/factura/valoración).
- **`/mis-tickets/[id]`** — el hilo: burbujas por lado (`side`), tarjeta de la entidad
  enlazada arriba, caja de respuesta, y las acciones que el usuario tiene según §7.2
  ("Reabrir" en `RESOLVED`, "Ya no lo necesito" en `origin = USER`). Paginación por
  cursor, "cargar mensajes anteriores" (molde `ChatClient`).
- `middleware.ts`: `accountPrefixes` += `/mis-tickets`.
- Entradas contextuales: botón "¿Necesitas ayuda con este anuncio / esta factura / esta
  valoración?" en `/mis-anuncios/[id]`, `/perfil/facturacion` y la valoración recibida.

### 13.2 Staff — `app/(admin)/admin/tickets/`

Client-side, sin SEO (regla del backoffice).

- **`/admin/tickets`** — bandeja: filtros por estado, motivo, asignado (incl. "sin
  asignar" y "míos") y flujo (`origin`). Orden por `lastMessageAt` desc.
  Paginación `page/perPage`, molde `/admin/mensajes-contacto`.
- **`/admin/tickets/[id]`** — hilo completo (incl. notas internas, visualmente
  diferenciadas), acciones: Tomar / Responder / Nota interna / Resolver / Cerrar /
  Reasignar (ADMIN). Panel lateral con la ficha del usuario, la entidad enlazada y el
  `Report` de origen si lo hay.
- **`/admin/tickets/nuevo`** — flujo (b): buscador de usuario (`GET /users/search`) +
  asunto + mensaje.
- Botón **"Contactar con el usuario reportado"** en `/admin/reportes/[id]` (flujo c).
- `AdminNav` + `ROLE_ALLOWED_PATHS` (§10.2).

---

## 14. Preguntas abiertas — decisión de Ernest antes de implementar

**§14.1 — Taxonomía de motivos: ¿`ContactReason` compartido o tabla propia?**
Recomiendo **reutilizar `ContactReason` añadiéndole una columna
`scope ContactReasonScope @default(PUBLIC)`** (`PUBLIC | TICKET | BOTH`). Con ese default,
los 6 motivos existentes conservan exactamente su comportamiento actual sin backfill (mismo
truco que `Category.allowedListingType @default(BOTH)`), y se reutiliza tal cual el CRUD +
reorder de `/admin/motivos-contacto` ya construido. Alternativa: un modelo `TicketTopic`
nuevo con el mismo molde — más "independiente", pero duplica una pantalla de admin entera.
**Es el único punto donde propongo tocar un sistema existente.** ¿Adelante, o tabla propia?

**§14.2 — Ventana de reapertura (T8) y cierre automático (T9).**
Propongo 14 días desde `resolvedAt`, con un cron que cierra los `RESOLVED` vencidos
(molde `ExpirationService`, valor en `Setting` para poder cambiarlo en caliente, no en
código). ¿14 días? ¿O sin cierre automático — `RESOLVED` se queda ahí para siempre y solo
el staff cierra?

**§14.3 — ¿Notas internas en la primera entrega?**
Son útiles pero son el mayor riesgo de fuga del diseño (§10.3). Se pueden dejar en el
schema sin vía de escritura y activarlas en una ráfaga posterior, con coste de rediseño
cero. ¿Entran en R2 o se aplazan?

**§14.4 — Fan-out a staff: ¿a todos, o solo a ADMIN?**
Hoy `ContactMessage` hace fan-out a `role = 'ADMIN'`. Si los tickets son 10× más
frecuentes, cada admin recibirá 10× notificaciones y emails, con la limitación ya conocida
de que atender uno no marca leídas las de los demás. Opciones: (a) fan-out igual que ahora;
(b) fan-out solo de la `Notification` in-app y **un solo email diario de resumen**;
(c) email solo a una dirección de soporte configurable en `Setting` (`supportEmail`), sin
fan-out. **Recomiendo (c)** — es la que escala y la que menos código nuevo pide.

**§14.5 — Los dos huecos de comunicación detectados en la auditoría (§1.2, §8.3).**
Ni al denunciante se le dice en qué acabó su denuncia, ni al vendedor se le avisa de que le
han rechazado/desactivado un anuncio. Los he dejado **fuera de alcance** porque se resuelven
con `Notification`, no con tickets. ¿Se abren como ráfaga aparte después, o se meten aquí?

**§14.6 — ¿Convertir un `ContactMessage` en `Ticket`?**
Propongo **coexistencia sin conversión automática**: `/contacto` sigue siendo el canal
anónimo intacto. Extras posibles, ambos opcionales: (a) que el formulario público detecte
sesión activa y sugiera "abre un ticket en su lugar" (mejor trazabilidad, hilo real);
(b) un botón de admin "convertir en ticket" que solo se ofrezca si `ContactMessage.email`
coincide con un `User` existente. ¿Alguno, ninguno, los dos?

**§14.7 — Límites de adjuntos.**
Propongo heredar los de `MediaService` (JPEG/PNG/WebP, 10 MB) **más PDF**, máximo 5 por
mensaje. ¿PDF sí? ¿Otros tipos?

**§14.8 — Rate limit para abrir tickets.**
La superficie está autenticada (a diferencia de `/contacto`), pero un usuario podría abrir
100 tickets. `RateLimitService` ya es genérico desde RC.1. Propongo 10 tickets/día por
usuario. ¿Cifra?

---

## 15. Desglose en ráfagas (SIN implementar)

| Ráfaga | Contenido | Depende de | Verificación |
|---|---|---|---|
| **R1 — Modelo + estados** | Migración `add_ticketing` (3 modelos + 3 enums + `ContactReason.scope`). `TicketsService` con la máquina de estados completa, guards, `AuditLog`, sin controladores. Tests unitarios de la matriz §7.2 (incl. "CLOSED no admite ninguna transición"). | §14.1, §14.2, §14.3 | `pnpm test`; `prisma migrate` limpio; suites existentes verdes |
| **R2 — API de usuario** | `TicketsController`: crear, listar (owner-scope), ver hilo, responder, reabrir, cerrar el propio. DTOs + validación de propiedad de la entidad enlazada. **Test de privacidad de notas internas (§10.3.4)**. | R1 | `tickets-user.e2e-spec.ts` |
| **R3 — API de staff** | `AdminTicketsController` (`@Roles(MODERATOR, ADMIN)`): bandeja + filtros, ver, tomar, responder, nota interna, resolver, cerrar, reasignar (ADMIN), abrir hilo (flujo b). Guard ADMIN-only de tickets con factura. Endpoint "contactar al reportado" (flujo c). | R2 | `tickets-admin.e2e-spec.ts` (incl. frontera MODERATOR/ADMIN, molde RR5.1); `moderation.e2e-spec.ts` **sin editar** y verde |
| **R4 — Notificaciones + email** | 3 tipos de `Notification` (+ los 3 `case` del frontend, y de paso el de `INVOICING_PENDING_FISCAL_DATA` que falta), 3 jobs de Resend (`text:` plano), cableado en las transiciones. Decisión §14.4. | R3 | `tickets-notifications.e2e-spec.ts`; `notifications.e2e-spec.ts` verde |
| **R5 — Adjuntos** | `TicketAttachment` + subida a R2 privado (`tickets/<ticketId>/...`) + endpoint de descarga autenticado con revalidación de acceso. Molde factura, **no** molde media. Decisión §14.7. | R2 | `tickets-attachments.e2e-spec.ts` (incl. 403 sobre adjunto ajeno) |
| **R6 — Frontend usuario** | `/mis-tickets`, `/nuevo`, `/[id]`. `middleware.ts` (`accountPrefixes`). Entradas contextuales desde anuncio/factura/valoración. | R2, R4, R5 | Playwright `tickets-usuario.spec.ts` |
| **R7 — Frontend staff** | `/admin/tickets` + `/[id]` + `/nuevo`. `AdminNav` + `ROLE_ALLOWED_PATHS`. Botón en `/admin/reportes/[id]`. | R3, R6 | Playwright `tickets-admin.spec.ts`; `admin-roles.spec.ts` actualizado |
| **R8 — Cron de cierre** *(si §14.2 = sí)* | Cierre automático de `RESOLVED` vencidos, ventana en `Setting`. Molde `ExpirationService`. | R1 | `tickets-cron.e2e-spec.ts` |
| **R9 — Tiempo real** *(OPCIONAL, solo si Ernest lo pide)* | Sala `ticket:<id>` + sala `staff` en `MessagingGateway`, proveedor de socket en el frontend. Cerrar antes el `TODO(prod)` del CORS. | R7 | Playwright con dos sesiones |

Orden recomendado si hay que recortar: **R1→R2→R3→R4→R6→R7** es el sistema completo y
usable. R5 (adjuntos), R8 (cron) y R9 (tiempo real) son incrementos independientes.

---

## 16. Compatibilidad — qué NO se rompe y cómo se verifica

| Riesgo | Por qué no se materializa | Cómo se comprueba |
|---|---|---|
| Romper `/contacto` | El módulo `contact` no se modifica en ninguna ráfaga. El único cambio en su territorio es **añadir** la columna `ContactReason.scope` con default que preserva el comportamiento. | `rc1-contact.e2e-spec.ts` verde **sin editarlo** |
| Romper moderación | `Report`, `ModerationService` y `ModerationController` no se tocan. El flujo (c) solo **lee** `Report` y **añade** un botón en su UI. | `moderation.e2e-spec.ts` verde **sin editarlo** (45 casos) |
| Romper notificaciones | Los tipos nuevos son aditivos (`type` es `String`); ninguna `Notification` existente cambia de forma. | `notifications.e2e-spec.ts` verde; render manual de los 3 tipos nuevos |
| Fuga de notas internas | §10.3: métodos separados, filtro en la query, DTO sin el campo, y un test que busca la cadena en crudo en el JSON. | `tickets-user.e2e-spec.ts` — test de privacidad, molde `listing-phone.e2e-spec.ts` |
| Escalada de privilegios | El MODERATOR gana acceso a una sección nueva. Las tres puertas ADMIN-only (facturación, reasignación, cambio de rol) se prueban explícitamente. | `tickets-admin.e2e-spec.ts` (frontera de rol, molde RR5.1) + `admin-roles.spec.ts` |
| Sección admin inaccesible o invisible | Añadir `/admin/tickets` exige tocar `middleware.ts` **y** `AdminNav.tsx` a la vez. | `admin-roles.spec.ts` cuenta los ítems del nav por rol |
| Cola sin reintentos | `queue-retry.e2e-spec.ts` grepea el código y falla si algún `registerQueue()` no pasa por `retryQueue()`. | La propia suite |
| Migración destructiva | `add_ticketing` es 100% aditiva: 3 tablas nuevas, 3 enums nuevos, 1 columna nueva con default, N relaciones inversas. Sin renombrados, sin borrados, sin backfill. | `prisma migrate diff` revisado antes de aplicar |

---

## 17. Resumen de decisiones (para aprobar o corregir)

| # | Decisión | Justificación auditada |
|---|---|---|
| 1 | Sistema **nuevo e independiente** (`Ticket` / `TicketMessage` / `TicketAttachment`) | `ContactMessage` no tiene `userId` ni hilo bidireccional; `Conversation` está anclada a `@@unique([listingId, buyerId])` |
| 2 | Flujo (c) **se apoya en la moderación existente** vía `Ticket.reportId`; `Report` no se toca | El triaje ya existe y está probado (45 casos e2e); lo que falta es solo la comunicación, que hoy es **cero** |
| 3 | Enlace polimórfico con **FKs nullables + `onDelete: SetNull` + snapshot** | Patrón A, el que el proyecto ya eligió para el caso gemelo (`Report`); `SetNull` + snapshot es el molde `Review`/`Deal` |
| 4 | Máquina de estados con **guards en el service + arrays estáticos**; `CLOSED` irreversible por construcción | Molde `ListingsService.ARCHIVABLE_STATUSES`; sin triggers de BD (eso es solo para lo fiscal) |
| 5 | `Notification` reutilizada con **3 tipos nuevos, sin migración** | `type` es `String` a propósito; ya validado al añadir `CONTACT_MESSAGE` |
| 6 | Email (Resend) **solo avisa**; responder por email no se soporta | No existe email entrante en el proyecto; el cuerpo lleva extracto + enlace, nunca la conversación |
| 7 | Staff = **MODERATOR + ADMIN**, con facturación y reasignación ADMIN-only | El MODERATOR ya ve reportes/anuncios/usuarios; la facturación es ADMIN-only en todo el proyecto |
| 8 | Adjuntos en **R2 privado** (molde factura), no público (molde media) | Un pantallazo puede llevar datos personales; `MediaService` además crearía filas `ListingImage` sin sentido |
| 9 | **Sin WebSocket** en la primera entrega | Un ticket es asíncrono; falta una sala de rol `staff` en el gateway y hay un `TODO(prod)` de CORS abierto |
| 10 | Notas internas con **invariante de privacidad y test dedicado** | Precedente exacto de `Listing.phone`: un `include` sin `select` publicó un campo privado |

---

**FIN DE LA PROPUESTA. Nada implementado — pendiente de aprobación.**
