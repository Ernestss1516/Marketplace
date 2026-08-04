# Diseño del sistema de valoraciones — Hito 3, Fase V

> ## ✅ ESTADO: IMPLEMENTADO — con DOS decisiones arquitectónicas invertidas
>
> **Diseño de RV.1 (2026-06-24), implementado en RV.2–RV.5** y **modificado después** por el
> Hito 7 y por las ráfagas de Reputación. Revisado en la auditoría de documentación del
> **2026-08-04**. **Donde el diseño y la implementación difieran, gana la implementación.**
>
> Este documento acertó en casi todo —bidireccionalidad, ventana de 72 h, `editedAt`,
> agregado on-the-fly, moderación por reportes— **y sus dos decisiones más marcadas se
> revirtieron.** Las dos están documentadas en su sección, con el razonamiento original
> conservado: quien leyó este diseño debe entender qué lo sustituyó y por qué.
>
> ### 🔄 Reemplazo 1 — el gate de elegibilidad (§1, «decisión arquitectónica principal»)
>
> | | Este diseño | Hoy |
> |---|---|---|
> | Gate | Existe una **`Conversation`** entre A y B sobre el anuncio L | Existe un **`Deal`** entre A y B sobre L |
> | Qué prueba | Que **hablaron** | Que **hubo trato** |
>
> `Conversation` **no desapareció: fue degradada de gate a señal de confianza.** Hoy
> cualquier `Deal` habilita valorar, y que ese trato tenga conversación detrás
> (`conversationId != null`) es lo que marca la reseña como **verificada**. Ver §1.
>
> ### 🔄 Reemplazo 2 — `listingId`, y va en dirección CONTRARIA a la planeada (§7)
>
> | | Este diseño | Hoy |
> |---|---|---|
> | `Review.listingId` | Corregir el stub a **`String` NO nullable** | **`String?` nullable, `onDelete: SetNull`** |
> | Al borrar el anuncio | La reseña caía en cascada | **La reseña SOBREVIVE**, con `listingTitle` congelado |
>
> El diseño quería endurecerlo *«la elegibilidad siempre requiere un anuncio específico»*.
> El Hito 7 lo aflojó **por una razón distinta que el diseño no había considerado**: la
> reputación no puede ser borrable por el propio vendedor. Ver §7.
>
> ### Lo que se añadió y este diseño no contemplaba
>
> - **`Review.verified`** — congelado al crear, nunca recalculado. Solo las verificadas
>   cuentan para la media (§5).
> - **`Review.listingTitle`** — snapshot del título, para que la reseña conserve contexto
>   aunque el anuncio desaparezca (§7).
> - **El escaparate de reputación** — la media dejó de vivir solo en el perfil del vendedor y
>   aparece donde el comprador decide: cards de listado, búsqueda y ficha del anuncio (§5).
>
> **Para la crónica** —las cuatro ráfagas de Reputación y el Hito 7, con sus mediciones— la
> referencia es `estado-tecnico.md`. **Para el inventario de endpoints**,
> `docs/contratos-api.md`.

---

## 0. Andamiaje existente — ESTADO PREVIO (2026-06-24), no el actual

> **Se conserva como punto de partida.** Donde dice «Stub vacío» hoy hay implementación:
> `modules/reviews/` está completo (suite `reviews.e2e-spec.ts`, 24 tests), `Report` ya tiene
> `reviewId` y `ReportReason` ya incluye `FAKE_REVIEW`. La fila que más ha cambiado es la de
> `Conversation` —«fuente de verdad de la elegibilidad»—: **ya no lo es**, ese papel lo tiene
> `Deal` (§1).

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

