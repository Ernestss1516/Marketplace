# Diseño — El cuerpo de borrado (P5, la política transversal)

> Documento de diseño (2026-08-19). Parte de
> [`docs/auditoria-backoffice-administracion.md`](./auditoria-backoffice-administracion.md)
> §Bloque 4 y lo convierte en un plan.
>
> **Objetivo:** que el usuario **archive** y no elimine; que el **staff** elimine, y sólo
> anuncios ya archivados; y que eliminar limpie lo que es parte del anuncio **preservando**
> lo que es un registro con valor propio.
>
> **Alcance:** el borrado de un `Listing`. No entra el borrado de usuarios, ni el de las
> demás entidades (posts, categorías, cupones…), que tienen sus propias reglas.
>
> Toda afirmación sobre el schema y el código está verificada contra el fichero y la línea
> citados. Donde hay una decisión abierta, se dice y se recomienda.

---

## 0. Las tres inversiones

Hoy el borrado está **al revés** de lo que se quiere, en tres ejes a la vez:

| | Hoy (verificado) | Objetivo |
|---|---|---|
| **Quién** | Sólo el **dueño** puede eliminar (`assertOwnership` en [`listings.service.ts:988`](../apps/api/src/modules/listings/listings.service.ts#L988)). El staff **no puede** — no existe ningún endpoint | Sólo el **staff**. El dueño, nunca |
| **Desde dónde** | Desde **cualquier estado** — `remove()` no mira `status` | Sólo desde **ARCHIVED** |
| **Qué se lleva por delante** | Los **reportes** (Cascade) y las **conversaciones enteras** (Cascade). Y **no** limpia R2 | Los reportes y las conversaciones **sobreviven**. R2 se limpia |

La tercera es la que convierte esto en algo más que una permuta de permisos: **hoy el
denunciado puede destruir la denuncia y el vendedor puede destruir el hilo de mensajes que
prueba lo que dijo**, y le basta con borrar su propio anuncio. Es la misma clase de defecto
dos veces, y el motivo de fondo por el que el borrado deja de ser del usuario.

---

## 1. Bloque 1 — La política: quién puede qué

### 1.1 La tabla

| Acción | Usuario (dueño) | Staff (MODERATOR+) | Estado de partida | Reversible |
|---|---|---|---|---|
| **Archivar** | **sí** (ya existe) | **sí** — hay que añadirlo a la UI | `ACTIVE`, `PAUSED`, `SOLD`, `EXPIRED`, `REJECTED` | **no** (ARCHIVED es terminal) |
| **Eliminar** | **NO** — hay que quitárselo | **sí** — hay que construirlo | **sólo `ARCHIVED`** | no (destruye la fila) |

Verificado que ya existe y no hay que tocarlo:

- `archive()` ([`listings.service.ts:717`](../apps/api/src/modules/listings/listings.service.ts#L717))
  con `ARCHIVABLE_STATUSES = [ACTIVE, PAUSED, SOLD, EXPIRED, REJECTED]`.
- `ARCHIVED` es **terminal en dos capas**: el schema lo declara y
  [`listing-status.transitions.ts`](../apps/api/src/modules/listings/listing-status.transitions.ts)
  lo hace cumplir (`ARCHIVED: []`, y `isLegalTransition` sólo admite el no-op `from === to`).
- Archivar **no destruye nada**: conversaciones, tratos y valoraciones sobreviven — es, por
  diseño, «la alternativa no destructiva a `remove()`».

### 1.2 El hueco que la política abre, y que hay que cerrar en el mismo cuerpo

**Éste es el hallazgo central del diseño, y no estaba en la auditoría.**

Quitarle el borrado al usuario deja **estados sin salida**. Verificado:

- `ESTADOS_QUE_CUENTAN_AL_TOTAL` ([`listing-limits.ts:62`](../apps/api/src/modules/listing-gate/listing-limits.ts#L62))
  = `DRAFT, PENDING_REVIEW, ACTIVE, RESERVED, PAUSED, EXPIRED, REJECTED`. Es decir: **todo
  menos `ARCHIVED`**. Archivar libera plaza; ésa es la válvula de escape del tope.
- Pero `ARCHIVABLE_STATUSES` **excluye `DRAFT` y `PENDING_REVIEW`** («nada publicado aún») y
  **`RESERVED`** («archivar dejaría un trato colgado sin resolver»).

Cruzando las dos listas:

| Estado | ¿Cuenta al tope? | ¿Archivable? | ¿Salida hoy? | ¿Salida sin el borrado del usuario? |
|---|---|---|---|---|
| `DRAFT` | **sí** | **no** | eliminar | **NINGUNA** ⚠️ |
| `PENDING_REVIEW` | **sí** | **no** | eliminar | sólo esperar al moderador → y desemboca en `DRAFT` ⚠️ |
| `RESERVED` | sí | no | eliminar | cerrar o deshacer el trato → `ACTIVE`/`SOLD` → archivar ✔ |
| resto | sí | sí | archivar | archivar ✔ |

**Un usuario con tres borradores abandonados se quedaría con tres plazas de su cupo ocupadas
para siempre**, sin ninguna acción a su alcance. Eso no es un efecto lateral tolerable: es un
callejón sin salida introducido por la propia política.

**Decisión abierta D-1 (§6.1), con recomendación.** Dos formas de cerrarlo:

- **(a) Ampliar `ARCHIVABLE_STATUSES` a `DRAFT` y `PENDING_REVIEW`.** Literal con la política
  («el usuario sólo archiva»), pero exige tocar la máquina de estados de la ráfaga A —
  `DRAFT: ['ACTIVE','PENDING_REVIEW']` y `PENDING_REVIEW: ['ACTIVE','REJECTED','DRAFT']` no
  admiten `ARCHIVED`— y deja al usuario con un archivo lleno de borradores a medias, usando
  una palabra («archivar») que significa «conservar para siempre» para algo que nunca existió.
- **(b) ⭐ El usuario puede DESCARTAR un anuncio nunca publicado (`DRAFT` únicamente).**
  Recomendada. La política existe para que **nadie destruya historia pública**; un `DRAFT` no
  tiene ninguna: no está en el índice, nadie lo ha marcado como favorito, no tiene
  conversaciones, ni reportes, ni valoraciones, ni tratos. Descartarlo no destruye nada que
  otra persona pueda echar en falta. Es una operación **distinta** de «eliminar un anuncio», y
  conviene que se llame distinto en el código y en la UI, precisamente para que nadie la
  confunda con la que se le está quitando.
  - Alcance exacto: `DRAFT`. `PENDING_REVIEW` **no** — ahí hay un moderador con trabajo
    encolado, y retirarlo por debajo es otra decisión (ver D-2).
  - Lo único que hay que limpiar es la fila y sus objetos de R2 (un borrador **sí** puede
    tener imágenes ya subidas). El resto de relaciones está vacío por construcción.

Sea cual sea la elegida, **tiene que ir en el mismo cuerpo que quita el borrado**: entregar
una sin la otra deja el producto peor que hoy.

### 1.3 Eliminar NO es una transición de estado

Decisión de forma, para que no se cuele en el sitio equivocado: `remove()` **destruye la
fila**, no la mueve. No entra en `LISTING_STATUS_TRANSITIONS` ni pasa por
`isLegalTransition`. Lo que sí hace es **comprobar el estado de partida** (`ARCHIVED`) con su
propio `if`, exactamente como hacen `archive()`, `publish()`, `reserve()` y compañía — que
son los doce escritores de estado que ya llevan su guarda propia.

La consecuencia operativa importa: **para eliminar un anuncio activo hay que archivarlo
primero**, en dos pasos deliberados. Ese segundo clic es la salvaguarda: separa «sacarlo del
mercado» de «destruirlo».

### 1.4 «En todo el proyecto»: dónde vive hoy el borrado del usuario

Verificado — la superficie es pequeña y está toda localizada:

| Capa | Dónde | Qué hacer |
|---|---|---|
| API | `DELETE /listings/:id` → `remove()` ([`listings.controller.ts:139`](../apps/api/src/modules/listings/listings.controller.ts#L139)) | Deja de ser del dueño. Ver D-1 para qué queda en su lugar |
| Cliente | `deleteListing()` ([`lib/api/anuncios.ts:216`](../apps/web/src/lib/api/anuncios.ts#L216)) | Un solo consumidor real |
| UI | La entrada «Eliminar» del menú del dueño, **añadida sin condición** ([`use-listing-actions.tsx:272`](../apps/web/src/components/anuncios/owner/use-listing-actions.tsx#L272)) — con su `AlertDialog` | Se retira (o se convierte en «Descartar» y sólo en `DRAFT`, si D-1 = (b)) |

No hay ninguna otra vía: **un solo `prisma.listing.delete` en todo `apps/api/src`** (grep
verificado) y un solo llamante en el web.

---

## 2. Bloque 2 — El inventario, caso por caso

### 2.1 El criterio

> **Parte del anuncio** → muere con él. Es contenido o accesorio del propio anuncio; sin el
> anuncio no significa nada.
>
> **Registro con valor propio** → sobrevive. Es la constancia de algo que **pasó** —una
> denuncia, un trato, una conversación entre dos personas, un cobro— y su valor no depende de
> que el anuncio siga existiendo. La prueba del algodón: **¿lo echaría en falta alguien que no
> sea el dueño del anuncio?** Si la respuesta es sí, no es suyo para destruirlo.

### 2.2 La tabla completa

Las **13 relaciones** con FK a `Listing`, verificadas una a una en el schema:

| # | Qué | `onDelete` hoy | Veredicto | Acción |
|---|---|---|---|---|
| 1 | `ListingTag` | Cascade | **BORRA** | ninguna — ya correcto |
| 2 | `ListingImage` | Cascade | **BORRA** | filas ✔; **los objetos de R2 no se borran** ⚠️ §2.3 |
| 3 | `Favorite` | Cascade | **BORRA** | ninguna. Un favorito a un anuncio inexistente no significa nada |
| 4 | `AlertMatch` | Cascade | **BORRA** | ninguna |
| 5 | `ListingViewDaily` | Cascade | **BORRA** | ninguna. Las vistas son del anuncio |
| 6 | `BumpSchedule` (→ `BumpRun` Cascade) | Cascade | **BORRA** | ninguna. Agenda de un anuncio que ya no existe. **El dinero no se pierde**: §2.6 |
| 7 | **`Conversation`** (→ `Message` Cascade) | **Cascade** | **PRESERVA** ⚠️ | **cambio de schema** — §2.5 |
| 8 | **`Report`** | **Cascade** | **PRESERVA** ⚠️ | **cambio de schema** — §2.4 |
| 9 | `Deal` | SetNull + `listingTitle` | **PRESERVA** | ninguna — ya correcto, y es el molde |
| 10 | `Review` | SetNull + `listingTitle` | **PRESERVA** | ninguna — ya correcto |
| 11 | `Ticket` | SetNull + `linkedLabel` | **PRESERVA** | ninguna — ya correcto |
| 12 | `Entitlement` | SetNull | **PRESERVA** | ninguna — §2.6 |
| 13 | `Transaction` | SetNull | **PRESERVA** | ninguna. Registro contable: nunca se borra |

Y lo que no es una FK:

| Qué | Veredicto | Estado hoy |
|---|---|---|
| **Objetos en R2** (imágenes **y sus miniaturas**, vídeo) | **BORRA** | ❌ **no se limpia nada** — §2.3 |
| **Documento en Meilisearch** | **BORRA** | ✔ `indexingQueue.add('remove')` en `remove()`, con su `case 'remove'` en [`indexing.processor.ts:49`](../apps/api/src/infra/queue/processors/indexing.processor.ts#L49) |
| **Caché Redis de la ficha** (`listing:{slug}`) | **BORRA** | ✔ `redis.client.del(cacheKey(slug))` en `remove()` |
| `view:dedup:{listingId}:{visitante}` (Redis) | irrelevante | TTL corto, se expira solo. **No hacer nada** — barrer claves por patrón costaría más que dejarlas morir |
| `CreditLedger` / `BumpLedger` | **PRESERVA** | ✔ **por construcción**: apuntan al anuncio con `referenceType`/`referenceId` (strings), sin FK. §2.6 |
| `Notification` | **PRESERVA** con enlace muerto | Decisión ya tomada y escrita en el schema: el `data` es un *snapshot autocontenido* que «debe sobrevivir aunque el anuncio se borre». El enlace lleva a un 404 — §6.2 |

**Balance: de trece relaciones, once ya están bien.** El cuerpo de borrado toca **dos** —
`Report` y `Conversation`— más la limpieza de R2. Eso es una noticia buena y conviene decirla:
el modelo de datos ya distingue casi siempre entre lo que es del anuncio y lo que es un
registro.

### 2.3 Los objetos de R2: el hueco más grande

**Verificado, y peor de lo que decía la auditoría: cada imagen deja DOS objetos.**

- `MediaService.upload` sube el original con clave `media/<hex><ext>` y guarda en
  `ListingImage.url` la **URL pública completa** ([`media.service.ts:33-40`](../apps/api/src/modules/media/media.service.ts#L33)).
- `ImageProcessor` genera después una miniatura y la sube con
  `thumbKey = r2Key.replace(/\.[^.]+$/, '-thumb.webp')` ([`image.processor.ts:35`](../apps/api/src/infra/queue/processors/image.processor.ts#L35)).
  **Esa clave no se guarda en ninguna columna**: sólo existe como una regla de derivación
  dentro del procesador.
- El vídeo vive en `Listing.videoUrl` y `Listing.videoPosterUrl`.

Consecuencias para el diseño:

1. Limpiar un anuncio significa borrar, por cada imagen, **el original y su miniatura
   derivando la clave con la misma regla**. Si sólo se borra lo que hay en la BD, la mitad de
   la basura se queda.
2. **La regla de derivación pasa a estar en dos sitios** (quien sube y quien limpia). Debe
   extraerse a un único helper —el molde es `cache-keys.ts`, que existe exactamente por este
   motivo— o volverá a divergir.
3. `videoPosterUrl` es un objeto más y se olvida con facilidad.

**El molde de limpieza ya existe y es bueno:** `VideoService.deleteObjectByUrl`
([`video.service.ts:270`](../apps/api/src/modules/video/video.service.ts#L270)) hace
`isOwnStorageUrl` → deriva la clave restando el prefijo público → `r2.delete(key)` → **y
traga el error con un log**: «no dejar limpiar no debe romper nada». Ese criterio es el
correcto y se hereda tal cual: un objeto que no se borra es **basura, no corrupción**.

### 2.4 `Report` — de Cascade a SetNull + snapshot

**Es el defecto más serio del borrado actual.** `Report.listingId` es `onDelete: Cascade`
([`schema.prisma:990`](../apps/api/prisma/schema.prisma#L990)), así que borrar un anuncio
**destruye todas sus denuncias, resueltas o no**. Hoy eso lo puede disparar el propio
denunciado, porque hoy el borrado es del dueño.

Y no es una decisión que alguien tomara: la de al lado sí lo es, y dice lo contrario —
`Review.listingId` es `SetNull` con el comentario «la reseña sobrevive al borrado del
anuncio (**la reputación no es borrable por el vendedor**)». La denuncia merece exactamente
el mismo argumento y le tocó el valor contrario.

**Diseño:**

- `Report.listingId` → **nullable + `onDelete: SetNull`**.
- Columna nueva de contexto, molde `Review.listingTitle` / `Deal.listingTitle` /
  `Ticket.linkedLabel` — los **tres** precedentes del repo, uno de los cuales cita
  explícitamente a los otros dos. Con guardar el **título** basta para que la cola de
  moderación siga siendo legible; si se quiere más contexto, el `slug` es barato.
- Migración **aditiva**: la columna nace `null` para los reportes existentes, que siguen
  teniendo su `listingId` vivo. No hace falta backfill — el snapshot sólo se necesita cuando
  el anuncio desaparece, y se **escribe al crear el reporte**, no al borrar el anuncio (ver
  §3.3: escribirlo en el borrado sería una escritura masiva dentro de la transacción).

**Ojo con el segundo salto:** `Report.reviewId` también es `Cascade`. No se dispara en este
camino (la `Review` sobrevive al borrado del anuncio), pero significa que **borrar una
valoración sí destruye sus denuncias** — y eso lo hace el staff desde `/admin/reportes`. Es
el mismo defecto en otra arista. **No entra en este cuerpo** (va de borrar reseñas, no
anuncios), pero queda anotado en §6.2 para no perderlo.

### 2.5 `Conversation` — la decisión más difícil

`Conversation.listingId` es **obligatorio** y `Cascade`, y la cabecera del modelo declara la
intención: *«MENSAJERÍA (conversación **por anuncio** entre comprador y vendedor)»*, anclada
además por `@@unique([listingId, buyerId])`. Leído así, la conversación **es** del anuncio y
morir con él es coherente.

**Y aun así el veredicto es PRESERVAR.** Tres razones, en orden de peso:

1. **Los mensajes son de dos personas, no del anuncio.** Contienen acuerdos, direcciones,
   teléfonos y —cuando algo va mal— la prueba de lo que se dijo. Que el vendedor pueda
   destruir el hilo del comprador borrando su propio anuncio es **exactamente el mismo abuso**
   que el Cascade de `Report`, con otro nombre. Que hoy sea el dueño quien borra es lo que lo
   convierte en un problema real y no teórico.
2. **Ya hay una incoherencia declarada dentro del propio modelo.** `Deal.conversationId` es
   `SetNull` y su comentario dice que distingue «interacción verificable» de «afirmado por el
   vendedor». Con `Conversation` en Cascade, borrar el anuncio **pone ese campo a `null`** y
   degrada en silencio la evidencia de un trato que sí ocurrió. (No hay daño retroactivo en
   las reseñas: `Review.verified` está *congelado al crear* y nunca se recalcula.)
3. **Archivar ya promete lo contrario.** `archive()` presume de no destruir conversaciones.
   Si `archive → delete` acaba destruyéndolas igual, la promesa dura lo que tarde el staff en
   pasar por ahí.

**Diseño:**

- `Conversation.listingId` → **nullable + `SetNull`**, y columna de contexto (título), mismo
  molde que los otros tres.
- **Consecuencia en `@@unique([listingId, buyerId])`, que hay que aceptar a propósito:** en
  Postgres los `NULL` no colisionan entre sí, así que varias conversaciones huérfanas del
  mismo par comprador/vendedor podrán coexistir. Es correcto — son hilos históricos de
  anuncios distintos, y la unicidad sólo tiene sentido mientras el anuncio existe.
- **Impacto verificado en la bandeja:** `MessagingService` construye la respuesta con
  `conv.listing.id / .title / .slug / .images[0]` ([`messaging.service.ts:58-63`](../apps/api/src/modules/messaging/messaging.service.ts#L58));
  con `listing` a `null` eso reventaría. La implementación tiene que degradar a: título desde
  el snapshot, **sin enlace** y **sin miniatura** (la miniatura no puede sobrevivir: sus
  objetos de R2 se borran, §2.3). Es la parte de UI de este bloque.

**La alternativa, honestamente:** dejar `Cascade` es defendible si se acepta que la
conversación es contenido del anuncio; ahorra una migración y el retoque de la bandeja. Se
descarta por la razón 1, que es de fondo y no de comodidad. Queda como **D-3** por si Ernest
prefiere lo contrario.

### 2.6 El dinero sobrevive solo, y conviene saber por qué

Bien resuelto ya, sin tocar nada:

- **`CreditLedger` y `BumpLedger` no tienen FK a `Listing`.** Apuntan con
  `referenceType: 'Listing'` + `referenceId`, dos columnas de texto. Borrar el anuncio **no
  los toca**, así que el libro mayor —el invariante `wallet.balance == SUM(ledger.amount)`—
  queda intacto por construcción. Es la ventaja no buscada de la referencia polimórfica.
- **`Transaction`** es `SetNull`: el cobro sobrevive sin su anuncio. Correcto; una
  transacción es un hecho contable.
- **`BumpRun`** muere con su `BumpSchedule`. Es un registro de **ejecución**, no de cobro —
  el schema lo dice explícitamente: «NO son el libro mayor». Lo que se pagó está en
  `BumpLedger`, que sobrevive. Correcto.
- **`Entitlement`** es `SetNull`: un destacado pagado queda apuntando a nada. Inofensivo —
  `getFeaturedQuotaStatus` cuenta por `userId` y fecha, no por anuncio, así que ningún cupo se
  corrompe. **Recomendación menor:** revocarlo (`revokedAt`) al borrar sería más limpio que
  dejarlo vigente sobre un anuncio inexistente. No es obligatorio; se anota.

---

## 3. Bloque 3 — Atomicidad y orden

### 3.1 El problema

El borrado toca cuatro sistemas y **sólo uno es transaccional**: Postgres. R2, Meilisearch y
Redis quedan fuera de la transacción de Prisma. Hay dos maneras de quedarse a medias, y no
son igual de graves:

- **BD inconsistente** (unas filas borradas y otras no) → **corrupción**. Inaceptable.
- **BD limpia pero objetos en R2 / documento en Meili** → **basura**. Molesta, cuesta dinero,
  no rompe nada y se puede reintentar.

Todo el diseño sale de esa asimetría.

### 3.2 El orden

1. **Cargar el anuncio con lo que hará falta después** — imágenes, `videoUrl`,
   `videoPosterUrl`, `slug`. Es el paso que la gente olvida: después del borrado ya no hay de
   dónde sacarlo. Molde exacto: `deleteReview` carga la fila antes para poder construir el
   aviso «porque después no habría de dónde sacar el dato».
2. **Comprobar la guarda** — existe, y está en `ARCHIVED`.
3. **Transacción de BD.** Un único `prisma.listing.delete`; las cascadas y los `SetNull` los
   resuelve Postgres **dentro de la misma sentencia**, que es atómica por sí sola. Aquí no
   hace falta un `$transaction` explícito salvo que se añada trabajo previo (ver §3.3).
4. **Auditoría** (§4.2), con el `before` que se cargó en el paso 1.
5. **Efectos externos, ya fuera de la transacción y sin poder tumbar el borrado:**
   - `redis.del(listingCacheKey(slug))` — inmediato, barato, sin fallo posible que importe.
   - `indexingQueue.add('remove', { listingId })` — **ya existe y funciona**.
   - **`mediaCleanupQueue.add('purge', { keys })`** — lo nuevo. Ver §3.4.

**Regla:** si algo del paso 5 falla, el borrado **no se deshace**. La fila ya no está y eso es
lo correcto: reintentar la limpieza es trivial, resucitar el anuncio no.

### 3.3 Por qué el snapshot se escribe al CREAR, no al borrar

Tentación evidente: en el momento del borrado, recorrer los reportes y las conversaciones del
anuncio y rellenarles el título antes de soltar la FK. **Se descarta**, por dos motivos:

- Convierte un borrado en una escritura de N filas dentro de la transacción, con N sin cota
  (un anuncio popular puede tener decenas de conversaciones). Un borrado que se vuelve lento
  y bloqueante en proporción a lo popular que fue el anuncio es justo lo contrario de lo que
  se quiere.
- Es un camino que **sólo se ejecuta en el borrado**, así que sólo se prueba ahí: si alguna vez
  falla, el registro se queda sin contexto y no hay segunda oportunidad.

Escribirlo **al crear el reporte / la conversación** es una columna más en un `create` que ya
existe, cuesta cero, y es exactamente lo que hacen los tres precedentes del repo
(`Review.listingTitle`, `Deal.listingTitle`, `Ticket.linkedLabel`): **snapshot en el momento
del hecho**, no en el momento del borrado.

Coste que hay que aceptar: los reportes y conversaciones **anteriores** a la migración se
quedarán sin título si su anuncio se borra. Es aceptable —el enlace muerto sigue siendo
identificable por su id— y un backfill desde `Listing.title` es opcional y fácil, porque los
anuncios todavía existen cuando se aplique la migración. **Recomendado hacerlo**: es un
`UPDATE ... FROM` de una sola pasada y evita un hueco permanente en la evidencia.

### 3.4 La cola de limpieza de R2

**No existe ninguna hoy** — hay que crearla, y el repo tiene todos los moldes:

- Cuatro colas BullMQ ya en marcha (`indexing`, `image`, `alert-matching`, `notifications`),
  con `@Processor` y reintentos.
- `R2Service.delete(key)` ([`r2.service.ts:52`](../apps/api/src/infra/r2/r2.service.ts#L52)).
- El criterio de fallo silencioso de `deleteObjectByUrl`.

**Decisión: el trabajo recibe las CLAVES ya resueltas, no el `listingId`.** Es lo que lo hace
correcto: cuando el trabajo se ejecute, el anuncio **ya no existe** y no habría forma de
averiguar qué ficheros eran suyos. El paso 1 del §3.2 es quien las calcula.

Contenido del trabajo, por anuncio: por cada `ListingImage`, la clave del original **y la
derivada de la miniatura**; más `videoUrl` y `videoPosterUrl` si los hay.

**Reutilizable más allá de este cuerpo:** la misma cola cierra la deuda de huérfanas ya
declarada en [`docs/pendientes.md`](./pendientes.md) —imágenes de wizards abandonados,
adjuntos de ticket, vídeos sin confirmar—, cuya nota de alcance avisa exactamente de esto:
«hoy no puede materializarse porque no existe ningún endpoint que borre tickets, mensajes ni
usuarios. **Si se añade cualquiera de los tres, hay que borrar también del bucket**». Este
cuerpo añade uno. Diseñar la cola por clave, y no por anuncio, es lo que la deja servir
también para los otros dos casos.

---

## 4. Bloque 4 — Irreversibilidad, auditoría y seguridad

### 4.1 Las salvaguardas, en capas

| Capa | Qué impide |
|---|---|
| Rol (`@MinRole(MODERATOR)`) | Que lo haga quien no es staff. **Decisión abierta D-4**: ¿MODERATOR o ADMIN? |
| Guarda de estado (`ARCHIVED`) | Que se destruya algo vivo. Obliga a los dos pasos |
| `AlertDialog` en el backoffice | El clic accidental. Molde ya establecido: «acción irreversible ⇒ `AlertDialog` antes y aviso después» (regla escrita en `apps/web/CLAUDE.md`) |
| `AuditLog` | Que no quede constancia |

Las dos primeras son de verdad; las dos últimas son trazabilidad y ergonomía. Conviene no
confundirlas.

### 4.2 La auditoría del borrado

**Imprescindible, y es lo único que sobrevive al borrado.** Molde exacto: `deleteReview`
([`moderation.service.ts`](../apps/api/src/modules/moderation/moderation.service.ts)) — carga
la fila, borra, y registra con `before` poblado desde la copia en memoria.

- **Acción:** `LISTING_DELETE`, junto a las cinco que ya existen (`LISTING_STATUS_CHANGE`,
  `LISTING_APPROVE`, `LISTING_REJECT`, `LISTING_DEACTIVATE`, `LISTING_RESTORE`). La lista
  vive documentada en el comentario del modelo `AuditLog` y hay que ampliarla ahí también.
- **`before`:** lo que permita reconstruir *qué* se destruyó — `title`, `slug`, `sellerId`,
  `status`, `categoryId`, y los recuentos de lo que colgaba (imágenes, conversaciones,
  reportes). No el anuncio entero: el `AuditLog` no es una papelera.
- **`resourceId`:** el `listingId`. Sobrevive aunque la fila no.
- **`actorId`:** quién. Es el punto entero del registro.

Nota de integridad ya verificada: `AuditLog.actorId` es una relación **obligatoria** a `User`
sin `onDelete`, es decir `Restrict` — el registro no puede quedar huérfano de actor.

### 4.3 Lo que este cuerpo NO debe tocar

- **`ARCHIVED` sigue siendo terminal.** Eliminar no es una transición (§1.3), así que
  `LISTING_STATUS_TRANSITIONS` **no cambia** — salvo que D-1 se resuelva como (a), que sí
  añadiría aristas hacia `ARCHIVED`.
- **`archive()` sigue siendo del dueño.** Se le **añade** el camino de staff, no se le quita
  el suyo.
- **La cuota y la puerta de validación** no participan: borrar libera plaza por construcción
  (la fila desaparece del `count`), sin tocar ninguna regla.

---

## 5. Bloque 5 — El plan de ráfagas

Cuatro, en este orden. El criterio: **primero lo que deja el sistema consistente, después lo
que lo deja limpio.** Cada una es desplegable por sí sola.

| # | Ráfaga | Qué entra | Por qué aquí |
|---|---|---|---|
| **B1** | **Los registros dejan de morir** | `Report` y `Conversation` → nullable + `SetNull` + snapshot, escrito **al crear**. Backfill de los existentes. La bandeja tolera `listing: null` | **Va primero, y es lo importante.** Es el arreglo de una pérdida de datos que ocurre **hoy**, con el borrado actual. Si sólo se hiciera una ráfaga de este cuerpo, sería ésta |
| **B2** | **La política de permisos** | Quitar el borrado al dueño (+ D-1); `DELETE /admin/listings/:id` para staff, con guarda de `ARCHIVED`, `AuditLog` y `@MinRole`; botón de archivar para staff. UI: retirar «Eliminar» del menú del dueño, añadirlo al backoffice con su `AlertDialog` | Ya sobre B1: cuando el staff empiece a borrar, los reportes y las conversaciones **ya** sobreviven. Al revés, cada borrado de las primeras semanas destruiría evidencia |
| **B3** | **La limpieza de R2** | La cola nueva + el helper único de derivación de la clave de miniatura + el enganche desde el borrado | Es **basura, no corrupción** (§3.1), así que puede ir después sin riesgo. Separarla también la deja lista para reutilizarse |
| **B4** | *(opcional)* **La deuda de huérfanos** | Recolección de lo ya acumulado: imágenes de wizards abandonados, adjuntos de ticket, vídeos sin confirmar | Es la deuda de `pendientes.md`, no P5. Con B3 hecha, es un comando que reutiliza la misma cola. **Decisión aparte** (D-5) |

**Reparto backend/UI:** B1 es 100 % backend + un retoque de la bandeja. B2 es backend + dos
cambios de UI (quitar uno, añadir otro). B3 es 100 % backend. La UI total del cuerpo son tres
sitios.

**Qué necesita Playwright:** que el dueño **ya no vea** «Eliminar»; que el staff lo vea **sólo
en archivados** y con su confirmación; y —el que de verdad importa— que **tras eliminar un
anuncio con reportes y conversaciones, ambos sigan ahí** y la bandeja se pinte sin enlace. Ese
último es el test que justifica el cuerpo entero.

**Qué necesita backend (Jest):** la guarda de estado (borrar un `ACTIVE` → 400); el rol; que
`AuditLog` registre con su `before`; y **un test de inventario**: crear un anuncio con las
trece relaciones pobladas, borrarlo, y afirmar **una por una** cuáles desaparecieron y cuáles
no. Ese test es la barrera real de este cuerpo — sin él, un `onDelete` cambiado por descuido
en una migración futura vuelve a destruir denuncias en silencio.

---

## 6. Riesgos y decisiones abiertas

### 6.1 Decisiones que necesitan tu visto bueno

| # | Decisión | Recomendación |
|---|---|---|
| **D-1** | Los `DRAFT` se quedan sin salida al quitar el borrado del usuario (§1.2) | **(b) «Descartar» sólo para `DRAFT`**, con nombre propio en código y UI. Un borrador no tiene historia pública que proteger, y llamarlo distinto evita que se lea como una excepción a la política. Alternativa: (a) ampliar `ARCHIVABLE_STATUSES` |
| **D-2** | ¿Puede el usuario retirar un `PENDING_REVIEW`? Hoy no, y con D-1(b) tampoco | **Dejarlo fuera de este cuerpo.** Hay trabajo de un moderador encolado; retirarlo por debajo es una decisión de la cola de moderación, no del borrado |
| **D-3** | ¿`Conversation` PRESERVA (recomendado) o sigue Cascade? | **Preservar** (§2.5). Es el argumento más fuerte del documento y también el cambio más caro |
| **D-4** | ¿Eliminar es de MODERATOR o de ADMIN? | **ADMIN.** Es la única acción **irreversible y destructiva** del backoffice sobre un anuncio; el resto son reversibles. Con el reparto de R2 un MODERATOR ya archiva, que es la parte del trabajo diario. Precedente exacto: el borrado físico de un post del blog es ADMIN-only teniendo el resto abierto a EDITOR |
| **D-5** | ¿Se recolectan los huérfanos de R2 ya existentes (B4)? | **Sí, pero aparte.** Es la deuda de `pendientes.md`, y mezclarla con P5 confunde «evitar basura nueva» con «limpiar la vieja» |

### 6.2 Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | **B2 sin B1** destruiría evidencia en cada borrado de staff | El orden de §5 es un requisito, no una preferencia |
| 2 | La regla de la clave de miniatura queda en **dos** sitios y diverge → basura silenciosa | Extraerla a un helper único (molde `cache-keys.ts`) es parte de B3, no un extra |
| 3 | La bandeja revienta con `conv.listing === null` (verificado en `messaging.service.ts`) | Entra en B1, en la misma ráfaga que hace nullable la FK |
| 4 | `@@unique([listingId, buyerId])` se relaja con `NULL` | Aceptado a propósito (§2.5): los hilos huérfanos son históricos |
| 5 | **`Report.reviewId` sigue en `Cascade`**: borrar una valoración destruye sus denuncias | Fuera de alcance (va de reseñas), **pero es el mismo defecto**. Anotado aquí para no perderlo |
| 6 | Las `Notification` de alerta quedan con enlace a un anuncio muerto (404) | Decisión ya tomada y escrita en el schema. Si molesta, es cosa de la vista de notificaciones, no del borrado |
| 7 | Un borrado que falla tras la transacción deja objetos en R2 | Por diseño (§3.1): basura reintentable, no corrupción |
| 8 | El snapshot no cubre lo anterior a la migración | Backfill recomendado en B1, mientras los anuncios aún existen |

### 6.3 Lo que este cuerpo NO hace

- No toca el borrado de usuarios, posts, categorías ni ninguna otra entidad.
- No convierte `remove()` en una transición de estado.
- No añade una papelera ni un «deshacer»: eliminar es irreversible **a propósito**.
- No arregla `Report.reviewId` (riesgo 5) ni recolecta los huérfanos ya existentes (D-5).

---

## Apéndice — inventario verificado

| Qué | Dónde | Dato |
|---|---|---|
| Único borrado de anuncios | [`listings.service.ts:988`](../apps/api/src/modules/listings/listings.service.ts#L988) | 1 sola coincidencia de `prisma.listing.delete` en `apps/api/src` |
| Es del dueño, sin mirar estado | mismo, vía `assertOwnership` | no comprueba `status` |
| Botón del usuario | [`use-listing-actions.tsx:272`](../apps/web/src/components/anuncios/owner/use-listing-actions.tsx#L272) | añadido **sin condición** de estado |
| Archivar | [`listings.service.ts:717`](../apps/api/src/modules/listings/listings.service.ts#L717) | `ARCHIVABLE_STATUSES` = ACTIVE, PAUSED, SOLD, EXPIRED, REJECTED |
| `ARCHIVED` terminal | [`listing-status.transitions.ts`](../apps/api/src/modules/listings/listing-status.transitions.ts) | `ARCHIVED: []` |
| Cuota total | [`listing-limits.ts:62`](../apps/api/src/modules/listing-gate/listing-limits.ts#L62) | cuenta todo **menos** `ARCHIVED`; incluye `DRAFT` |
| FKs a `Listing` | `schema.prisma` | 13: Cascade en ListingTag, ListingImage, Favorite, AlertMatch, ListingViewDaily, Conversation, Report, BumpSchedule; SetNull en Deal, Review, Entitlement, Transaction, Ticket |
| Segundo salto | `schema.prisma` | `Message`→Conversation Cascade · `Deal.conversationId`→SetNull · `BumpRun`→Cascade · `Report.reviewId`→Cascade · `Ticket.{reviewId,reportId}`→SetNull |
| Snapshots existentes (el molde) | `schema.prisma` | `Review.listingTitle`, `Deal.listingTitle`, `Ticket.linkedLabel` — el tercero cita a los dos primeros |
| Ledgers sin FK | `schema.prisma` | `CreditLedger`/`BumpLedger` usan `referenceType`+`referenceId` (texto) |
| Dos objetos por imagen | [`media.service.ts:33`](../apps/api/src/modules/media/media.service.ts#L33) · [`image.processor.ts:35`](../apps/api/src/infra/queue/processors/image.processor.ts#L35) | original `media/<hex><ext>` + miniatura `-thumb.webp`, **clave derivada y no persistida** |
| Borrado en R2 | [`r2.service.ts:52`](../apps/api/src/infra/r2/r2.service.ts#L52) | `delete(key)`; único llamante: `VideoService.deleteObjectByUrl` |
| Meili al borrar | [`indexing.processor.ts:49`](../apps/api/src/infra/queue/processors/indexing.processor.ts#L49) | `case 'remove'` ✔ ya enganchado |
| Redis por anuncio | `cache-keys.ts` | sólo `listing:{slug}` ✔ ya invalidado. `view:dedup:*` se expira solo |
| Molde de borrado por staff | `moderation.service.ts` → `deleteReview` | carga → borra → `AuditLog` con `before` → efectos con la copia en memoria |
| Acciones de auditoría existentes | `moderation.service.ts`, `admin.service.ts` | `LISTING_STATUS_CHANGE`, `_APPROVE`, `_REJECT`, `_DEACTIVATE`, `_RESTORE`, `REVIEW_DELETE` |
| La bandeja necesita el anuncio | [`messaging.service.ts:58`](../apps/api/src/modules/messaging/messaging.service.ts#L58) | usa `conv.listing.id/.title/.slug/.images[0]` sin comprobar null |
| Deuda de huérfanas | [`docs/pendientes.md`](./pendientes.md) | avisa: «si se añade [un borrado], hay que borrar también del bucket» |
