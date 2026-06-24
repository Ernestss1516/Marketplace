# Diseño del sistema de valoraciones — Hito 3, Fase V

> Documento de diseño de RV.1 (2026-06-24). Las ráfagas RV.2–RV.5 implementan lo
> aquí descrito. Este documento es el entregable de la ráfaga RV.1 (Opus).

---

## 0. Andamiaje existente

| Elemento | Ubicación | Estado |
|---|---|---|
| Modelo `Review` | `prisma/schema.prisma` | Existe — `rating`, `comment`, `authorId`, `targetId`, `listingId?` — **pero con decisiones de diseño que la migración de RV.2 debe corregir** (ver §7) |
| `reviewsAuthored` / `reviewsReceived` | `User` en schema | Relaciones declaradas ✓ |
| `Review[]` en `Listing` | `Listing` en schema | Relación declarada ✓ |
| `ReviewsModule` | `modules/reviews/` | Stub vacío — controller y service sin implementación |
| Modelo `Report` | schema | Soporta `listingId?` y `reportedUserId?`; necesita `reviewId?` (§7) |
| `ReportReason` enum | schema | `SPAM \| FRAUD \| INAPPROPRIATE \| PROHIBITED_ITEM \| WRONG_CATEGORY \| OTHER`; necesita `FAKE_REVIEW` (§7) |
| `Conversation` | schema | `listingId`, `buyerId`, `sellerId` — fuente de verdad de la elegibilidad (§1) |
| `ModerationService` / `ModerationController` | `modules/moderation/` | Operativo; se extiende en RV.5 para acciones sobre reseñas |
| `AuditLogService` | `modules/audit-log/` | Inyectable; se usa en RV.5 para `REVIEW_DELETE` |

---

## 1. Elegibilidad (anti-fraude) — decisión arquitectónica principal

### Decisión: conversación existente como gate de elegibilidad

Un usuario `A` puede valorar al usuario `B` para el anuncio `L` si y solo si existe
una `Conversation` en base de datos donde:

- `conversation.listingId === L`, **y**
- (`conversation.buyerId === A` y `conversation.sellerId === B`) **o**
- (`conversation.sellerId === A` y `conversation.buyerId === B`)

Es decir: **A y B deben haber tenido un intercambio real de mensajes sobre ese anuncio concreto.**

### Justificación

El modelo `Conversation` ya es el registro de interacción más sólido del sistema:

- Solo se crea vía `POST /conversations`, que valida que el anuncio exista, que el
  comprador no sea el mismo que el vendedor, y que el anuncio esté en estado `ACTIVE`
  o `RESERVED`. Es imposible abrir una conversación con uno mismo.
- La existencia de la conversación demuestra intención real de compra, no solo vista
  de un perfil.
- No requiere que el anuncio pase a `SOLD`: muchas transacciones se cierran offline y
  el vendedor nunca marca el anuncio como vendido. Exigir `SOLD` eliminaría la mayoría
  de casos reales.
- Elimina tres vectores de fraude: autovaloraciones, valoraciones sin contacto previo
  y valoraciones de "conocidos" sin transacción.

### Reglas derivadas

| Regla | Implementación |
|---|---|
| `author ≠ target` | Validado en `ReviewsService.create()` con `BadRequestException` |
| Conversación existe | `prisma.conversation.findFirst({ where: { listingId, OR: [...] } })` |
| Una sola valoración por `(author, target, listing)` | `@@unique([authorId, targetId, listingId])` en schema + `P2002` → 409 en service |
| El `listingId` es obligatorio | Campo no nullable en la migración (el stub lo tiene como `String?`; se corrige en RV.2) |

### Lo que la elegibilidad no exige (y por qué)

- **Estado del anuncio al valorar:** el anuncio puede estar `SOLD`, `EXPIRED` o
  `REJECTED`. La conversación ya ocurrió; el estado actual no altera el derecho a valorar.
- **Ventana de tiempo para valorar:** sin límite. Un comprador que no valoró en semanas
  sigue pudiendo hacerlo. Añadir un límite temporal crearía fricción sin beneficio
  antifraude significativo.
- **Que el vendedor marque `SOLD`:** la validación es la conversación, no el estado del anuncio.

---

## 2. Bidireccionalidad comprador ↔ vendedor

Ambas partes pueden valorarse entre sí de forma independiente:

