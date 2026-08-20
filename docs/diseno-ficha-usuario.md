# Diseño — La ficha de usuario (P2): ver todo, Pro manual y saldo

> **Tercer cuerpo de administración.** Se apoya en roles (R1-R4), la ficha de
> anuncio (F1+F2), la etiqueta interna (P1) y `AuditLog`, todos en `main`.
> Origen: [`auditoria-backoffice-administracion.md`](./auditoria-backoffice-administracion.md).
>
> **Documento de diseño. Cero código.** El apéndice lleva el inventario con
> fichero y línea.

---

## 0. El inventario cambia el diagnóstico

La auditoría dijo que hay **dos fuentes de verdad de «es Pro» que divergen**:
`isProActive` mirando el `Entitlement` y `getFeaturedQuotaStatus` mirando la
`Subscription`. Se ha hecho el grep exhaustivo, y el resultado obliga a
reformular el problema — para bien, porque el arreglo es mucho más pequeño de lo
que parecía y el peligro real está en otro sitio.

### 0.1 Los lectores del HECHO: siete, y los siete ya son correctos

| # | Dónde | Para qué |
|---|---|---|
| 1 | `active-listing-limit.rule.ts:64` | Cuota de anuncios activos |
| 2 | `total-listing-limit.rule.ts:85` | Cuota total de anuncios |
| 3 | `listings.service.ts:1514` | Estadísticas del vendedor |
| 4 | `listings.service.ts:1539` | Estadísticas del vendedor |
| 5 | `redsys.service.ts:306` | Bonus Pro al comprar un pack |
| 6 | `users.service.ts:76` | La insignia Pro del perfil público |
| 7 | `video.service.ts:242` | La puerta del vídeo Pro |

**Los siete pasan por `ProStatusService.isProActive`, que lee el `Entitlement`.**
No hay una segunda implementación: `EntitlementService.isProActive` **delega** en
ella, y su propio comentario explica por qué («dos implementaciones de "¿es Pro?"
podrían divergir y nadie se enteraría»). Ese trabajo ya está hecho.

### 0.2 Lo que sí está acoplado a `Subscription`: tres funciones, un fichero

| Dónde | Qué hace | Qué pasa sin `Subscription` |
|---|---|---|
| `entitlement.service.ts:111` `getFeaturedQuotaStatus` | Cuota mensual de destacados y bumps | **Devuelve `isPro: false`** |
| `entitlement.service.ts:205` `hasAvailableFeaturedQuota` | ¿Queda destacado gratis? | `return false` en silencio |
| `entitlement.service.ts:250` `hasAvailableBumpQuota` | ¿Queda bump gratis? | `return false` en silencio |

Y las tres leen **el mismo `Entitlement` que los otros siete**. No preguntan por
la procedencia: piden la `Subscription` porque necesitan un **PERIODO DE
FACTURACIÓN** con el que contar la cuota mensual (`createdAt >= currentPeriodStart`).

### 0.3 El defecto reformulado

> No son dos fuentes de verdad de «es Pro». **La cuota mensual necesita un
> periodo, el único periodo que el sistema sabe producir viene de la suscripción
> de pago, y el código expresa «no hay periodo» como «no es Pro».**

Es un defecto más pequeño y más preciso: está en **una línea** de
`getFeaturedQuotaStatus` (devolver `isPro: false` en la rama sin suscripción) y
en dos `return false` silenciosos. Y el propio código ya sospechaba: el comentario
dice *«should not happen — `ensureProEntitlement` always links a Subscription»*.
El Pro manual convierte ese «no debería pasar» en el caso normal.

**Táctica que decide el conteo:** no hay que redirigir lectores —los siete ya
apuntan bien—. Hay que **separar dos preguntas que hoy comparten una respuesta**:
«¿es Pro?» y «¿tiene periodo de cuota?».

### 0.4 El peligro que el inventario destapa, y que nadie había nombrado

