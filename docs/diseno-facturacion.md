# Diseño del sistema de facturación — RF.1

> **Fase:** Hito 2 · Ráfaga RF.1 (diseño)
> **Fecha:** 2026-06-24
> **Estado:** Aprobado — pendiente de implementación (RF.2+)
>
> Este documento es diseño, no implementación. La implementación de cada ráfaga
> (schema, módulos, frontend) se abordará en sesiones sucesivas.

---

## 0. Auditoría del estado actual

El MVP (Hito 1) no implementa ningún componente de facturación. Verificado:

| Recurso | Estado |
|---|---|
| Schema Prisma | Sin modelos de pago, suscripción, entitlement o producto |
| Módulos NestJS | Sin `billing`, `payments`, `subscriptions`, ni `entitlements` |
| Meilisearch | Sin campo `boostScore` en documentos; sin ranking rule de boost |
| Variables de entorno | Sin `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` ni similares |
| Frontend | Sin páginas de planes, checkout ni gestión de facturación |

El sistema parte de cero. Todo lo que sigue requiere nueva implementación.

---

## 1. Productos y catálogo de precios

### 1.1 Destacado de anuncio (pago único)

Un usuario paga para destacar un anuncio concreto durante un período fijo. El anuncio
aparece con mayor visibilidad en los resultados de búsqueda y listados (ver §5).

| Variante | Precio | Duración |
|---|---|---|
| Destacado 7 días | 2,99 € | 7 días desde el pago |
| Destacado 14 días | 4,99 € | 14 días desde el pago |
| Destacado 30 días | 7,99 € | 30 días desde el pago |

Todos los importes son IVA incluido (base imponible + 21 % IVA). Los precios son
orientativos y se almacenan en base de datos (`Price.amount`), no en el código.

**Restricciones de negocio:**
- Solo se puede destacar un anuncio en estado `ACTIVE`.
- Un anuncio puede tener como máximo un destacado activo en todo momento.
- Al vencer el destacado, el anuncio sigue publicado y activo; solo deja de tener boost.

### 1.2 Plan Pro (suscripción recurrente)

Un usuario suscrito a Pro obtiene un conjunto de derechos ampliados sobre su cuenta.

| Variante | Precio | Ciclo |
|---|---|---|
| Pro Mensual | 9,99 € / mes | Mensual, renovación automática |
| Pro Anual | 89,99 € / año (~7,50 €/mes) | Anual, renovación automática |

**Derechos del Plan Pro (`PRO_SUBSCRIPTION`):**

| Derecho | Plan Free | Plan Pro |
|---|---|---|
| Anuncios activos simultáneos | 5 | 20 |
| Fotos por anuncio | 4 | 10 |
| Badge "Pro" en el perfil público | — | ✓ |
| Estadísticas de visitas del anuncio | — | ✓ (usa `viewCount` ya existente) |

Los límites del plan Free se aplican en el service de listings (`ListingsService`):
al publicar un anuncio, se comprueba el número de anuncios ACTIVE del usuario
y si tiene el entitlement `PRO_SUBSCRIPTION` activo; si excede el límite → 403.

---

## 2. Modelo de datos

### 2.1 Diagrama de relaciones

```
User ──── Subscription ──── Price ──── Product
  │              │
  │         Entitlement
  │              │
  ├── Transaction ┘
  │        │
  │    (listingId)
  │        │
  └── Listing

GatewayEvent  (tabla de idempotencia, independiente)
```

### 2.2 Modelos Prisma

> **Nota de implementación (RF.2):** El schema completo se añade en una sola
> migración `add_billing` que no altera modelos existentes, salvo agregar
> `stripeCustomerId` a `User` y las relaciones opcionales en `Listing`.