- **Comprador valora al vendedor:** `authorId = buyerId`, `targetId = sellerId`.
- **Vendedor valora al comprador:** `authorId = sellerId`, `targetId = buyerId`.

Cada dirección es una `Review` separada en base de datos. La unicidad se garantiza por
`@@unique([authorId, targetId, listingId])`, que permite ambas direcciones sin conflicto.

### Momento de la valoración

Las valoraciones pueden emitirse en cualquier momento posterior a la apertura de la
conversación. No se implementa un sistema de "valoración ciega" (tipo Airbnb, donde
ambas partes envían antes de ver la del otro) para el MVP. La razón:

- La valoración ciega requiere un estado `pending` por review, un cron para revelarlas
  cuando ambas partes han valorado o el plazo expira, y lógica de notificación — complejidad
  desproporcionada para el MVP.
- El riesgo de "valoración de represalia" es bajo en un mercado C2C donde el volumen
  de transacciones por usuario es pequeño y la moderación puede intervenir.
- Se anota como evolución natural para cuando el volumen justifique la complejidad.

Las valoraciones son **visibles inmediatamente** tras su publicación.

> **Decisión consciente — trade-off anotado:** la visibilidad inmediata expone a ambas
> partes al riesgo de valoraciones de represalia ("te pongo un 1 porque me pusiste un 2").
> Un sistema ciego al estilo Airbnb elimina ese incentivo: ninguna parte ve la valoración
> del otro hasta que ambas han enviado la suya o expira una ventana (p.ej. 14 días).
> Se descarta para el MVP por la complejidad que añade (estado `pending` por review,
> cron de revelación, notificaciones). Si aparecen patrones de represalia observables en
> moderación, el sistema ciego es la evolución natural con el modelo de datos actual
> (añadir `visibleAt DateTime?` a `Review` y un scheduled job).

---

## 3. Contenido de la valoración

| Campo | Tipo | Regla |
|---|---|---|
| `rating` | `Int` (1–5) | Obligatorio. Validado con `@Min(1) @Max(5)` en el DTO. |
| `comment` | `String?` (max 1 000 chars) | Opcional. `@MaxLength(1000)` en el DTO. |
| `listingId` | `String` | Obligatorio. Identifica el anuncio de la interacción. |
| `targetId` | `String` | Obligatorio. El usuario que recibe la valoración. |

Granularidad: **una valoración por par `(authorId, targetId, listingId)`**. Si el vendedor
tiene 10 conversaciones sobre 10 anuncios distintos con el mismo comprador, puede recibir
hasta 10 valoraciones de ese comprador (una por anuncio), lo que refleja con fidelidad la
realidad de múltiples transacciones.

Un vendedor que tiene múltiples conversaciones sobre **el mismo anuncio** con compradores
distintos puede dejar una valoración por cada comprador. La unicidad `[authorId, targetId,
listingId]` no impide que el vendedor valore a distintos compradores del mismo anuncio.

---

## 4. Ciclo de vida de una valoración

### Ventana de edición: 72 horas

- El autor puede **editar** (`PATCH /reviews/:id`) o **borrar** (`DELETE /reviews/:id`)
  su propia valoración durante las 72 h siguientes a `createdAt`.
- Fuera de esa ventana, la valoración es **inmutable** para el autor.
- La comprobación es: `Date.now() < createdAt.getTime() + 72 * 60 * 60 * 1000`.

Justificación del plazo: 72 h permite corregir errores tipográficos o cambiar de opinión
tras una conversación con el vendedor, sin dar tiempo a manipular la valoración una vez que
el otro usuario ya la ha visto y respondido (verbalmente, fuera de la plataforma). Plazos
más cortos (24 h) son demasiado restrictivos; plazos más largos (7 días) aumentan el riesgo
de presión externa para modificar la valoración.

### Borrado por moderación

Fuera de la ventana de 72 h, solo un `MODERATOR` o `ADMIN` puede borrar una valoración
(acción `DELETE /moderation/reviews/:id`, capturada en `AuditLog` con acción
`REVIEW_DELETE`). Este borrado se activa normalmente tras resolver un reporte de la
valoración.

### Edición transparente: campo `editedAt`

La valoración editada sustituye a la original (no se guarda historial de versiones), pero
**se marca públicamente como editada** mediante el campo `editedAt DateTime?`:

- Al crear: `editedAt = null`.
- Al editar dentro del plazo: `editedAt = now()` (seteado en el service, no por Prisma automáticamente).
- El frontend muestra un indicador "Editada" junto a la fecha de publicación cuando `editedAt !== null`.

Esto da transparencia al destinatario de la valoración sin revelar qué cambió. No guardar
el historial completo mantiene el modelo simple; el indicador "editada" es suficiente para
que el usuario sepa que la valoración no es la original.

---

## 5. Agregado y visualización

### Cálculo

El agregado se calcula **en tiempo de ejecución** con la función de agregación de Prisma
(`_avg`, `_count`, `groupBy`) al consultar el perfil del usuario. No se desnormaliza en
`User` para el MVP.

```ts
// En ReviewsService.getAggregate(targetId)
const [aggregate, distribution] = await Promise.all([
  this.prisma.review.aggregate({
    where: { targetId },
    _avg: { rating: true },
    _count: { rating: true },
  }),
  this.prisma.review.groupBy({
    by: ['rating'],
    where: { targetId },
    _count: true,
  }),
]);
```

El resultado:
```json
{
  "average": 4.3,   // null si count === 0
  "count": 27,
  "distribution": { "1": 1, "2": 2, "3": 3, "4": 8, "5": 13 }
}
```

La `average` se redondea a 1 decimal en el service antes de devolverla.

### Visualización

| Superficie | Qué se muestra |
|---|---|
| Perfil público `/vendedor/[slug]` | Media con estrellas + contador total + barra de distribución 1–5 + lista paginada (cursor) de valoraciones recibidas con nombre y avatar del autor |
| Ficha de anuncio `/anuncio/[slug]` | Chip del vendedor ya existente, extendido con media de estrellas y contador (datos incluidos en `GET /users/:slug`) |
| Chat `/mensajes/[id]` | Encabezado del otro usuario con su media de estrellas; botón "Valorar" si `canReview: true` |

### Usuarios sin valoraciones

- `average` devuelto como `null` (no como `0`); el frontend muestra "Sin valoraciones todavía".
- `count === 0` es el estado inicial de todos los usuarios.

### Nota de rendimiento (YAGNI — no optimizar ahora)

El aggregate requiere un scan de la tabla `Review` filtrado por `targetId` (cubierto por
`@@index([targetId])`). Es rápido con cientos o miles de reseñas por usuario. Si el perfil
del vendedor muestra latencia alta con muchas reseñas, el primer paso es **cachear el
resultado en Redis** (TTL corto, p.ej. 2 min; invalidar al crear/editar/borrar una review
del mismo `targetId`). Solo si el volumen es masivo se justifica desnormalizar
`ratingAverage Float?` + `ratingCount Int` en `User` y mantenerlos sincronizados. Ninguna
de las dos optimizaciones se implementa ahora.

---

## 6. Moderación

### Mecanismo: extensión del sistema de reportes existente

No se crea un circuito paralelo. Las reseñas abusivas se reportan mediante el mismo
`POST /moderation/reports` que ya existe para anuncios y usuarios. Se añade el campo
`reviewId?` al modelo `Report` y al `CreateReportDto`.

El nuevo motivo `FAKE_REVIEW` se añade al enum `ReportReason` en la migración de RV.2.
Los existentes (`SPAM`, `INAPPROPRIATE`) también aplican a reseñas.

### Flujo de moderación de una reseña

```
Usuario reporta valoración abusiva
  → POST /moderation/reports { reviewId, reason: "FAKE_REVIEW"|"INAPPROPRIATE"|"SPAM", description? }
  → Reporte en cola con status PENDING
  → Moderador lo ve en /admin/reportes con el contenido de la reseña (rating + comment)
  → Acción: "Eliminar valoración" → DELETE /moderation/reviews/:id
    → AuditLog { action: "REVIEW_DELETE", resourceType: "Review", ... }
    → Reporte resuelto automáticamente (resolvedAt = now, status = RESOLVED)
  → Acción: "Desestimar" → el reporte se cierra y la valoración permanece
```

La moderación es reactiva (reporte de usuario → acción moderador). No hay moderación
preventiva automática de reseñas (a diferencia de los anuncios, donde `BadWordService`
puede enviar a `PENDING_REVIEW`). El texto de una reseña es mucho más corto y personal;
el filtro automático generaría demasiados falsos positivos.

### Validación de `Report` con `reviewId`

La regla existente "al menos un target presente" se amplía:
`listingId || reportedUserId || reviewId` → si ninguno: `422 UnprocessableEntity`.

