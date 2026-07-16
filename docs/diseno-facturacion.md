# Diseño del sistema de facturación — revisión 3

> **Fase:** Hito 8 (H8) · Revisión 3 del diseño de monetización — cierre del Hito 8 enfocado
> **Fecha:** 2026-07-05
> **Estado:** Hito 8 enfocado CERRADO. Este documento refleja lo REALMENTE construido
> (H8.1–H8.5b, Bloque E), no lo planeado originalmente — donde el plan y la implementación
> divergieron, gana la implementación.
>
> Este documento reemplaza la revisión 2 (2026-06-26), que a su vez reemplazó la revisión 1
> (2026-06-24). Las ráfagas RF.2–RF.13 (Hito 4) y el Plan Pro (Hito 4/5) ya estaban
> implementadas antes de esta revisión. Lo nuevo en esta revisión es todo el Hito 8: la
> consolidación de las ventajas Pro, la cuota mensual de destacados, y el Bloque E
> (Vendedor de confianza, independiente de Pro). Ver §1.4, §1.4.1, §1.5 y §16.

---

## 0. Estado al inicio de esta revisión

### 0.1 Qué hay implementado

| Ráfaga | Contenido | Estado |
|---|---|---|
| **RF.2** | Schema `add_billing`: 6 modelos (`Product`, `Price`, `Entitlement`, `Subscription`, `Transaction`, `GatewayEvent`) + `User.stripeCustomerId` | ✅ Implementada |
| **RF.3** | `BillingModule` NestJS: checkout Pro (Stripe Checkout), `StripeWebhookGuard`, `BillingProcessor` (5 eventos Stripe), `EntitlementService` | ✅ Implementada |

### 0.2 Qué cambia en esta revisión

| Aspecto | Diseño v1 | Diseño v2 |
|---|---|---|
| Pasarelas | Solo Stripe | Stripe (Pro) + Redsys (créditos + destacado directo) |
| Productos | Destacado (ONE_TIME) + Pro (RECURRING) | + Packs de créditos; + Bump |
| Wallet | No existía | Nuevo: `Wallet` + `CreditLedger` + `CreditPack` |
| Bump | No existía | Nuevo: `bumpedAt` en `Listing`; límite 1/hora; créditos |
| Destacado | Solo pago Stripe | Dos vías: créditos O pago directo Redsys |
| Meilisearch | Solo `boostScore` | `boostScore` (featured) + `sortDate` (bump), ortogonales |

Los 6 modelos de RF.2 son agnósticos de pasarela y se conservan íntegros. Solo se extienden.

---

## 1. Catálogo de productos y acciones

### 1.1 Packs de créditos

Los créditos son unidades internas abstractas sin valor € fijo (el valor real lo determina el precio del pack). **No caducan. No son reembolsables.**

La compra del pack es el único hecho imponible asociado a los créditos: se factura IVA en ese momento. Gastar créditos es un movimiento interno sin nueva factura.

| Pack | Créditos | Precio orientativo (IVA incluido) |
|---|---|---|
| Pack Básico | 50 | 4,99 € |
| Pack Estándar | 150 | 9,99 € |
| Pack Max | 400 | 19,99 € |

Valores en BD (`Price.amount`, `CreditPack.creditAmount`), no en código. Configurables desde backoffice.

### 1.2 Destacado de anuncio

**Dos vías de pago que producen exactamente el mismo efecto**: un `Entitlement FEATURED_LISTING` con la misma duración y el mismo boost. No hay diferencia visible para el usuario ni para el sistema de entitlements.

| Variante | Vía Redsys | Vía créditos |
|---|---|---|
| 7 días | 2,99 € | 30 créditos |
| 14 días | 4,99 € | 50 créditos |
| 30 días | 7,99 € | 100 créditos |

Los costes en créditos viven en `Setting` (`featuredCreditCost7d`, `featuredCreditCost14d`, `featuredCreditCost30d`), inicializados por el seed.

**Restricciones (idénticas en ambas vías):**
- Solo anuncios en estado `ACTIVE` del propio usuario.
- Un anuncio solo puede tener un destacado activo en todo momento.
- Al vencer el destacado el anuncio permanece publicado; solo deja de tener boost.

### 1.3 Bump (refrescar anuncio)

Empujón puntual de recencia: sube el anuncio al top de los listados sin boost sostenido. Solo vía créditos. Independiente del destacado (ambos pueden estar activos simultáneamente).

| Coste | Límite | Efecto |
|---|---|---|
| 5 créditos (configurable en `Setting.bumpCreditCost`) | 1 bump/hora por anuncio (límite duro) | `Listing.bumpedAt = now()` |

El límite se aplica únicamente a los bumps realizados con éxito. Los intentos fallidos (saldo insuficiente, anuncio no activo) **no** consumen el cooldown.

### 1.4 Plan Pro (solo Stripe)

Suscripción recurrente gestionada íntegramente por Stripe.

> **Principio real (H8, corrige la revisión 2):** la revisión 2 de este documento decía "Pro no
> regala créditos ni otorga descuentos en packs". Esa frase era **falsa** desde que se implementó
> §2.5 (bonus de créditos Pro) y lo sigue siendo con la cuota de destacados de H8 — Pro sí concede
> beneficios reales, materializados en el wallet y en los entitlements del usuario. El principio
> que de verdad se preserva, y que nunca se ha roto, es otro: **Pro nunca altera el precio cobrado
> ni el hecho imponible.** El importe que paga un Pro por un pack de créditos es el mismo que paga
> cualquiera (§2.5); el IVA se calcula igual para todos. Los beneficios Pro viven enteramente
> dentro de sistemas internos sin IVA (wallet, entitlements) — nunca en el precio ni en la factura.
> Esa es la regla a preservar en cualquier beneficio Pro futuro, no "cero beneficios".

| Variante | Precio | Ciclo |
|---|---|---|
| Pro Mensual | 9,99 €/mes | Mensual, renovación automática |
| Pro Anual | 89,99 €/año (~7,50 €/mes) | Anual, renovación automática |

**Tabla canónica de derechos `PRO_SUBSCRIPTION` (H8 — reemplaza la tabla de la revisión 2, que
había quedado desactualizada e incompleta):**

| Derecho | Free | Pro | Estado |
|---|---|---|---|
| Anuncios activos simultáneos | `freeActiveListingLimit` (5) | `proActiveListingLimit` (20) | ✅ Implementado (RF.7). Configurable en `Setting`, editable en `/admin/ajustes`. |
| Bonus de créditos al comprar packs | — | `proExtraCreditsPercent` (20%) | ✅ Implementado (§2.5, RF.10). Congelado en el checkout, no en la confirmación (§2.5). |
| Badge "Pro" en perfil público | — | ✓ | ✅ Implementado (H8.4). Icono `Crown`, `/vendedor/[slug]`. Ver §1.4.2. |
| Destacados gratis al mes | — | `proMonthlyFeaturedQuota` (4), duración fija `proQuotaFeaturedDurationDays` (7d) | ✅ Implementado (H8.1–H8.5a). Ver §1.4.1 — es el núcleo de este hito. |

**Deuda previa, fuera de alcance del Hito 8 (declarada aquí desde la revisión 2, nunca
implementada — no confundir con lo de arriba, que sí está construido):**

| Derecho declarado | Estado real |
|---|---|
| Fotos por anuncio (4 free / 10 Pro) | ❌ No implementado. No hay código que límite fotos por plan. |
| Estadísticas de visitas | ❌ No implementado. No hay ninguna superficie de estadísticas para el vendedor. |

Si se retoman, son candidatas para Hito 8b o Hito 9 — no se tocaron en H8 porque el hito se centró
en la cuota de destacados (la pieza que sí formaba parte del encargo).

### 1.4.1 Mecánica de la cuota mensual de destacados Pro (H8.1–H8.5a) — el núcleo del hito

**Las dos bolsas.** Un destacado puede venir de dos sitios que nunca se mezclan:

| Bolsa | Origen | Caducidad | Cómo se identifica |
|---|---|---|---|
| Cuota mensual Pro | Gratis, parte del plan Pro | Caduca al fin del periodo de facturación — no se acumula | `Entitlement.origin = PRO_QUOTA` |
| Adquirido | Créditos (`featuredByCredits`) o pago directo (Redsys) | No caduca nunca | `Entitlement.origin = CREDITS \| REDSYS` |

El campo que las distingue es `Entitlement.origin` (enum `FeaturedOrigin { CREDITS, REDSYS,
PRO_QUOTA }`), añadido en la migración `add_featured_origin` (H8.1) con backfill de las filas
`FEATURED_LISTING` preexistentes (`transactionId` presente → `REDSYS`; ausente → `CREDITS`). Es un
campo en el `Entitlement` ya existente (RF.2), no un modelo nuevo — evaluado y descartado un modelo
`FeaturedAllowance` separado porque hubiera introducido un segundo lugar donde el estado del
destacado pudiera desincronizarse.

**Reseteo DERIVADO — sin cron, sin contador que resetear.** "Usado este periodo" se calcula
contando cuántos `Entitlement` con `origin = PRO_QUOTA` tiene el usuario con `createdAt >=
subscription.currentPeriodStart`. `currentPeriodStart` es el mismo campo que Stripe avanza en cada
renovación de la suscripción (`invoice.payment_succeeded`, §5) — en cuanto avanza, los `PRO_QUOTA`
del periodo anterior dejan de contar automáticamente, sin que nada los "resetee" explícitamente. El
periodo se obtiene de la `Subscription` vinculada al `Entitlement PRO_SUBSCRIPTION` vigente
(`Entitlement.subscriptionId`), no de un `findFirst` genérico sobre `Subscription`, para no
confundirse con suscripciones canceladas residuales del mismo usuario.

```
limit     = Setting['proMonthlyFeaturedQuota']       (default 4)
used      = COUNT(Entitlement WHERE userId=X AND type=FEATURED_LISTING
                   AND origin='PRO_QUOTA' AND createdAt >= subscription.currentPeriodStart)
remaining = max(0, limit - used)
```

Expuesto en `GET /billing/pro-status` (`EntitlementService.getFeaturedQuotaStatus`), que devuelve
además `isPro`, `periodStart`/`periodEnd` y `quotaDurationDays` — el punto único que consulta el
frontend para saber "¿cuántos destacados gratis le quedan a este usuario?".

**El usuario elige la vía (H8.5a) — decisión de producto que sustituyó a la automática de H8.3.**
La primera versión (H8.3) hacía "cuota-primero" automáticamente: si había cuota, se usaba sin
preguntar. H8.5a cambió esto: el usuario elige explícitamente en `POST /billing/featured-by-credits`
vía el campo `useQuota: boolean` del DTO:

| `useQuota` | Efecto | Duración | Coste |
|---|---|---|---|
| `true` | Gratis, `origin = PRO_QUOTA` | FIJA: `Setting['proQuotaFeaturedDurationDays']` (7d). Ignora cualquier `priceId` recibido — no hay variante que elegir. | Ninguno. Sin débito de wallet, sin `CreditLedger`. |
| `false` / omitido | De pago, `origin = CREDITS` | A elegir por el usuario vía `priceId` (7/14/30d, como siempre) | Créditos, según `featuredCreditCost{N}d` |

Si el usuario pide cuota y no le queda (`remaining = 0`), el backend responde **`400
{ code: 'QUOTA_UNAVAILABLE' }`** — nunca cae a créditos en silencio, porque el usuario pidió cuota
a propósito; el frontend ofrece entonces la vía de créditos en el mismo diálogo, sin dejar al
usuario atascado. Si el usuario elige créditos teniendo cuota disponible, la cuota **queda intacta**
— puede reservarla deliberadamente para otro anuncio.

**Concurrencia — el punto que más cuidado exigió.** La cuota es derivada (un `COUNT`, no un saldo
decrementable como el `Wallet`), así que dos peticiones de cuota simultáneas del mismo usuario
podrían leer "remaining=1" antes de que ninguna cree su `Entitlement`, y ambas concederían un
destacado gratis para una cuota de uno. Se resuelve con
`EntitlementService.hasAvailableFeaturedQuota(tx, userId)`: bloquea la fila de la `Subscription`
vinculada (`SELECT ... FOR UPDATE`) dentro de la misma transacción que crea el `Entitlement
PRO_QUOTA` — la segunda petición concurrente espera ese lock hasta que la primera confirma (o
revierte), y su propio `COUNT`, ejecutado tras adquirir el lock, ya ve el grant recién creado. El
mismo lock protege también contra una renovación de Stripe concurrente que intentara avanzar
`currentPeriodStart` a mitad de la operación. **Verificado con un test que falla de forma
reproducible sin el lock** (dos peticiones de cuota concurrentes con `remaining=1` devuelven
`[201, 201]` sin lock — el bug exacto que preocupaba — y siempre `[201, 400]` con lock puesto).

