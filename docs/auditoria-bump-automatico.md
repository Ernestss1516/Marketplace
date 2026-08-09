# Auditoría — BUMP AUTOMÁTICO (proyecto 2)

**Tipo:** inventario y viabilidad. **No** diseña, **no** implementa y **no** toma
decisiones: las saca a la superficie con sus alternativas para que se resuelvan en el
diseño.

**Feature auditada:** el propietario de un anuncio puede automatizar los bumps —programar
que se apliquen solos por frecuencia (y, si se puede, hora y día)— mientras tenga
créditos o saldo de bumps.

Todo lo que sigue está verificado contra el código de `main` (`9f8abe2`). Cada afirmación
lleva `fichero:línea`. Donde algo **no** existe, se dice que no existe y se indica qué se
comprobó para saberlo.

---

## Resumen ejecutivo

El bump automático es, técnicamente, **un cron que llama a una función que ya existe**. La
operación base (`BillingService.bump`) es atómica, valida todo lo que hay que validar y
resuelve por sí sola de dónde sale el pago. El repo ya tiene un patrón de cron maduro
—tres en producción— con reloj inyectado y un molde de idempotencia. Y UXV.4 dejó el hueco
de UI escrito con nombre y apellidos.

Lo que hay que inventar es **poco pero delicado**: un modelo de programación (no existe
nada reutilizable), la política de qué pasa cuando se acaba el saldo, y —el punto que más
condiciona el diseño— **la idempotencia y la unicidad de ejecución**, porque este cron
gasta dinero del usuario. Los tres crons actuales pueden ejecutarse dos veces sin daño;
este no.

Hay además una decisión que estrangula a todas las demás y conviene resolver primero: **si
la granularidad incluye "hora del día", el cron diario que usa el repo no sirve** y hay que
elegir entre subirlo a frecuencia horaria o cambiar de mecanismo.

---

# A. INVENTARIO — qué YA existe

Clasificación usada:
**[REUSA]** sirve tal cual · **[ADAPTA]** existe pero hay que tocarlo ·
**[NO EXISTE]** hay que crearlo.

## A.1 — El bump manual: la operación que se va a automatizar

