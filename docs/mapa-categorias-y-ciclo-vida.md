# Mapa de inventario — sistema de categorías y ciclo de vida del anuncio

> **Qué es este documento.** Un inventario del estado ACTUAL, verificado contra el código,
> fichero a fichero. No propone cambios, no decide nada, no diseña. Es el terreno sobre el
> que después se decidirá cómo trocear el trabajo.
>
> **Método.** Todo lo que aquí se afirma se ha leído en el código. Donde `docs/estado-tecnico.md`
> dice algo, se ha confirmado o corregido contra el fuente — el código manda. Lo que NO se
> encuentra se marca explícitamente como **NO EXISTE** o **NO VERIFICADO**.
>
> Fecha del inventario: 2026-08-11. Rama `main`, commit `1d1f462`.

---

## Índice

- [BLOQUE 1 — La profundidad del árbol](#bloque-1--la-profundidad-del-árbol)
- [BLOQUE 2 — El ciclo de vida del anuncio y sus validaciones](#bloque-2--el-ciclo-de-vida-del-anuncio-y-sus-validaciones)
- [BLOQUE 3 — El acoplamiento config de categorías ↔ anuncios existentes](#bloque-3--el-acoplamiento-config-de-categorías--anuncios-existentes)
- [BLOQUE 4 — Los ajustes configurables existentes (el molde)](#bloque-4--los-ajustes-configurables-existentes-el-molde)

---

# BLOQUE 1 — La profundidad del árbol

## 1.0 Resumen del hallazgo central

**La herencia NO es recursiva: es de UN SOLO SALTO sobre dos arrays planos.**

`resolveEffectiveSchema(own, parentSchema)` recibe **dos listas ya resueltas** y las fusiona.
No recorre el árbol, no acepta una cadena de ancestros, no se llama a sí misma. Y cada uno de
sus ~8 llamantes carga el padre con un `parent: { select: … }` de **un nivel** en la consulta
Prisma — el abuelo nunca llega a memoria.

Consecuencia directa para la decisión de 2→4 niveles: **no es "quitar un límite"**. El límite
(`assertParentIsRoot`) es una guarda de tres líneas y quitarla es trivial; lo que hay debajo es
que *ninguna* de las cinco funciones de resolución ni *ninguno* de sus puntos de carga sabe
subir más de un escalón. Pasar a 4 niveles es **reescribir la resolución de herencia y todos
sus puntos de carga**, más `categoryPath`, más el fallback de Postgres, más las rutas del
frontend, más la canonicalización de URLs.

## 1.1 El MODELO `Category` — cómo se representa la jerarquía

**Fichero:** [schema.prisma:413-466](apps/api/prisma/schema.prisma#L413-L466)

```
model Category {
  parentId String?                                    // línea 422
  parent   Category?  @relation("CategoryTree", …)     // línea 423
  children Category[] @relation("CategoryTree")        // línea 424
  @@index([parentId])                                  // línea 465
}
```

| Pregunta | Respuesta verificada |
|---|---|
| ¿Hay columna `path`? | **NO** |
| ¿Hay columna `level` / `depth`? | **NO** |
| ¿Hay límite de profundidad en el modelo? | **NO** — auto-relación sin restricción |
| ¿Hay constraint `CHECK` en la base de datos? | **NO** — verificado en todas las migraciones |
| FK de `parentId` | `ON DELETE SET NULL` — [migrations/20260620100046_init/migration.sql:231](apps/api/prisma/migrations/20260620100046_init/migration.sql#L231) |

Es decir: **el modelo de datos admite N niveles hoy mismo**. El "2" vive enteramente en la capa
de aplicación.

### El único punto que impide el 3.er nivel

**`AdminService.assertParentIsRoot`** — [admin.service.ts:870-881](apps/api/src/modules/admin/admin.service.ts#L870-L881)

```
if (parent?.parentId) throw new BadRequestException(
  `… el árbol de categorías admite solo 2 niveles (padre → hija).`)
```

Su comentario de cabecera ([admin.service.ts:852-869](apps/api/src/modules/admin/admin.service.ts#L852-L869))
documenta explícitamente la decisión y sus consecuencias: un nieto *desaparecía* de
`GET /categories` (`findTree` solo recorre raíces + un nivel) y *perdía los atributos del abuelo*
en `GET /categories/:slug` — en silencio, sin error. También deja escrito que la alternativa
(«opción B: generalizar `resolveEffectiveSchema` a N niveles») quedó pendiente a propósito.

**Se llama en UN solo sitio:** `createCategory` — [admin.service.ts:903](apps/api/src/modules/admin/admin.service.ts#L903).

**Refuerzo estructural:** `UpdateCategoryDto` **no admite `parentId`**
([update-category.dto.ts](apps/api/src/modules/admin/dto/update-category.dto.ts), confirmado por el
comentario en [admin.service.ts:975-977](apps/api/src/modules/admin/admin.service.ts#L975-L977)).
Una categoría **no se puede mover de padre** después de creada — no hay endpoint para ello. Por
tanto, controlando la creación queda controlada la profundidad para siempre.

## 1.2 La HERENCIA de atributos — recursiva o de un salto (CRÍTICO)

### La función

**`resolveEffectiveSchema`** — [category.types.ts:65-73](apps/api/src/modules/categories/category.types.ts#L65-L73)

```
export function resolveEffectiveSchema(own: AttributeField[], parentSchema: AttributeField[]) {
  if (!parentSchema.length) return own;
  const ownNames = new Set(own.map((f) => f.name));
  const inherited = parentSchema.filter((f) => !ownNames.has(f.name));
  return [...inherited, ...own];      // heredados primero, propios después
}
```

- **Firma:** dos arrays planos. No recibe una categoría, ni un id, ni una cadena de ancestros.
- **Cuerpo:** una fusión por nombre. **Sin recursión, sin bucle sobre ancestros, sin acceso a BD.**
- **Regla de colisión:** el hijo pisa al padre cuando comparten `name`.
- **Orden:** heredados primero (es orden de *formulario*: el contexto del padre antes de lo específico).
- **Comentario en el propio fichero, línea 63:** *"Depth is capped at 2 levels (leaf → parent), matching categoryPath and INDEX_INCLUDE."*

**Respuesta a la pregunta de nieto→hijo→padre:** con la función tal cual está, un nieto solo
recibiría el schema de su padre directo. Los atributos del abuelo **se perderían en silencio** —
exactamente lo que documenta `assertParentIsRoot`. La función *podría* componerse manualmente
(`resolveEffectiveSchema(nieto, resolveEffectiveSchema(hijo, abuelo))`), pero **nadie lo hace**, y
sobre todo: **ningún llamante carga el abuelo**.

### Los puntos de carga (todos de un nivel)

Esto es lo que hace que el cambio no sea local a `category.types.ts`. Cada llamante emite su
propia consulta Prisma con **exactamente un `parent`**:

| Llamante | Carga del padre | Uso |
|---|---|---|
| `CategoriesService.findTree` | [categories.service.ts:43-54](apps/api/src/modules/categories/categories.service.ts#L43-L54) — raíces + `children` (1 nivel) | [:115](apps/api/src/modules/categories/categories.service.ts#L115) |
| `CategoriesService.findBySlug` | [categories.service.ts:157-172](apps/api/src/modules/categories/categories.service.ts#L157-L172) — `parent: { select: … }` | [:178](apps/api/src/modules/categories/categories.service.ts#L178) |
| `ListingsService.create` | [listings.service.ts:182-185](apps/api/src/modules/listings/listings.service.ts#L182-L185) | [:188-191](apps/api/src/modules/listings/listings.service.ts#L188-L191) |
| `ListingsService.update` | [listings.service.ts:292-295](apps/api/src/modules/listings/listings.service.ts#L292-L295) | [:300-303](apps/api/src/modules/listings/listings.service.ts#L300-L303) |
| `AdminService.validateCardAttributeLimitByType` | [admin.service.ts:558-565](apps/api/src/modules/admin/admin.service.ts#L558-L565) | [:566](apps/api/src/modules/admin/admin.service.ts#L566) |
| `AdminService.assertCardAttributeChangeDoesNotBreakChildren` | [admin.service.ts:676-679](apps/api/src/modules/admin/admin.service.ts#L676-L679) — hijas DIRECTAS | [:689](apps/api/src/modules/admin/admin.service.ts#L689) |
| `FilterableAttributesResolver.mergeSchemasForCategory` | [filterable-attributes.resolver.ts:117-137](apps/api/src/modules/search/filterable-attributes.resolver.ts#L117-L137) — un nivel arriba **o** un nivel abajo | [:126-127](apps/api/src/modules/search/filterable-attributes.resolver.ts#L126-L127) |
| `FilterableAttributesResolver.loadCategories` | [filterable-attributes.resolver.ts:153-154](apps/api/src/modules/search/filterable-attributes.resolver.ts#L153-L154) — `parent: { select: { slug } }` | — |

### Las OTRAS cuatro resoluciones — el mismo salto único

Todas viven en `category.types.ts` y todas repiten la firma «propio + efectivo-del-padre», todas
con el mismo supuesto anotado en su comentario:

| Función | Línea | Regla | Nota de profundidad |
|---|---|---|---|
| `resolveEffectivePolicy` | [:122-129](apps/api/src/modules/categories/category.types.ts#L122-L129) | `BOTH` es neutro; el hijo solo puede *restringir* | *"Same 2-level depth assumption… (leaf → parent only, no grandparent)"* [:119-120](apps/api/src/modules/categories/category.types.ts#L119-L120) |
| `resolveEffectiveViews` | [:181-189](apps/api/src/modules/categories/category.types.ts#L181-L189) | Override COMPLETO (no fusión) | *"Same 2-level depth assumption"* [:178-179](apps/api/src/modules/categories/category.types.ts#L178-L179) |
| `resolveEffectivePriceUnits` | [:218-224](apps/api/src/modules/categories/category.types.ts#L218-L224) | Override COMPLETO | *"…no grandparent — enforced by assertParentIsRoot"* [:215-216](apps/api/src/modules/categories/category.types.ts#L215-L216) |
| `resolveEffectiveTags` | [tag.types.ts:36-39](apps/api/src/modules/tags/tag.types.ts#L36-L39) | Unión; propios PRIMERO (orden inverso al de atributos, a propósito) | *"Mismo supuesto de 2 niveles… garantizado por `assertParentIsRoot`"* [tag.types.ts:29-30](apps/api/src/modules/tags/tag.types.ts#L29-L30) |

**Patrón de resolución en dos pasos.** Vistas y formatos de precio se resuelven así, y el "dos
pasos" ES el 2-niveles cableado:
[categories.service.ts:191-211](apps/api/src/modules/categories/categories.service.ts#L191-L211) —
el padre resuelve contra `null`, el hijo contra el efectivo del padre. Mismo patrón en
[listings.service.ts:1500-1503](apps/api/src/modules/listings/listings.service.ts#L1500-L1503).

**Herencia de tags:** el `parentId` se lee directo y se compone una lista de 2 ids:
[tags.service.ts:86-90](apps/api/src/modules/tags/tags.service.ts#L86-L90),
[:203-209](apps/api/src/modules/tags/tags.service.ts#L203-L209),
[:475-480](apps/api/src/modules/tags/tags.service.ts#L475-L480).

## 1.3 `categoryPath` — cómo se construye

**Construcción:** [search.service.ts:513-516](apps/api/src/modules/search/search.service.ts#L513-L516)

```
categoryPath: [
  listing.category.slug,
  ...(listing.category.parent ? [listing.category.parent.slug] : []),
],
```

**Array de 1 o 2 elementos. Literal.** Sin bucle, sin recursión.

- **Declaración del campo:** [search.service.ts:24-25](apps/api/src/modules/search/search.service.ts#L24-L25) — *"Slug of the leaf category followed by all ancestor slugs"* (el comentario dice "all ancestors"; el código pone uno).
- **Filtro:** [search.service.ts:400](apps/api/src/modules/search/search.service.ts#L400) — `categoryPath = "slug"`, que Meilisearch evalúa como «¿contiene el array este valor?». Es lo que hace que navegar un PADRE agregue los anuncios de sus hijas.
- **Filtrable siempre:** `CORE_FILTERABLE_ATTRIBUTES` [search.service.ts:100](apps/api/src/modules/search/search.service.ts#L100).
- **Nombre reservado** para que un atributo de categoría no lo pise: [filterable-attributes.resolver.ts:16](apps/api/src/modules/search/filterable-attributes.resolver.ts#L16).
- **Uso en tags:** [tags.service.ts:246](apps/api/src/modules/tags/tags.service.ts#L246).

## 1.4 `INDEX_INCLUDE` y el documento Meili

**Fichero:** [search.service.ts:197-221](apps/api/src/modules/search/search.service.ts#L197-L221)

```
category: { select: { id, slug, name, parent: { select: { slug } } } }
```

**Un solo `parent`.** El propio comentario de cabecera lo declara y da la receta de qué habría
que tocar — [search.service.ts:186-196](apps/api/src/modules/search/search.service.ts#L186-L196):

> *"NOTE: `parent` covers a 2-level hierarchy (leaf → parent). If the category tree ever grows to
> 3+ levels the include must walk further up the chain (parent.parent…) and `toDocument` must
> build the full ancestor array instead of checking only one level."*

`INDEX_INCLUDE` se **exporta** a propósito para que el processor de indexación y `pnpm reindex`
usen exactamente el mismo include ([:188-191](apps/api/src/modules/search/search.service.ts#L188-L191)) —
o un mismo anuncio tendría documentos distintos según por qué camino se indexara.

**Campos de categoría en el documento:** `categoryId`, `categorySlug`, `categoryName`, `categoryPath`
([search.service.ts:510-516](apps/api/src/modules/search/search.service.ts#L510-L516)).
`categorySlug` es también faceta nativa ([:140](apps/api/src/modules/search/search.service.ts#L140)).

## 1.5 Los BREADCRUMBS

| Sitio | Fichero:línea | Forma |
|---|---|---|
| Dato de origen (API) | [categories.service.ts:220-222](apps/api/src/modules/categories/categories.service.ts#L220-L222) | `parent: { slug, name } \| null` — **un nivel** |
| Miga de la página de categoría | [CategoryListingPage.tsx:371-376](apps/web/src/components/categorias/CategoryListingPage.tsx#L371-L376) | `[...(category.parent ? [padre] : []), actual]` — array de 1 o 2 |
| JSON-LD | [CategoryListingPage.tsx:381-383](apps/web/src/components/categorias/CategoryListingPage.tsx#L381-L383) | Generado del MISMO `trail` |
| Miga de la ficha del anuncio | [anuncio/[slug]/page.tsx:113-120](apps/web/src/app/(public)/anuncio/[slug]/page.tsx#L113-L120) | `categoryParent` opcional, un nivel |
| Include de la ficha | [listings.service.ts:79-81](apps/api/src/modules/listings/listings.service.ts#L79-L81) | `category.parent: { slug, name }` — un nivel |

Nota operativa registrada en el código: la ficha se cachea 5 min en Redis, así que tras un
despliegue hay fichas servidas **sin** `category.parent`; el frontend lo trata como opcional y
degrada a URL plana + miga de 2 niveles — [listings.service.ts:75-78](apps/api/src/modules/listings/listings.service.ts#L75-L78).

## 1.6 La ADMINISTRACIÓN de categorías (backoffice)

### Backend

| Punto | Fichero:línea | Qué asume |
|---|---|---|
| `getCategories` (árbol del admin) | [admin.service.ts:506-542](apps/api/src/modules/admin/admin.service.ts#L506-L542) | `parentId: null` + `children` — **exactamente 2 niveles**. Un nieto no aparecería |
| `createCategory` | [admin.service.ts:902-964](apps/api/src/modules/admin/admin.service.ts#L902-L964) | Llama `assertParentIsRoot` primero de todo |
| `updateCategory` | [admin.service.ts:966-1082](apps/api/src/modules/admin/admin.service.ts#L966-L1082) | No admite `parentId` → la condición raíz/hija no puede cambiar |
| `CreateCategoryDto.parentId` | [create-category.dto.ts:14](apps/api/src/modules/admin/dto/create-category.dto.ts#L14) | `parentId?: string` — sin validación de profundidad en el DTO (vive en el servicio) |
| `deleteCategory` | [admin.service.ts:1127-1172](apps/api/src/modules/admin/admin.service.ts#L1127-L1172) | Cuenta hijas DIRECTAS ([:1142](apps/api/src/modules/admin/admin.service.ts#L1142)) |

### Frontend (`/admin/categorias`)

| Punto | Fichero:línea | Qué asume |
|---|---|---|
| `openCreate` | [page.tsx:650-668](apps/web/src/app/(admin)/admin/categorias/page.tsx#L650-L668) | *"Parent is a root category → its effective schema = its own schema"* ([:664](apps/web/src/app/(admin)/admin/categorias/page.tsx#L664)) — **hardcodeado**: el heredado que se muestra al crear una hija es el schema PROPIO del padre, sin resolver nada |
| Botón «Nueva subcategoría» | [page.tsx:992-1001](apps/web/src/app/(admin)/admin/categorias/page.tsx#L992-L1001) | Existe **solo en la fila de raíz**. La UI impide el 3.er nivel estructuralmente |
| `buildSchemaPanel` | [page.tsx:803-805](apps/web/src/app/(admin)/admin/categorias/page.tsx#L803-L805) | *"`children` solo se pasa desde la fila RAÍZ (la única que puede tener hijas en el modelo de 2 niveles)"* |
| `nextOrderFor` | [page.tsx:671-677](apps/web/src/app/(admin)/admin/categorias/page.tsx#L671-L677) | Hermanos = raíces o `children` del padre — 2 niveles |
| `moveChild` | [page.tsx:755-777](apps/web/src/app/(admin)/admin/categorias/page.tsx#L755-L777) | Reordena dentro de `parent.children` |
| Sangrado visual | [page.tsx:401-404](apps/web/src/app/(admin)/admin/categorias/page.tsx#L401-L404) | `indent: boolean` — **booleano, no un número de nivel** |
| Tipo del cliente | [lib/api/admin.ts:215](apps/web/src/lib/api/admin.ts#L215) | `children: AdminCategoryChild[]` — el hijo NO tiene `children` |

## 1.7 Los FILTROS y el buscador

| Punto | Fichero:línea | Qué asume |
|---|---|---|
| Filtro por categoría (Meili) | [search.service.ts:400](apps/api/src/modules/search/search.service.ts#L400) | `categoryPath = slug` → incluye descendientes **porque el array los lleva**, no por lógica de árbol |
| **Fallback Postgres** de `/[categoria]` | [listings.service.ts:941-946](apps/api/src/modules/listings/listings.service.ts#L941-L946) | `OR: [{ slug }, { parent: { slug } }]` — el equivalente SQL de `categoryPath`, **2 niveles**. Comentario explícito en [:938-940](apps/api/src/modules/listings/listings.service.ts#L938-L940) |
| Atributos filtrables por categoría | [filterable-attributes.resolver.ts:117-137](apps/api/src/modules/search/filterable-attributes.resolver.ts#L117-L137) | HOJA = propio + padre; PADRE = propio + cada hija. **Un nivel en cada dirección** |
| Colisión de sufijos `_min`/`_max` | [admin.service.ts:602-643](apps/api/src/modules/admin/admin.service.ts#L602-L643) | Ámbito = propio + padre + hijas directas |
| Patrocinados | [sponsored-ads.service.ts:52-68](apps/api/src/modules/sponsored-ads/sponsored-ads.service.ts#L52-L68) | `categoryIds = parentId ? [categoryId, parentId] : [categoryId]`. Comentario: *"2 niveles, mismo límite que categoryPath"* ([:62](apps/api/src/modules/sponsored-ads/sponsored-ads.service.ts#L62)) |
| Tags disponibles | [available-tags.ts:39,56,58](apps/web/src/lib/available-tags.ts#L39) | `root.tags` + `root.children[].tags` |
| Arrastre de filtros al cambiar de categoría | [filter-carry.ts:103,106,147,150](apps/web/src/lib/filter-carry.ts#L103) | Bucle raíz → hijas |
| Campos filtrables (frontend) | [filterable-fields.ts:83,109](apps/web/src/lib/filterable-fields.ts#L83) | `raiz.children.flatMap(...)` |
| Atributos de card | [card-attributes.ts:49,67,103](apps/web/src/lib/card-attributes.ts#L49) | Tres bucles `for (const child of cat.children ?? [])` |
| Selector de categoría | [CategorySelect.tsx:63-66,85](apps/web/src/components/busqueda/CategorySelect.tsx#L63-L66) | `optgroup` raíz → `option` hijas |
| Buscador de portada | [SearchBar.tsx:91](apps/web/src/components/busqueda/SearchBar.tsx#L91) + [category-url.ts:59-70](apps/web/src/lib/category-url.ts#L59-L70) | Resuelve vía `findCategoryUrlParts` |
| Carrusel de categorías | [CategoryCarouselHomeBlockRenderer.tsx:37](apps/web/src/components/home/blocks/CategoryCarouselHomeBlockRenderer.tsx#L37) | `.flatMap((c) => [c, ...(c.children ?? [])])` |
| Tabla de búsqueda de portada | [SearchTableHomeBlockRenderer.tsx:73,96](apps/web/src/components/home/blocks/SearchTableHomeBlockRenderer.tsx#L73) | Ídem |
| Grid de categorías | [CategoryGrid.tsx:12](apps/web/src/components/categorias/CategoryGrid.tsx#L12) | `categoryPath(cat)` |

## 1.8 URLs, rutas y canonicalización (frontend)

**Fuente única de la URL de categoría:** [category-url.ts](apps/web/src/lib/category-url.ts)

- Cabecera, [:15-16](apps/web/src/lib/category-url.ts#L15-L16): *"El árbol es de EXACTAMENTE 2 niveles (garantizado en el backend por `assertParentIsRoot`), así que no hay caso de abuelo: o hay padre o no lo hay."*
- `categoryPath` [:35-37](apps/web/src/lib/category-url.ts#L35-L37): `parentSlug ? '/{padre}/{slug}' : '/{slug}'` — **ternario, no un join de N segmentos**.
- `findCategoryUrlParts` [:59-70](apps/web/src/lib/category-url.ts#L59-L70): doble bucle raíz→hija.
- Regla de proyecto declarada en [:5-9](apps/web/src/lib/category-url.ts#L5-L9): nadie construye `/${slug}` a mano (había 11 sitios que lo hacían).

**Rutas de Next:**

- [`(public)/[categoria]/page.tsx`](apps/web/src/app/(public)/[categoria]/page.tsx) — raíz
- [`(public)/[categoria]/[subcategoria]/page.tsx`](apps/web/src/app/(public)/[categoria]/[subcategoria]/page.tsx) — hija. Comentario [:14-15](apps/web/src/app/(public)/[categoria]/[subcategoria]/page.tsx#L14-L15): *"Dos segmentos y no más: el árbol tiene exactamente 2 niveles, así que /a/b/c no casa con ninguna ruta y sigue dando el 404 real del router"*
- **NO hay catch-all `[...ruta]`** — son dos rutas fijas.

**Canonicalización (middleware 308):** [category-canonical.ts](apps/web/src/lib/category-canonical.ts)

- `MAX_CATEGORY_SEGMENTS = 2` — [:45-47](apps/web/src/lib/category-canonical.ts#L45-L47), con el comentario *"El árbol es de 2 niveles (assertParentIsRoot), así que ninguna URL de categoría legítima pasa de dos segmentos."*
- Corte por longitud: [:116](apps/web/src/lib/category-canonical.ts#L116)
- Construcción del mapa `slug → padre`: [:84-87](apps/web/src/lib/category-canonical.ts#L84-L87) — doble bucle raíz→hija
- Regla: *"manda el último segmento"* [:105-109](apps/web/src/lib/category-canonical.ts#L105-L109)

**Sitemap:** [sitemap.ts:102-113](apps/web/src/app/sitemap.ts#L102-L113) — `categories.flatMap(root => [root, ...root.children])`.

**Tipo público:** [types/index.ts:156](apps/web/src/types/index.ts#L156) — `children?: Category[]` (recursivo en el TIPO, pero nadie lo recorre en profundidad).

**Slugs raíz reservados:** [admin.service.ts:159-169](apps/api/src/modules/admin/admin.service.ts#L159-L169) (backend) y su espejo [category-canonical.ts:37-43](apps/web/src/lib/category-canonical.ts#L37-L43) (frontend). Solo aplican a RAÍCES: una hija vive bajo el padre y no compite con `/blog` — [admin.service.ts:884-892](apps/api/src/modules/admin/admin.service.ts#L884-L892).

## 1.9 Inventario cerrado: TODOS los puntos donde el "2" está presente

**Guarda activa (1):**
1. [admin.service.ts:870-881](apps/api/src/modules/admin/admin.service.ts#L870-L881) — `assertParentIsRoot`

**Resolución de herencia — un salto (5 funciones):**
2. [category.types.ts:65-73](apps/api/src/modules/categories/category.types.ts#L65-L73) — `resolveEffectiveSchema`
3. [category.types.ts:122-129](apps/api/src/modules/categories/category.types.ts#L122-L129) — `resolveEffectivePolicy`
4. [category.types.ts:181-189](apps/api/src/modules/categories/category.types.ts#L181-L189) — `resolveEffectiveViews`
5. [category.types.ts:218-224](apps/api/src/modules/categories/category.types.ts#L218-L224) — `resolveEffectivePriceUnits`
6. [tag.types.ts:36-39](apps/api/src/modules/tags/tag.types.ts#L36-L39) — `resolveEffectiveTags`

**Puntos de carga de un solo `parent` (8):**
7. [categories.service.ts:43-54](apps/api/src/modules/categories/categories.service.ts#L43-L54) · 8. [categories.service.ts:157-172](apps/api/src/modules/categories/categories.service.ts#L157-L172) · 9. [listings.service.ts:182-185](apps/api/src/modules/listings/listings.service.ts#L182-L185) · 10. [listings.service.ts:292-295](apps/api/src/modules/listings/listings.service.ts#L292-L295) · 11. [admin.service.ts:558-565](apps/api/src/modules/admin/admin.service.ts#L558-L565) · 12. [admin.service.ts:676-679](apps/api/src/modules/admin/admin.service.ts#L676-L679) · 13. [admin.service.ts:609-624](apps/api/src/modules/admin/admin.service.ts#L609-L624) · 14. [filterable-attributes.resolver.ts:117-137](apps/api/src/modules/search/filterable-attributes.resolver.ts#L117-L137)

**Búsqueda / indexado (3):**
15. [search.service.ts:197-205](apps/api/src/modules/search/search.service.ts#L197-L205) — `INDEX_INCLUDE`
16. [search.service.ts:513-516](apps/api/src/modules/search/search.service.ts#L513-L516) — construcción de `categoryPath`
17. [listings.service.ts:941-946](apps/api/src/modules/listings/listings.service.ts#L941-L946) — fallback Postgres

**Otros consumidores backend (3):**
18. [sponsored-ads.service.ts:52-68](apps/api/src/modules/sponsored-ads/sponsored-ads.service.ts#L52-L68) · 19. [tags.service.ts:86-90, 203-209, 475-480](apps/api/src/modules/tags/tags.service.ts#L86-L90) · 20. [admin.service.ts:506-542](apps/api/src/modules/admin/admin.service.ts#L506-L542) (árbol del admin) + [:762-795](apps/api/src/modules/admin/admin.service.ts#L762-L795) + [:823-850](apps/api/src/modules/admin/admin.service.ts#L823-L850) (guardas hacia hijas directas)

**Frontend (13):**
21. [category-url.ts:35-37, 59-70](apps/web/src/lib/category-url.ts#L35-L37) · 22. [category-canonical.ts:45-47, 84-87, 116](apps/web/src/lib/category-canonical.ts#L45-L47) · 23. [`[categoria]/[subcategoria]/page.tsx`](apps/web/src/app/(public)/[categoria]/[subcategoria]/page.tsx) · 24. [sitemap.ts:102-113](apps/web/src/app/sitemap.ts#L102-L113) · 25. [CategoryListingPage.tsx:371-376](apps/web/src/components/categorias/CategoryListingPage.tsx#L371-L376) · 26. [anuncio/[slug]/page.tsx:113-120](apps/web/src/app/(public)/anuncio/[slug]/page.tsx#L113-L120) · 27. [filter-carry.ts:103,106,147,150](apps/web/src/lib/filter-carry.ts#L103) · 28. [card-attributes.ts:49,67,103](apps/web/src/lib/card-attributes.ts#L49) · 29. [filterable-fields.ts:83,109](apps/web/src/lib/filterable-fields.ts#L83) · 30. [available-tags.ts:39,56,58](apps/web/src/lib/available-tags.ts#L39) · 31. [CategorySelect.tsx:63-66,85](apps/web/src/components/busqueda/CategorySelect.tsx#L63-L66) · 32. [CategoryCarouselHomeBlockRenderer.tsx:37](apps/web/src/components/home/blocks/CategoryCarouselHomeBlockRenderer.tsx#L37) + [SearchTableHomeBlockRenderer.tsx:73,96](apps/web/src/components/home/blocks/SearchTableHomeBlockRenderer.tsx#L73) · 33. [/admin/categorias/page.tsx:650-668, 803-805, 992-1001](apps/web/src/app/(admin)/admin/categorias/page.tsx#L650-L668)

**Lo que NO existe:** columna `path`, columna `level`, constante `MAX_CATEGORY_DEPTH` en el
backend, constraint de base de datos, validación de profundidad en ningún DTO, y **ninguna
función de recorrido de ancestros en todo el repositorio**.

> Nota de contraste: `NavItem` (el menú del sitio, otro árbol) **sí** tiene una constante
> `NAV_MAX_DEPTH = 2` y una guarda `assertMaxDepth` + `assertNoCycle` que permite MOVER nodos —
> [nav.service.ts:310-324](apps/api/src/modules/nav/nav.service.ts#L310-L324). Es un árbol
> distinto y no comparte código con `Category`, pero es el molde más cercano que existe hoy para
> «tope de profundidad configurable con movimiento de nodos».

## 1.10 Verificación contra `estado-tecnico.md`

| Lo que dice el doc | Verificación |
|---|---|
| *"Profundidad máxima 2 niveles (hoja → padre), congruente con `categoryPath` e `INDEX_INCLUDE`"* ([estado-tecnico.md:58](docs/estado-tecnico.md), [:329-330](docs/estado-tecnico.md)) | ✅ **Correcto**, pero **incompleto**: no dice que la herencia sea de un salto ni que el 2 esté replicado en ~33 puntos, incluidos 13 del frontend |
| *"`INDEX_INCLUDE` solo incluye un nivel de padre"* ([estado-tecnico.md:281-282](docs/estado-tecnico.md)) | ✅ Confirmado en [search.service.ts:203](apps/api/src/modules/search/search.service.ts#L203) |
| *"`GET /categories/:slug` devuelve schema efectivo: herencia padre→hijo, hijo sobreescribe campo con mismo `name`"* | ✅ Confirmado en [categories.service.ts:178](apps/api/src/modules/categories/categories.service.ts#L178) y [category.types.ts:70-72](apps/api/src/modules/categories/category.types.ts#L70-L72) |

---

# BLOQUE 2 — El ciclo de vida del anuncio y sus validaciones

## 2.0 Resumen del hallazgo central

**NO existe una puerta de validación común.** Cada transición comprueba lo suyo por su cuenta,
en su propio método, y las comprobaciones difieren entre caminos que llevan al MISMO estado.

Hay una función que *parece* la puerta pero no lo es: `ListingActivationService.listingBecameActive`
([listing-activation.service.ts:38-40](apps/api/src/modules/listing-activation/listing-activation.service.ts#L38-L40)).
Su propio comentario dice *"Single hook point"*, pero es un hook **posterior** a la activación
(invalida caché + encola reindexado + dispara el matching de alertas). **No valida nada** y **no
lo llaman todos los caminos que activan**.

Consecuencia medible: **hay 4 caminos que dejan un anuncio en `ACTIVE` sin pasar por la cuota de
activos** (ver §2.5).

## 2.1 Los ESTADOS — el enum real

**Fichero:** [schema.prisma:53-72](apps/api/prisma/schema.prisma#L53-L72)

| Estado | Línea | Significado según el propio schema |
|---|---|---|
| `DRAFT` | [:54](apps/api/prisma/schema.prisma#L54) | Borrador, aún no enviado. **Default de la columna** ([:573](apps/api/prisma/schema.prisma#L573)) |
| `PENDING_REVIEW` | [:55](apps/api/prisma/schema.prisma#L55) | En espera de moderación |
| `ACTIVE` | [:56](apps/api/prisma/schema.prisma#L56) | Publicado y visible |
| `RESERVED` | [:57](apps/api/prisma/schema.prisma#L57) | Reservado a un comprador |
| `SOLD` | [:58](apps/api/prisma/schema.prisma#L58) | Vendido |
| `EXPIRED` | [:59](apps/api/prisma/schema.prisma#L59) | Caducado |
| `REJECTED` | [:60](apps/api/prisma/schema.prisma#L60) | Rechazado por moderación |
| `PAUSED` | [:61-66](apps/api/prisma/schema.prisma#L61-L66) | Temporal, reactivable. Ni cuenta para cuota ni se indexa |
| `ARCHIVED` | [:67-71](apps/api/prisma/schema.prisma#L67-L71) | Permanente, **IRREVERSIBLE**. No destruye conversaciones/tratos/valoraciones |

**No hay tabla ni máquina de estados declarativa.** Las transiciones permitidas son `if`s
dispersos en cuatro servicios distintos.

## 2.2 Tabla completa de transiciones

### `ListingsService` — [listings.service.ts](apps/api/src/modules/listings/listings.service.ts)

| Método | Línea | Origen exigido | Destino | Qué valida |
|---|---|---|---|---|
| `create` | [:171-259](apps/api/src/modules/listings/listings.service.ts#L171-L259) | — | `DRAFT` (default) | Categoría existe; **atributos requeridos** (filtrados por tipo); **valores de atributos**; **selects vinculados**; **política producto/servicio**; **formato de precio**; **tags** (contra categoría + tope). Imágenes: solo propiedad y no-vinculadas-a-otro ([:1530-1568](apps/api/src/modules/listings/listings.service.ts#L1530-L1568)). **NO comprueba cuota** |
| `update` | [:261-450](apps/api/src/modules/listings/listings.service.ts#L261-L450) | cualquiera (solo propiedad) | sin cambio de estado | Con *grandfathering* por disparador (§2.6). **No hay guarda de estado**: se puede editar un `ARCHIVED` |
| `publish` | [:452-494](apps/api/src/modules/listings/listings.service.ts#L452-L494) | `DRAFT` únicamente | `ACTIVE` o `PENDING_REVIEW` | 1) Propiedad. 2) `status === DRAFT`. 3) Filtro de palabras → `PENDING_REVIEW` (fail-open). 4) **Cuota de activos, solo si el destino es ACTIVE** ([:472-474](apps/api/src/modules/listings/listings.service.ts#L472-L474)). Fija `publishedAt` y `expiresAt` |
| `renew` | [:496-526](apps/api/src/modules/listings/listings.service.ts#L496-L526) | `ACTIVE` o `EXPIRED` | `ACTIVE` | Propiedad + estado + **cuota** ([:506](apps/api/src/modules/listings/listings.service.ts#L506)). **Preserva `publishedAt`** ([:513-515](apps/api/src/modules/listings/listings.service.ts#L513-L515)) y recalcula `expiresAt` desde ahora. **No revalida nada más** |
| `reserve` | [:528-541](apps/api/src/modules/listings/listings.service.ts#L528-L541) | `ACTIVE` | `RESERVED` | Propiedad + estado. Nada más |
| `pause` | [:552-565](apps/api/src/modules/listings/listings.service.ts#L552-L565) | `ACTIVE` | `PAUSED` | Propiedad + estado. **Sin cuota a propósito** (salir de ACTIVE siempre libera) |
| `reactivate` | [:575-594](apps/api/src/modules/listings/listings.service.ts#L575-L594) | `PAUSED` | `ACTIVE` | Propiedad + estado + **cuota** ([:581](apps/api/src/modules/listings/listings.service.ts#L581)). Recalcula `expiresAt`. **No revalida atributos ni categoría** |
| `archive` | [:614-629](apps/api/src/modules/listings/listings.service.ts#L614-L629) | `ACTIVE`, `PAUSED`, `SOLD`, `EXPIRED`, `REJECTED` ([:606-612](apps/api/src/modules/listings/listings.service.ts#L606-L612)) | `ARCHIVED` | Propiedad + estado. **Irreversible** |
| `closeDeal` | [:639-734](apps/api/src/modules/listings/listings.service.ts#L639-L734) | `ACTIVE` o `RESERVED` | `SOLD` (PRODUCT) / `ACTIVE` (SERVICE) | Propiedad + estado + comprador obligatorio en servicios + no-tú-mismo |
| `undoDeal` | [:743-763](apps/api/src/modules/listings/listings.service.ts#L743-L763) | — | `SOLD` → `ACTIVE` | Propiedad + trato existe + ventana 72 h. **⚠ NO comprueba cuota** al volver a ACTIVE |
| `remove` | [:836-841](apps/api/src/modules/listings/listings.service.ts#L836-L841) | cualquiera | borrado FÍSICO | **Solo propiedad**. Sin guarda de estado |

### `ModerationService` — [moderation.service.ts](apps/api/src/modules/moderation/moderation.service.ts)

| Método | Línea | Origen exigido | Destino | Qué valida |
|---|---|---|---|---|
| `approveListing` | [:224-258](apps/api/src/modules/moderation/moderation.service.ts#L224-L258) | `PENDING_REVIEW` | `ACTIVE` | Solo el estado. **⚠ NO comprueba cuota** |
| `rejectListing` | [:260-296](apps/api/src/modules/moderation/moderation.service.ts#L260-L296) | `PENDING_REVIEW` | `REJECTED` | Solo el estado |
| `deactivateListing` | [:298-338](apps/api/src/modules/moderation/moderation.service.ts#L298-L338) | `ACTIVE` | `REJECTED` | Solo el estado. Encola `remove` **directamente**, sin pasar por `ListingActivationService` |
| `restoreListing` | [:340-379](apps/api/src/modules/moderation/moderation.service.ts#L340-L379) | `REJECTED` | `ACTIVE` | Solo el estado. **⚠ NO comprueba cuota** |

### `AdminService`

| Método | Línea | Origen | Destino | Qué valida |
|---|---|---|---|---|
| `changeListingStatus` | [admin.service.ts:256-302](apps/api/src/modules/admin/admin.service.ts#L256-L302) | **cualquiera** | **cualquiera** (`ChangeListingStatusDto`) | **⚠ NADA**. Ni máquina de estados, ni cuota, ni validez del anuncio. Fija `publishedAt`/`expiresAt` si va a ACTIVE y gestiona caché+índice a mano |

### Crons

| Servicio | Línea | Transición | Notas |
|---|---|---|---|
| `ExpirationService.expireListings` | [expiration.service.ts:24-48](apps/api/src/modules/expiration/expiration.service.ts#L24-L48) | `ACTIVE` + `expiresAt <= now` → `EXPIRED` | Diario 02:00. Solo consulta `status: 'ACTIVE'` — por eso `PAUSED` queda invisible por construcción. `RESERVED` excluido a propósito ([:22-23](apps/api/src/modules/expiration/expiration.service.ts#L22-L23)) |
| `EntitlementExpirationService.downgradeExpiredPro` | [entitlement-expiration.service.ts:106-193](apps/api/src/modules/expiration/entitlement-expiration.service.ts#L106-L193) | `ACTIVE` → `DRAFT` (los más antiguos que excedan el límite free) | Diario 03:00, con 7 días de gracia ([:13](apps/api/src/modules/expiration/entitlement-expiration.service.ts#L13)). Lee `freeActiveListingLimit` ([:123-126](apps/api/src/modules/expiration/entitlement-expiration.service.ts#L123-L126)). Idempotente |
| `EntitlementExpirationService.expireFeaturedListings` | [:50-100](apps/api/src/modules/expiration/entitlement-expiration.service.ts#L50-L100) | No cambia el estado — revoca el entitlement y reindexa (`boostScore → 0`) | — |

### `BillingService` — bump y destacado

| Método | Línea | Qué valida antes de cobrar |
|---|---|---|
| `bump` | [billing.service.ts:580-599](apps/api/src/modules/billing/billing.service.ts#L580-L599) | Anuncio existe · es tuyo · `status === ACTIVE`. Después, el **cooldown se RECLAMA** con un `UPDATE` condicional dentro de la transacción ([:616-663](apps/api/src/modules/billing/billing.service.ts#L616-L663)) — no se lee `bumpedAt` fuera. **NO valida la validez del anuncio** (atributos, categoría, fotos): solo estado y propiedad, y cobra |
| `grantFeaturedListingTx` | [:311-327](apps/api/src/modules/billing/billing.service.ts#L311-L327) | Existe · es tuyo · `ACTIVE` · sin destacado vigente |
| `assertFeaturable` | [:370-401](apps/api/src/modules/billing/billing.service.ts#L370-L401) | Lo mismo, compartido por los dos caminos de destacado |
| `BumpScheduleService` (bump automático) | [bump-schedule.service.ts:93-100](apps/api/src/modules/bump-schedule/bump-schedule.service.ts#L93-L100) | Selecciona programaciones `ACTIVE` con `nextRunAt <= now`; la validación del anuncio la hace `BillingService.bump` |

## 2.3 Diagrama de transiciones (estado real)

```
                    create()          publish()  [badWords?]
        ─────────────────────► DRAFT ──────┬──────────────► PENDING_REVIEW
                                  ▲        │                   │      │
      downgrade Pro (cron 03:00)  │        │ (limpio)   approve│      │reject
                                  │        │            +cuota✗│      │
                                  │        ▼                   ▼      ▼
                                  └──── ACTIVE ◄───────────────┘   REJECTED
                                     ▲  │ │ │ │ ▲                     │
              renew() +cuota✓ ───────┘  │ │ │ │ └── restore() +cuota✗ ┘
              (desde ACTIVE|EXPIRED)    │ │ │ │
                                        │ │ │ └──── deactivate() ──► REJECTED
              reactivate() +cuota✓      │ │ │
              PAUSED ──────────────────►│ │ │
                    ▲                   │ │ └────► RESERVED ──┐
                    └── pause() ────────┘ │            │      │
                                          │            │ closeDeal()
                        expira (cron 02:00)            ▼      ▼
                                          └──────► EXPIRED   SOLD
                                                     │        │
                                                     │        └── undoDeal() +cuota✗ ──► ACTIVE
                                                     │            (ventana 72 h)
   archive() desde {ACTIVE,PAUSED,SOLD,EXPIRED,REJECTED} ──────► ARCHIVED  (irreversible)
   remove()  desde cualquier estado ──────────────────────────► (borrado físico)
   AdminService.changeListingStatus: CUALQUIERA ──► CUALQUIERA (sin guarda alguna)
```

`+cuota✓` = comprueba `checkActiveListingLimit`. `+cuota✗` = **no la comprueba**.

## 2.4 ¿Existe una puerta de validación común? — **NO**

### Lo que hay

**`checkActiveListingLimit`** — [listings.service.ts:1511-1528](apps/api/src/modules/listings/listings.service.ts#L1511-L1528)

```
private async checkActiveListingLimit(userId: string): Promise<void>
```

- Es **`private`** de `ListingsService`. Ningún otro módulo puede llamarla.
- Llamantes: **exactamente 3** — [publish:473](apps/api/src/modules/listings/listings.service.ts#L473),
  [renew:506](apps/api/src/modules/listings/listings.service.ts#L506),
  [reactivate:581](apps/api/src/modules/listings/listings.service.ts#L581).
- Lee el Setting según sea Pro o no, con fallbacks **hardcodeados** `20`/`5` ([:1513-1517](apps/api/src/modules/listings/listings.service.ts#L1513-L1517)).
- Lanza `ForbiddenException` (403) — coincide con lo que dice `estado-tecnico.md`.

**`ListingActivationService.listingBecameActive`** — [listing-activation.service.ts:33-40](apps/api/src/modules/listing-activation/listing-activation.service.ts#L33-L40)

Su comentario dice *"Called by every path that transitions a Listing to ACTIVE (publish, approveListing, restoreListing, renew). Single hook point…"*. Verificado:

| Camino a `ACTIVE` | ¿Llama `listingBecameActive`? |
|---|---|
| `publish` (rama ACTIVE) | ✅ [:490](apps/api/src/modules/listings/listings.service.ts#L490) |
| `renew` | ✅ [:524](apps/api/src/modules/listings/listings.service.ts#L524) |
| `reactivate` | ✅ [:592](apps/api/src/modules/listings/listings.service.ts#L592) |
| `approveListing` | ✅ [moderation.service.ts:245](apps/api/src/modules/moderation/moderation.service.ts#L245) |
| `restoreListing` | ✅ [moderation.service.ts:361](apps/api/src/modules/moderation/moderation.service.ts#L361) |
| `closeDeal` (SERVICE se queda ACTIVE) | ❌ usa `invalidateAndReindex` [:732](apps/api/src/modules/listings/listings.service.ts#L732) |
| `undoDeal` (SOLD → ACTIVE) | ❌ usa `invalidateAndReindex` [:761](apps/api/src/modules/listings/listings.service.ts#L761) |
| `AdminService.changeListingStatus` | ❌ encola `index` a mano [admin.service.ts:283-289](apps/api/src/modules/admin/admin.service.ts#L283-L289) |

**Y en cualquier caso no valida: invalida caché y encola trabajo.** No es una puerta.

### Lo que NO hay

- ❌ Ninguna función `validateListing(listing)` / `assertPublishable(...)` / `canGoActive(...)` en todo el repositorio.
- ❌ Ninguna máquina de estados declarativa (tabla de transiciones permitidas).
- ❌ Ningún guard de NestJS sobre las transiciones — solo `JwtAuthGuard` en todas las rutas de `/listings` ([listings.controller.ts](apps/api/src/modules/listings/listings.controller.ts), verificadas las 20 rutas).
- ❌ Ningún interceptor/middleware de validación de anuncio.

**La validación de contenido del anuncio (atributos, categoría, precio, tags) vive
EXCLUSIVAMENTE en `create()` y `update()`.** Ninguna transición de estado la reejecuta. Un
anuncio creado en 2026-01 con atributos válidos entonces se puede `publish` → `pause` →
`reactivate` → `renew` indefinidamente sin que nadie vuelva a mirar si sigue cumpliendo el
schema de su categoría.

## 2.5 Los caminos a `ACTIVE` que saltan la cuota (hallazgo)

| Camino | Fichero:línea | Estado |
|---|---|---|
| `ModerationService.approveListing` | [moderation.service.ts:236-243](apps/api/src/modules/moderation/moderation.service.ts#L236-L243) | Sin `checkActiveListingLimit` |
| `ModerationService.restoreListing` | [moderation.service.ts:352-359](apps/api/src/modules/moderation/moderation.service.ts#L352-L359) | Sin `checkActiveListingLimit` |
| `ListingsService.undoDeal` (SOLD → ACTIVE) | [listings.service.ts:753-759](apps/api/src/modules/listings/listings.service.ts#L753-L759) | Sin `checkActiveListingLimit` |
| `AdminService.changeListingStatus` | [admin.service.ts:270-280](apps/api/src/modules/admin/admin.service.ts#L270-L280) | Sin ninguna comprobación |

*(Los dos de moderación y el de admin son acciones de staff, así que puede ser deliberado —
pero no hay comentario que lo diga. `undoDeal` es una acción del vendedor.)*

## 2.6 La VALIDACIÓN de atributos contra el schema de la categoría

**Dónde vive:** cuatro métodos privados de `ListingsService`. **Solo** se ejecutan en `create()` y `update()`.

| Función | Línea | Qué comprueba |
|---|---|---|
| `validateRequired` | [:1327-1339](apps/api/src/modules/listings/listings.service.ts#L1327-L1339) | Presencia de las claves `required`. `422 Atributos requeridos faltantes` |
| `validateAttributeValues` | [:1352-1389](apps/api/src/modules/listings/listings.service.ts#L1352-L1389) | Claves **desconocidas** (`422 Atributos no reconocidos`) · opciones válidas de un `select` plano · tipo `number` · tipo `boolean`. `text` no se refuerza. Los `dependsOn` se saltan aquí |
| `validateLinkedSelects` | [:1434-1463](apps/api/src/modules/listings/listings.service.ts#L1434-L1463) | Un select vinculado debe resolver contra el valor actual de su padre (`optionsByParent`). Un nivel de vinculación, sin cadenas ([category.types.ts:32-38](apps/api/src/modules/categories/category.types.ts#L32-L38)) |
| `computeAttributesDelta` | [:1401-1415](apps/api/src/modules/listings/listings.service.ts#L1401-L1415) | Qué claves cambian de verdad en esta petición (comparación por `JSON.stringify`) |

**Filtro por tipo de anuncio antes de validar:** `filterSchemaByType`
([category.types.ts:81-86](apps/api/src/modules/categories/category.types.ts#L81-L86)) — un `required`
marcado solo para PRODUCT no bloquea un SERVICE. El comentario en
[listings.service.ts:192-195](apps/api/src/modules/listings/listings.service.ts#L192-L195) registra
que fue un bug real encontrado en verificación.

### El *grandfathering* — la clave del Bloque 3

**En `create()`** ([:196-214](apps/api/src/modules/listings/listings.service.ts#L196-L214)): se valida el bag **COMPLETO**. No hay "existing" con el que comparar.

**En `update()`** ([:299-348](apps/api/src/modules/listings/listings.service.ts#L299-L348)): asimetría deliberada, documentada en [:310-316](apps/api/src/modules/listings/listings.service.ts#L310-L316):

- `validateRequired` → sobre el bag **COMPLETO fusionado** (es un invariante de completitud del anuncio).
- `validateAttributeValues` → **solo sobre el DELTA**. Valores ya guardados que el usuario no toca **se toleran**.
- `validateLinkedSelects` → sobre el bag completo pero **acotado al delta** (`deltaKeys`).
- `validatePriceUnitAllowed` → solo si el usuario **toca** `priceUnit` **o** mueve el anuncio de categoría ([:342-348](apps/api/src/modules/listings/listings.service.ts#L342-L348)).
- `validateListingTypeAllowed` → solo si cambia `categoryId` ([:328-334](apps/api/src/modules/listings/listings.service.ts#L328-L334)).
- **Tags**: si el usuario manda `tags` → estricto (422); si solo cambia `categoryId` → los tags ajenos **se podan en silencio** ([:350-376](apps/api/src/modules/listings/listings.service.ts#L350-L376)).

**Traducción:** un anuncio con datos que ya no cumplen el schema de su categoría **se sigue
editando sin error** mientras el usuario no toque esas claves. Es el mecanismo que hoy sostiene
la desconexión del Bloque 3.

## 2.7 Otras validaciones del ciclo de vida

| Cosa | Dónde | Estado |
|---|---|---|
| Propiedad del anuncio | `assertOwnership` [listings.service.ts:1161](apps/api/src/modules/listings/listings.service.ts#L1161) — usado en 12 métodos | ✅ |
| Correo verificado antes de publicar | — | **NO EXISTE** (§4.4) |
| Nº mínimo de fotos para publicar | — | **NO EXISTE** (§4.5) |
| Nº máximo de fotos | `@ArrayMaxSize(15)` en el DTO (§4.5) | Parcial |
| Palabras prohibidas | [listings.service.ts:458-469](apps/api/src/modules/listings/listings.service.ts#L458-L469) — **fail-open** | Solo en `publish` |
| Slug único (con reintentos) | `createWithUniqueSlug` [:1301-1325](apps/api/src/modules/listings/listings.service.ts#L1301-L1325) | ✅ |
| Imágenes: propiedad y no-robadas | `linkImages` [:1530-1568](apps/api/src/modules/listings/listings.service.ts#L1530-L1568) | ✅ |
| Rate limit de «ver teléfono» | [:806-824](apps/api/src/modules/listings/listings.service.ts#L806-L824) | ✅ |

---

# BLOQUE 3 — El acoplamiento config de categorías ↔ anuncios existentes

## 3.0 Resumen

El acoplamiento es **asimétrico y con huecos concretos**. Hay guardas *serias* para tres cambios
de configuración (política producto/servicio, formatos de precio, topes de atributos en card) —
todas del molde «cuenta los afectados y devuelve un 400 con el número». Pero para lo que Ernest
pregunta —**renombrar, borrar o cambiar un atributo, o borrar una opción de un select**— **no hay
ninguna comprobación en el backend**: se guarda y los anuncios quedan como estén.

## 3.1 Qué pasa al EDITAR una categoría

### Guardas que SÍ existen (todas en `updateCategory`)

| Cambio | Guarda | Línea | Comportamiento |
|---|---|---|---|
| `allowedListingType` (hacia el padre) | `assertPolicyConsistentWithParent` | [admin.service.ts:740-754](apps/api/src/modules/admin/admin.service.ts#L740-L754) | 400 si contradice al padre |
| `allowedListingType` (hacia abajo) | `assertPolicyChangeDoesNotBreakChildren` | [:762-795](apps/api/src/modules/admin/admin.service.ts#L762-L795) | 400 si una hija ya está configurada al contrario · **cuenta anuncios del tipo prohibido** en la categoría + sus hijas y devuelve 400 con el número ([:787-793](apps/api/src/modules/admin/admin.service.ts#L787-L793)) |
| `allowedPriceUnits` | `assertPriceUnitsChangeDoesNotBreakListings` | [:823-850](apps/api/src/modules/admin/admin.service.ts#L823-L850) | **Cuenta anuncios con un `priceUnit` que quedaría fuera** (incluye hijas sin config propia) → 400. Vaciar la lista no valida nada (solo puede ampliar) |
| `cardAttribute` / `wideCardAttribute` (hacia arriba) | `validateCardAttributeLimitByType` | [:552-583](apps/api/src/modules/admin/admin.service.ts#L552-L583), [:650-655](apps/api/src/modules/admin/admin.service.ts#L650-L655) | Topes 2 y 6, **por tipo de anuncio** |
| `cardAttribute` (hacia abajo) | `assertCardAttributeChangeDoesNotBreakChildren` | [:672-702](apps/api/src/modules/admin/admin.service.ts#L672-L702) | Recalcula el efectivo de **cada hija directa** con el schema NUEVO del padre → 400 |
| Nombres `X_min`/`X_max` | `assertNoRangeSuffixCollision` | [:602-643](apps/api/src/modules/admin/admin.service.ts#L602-L643) | 400. Ámbito: propio + padre + hijas |
| `allowedViews`/`defaultView` | `validateViewsConfig` | [:714-731](apps/api/src/modules/admin/admin.service.ts#L714-L731) | Valida el estado FINAL. Vaciar `allowedViews` **auto-limpia** `defaultView` ([:1016-1019](apps/api/src/modules/admin/admin.service.ts#L1016-L1019)) |
| Slug de raíz | `assertRootSlugNotReserved` | [:893-900](apps/api/src/modules/admin/admin.service.ts#L893-L900) | 400 |

**Efecto colateral tras guardar el schema:** se encola `refresh-filterable-attributes`
([:1071-1073](apps/api/src/modules/admin/admin.service.ts#L1071-L1073) y [:953-955](apps/api/src/modules/admin/admin.service.ts#L953-L955)),
que recalcula los `filterableAttributes` de Meilisearch
([search.service.ts:302-317](apps/api/src/modules/search/search.service.ts#L302-L317)) e invalida la
memoización del resolver ([filterable-attributes.resolver.ts:147-149](apps/api/src/modules/search/filterable-attributes.resolver.ts#L147-L149)).
**Nota:** la invalidación es solo en memoria del proceso que la ejecuta — un despliegue
multi-instancia necesitaría pub/sub, y está documentado como fuera de alcance ([:143-145](apps/api/src/modules/search/filterable-attributes.resolver.ts#L143-L145)).
**Esto NO reindexa los anuncios** ni revalida ninguno.

### Los huecos — lo que NO se comprueba

| Cambio del admin | Comprobación en backend | Qué pasa con los anuncios existentes |
|---|---|---|
| **Renombrar** la `name` de un atributo | ❌ Ninguna | Los datos quedan bajo la clave VIEJA en `Listing.attributes`. **Huérfanos**: no se muestran (el schema ya no los conoce) y no se migran |
| **Borrar** un atributo | ❌ Ninguna | La clave sigue en `Listing.attributes`. Deja de mostrarse. Si el usuario reenvía esa clave en un `update`, salta `422 Atributos no reconocidos` ([listings.service.ts:1358-1363](apps/api/src/modules/listings/listings.service.ts#L1358-L1363)) |
| **Borrar/cambiar una opción** de un `select` | ❌ Ninguna | El anuncio conserva el valor. Solo se revalida si el usuario TOCA esa clave (delta) → entonces `422 "X" no es una opción válida de "Y"` |
| **Cambiar el `type`** de un atributo (p. ej. `text` → `number`) | ❌ Ninguna | Ídem: se revalida solo al tocar la clave |
| **Marcar `required`** un atributo nuevo | ❌ Ninguna | Los anuncios existentes siguen ACTIVOS sin él. Pero **cualquier `update` posterior falla** (`validateRequired` corre sobre el bag completo, [listings.service.ts:312](apps/api/src/modules/listings/listings.service.ts#L312)) — el anuncio queda **ineditable** hasta rellenarlo |
| **Cambiar `filterable`** | ❌ Ninguna (solo refresca Meili) | — |
| Reordenar atributos | ❌ N/A | — |

### Lo único que existe: un aviso INFORMATIVO al renombrar

**Backend — `getAttributeUsage`** ([admin.service.ts:1114-1125](apps/api/src/modules/admin/admin.service.ts#L1114-L1125)):

```sql
SELECT COUNT(*) FROM "Listing" WHERE "categoryId" = $1 AND "attributes" ? $2
```

Operador jsonb `?` = existencia de clave de nivel superior. Su propio comentario dice:
*"Usado por el editor de atributos para avisar antes de renombrar una key con datos existentes
(**no migra nada, solo informa**)"* ([:1110-1113](apps/api/src/modules/admin/admin.service.ts#L1110-L1113)).

**Frontend — `AttributeSchemaEditor.commitDraft`** ([AttributeSchemaEditor.tsx:439-460](apps/web/src/components/admin/AttributeSchemaEditor.tsx#L439-L460)):

- Solo se dispara **al RENOMBRAR** una fila existente (`isRename`).
- `window.confirm(...)`: *"N anuncio(s) tienen datos bajo la clave 'X'. Al renombrarla a 'Y', esos datos quedarán huérfanos (no se muestran ni se migran). ¿Continuar?"*
- **Fail-open**: si la consulta falla, `count = 0` y no bloquea ([:447-448](apps/web/src/components/admin/AttributeSchemaEditor.tsx#L447-L448)).
- Es **puramente cliente**: una llamada directa a `PATCH /admin/categories/:id` no lo ve.

**Al BORRAR un atributo** — `confirmDelete` ([AttributeSchemaEditor.tsx:479-485](apps/web/src/components/admin/AttributeSchemaEditor.tsx#L479-L485)):
un diálogo de confirmación genérico ("¿Eliminar X?", [:629](apps/web/src/components/admin/AttributeSchemaEditor.tsx#L629)),
**sin consultar el uso**. Filtra la fila y listo.

## 3.2 Qué pasa al BORRAR una categoría

**`deleteCategory`** — [admin.service.ts:1127-1172](apps/api/src/modules/admin/admin.service.ts#L1127-L1172)

Tres bloqueos, todos con **conteo exacto** y **400 legible**, en una sola transacción ([:1140-1144](apps/api/src/modules/admin/admin.service.ts#L1140-L1144)):

1. **Anuncios** — `count({ categoryId: id })` **sin filtrar por estado**. El comentario ([:1131-1136](apps/api/src/modules/admin/admin.service.ts#L1131-L1136)) explica por qué: la FK física es `RESTRICT` sobre *cualquier* `Listing`, así que filtrar por ACTIVE dejaría pasar el chequeo y el DELETE reventaría con un 500 de Postgres.
2. **Subcategorías** — `count({ parentId: id })`.
3. **Patrocinados** — `count({ categoryId: id })`, también `RESTRICT`.

Si pasa los tres: **borrado FÍSICO** ([:1162](apps/api/src/modules/admin/admin.service.ts#L1162)) + audit log. **No hay soft-delete ni desactivación de categorías.**

**Red de seguridad en la base de datos:**
- `Listing.categoryId` → `ON DELETE RESTRICT` ([init/migration.sql:237](apps/api/prisma/migrations/20260620100046_init/migration.sql#L237))
- `SponsoredAd.categoryId` → `ON DELETE RESTRICT` ([add_sponsored_ad/migration.sql:23](apps/api/prisma/migrations/20260710162508_add_sponsored_ad/migration.sql#L23))
- `Category.parentId` → **`ON DELETE SET NULL`** ([init/migration.sql:231](apps/api/prisma/migrations/20260620100046_init/migration.sql#L231)) — si el chequeo de hijas se saltara, las hijas se promocionarían a raíz en silencio
- `CategoryTag.categoryId` → `CASCADE` ([add_tags/migration.sql:44](apps/api/prisma/migrations/20260802021723_add_tags/migration.sql#L44))

### Contraste: los tags

Los `Tag` **no tienen DELETE**, solo desactivación ([schema.prisma:488-490](apps/api/prisma/schema.prisma#L488-L490)):
*"desactivar un tag deja de ofrecerlo y de filtrarlo, pero los anuncios que ya lo llevan conservan
su fila de `ListingTag` intacta"*. Y `ListingTag.tagId` es `onDelete: Restrict`
([schema.prisma:540-543](apps/api/prisma/schema.prisma#L540-L543)) como defensa estructural.
Además existe `TagsService.usage(id)` que devuelve `{ listingCount, categoryCount }`
([tags.service.ts:450-459](apps/api/src/modules/tags/tags.service.ts#L450-L459)) — **el sistema de
tags SÍ tiene un contador de uso; el de atributos solo tiene el `getAttributeUsage` puntual por clave**.

## 3.3 Cómo se almacenan los atributos de un anuncio

**`Listing.attributes Json @default("{}")`** — [schema.prisma:575-579](apps/api/prisma/schema.prisma#L575-L579).
`jsonb`, sin esquema en la base de datos, sin integridad referencial. El propio schema lo dice
([schema.prisma:483-484](apps/api/prisma/schema.prisma#L483-L484)): *"El bag Json de atributos no
[tiene integridad referencial] — por eso existe `validateAttributeValues`"*.

| Pregunta | Respuesta |
|---|---|
| ¿Se valida al guardar? | **Sí** en `create()` (completo) y `update()` (con el grandfathering de §2.6) |
| ¿Es JSON libre? | No en la puerta de escritura de la API. **Sí de facto** en la base de datos: nada impide un `UPDATE` directo, y el bag ya guardado nunca se re-audita |
| ¿Se revalida después? | **NUNCA**. Ni al publicar, ni al renovar, ni al reactivar, ni al bumpear, ni al destacar, ni al reindexar. No hay job ni comando de auditoría de atributos |
| ¿Se reindexa lo guardado? | Sí: `toDocument` hace `...attributes` primero, y los campos core se escriben después para que ningún atributo los pise ([search.service.ts:496-500](apps/api/src/modules/search/search.service.ts#L496-L500)) |
| ¿Qué llega a la card? | El resolver reconstruye el bag por nombre de atributo de la categoría ([filterable-attributes.resolver.ts:97-100](apps/api/src/modules/search/filterable-attributes.resolver.ts#L97-L100)) — una clave huérfana simplemente no aparece |

## 3.4 CONTADORES y elementos auxiliares por categoría

**Hallazgo: NO existe ningún contador de anuncios por categoría.**

Verificado exhaustivamente:
- `Category` **no tiene** `_count` en ninguna consulta del repositorio.
- `CategoriesService.findTree` ([categories.service.ts:22-143](apps/api/src/modules/categories/categories.service.ts#L22-L143)) **no devuelve ningún número**.
- `AdminService.getCategories` ([admin.service.ts:506-542](apps/api/src/modules/admin/admin.service.ts#L506-L542)) tampoco.
- El backoffice de categorías no muestra "N anuncios".

Los **únicos** conteos por categoría son guardas puntuales, calculadas al vuelo y descartadas:

| Conteo | Fichero:línea | Para qué |
|---|---|---|
| Anuncios (cualquier estado) | [admin.service.ts:1141](apps/api/src/modules/admin/admin.service.ts#L1141) | Bloquear el borrado de categoría |
| Subcategorías | [admin.service.ts:1142](apps/api/src/modules/admin/admin.service.ts#L1142) | Ídem |
| Patrocinados | [admin.service.ts:1143](apps/api/src/modules/admin/admin.service.ts#L1143) | Ídem |
| Anuncios del tipo prohibido | [admin.service.ts:787-789](apps/api/src/modules/admin/admin.service.ts#L787-L789) | Guarda de `allowedListingType` |
| Anuncios con `priceUnit` fuera | [admin.service.ts:842-844](apps/api/src/modules/admin/admin.service.ts#L842-L844) | Guarda de `allowedPriceUnits` |
| Anuncios con una clave concreta | [admin.service.ts:1118-1123](apps/api/src/modules/admin/admin.service.ts#L1118-L1123) | Aviso al renombrar un atributo |

**Lo que sí hay, y viene de Meilisearch, no de Postgres:** la distribución de facetas
(`facetDistribution`, [search.controller.ts:182](apps/api/src/modules/search/search.controller.ts#L182)),
con `categorySlug` como faceta nativa ([search.service.ts:140](apps/api/src/modules/search/search.service.ts#L140)).
Cuenta **solo anuncios ACTIVE indexados** y depende de los filtros de la consulta. **No asume nada
de la profundidad** — es un conteo por slug plano.

**Contadores globales del dashboard** (no por categoría): `AdminService.getStats`
([admin.service.ts:1293-1348](apps/api/src/modules/admin/admin.service.ts#L1293-L1348)) — activos,
pendientes de revisión, publicados hoy, usuarios, reportes pendientes, conversaciones, y stats de
Meili.

**Contadores por vendedor:** `findMine` con `groupBy` de estado
([listings.service.ts:1030, 1088-1098](apps/api/src/modules/listings/listings.service.ts#L1088-L1098)).

## 3.5 Resumen del acoplamiento actual

| Cambio en la categoría | Estado actual |
|---|---|
| Renombrar un atributo | 🔴 Silencioso — datos huérfanos. Aviso solo en la UI, fail-open |
| Borrar un atributo | 🔴 Silencioso — ni siquiera avisa |
| Borrar/cambiar opciones de un select | 🔴 Silencioso |
| Cambiar el tipo de un atributo | 🔴 Silencioso |
| Marcar `required` un atributo | 🔴 Silencioso — pero deja el anuncio ineditable |
| Cambiar `allowedListingType` | 🟢 Bloqueado con conteo exacto (hijas + anuncios) |
| Cambiar `allowedPriceUnits` | 🟢 Bloqueado con conteo exacto (anuncios, hijas incluidas) |
| Pasarse de topes de card | 🟢 Bloqueado en las dos direcciones (padre y hijas) |
| Borrar la categoría | 🟢 Bloqueado con conteo exacto + `RESTRICT` en la BD |
| Reindexado de anuncios tras un cambio de schema | 🔴 **No se hace** — solo se refrescan los `filterableAttributes` de Meili |

---

# BLOQUE 4 — Los ajustes configurables existentes (el molde)

## 4.1 El modelo `Setting`

**Fichero:** [schema.prisma:1037-1048](apps/api/prisma/schema.prisma#L1037-L1048)

```
model Setting {
  key         String   @id      // la clave ES la primary key
  value       Json              // el tipo concreto depende de la key
  updatedAt   DateTime @updatedAt
  updatedById String?           // admin que la tocó (null en el seed)
}
```

**Sin columna de tipo, sin validación en la BD, sin categoría/grupo.** Cada lector castea.

## 4.2 El molde completo, de punta a punta

### 1) Declarar la clave — `SETTING_KEYS`

[admin.service.ts:47-100](apps/api/src/modules/admin/admin.service.ts#L47-L100) — **20 claves**, con
un comentario por clave explicando qué es y por qué se siembra o no. Es un `as const`, y de él sale
el tipo `SettingKey` ([:101](apps/api/src/modules/admin/admin.service.ts#L101)).

Es la **única puerta**: `updateSetting` rechaza con 400 cualquier clave fuera de la lista ([:1216-1220](apps/api/src/modules/admin/admin.service.ts#L1216-L1220)).

### 2) Declarar el tipo de valor

| Lista | Línea | Regla |
|---|---|---|
| `POSITIVE_INT_SETTING_KEYS` | [:112-125](apps/api/src/modules/admin/admin.service.ts#L112-L125) | Entero ≥ 1 — validado en [:1222-1229](apps/api/src/modules/admin/admin.service.ts#L1222-L1229) |
| `PERCENT_SETTING_KEYS` | [:130](apps/api/src/modules/admin/admin.service.ts#L130) | Entero en [0, 100] — validado en [:1231-1238](apps/api/src/modules/admin/admin.service.ts#L1231-L1238) |
| (sin lista) | — | Cualquier JSON. `freeActiveListingLimit`/`proActiveListingLimit` **NO están en ninguna de las dos** — el backend aceptaría un `0`, un negativo o una cadena |

### 3) Decidir si se siembra

**Se siembran** en [seed.ts:445+](apps/api/prisma/seed.ts) con `createMany` + `skipDuplicates`
(para no pisar lo que el admin haya cambiado — [schema.prisma:1035-1036](apps/api/prisma/schema.prisma#L1035-L1036)).

**No se siembran** a propósito (el estado "sin configurar" es válido): `maxTagsPerListing`,
`supportEmail`, `ticketAutoCloseWindowDays`. Sus defaults viven en `SETTING_DEFAULTS`
([:140-144](apps/api/src/modules/admin/admin.service.ts#L140-L144)), que **importa las constantes,
nunca las copia** ([:132-137](apps/api/src/modules/admin/admin.service.ts#L132-L137)).

### 4) Leer el ajuste

**No hay servicio central de settings ni caché.** Cada consumidor hace su propio
`prisma.setting.findUnique` con su propio fallback:

| Consumidor | Línea | Clave | Fallback |
|---|---|---|---|
| `ListingsService.checkActiveListingLimit` | [:1516-1517](apps/api/src/modules/listings/listings.service.ts#L1516-L1517) | `freeActiveListingLimit` / `proActiveListingLimit` | **`5` / `20` hardcodeados** ([:1514](apps/api/src/modules/listings/listings.service.ts#L1514)) |
| `EntitlementExpirationService` | [:123-126](apps/api/src/modules/expiration/entitlement-expiration.service.ts#L123-L126) | `freeActiveListingLimit` | **`DEFAULT_FREE_LIMIT = 5`** ([:16](apps/api/src/modules/expiration/entitlement-expiration.service.ts#L16)) — **fallback DUPLICADO** con el anterior |
| `TagsService.getMaxTagsPerListing` | [:263-269](apps/api/src/modules/tags/tags.service.ts#L263-L269) | `maxTagsPerListing` | `DEFAULT_MAX_TAGS_PER_LISTING` (constante importada) |
| `BillingService.bump` | [:601-604](apps/api/src/modules/billing/billing.service.ts#L601-L604) | `bumpCreditCost` | `5` |
| `BillingService.getQuotaFeaturedDurationDays` | [:403-408](apps/api/src/modules/billing/billing.service.ts#L403-L408) | `proQuotaFeaturedDurationDays` | `7` |
| `BadWordService.hasBadWords` | [:19-24](apps/api/src/modules/moderation/bad-word.service.ts#L19-L24) | `badWordList` | `false` (fail-open) |
| `VideoService` | `VIDEO_ENABLED_SETTING` [video-limits.ts:46](apps/api/src/modules/video/video-limits.ts#L46) | `videoEnabled` | **Apagado sin fila** (a propósito: cuesta almacenamiento) |

**El molde de la lectura es siempre el mismo:** `findUnique` → `Number(value)` / cast →
`?? CONSTANTE_POR_DEFECTO`. Sin caché: **cada llamada a `publish` hace una consulta a `Setting`**.

### 5) Servir al backoffice — `getSettings`

[admin.service.ts:1191-1208](apps/api/src/modules/admin/admin.service.ts#L1191-L1208)

**Toda clave del whitelist sale, tenga fila o no.** Las que no la tienen salen con su default y
`configured: false`, `updatedAt: null`. Documentado en [:1178-1190](apps/api/src/modules/admin/admin.service.ts#L1178-L1190):
antes solo salían las filas existentes y las tres claves sin sembrar eran **invisibles** en el editor.

### 6) Escribir — `updateSetting`

[admin.service.ts:1210-1287](apps/api/src/modules/admin/admin.service.ts#L1210-L1287)

Orden: **whitelist → validación por tipo → `upsert` + audit log en UNA transacción**.
Es `upsert` y no `update` porque con `findUnique` + 404 las claves sin sembrar eran ineditables
para siempre (catch-22, documentado en [:1240-1249](apps/api/src/modules/admin/admin.service.ts#L1240-L1249)).

### 7) La UI — `/admin/ajustes`

[apps/web/src/app/(admin)/admin/ajustes/page.tsx](apps/web/src/app/(admin)/admin/ajustes/page.tsx)

- `SETTING_TITLES` [:332-346](apps/web/src/app/(admin)/admin/ajustes/page.tsx#L332-L346) — etiqueta en español.
- `SETTING_DESCRIPTIONS` [:348+](apps/web/src/app/(admin)/admin/ajustes/page.tsx#L348) — párrafo explicativo largo por clave.
- `MONETIZATION_SETTING_KEYS` [:382+](apps/web/src/app/(admin)/admin/ajustes/page.tsx#L382) — agrupación aparte.
- El editor por clave se adapta al tipo (booleano → switch, [:253](apps/web/src/app/(admin)/admin/ajustes/page.tsx#L253); lista → `PriceListEditor`).

**Checklist real para un Setting nuevo:** (1) añadir a `SETTING_KEYS`; (2) si es entero/porcentaje,
añadir a la lista de validación; (3) decidir si se siembra o va a `SETTING_DEFAULTS`; (4) escribir
el lector con su constante de fallback; (5) añadir título y descripción en la UI. **Cinco sitios,
tres ficheros.**

## 4.3 El límite de activos (free 5 / pro 20) — el molde directo

| Pieza | Fichero:línea |
|---|---|
| Claves declaradas | [admin.service.ts:52-53](apps/api/src/modules/admin/admin.service.ts#L52-L53) |
| Sembradas | [seed.ts:445+](apps/api/prisma/seed.ts) |
| **Validación de tipo** | ❌ **NO están en `POSITIVE_INT_SETTING_KEYS` ni en `PERCENT_SETTING_KEYS`** |
| Lectura + aplicación | [listings.service.ts:1511-1528](apps/api/src/modules/listings/listings.service.ts#L1511-L1528) |
| Segunda lectura (cron) | [entitlement-expiration.service.ts:123-126](apps/api/src/modules/expiration/entitlement-expiration.service.ts#L123-L126) |
| ¿Pro o no? | `EntitlementService.isProActive(userId)` ([listings.service.ts:1512](apps/api/src/modules/listings/listings.service.ts#L1512)) |
| Qué cuenta | `count({ sellerId, status: 'ACTIVE' })` — **solo ACTIVE**, ningún otro estado ([:1519-1521](apps/api/src/modules/listings/listings.service.ts#L1519-L1521)) |
| Error | `403 ForbiddenException` — *"Has alcanzado el límite de N anuncios activos de tu plan"* |
| Dónde se aplica | `publish` · `renew` · `reactivate` — **y en ningún otro sitio** (§2.5) |
| UI | [ajustes/page.tsx:336-337](apps/web/src/app/(admin)/admin/ajustes/page.tsx#L336-L337) + descripciones |

**Molde de un «límite total» nuevo:** el patrón está completo y probado, pero hay dos cosas que
copiar mal sería fácil: (a) el fallback está **duplicado** en dos servicios; (b) estas dos claves
**no tienen validación de tipo** en el backend.

## 4.4 El CORREO VERIFICADO

**Hallazgo: `emailVerified` existe como dato, pero NO es una puerta en ningún sitio.**

| Dónde aparece | Fichero:línea | Qué hace |
|---|---|---|
| Se marca al verificar | [auth.service.ts:276](apps/api/src/modules/auth/auth.service.ts#L276) | `data: { emailVerified: true }` |
| Se marca vía OAuth | [auth.service.ts:441, 460](apps/api/src/modules/auth/auth.service.ts#L441) | Solo si el proveedor lo verificó criptográficamente ([:424, 447](apps/api/src/modules/auth/auth.service.ts#L424)) |
| Llega al request | [jwt.strategy.ts:45-50](apps/api/src/modules/auth/strategies/jwt.strategy.ts#L45-L50) | Leído **fresco de la BD** en cada petición, no del token |
| Se muestra al usuario | [perfil/page.tsx:42](apps/web/src/app/(account)/perfil/page.tsx#L42) | Aviso «verifica tu correo» |
| Lo ve el admin | [admin.service.ts:333, 356](apps/api/src/modules/admin/admin.service.ts#L333) | Solo lectura |

**Guards disponibles:** [common/guards/](apps/api/src/common/guards/) contiene exactamente tres —
`jwt-auth.guard.ts`, `optional-jwt-auth.guard.ts`, `roles.guard.ts`. **No hay `EmailVerifiedGuard`.**

**Verificado:** ninguna ruta de `/listings` lo comprueba (las 20 rutas de
[listings.controller.ts](apps/api/src/modules/listings/listings.controller.ts) usan `JwtAuthGuard`
a secas). `publish()` no lo mira. `ContactService` tampoco
([contact.service.ts](apps/api/src/modules/contact/contact.service.ts) — solo tiene una trampa
temporal anti-bot, [:80](apps/api/src/modules/contact/contact.service.ts#L80)).

### ⚠ El Setting `contactRequiresVerification` está MUERTO

- Declarado: [admin.service.ts:50](apps/api/src/modules/admin/admin.service.ts#L50)
- Sembrado con valor `true`: [seed.ts:454](apps/api/prisma/seed.ts#L454) y [seed-test.ts:83](apps/api/prisma/seed-test.ts#L83)
- Documentado en la UI: [ajustes/page.tsx:335, 353-354](apps/web/src/app/(admin)/admin/ajustes/page.tsx#L335) — *"Controla si los usuarios necesitan tener el email verificado para poder contactar con vendedores"*
- **Lectores en `apps/api/src`: CERO.** Verificado con grep sobre todo el backend. El editor lo muestra, el admin lo puede cambiar, y no hace absolutamente nada.

### ⚠ El Setting `listingExpiryDays` también está MUERTO

- Declarado: [admin.service.ts:49](apps/api/src/modules/admin/admin.service.ts#L49). Sembrado con `60`: [seed.ts:453](apps/api/prisma/seed.ts#L453). Descrito en la UI: [ajustes/page.tsx:334, 351-352](apps/web/src/app/(admin)/admin/ajustes/page.tsx#L334).
- **`ExpirationService` usa una constante hardcodeada:** `const EXPIRY_DAYS = 60` ([expiration.service.ts:9](apps/api/src/modules/expiration/expiration.service.ts#L9)), consumida por `ExpirationService.expiresAt()` ([:50-52](apps/api/src/modules/expiration/expiration.service.ts#L50-L52)), que es el método que llaman **publish, renew, reactivate, approveListing, restoreListing y changeListingStatus**.
- **Lectores del Setting: CERO.** Cambiar el ajuste en el backoffice no cambia nada. El valor coincide por casualidad, así que el síntoma es invisible hasta que alguien lo toque.
- (Referencia cruzada: [tickets.constants.ts:29](apps/api/src/modules/tickets/tickets.constants.ts#L29) menciona *"mismo camino que siguió `listingExpiryDays`"* como precedente de constante-que-luego-se-migra-a-Setting.)

## 4.5 El límite de FOTOS

**No hay un Setting.** Lo que hay:

| Límite | Dónde | Qué es exactamente |
|---|---|---|
| **15 ids por petición** | [create-listing.dto.ts:106-110](apps/api/src/modules/listings/dto/create-listing.dto.ts#L106-L110) y [update-listing.dto.ts:109-113](apps/api/src/modules/listings/dto/update-listing.dto.ts#L109-L113) — `@ArrayMaxSize(15)` | Tope del array `imageIds` de **una** petición. Como `update` **reemplaza** el set completo (desvincula las que no vengan, [listings.service.ts:426-429](apps/api/src/modules/listings/listings.service.ts#L426-L429)), en la práctica funciona como tope por anuncio **por la vía del cliente oficial**. Hardcodeado en el decorador |
| **15 en la UI** | `MAX_PHOTOS = 15` [StepFotos.tsx:24](apps/web/src/components/publicar/steps/StepFotos.tsx#L24) | Constante **duplicada** en el frontend, sin relación con el DTO |
| **10 MB por fichero** | `MAX_FILE_SIZE` [media.service.ts:17](apps/api/src/modules/media/media.service.ts#L17) | **Tamaño**, no cantidad |
| **Mínimo de fotos** | — | **NO EXISTE.** [StepFotos.tsx:135-136](apps/web/src/components/publicar/steps/StepFotos.tsx#L135-L136) dice *"Para publicar se necesita al menos 1 foto"*, pero **es solo texto**: `validateStep('fotos')` ([PublicarWizard.tsx:90-94](apps/web/src/components/publicar/PublicarWizard.tsx#L90-L94)) solo comprueba que no queden subidas en curso, y `publish()` en el backend no mira las imágenes |

**Contraste — el molde de vídeo:** los límites de vídeo viven en un fichero propio,
[video-limits.ts](apps/api/src/modules/video/video-limits.ts), como **fuente única** que la API
publica para que el cliente valide antes de subir (`VIDEO_LIMITS`, [:59+](apps/api/src/modules/video/video-limits.ts#L59)),
con la frontera cliente/servidor documentada ([:20-29](apps/api/src/modules/video/video-limits.ts#L20-L29))
y el interruptor de feature como Setting (`videoEnabled`, [:46](apps/api/src/modules/video/video-limits.ts#L46)).
**Las fotos no tienen equivalente**: su 15 está en dos decoradores y una constante de React.

## 4.6 La MODERACIÓN existente

**Hallazgo: hoy NO hay revisión previa a la publicación. Solo hay un filtro de palabras y
moderación reactiva.**

### Lo que hace el módulo Moderation

**Reportes (post-publicación)** — [moderation.service.ts:40-218](apps/api/src/modules/moderation/moderation.service.ts#L40-L218):
`createReport` (sobre anuncio, usuario o valoración), `listReports`, `getReport`, `startReview`,
`resolveReport`, `dismissReport`. Modelo `Report` con `ReportStatus`. Notificaciones al denunciante
al cerrar ([moderation-notifications.service.ts](apps/api/src/modules/moderation/moderation-notifications.service.ts)).

**Acciones sobre anuncios** — [:224-379](apps/api/src/modules/moderation/moderation.service.ts#L224-L379):
`approveListing`, `rejectListing` (ambos exigen `PENDING_REVIEW`), `deactivateListing` (retirada
post-publicación desde `ACTIVE`), `restoreListing`.

**Acciones sobre valoraciones** — `deleteReview` [:385-406](apps/api/src/modules/moderation/moderation.service.ts#L385-L406).

### El ÚNICO camino a `PENDING_REVIEW`

**`ListingsService.publish`** — [listings.service.ts:458-469](apps/api/src/modules/listings/listings.service.ts#L458-L469)

```
let targetStatus: 'ACTIVE' | 'PENDING_REVIEW' = 'ACTIVE';
try {
  const flagged = await this.badWordService.hasBadWords(existing.title, existing.description);
  if (flagged) targetStatus = 'PENDING_REVIEW';
} catch (_err) { /* Silent fallback — publication continues normally. */ }
```

`BadWordService` — [bad-word.service.ts:17-35](apps/api/src/modules/moderation/bad-word.service.ts#L17-L35):
normaliza (quita tildes, minúsculas), tokeniza título+descripción por no-alfanuméricos, y busca
coincidencia **exacta de token** contra `badWordList`.

**Contrato de fallo declarado** ([bad-word.service.ts:6-9](apps/api/src/modules/moderation/bad-word.service.ts#L6-L9)):
*"if the list is absent, empty, or the service throws for any reason, `hasBadWords()` returns false
and publication continues normally → ACTIVE. **Moderation must never block the publish flow.**"*

### Lo que NO existe

- ❌ Ningún ajuste tipo `requireModerationForAll` / `moderationEnabled`.
- ❌ Ninguna forma de que TODOS los anuncios pasen por revisión (`PENDING_REVIEW` solo se alcanza si una palabra de la lista coincide).
- ❌ Ninguna revisión previa por categoría, por vendedor nuevo, o por cualquier otro criterio.
- ❌ Ninguna cola de moderación *previa* — la cola existente es la de `PENDING_REVIEW`, alimentada solo por el filtro de palabras.
- ❌ Ninguna revisión al **editar** un anuncio ya activo: `update()` **no pasa por `BadWordService`**. Un anuncio se publica limpio y luego se edita metiendo lo que sea, sin filtro.

**Lo visible en el backoffice:** el contador `listingsPendingReview` del dashboard
([admin.service.ts:1307](apps/api/src/modules/admin/admin.service.ts#L1307)) y el filtro por
`status` en `/admin/anuncios` ([admin.service.ts:186-192](apps/api/src/modules/admin/admin.service.ts#L186-L192)).

**Nota de flujo:** un `PENDING_REVIEW` **no tiene `expiresAt`** — se le pone al aprobarlo
([listings.service.ts:482-485](apps/api/src/modules/listings/listings.service.ts#L482-L485) y
[moderation.service.ts:241](apps/api/src/modules/moderation/moderation.service.ts#L241)). Y
`approveListing` **no comprueba la cuota de activos** (§2.5).

---

# Apéndice — Lo que NO se encontró (hallazgos negativos)

Cada uno de estos se buscó explícitamente y **no existe** en el código:

1. Columna `path`, `level` o `depth` en `Category`.
2. Constraint de base de datos que limite la profundidad del árbol.
3. Constante `MAX_CATEGORY_DEPTH` (existe `NAV_MAX_DEPTH` para el menú, otro árbol).
4. Cualquier función que recorra ancestros de categoría (`while (parent)`, recursión, CTE).
5. Endpoint o DTO para **mover** una categoría de padre.
6. Puerta de validación común del anuncio (`validateListing`, `assertPublishable`…).
7. Máquina de estados declarativa del `ListingStatus`.
8. Revalidación de atributos en cualquier transición de estado.
9. Comprobación al **borrar** un atributo de categoría (la de renombrar es solo un aviso de cliente).
10. Comprobación al borrar/cambiar **opciones** de un `select`.
11. Job o comando de auditoría/migración de `Listing.attributes`.
12. Reindexado de los anuncios de una categoría tras cambiar su `attributeSchema`.
13. Contador de anuncios por categoría (en la API o en el backoffice).
14. Guard de correo verificado (`EmailVerifiedGuard`), ni comprobación de `emailVerified` en publicar/contactar.
15. Setting o mecanismo de **moderación previa** de todos los anuncios.
16. Filtro de palabras al **editar** un anuncio (solo al publicar).
17. Setting para el número de fotos, ni mínimo de fotos exigido en ningún sitio.
18. Servicio central de lectura de `Setting`, ni caché de settings.
19. Soft-delete o desactivación de categorías.

**Y dos ajustes que existen pero no hacen nada:** `contactRequiresVerification` y
`listingExpiryDays` — declarados, sembrados, editables y documentados en el backoffice, con **cero
lectores** en el backend (§4.4).