Las tres funciones acopladas hacen `findFirst(... activeFilter())` con
`orderBy: { createdAt: 'desc' }`: **se quedan con el entitlement PRO más
reciente**. Si un usuario tiene los dos —uno de pago y uno manual concedido
después—, cogerían el manual, verían `subscriptionId = null` y responderían «sin
cuota»… **a un usuario que está pagando**.

Es decir: introducir el Pro manual, tal cual, **rompería la cuota de usuarios de
pago**. No es hipotético — es la consecuencia directa de esas tres líneas de
`orderBy`. Cualquier diseño que no lo resuelva está introduciendo una regresión
en el camino que sí genera ingresos.

---

## 1. Bloque 1 — El modelo de «es Pro»

### 1.1 La fuente única: el `Entitlement`, que ya lo era

`Entitlement` con `type = PRO_SUBSCRIPTION` y **vigente** =
`revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now())`. Es lo que ya
usan los siete lectores.

El Pro manual es **la misma fila** con `subscriptionId = null` y un `expiresAt`
elegido por el staff. No hace falta ni un modelo nuevo ni una columna para
representarlo: `subscriptionId` ya es nullable y `expiresAt` ya existe.

### 1.2 La procedencia se DERIVA, no se guarda

```
procedencia = subscriptionId === null ? 'MANUAL' : 'PAID'
```

**Por qué derivarla y no añadir un `source`.** Porque `ensureProEntitlement`
—único creador del Pro de pago— **siempre** enlaza una `Subscription`, así que
`subscriptionId` ya contiene la respuesta. Una columna `source` sería una segunda
verdad que puede desincronizarse de la primera.

Este proyecto ya tomó exactamente esta decisión y la escribió, sobre el vídeo:

> *«`hasVideo` NO es una columna: se deriva de `videoUrl != null`. Guardar el
> booleano aparte crearía dos verdades que pueden desincronizarse.»*

Lo que **sí** hay que guardar es el «quién y por qué» de la concesión, y eso no
es una columna del entitlement: es `AuditLog` (§2.2).

### 1.3 Lo que se descarta, con su motivo

**La `Subscription` sintética** —crear una suscripción falsa para que el Pro
manual tenga periodo— se descarta, y no por elegancia: `billing.service.ts:130`
bloquea suscribirse si existe una `Subscription` `ACTIVE` o `CANCELING`. Una
sintética haría que el usuario **no pudiera suscribirse de verdad**, con el
mensaje «Ya tienes un plan Pro activo». Se le regalaría Pro tres meses y se le
cerraría la puerta a pagar. Es una consecuencia verificada, no un riesgo teórico.

### 1.4 La cuota mensual: el hecho y el periodo, separados

Las tres funciones acopladas se corrigen así:

1. **«¿Es Pro?» se responde con el entitlement**, siempre. `getFeaturedQuotaStatus`
   deja de devolver `isPro: false` cuando hay Pro pero no hay periodo.
2. **«¿Hay periodo de cuota?» se responde con la `Subscription`**, y su ausencia
   se dice explícitamente (`quotaSource: 'NONE'` o equivalente) en vez de
   disfrazarse de «no es Pro».
3. **La búsqueda del periodo prefiere el entitlement CON suscripción**, no el más
   reciente — que es lo que cierra el peligro de §0.4.

Con eso, un Pro manual es Pro para los siete lectores (cuotas de anuncios, vídeo,
insignia, bonus) y su cuota mensual de destacados/bumps se informa como **no
aplicable** en vez de mentir.

### 1.5 Coexistencia

| Caso | Respuesta |
|---|---|
| Manual + pago a la vez | **Es Pro** (cualquier entitlement vigente basta) y **la cuota sale del de pago** (§1.4.3) |
| Caduca el manual, sigue el de pago | Sigue siendo Pro, sin cambio observable |
| Caduca el de pago, sigue el manual | Sigue siendo Pro **sin cuota mensual** |
| Un Pro manual quiere suscribirse | **Puede**: no hay `Subscription`, así que la guarda de `billing.service.ts:130` no salta. Correcto — y es exactamente lo que la suscripción sintética habría roto |