**Settings nuevos**, ambos editables en `/admin/ajustes` (patrón `NumberSettingEditor`):

- `proMonthlyFeaturedQuota` (default 4) — cuántos destacados gratis al mes.
- `proQuotaFeaturedDurationDays` (default 7) — duración fija de un destacado pagado con cuota.

### 1.4.2 Badge "Pro" en el perfil público (H8.4)

`EntitlementService.isProActive(userId)` existía desde antes (gating de límites y precios) pero
nunca se usaba para mostrar nada. H8.4 lo expone en `UsersService.findBySlug` (el endpoint tras
`/vendedor/[slug]`) como `isPro: boolean` — un único cálculo por perfil, sin N+1 (es un vendedor,
no un listado). El frontend pinta un `<Badge>` con icono `Crown` (fondo primary sólido) junto al
nombre, solo cuando `isPro`. **Deliberadamente NO se toca la card de anuncio en listados/
búsqueda/categoría/home** — requeriría denormalizar `isPro` del vendedor en el documento de
Meilisearch (mismo mecanismo que `boostScore`) para evitar N+1 al pintar una lista con vendedores
distintos; queda anotado como mejora futura opcional en §16, no implementada.

### 1.5 Vendedor de confianza (H8 Bloque E) — INDEPENDIENTE de Pro

Bloque autocontenido, sin relación de dependencia con Pro en ningún sentido: un usuario puede ser
Pro, de confianza, ambos o ninguno. Mientras Pro es un beneficio que el usuario **compra**, "de
confianza" es una **decisión de la plataforma**, otorgada manualmente por un `ADMIN`.

- **Schema:** `User.trusted Boolean @default(false)`. Campo propio del usuario, no derivado de
  ningún cálculo (a diferencia de `isPro`, que sí requiere `isProActive`).
- **Backend admin:** `PATCH /admin/users/:id/trusted { trusted: boolean }` — **ADMIN-only**
  (hereda `@Roles(Role.ADMIN)` de la clase, sin override a `MODERATOR`). Decisión deliberada:
  otorgar confianza es decisión de plataforma, no moderación, a diferencia de suspender (que sí
  pueden hacer moderadores). `AuditLogService.log` con acción `USER_TRUST` / `USER_UNTRUST`
  (before/after `{trusted}`), mismo patrón que `changeUserStatus`/`changeUserRole`.
- **Exposición pública, sin Meili, con Postgres directo (no hay N+1 en ninguno de los dos casos):**
  - `UsersService.findBySlug` (`/vendedor/[slug]`): `trusted` es un campo directo del `select`.
  - `ListingsService` — `LISTING_INCLUDE.seller` (ficha del anuncio, `/anuncio/[slug]`, vía
    `SellerCard`): `trusted: true` añadido al `select` del vendedor.
- **Frontend:** badge `BadgeCheck` verde (`outline`, `border-green-300 bg-green-50 text-green-700`)
  — deliberadamente un tercer estilo visual distinto del Pro (`Crown`, primary sólido) y del
  "Destacado" (ámbar), para que los tres conceptos nunca se confundan. En `/vendedor/[slug]` ambos
  badges (Pro + confianza) conviven en la misma fila `flex flex-wrap`, sin amontonarse.
- **Admin UI:** columna "Confianza" en `/admin/usuarios` con badge de estado + botón
  Marcar/Quitar, visible solo para `ADMIN` (oculto para `MODERATOR`, igual que Banear/Desbanear).
- **Deuda conocida, no resuelta aquí:** ver §16 — la ficha del anuncio cachea al vendedor en Redis
  5 minutos; desmarcar a alguien no invalida esa caché.

---

## 2. Modelo de datos

### 2.1 Diagrama de relaciones

```
User ──── Wallet ──── CreditLedger  (libro contable inmutable)
  │
  ├── Subscription ──── Price ──── Product
  │         │                └──── CreditPack  (si Price es de un pack)
  │    Entitlement
  │         │
  ├── Transaction  (solo cobros reales con dinero; Stripe o Redsys)
  │         │
  └── Listing ──── (bumpedAt)

GatewayEvent  (idempotencia; sirve para Stripe y Redsys con campo gateway)
```

### 2.2 Modelos y enums nuevos (migración RF.4)

```prisma
// ============================================================================
//  ENUM NUEVO
// ============================================================================

enum CreditLedgerType {
  PACK_PURCHASE   // Compra de pack de créditos → entrada (positivo)
  FEATURED_DEBIT  // Destacado pagado con créditos → salida (negativo)
  BUMP_DEBIT      // Bump pagado con créditos → salida (negativo)
  ADMIN_CREDIT    // Acreditación manual de soporte → entrada
  ADMIN_DEBIT     // Débito manual de soporte → salida
  PRO_BONUS       // Créditos extra concedidos a usuarios Pro al comprar un pack → entrada
}

// ============================================================================
//  MODELOS NUEVOS
// ============================================================================

/// Pack de créditos comprable. El precio en EUR vive en el Price asociado.
/// Los costes de gastar créditos (featured, bump) viven en Setting.
model CreditPack {
  id           String   @id @default(cuid())
  name         String   // "Pack Básico", "Pack Estándar", "Pack Max"
  description  String?  @db.Text
  /// Créditos que el usuario recibe al comprar este pack.
  creditAmount Int
  active       Boolean  @default(true)

  /// El Price asociado apunta a este pack vía creditPackId.
  price        Price?

  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

/// Saldo de créditos de un usuario. Una fila por usuario.
///
/// INVARIANTE: balance >= 0. Nunca se vuelve negativo.
/// El débito atómico via UPDATE ... WHERE balance >= N garantiza este invariante
/// sin serializable isolation. Ver §3.2 para el patrón.
model Wallet {
  id        String         @id @default(cuid())
  userId    String         @unique
  user      User           @relation(fields: [userId], references: [id], onDelete: Cascade)

  /// Saldo en créditos enteros. Fuente de verdad del saldo actual.
  /// Debe ser siempre consistente con la suma de todos sus CreditLedger.entries.
  balance   Int            @default(0)

  entries   CreditLedger[]

  createdAt DateTime       @default(now())
  updatedAt DateTime       @updatedAt
}

/// Registro inmutable de cada movimiento de créditos.
/// NUNCA se modifica ni se borra una fila de esta tabla.
/// amount > 0 = crédito (suma); amount < 0 = débito (resta).
model CreditLedger {
  id            String           @id @default(cuid())
  walletId      String
  wallet        Wallet           @relation(fields: [walletId], references: [id])

  type          CreditLedgerType

  /// Positivo = crédito (suma al saldo); negativo = débito (resta al saldo).
  amount        Int

  /// Referencia polimórfica al recurso que originó el movimiento.
  /// Transaction.id para compras; Entitlement.id para destacados; Listing.id para bumps.
  referenceId   String?
  referenceType String?          // "Transaction" | "Entitlement" | "Listing"

  note          String?

  createdAt     DateTime         @default(now())

  @@index([walletId])
  @@index([createdAt])
}
```

### 2.3 Cambios en modelos existentes (misma migración)

```prisma
// ── Price ───────────────────────────────────────────────────────────────────
// Añadir FK opcional a CreditPack.
// Solo los Price de packs de créditos tienen este campo no nulo.
creditPackId  String?    @unique
creditPack    CreditPack? @relation(fields: [creditPackId], references: [id])

// ── Listing ──────────────────────────────────────────────────────────────────
// Un solo campo cumple dos funciones:
//   1. Límite de 1 bump/hora: (now() - bumpedAt) < 3600 s → rechazar.
//   2. Orden por recencia artificial: GREATEST(publishedAt, bumpedAt).
bumpedAt  DateTime?

// ── Transaction ──────────────────────────────────────────────────────────────
// Pasarela que procesó el cobro.
// Solo las compras con dinero real generan Transaction; los gastos de créditos
// generan únicamente un CreditLedger (no son hechos imponibles).
gateway  String  @default("STRIPE")   // "STRIPE" | "REDSYS"

// ── GatewayEvent ─────────────────────────────────────────────────────────────
// Distingue el origen del evento para trazabilidad.
// "STRIPE" → gatewayEventId es el event.id de Stripe (p.ej. "evt_1ABC...")
// "REDSYS" → gatewayEventId es el Ds_Order generado por nosotros
gateway  String  @default("STRIPE")   // "STRIPE" | "REDSYS"

// ── User ─────────────────────────────────────────────────────────────────────
// Relación con el nuevo Wallet.
wallet  Wallet?
```

### 2.4 Migración Prisma (RF.4)

Una sola migración nueva: `add_wallet_and_bump`

```
apps/api/prisma/migrations/
  YYYYMMDDHHMMSS_add_wallet_and_bump/
    migration.sql
```

Añade el enum `CreditLedgerType`, los modelos `CreditPack` / `Wallet` / `CreditLedger`, y los campos nuevos en `Price`, `Listing`, `Transaction`, `GatewayEvent` y `User`. No altera filas existentes.

**Seed de RF.4:** crea los packs de créditos en `CreditPack` + sus `Price`; añade en `Setting` los costes de créditos (`featuredCreditCost7d/14d/30d`, `bumpCreditCost`). Todos idempotentes (`upsert` o `skipDuplicates`).

### 2.5 Beneficio Pro: créditos extra en la compra de packs

**Modelo**

El beneficio de ser Pro al comprar packs de créditos NO es un descuento sobre el precio, sino créditos extra por el mismo importe. Un usuario Pro paga el mismo precio que cualquier otro por un pack, pero recibe un porcentaje adicional de créditos en su wallet.

Ejemplo (con `proExtraCreditsPercent = 20`):

| Pack | Precio | Créditos (normal) | Créditos (Pro) |
|---|---|---|---|
| Básico | 4,99 € | 50 | 60 |
| Estándar | 9,99 € | 150 | 180 |
| Max | 19,99 € | 400 | 480 |

Razón del modelo (créditos extra vs. descuento en precio): mantener el importe cobrado constante hace que el hecho imponible (la compra del pack) sea idéntico para Pro y no-Pro. La factura, el `amountGross` y el desglose de IVA son los mismos para todos. El beneficio Pro se materializa íntegramente dentro del wallet —un sistema interno sin IVA—, por lo que es invisible para la fiscalidad. Esto evita justificar bases imponibles variables y mantiene un único precio por pack.

**Alcance**

- Aplica: solo a la compra de packs de créditos (vía Redsys).
- No aplica directamente a destacado por pago directo ni a bump. Estos se benefician indirectamente: al recibir más créditos por el mismo dinero, el coste efectivo en euros de destacar/bumpear con créditos baja para el Pro.

**Configuración**

- `proExtraCreditsPercent` en `Setting` (entero, p. ej. `20`). Configurable desde el backoffice sin despliegue, coherente con los demás parámetros de monetización.
- Cálculo: `créditosConcedidos = ceil(creditPack.creditAmount × (1 + proExtraCreditsPercent / 100))`. Redondeo hacia arriba (a favor del usuario) si el porcentaje produjera fracción. Con los packs y el 20 % actuales el resultado es entero, pero el código debe contemplar el redondeo.

**Momento de la comprobación (congelado en el checkout)**

La condición de Pro se evalúa con `EntitlementService.isProActive(userId)` en el momento de generar el checkout (`createCreditPackCheckout`), NO al confirmar el pago. El número de créditos a conceder (base + bonus) se congela en la `Transaction PENDING` (en su `metadata`) junto con el IVA. El `RedsysProcessor`, al recibir la notificación de pago, solo lee y acredita lo ya decidido; no recalcula la condición de Pro.

Justificación: entre el inicio de la compra y la confirmación del pago pueden pasar minutos. La regla justa es "eras Pro cuando iniciaste la compra → recibes el bonus", determinada una sola vez. Es coherente con cómo se congela el desglose de IVA en el checkout.

