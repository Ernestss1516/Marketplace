# Diseño — Formatos de precio configurables por categoría

> Documento de diseño aprobado (2026-07-28). Recoge la auditoría del código real y el
> diseño acordado. Las ráfagas RP.1–RP.4 implementan lo aquí descrito.
>
> **Objetivo:** que el vendedor pueda indicar el FORMATO del precio (pago único, cuota
> mensual, por hora, por día…) al crear/editar un anuncio, y que el admin configure qué
> formatos son seleccionables por categoría, con herencia padre→hijo — sin romper nada
> de lo ya implementado.

---

## 0. Corrección de partida — `Price` no es el precio de un anuncio

`Price` (`prisma/schema.prisma`) pertenece al subsistema de **facturación**: cuelga de
`Product`, tiene `gatewayPriceId` (Stripe), `creditPackId`, `bumpPackId`,
`interval`/`intervalCount`. Es el catálogo de lo que **la plataforma cobra** (destacados,
packs de créditos, packs de bumps, Plan Pro).

El precio de un anuncio son **tres campos planos en `Listing`**:

```prisma
price     Decimal   @db.Decimal(12, 2)
currency  String    @default("EUR")
priceType PriceType @default(FIXED)
```

No hay modelo intermedio ni relación 1:N. Un anuncio tiene exactamente un importe. El
formato es, por tanto, una columna más en `Listing`.

---

## 1. Auditoría

### 1.1 `priceType` hoy

| Elemento | Ubicación | Contenido |
|---|---|---|
| Enum | `schema.prisma` | `FIXED` / `FREE` / `NEGOTIABLE` |
| Migración | `20260620211233_add_price_type` | `ADD COLUMN "priceType" NOT NULL DEFAULT 'FIXED'` |
| DTO alta | `listings/dto/create-listing.dto.ts` | `@IsEnum(PriceType) priceType!: PriceType` (**obligatorio**) |
| Escritura | `listings.service.ts` (`create`/`update`) | Se copia tal cual, sin validación de negocio |
| Índice Meili | `search.service.ts` | Indexado, en `CORE_FILTERABLE_ATTRIBUTES` y en `NATIVE_FACET_ATTRIBUTES` |
| Filtro búsqueda | `search.service.ts` | `priceType = "…"` |
| Alertas | `Alert.priceType PriceType?` | Criterio guardado por usuarios reales |
| Wizard | `components/publicar/steps/StepDatos.tsx` | Radio `PriceMode` (`fixed`/`free`/`negotiable`) → `priceTypeFromMode()` |
| Visualización | `listing-card-shared.tsx`, `MyListingCard.tsx`, `anuncio/[slug]/page.tsx` | **Tres copias** de la misma función `formatPrice` |

### 1.2 ¿Mismo eje o eje ortogonal? → **Ortogonal. Campo nuevo.**

`priceType` responde a *«¿hay importe y es firme?»*. El formato responde a *«¿el importe
es por qué unidad?»*. Son combinables, no excluyentes:

- `FIXED` + `PER_HOUR` → «15 €/hora, precio fijo» ✔️
- `NEGOTIABLE` + `PER_MONTH` → «alquiler a convenir, al mes» ✔️
- `FREE` + cualquier unidad → sin sentido; se resuelve en la visualización (§7)

Tres pruebas del código de que **extender el enum sería un error**:

1. **`formatListingPrice` sustituye el importe entero** para `FREE`/`NEGOTIABLE`
   (`'Gratis'`, `'A convenir'`). El formato es un **sufijo** sobre el importe. Semánticas
   incompatibles en el mismo enum.
2. **`priceType` es filtro y facet en Meilisearch.** Fusionar los ejes daría 3 × N valores
   de facet combinatorios y haría imposible el filtro «solo negociables» independiente del
   formato.
3. **`Alert.priceType` guarda criterios de alertas ya creadas por usuarios.** Extender el
   enum no rompe la columna, pero las alertas existentes con `priceType = FIXED` pasarían a
   significar «fijo Y pago único» sin que nadie lo pidiera — cambio silencioso de semántica
   sobre datos de usuario.

**Decisión: enum nuevo `PriceUnit`, campo nuevo `Listing.priceUnit`. `priceType` queda
intacto.**