```prisma
// ============================================================================
//  ENUMS DE FACTURACIÓN
// ============================================================================

enum ProductType {
  ONE_TIME    // Pago único (destacado de anuncio)
  RECURRING   // Suscripción recurrente (Plan Pro)
}

enum PriceInterval {
  MONTH
  YEAR
}

enum SubscriptionStatus {
  ACTIVE      // Activa y se renovará automáticamente
  CANCELING   // Cancelada por el usuario; sigue activa hasta currentPeriodEnd
  CANCELED    // Expirada definitivamente
  PAST_DUE    // Pago fallido; en período de reintento por la pasarela
}

enum TransactionStatus {
  PENDING           // Esperando confirmación de la pasarela
  SUCCEEDED         // Cobro confirmado
  FAILED            // Cobro fallido definitivamente
  REFUNDED          // Devuelto íntegramente
  PARTIALLY_REFUNDED
}

enum EntitlementType {
  PRO_SUBSCRIPTION  // Acceso al Plan Pro (nivel de usuario)
  FEATURED_LISTING  // Anuncio destacado (nivel de anuncio)
}

// ============================================================================
//  CATÁLOGO
// ============================================================================

/// Producto comercial. Los precios concretos viven en Price.
/// Los productos no se eliminan físicamente; se desactivan (active = false).
model Product {
  id          String      @id @default(cuid())
  name        String      // "Destacado 7 días", "Plan Pro Mensual"…
  description String?     @db.Text
  type        ProductType

  /// Cuando active=false, el producto no se ofrece en nuevas compras
  /// pero sus Prices y Entitlements existentes siguen vigentes.
  active      Boolean     @default(true)

  prices      Price[]

  createdAt   DateTime    @default(now())
  updatedAt   DateTime    @updatedAt
}

/// Variante de precio de un producto. Una variante = una opción de compra.
model Price {
  id            String         @id @default(cuid())
  productId     String
  product       Product        @relation(fields: [productId], references: [id])

  amount        Decimal        @db.Decimal(10, 2)  // Importe bruto (IVA incluido) en EUR
  currency      String         @default("EUR")

  // Solo para RECURRING
  interval      PriceInterval?
  intervalCount Int?           @default(1)   // 1 mes, 1 año, …

  // Solo para ONE_TIME (destacado)
  durationDays  Int?           // 7, 14 o 30

  /// IDs del objeto equivalente en la pasarela (Stripe Price ID).
  /// Nunca se borran aunque el Price se desactive, para mantener trazabilidad.
  gatewayPriceId String?       @unique

  active        Boolean        @default(true)

  transactions  Transaction[]
  subscriptions Subscription[]
  entitlements  Entitlement[]

  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt

  @@index([productId])
}

// ============================================================================
//  ENTITLEMENTS (derechos efectivos del usuario)
// ============================================================================

/// Registro de un derecho activo. Es la única tabla que lee la lógica de negocio
/// para decidir si un usuario puede hacer algo. No conoce la pasarela.
///
/// Un entitlement es válido cuando:
///   expiresAt IS NULL OR expiresAt > now()
///
/// La lógica de negocio NO lee Subscription ni Transaction para decidir si
/// un usuario tiene Pro; solo lee Entitlement. Esto desacopla la pasarela
/// del dominio.
model Entitlement {
  id             String          @id @default(cuid())
  userId         String
  user           User            @relation(fields: [userId], references: [id], onDelete: Cascade)

  type           EntitlementType

  /// Solo para FEATURED_LISTING: anuncio al que aplica el boost.
  listingId      String?
  listing        Listing?        @relation(fields: [listingId], references: [id], onDelete: SetNull)

  startsAt       DateTime        @default(now())
  /// Null = sin caducidad (reservado para créditos manuales de soporte).
  /// Para cobros normales siempre se fija.
  expiresAt      DateTime?

  // Trazabilidad del origen
  priceId        String?
  price          Price?          @relation(fields: [priceId], references: [id])
  transactionId  String?
  transaction    Transaction?    @relation(fields: [transactionId], references: [id])
  subscriptionId String?
  subscription   Subscription?   @relation(fields: [subscriptionId], references: [id])

  createdAt      DateTime        @default(now())

  @@index([userId, type])
  @@index([listingId])
  @@index([expiresAt])   // para el cron de expiración
}

// ============================================================================
//  SUSCRIPCIONES
// ============================================================================

/// Estado de una suscripción recurrente. Una sola suscripción activa por usuario.
model Subscription {
  id                    String             @id @default(cuid())
  userId                String
  user                  User               @relation(fields: [userId], references: [id], onDelete: Restrict)

  priceId               String
  price                 Price              @relation(fields: [priceId], references: [id])

  status                SubscriptionStatus @default(ACTIVE)

  currentPeriodStart    DateTime
  currentPeriodEnd      DateTime

  /// true cuando el usuario ha cancelado pero el período sigue activo.
  cancelAtPeriodEnd     Boolean            @default(false)
  canceledAt            DateTime?

  /// ID de la suscripción en Stripe. Inmutable tras la creación.
  gatewaySubscriptionId String             @unique

  entitlements          Entitlement[]

  createdAt             DateTime           @default(now())
  updatedAt             DateTime           @updatedAt

  @@index([userId])
  @@index([status])
  @@index([currentPeriodEnd])
}

// ============================================================================
//  TRANSACCIONES (registro contable inmutable)
// ============================================================================

/// Registro permanente de cada cobro. NUNCA se borra ni se modifica el importe.
/// En caso de reembolso se añade una transacción con status REFUNDED.
model Transaction {
  id           String            @id @default(cuid())
  userId       String
  user         User              @relation(fields: [userId], references: [id], onDelete: Restrict)

  priceId      String
  price        Price             @relation(fields: [priceId], references: [id])

  // Desglose económico en el momento del cobro
  amountGross  Decimal           @db.Decimal(10, 2)  // Total cobrado (IVA incluido)
  amountNet    Decimal           @db.Decimal(10, 2)  // Base imponible
  taxAmount    Decimal           @db.Decimal(10, 2)  // Cuota IVA
  taxRate      Decimal           @db.Decimal(5, 4)   // 0.2100 = 21 %
  currency     String            @default("EUR")

  status       TransactionStatus @default(PENDING)

  /// Referencias de la pasarela. NUNCA se almacenan PANs, CVVs ni datos de tarjeta.
  gatewayPaymentIntentId String?  @unique
  gatewayInvoiceId       String?  @unique
  gatewayChargeId        String?

  /// Hueco para el sistema de facturación fiscal externo (ver §7).
  /// El número de factura lo asigna el sistema externo (Holded, etc.), no Stripe.
  invoiceNumber  String?   // Número correlativo de factura fiscal española
  invoiceUrl     String?   // URL del PDF generado por el sistema externo

  // Contexto del cobro
  subscriptionId String?
  subscription   Subscription? @relation(fields: [subscriptionId], references: [id])

  /// Solo en destacados: anuncio al que corresponde el cobro.
  listingId      String?
  listing        Listing?      @relation(fields: [listingId], references: [id], onDelete: SetNull)

  entitlements   Entitlement[]

  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  @@index([userId])
  @@index([status])
  @@index([createdAt])
}

// ============================================================================
//  IDEMPOTENCIA DE WEBHOOKS
// ============================================================================

/// Tabla de registro de eventos ya procesados de la pasarela.
/// Garantiza que un webhook duplicado no tenga efectos secundarios.
/// Solo se escribe; nunca se actualiza ni se borra.
model GatewayEvent {
  id             String   @id @default(cuid())

  /// ID único del evento en la pasarela (p.ej. "evt_1ABC..." en Stripe).
  /// El constraint UNIQUE es el mecanismo de idempotencia.
  gatewayEventId String   @unique

  eventType      String   // "checkout.session.completed", "invoice.payment_succeeded"…

  processedAt    DateTime @default(now())

  @@index([processedAt])
}
```