Caso borde (Pro caduca entre ver el precio y pagar): como el importe cobrado es el mismo sea Pro o no, no hay sorpresa de precio. Si era Pro al generar el checkout, recibe el bonus aunque su Pro caduque antes de confirmarse el pago. Si ya no era Pro al generar el checkout, recibe los créditos base. En ambos casos paga el mismo importe.

Seguridad: el cálculo (precio e importe de créditos) ocurre íntegramente en el backend. El frontend solo muestra de forma informativa "como Pro recibes N créditos"; el valor vinculante es el que el backend fija en la `Transaction PENDING`.

**Trazabilidad (`CreditLedger`)**

La acreditación de un pack comprado por un Pro genera dos entradas en el `CreditLedger`, no una:

1. `PACK_PURCHASE` — los créditos base del pack (p. ej. +150).
2. `PRO_BONUS` — los créditos extra por ser Pro (p. ej. +30).

Ambas referencian la misma `Transaction` (`referenceType = "Transaction"`, `referenceId = transactionId`). Separarlas permite auditar cuántos créditos provienen de la compra y cuántos del beneficio Pro. Requiere añadir `PRO_BONUS` al enum `CreditLedgerType` (ver §2.2).

**Implementación**

Esta regla se implementa junto al flujo de compra de packs por Redsys (RF.10/RF.11), no en RF.9. Vive en `createCreditPackCheckout` (cálculo y congelado en la `Transaction PENDING`) y en el `RedsysProcessor` (acreditación de las dos entradas del ledger). El IVA y el importe cobrado **no** se ven afectados.

---

## 3. Operación unificada "conceder destacado"

### 3.1 El principio (y dónde la realidad se apartó de él — ver deuda en §16)

El diseño original preveía **una sola operación de dominio** que concede el destacado, con
**varios authorization paths** que la invocan, para que el efecto sea idéntico por construcción.
Con H8 son tres vías, no dos:

```
vía créditos   ──┐
vía cuota Pro  ──┼──► grantFeaturedListing(params)  ──► Entitlement FEATURED_LISTING
vía Redsys     ──┘                                        (mismo expiresAt, boostScore=1)
```

**Esto es el diagrama ideal, no exactamente lo que hay.** En la implementación real, solo la vía
Redsys llama a `grantFeaturedListing`. Las vías créditos y cuota Pro viven **ambas dentro de
`featuredByCredits`**, que mantiene su propia copia de las validaciones (ownership, `ACTIVE`, sin
destacado activo) en su propio `$transaction`, porque necesita atomicidad con el débito del wallet
(vía créditos) o con el lock de concurrencia (vía cuota, §1.4.1) — algo que `grantFeaturedListing`
no puede dar al usar `this.prisma` en vez de la `tx` del caller. Es decir: hay **dos puntos de
concesión**, no uno, pese a que el principio de diseño pedía uno solo. Documentado como deuda
consciente en §16 — cualquier regla nueva sobre "cómo se concede un destacado" tiene que aplicarse
en ambos sitios, y ya ha pasado dos veces (H8.1 origin, H8.3/H8.5a cuota).

### 3.2 `grantFeaturedListing` — la operación central (vía Redsys)

```typescript
interface GrantFeaturedParams {
  userId: string;
  listingId: string;
  durationDays: number;
  priceId: string;          // Price de la variante elegida
  transactionId?: string;   // Solo cuando la vía es Redsys (cobro real)
  origin: FeaturedOrigin;   // H8.1 — CREDITS | REDSYS | PRO_QUOTA (ver §1.4.1)
}
```

Esta función en `BillingService`:

1. Verifica que el anuncio está `ACTIVE` y pertenece a `userId`. → 403 si no.
2. Verifica que no hay un `Entitlement FEATURED_LISTING` activo para ese listing. → 400 si ya existe.
3. Crea `Entitlement { type: FEATURED_LISTING, userId, listingId, expiresAt: now + durationDays, priceId, transactionId?, origin }`.
4. Encola job `index` en BullMQ (el `IndexingProcessor` recalculará `boostScore = 1`).

`grantFeaturedListing` **no sabe cómo se pagó**. Solo recibe el resultado validado, incluido el
`origin` que le corresponde a la fila resultante.

### 3.3 Vía créditos — `featuredByCredits` con `useQuota: false` (u omitido)

```
1. Leer durationDays del Price elegido (dto.priceId es obligatorio en esta vía).
2. Leer coste de Setting (featuredCreditCost{N}d).
3. Débito atómico en Wallet (dentro de una transacción Postgres):

     result = await prisma.$executeRaw`
       UPDATE "Wallet" SET balance = balance - ${cost}
       WHERE "userId" = ${userId} AND balance >= ${cost}
     `;
     if (result === 0) throw new InsufficientCreditsException(); // 402

4. Crear CreditLedger { type: FEATURED_DEBIT, amount: -cost,
                        referenceType: "Listing", referenceId: listingId }.
5. Crear Entitlement { origin: CREDITS, priceId, ... } directamente en la misma tx
   (no llama a grantFeaturedListing — ver §3.1).
```

El `UPDATE`, el `CreditLedger` y el `Entitlement` se escriben en la misma transacción Postgres. Si
la creación del `Entitlement` falla (p.ej., ya había un destacado activo), el rollback devuelve los
créditos. El usuario nunca pierde créditos por un destacado que no se concedió. La cuota Pro,
aunque el usuario la tuviera disponible, **no se toca** en esta vía — queda intacta para que el
usuario la reserve deliberadamente si lo prefiere (decisión de H8.5a, ver §1.4.1).

### 3.4 Vía Redsys — `featuredByRedsys`

```
[Dentro de RedsysProcessor, tras confirmar Ds_Response = "0000"]

1. Recuperar Transaction PENDING donde gatewayPaymentIntentId = Ds_Order.
2. Actualizar Transaction.status = SUCCEEDED, Transaction.gateway = "REDSYS".
3. Extraer { userId, listingId, priceId, durationDays } de Transaction.metadata
   (guardado antes del redirect).
4. Llamar a grantFeaturedListing({ userId, listingId, durationDays, priceId,
                                    transactionId: transaction.id, origin: 'REDSYS' }).
```

No hay débito de créditos. La `Transaction` deja la traza del cobro en EUR con desglose de IVA.

### 3.5 Vía cuota Pro — `featuredByCredits` con `useQuota: true`

Tercera vía, añadida en H8.3 (automática) y convertida en elección explícita del usuario en H8.5a.
Vive en el mismo `featuredByCredits` que §3.3, bifurcando antes de tocar el wallet. La mecánica
completa (las dos bolsas, el reseteo derivado, la elección de vía, la concurrencia) está en
**§1.4.1** para no duplicarla — aquí solo el resumen de la vía como tercer camino de concesión:

```
1. Ignora dto.priceId si viene (la duración es fija: Setting proQuotaFeaturedDurationDays).
2. EntitlementService.hasAvailableFeaturedQuota(tx, userId):
   - Bloquea la Subscription vinculada (SELECT ... FOR UPDATE) — ver concurrencia en §1.4.1.
   - Si no hay cuota disponible → 400 { code: 'QUOTA_UNAVAILABLE' }. NO cae a créditos.
3. Si hay cuota: crea Entitlement { origin: PRO_QUOTA, priceId: null, ... } directamente
   en la tx (igual que §3.3, no llama a grantFeaturedListing).
```

Sin débito de wallet, sin `CreditLedger` — es la única de las tres vías que no genera ningún
movimiento económico en absoluto (el "coste" ya está pagado en la cuota mensual de Pro).

---

## 4. Bump (refrescar anuncio)

### 4.1 Flujo completo

```
POST /listings/:id/bump  (JwtAuthGuard; usuario propietario del anuncio)
│
├── 1. Leer Listing. Si no existe → 404. Si sellerId ≠ userId → 403.
│       Si status ≠ ACTIVE → 400 ("Solo se pueden bumpar anuncios publicados").
│
├── 2. Comprobar cooldown:
│       Si Listing.bumpedAt != null Y (now() - bumpedAt) < 3600 s:
│         → 429 Too Many Requests
│             Retry-After: ceil((bumpedAt + 3600s - now()) en segundos)
│
├── 3. Leer coste de Setting: bumpCreditCost (por defecto 5).
│
├── 4. Débito atómico en Wallet (misma técnica que §3.3):
│       UPDATE "Wallet" SET balance = balance - :cost WHERE "userId" = :userId AND balance >= :cost
│       → 0 filas → 402 Insufficient Credits
│
├── 5. En la misma transacción Postgres:
│       - Crear CreditLedger { type: BUMP_DEBIT, amount: -cost,
│                              referenceType: "Listing", referenceId: listingId }.
│       - UPDATE Listing SET bumpedAt = now() WHERE id = :listingId.
│
├── 6. Encolar job index en BullMQ (IndexingProcessor recalcula sortDate).
│
└── 7. Responder 200 { bumpedAt: <nueva fecha> }.
```

### 4.2 El campo `bumpedAt` cumple dos funciones con un solo campo

| Función | Lectura |
|---|---|
| Límite de 1 bump/hora | `(now() - bumpedAt) < 3600 s` → rechazar |
| Orden por recencia artificial | `GREATEST(publishedAt, COALESCE(bumpedAt, '1970-01-01'))` en Postgres; `sortDate` en Meilisearch |

Un único campo es suficiente. **Los intentos fallidos no actualizan `bumpedAt`**: si el usuario no tiene saldo o el anuncio no está en estado válido, el campo no cambia y el cooldown no se consume.

---

## 5. Plan Pro (Stripe — diseño conservado de RF.3)

El Plan Pro se gestiona íntegramente por Stripe. Es el único producto de la plataforma que pasa por Stripe.

Los cinco webhooks de Stripe ya implementados en `BillingProcessor` (RF.3):

| Evento Stripe | Acción |
|---|---|
| `checkout.session.completed` | Inicio de suscripción: crear `Subscription` + `Entitlement PRO_SUBSCRIPTION` |
| `invoice.payment_succeeded` | Renovación: crear `Transaction` (gateway="STRIPE") + actualizar `Subscription.currentPeriodStart` **y** `currentPeriodEnd` + extender `Entitlement.expiresAt`. El avance de `currentPeriodStart` en cada renovación es lo que hace posible el reseteo derivado de la cuota de destacados (§1.4.1) — sin cron. |
| `invoice.payment_failed` | `Subscription.status = PAST_DUE` |
| `customer.subscription.updated` | Actualizar estado de la `Subscription` |
| `customer.subscription.deleted` | `Subscription.status = CANCELED` |

Solo se añade `gateway: "STRIPE"` a las `Transaction` que el processor ya crea.

---

## 6. Enrutado de pasarelas

Determinista por tipo de acción. No hace falta una interfaz `PaymentGateway` genérica; el endpoint ya determina la pasarela.

| Acción | Pasarela | Módulo responsable |
|---|---|---|
| Compra de pack de créditos | Redsys | `RedsysModule` (nuevo, RF.5) |
| Destacado por pago directo | Redsys | `RedsysModule` |
| Destacado por créditos | Wallet interno | `BillingService` |
| Bump | Wallet interno | `BillingService` |
| Plan Pro (mensual/anual) | Stripe | `BillingModule` (RF.3, ya implementado) |

Endpoints diferenciados por pasarela:

```
POST /billing/checkout/credits-pack   → genera form Redsys para pack
POST /billing/checkout/featured-pay   → genera form Redsys para destacado directo
POST /billing/featured-by-credits     → débito Wallet, llama grantFeaturedListing
POST /listings/:id/bump               → débito Wallet, actualiza bumpedAt
POST /billing/checkout/pro            → Stripe Checkout (ya implementado)
```

---

## 7. Integración Redsys

### 7.1 PCI — Redirección (base) vs InSite (variante futura)

El diseño base asume **Redsys Redirección**:

| Modo | Descripción | Nivel PCI | UX |
|---|---|---|---|
| **Redirección** ← base | El usuario es enviado a una página de Redsys para introducir su tarjeta | SAQ A — sin auditoría de código propio; equivalente a Stripe Checkout | Sale de la web al pagar |
| InSite (variante futura) | Los campos de tarjeta se renderizan en nuestro dominio dentro de un iframe de Redsys | SAQ A-EP — pentest anual, ASV scan, revisión del código de pago | No sale de la web |

> **Nota:** si el banco adquirente exige InSite explícitamente, la firma HMAC y el flujo de notificación son idénticos a Redirección; solo cambia la integración de frontend. Confirmar con el banco antes de elegir modo definitivo.