### 1.3 El molde — política por categoría

Hay **dos idiomas de herencia** en el código, y el campo nuevo necesita uno de cada:

| | `allowedListingType` (escalar) | `allowedViews` (conjunto) |
|---|---|---|
| Campo | `ListingTypePolicy @default(BOTH)` | `ListingViewMode[] @default([])` |
| «No configurado» | `BOTH` (elemento neutro) | `[]` |
| Resolución | `resolveEffectivePolicy` | `resolveEffectiveViews` |
| Semántica | El hijo solo puede **restringir** | **Override total**, sin fusión |
| Fallback global | — | `DEFAULT_EFFECTIVE_VIEWS` |
| Guard padre | `assertPolicyConsistentWithParent` → 400 | **ninguno** (override legítimo) |
| Guard hijos/anuncios | `assertPolicyChangeDoesNotBreakChildren` → 400 con recuento | ninguno |
| Validación en alta | `validateListingTypeAllowed` → **422** | — |
| Lectura pública | `findBySlug` devuelve el valor **ya resuelto** | ídem |
| Panel admin | `<select>` `POLICY_OPTIONS` | checkboxes `VIEW_OPTIONS` |
| Profundidad | 2 niveles (garantizado por `assertParentIsRoot`) | 2 niveles |

Mecanismo clave de la validación en alta (`listings.service.ts`):

```ts
private validateListingTypeAllowed(type, ownPolicy, parentPolicy): void {
  const effective = resolveEffectivePolicy(ownPolicy, parentPolicy ?? 'BOTH');
  if (!isListingTypeAllowed(effective, type))
    throw new UnprocessableEntityException(`Esta categoría no admite anuncios de tipo ${type}.`);
}
```

Se llama **siempre** en `create()`, y en `update()` **solo si `dto.categoryId !== undefined`**
— ése es el mecanismo de grandfathering que hay que replicar.

### 1.4 Impacto en lo existente — verificado sobre el código

| Área | Veredicto | Evidencia |
|---|---|---|
| **Checkout / entitlements / facturación (RF.13)** | **Impacto cero.** Nunca leen `Listing.price` | `modules/billing`, `modules/invoicing`, `modules/redsys` usan `prisma.price` (modelo de facturación) y `listingId` solo para propiedad/elegibilidad. `invoicing.service.ts` usa `tx.price.durationDays` / `tx.price.product.name` |
| **`Deal`** | Sin impacto. No tiene campo de precio | `schema.prisma` |
| **Únicos lectores de `Listing.price`** | `alert-matching.service.ts` y `search.service.ts` | Un campo nuevo no los altera |
| **Meilisearch** | Indexa `price` y `priceType`. `priceUnit` requiere añadirlo a `toDocument`, a `CORE_FILTERABLE_ATTRIBUTES` y **reindexar** | `search.service.ts` |
| **JSON-LD / SEO** | **No hay** structured data en la ficha de anuncio (solo blog y páginas). Nada que romper | `grep 'ld+json'` |
| **Anuncios existentes** | Todos son pago único de facto. `DEFAULT 'ONE_TIME'` los describe correctamente sin backfill | — |

---

## 2. Modelo de datos

```prisma
/// Unidad de medida del importe de un anuncio. Ortogonal a PriceType (que dice
/// si hay importe y si es firme): un precio puede ser a la vez NEGOTIABLE y
/// PER_HOUR. ONE_TIME es el default y describe correctamente todos los anuncios
/// anteriores a esta migración — sin backfill.
enum PriceUnit {
  ONE_TIME    // Pago único
  PER_MONTH   // /mes
  PER_WEEK    // /semana
  PER_DAY     // /día
  PER_HOUR    // /hora
  PER_UNIT    // /ud.
  PER_SESSION // /sesión
}

model Listing {
  // …
  priceType PriceType @default(FIXED)
  priceUnit PriceUnit @default(ONE_TIME)   // ← nuevo
}

model Category {
  // …
  /// Formatos de precio seleccionables en esta categoría. [] = "no configurado"
  /// — hereda del padre; si el padre tampoco configura, cae al default global
  /// DEFAULT_ALLOWED_PRICE_UNITS = [ONE_TIME]. Override completo, no fusión —
  /// mismo criterio que allowedViews.
  allowedPriceUnits PriceUnit[] @default([])   // ← nuevo
}
```

