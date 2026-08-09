# Diseño — BUMP AUTOMÁTICO (proyecto 2)

Documento **aprobable**, no implementación. Cero código: lo que aquí hay son formas,
contratos y razones. Base: [`auditoria-bump-automatico.md`](auditoria-bump-automatico.md)
(viabilidad alta, inventario verificado).

Dos entregables:

1. **Arquitectura técnica** — modelo, scheduler, concurrencia resuelta en sus dos capas, cableado a la UI.
2. **11 decisiones de producto** — cada una con opciones, contrapartida y **recomendación**, para confirmar **en bloque** (§ [Hoja de confirmación](#hoja-de-confirmación)).

Los moldes citados están verificados contra `main` (`a8c5da0`).

---

## Principio rector

> **El scheduler no sabe cobrar. Sabe *cuándo*.**

Todo lo que es "hacer un bump" —validar, elegir bolsa, cobrar, escribir, reindexar,
invalidar caché— ya vive en [`BillingService.bump`](../apps/api/src/modules/billing/billing.service.ts#L574) y **no se replica**. El proyecto añade tres cosas y ninguna más: **cuándo** tocaba, **que no se haga dos veces**, y **qué hacer cuando falla**.

De ahí sale el resto del diseño. Si en algún punto este documento propusiera duplicar
lógica de cobro, estaría mal.

---

# ENTREGABLE 1 — ARQUITECTURA TÉCNICA

## A. El modelo de datos

Dos tablas nuevas. La segunda no estaba en el guion y **es la pieza que resuelve a la vez
la idempotencia y la trazabilidad** que la auditoría señaló como hueco (B.4).

### A.1 — `BumpSchedule` — la programación

La intención del usuario. Una fila = "este anuncio, cada tanto, a tal hora".

| Campo | Tipo | Papel | Depende de |
|---|---|---|---|
| `id` | `String @id @default(cuid())` | — | — |
| `listingId` | `String` + relación a `Listing`, **`onDelete: Cascade`** | de qué anuncio | — |
| `userId` | `String` + relación a `User`, `onDelete: Cascade` | de quién es el bolsillo | — |
| `intervalDays` | `Int` | cada cuántos días | **D1** |
| `hourOfDay` | `Int` (0–23) | a qué hora | **D1, D4** |
| `status` | enum `BumpScheduleStatus` | activa o por qué no | **D2, D7, D9** |
| `nextRunAt` | `DateTime` | **el instante del próximo turno** | D1, D4 |
| `lastRunAt` | `DateTime?` | último intento | — |
| `createdAt` / `updatedAt` | `DateTime` | — | — |

**Índices:**
- `@@unique([listingId])` — **una programación por anuncio** (D3). No es una restricción cosmética: dos programaciones sobre el mismo anuncio competirían por el mismo cooldown y una de las dos no haría nunca nada. La base lo impide.
- `@@index([status, nextRunAt])` — es *la* consulta del cron (`status = ACTIVE AND nextRunAt <= now`). Sin este índice, cada pasada horaria hace un recorrido completo de la tabla.

**`onDelete: Cascade` sobre `listingId`:** sí. Una programación sin anuncio no significa
nada, y `Listing` ya cascadea desde `seller` ([schema.prisma:604-605](../apps/api/prisma/schema.prisma#L604)). Coherente con `Favorite`, `ListingTag` y el resto de satélites del anuncio.

**Por qué `userId` además de `listingId`,** pudiendo derivarse de `listing.sellerId`: el
límite por usuario (D3) se comprueba en cada alta, y hacerlo con un `JOIN` a `Listing` en
un camino caliente es peor que una columna. Además el cobro es contra la cartera del
usuario, no del anuncio: tener el dueño explícito hace que las consultas de dinero no
dependan de una relación que puede cambiar.

**Por qué `nextRunAt` es una columna materializada y no un cálculo:** es lo que el cron
consulta e indexa, y —crucialmente— es **el ancla del reclamo atómico** de la CAPA 2 (§C.2).
Un valor calculado no se puede reclamar.

**Estados** (`BumpScheduleStatus`) — el conjunto sale de D2, D7 y D9, y cada uno existe
porque hay que distinguir *por qué* está parada:

- `ACTIVE` — corriendo.
- `PAUSED_BY_USER` — la paró el usuario.
- `PAUSED_NO_FUNDS` — se quedó sin las tres bolsas (D2).
- `PAUSED_LISTING_INACTIVE` — el anuncio dejó de estar `ACTIVE` (D9).

Que sean estados distintos y no un `paused: boolean` es deliberado: **la razón determina la
salida**. "Recarga créditos" y "reactiva tu anuncio" son mensajes distintos, y la
reanudación automática de D9 solo puede existir si se sabe que la pausa fue por esa causa.
Es la misma lección que dejó `motivoNoDisponible` en `FacturasPanel` (UXV.3/M7): un estado
bloqueado sin razón visible es un callejón.

**Campos condicionales** — solo si la decisión correspondiente se confirma en la variante
que los pide:

| Campo | Solo si | Comentario |
|---|---|---|
| `weekday` | D1 = semanal con día | no hace falta con "cada N días" |
| `frozenCreditCost` | D10 = congelar precio | la recomendación es **no** congelar |
| `fundingPolicy` | D11 = orden distinto al manual | la recomendación es **mismo orden** |

### A.2 — `BumpRun` — cada ejecución programada

**Esta tabla es el corazón de la idempotencia.** Una fila por *turno* (slot), se haya
cobrado o no.

| Campo | Tipo | Papel |
|---|---|---|
| `id` | `String @id` | — |
| `scheduleId` | `String` + relación, `onDelete: Cascade` | de qué programación |
| `slot` | `DateTime` | **el instante previsto del turno**, no el de ejecución |
| `outcome` | enum `BumpRunOutcome` | cómo acabó |
| `paidWith` | `String?` | `PRO_QUOTA` / `BUMP_BALANCE` / `CREDITS`, tal cual lo devuelve `bump()` |
| `cost` | `Int?` | créditos cobrados (0 si fue gratis) |
| `detail` | `String?` | motivo cuando no se aplicó |
| `createdAt` | `DateTime` | cuándo se ejecutó de verdad |

**`@@unique([scheduleId, slot])` — el guard fuerte.** Dos procesos que intenten el mismo
turno no pueden crear dos filas: el segundo choca contra la restricción de la base. Es
exactamente el molde de [`Invoice.idempotencyKey @unique`](../apps/api/prisma/schema.prisma#L2048), que existe por la misma razón (emitir dos veces es grave) y con el mismo criterio: **el guard que de verdad no se puede esquivar vive en la base, no en el código**.

**Resultados** (`BumpRunOutcome`): `APPLIED`, `SKIPPED_COOLDOWN`, `SKIPPED_LISTING_INACTIVE`,
`FAILED_NO_FUNDS`, `FAILED_ERROR`.

**Lo que esta tabla resuelve además de la idempotencia** — el hueco B.4 de la auditoría:
hoy `BumpLedgerType` ([schema.prisma:197-226](../apps/api/prisma/schema.prisma#L197)) y `CreditLedger.referenceType` (`'Listing'` en los tres caminos: [:651](../apps/api/src/modules/billing/billing.service.ts#L651), [:675](../apps/api/src/modules/billing/billing.service.ts#L675), [:701](../apps/api/src/modules/billing/billing.service.ts#L701)) **no distinguen un bump automático de uno manual**. Sin `BumpRun`, el usuario ve créditos gastados y no puede reconstruir por qué.

Nótese que esto se consigue **sin tocar el ledger ni añadir tipos nuevos al enum**: `BumpRun`
es un registro paralelo que apunta al mismo hecho. El invariante contable
`wallet.bumpBalance == SUM(BumpLedger.amount)` ([schema.prisma:1369-1371](../apps/api/prisma/schema.prisma#L1369)) queda intacto, que es justo lo que se quiere de una tabla nueva junto a un libro mayor.

**Retención:** `BumpRun` crece sin techo (una fila por turno por programación). No es urgente
—una programación cada 3 días son ~120 filas/año— pero el diseño lo deja anotado como
mantenimiento futuro, no como deuda oculta.

## B. El scheduler

**`BumpScheduleService`**, molde [`InvoicingScheduleService`](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts) — verificado, y se copian sus cuatro propiedades.

### B.1 — El `@Cron` es fino y el reloj es inyectable

```
@Cron('10 * * * *')  →  runDueSchedules(now: Date)
```

**El decorador solo pasa la fecha.** Toda la lógica vive en un método público que **recibe
`now`** y nunca llama a `new Date()` por dentro. Es el molde declarado en
[invoicing-schedule.service.ts:41-47](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L41) y [tickets-schedule.service.ts:25-27](../apps/api/src/modules/tickets/tickets-schedule.service.ts#L25) — *«el `@Cron` es fino y delega en un método público que RECIBE LA FECHA … y por eso se puede probar el día 13, el 14 y el 15 sin esperar al reloj»*.

**Es la lección de `tickets-cron.e2e-spec.ts`, y aquí no es opcional.** Un scheduler que
gasta dinero y solo se puede probar esperando al reloj es una bomba de relojería: los casos
que hay que verificar (el turno justo en la frontera, el turno con cooldown activo, el turno
sin saldo, dos instancias en el mismo segundo) son **precisamente** los que no se pueden
provocar esperando.

**Minuto 10, no 0:** los cuatro `@Cron` existentes corren a `0 2`, `0 3`, `0 4` y `0 5`
([expiration.service.ts:24](../apps/api/src/modules/expiration/expiration.service.ts#L24), [entitlement-expiration.service.ts:30](../apps/api/src/modules/expiration/entitlement-expiration.service.ts#L30), [invoicing-schedule.service.ts:44](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L44), [tickets-schedule.service.ts:47](../apps/api/src/modules/tickets/tickets-schedule.service.ts#L47)) — todos en minuto 0. Un cron horario en minuto 0 se solaparía con ellos cuatro veces al día sin ninguna necesidad. El precedente ya existe: el cron de tickets se puso a las 05:00 explícitamente *«una hora después del cron de facturación (04:00) para no solaparlos en la misma máquina»* ([tickets-schedule.service.ts:44-46](../apps/api/src/modules/tickets/tickets-schedule.service.ts#L44)).

**Periodicidad horaria** porque D4 recomienda soportar hora del día. Si D4 se resolviera sin
hora, bastaría un cron diario.

### B.2 — El cron selecciona y encola; no ejecuta

Molde [invoicing-schedule.service.ts:22-23](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L22): *«El trabajo pesado … va en cola, NUNCA inline en el cron.»*

Un bump no es pesado por sí solo, pero **el pico sí lo es**: con D1/D4 confirmados, todas
las programaciones de "las 9:00" caen en la misma pasada. Ejecutarlas en línea serializa N
transacciones dentro del tick del cron. Encolar las reparte por la cola, que es el
amortiguador para el que existe.

Flujo de una pasada:

1. **Seleccionar** los turnos vencidos: `status = ACTIVE AND nextRunAt <= now`, ordenados por `nextRunAt`, en lotes.
2. Para cada uno: **reclamar el turno** (§C.2) — atómico. Quien no reclama, no sigue.
3. Quien reclamó: **encolar** un job en la cola de bump-auto con `jobId` estable.
4. **Registrar** en el log un resumen (cuántos vencidos, cuántos reclamados, cuántos encolados) y devolverlo, como hace `runScheduledInvoicing` ([:54-71](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L54)) — es lo que hace observable y testeable la pasada.

**La cola nueva** debe registrarse con el helper `retryQueue()` ([queue.constants.ts:28-30](../apps/api/src/infra/queue/queue.constants.ts#L28)) y no con `{ name }` a mano: hay un test de estructura (`queue-retry.e2e-spec.ts`) que rastrea `src/` y rompe la suite si alguien lo esquiva ([:23-27](../apps/api/src/infra/queue/queue.constants.ts#L23)). Hereda `attempts: 3` con backoff exponencial de 2 s ([:16-21](../apps/api/src/infra/queue/queue.constants.ts#L16)).

### B.3 — El processor: llamar a `bump()` y traducir el resultado

El processor hace **una** cosa: llama a `BillingService.bump(listingId, userId)` y traduce lo
que salga.

| Lo que devuelve `bump()` | `BumpRun.outcome` | Efecto sobre la programación |
|---|---|---|
| `{ bumpedAt, paidWith, cost }` | `APPLIED` | sigue `ACTIVE`; `nextRunAt` ya avanzó al reclamar |
| `402 Insufficient credits` ([:688-690](../apps/api/src/modules/billing/billing.service.ts#L688)) | `FAILED_NO_FUNDS` | → `PAUSED_NO_FUNDS` + aviso (**D2**) |
| `429 Cooldown active` ([:605-608](../apps/api/src/modules/billing/billing.service.ts#L605)) | `SKIPPED_COOLDOWN` | sigue `ACTIVE`, turno perdido, **sin cobro** (**D5**) |
| `400 Only ACTIVE listings can be bumped` ([:586-588](../apps/api/src/modules/billing/billing.service.ts#L586)) | `SKIPPED_LISTING_INACTIVE` | → `PAUSED_LISTING_INACTIVE` + aviso (**D9**) |
| `403 Not your listing` ([:585](../apps/api/src/modules/billing/billing.service.ts#L585)) / `404` | `FAILED_ERROR` | → pausa; no debería ocurrir, y por eso conviene que quede escrito |
| otra | `FAILED_ERROR` | reintento de BullMQ; agotados, pausa |

**El `402` no hay que inventarlo ni detectarlo mirando saldos:** `bump()` ya recorre las tres
bolsas en orden y solo lanza `402` cuando las tres están vacías ([:626-709](../apps/api/src/modules/billing/billing.service.ts#L626)). Comprobar el saldo por adelantado sería replicar la lógica de cobro — justo lo que el principio rector prohíbe.

**Los reintentos de BullMQ no pueden cobrar dos veces**, y la razón es aritmética: el backoff
exponencial desde 2 s con 3 intentos agota en segundos, muy dentro de la ventana de cooldown
de **3600 s** ([bump-cooldown.ts:18](../apps/api/src/modules/billing/bump-cooldown.ts#L18)). Un reintento tras un cobro confirmado choca con el cooldown recién escrito y sale por `429`. Y eso es solo la **tercera** línea de defensa (§C.3).

### B.4 — Cómo avanza `nextRunAt`

Se calcula **desde el turno previsto, no desde el instante de ejecución**:

```
nextRunAt(siguiente) = slot + intervalDays días, a la hora hourOfDay
```

Anclarlo al `slot` y no a `now` tiene tres consecuencias que importan:

- **No hay deriva.** Si una pasada se retrasa 20 minutos, el turno siguiente no se corre 20 minutos; "cada 3 días a las 9:00" sigue siendo a las 9:00 el año que viene.
- **Es determinista.** Dos instancias calculan el mismo valor, que es lo que hace válido el reclamo atómico de §C.2.
- **Es reproducible en test** con el reloj inyectado.

**Recuperación tras caída** (molde de facturación, [:25-29](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L25) — *«en vez de "¿hoy es el día 1?", pregunta "¿hay periodos cerrados sin facturar?"»*): la consulta es `nextRunAt <= now`, así que un turno vencido durante una caída se detecta al arrancar. Pero **no se recuperan turnos acumulados**: si el servidor estuvo caído cuatro días, no se disparan cuatro bumps de golpe. Se ejecuta **uno** y `nextRunAt` salta al primer turno futuro. Encadenar cuatro cobros retroactivos sería lo contrario de lo que el usuario espera, y además chocaría con el cooldown de todos modos.

## C. La concurrencia — dos capas, las dos resueltas

Es el prerequisito técnico del proyecto. Se resuelven por separado porque son problemas
distintos con soluciones distintas.

### C.1 — CAPA 1: la carrera del cooldown (arreglo de base)

**El defecto, anotado en el propio código** ([billing.service.ts:590-594](../apps/api/src/modules/billing/billing.service.ts#L590)): *«esta comprobación lee `bumpedAt` FUERA de la transacción, así que dos peticiones concurrentes sobre el mismo listing podrían ambas pasarla antes de que ninguna confirme su propio UPDATE — inventariada, no se toca aquí.»*

Verificado además que el `UPDATE` de `bumpedAt` es la **última** sentencia de las tres ramas
de la transacción ([:655](../apps/api/src/modules/billing/billing.service.ts#L655), [:679](../apps/api/src/modules/billing/billing.service.ts#L679), [:707](../apps/api/src/modules/billing/billing.service.ts#L707)): se cobra primero y se marca después, que es el orden que ensancha la ventana de carrera.

Hoy hace falta un doble clic humano simultáneo. Con un scheduler en N instancias es el caso
normal.

#### El arreglo: reclamar el turno **antes** de cobrar, con una condición atómica

Se invierte el orden dentro de la transacción existente:

1. **Primero**, un `UPDATE` condicional sobre `Listing` que escribe `bumpedAt` **solo si** el anuncio sigue `ACTIVE` y el cooldown ya venció. Si afecta **0 filas** → se lanza el `429` de siempre y la transacción revierte.
2. **Después**, el cobro en tres niveles, exactamente como está hoy.

**Por qué esto es correcto**, y no un truco: bajo `READ COMMITTED` —el nivel por defecto de
PostgreSQL, y verificado que el repo **no fija `isolationLevel` en ninguna `$transaction`**—
un `UPDATE` sobre una fila que otra transacción está modificando **espera** a que la primera
confirme y entonces **reevalúa su `WHERE` contra la versión nueva**. El segundo ve el
`bumpedAt` recién escrito, la condición falla, y afecta 0 filas. No hay ventana.

**No es un patrón nuevo en este repo: es el que ya se usa para el dinero.** El débito de
créditos es `UPDATE "Wallet" SET balance = balance - X WHERE balance >= X` seguido de
"si afectó 0 filas, error" ([:684-690](../apps/api/src/modules/billing/billing.service.ts#L684)); el saldo de bumps, igual ([:660-665](../apps/api/src/modules/billing/billing.service.ts#L660)); el destacado por créditos, igual ([:500-505](../apps/api/src/modules/billing/billing.service.ts#L500)). Aplicar el mismo idioma al cooldown es **coherencia**, no invención.

#### Cuatro propiedades del arreglo que conviene explicitar

1. **Beneficia al bump manual.** No es un peaje del proyecto 2: cierra una deuda que ya existía y que hoy protege mal a un usuario con doble clic o doble pestaña.
2. **El contrato externo no cambia.** Mismo `429`, mismo `retryAfter`, mismo `nextBumpAt`. Los seis casos de [`uxv1-bump-cooldown.e2e-spec.ts`](../apps/api/test/uxv1-bump-cooldown.e2e-spec.ts) deben pasar **sin tocarlos** — y esa es precisamente la prueba de que el arreglo es interno. Si hubiera que reescribirlos, el arreglo estaría mal.
3. **El `retryAfter` sigue siendo exacto.** Cuando el reclamo falla hay que leer el `bumpedAt` vigente para calcularlo; una lectura extra solo en el camino de error, que es el barato.
4. **La comprobación previa a la transacción puede quedarse**, pero cambia de papel: deja de ser el guard y pasa a ser un atajo que evita abrir una transacción cuando el cooldown es evidente. Conviene que el código lo diga, o alguien la volverá a tomar por la garantía.

**Efecto colateral deseable:** con el reclamo primero, un `402` revierte también el reclamo,
así que un intento sin saldo **no** consume la ventana de cooldown. Hoy tampoco lo hace
(la transacción revierte entera), pero con el orden invertido la razón es evidente en lugar
de accidental.

### C.2 — CAPA 2: el cron que corre N veces

**El problema:** `@nestjs/schedule` corre **en proceso** ([app.module.ts:64](../apps/api/src/app.module.ts#L64)). Con N instancias del API, el `@Cron` se dispara N veces. Los cuatro crons actuales lo toleran porque son idempotentes por diseño; **uno que cobra, no**. Verificado que **no existe ningún lock distribuido** en el repo.

#### Las tres opciones y la elegida

| Opción | A favor | En contra |
|---|---|---|
| **(a) Lock distribuido** (Redis `SET NX EX`) | El repo ya usa Redis y el idioma (dedup de visitas, [listings.service.ts:1168-1177](../apps/api/src/modules/listings/listings.service.ts#L1168)) | Es **advisory**: protege la pasada, no el turno. Si el poseedor muere a mitad, la pasada queda bloqueada hasta el TTL. Y no dice nada sobre reintentos de un job, que es la otra fuente de doble cobro |
| **(b) Idempotencia por turno** (`BumpRun @@unique([scheduleId, slot])`) | Guard **en la base**, no advisory. Cubre N instancias **y** reintentos con el mismo mecanismo. Da de paso la trazabilidad de B.4 | Una tabla más |
| **(c) Que baste el arreglo de la CAPA 1** | Cero infraestructura | **Funciona, pero es un colador silencioso**: ver abajo |

**Elegida: (b) como guard principal, con (c) de red inferior.**

**Por qué (c) sola no basta**, aunque la auditoría la señalara como elegante y **sea cierta
en lo esencial**: con la CAPA 1 arreglada, dos ejecuciones simultáneas del mismo turno
terminan en una que cobra y otra que choca con el cooldown. **El dinero está a salvo.** Pero
el sistema queda ciego a que ocurrió: la segunda registra un `SKIPPED_COOLDOWN` que es
indistinguible de un usuario que bumpeó a mano un minuto antes. Con (b), la segunda ni
siquiera llega a intentarlo, y si lo intentase la colisión de la clave única lo diría con
todas las letras. **La corrección no debería depender de que dos fallos se cancelen entre
sí.**

**Por qué (b) y no (a):** un lock protege *el momento*; la clave única protege *el hecho*.
Lo que no puede pasar dos veces no es "la pasada de las 9:00", es "el turno de las 9:00 de
esta programación". La restricción se escribe sobre exactamente eso.

#### Cómo se reclama un turno

Dos escrituras, una detrás de otra:

1. **Insertar `BumpRun`** con `(scheduleId, slot)`. Si viola la clave única → **otro se lo quedó**: se abandona sin ruido. Es el mismo gesto que el `Invoice.idempotencyKey @unique` de facturación.
2. **Avanzar `nextRunAt`** con una condición sobre el valor que se leyó (comparación-y-cambio): solo progresa si nadie lo movió mientras tanto.

Solo quien completa las dos encola el job.

**Contrapartida honesta:** si la instancia que reclamó muere entre el reclamo y el bump, ese
turno **se pierde** (`nextRunAt` ya avanzó). Es deliberado: perder un bump es un
inconveniente, cobrar dos es un fallo de confianza. Y el turno siguiente llega solo. Queda
registrado en `BumpRun` como fila sin `outcome` final, que es la señal de que ocurrió — no
un silencio.

### C.3 — La garantía de idempotencia, enunciada

**Un turno programado produce como mucho un cobro. Siempre.** Tres guardas independientes,
en tres capas distintas — el mismo esquema de triple guard que protege la facturación
([invoicing-schedule.service.ts:112-121](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L112) + [`Invoice.idempotencyKey`](../apps/api/prisma/schema.prisma#L2048)):

| # | Guard | Dónde | Qué ataca |
|---|---|---|---|
| 1 | `BumpRun @@unique([scheduleId, slot])` | base de datos | N instancias reclamando el mismo turno |
| 2 | `jobId` estable `bump-auto-{scheduleId}-{slot}` | BullMQ | encolado duplicado del mismo turno |
| 3 | Reclamo atómico del cooldown (CAPA 1) | transacción de `bump()` | reintento del job; y **cualquier** camino imprevisto, incluido el manual |

Ninguna depende de las otras. **El guard 3 es el que hace que la garantía no sea una
promesa de diseño sino una propiedad del sistema**: aunque las dos primeras fallaran, un
segundo cobro del mismo anuncio dentro de la hora es imposible a nivel de transacción.

## D. El cableado a la UI

Todo se apoya en lo que UXV.4 dejó preparado. Nada obliga a reestructurar la tarjeta.

### D.1 — La entrada: dentro del diálogo, con atajo en el `▾`

`PromocionarDialog` **ya se declaró la casa de esto** ([PromocionarDialog.tsx:53-58](../apps/web/src/components/anuncios/owner/PromocionarDialog.tsx#L53)): *«Entrará como un `Producto` más en el selector de arriba, con su propio bloque de configuración donde hoy están la duración y el método de pago del destacado.»* El tipo es literalmente `type Producto = 'bump' | 'destacado'` ([:66](../apps/web/src/components/anuncios/owner/PromocionarDialog.tsx#L66)) — se añade un tercero.

**Y esto resuelve solo el hallazgo de la auditoría** (el `▾` únicamente se pinta cuando el
bump es gratis, [PromocionarControl.tsx:117-118](../apps/web/src/components/anuncios/owner/PromocionarControl.tsx#L117)). Verificado el otro camino ([:158-173](../apps/web/src/components/anuncios/owner/PromocionarControl.tsx#L158)): el usuario **de pago** ve un botón único «Promocionar» que **abre ese mismo diálogo**. Si programar vive dentro del diálogo, ese usuario llega igual.

La conclusión importa: **el problema no era la ausencia de entrada, era depender del `▾`
como entrada única**. El `▾` se queda como atajo para quien tiene bumps gratis —una entrada
más junto a «Destacar anuncio…» ([:147-154](../apps/web/src/components/anuncios/owner/PromocionarControl.tsx#L147)), tal como previó el comentario [:37-39](../apps/web/src/components/anuncios/owner/PromocionarControl.tsx#L37)— pero deja de ser el único camino. Ver **D8**.

### D.2 — El estado: la línea que UXV.4 dejó escrita

[`PromotionStatus.tsx:51`](../apps/web/src/components/anuncios/owner/PromotionStatus.tsx#L51) contiene, literalmente, `{/* AQUÍ va «Próximo bump: …» cuando llegue el bump automático. */}`. El componente se declaró zona multi-línea por este motivo ([:8-12](../apps/web/src/components/anuncios/owner/PromotionStatus.tsx#L8)).

Se añade una prop y una línea. Dos matices de diseño:

- **La línea debe decir también cuándo NO va a pasar.** Una programación en `PAUSED_NO_FUNDS` que no se distinga de una activa repite el defecto que UXV.6/M12 cerró en la cuota Pro (desaparecía al agotarse, y «no la tengo» se veía igual que «ya la gasté»). Pausada tiene que verse, y decir por qué.
- **La condición de pintado cambia.** Hoy el bloque se oculta si no hay ni destacado ni cooldown ([:35](../apps/web/src/components/anuncios/owner/PromotionStatus.tsx#L35)); tendrá que contemplar la programación.

**Payload:** el dato viaja junto a `nextBumpAt`, en los dos sitios donde ya se sirve —ficha
([listings.service.ts:909](../apps/api/src/modules/listings/listings.service.ts#L909)) y lista ([:1090](../apps/api/src/modules/listings/listings.service.ts#L1090))— y **ya resuelto por el backend**, nunca derivado en el cliente. Es la regla que UXV.1 dejó escrita ([bump-cooldown.ts:10-14](../apps/api/src/modules/billing/bump-cooldown.ts#L10)) y el motivo de que hoy no haya tres verdades sobre el cooldown.

**Aviso de caché:** la ficha se sirve desde un blob en Redis y por eso `bump()` invalida
`listingCacheKey(slug)` al terminar ([:714-721](../apps/api/src/modules/billing/billing.service.ts#L714)). Si el estado de programación viaja en ese payload, **crear, editar o cancelar una programación tiene que invalidar igual**, o la ficha mostrará un «Próximo bump» que ya no existe. Es exactamente la discrepancia entre superficies que UXV.1/A2 cerró.

### D.3 — La gestión: dos vistas, cada una donde se pregunta

- **Editar y cancelar, en el anuncio** (tarjeta → diálogo). Es donde se creó y donde el usuario piensa en ello.
- **Vista agregada, en `/mis-creditos`.** La sección de bumps ya existe (`HistorialBumps`, [Historiales.tsx:147](../apps/web/src/app/(account)/mis-creditos/_components/Historiales.tsx#L147)) y es **donde el usuario va cuando la pregunta es de dinero** —«¿por qué se me van los créditos?»—. Es la pregunta que crea el bump automático, y `BumpRun` es exactamente su respuesta.

**No se propone una entrada nueva en `ACCOUNT_NAV`** ([account-nav.ts:76](../apps/web/src/config/account-nav.ts#L76): «Mi saldo» ya está). UXV.2 costó reducir la zona a cuatro grupos y trece entradas; añadir una decimocuarta para una feature de un solo anuncio sería empezar a deshacerlo.

---

# ENTREGABLE 2 — DECISIONES DE PRODUCTO

Once decisiones. Cada una con opciones, contrapartida y **recomendación**. Se confirman
**en bloque** en la [hoja del final](#hoja-de-confirmación).

## D1 — Granularidad de la frecuencia

**Dato duro:** el cooldown es **1 hora** ([bump-cooldown.ts:18](../apps/api/src/modules/billing/bump-cooldown.ts#L18)). Nada más limita.

| Opción | A favor | En contra |
|---|---|---|
| (a) Cada N días | Modelo mínimo; cron diario basta | Sin hora ni día de la semana |
| **(b) Cada N días + hora del día** | Cubre lo pedido; un solo campo más | Obliga a cron horario |
| (c) Semanal con día(s) + hora | «Los viernes por la tarde» | Modelo y UI más complejos; poco valor extra sobre (b) |
| (d) Expresión cron libre | Máxima potencia | Inaceptable de cara al usuario; roza el cooldown |

**→ Recomendación: (b), con `intervalDays` de 1 a 30 y una hora del día.**

Cubre *«frecuencia y, si se puede, hora y día»* con un único campo adicional. «Cada 7 días a
las 9:00» es un viernes recurrente sin necesidad de modelar días de la semana.

**Mínimo para lo automático: 1 día, no 1 hora.** Aunque el cooldown permita 24 bumps
diarios, eso son ~120 créditos/día al precio por defecto de 5 ([billing.service.ts:612-615](../apps/api/src/modules/billing/billing.service.ts#L612)) — un gasto desatendido que ningún usuario configura a conciencia, y un catálogo dominado por un solo anuncio. **El cooldown protege la plataforma; este mínimo protege al usuario.**

## D2 — Qué pasa sin saldo *(la pregunta explícita del usuario)*

Ocurre solo cuando **las tres** bolsas están vacías ([:626-709](../apps/api/src/modules/billing/billing.service.ts#L626)).

| Opción | A favor | En contra |
|---|---|---|
| **(a) Pausar + notificar** | No destruye lo configurado; reanudable; el aviso reengancha | Necesita estado y forma de reanudar |
| (b) Cancelar | Trivial | Hostil: se pierde la configuración por estar a cero un día |
| (c) Reintentar en silencio | Se recupera solo | Reintentos indefinidos y usuario a ciegas |
| (d) Fallo silencioso | Nada que construir | El peor: el usuario cree que sigue activo |

**→ Recomendación: (a), con reanudación MANUAL.**

Único precedente coherente en el repo: el cron de facturación, al no poder hacer su trabajo,
**avisa y deja la puerta abierta** ([invoicing-schedule.service.ts:128-142](../apps/api/src/modules/invoicing/invoicing-schedule.service.ts#L128)). Y (d) contradice frontalmente UXV.3, que existió para cerrar silencios así.

**Manual y no automática, deliberadamente:** los créditos son una bolsa común. Alguien
recarga para destacar un anuncio y, con reanudación automática, ese saldo empieza a irse en
bumps que no ha vuelto a pedir. **Reanudar debe ser un acto, no un efecto secundario.**
(Asimetría intencionada con D9 — allí sí es automática, y ahí se explica por qué.)

## D3 — Límites y quién puede usarlo

| Eje | Recomendación | Razón |
|---|---|---|
| ¿Solo Pro? | **No: cualquiera con saldo** | Es lo que se pidió («siempre que tengan créditos»). Además ata la feature al **consumo de créditos**, que es ingreso directo, en vez de a la suscripción |
| Por anuncio | **Una**, con `@@unique([listingId])` | Dos programaciones sobre el mismo anuncio compiten por el mismo cooldown: una no haría nada nunca |
| Por usuario | **Tope configurable** (`Setting`, entero positivo) | Molde [admin.service.ts:99-110](../apps/api/src/modules/admin/admin.service.ts#L99) |

**→ Recomendación: para todos, una por anuncio, tope por usuario configurable.**

**Advertencia aprendida esta semana:** si el tope acaba siendo distinto para Pro y para
gratuito, cualquier texto que los compare debe **derivarlo de los dos valores**, nunca
afirmarlo fijo. Es exactamente el defecto que se cerró en `/planes` (`9f8abe2`), y nace de
que ambos son ajustes de admin que pueden cruzarse.

## D4 — Hora y zona horaria

**Hallazgo verificado:** el backend **no gestiona zonas horarias** (`timeZone`, `TZ`,
`Europe/Madrid`: cero resultados en `apps/api/src`) y **`User` no tiene campo de zona
horaria** (verificado sobre [schema.prisma:298](../apps/api/prisma/schema.prisma#L298)). `@nestjs/schedule` sí admite `timeZone`; no se usa.

| Opción | A favor | En contra |
|---|---|---|
| (a) Sin hora | Elimina el problema | No es lo pedido |
| **(b) Hora peninsular, declarada y mostrada** | Barato y honesto | No es la hora local de quien esté fuera |
| (c) Zona por usuario | Correcto de verdad | Campo nuevo + captura + mantenimiento + horario de verano |

**→ Recomendación: (b).** Fijar `timeZone: 'Europe/Madrid'` **explícitamente** en el `@Cron`
—hoy los cuatro crons dependen de la zona del proceso, que es una dependencia no
declarada— y que la UI diga «hora peninsular» sin letra pequeña.

Un marketplace español con vendedores españoles no justifica el coste de (c). Pero **decirlo
sí es obligatorio**: la diferencia entre (b) y engañar al usuario es una línea de copia.

**Precisión que la UI debe reflejar:** con cron horario, «las 9:00» significa «en la pasada
de las 9:00». Se redacta como franja («sobre las 9:00»), no como hora exacta. Prometer
precisión de minuto sería prometer lo que la arquitectura no da.

## D5 — Colisión con el bump manual

**Ya está resuelto en cuanto a seguridad:** el cooldown lo aplica `bump()` sin mirar el
origen ([:600-610](../apps/api/src/modules/billing/billing.service.ts#L600)). No hay riesgo de doble bump. La pregunta es de comportamiento.

| Opción | A favor | En contra |
|---|---|---|
| **(a) Se salta el turno** | Predecible; el usuario ya obtuvo su bump | Pierde el turno |
| (b) Se reintenta después | No se pierde | ¿Cuánto después? Acumula reintentos |
| (c) Se recalcula el calendario | Intuitivo con «cada N días» | Rompe «a las 9:00»: la hora se iría desplazando con cada bump manual |

**→ Recomendación: (a).** Con D1(b) confirmado, la programación es un **calendario**
(«cada 3 días a las 9:00»), y un calendario no se mueve porque hoy hayas hecho algo a mano.
(c) haría que la hora derivase impredeciblemente.

El turno saltado se registra como `SKIPPED_COOLDOWN`, **sin cobro** y sin aviso: el usuario
acaba de bumpear a mano, no necesita que le cuenten que por eso no se bumpeó otra vez.

## D6 — Notificación

Canal verificado y disponible: in-app persistente ([notifications.service.ts:36-44](../apps/api/src/modules/notifications/notifications.service.ts#L36)) + email por Resend ([notification.processor.ts:6,30-33](../apps/api/src/infra/queue/processors/notification.processor.ts#L6)). `Notification.type` es `String` a propósito: **tipo nuevo sin migración** ([notification.types.ts:6-7](../apps/api/src/modules/notifications/notification.types.ts#L6)).

| Opción | A favor | En contra |
|---|---|---|
| **(a) Solo incidencias; los bumps, al historial** | Cero ruido; es lo que el usuario contrató | Un cobro sin aviso puntual |
| (b) Aviso por cada bump | Trazabilidad máxima | Inunda la campana |
| (c) Resumen periódico | Equilibrio | Otro cron |
| (d) In-app siempre + email en incidencias | Aprovecha el doble canal | Mismo ruido que (b) |

**→ Recomendación: (a).** Con dos precisiones:

1. **Se avisa de lo que exige actuar**: pausada por falta de saldo (D2) y pausada por anuncio inactivo (D9). Esos dos, **in-app + email** —el molde de doble canal existe ([ticket-notifications.service.ts:87,117,123](../apps/api/src/modules/tickets/ticket-notifications.service.ts#L87))— porque el usuario puede tardar días en abrir la web y mientras tanto no se está bumpeando nada.
2. **Los bumps aplicados no notifican, pero quedan todos** en `BumpRun`, visible en `/mis-creditos`. La trazabilidad no se sacrifica: se cambia de canal.

**Lo que el tipo nuevo debe respetar** ([schema.prisma:681-687](../apps/api/prisma/schema.prisma#L681), [notification.types.ts:60-66](../apps/api/src/modules/notifications/notification.types.ts#L60)): `data` es un **snapshot autocontenido** con nombres ya resueltos, nunca ids que haya que resolver al pintar. Un aviso sobre un anuncio debe seguir siendo legible si el anuncio se borra. Y necesita su `case` en [notification-content.ts](../apps/web/src/components/notifications/notification-content.ts#L9) o no se pintará.

## D7 — Flag de admin

**→ Recomendación: sí — `bumpAutoEnabled`, booleano.**

Dos razones concretas: es la primera feature que **gasta dinero de los usuarios de forma
desatendida** (un fallo se multiplica por cada programación activa, y sin interruptor la
única salida es desplegar), y el camino está trillado — precedente booleano
`contactRequiresVerification`, sembrado ([seed.ts:454](../apps/api/prisma/seed.ts#L454)), whitelisted ([admin.service.ts:50](../apps/api/src/modules/admin/admin.service.ts#L50)) y con `Switch` en el backoffice ([ajustes/page.tsx:253](../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L253)).

**Al apagarlo: el cron no ejecuta y la UI oculta la entrada, pero las programaciones NO se
tocan** — ni se borran ni cambian de estado. Al reencender siguen donde estaban. Un
interruptor de emergencia que destruye configuración de usuarios no es un interruptor, es
una bomba.

**Anotación técnica:** no existe familia de validación booleana en `admin.service.ts`
(solo `POSITIVE_INT_SETTING_KEYS` y `PERCENT_SETTING_KEYS`, [:99-115](../apps/api/src/modules/admin/admin.service.ts#L99)). Merece una, o el ajuste aceptará cualquier JSON.

## D8 — La entrada para el usuario de pago

**→ Recomendación: la configuración vive en `PromocionarDialog`; el `▾` es atajo, no puerta única.**

Verificado (§D.1 de la arquitectura): el usuario de pago **ya llega al diálogo** por el botón
único «Promocionar» ([PromocionarControl.tsx:158-173](../apps/web/src/components/anuncios/owner/PromocionarControl.tsx#L158)). Poniendo «Programar bumps» como tercer `Producto` del diálogo, los dos perfiles llegan por su camino natural y **no hay que tocar la lógica de `unClic`**.

El hallazgo de la auditoría era real, pero la lectura correcta no era «falta una entrada»
sino «no puede haber una sola». Con esto, la superficie de UXV.4 se aprovecha entera sin
retocarla.

## D9 — El anuncio deja de estar `ACTIVE`

`bump()` exige `ACTIVE` ([:586-588](../apps/api/src/modules/billing/billing.service.ts#L586)) y `canPromote` lo replica en la UI ([promocion.ts:101-103](../apps/web/src/components/anuncios/owner/promocion.ts#L101)). Un anuncio puede pasar a `EXPIRED` por el cron ([expiration.service.ts:24](../apps/api/src/modules/expiration/expiration.service.ts#L24)), a `SOLD`, a archivado o ser moderado.

**→ Recomendación: pausar (`PAUSED_LISTING_INACTIVE`) + avisar, y reanudar AUTOMÁTICAMENTE si el anuncio vuelve a `ACTIVE`.**

Borrarla castiga al usuario por vender. Dejarla intentándolo a diario crea las
programaciones zombis que la auditoría anticipó.

**Por qué aquí sí es automática y en D2 no:** son actos distintos. Reactivar *ese* anuncio es
una decisión sobre *esa* cosa, y reanudar lo que tenía configurado es lo que cualquiera
espera. Recargar créditos, en cambio, es reponer una bolsa común que puede estar destinada a
otra cosa. **La reanudación automática solo es segura cuando el gesto del usuario apunta al
mismo objeto que la programación.**

Enganche natural: `ListingActivationService`, que ya es el punto único por el que pasan
todas las transiciones a `ACTIVE` ([listing-activation.service.ts](../apps/api/src/modules/listing-activation/listing-activation.service.ts)).

## D10 — Precio en vivo

`bumpCreditCost` es un `Setting` editable ([admin.service.ts:59](../apps/api/src/modules/admin/admin.service.ts#L59)) y `bump()` lo **relee en cada llamada** ([:612-615](../apps/api/src/modules/billing/billing.service.ts#L612)), aplicando además el descuento de campaña vigente ([:617-622](../apps/api/src/modules/billing/billing.service.ts#L617)).

| Opción | A favor | En contra |
|---|---|---|
| **(a) Cobrar el vigente, y decirlo** | Una sola verdad sobre el precio; las campañas benefician al usuario automáticamente | El usuario puede pagar más que al configurar |
| (b) Congelar al programar | Previsible | **Crea una segunda verdad del precio** y bloquea los descuentos de campaña |

**→ Recomendación: (a), con la advertencia visible al configurar.**

(b) es tentador y es la trampa que este proyecto ya conoce: congelar un valor configurable
crea dos verdades que divergen en silencio —lo mismo que hacía la lista de `/planes` antes
de `9f8abe2`—. Y tiene un efecto perverso concreto: un precio congelado **también congela
las rebajas**, así que una campaña de bumps al -20% no llegaría a quien más bumps consume.

Contrapartida real y aceptada: se puede pagar más que el día que se configuró. Se mitiga
diciéndolo donde se configura, y `BumpRun.cost` deja constancia de lo cobrado en cada turno.

## D11 — Orden de cobro

El orden actual —cuota Pro → saldo de bumps → créditos— es deliberado y está razonado en el
código ([:562-567](../apps/api/src/modules/billing/billing.service.ts#L562)): *«se gasta primero lo que se PIERDE al resetear (cuota), luego lo gratis-permanente (cupón), luego lo pagado (créditos) — el usuario nunca sale perdiendo por el orden automático»*.

| Opción | A favor | En contra |
|---|---|---|
| **(a) El mismo orden que el manual** | Una sola regla; el usuario nunca pierde cuota que iba a caducar | Lo automático puede agotar la cuota Pro antes de que el usuario la use a mano |
| (b) Lo automático empieza por créditos | Reserva la cuota para lo manual | **Dos reglas de cobro**; y hace que lo automático cueste dinero pudiendo ser gratis |

**→ Recomendación: (a).**

El argumento decisivo es el mismo que justifica el orden actual: **la cuota Pro se pierde si
no se usa**. Saltársela en lo automático para «reservarla» significa que caduque sin gastar
mientras el usuario paga créditos por lo mismo. Eso es exactamente lo que el orden vigente
existe para impedir.

La preocupación legítima detrás de (b) —«se me fue la cuota en algo que no elegí»— se
atiende mostrando qué pagó cada turno (`BumpRun.paidWith`), no cambiando la regla.

---

## Hoja de confirmación

Once decisiones, para confirmar **en bloque**. Marcar solo lo que se quiera cambiar.

| # | Decisión | Recomendación |
|---|---|---|
| **D1** | Granularidad | **Cada N días (1–30) + hora del día.** Mínimo **1 día** para lo automático |
| **D2** | Sin saldo | **Pausar + notificar**; reanudación **manual** |
| **D3** | Límites | **Para todos** con saldo · **una** por anuncio · tope por usuario configurable |
| **D4** | Hora / zona | **Hora peninsular declarada** en el `@Cron` y mostrada; sin zona por usuario |
| **D5** | Colisión con manual | **Saltar el turno**, sin cobro y sin recalcular el calendario |
| **D6** | Notificación | **Solo incidencias** (in-app + email); los bumps van al historial |
| **D7** | Flag de admin | **Sí**, `bumpAutoEnabled`; al apagar **no** se tocan las programaciones |
| **D8** | Entrada UI | **En el diálogo**; el `▾` como atajo, no puerta única |
| **D9** | Anuncio no `ACTIVE` | **Pausar + avisar**; reanudar **automáticamente** al volver a `ACTIVE` |
| **D10** | Precio | **El vigente**, advertido al configurar; **no** congelar |
| **D11** | Orden de cobro | **El mismo que el manual** (cuota Pro → saldo → créditos) |

**Qué cambia si se cambia algo:**

- **D1 → sin hora**: desaparece `hourOfDay`, D4 se vuelve irrelevante y el cron pasa a diario.
- **D1 → semanal con día**: añade `weekday` y complica el cálculo de `nextRunAt`.
- **D2 → cancelar**: desaparece `PAUSED_NO_FUNDS` y sobra medio D6.
- **D10 → congelar**: añade `frozenCreditCost` y hay que decidir qué pasa con las campañas.
- **D11 → distinto orden**: añade `fundingPolicy` y **una segunda regla de cobro** — el cambio de mayor coste de los once.

Las decisiones **D1, D2 y D4** son las que más arrastran: conviene resolverlas primero
aunque se confirmen todas juntas.

---

## Lo que este diseño NO resuelve (deliberadamente)

- **Retención de `BumpRun`.** Crece sin techo. No es urgente y no se inventa una política ahora.
- **`listingExpiryDays` desconectado.** Hallazgo de la auditoría (ajuste editable que nadie lee). Fuera de alcance; sigue anotado.
- **Reparto del pico horario.** Si «las 9:00» concentrase demasiadas programaciones, se repartirían dentro de una franja. La cola amortigua; no se optimiza sin medir. Mismo criterio con el que se calibró `INDEXING_CONCURRENCY` ([queue.constants.ts:36-48](../apps/api/src/infra/queue/queue.constants.ts#L36)): se midió, no se supuso.
- **Cooldown por plan.** [bump-cooldown.ts:13-14](../apps/api/src/modules/billing/bump-cooldown.ts#L13) lo anticipa como posible. No hace falta para esto y el fichero sigue siendo el único sitio donde cambiarlo.

## Orden sugerido de implementación

No es un plan de ráfagas —eso es el paso siguiente— sino la dependencia real:

1. **CAPA 1 (el arreglo del cooldown), sola y antes que nada.** Es independiente del bump automático, beneficia al manual y se valida con los tests que ya existen ([`uxv1-bump-cooldown.e2e-spec.ts`](../apps/api/test/uxv1-bump-cooldown.e2e-spec.ts), [`bump-balance.e2e-spec.ts`](../apps/api/test/bump-balance.e2e-spec.ts), [`billing-rf6.e2e-spec.ts`](../apps/api/test/billing-rf6.e2e-spec.ts)) **sin modificarlos**. Entra sola, se verifica sola.
2. **Modelo + scheduler + idempotencia**, con el reloj inyectado desde el primer día.
3. **UI**: entrada en el diálogo, línea de estado, vista agregada.
4. **Notificaciones y flag de admin.**

Que (1) vaya primero y por separado no es un capricho de orden: es la única forma de que el
arreglo de una deuda preexistente se pueda verificar **sin** la feature nueva encima
confundiendo las señales.