### 2.3 Cambios en modelos existentes

```prisma
// En model User — añadir:
stripeCustomerId  String?  @unique   // Referencia al Customer de Stripe; null hasta el primer pago

// Relaciones nuevas en User:
entitlements   Entitlement[]
subscriptions  Subscription[]
transactions   Transaction[]

// Relaciones nuevas en Listing:
entitlements   Entitlement[]
transactions   Transaction[]
```

### 2.4 Migración Prisma

Una sola migración: `add_billing`

```
apps/api/prisma/migrations/
  YYYYMMDDHHMMSS_add_billing/
    migration.sql
```

La migración añade los 6 modelos nuevos y los campos nuevos en `User` y `Listing`.
No altera datos existentes ni rompe compatibilidad con el código actual.

---

## 3. Endpoints previstos

### 3.1 Módulo `billing` (nuevo)

```
GET  /billing/products                → Lista de productos activos con precios
POST /billing/checkout                → Crea Checkout Session de Stripe
GET  /billing/my-subscriptions        → Suscripciones del usuario autenticado
POST /billing/cancel-subscription/:id → Cancela al final del período
GET  /billing/my-entitlements         → Entitlements activos del usuario
GET  /billing/my-transactions         → Historial de transacciones (paginado)
```

**`POST /billing/checkout`** — Body:
```json
{ "priceId": "cuid...", "listingId": "cuid..." }
```
`listingId` es obligatorio solo para destacados (priceId de tipo `ONE_TIME`).
Devuelve `{ checkoutUrl }` para redirigir al usuario a Stripe Checkout.
Al finalizar Stripe, redirige a `/planes/exito?session_id=...` o `/planes/cancelar`.

### 3.2 Webhook receptor (nuevo)

```
POST /webhooks/stripe   → Solo verifica Stripe-Signature; NO requiere Bearer JWT
```

No pertenece al módulo `billing` en cuanto a autenticación: usa un guard propio
(`StripeWebhookGuard`) que valida la firma HMAC del header `Stripe-Signature`.

