# Auditoría — Archivado y eliminación de cuentas de usuario

> Documento de **diagnóstico** (2026-08-26). Inventaría el terreno antes de diseñar nada.
> **No diseña la solución**: no propone endpoints, ni migraciones, ni ráfagas. Donde hay
> una decisión que tomar, la enmarca y la deja abierta (§8).
>
> **El encargo que enmarca el diagnóstico** (de Ernest): un sistema de archivado +
> eliminación de cuentas análogo al de anuncios. El usuario pide irse → deja de poder
> entrar (para él ya no existe) pero la cuenta pasa a ARCHIVADO, no se destruye. El staff
> revisa los archivados desde lista y ficha y decide eliminar definitivamente o mantener.
> El staff también puede archivar. Más: exportación de toda la información del usuario
> (por él mismo y por el staff). Y aclarar qué hacen BANNED y SUSPENDED.
>
> **Tres tratamientos ya decididos por Ernest**, que este diagnóstico aplica como criterio
> de clasificación: **ARCHIVAR** (la fila vive, oculta, recuperable) · **ANONIMIZAR** (el
> contenido queda, el autor pasa a «usuario eliminado» — para lo que tiene DOS DUEÑOS) ·
> **CONSERVAR** intacto (obligación legal de conservación).
>
> **Método:** toda afirmación está verificada contra el fichero y la línea que se cita.
> Las acciones referenciales no se dan por los *defaults* de Prisma: están comprobadas una
> a una contra el SQL de las migraciones. Lo que no está claro se marca **DUDOSO** y se
> deja para que lo decida Ernest, no se inventa.

---

## 0. Resumen del terreno, en seis frases

1. **Hoy no existe ninguna vía que borre un `User`.** Cero `prisma.user.delete` en
   `apps/api/src` (grep verificado). Tampoco hay «darse de baja» en el frontend.
2. **La cascada no es sólo teórica: está BLOQUEADA.** De las 34 relaciones que apuntan a
   `User`, **12 son `RESTRICT`**. Un `DELETE` sobre un usuario con conversaciones,
   mensajes, denuncias, tickets, transacciones, facturas o registros de auditoría **falla
   con violación de clave ajena**. La cascada nunca llegaría a ejecutarse (§2.3).
3. **`SUSPENDED` y `BANNED` producen exactamente el mismo efecto** (403, sólo cambia el
   mensaje), verificado en los tres sitios que miran el estado. Pero **no son idénticos**:
   difieren en **quién puede deshacerlos** (MODERATOR vs ADMIN) (§1.4, §7).
4. **Ninguna superficie pública mira `User.status`.** Sólo cuatro ficheros mencionan
   `BANNED`/`SUSPENDED` en todo el backend, y los cuatro son de auth o de admin.
   Consecuencia verificada: **el perfil público y los anuncios ACTIVE de un usuario
   baneado siguen visibles e indexados** (§1.5). Es un hueco que ARCHIVED hereda tal cual.
5. **El molde de anuncios existe, está completo y es bueno** (archivar del dueño +
   `DELETE /admin/listings/:id` ADMIN-only con guarda de `ARCHIVED` + `AuditLog` con
   `before` + limpieza de R2 por cola). Es replicable casi entero (§2.5).
6. **No existe ninguna exportación de datos.** Habría que construirla desde cero (§6).

---

## 1. Los estados de cuenta hoy

### 1.1 El enum, verificado