**Decisión de forma: el conjunto se calca de `allowedViews`; la validación 422 se calca de
`allowedListingType`.**

Justificación de la desviación: `allowedListingType` es un **escalar jerárquico** donde el
hijo solo puede restringir. Los formatos son un **conjunto** cuya restricción no es
jerárquica: «Inmobiliaria» puede ser `[ONE_TIME]` (venta) y su hija «Alquiler de pisos»
`[PER_MONTH]` — el hijo ofrece algo que el padre no, y eso es correcto, no una
contradicción. Forzar el molde escalar obligaría a marcar el padre con todos los formatos
de todas sus hijas.

**Default global `[ONE_TIME]`** (no «todos los formatos»): preserva exactamente el
comportamiento actual y obliga a que el admin habilite formatos conscientemente. Con
«todos», aparecería «por hora» en categorías donde no tiene sentido sin que nadie lo
configurara.

**Sin `defaultPriceUnit`.** El wizard preselecciona `ONE_TIME` si está permitido y, si no,
el primero de la lista. Evita un segundo campo y el par de validaciones cruzadas que
`defaultView` obliga a mantener (`validateViewsConfig`).

---

## 3. Migración (`add_price_unit`)

Una sola migración aditiva, misma forma exacta que
`20260707201127_add_category_allowed_listing_type` y `20260713171226_add_category_view_config`:

```sql
-- CreateEnum
CREATE TYPE "PriceUnit" AS ENUM ('ONE_TIME','PER_MONTH','PER_WEEK','PER_DAY','PER_HOUR','PER_UNIT','PER_SESSION');

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "priceUnit" "PriceUnit" NOT NULL DEFAULT 'ONE_TIME';

-- AlterTable
ALTER TABLE "Category" ADD COLUMN "allowedPriceUnits" "PriceUnit"[] DEFAULT ARRAY[]::"PriceUnit"[];
```

**Compatibilidad hacia atrás garantizada por construcción:** Postgres escribe el `DEFAULT`
en todas las filas existentes al añadir la columna `NOT NULL`. Cero backfill, cero script,
cero downtime. Categorías existentes → `[]` = «no configurado» = comportamiento idéntico al
de hoy.

---

## 4. Herencia de formatos permitidos

En `categories/category.types.ts`, junto a `resolveEffectiveViews`:

```ts
/** Fallback global: solo pago único — reproduce el comportamiento anterior a
 *  esta ráfaga (todo anuncio era, de facto, pago único). */
export const DEFAULT_ALLOWED_PRICE_UNITS: PriceUnit[] = ['ONE_TIME'];

export function resolveEffectivePriceUnits(
  own: PriceUnit[],
  parentEffective: PriceUnit[] | null,
): PriceUnit[] {
  if (own.length > 0) return own;                    // override total, sin fusión
  return parentEffective ?? DEFAULT_ALLOWED_PRICE_UNITS;
}

export function isPriceUnitAllowed(allowed: PriceUnit[], unit: PriceUnit): boolean {
  return allowed.includes(unit);
}
```

Funciones puras, sin dependencias, testeables en `category.types.spec.ts`. Profundidad 2
niveles, como todo lo demás (garantizado por `assertParentIsRoot`).

`categories.service.findBySlug` devuelve `allowedPriceUnits` **ya resuelto**, en el mismo
bloque donde ya resuelve `allowedListingType` y `allowedViews`.

---

## 5. Validación

### 5.1 En el anuncio → 422

En `listings.service.ts`, junto a `validateListingTypeAllowed`:

```ts
private validatePriceUnitAllowed(unit, ownAllowed, parentAllowed): void {
  const effective = resolveEffectivePriceUnits(
    ownAllowed,
    parentAllowed ? resolveEffectivePriceUnits(parentAllowed, null) : null,
  );
  if (!isPriceUnitAllowed(effective, unit))
    throw new UnprocessableEntityException(
      `Esta categoría no admite el formato de precio ${unit}.`,
    );
}
```