> ## 🔄 EL GATE REAL: un `Deal`, no una `Conversation`
>
> **Esta es la decisión que más ha cambiado del documento, y era su pilar.** La regla vigente:
>
> > **`A` puede valorar a `B` por el anuncio `L` si existe al menos un `Deal` entre ambos
> > sobre `L`** — en cualquiera de los dos sentidos (`A` vendedor y `B` comprador, o al revés).
>
> Implementado en `findDealsBetween()` ([reviews.service.ts](apps/api/src/modules/reviews/reviews.service.ts)),
> que es el guard único: lo usan `create()` y `getEligibility()`, así que la comprobación
> previa que ve la UI y la que aplica el servidor **no pueden divergir**. Sin trato →
> `403`.
>
> ### El gate tiene DOS niveles, y ahí está la elegancia del cambio
>
> | Hecho | Consecuencia |
> |---|---|
> | Existe un `Deal` (declarado o verificable) | **Puedes valorar** |
> | Ese `Deal` tiene `conversationId != null` (**verificable**) | La reseña nace **`verified: true`** |
>
> **`Conversation` no se tiró: se degradó de gate a señal de confianza.** El razonamiento
> original de abajo —que una conversación es el registro de interacción más sólido del
> sistema— **sigue siendo cierto**; lo que dejó de ser cierto es que fuera el mejor gate.
>
> ### Por qué se cambió — los dos errores simétricos del gate viejo
>
> Cuando el ciclo de vida ganó la entidad `Deal` («¿a quién se lo vendiste?»), el gate de
> `Conversation` quedó produciendo dos fallos opuestos, **ambos verificados en vivo antes de
> tocar código**:
>
> 1. **Falso negativo.** Un trato real y cerrado, declarado sin haber chateado por la
>    plataforma (el comprador llamó por teléfono, o se conocían), **no** habilitaba valorar.
>    Se penalizaba la venta real por no haber pasado por el chat.
> 2. **Falso positivo.** Un simple *«¿sigue disponible?»* sin ningún trato **sí** lo
>    habilitaba. Es decir: el gate anti-fraude se abría con el mensaje más barato de fabricar
>    del sistema.
>
> `Deal` prueba **transacción**, no conversación. Es un gate estrictamente más fuerte contra
> reseñas falsas y a la vez más justo con las ventas legítimas. Y como los `Deal` los declara
> el vendedor —que es quien tiene el incentivo de no inflarlos con desconocidos—, el coste de
> fabricar uno es mucho mayor que el de escribir un mensaje.
>
> ### El matiz que hace que esto no sea un agujero
>
> Un `Deal` **declarado** (sin conversación) también habilita valorar — si no, se reintroduce
> el falso negativo. Lo que hace es **no contar para la media**: `verified` se congela a
> `false` y la reseña sale en la lista pública **etiquetada**, pero fuera de
> `average`/`count`/`distribution` (§5). Así ninguna opinión real se censura y, a la vez,
> la puntuación de confianza solo se construye con tratos que el sistema puede corroborar.
>
> ### Lo que NO se hizo, y es deliberado: `Review` no tiene `dealId`
>
> Se evaluó anclar cada reseña a un `Deal` concreto (`dealId` + `@@unique([authorId, dealId])`)
> y **se descartó**: `Deal` no tiene límite de repetición —un mismo cliente puede repetir
> trato con el mismo servicio—, así que anclarlo permitiría **multiplicar el peso de una
> reseña repitiendo tratos con el mismo par**. Se conserva
> `@@unique([authorId, targetId, listingId])`: una reseña por par por anuncio, haya los tratos
> que haya. Por eso `verified` se pregunta *«¿algún `Deal` de este par sobre este anuncio es
> verificable?»* y nunca se ancla a uno.
>
> ### `verified` se congela y NUNCA se recalcula
>
> Ni al editar, ni por ningún otro endpoint. Y `@default(true)` es **grandfathering
> deliberado**: las reseñas creadas bajo el gate viejo de `Conversation` cuentan como
> contaban, sin backfill ni recálculo retroactivo.

---

### Enfoque inicial (RV.1), reemplazado — se conserva por su razonamiento

> Lo siguiente es el diseño original. **Ya no es la regla vigente**, pero explica de dónde
> viene la actual: el criterio de fondo —exigir una interacción real y previa, registrada por
> el sistema, y no la mera intención— es exactamente el mismo. Lo que cambió es **qué
> interacción cuenta**.

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

> ## ✅ Se implementó como se diseñó — con una limitación conocida, abierta
>
> El `@@unique([authorId, targetId, listingId])` permite las dos direcciones como filas
> distintas, tal cual se razona aquí, y el gate de `Deal` es simétrico (`A` vendedor y `B`
> comprador, o al revés).
>
> **Lo que sigue abierto: las reseñas NO son ciegas.** No hay periodo de doble ciego, así que
> cada parte **puede leer la valoración de la otra antes de escribir o editar la suya** y
> ajustarla en consecuencia — bajar la nota como represalia tras recibir una mala reseña, por
> ejemplo. Es **preexistente** a las ráfagas de Reputación (venía con la bidireccionalidad
> desde RV.2) y no se resolvió en ellas: cerrarlo exige publicar solo cuando ambas partes han
> valorado o cuando vence un plazo, y eso es una ráfaga propia. Anotado como candidato, no
> como deuda urgente: hoy lo mitiga que la ventana de edición sea de solo 72 h y que
> `FAKE_REVIEW` permita reportar la represalia.

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