### 3.3 Módulo `admin` (extensión)

```
GET  /admin/billing/transactions       → Lista global (filtros: status, userId, dateRange)
GET  /admin/billing/subscriptions      → Lista global (filtros: status, userId)
POST /admin/billing/subscriptions/:id/cancel → Cancelar desde backoffice
GET  /admin/billing/entitlements       → Lista de entitlements activos (filtros: type, userId)
```

### 3.4 Módulo `listings` (modificación menor)

`POST /listings/:id/publish` — Añadir comprobación:
```
Si User.entitlements[PRO_SUBSCRIPTION].activo → límite 20 anuncios ACTIVE
Si no → límite 5 anuncios ACTIVE
Si excede → 403 con mensaje específico
```

---

## 4. Seguridad de datos de pago (PCI-DSS)

**Los datos de tarjeta nunca llegan a nuestro backend. Sin excepciones.**

El flujo de pago usa **Stripe Checkout** (redirect) o **Stripe Payment Element**
(hosted iframe en dominio de Stripe). El usuario introduce sus datos de tarjeta
directamente en los formularios de Stripe, cifrados en tránsito hacia los servidores
de Stripe. Nuestro servidor nunca recibe el PAN, el CVV ni la fecha de expiración.

Lo que sí guardamos (solo referencias):

| Campo | Modelo | Descripción |
|---|---|---|
| `stripeCustomerId` | `User` | ID del Customer de Stripe |
| `gatewaySubscriptionId` | `Subscription` | ID de la Subscription de Stripe |
| `gatewayPaymentIntentId` | `Transaction` | ID del PaymentIntent de Stripe |
| `gatewayInvoiceId` | `Transaction` | ID de la Invoice de Stripe |
| `gatewayChargeId` | `Transaction` | ID del Charge de Stripe (para reembolsos) |

Estas referencias permiten consultar el estado en Stripe, iniciar reembolsos desde
el backoffice y correlacionar eventos de webhook con nuestros registros.

Con esta arquitectura, nuestro sistema opera en el nivel más bajo de PCI-DSS
(SAQ A), que no requiere auditoría formal de seguridad de datos de tarjeta.

---

## 5. Efecto del destacado en Meilisearch

### 5.1 Campo `boostScore` (binario)

Se añade el campo `boostScore: 0 | 1` al documento indexado en Meilisearch:

```ts
// En toDocument() del SearchService / IndexingProcessor:
boostScore: listing.entitlements?.some(e =>
  e.type === 'FEATURED_LISTING' &&
  e.expiresAt > new Date()
) ? 1 : 0
```

El campo es **binario**: `0` = sin destacar, `1` = destacado activo. No hay niveles
premium (p.ej. "súper-destacado"). Agregar un segundo nivel en el futuro solo
requiere cambiar el rango a `0 | 1 | 2` y ajustar la regla de ranking; el campo
numérico ya lo soporta sin cambio de schema.

Meilisearch requiere que `boostScore` sea un atributo **sortable** (además de
estar en el documento) para poder usarse en `rankingRules`.

### 5.2 Reglas de ranking

Las `rankingRules` actuales de Meilisearch (por defecto o similares) se amplían:

```
Antes: ["words", "typo", "proximity", "attribute", "sort", "exactness"]
Después: ["words", "typo", "proximity", "attribute", "boostScore:desc", "sort", "exactness"]
```

`boostScore:desc` se inserta entre `attribute` y `sort`.

**Comportamiento resultante:**

| Contexto | Efecto |
|---|---|
| Búsqueda de texto libre (`q="iPhone"`) | Las 4 reglas de relevancia textual van ANTES del boost. El boost solo rompe empates entre resultados igualmente relevantes. No se compran posiciones en búsqueda orgánica. |
| Browsing sin texto (`q=""`, sin sort) | Después de `attribute`, `boostScore:desc` ordena los destacados al frente. |
| Browsing con sort explícito (`sort=publishedAt:desc`) | El boost actúa ANTES que el sort del usuario. Resultado: primero los destacados (entre sí ordenados por fecha), luego el resto ordenado por fecha. Este es el comportamiento estándar en marketplaces: el boost no desaparece cuando el usuario ordena. |
| Búsqueda por proximidad (`lat`+`lng`+`radius`) | Los anuncios dentro del radio con boost aparecen antes que los anuncios sin boost a la misma distancia aproximada. El radio sigue filtrando correctamente; solo el orden interno cambia. |