### 7.2 Firma HMAC-SHA256 (Redsys "HMAC_SHA256_V1")

Redsys diversifica la clave por pedido para evitar reutilización de firmas:

```
Clave base (b64) = REDSYS_SECRET_KEY  ← variable de entorno, nunca expuesta al cliente

Al enviar (redirect):
  1. key3DES  = 3DES-decrypt(REDSYS_SECRET_KEY_b64, Ds_Order)
  2. params   = base64(JSON con todos los parámetros de la petición)
  3. signature = base64url(HMAC-SHA256(params, key3DES))
  Enviar: Ds_MerchantParameters=params, Ds_SignatureVersion="HMAC_SHA256_V1", Ds_Signature=signature

Al recibir notificación (verificar):
  1. Decodificar Ds_MerchantParameters → extraer Ds_Order
  2. key3DES  = 3DES-decrypt(REDSYS_SECRET_KEY_b64, Ds_Order)
  3. expected = base64url(HMAC-SHA256(Ds_MerchantParameters, key3DES))
  4. Si expected ≠ Ds_Signature → 400, descartar inmediatamente
```

Librería recomendada: `redsys-easy` (npm). Los parámetros obligatorios de la petición incluyen `DS_MERCHANT_AMOUNT` (en céntimos, sin decimales), `DS_MERCHANT_ORDER`, `DS_MERCHANT_MERCHANTCODE`, `DS_MERCHANT_TERMINAL`, `DS_MERCHANT_TRANSACTIONTYPE = "0"` (cobro), `DS_MERCHANT_CURRENCY = "978"` (EUR), `DS_MERCHANT_URLOK`, `DS_MERCHANT_URLKO`, `DS_MERCHANT_MERCHANTURL` (nuestra URL de notificación, pública, sin JWT).

### 7.3 Generación de `Ds_Order`

Redsys exige: 4-12 caracteres alfanuméricos, debe empezar con al menos 4 dígitos.

Formato usado: `YYYYMMDDNNNNN` truncado a 12 chars, con `NNNNN` = últimos 5 dígitos del timestamp de milisegundos. Garantiza unicidad práctica dentro del mismo día. Ejemplos: `202606261234`, `202606261589`.

El `Ds_Order` es la **clave de idempotencia** del sistema Redsys (análogo al `event.id` de Stripe, pero lo generamos nosotros).

### 7.4 Flujo completo — Redirección

```
Usuario              Frontend                Backend (NestJS)            Redsys
   │                     │                         │                        │
   ├─ "Comprar pack" ───►│                         │                        │
   │                     ├─ POST /billing/ ────────►│                       │
   │                     │   checkout/credits-pack  │                       │
   │                     │                         ├─ Generar Ds_Order      │
   │                     │                         ├─ CREATE Transaction    │
   │                     │                         │  { status: PENDING,    │
   │                     │                         │    gatewayPaymentIntentId: Ds_Order,
   │                     │                         │    gateway: "REDSYS",  │
   │                     │                         │    metadata: { userId, │
   │                     │                         │      packId, priceId } }
   │                     │                         ├─ Firmar parámetros     │
   │                     │◄── { redsysFormData } ──┤                        │
   │                     │                         │                        │
   │◄─ Render form ──────┤                         │                        │
   │   (auto-submit) ────────────────────────────────────────────────────►  │
   │                     │                         │                        ├─ Procesa pago
   │                     │                         │                        │
   │   ◄──────────────── Notificación online ──────────────────────────────┤
   │                     │  POST /webhooks/redsys   │◄── Ds_MerchantParameters + Ds_Signature
   │                     │                         ├─ Verificar firma HMAC
   │                     │                         ├─ INSERT GatewayEvent (P2002 → ya procesado → 200)
   │                     │                         ├─ Ds_Response == "0000"?
   │                     │                         │   Sí → encolar BullMQ job
   │                     │                         │   No → Transaction.status = FAILED
   │                     │                         ├──────────────────────────────────► 200
   │                     │                         │                        │
   │◄───────────────────────────────────── Redirect a URLOK ───────────────┤
   │                     │                         │                        │
   ├─ GET /planes/ ─────►│                         │                        │
   │    exito-redsys     │                         │                        │
   │◄─ Pantalla visual ──┤  (sin lógica de negocio)│                        │
```

### 7.5 ⚠️ INVARIANTE DE SEGURIDAD — la notificación online es la única fuente de verdad

> **La `success_url` (URLOK) NUNCA concede entitlements, acredita créditos ni ejecuta ninguna lógica de negocio. Solo muestra una confirmación visual al usuario.**

Todo el procesamiento ocurre exclusivamente en el handler de la notificación online firmada (`POST /webhooks/redsys`).

**Por qué este invariante es no negociable:**

| Escenario | Con lógica en `success_url` | Con lógica en notificación |
|---|---|---|
| Usuario cierra el browser tras pagar | El GET de success_url nunca se ejecuta → el usuario pagó pero no recibe su compra | La notificación ya llegó antes del redirect → compra procesada correctamente |
| Usuario manipula la URL | Puede visitar success_url sin haber pagado → acceso no autorizado | La URL de éxito no tiene efecto; sin notificación firmada, no pasa nada |
| Red lenta / timeout en el redirect | El usuario ve un error pero el pago está hecho | Ídem: notificación llegó; se muestra "en proceso" al reconectar |

```
success_url / URLOK → SOLO UI: "Tu pago está siendo procesado."
notificación online → TODA la lógica: Transaction, CreditLedger, Entitlement, BullMQ.
```

Este invariante aplica por igual al flujo de packs de créditos y al de destacado directo por Redsys.

### 7.6 Idempotencia por `Ds_Order` — `GatewayEvent` reutilizado

Para Redsys no existe un event ID emitido por la pasarela. El `Ds_Order` lo generamos nosotros, por lo que es nuestra clave de idempotencia. El mismo modelo `GatewayEvent` de RF.2 sirve para ambas pasarelas, añadiendo el campo `gateway`:

```
POST /webhooks/redsys
│
├── 1. Verificar firma HMAC (§7.2). Si falla → 400 inmediato.
│
├── 2. Extraer Ds_Order de Ds_MerchantParameters.
│
├── 3. INSERT INTO GatewayEvent {
│         gatewayEventId: Ds_Order,
│         eventType: "redsys.notification",
│         gateway: "REDSYS"
│       }
│       → P2002 (UNIQUE violation) → ya procesado → responder 200 y terminar.
│       → OK → continuar.
│
├── 4. Leer Transaction { gatewayPaymentIntentId: Ds_Order }
│       (creada antes del redirect; si no existe = Ds_Order desconocido → 400)
│
├── 5. Si Ds_Response == "0000":
│         encolar BullMQ job { type: "redsys.success", transactionId }
│       Si Ds_Response != "0000":
│         Transaction.status = FAILED
│
└── 6. Responder 200 (siempre que la firma sea válida)
```

`RedsysProcessor` (BullMQ, RF.5) lee la `Transaction`, ejecuta la acción de negocio (acreditar créditos o llamar a `grantFeaturedListing`), marca `Transaction.status = SUCCEEDED`.

### 7.7 Variables de entorno Redsys

```bash
# apps/api/.env.example — sección Redsys (añadir en RF.4)
REDSYS_MERCHANT_CODE=...        # Código de comercio (Ds_MerchantCode)
REDSYS_TERMINAL=001             # Terminal
REDSYS_SECRET_KEY=...           # Clave del comercio en base64 (para firma HMAC)
REDSYS_ENVIRONMENT=test         # "test" | "production" (URL del TPV)
REDSYS_NOTIFICATION_URL=...     # URL pública de POST /webhooks/redsys (sin JWT)
```

Todas opcionales en Joi (`Joi.string().allow('').optional()`) para que los tests corran sin credenciales reales, igual que las variables de Stripe.

---

## 8. IVA por flujo

Redsys no calcula ni desglosa impuestos: devuelve solo el importe total cobrado. El desglose `amountNet / taxAmount / taxRate` lo calculamos siempre nosotros antes de crear la `Transaction`.

| Flujo | Hecho imponible | Cálculo IVA |
|---|---|---|
| Compra pack créditos (Redsys) | ✅ Sí | Nuestro: `amountNet = gross / 1.21` (redondeado a 2 dec.) ; `taxAmount = gross − net` ; `taxRate = 0.2100` |
| Destacado pago directo (Redsys) | ✅ Sí | Ídem |
| Destacado por créditos | ❌ No | Sin `Transaction`. El IVA ya tributó al comprar el pack. Solo `CreditLedger`. |
| Bump | ❌ No | Sin `Transaction`. Ídem. |
| Plan Pro (Stripe) | ✅ Sí | Preferencia: `invoice.total_taxes` de Stripe Tax. Fallback: cálculo propio al 21 %. |

```typescript
// Helper compartido para flujos Redsys:
function redsysTaxBreakdown(grossEuros: number) {
  const amountGross = new Prisma.Decimal(grossEuros);
  const taxRate     = new Prisma.Decimal('0.2100');
  const amountNet   = amountGross.div(new Prisma.Decimal('1.21')).toDecimalPlaces(2);
  const taxAmount   = amountGross.sub(amountNet).toDecimalPlaces(2);
  return { amountGross, amountNet, taxAmount, taxRate };
}
```

Los campos `invoiceNumber` e `invoiceUrl` en `Transaction` quedan reservados para la integración futura con el sistema de facturación fiscal (RF.13).

Ahora hay **tres tipos de hecho imponible** (en v1 solo había Pro):
1. Plan Pro — `invoice.payment_succeeded` de Stripe.
2. Pack de créditos — notificación Redsys confirmada.
3. Destacado directo — notificación Redsys confirmada.

---

## 9. Efecto en Meilisearch

### 9.1 `boostScore` — señal del destacado (sostenida)

Sin cambios respecto al diseño de RF.1. Campo binario `0 | 1` en el documento indexado:

```typescript
// En IndexingProcessor / toDocument():
boostScore: listing.entitlements?.some(e =>
  e.type === 'FEATURED_LISTING' && e.expiresAt > new Date()
) ? 1 : 0
```

En `rankingRules`:
```
["words", "typo", "proximity", "attribute", "boostScore:desc", "sort", "exactness"]
```

`boostScore:desc` en la posición 5 significa que actúa **después de la relevancia textual** (no se compran posiciones en búsqueda orgánica) pero **antes del sort** del usuario (los destacados son visibles en cualquier ordenación).

### 9.2 `sortDate` — señal de recencia con bump (puntual)

Campo numérico nuevo (epoch ms) en el documento indexado:

```typescript
sortDate: Math.max(
  listing.publishedAt?.getTime() ?? 0,
  listing.bumpedAt?.getTime()    ?? 0
)
```

`sortDate` debe declararse como atributo **sortable** en Meilisearch. El sort por recencia usa `sortDate:desc` en lugar de `publishedAt:desc`.

Para las páginas de listado que usan **Postgres** (categoría, home), la query de orden usa:
```sql
ORDER BY GREATEST(publishedAt, COALESCE(bumpedAt, '1970-01-01'::timestamptz)) DESC
```

### 9.3 Ortogonalidad de `boostScore` y `sortDate`

Las dos señales actúan en dimensiones distintas y no interfieren:

| Señal | Tipo | Duración | Efecto |
|---|---|---|---|
| `boostScore` | Ranking rule | Sostenida (hasta `expiresAt`) | Prioridad antes del sort; afecta a toda búsqueda y browse |
| `sortDate` | Sort dimension | Puntual (decae por tiempo natural) | Solo afecta al sort por recencia; `boostScore` lo precede en rankingRules |

Un anuncio puede tener `boostScore=1` Y `sortDate=now` simultáneamente (destacado activo + bump reciente). Otro solo con `boostScore=1` (destacado, sin bump). En un sort por recencia, ambos aparecen en la zona "destacados", pero el del bump aparece antes dentro de esa zona.

El bump **no cambia** `boostScore`. El destacado **no cambia** `sortDate` directamente (solo lo recalcula el `IndexingProcessor` al reindexar, junto con todos los demás campos).

### 9.4 Triggers de reindexado en BullMQ