> ## ✅ On-the-fly, como se diseñó — con dos añadidos
>
> **La decisión central de esta sección aguantó**: el agregado se calcula en tiempo de
> ejecución, sin desnormalizar en `User`. Y no aguantó por inercia — cuando el Hito 7 quiso
> llevar la media a las cards de listado, se **midió antes de decidir**: incluso con 1 000
> vendedores, 88 000 reseñas y eligiendo adversarialmente los 40 vendedores más pesados, la
> consulta agrupada tarda **~2,8 ms** (`Index Scan` sobre el índice que ya existía). Frente a
> consultas ya aceptadas como gratis en ese mismo listado (~0,6 ms), es una milésima más, no
> un orden de magnitud. **Se confirmó on-the-fly**: una sola fuente de verdad, cero riesgo de
> desincronización, cero invariante que mantener. La nota de §5 «YAGNI — no optimizar ahora»
> se validó con números.
>
> ### Añadido 1 — la media cuenta SOLO las reseñas verificadas
>
> El `where` real no es `{ targetId }` sino **`{ targetId, verified: true }`** para
> `average`, `count` y `distribution`. Además se devuelve **`unverifiedCount`**.
>
> La respuesta real de `listForUser()`:
>
> ```json
> {
>   "average": 4.3, "count": 27,
>   "distribution": { "1": 1, "2": 2, "3": 3, "4": 8, "5": 13 },
>   "unverifiedCount": 4,
>   "items": [ … ], "nextCursor": "…"
> }
> ```
>
> **`items` incluye TODAS las reseñas**, verificadas y no, cada una con su propio `verified`.
> El criterio: **no censurar opinión real solo porque el trato no pasó por el chat**, pero no
> dejar que entre en la puntuación de confianza. Se muestran, etiquetadas y aparte.
>
> ### Añadido 2 — el escaparate: la reputación donde el comprador decide
>
> Este diseño ponía la reputación **solo en el perfil del vendedor**. El problema, medido en
> la auditoría del Hito 7: es invisible justo en el momento en que se decide la compra — ni
> las cards de listado ni la ficha del anuncio mostraban una estrella.
>
> Hoy la media aparece también en **cards de listado, resultados de búsqueda, portada,
> bloques de contenido y la ficha del anuncio**, todos a través de la misma función
> (`ReviewsService.getRatingSummaries()`), sin duplicar la agregación.
>
> **Dos decisiones de arquitectura que conviene no deshacer:**
>
> - **La media NO se indexa en Meilisearch**, a diferencia de `sellerName` o `trusted`. Esos
>   casi nunca cambian; la media cambiaría **con cada reseña nueva**, y meterla en el
>   documento obligaría a **reindexar todos los anuncios de un vendedor en cada valoración**.
>   Se mezcla *después* de leer los hits. Verificado ejerciendo: la media aparece correcta en
>   `GET /search` inmediatamente tras publicar, **sin reindexar nada**.
> - **En la ficha va siempre fresca, fuera de la caché Redis de 5 min** — mismo criterio que
>   `featuredUntil`.
>
> **Sin reseñas verificadas se muestra «Nuevo», nunca ★0,0.** El caso que lo prueba: un
> vendedor con una única reseña **no verificada** de 2 estrellas devuelve
> `ratingAverage: null, ratingCount: 0` — su media cruda (2,0) **no se cuela** como si fuera
> reputación verificada.

### Cálculo *(diseño original — sin el filtro `verified`)*

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