`BillingService.bump(listingId, userId)` — [billing.service.ts:574](../apps/api/src/modules/billing/billing.service.ts#L574). **[REUSA]**

Es el corazón de la feature y está en muy buen estado para ser llamado por un scheduler.
Lo que hace, en orden:

| Paso | Dónde | Qué hace |
|---|---|---|
| Carga el anuncio | [:578-583](../apps/api/src/modules/billing/billing.service.ts#L578) | `select` de `id, slug, status, sellerId, bumpedAt` |
| Valida existencia | [:584](../apps/api/src/modules/billing/billing.service.ts#L584) | `NotFoundException` |
| Valida propiedad | [:585](../apps/api/src/modules/billing/billing.service.ts#L585) | `ForbiddenException` si `sellerId !== userId` |
| Valida estado | [:586-588](../apps/api/src/modules/billing/billing.service.ts#L586) | solo `ACTIVE` |
| Valida cooldown | [:600-610](../apps/api/src/modules/billing/billing.service.ts#L600) | `429` con `retryAfter` si `bumpedAt` cae dentro de la ventana |
| Resuelve coste | [:612-622](../apps/api/src/modules/billing/billing.service.ts#L612) | Setting `bumpCreditCost` (default 5) menos descuento de campaña activa |
| Cobra y escribe | [:626-709](../apps/api/src/modules/billing/billing.service.ts#L626) | **una sola `$transaction`** |
| Reindexa | [:712](../apps/api/src/modules/billing/billing.service.ts#L712) | encola en `QUEUE_INDEXING` |
| Invalida caché | [:721](../apps/api/src/modules/billing/billing.service.ts#L721) | `del(listingCacheKey(slug))` |

**El cobro tiene tres niveles encadenados dentro de la misma transacción**, en orden
deliberado (primero lo que se pierde, luego lo gratis permanente, luego lo pagado) —
[:553-567](../apps/api/src/modules/billing/billing.service.ts#L553):

1. **Cuota mensual Pro** — [:630-657](../apps/api/src/modules/billing/billing.service.ts#L630). Crea `BumpLedger` tipo `PRO_QUOTA` con `amount: 0` (marcador contable, no movimiento de saldo — [:642-645](../apps/api/src/modules/billing/billing.service.ts#L642)).
2. **Saldo de bumps** (`Wallet.bumpBalance`) — [:659-681](../apps/api/src/modules/billing/billing.service.ts#L659). `UPDATE … WHERE bumpBalance >= 1` atómico + `BumpLedger` tipo `BUMP_DEBIT` con `amount: -1`.
3. **Créditos** — [:683-708](../apps/api/src/modules/billing/billing.service.ts#L683). `UPDATE … WHERE balance >= creditCost`; si afecta 0 filas lanza **`402 Insufficient credits`** ([:688-690](../apps/api/src/modules/billing/billing.service.ts#L688)).

**Lo que esto significa para el bump automático:** el scheduler **no necesita replicar nada
de la lógica de cobro ni de validación**. Llama a `bump()` y recibe
`{ bumpedAt, paidWith, cost }` o una excepción tipada. El `402` es exactamente la señal de
"se acabó el saldo" que la decisión C.2 necesita, y llega sin escribir una línea nueva.

**Deuda ya inventariada que el bump-auto agrava** — [:590-594](../apps/api/src/modules/billing/billing.service.ts#L590): la comprobación de cooldown lee `bumpedAt` **fuera** de la transacción, así que dos peticiones concurrentes sobre el mismo anuncio podrían pasarla ambas. Hoy hace falta que el usuario pulse dos veces a la vez; con un scheduler concurrente deja de ser hipotético (ver **D.3**).

**Endpoint HTTP:** `POST /listings/:id/bump` — [listings.controller.ts:148-152](../apps/api/src/modules/listings/listings.controller.ts#L148). El scheduler debe llamar al **servicio**, no al endpoint.

**Efecto en búsqueda:** `sortDate = max(publishedAt, bumpedAt)` — [search.service.ts:525-527](../apps/api/src/modules/search/search.service.ts#L525), ordenación por defecto `sortDate:desc` ([:170-171](../apps/api/src/modules/search/search.service.ts#L170)). Es lo que hace que un bump reflote el anuncio; el bump-auto lo hereda sin tocar nada.

## A.2 — Colas y jobs: cuál es el patrón del repo

### Lo que hay

**Siete colas BullMQ** — [queue.constants.ts:1-7](../apps/api/src/infra/queue/queue.constants.ts#L1): `image-processing`, `indexing`, `notifications`, `billing`, `redsys`, `alert-matching`, `invoicing`.

Con opciones de reintento compartidas — [:16-21](../apps/api/src/infra/queue/queue.constants.ts#L16): `attempts: 3`, backoff exponencial 2 s. Y un helper `retryQueue(name)` ([:28-30](../apps/api/src/infra/queue/queue.constants.ts#L28)) que **un test de estructura obliga a usar**: `queue-retry.e2e-spec.ts` rastrea `src/` buscando cualquier `registerQueue()` que lo esquive y rompe la suite si lo encuentra ([:23-27](../apps/api/src/infra/queue/queue.constants.ts#L23)). Una cola nueva del bump-auto tendría que pasar por ahí.

### El mecanismo de jobs recurrentes: `@nestjs/schedule`, NO BullMQ repeatable **[REUSA]**

Esto es lo que se pidió verificar con atención, y el resultado es inequívoco.

`ScheduleModule.forRoot()` — [app.module.ts:64](../apps/api/src/app.module.ts#L64). **Tres crons en producción**, todos con `@Cron`:

| Cron | Fichero:línea | Horario |
|---|---|---|
| Expiración de anuncios (RF.7) | [expiration.service.ts:24](../apps/api/src/modules/expiration/expiration.service.ts#L24) | `EVERY_DAY_AT_2AM` |
| Caducidad de entitlements | [entitlement-expiration.service.ts:30](../apps/api/src/modules/expiration/entitlement-expiration.service.ts#L30) | `0 3 * * *` |
| Facturación automática | [invoicing-schedule.service.ts:44](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L44) | `0 4 * * *` |
| Auto-cierre de tickets | [tickets-schedule.service.ts:47](../apps/api/src/modules/tickets/tickets-schedule.service.ts#L47) | `0 5 * * *` |

(Son cuatro `@Cron`; "tres crons" en el sentido de tres dominios — expiración cuenta dos.)

**BullMQ repeatable jobs: NO se usan en ninguna parte.** Verificado buscando
`repeat:`, `repeatable`, `upsertJobScheduler` y `JobScheduler` en todo `apps/api/src` — cero
resultados. **Tampoco se usan jobs con `delay:`** (misma búsqueda, cero resultados fuera de
`backoff`). El repo programa con `@Cron` y usa BullMQ solo para trabajo **disparado**, nunca
temporizado.

### El molde de cron, que está muy bien definido

`InvoicingScheduleService` es el molde declarado, y `TicketsScheduleService` lo dice
explícitamente ([tickets-schedule.service.ts:25-27](../apps/api/src/modules/tickets/tickets-schedule.service.ts#L25)). Tiene cuatro propiedades que el bump-auto debería heredar:

1. **El `@Cron` es fino y delega en un método público que RECIBE la fecha** — [invoicing-schedule.service.ts:44-47](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L44), [tickets-schedule.service.ts:47-50](../apps/api/src/modules/tickets/tickets-schedule.service.ts#L47). La lógica nunca llama a `new Date()` por dentro, y por eso se puede probar cualquier instante sin esperar al reloj. *(Este es exactamente el arreglo que se hizo en la deuda de `tickets-cron.e2e-spec.ts`.)*
2. **El trabajo pesado va a cola, nunca inline en el cron** — [:22-23](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L22) y [:115-121](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L115): el cron **selecciona y encola**, el processor ejecuta.
3. **Recuperación por estado, no por calendario** — [:25-29](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L25): en vez de "¿hoy es el día?", pregunta "¿hay trabajo pendiente?". Si el servidor estuvo caído, al arrancar lo detecta.
4. **Idempotencia explícita, con dos moldes distintos según el caso**:
   - **Por estado de la fila** (tickets) — [tickets-schedule.service.ts:56-64](../apps/api/src/modules/tickets/tickets-schedule.service.ts#L56): un ticket ya cerrado deja de casar el `WHERE`. El estado *es* la marca; añadir un Setting de "última corrida" sería estado redundante.
   - **Por marca + clave única** (facturación) — `Setting` `fiscalInvoicingLastPeriod` ([:15](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L15), [:161-167](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L161)) + `jobId` estable para el dedup de BullMQ ([:116-121](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L116)) + `Invoice.idempotencyKey @unique` en base de datos ([schema.prisma:2048](../apps/api/prisma/schema.prisma#L2048)). Triple guard, porque emitir dos facturas es grave.

**El bump-auto está en la categoría "grave": gasta dinero.** El molde de facturación es el
que le corresponde, no el de tickets (ver **D.3**).

### Primitiva de deduplicación en Redis **[REUSA]**

`SET … EX … NX` — [listings.service.ts:1168-1177](../apps/api/src/modules/listings/listings.service.ts#L1168), usado para deduplicar visitas. Es una cerradura con expiración ya en uso en el repo; sirve como candado de ejecución si el diseño lo necesita.

## A.3 — Créditos y saldo de bumps

**Tres bolsas distintas**, y el bump las consume en orden fijo (A.1):

| Bolsa | Modelo | Se agota | Notas |
|---|---|---|---|
| Cuota mensual Pro | contada sobre `BumpLedger` | sí, cada periodo | límite en Setting `proMonthlyBumpQuota` |
| Saldo de bumps | `Wallet.bumpBalance` — [schema.prisma:1386](../apps/api/prisma/schema.prisma#L1386) | sí, al gastarlo | gratis y **permanente**, no caduca |
| Créditos | `Wallet.balance` — [schema.prisma:1373](../apps/api/prisma/schema.prisma#L1373) | sí, al gastarlos | de pago |

- **Cuota Pro:** `EntitlementService.hasAvailableBumpQuota` — [entitlement.service.ts:243-272](../apps/api/src/modules/billing/entitlement.service.ts#L243). Bloquea la `Subscription` con `SELECT … FOR UPDATE` ([:251-253](../apps/api/src/modules/billing/entitlement.service.ts#L251)) y cuenta los `BumpLedger` de tipo `PRO_QUOTA` desde `currentPeriodStart` ([:263-269](../apps/api/src/modules/billing/entitlement.service.ts#L263)).
- **Invariante contable:** `wallet.bumpBalance == SUM(BumpLedger.amount)` — [schema.prisma:1369-1371](../apps/api/prisma/schema.prisma#L1369), [:204-206](../apps/api/prisma/schema.prisma#L204). Un bump automático tiene que respetarlo; llamando a `bump()` lo respeta gratis.
- **Packs de bumps** (5/15/40) — `BumpPack` [schema.prisma:1349](../apps/api/prisma/schema.prisma#L1349); bonus Pro al comprar vía Setting `proExtraBumpsPercent`.
- **Tipos de movimiento:** `BumpLedgerType` — [schema.prisma:197-226](../apps/api/prisma/schema.prisma#L197). **No hay un tipo que distinga un bump automático de uno manual** (ver B.4 y C.6).

**Qué pasa hoy si no hay saldo:** `HttpException('Insufficient credits', 402)` — [billing.service.ts:688-690](../apps/api/src/modules/billing/billing.service.ts#L688). Nada más: no hay aviso, ni pausa, ni reintento. Es una respuesta HTTP a un clic. **Lo que el scheduler haga con ese 402 es la decisión C.2, y hoy no existe ninguna política.**

## A.4 — El cooldown

`BUMP_COOLDOWN_SECONDS = 3600` (**1 hora**) — [bump-cooldown.ts:18](../apps/api/src/modules/billing/bump-cooldown.ts#L18). **[REUSA]**

Fichero creado en UXV.1 como **fuente única**: antes había tres verdades distintas sobre
"¿puedo volver a bumpear?" ([:4-8](../apps/api/src/modules/billing/bump-cooldown.ts#L4)). El backend la aplica y la **expone ya resuelta** como `nextBumpAt`, para que el frontend solo compare contra `Date.now()` ([:10-14](../apps/api/src/modules/billing/bump-cooldown.ts#L10)).

`nextBumpAt(bumpedAt)` — [:29-34](../apps/api/src/modules/billing/bump-cooldown.ts#L29). Expuesto en las dos superficies de propietario: ficha ([listings.service.ts:909](../apps/api/src/modules/listings/listings.service.ts#L909)) y lista ([listings.service.ts:1090](../apps/api/src/modules/listings/listings.service.ts#L1090)).

**Cómo lo consultaría el scheduler:** no necesita consultarlo. `bump()` ya lo aplica y
devuelve `429` con `retryAfter`. Para *evitar* llamadas condenadas al fallo puede
prefiltrar en SQL (`bumpedAt IS NULL OR bumpedAt <= now - 3600s`) usando la misma constante
importada — nunca un literal.

**Nota del propio fichero, escrita pensando en esta feature** ([:13-14](../apps/api/src/modules/billing/bump-cooldown.ts#L13)): *«Cambiar la política (p. ej. cooldown por plan, cuando llegue el bump automático) es cambiar este fichero, no cuatro sitios.»* El seam existe y está anotado.

## A.5 — La superficie que dejó UXV.4

Los tres huecos están **escritos y comentados en el código**, no supuestos:

1. **El punto de entrada — el menú `▾`** — [PromocionarControl.tsx:134-156](../apps/web/src/components/anuncios/owner/PromocionarControl.tsx#L134). Comentario [:37-39](../apps/web/src/components/anuncios/owner/PromocionarControl.tsx#L37): *«EL SITIO DEL BUMP AUTOMÁTICO (proyecto 2) ES ESE MENÚ ▾. Está ahí precisamente para que "Programar bumps…" sea una entrada más, junto a "Destacar anuncio…", sin volver a tocar la jerarquía de la tarjeta.»* Hoy tiene dos entradas ([:147-154](../apps/web/src/components/anuncios/owner/PromocionarControl.tsx#L147)). **[ADAPTA]** — añadir una tercera.
   - **Matiz que el diseño debe resolver:** el menú `▾` **solo se pinta cuando el bump es gratis y no hay cooldown** ([:117-118](../apps/web/src/components/anuncios/owner/PromocionarControl.tsx#L117), `unClic`). En el otro camino ([:158-173](../apps/web/src/components/anuncios/owner/PromocionarControl.tsx#L158)) hay un botón único que abre el diálogo, **sin menú**. Un usuario sin saldo —justo el que más querría programar— no tiene hoy por dónde entrar.
2. **La zona de estado — "Próximo bump: …"** — [PromotionStatus.tsx:51](../apps/web/src/components/anuncios/owner/PromotionStatus.tsx#L51), literalmente `{/* AQUÍ va «Próximo bump: …» cuando llegue el bump automático. */}`. El componente se declaró zona multi-línea por este motivo ([:8-12](../apps/web/src/components/anuncios/owner/PromotionStatus.tsx#L8)). **[ADAPTA]** — añadir una línea y una prop.
3. **La lógica compartida de promoción** — [promocion.ts](../apps/web/src/components/anuncios/owner/promocion.ts): `resolveBumpOffer` ([:42](../apps/web/src/components/anuncios/owner/promocion.ts#L42)) ya calcula de qué bolsa saldría el próximo bump, y `canPromote` ([:101-103](../apps/web/src/components/anuncios/owner/promocion.ts#L101)) ya define que solo `ACTIVE` admite promoción. **[REUSA]** para anticipar en la UI qué pagará la programación.

También existe `PromocionarDialog.tsx` (el diálogo con los dos productos) y `OwnerActionsMenu.tsx` (el menú de acciones no promocionales). El diálogo es un candidato natural para alojar la configuración, pero eso ya es diseño.

## A.6 — El modelo de datos: **no hay nada reutilizable**

Revisados **los 60 modelos del esquema** (`grep "^model"` sobre `schema.prisma`). **No
existe ninguna tabla de tareas programadas, trabajos diferidos ni recurrencias.**
**[NO EXISTE]**

Lo más cercano, y por qué no sirve:

| Modelo | Qué tiene | Por qué no vale |
|---|---|---|
| `Campaign` [:1472](../apps/api/prisma/schema.prisma#L1472) | ventana de fechas + `params` jsonb | promoción global de plataforma, no del usuario; ventana única, no recurrencia |
| `Coupon` [:1520](../apps/api/prisma/schema.prisma#L1520) | validez temporal | canje puntual |
| `Entitlement` [:1128](../apps/api/prisma/schema.prisma#L1128) | derecho con caducidad | expira, no se repite |
| `Subscription` [:1180](../apps/api/prisma/schema.prisma#L1180) | `currentPeriodStart` | ciclo de cobro externo (Stripe), no programable por el usuario |
| `Setting` [:1012](../apps/api/prisma/schema.prisma#L1012) | clave→Json global | es configuración de plataforma, no por anuncio |

`Listing` [:551-629](../apps/api/prisma/schema.prisma#L551) tiene `bumpedAt` ([:599](../apps/api/prisma/schema.prisma#L599)) pero **ninguna** relación ni campo de programación.

Hay que crear un modelo nuevo. La forma exacta (campos, si cuelga de `Listing` o de `User`,
si `nextRunAt` es columna materializada o se calcula) es **diseño**, no inventario.

## A.7 — El canal de notificación

Existe y es **doble**. **[REUSA]**

**In-app persistente:** modelo `Notification` — [schema.prisma:675-695](../apps/api/prisma/schema.prisma#L675). `type` es `String` a propósito, **no un enum**, de modo que **añadir un tipo nuevo no requiere migración** ([notification.types.ts:6-7](../apps/api/src/modules/notifications/notification.types.ts#L6): *«SIN migración: `Notification.type` es String a propósito»*). Diez tipos hoy ([:1-17](../apps/api/src/modules/notifications/notification.types.ts#L1)).

Regla invariante que un tipo nuevo debe respetar: **`data` es un snapshot autocontenido**, con nombres ya resueltos y nunca ids que haya que resolver al pintar — [schema.prisma:681-687](../apps/api/prisma/schema.prisma#L681), [notification.types.ts:60-66](../apps/api/src/modules/notifications/notification.types.ts#L60). Un aviso de bump debe sobrevivir al borrado del anuncio.

API: `createNotification(userId, type, data)` — [notifications.service.ts:36-44](../apps/api/src/modules/notifications/notifications.service.ts#L36). Tipado por tipo vía el mapa `DataByType` ([:18-29](../apps/api/src/modules/notifications/notifications.service.ts#L18)).

**Email:** `NotificationProcessor` sobre `QUEUE_NOTIFICATIONS` con **Resend** — [notification.processor.ts:6,30-33](../apps/api/src/infra/queue/processors/notification.processor.ts#L6). Diez jobs registrados en `NOTIFICATION_JOB` — [notification.types.ts:1-14](../apps/api/src/infra/queue/notification.types.ts#L1).

**Molde de doble canal:** `TicketNotificationsService` crea la notificación in-app **y** encola el email — [ticket-notifications.service.ts:87,117,123](../apps/api/src/modules/tickets/ticket-notifications.service.ts#L87). El cron de facturación usa solo in-app ([invoicing-schedule.service.ts:138-141](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L138)).

**Frontend:** campana + página — [NotificationBell.tsx](../apps/web/src/components/notifications/NotificationBell.tsx), [notificaciones/](../apps/web/src/app/(account)/notificaciones/). El texto de cada tipo se resuelve en un `switch` — [notification-content.ts:9-71](../apps/web/src/components/notifications/notification-content.ts#L9). **[ADAPTA]**: un tipo nuevo necesita su `case` aquí o no se pintará.

**Conclusión:** el canal persistente que un bump nocturno necesita **ya existe**. El toast
(sonner, canal único de UXV.3) es para acciones en vivo y no sirve aquí — correcto en la
premisa de la auditoría.

## A.8 — Feature flags de admin

**Existe el mecanismo, con un flag booleano ya en producción.** **[ADAPTA]**

- Whitelist de claves editables: `SETTING_KEYS` — [admin.service.ts:47-87](../apps/api/src/modules/admin/admin.service.ts#L47). Una clave fuera de la lista se rechaza ([:1201-1204](../apps/api/src/modules/admin/admin.service.ts#L1201)).
- Validación por familias: `POSITIVE_INT_SETTING_KEYS` ([:99-110](../apps/api/src/modules/admin/admin.service.ts#L99)), `PERCENT_SETTING_KEYS` ([:115](../apps/api/src/modules/admin/admin.service.ts#L115)).
- **Precedente booleano:** `contactRequiresVerification`, sembrado como `true` ([seed.ts:454](../apps/api/prisma/seed.ts#L454)) y editado con un `Switch` en el backoffice ([ajustes/page.tsx:253](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L253), [:554](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L554)).

Un `bumpAutoEnabled` seguiría un camino ya trillado. **Ojo:** no hay familia de validación
booleana; hoy el booleano pasa sin validación de tipo específica.

---

# B. LOS HUECOS — qué falta construir

| # | Pieza | Estado | Notas |
|---|---|---|---|
| B.1 | **Modelo de programación** (`BumpSchedule` o similar) | **[NO EXISTE]** | Nada reutilizable en 60 modelos (A.6). Migración Prisma nueva. |
| B.2 | **El cron que ejecuta** | **[NO EXISTE]**, pero con molde | `@nestjs/schedule` + molde de `InvoicingScheduleService`. **Su periodicidad depende de C.1/C.4.** |
| B.3 | **Guard de idempotencia** | **[NO EXISTE]** | Ningún mecanismo actual protege un gasto recurrente. Ver D.3. |
| B.4 | **Trazabilidad automático vs. manual** | **[NO EXISTE]** | `BumpLedgerType` [:197-226](../apps/api/prisma/schema.prisma#L197) no distingue origen; `CreditLedger.referenceType` es `'Listing'` en ambos casos ([billing.service.ts:651,675,701](../apps/api/src/modules/billing/billing.service.ts#L651)). Sin esto no se puede responder "¿este cobro lo pedí yo?". |
| B.5 | **Política de saldo agotado** | **[NO EXISTE]** | Hoy solo un `402` sin consecuencias (A.3). Decisión C.2. |
| B.6 | **Tipo de notificación + su `case` en el frontend** | **[ADAPTA]** | Sin migración (A.7); requiere entrada en `NotificationType`, en `DataByType`, y en `notification-content.ts`. |
| B.7 | **UI de configuración** | **[ADAPTA]** | Entrada en el menú `▾` + formulario. **Hueco real:** el menú no se pinta sin saldo (A.5). |
| B.8 | **Línea "Próximo bump"** | **[ADAPTA]** | Hueco literal en [PromotionStatus.tsx:51](../apps/web/src/components/anuncios/owner/PromotionStatus.tsx#L51) + prop nueva + exponerla en el payload de propietario (junto a `nextBumpAt`, [listings.service.ts:909,1090](../apps/api/src/modules/listings/listings.service.ts#L909)). |
| B.9 | **Gestión (ver/editar/cancelar)** | **[NO EXISTE]** | Endpoints CRUD + pantalla. Si son varias, ¿una pantalla propia en la zona de cuenta? El shell de UXV.2 admite entradas nuevas (`ACCOUNT_NAV`). |
| B.10 | **Limpieza al cambiar el anuncio de estado** | **[NO EXISTE]** | Si el anuncio se archiva, vende, expira o se modera, ¿qué pasa con su programación? Hay hooks (`ListingActivationService`, cron de expiración) donde engancharlo. |
| B.11 | **Flag de admin** | **[ADAPTA]** | Camino trillado (A.8), si se decide que sí (C.7). |

---

# C. DECISIONES DE DISEÑO — propuestas, para que Ernest decida

> Ninguna está tomada. Cada una lleva opciones y su contrapartida.

## C.1 — Granularidad de la frecuencia

**Dato duro:** el cooldown es **1 hora** ([bump-cooldown.ts:18](../apps/api/src/modules/billing/bump-cooldown.ts#L18)). Técnicamente permite hasta un bump por hora. Nada más lo limita.

| Opción | A favor | En contra |
|---|---|---|
| **a) Cada N días** (1–30) | Modelo trivial (`intervalDays`); el cron diario existente vale sin tocar nada | No permite "los lunes", ni hora |
| **b) Semanal con día(s)** | Encaja con cómo se piensa la venta ("finde") | Necesita almacenar días; sigue sin hora salvo que se fije una |
| **c) Diario/semanal con hora** | Lo que pidió el usuario ("si se puede, hora y día") | **Obliga a cron horario o más fino** (B.2) y abre C.4 (zona horaria) |
| **d) Expresión cron libre** | Máxima potencia, cero modelo nuevo de recurrencia | Inaceptable de cara al usuario; permite abusos rozando el cooldown |

**Lo que conviene saber al decidir:** el salto de coste real no está entre (a) y (b) —ambos
viven con el cron diario— sino entre (b) y (c). Con (c) el cron pasa a despertarse cada
hora y el volumen de ejecuciones se multiplica por 24.

**Segunda pregunta dentro de esta:** ¿el mínimo del bump-auto es el cooldown (1 h) o algo
mayor? Permitir "cada hora" automático significa 24 bumps/día, ~120 créditos/día al precio
por defecto. Un mínimo mayor para lo automático (p. ej. 12 h o 1 día) es defendible como
protección tanto del usuario como del orden del catálogo.

## C.2 — Qué pasa cuando se acaba el saldo *(pregunta explícita del usuario)*

**Punto de partida:** hoy `bump()` lanza `402` ([billing.service.ts:688-690](../apps/api/src/modules/billing/billing.service.ts#L688)) y nadie escucha. Además el orden de consumo ya encadena cuota Pro → saldo de bumps → créditos, así que "quedarse sin saldo" solo ocurre cuando **las tres** bolsas están vacías.

| Opción | A favor | En contra |
|---|---|---|
| **a) Pausar + notificar** | No destruye la configuración; reanudable con un clic tras recargar; el aviso reengancha (y es una palanca comercial honesta) | Necesita estado `PAUSED` y una forma de reanudar |
| **b) Cancelar (borrar)** | Simplísimo | Hostil: el usuario pierde lo que configuró por quedarse a cero un día |
| **c) Seguir intentando en silencio** | Se recupera solo si recarga | Reintentos indefinidos contra la base; el usuario no se entera de nada |
| **d) Fallo silencioso, sin marca** | Nada que construir | **El peor**: el usuario cree que sigue activo. Contradice UXV.3 (feedback), que existió justo para cerrar silencios así |

**Recomendación implícita del repo:** (a) es la única coherente con el precedente de
`INVOICING_PENDING_FISCAL_DATA` ([invoicing-schedule.service.ts:128-142](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L128)), donde el cron detecta que no puede hacer su trabajo, **avisa** y deja la puerta abierta.

**Sub-decisiones que arrastra (a):**
- ¿Se avisa **antes** de agotarse ("te queda 1 bump programado")? Requiere mirar el saldo, no solo reaccionar al fallo.
- ¿Se reanuda **sola** al recargar saldo, o hay que reactivarla a mano? Automática es más cómoda pero puede sorprender: se recargan créditos para otra cosa y empiezan a gastarse solos.

## C.3 — Límites y quién puede usarlo

El usuario dijo *«siempre que tengan créditos»*, lo que sugiere que **no** es exclusivo de
Pro. Conviene confirmarlo porque condiciona el valor del plan.

| Eje | Opciones |
|---|---|
| **¿Solo Pro?** | (a) todos con saldo — coherente con lo dicho, más ingresos por créditos · (b) solo Pro — palanca de suscripción, pero contradice la frase · (c) todos, con más frecuencia para Pro |
| **Programaciones por usuario** | (a) sin límite · (b) tope global · (c) tope solo para no-Pro |
| **Por anuncio** | Casi con seguridad **una** — dos programaciones sobre el mismo anuncio compiten por el mismo cooldown |

**Referencia:** los límites configurables existentes viven en `Setting` con validación de
entero positivo ([admin.service.ts:99-110](../apps/api/src/modules/admin/admin.service.ts#L99)) — un `maxBumpSchedulesPerUser` seguiría ese molde.

**Nota que acaba de aprender el proyecto:** si el límite Pro y el gratuito son ambos
configurables, cualquier texto que los compare debe **derivarlo**, no afirmarlo (ver el
arreglo de la línea de `/planes` en `9f8abe2`).

## C.4 — Hora y día: la zona horaria

**Hallazgo relevante:** **no hay ninguna gestión de zona horaria en el backend.** Verificado buscando `timeZone`, `TZ` y `Europe/Madrid` en todo `apps/api/src` — cero resultados. Los cuatro `@Cron` corren en la zona del proceso, sin declararla. `@nestjs/schedule` **sí** admite `timeZone` en las opciones; simplemente no se usa.

| Opción | A favor | En contra |
|---|---|---|
| **a) Sin hora — solo frecuencia** | Elimina el problema entero | No es lo que se pidió |
| **b) Hora en la zona del servidor** | Barato: fijar `timeZone: 'Europe/Madrid'` en el `@Cron` | Miente al usuario fuera de esa zona; el marketplace es español, así que el daño es acotado |
| **c) Hora en la zona del usuario** | Correcto de verdad | `User` **no tiene** campo de zona horaria (verificado en [schema.prisma:298](../apps/api/prisma/schema.prisma#L298)): hay que añadirlo, capturarlo y mantenerlo. Y el horario de verano hace que "las 9:00" se mueva |
| **d) Hora del servidor, mostrada explícitamente** | Honesto y barato: "se aplicará sobre las 9:00 (hora peninsular)" | Sigue sin ser la hora del usuario |

**Aviso de precisión:** con un cron horario, "las 9:00" significa realmente "en la pasada de
las 9:00". El diseño debería decidir si eso se promete como hora exacta o como franja — y
si la UI lo redacta en consecuencia.

## C.5 — Colisión con el bump manual

**Lo que ya está resuelto:** el cooldown lo aplica `bump()` sin distinguir origen ([billing.service.ts:600-610](../apps/api/src/modules/billing/billing.service.ts#L600)). Un manual reciente hará que el automático reciba `429`. **No hay riesgo de doble bump por esta vía**; la pregunta es de comportamiento, no de seguridad.

| Opción | A favor | En contra |
|---|---|---|
| **a) El automático se salta el turno** (429 → se ignora, siguiente según calendario) | Trivial; el usuario ya obtuvo su bump | Pierde el turno pagado sin avisar |
| **b) Se reintenta poco después** | No se pierde el turno | ¿Cuánto después? Puede acumular reintentos |
| **c) Se recalcula el calendario desde el bump manual** | Intuitivo: "cada 3 días desde el último bump, lo diera quien lo diera" | Cambia la semántica de "los lunes" a "cada N días", incompatible con C.1(b/c) |

**Observación:** (c) solo es coherente si la frecuencia es "cada N días". Con "los lunes a
las 9:00", recalcular no significa nada.

## C.6 — Notificación de cada bump aplicado

Canal disponible y adecuado (A.7). La pregunta es **cuánto** avisar.

| Opción | A favor | En contra |
|---|---|---|
| **a) Nada por bump; solo incidencias** (sin saldo, pausada) | Cero ruido; es lo que el usuario configuró para no tener que enterarse | Un cobro recurrente sin rastro visible salvo en el historial |
| **b) Notificación in-app por cada bump** | Trazabilidad completa | Con frecuencia alta, inunda la campana |
| **c) Resumen periódico** ("esta semana: 3 bumps, 15 créditos") | Buen equilibrio | Otro cron más |
| **d) In-app siempre + email solo en incidencias** | Aprovecha el molde de doble canal | Mismo riesgo de ruido que (b) |

**Dependencia con B.4:** cualquier opción distinta de (b) exige que el **historial** distinga los bumps automáticos, y hoy no los distingue. Si no se resuelve, el usuario ve créditos gastados sin poder saber por qué.

## C.7 — Flag de admin

**Propuesta: sí**, por dos razones concretas — es una feature que **gasta dinero de los
usuarios de forma desatendida** (un fallo se multiplica por cada programación activa), y el
mecanismo ya existe con precedente booleano (A.8), así que el coste es bajo.

| Opción | A favor | En contra |
|---|---|---|
| **a) Flag global `bumpAutoEnabled`** | Interruptor de emergencia; permite lanzar en apagado | Una clave más |
| **b) Sin flag** | Menos superficie | Ante un fallo, la única salida es desplegar |
| **c) Flag + límite configurable** | Control fino sin desplegar | Más claves |

**Pregunta que el diseño debe responder si se elige (a):** al apagar el flag, ¿las
programaciones existentes se **pausan** (y se reanudan al reencender) o se **ignoran en
silencio**? No es lo mismo para el usuario.

## C.8 — Decisiones que aparecieron al inventariar *(no estaban en el guion)*

**C.8.1 — La entrada de UI para quien no tiene saldo.** El menú `▾` solo se pinta si el bump es gratis y no hay cooldown ([PromocionarControl.tsx:117-118](../apps/web/src/components/anuncios/owner/PromocionarControl.tsx#L117)). Justamente el usuario sin saldo —el que más motivos tiene para programar y comprar créditos— no lo ve. Opciones: pintar el menú siempre; meter "Programar" dentro del `PromocionarDialog`; o darle sitio propio en la zona de cuenta.

**C.8.2 — Qué pasa con la programación si el anuncio deja de ser `ACTIVE`.** `bump()` exige `ACTIVE` ([:586-588](../apps/api/src/modules/billing/billing.service.ts#L586)) y `canPromote` lo replica en la UI ([promocion.ts:101-103](../apps/web/src/components/anuncios/owner/promocion.ts#L101)). Un anuncio puede pasar a `EXPIRED` por el cron ([expiration.service.ts:24](../apps/api/src/modules/expiration/expiration.service.ts#L24)), a `SOLD`, a archivado o ser moderado. ¿La programación se pausa, se borra o simplemente falla cada vez? Sin decidirlo, quedan programaciones zombis intentándolo a diario para siempre.

**C.8.3 — Un cambio de precio no avisa.** `bumpCreditCost` es un Setting editable ([admin.service.ts:59](../apps/api/src/modules/admin/admin.service.ts#L59)) y `bump()` lo lee **en vivo** en cada llamada ([billing.service.ts:612-615](../apps/api/src/modules/billing/billing.service.ts#L612)). Alguien que programó a 5 créditos puede acabar pagando 8 sin enterarse. ¿Se congela el precio al programar, se avisa del cambio, o se acepta que es en vivo?

**C.8.4 — ¿Cuenta la cuota Pro para lo automático?** El orden de consumo gastaría primero la cuota mensual Pro ([:630-657](../apps/api/src/modules/billing/billing.service.ts#L630)). Una programación activa puede agotarla entera antes de que el usuario quiera usarla a mano en el anuncio que le interesa. ¿El bump-auto consume el mismo orden, o empieza por los créditos y deja la cuota para lo manual?

---

# D. VIABILIDAD Y RIESGOS

**Veredicto de viabilidad: alto.** La operación base es sólida y reutilizable sin tocarla, el
patrón de cron está maduro y probado, y el canal de notificación existe. El grueso del
riesgo no está en construirlo sino en **tres puntos concretos**, todos conocidos y
abordables.

## D.1 — Ejecución duplicada por múltiples instancias 🔴 *el riesgo mayor*

`@nestjs/schedule` corre **dentro del proceso**. Con N instancias del API, **los cuatro
crons actuales se ejecutan N veces**. Hoy no pasa nada porque cada uno es idempotente por
diseño: el de tickets porque el estado de la fila es la marca ([tickets-schedule.service.ts:56-64](../apps/api/src/modules/tickets/tickets-schedule.service.ts#L56)); el de facturación por triple guard ([invoicing-schedule.service.ts:112-121](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L112) + `idempotencyKey @unique`).

**Un bump automático sin protección se cobraría N veces.**

Verificado: **no existe ningún lock distribuido para crons** en el repo (búsqueda de
`acquireLock`, `redlock`, `setnx` sobre `apps/api/src` — el único `NX` es el dedup de
visitas, [listings.service.ts:1175](../apps/api/src/modules/listings/listings.service.ts#L1175)).

Caminos que el diseño puede tomar (no excluyentes): candado Redis `SET NX EX` alrededor de
la pasada, reutilizando la primitiva que ya existe · `jobId` estable en BullMQ, como
facturación · una **clave única en base de datos** por `(scheduleId, slotProgramado)`, que
es el guard que de verdad no se puede esquivar.

## D.2 — El cooldown como red de seguridad (y su agujero)

**A favor:** el cooldown de 1 h ([bump-cooldown.ts:18](../apps/api/src/modules/billing/bump-cooldown.ts#L18)) actúa como limitador natural. Aunque la programación se disparase de más, `bump()` rechazaría con `429` cualquier intento dentro de la hora. Es una segunda línea de defensa gratuita.

**El agujero, ya inventariado en el propio código** ([billing.service.ts:590-594](../apps/api/src/modules/billing/billing.service.ts#L590)): la comprobación lee `bumpedAt` **fuera** de la transacción. Dos ejecuciones simultáneas pueden pasar ambas el guard antes de que ninguna confirme su `UPDATE`. Hoy exige un doble clic simultáneo; con N instancias disparando el mismo cron **al mismo segundo**, es el caso normal, no el raro.

**Consecuencia para el diseño:** el cooldown **no** puede ser la única protección contra el
doble cobro (D.1). O se cierra la carrera moviendo la comprobación dentro de la transacción,
o el guard fuerte vive en otro sitio.

## D.3 — Idempotencia del job

Si el bump-auto encola trabajo, `RETRY_JOB_OPTIONS` da **3 intentos** con backoff ([queue.constants.ts:16-21](../apps/api/src/infra/queue/queue.constants.ts#L16)). Un reintento tras un fallo **parcial** (la transacción confirmó pero el proceso murió antes de marcar el job como completado) volvería a cobrar.

**El cooldown lo absorbe casi siempre** —el reintento llega segundos después y choca con la
ventana de 1 h—, pero "casi siempre" no basta para dinero. El molde correcto es el de
facturación: marca persistente + clave única, no confiar en el reintento.

**Pregunta abierta para el diseño:** ¿la unidad de idempotencia es el *slot programado*
(`schedule + instante previsto`) o el *día*? La primera es más precisa y soporta frecuencias
altas; la segunda es más simple pero rompe si se permite más de un bump al día.

## D.4 — Carga

Riesgo **bajo, pero con una punta evitable**. Con "todos los lunes a las 9:00", todas las
programaciones caen en el mismo minuto. Cada bump son: una transacción Postgres con
`SELECT … FOR UPDATE` sobre `Subscription` ([entitlement.service.ts:251-253](../apps/api/src/modules/billing/entitlement.service.ts#L251)), un job de reindexado ([billing.service.ts:712](../apps/api/src/modules/billing/billing.service.ts#L712)) y un `DEL` en Redis ([:721](../apps/api/src/modules/billing/billing.service.ts#L721)).

El indexado tiene concurrencia 5 y está calibrado con mediciones ([queue.constants.ts:36-48](../apps/api/src/infra/queue/queue.constants.ts#L36)), así que absorbe picos; la cola es precisamente el amortiguador. Mitigaciones posibles: el cron **selecciona y encola**, nunca ejecuta inline (molde de facturación, [invoicing-schedule.service.ts:22-23](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L22)); y, si hiciera falta, repartir dentro de una franja en vez de un instante.

## D.5 — Riesgos menores, pero que conviene anotar

- **Zona horaria** (C.4): sin campo en `User` y sin `timeZone` en ningún `@Cron`. El horario de verano desplaza cualquier hora prometida.
- **Programaciones zombis** (C.8.2): sin limpieza al cambiar de estado el anuncio, quedan intentos diarios condenados a fallar para siempre.
- **Precio en vivo** (C.8.3): `bumpCreditCost` se relee en cada bump; una subida se aplica a programaciones ya configuradas sin avisar.
- **Trazabilidad** (B.4): sin distinguir el origen en el ledger, el usuario ve créditos gastados y no puede reconstruir por qué. Es también un futuro problema de soporte.
- **Caducidad del anuncio:** un anuncio expira a los 60 días — constante `EXPIRY_DAYS` ([expiration.service.ts:9](../apps/api/src/modules/expiration/expiration.service.ts#L9)), aplicada en `ExpirationService.expiresAt` ([:50-52](../apps/api/src/modules/expiration/expiration.service.ts#L50)). Una programación puede sobrevivir a su propio anuncio.

### Hallazgo colateral (fuera del alcance, pero conviene anotarlo)

**El ajuste `listingExpiryDays` no lo lee nadie.** Está sembrado con valor 60 ([seed.ts:453](../apps/api/prisma/seed.ts#L453), [seed-test.ts:82](../apps/api/prisma/seed-test.ts#L82)), whitelisted para edición ([admin.service.ts:49](../apps/api/src/modules/admin/admin.service.ts#L49)) y **editable desde el backoffice** ([ajustes/page.tsx:481,530-535](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L530)) — pero la caducidad real sale de la constante `EXPIRY_DAYS`. Verificado buscando `listingExpiryDays` en todo `apps/api/src` y `apps/web/src`: **ninguna lectura**, solo la whitelist y la UI. Un admin puede cambiarlo, ver que se guarda, y no cambiar nada.

Es exactamente la misma clase de defecto que se acaba de cerrar en `/planes` (`9f8abe2`): un valor configurable que no gobierna el comportamiento que aparenta gobernar. **No se toca aquí** —queda fuera del alcance de esta auditoría—, pero es relevante para el diseño del bump automático por dos razones: es el precedente de que en este repo un `Setting` puede quedar desconectado sin que nada lo delate, y si el bump-auto añade ajustes propios (C.3, C.7) conviene que cada uno nazca con una prueba que demuestre que **de verdad** gobierna algo, como la que se escribió para la línea de `/planes`.

---

## Para el diseño: el orden que sugiere el inventario

No es un plan —eso es el diseño— sino la constatación de qué decisiones bloquean a otras:

1. **C.1 (granularidad)** condiciona B.1 (modelo), B.2 (periodicidad del cron) y C.4 (zona horaria). Decidirla primero ahorra rehacer.
2. **C.2 (sin saldo)** define estados del modelo y el tipo de notificación (B.6). Va inmediatamente después.
3. **D.1/D.3 (idempotencia)** no es negociable y debe estar en el diseño desde el principio, no como remate: condiciona el esquema (clave única) y el cron.
4. El resto (C.3, C.5, C.6, C.7, C.8) afina, pero no bloquea la estructura.

## Nota final sobre el alcance de esta auditoría

Todo lo verificable se verificó contra el código. Donde se afirma que algo **no existe**
—repeatable jobs, jobs con `delay`, modelo de programación, lock distribuido, zona horaria,
distinción automático/manual en el ledger, campo de zona horaria en `User`— se indicó la
búsqueda concreta que lo respalda, para que sea comprobable y no haya que fiarse.

Las decisiones de la sección C están **propuestas, no tomadas**. Donde se ha señalado que
una opción encaja mejor con el repo (C.2 y C.7), se ha dicho por qué y con qué precedente,
pero la elección es de Ernest.
