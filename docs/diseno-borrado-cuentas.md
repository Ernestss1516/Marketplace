# Diseño — Archivado y eliminación de cuentas de usuario

> Documento de diseño (2026-08-26). Convierte
> [`docs/auditoria-borrado-cuentas.md`](./auditoria-borrado-cuentas.md) en un plan.
> **Cero código.** No implementa nada: define el modelo, el mapa de tratamiento, la máquina
> de estados, el gate de visibilidad, la operación de eliminación, la exportación y las
> ráfagas.
>
> **La auditoría sigue vigente**: verificado que no hay cambios en `apps/` desde que se
> escribió (`git status` limpio salvo el propio documento; `HEAD` en `0563d27`). Todas sus
> referencias se han vuelto a comprobar en las que este diseño se apoya.
>
> **Las cuatro decisiones de Ernest son el cimiento y no se rediscuten:**
> **D-1** archivar NO anonimiza (reversible); anonimizar sólo al eliminar ·
> **D-3** `ARCHIVED` es valor de `UserStatus` + metadatos `archivedAt`/`archiveReason`/quién ·
> **D-4** ban y suspend se diferencian de verdad (SUSPENDED temporal, BANNED permanente) ·
> **D-5** un solo estado `ARCHIVED`, el origen vive en `archiveReason`.
>
> **El principio rector, en una frase:** *lo que tiene dos dueños nunca se destruye porque
> se vaya uno —se anonimiza—; lo fiscal y la auditoría se conservan; el olvido cubre lo
> personal del que se va. `ARCHIVED` es reversible; eliminar es terminal.*

---

## 0. La idea del diseño, en una página

**Eliminar una cuenta no borra su fila: la vacía de persona.**

Esa frase no es una metáfora, es la arquitectura. La auditoría verificó que
`prisma.user.delete()` está **bloqueado por doce `RESTRICT`, dos libros mayores y un
*trigger* fiscal** (§2.3 de la auditoría), así que la fila **tiene que** sobrevivir. Lo que
el diseño descubre es que eso no es una limitación: **es la solución**.

Porque casi todo lo que muestra el nombre de una persona en este producto lo hace
**a través de la relación con `User`**, pidiendo los mismos cuatro campos. Verificado:

- `SELECT_USER_STUB` en mensajería = `{ id, name, slug, avatarUrl }`
  ([`messaging.service.ts:15-20`](../apps/api/src/modules/messaging/messaging.service.ts#L15))
- `SELECT_AUTHOR` en valoraciones = `{ id, name, slug, avatarUrl }`
  ([`reviews.service.ts:35-40`](../apps/api/src/modules/reviews/reviews.service.ts#L35))
- Y los `select: { id, name, slug }` repartidos por moderación y backoffice.

**Consecuencia:** si al eliminar se sobrescribe `User.name` con «Usuario eliminado»,
`slug` con un identificador neutro y `avatarUrl` con `null`, entonces la bandeja del
comprador, la valoración que recibió un tercero, la cola de moderación y la ficha del
staff **muestran «Usuario eliminado» sin que haya que tocar un solo lector**. La
anonimización se propaga por las mismas claves ajenas que hoy propagan el nombre.

De ahí salen las dos mitades del diseño, y su **asimetría de coste**:

| | **Eliminar** (anonimizar) | **Archivar** (ocultar) |
|---|---|---|
| Qué hace | Vacía la fila de persona | Deja la fila intacta y cierra puertas |
| Lectores que hay que cambiar | **ninguno** — se propaga solo | **los de descubrimiento** — hay que enseñarles a esconder |
| Reversible | **no** (terminal) | **sí** |
| Dónde está el trabajo | En la operación (una vez) | En una capa nueva de visibilidad |

Y de esa asimetría sale el orden de las ráfagas (§9): **lo caro es el archivado, no la
eliminación**, que es justo lo contrario de lo que parecía al empezar.

---

## 1. La tensión de ejes, resuelta

### 1.1 El problema, planteado con precisión

Un anuncio tiene **un** eje de ciclo de vida. Una cuenta tiene **dos** preguntas:

- **¿Está sancionada?** → `ACTIVE` / `SUSPENDED` / `BANNED`
- **¿Existe?** → viva / archivada / vaciada

Y pueden coincidir de verdad. El caso que lo demuestra: **un usuario baneado tiene derecho
a pedir que se le borre.** La sanción no suspende el derecho al olvido. Si `ARCHIVED`
entra en `UserStatus` (D-3), ese usuario pasa a `ARCHIVED` y **el ban desaparece de la
columna**. Si después alguien lo desarchiva, vuelve a `ACTIVE`: **el ban se ha lavado.**

Ése es el estado inválido que hay que hacer irrepresentable. No «SUSPENDED y ARCHIVED a la
vez» —eso ya es imposible con una sola columna—, sino **«desarchivar convierte una sanción
en su ausencia»**.

### 1.2 Las dos formas de resolverlo

**Opción A — Eje separado.** `UserStatus` sólo para la sanción; `archivedAt` como campo
ortogonal que gobierna existencia. Los dos ejes conviven.

- *A favor:* modela la realidad sin pérdidas. Un usuario puede estar baneado **y**
  archivado, y las dos cosas constan.
- *En contra, y es decisivo:* **el gate deja de ser un interruptor**. Los tres puntos de
  entrada verificados (`jwt.strategy.ts:37`, `auth.service.ts:290`, `auth.service.ts:436`)
  pasarían de un `if` sobre una columna a evaluar dos cosas. Y el **gate de visibilidad
  nuevo** (§5), que hay que añadir a cinco superficies que hoy no miran nada, tendría que
  evaluar las dos también. Cada sitio donde se olvide una mitad **falla en silencio y hacia
  el lado peligroso**: la cuenta parece visible. Además el filtro de `/admin/usuarios` —hoy
  `@IsEnum(UserStatus)`
  ([`list-admin-users.dto.ts:17-18`](../apps/api/src/modules/admin/dto/list-admin-users.dto.ts#L17))—
  dejaría de servir para «enséñame los archivados».
- Y contradice el cimiento **D-3**, que dice `ARCHIVED` *dentro* del enum.

**Opción B — Un solo eje, con memoria del anterior. ⭐ ELEGIDA.**

`UserStatus` sigue siendo **una sola columna** y absorbe las dos preguntas. `ARCHIVED`
**reemplaza** a la sanción, y la sanción que había **se guarda en una columna aparte cuyo
único consumidor es el desarchivado**.

```
UserStatus = ACTIVE | SUSPENDED | BANNED | ARCHIVED | DELETED
statusBeforeArchive : UserStatus?   ← memoria, no eje
```

**Por qué `statusBeforeArchive` NO es un segundo eje, y esto es lo que sostiene la
decisión:** se escribe **una vez** (al archivar), se lee **una vez** (al desarchivar) y
**ni el gate ni la visibilidad lo consultan jamás**. No responde «¿qué es esta cuenta?»
—eso lo responde `status`, siempre—; responde «¿a dónde vuelve si la desarchivo?». Es un
**destino de restauración**, no un estado.

El repo tiene el molde exacto de este tipo de columna: `BumpRun.slot`, que es *«el valor
que `BumpSchedule.nextRunAt` TENÍA cuando el turno se reclamó, copiado tal cual. No se
recalcula, no se trunca, no se deriva»*
([`schema.prisma:2088-2103`](../apps/api/prisma/schema.prisma#L2088)). Y `Review.verified`,
congelado al crear y nunca recalculado.

**Qué gana la Opción B, punto por punto:**

| | Resultado |
|---|---|
| Estados inválidos | **Irrepresentables por construcción**: una columna no guarda dos valores |
| Ban lavado | **Cerrado**: desarchivar devuelve a `statusBeforeArchive`, no a `ACTIVE` |
| Gate | **Un `switch` sobre una columna**, en los tres sitios de siempre |
| Visibilidad | **Un predicado compartido** sobre la misma columna (§5) |
| Filtro del backoffice | **Gratis** — el DTO ya acepta cualquier valor del enum |
| Migración | **Aditiva**: `ALTER TYPE ... ADD VALUE`, sin backfill (nadie está archivado) |

### 1.3 Por qué hace falta un QUINTO valor: `DELETED`

Si al eliminar la fila sobrevive (D-2), **necesita un estado**. Dejarla en `ARCHIVED` sería
un error de tres formas a la vez:

1. **El staff no podría distinguir** «archivado, pendiente de revisar» de «ya vaciado». Y
   la lista de archivados es la pantalla entera del encargo.
2. **`desarchivar` tendría que aprender a decir que no** a una cuenta ya vaciada — con un
   `if` que se puede olvidar. Con `DELETED` en el enum, **no está en la tabla de
   transiciones y se rechaza por construcción**.
3. **Se perdería el estado terminal.** Y el molde de anuncios exige uno.

Con `DELETED`, el molde se recupera entero — sólo que **un paso más allá** de donde está en
los anuncios:

| | Anuncios | Cuentas |
|---|---|---|
| Estado reversible de ocultación | *(no existe: `ARCHIVED` es terminal)* | **`ARCHIVED`** |
| Estado terminal | **`ARCHIVED`** | **`DELETED`** |
| Cómo se llega al terminal | `DELETE` destruye la fila | La operación vacía la fila |

### 1.4 La divergencia deliberada: `ARCHIVED` de cuenta **sí** es reversible

`ListingStatus.ARCHIVED` es terminal, y este diseño **no lo copia**. La razón no es
comodidad:

> Para un **anuncio**, archivado es el final porque no hay nada a lo que volver: nadie
> mantiene una relación con un anuncio retirado. Para una **cuenta**, archivado es una
> **pausa sobre la existencia**: hay facturas, reputación, hilos abiertos y, sobre todo,
> una persona que puede cambiar de opinión o a la que el staff pudo archivar por error.
> **El final de una cuenta no es estar archivada: es estar vaciada.**

Y hay un argumento de simetría de permisos que lo confirma (§4.3): archivar es **MODERATOR**
porque es reversible; si no lo fuera, tendría que ser ADMIN — y entonces el staff no podría
hacer el trabajo del día a día, que es exactamente el reparto que el borrado de anuncios
razonó y dejó escrito
([`admin.controller.ts:134-140`](../apps/api/src/modules/admin/admin.controller.ts#L134)).

### 1.5 Una propiedad que sale gratis, y conviene notarla

**Un `BANNED` no puede auto-archivarse**: no puede entrar (el gate lo rechaza en los tres
sitios), así que no puede pulsar nada en `/perfil`. La transición `BANNED → ARCHIVED`
**sólo puede ejecutarla el staff**. Eso no cierra el derecho —un baneado escribe a soporte
y el staff archiva por él—, y por eso `archiveReason` (**por qué**) y `archivedById`
(**quién lo ejecutó**) son **dos columnas distintas**: una petición del usuario ejecutada
por el staff es `SELF_REQUEST` con `archivedById` poblado. Sin esa separación, ese caso
—que es el caso real del derecho al olvido de un sancionado— no se podría representar.

---

## 2. El modelo de datos

### 2.1 Enums

```prisma
enum UserStatus {
  ACTIVE
  SUSPENDED   // sanción TEMPORAL — con caducidad opcional (D-4)
  BANNED      // sanción PERMANENTE
  ARCHIVED    // la cuenta ya no existe para su dueño. REVERSIBLE. No anonimiza.
  DELETED     // vaciada de persona. TERMINAL.
}

enum ArchiveReason {
  SELF_REQUEST   // lo pidió el usuario (lo ejecute él o el staff en su nombre)
  STAFF_ACTION   // decisión de la plataforma
}
```

`ArchiveReason` es un **enum y no texto libre** por el mismo motivo que
`BumpScheduleStatus`: *«LA RAZÓN DETERMINA LA SALIDA»*
([`schema.prisma:1975-1980`](../apps/api/prisma/schema.prisma#L1975)). Aquí determina el
plazo antes de poder eliminar y qué se hace con la IP (§6.6). El *porqué* narrativo va
aparte, en `archiveNote`.

### 2.2 Columnas nuevas en `User`

| Columna | Tipo | Para qué | Molde del repo |
|---|---|---|---|
| `suspendedUntil` | `DateTime?` | Fin de la suspensión. `null` = indefinida (comportamiento actual, sin backfill) | `User.lockedUntil` · `Entitlement.expiresAt` |
| `archivedAt` | `DateTime?` | Cuándo | `Review.retiredAt` · `Ticket.closedAt` |
| `archiveReason` | `ArchiveReason?` | Por qué (categoría) | `BumpScheduleStatus` |
| `archivedById` | `String?` → `User` **SetNull** | Quién lo ejecutó. `null` = el propio usuario | `Review.retiredById` · `Ticket.closedById` |
| `archiveNote` | `String? @db.Text` | El porqué narrativo | `Review.retiredReason` |
| `statusBeforeArchive` | `UserStatus?` | Destino de restauración (§1.2) | `BumpRun.slot` |
| `deletedAt` | `DateTime?` | Cuándo se vació | `Review.retiredAt` |

Todas **nullable, aditivas, sin backfill**: nacen `null` para las filas existentes, que
siguen comportándose exactamente igual. Es el criterio que el repo aplica en cada
migración.

**Índice:** `@@index([status])` **ya existe**
([`schema.prisma:440`](../apps/api/prisma/schema.prisma#L440)) y cubre «enséñame los
archivados». Para ordenar la cola de revisión por antigüedad haría falta
`@@index([status, archivedAt])`; **se añade sólo si la consulta lo pide**, con el criterio
que E2/F2 dejaron escrito (se mide con `EXPLAIN` antes de añadirlo).

### 2.3 Columna nueva en `Listing`

| Columna | Tipo | Para qué |
|---|---|---|
| `pausedByAccountArchive` | `Boolean @default(false)` | Marca los anuncios que pausó **el archivado de la cuenta**, para que el desarchivado devuelva **sólo ésos** y no los que el vendedor había pausado por su cuenta |

Es un **marcador de origen**, no una copia de estado: sólo hay un destino posible al
restaurar (`ACTIVE`), así que un booleano basta. Molde: `Entitlement.origin` y
`BumpRun.paidWith` — registrar *por qué* pasó algo para poder revertirlo selectivamente.

### 2.4 Las claves ajenas peligrosas: `Cascade` → `Restrict`

**Ocho relaciones cambian.** Ninguna toca datos: es una migración declarativa.

| Relación | Hoy | Pasa a | Por qué |
|---|---|---|---|
| `Review.authorId` | Cascade | **Restrict** | Destruiría **la reputación de terceros** |
| `Review.targetId` | Cascade | **Restrict** | Destruiría el testimonio de sus autores |
| `Deal.sellerId` | Cascade | **Restrict** | Es la **evidencia** de `Review.verified` |
| `Deal.buyerId` | Cascade | **Restrict** | Ídem |
| `Ticket.userId` | Cascade | **Restrict** | El hilo tiene dos lados |
| `Entitlement.userId` | Cascade | **Restrict** | *«Nunca se borra una fila de esta tabla»* ([`schema.prisma:1629`](../apps/api/prisma/schema.prisma#L1629)) |
| `CouponRedemption.userId` | Cascade | **Restrict** | *«NUNCA se borra ni se modifica»* ([`schema.prisma:2233`](../apps/api/prisma/schema.prisma#L2233)) |
| `Wallet.userId` | Cascade | **Restrict** | Ya estaba bloqueado de hecho por los ledgers: **se declara en vez de depender del accidente** |

**Tres argumentos, y el tercero es el que decide.**

1. **Resuelve las contradicciones schema-vs-comentario** que la auditoría encontró
   (D-10/D-11): `Entitlement` y `CouponRedemption` decían por escrito que nunca se borran y
   tenían la constraint contraria. Ahora dicen lo mismo en los dos sitios.

2. **Cada una es la excepción entre sus propias hermanas.** Verificado uno a uno:
   `Conversation.buyerId`, `Conversation.sellerId`, `Message.senderId`,
   `Report.reporterId`, `Ticket.openedById`, `TicketMessage.authorId` **ya son `Restrict`**.
   `Review.author` y `Ticket.user` son las raras de su propio modelo — `Ticket.userId` es
   `Cascade` mientras `TicketMessage.authorId` es `Restrict`, **dentro de la misma
   migración**. No es una decisión que alguien tomara; es un valor que nadie revisó, que es
   literalmente lo que B1 dijo de `Report.listingId`.

3. **«Neutralizado» no es «resuelto», y el repo ya falló esto por escrito.** Alguien podrá
   objetar que, como la fila de `User` nunca se borra, los `Cascade` no llegan a
   dispararse. Ese argumento exacto se probó ya con `Report.reviewId`, y el schema anotó
   cómo salió:

   > *«7b lo NEUTRALIZÓ sin resolverlo: quitó el único camino que borraba valoraciones en
   > vivo, así que con la fila siempre viva el `Cascade` no llegaba a dispararse. Pero la
   > regla seguía ahí, **armada para el siguiente**: una purga RGPD, un `deleteMany` de
   > mantenimiento o **una cascada de usuario** volvían a destruir denuncias en silencio.»*
   > — [`schema.prisma:1403-1410`](../apps/api/prisma/schema.prisma#L1403)

   El schema **nombra por adelantado el escenario de este documento**. Dejar los `Cascade`
   dormidos sería repetir el error que el propio repo documentó y corrigió.

**Por qué `Restrict` y no `SetNull`.** Los seis campos son `NOT NULL`. Hacerlos nullables
obligaría a **todos** sus lectores a tratar un `null` para un caso que, con este diseño, no
puede ocurrir nunca — coste permanente por una posibilidad inexistente. `Restrict` declara
el invariante correcto: **estas filas no pueden quedarse huérfanas de persona**. Y de paso
convierte «la fila de `User` sobrevive» en algo que garantiza **Postgres**, no la
disciplina de quien escriba el próximo servicio.

**Lo que NO cambia:** los `Cascade` de un solo dueño (`Listing`, `Favorite`, `Notification`,
`Alert`, `Account`, `VerificationToken`, `PasswordResetToken`, `BumpSchedule`) se quedan.
Nunca se dispararán, pero **documentan la propiedad** —«esto es suyo y de nadie más»—, que
es información útil y gratuita.

### 2.5 Snapshots

**(a) El que hay que AÑADIR — escrito al crear, nunca al borrar:**

| Columna | Modelo | Por qué |
|---|---|---|
| `reportedUserName` | `Report` | Tras anonimizar, la cola de moderación diría *«denuncia contra Usuario eliminado»* y **perdería a quién se denunció**. Molde exacto: `Report.listingTitle`, `Report.reviewAuthorName`, `Deal.listingTitle`, `Ticket.linkedLabel` |

**Se escribe al CREAR la denuncia**, por las dos razones que `diseno-borrado.md` §3.3 dejó
escritas: rellenarlo en la operación de borrado sería una escritura de N filas dentro de la
transacción, y sería un camino **que sólo se ejecuta ahí, o sea que sólo se prueba ahí**.

*No se añaden más.* `Report.reporterName` se evaluó y **se descarta**: la denuncia sigue
siendo accionable sin saber quién la puso (el `reporterId` sigue ahí para correlacionar), y
congelar el nombre del denunciante multiplica las copias de datos personales sin resolver
ningún problema real.

**(b) Los que hay que FREGAR — copias congeladas que la anonimización por FK no alcanza.**
Ésta es la lista que se olvida. Barrida completa del schema:

| Dónde | Qué guarda | Acción |
|---|---|---|
| `Report.reviewAuthorName` | El **nombre** del autor de una valoración denunciada | **Sobrescribir** al eliminar |
| Documentos de Meilisearch | `sellerName`, `sellerSlug`, `sellerAvatarUrl` congelados ([`search.service.ts:53-57`](../apps/api/src/modules/search/search.service.ts#L53)) | **Se resuelve solo**: los anuncios salen del índice al pausarse/archivarse (§4.4) |
| `Invoice.receiver*` | Datos fiscales congelados | **CONSERVAR** — es el documento fiscal |
| `AuditLog.before/after` | Estados anteriores, con datos personales | **CONSERVAR** — es el rastro |
| `Conversation.listingTitle`, `Deal.listingTitle`, `Review.listingTitle`, `Report.listingTitle`, `Ticket.linkedLabel` | Títulos de anuncio | Nada: no son datos personales |
| `Notification.data` | Snapshots autocontenidos | Forma verificada de `ALERT_MATCH` = `{alertId, alertName, listingId, listingSlug, listingTitle}` — **sin nombres de usuario**. Nada que fregar |

**Que la lista (b) sea tan corta es el resultado del §0**: como casi todo lee el nombre por
la relación, casi nada lo tiene congelado.

---

## 3. El mapa final de tratamiento — las 34 relaciones, en los dos momentos

**Dos momentos distintos, y ésa es la lectura de la tabla (D-1):** archivar oculta y no
toca nada personal; eliminar vacía. La columna «Tratamiento» es la clasificación de Ernest;
las dos siguientes dicen qué pasa en cada momento.

### 3.1 ARCHIVAR — sólo del usuario

| Relación | Tratamiento | Al **archivar** | Al **eliminar** |
|---|---|---|---|
| `Listing.sellerId` | ARCHIVAR | `ACTIVE`/`RESERVED` → **`PAUSED`** con marca (§4.4) | → `ARCHIVED` → **borrado por la vía existente** (§6.4) |
| `ListingImage.uploadedById` | ARCHIVAR | intacto | muere con el anuncio; **R2 limpiado** por `mediaCleanupQueue` |
| `Favorite.userId` | ARCHIVAR | intacto (inaccesible) | **borrar** — no significa nada para nadie |
| `Notification.userId` | ARCHIVAR | intacto; **dejan de generarse** (§4.5) | **borrar** — buzón privado |
| `Alert.userId` (+`AlertMatch`) | ARCHIVAR | intacto; **el matching deja de considerarlas** (§4.5) | **borrar** |
| `Account.userId` | ARCHIVAR | intacto — el gate ya bloquea, desvincular no añade nada (**cierra D-f**) | **borrar** — es una credencial |
| `VerificationToken` / `PasswordResetToken` | ARCHIVAR | **invalidar** (§4.5) | **borrar** |
| `BumpSchedule.userId` (+`BumpRun`) | ARCHIVAR | **se para solo** (§4.5) | **borrar la programación**; `BumpRun` cae con ella |

### 3.2 ANONIMIZAR — dos dueños

**Todas comparten mecanismo: no se tocan.** Se anonimizan **por propagación** al vaciar la
fila de `User` (§0). La columna «Al eliminar» dice qué ve el otro dueño después.

| Relación | Al **archivar** | Al **eliminar** — lo que ve el otro |
|---|---|---|
| `Conversation.buyerId` / `.sellerId` | intacto y **legible para el otro** (§5.3) | el hilo entero, con «Usuario eliminado» |
| `Message.senderId` | intacto | los mensajes, con autor «Usuario eliminado» |
| `Review.authorId` | intacto | su valoración sigue contando para la media del tercero, firmada «Usuario eliminado» |
| `Review.targetId` | intacto (oculto con el perfil) | **se conserva** — ver §3.5 (D-7) |
| `Deal.sellerId` / `.buyerId` | intacto | el trato sigue siendo evidencia de `Review.verified` |
| `Report.reporterId` | intacto | la denuncia sigue viva y accionable |
| `Report.reportedUserId` | intacto | la denuncia sobrevive **legible** gracias a `reportedUserName` (§2.5a) |
| `Ticket.userId` / `.openedById` | intacto | el historial de soporte se conserva |
| `TicketMessage.authorId` | intacto | los mensajes se conservan; **los `internal` siguen sin salir** |
| `TicketAttachment` | intacto | **fila conservada; objeto de R2 purgado** (contenido personal) |

### 3.3 CONSERVAR — obligación legal y rastro

**Ni al archivar ni al eliminar se toca ninguna.**

| Relación | Por qué |
|---|---|
| `Invoice.userId` | Documento fiscal. `Restrict` **+** *trigger* `BEFORE UPDATE/DELETE`. El receptor va congelado dentro, así que **sobrevive legible sin la persona** |
| `InvoiceLine` | Ídem, mismo *trigger* |
| `Transaction.userId` | *«Registro permanente de cada cobro. NUNCA se borra»* |
| `Subscription.userId` | Sostiene `Transaction` y `Entitlement`. **Ojo: hay que cancelarla en la pasarela** (§6.5) |
| `CreditLedger` / `BumpLedger` | Libro mayor. Sostienen `balance == SUM(amount)` |
| `AuditLog.actorId` | Rastro de seguridad. Un miembro del staff **no se lleva lo que hizo** al irse |
| `ContactReply.adminUserId` | Constancia de qué se respondió y quién |
| `AuditLog` **sobre** el usuario (`resourceId`, texto) | Sobrevive por construcción, sin FK. Es el «único superviviente» del molde |
| `CreditLedger.referenceId='User'` | Ídem |

### 3.4 Ya resuelto — staff, `SetNull`

`Report.resolvedById` · `Review.retiredById` · `Ticket.assignedToId` · `Ticket.closedById`.
**No se tocan.** Y el nuevo `User.archivedById` se suma al grupo con el mismo `SetNull`.

### 3.5 Los diez dudosos de la auditoría, cerrados

| # | Dudoso | **Resolución** | Fundamento |
|---|---|---|---|
| **D-a** | Saldo del wallet | **Conservar el libro; poner el saldo a cero con un asiento** `ADMIN_DEBIT` («cierre de cuenta») **al eliminar**. Al archivar, no se toca | Es la única forma de cerrar sin romper `balance == SUM(ledger)`. **Si se devuelve dinero o no es decisión de producto** → §10 |
| **D-b** | `Entitlement` | **CONSERVAR revocando** (`revokedAt = now`) al eliminar. FK → `Restrict` | El schema ya lo dice: *«la revocación es el mecanismo de cierre»* |
| **D-c** | `CouponRedemption` | **CONSERVAR.** FK → `Restrict` | *«historial permanente de canjes»*. Y borrarlo permitiría **recanjear** el mismo cupón con otra cuenta del mismo correo |
| **D-d** | `Post.authorId` (blog) | **Guarda dura: eliminar se rechaza (400 legible) si el usuario tiene `Post`.** Hay que reasignar antes | Un blog firmado «Usuario eliminado» es peor que cualquier alternativa. Molde exacto: `BlogService.adminDelete`, que precomprueba `footerItems`+`navItems` y da un 400 antes de que reviente la constraint. **A quién se reasigna: producto** → §10 |
| **D-e** | `Review.targetId` (recibidas) | **SE QUEDAN.** Al archivar, ocultas con el perfil; al eliminar, se conservan anonimizado el sujeto | Son **de dos dueños** igual que las escritas: el autor las escribió. Borrarlas destruiría su testimonio y **liberaría el `@@unique([authorId,targetId,listingId])`**, permitiendo reescribirlas. Y dejan de ser alcanzables solas: `listForUser` entra **por `slug`**, y el slug ya no existe |
| **D-f** | `Account` (Google) | **No se desvincula al archivar**; se borra al eliminar | El gate ya bloquea: desvincular no añade seguridad y sí un efecto que habría que deshacer |
| **D-g** | `lastLoginIp` / `lastOwnerIp` | **Al archivar: intactos** (D-1 manda). **Al eliminar: se borran de la fila**, y si `archiveReason = STAFF_ACTION` se **conservan dentro del `before` del `AuditLog`** | Usa el molde del «único superviviente». El caso antifraude retiene la evidencia en la superficie MODERATOR+ que ya es la suya; quien pidió irse, no. **Ernest puede preferir borrar siempre** → §10 |
| **D-h** | `DRAFT`/`PENDING_REVIEW`/`RESERVED` no archivables | **Disuelto**: el archivado de cuenta usa `PAUSED`, no `ARCHIVED` (§4.4) | El callejón sólo existía si había que llevarlos a `ARCHIVED`. `DRAFT` y `PENDING_REVIEW` **no son públicos** (ni indexados ni visibles), así que no hay nada que ocultar |
| **D-i** | `Notification.data` ajena | **Nada que hacer** | Barrido verificado (§2.5b): el `data` de `ALERT_MATCH` no lleva nombres de usuario |
| **D-j** | `Report.reportedUserName` | **Se añade**, escrito al crear (§2.5a) | Molde de B1 |

---

## 4. La máquina de estados

### 4.1 El grafo

Fichero propio `user-status.transitions.ts`, **molde literal** de
[`listing-status.transitions.ts`](../apps/api/src/modules/listings/listing-status.transitions.ts):
tabla de constantes, fichero puro sin DI, con `isLegalTransition` y
`describeIllegalTransition` (un 400 que dice **a qué sí** se puede pasar, no sólo que no).

```
ACTIVE     → SUSPENDED · BANNED · ARCHIVED
SUSPENDED  → ACTIVE · BANNED · ARCHIVED
BANNED     → ACTIVE · ARCHIVED
ARCHIVED   → ACTIVE · SUSPENDED · BANNED   (sólo vía desarchivar → statusBeforeArchive)
           → DELETED
DELETED    → ∅                              TERMINAL
```

**Las tres aristas que NO existen, y por qué:**

- **`DELETED` → cualquier cosa.** Terminal. La fila está vaciada: no hay persona a la que
  devolver la cuenta.
- **`ARCHIVED` → `ACTIVE`/`SUSPENDED`/`BANNED` a mano.** Sólo se llega por `unarchive()`,
  que **no elige destino**: lo lee de `statusBeforeArchive`. Que las tres aparezcan en la
  tabla es porque son alcanzables; que no se puedan pedir es cosa del método.
- **`ACTIVE`/`SUSPENDED`/`BANNED` → `DELETED`.** **Los dos pasos son la salvaguarda**, igual
  que en anuncios: para vaciar una cuenta hay que archivarla primero. Ese segundo clic
  separa «cerrarla» de «vaciarla».

### 4.2 Los invariantes de los metadatos

Cada columna tiene sentido en **un solo** estado, y las transiciones lo mantienen:

| Columna | Vive con | Se limpia al |
|---|---|---|
| `suspendedUntil` | `SUSPENDED` | salir de `SUSPENDED` (cualquier destino) |
| `archivedAt`, `archiveReason`, `archivedById`, `archiveNote`, `statusBeforeArchive` | `ARCHIVED` | **desarchivar** |
| `deletedAt` | `DELETED` | nunca (terminal) |

**Excepción deliberada:** al pasar de `ARCHIVED` a `DELETED`, los metadatos de archivado
**se conservan**. Son el contexto de por qué se vació, y `DELETED` es terminal: nadie los va
a reutilizar mal.

### 4.3 Quién puede qué

| Acción | Rol | Reversible | `AuditLog.action` |
|---|---|---|---|
| Auto-archivar | **el propio usuario** (`/perfil`) | sí | `USER_ARCHIVE` (`archivedById` null) |
| Archivar a otro | **MODERATOR+** | sí | `USER_ARCHIVE` |
| **Desarchivar** | **MODERATOR+** | — | `USER_UNARCHIVE` |
| Suspender / des-suspender | **MODERATOR+** *(ya existe)* | sí | `USER_SUSPEND` / `USER_UNSUSPEND` |
| Banear / reinstaurar | **ADMIN** *(ya existe)* | sí | `USER_BAN` / `USER_REINSTATE` |
| **Eliminar definitivamente** | **ADMIN** | **NO** | `USER_DELETE` |
| Exportar lo propio | el usuario | — | *(sin auditoría: es su dato)* |
| Exportar de otro | **ADMIN** (§7.4) | — | `USER_EXPORT` |

**El criterio, cerrando D-19:** *MODERATOR hace lo reversible, ADMIN lo irreversible.* Es
literalmente el reparto que el borrado de anuncios razonó y dejó escrito, y encaja sin
tocar nada con la asimetría que **ya existe** entre suspender (MODERATOR) y banear (ADMIN).

**Dos guardas duras antes de eliminar**, ambas con 400 legible y precomprobado (molde
`BlogService.adminDelete`):

1. **`role !== USER` → rechazo.** Vaciar una cuenta de staff convertiría su rastro de
   auditoría en *«Usuario eliminado aprobó este anuncio»*, degradando el registro que
   `AuditLog.actorId` existe para sostener. Hay que degradar el rol primero — cosa que el
   backoffice ya sabe hacer.
2. **Tiene `Post` → rechazo.** Ver D-d.

### 4.4 Qué le pasa a los anuncios al archivar la cuenta — y por qué `PAUSED`

**La decisión:** archivar una cuenta lleva sus anuncios `ACTIVE` y `RESERVED` a **`PAUSED`**,
no a `ARCHIVED`.

`PAUSED` **es exactamente lo que hace falta**, y lo dice el propio schema:

> *«temporal, **reactivable (PAUSED → ACTIVE)**, ambos tipos. **Ni cuenta para la cuota de
> activos ni se indexa**.»* — [`schema.prisma:61-66`](../apps/api/prisma/schema.prisma#L61)

Tres propiedades que el archivado necesita, ya construidas y probadas:

1. **Sale del índice y de la caché** por el camino de siempre — cero código de visibilidad
   nuevo para los anuncios.
2. **Es reversible**, y `ACTIVE → PAUSED` y `PAUSED → ACTIVE` **ya son transiciones legales**.
3. **Libera la cuota**, que es lo correcto mientras la cuenta no existe.

**Por qué NO `ARCHIVED`:** es terminal por diseño en dos capas. Usarlo obligaría a abrir un
agujero en una irreversibilidad que se construyó a propósito — y a inventar una columna que
recordara el estado previo de cada anuncio. `PAUSED` no necesita nada de eso: sólo el
marcador booleano de §2.3.

**Lo que queda igual al archivar:**

| Estado | Qué se hace | Por qué |
|---|---|---|
| `DRAFT`, `PENDING_REVIEW` | **nada** | No son públicos: ni indexados, ni visibles, ni enlazables. No hay nada que ocultar — **y aquí se disuelve D-13** |
| `SOLD`, `EXPIRED`, `REJECTED`, `ARCHIVED` | **nada** | Ya están fuera del escaparate |
| `ACTIVE` | → `PAUSED` + marca | Es lo que se ve |
| `RESERVED` | → `PAUSED` + marca — **requiere una arista nueva** | Ver abajo |

**`RESERVED → PAUSED` no es legal hoy** (`RESERVED: ['ACTIVE','SOLD','REJECTED','DRAFT']`).
**Se añade**, y el argumento es honesto: una reserva es un compromiso con **otra persona**,
y el vendedor se acaba de ir — la reserva **no puede prosperar**, y dejarla visible sostiene
una promesa que ya no existe. Que desaparezca es la información verdadera. *(Avisar al
comprador es deseable y queda anotado en §10: la reserva la ve una persona concreta.)*

**Al desarchivar:** los `PAUSED` **con la marca** vuelven a `ACTIVE`; los demás no se tocan.
La reactivación **pasa por la misma puerta de cuota que `reactivate()`** —el usuario pudo
perder Pro mientras estaba archivado— y **lo que no quepa se queda `PAUSED`**, con aviso.
Reactivar saltándose el cupo sería un agujero en la cuota abierto por una operación de otro
dominio.

**Al eliminar:** los anuncios pasan a `ARCHIVED` y **se eliminan por la vía existente**
(§6.4).

### 4.5 Lo que hay que apagar al archivar — y lo que se apaga solo

| Qué | Riesgo si no se toca | Solución |
|---|---|---|
| **`BumpSchedule`** | **Gasta dinero** de una cuenta que no existe | **Se apaga solo**: `BumpScheduleStatus.PAUSED_LISTING_INACTIVE` está diseñado para «el anuncio dejó de estar ACTIVE», con **reanudación automática al volver a ACTIVE** ([`schema.prisma:1991-1993`](../apps/api/prisma/schema.prisma#L1991)). Pausar los anuncios lo dispara. El turno intermedio sale `SKIPPED_LISTING_INACTIVE` — **sin cobro**. **Cero código** |
| **`Alert`** | Trabajo de matching para un fantasma | **Una condición de cuenta en la consulta del matching** ([`alert-matching.service.ts:43-45`](../apps/api/src/modules/alerts/alert-matching.service.ts#L43)), que hoy filtra `active: true` y no mira al usuario. **Mejor que apagar las alertas una a una**: no hay estado que restaurar al desarchivar |
| **`Notification`** | Se acumulan sin leerse | Se resuelve con lo anterior (la fuente principal es `ALERT_MATCH`) |
| **Tokens de verificación y de reseteo** | Un enlace vivo hacia una cuenta cerrada | **Invalidar** los pendientes. Y `tokenVersion + 1`, que **mata todas las sesiones al instante** por el molde ya usado en `resetPassword` y el cambio de rol |
| **`Subscription` activa** | **Se le sigue cobrando la tarjeta** | **Cancelar en la pasarela.** Al archivar: al final del periodo (`cancelAtPeriodEnd`). Al eliminar: inmediata. Ver §6.5 — **es el efecto externo más peligroso de todo el cuerpo** |

### 4.6 La caducidad de `SUSPENDED` (D-4)

**Dos mitades, y el repo tiene el molde de las dos.**

**1) Perezosa, en el gate.** `SUSPENDED` con `suspendedUntil` pasado **se trata como
`ACTIVE`** en el momento de evaluar. Un predicado compartido —molde `activeFilter()`
([`entitlement.service.ts:11-17`](../apps/api/src/modules/billing/entitlement.service.ts#L11))—
que dice: `status !== SUSPENDED || suspendedUntil == null || suspendedUntil > now`.
Precedente directo en el mismo fichero de auth: `lockedUntil`, que se evalúa así, **sin
cron ni escritura**, en el login
([`auth.service.ts:280-282`](../apps/api/src/modules/auth/auth.service.ts#L280)).

*Por qué perezosa y no una escritura en el gate:* `JwtStrategy.validate` corre en **cada
petición autenticada**. Meter ahí un `UPDATE` condicional pondría una escritura en el camino
más caliente de la aplicación.

**2) Un cron que lo materializa.** Diario, molde exacto de
`EntitlementExpirationService` (`@Cron('0 3 * * *')`): pasa a `ACTIVE` las suspensiones
vencidas y **deja constancia en `AuditLog`**. Sin él, `/admin/usuarios` seguiría mostrando
como suspendida a gente que ya entra — dos verdades distintas, que es exactamente lo que el
cron de entitlements existe para evitar. **Franja:** las de 02:00 a 06:00 están ocupadas
(`02:00` anuncios, `03:00` entitlements, `04:00` facturación, `05:00` tickets, `06:00`
impresiones, `*/15` volcado, `:10` bumps): **`0 7 * * *`** queda libre.

**Compatibilidad, sin backfill:** `suspendedUntil = null` significa **indefinida**, que es
exactamente el comportamiento de hoy. Las suspensiones existentes siguen igual. Lo nuevo es
que el DTO de suspender **acepta una duración**, con un `Setting` para el valor por defecto
(patrón verificado: `prisma.setting.findUnique` + constante por defecto en código, como
`total-listing-limit.rule.ts` y `redsys.service.ts`).

**Y con esto ban y suspend se diferencian de verdad**, en los tres ejes a la vez:

| | `SUSPENDED` | `BANNED` |
|---|---|---|
| Duración | **temporal, con vencimiento** | permanente |
| Quién la pone y la quita | MODERATOR | ADMIN |
| Contenido público | **sigue visible** (§5.2) | **se oculta** |

---

## 5. El gate de visibilidad (D-6) — la capa nueva

### 5.1 De qué se parte

Verificado en la auditoría: **ninguna superficie pública mira `User.status`.** Sólo cuatro
ficheros del backend mencionan `BANNED`/`SUSPENDED`, y los cuatro son de auth o admin.
Hoy, el perfil y los anuncios activos de un baneado **siguen públicos e indexados**. Esto
no es replicar un molde: **es construir algo que no existe**.

### 5.2 La regla: escaparate vs historial

> **Una cuenta oculta desaparece del ESCAPARATE, no de TU HISTORIAL.**
>
> - **Descubrimiento** (dónde la gente **encuentra** a alguien): perfil público, buscador de
>   usuarios, listado de anuncios del vendedor, índice de búsqueda. → **se cierra**.
> - **Relación** (dónde alguien ya tiene trato con esa persona): el hilo de mensajes en el
>   que participas, la valoración que recibiste, el trato que cerraste, la denuncia que
>   pusiste. → **se conserva**.

**Por qué la línea va ahí.** Ocultar el historial no protegería a nadie: el comprador ya
leyó esos mensajes y puede volver a leerlos. Lo que sí haría es **destruir el lado del
otro**, que es exactamente lo que el principio rector prohíbe. Y es el mismo razonamiento
que el schema usó para justificar guardar un teléfono detectado: *«NO es una divulgación
nueva … esto es un índice a texto ya público»*
([`schema.prisma:938-941`](../apps/api/prisma/schema.prisma#L938)).

### 5.3 El predicado, y dónde se aplica

**Una sola constante compartida**, no cinco copias del filtro. El molde está escrito y
razonado en el repo:

> *«Escribir `retiredAt: null` cinco veces es cinco ocasiones de olvidarlo una, y el olvido
> no se ve: la pantalla funciona, sólo que la reputación de alguien sigue arrastrando lo que
> el equipo retiró.»* — `VIGENTES` en
> [`reviews.service.ts:25-33`](../apps/api/src/modules/reviews/reviews.service.ts#L25)

```
CUENTA_EN_ESCAPARATE = { status: { in: [ACTIVE, SUSPENDED] } }
```

**`SUSPENDED` sí está en el escaparate, y es deliberado.** Con D-4 la suspensión es
**temporal**: esconder y volver a mostrar en unos días haría entrar y salir del índice a
todos sus anuncios por una sanción que caduca sola. `BANNED`, `ARCHIVED` y `DELETED` son
permanentes o indefinidos, y ahí sí compensa. **Esto cierra la nota de D-6: sí, `ARCHIVED`
y el ban comparten el gate de identidad** — y arreglar el hueco del baneado sale gratis.

| Superficie | Hoy | Con el gate |
|---|---|---|
| `GET /users/:slug` — perfil público ([`users.service.ts:177`](../apps/api/src/modules/users/users.service.ts#L177)) | se sirve siempre | **404**, el mismo que un slug inexistente. No se inventa una ficha de «no disponible»: eso confirmaría que la cuenta existe |
| `GET /users/:slug/listings` ([`listings.service.ts:1295`](../apps/api/src/modules/listings/listings.service.ts#L1295)) | filtra `ACTIVE`, no mira al vendedor | **404** por coherencia con el perfil |
| `GET /users/:slug/reviews` ([`reviews.service.ts:134`](../apps/api/src/modules/reviews/reviews.service.ts#L134)) | entra por slug | **404** — ya resuelve por `findUnique({where:{slug}})`, así que es el mismo sitio |
| `GET /users/search` ([`users.service.ts:204`](../apps/api/src/modules/users/users.service.ts#L204)) | devuelve a cualquiera | **filtrar** |
| Índice de Meilisearch | contiene sus anuncios | **se resuelve solo** al pausar/archivar los anuncios (§4.4) |
| Alert matching ([`alert-matching.service.ts:43`](../apps/api/src/modules/alerts/alert-matching.service.ts#L43)) | no mira al usuario | **filtrar** (§4.5) |
| **Bandeja, valoraciones recibidas, tratos, denuncias, tickets** | — | **NO se tocan.** Es historial (§5.2) |

**Ficha de anuncio:** no necesita gate propio. Si el vendedor está oculto sus anuncios están
`PAUSED`/`ARCHIVED`, y `findBySlug` **ya exige `status === 'ACTIVE'`**
([`listings.service.ts:1186`](../apps/api/src/modules/listings/listings.service.ts#L1186)).
Un baneado con anuncios activos sí seguiría teniendo ficha — se anota en §10 como el
residuo consciente de no atar el ban al ciclo de vida de los anuncios.

---

## 6. Eliminar definitivamente (D-2) — la supresión selectiva

### 6.1 Qué es y qué no es

**No es** `prisma.user.delete()`: está bloqueado y **debe estarlo** (§2.4). **Es** vaciar la
fila de persona, dejando en pie lo que la ley y los terceros necesitan.

### 6.2 Las guardas, en capas

| Capa | Qué impide |
|---|---|
| `@MinRole(ADMIN)` | Que lo haga quien no debe |
| **Guarda de estado: `ARCHIVED`** | Que se vacíe algo vivo. **Obliga a los dos pasos** |
| Guarda `role === USER` | Degradar el rastro de auditoría (§4.3) |
| Guarda «sin `Post`» | Un blog firmado por nadie (D-d) |
| Plazo mínimo desde `archivedAt` | El arrepentimiento. **Duración: §10** |
| `AlertDialog` en el backoffice | El clic accidental. Regla escrita en `apps/web/CLAUDE.md` |
| `AuditLog` | Que no quede constancia |

### 6.3 El orden — molde de `deleteListing`

**Paso 1 · Cargar antes.** La identidad, `avatarUrl`, `lastLoginIp`, los recuentos de lo
que colgaba y las claves de R2. *Después no habrá de dónde sacarlo* — es el paso que la
gente olvida, y el que `deleteListing` puso primero por eso mismo.

**Paso 2 · Las guardas** (§6.2).

**Paso 3 · Transacción de base de datos.**

1. **Vaciar los escalares de `User`:**

   | Campo | Queda en |
   |---|---|
   | `name` | `'Usuario eliminado'` |
   | `email` | `deleted-<id>@deleted.invalid` — **libera el real** |
   | `slug` | `usuario-eliminado-<id>` — **libera el real** |
   | `phone`, `avatarUrl`, `bio`, `city`, `province`, `postalCode` | `null` |
   | `passwordHash` | `null` — es un secreto, no sobrevive |
   | `tokenVersion` | `+1` — mata cualquier sesión residual |
   | `lastLoginAt`, `lastLoginIp` | `null` (§3.5 D-g) |
   | `fiscal*` (los ocho) | `null` — **las facturas los llevan congelados dentro**, así que borrarlos **no daña la conservación fiscal** |
   | `stripeCustomerId` | **se conserva** — es el puntero que ata los cobros conservados a la pasarela |
   | `status`, `deletedAt` | `DELETED`, `now()` |

   `@deleted.invalid` usa el TLD reservado por RFC 2606: **no puede existir**, así que ningún
   correo saldrá nunca hacia ahí ni por accidente.

2. **Fregar los snapshots congelados** (§2.5b): `Report.reviewAuthorName` de sus
   valoraciones.
3. **Vaciar lo personal que NO cuelga de `User`:** `Listing.phone`, `Listing.phoneNormalized`
   y `Listing.lastOwnerIp` de sus anuncios. **Es el hueco fácil de olvidar**: el teléfono
   publicado es un campo del anuncio, no del perfil, y no se anonimiza por propagación.
4. **Cerrar lo que queda vivo:** `Entitlement` → `revokedAt` (D-b) · `Alert` → borrar ·
   `Favorite`, `Notification`, `Account`, tokens, `BumpSchedule` → borrar · asiento
   `ADMIN_DEBIT` que deja el saldo a cero (D-a).

**Paso 4 · `AuditLog` `USER_DELETE`** con `before` poblado desde la copia en memoria: la
identidad real, el `archiveReason`, y los recuentos de lo que colgaba. **Es lo único que
sobrevive**, y por eso lleva lo justo para responder *«¿quién era esto?»* — no la fila
entera: el `AuditLog` no es una papelera.

**Paso 5 · Efectos externos, fuera de la transacción y sin poder tumbar la operación.** Si
algo de aquí falla, **no se deshace nada**: reintentar una limpieza es trivial, resucitar a
una persona no.

- **Cancelar la suscripción en la pasarela** (§6.5).
- **Encolar la eliminación de los anuncios** (§6.4).
- **Purgar de R2**: el avatar y los adjuntos de ticket. Por `mediaCleanupQueue`, con las
  **claves ya resueltas** y `origen: user:<id>`. Los de anuncio los limpia su propio
  borrado. **`facturas/` NO se toca.**
- Invalidar cachés.

### 6.4 Los anuncios: reutilizar el borrado que ya existe

`ARCHIVED` (legal desde `PAUSED`, `SOLD`, `EXPIRED`, `REJECTED`) y después **`deleteListing`
tal cual**. Se reutiliza entero: la cascada, los `SetNull` **con sus snapshots de B1**
(conversaciones, denuncias, tratos, valoraciones y tickets **sobreviven legibles**), el
`AuditLog` por anuncio, Redis, Meilisearch y la limpieza de R2 con miniaturas derivadas.

**Cero lógica destructiva nueva.** Y el volumen —un vendedor con doscientos anuncios— va
por cola, un trabajo por anuncio, con los reintentos que las colas ya traen.

Los `DRAFT` van por **`discardDraft`**, que es su camino propio y ya limpia su R2.

### 6.5 El efecto externo peligroso: la pasarela

**Una cuenta archivada con Pro activo sigue pagando.** No hay ninguna FK que lo impida y
ningún cron que lo note. Es el riesgo más caro de todo el cuerpo y no estaba en la
auditoría.

- **Al archivar:** `cancelAtPeriodEnd` — la suscripción llega al final del periodo ya
  pagado y no renueva. Coherente con que archivar es reversible: si desarchiva antes del
  corte, se puede deshacer.
- **Al eliminar:** cancelación **inmediata** en la pasarela.
- **`Subscription` y `Transaction` no se borran** (§3.3): cambia el estado, no la historia.
- **Si la llamada a la pasarela falla**, la operación **no se deshace**, pero debe quedar
  registrado y ser reintentable — un cobro de más es dinero real y un usuario enfadado.
  **Va por cola, con reintentos.**

### 6.6 Los identificadores únicos (D-14)

| | **ARCHIVED** | **DELETED** |
|---|---|---|
| `email` | **sigue ocupado** — la fila vive y es reversible | **liberado** |
| `slug` | sigue ocupado | liberado |
| `stripeCustomerId` | sigue | **sigue** (rastro contable) |
| Quien intente registrarse con ese correo | 409 *«Email already registered»* | se registra sin más |

**El caso «archivado» no necesita nada de código, y eso está verificado:** `register` ya
devuelve `ConflictException('Email already registered')` sobre cualquier correo existente
([`auth.service.ts:107-111`](../apps/api/src/modules/auth/auth.service.ts#L107)). Una cuenta
archivada produce **exactamente el mismo mensaje que hoy**: no se abre ninguna fuga nueva de
enumeración, y el camino de vuelta es soporte, que es el correcto (desarchivar es una
decisión de staff, no algo que se dispare escribiendo un correo en un formulario).

### 6.7 `forgotPassword` (D-18)

Hoy no mira el estado: un suspendido, un baneado o —lo que sería peor— **alguien que pidió
irse recibe el correo de recuperación**
([`auth.service.ts:359-374`](../apps/api/src/modules/auth/auth.service.ts#L359)).

**Se cierra en este cuerpo, y sin romper la no-enumerabilidad**: el método **ya devuelve
siempre `{ ok: true }`** y sólo encola el envío cuando procede. Basta con **añadir el estado
a la condición existente**: mismo `select`, misma respuesta, un envío menos. Cero superficie
nueva.

---

## 7. La exportación (D-17)

### 7.1 Formato: **ZIP**

Un JSON no puede llevar **las facturas en PDF**, que son la parte de la exportación con
valor real y práctico. Y sus claves son **privadas** (`Invoice.pdfKey`, *«Clave PRIVADA en
R2 (nunca URL pública)»*), así que un JSON con enlaces sería un JSON con enlaces que no
abren.

```
exportacion-<slug>-<fecha>.zip
├── datos.json          ← todo lo estructurado
├── LEEME.txt           ← qué es cada cosa, en español
└── ficheros/
    ├── avatar.<ext>
    ├── anuncios/<listingId>/<n>.<ext>
    ├── facturas/<numero>.pdf
    └── tickets/<ticketId>/<nombre>
```

### 7.2 Alcance

**Se incluye:** perfil (menos `passwordHash` y `tokenVersion`, que son secretos) · datos
fiscales · anuncios con atributos, tags, fotos, vídeo y estadísticas · **hilos de mensajes
completos** · valoraciones **en las dos direcciones** · tratos · tickets con sus adjuntos ·
facturas, transacciones, suscripciones, entitlements, wallet y los dos libros mayores ·
canjes de cupón · favoritos, alertas, notificaciones · proveedores vinculados ·
`lastLoginAt`/`lastLoginIp` · denuncias **emitidas**.

**Se excluye, y cada exclusión tiene su razón:**

| Qué | Por qué |
|---|---|
| `TicketMessage.internal` | Notas del staff. La invariante ya está puesta en `getForUser`, que filtra `internal: false` **en la propia consulta** |
| **La identidad de quien le denunció** | Es dato de **otra persona**, y revelarla habilita represalias. Se incluyen motivo, fecha y estado — **el hecho sin el nombre** |
| `AuditLog` | Rastro interno de seguridad, con IPs del **staff**. «Auditar personas es otra pantalla con otro rol» |
| Secretos | `passwordHash`, `tokenVersion` |

**El hilo de mensajes va ENTERO, incluida la parte del otro.** No es una divulgación nueva:
el solicitante **ya lee esos mensajes en su bandeja**. Exportarlos no le enseña nada que no
pudiera copiar a mano. Es el mismo razonamiento con el que el schema justificó persistir un
teléfono detectado (§5.2).

### 7.3 El flujo

**Por cola**, sin discusión: reunir una decena de tablas y descargar N ficheros de R2 no
cabe en una petición HTTP, y la regla del proyecto es innegociable.

1. `POST` → crea una fila `DataExport` (`PENDING`) y encola.
2. El worker reúne, comprime, sube a `exportaciones/<id>.zip` (**prefijo privado**), marca
   `READY` con `expiresAt`.
3. **Aviso** por `Notification` (y correo, si aplica).
4. **Descarga por endpoint autenticado** que revalida propiedad y sirve el buffer —
   **molde exacto y verificado**: `GET /billing/invoices/:id/pdf`
   ([`invoicing.controller.ts:54`](../apps/api/src/modules/invoicing/invoicing.controller.ts#L54))
   y la descarga de adjuntos ([`tickets.controller.ts:179`](../apps/api/src/modules/tickets/tickets.controller.ts#L179)),
   que declara el criterio por escrito.
5. **Caduca**: un cron borra el objeto y marca `EXPIRED`. Un ZIP con la vida entera de una
   persona **no puede quedarse en el bucket para siempre**.

**Modelo mínimo `DataExport`:** `subjectUserId`, `requestedById`, `status`, `key`,
`expiresAt`, `sizeBytes`, `createdAt`. Hace falta para saber que está listo, quién lo pidió
y cuándo muere.

**Rate limit:** una exportación viva por usuario, molde `RateLimitService`.

### 7.4 Quién

- **El usuario, de sí mismo**, desde `/perfil`.
- **El staff, de cualquiera: ADMIN.** No MODERATOR, y el argumento está verificado en el
  código: la exportación incluye **facturación**, y el reparto vigente ya dice que la
  procedencia comercial es ADMIN — *«Lo que NO se sirve aquí es la PROCEDENCIA … eso
  describe una relación comercial y vive en `GET /admin/billing/users/:id`, que es ADMIN.
  El reparto no es cosmético — el dato no sale por esta puerta»*
  ([`admin.service.ts:1506-1509`](../apps/api/src/modules/admin/admin.service.ts#L1506)).
  Un ZIP con las facturas dentro **es esa puerta**.
- **Una cuenta `ARCHIVED` puede exportarse** (por el staff): es justo cuando más falta hace.
  Una `DELETED`, **no**: ya no hay datos que exportar, y sería exportar el vacío.

---

## 8. El plan de ráfagas

Seis. El criterio: **primero lo que hace representables los estados, después lo que los usa,
y lo destructivo al final** — cuando el contenido ya está oculto y las cascadas peligrosas
ya no lo son. Cada una es desplegable por sí sola.

| # | Ráfaga | Qué entra | Por qué aquí |
|---|---|---|---|
| **C1** | **El modelo y la puerta** | Migración: `ARCHIVED`+`DELETED` en el enum, `ArchiveReason`, las 7 columnas de `User`, `Listing.pausedByAccountArchive`, `Report.reportedUserName`, y los **8 `Cascade` → `Restrict`**. `user-status.transitions.ts`. Los **tres gates** aprenden los estados nuevos. **D-18** (`forgotPassword`) | Nada existe sin los estados. Y los `Restrict` **van antes que cualquier borrado**, por la misma razón que B1 fue antes que B2: si no, cada operación de las primeras semanas destruiría evidencia. Sin UI |
| **C2** | **Archivar y desarchivar** | `archive()` del usuario (`/perfil`) y del staff · `unarchive()` con `statusBeforeArchive` · pausado de anuncios con marca · arista `RESERVED → PAUSED` · apagados de §4.5 · **cancelación de suscripción** · `AuditLog` · lista y ficha del backoffice | Ya sobre C1. Es el corazón del encargo y **lo más caro** |
| **C3** | **El gate de visibilidad** | El predicado compartido + las cinco superficies de §5.3 | Después de C2: primero hay algo que ocultar. **Arregla de paso el hueco del baneado**, que es de hoy |
| **C4** | **`SUSPENDED` con caducidad** | `suspendedUntil` en el DTO · el predicado perezoso · el cron de las 07:00 · `Setting` del valor por defecto | **Independiente**: sólo depende de C1 y podría ir antes que C3. Va aquí porque toca el mismo gate y conviene tocarlo una vez |
| **C5** | **Eliminar definitivamente** | La supresión selectiva de §6 · el borrado de anuncios reutilizado · R2 · el fregado de snapshots · las guardas · `AlertDialog` | Lo último de lo destructivo, y **exige C1** (los `Restrict`) y **C3** (el contenido ya oculto) |
| **C6** | **Exportación** | `DataExport`, la cola, el ZIP, la descarga autenticada, la caducidad, las dos entradas | **Aditiva y sin dependencias fuertes.** Podría adelantarse; va al final porque su alcance sale del inventario que C5 fija |

**Reparto backend/UI.** C1 y C4 son 100 % backend. C2 es la que más UI lleva: el gesto en
`/perfil` (con su `AlertDialog` y su explicación de qué significa), el filtro y la columna
en `/admin/usuarios`, y los botones de la ficha. C3 es backend salvo los 404. C5 es backend
+ un botón con confirmación. C6 son dos pantallas pequeñas.

### 8.1 Las barreras — qué demuestra que cada ráfaga está hecha

| # | Barrera |
|---|---|
| **C1** | Un usuario en `ARCHIVED` y otro en `DELETED` reciben **403 en los tres gates** (petición autenticada, login por correo, login con Google) · las transiciones ilegales dan 400 con mensaje que dice a qué sí se puede pasar · `forgotPassword` **no encola** para los cuatro estados no-`ACTIVE` **y sigue devolviendo `{ok:true}`** · la migración de FKs no rompe ninguna suite |
| **C2** | Archivar → no puede entrar · sus anuncios quedan `PAUSED`, **fuera del índice** y **sin contar para la cuota** · desarchivar devuelve al **estado previo** (y **un baneado archivado vuelve a `BANNED`, no a `ACTIVE`** — es *la* barrera de §1.1) · los anuncios marcados vuelven a `ACTIVE` **respetando el cupo**, y lo que no cabe se queda `PAUSED` · la suscripción queda con `cancelAtPeriodEnd` · el bump programado **no cobra** |
| **C3** | Perfil de archivado y de baneado → **404** · no salen en el buscador de usuarios · **el comprador sigue viendo su hilo entero** y la valoración que recibió (es la barrera que impide pasarse de frenada) · un suspendido **sigue visible** |
| **C4** | Una suspensión con `suspendedUntil` pasado **deja entrar sin que nadie toque nada** · el cron la pasa a `ACTIVE` y lo audita · `suspendedUntil = null` sigue siendo indefinida |
| **C5** | **El test de inventario, y es la barrera real del cuerpo:** crear un usuario con **las 34 relaciones pobladas**, eliminarlo, y afirmar **una por una** qué se anonimizó, qué se conservó y qué se liberó. Más: la valoración que escribió **sigue contando** para la media de un tercero, firmada «Usuario eliminado» · la denuncia contra él **sigue diciendo contra quién** (`reportedUserName`) · su factura **sigue intacta y descargable** y su PDF **sigue en el bucket** · el correo real **se puede volver a registrar** · `Listing.phone`/`phoneNormalized` vacíos · eliminar un MODERATOR o a alguien con `Post` → **400** |
| **C6** | El ZIP abre, `datos.json` valida, las facturas se abren · **las notas internas no están** · **el nombre de quien le denunció no está** · el enlace caduca y el objeto desaparece del bucket · un usuario no puede exportar a otro |

---

## 9. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | **Se le sigue cobrando** a una cuenta archivada | §6.5. Es el más caro y va **dentro de C2**, no después |
| 2 | Desarchivar **lava un ban** | `statusBeforeArchive` (§1.2), con barrera propia en C2 |
| 3 | El gate de visibilidad **se pasa de frenada** y borra el historial del comprador | La regla escaparate/historial (§5.2) y su barrera en C3 |
| 4 | Reactivar anuncios al desarchivar **revienta la cuota** | Pasan por la puerta de `reactivate()`; lo que no cabe se queda `PAUSED` (§4.4) |
| 5 | Un `Cascade` peligroso **vuelve** en una migración futura | Van a `Restrict` en C1, y el test de inventario de C5 los fija uno a uno — molde `borrado-inventario.e2e-spec.ts` |
| 6 | Se olvida un dato personal **fuera de `User`** | La lista de §6.3 paso 3.3 (`Listing.phone`, `phoneNormalized`, `lastOwnerIp`) y §2.5b, con la barrera de C5 |
| 7 | Un usuario elimina su cuenta **por error** | Dos pasos + plazo mínimo desde `archivedAt` + `AlertDialog` + que **la elimina el staff**, no él |
| 8 | El ZIP de exportación **se queda en el bucket** | Caducidad con cron (§7.3) |
| 9 | Vaciar un **staff** degrada la auditoría | Guarda `role === USER` (§4.3) |
| 10 | La reserva de un comprador **desaparece sin aviso** | Anotado en §10; la arista está justificada, el aviso está por decidir |
| 11 | Un **baneado** con anuncios `ACTIVE` sigue teniendo ficha | Residuo consciente (§5.3): atar el ban al ciclo de vida de los anuncios es otra decisión |

---

## 10. Lo que sigue siendo decisión de producto

Cinco cosas que **no se pueden cerrar con criterio técnico**. El diseño funciona con
cualquiera de las respuestas; sólo hay que elegir.

| # | Decisión | Lo que aporta el diseño |
|---|---|---|
| **P-1** | **¿Se devuelve el saldo** de créditos y bumps de quien se va? | Técnicamente, el asiento de cierre (D-a) mantiene el invariante **decida lo que decida**. Sólo cambia si hay un reembolso al lado |
| **P-2** | **¿A quién se reasignan los `Post`** de un editor que se va? | La guarda dura ya impide vaciarlo sin resolverlo. Falta el destinatario: ¿una cuenta institucional? ¿el editor en jefe? |
| **P-3** | **¿Cuánto dura el plazo mínimo** entre archivar y poder eliminar, y es igual para `SELF_REQUEST` que para `STAFF_ACTION`? | La estructura está (`archivedAt` + `archiveReason`). Recomendación: un plazo corto para el arrepentimiento, y para `STAFF_ACTION` uno **más largo** — ahí la cuenta suele estar bajo investigación |
| **P-4** | **¿Se avisa al comprador** cuando una reserva se cae porque el vendedor archivó? | La arista `RESERVED → PAUSED` está justificada igualmente. El aviso es cortesía con coste (§4.4) |
| **P-5** | **`lastLoginIp` al eliminar: ¿se conserva en el `AuditLog` cuando `archiveReason = STAFF_ACTION`?** | Recomendación en D-g. La alternativa —borrar siempre— es más limpia de contar y pierde la evidencia del único caso donde importa |

---

## Apéndice — el cimiento verificado

| Qué usa el diseño | Dónde | Para qué |
|---|---|---|
| Los tres gates | [`jwt.strategy.ts:37`](../apps/api/src/modules/auth/strategies/jwt.strategy.ts#L37) · [`auth.service.ts:290`](../apps/api/src/modules/auth/auth.service.ts#L290) · [`auth.service.ts:436`](../apps/api/src/modules/auth/auth.service.ts#L436) | Los estados nuevos (C1) |
| `forgotPassword` siempre `{ok:true}` | [`auth.service.ts:359-374`](../apps/api/src/modules/auth/auth.service.ts#L359) | D-18 sin fuga (C1) |
| `register` ya da 409 | [`auth.service.ts:107-111`](../apps/api/src/modules/auth/auth.service.ts#L107) | D-14, mitad archivada: cero trabajo |
| `lockedUntil` perezoso | [`auth.service.ts:280-282`](../apps/api/src/modules/auth/auth.service.ts#L280) | `suspendedUntil` (C4) |
| `activeFilter()` | [`entitlement.service.ts:11-17`](../apps/api/src/modules/billing/entitlement.service.ts#L11) | El predicado compartido (C4) |
| `EntitlementExpirationService` `@Cron('0 3 * * *')` | [`entitlement-expiration.service.ts:30`](../apps/api/src/modules/expiration/entitlement-expiration.service.ts#L30) | El cron de caducidad (C4) |
| Franjas de cron ocupadas | `*/15`, `:10`, `0 3`, `0 4`, `0 5`, `0 6`, 02:00 | `0 7 * * *` libre |
| `VIGENTES` — una constante, no cinco copias | [`reviews.service.ts:25-33`](../apps/api/src/modules/reviews/reviews.service.ts#L25) | El predicado de visibilidad (C3) |
| `SELECT_USER_STUB` / `SELECT_AUTHOR` idénticos | [`messaging.service.ts:15`](../apps/api/src/modules/messaging/messaging.service.ts#L15) · [`reviews.service.ts:35`](../apps/api/src/modules/reviews/reviews.service.ts#L35) | La anonimización se propaga sola (§0) |
| `LISTING_STATUS_TRANSITIONS` | [`listing-status.transitions.ts:68`](../apps/api/src/modules/listings/listing-status.transitions.ts#L68) | Molde de `user-status.transitions.ts` (C1) |
| `PAUSED`: reactivable, sin índice, sin cuota | [`schema.prisma:61-66`](../apps/api/prisma/schema.prisma#L61) | El pausado de anuncios (C2) |
| `RESERVED` no va a `PAUSED` hoy | [`listing-status.transitions.ts:96`](../apps/api/src/modules/listings/listing-status.transitions.ts#L96) | La arista nueva (C2) |
| `PAUSED_LISTING_INACTIVE` se reanuda solo | [`schema.prisma:1991-1993`](../apps/api/prisma/schema.prisma#L1991) | Los bumps se apagan solos (C2) |
| `alert-matching` filtra `active`, no al usuario | [`alert-matching.service.ts:43-45`](../apps/api/src/modules/alerts/alert-matching.service.ts#L43) | Una condición más (C2) |
| `deleteListing` completo | [`admin.service.ts:1233-1311`](../apps/api/src/modules/admin/admin.service.ts#L1233) | Reutilizado entero (C5) |
| `discardDraft` | [`listings.service.ts:1122-1163`](../apps/api/src/modules/listings/listings.service.ts#L1122) | Los borradores (C5) |
| `listingMediaKeys` / `thumbKeyFor` | [`media-keys.ts:70-90`](../apps/api/src/infra/r2/media-keys.ts#L70) | R2 (C5) |
| `mediaCleanup` comprueba la BD antes | [`media-cleanup.service.ts:107-126`](../apps/api/src/modules/media-cleanup/media-cleanup.service.ts#L107) | Purga segura (C5) |
| `Report.reviewId` — «neutralizado no es resuelto» | [`schema.prisma:1403-1410`](../apps/api/prisma/schema.prisma#L1403) | El argumento de los `Restrict` (C1) |
| Snapshot al crear, no al borrar | [`diseno-borrado.md` §3.3](./diseno-borrado.md) | `reportedUserName` (C1) |
| ADMIN para lo irreversible | [`admin.controller.ts:134-140`](../apps/api/src/modules/admin/admin.controller.ts#L134) | D-19 |
| La facturación es ADMIN | [`admin.service.ts:1506-1509`](../apps/api/src/modules/admin/admin.service.ts#L1506) | Quién exporta (C6) |
| Descarga privada autenticada | [`invoicing.controller.ts:54`](../apps/api/src/modules/invoicing/invoicing.controller.ts#L54) · [`tickets.controller.ts:179`](../apps/api/src/modules/tickets/tickets.controller.ts#L179) | El ZIP (C6) |
| `Setting` + default en código | [`total-listing-limit.rule.ts:89-90`](../apps/api/src/modules/listing-gate/rules/total-listing-limit.rule.ts#L89) | Duración de suspensión (C4) |
| Precheck + 400 legible | `BlogService.adminDelete` | Las guardas de C5 |
| Inmutabilidad fiscal en BD | [`20260727000001:16-36`](../apps/api/prisma/migrations/20260727000001_invoice_immutability_guard/migration.sql#L16) | Por qué la fila sobrevive |