**La caducidad ya está resuelta y no hace falta cron nuevo.** Se evalúa **al
leer** (`expiresAt > now()` dentro de `activeFilter`), así que un Pro manual
caduca solo. Y `entitlement-expiration.service.ts` —que avisa y degrada al perder
Pro— filtra por `type` y `expiresAt` **sin exigir suscripción**, de modo que
trata un Pro manual caducado igual que uno de pago. Hay que **verificarlo con un
test**, no darlo por hecho.

---

## 2. Bloque 2 — Conceder y revocar el Pro manual

### 2.1 La forma

Conceder = crear un `Entitlement` `PRO_SUBSCRIPTION` con `expiresAt` obligatorio.
Revocar = poner `revokedAt`, **no borrar**: el registro de que se concedió es
parte de la historia y `activeFilter` ya lo excluye.

**`expiresAt` obligatorio, sin opción de «para siempre».** El modelo admite
`expiresAt: null` (Pro perpetuo), y precisamente por eso conviene que el endpoint
no lo permita: un beneficio de pago regalado sin fecha es una fuga que nadie
vuelve a mirar. Si algún día hace falta, se concede otra vez.

### 2.2 El rol y la traza

**ADMIN.** Es regalar un producto de pago, que es la misma clase de acción que
`grantCredits` —ya `@MinRole(Role.ADMIN)` a nivel de clase en
`AdminBillingController`—. Se sigue ese precedente en vez de inventar otro.

**`AuditLog` obligatorio**, con acciones nuevas `PRO_GRANT` y `PRO_REVOKE`:
quién, a quién, hasta cuándo y **por qué**. El motivo es texto obligatorio, como
en `CreditGrantDto` (`@MinLength(5)`), y vive en el registro de auditoría, no en
el entitlement: el «por qué» es historia de una decisión, no un atributo del
derecho concedido.

---

## 3. Bloque 3 — Créditos y bumps

### 3.1 Lo que ya existe (más de lo que parecía)

`POST /admin/billing/users/:userId/credits` **está construido**: ADMIN, motivo
obligatorio de 5-500 caracteres, escribe `CreditLedger` de tipo `ADMIN_CREDIT` y
deja `AuditLog` con acción `ADMIN_CREDIT_GRANT`. Y hay una pantalla,
`/admin/facturacion/usuarios/[id]`, con el monedero, los entitlements, las
transacciones y el formulario de concesión.

### 3.2 Lo que falta

| | Estado |
|---|---|
| Dar créditos | ✅ construido |
| **Dar bumps** | ❌ no existe, aunque `BumpLedgerType.ADMIN_CREDIT` sí |
| **Quitar (débito)** | ❌ no existe: `CreditGrantDto` tiene `@Min(1)`. `ADMIN_DEBIT` existe en los dos enums y **no lo escribe nadie** |

El saldo de bumps es una moneda aparte (`Wallet.bumpBalance`, `BumpLedger`), así
que dar bumps es el mismo molde sobre la otra columna — no un caso especial.

### 3.3 La pregunta de producto: ¿se puede quitar lo que el usuario pagó?

**Hay una respuesta técnica antes que la de producto, y la acota.** El monedero
es un **escalar** (`Wallet.balance Int`): el ledger registra los movimientos, pero
el saldo restante **no sabe de dónde vino cada unidad**. No hay lotes. Así que
«quitar sólo los créditos concedidos y nunca los comprados» **no es
implementable** sin rediseñar el monedero a lotes con procedencia — un trabajo
mucho mayor que este cuerpo.

Con eso delante, las opciones reales son dos:

| | |
|---|---|
| **(a) No quitar nunca** | Lo que hay hoy (`@Min(1)`). Los errores se arreglan sumando, no restando |
| **(b) Quitar con traza, sin distinguir origen** | Un `ADMIN_DEBIT` con motivo obligatorio y suelo en cero. Honesto: no se puede prometer «sólo lo regalado» |

