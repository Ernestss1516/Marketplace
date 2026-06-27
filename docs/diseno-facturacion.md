# Diseño del sistema de facturación — revisión 2

> **Fase:** Hito 4 · Revisión 2 del diseño de monetización
> **Fecha:** 2026-06-26
> **Estado:** Aprobado — pendiente de implementación RF.4+
>
> Este documento reemplaza la revisión 1 (2026-06-24). Las ráfagas RF.2 y RF.3
> ya están implementadas y commitadas; lo nuevo empieza en RF.4.

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

Suscripción recurrente gestionada íntegramente por Stripe. Completamente independiente del sistema de créditos: no regala créditos ni otorga descuentos en packs.

| Variante | Precio | Ciclo |
|---|---|---|
| Pro Mensual | 9,99 €/mes | Mensual, renovación automática |
| Pro Anual | 89,99 €/año (~7,50 €/mes) | Anual, renovación automática |

**Derechos `PRO_SUBSCRIPTION`:**

| Derecho | Free | Pro |
|---|---|---|
| Anuncios activos simultáneos | 5 | 20 |
| Fotos por anuncio | 4 | 10 |
| Badge "Pro" en perfil público | — | ✓ |
| Estadísticas de visitas | — | ✓ |

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

### 3.1 El principio

Existe **una sola operación de dominio** que concede el destacado, y **dos authorization paths** que la invocan. El efecto es idéntico por construcción: no hay dos caminos paralelos que casualmente hacen lo mismo.

```
vía créditos   ──┐
                  ├──► grantFeaturedListing(params)  ──► Entitlement FEATURED_LISTING
vía Redsys     ──┘                                        (mismo expiresAt, mismo boost)
```

### 3.2 `grantFeaturedListing` — la operación central

```typescript
interface GrantFeaturedParams {
  userId: string;
  listingId: string;
  durationDays: number;
  priceId: string;          // Price de la variante elegida
  transactionId?: string;   // Solo cuando la vía es Redsys (cobro real)
}
```

Esta función en `BillingService`:

1. Verifica que el anuncio está `ACTIVE` y pertenece a `userId`. → 403 si no.
2. Verifica que no hay un `Entitlement FEATURED_LISTING` activo para ese listing. → 400 si ya existe.
3. Crea `Entitlement { type: FEATURED_LISTING, userId, listingId, expiresAt: now + durationDays, priceId, transactionId? }`.
4. Encola job `index` en BullMQ (el `IndexingProcessor` recalculará `boostScore = 1`).

`grantFeaturedListing` **no sabe cómo se pagó**. Solo recibe el resultado validado.

### 3.3 Vía créditos — `featuredByCredits`

```
1. Leer durationDays del Price elegido.
2. Leer coste de Setting (featuredCreditCost{N}d).
3. Débito atómico en Wallet (dentro de una transacción Postgres):

     result = await prisma.$executeRaw`
       UPDATE "Wallet" SET balance = balance - ${cost}
       WHERE "userId" = ${userId} AND balance >= ${cost}
     `;
     if (result === 0) throw new InsufficientCreditsException(); // 402

4. Crear CreditLedger { type: FEATURED_DEBIT, amount: -cost,
                        referenceType: "Listing", referenceId: listingId }.
5. Llamar a grantFeaturedListing({ userId, listingId, durationDays, priceId }).
   (sin transactionId: no hay cobro en dinero)
```

El `UPDATE`, el `CreditLedger` y el `Entitlement` se escriben en la misma transacción Postgres. Si `grantFeaturedListing` falla (p.ej., ya había un destacado activo), el rollback devuelve los créditos. El usuario nunca pierde créditos por un destacado que no se concedió.

### 3.4 Vía Redsys — `featuredByRedsys`

```
[Dentro de RedsysProcessor, tras confirmar Ds_Response = "0000"]

1. Recuperar Transaction PENDING donde gatewayPaymentIntentId = Ds_Order.
2. Actualizar Transaction.status = SUCCEEDED, Transaction.gateway = "REDSYS".
3. Extraer { userId, listingId, priceId, durationDays } de Transaction.metadata
   (guardado antes del redirect).
4. Llamar a grantFeaturedListing({ userId, listingId, durationDays, priceId,
                                    transactionId: transaction.id }).
```

No hay débito de créditos. La `Transaction` deja la traza del cobro en EUR con desglose de IVA.

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
| `invoice.payment_succeeded` | Renovación: crear `Transaction` (gateway="STRIPE") + actualizar `Subscription.currentPeriodEnd` + extender `Entitlement.expiresAt` |
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
POST /billing/featured-by-credits        → Destaca con créditos (inmediato)
GET  /billing/wallet                     → Saldo + últimos movimientos del wallet
GET  /billing/my-subscriptions           → Suscripciones activas (ya impl.)
POST /billing/cancel-subscription/:id    → Cancela suscripción Pro (ya impl.)
GET  /billing/my-entitlements            → Entitlements activos (ya impl.)
GET  /billing/my-transactions            → Historial de cobros reales, paginado (ya impl.)
POST /billing/checkout/pro               → Stripe Checkout para Plan Pro (ya impl.)