| Evento | Acción en Meilisearch |
|---|---|
| Se activa un destacado (`grantFeaturedListing`) | Reindexar → `boostScore: 1` |
| Expira un destacado (cron de expiración) | Reindexar → `boostScore: 0` |
| Se hace un bump exitoso | Reindexar → `sortDate: max(publishedAt, bumpedAt)` |
| Se publica / edita / renueva un anuncio | Reindexar todo (comportamiento ya existente) |

---

## 10. Endpoints previstos (actualización completa)

```
─── Billing (usuario autenticado, JWT) ────────────────────────────────────────
POST /billing/checkout/credits-pack      → Inicia pago Redsys para un pack de créditos
POST /billing/checkout/featured-pay      → Inicia pago Redsys para destacado directo
POST /billing/featured-by-credits        → Destaca — { listingId, useQuota?, priceId? } (H8.5a: el
                                            usuario elige la vía, ver §1.4.1)
GET  /billing/pro-status                 → { isPro, limit, used, remaining, periodStart, periodEnd,
                                            quotaDurationDays } — cuota de destacados (H8.2)
GET  /billing/wallet                     → Saldo + últimos movimientos del wallet
GET  /billing/my-subscriptions           → Suscripciones activas (ya impl.)
POST /billing/cancel-subscription/:id    → Cancela suscripción Pro (ya impl.)
GET  /billing/my-entitlements            → Entitlements activos (ya impl.)
GET  /billing/my-transactions            → Historial de cobros reales, paginado (ya impl.)
POST /billing/checkout/pro               → Stripe Checkout para Plan Pro (ya impl.)

─── Listings (usuario autenticado, propietario del anuncio) ───────────────────
POST /listings/:id/bump                  → Bump por créditos

─── Users (público) ────────────────────────────────────────────────────────────
GET  /users/:slug                        → Perfil del vendedor — incluye isPro (H8.4) y
                                            trusted (H8 Bloque E)
GET  /listings/:slug                     → Ficha del anuncio — seller incluye trusted (H8 Bloque E)

─── Webhooks (sin JWT; autenticación por firma) ────────────────────────────────
POST /webhooks/stripe                    → Guard HMAC Stripe-Signature (ya impl.)
POST /webhooks/redsys                    → Guard HMAC Redsys (nuevo, RF.5)

─── Admin (ADMIN) ──────────────────────────────────────────────────────────────
GET  /admin/billing/transactions         → Lista global (filtros: gateway, status, fecha, userId)
GET  /admin/billing/subscriptions        → Suscripciones activas (filtros: status, userId)
GET  /admin/billing/wallets              → Saldos de wallets (filtros: userId)
POST /admin/billing/wallets/:id/credit   → Acreditación manual (ADMIN_CREDIT)
GET  /admin/billing/entitlements         → Lista de entitlements activos (filtros: type, userId)
PATCH /admin/users/:id/trusted           → { trusted: boolean } — Vendedor de confianza, ADMIN-only
                                            + AuditLog USER_TRUST/USER_UNTRUST (H8 Bloque E)
```

### Flujo Redsys — `POST /billing/checkout/credits-pack` o `featured-pay`

**Body:**
```json
{ "packId": "cuid...", "priceId": "cuid..." }           // pack de créditos
{ "priceId": "cuid...", "listingId": "cuid..." }        // destacado directo
```

**Respuesta:**
```json
{ "redsysFormData": { "Ds_MerchantParameters": "...", "Ds_SignatureVersion": "...", "Ds_Signature": "...", "tpvUrl": "https://sis-t.redsys.es:25443/sis/realizarPago" } }
```

El frontend construye un `<form>` con estos campos y lo auto-submite hacia `tpvUrl`.

---

## 11. Cancelación, reembolso y degradación de plan

### 11.1 Cancelación Pro (Stripe)

Sin cambios respecto a RF.1. El usuario cancela con `POST /billing/cancel-subscription/:id`; Stripe recibe `cancel_at_period_end: true`; el `Entitlement PRO_SUBSCRIPTION` permanece activo hasta `currentPeriodEnd`.

### 11.2 Créditos — sin reembolso automático

Los créditos no son reembolsables por defecto. Si el banco tramita un chargeback sobre la compra de un pack, el equipo de soporte puede aplicar un `ADMIN_DEBIT` manual en `CreditLedger` para retirar los créditos acreditados. El sistema técnico soporta esta operación; la política de cuándo aplicarla la define el equipo.

**Los créditos no caducan.** No hay `expiresAt` en `Wallet` ni en `CreditLedger`.

### 11.3 Reembolso de cobros Redsys

Los reembolsos se tramitan vía Redsys (operación de devolución, tipo `"3"`) desde el backoffice o directamente desde el panel del banco. En nuestro sistema: se crea una `Transaction` con `status = REFUNDED` (la original queda intacta). Si el reembolso implica revocar el acceso: ajuste manual de `Entitlement.expiresAt = now()` y `ADMIN_DEBIT` en el wallet si aplica.

### 11.4 Degradación Pro → Free

Sin cambios respecto a RF.1. Período de gracia de 7 días; cron a las 03:00; los anuncios [6..N] pasan a `DRAFT`; `AuditLog` con `LISTING_DRAFT_BY_PLAN_DOWNGRADE`.

---

## 12. Seguridad de datos de pago (PCI-DSS)

| Modo | Nivel PCI | Implicación |
|---|---|---|
| Redsys Redirección | SAQ A | Los datos de tarjeta nunca llegan a nuestro dominio. Sin pentest de código propio. |
| Stripe Checkout | SAQ A | Ídem. Los datos de tarjeta se introducen en el dominio de Stripe. |

Lo que guardamos (solo referencias, nunca PANs ni CVVs):

| Campo | Modelo | Descripción |
|---|---|---|
| `stripeCustomerId` | `User` | ID del Customer de Stripe |
| `gatewaySubscriptionId` | `Subscription` | ID de la Subscription de Stripe |
| `gatewayPaymentIntentId` | `Transaction` | PaymentIntent de Stripe o Ds_Order de Redsys |
| `gatewayInvoiceId` | `Transaction` | Invoice de Stripe |
| `gateway` | `Transaction` | "STRIPE" o "REDSYS" |

---

## 13. Nota fiscal — IVA y VeriFactu

### 13.1 Lo que hacen (y lo que no) las pasarelas

**Redsys:** no calcula impuestos. Solo devuelve el importe cobrado. El desglose lo calculamos nosotros (§8).

**Stripe Tax:** puede calcular el IVA para Pro. Las invoices de Stripe **no son facturas fiscalmente válidas en España** (no cumplen R.D. 1619/2012).

### 13.2 VeriFactu

El R.D. 1007/2023 exige registros de facturación verificables desde 2025-2026. Esto afecta a los tres tipos de hecho imponible (Pro, pack de créditos, destacado directo). La integración VeriFactu queda para RF.13.

El modelo `Transaction` incluye `invoiceNumber` e `invoiceUrl` como punto de unión entre el sistema de pagos y el sistema de facturación externo (Holded, Factusol u otro).

---

## 14. Orden de ráfagas de implementación

| Ráfaga | Contenido | Dep. |
|---|---|---|
| **RF.2** ✅ | Schema `add_billing` (6 modelos, `stripeCustomerId`) | — |
| **RF.3** ✅ | BillingModule Stripe: checkout Pro, webhooks, BillingProcessor, EntitlementService | RF.2 |
| **RF.4** | Schema `add_wallet_and_bump`: `CreditPack`, `Wallet`, `CreditLedger`, campo `gateway` en `Transaction`/`GatewayEvent`, `bumpedAt` en `Listing`. Variables de entorno Redsys. Seed de packs y costes en Setting. | RF.3 |
| **RF.5** | Backend Redsys: `RedsysModule` (generación de params y firma, `RedsysWebhookGuard` con verificación HMAC, `RedsysProcessor` para acreditar créditos al wallet). Flujo completo compra pack → `Wallet`. | RF.4 |
| **RF.6** | Operación unificada de destacado: `grantFeaturedListing` + `featuredByCredits` + `featuredByRedsys` (en `BillingService` / `RedsysProcessor`). `BumpService` (`POST /listings/:id/bump`, débito atómico, `bumpedAt`). `EntitlementService` actualizado. | RF.5 |
| **RF.7** | Entitlements en dominio: `ListingsService.publish()` comprueba límites (5 free / 20 Pro); `EntitlementExpirationService` (cron 03:00, gracia 7 días, downgrade DRAFT). | RF.6 |
| **RF.8** | Meilisearch: `boostScore` (featured) + `sortDate` (bump) en `IndexingProcessor`; `rankingRules` y atributos sortable actualizados. Orden Postgres con `GREATEST(publishedAt, bumpedAt)`. | RF.6 |
| **RF.9** | Frontend Pro: `/planes` (tabla comparativa Free/Pro), Stripe Checkout redirect, `/planes/exito`, badge Pro en perfiles y fichas. | RF.3 |
| **RF.10** | Frontend wallet y Redsys: `/mis-creditos` (saldo, historial de movimientos), compra de pack (redirect Redsys), `/planes/exito-redsys` (solo visual, sin lógica de negocio). | RF.5 |
| **RF.11** | Frontend destacado y bump: selector "Destacar anuncio" en `/mis-anuncios` (vía créditos / vía pago directo Redsys), botón "Bumpar" con visualización de cooldown, badge "Destacado" con días restantes en tarjeta del anuncio. | RF.8, RF.10 |
| **RF.12** | Backoffice admin: tabla de transacciones (filtros gateway/status/fecha), saldos de wallets, acreditación manual de créditos, entitlements por usuario. | RF.6 |
| **RF.13** | Facturación fiscal: `InvoicingProcessor`, integración con sistema externo (Holded u otro), VeriFactu, descarga de facturas en `/perfil/facturas`. | RF.12 |
| **H8.1** ✅ | Cimiento de la cuota: migración `add_featured_origin` (`FeaturedOrigin`, `Entitlement.origin`, backfill, índice), `Setting proMonthlyFeaturedQuota`, fix de `freeActiveListingLimit`/`proActiveListingLimit` no expuestos en `/admin/ajustes`. Sin lógica de negocio todavía. | RF.7 |
| **H8.2** ✅ | `EntitlementService.getFeaturedQuotaStatus` (query derivada, §1.4.1) + `GET /billing/pro-status`. `origin` propagado en todos los `entitlement.create` de `FEATURED_LISTING` existentes. | H8.1 |
| **H8.3** ✅ (superada por H8.5a) | Bifurcación cuota-primero AUTOMÁTICA en `featuredByCredits` + lock de concurrencia (`hasAvailableFeaturedQuota`, `SELECT FOR UPDATE`). El mecanismo de lock sigue vigente; el "automático" lo sustituyó H8.5a. | H8.2 |
| **H8.4** ✅ | Badge "Pro" en `/vendedor/[slug]` (§1.4.2). `isPro` en `UsersService.findBySlug`. | H8.1 (independiente de H8.2/3) |
| **H8.5a** ✅ | Cambio de producto: el usuario ELIGE la vía (`useQuota` en el DTO) en vez de automática. Duración fija de cuota (`Setting proQuotaFeaturedDurationDays`). Error explícito `QUOTA_UNAVAILABLE`. Reemplaza el comportamiento de H8.3. | H8.3 |
| **H8.5b** ✅ | UX: selector "Cómo destacar" en `DestacadoDialog` (gratis vs. créditos/tarjeta), aviso de último gratis del mes, banner de cuota en `/mis-anuncios`, sección de cuota en `/perfil/suscripcion`, manejo con gracia de `QUOTA_UNAVAILABLE`. | H8.5a |
| **H8 Bloque E** ✅ | "Vendedor de confianza" (§1.5): `User.trusted`, `PATCH /admin/users/:id/trusted` (ADMIN-only + AuditLog), badge `BadgeCheck` verde en perfil y ficha, toggle en `/admin/usuarios`. Autocontenido, independiente de todo lo anterior. | — |
| **H8.6** ✅ | Esta revisión del documento — consolida §1.4 (resuelve la contradicción con §2.5), añade §1.4.1/§1.4.2/§1.5, actualiza §3 y esta tabla, documenta la deuda del hito en §16. Cierra el Hito 8 enfocado. | H8.1–H8.5b, Bloque E |

---

## 15. Resumen de decisiones de diseño