**Recomendación: (b)**, porque el caso que la motiva es real y no tiene otra
salida — una concesión equivocada (un cero de más) hoy no se puede deshacer. Con
motivo obligatorio, `AuditLog` y la imposibilidad de dejar el saldo negativo, el
riesgo está acotado. Pero es **decisión de producto** y va señalada (§7, **D-2**).

---

## 4. Bloque 4 — Ver todo

### 4.1 El hallazgo estructural: ya hay DOS vistas por usuario

| | Sección | Rol | Qué muestra |
|---|---|---|---|
| `/admin/usuarios` (panel desplegable) | `usuarios` | **MODERATOR** | Identidad, últimos anuncios, reportes recibidos, `AuditLog` |
| `/admin/facturacion/usuarios/[id]` | `facturacion` | **ADMIN** | Monedero, ledger, entitlements, transacciones, conceder créditos |

**El reparto no es un accidente: el dinero es ADMIN y la moderación es
MODERATOR.** Cualquier «ficha única que lo muestre todo» tiene que decidir qué
hacer con eso, y las tres salidas no son equivalentes:

- hacer la ficha ADMIN → el moderador pierde lo que hoy tiene;
- hacer la ficha MODERATOR con el dinero dentro → **se ensancha** quién ve saldos
  y pagos, hoy restringido;
- **ficha MODERATOR, bloque de dinero sólo para ADMIN** → se conserva el reparto.

**Recomendación: la tercera.** Es el patrón que F1 ya estableció con el botón de
eliminar («la UI no le promete al moderador algo que le va a responder 403»),
aplicado a una sección entera en vez de a un botón. Y el bloque de dinero muestra
un **resumen** (¿es Pro?, procedencia, vencimiento, saldos) con enlace a
`/admin/facturacion/usuarios/[id]` para el detalle — no se duplica la pantalla que
ya existe.

### 4.2 Qué muestra la ficha

| Sección | Contenido | ¿De dónde? |
|---|---|---|
| **Cabecera** | Nombre, email, slug, rol, estado (activo/suspendido/baneado), alta, `trusted`, `requiresReview` | `getUserById`, ya lo trae |
| **Anuncios** | Los suyos, **con enlace a la ficha de anuncio** — cierra el círculo con F1 | ya lo trae |
| **Reportes** | Recibidos; y los **emitidos** por él, que hoy no se muestran y dicen mucho de un denunciante compulsivo | ampliar |
| **Valoraciones** | Dadas y recibidas | ampliar |
| **Tickets** | Los suyos | ampliar |
| **Pro** *(sólo ADMIN)* | ¿Es Pro?, **procedencia** (pagó / se lo dieron), vencimiento, y las acciones de §2 | nuevo |
| **Saldo** *(sólo ADMIN)* | Créditos y bumps, con las acciones de §3 y enlace al ledger completo | nuevo |
| **Historial** | `AuditLog` del usuario | ya lo trae |

### 4.3 Ruta propia, y el enlace de F1

**`/admin/usuarios/[id]`**, por las mismas razones que la ficha de anuncio: sin
URL no se puede enlazar desde otras pantallas, y el panel desplegable no tiene
sitio para nueve secciones. Hereda `MODERATOR` **por segmento**, sin fila nueva en
el mapa.

F1 enlaza hoy a `/admin/usuarios?q={email}&destacado={id}`. Se re-apunta a
`/admin/usuarios/{id}`: **una línea** en la ficha de anuncio. La promesa que F1
hizo —«P2 lo redirige después sin tocar esta pantalla»— se cumple en lo que
importaba: no hay que rediseñar nada, sólo cambiar el destino.

---

## 5. Los permisos, sobre la fuente única

- **Ver** la ficha: sección `usuarios` → **MODERATOR**, heredado por segmento.
- **Actuar** sobre moderación (suspender, banear, `trusted`, `requiresReview`):
  como hoy. `requires-review` y el cambio de rol ya son ADMIN.
- **Ver y actuar sobre dinero** (Pro manual, créditos, bumps): **ADMIN**,
  conservando el reparto actual (§4.1).

Es el patrón «ver MODERATOR, actuar ADMIN» que roles ya soporta, con un matiz que
este cuerpo añade y conviene decir en voz alta: **para el dinero, ver también es
ADMIN**.