La clave es: el boost **nunca supera la relevancia textual** (posición 5 vs. posiciones
1-4), pero sí supera el sort explícito del usuario (posición 5 vs. posición 6). Esto
es una decisión de diseño deliberada: el usuario que paga para destacar su anuncio
tiene visibilidad preferente en todas las vistas, incluyendo las ordenadas.

### 5.3 Actualización del campo `boostScore`

El campo se actualiza mediante el `IndexingProcessor` ya existente (BullMQ). Los
dos triggers nuevos que encolan un job `index` para el anuncio:

1. **Al activar el destacado** — cuando `BillingProcessor` crea el `Entitlement`
   de tipo `FEATURED_LISTING`.
2. **Al desactivar el destacado** — cuando el cron de expiración de entitlements
   detecta que `expiresAt ≤ now()` para un `FEATURED_LISTING`.

No se cambia la estructura del job; el `IndexingProcessor` al reindexar lee los
entitlements activos del anuncio y calcula `boostScore` en el momento de la indexación.

---

## 6. Flujo de webhooks → BullMQ (idempotente)

### 6.1 Eventos de Stripe procesados

| Evento Stripe | Acción en nuestro sistema |
|---|---|
| `checkout.session.completed` | Pago único o inicio de suscripción: crear `Transaction` (SUCCEEDED) + `Entitlement` |
| `invoice.payment_succeeded` | Renovación de suscripción: crear `Transaction` + actualizar `Subscription.currentPeriodEnd` + extender `Entitlement.expiresAt` |
| `invoice.payment_failed` | Pago fallido: `Subscription.status = PAST_DUE` + notificación al usuario |
| `customer.subscription.updated` | Cambios de suscripción (ej: `cancel_at_period_end = true`): actualizar `Subscription` |
| `customer.subscription.deleted` | Fin definitivo: `Subscription.status = CANCELED`; el `Entitlement` ya caducó en `currentPeriodEnd` |

### 6.2 Flujo de procesamiento

```
POST /webhooks/stripe
│
├─ 1. Verificar firma HMAC (header Stripe-Signature + STRIPE_WEBHOOK_SECRET)
│      → 400 Bad Request si la firma no es válida (posible ataque o error de config)
│
├─ 2. INSERT INTO GatewayEvent { gatewayEventId: event.id, eventType: event.type }
│      → P2002 (UNIQUE violation) → Responder 200 "already processed" y terminar
│      → Éxito → Continuar
│
├─ 3. Encolar job en BullMQ (queue "billing"):
│      { eventType: event.type, payload: event.data.object }
│
└─ 4. Responder 200 inmediatamente (sin esperar al procesamiento del job)

BillingProcessor.process(job)
│
├─ Switch on eventType
│    checkout.session.completed  → crear Transaction + Entitlement
│    invoice.payment_succeeded   → crear Transaction + actualizar Subscription/Entitlement
│    invoice.payment_failed      → actualizar Subscription + notificación
│    customer.subscription.*     → actualizar Subscription
│
└─ On error: Sentry.captureException(err) + rethrow (BullMQ gestiona reintentos)
```

**Por qué funciona la idempotencia:** El `GatewayEvent.gatewayEventId` tiene un
constraint `@unique` en Postgres. Si Stripe reenvía el mismo evento (lo hace
automáticamente si recibe un 5xx o no recibe respuesta en tiempo), la segunda
inserción lanza una excepción `P2002` de Prisma. El webhook handler la captura,
devuelve `200` (para que Stripe no siga reintentando) y no encola ningún job.
El procesamiento del primer evento ya creó los registros correctos.

**La clave es**: el webhook siempre devuelve `200` si la firma es válida, incluso
si descarta el evento por duplicado. Solo devuelve errores (4xx/5xx) cuando hay
problemas reales (firma inválida, error de infraestructura). Esto evita bucles de
reintento innecesarios.

### 6.3 Cola `billing` (nueva)

Reutiliza la infraestructura BullMQ existente (`infra/queue`). Se registra una nueva
cola `billing` junto a las tres existentes (`indexing`, `image`, `notification`).
El processor `BillingProcessor` sigue el mismo patrón que `IndexingProcessor`.

---

## 7. Cancelación, reembolso y degradación de plan

### 7.1 Cancelación de suscripción Pro

**Flujo cuando el usuario cancela:**

1. El usuario pulsa "Cancelar plan" en el frontend.
2. `POST /billing/cancel-subscription/:id` → Service llama a
   `stripe.subscriptions.update(gatewaySubscriptionId, { cancel_at_period_end: true })`.