- **`create()`**: siempre, con `dto.priceUnit ?? 'ONE_TIME'`.
- **`update()`**: **solo si `dto.priceUnit !== undefined` o `dto.categoryId !== undefined`**.
  Un anuncio antiguo con `ONE_TIME` en una categoría reconfigurada después nunca falla al
  editar solo el título. Misma condición que ya usa `validateListingTypeAllowed`.

Las dos `select` de categoría en `create()`/`update()` ya traen `parent` — solo hay que
añadir `allowedPriceUnits: true` en ambos niveles.

### 5.2 En el admin → 400 (RP.2)

Un guard nuevo en `admin.service.ts`, calcado de `assertPolicyChangeDoesNotBreakChildren`:

```ts
private async assertPriceUnitsChangeDoesNotBreakListings(categoryId, newUnits) {
  if (newUnits.length === 0) return;   // volver a "no configurado" nunca rompe
  const children = await this.prisma.category.findMany({
    where: { parentId: categoryId }, select: { id: true, allowedPriceUnits: true },
  });
  // Solo las hijas SIN config propia heredan el cambio; las que la tienen son inmunes.
  const affected = [categoryId, ...children.filter(c => !c.allowedPriceUnits.length).map(c => c.id)];
  const count = await this.prisma.listing.count({
    where: { categoryId: { in: affected }, priceUnit: { notIn: newUnits } },
  });
  if (count > 0) throw new BadRequestException(
    `No se puede cambiar los formatos: ${count} anuncio(s) usan un formato que quedaría fuera de los permitidos.`,
  );
}
```

Se llama solo cuando `dto.allowedPriceUnits` **cambia realmente** respecto a lo persistido
(mismo ahorro que ya hace `updateCategory` con `allowedListingType`). **Sin guard de
coherencia con el padre** — el override es legítimo (§2).

Esto es lo que blinda el requisito de oro por el lado del admin: hace imposible dejar
huérfano un anuncio existente.

### 5.3 DTOs

```ts
// create-listing.dto.ts / update-listing.dto.ts
@IsOptional() @IsEnum(PriceUnit) priceUnit?: PriceUnit;
```

**Opcional**, a diferencia de `priceType`. Cualquier cliente existente que no lo envíe sigue
funcionando y obtiene `ONE_TIME`.

```ts
// create-category.dto.ts / update-category.dto.ts  (RP.2)
@IsOptional() @IsArray() @IsEnum(PriceUnit, { each: true }) allowedPriceUnits?: PriceUnit[];
```

---

## 6. Frontend (RP.3)

### 6.1 Wizard de anuncio

`StepDatos` recibe una prop nueva `allowedPriceUnits: PriceUnit[]` (prop-drilling desde el
wizard, igual que `readOnlyType`). Junto al `Input` de importe:

```
Precio *
 ( ) Precio fijo   ( ) Gratis   ( ) A convenir

 [ 9,99 ] €   [ al mes ▾ ]        ← selector nuevo
```

Reglas:

- **Si `allowedPriceUnits.length <= 1`, el selector no se renderiza.** Toda categoría no
  configurada (= todas las de hoy) muestra el formulario **idéntico** al actual.
- Visible con `priceMode === 'fixed'` **y** con `priceMode === 'negotiable'` — «alquiler a
  convenir, al mes» es un caso real en inmobiliaria. `FREE` **nunca** lleva formato: envía
  `ONE_TIME`.
- Preselección: `ONE_TIME` si está permitido; si no, el primero de la lista.

`StepCategoria` añade `allowedPriceUnits` a su `CategoryData` (viene ya resuelto de
`getCategoryBySlug`). `EditarWizard` hace la misma carga para la categoría ya asignada.

### 6.2 Panel de categorías del admin (RP.2)

Bloque de checkboxes nuevo en `admin/categorias/page.tsx`, inmediatamente debajo de «Vistas
de resultados permitidas», copiando su estructura:

```tsx
const PRICE_UNIT_OPTIONS = [
  { value: 'ONE_TIME',    label: 'Pago único' },
  { value: 'PER_MONTH',   label: 'Al mes' },
  { value: 'PER_WEEK',    label: 'A la semana' },
  { value: 'PER_DAY',     label: 'Al día' },
  { value: 'PER_HOUR',    label: 'Por hora' },
  { value: 'PER_UNIT',    label: 'Por unidad' },
  { value: 'PER_SESSION', label: 'Por sesión' },
];
```