---

## 6. El plan de ráfagas

Tres, y el orden no es negociable: la primera es un arreglo transversal que deja
el sistema coherente **antes** de construir encima, igual que B1 en el cuerpo de
borrado.

### U1 — «Es Pro» deja de depender de tener suscripción

Separar el hecho del periodo en las tres funciones de `EntitlementService`, y
hacer que la búsqueda del periodo **prefiera el entitlement con suscripción**.
Sin UI, sin conceder nada todavía.

**Barreras:**
1. Un entitlement PRO **sin** `Subscription` (creado a mano en el test) es Pro
   para **los siete lectores**: cuotas de anuncios, vídeo, insignia pública,
   bonus de pack.
2. Ese mismo usuario recibe una cuota mensual **declarada como no aplicable**, no
   un `isPro: false`.
3. **La regresión que U1 existe para impedir:** un usuario con Pro de pago **y**
   Pro manual más reciente conserva su cuota mensual íntegra.
4. Un Pro manual caducado es tratado por `entitlement-expiration.service` igual
   que uno de pago.

Al terminar, `main` es coherente y nada visible ha cambiado.

### U2 — Conceder/revocar Pro manual, y el saldo (backend)

`PRO_GRANT` / `PRO_REVOKE` con `expiresAt` obligatorio y motivo; dar bumps; el
débito si se aprueba **D-2**. Todo ADMIN y todo con `AuditLog`.

**Barreras:** conceder deja al usuario Pro y **caduca solo** al pasar la fecha;
revocar lo quita en el acto; cada acción deja registro con su actor y su motivo;
el débito nunca deja el saldo negativo.

### U3 — La ficha

`/admin/usuarios/[id]` con sus secciones, el bloque de dinero sólo para ADMIN,
las acciones de U2, y el re-apuntado del enlace de F1.

**Barreras:** un MODERATOR ve la ficha y **no ve** el bloque de dinero; un ADMIN
sí; desde la ficha de un anuncio se llega a la de su vendedor; conceder Pro desde
la ficha se refleja y aparece en el historial.

---

## 7. Decisiones abiertas

| # | Decisión | Recomendación |
|---|---|---|
| **D-1** | ¿El Pro manual da cuota mensual de destacados/bumps? | **No, en U1.** El staff concede *las capacidades* de Pro (límites, vídeo, insignia); las gratuidades mensuales están atadas a un ciclo de facturación que no existe. Inventar un periodo mensual sobre una concesión de seis meses es un producto nuevo, no un arreglo. **Es decisión de producto**: si la respuesta es «sí», U1 crece con una ventana rodante desde `startsAt` |
| **D-2** | ¿El staff puede QUITAR saldo? | **Sí, con motivo obligatorio y suelo en cero.** «Sólo lo regalado» **no es implementable**: el monedero es un escalar sin lotes (§3.3). Decisión de producto porque toca dinero de usuarios |
| **D-3** | ¿El bloque de dinero se muestra a MODERATOR? | **No.** Hoy ver saldos ya es ADMIN, y la ficha no debe ensanchar eso de rebote |
| **D-4** | ¿`expiresAt` obligatorio al conceder Pro? | **Sí.** El modelo admite perpetuo y por eso conviene que el endpoint no lo ofrezca |
| **D-5** | ¿Se añade `source` al `Entitlement`? | **No**: se deriva de `subscriptionId` (§1.2), con el precedente de `hasVideo` |

### Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | **El Pro manual rompe la cuota de un usuario de pago** (§0.4) | Es la barrera 3 de U1, y por eso U1 va sola y primero |
| 2 | Que quede un lector de «es Pro» sin inventariar | El inventario es exhaustivo y está en el apéndice; la barrera 1 de U1 los recorre **uno por uno** |
| 3 | Regalar Pro sin fecha y no volver a mirarlo | `expiresAt` obligatorio (D-4) |
| 4 | Quitar saldo comprado sin poder distinguirlo | Se dice explícitamente que no se puede distinguir (§3.3) en vez de prometer un filtro que no existe |
| 5 | Duplicar la pantalla de facturación en la ficha | La ficha resume y **enlaza**; el detalle sigue viviendo en `/admin/facturacion/usuarios/[id]` |