3. Se actualiza `Subscription.cancelAtPeriodEnd = true`, `Subscription.status = CANCELING`.
4. El `Entitlement PRO_SUBSCRIPTION` **permanece activo** con su `expiresAt` existente
   (= `currentPeriodEnd`). El usuario conserva todos sus derechos hasta que pague el
   último día del período ya abonado.
5. Stripe envía `customer.subscription.deleted` al llegar `currentPeriodEnd`.
6. `BillingProcessor` actualiza `Subscription.status = CANCELED`.
   El `Entitlement.expiresAt` ya pasó → el entitlement está expirado de forma natural.

**El usuario NO pierde el acceso el día que cancela. Solo lo pierde al final del
período que ya pagó.**

### 7.2 Reembolsos

Los reembolsos se tramitan manualmente desde el backoffice admin (endpoint
`POST /admin/billing/transactions/:id/refund`) o directamente desde el dashboard
de Stripe. En ambos casos:

- Se crea una nueva `Transaction` con `status = REFUNDED` (el registro original
  queda intacto e inmutable).
- Si el reembolso implica revocar el acceso anticipadamente (decisión del equipo
  de soporte), se actualiza `Entitlement.expiresAt = now()` manualmente.
- El diseño no automatiza reembolsos de destacados: son pagos únicos de bajo importe
  y la política de reembolso la define el equipo (ej: no se reembolsa el destacado
  si el anuncio ya estuvo destacado más de 48 h).

### 7.3 Degradación Pro → Free (exceso de anuncios)

**Definición del problema:** un usuario con Plan Pro puede tener hasta 20 anuncios
ACTIVE. Al expirar el plan, el límite cae a 5. Los anuncios 6-20 quedan en limbo.

**Período de gracia: 7 días** contados desde `Entitlement.expiresAt`.

**Nuevo cron diario** (`EntitlementExpirationService`, similar a `ExpirationService`):

```
Ejecuta diariamente a las 03:00 (un hora después del cron de caducidad de anuncios)

Paso 1 — Notificación al inicio del período de gracia:
  Busca usuarios con Entitlement PRO_SUBSCRIPTION donde
    expiresAt BETWEEN (now()-1day) AND now()
  → Envía email: "Tu Plan Pro ha expirado. Tienes 7 días para
    reducir tus anuncios activos a 5 o reactivar el plan."

Paso 2 — Ejecución del downgrade al final del período:
  Busca usuarios con Entitlement PRO_SUBSCRIPTION donde
    expiresAt < (now()-7days)
    AND no tienen otro Entitlement PRO_SUBSCRIPTION activo
    AND tienen más de 5 anuncios en estado ACTIVE
  → Cuenta los anuncios ACTIVE del usuario
  → Ordena por publishedAt ASC (los más antiguos primero)
  → Los anuncios [6..N] pasan a estado DRAFT
  → Por cada anuncio movido a DRAFT:
      - Invalida caché Redis
      - Encola job de reindexado (retira de Meilisearch)
      - Crea AuditLog con action = "LISTING_DRAFT_BY_PLAN_DOWNGRADE"
  → Envía email al usuario listando los anuncios afectados
```

**Por qué DRAFT y no otro estado:**
- `DRAFT` preserva el contenido (el usuario no pierde los datos).
- El usuario puede re-publicar manualmente cualquiera de esos anuncios cuando
  tenga capacidad libre (ya sea subiendo a Pro o eliminando otros activos).
- `DRAFT` no se indexa en Meilisearch (coherente con el comportamiento actual).
- Evita crear un nuevo estado (`SUSPENDED_BY_PLAN`) que requeriría cambios
  en más partes del código.

**Si el usuario reactiva Pro antes de que termine el período de gracia:** el cron
del Paso 2 no encuentra ningún anuncio excedente porque el nuevo `Entitlement` ya
está activo, y no toma acción.

---

## 8. Comparativa de pasarelas de pago

### 8.1 Criterios relevantes para el caso español/europeo

- Soporte de pago con tarjeta de crédito/débito en España
- Suscripciones recurrentes (billing automático)
- Checkout hosted (no tocamos datos de tarjeta)
- Strong Customer Authentication (SCA / PSD2) — obligatorio en la UE desde 2021
- Soporte de IVA/Tax europeo
- Calidad de la documentación y DX
- Coste por transacción en el mercado español

### 8.2 Tabla comparativa