Etiqueta: *«Formatos de precio permitidos — (vacío = hereda del padre, o solo pago único)»*.
`data-testid="allowed-price-units-checkbox"`.

---

## 7. Visualización (RP.4)

### 7.1 Semántica decidida

| `priceType` | Sufijo de formato | Ejemplo |
|---|---|---|
| `FREE` | **Nunca** | `Gratis` |
| `NEGOTIABLE` | **Sí**, si hay formato | `A convenir/mes` |
| `FIXED` | **Sí**, si hay formato | `9,99 €/mes`, `15 €/hora`, `200 €` |

Consecuencia de implementación, importante: **la función NO puede hacer un `return` limpio
para `NEGOTIABLE`** como hace hoy — debe aplicar el sufijo también en esa rama. Solo `FREE`
retorna sin sufijo.

```ts
const UNIT_SUFFIX: Record<PriceUnit, string> = {
  ONE_TIME: '', PER_MONTH: '/mes', PER_WEEK: '/semana', PER_DAY: '/día',
  PER_HOUR: '/hora', PER_UNIT: '/ud.', PER_SESSION: '/sesión',
};

export function formatListingPrice(
  price: number, currency: string, priceType: PriceType,
  priceUnit: PriceUnit = 'ONE_TIME',            // ← default: llamadas antiguas compilan igual
): string {
  if (priceType === 'FREE') return 'Gratis';    // única salida sin sufijo
  const suffix = UNIT_SUFFIX[priceUnit];
  if (priceType === 'NEGOTIABLE') return `A convenir${suffix}`;
  const amount = new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(price);
  return amount + suffix;
}
```

Con `ONE_TIME` el sufijo es `''` → **todo lo existente se renderiza carácter por carácter
igual que hoy**, incluido `A convenir`.

Aplica en: `ListingCard`, `ListingCardWide`, `MyListingCard`, ficha `/anuncio/[slug]`.

### 7.2 Consolidación de las tres copias — en dos pasos separados

Hoy hay **tres copias** de `formatPrice` (`listing-card-shared.tsx`, `MyListingCard.tsx`,
`anuncio/[slug]/page.tsx`). Se unifican en la de `listing-card-shared.tsx`, pero **en dos
commits separados dentro de RP.4**:

1. **Unificar idéntica**: las tres copias se sustituyen por la compartida **sin cambiar el
   comportamiento**. Diff de salida: cero. Si algún test se mueve aquí, es una regresión
   pura de refactor y se ve aislada.
2. **Añadir el sufijo**: solo entonces se introduce el 4º parámetro y `UNIT_SUFFIX`.

Mezclar ambos pasos haría indistinguible un fallo de refactor de un fallo de la feature.

### 7.3 Meilisearch

- `priceUnit` se añade a `toDocument()` y a `CORE_FILTERABLE_ATTRIBUTES` → **filtrable
  siempre**. Requiere `pnpm --filter @marketplace/api reindex`.
- Como **facet visible** en el panel de filtros: **solo en categorías con más de un formato
  efectivo**. No se añade a `NATIVE_FACET_ATTRIBUTES` (que aplicaría a todas las categorías,
  incluidas las de solo pago único, donde sería un filtro de un único valor: ruido). Se
  resuelve por petición, con el mismo criterio con el que `SearchController` ya calcula
  `attributeFacetNames` según la categoría.

---

## 8. Compatibilidad — cómo lo existente sigue funcionando