Cuando `reviewId` está presente, el service valida que la reseña exista antes de crear
el reporte.

---

## 7. Modelo de datos y migración

### Cambios al schema de Prisma

#### Enum `ReportReason` — añadir valor

```prisma
enum ReportReason {
  SPAM
  FRAUD
  INAPPROPRIATE
  PROHIBITED_ITEM
  WRONG_CATEGORY
  FAKE_REVIEW     // NUEVO: para reportar valoraciones falsas o de represalia
  OTHER
}
```

#### Modelo `Review` — ajustes respecto al stub actual

```prisma
model Review {
  id        String   @id @default(cuid())
  rating    Int      // 1..5 — validado en el DTO

  comment   String?  @db.Text

  authorId  String
  author    User     @relation("ReviewAuthor", fields: [authorId], references: [id], onDelete: Cascade)

  targetId  String
  target    User     @relation("ReviewTarget", fields: [targetId], references: [id], onDelete: Cascade)

  // No nullable: la elegibilidad siempre requiere un anuncio específico.
  // El stub lo tiene como String?; la migración lo convierte a String.
  listingId String
  listing   Listing  @relation(fields: [listingId], references: [id], onDelete: Cascade)

  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt   // Para comprobar la ventana de edición (createdAt + 72h)
  editedAt  DateTime?             // NUEVO: null hasta la primera edición; marca transparencia pública

  reports   Report[]              // NUEVO: relación inversa para reportes

  // @@unique anterior era [authorId, listingId] — insuficiente para bidireccionalidad
  // El nuevo unique incluye targetId para distinguir "comprador valora vendedor" de
  // "vendedor valora comprador" sobre el mismo anuncio.
  @@unique([authorId, targetId, listingId])
  @@index([targetId])
  @@index([listingId])   // NUEVO: para reverse lookup desde Listing
}
```

**Diferencias respecto al stub actual:**
| Campo/constraint | Stub actual | Después de migración |
|---|---|---|
| `listingId` | `String?` (nullable) | `String` (non-nullable) |
| `updatedAt` | Ausente | `DateTime @updatedAt` |
| `editedAt` | Ausente | `DateTime?` — null hasta primera edición |
| `@@unique` | `[authorId, listingId]` | `[authorId, targetId, listingId]` |
| `@@index([listingId])` | Ausente | Presente |
| `reports Report[]` | Ausente | Presente |
| `onDelete` en `author` y `target` | Ausente | `Cascade` |

#### Modelo `Report` — añadir `reviewId`

```prisma
model Report {
  // ... campos existentes sin cambio ...

  // NUEVO: una denuncia puede apuntar a una valoración (además de a listing o user)
  reviewId       String?
  review         Review?  @relation(fields: [reviewId], references: [id], onDelete: Cascade)

  // @@index existentes sin cambio
  @@index([reviewId])   // NUEVO
}
```

### Nombre de la migración

`20260624_add_review_fields`

### SQL generado por Prisma (referencia, no ejecutar manualmente)

```sql
-- Nuevo valor de enum (Postgres permite ALTER TYPE ... ADD VALUE sin recrear)
ALTER TYPE "ReportReason" ADD VALUE 'FAKE_REVIEW';

-- Review: listingId non-nullable (tabla vacía en prod — migración directa)
ALTER TABLE "Review" ALTER COLUMN "listingId" SET NOT NULL;

-- Review: updatedAt
ALTER TABLE "Review" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW();

-- Review: editedAt (null = nunca editada; se setea en el service al hacer PATCH)
ALTER TABLE "Review" ADD COLUMN "editedAt" TIMESTAMP(3);

-- Review: cambio de unique constraint
ALTER TABLE "Review" DROP CONSTRAINT IF EXISTS "Review_authorId_listingId_key";
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorId_targetId_listingId_key"
  UNIQUE ("authorId", "targetId", "listingId");

-- Review: índice en listingId
CREATE INDEX "Review_listingId_idx" ON "Review"("listingId");

-- Report: reviewId + FK
ALTER TABLE "Report" ADD COLUMN "reviewId" TEXT;
ALTER TABLE "Report" ADD CONSTRAINT "Report_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "Review"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Report_reviewId_idx" ON "Report"("reviewId");
```

> **Seguridad de datos:** La tabla `Review` no tiene datos reales (stub). Cambiar
> `listingId` a non-nullable y el `@@unique` es una migración de schema puro sin riesgo
> de pérdida de datos.