| Pasarela | Cobro por transacción (EU) | Suscripciones | Checkout hosted | Tax/IVA | DX | Notas España |
|---|---|---|---|---|---|---|
| **Stripe** | 1,5 % + 0,25 € (tarjetas EU) | ✓ Nativo | ✓ Checkout + Elements | ✓ Stripe Tax | Excelente | Disponible; SCA nativo; Radar antifraude |
| **Mollie** | 1,8 % + 0,25 € aprox. | ✓ | ✓ | Básico | Bueno | Europeo (NL); bien valorado en ES; sin Tax equivalente |
| **Adyen** | Variable (negociado) | ✓ | ✓ | ✓ | Bueno | Ideal para alto volumen; mínimo mensual; no apto para MVP |
| **Redsys** | Negociado con banco | Limitado | Limitado | Manual | Pobre | Estándar bancario español; API anticuada; sin ecosistema |
| **Braintree** | 1,9 % + 0,30 € | ✓ | ✓ | Manual | Regular | Integrado con PayPal; soporte más lento |

### 8.3 Recomendación: Stripe

**Para el MVP, Stripe es la elección recomendada** por las siguientes razones:

1. **DX superior**: SDK de Node.js/TypeScript bien mantenido, tipos incluidos,
   webhooks fiables con firma HMAC, dashboard claro.
2. **Suscripciones y cobros únicos nativos**: el modelo de datos de Stripe (Products,
   Prices, Subscriptions, PaymentIntents) se alinea directamente con nuestro diseño.
3. **SCA/PSD2**: cumplimiento automático sin código adicional (Stripe 3D Secure 2).
4. **Stripe Tax**: puede calcular y recaudar el IVA del 21 % automáticamente
   (aunque no genera la factura fiscal española válida, ver §9).
5. **Stripe Checkout hosted**: el usuario nunca introduce datos de tarjeta en
   nuestro dominio → PCI-DSS nivel mínimo (SAQ A).

**Redsys como adición futura**: si el segmento de usuarios corporativos o
administraciones públicas lo demanda, Redsys puede añadirse como método de pago
secundario. El modelo de entitlements desacoplado hace que añadir una segunda
pasarela no afecte a la lógica de negocio: solo añade un nuevo handler en
`BillingProcessor` y un nuevo receptor de webhooks.

---

## 9. Nota fiscal: IVA y facturación en España/UE

### 9.1 Lo que Stripe hace (y lo que no)

**Stripe Tax** puede configurarse para:
- Calcular automáticamente el IVA del 21 % en cobros a consumidores en España.
- Incluir el desglose de impuestos en las "invoices" de Stripe.
- Gestionar el esquema OSS (One Stop Shop) para cobros a consumidores de la UE.

**Stripe Tax / Stripe Invoices NO son facturas fiscalmente válidas en España.**
Los documentos que genera Stripe son recibos de pasarela ("receipts") con
información de IVA, pero no cumplen los requisitos formales de una factura
ordinaria española (R.D. 1619/2012).

### 9.2 Requisitos de la factura ordinaria española

Una factura válida en España debe incluir:
- Número de factura con serie y numeración **correlativa sin saltos**
- Fecha de expedición y fecha de operación (si difieren)
- NIF/CIF del emisor y NIF/CIF del receptor (si el receptor es empresa)
- Datos completos del emisor (nombre/razón social, domicilio)
- Descripción de los bienes o servicios prestados
- Base imponible, tipo de IVA aplicado (21 %), cuota de IVA
- Importe total

### 9.3 VeriFactu (obligación en curso)

El **Real Decreto 1007/2023** (sistemas de facturación informática) exige que,
a partir de 2025-2026, los sistemas que emitan facturas generen **registros de
facturación verificables** con hash encadenado y los remitan a la AEAT (o los
mantengan disponibles para inspección). Esta obligación recae sobre el **sistema
que emite la factura**, no sobre la pasarela de pago.

**Esto significa que Stripe no puede asumir el cumplimiento VeriFactu por nosotros.**

### 9.4 Diseño que contempla este hueco (sin prescribir la solución)

El modelo `Transaction` incluye:
- `invoiceNumber String?` — número asignado por el sistema de facturación externo
- `invoiceUrl String?` — URL del PDF de factura fiscal generado por el sistema externo

El flujo previsto (a implementar en una ráfaga futura, ej. RF.9):

```
Stripe confirma el cobro (webhook invoice.payment_succeeded)
  → BillingProcessor crea Transaction con los importes
  → Se encola un job en BullMQ (queue "invoicing")
  → InvoicingProcessor llama a la API del sistema externo
    (Holded, Factusol, Odoo, o un microservicio propio)
    con los datos de la Transaction
  → El sistema externo genera la factura fiscal (número correlativo,
    requisitos AEAT, VeriFactu si aplica) y devuelve
    { invoiceNumber, invoicePdfUrl }
  → Se actualiza Transaction.invoiceNumber + Transaction.invoiceUrl
  → El usuario puede descargar su factura desde /perfil/facturas
```