| Riesgo | Mitigación | Test que lo prueba |
|---|---|---|
| Anuncios existentes sin formato | `DEFAULT 'ONE_TIME'` a nivel de columna, escrito por Postgres en la migración | e2e: un anuncio creado sin `priceUnit` lee `ONE_TIME` |
| Categorías existentes | `DEFAULT []` = «no configurado» → efectivo `[ONE_TIME]` = comportamiento actual | e2e: `GET /categories/:slug` sin config → `['ONE_TIME']` |
| Clientes que no envían `priceUnit` | DTO `@IsOptional()` | e2e: `POST /listings` sin `priceUnit` → 201, `ONE_TIME` |
| Editar un anuncio antiguo tras un cambio de política | `update()` solo valida si llegan `priceUnit` o `categoryId` | e2e: PATCH de solo título en anuncio incompatible → 200 |
| El admin deja anuncios huérfanos | `assertPriceUnitsChangeDoesNotBreakListings` → 400 con recuento (RP.2) | e2e admin: restringir con anuncios incompatibles → 400 |
| Checkout / RF.13 | No leen `Listing.price` ni `Listing.priceType` (§1.4). Columna nueva invisible para ellos | Los e2e de `billing-rf6`, `redsys` y facturación siguen en verde **sin tocarlos** |
| Precios renderizados distinto | Sufijo `''` para `ONE_TIME`; `FREE` retorna antes | unit: `formatListingPrice` sin 4º argumento === salida actual |
| Búsqueda / alertas existentes | `priceType` intacto; `priceUnit` es un filtro nuevo y opcional | `search.e2e-spec`, `alerts.e2e-spec` sin cambios |

**Regla de oro del diseño:** ningún fichero de test existente debería necesitar
modificación. Si alguno la necesita, es señal de que algo se rompió — hay que parar y
reportar, no «arreglar» el test.

---

## 9. Desglose en ráfagas

| Ráfaga | Alcance | Entregable de test |
|---|---|---|
| **RP.1 — Backend: modelo + validación** | Enum `PriceUnit`, `Listing.priceUnit`, `Category.allowedPriceUnits`, migración, `DEFAULT_ALLOWED_PRICE_UNITS`/`resolveEffectivePriceUnits`/`isPriceUnitAllowed`, `validatePriceUnitAllowed` (422) en create/update, DTOs de listing, `findBySlug` expone el efectivo | `category.types.spec.ts` ampliado + `price-unit-policy.e2e-spec.ts` (calcado de `listing-type-policy.e2e-spec.ts`) |
| **RP.2 — Admin: categorías** | DTOs de categoría, `assertPriceUnitsChangeDoesNotBreakListings`, escritura en create/updateCategory, `findTree` devuelve el campo, panel de categorías | `admin-price-units-policy.e2e-spec.ts` + `page.test.tsx` |
| **RP.3 — Frontend: anuncio** | `StepCategoria` → `StepDatos` selector, `PublicarWizard`/`EditarWizard`, tipos web | `PublicarWizard.test.tsx` + e2e Playwright `formato-precio.spec.ts` |
| **RP.4 — Visualización + búsqueda** | (a) unificar las 3 `formatPrice` sin cambiar comportamiento; (b) sufijos en cards y ficha; `priceUnit` en Meilisearch (`toDocument` + filtrable + reindex); facet condicional en `FilterPanel` | unit de formato + `rf8-meilisearch.e2e-spec.ts` |

RP.1 y RP.2 son independientes de RP.3/RP.4: tras RP.2 el sistema es funcional vía API
aunque la UI no lo exponga todavía.

**Nota sobre el hueco entre RP.1 y RP.2:** el guard anti-huérfanos vive en RP.2. RP.1 no
expone ninguna vía (ni DTO ni endpoint) para que un admin escriba `allowedPriceUnits`, así
que el hueco no es explotable hasta que RP.2 abra esa puerta — y RP.2 la abre con el guard
ya puesto.

---

## 10. Extensiones futuras (fuera de alcance)

- **`Alert.priceUnit`** — permitir que un usuario guarde alertas del tipo «pisos en alquiler
  mensual». Fuera de alcance por ahora. Si se implementa, sigue el molde exacto de
  `Alert.priceType`: columna opcional, filtro en `alert-matching.service.ts` con
  `{ OR: [{ priceUnit: null }, { priceUnit: listing.priceUnit }] }`.
- **`defaultPriceUnit` por categoría** — si la preselección «`ONE_TIME` o el primero» resulta
  insuficiente en la práctica. Implicaría replicar el par de validaciones cruzadas de
  `defaultView`.
- **Formatos adicionales** (`PER_M2`, `PER_KM`) — añadir valores a un enum es trivial;
  quitarlos no. Se añaden cuando haya un caso real.
- **JSON-LD en la ficha de anuncio** — hoy no existe. Cuando se añada, `priceUnit` mapea a
  `priceSpecification.unitCode` / `billingIncrement` de schema.org.