---

## 8. Endpoints

### `ReviewsController` (`/reviews`) — requiere JWT

| Método | Ruta | Body / Query | Respuesta | Notas |
|---|---|---|---|---|
| `POST` | `/reviews` | `CreateReviewDto` | `201 Review` | Crea valoración; 409 si ya existe; 403 si no hay conversación; 400 si `author === target` |
| `GET` | `/reviews/eligibility` | `?listingId&targetId` | `{ canReview, alreadyReviewed }` | Sin side effects; para el frontend antes de mostrar el botón |
| `PATCH` | `/reviews/:id` | `UpdateReviewDto` | `200 Review` | Solo el autor, dentro de 72 h; 403 fuera del plazo |
| `DELETE` | `/reviews/:id` | — | `204` | Solo el autor, dentro de 72 h; 403 fuera del plazo |

### `UsersController` — extensión pública

| Método | Ruta | Query | Respuesta | Notas |
|---|---|---|---|---|
| `GET` | `/users/:slug/reviews` | `?cursor&limit` (cursor-based) | `{ average, count, distribution, items, nextCursor }` | Público — no requiere JWT. Cursor sobre `createdAt DESC`. |

`GET /users/:slug` (perfil público existente) se amplía en RV.3 para incluir
`rating: { average: number \| null, count: number }` en su respuesta.

### `ModerationController` — extensión (MODERATOR / ADMIN)

| Método | Ruta | Notas |
|---|---|---|
| `DELETE` | `/moderation/reviews/:id` | Borra cualquier reseña; captura `AuditLog { action: 'REVIEW_DELETE' }` |

### `POST /moderation/reports` — extensión (cualquier usuario autenticado)

`CreateReportDto` añade `reviewId?: string`. La validación del service pasa de
`listingId \|\| reportedUserId` a `listingId \|\| reportedUserId \|\| reviewId`.

### DTOs

```ts
// CreateReviewDto
class CreateReviewDto {
  @IsInt() @Min(1) @Max(5) rating: number;
  @IsString() @MaxLength(1000) @IsOptional() comment?: string;
  @IsString() listingId: string;
  @IsString() targetId: string;
}

// UpdateReviewDto
class UpdateReviewDto {
  @IsInt() @Min(1) @Max(5) @IsOptional() rating?: number;
  @IsString() @MaxLength(1000) @IsOptional() comment?: string;
}
```

---

## 9. Decisiones cruzadas con otros módulos

### UsersModule

`GET /users/:slug` (existente en `UsersService.findBySlug`) necesita incluir el
agregado de valoraciones. En RV.3 se añade una segunda query en paralelo:

```ts
const [user, reviewAgg] = await Promise.all([
  this.prisma.user.findUnique({ where: { slug }, ... }),
  this.prisma.review.aggregate({ where: { targetId: user.id }, _avg: ..., _count: ... }),
]);
```

No hay dependencia circular: `ReviewsModule` no importa `UsersModule`; el servicio de
usuarios añade la query directamente con Prisma.

### ModerationModule

`ModerationService.createReport()` extiende su validación para `reviewId` (verificar que
la reseña existe). Añade el método `deleteReview(id, actorId, ip)`.
El `ReviewsModule` no depende de `ModerationModule`; la dependencia es en sentido contrario.

### AdminModule / AuditLog

La acción `REVIEW_DELETE` sigue el mismo patrón que `REPORT_RESOLVE`: captura explícita
en el service, no en un interceptor.

---

## 10. Ráfagas de implementación RV.2–RV.5

### RV.2 — Backend completo (Sonnet)

**Alcance:** Todo el backend de valoraciones, sin frontend.

1. Migración Prisma `add_review_fields` (cambios del §7).
2. `ReviewsService`: métodos `create`, `getEligibility`, `edit`, `remove`,
   `getForUser` (lista paginada + aggregate).
3. `ReviewsController`: 4 endpoints propios + registrar el módulo en `AppModule`.
4. Extensión de `UsersService.findBySlug` con aggregate.
5. Extensión de `ModerationService.createReport` para `reviewId?`; nuevo método
   `deleteReview`.