### Lo que este cuerpo NO hace

- No rediseña el monedero a lotes con procedencia (§3.3).
- No inventa periodos de facturación para el Pro manual (D-1).
- No toca Redsys, Stripe ni el flujo de pago real.
- No mueve la sección de facturación ni cambia su rol.

---

## Apéndice — inventario verificado

| Qué | Dónde | Dato |
|---|---|---|
| **Los 7 lectores del hecho** | `active-listing-limit.rule.ts:64` · `total-listing-limit.rule.ts:85` · `listings.service.ts:1514,1539` · `redsys.service.ts:306` · `users.service.ts:76` · `video.service.ts:242` | **Todos** vía `isProActive` → `Entitlement` |
| Una sola implementación | [`pro-status.service.ts:51`](../apps/api/src/modules/listing-gate/pro-status.service.ts#L51) | `EntitlementService.isProActive` **delega**; su comentario ya avisaba de la divergencia |
| **Las 3 acopladas a `Subscription`** | [`entitlement.service.ts:111`](../apps/api/src/modules/billing/entitlement.service.ts#L111) · `:205` · `:250` | Leen el MISMO entitlement; piden la suscripción por el **periodo** |
| El síntoma visible | `entitlement.service.ts:123` | `if (!proEntitlement?.subscription)` → `isPro: false`, con el comentario *«should not happen»* |
| **El peligro no nombrado** | `entitlement.service.ts:117, 209, 254` | `orderBy: { createdAt: 'desc' }` → el manual más reciente taparía la cuota del de pago |
| El modelo ya admite el Pro manual | `schema.prisma`, `Entitlement` | `subscriptionId String?`, `expiresAt DateTime?`, `revokedAt DateTime?` |
| La caducidad se evalúa AL LEER | `pro-status.service.ts` → `activeFilter()` | `revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now())` — sin cron |
| Y el aviso de caducidad no exige suscripción | [`entitlement-expiration.service.ts:113`](../apps/api/src/modules/expiration/entitlement-expiration.service.ts#L113) | Filtra por `type` y `expiresAt` |
| La suscripción sintética se descarta por esto | [`billing.service.ts:130`](../apps/api/src/modules/billing/billing.service.ts#L130) | `ALREADY_SUBSCRIBED` bloquearía pagar de verdad |
| El precedente de derivar la procedencia | `schema.prisma`, `Listing.videoUrl` | *«`hasVideo` NO es una columna […] crearía dos verdades»* |
| Dar créditos YA existe | [`admin-billing.controller.ts:50`](../apps/api/src/modules/admin/admin-billing.controller.ts#L50) · `admin-billing.service.ts:184` | ADMIN, motivo 5-500, `ADMIN_CREDIT` + `AuditLog: ADMIN_CREDIT_GRANT` |
| Sólo suma | `credit-grant.dto.ts` | `@Min(1)` — no hay débito |
| `ADMIN_DEBIT` existe y no lo escribe nadie | `schema.prisma`, ambos enums | Enum sin escritor |
| El monedero es un escalar | `schema.prisma`, `Wallet` | `balance Int`, `bumpBalance Int` — sin lotes: no se puede saber qué unidad se compró |
| Las dos vistas por usuario | `backoffice-sections.ts:101` y `:105` | `usuarios` **MODERATOR** · `facturacion` **ADMIN** |
| Lo que ve hoy el MODERATOR | `admin.service.ts` → `getUserById` | Identidad, `trusted`, `requiresReview`, anuncios, reportes recibidos, `AuditLog`. **Sin dinero** |
| El enlace de F1 a re-apuntar | [`anuncios/[id]/page.tsx:682`](../apps/web/src/app/(admin)/admin/anuncios/[id]/page.tsx#L682) | `/admin/usuarios?q={email}&destacado={id}` |