| Decisión | Justificación |
|---|---|
| Créditos como enteros (`Int`) | Evita errores de redondeo. Los créditos son unidades discretas; no hay fracciones de crédito. |
| `Wallet` como modelo separado (no campo en `User`) | El débito atómico requiere un `UPDATE` sobre la fila del wallet. Acoplarlo a la fila de `User` bloquearía operaciones no relacionadas en la misma transacción. |
| Débito atómico con SQL bruto en transacción Prisma | `UPDATE Wallet SET balance = balance - N WHERE userId = X AND balance >= N` es el mecanismo más simple y correcto para garantizar que `balance >= 0` sin serializable isolation ni optimistic locking. Cero filas = saldo insuficiente. |
| Un solo campo `bumpedAt` (sin `lastBumpRequestAt`) | Los intentos fallidos (sin saldo, cooldown, anuncio inactivo) **no** actualizan `bumpedAt`. Un campo único cumple las dos funciones: límite de 1/hora y orden por recencia. |
| `grantFeaturedListing` como punto único de concesión — **corregido en H8, ver §3.1 y §16** | El diseño original preveía que las vías de pago desembocaran en la misma función. En la práctica, solo Redsys la usa; créditos y cuota Pro mantienen su propia copia de las validaciones dentro de `featuredByCredits` por necesidad de atomicidad transaccional (débito de wallet / lock de concurrencia). Deuda consciente, no resuelta en H8 — documentada para que cualquier regla nueva se aplique en ambos sitios. |
| Notificación online = fuente de verdad (invariante de seguridad) | La `success_url` puede ser manipulada o no ejecutarse (browser cerrado tras el pago). La notificación HMAC firmada es infalsificable. Este invariante evita el bug más común en integraciones Redsys: conceder el acceso en el retorno del usuario. |
| Redsys Redirección como modo base | SAQ A (nivel mínimo PCI), equivalente a Stripe Checkout. Si el banco exige InSite, la lógica de notificación y firma es idéntica; solo cambia el frontend. |
| `Ds_Order` generado por nosotros como clave de idempotencia | Redsys no emite un event ID propio. El `Ds_Order` lo generamos antes del redirect y lo usamos como `GatewayEvent.gatewayEventId`. Pre-crear la `Transaction` con `status=PENDING` garantiza que cualquier notificación se pueda vincular a un pedido legítimo. |
| `GatewayEvent` reutilizado para Redsys (campo `gateway`) | Un modelo de idempotencia para ambas pasarelas. El constraint `@unique` en `gatewayEventId` es el mecanismo; el campo `gateway` añade trazabilidad. |
| `boostScore` y `sortDate` ortogonales en Meilisearch | Featured = ranking rule (posición 5, antes del sort). Bump = dimensión de sort (recencia artificial). Sin interferencias: un anuncio puede tener ambos activos simultáneamente. |
| Costes en créditos en `Setting` (no en código) | `featuredCreditCost{N}d` y `bumpCreditCost` son configurables desde el backoffice sin despliegue. El seed los inicializa. |
| Gastos de créditos sin `Transaction` (solo `CreditLedger`) | El gasto de créditos no es un hecho imponible (el IVA ya tributó al comprar el pack). Solo las compras con dinero real generan `Transaction` y factura. |
| Créditos no caducan | Simplicidad y UX. Si en el futuro se quiere caducidad (p.ej. créditos de campaña), basta con añadir `expiresAt` al `CreditLedger` y un cron que expire entradas. |
| Modelos existentes conservados íntegros | Los 6 modelos de RF.2 son agnósticos de pasarela. Solo se extienden con campos opcionales y nuevas relaciones. No se rompe ninguna migración ni test existente. |
| `origin` como campo en `Entitlement`, no un modelo `FeaturedAllowance` nuevo (H8.1) | La pregunta "¿cuántos destacados de cuota lleva usado este usuario?" ya es una consulta directa sobre `Entitlement`, la tabla que se consulta para todo lo demás. Un modelo nuevo con un contador propio introduciría un segundo lugar donde el estado pudiera desincronizarse del real. |
| Reseteo de la cuota DERIVADO, no contador+cron (H8.2) | Contar `PRO_QUOTA` con `createdAt >= currentPeriodStart` en vez de mantener un contador que un cron resetea. Cero estado nuevo que pueda desincronizarse, cero cron nuevo, auditable con una query. El único coste es un `COUNT` adicional al destacar — trivial en volumen. |
| Lock `SELECT ... FOR UPDATE` sobre la `Subscription` para la concurrencia de cuota (H8.3) | La cuota es derivada (sin saldo que decrementar atómicamente como el `Wallet`), así que el lock pesimista sobre la fila de la suscripción es lo que serializa dos peticiones concurrentes del mismo usuario. Verificado con un test que fuerza solapamiento real (`jest.spyOn` + delay) y falla de forma reproducible si se quita el lock — la comprobación "ingenua" con dos `POST` simultáneos no bastaba: en Postgres local ambas transacciones son demasiado rápidas para solaparse de verdad. |
| Elección explícita del usuario (H8.5a) en vez de "cuota-primero" automático (H8.3) | Decisión de producto: el usuario debe poder reservar su cuota para otro anuncio y pagar con créditos aunque le quede cuota disponible. La cuota nunca se consume sin que el usuario lo pida explícitamente (`useQuota: true`), y pedirla sin tenerla es un error explícito (`QUOTA_UNAVAILABLE`), nunca un fallback silencioso a créditos. |
| `User.trusted` como campo independiente, no derivado de `isProActive` (Bloque E) | "De confianza" es una decisión de la plataforma (ADMIN-only); Pro es una compra. Mezclarlos en un solo cálculo impediría que un usuario fuera ambos, ninguno, o solo uno — el caso real que el negocio quería permitir. |
| La cuota Pro siempre concede `proQuotaFeaturedDurationDays` (7d por defecto), ignorando cualquier `priceId` de mayor duración que el cliente adjunte (H8.5a, confirmado en la auditoría de monetización de 2026-07 y blindado en `h8-featured-quota.e2e-spec.ts`, test "elige CUOTA con un priceId de 30d adjunto → lo IGNORA") | Es una POLÍTICA, no un bug: la cuota gratuita es un regalo acotado, no un vale intercambiable por más duración. Para más días, el Pro debe renunciar a la cuota y pagar (créditos o tarjeta) al mismo precio que un no-Pro — nunca puede combinar "gratis" con "más duración". Si en el futuro se quiere permitir elegir duración con cuota, es una decisión de producto nueva, no una corrección de bug. |
| Los descuentos de campaña (`ACTION_DISCOUNT`) solo se aplican al pagar con créditos (bump y destacado-por-créditos), nunca al pago directo por Redsys (H8 Bloque D, ver comentario en `h8-d2-action-discount.e2e-spec.ts`: "Redsys directo NUNCA se descuenta — principio fiscal") | El importe cobrado por Redsys es un hecho imponible con IVA calculado sobre el precio del `Price`; descontarlo ahí obligaría a recalcular y refacturar el IVA de cada campaña. Los créditos, en cambio, no son un hecho imponible en sí (el IVA ya tributó al comprar el pack — ver §2.5/§8), así que un descuento sobre su coste no toca ninguna factura. Mismo principio que el bonus Pro: los beneficios promocionales viven en sistemas internos sin IVA, nunca en el precio facturado. La UI (`DestacadoDialog`) muestra una nota breve ("El descuento aplica solo al pagar con créditos") para que el usuario entienda la diferencia sin necesitar este documento. |
| Gracia asimétrica al expirar Pro: la cuota de destacados cae inmediatamente, los anuncios activos por encima del límite tienen 7 días (RF.7, `entitlement-expiration.service.ts`) | Son dos mecanismos distintos con distinta urgencia. La cuota es un beneficio prospectivo (destacar algo nuevo) — no hay nada que "deshacer" si deja de estar disponible al instante. El límite de anuncios activos, en cambio, afecta contenido ya publicado y visible a compradores; downgradearlo a `DRAFT` de golpe sería disruptivo, así que se da un margen. No es una inconsistencia a corregir — son políticas independientes con razones independientes, documentadas aquí para que quede explícito. |

---

## 16. Estado del Hito 8 (H8) — CERRADO (enfocado)

El Hito 8 enfocado —consolidar Pro y construir la cuota mensual de destacados, más el Bloque E de
Vendedor de confianza— está **cerrado**. Ráfagas H8.1 a H8.6 y Bloque E completadas, batería de
tests verde en cada cierre (backend e2e en serie sobre BD fresca + Playwright + `tsc --noEmit`),
verificación manual con capturas de pantalla reales en las ráfagas de UX (H8.5b, H8.4, Bloque E).

### 16.1 Deuda dejada conscientemente (no bloquea el cierre, sí hay que revisarla más adelante)

| Deuda | Detalle | Dónde revisar |
|---|---|---|
| Duplicación `grantFeaturedListing` / `featuredByCredits` | La lógica de "conceder un destacado" vive en dos sitios (no uno, como pedía el diseño original) por necesidad de atomicidad transaccional. Cualquier regla nueva sobre destacados debe aplicarse en ambos. | §3.1. Posible solución futura: unificar vía un patrón de `tx` opcional pasado a `grantFeaturedListing` (como ya hace `AuditLogService.log(dto, tx?)`), para que pueda participar en la transacción del caller sin duplicar validaciones. No evaluado en profundidad — anotado como pista, no como diseño cerrado. |
| Caché Redis 5 min del vendedor en la ficha del anuncio | `ListingsService.findBySlug` cachea la ficha completa (incluido `seller.trusted`, `seller.avatarUrl`, `seller.name`) 5 minutos. Cambiar cualquiera de esos campos no invalida la caché — una ficha ya vista puede tardar hasta 5 min en reflejarlo. Preexistente a H8, pero H8 (Bloque E) lo hizo más visible al añadir un campo administrable con efecto inmediato esperado por el admin. | `ListingsService.findBySlug`/`invalidateAndReindex`. Solución futura: invalidar `cacheKey(slug)` de los anuncios de un vendedor cuando cambia `trusted` (o cualquier campo de perfil), igual que ya se hace al editar el propio anuncio. |
| Badges Pro / confianza no en cards de listados (búsqueda/categoría/home) | Solo se implementaron en `/vendedor/[slug]` y en la ficha del anuncio (`/anuncio/[slug]`), nunca en las cards de listados. Añadirlos ahí requeriría denormalizar `isPro`/`trusted` del vendedor en el documento de Meilisearch (mismo mecanismo que `boostScore`), para evitar N+1 al pintar una lista con vendedores distintos. Decisión deliberada de alcance en H8.4 y Bloque E, no un olvido. | `IndexingProcessor` / documento de Meilisearch, si se retoma. |
| Aislamiento dev/test de Redis y BD en paralelo local | Ejecutar `jest --config test/jest-e2e.json` en paralelo (workers por defecto) contra una BD de test local compartida produce deadlocks y violaciones de FK entre suites (cada spec hace `cleanDb` en su `beforeAll`). Con `--runInBand` sobre BD fresca no hay fallos — así corre CI. Preexistente a H8, documentado repetidamente durante el hito porque se hizo evidente al añadir tantas suites nuevas. | `jest-e2e.json`, posible aislar por BD/Redis por worker en Hito 9. |
| Deuda previa sin tocar en H8 (ver §1.4) | Fotos por anuncio (4/10) y estadísticas de visitas siguen declaradas mas no implementadas. No formaban parte del encargo de H8. | Hito 8b o Hito 9 si se retoman. |

### 16.2 Diferido conscientemente (no es deuda — decisión explícita de alcance, fuera del Hito 8 enfocado)

- **Bloque C (estadísticas para el vendedor)** y **Bloque D (campañas/cupones)** — quedan para
  **Hito 8b** o más adelante. No se empezaron; no hay código parcial que mantener.
- **Redsys E2E real** (el ciclo completo notificación → acreditación con credenciales reales) sigue
  bloqueado por tooling: hace falta un túnel público (ngrok o similar) para que Redsys pueda
  notificar a un backend en desarrollo, y no se ha configurado. Los flujos están probados con
  Redsys mockeado (firma HMAC, generación de formulario) desde RF.10; el ciclo real queda para
  cuando se disponga del túnel.

### 16.3 Qué mirar primero si se retoma el sistema de facturación

1. §1.4.1 (mecánica de la cuota) y §3.5 (vía cuota) si se toca cualquier cosa relacionada con
   destacados — son el código más nuevo y el más sensible a condiciones de carrera.