6. Extensión de `ModerationController` con `DELETE /moderation/reviews/:id`.
7. `ReviewsModule` actualizado (importa `PrismaModule`; nada más).
8. Tests e2e `reviews.e2e-spec.ts`:
   - Crear valoración (buyer → seller) — 201
   - Crear valoración (seller → buyer) — 201
   - Comprobar elegibilidad antes y después
   - Doble valoración → 409
   - Sin conversación previa → 403
   - Autovaloración → 400
   - Editar dentro del plazo → 200
   - Editar fuera del plazo → 403
   - Borrar dentro del plazo → 204
   - Borrar fuera del plazo → 403
   - Guest sin token → 401
   - `GET /users/:slug/reviews` — paginación y aggregate correctos

### RV.3 — Frontend: perfil del vendedor (Sonnet)

**Alcance:** Visualización de valoraciones recibidas en el perfil público.

1. Extender `lib/api/users.ts` con los tipos de respuesta de aggregate y reviews.
2. Sección "Valoraciones" en `/vendedor/[slug]` (Server Component, SSR):
   - Media de estrellas con representación visual (estrellitas).
   - Distribución 1–5 con barras proporcionales.
   - Lista paginada de valoraciones (nombre + avatar del autor, rating, comment, fecha).
   - Estado vacío: "Todavía no tiene valoraciones".
3. Chip de rating en la ficha de anuncio (`/anuncio/[slug]`): extender el bloque
   de info del vendedor con la media (si `count > 0`).
4. Sin cambios al sitemap ni a las rutas — todo en páginas existentes.

### RV.4 — Frontend: flujo de valorar (Sonnet)

**Alcance:** Botón + formulario para emitir una valoración desde la vista del chat.

1. Al cargar `/mensajes/[id]`, el `ChatClient` llama a `GET /reviews/eligibility?
   listingId=X&targetId=Y` en paralelo con los mensajes.
2. Si `canReview: true`: botón "Valorar a {nombre}" en la cabecera del chat.
3. Si `alreadyReviewed: true`: badge "Ya valoraste a este usuario".
4. Modal de valoración:
   - Selector de estrellas interactivo (1–5).
   - Textarea de comentario (opcional, max 1 000 chars, contador).
   - Submit → `POST /reviews` → toast de éxito + refresca el estado de elegibilidad.
5. Sin nueva ruta pública; el flujo vive dentro de `/mensajes/[id]`.

### RV.5 — Moderación de reseñas (Sonnet)

**Alcance:** Reportar y borrar reseñas desde el backoffice.

1. Backend ya resuelto en RV.2 (`reviewId` en Report; `DELETE /moderation/reviews/:id`).
2. Actualizar `ReportButton` (o crecer desde él) para aceptar `reviewId` cuando el
   contexto es una reseña.
3. En `/admin/reportes`: cuando `report.reviewId` está presente, mostrar el contenido de
   la reseña (rating + comment) en la fila de la cola.
4. Botón "Eliminar valoración" en la fila → `DELETE /moderation/reviews/:id` →
   toast de confirmación → reporte marcado como RESOLVED automáticamente.
5. No se crea página dedicada de detalle de reseñas; el backoffice es deliberadamente
   minimalista — el moderador ve el contenido inline en la cola.

---

## Resumen de decisiones

| Decisión | Elección | Alternativa descartada |
|---|---|---|
| Criterio de elegibilidad | Conversación existente entre ambos usuarios para ese anuncio | Anuncio en estado SOLD (demasiado restrictivo; mayoría de tratos no marcan SOLD) |
| Granularidad | Una valoración por `(author, target, listing)` | Una por par de usuarios global (no refleja múltiples transacciones) |
| Bidireccionalidad | Ambas partes pueden valorar independientemente | Solo el comprador valora (descarta la experiencia del vendedor) |
| Visibilidad | Inmediata (decisión consciente; trade-off: riesgo de represalia vs. complejidad del sistema ciego) | Ciega tipo Airbnb: eliminada por complejidad; anotada como evolución si hay patrones de represalia |
| Ventana de edición | 72 h desde creación; edición marcada con `editedAt` visible públicamente | 24 h (demasiado corto) / sin límite (riesgo de presión) / edición silenciosa (falta transparencia) |
| Cálculo del aggregate | On-the-fly con Prisma `_avg` / `_count`; caché Redis si hay latencia (YAGNI) | Desnormalizado en `User` (prematura optimización) |
| Moderación | Extensión del sistema de reportes existente + acción de borrado | Circuito de moderación separado (duplicación de infraestructura) |