─── Listings (usuario autenticado, propietario del anuncio) ───────────────────
POST /listings/:id/bump                  → Bump por créditos

─── Webhooks (sin JWT; autenticación por firma) ────────────────────────────────
POST /webhooks/stripe                    → Guard HMAC Stripe-Signature (ya impl.)
POST /webhooks/redsys                    → Guard HMAC Redsys (nuevo, RF.5)

─── Admin (ADMIN) ──────────────────────────────────────────────────────────────
GET  /admin/billing/transactions         → Lista global (filtros: gateway, status, fecha, userId)
GET  /admin/billing/subscriptions        → Suscripciones activas (filtros: status, userId)
GET  /admin/billing/wallets              → Saldos de wallets (filtros: userId)
POST /admin/billing/wallets/:id/credit   → Acreditación manual (ADMIN_CREDIT)
GET  /admin/billing/entitlements         → Lista de entitlements activos (filtros: type, userId)
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

---

## 15. Resumen de decisiones de diseño

| Decisión | Justificación |
|---|---|
| Créditos como enteros (`Int`) | Evita errores de redondeo. Los créditos son unidades discretas; no hay fracciones de crédito. |
| `Wallet` como modelo separado (no campo en `User`) | El débito atómico requiere un `UPDATE` sobre la fila del wallet. Acoplarlo a la fila de `User` bloquearía operaciones no relacionadas en la misma transacción. |
| Débito atómico con SQL bruto en transacción Prisma | `UPDATE Wallet SET balance = balance - N WHERE userId = X AND balance >= N` es el mecanismo más simple y correcto para garantizar que `balance >= 0` sin serializable isolation ni optimistic locking. Cero filas = saldo insuficiente. |
| Un solo campo `bumpedAt` (sin `lastBumpRequestAt`) | Los intentos fallidos (sin saldo, cooldown, anuncio inactivo) **no** actualizan `bumpedAt`. Un campo único cumple las dos funciones: límite de 1/hora y orden por recencia. |
| `grantFeaturedListing` como punto único de concesión | Las dos vías de pago (créditos y Redsys) desembocan en la misma función. Cualquier cambio en las reglas del destacado se hace en un solo lugar. |
| Notificación online = fuente de verdad (invariante de seguridad) | La `success_url` puede ser manipulada o no ejecutarse (browser cerrado tras el pago). La notificación HMAC firmada es infalsificable. Este invariante evita el bug más común en integraciones Redsys: conceder el acceso en el retorno del usuario. |
| Redsys Redirección como modo base | SAQ A (nivel mínimo PCI), equivalente a Stripe Checkout. Si el banco exige InSite, la lógica de notificación y firma es idéntica; solo cambia el frontend. |
| `Ds_Order` generado por nosotros como clave de idempotencia | Redsys no emite un event ID propio. El `Ds_Order` lo generamos antes del redirect y lo usamos como `GatewayEvent.gatewayEventId`. Pre-crear la `Transaction` con `status=PENDING` garantiza que cualquier notificación se pueda vincular a un pedido legítimo. |
| `GatewayEvent` reutilizado para Redsys (campo `gateway`) | Un modelo de idempotencia para ambas pasarelas. El constraint `@unique` en `gatewayEventId` es el mecanismo; el campo `gateway` añade trazabilidad. |
| `boostScore` y `sortDate` ortogonales en Meilisearch | Featured = ranking rule (posición 5, antes del sort). Bump = dimensión de sort (recencia artificial). Sin interferencias: un anuncio puede tener ambos activos simultáneamente. |
| Costes en créditos en `Setting` (no en código) | `featuredCreditCost{N}d` y `bumpCreditCost` son configurables desde el backoffice sin despliegue. El seed los inicializa. |
| Gastos de créditos sin `Transaction` (solo `CreditLedger`) | El gasto de créditos no es un hecho imponible (el IVA ya tributó al comprar el pack). Solo las compras con dinero real generan `Transaction` y factura. |
| Créditos no caducan | Simplicidad y UX. Si en el futuro se quiere caducidad (p.ej. créditos de campaña), basta con añadir `expiresAt` al `CreditLedger` y un cron que expire entradas. |
| Modelos existentes conservados íntegros | Los 6 modelos de RF.2 son agnósticos de pasarela. Solo se extienden con campos opcionales y nuevas relaciones. No se rompe ninguna migración ni test existente. |
