# Auditoría y diseño — Cuotas mensuales del Pro anual y del Pro manual

**Fecha:** 2026-09-19 · **Alcance:** FACTURACIÓN / CUOTAS · **Estado:** documento de decisión.
**Cero cambios de código.** Todo lo que sigue está verificado contra el código y, donde se
indica, medido contra la base de datos de desarrollo.

---

## §0 — El veredicto en diez líneas

1. **La cuota mensual de Pro no es mensual: es «por periodo de facturación».** Se cuenta con
   un `COUNT` desde `Subscription.currentPeriodStart`
   ([entitlement.service.ts:309](../apps/api/src/modules/billing/entitlement.service.ts#L309)).
2. **Para el Pro MENSUAL eso coincide con «al mes» y funciona bien.** Para el Pro **ANUAL**,
   `currentPeriodStart` avanza **una vez al año**, así que recibe **4 destacados y 4 bumps al
   AÑO** en vez de 4+4 al mes. **Es 1/12 de lo que la página de precios le promete.**
3. El bug **no es sólo interno**: `/planes` pinta en la tarjeta anual **la misma lista de
   beneficios** que en la mensual —«4 destacados gratis al mes, de 7 días cada uno»— porque
   `proBenefits` se deriva de los mismos `Setting` y no distingue intervalo
   ([billing.service.ts:1266-1345](../apps/api/src/modules/billing/billing.service.ts#L1266)).
4. Y **`/perfil/suscripcion` se contradice a sí mismo** para un anual: dice «4 de 4 restantes
   **este mes**» junto a «Se renueva: *(dentro de un año)*».
5. **El Pro MANUAL no tiene cuota** (`quotaSource: 'NONE'`) por una razón estructural, no por
   descuido: no existe `Subscription`, luego no existe `currentPeriodStart`, luego no hay
   nada desde donde contar.
6. **Las dos cosas son el mismo defecto**: la ventana de la cuota está atada al ciclo de
   facturación. Desatarla —contar por **mes natural**— arregla el anual **y** habilita el manual.
7. **Alcance medido:** en la base de datos de desarrollo hay **0 suscripciones** (ni mensuales
   ni anuales) y **1 Pro manual vigente**. Hoy el bug del anual es **LATENTE**. La consulta
   para medirlo en producción está en [§2.3](#23-el-alcance-del-bug--cuántos-pro-anuales-hay).
8. **El precio del bug, cuando muerda:** el plan anual cuesta **89,99 €**; la cuota que no
   recibe vale **131,56 €/año** sólo en destacados (44 × 2,99 €) más 44 bumps. **Un anual
   pierde más valor que el precio entero de su plan.**
9. **El diseño propuesto:** ventana = **mes natural de calendario** (día 1 → fin de mes),
   idéntica para los tres tipos de Pro; el ajuste del manual, **propio y configurable**, con
   **0 por defecto** (retrocompatible: hoy no tiene cuota, y sin tocar nada sigue sin tenerla).
10. **El punto duro que hay que resolver sí o sí:** la reserva atómica hoy bloquea la fila
    `Subscription` (`SELECT … FOR UPDATE`). El Pro manual **no tiene esa fila**. Ver [§8](#8--el-punto-duro-el-cerrojo-de-la-reserva-atómica).

---

# PARTE A — EL ESTADO ACTUAL

## §1 — El mecanismo de cuota, hoy

### 1.1 Dónde vive

Todo en un solo fichero:
[`apps/api/src/modules/billing/entitlement.service.ts`](../apps/api/src/modules/billing/entitlement.service.ts),
con tres funciones que **repiten la misma aritmética**:

| Función | Línea | Para qué | Quién la llama |
|---|---|---|---|
| `getFeaturedQuotaStatus` | [247](../apps/api/src/modules/billing/entitlement.service.ts#L247) | **Leer** el estado (lo que se pinta) | `GET /billing/pro-status` ([billing.controller.ts:81](../apps/api/src/modules/billing/billing.controller.ts#L81)) |
| `hasAvailableFeaturedQuota` | [361](../apps/api/src/modules/billing/entitlement.service.ts#L361) | **Reservar** un destacado (con cerrojo) | `BillingService.featuredByCredits` ([billing.service.ts:544](../apps/api/src/modules/billing/billing.service.ts#L544)) |
| `hasAvailableBumpQuota` | [411](../apps/api/src/modules/billing/entitlement.service.ts#L411) | **Reservar** un bump (con cerrojo) | `BillingService.bump` ([billing.service.ts:786](../apps/api/src/modules/billing/billing.service.ts#L786)) |

**Las tres derivan la ventana del mismo sitio, y ése es el defecto: hay que cambiarlo en tres
sitios, no en uno.** (Ver [§10](#10--el-plan-de-ráfagas): el primer paso del arreglo es
unificarlas.)

### 1.2 Cómo cuenta — el reseteo DERIVADO

No hay contador ni cron de reseteo. «Usado este periodo» es un `COUNT`:

```ts
// destacados — entitlement.service.ts:304-311
this.prisma.entitlement.count({
  where: {
    userId,
    type: EntitlementType.FEATURED_LISTING,
    origin: FeaturedOrigin.PRO_QUOTA,
    createdAt: { gte: currentPeriodStart },   // ← LA VENTANA
  },
})

// bumps — entitlement.service.ts:316-322
this.prisma.bumpLedger.count({
  where: {
    type: BumpLedgerType.PRO_QUOTA,
    createdAt: { gte: currentPeriodStart },   // ← LA MISMA VENTANA
    wallet: { userId },
  },
})
```

El diseño es bueno y **se conserva entero**: cuando la ventana avanza, lo gastado antes deja
de contar **solo**. No hay estado que corromper ni cron que se pueda caer. **Lo único que
está mal es de dónde sale `currentPeriodStart`.**

### 1.3 De dónde sale la ventana — la cadena completa

```
Entitlement{type: PRO_SUBSCRIPTION, subscriptionId ≠ null, vigente}   ← proConPeriodoFilter()
        │                                                               (entitlement.service.ts:42)
        ↓ .subscription
Subscription.currentPeriodStart                                       ← LA VENTANA
        ↑
        └── lo escribe Stripe vía webhook (billing.processor.ts:221, 306, 320, 380, 388)
```

`currentPeriodStart` **es el ciclo de cobro de Stripe, sin traducción**: lo copia
`periodFromSubscription(sub)` de la suscripción de Stripe en cada
`invoice.paid` / `customer.subscription.updated`
([billing.processor.ts:370-393](../apps/api/src/modules/billing/billing.processor.ts#L370)).

**Por tanto: la cuota «mensual» dura exactamente lo que dura el ciclo de cobro.**

### 1.4 La reserva atómica y su cerrojo

`hasAvailableFeaturedQuota` / `hasAvailableBumpQuota` hacen, dentro de la `tx` del llamante:

```sql
SELECT "currentPeriodStart" FROM "Subscription" WHERE id = $1 FOR UPDATE
```

y **sólo después** cuentan. El cerrojo es imprescindible porque la cuota es **derivada**, no
un saldo decrementable: sin él, dos peticiones concurrentes leerían `remaining = 1` antes de
que ninguna creara su fila, y ambas pasarían
([entitlement.service.ts:343-360](../apps/api/src/modules/billing/entitlement.service.ts#L343)).
Hay **dos tests e2e** que lo prueban, uno de ellos forzando el solape con un retardo inyectado
([h8-featured-quota.e2e-spec.ts:675-710](../apps/api/test/h8-featured-quota.e2e-spec.ts#L675),
[pro-bump-quota.e2e-spec.ts:316-330](../apps/api/test/pro-bump-quota.e2e-spec.ts#L316)).

> **Esto es lo que más hay que cuidar en el arreglo.** El cerrojo cuelga de una fila que el
> Pro manual no tiene. Ver [§8](#8--el-punto-duro-el-cerrojo-de-la-reserva-atómica).

### 1.5 El contrato que sale al frontend

`GET /billing/pro-status` devuelve `FeaturedQuotaStatus`
([entitlement.service.ts:73-124](../apps/api/src/modules/billing/entitlement.service.ts#L73)):

| Campo | Significado HOY | Quién lo lee |
|---|---|---|
| `isPro` | ¿Es Pro? (el hecho, vía `ProStatusService`) | `/mis-anuncios`, `/perfil/suscripcion` |
| `limit` / `used` / `remaining` | Cuota de **destacados** | idem |
| `bumpQuota.{limit,used,remaining}` | Cuota de **bumps** | idem |
| `periodStart` / `periodEnd` | **El ciclo de FACTURACIÓN** (`Subscription.*`) | el aviso de caducidad; «Se renueva» en `/perfil/suscripcion` |
| `quotaDurationDays` | Días que dura un destacado de cuota (7) | el diálogo de promocionar |
| `quotaSource` | `'SUBSCRIPTION'` \| `'NONE'` | `tieneCuota` en `/mis-anuncios`; el aviso de caducidad |
| `hasActiveSubscription` | ¿Hay suscripción de pago viva? (eje aparte) | `/planes`, `/perfil/suscripcion` |

**`quotaSource` fue diseñado dejando sitio al tercer valor.** Su propio doc-comment lo dice:
*«deja sitio a un tercer valor si algún día se decide que una concesión manual sí traiga cuota
(D-1)»* ([entitlement.service.ts:98-99](../apps/api/src/modules/billing/entitlement.service.ts#L98)).
Este documento es la decisión D-1, tomada en sentido afirmativo.

---

## §2 — El bug del Pro anual

### 2.1 Confirmado: sí, es exactamente lo que se temía

**El plan anual existe, está a la venta y se compra.**

- `Price` sembrado: **89,99 € / `interval: YEAR`**
  ([seed.ts:605](../apps/api/prisma/seed.ts#L605)), y verificado en la BD de desarrollo
  (`precios_pro | YEAR | 89.99`).
- `/planes` pinta su tarjeta con su propio `CheckoutButton`
  ([planes/page.tsx:149-187](<../apps/web/src/app/(public)/planes/page.tsx#L149>)).
- Nada en la cadena de cuota mira `Price.interval`. **Ni una sola vez.** `proConPeriodoFilter`
  pide la suscripción y lee su `currentPeriodStart`, sea de un mes o de un año.

**La cadena causal, entera:**

```
Compra el plan YEAR
  → Stripe crea la suscripción con periodo de 12 meses
  → webhook escribe currentPeriodStart = hoy, currentPeriodEnd = hoy + 1 año
  → la cuota cuenta PRO_QUOTA desde currentPeriodStart
  → la ventana dura 365 días
  → recibe `proMonthlyFeaturedQuota` destacados… en 365 días.
```

### 2.2 Los números

Con la configuración real de la instancia (`Setting` medidos en BD: `proMonthlyFeaturedQuota
= 4`, `proMonthlyBumpQuota = 4`, `proQuotaFeaturedDurationDays = 7`):

| | Pro **mensual** (9,99 €/mes) | Pro **anual** (89,99 €/año) | Ratio |
|---|---|---|---|
| Precio al año | 119,88 € | 89,99 € | −25 % |
| Destacados gratis **al mes** | 4 | **0,33** | **1/12** |
| Destacados gratis **al año** | **48** | **4** | **1/12** |
| Bumps gratis al año | **48** | **4** | **1/12** |
| Valor de los destacados al año (a 2,99 € el de 7 días) | **143,52 €** | **11,96 €** | — |
| Valor de los destacados al año (a 30 créditos el de 7 días) | 1 440 créditos | 120 créditos | — |

**La diferencia son 44 destacados + 44 bumps al año = 131,56 € de valor en destacados, sobre
un plan que cuesta 89,99 €.** El anual paga por ahorrar un 25 % y recibe un 8 % de la cuota.

### 2.3 El alcance del bug — ¿cuántos Pro anuales hay?

**Medido en la base de datos de desarrollo (`marketplace-postgres`, 2026-09-19):**

```
entitlements_pro | MANUAL | vigente     | 1
entitlements_pro | MANUAL | no_vigente  | 2
precios_pro      | MONTH  | 9.99        | 1
precios_pro      | YEAR   | 89.99       | 1
usuarios_total   |   -    |   -         | 3
```

**Cero filas en `Subscription`.** Ni una mensual ni una anual. **En desarrollo el bug es
LATENTE: no muerde a nadie porque nadie ha comprado todavía.**

> **No puedo medir producción desde aquí.** Para saberlo, esta consulta:
>
> ```sql
> SELECT p.interval, s.status, count(*) AS suscripciones,
>        count(*) FILTER (WHERE s.status IN ('ACTIVE','CANCELING','PAST_DUE')) AS vivas
> FROM "Subscription" s JOIN "Price" p ON p.id = s."priceId"
> GROUP BY 1, 2 ORDER BY 1, 2;
>
> -- Y cuánta cuota han dejado de recibir los anuales vivos:
> SELECT s."userId", s."currentPeriodStart", s."currentPeriodEnd",
>        (SELECT count(*) FROM "Entitlement" e
>          WHERE e."userId" = s."userId" AND e.type = 'FEATURED_LISTING'
>            AND e.origin = 'PRO_QUOTA' AND e."createdAt" >= s."currentPeriodStart") AS destacados_usados
> FROM "Subscription" s JOIN "Price" p ON p.id = s."priceId"
> WHERE p.interval = 'YEAR' AND s.status IN ('ACTIVE','CANCELING','PAST_DUE');
> ```

**La lectura correcta del «latente»:** que hoy no muerda **no lo hace menos urgente, lo hace
más barato**. Arreglarlo ahora no exige compensar a nadie, no hay que decidir qué se le debe a
un cliente que lleva seis meses recibiendo 1/12, y no hay comunicación que hacer. **Es la
ventana buena para tocarlo.** Si se arregla después de la primera venta anual, cada una de
esas tres cosas pasa a existir.

### 2.4 El daño que YA es visible (aunque nadie haya comprado)

Dos mentiras están **escritas en pantalla hoy**, esperando al primer cliente anual:

1. **`/planes`, tarjeta anual.** `proFeatures` es **la misma variable** en las dos tarjetas
   ([planes/page.tsx:135 y :175](<../apps/web/src/app/(public)/planes/page.tsx#L175>)), y sale
   de `catalog.proBenefits`, que se construye sin mirar el intervalo:
   ```ts
   // billing.service.ts:1336-1340
   if (destacados > 0) beneficios.push(`${destacados} destacados gratis al mes, de ${duracion} días cada uno`);
   if (bumps > 0)      beneficios.push(`${bumps} bumps gratis al mes para subir tus anuncios`);
   ```
   **La tarjeta anual promete «4 destacados gratis al mes» y el sistema entrega 4 al año.**
   Es, literalmente, el defecto que `buildProBenefits` fue escrito para cerrar —«lo que el
   ajuste no concede, no se promete»— reaparecido por un eje que esa función no contempla.

2. **`/perfil/suscripcion`, bloque de cuota.** Para un anual pintaría, en la misma línea:
   *«Destacados gratis: 4 de 4 restantes **este mes**»* y *«Se renueva: 19/09/2027»*
   ([suscripcion/page.tsx:127-157](<../apps/web/src/app/(account)/perfil/suscripcion/page.tsx#L127>)).
   **Se contradice a sí mismo en dos líneas contiguas.**

3. **El aviso de caducidad**, para un anual, **salta una vez al año**: `resolverAvisoCaducidad`
   compara `periodEnd` con hoy y avisa dentro de los 3 días previos
   ([cuota-caducidad.ts:108](../apps/web/src/components/anuncios/cuota-caducidad.ts#L108)). Con
   `periodEnd` a doce meses, el aviso no aparece en 362 días y luego dice «se te pierde la
   cuota» de una cuota anual. **Funciona; lo que está mal es la ventana que mide.**

---

## §3 — El Pro manual, hoy

### 3.1 Cómo se marca — no hay flag ni rol: **es la ausencia de suscripción**

`AdminBillingService.grantPro`
([admin-billing.service.ts:221-273](../apps/api/src/modules/admin/admin-billing.service.ts#L221))
crea:

```ts
tx.entitlement.create({
  data: {
    userId,
    type: EntitlementType.PRO_SUBSCRIPTION,
    subscriptionId: null,   // ← «La marca de que es manual. No hay columna `source`:
    expiresAt,              //    esto ES la procedencia.» (comentario del propio código)
  },
})
```

| Pregunta del encargo | Respuesta verificada |
|---|---|
| ¿Un flag? | **No.** No existe columna `source`, `isManual` ni equivalente en `Entitlement`. |
| ¿Un rol? | **No.** `User.role` no interviene; la puerta Pro es `ProStatusService.isProActive`, que sólo mira entitlements vigentes ([pro-status.service.ts:59](../apps/api/src/modules/listing-gate/pro-status.service.ts#L59)). |
| ¿Una fecha de alta? | **Sí, y es el dato que el diseño necesita** — ver abajo. |

`revokePro` usa el mismo predicado (`subscriptionId: null`) para no poder revocarle nunca el
Pro a alguien que está pagando
([admin-billing.service.ts:293-301](../apps/api/src/modules/admin/admin-billing.service.ts#L293)).
`expiresAt` es **obligatorio y futuro** (lo valida el DTO + una comprobación explícita): **un
Pro manual siempre tiene fecha de caducidad**.

### 3.2 ¿Tiene una fecha desde la que contar?

**Sí, tres, y todas sirven:**

| Campo | Qué es | Sirve para el mes natural |
|---|---|---|
| `Entitlement.createdAt` | Cuándo lo concedió el admin | ✔ (ancla natural del alta) |
| `Entitlement.startsAt` | `@default(now())` — hoy siempre igual a `createdAt` | ✔ |
| `Entitlement.expiresAt` | Hasta cuándo es Pro | (el tope, no el ancla) |

**Y con el diseño que se propone no hace falta ninguna**: el mes natural de calendario no
necesita ancla por usuario. Se menciona porque es el dato que **sí** haría falta si se
eligiera la alternativa rodante (ver [§4.2](#42-la-decisión-calendario-o-rodante)).

### 3.3 Por qué hoy no tiene cuota — y por qué NO es un olvido

`getFeaturedQuotaStatus` pide desde el principio un entitlement **con** suscripción
(`proConPeriodoFilter`). Un Pro manual no encaja, así que cae en la rama
[274-285](../apps/api/src/modules/billing/entitlement.service.ts#L274):

```ts
return { isPro: true, quotaSource: 'NONE', limit: 0, used: 0, remaining: 0,
         bumpQuota: { limit: 0, used: 0, remaining: 0 }, ... };
```

Eso **es correcto hoy** y está documentado como decisión consciente (D-1) en
[`docs/auditoria-reconciliacion-video-cupones.md` §2.2](auditoria-reconciliacion-video-cupones.md)
y en [`docs/auditoria-pro-video.md`](auditoria-pro-video.md). Aquel informe llegó a
**recomendar no cambiarlo** (su tabla de decisiones, D-C). **Ernest decide lo contrario, y la
diferencia entre entonces y ahora es real:** entonces darle cuota al manual exigía inventarle
un ciclo de facturación falso; con el mes natural ya no hace falta inventar nada, porque el
anual obliga a construir el mecanismo de todas formas. **La objeción de aquel informe era el
coste, y el coste acaba de caer a casi cero.**

> **Nota sobre `hasActiveSubscription`.** Es un eje **distinto** de `quotaSource` y **no se
> toca** en este diseño. Responde «¿puede comprar un plan?» (se calcula con el mismo predicado
> que el guard del checkout) y seguirá siendo `false` para un Pro manual aunque pase a tener
> cuota. Confundirlos volvería a romper el botón de `/planes`.

---

## §4 — Dónde están las cantidades, hoy

**En `Setting`, no hardcodeadas y no en Stripe.** Verificado en las tres capas:

| Capa | Sitio | Valor real medido |
|---|---|---|
| Semilla | [seed-settings.ts:35,38,42](../apps/api/prisma/seed-settings.ts#L35) | `4`, `7`, `4` |
| BD (desarrollo) | tabla `Setting` | `proMonthlyFeaturedQuota=4`, `proQuotaFeaturedDurationDays=7`, `proMonthlyBumpQuota=4` |
| Lectura | [entitlement.service.ts:289-301](../apps/api/src/modules/billing/entitlement.service.ts#L289) | `Setting` → si falta la fila, constante de respaldo |
| Escritura | `PATCH /admin/settings/:key` → `AdminService.updateSetting` ([admin.service.ts:3574](../apps/api/src/modules/admin/admin.service.ts#L3574)) | whitelist `SETTING_KEYS` + validación `>= 1` |
| Pantalla | grupo **«Ventajas Pro y cuotas»** en `/admin/ajustes` ([ajustes-organizacion.ts:255-267](<../apps/web/src/app/(admin)/admin/ajustes/ajustes-organizacion.ts#L255>)) | `NumberSettingEditor` con `min={1}` |

**Conclusión operativa: «configurable en /admin/ajustes» es EXTENDER un molde que existe y
está completo** (título, descripción larga, grupo, editor, validación de servidor, defaults
para las claves sin fila). No hay que construir nada nuevo. El molde exacto a copiar es
`proMonthlyBumpQuota` ([ajustes/page.tsx:1220-1230](<../apps/web/src/app/(admin)/admin/ajustes/page.tsx#L1220>)).

**Stripe no interviene en las cantidades.** El `Price` sólo aporta el importe y el intervalo de
cobro; ningún metadato de Stripe se lee para la cuota.

---

## §5 — Hallazgos laterales (verificados, fuera del encargo pero pegados a él)

| # | Hallazgo | Dónde | Gravedad |
|---|---|---|---|
| **L1** | **Dos defaults distintos para la misma cuota.** `entitlement.service.ts` respalda `proMonthlyBumpQuota` con **4**; `buildProBenefits` lo respalda con **5** ([billing.service.ts:1271](../apps/api/src/modules/billing/billing.service.ts#L1271)). Sólo diverge si falta la fila `Setting` — hoy está sembrada, así que **no muerde**, pero es la página de precios prometiendo un número que el motor no da. | api | Baja (latente) |
| **L2** | **`proMonthlyFeaturedQuota` y `proMonthlyBumpQuota` exigen `>= 1`** ([admin.service.ts:382-393](../apps/api/src/modules/admin/admin.service.ts#L382)), así que **hoy no se puede apagar la cuota Pro desde admin**. Es deliberado («un plan Pro siempre concede al menos uno»). **Importa porque las claves nuevas del manual necesitan lo contrario** (0 = sin cuota). Ver [§7.2](#72-la-validación-tiene-que-ser-distinta--y-es-el-detalle-que-más-fácil-se-cuela). | api | Informativa |
| **L3** | **La tarjeta anual de `/planes` promete la cuota mensual.** Ya desarrollado en [§2.4](#24-el-daño-que-ya-es-visible-aunque-nadie-haya-comprado). Se arregla **solo** al arreglar el motor: en cuanto el anual reciba de verdad 4 al mes, la frase pasa a ser cierta. **No hay que tocar el texto.** | web | Se cierra con la pieza 1 |

---

# PARTE B — EL DISEÑO

## §6 — El mecanismo compartido: contar por MES NATURAL

### 6.1 El cambio, en una línea

```diff
- createdAt: { gte: currentPeriodStart }    // ventana = ciclo de facturación
+ createdAt: { gte: inicioDelMesNatural() } // ventana = mes de calendario
```

**Y con eso los tres casos quedan resueltos por el mismo código:**

| Tipo de Pro | Hoy | Con mes natural |
|---|---|---|
| **Mensual** | 4+4 por ciclo de cobro (≈ al mes) | 4+4 por mes natural — **prácticamente igual** |
| **Anual** | 4+4 **al año** | 4+4 **cada mes natural** → **12× más, la paridad** |
| **Manual** | **sin cuota** (no hay ventana) | 4+4 (o lo que diga su ajuste) **cada mes natural** — **habilitado** |

**Este es el punto que el encargo llama «la conexión», y es literal: una sola función pura
resuelve las dos piezas.** El anual necesita que la ventana deje de ser el ciclo; el manual
necesita que la ventana no dependa de que exista un ciclo. **Es el mismo requisito dicho dos
veces.**

### 6.2 La decisión: calendario o rodante

**Recomendación: MES NATURAL DE CALENDARIO** (día 1 a las 00:00 → último día a las 23:59:59).

| | **Calendario** (recomendado) | **30 días rodantes desde el alta** |
|---|---|---|
| ¿Necesita ancla por usuario? | **No** | **Sí** — y **tres anclas distintas**: `currentPeriodStart` (pago), `Entitlement.createdAt` (manual)… que es volver a tener tres reglas |
| ¿El usuario sabe cuándo se renueva? | **Sí: el día 1.** Sin mirar nada | No: hay que recordar cuándo se dio de alta |
| ¿Se puede calcular sin tocar la BD? | **Sí** (sólo el reloj) | No |
| ¿Deriva con el tiempo? | No | Sí (los meses de 31 días desplazan el ancla) |
| ¿Es «más justo» desde el alta? | Ligeramente menos | Ligeramente más |
| ¿Hay precedente en el proyecto? | **Sí**: [`invoicing/period.ts`](../apps/api/src/modules/invoicing/period.ts) ya define el mes natural así para el cron de facturación | No |
| Complejidad de implementación | **~15 líneas puras** | Anclas + normalización + caso «día 31» |

**El criterio que decide es el primero de la tabla, no la sencillez.** El objetivo del encargo
es **un solo mecanismo para los tres tipos**. La ventana rodante necesita saber «desde cuándo»
y eso obliga a preguntar a una fila distinta según el tipo de Pro — **es reintroducir la
dependencia del tipo de suscripción que este arreglo existe para eliminar**. El calendario es
el único que no pregunta nada.

**El segundo criterio es que sea decible.** «Tus destacados gratis se renuevan el día 1» es una
frase que cabe en el aviso de caducidad y que el usuario puede verificar solo. Con la rodante,
el aviso tendría que calcular y explicar una fecha distinta por usuario.

**Su coste, dicho sin adornos: el primer mes es parcial.** Quien se hace Pro el día 28 recibe
su cuota entera para tres días y otra entera el día 1. **Se propone aceptarlo, no prorratearlo:**

- El coste está **acotado**: como mucho **una cuota extra por usuario, una sola vez en su
  vida**.
- Prorratear (dar 4 × 3/31 ≈ 0,4 destacados) es **peor producto**: convierte un regalo de
  bienvenida en una fracción que hay que explicar, y obliga a redondear —hacia arriba regalas
  igual, hacia abajo estrenas el plan con cero cuota.
- Y es **coherente con lo que ya se hace**: un destacado de cuota dura 7 días fijos sin
  importar cuándo se pida.

### 6.3 La zona horaria — **hay que declararla, no heredarla**

«El día 1 a las 00:00» **de dónde**. Si se calcula con `new Date(y, m, 1)` se usa la zona del
proceso, y el propio proyecto ya avisa de que esa zona **no está garantizada**: *«un servidor
en UTC…»* ([instance-info.types.ts:136](../apps/api/src/modules/admin/instance-info.types.ts#L136)).
Con el servidor en UTC, en verano el mes cambiaría a las **02:00 hora peninsular**: alguien que
gasta su última cuota a la 01:00 del día 1 la vería contar contra el mes anterior.

**Propuesta: `Europe/Madrid`, declarada en la constante**, con el mismo patrón que ya existe
para las programaciones de bump — `BUMP_SCHEDULE_TIMEZONE` y el cálculo de offset con `Intl`,
que sobrevive a los cambios de hora
([next-run.ts:9-56](../apps/api/src/modules/bump-schedule/next-run.ts#L9)).

### 6.4 La forma del código

Un fichero nuevo, **función pura**, en el molde de `next-run.ts` e `invoicing/period.ts`:

```
apps/api/src/modules/billing/mes-natural.ts
  export const QUOTA_TIMEZONE = 'Europe/Madrid';
  export function inicioDelMesNatural(ahora: Date): Date   // día 1, 00:00, en zona
  export function finDelMesNatural(ahora: Date): Date      // último instante del mes
```

**Pura y sin Nest**, para que se pruebe sin base de datos ni reloj real —el mismo argumento
que ya está escrito en `next-run.ts` y en `cuota-caducidad.ts`. Aquí importa más que en
ninguno de los dos: **es la función de la que depende cuánto valor recibe cada cliente de
pago**, y tiene que poder probarse contra el 1 de enero, el 28 de febrero, el 31 de marzo y
los dos cambios de hora sin montar nada.

### 6.5 La regla que NO cambia: la cuota no se acumula

**Se mantiene intacta y sale gratis**: el reseteo sigue siendo derivado, así que lo no gastado
en septiembre simplemente deja de contar el 1 de octubre. Lo único que cambia es **cuándo**
ocurre ese corte. **El aviso de caducidad que ya existe sigue valiendo íntegro** — ver
[§9.1](#91-el-aviso-de-caducidad).

### 6.6 Lo que hay que unificar antes de tocar nada

Hoy la ventana se deriva **en tres funciones distintas** ([§1.1](#11-dónde-vive)). Cambiar tres
sitios a mano es exactamente cómo se producen las divergencias que este proyecto lleva
documentando desde `pro-status.service.ts` (*«dos implementaciones de "¿es Pro?" podrían
divergir y nadie se enteraría»*). **El primer paso de la ráfaga 1 es extraer una única
función** —«¿de qué ventana y con qué límites cuelga la cuota de este usuario?»— **de la que
tiren las tres**. Sin eso, el arreglo del anual puede aplicarse a la lectura y no a la reserva,
y el síntoma sería el peor posible: la pantalla dice «te quedan 3» y el botón responde «no
tienes cuota».

---

## §7 — Pieza 1: la paridad anual = mensual

### 7.1 No hay nada que igualar: **ya son las mismas cantidades**

Verificado: **no existen ajustes separados por intervalo**. `proMonthlyFeaturedQuota` y
`proMonthlyBumpQuota` son **uno por concepto, no uno por plan**, y `proConPeriodoFilter` no
mira `Price.interval` en ningún punto. **El anual y el mensual ya leen exactamente los mismos
dos números.**

**Por tanto la paridad no requiere ningún cambio propio: es un efecto automático del §6.**
En cuanto la ventana deja de ser el ciclo de cobro, ambos reciben `limit` por mes natural
porque ambos leen el mismo `limit` y la misma ventana.

**Y esto hay que dejarlo escrito como invariante**, porque es lo que impide que el bug vuelva:

> **La cuota es del PLAN PRO, no de la forma de pago.** Ningún punto del cálculo de cuota
> puede leer `Price.interval`, `Price.intervalCount`, `Subscription.currentPeriodStart` ni
> `currentPeriodEnd`. Si alguna vez un plan tuviera que dar cuota distinta, sería un `Setting`
> distinto, no una derivación del ciclo de cobro.

Se propone un **test e2e que lo fije**: un Pro `YEAR` y un Pro `MONTH` creados el mismo día
deben devolver `limit`, `remaining` y `periodEnd` **idénticos** en `GET /billing/pro-status`.
Ese test es la red que detecta el bug si alguien vuelve a atar la ventana al ciclo.

### 7.2 El contrato `periodStart` / `periodEnd` cambia de significado

Hoy son el ciclo de facturación. Con el arreglo pasan a ser **la ventana de la cuota** (día 1 →
fin de mes). **Se propone conservar los nombres y cambiar el significado**, por tres razones
verificadas:

1. **Sus dos lectores están dentro del bloque de cuota**, no en el de facturación:
   `resolverAvisoCaducidad` ([cuota-caducidad.ts:91-108](../apps/web/src/components/anuncios/cuota-caducidad.ts#L91))
   y el «Se renueva» que va junto a «restantes este mes»
   ([suscripcion/page.tsx:149-156](<../apps/web/src/app/(account)/perfil/suscripcion/page.tsx#L149>)).
   **Para los dos, el nuevo significado es el correcto**, y es justo el que arregla la
   contradicción de [§2.4](#24-el-daño-que-ya-es-visible-aunque-nadie-haya-comprado).
2. **La fecha de renovación del COBRO no se pierde**: se pinta desde
   `activeSubscription.currentPeriodEnd`, que es otro campo y otro origen
   ([suscripcion/page.tsx:110](<../apps/web/src/app/(account)/perfil/suscripcion/page.tsx#L110>),
   [SuscripcionActions.tsx:48](<../apps/web/src/app/(account)/perfil/suscripcion/_components/SuscripcionActions.tsx#L48>)).
   **No hay ningún sitio que se quede sin el dato de facturación.**
3. Renombrarlos a `quotaPeriodStart/End` obligaría a tocar los dos lectores y la interfaz TS
   sin ganar nada que el doc-comment no resuelva.

**Decisión abierta (D-4)** por si Ernest prefiere lo contrario: renombrar es más explícito y
cuesta ~4 ficheros. Recomiendo **no** renombrar, pero **sí** reescribir el doc-comment del
campo: es el sitio donde alguien volverá a mirar.

---

## §8 — El punto duro: el cerrojo de la reserva atómica

**Este es el único punto del diseño donde algo puede romperse de verdad, y hay que decidirlo
explícitamente.**

### 8.1 El problema

Hoy la reserva se serializa bloqueando la fila `Subscription`
([§1.4](#14-la-reserva-atómica-y-su-cerrojo)). Con el nuevo diseño:

- El Pro **manual no tiene fila `Subscription`**. No hay nada que bloquear.
- Y el motivo secundario del cerrojo actual —*«bloquea también una renovación de Stripe
  concurrente que intentara avanzar `currentPeriodStart`»*— **desaparece**: la ventana ya no
  depende de `currentPeriodStart`, así que una renovación concurrente deja de poder alterarla.

**Sin cerrojo, el bug es real y conocido:** dos peticiones simultáneas leen `remaining = 1`
antes de que ninguna escriba, y ambas conceden. Es exactamente lo que los dos tests e2e de
[§1.4](#14-la-reserva-atómica-y-su-cerrojo) prueban que hoy no pasa. **Quitarlo sin sustituto
sería regalar cuota a quien sepa pulsar dos veces.**

### 8.2 Las dos salidas

| | **A — Bloquear la fila `Entitlement`** (recomendada) | **B — `pg_advisory_xact_lock`** |
|---|---|---|
| Qué se bloquea | El `Entitlement` PRO_SUBSCRIPTION que concede la cuota | Un entero derivado de `userId` |
| ¿Existe siempre? | **Sí** — pagando y manual tienen entitlement; es lo que los hace Pro | Sí (no necesita fila) |
| ¿Cambia el estilo del código? | No: sustituye un `SELECT … FOR UPDATE` por otro | Sí: introduce un mecanismo nuevo en el proyecto |
| Riesgo | Hay que elegir **determinísticamente** cuál si hay varios | Espacio global de 64 bits: colisiones entre features distintas serializan de más |
| Se libera | Al confirmar/revertir la `tx` | Igual (`_xact_`) |

**Recomendada la A.** Bloquea *la fila que responde a la pregunta* («¿quién le concede esta
cuota a este usuario?»), existe en los tres casos, y mantiene el patrón que los tests ya
ejercitan. **B queda como plan de respaldo** si al implementar apareciera alguna ambigüedad
irreducible en la elección.

### 8.3 El desempate: cuál entitlement manda

Un usuario puede tener **varios** PRO_SUBSCRIPTION vigentes a la vez —ése fue precisamente el
defecto que arregló U1: *«un Pro concedido a mano a alguien que YA PAGA es más nuevo, no tiene
suscripción, y taparía la cuota mensual que ese cliente está pagando»*
([entitlement.service.ts:19-41](../apps/api/src/modules/billing/entitlement.service.ts#L19)).

**La regla de desempate tiene que conservar esa corrección**, y se propone una única función
—«el entitlement que manda»— con este orden:

1. **Gana el que tenga `subscriptionId ≠ null`** (el de pago), el más reciente si hay varios.
   → `quotaSource: 'SUBSCRIPTION'`, cantidades del plan pagado.
2. **Si no hay ninguno de pago, gana el manual** más reciente.
   → `quotaSource: 'MANUAL'`, cantidades de los ajustes del manual.
3. Si no hay ninguno vigente → no es Pro → `quotaSource: 'NONE'`, todo a 0.

**Consecuencia deliberada: un Pro manual que además paga cobra la cuota del PLAN, no la suma
de las dos.** Es lo correcto —la concesión manual es una cortesía, no un acumulable— y es
exactamente lo que U1 dejó fijado. **Conviene un test que lo blinde**, porque el paso 2 es
código nuevo pisando el terreno que U1 arregló, y `pro-sin-periodo.e2e-spec.ts` ya tiene el
molde.

---

## §9 — Pieza 2: la cuota del Pro manual, configurable

### 9.1 Los dos `Setting` nuevos

| Clave | Título en `/admin/ajustes` | Default sin fila | Validación |
|---|---|---|---|
| `proManualMonthlyFeaturedQuota` | Cuota mensual de destacados (Pro concedido) | **0** | entero **>= 0** |
| `proManualMonthlyBumpQuota` | Cuota mensual de bumps (Pro concedido) | **0** | entero **>= 0** |

**Propios e independientes del plan pagado**, como pide el encargo: Ernest decide el número
sin tocar lo que reciben los clientes de pago, y al revés.

Lo que hay que tocar es el molde completo de un ajuste, ya inventariado en [§4](#4--dónde-están-las-cantidades-hoy):
`SETTING_KEYS` · `SETTING_DEFAULTS` · la lista de validación · `SETTING_TITLES` ·
`SETTING_DESCRIPTIONS` · el grupo **«Ventajas Pro y cuotas»** de `GRUPOS` · un
`NumberSettingEditor` con `min={0}` · y `seed-settings.ts`.

> **Nota sobre sembrar o no.** El backend devuelve **toda** clave del whitelist aunque no
> tenga fila, con su default y `configured: false`
> ([admin.service.ts:3464-3477](../apps/api/src/modules/admin/admin.service.ts#L3464)), y la
> tarjeta se pinta igual, con el rótulo *«Sin configurar — se usa el valor por defecto»*.
> **Por eso NO hace falta sembrarlas**, y se recomienda no hacerlo: «sin configurar» es aquí
> un estado honesto y visible que dice exactamente la verdad —la cuota del manual no se ha
> decidido todavía—. Es el mismo criterio con el que nacieron `totalListingLimitEnabled` y
> `emailVerifiedToPublishEnabled`.

### 9.2 La validación tiene que ser DISTINTA — y es el detalle que más fácil se cuela

Las dos claves del plan pagado están en `POSITIVE_INT_SETTING_KEYS`, que exige **`>= 1`**
([admin.service.ts:382-393](../apps/api/src/modules/admin/admin.service.ts#L382), con un
comentario que argumenta *«a Pro plan always grants at least one of each per period»*).

**Meter ahí las claves nuevas rompería el requisito de retrocompatibilidad**: si el mínimo es
1, el estado «el Pro manual no tiene cuota» deja de ser configurable y **todos los Pro
manuales existentes empezarían a recibir cuota el día del despliegue**, sin que nadie lo
decida.

**Hace falta una lista nueva** —`NON_NEGATIVE_INT_SETTING_KEYS`, `>= 0`— con las dos claves del
manual. **El 0 no es un valor degenerado aquí: es el valor por defecto y el que preserva el
comportamiento de hoy.**

### 9.3 `quotaSource: 'MANUAL'` — y cuándo NO usarlo

El campo pasa a `'SUBSCRIPTION' | 'MANUAL' | 'NONE'`. El hueco estaba dejado a propósito
([§1.5](#15-el-contrato-que-sale-al-frontend)).

**La regla fina, que es la que evita una regresión:**

> Un Pro manual devuelve `quotaSource: 'MANUAL'` **sólo si alguna de las dos cantidades es > 0**.
> Con las dos a 0 devuelve **`'NONE'`**, exactamente como hoy.

**Por qué importa:** `/mis-anuncios` decide pintar el recuadro de cuota con
`tieneCuota = isPro && quotaSource !== 'NONE'`
([MisAnunciosClient.tsx:78](../apps/web/src/components/anuncios/MisAnunciosClient.tsx#L78)) y,
si `remaining === 0`, escribe **«Has usado tus destacados gratis de este mes»**
([:155](../apps/web/src/components/anuncios/MisAnunciosClient.tsx#L155)). Devolver `'MANUAL'`
con límite 0 le diría a un Pro manual sin cuota que **gastó** unos destacados que nunca tuvo
— **que es literalmente el defecto que UXV.6 arregló** y que el doc-comment de esa línea deja
escrito. **El contrato tiene que hacer imposible reintroducirlo.**

**Corolario con una cuota a 0 y la otra no** (p. ej. bumps 2, destacados 0): `quotaSource`
sería `'MANUAL'` y el recuadro diría «Has usado tus destacados gratis» sobre un límite de 0.
**`/mis-anuncios` tiene que pasar a condicionar cada frase por su propio `limit > 0`, no por
`quotaSource`.** Es un cambio pequeño y entra en la ráfaga 2. *(Nota: la misma situación es
alcanzable hoy en el plan de pago sólo por debajo de la validación, ya que `>= 1` lo impide
desde admin — con las claves del manual a `>= 0` pasa a ser un estado normal y alcanzable.)*

### 9.4 Retrocompatibilidad — el balance exacto

| Escenario | Antes | Después, sin tocar ningún ajuste |
|---|---|---|
| Pro manual, ajustes sin configurar | sin cuota, `quotaSource: 'NONE'` | **idéntico** |
| Pro manual, Ernest pone 2 y 2 | — | recibe 2+2 cada mes natural, `'MANUAL'` |
| Pro mensual | 4+4 por ciclo | 4+4 por mes natural (ver [§11.2](#112-la-transición--el-único-riesgo-de-despliegue)) |
| Pro anual | 4+4 al **año** | 4+4 al **mes** — **el arreglo** |
| No Pro | nada | nada |

---

## §10 — El efecto en lo que ya está hecho

### 10.1 El aviso de caducidad

[`cuota-caducidad.ts`](../apps/web/src/components/anuncios/cuota-caducidad.ts) **funciona para
los tres tipos sin cambiar una línea de su lógica**, y conviene ver por qué, condición a
condición:

| Guarda | Mensual | Anual | Manual con cuota | Manual sin cuota |
|---|---|---|---|---|
| `if (!isPro) return null` | pasa | pasa | pasa | pasa |
| `if (quotaSource === 'NONE') return null` | pasa | pasa | pasa (`'MANUAL'`) | **para** ✔ |
| `if (!periodEnd) return null` | pasa | pasa | pasa (fin de mes) | — |
| `if (remaining <= 0 && bumps <= 0)` | correcto | correcto | correcto | — |
| ventana de 3 días sobre `periodEnd` | fin de mes | **fin de mes** (antes: aniversario anual) | fin de mes | — |

**Las dos comprobaciones que ya existían resultan ser exactamente las correctas**: la de
`quotaSource` deja fuera al manual sin cuota **por el mismo motivo de siempre** —«avisarle
sería contarle que pierde algo que nunca tuvo»— y la de `periodEnd` sigue siendo su segunda
puerta.

**Lo que sí cambia, y a mejor:** el anual pasa de recibir el aviso **una vez al año sobre una
cuota anual** a recibirlo **doce veces, a fin de mes, sobre la cuota del mes**. Eso es
consecuencia directa de que `periodEnd` pase a ser el fin del mes natural
([§7.2](#72-el-contrato-periodstart--periodend-cambia-de-significado)).

**Tests que hay que revisar** (no necesariamente cambiar): `cuota-caducidad.test.ts`,
`quota-reminder.test.tsx`, `e2e/cuota-caducidad.spec.ts`. Los que fijan fechas de periodo
tendrán que expresarlas como fin de mes.

**Retoque de texto, opcional pero recomendado:** `cuandoCaduca()` puede decir «el 30 de
septiembre» igual que hoy; pero ahora que la fecha es siempre fin de mes, el aviso **podría**
añadir «se renuevan el día 1», que es información que antes no se podía dar porque cada usuario
renovaba un día distinto. **Es una mejora que este cambio habilita, no un requisito.**

### 10.2 Las tres bolsas en cascada

El orden confirmado (D11) es **cuota Pro → saldo de bumps → créditos**, encadenado dentro de
una sola `$transaction`
([billing.service.ts:659-680 y 783-800](../apps/api/src/modules/billing/billing.service.ts#L659)).

**La cascada no se toca.** Lo único que cambia es que `hasAvailableBumpQuota` empiece a
devolver `true` para un anual con su mes recién estrenado y para un manual con cuota
configurada. **El nivel 1 se les enciende; los niveles 2 y 3 siguen exactamente igual.**

Consecuencia económica que conviene ver con los ojos abiertos: **un anual que antes agotaba su
cuota en enero y pagaba con créditos los otros once meses, ahora no paga.** Eso es el arreglo
funcionando, no un efecto secundario — pero es ingreso en créditos que deja de entrar, y es
parte de lo que Ernest está decidiendo.

### 10.3 El bump automático

[`bump-auto.processor.ts`](../apps/api/src/modules/bump-schedule/bump-auto.processor.ts) **no
replica el cobro**: llama a `BillingService.bump`
([:92](../apps/api/src/modules/bump-schedule/bump-auto.processor.ts#L92)), que es quien elige la
bolsa. **Hereda el arreglo sin tocar nada.**

Efecto real y deseable: una programación de bump automático de un Pro **anual** hoy consume
cuota en la primera ejecución del año y créditos en las ~51 restantes. Después consumirá cuota
las primeras 4 de cada mes. **Y su mensaje de fallo —«Sin cuota Pro, saldo de bumps ni créditos
suficientes»** ([:143](../apps/api/src/modules/bump-schedule/bump-auto.processor.ts#L143))—
**pasa a ser cierto con menos frecuencia**, que es justo el sentido correcto.

### 10.4 El rendimiento — no cambia

La consulta sigue siendo `createdAt >= <instante>`; sólo cambia el instante. El índice
`Entitlement(userId, type, origin, createdAt)` la sirve igual. En `BumpLedger` los índices son
`(walletId)` y `(createdAt)` por separado —no ideal— pero **idéntico antes y después**: este
diseño no lo mejora ni lo empeora, y no procede tocarlo aquí.

---

## §11 — El plan de ráfagas

### 11.1 Las tres ráfagas

**RÁFAGA 1 — El mes natural y la paridad del anual** *(la pieza 1; es la que arregla un bug
que cuesta dinero)*

1. `mes-natural.ts`: función pura + tests unitarios (1 de enero, 28/29 de febrero, 31 de marzo,
   los dos cambios de hora, medianoche exacta).
2. **Unificar las tres derivaciones de ventana** en una sola función interna de
   `EntitlementService` ([§6.6](#66-lo-que-hay-que-unificar-antes-de-tocar-nada)). **Este paso
   va antes que el cambio de ventana, no después.**
3. Sustituir `currentPeriodStart` por `inicioDelMesNatural()` en esa única función.
4. **Sustituir el cerrojo** por el `FOR UPDATE` sobre `Entitlement`
   ([§8](#8--el-punto-duro-el-cerrojo-de-la-reserva-atómica)) y **verificar que los dos tests de
   carrera existentes siguen en verde** — son la prueba de que la reserva sigue siendo atómica.
5. `periodStart/periodEnd` pasan a ser la ventana de la cuota; reescribir su doc-comment.
6. **Test de paridad**: un `YEAR` y un `MONTH` creados el mismo día devuelven lo mismo
   ([§7.1](#71-no-hay-nada-que-igualar-ya-son-las-mismas-cantidades)).
7. Revisar los tests de caducidad, que expresan periodos.

> Al terminar la ráfaga 1, **la tarjeta anual de `/planes` deja de mentir sin tocarla** ([L3](#5--hallazgos-laterales-verificados-fuera-del-encargo-pero-pegados-a-él)).

**RÁFAGA 2 — La cuota del Pro manual, configurable** *(la pieza 2; se apoya entera en la 1)*

1. Los dos `Setting` nuevos, con default 0 y la lista de validación `>= 0` nueva
   ([§9.2](#92-la-validación-tiene-que-ser-distinta--y-es-el-detalle-que-más-fácil-se-cuela)).
2. La función «el entitlement que manda» con su desempate
   ([§8.3](#83-el-desempate-cuál-entitlement-manda)) + test de que el de pago sigue ganando.
3. `quotaSource: 'MANUAL'`, con la regla de **no** emitirlo cuando ambas cantidades son 0
   ([§9.3](#93-quotasource-manual--y-cuándo-no-usarlo)).
4. `/admin/ajustes`: las dos tarjetas en el grupo «Ventajas Pro y cuotas».
5. `/mis-anuncios`: cada frase condicionada por **su** `limit > 0`, no por `quotaSource`.
6. Test e2e: manual con 0 → idéntico a hoy; manual con 2 → recibe 2 y se le acaban a la
   tercera; el 1 del mes siguiente vuelve a tener 2.

**RÁFAGA 3 (pequeña) — La coherencia de alrededor**

1. **L1**: unificar el default de `proMonthlyBumpQuota` (4 en el motor, 5 en la página de
   precios).
2. Revisar si `buildProBenefits` debe mencionar que la cuota se renueva el día 1.
3. Actualizar `docs/estado-tecnico.md` y `docs/contratos-api.md` con el nuevo significado de
   `periodStart/periodEnd` y el tercer valor de `quotaSource`; anotar **D-1 como cerrada en
   sentido afirmativo** en `docs/auditoria-reconciliacion-video-cupones.md` y
   `docs/auditoria-pro-video.md`, que hoy la dan por abierta.

### 11.2 La transición — **el único riesgo de despliegue**

**El escenario, con nombres y fechas.** Un Pro mensual cuyo ciclo va del **25 de enero al 25 de
febrero**. El 10 de febrero gastó sus 4 destacados (contra su ciclo, correctamente). Se
despliega el cambio el **20 de febrero**. A partir de ese instante la ventana es **1–28 de
febrero**, y el `COUNT` **ve los 4 del día 10**. Resultado: **se queda sin cuota hasta el 1 de
marzo, habiendo gastado la de un ciclo que ya terminó.**

Es el efecto simétrico y menos visible del caso contrario (alguien a quien el cambio le regala
una cuota extra). **El que regala es aceptable; el que quita, no** — es facturación, y quitarle
a un cliente algo que ya había ganado no se hace por conveniencia de calendario.

**Dos salidas, y conviene elegir ahora:**

| | **A — Desplegar el día 1** | **B — Suelo de época** |
|---|---|---|
| Cómo | Publicar la ráfaga 1 en las primeras horas del día 1 de un mes | `gte: max(inicioDelMesNatural, EPOCH)`, con `EPOCH` = instante del despliegue, activo sólo ese primer mes |
| Coste | Cero código; una restricción de calendario | ~3 líneas + una constante que se retira el mes siguiente |
| Quién puede perder | Nadie (la ventana nueva empieza vacía) | Nadie |
| Quién gana de más | Nadie | Todo Pro activo: una cuota extra ese mes |

**Recomendada la A**, y hoy es **gratis**: con **0 suscripciones en la base**
([§2.3](#23-el-alcance-del-bug--cuántos-pro-anuales-hay)) no hay ni a quien quitarle ni a quien
regalarle. **B queda escrita por si la ráfaga se retrasa más allá de las primeras ventas** —
en ese momento deja de ser opcional.

---

## §12 — Las decisiones para Ernest

| # | Decisión | Opciones | Recomendación | Por qué |
|---|---|---|---|---|
| **D-1** | **¿El Pro manual recibe cuota mensual?** *(la decisión que lleva abierta desde la ficha de usuario)* | Sí / No | **Sí** | Es el encargo; el hueco (`quotaSource`) se dejó para esto y el mecanismo lo construye la pieza 1 de todas formas |
| **D-2** | **El borde del mes natural** | **Calendario** (día 1) / 30 días rodantes desde el alta | **Calendario** | Es el único que **no necesita ancla por usuario**, y por tanto el único que da UN mecanismo para los tres tipos ([§6.2](#62-la-decisión-calendario-o-rodante)) |
| **D-3** | **La zona horaria de «el día 1»** | `Europe/Madrid` / la del servidor | **`Europe/Madrid`, declarada** | Con el servidor en UTC, en verano el mes cambia a las 02:00 peninsulares ([§6.3](#63-la-zona-horaria--hay-que-declararla-no-heredarla)) |
| **D-4** | **¿`periodStart`/`periodEnd` cambian de significado o de nombre?** | Conservar nombre / renombrar a `quotaPeriod*` | **Conservar** | Sus dos lectores están en el bloque de cuota y el nuevo significado es el que les corresponde ([§7.2](#72-el-contrato-periodstart--periodend-cambia-de-significado)) |
| **D-5** | **Las cantidades de la cuota manual** | Un número / dos números / que hereden del plan | **Dos `Setting` propios, default 0** | Lo pide el encargo, y el 0 es lo que hace el cambio retrocompatible ([§9](#9--pieza-2-la-cuota-del-pro-manual-configurable)) |
| **D-6** | **¿Cuánto vale la cuota del manual?** — el número | 0 / 1+1 / 2+2 / lo mismo que el plan | **Decisión de negocio de Ernest.** Nota: igualarla al plan pagado (4+4) regala **143 €/año** de valor a cada concesión de cortesía | Salir con **0** y subirlo a conciencia es lo prudente: el default no decide por Ernest |
| **D-7** | **El cerrojo de la reserva** | `FOR UPDATE` sobre `Entitlement` / `pg_advisory_xact_lock` | **`Entitlement`** | Existe en los tres casos y mantiene el patrón que los tests ya ejercitan ([§8.2](#82-las-dos-salidas)) |
| **D-8** | **Pro manual + Pro de pago a la vez** | Gana el de pago / se suman | **Gana el de pago** | Es lo que fijó U1; sumar convertiría una cortesía en un acumulable ([§8.3](#83-el-desempate-cuál-entitlement-manda)) |
| **D-9** | **La transición** | Desplegar el día 1 / suelo de época | **Día 1** (hoy es gratis: 0 suscripciones) | Es la única que no quita cuota ya ganada, y no cuesta código ([§11.2](#112-la-transición--el-único-riesgo-de-despliegue)) |
| **D-10** | **El primer mes parcial** | Cuota entera / prorratear | **Entera** | Coste acotado a una cuota por usuario y una sola vez; prorratear obliga a explicar fracciones ([§6.2](#62-la-decisión-calendario-o-rodante)) |

---

## §13 — Lo que este diseño NO toca (y conviene que siga así)

- **`hasActiveSubscription`** — otro eje, otra pregunta. Un Pro manual con cuota sigue
  teniéndolo a `false`, y `/planes` sigue dejándole comprar un plan.
- **`isPro` / `ProStatusService`** — «¿es Pro?» no cambia. Todo este documento trata de la otra
  pregunta.
- **El reseteo derivado** — sigue sin haber cron ni contador. Es lo mejor del diseño actual.
- **El orden de la cascada** (cuota → saldo → créditos) y **el cooldown del bump**.
- **`grantPro` / `revokePro`** — la concesión manual no cambia de forma. Sigue sin haber
  columna `source`: `subscriptionId: null` es la marca.
- **Stripe** — no se toca el catálogo, ni los webhooks, ni `currentPeriodStart`, que sigue
  siendo la verdad del **cobro**. Lo único que cambia es que la cuota deja de preguntárselo.
- **`quotaDurationDays`** (7 días por destacado de cuota) — independiente de todo esto.

---

## §14 — Resumen de verificación

| Afirmación del encargo | Veredicto | Dónde se comprobó |
|---|---|---|
| «La cuota es un `COUNT` desde `Subscription.currentPeriodStart`» | **CONFIRMADO** | [entitlement.service.ts:309, 390, 435](../apps/api/src/modules/billing/entitlement.service.ts#L309) |
| «El anual recibe 1/12» | **CONFIRMADO**, y medido: 4 al año vs 48 | [§2.2](#22-los-números) |
| «¿Cuántos Pro anuales hay?» | **0 suscripciones** en desarrollo → **bug latente**. Producción: consulta en [§2.3](#23-el-alcance-del-bug--cuántos-pro-anuales-hay) | BD `marketplace-postgres` |
| «El Pro manual es `quotaSource: 'NONE'`» | **CONFIRMADO** | [entitlement.service.ts:274-285](../apps/api/src/modules/billing/entitlement.service.ts#L274) |
| «¿Cómo se marca un Pro manual?» | **Ni flag ni rol**: `Entitlement{PRO_SUBSCRIPTION, subscriptionId: null}` | [admin-billing.service.ts:239-249](../apps/api/src/modules/admin/admin-billing.service.ts#L239) |
| «¿Tiene fecha desde la que contar?» | **Sí** (`createdAt`/`startsAt`), pero **el diseño recomendado no la necesita** | [§3.2](#32-tiene-una-fecha-desde-la-que-contar) |
| «Las cantidades: ¿hardcode, `Setting` o Stripe?» | **`Setting`**, con constante de respaldo. Stripe no interviene | [§4](#4--dónde-están-las-cantidades-hoy) |
| «`/admin/ajustes` tiene molde para extender» | **CONFIRMADO**, molde completo | [§4](#4--dónde-están-las-cantidades-hoy) |
| «El anual debería tener las mismas cantidades» | **Ya las tiene**: no hay ajustes por intervalo. Sólo falla la ventana | [§7.1](#71-no-hay-nada-que-igualar-ya-son-las-mismas-cantidades) |
| «El bump automático hereda el cambio» | **CONFIRMADO**: llama a `BillingService.bump` | [bump-auto.processor.ts:92](../apps/api/src/modules/bump-schedule/bump-auto.processor.ts#L92) |
| «El aviso de caducidad funciona para los tres» | **Sí, sin cambiar su lógica** — sus dos guardas resultan ser las correctas | [§10.1](#101-el-aviso-de-caducidad) |
| — *(no estaba en el encargo)* | **El cerrojo de la reserva cuelga de una fila que el manual no tiene.** Hay que sustituirlo | [§8](#8--el-punto-duro-el-cerrojo-de-la-reserva-atómica) |
| — *(no estaba en el encargo)* | **`/planes` ya promete hoy al anual la cuota que no le da** | [§2.4](#24-el-daño-que-ya-es-visible-aunque-nadie-haya-comprado) |
| — *(no estaba en el encargo)* | **`>= 1` en la validación impediría el `0` retrocompatible del manual** | [§9.2](#92-la-validación-tiene-que-ser-distinta--y-es-el-detalle-que-más-fácil-se-cuela) |