2. §16.1 antes de añadir campos nuevos al vendedor cacheado en la ficha del anuncio (evitar
   sorpresas con la caché de 5 minutos).
3. Esta tabla de decisiones (§15) tiene ahora entradas corregidas respecto a revisiones anteriores
   (`grantFeaturedListing` ya no es "punto único") — si algo de código contradice lo escrito aquí,
   confiar en el código y actualizar el documento, no al revés.

---

## 17. Saldo de bumps (Monetización ráfaga 2) — moneda separada, gratuita e intransferible

Diseñado y aprobado antes de implementar (mismo rigor que el sistema de créditos: una moneda a
medias es peor que ninguna). Cierra la deuda de "bumps gratis" que quedó fuera de la ráfaga 1.

### 17.1 Modelo

`Wallet` gana una segunda columna, `bumpBalance Int @default(0)`, en vez de una tabla `BumpWallet`
separada: las dos monedas se consumen en la MISMA operación (bumpear intenta primero bumpBalance,
luego balance — ver §17.3), así que compartir fila evita coordinar dos filas en cada bump. El
invariante (`bumpBalance >= 0`) se protege con el mismo patrón `UPDATE ... WHERE bumpBalance >= N`
que ya usa `balance` — sin `SELECT ... FOR UPDATE`, sin serializable isolation.

`BumpLedger` es una tabla nueva, separada de `CreditLedger` (mismo molde: `walletId`, `type`,
`amount`, `referenceId`/`referenceType`, `note`, `createdAt`, inmutable). Moneda distinta, ledger
distinto — mezclarlas en una tabla habría exigido un discriminador de moneda en cada fila, más
confuso que dos tablas con la misma forma. `BumpLedgerType`: `COUPON_REDEEM` (entrada),
`BUMP_DEBIT` (salida), `ADMIN_CREDIT`/`ADMIN_DEBIT` (ajustes de soporte). Sin `PACK_PURCHASE`: los
bumps no se compran directamente con dinero real (ver §17.4, Opción B).

### 17.2 Caducidad — decisión: NO caducan

Mismo motivo que los créditos hoy (§15, "simplicidad y UX"). Razón técnica añadida: un saldo que
caduca por partes (cupón A caduca antes que cupón B) no se puede representar correctamente con un
contador simple (`bumpBalance Int`) — haría falta saldo *derivado* del ledger (sumar solo entradas
no caducadas), un diseño bastante más grande. Si en el futuro hace falta caducidad, la puerta ya
está documentada (igual que para créditos): añadir `expiresAt` por fila de `BumpLedger` y pasar de
saldo-contador a saldo-derivado.

### 17.3 Prioridad de consumo — EL PUNTO CRÍTICO

Al bumpear (`BillingService.bump()`), dos `UPDATE ... WHERE` condicionales encadenados, nunca
`SELECT ... FOR UPDATE`:

1. Intentar `bumpBalance - 1` (gratis, siempre 1 unidad exacta, inmune a descuentos de campaña —
   igual que la cuota Pro: lo gratis no se abarata más). Si afecta 1 fila → `BumpLedger BUMP_DEBIT`,
   `paidWith: 'BUMP_BALANCE'`, listo.
2. Si no había saldo (afecta 0 filas) → débito de créditos EXACTAMENTE como antes de esta ráfaga
   (con descuento de campaña si aplica) → `CreditLedger BUMP_DEBIT`, `paidWith: 'CREDITS'`.

La respuesta de `POST /listings/:id/bump` incluye `paidWith` y `cost` para que la UI confirme sin
ambigüedad qué se gastó (`MyListingCard`: "Bump gratis usado" vs. "Se han descontado N créditos").
El botón, ANTES de hacer clic, ya anuncia cuál va a ser ("Bump gratis (te quedan N)" vs. el coste en
créditos) leyendo `bumpBalance` del wallet.

### 17.4 Pack de bumps — Opción B (no es una moneda nueva)

Decisión tomada explícitamente: comprar bumps con dinero real NO acredita `bumpBalance`. Acredita
`balance` (créditos), como cualquier pack — es un `CreditPack` normal con un flag de presentación,
`highlightBumps Boolean`. Cuando está activo, `GET /billing/catalog` añade un campo derivado
`bumpEquivalent = floor(creditAmount / bumpCreditCost)`, calculado EN VIVO con el `Setting` vigente
— nunca guardado como texto fijo. Si el admin cambia `bumpCreditCost` después, el número mostrado
se recalcula solo en la siguiente lectura del catálogo; lo que el comprador ya recibió
(`creditAmount`, congelado en `Transaction.baseCreditAmount` igual que cualquier pack) no cambia.
Por ser un `CreditPack` normal, un Pro que lo compra recibe el mismo bonus del +20% (§2.5) que
cualquier otro pack — sin casuística especial.

### 17.5 Cupones de bump

`CouponRewardType` gana `BUMP`; `Coupon.bumpAmount Int?` (solo para ese tipo), mismo molde exacto
que `CREDITS`/`creditAmount`. El canje (`CouponsService.redeem()`) gana una tercera rama que
acredita `bumpBalance`/`BumpLedger` dentro de la misma `$transaction` que ya protege el límite total
y el uno-por-usuario — cero mecanismo de concurrencia nuevo. Disponible para cualquier usuario, Pro
o no: el sistema de cupones nunca ha distinguido plan (los de `CREDITS`/`FEATURED` tampoco lo
hacen), así que no hizo falta añadir NI quitar autorización. Los cupones se crean a mano desde
`/admin/coupones` y se distribuyen fuera de la app (marketing, soporte) — mismo patrón que
`CREDITS`/`FEATURED`, no se implementó concesión automática por evento.

### 17.6 Histórico sin ambigüedad

Corrección incorporada al diseño antes de implementar: la fila que registra CON QUÉ se pagó un bump
concreto (`BumpLedger` o `CreditLedger`, nunca ambas para el mismo evento) usa siempre
`referenceType='Listing'` + `referenceId=<listingId>`. La consulta correcta para reconstruir el
histórico de un anuncio es filtrar CADA ledger por esa referencia y ordenar por `createdAt` — nunca
por cercanía a `Listing.bumpedAt`, que solo guarda el instante del ÚLTIMO bump y se sobrescribe en
cada uno. Verificado con un test que bumpea el mismo listing dos veces (una por cada moneda) y
localiza cada pago sin más pista que `referenceId` (`bump-balance.e2e-spec.ts`).

### 17.7 Deuda inventariada, no tocada en esta ráfaga

La comprobación de cooldown de bump (`listing.bumpedAt`) se lee FUERA de la `$transaction` — dos
peticiones concurrentes sobre el mismo listing podrían, en teoría, pasar ambas la comprobación
antes de que ninguna confirme su propio `UPDATE`. Preexistente a esta ráfaga (la prioridad de
consumo no lo agrava ni lo mejora); señalada al diseñar, deliberadamente no resuelta aquí para no
ampliar el alcance.

### 17.8 Fuera de esta ráfaga (diferido explícitamente)

Pago con tarjeta para bump directo, cupones de bump con reglas más ricas (p. ej. por segmento de
usuario), bumps gratis automáticos para Pro (más allá del cupón manual). Ninguno se empezó; no hay
código parcial que mantener.

> **Actualización (Monetización ráfaga 3)**: "bumps gratis automáticos para Pro" ya no está
> diferido — es exactamente lo que añade §18 (cuota mensual de bumps). El resto de este punto
> (pago con tarjeta para bump, cupones con reglas más ricas) sigue diferido.

---

## 18. Cuota mensual de bumps para Pro (Monetización ráfaga 3) — nivel 1 de 3

Diseñado y aprobado antes de implementar. Réplica deliberada del molde de la cuota de destacados
(§1.4.1, H8.2/H8.3) — mismo mecanismo de conteo derivado, mismo lock de concurrencia, mismo
comportamiento de expiración sin gracia. La diferencia real: los bumps no tienen `Entitlement`
propio (son eventos instantáneos, no derechos con vigencia), así que el conteo usa
`BumpLedger{type: PRO_QUOTA}` en su lugar.

### 18.1 Modelo

Setting `proMonthlyBumpQuota` (int, mismo molde que `proMonthlyFeaturedQuota`). "Usado este
periodo" se cuenta con un COUNT derivado sobre `BumpLedger` filtrado por
`type=PRO_QUOTA AND createdAt >= currentPeriodStart AND wallet:{userId}` — sin contador propio ni
cron, mismo principio que la cuota de destacados. Reseteo: por construcción, comparte periodo con
la cuota de destacados (misma `Subscription.currentPeriodStart` — un usuario Pro tiene una sola
suscripción/ciclo de facturación; no existen "dos periodos" que sincronizar). Cada cuota lleva su
propio límite y su propio contador, independientes entre sí.

**Cuidado de diseño explícito**: las filas `BumpLedger{type:PRO_QUOTA}` llevan siempre
**`amount: 0`** — son un marcador contable para el COUNT de la cuota (mismo rol que
`Entitlement.origin=PRO_QUOTA` para destacados), nunca un movimiento de `bumpBalance`. Con
`amount: -1` habrían roto el invariante `wallet.bumpBalance == SUM(BumpLedger.amount)` que se
cumple por construcción para el resto de tipos (`COUPON_REDEEM`, `BUMP_DEBIT`,
`ADMIN_CREDIT`/`ADMIN_DEBIT`). Verificado explícitamente con un test que mezcla una fila
`PRO_QUOTA` y una `COUPON_REDEEM` en el mismo wallet y confirma que la suma sigue cuadrando
(`pro-bump-quota.e2e-spec.ts`, describe "Invariante del ledger").

### 18.2 `EntitlementService.hasAvailableBumpQuota` — réplica literal de `hasAvailableFeaturedQuota`

Mismo `SELECT ... FOR UPDATE` sobre la fila `Subscription` del usuario (es la MISMA fila que ya
lockea la cuota de destacados — no hay una segunda "Subscription" que lockear, porque comparten
periodo por construcción). Verificado bajo solapamiento REAL forzado (mismo técnica que el test
determinista de destacados: `jest.spyOn` + delay inyectado tras adquirir el lock): dos bumps
simultáneos con 1 de cuota restante → exactamente uno usa `PRO_QUOTA`, el otro cae al siguiente
nivel — nunca los dos, nunca ninguno.

### 18.3 Los 3 niveles, atómicos, misma `$transaction`

Insertado en `BillingService.bump()` como nivel 1, ANTES del `bumpBalance` de la ráfaga 2:

1. **Cuota mensual Pro** — gratis, se pierde si no se usa este periodo. Se gasta primero
   precisamente por eso: es lo más restringido, lo que conviene consumir antes de que caduque.
2. **Saldo de bumps por cupón** (`bumpBalance`, ráfaga 2) — gratis, permanente, no caduca.
3. **Créditos** — de pago, con descuento de campaña si lo hay (el único nivel al que aplica).

`paidWith` en la respuesta de `POST /listings/:id/bump` gana el valor `'PRO_QUOTA'`.