**El diseño NO asume "Stripe ya factura"**. Stripe confirma el cobro y nos da los
importes bruto/neto/IVA. El cumplimiento fiscal es un sistema separado. El campo
`invoiceNumber` en `Transaction` es el punto de unión entre ambos sistemas.

La elección del sistema de facturación externo (Holded, Factusol, sistema propio)
queda fuera del alcance de esta ráfaga de diseño y se decide en RF.9.

---

## 10. Orden de ráfagas de implementación

| Ráfaga | Contenido | Dependencias |
|---|---|---|
| **RF.2** | Schema Prisma: 6 modelos nuevos + campos en User/Listing. Variables de entorno (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_PRO_MONTHLY`, …). Seed de productos y precios. | — |
| **RF.3** | Backend `BillingModule`: `BillingService` (checkout, cancel), `WebhookController` + `StripeWebhookGuard`, `BillingProcessor` (maneja los 5 eventos de Stripe, idempotente vía `GatewayEvent`). `EntitlementService` (verificar si un usuario tiene Pro o un anuncio está destacado). | RF.2 |
| **RF.4** | Integración entitlements en dominio: `ListingsService.publish()` comprueba límite de anuncios activos; `EntitlementExpirationService` (cron 03:00, gracia 7 días, downgrade a DRAFT). | RF.3 |
| **RF.5** | Integración Meilisearch: campo `boostScore` en `toDocument()`, atributo `sortable`, actualización de `rankingRules`. El `IndexingProcessor` calcula `boostScore` al reindexar. | RF.3 |
| **RF.6** | Frontend — Planes: página `/planes` (comparativa Free vs Pro, precios), redirección a Stripe Checkout, página de éxito `/planes/exito`, badge Pro en perfiles y fichas de vendedor. | RF.3 |
| **RF.7** | Frontend — Destacado: botón "Destacar anuncio" en `/mis-anuncios` (solo en anuncios ACTIVE), selector de variante (7/14/30 días), redirección a Stripe Checkout, badge "Destacado" en la tarjeta del anuncio con días restantes. | RF.5, RF.6 |
| **RF.8** | Backoffice admin: tabla de transacciones (filtros estado/fecha/usuario), tabla de suscripciones activas (acción cancelar), vista de entitlements por usuario. | RF.3 |
| **RF.9** | Facturación fiscal: integración con sistema externo (Holded u otro), `InvoicingProcessor`, descarga de facturas en `/perfil/facturas`. | RF.8 |

---

## 11. Resumen de decisiones de diseño

| Decisión | Justificación |
|---|---|
| Modelo de entitlements desacoplado de la pasarela | La lógica de negocio no depende de Stripe; si cambia la pasarela, solo cambia el webhook handler, no los guards ni los services de dominio |
| `boostScore` binario (0/1) | Principio YAGNI. Un nivel premium puede añadirse cambiando el rango del campo numérico sin cambios de schema ni de rankingRules |
| `boostScore` después de relevancia textual | No se compran posiciones en búsqueda orgánica; el boost solo actúa cuando la relevancia textual no diferencia entre resultados |
| Idempotencia en `GatewayEvent` | El constraint `@unique` en Postgres es atómico: no hay race condition. Si dos procesos reciben el mismo webhook simultáneamente, uno gana y el otro obtiene P2002 |
| Entitlement Pro activo hasta fin de período en cancelación | Estándar de la industria; el usuario ya pagó ese período. Cortar el acceso inmediatamente sería agravio y aumenta el riesgo de chargebacks |
| Período de gracia de 7 días + downgrade a DRAFT | 7 días da tiempo al usuario a gestionar sus anuncios sin perder el contenido. DRAFT es el estado menos disruptivo (no elimina ni expira; el usuario puede re-publicar) |
| Datos de tarjeta nunca en nuestro backend (Stripe Checkout hosted) | PCI-DSS SAQ A (nivel mínimo). Reducción drástica del riesgo y de la auditoría de seguridad requerida |
| Stripe como pasarela principal | Mejor DX, SCA nativo, Stripe Tax, webhooks fiables, bien documentado. Redsys se puede añadir como segundo método sin tocar la lógica de entitlements |
| `invoiceNumber` / `invoiceUrl` en Transaction pero sin implementar | Deja el hueco para cumplimiento VeriFactu / factura fiscal española sin acoplar el sistema de facturación externo al MVP de pagos |