[`schema.prisma:45-50`](../apps/api/prisma/schema.prisma#L45):

```prisma
/// Estado de la cuenta de usuario.
enum UserStatus {
  ACTIVE
  SUSPENDED
  BANNED
}
```

**Tres valores, ni uno más.** `User.status` es `UserStatus @default(ACTIVE)`
([`schema.prisma:329`](../apps/api/prisma/schema.prisma#L329)) y tiene `@@index([status])`
([`schema.prisma:440`](../apps/api/prisma/schema.prisma#L440)) — el índice ya existe y
serviría para listar archivados sin recorrer la tabla.

El enum físico es el de la migración inicial y **nunca se ha ampliado**:
[`20260620100046_init/migration.sql:8`](../apps/api/prisma/migrations/20260620100046_init/migration.sql#L8)
— `CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED');`.

### 1.2 Qué hace CADA uno, hoy

| Estado | Efecto verificado | Caduca | Permite algo |
|---|---|---|---|
| `ACTIVE` | Nada: es el default, no se comprueba | — | todo |
| `SUSPENDED` | `403 ForbiddenException` — *«Tu cuenta está suspendida. Contacta con soporte si crees que es un error.»* | **no** | **nada** |
| `BANNED` | `403 ForbiddenException` — *«Tu cuenta ha sido inhabilitada permanentemente.»* | **no** | **nada** |

**Confirmado: la única diferencia de EFECTO entre `SUSPENDED` y `BANNED` es la cadena del
mensaje.** No hay ninguna otra. Verificado exhaustivamente: sólo **cuatro ficheros** de
todo `apps/api/src` mencionan `BANNED` o `SUSPENDED` —`auth.service.ts`,
`jwt.strategy.ts`, `admin.service.ts` y `admin.controller.ts`— y en los dos primeros el
código es literalmente el mismo `if` duplicado tres veces.

Ni uno de los dos caduca: **no hay ninguna columna de vencimiento de sanción** en `User`.
Lo que sí caduca es el bloqueo por intentos fallidos (`lockedUntil`,
[`schema.prisma:334`](../apps/api/prisma/schema.prisma#L334)), que es otro mecanismo y otro
eje — es antifuerza-bruta, no sanción, y se resetea solo en el siguiente login correcto.

Esto coincide con lo que ya estaba escrito en
[`estado-tecnico.md:4780-4785`](./estado-tecnico.md#L4780) («No se distingue semánticamente
en la API porque añadiría edge cases … sin un requisito de negocio concreto para el MVP»),
y el diagnóstico lo confirma línea a línea.

### 1.3 Dónde se mira el estado — EL MAPA DEL GATE

**Son TRES sitios, no dos.** Éste es el mapa que ARCHIVED tendrá que replicar, porque una
cuenta archivada tampoco puede entrar:

| # | Dónde | Momento | Código |
|---|---|---|---|
| 1 | `JwtStrategy.validate()` | **cada petición autenticada** | [`jwt.strategy.ts:37-40`](../apps/api/src/modules/auth/strategies/jwt.strategy.ts#L37) |
| 2 | `AuthService.validateCredentials()` (login por correo, y también el del panel) | en el login | [`auth.service.ts:290-293`](../apps/api/src/modules/auth/auth.service.ts#L290) |
| 3 | `AuthService.loginWithGoogle()` | en el login social | [`auth.service.ts:436-439`](../apps/api/src/modules/auth/auth.service.ts#L436) |

Detalles verificados que importan para el diseño:

- **El guard lee el estado FRESCO de la base en cada petición** (`findUnique` por clave
  primaria, junto con `role`, `emailVerified` y `tokenVersion`). Así que un cambio de
  estado tiene efecto en la **siguiente petición**, sin esperar a que caduque el JWT. Lo
  mismo valdrá para ARCHIVED: **no hace falta invalidar tokens** para cerrar el acceso.
- **En el login por contraseña, el estado se comprueba DESPUÉS de verificar la
  contraseña** ([`auth.service.ts:284-293`](../apps/api/src/modules/auth/auth.service.ts#L284)),
  y a propósito: se devuelve 403 y no 401 porque las credenciales son correctas — lo que
  falla es la cuenta. Efecto colateral conocido y aceptado: **el 403 revela que la cuenta
  existe** a quien acierte la contraseña.
- **Existe además `tokenVersion`** ([`schema.prisma:338`](../apps/api/prisma/schema.prisma#L338)),
  que sí mata todas las sesiones al instante y que ya usan `resetPassword`,
  `changePassword`, `setPassword` y el cambio de rol
  ([`admin.service.ts:1593-1618`](../apps/api/src/modules/admin/admin.service.ts#L1593)).
  Es una segunda palanca disponible.

**DOS HUECOS DEL GATE ACTUAL, verificados** (y que ARCHIVED heredaría si se replica sin
mirar):

- **`forgotPassword()` NO mira el estado.**
  [`auth.service.ts:359-374`](../apps/api/src/modules/auth/auth.service.ts#L359) selecciona
  `id`, `email`, `name`, `passwordHash` — y nada más. Un usuario suspendido o baneado
  **recibe el correo de recuperación** igual que cualquiera (y podrá cambiar la contraseña;
  lo que no podrá es entrar después, porque ahí sí hay gate). Para una cuenta archivada
  *a petición propia* esto es peor que un detalle: es la plataforma escribiéndole a quien
  pidió irse.
- **El `email` es `@unique`** ([`schema.prisma:319`](../apps/api/prisma/schema.prisma#L319))
  y también lo son `slug` y `stripeCustomerId`. Mientras la fila viva —que es justo lo que
  significa archivar— **ese correo no puede volver a registrarse**. Es una consecuencia
  directa e inevitable del modelo, y hay que decidir qué se le responde a quien lo intente.

### 1.4 Las transiciones actuales, y quién puede hacer qué

Las cuatro pasan por un único helper privado,
`changeUserStatus()` ([`admin.service.ts:2935-2964`](../apps/api/src/modules/admin/admin.service.ts#L2935)),
que hace exactamente tres cosas: lee la fila, la actualiza y registra en `AuditLog` con
`before: { status }` / `after: { status }` y la IP del actor.

| Endpoint | Rol | Origen → Destino | Guarda de estado | `AuditLog.action` |
|---|---|---|---|---|
| `PATCH /admin/users/:id/suspend` | **MODERATOR+** ([`admin.controller.ts:166-175`](../apps/api/src/modules/admin/admin.controller.ts#L166)) | *cualquiera* → `SUSPENDED` | **ninguna** | `USER_SUSPEND` |
| `PATCH /admin/users/:id/unsuspend` | **MODERATOR+** ([`admin.controller.ts:179-188`](../apps/api/src/modules/admin/admin.controller.ts#L179)) | `SUSPENDED` → `ACTIVE` | **sí** — 400 si no está `SUSPENDED` | `USER_UNSUSPEND` |
| `PATCH /admin/users/:id/ban` | **ADMIN** (hereda `@MinRole(ADMIN)` de la clase, [`admin.controller.ts:190-199`](../apps/api/src/modules/admin/admin.controller.ts#L190)) | *cualquiera* → `BANNED` | **ninguna** | `USER_BAN` |
| `PATCH /admin/users/:id/reinstate` | **ADMIN** ([`admin.controller.ts:202-210`](../apps/api/src/modules/admin/admin.controller.ts#L202)) | *cualquiera* → `ACTIVE` | **ninguna** | `USER_REINSTATE` |

**El hallazgo de este apartado, y contradice en parte la premisa del encargo:** ban y
suspend **no** hacen «LO MISMO». Hacen el mismo **efecto**, pero tienen distinta
**autoridad de reversión**, y eso está deliberadamente construido:

- suspender y **des**suspender son de MODERATOR;
- banear y **rein**staurar son de ADMIN;
- y `unsuspendUser` **rechaza explícitamente** a un usuario `BANNED`
  ([`admin.service.ts:1554-1563`](../apps/api/src/modules/admin/admin.service.ts#L1554)):
  *«Solo se pueden reactivar usuarios en estado SUSPENDED. Para BANNED, usa desbanear.»*

Es decir: **un moderador no puede levantar un ban**. La distinción semántica que se dice
inexistente **sí existe**, sólo que vive en el reparto de roles y no en el efecto sobre el
usuario. Es un dato de peso para §7.

Notas menores verificadas:
- `USER_UNSUSPEND` **no está documentada** en la lista de acciones del comentario de
  `AuditLog` ([`schema.prisma:1462`](../apps/api/prisma/schema.prisma#L1462), que sólo cita
  `USER_SUSPEND | USER_BAN | USER_REINSTATE | USER_ROLE_CHANGE`). Deuda de documentación,
  no de código.
- **No hay guarda de auto-objetivo**: nada impide que un ADMIN se banee a sí mismo. Sí la
  hay para el rol (`changeUserRole` rechaza tocar a otro ADMIN,
  [`admin.service.ts:1583-1589`](../apps/api/src/modules/admin/admin.service.ts#L1583)),
  pero no para el estado.

### 1.5 Lo que el estado NO hace hoy — y es lo más importante de esta sección

**Ninguna superficie pública mira `User.status`.** Verificado por grep exhaustivo: los
únicos ficheros de `apps/api/src` que mencionan `BANNED`/`SUSPENDED` son
`auth.service.ts`, `jwt.strategy.ts`, `admin.service.ts` y `admin.controller.ts`.

Consecuencias comprobadas, todas hoy, con un usuario `BANNED`:

| Superficie | Qué hace | Verificado en |
|---|---|---|
| **Perfil público** `/vendedor/{slug}` | Se sirve igual. `findBySlug` no filtra por estado | [`users.service.ts:177-196`](../apps/api/src/modules/users/users.service.ts#L177) |
| **Anuncios del vendedor** | Se sirven los `ACTIVE`. El `where` es `{ status: 'ACTIVE', seller: { slug } }` — **el estado del vendedor no entra** | [`listings.service.ts:1295-1312`](../apps/api/src/modules/listings/listings.service.ts#L1295) |
| **Buscador (Meilisearch)** | Sus anuncios siguen indexados: banear **no toca los anuncios** (`changeUserStatus` sólo escribe `status`) y sólo `ListingStatus` gobierna la indexación | [`admin.service.ts:2947-2951`](../apps/api/src/modules/admin/admin.service.ts#L2947) |
| **Ficha de anuncio** | Muestra el bloque del vendedor con su valoración media | [`listings.service.ts:1223-1240`](../apps/api/src/modules/listings/listings.service.ts#L1223) |
| **Valoraciones** | Las escritas y las recibidas siguen contando y mostrándose | `reviews.service.ts` (sin filtro de estado) |
| **Buscador de usuarios** (elegir comprador al cerrar un trato) | Lo sigue devolviendo | [`users.service.ts:204-216`](../apps/api/src/modules/users/users.service.ts#L204) |

**Traducción para el diseño:** hoy `status` es **exclusivamente un gate de entrada**, no un
interruptor de visibilidad. El encargo pide que una cuenta ARCHIVED, además de no poder
entrar, **oculte su contenido al público** — y eso **no es replicar lo que hay**: es
construir una capa que hoy no existe en ningún sitio. Además, el índice de Meilisearch
lleva **`sellerName`, `sellerSlug` y `sellerAvatarUrl` congelados en cada documento**
([`search.service.ts:53-57`](../apps/api/src/modules/search/search.service.ts#L53)), así
que ocultar o anonimizar a un vendedor **obliga a reindexar sus anuncios**, no basta con
tocar la fila del usuario.

---

## 2. La cascada teórica y el borrado actual

### 2.1 No hay ninguna ruta que borre un usuario — confirmado

- **Cero `prisma.user.delete` / `deleteUser` en `apps/api/src`.** Las únicas apariciones
  están en las suites de test (`redsys.e2e-spec.ts:552`, y los `deleteMany` de limpieza de
  `tags-b2/b3/b4.e2e-spec.ts`).
- **Cero interfaz de baja en el frontend**: ninguna coincidencia de «eliminar cuenta»,
  «darse de baja» ni equivalentes en `apps/web`.
- El backoffice de usuarios expone **listar, ver ficha, suspender, des-suspender, banear,
  reinstaurar, cambiar rol, marcar de confianza y marcar revisión previa**
  ([`admin.controller.ts:154-262`](../apps/api/src/modules/admin/admin.controller.ts#L154)).
  **No hay `DELETE`.**

Coincide con lo que ya decía [`estado-tecnico.md:423`](./estado-tecnico.md#L423) («la
cascada es teórica; solo existe BAN»). Este diagnóstico añade que **es teórica y además
imposible** tal como está (§2.3).

> **Aviso de documentación desfasada:** [`estado-tecnico.md:418-419`](./estado-tecnico.md#L418)
> sigue describiendo el borrado de anuncios como era **antes** del cuerpo de borrado
> («HARD delete en cascada» sobre `Conversation` y `Report`). Eso ya no es cierto desde B1:
> ambas son `SetNull` + snapshot. La tabla de §2.5 refleja el estado real.

### 2.2 EL MAPA COMPLETO — las 34 relaciones que apuntan a `User`

Recorrido exhaustivo del schema (`User? @relation` / `User @relation`), con la acción
referencial **verificada contra el SQL de la migración que la creó**, no contra el default
de Prisma. Ordenadas por acción.

#### `ON DELETE CASCADE` — 16 relaciones

| # | Modelo.campo | Migración que lo fija |
|---|---|---|
| 1 | `Account.userId` | [`20260704163552:22`](../apps/api/prisma/migrations/20260704163552_social_login_google/migration.sql#L22) |
| 2 | `Listing.sellerId` | [`init:234`](../apps/api/prisma/migrations/20260620100046_init/migration.sql#L234) |
| 3 | `Favorite.userId` | [`init:243`](../apps/api/prisma/migrations/20260620100046_init/migration.sql#L243) |
| 4 | `Notification.userId` | [`20260709161211:21`](../apps/api/prisma/migrations/20260709161211_add_notification/migration.sql#L21) |
| 5 | `Alert.userId` | [`20260709163706:32`](../apps/api/prisma/migrations/20260709163706_add_alert/migration.sql#L32) |
| 6 | `Deal.sellerId` | [`20260716183829:30`](../apps/api/prisma/migrations/20260716183829_deal_entity/migration.sql#L30) |
| 7 | `Deal.buyerId` | [`20260716183829:33`](../apps/api/prisma/migrations/20260716183829_deal_entity/migration.sql#L33) |
| 8 | `Review.authorId` | [`20260624130000:30`](../apps/api/prisma/migrations/20260624130000_add_review_fields/migration.sql#L30) ⚠️ |
| 9 | `Review.targetId` | [`20260624130000:33`](../apps/api/prisma/migrations/20260624130000_add_review_fields/migration.sql#L33) ⚠️ |
| 10 | `VerificationToken.userId` | [`20260620165827:37`](../apps/api/prisma/migrations/20260620165827_add_auth_tokens/migration.sql#L37) |
| 11 | `PasswordResetToken.userId` | [`20260620165827:40`](../apps/api/prisma/migrations/20260620165827_add_auth_tokens/migration.sql#L40) |
| 12 | `Entitlement.userId` | [`20260625000000:174`](../apps/api/prisma/migrations/20260625000000_add_billing/migration.sql#L174) |
| 13 | `Wallet.userId` | [`20260626000001:70`](../apps/api/prisma/migrations/20260626000001_add_wallet_and_bump/migration.sql#L70) |
| 14 | `CouponRedemption.userId` | [`20260706012722:56`](../apps/api/prisma/migrations/20260706012722_add_coupons/migration.sql#L56) |
| 15 | `BumpSchedule.userId` | [`20260809064617:56`](../apps/api/prisma/migrations/20260809064617_add_bump_schedule/migration.sql#L56) |
| 16 | `Ticket.userId` | [`20260729084926:94`](../apps/api/prisma/migrations/20260729084926_add_ticketing/migration.sql#L94) ⚠️ |

⚠️ **`Review.authorId` es `CASCADE`, y el dato duele:** las valoraciones **que el usuario
escribió sobre otros** —es decir, **la reputación de otras personas**— se destruyen con su
cuenta. Es el mismo defecto de clase que B1 arregló para `Report` y `Conversation` respecto
del anuncio, sin arreglar en el eje del usuario. Y no es un descuido reciente: la migración
inicial las creó `RESTRICT` ([`init:264,267`](../apps/api/prisma/migrations/20260620100046_init/migration.sql#L264))
y una migración posterior **las cambió a `CASCADE` a propósito**. Igual `Deal`, que es la
evidencia de `Review.verified`.

⚠️ **`Ticket.userId` es `CASCADE` mientras `TicketMessage.authorId` es `RESTRICT`**
(§2.3): el propio modelo de tickets se contradice sobre si un hilo puede morir con una
persona.

#### `ON DELETE RESTRICT` — 12 relaciones (las que **bloquean** el borrado)

| # | Modelo.campo | Migración |
|---|---|---|
| 17 | `Conversation.buyerId` | [`init:252`](../apps/api/prisma/migrations/20260620100046_init/migration.sql#L252) |
| 18 | `Conversation.sellerId` | [`init:255`](../apps/api/prisma/migrations/20260620100046_init/migration.sql#L255) |
| 19 | `Message.senderId` | [`init:261`](../apps/api/prisma/migrations/20260620100046_init/migration.sql#L261) |
| 20 | `Report.reporterId` | [`init:273`](../apps/api/prisma/migrations/20260620100046_init/migration.sql#L273) |
| 21 | `AuditLog.actorId` | [`20260624054916:36`](../apps/api/prisma/migrations/20260624054916_add_audit_log_and_settings/migration.sql#L36) |
| 22 | `Post.authorId` | [`20260624095521:31`](../apps/api/prisma/migrations/20260624095521_add_blog_post/migration.sql#L31) |
| 23 | `Subscription.userId` | [`20260625000000:189`](../apps/api/prisma/migrations/20260625000000_add_billing/migration.sql#L189) |
| 24 | `Transaction.userId` | [`20260625000000:195`](../apps/api/prisma/migrations/20260625000000_add_billing/migration.sql#L195) |
| 25 | `ContactReply.adminUserId` | [`20260712114504:43`](../apps/api/prisma/migrations/20260712114504_add_contact_message/migration.sql#L43) |
| 26 | `Invoice.userId` | [`20260726000001:105`](../apps/api/prisma/migrations/20260726000001_add_fiscal_invoicing/migration.sql#L105) |
| 27 | `Ticket.openedById` | [`20260729084926:97`](../apps/api/prisma/migrations/20260729084926_add_ticketing/migration.sql#L97) |
| 28 | `TicketMessage.authorId` | [`20260729084926:121`](../apps/api/prisma/migrations/20260729084926_add_ticketing/migration.sql#L121) |

#### `ON DELETE SET NULL` — 6 relaciones

| # | Modelo.campo | Migración |
|---|---|---|
| 29 | `ListingImage.uploadedById` | [`20260620182835:9`](../apps/api/prisma/migrations/20260620182835_media_listing_image_nullable/migration.sql#L9) |
| 30 | `Report.reportedUserId` | [`init:279`](../apps/api/prisma/migrations/20260620100046_init/migration.sql#L279) |
| 31 | `Report.resolvedById` | [`init:282`](../apps/api/prisma/migrations/20260620100046_init/migration.sql#L282) |
| 32 | `Review.retiredById` | [`20260822000838:26`](../apps/api/prisma/migrations/20260822000838_retirada_valoraciones/migration.sql#L26) |
| 33 | `Ticket.assignedToId` | [`20260729084926:100`](../apps/api/prisma/migrations/20260729084926_add_ticketing/migration.sql#L100) |
| 34 | `Ticket.closedById` | [`20260729084926:115`](../apps/api/prisma/migrations/20260729084926_add_ticketing/migration.sql#L115) |

**Patrón que emerge solo, y es una buena noticia:** las seis `SetNull` son exactamente las
relaciones **de staff** (quién retiró, quién resolvió, quién atiende, quién cerró, quién
subió el fichero) más el denunciado. Es decir: **el modelo ya sabe anonimizar el lado del
staff**, y lo hace por la razón correcta, escrita en el schema —*«que se borre la cuenta
del moderador no puede resucitar una valoración retirada»*
([`schema.prisma:1329-1332`](../apps/api/prisma/schema.prisma#L1329))—. Lo que no sabe
anonimizar es el lado del **usuario**.

### 2.3 «La cascada es teórica» — sí, y además está BLOQUEADA

Si hoy alguien ejecutara `prisma.user.delete({ where: { id } })` sobre una cuenta con
actividad real, **no borraría nada**: fallaría con violación de clave ajena en la primera
de las doce `RESTRICT`. Basta con que el usuario tenga **una** conversación, **un** mensaje
enviado, **una** denuncia emitida, **un** ticket abierto por él, **una** transacción, **una**
factura o —si es staff— **una** entrada de auditoría.

Y hay **un bloqueo de segundo nivel** que conviene ver, porque no se deduce de la tabla:

> `User` → `Wallet` es `CASCADE`, **pero** `CreditLedger.walletId` y `BumpLedger.walletId`
> son **`RESTRICT`**
> ([`20260626000001:73`](../apps/api/prisma/migrations/20260626000001_add_wallet_and_bump/migration.sql#L73),
> [`20260715110525:43`](../apps/api/prisma/migrations/20260715110525_bump_balance_and_bump_coupons/migration.sql#L43)).
> Borrar el usuario intentaría borrar su `Wallet`, y **el libro mayor lo impediría**. Es
> coherente con lo que el schema promete de esas tablas: *«Registro inmutable … NUNCA se
> modifica ni se borra una fila»*.

Y **un bloqueo de tercer nivel, éste a nivel de base de datos y no de FK**: las facturas
`ISSUED` están protegidas por un *trigger* `BEFORE UPDATE OR DELETE` que lanza excepción
([`20260727000001_invoice_immutability_guard/migration.sql:16-36`](../apps/api/prisma/migrations/20260727000001_invoice_immutability_guard/migration.sql#L16)).
Aunque alguien quitara el `RESTRICT` de `Invoice.userId`, **Postgres seguiría negándose**.

**Conclusión operativa para el diseño:** «eliminar definitivamente» **no puede ser un
`user.delete()`**. O es una supresión selectiva y ordenada (anonimizar lo de dos dueños,
conservar lo fiscal, borrar lo propio), o no ocurre. El modelo de datos ya lo está
diciendo con sus constraints — y lo dice **bien**.

### 2.4 El segundo salto — lo que cuelga de lo que cuelga

Para el inventario importa qué arrastra cada `CASCADE` de primer nivel:

| Primer nivel | Arrastra (segundo salto) | Nota |
|---|---|---|
| `Listing` (Cascade) | `ListingImage`, `ListingTag`, `Favorite`, `AlertMatch`, `ListingViewDaily`, `ListingImpressionDaily`, `ListingDetection`, `BumpSchedule`→`BumpRun` (todas Cascade) | Y **preserva** `Conversation`, `Report`, `Deal`, `Review`, `Ticket`, `Entitlement`, `Transaction` (SetNull + snapshot) — el trabajo de B1 |
| `Alert` (Cascade) | `AlertMatch` (Cascade) | — |
| `Wallet` (Cascade) | **bloqueado** por `CreditLedger`/`BumpLedger` (Restrict) | §2.3 |
| `Ticket` (Cascade) | `TicketMessage` (Cascade) → `TicketAttachment` (Cascade) | Pero `TicketMessage.authorId` es Restrict: el hilo del usuario **se lleva por delante los mensajes del staff** |
| `BumpSchedule` (Cascade) | `BumpRun` (Cascade) | — |
| `Review` (Cascade) | `Report.reviewId` → **SetNull + snapshot** (`reviewComment`, `reviewAuthorName`) | Cerrado en 2026-08-22; la denuncia sobrevive |

### 2.5 EL MOLDE — cómo funciona el archivado y el borrado de ANUNCIOS

Es lo que hay que replicar, y está completo y verificado.

**Archivar (del dueño):** `ListingsService.archive()`
([`listings.service.ts:820-835`](../apps/api/src/modules/listings/listings.service.ts#L820)).

- Guarda de estado con su propio `if`:
  `ARCHIVABLE_STATUSES = [ACTIVE, PAUSED, SOLD, EXPIRED, REJECTED]`
  ([`listings.service.ts:812-818`](../apps/api/src/modules/listings/listings.service.ts#L812)).
- Un `update` de `status` y **nada más**: no destruye conversaciones, tratos ni
  valoraciones. El schema lo declara: *«a diferencia de `remove()`, no destruye
  conversaciones/tratos/valoraciones — es la alternativa no destructiva»*
  ([`schema.prisma:67-71`](../apps/api/prisma/schema.prisma#L67)).
- `invalidateAndReindex(slug, id)`: **saca el documento de Meilisearch e invalida la caché
  Redis**. Éste es el gesto que convierte «archivado» en «invisible», y es el que hoy
  **no tiene equivalente para un usuario**.
- `ARCHIVED` es **terminal en dos capas**: el enum lo declara irreversible y
  `listing-status.transitions.ts` lo hace cumplir (`ARCHIVED: []`).

**Eliminar (del staff):** `AdminService.deleteListing()`
([`admin.service.ts:1233-1311`](../apps/api/src/modules/admin/admin.service.ts#L1233)),
expuesto en `DELETE /admin/listings/:id`
([`admin.controller.ts:132-149`](../apps/api/src/modules/admin/admin.controller.ts#L132)).
Seis pasos, en este orden:

1. **Cargar la fila antes de borrar**, con todo lo que hará falta después (título, slug,
   dueño, categoría, URLs de imágenes/vídeo/póster y los `_count` de lo que colgaba).
   *«Una vez borrada la fila no hay de dónde sacar nada.»*
2. **Guarda de estado**: `if (status !== ARCHIVED) → 400`, con mensaje explícito
   («Archívalo primero: eliminar es irreversible»). Los **dos pasos son la salvaguarda**.
3. **`prisma.listing.delete`** — una sola sentencia; las cascadas y los `SetNull` los
   resuelve Postgres atómicamente.
4. **`AuditLog` con `before` poblado desde la copia en memoria** — acción `LISTING_DELETE`,
   `resourceId` = el id (sobrevive a la fila), `actorId` = quién. *«Es lo único que
   sobrevive al borrado»*, y por eso lleva identidad, dueño y recuentos, pero **no la fila
   entera**: el `AuditLog` no es una papelera.
5. **Efectos externos, fuera de la transacción y sin poder tumbar el borrado**:
   `redis.del(cacheKey(slug))` + `indexingQueue.add('remove')`.
6. **`mediaCleanupQueue.add('purge', { keys })`** — la limpieza de R2 (B3), con las
   **claves ya resueltas**, nunca el id: cuando el trabajo se ejecute el anuncio ya no
   existirá. Las claves las calcula `listingMediaKeys()`
   ([`media-keys.ts:70-90`](../apps/api/src/infra/r2/media-keys.ts#L70)), que por cada
   imagen añade **el original y su miniatura derivada** (`thumbKeyFor`), más vídeo y
   póster.

**Rol:** ADMIN-only, **excepción deliberada** dentro de una sección que es MODERATOR,
porque es la única acción irreversible ([`admin.controller.ts:134-140`](../apps/api/src/modules/admin/admin.controller.ts#L134)).

**Y la válvula que hubo que abrir al quitarle el borrado al usuario:** `discardDraft()`
([`listings.service.ts:1122-1161`](../apps/api/src/modules/listings/listings.service.ts#L1122)),
sólo para `DRAFT`, con nombre distinto a propósito «para que nadie la lea como el borrado de
antes con la puerta entornada». **Lección directamente transferible:** quitar una capacidad
al usuario puede dejar un callejón sin salida, y hay que buscarlo *en el mismo cuerpo*.

**Qué de este molde es reutilizable tal cual para usuarios**

| Pieza | ¿Sirve? |
|---|---|
| Estado terminal en el enum + guarda propia con `if` | **Sí**, directamente |
| Dos pasos (archivar → eliminar) como salvaguarda | **Sí** |
| `AuditLog` con `before` como único superviviente | **Sí**, y aquí es aún más necesario |
| ADMIN-only para lo irreversible, MODERATOR para lo reversible | **Sí**, ya es el reparto de ban/suspend |
| Un solo `delete` atómico que resuelve la cascada | **NO** — está bloqueado (§2.3) |
| `mediaCleanupQueue` con claves resueltas | **Sí**, pero las claves de un usuario están en **cinco prefijos** y algunas no son suyas (§4) |
| `invalidateAndReindex` | **Parcialmente**: hay que reindexar **N anuncios**, no uno |

---

## 3. EL INVENTARIO CLASIFICADO — el corazón del diagnóstico

### 3.1 El criterio de los tres tratamientos

> **ARCHIVAR** — la información es **sólo del usuario**. Nadie más la echaría en falta.
> Al archivar se oculta y la fila vive (recuperable); al eliminar definitivamente, se
> destruye.
>
> **ANONIMIZAR** — la información tiene **DOS DUEÑOS**. Archivarla o borrarla destruiría
> el lado de la otra persona: la reseña que otro vendedor recibió, el hilo del comprador,
> la denuncia que alguien puso. El contenido se queda; el autor pasa a «usuario eliminado».
>
> **CONSERVAR** — hay **obligación legal de conservación** (fiscal/contable) o es rastro de
> seguridad no borrable. Ni se archiva ni se anonimiza: se queda como está. *El derecho al
> olvido no cubre las obligaciones contables.*

**La prueba del algodón, heredada de [`diseno-borrado.md`](./diseno-borrado.md) §2.1:**
¿lo echaría en falta alguien que no sea el propio usuario? Si sí, no es suyo para
destruirlo.

**Una tensión que el diagnóstico deja anotada y no resuelve** (va a §8, D-1): los tres
tratamientos describen bien el **borrado definitivo**, pero **al ARCHIVAR** la
anonimización es prematura — archivar es reversible, y anonimizar no lo es. La tabla de
abajo clasifica por el tratamiento **de la eliminación definitiva** (que es donde los tres
se distinguen de verdad) y añade una columna con lo que hace falta **al archivar**.

### 3.2 La tabla completa — las 34 relaciones

#### Bloque A · ARCHIVAR (sólo del usuario)

| # | Modelo.campo | `onDelete` | Al **archivar** | Por qué ARCHIVAR |
|---|---|---|---|---|
| 1 | `Listing.sellerId` | Cascade | **Reusar `ListingStatus.ARCHIVED`** sobre sus anuncios: los saca del índice y de la caché. Ojo: `ARCHIVABLE_STATUSES` excluye `DRAFT`, `PENDING_REVIEW` y `RESERVED` — hay tres estados sin camino (§3.5) | El anuncio es del vendedor. Ya tiene su propio archivado, probado y con su limpieza de R2 |
| 2 | `ListingImage.uploadedById` | **SetNull** | nada (la imagen muere con el anuncio) | Ya anonimiza por construcción. Cuelga del anuncio, no del usuario |
| 3 | `Favorite.userId` | Cascade | Ocultar | Un favorito no significa nada para nadie más |
| 4 | `Notification.userId` | Cascade | **Dejar de generarlas**, además de ocultarlas | Buzón privado, `userId` 1:1 por diseño |
| 5 | `Alert.userId` | Cascade | **`active = false`** — si no, el cron de matching seguiría notificando a una cuenta que no puede entrar | Búsqueda guardada, estrictamente privada |
| 6 | `AlertMatch` (vía `Alert`) | Cascade | — | Deduplicación interna |
| 7 | `Account.userId` | Cascade | Ver §3.5 (dudoso menor) | Vínculo con Google. Sólo del usuario |
| 8 | `VerificationToken.userId` | Cascade | **Invalidar** | Credencial efímera, sin valor histórico |
| 9 | `PasswordResetToken.userId` | Cascade | **Invalidar** | Ídem. Y ver el hueco de `forgotPassword` (§1.3) |
| 10 | `BumpSchedule.userId` | Cascade | **Parar** (`PAUSED_*`) | Gasto desatendido. El enum ya prevé `PAUSED_LISTING_INACTIVE`, que se dispara solo al archivar los anuncios |
| 11 | `BumpRun` (vía `BumpSchedule`) | Cascade | — | Registro de ejecución, no contable — lo dice el schema |

#### Bloque B · ANONIMIZAR (dos dueños)

| # | Modelo.campo | `onDelete` | Riesgo actual | Por qué ANONIMIZAR |
|---|---|---|---|---|
| 12 | `Conversation.buyerId` | Restrict | bloquea | El hilo es de **dos personas**. Ya se decidió lo mismo frente al anuncio (B1, §2.5 de `diseno-borrado.md`); el argumento es idéntico frente al usuario |
| 13 | `Conversation.sellerId` | Restrict | bloquea | Ídem |
| 14 | `Message.senderId` | Restrict | bloquea | Cada mensaje tiene un autor y un destinatario. Borrarlos deja el hilo del otro con huecos |
| 15 | `Review.authorId` | **Cascade ⚠️** | **destruye la reputación de OTROS** | Una reseña **que él escribió** describe a un tercero. Es el hallazgo más grave del inventario |
| 16 | `Deal.sellerId` | **Cascade ⚠️** | destruye el trato del otro | Un trato es de dos, y es la **evidencia** de `Review.verified` |
| 17 | `Deal.buyerId` | **Cascade ⚠️** | ídem | Ídem |
| 18 | `Report.reporterId` | Restrict | bloquea | La denuncia es evidencia de moderación. B1 ya la protegió del borrado del anuncio; falta el eje del usuario |
| 19 | `Report.reportedUserId` | SetNull | ya anonimiza — **pero sin snapshot** | La denuncia sobrevive, y debe. Hueco: no hay `reportedUserName` congelado, a diferencia de `listingTitle` / `reviewAuthorName` (§3.5) |
| 20 | `Ticket.userId` | **Cascade ⚠️** | destruye el hilo entero, mensajes del staff incluidos | Un ticket tiene **dos lados** por construcción (`TicketAuthorSide.USER` / `STAFF`) |
| 21 | `Ticket.openedById` | Restrict | bloquea | Ídem |
| 22 | `TicketMessage.authorId` | Restrict | bloquea | Ídem. **Contradice** el `Cascade` de la #20 |
| 23 | `TicketAttachment` (vía `TicketMessage`) | Cascade | — | Sigue a su mensaje. Pero **su objeto en R2 no se limpia solo** (§4) |

#### Bloque C · CONSERVAR (obligación legal / rastro)

| # | Modelo.campo | `onDelete` | Por qué CONSERVAR |
|---|---|---|---|
| 24 | `Invoice.userId` | **Restrict** + *trigger* | **Documento fiscal.** Doblemente protegido: FK y `BEFORE UPDATE/DELETE` en Postgres. El derecho al olvido no alcanza aquí. Y el receptor va **congelado** en la propia factura (`receiverTaxId`, `receiverName`…), así que **sobrevive legible sin el usuario** |
| 25 | `InvoiceLine` (vía `Invoice` / `Transaction`) | Cascade / Restrict | Ídem, con el mismo *trigger* |
| 26 | `Transaction.userId` | **Restrict** | *«Registro permanente de cada cobro. NUNCA se borra»* ([`schema.prisma:1712`](../apps/api/prisma/schema.prisma#L1712)) |
| 27 | `Subscription.userId` | **Restrict** | Relación comercial; sostiene `Transaction` y `Entitlement` |
| 28 | `CreditLedger` / `BumpLedger` (vía `Wallet`) | **Restrict** | Libro mayor inmutable. Sostienen el invariante `wallet.balance == SUM(ledger.amount)` |
| 29 | `AuditLog.actorId` | **Restrict** | Rastro de seguridad interno. **Un miembro del staff no puede llevarse el registro de lo que hizo al irse.** Aquí el `RESTRICT` es la decisión correcta y debe seguir bloqueando |
| 30 | `ContactReply.adminUserId` | Restrict | Constancia de qué se le respondió a un ciudadano y quién. Sólo aplica a staff |

#### Bloque D · Ya resuelto (staff, `SetNull` — no hay nada que decidir)

| # | Modelo.campo | `onDelete` | Nota |
|---|---|---|---|
| 31 | `Report.resolvedById` | SetNull | Correcto: se pierde quién resolvió, no la resolución |
| 32 | `Review.retiredById` | SetNull | Con razón escrita en el schema |
| 33 | `Ticket.assignedToId` | SetNull | *«el hilo sigue vivo y vuelve a la bandeja sin asignar»* |
| 34 | `Ticket.closedById` | SetNull | Ídem |

#### Bloque E · Los que no encajan limpiamente → **DUDOSOS**, detallados en §3.5

`Wallet` · `Entitlement` · `CouponRedemption` · `Post.authorId` · `Review.targetId`

### 3.3 Los datos del propio `User` — las columnas

El derecho al olvido cubre esto directamente. Todo verificado en
[`schema.prisma:317-441`](../apps/api/prisma/schema.prisma#L317).

| Grupo | Columnas | Tratamiento | Notas |
|---|---|---|---|
| **Identidad** | `name`, `email` **@unique**, `slug` **@unique**, `phone`, `avatarUrl`, `bio` | **ARCHIVAR** → anonimizar al eliminar | Los `@unique` son el problema real: no se puede poner «eliminado» en todas. Hace falta una estrategia (sufijo con el id, tombstone…) |
| **Credenciales** | `passwordHash`, `tokenVersion`, `failedLoginAttempts`, `lockedUntil` | **ARCHIVAR** (y al eliminar, destruir) | `passwordHash` es un secreto: no debería sobrevivir a la eliminación bajo ningún concepto |
| **Ubicación pública** | `city`, `province`, `postalCode` | **ARCHIVAR** | Se muestra en el perfil público |
| **Datos fiscales** | `fiscalTaxId`, `fiscalName`, `fiscalEntityType`, `fiscalAddress`, `fiscalCity`, `fiscalPostalCode`, `fiscalProvince`, `fiscalCountry` | **DUDOSO → probablemente CONSERVAR o borrar** | **El schema ya resolvió la tensión**: se **congelan (copia, no referencia) en cada `Invoice` al emitir**. La factura no depende de estas columnas. Así que **borrarlas de `User` no daña la conservación fiscal** |
| **Pagos** | `stripeCustomerId` **@unique** | **CONSERVAR** | Es la referencia externa que ata las transacciones a la pasarela |
| **Antifraude** | `lastLoginAt`, `lastLoginIp` | **DUDOSO** | Dato personal (decisión escrita: MODERATOR+). Para un archivado por sanción tiene sentido conservarlo; para uno a petición propia, es lo primero que cubre el olvido. Ver §3.5 |
| **Plataforma** | `role`, `status`, `emailVerified`, `trusted`, `requiresReview` | **CONSERVAR** | Estado del sistema, no información personal |
| **Marcas de tiempo** | `createdAt`, `updatedAt` | **CONSERVAR** | Sin ellas no se puede auditar cuándo pasó nada |

### 3.4 Lo que no es una FK — y se olvida con facilidad

| Qué | Dónde vive | Tratamiento | Estado hoy |
|---|---|---|---|
| **`AuditLog` SOBRE el usuario** (`resourceType='User'`, `resourceId=<id>`) | Dos columnas de **texto**, sin FK | **CONSERVAR** | ✔ **Sobrevive por construcción** — igual que los ledgers respecto del anuncio. Un usuario eliminado deja su historial de suspensiones/bans/roles intacto. Es lo que hace posible el «único superviviente» del molde |
| **`CreditLedger` / `BumpLedger`** con `referenceType='User'` | Texto, sin FK ([`schema.prisma:1951`](../apps/api/prisma/schema.prisma#L1951)) | **CONSERVAR** | ✔ Por construcción |
| **Documentos de Meilisearch** | Índice externo | **hay que reindexar** | ⚠️ Llevan `sellerId`, `sellerName`, `sellerSlug`, `sellerAvatarUrl` congelados ([`search.service.ts:53-57`](../apps/api/src/modules/search/search.service.ts#L53)). Archivar sus anuncios los saca del índice; anonimizar sin archivar exigiría reindexar N documentos |
| **Caché Redis de fichas** (`listing:{slug}`) | Redis | invalidar por anuncio | ✔ Ya lo hace `invalidateAndReindex` |
| **Rate limits, dedup de vistas** (`auth:*`, `view:dedup:*`) | Redis, TTL corto | **nada** | ✔ Se expiran solos — mismo criterio que B3 |
| **`Notification.data`** de otros usuarios | `Json` autocontenido | **DUDOSO** | Los snapshots pueden llevar datos del usuario que se va, en buzones ajenos. No hay FK que los alcance |
| **`Conversation.listingTitle`, `Deal.listingTitle`, `Review.listingTitle`, `Report.listingTitle`, `Ticket.linkedLabel`, `Report.reviewAuthorName`** | Snapshots congelados | **CONSERVAR** | ⚠️ **`Report.reviewAuthorName` guarda el NOMBRE de un autor de reseña.** Anonimizar la fila `User` no lo alcanza |

### 3.5 LOS DUDOSOS — marcados como tales, sin inventar la clasificación

**D-a · `Wallet` + saldo.** El `Wallet` es `Cascade` desde `User`, pero sus ledgers son
`Restrict`. Técnicamente el tratamiento es CONSERVAR (libro mayor). **Lo que está sin
decidir no es técnico, es de negocio:** ¿qué pasa con un saldo de créditos o de bumps
positivo cuando alguien pide irse? ¿Se pierde? ¿Se reembolsa? ¿Se congela por si vuelve? El
schema no lo dice y ningún código lo contempla. **Decisión de Ernest.**

**D-b · `Entitlement`.** Es `Cascade` desde `User`, pero el schema dice lo contrario en
palabras: *«Nunca se borra una fila de esta tabla; la revocación es el mecanismo de
cierre»* ([`schema.prisma:1629`](../apps/api/prisma/schema.prisma#L1629)). **Contradicción
verificada entre la regla escrita y la constraint.** Además, un `Entitlement` puede apuntar
a una `Transaction` conservada, con lo que borrarlo rompe la trazabilidad de un cobro que
sí se conserva. *Inclinación:* CONSERVAR revocando (`revokedAt`), que es lo que el propio
modelo dice. **Marcado como dudoso porque el `Cascade` dice otra cosa.**

**D-c · `CouponRedemption`.** Misma forma exacta de contradicción: FK `Cascade`, comentario
del schema *«NUNCA se borra ni se modifica: historial permanente de canjes»*
([`schema.prisma:2233`](../apps/api/prisma/schema.prisma#L2233)). Y tiene
`@@unique([couponId, userId])`: borrarlo permitiría **volver a canjear el mismo cupón** con
una cuenta nueva del mismo correo. *Inclinación:* CONSERVAR.

**D-d · `Post.authorId` (blog y páginas).** `Restrict`. Aplica sólo a EDITOR/ADMIN. Un
artículo publicado es **contenido del sitio**, no del autor: no se archiva con él ni se
borra. Pero la firma es un dato personal. Tres salidas posibles —reasignar el autor,
anonimizar la firma, o conservar tal cual— y ninguna es obviamente la buena. **Decisión de
Ernest.** *(Nota: un `Post` de tipo `PAGE` enlazado desde el nav o el footer tampoco se
puede borrar — `FooterItem.pageId` y `NavItem.pageId` son `Restrict`.)*

**D-e · `Review.targetId` — las valoraciones RECIBIDAS.** Es la dirección difícil, y el
encargo pide analizarla en las dos:
- **Las que él escribió** (`authorId`, #15): claro — **ANONIMIZAR**. Describen a otras
  personas y son la reputación de otros.
- **Las que él recibió** (`targetId`): describen **a él**. Si la cuenta desaparece, la
  reseña ya no describe a nadie y su exhibición pública no tiene sujeto → argumento para
  llevárselas con él. **Pero** son también el testimonio de sus autores y sostienen
  `Review.verified` y las medias históricas. Y el `@@unique([authorId, targetId,
  listingId])` significa que borrarlas **liberaría el hueco** para escribir otra.
  **Sin recomendación: es una decisión de producto.**

**D-f · `Account` (login social).** `Cascade`. Al archivar, ¿se desvincula la identidad de
Google? El gate ya bloquea la entrada, así que desvincular no aporta seguridad; pero
mantener el vínculo significa que la cuenta archivada sigue «reconociendo» ese Google. Es
menor, pero hay que decidirlo.

**D-g · `lastLoginIp` / `lastLoginAt`.** Dato personal con finalidad antifraude declarada
por escrito ([`schema.prisma:376-394`](../apps/api/prisma/schema.prisma#L376)). Conservarlo
en una cuenta archivada **por sanción** tiene una justificación clara; en una archivada
**a petición propia**, es exactamente lo que el usuario está pidiendo que se borre. El
mismo dilema aplica a `Listing.lastOwnerIp`.

**D-h · Los tres estados de anuncio sin camino al archivar la cuenta.** Verificado:
`ARCHIVABLE_STATUSES` **excluye `DRAFT`, `PENDING_REVIEW` y `RESERVED`**
([`listings.service.ts:812`](../apps/api/src/modules/listings/listings.service.ts#L812)).
Si archivar una cuenta se implementa como «archivar todos sus anuncios», esos tres **no
tienen transición legal**. Es el **mismo callejón sin salida** que `diseno-borrado.md` §1.2
encontró y cerró con `discardDraft()`, reapareciendo un nivel más arriba. Un `RESERVED`
además tiene un trato colgado con **otra persona** dentro.

**D-i · `Notification.data` en buzones ajenos** (§3.4). Sin FK que lo alcance.

**D-j · `Report.reportedUserId` sin snapshot.** Cuando se anonimice al denunciado, la cola
de moderación se quedará sin saber **a quién** se denunció. Los tres precedentes del repo
(`listingTitle`, `reviewAuthorName`, `linkedLabel`) dicen cómo se arregla — y que **se
escribe al crear, no al borrar** (`diseno-borrado.md` §3.3). Aquí no existe.

---

## 4. Los objetos de R2

**Al archivar: NO se tocan.** Archivar es reversible y los ficheros son inertes mientras
nadie los enlace. Es exactamente lo que ya hace `archive()` con un anuncio.

**Al eliminar definitivamente:** hay que limpiarlos, y el molde existe (`media-cleanup`,
B3). El inventario de prefijos, de
[`diseno-borrado.md` §7.2](./diseno-borrado.md) y verificado en el código:

| Prefijo | Qué es | ¿Del usuario? | Cómo se alcanza |
|---|---|---|---|
| `avatars/` | Su foto de perfil | **sí** | `User.avatarUrl` (URL pública). Ya hay limpieza en el cambio de avatar: `purgeReleased` en [`users.service.ts:103-107`](../apps/api/src/modules/users/users.service.ts#L103) |
| `media/` | Fotos de sus anuncios **y sus miniaturas** | **sí, vía anuncio** | `listingMediaKeys()` — y la miniatura **no está en ninguna columna**: se deriva con `thumbKeyFor` |
| `listing-videos/` | Vídeo Pro y póster | **sí, vía anuncio** | `Listing.videoUrl` / `videoPosterUrl` |
| `tickets/` | Adjuntos de sus mensajes de ticket | **sí** | `TicketAttachment.key` — **clave desnuda, no URL** |
| `facturas/` | PDFs de sus facturas | **sí, pero** | `Invoice.pdfKey` — **clave desnuda**. **CONSERVAR**: documento fiscal |
| `blocks/`, `homepage/`, `sponsored/` | Contenido editorial y publicidad | **NO** | Aunque los subiera un admin, son del sitio |

**Cuatro trampas ya documentadas y demostradas** en `diseno-borrado.md` §7.6, que aplican
igual aquí y hay que respetar:

1. `media/` **no es exclusivo de anuncios** — contiene también las portadas del blog, que
   viven como `ListingImage` con `listingId = null`. **Prefijo ≠ dueño.**
2. Las **miniaturas no están persistidas**: hay que derivarlas o quedan huérfanas.
3. `Invoice.pdfKey` y `TicketAttachment.key` son **claves desnudas**, no URLs: un barrido
   que sólo case contra el prefijo público **no las ve** — y en el caso de las facturas,
   borrarlas sería destruir documentos de conservación obligatoria.
4. Hay referencias **dentro de columnas `Json`** (`Post.blocks`, `HomepageConfig.blocks`,
   `AuditLog.before/after`). `MediaCleanupService` ya lo contempla: **comprueba contra la
   base de datos antes de borrar nada**
   ([`media-cleanup.service.ts:107-126`](../apps/api/src/modules/media-cleanup/media-cleanup.service.ts#L107)).

**La regla que dejó escrita B4, y que aquí vale igual:** *ante la duda, un huérfano de más
es mejor que un fichero vivo de menos.*

---

## 5. Encaje de `ARCHIVED` con los estados existentes

### 5.1 ¿Valor del enum, o campo aparte?

**Opción (a) — un cuarto valor en `UserStatus`.** Es el molde literal de anuncios.

*A favor, verificado:*
- **Un solo sitio que mirar por gate.** Los tres gates de §1.3 ya hacen
  `if (status === X)`; añadir un valor es añadir una rama en cada uno.
- **`@@index([status])` ya existe** ([`schema.prisma:440`](../apps/api/prisma/schema.prisma#L440)):
  listar archivados sale gratis.
- **El filtro del backoffice sale gratis**: `ListAdminUsersDto.status` es
  `@IsEnum(UserStatus)` ([`list-admin-users.dto.ts:17-18`](../apps/api/src/modules/admin/dto/list-admin-users.dto.ts#L17)),
  así que la lista de usuarios acepta el valor nuevo **sin tocar el DTO**.
- **Migración aditiva**: `ALTER TYPE ... ADD VALUE`, sin backfill — nadie está archivado.
- Es lo mismo que hizo `ListingStatus.ARCHIVED`, y el equipo ya sabe leerlo.

*En contra:*
- **`status` es un solo eje**, así que ARCHIVED **pisa** a SUSPENDED/BANNED. Si un usuario
  baneado pide irse (o si el staff archiva a un suspendido), **se pierde la sanción
  previa** — sólo quedaría en el `before` del `AuditLog`. Y al revés: si un archivado se
  restaura, ¿vuelve a `ACTIVE` o al ban que tenía?
- No hay dónde guardar **cuándo** se archivó ni **quién** lo pidió, que es justo lo que la
  lista de archivados necesita mostrar.

**Opción (b) — un campo `archivedAt` (+ `archivedById`, `archiveReason`).**

*A favor:* es **ortogonal** a la sanción (se puede estar baneado *y* archivado sin que uno
borre al otro); trae la fecha y el actor de serie; y el repo tiene el molde de sobra —
`Review.retiredAt`/`retiredById`/`retiredReason`, `Entitlement.revokedAt`,
`Ticket.closedAt`/`closedById`.

*En contra:* **duplica el gate** (hay que mirar dos cosas en tres sitios) y **no filtra
gratis** en la lista de admin.

**Observación del diagnóstico, sin decidir:** las dos opciones no son excluyentes, y de
hecho el repo ya combina ambas formas en otros modelos (`Listing` tiene `status` **y**
`triage`, `watched`, `needsRevalidation` — con la razón escrita: *«son preguntas distintas
y hay que poder responder a las dos a la vez»*). La pregunta real para el diseño es si
«archivado» y «sancionado» son la misma pregunta o dos. **Va a §8 (D-3).**

### 5.2 El gate: dónde tendría que mirarse

**Los tres sitios de §1.3**, sin excepción: `JwtStrategy.validate`,
`AuthService.validateCredentials` y `AuthService.loginWithGoogle`. Más los **dos huecos**
que hoy nadie cubre y que para un archivado importan más que para un baneado:
`forgotPassword` (no debería mandar correos a quien pidió irse) y el registro con un correo
`@unique` que sigue ocupado.

### 5.3 Ocultar el contenido: la parte que NO existe

Como se verificó en §1.5, `status` **no oculta nada** hoy. Que una cuenta ARCHIVED oculte
su contenido al público exige tocar superficies que nunca han mirado el estado de la
cuenta:

| Superficie | Qué habría que decidir |
|---|---|
| `GET /users/:slug` (perfil público) | ¿404, o una ficha vacía de «usuario no disponible»? |
| `GET /users/:slug/listings` | Vacío por construcción **si** los anuncios se archivan |
| Meilisearch | Se resuelve **si** los anuncios se archivan (sólo se indexan `ACTIVE`) |
| Ficha de anuncio de OTRO vendedor | Sus valoraciones y su nombre siguen ahí como autor |
| `GET /users/search` | Debe dejar de devolverlo |
| Bandeja de mensajes del **otro** | El hilo sigue vivo (bien): ¿qué nombre se pinta? |

**El camino más barato y más coherente con el molde**: archivar la cuenta **archiva sus
anuncios**, y eso arrastra caché, índice y listados sin escribir código nuevo. Lo que no
arrastra es el **perfil público**, las **valoraciones** y el **nombre en los hilos ajenos**.

### 5.4 La diferencia conceptual con BAN

Técnicamente ambos bloquean la entrada por el mismo `if`. Todo lo demás difiere:

| | **BAN** (sanción) | **ARCHIVED a petición propia** (derecho) |
|---|---|---|
| **Quién lo inicia** | El staff, contra la voluntad del usuario | El propio usuario |
| **Qué expresa** | *«te expulsamos»* | *«me voy»* |
| **Qué pasa con los datos** | **Nada.** Se conservan enteros — la sanción no es una petición de olvido | Empiezan a ocultarse, y el usuario espera que acaben borrándose |
| **Qué pasa con el contenido** | Hoy, **sigue público** (§1.5) | Debe dejar de estarlo |
| **Reversibilidad** | Reversible por ADMIN (`reinstate`) | La reversión es *otra* decisión: ¿puede alguien «volver»? |
| **Destino** | Permanecer baneado | **Cola de revisión del staff** → eliminar o mantener |
| **Obligación asociada** | Ninguna | Plazos y expectativas de supresión |
| **Quién decide el final** | El staff, siempre | El usuario inicia; el staff ejecuta |

**Y hay un tercer caso que el encargo introduce y conviene no confundir con los otros dos:
el staff archivando a un usuario desde el backoffice.** Ése tiene el *origen* de un ban (lo
decide el staff) y los *efectos sobre los datos* de un archivado (se ocultan). Es un cuarto
cuadrante que hoy no existe y que el diseño tendrá que nombrar. **Va a §8 (D-5).**

---

## 6. La exportación (RGPD)

### 6.1 Qué hay hoy: nada

Verificado por grep sobre `apps/` (`export`, `GDPR`, `RGPD`, `descargar datos`,
`exportar`): **no existe ninguna exportación de datos de usuario**, ni para el usuario ni
para el staff. Las únicas apariciones de «RGPD» en el repo son comentarios que justifican
**no** persistir la IP en `ContactMessage` y avisos de que un borrado futuro podría
destruir denuncias. Sería una capacidad **completamente nueva**.

### 6.2 Qué habría que reunir — sale directamente del inventario de §3

| Bloque | Fuentes |
|---|---|
| **Perfil** | Todas las columnas de `User` de §3.3 (menos `passwordHash` y `tokenVersion`, que son secretos y no se exportan) |
| **Anuncios** | `Listing` + `ListingImage`, `ListingTag`, atributos, vídeo, estadísticas (`viewCount`, `impressionCount`, y los diarios) |
| **Mensajería** | `Conversation` + `Message` — **con la cautela de que el hilo lleva mensajes de otra persona** |
| **Valoraciones** | `Review` **en las dos direcciones** (escritas y recibidas) |
| **Tratos** | `Deal` como vendedor y como comprador |
| **Atención al usuario** | `Ticket` + `TicketMessage` + `TicketAttachment` — **excluyendo `internal: true`**, que es la nota privada del staff (la invariante de privacidad ya está puesta en `getForUser`) |
| **Moderación** | `Report` emitidos. Los **recibidos** son dudosos: exportarlos revela quién le denunció |
| **Facturación** | `Invoice` (+ PDF), `Transaction`, `Subscription`, `Entitlement`, `Wallet`, `CreditLedger`, `BumpLedger`, `CouponRedemption` |
| **Preferencias** | `Favorite`, `Alert`, `Notification` |
| **Cuenta** | `Account` (proveedores vinculados), `lastLoginAt` / `lastLoginIp` |
| **Backoffice** *(sólo si es staff)* | `AuditLog` donde es **actor** y donde es **objeto** |

### 6.3 Lo que ya hay que reutilizar, y lo que falta decidir

**Moldes disponibles:**
- **Servir un fichero privado por endpoint autenticado**, sin URL pública: es exactamente
  lo que hacen `GET /billing/invoices/:id/pdf`
  ([`invoicing.controller.ts:54`](../apps/api/src/modules/invoicing/invoicing.controller.ts#L54))
  y la descarga de adjuntos de ticket
  ([`tickets.controller.ts:179`](../apps/api/src/modules/tickets/tickets.controller.ts#L179)),
  este último declarando el molde por escrito.
- **`R2Service.download(key)`** ya existe y se usa en ambos.
- **Trabajo pesado a BullMQ**: regla innegociable del proyecto. Una exportación completa
  con binarios **no cabe en una petición HTTP**.

**Lo que hay que decidir (a §8):** formato (JSON legible vs ZIP con binarios); si se
incluyen los ficheros o sólo enlaces; **si el hilo de mensajes se exporta entero** (lleva
texto de otra persona) o sólo lo que escribió el solicitante; si los `Report` recibidos
entran; síncrono vs por cola con aviso; y caducidad del enlace.

---

## 7. BAN vs SUSPEND — la aclaración

### 7.1 El estado real, dicho con precisión

- **Efecto: idéntico.** 403 en los tres gates; sólo cambia la cadena del mensaje.
- **Semántica: distinta y ya construida** — en el **reparto de roles**, no en el efecto:
  suspender/des-suspender es MODERATOR, banear/reinstaurar es ADMIN, y `unsuspend`
  **rechaza explícitamente** a un `BANNED`.
- **Ninguno caduca.** No hay columna de vencimiento de sanción.
- **Ninguno de los dos toca el contenido**: los anuncios de un baneado siguen públicos e
  indexados (§1.5).
- La decisión de dejarlos iguales **fue consciente y está escrita**
  ([`estado-tecnico.md:4782-4785`](./estado-tecnico.md#L4782)): *«sin un requisito de
  negocio concreto para el MVP»*. La pregunta de hoy es si ese requisito ya llegó.

### 7.2 Las opciones, sin decidir

**(a) Darles comportamiento distinto de verdad.** `SUSPENDED` = temporal y reversible,
con vencimiento (`suspendedUntil`) y levantamiento automático; `BANNED` = permanente.
- *A favor:* «suspensión» sin caducidad es una palabra que miente; hoy un suspendido
  depende de que alguien se acuerde. Y hay precedente **exacto en el propio modelo**:
  `lockedUntil`, que ya es un vencimiento comprobado en el momento del login
  ([`auth.service.ts:280-282`](../apps/api/src/modules/auth/auth.service.ts#L280)) — **sin
  cron**, porque se evalúa perezosamente al entrar.
- *En contra:* columna nueva, comprobación nueva en los gates, y decidir qué hacer con
  suspensiones ya puestas (todas indefinidas).

**(b) Consolidar en uno solo.** Un único estado bloqueado, con motivo y duración como
datos.
- *A favor:* hoy son el mismo `if` con dos mensajes; un enum con dos valores que hacen lo
  mismo invita a que alguien los use como si difirieran.
- *En contra:* **destruye el reparto de roles ya construido** (§1.4), que es una asimetría
  deliberada y útil: hay que poder dar a un moderador una sanción leve sin darle la grave.
  Y obliga a migrar datos.

**(c) Dejarlos como están y sólo documentarlo.**
- *A favor:* coste cero, ningún riesgo, y la asimetría de roles ya aporta la distinción
  práctica. Sigue el criterio del proyecto de no construir sin requisito.
- *En contra:* no arregla lo de «suspensión» sin caducidad, y ARCHIVED entra en un enum
  cuya semántica sigue siendo confusa.

**Qué añade ARCHIVED a esta decisión** (y es la razón de meterlas en el mismo cuerpo):
mientras `SUSPENDED` y `BANNED` son intercambiables, ARCHIVED **no** lo es —ni en origen,
ni en efectos sobre los datos, ni en destino (§5.4)—. Meter un valor con semántica fuerte
en un enum cuyos otros dos valores no se distinguen es lo que hace que la pregunta (a)/(b)/(c)
**tenga que responderse ahora** y no después.

---

## 8. Decisiones que el DISEÑO debe cerrar

Ninguna se resuelve aquí. Ordenadas por cuánto condicionan al resto.

| # | Decisión | Dónde está el material | Bloquea a |
|---|---|---|---|
| **D-1** | **¿Cuándo se anonimiza?** ¿Al archivar (y entonces archivar deja de ser reversible) o sólo al eliminar definitivamente? Los tres tratamientos describen el borrado; el archivado necesita su propia respuesta | §3.1 | Todo el inventario |
| **D-2** | **¿Qué significa «eliminar definitivamente»**, si `user.delete()` está bloqueado por doce `RESTRICT`, dos ledgers y un *trigger* fiscal? Es supresión selectiva, no borrado de fila | §2.3 | La ráfaga de eliminación |
| **D-3** | **¿`UserStatus.ARCHIVED`, campo `archivedAt`, o ambos?** Y qué pasa cuando ARCHIVED y una sanción coinciden | §5.1 | El gate y el modelo |
| **D-4** | **BAN vs SUSPEND: (a) diferenciar / (b) consolidar / (c) documentar** | §7.2 | El enum, y por tanto D-3 |
| **D-5** | **¿El archivado del staff es el mismo estado que el del usuario?** Mismo efecto, origen opuesto: es el cuarto cuadrante | §5.4 | El modelo y la UI |
| **D-6** | **¿Hasta dónde llega «ocultar el contenido»?** Perfil, valoraciones, nombre en hilos ajenos, buscador de usuarios. Hoy **nada** de eso mira el estado | §1.5, §5.3 | Superficies públicas |
| **D-7** | **`Review.targetId` — las valoraciones RECIBIDAS: ¿se van con él o se quedan?** | §3.5 (D-e) | Reputación |
| **D-8** | **`Review.authorId` es `Cascade`: ¿se cambia a anonimización?** Hoy irse destruye la reputación de terceros. Es el defecto más grave del inventario | §2.2, §3.2 #15 | Migración de schema |
| **D-9** | **`Deal` y `Ticket` también son `Cascade`** sobre entidades de dos dueños. ¿Mismo tratamiento que #8? | §3.2 #16-20 | Ídem |
| **D-10** | **Contradicciones schema-vs-comentario en `Entitlement` y `CouponRedemption`**: FK `Cascade` contra regla escrita de «nunca se borra» | §3.5 (D-b, D-c) | Facturación |
| **D-11** | **¿Qué pasa con el saldo** (créditos y bumps) de quien se va? | §3.5 (D-a) | Facturación |
| **D-12** | **`Post.authorId`**: ¿reasignar, anonimizar la firma, o conservar? | §3.5 (D-d) | Blog |
| **D-13** | **`DRAFT`, `PENDING_REVIEW` y `RESERVED` no son archivables.** ¿Qué pasa con esos anuncios al archivar la cuenta? Es el callejón de `diseno-borrado.md` §1.2 un nivel más arriba | §3.5 (D-h) | Ciclo de vida |
| **D-14** | **Identificadores `@unique`** (`email`, `slug`, `stripeCustomerId`): estrategia de anonimización, y qué se responde a quien intente registrarse con ese correo | §1.3, §3.3 | Auth |
| **D-15** | **`lastLoginIp` / `lastOwnerIp`**: ¿se conservan en una cuenta archivada a petición propia? | §3.5 (D-g) | Privacidad |
| **D-16** | **Snapshots que faltan**: `Report.reportedUserName` y equivalentes, para que la moderación siga siendo legible tras anonimizar. Y **se escriben al crear, no al borrar** | §3.5 (D-j) | Moderación |
| **D-17** | **Exportación**: formato, alcance de los mensajes de dos dueños, si entran los `Report` recibidos, cola vs síncrono, caducidad del enlace | §6.3 | Exportación |
| **D-18** | **`forgotPassword` no mira el estado.** ¿Se cierra en este cuerpo? | §1.3 | Auth |
| **D-19** | **Roles**: ¿archivar es MODERATOR (reversible) y eliminar ADMIN (irreversible)? El molde de anuncios ya dice que sí; conviene confirmarlo explícitamente | §2.5 | Backoffice |
| **D-20** | **¿Es ARCHIVED terminal**, como `ListingStatus.ARCHIVED`? ¿Puede el staff «desarchivar», y a qué estado vuelve? | §5.1 | Máquina de estados |

---

## Apéndice — inventario verificado

| Qué | Dónde | Dato |
|---|---|---|
| `UserStatus` | [`schema.prisma:45-50`](../apps/api/prisma/schema.prisma#L45) | Tres valores: `ACTIVE`, `SUSPENDED`, `BANNED` |
| Enum físico | [`init:8`](../apps/api/prisma/migrations/20260620100046_init/migration.sql#L8) | Nunca ampliado |
| Gate 1 (cada petición) | [`jwt.strategy.ts:37-40`](../apps/api/src/modules/auth/strategies/jwt.strategy.ts#L37) | 403, estado leído fresco de la BD |
| Gate 2 (login correo/panel) | [`auth.service.ts:290-293`](../apps/api/src/modules/auth/auth.service.ts#L290) | Después de verificar la contraseña |
| Gate 3 (login Google) | [`auth.service.ts:436-439`](../apps/api/src/modules/auth/auth.service.ts#L436) | Mismo `if` duplicado |
| `forgotPassword` sin gate | [`auth.service.ts:359-374`](../apps/api/src/modules/auth/auth.service.ts#L359) | No selecciona `status` |
| Transiciones | [`admin.controller.ts:166-210`](../apps/api/src/modules/admin/admin.controller.ts#L166) | suspend/unsuspend MODERATOR; ban/reinstate ADMIN |
| Único escritor de estado | [`admin.service.ts:2935-2964`](../apps/api/src/modules/admin/admin.service.ts#L2935) | Lee → actualiza → `AuditLog` con `before`/`after`/`ip` |
| `unsuspend` rechaza `BANNED` | [`admin.service.ts:1554-1563`](../apps/api/src/modules/admin/admin.service.ts#L1554) | La asimetría de roles, hecha cumplir |
| Cero borrado de usuarios | `apps/api/src` | Ni un `prisma.user.delete`; sólo en tests |
| FKs a `User` | `schema.prisma` + SQL de migraciones | **34**: 16 Cascade · 12 Restrict · 6 SetNull |
| Cascada bloqueada | §2.3 | 11 `RESTRICT` de primer nivel + ledgers + *trigger* de factura |
| Ledgers `RESTRICT` sobre `Wallet` | [`20260626000001:73`](../apps/api/prisma/migrations/20260626000001_add_wallet_and_bump/migration.sql#L73) · [`20260715110525:43`](../apps/api/prisma/migrations/20260715110525_bump_balance_and_bump_coupons/migration.sql#L43) | Bloqueo de segundo nivel |
| Inmutabilidad fiscal en BD | [`20260727000001:16-36`](../apps/api/prisma/migrations/20260727000001_invoice_immutability_guard/migration.sql#L16) | `BEFORE UPDATE OR DELETE` sobre `Invoice` |
| `Review.author/target` pasaron a Cascade | [`20260624130000:30,33`](../apps/api/prisma/migrations/20260624130000_add_review_fields/migration.sql#L30) | En `init` eran `RESTRICT` |
| Archivar anuncio | [`listings.service.ts:820-835`](../apps/api/src/modules/listings/listings.service.ts#L820) | Guarda + `update` + `invalidateAndReindex` |
| `ARCHIVABLE_STATUSES` | [`listings.service.ts:812-818`](../apps/api/src/modules/listings/listings.service.ts#L812) | Excluye `DRAFT`, `PENDING_REVIEW`, `RESERVED` |
| Eliminar anuncio (staff) | [`admin.service.ts:1233-1311`](../apps/api/src/modules/admin/admin.service.ts#L1233) | Cargar → guarda `ARCHIVED` → delete → `AuditLog` → Redis/Meili → R2 |
| ADMIN-only, con su porqué | [`admin.controller.ts:132-149`](../apps/api/src/modules/admin/admin.controller.ts#L132) | Excepción deliberada en sección MODERATOR |
| La válvula del callejón | [`listings.service.ts:1122-1161`](../apps/api/src/modules/listings/listings.service.ts#L1122) | `discardDraft()`, sólo `DRAFT`, con otro nombre |
| Claves de R2 de un anuncio | [`media-keys.ts:70-90`](../apps/api/src/infra/r2/media-keys.ts#L70) | Original + miniatura derivada + vídeo + póster |
| Limpieza comprueba la BD antes | [`media-cleanup.service.ts:107-126`](../apps/api/src/modules/media-cleanup/media-cleanup.service.ts#L107) | Mira también la **clave desnuda** (`Invoice.pdfKey`) |
| Perfil público sin gate | [`users.service.ts:177-196`](../apps/api/src/modules/users/users.service.ts#L177) | No mira `status` |
| Anuncios del vendedor sin gate | [`listings.service.ts:1295-1312`](../apps/api/src/modules/listings/listings.service.ts#L1295) | Filtra `ACTIVE`, no el estado del vendedor |
| Vendedor congelado en el índice | [`search.service.ts:53-57`](../apps/api/src/modules/search/search.service.ts#L53) | `sellerName`, `sellerSlug`, `sellerAvatarUrl` |
| Ficha de usuario del backoffice | [`admin.service.ts:1390-1546`](../apps/api/src/modules/admin/admin.service.ts#L1390) | Anuncios, denuncias (dadas y recibidas), valoraciones (ambos lados), tickets, IP, `AuditLog` |
| Cero exportación | `apps/` | Sin coincidencias de export/GDPR/RGPD de datos |
| Molde de fichero privado | [`invoicing.controller.ts:54`](../apps/api/src/modules/invoicing/invoicing.controller.ts#L54) · [`tickets.controller.ts:179`](../apps/api/src/modules/tickets/tickets.controller.ts#L179) | Endpoint autenticado + `R2Service.download` |
| Decisión escrita sobre ban/suspend | [`estado-tecnico.md:4780-4805`](./estado-tecnico.md#L4780) | «sin un requisito de negocio concreto para el MVP» |
| Doc desfasada | [`estado-tecnico.md:418-419`](./estado-tecnico.md#L418) | Describe el borrado de anuncios **anterior** a B1 |