> ## 🔄 El modelo REAL — y `listingId` acabó al revés de lo que este diseño planeaba
>
> ```prisma
> model Review {
>   id        String  @id @default(cuid())
>   rating    Int                    // 1..5, validado en el DTO
>   comment   String? @db.Text
>
>   authorId  String                 // Cascade — igual que se diseñó
>   targetId  String                 // Cascade — igual que se diseñó
>
>   // ⬇️ INVERTIDO respecto a este diseño
>   listingId    String?             // nullable
>   listing      Listing? @relation(fields: [listingId], references: [id], onDelete: SetNull)
>   listingTitle String?             // snapshot del título al crear la reseña
>
>   createdAt DateTime  @default(now())
>   updatedAt DateTime  @updatedAt
>   editedAt  DateTime?              // null hasta la primera edición — como se diseñó
>
>   verified  Boolean @default(true) // ⬅️ AÑADIDO (Reputación RÁFAGA 3)
>
>   reports Report[]
>   tickets Ticket[]                 // ⬅️ AÑADIDO: hilo de atención al usuario desde una reseña
>
>   @@unique([authorId, targetId, listingId])
> }
> ```
>
> ### La inversión, y por qué
>
> Este diseño decía: *«No nullable: la elegibilidad siempre requiere un anuncio específico.
> El stub lo tiene como `String?`; la migración lo convierte a `String`»*. Con
> `onDelete: Cascade`, borrar un anuncio se llevaba por delante sus reseñas.
>
> **El Hito 7 lo revirtió** (migración `review_survives_listing_delete`): `listingId` vuelve a
> ser nullable, la relación pasa a **`SetNull`**, y se añade `listingTitle` con **backfill**
> de las reseñas existentes cuyo anuncio seguía vivo.
>
> **El motivo no invalida el razonamiento original — responde a otra pregunta.** El diseño
> razonaba sobre *elegibilidad*: para valorar hace falta un anuncio concreto, y eso **sigue
> siendo verdad** (el gate exige un `Deal` sobre un `listingId`). La pregunta que no se había
> hecho es qué pasa **después**:
>
> > **La reputación no puede ser borrable por quien la sufre.** Con `Cascade`, a un vendedor
> > le bastaba con borrar el anuncio para hacer desaparecer las reseñas negativas que había
> > recibido por él. El anti-fraude de §1 se ocupaba de que no se pudieran *fabricar* reseñas,
> > y dejaba abierto que se pudieran *destruir*.
>
> `listingTitle` es lo que hace que la reseña siga siendo legible sin su anuncio: conserva el
> contexto («valoró tu venta de *Bicicleta de montaña*») aunque `listingId` sea ya `NULL`. Y
> se toma **del propio `Deal`**, no cargando el `Listing` en vivo — el `Deal` ya lleva su
> snapshot por el mismo motivo, así que sobrevive igual.
>
> Mismo molde que `Entitlement` y `Transaction`, que también conservan el registro cuando su
> objeto desaparece. Y `Deal.listingId` es `SetNull` por idéntica razón.
>
> ### Otras diferencias del modelo real
>
> - **`verified Boolean @default(true)`** — no existía en el diseño. Ver §1 y §5.
> - **`tickets Ticket[]`** — no existía: permite abrir un hilo de atención al usuario desde
>   una reseña (el botón solo se ofrece en el perfil propio, porque `ReviewsSection` es un
>   componente público y ofrecérselo a un visitante sería ofrecer una acción que el backend
>   rechaza).
> - **El `@@unique` se mantuvo tal cual se diseñó** — y en el Hito 7 se ratificó
>   explícitamente al descartar anclar la reseña a un `dealId` (§1).
> - **`ReportReason.FAKE_REVIEW` y `Report.reviewId`** se implementaron como se diseñaron.

### Cambios al schema de Prisma *(diseño original — `listingId` no nullable, invertido)*

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

> ## ✅ Las seis rutas se construyeron tal cual. Tres matices:
>
> - **`POST /reviews` → 403 «no hay conversación»** es hoy **«no hay trato»**: el mensaje real
>   es *«Solo puedes valorar a usuarios con los que has cerrado un trato sobre este anuncio»* (§1).
> - **`GET /reviews/eligibility` devuelve más campos** de los que lista la tabla:
>   `{ canReview, wouldBeVerified, alreadyReviewed, existingReview }`. **`wouldBeVerified`**
>   permite que la UI anticipe si la reseña contará para la media **antes** de enviarla — sin
>   él, el usuario descubriría después que su valoración no puntúa.
> - **`GET /users/:slug/reviews` devuelve además `unverifiedCount`** (§5).
>
> El inventario verificado está en `docs/contratos-api.md`.

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

## 10. Ráfagas de implementación RV.2–RV.5 — CERRADAS, más la evolución posterior

> ## ✅ Las cuatro se cerraron. Después el sistema evolucionó en dos tandas.
>
> | Ráfaga | Estado | Qué cerró |
> |---|---|---|
> | **RV.2** ✅ | Backend completo: modelo, gate, CRUD, agregado |
> | **RV.3** ✅ | Frontend: perfil del vendedor con reseñas y agregado |
> | **RV.4** ✅ | Frontend: flujo de valorar |
> | **RV.5** ✅ | Moderación de reseñas (reportes + `DELETE /moderation/reviews/:id`) |
>
> **Lo que vino después, y que este diseño no preveía:**
>
> | Después | Qué cambió |
> |---|---|
> | **Hito 7** — `review_survives_listing_delete` | `listingId` → `SetNull` + `listingTitle` + backfill (§7). **Invierte** la migración planeada en RV.2 |
> | **Ciclo de vida RÁFAGA 1** | Aparece `Deal` — la entidad que después reemplazaría al gate |
> | **Reputación RÁFAGA 3** | El gate pasa de `Conversation` a `Deal`; nace `Review.verified`; la media pasa a contar solo verificadas (§1, §5) |
> | **Escaparate RÁFAGA 4** | La reputación sale del perfil a cards, búsqueda y ficha (§5) |
>
> Verificación: `reviews.e2e-spec.ts` (24 tests). Los avisos de valoración tras cerrar un
> trato (`Notification REVIEW_REQUEST` + email a **ambas** partes) se disparan desde
> `ListingsService.closeDeal`, no desde este módulo.

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