**Detalle nuevo frente al nivel 2**: crear la fila `BumpLedger PRO_QUOTA` exige una fila `Wallet`
que puede no existir — un Pro con cuota disponible puede no haber tenido nunca una fila `Wallet`
(nunca compró créditos ni recibió un cupón de bump), a diferencia del nivel 2, donde
`bumpBalance >= 1` ya implica que la fila existe. Se resuelve con `tx.wallet.upsert(...)` en vez
de `findUniqueOrThrow`. Verificado explícitamente (`pro-bump-quota.e2e-spec.ts`, describe "Pro sin
Wallet previo").

### 18.4 `GET /billing/pro-status` — `bumpQuota` como campo hermano

Decisión tomada: campo aditivo (`bumpQuota: { limit, used, remaining }`) en la misma respuesta,
no un endpoint separado — la cuota de destacados y la de bumps son, conceptualmente, "el estado
mensual del Pro", y se pintan juntas con una sola petición. Para no-Pro, `bumpQuota` va siempre
`{ limit: 0, used: 0, remaining: 0 }` (mismo patrón que `limit`/`used`/`remaining` del nivel
superior — nunca `undefined`, para que la UI no tenga que distinguir "no está" de "es cero").

### 18.5 Expiración

Heredada automáticamente, sin diseño adicional: `hasAvailableBumpQuota` reutiliza el mismo
`activeFilter()` sobre el `Entitlement PRO_SUBSCRIPTION` que ya usa la cuota de destacados. Al
expirar, deja de encontrarlo → cuota no disponible desde ese instante → el siguiente bump cae
directo a nivel 2/3, sin gracia. Verificado (`pro-bump-quota.e2e-spec.ts`, describe "Expiración de
Pro").

### 18.6 Hueco de validación cerrado (no replicado)

Al diseñar se encontró que `proMonthlyFeaturedQuota` estaba en la whitelist de `SETTING_KEYS`
desde H8.1 sin validación numérica en el backend — el 400 por valor negativo o no entero solo lo
daba el `min={0}` del frontend, que un `PATCH` directo a la API podía saltarse. Decisión explícita:
**no replicar el hueco** en `proMonthlyBumpQuota` — se cerró para las dos a la vez, añadiendo
ambas a `POSITIVE_INT_SETTING_KEYS` (entero ≥ 1). Efecto secundario aceptado: `proMonthlyFeaturedQuota`
ya no admite `0` como "cuota desactivada este mes" (antes lo admitía por omisión, nunca declarado
como comportamiento soportado) — un Pro siempre tiene al menos 1 destacado y 1 bump gratis si la
suscripción está vigente. El editor de `/admin/ajustes` para `proMonthlyFeaturedQuota` se actualizó
en consecuencia (`min={0}` → `min={1}`). Verificado con 8 tests (`pro-bump-quota.e2e-spec.ts`,
describe "Validación de las Settings de cuota").

### 18.7 UX — tres monedas distinguibles

El botón "Bump" en `MyListingCard` prioriza visualmente en el mismo orden que el consumo real:
"Bump gratis (cuota: te quedan N este mes)" → "Bump gratis (guardado: te quedan N)" → coste en
créditos. La confirmación tras bumpear usa `paidWith` para decir exactamente cuál de las tres se
gastó, sin que el usuario tenga que inferirlo.

---

## 19. Packs de bumps directos (Monetización ráfaga 4) — retirada de la Opción B

Diseñado y aprobado antes de implementar (cambio de modelo que retira algo existente, con dinero de
por medio). Sustituye el pack de bumps-vía-créditos de la ráfaga 2 (`CreditPack.highlightBumps`,
Opción B) por packs que acreditan `bumpBalance` directamente.

### 19.1 Modelo — `BumpPack`, tabla paralela a `CreditPack`, no generalizada

Se evaluó generalizar en una sola tabla `Pack{type: CREDITS|BUMPS}` y se descartó: el checkout y el
processor ramifican por moneda de todas formas (Setting de bonus distinta —
`proExtraBumpsPercent` ≠ `proExtraCreditsPercent`—, ledger distinto, columna de `Wallet` distinta),
así que unificar el catálogo no habría evitado esa rama — solo habría obligado a renombrar
`Transaction.baseCreditAmount`/`bonusCreditAmount` a algo genérico, con mucho radio de explosión
sobre código ya verde (`redsys.service.ts`, `redsys.processor.ts`, varios e2e). `BumpPack` es una
tabla nueva, misma forma que `CreditPack` (`name`, `description`, `bumpAmount`, `active`, `price`
1:1). `Price` gana `bumpPackId String? @unique`, paralelo a `creditPackId`.

### 19.2 La compra — mismo rigor que packs de créditos

`RedsysService.createBumpPackCheckout`, espejo de `createCreditPackCheckout`: congela
`Transaction.baseBumpAmount`/`bonusBumpAmount` en el checkout (el processor nunca relee
`BumpPack.bumpAmount` ni `Setting.proExtraBumpsPercent` en vivo). El cálculo del bonus Pro se
extrajo a un helper compartido (`computeProBonus(userId, baseAmount, settingKey, defaultPct)`) —
misma fórmula, distinto Setting según la moneda; el resto (Ds_Order, retry, tax breakdown) ya era
genérico y se reutiliza tal cual. Sin bonus de campaña: `CampaignsService.getActiveCreditBonusCampaign()`
es específico de `CampaignType.CREDIT_BONUS`; extenderlo a bumps no se decidió en esta ráfaga.

`RedsysProcessor.processSuccess()` gana una tercera vía de enrutado (antes: `creditPack` → paquete de
créditos; si no, destacado por Redsys — ahora: `creditPack` → créditos; `bumpPack` → bumps directos;
si no, destacado). `handleBumpPackPurchase` es un espejo de `handlePackPurchase`, moneda distinta:
acredita `Wallet.bumpBalance`/`BumpLedger` en vez de `balance`/`CreditLedger`, misma capa de
idempotencia ya existente (`Transaction.status !== PENDING` corta antes de llegar aquí — un
reintento de BullMQ nunca ejecuta esto dos veces).

**Decisión reconsiderada durante la aprobación**: el ledger usa DOS filas separadas
(`BumpLedgerType.PACK_PURCHASE` para la base, `PRO_BONUS` para el bonus), no una combinada — mismo
criterio que créditos (`CreditLedgerType.PACK_PURCHASE`/`PRO_BONUS`), para poder reportar "cuánto
regala el bonus Pro" como métrica de negocio, y para no necesitar una migración de datos si algún
día hiciera falta desglosarlo. A diferencia de `BumpLedgerType.PRO_QUOTA` (ráfaga 3, siempre
`amount: 0` — un marcador, no un movimiento), estas dos filas SÍ llevan `amount` real: verificado
explícitamente que `wallet.bumpBalance == SUM(BumpLedger.amount)` se mantiene con ambas.

### 19.3 Bonus Pro — `proExtraBumpsPercent`

Setting propia, `PERCENT_SETTING_KEYS` (0-100, igual que `proExtraCreditsPercent`) — NUNCA se
reutiliza la de créditos, por decisión explícita: son beneficios distintos, calibrables por
separado. El catálogo expone `proExtraBumpsPercent` en su raíz (mismo patrón que `bumpCreditCost`)
para que la UI pueda PREVISUALIZAR "+N de regalo por ser Pro" antes de comprar — es solo una
vista previa (`Math.ceil(bumpAmount × pct / 100)` calculado en el frontend); lo que de verdad se
acredita se congela en el checkout, nunca se deriva de esta previsualización.

**Los dos bordes preguntados explícitamente al aprobar el diseño**:
- *¿El bonus se aplica en el checkout o en la confirmación del webhook?* En el checkout — mismo
  criterio que créditos (§2.5). Si el usuario deja de ser Pro entre el checkout y la confirmación,
  el bonus YA CONGELADO se acredita igual; revalidar `isPro` en el webhook abriría una ventana de
  carrera peor (cobrar sin dar lo prometido al pagar es peor que el caso contrario). Verificado
  explícitamente con un test que sube `proExtraBumpsPercent` a 90 entre el checkout y la
  confirmación, y comprueba que se acredita el bonus congelado, no el nuevo.
- *¿Qué pasa si se cambia `BumpPack.bumpAmount` a mitad de una compra en curso?* Igual — el valor
  congelado en `Transaction.baseBumpAmount` es el que se acredita, nunca el vigente en el momento
  de la confirmación. Verificado con el mismo patrón ("el test que importa") que ya usa
  `admin-pricing.e2e-spec.ts` para créditos.

### 19.4 Retirada limpia de la Opción B — sin romper histórico

**Hallazgo real durante el diseño, no un supuesto**: desactivar solo `CreditPack.active` NO basta
para retirar un pack — `BillingService.getCatalog()` filtra el catálogo por `Product.active`/
`Price.active`, nunca por `CreditPack.active`. Un pack "desactivado" así seguía siendo visible y
comprable (el checkout sí comprobaba ambos; el catálogo no). Cerrado desactivando **ambos**:
`CreditPack.active = false` Y su `Price.active = false`.

Migración en dos pasos, mismo patrón que `drop_contact_motivo_enum`/`drop_post_footer_fields`
(precedente real en este repo, no inventado):
1. **Dato** (`20260716090500_deactivate_highlightbumps_pack`): `UPDATE` sobre `CreditPack` y
   `Price` — sin tocar ninguna `Transaction`/`CreditLedger` histórica, que siguen íntegras (mismas
   FKs, solo `active=false` en las filas padre).
2. **Schema** (`20260716100000_drop_highlightbumps_column`), aplicada DESPUÉS de retirar las 9
   referencias de código (backend: schema, `admin-billing.service.ts`, `update-credit-pack.dto.ts`,
   `getCatalog()`, seeds; frontend: `admin-prices.ts`, `billing.ts`, `PriceListEditor.tsx`,
   `PackList.tsx`; más un describe de test que probaba el mecanismo retirado) — `DROP COLUMN
   "highlightBumps"`.

Verificado (`bump-pack-purchase.e2e-spec.ts`): un pack desactivado no aparece en el catálogo, un
intento de checkout devuelve 404, y una `Transaction` histórica que lo referencia sigue legible con
sus montos intactos.

### 19.5 Admin + UI

3 `BumpPack` configurables en `/admin/ajustes → Precios (Redsys)` (mismo `PriceListEditor`,
extendido con una tercera rama para `bumpPackId`), `proExtraBumpsPercent` editable junto a las
otras Settings de Pro. En `/mis-creditos` (renombrada "Mi saldo" en el título visible — la URL se
queda igual, es solo la página que ahora cubre dos monedas): dos secciones claramente separadas,
"Créditos" y "Bumps", cada una con su saldo, su compra y su historial — no fusionadas, mismo
principio que ya regía el historial (§17). El botón "Comprar" de un pack de bumps muestra el
preview "+N de regalo por ser Pro" cuando aplica; la página de confirmación tras el pago
(`/mis-creditos/exito`, compartida entre packs de créditos y de bumps porque Redsys no distingue
cuál se compró) muestra ambos saldos actuales.

## 20. Monetización ráfaga 5 — dos ajustes de catálogo

### 20.1 El pack "Pack de bumps" (highlightBumps) retirado NO se borra — sigue habiendo histórico real

Se planteó borrar por completo el `CreditPack` desactivado en §19.4 (desactivado, no borrado, para
proteger histórico). Antes de borrar nada se comprobó la BD (mismo criterio que "verificar
entitlement origin IS NULL antes de cerrar Stripe" en otra ráfaga): cuántas `Transaction`
referencian su `Price` vía `priceId`.

Resultado: **1 Transaction en estado PENDING la referencia**, y pertenece a una cuenta real de
producción (no un fixture `@example.com`). Borrar el `CreditPack`/`Price` habría dejado esa
`Transaction` con una FK rota o forzado un cascade que la destruye — ninguna de las dos opciones es
aceptable sin autorización explícita, así que **no se borra**.

En su lugar: `AdminBillingService.listPrices()` gana `active: true` en el `where` — los packs
desactivados (créditos o bumps) ya no aparecen en la lista editable del backoffice, sin tocar
ninguna fila existente. `getCatalog()` (cara al usuario) ya los excluía desde antes (§19.4). No se
creó ningún flujo para reactivar un pack — si algún día hace falta, es una migración de datos igual
de simple que la que lo desactivó.

### 20.2 Orden de los packs — ascendente por cantidad, agrupado por tipo

Antes: `listPrices()` ordenaba por `product.name` + `durationDays` únicamente — ningún criterio
tocaba `creditAmount`/`bumpAmount`, así que dentro de un mismo producto el orden era el de
inserción en BD (arbitrario en la práctica; se vio en vivo un pack de 40 bumps listado antes que
uno de 15). `getCatalog()` ordenaba por `amount` (precio en €), no por cantidad — un pack más caro
por unidad podía salir antes que uno más barato con más cantidad.

Fix en ambos sitios: el `orderBy` gana dos claves más — `creditPack.creditAmount` y
`bumpPack.bumpAmount`, ambas ascendentes. La agrupación por tipo (créditos nunca se mezclan con
bumps) ya venía gratis: son `Product`/relaciones distintas, así que el ordenamiento por cantidad
solo actúa DENTRO de cada grupo. Para un `Price` al que no le aplica una de las dos claves (p. ej.
un destacado no tiene `creditPack`), Prisma genera un LEFT JOIN y Postgres ordena los `NULL` al
final por defecto — inofensivo, porque ese `Price` ya está en su propio grupo por producto/tipo.

Aplicado en `AdminBillingService.listPrices()` y `BillingService.getCatalog()` — mismo criterio en
admin y en "Mi saldo", para que el orden visual sea coherente en ambos lados.
