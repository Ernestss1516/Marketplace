# Diseño — Ajustes al sistema de búsqueda + sistema de TAGS

> Documento de diseño **para aprobar** (2026-08-01). Recoge la auditoría del código real y
> el diseño propuesto. **Nada de esto está implementado todavía.**
>
> **Bloque A — Búsqueda (3 ajustes):**
> 1. Unificar búsqueda: elegir categoría en `/busqueda` lleva a la ruta de categoría
>    (y el tránsito inverso), preservando filtros.
> 2. URLs **anidadas** de categoría (`/vehiculos/coches`) con redirects de las viejas.
> 3. Confirmar que los filtros muestran **todos** los campos filtrables según config.
>
> **Bloque B — Tags:** sistema nuevo e independiente, hermano del de atributos.
>
> **Requisito de oro:** lo que ya funciona sigue funcionando. Se extiende, no se rehace.

---

## 0. Resumen ejecutivo de la auditoría

Cinco hallazgos condicionan todo el diseño:

| # | Hallazgo | Impacto |
|---|---|---|
| **H1** | El árbol de categorías es **estrictamente de 2 niveles**, garantizado en el backend por `assertParentIsRoot` ([admin.service.ts:748](apps/api/src/modules/admin/admin.service.ts#L748)) y asumido por *toda* la resolución de herencia. | El catch-all de rutas nunca tendrá que manejar 3+ segmentos. Simplifica muchísimo el ajuste 2. |
| **H2** | `GET /categories/:slug` **no devuelve el padre** ([categories.service.ts:76-159](apps/api/src/modules/categories/categories.service.ts#L76)) y `SELECT_DETAIL` del anuncio tampoco ([listings.service.ts:63](apps/api/src/modules/listings/listings.service.ts#L63)). | Por eso los breadcrumbs no reflejan el padre: **el dato no llega**, no es un olvido de la vista. Es un cambio de backend obligatorio para el ajuste 2. |
| **H3** | Solo hay **8 generadores** de URL de categoría en todo el front, y ninguno en el backend (ningún `revalidatePath` de categoría). | El radio del ajuste 2 es acotado y enumerable (§3.1.4). |
| **H4** | El backend **ya** ofrece como faceta *todos* los atributos filtrables de la categoría en scope ([search.controller.ts:81](apps/api/src/modules/search/search.controller.ts#L81)). El hueco del ajuste 3 está **entero en el frontend**: `FilterPanel` pinta las facetas a ciegas, sin el `AttributeField` que las define. | El ajuste 3 no toca la resolución de filtrables. Es un cambio de presentación + un DTO que se enriquece. |
| **H5** | El buscador de portada **no tiene sugerencia de ningún tipo**: es un `<form>` que hace `router.push('/busqueda?q=…')` ([SearchBar.tsx:22-31](apps/web/src/components/busqueda/SearchBar.tsx#L22)). El cliente Meilisearch instalado (`^0.47.0`) **sí** expone `searchForFacetValues`. | El buscador de tags se construye desde cero, pero con la pieza de Meilisearch disponible. |

**Los tres ajustes de A y el sistema B son viables sin rehacer nada.** El de más riesgo es,
como se anticipaba, el ajuste 2 — y el riesgo es de SEO, no técnico.

---

# PARTE I — AUDITORÍA

## 1. Bloque A — el sistema de búsqueda hoy

### 1.1 Enrutado de categorías

**La ruta.** Next.js App Router, segmento dinámico de un solo nivel:

```
apps/web/src/app/(public)/[categoria]/page.tsx        →  /coches, /vehiculos, /pisos…
```

Es un **Server Component** (`async function CategoriaPage`), SSR puro, sin `generateStaticParams`
ni `revalidate` explícito. `generateMetadata` resuelve título y descripción desde
`getCategoryBySlug`.

**El árbol es de 2 niveles y está garantizado.** Confirmado en tres sitios independientes:

- `assertParentIsRoot` ([admin.service.ts:748](apps/api/src/modules/admin/admin.service.ts#L748))
  rechaza con 400 crear/mover una categoría bajo una que ya tiene padre.
- `findTree` ([categories.service.ts:17](apps/api/src/modules/categories/categories.service.ts#L17))
  solo recorre raíces + un nivel de hijos.
- `INDEX_INCLUDE.category.parent` ([search.service.ts:168](apps/api/src/modules/search/search.service.ts#L168))
  y `categoryPath` (`[slug, parentSlug]`) están explícitamente documentados como "2 niveles;
  si el árbol crece hay que recorrer más arriba".

El seed confirma la forma: 6 raíces (`vehiculos`, `inmuebles`, `tecnologia`, `moda`, `hogar`,
`servicios`) con 2-4 hijas cada una.

> **Conclusión para el ajuste 2:** el catch-all solo tiene que resolver 1 o 2 segmentos.
> Cualquier ruta de 3+ segmentos es un 404 estructural, no un caso a soportar.

**Generadores y consumidores de URL de categoría (mapa completo).**

| # | Fichero | Línea | Qué construye | Nota |
|---|---|---|---|---|
| G1 | [CategoryGrid.tsx](apps/web/src/components/categorias/CategoryGrid.tsx#L11) | 11 | `/${cat.slug}` | Rejilla de categorías de la portada. Solo raíces hoy. |
| G2 | [[categoria]/page.tsx](apps/web/src/app/(public)/[categoria]/page.tsx#L220) | 220 | `/${categoria}?…` | `viewUrl` (switcher de vistas). |
| G3 | [[categoria]/page.tsx](apps/web/src/app/(public)/[categoria]/page.tsx#L232) | 232 | `/${categoria}?…` | `pageUrl` (paginación). |
| G4 | [[categoria]/page.tsx](apps/web/src/app/(public)/[categoria]/page.tsx#L400) | 400 | `/${categoria}` | "Ver todos los anuncios" del estado vacío. |
| G5 | [anuncio/[slug]/page.tsx](apps/web/src/app/(public)/anuncio/[slug]/page.tsx#L110) | 110 | `/${listing.category.slug}` | **Breadcrumb de la ficha.** |
| G6 | [anuncio/[slug]/page.tsx](apps/web/src/app/(public)/anuncio/[slug]/page.tsx#L192) | 192 | `/${listing.category.slug}` | Enlace de categoría en el cuerpo de la ficha. |
| G7 | [FilterPanel.tsx](apps/web/src/components/busqueda/FilterPanel.tsx#L193) | 193 | `/${slug}?…` | `goToSubcategory` — el selector "Subcategoría". |
| G8 | [[categoria]/page.tsx](apps/web/src/app/(public)/[categoria]/page.tsx#L268) | 268 | (breadcrumb) | No genera URL de categoría, pero **es** el breadcrumb a corregir. |

Y tres sitios que enlazan a la categoría **por la ruta de búsqueda**, no por la de categoría —
la incoherencia que el ajuste 1 viene a resolver:

| # | Fichero | Línea | Qué construye |
|---|---|---|---|
| G9 | [(public)/page.tsx](apps/web/src/app/(public)/page.tsx#L61) | 61 | `/busqueda?category=${cat.slug}` — chips "Populares" de la portada |
| G10 | [ListingsBlockRenderer.tsx](apps/web/src/components/blocks/ListingsBlockRenderer.tsx#L42) | 42 | `/busqueda?category=${block.categorySlug}` — "ver todos" del bloque CMS |
| G11 | [SearchBar.tsx](apps/web/src/components/busqueda/SearchBar.tsx#L30) | 30 | `/busqueda?…&category=…` — el buscador de portada |

**Lo que NO existe (y hay que saberlo):**

- **`sitemap.ts` no incluye ninguna categoría.** Ni siquiera hoy. Solo home, `/busqueda`,
  `/blog`, posts y páginas ([sitemap.ts](apps/web/src/app/sitemap.ts)). Tampoco incluye
  fichas de anuncio.
- **No hay redirects configurados.** `next.config.ts` solo tiene `transpilePackages` e
  `images`. No hay bloque `redirects()`.
- **`middleware.ts` no toca rutas públicas** — solo protege `(account)` y `(admin)`.
- **`ListingCard` no enlaza a la categoría** (solo a `/anuncio/[slug]`). No hay que tocarlo.
- **El backend no genera ninguna URL de categoría** — `revalidatePath` solo se usa para
  `/blog/*` y `/paginas/*`.
- **No hay JSON-LD de `BreadcrumbList`** en ninguna parte (solo `Article`/`WebPage` en blog
  y páginas).

**Tests e2e que dependen de la URL plana:** `categoria-meili.spec.ts:110` (`/coches?…`) y
`h6-6-sponsored-ads.spec.ts:77,117,140` (`/coches`).

### 1.2 `/busqueda` frente a `/[categoria]`

**Qué comparten (casi todo).** Ambas son Server Components que llaman al **mismo endpoint**
`GET /search` con los mismos parámetros y renderizan los mismos componentes:

| Pieza | `/busqueda` | `/[categoria]` |
|---|---|---|
| Fuente de datos | `search()` → `GET /search` | `search({category})` → `GET /search` |
| Fallback | ninguno (estado de error) | `getListingsByCategory()` → Postgres |
| `FilterPanel` | `categories={tree}` (selector visible) | `categories={[]}` + `subcategories` |
| `FeaturedBlock` | ✔ | ✔ |
| `FavoritesGridProvider` | ✔ | ✔ |
| `CardAttributesProvider` / `Wide` | ✔ (`buildCardAttributeMap(categories)`) | ✔ (idéntico, unificado tras el bug del árbol) |
| `ViewSwitcher` | `ALL_VIEWS`, default `LISTA` | `category.allowedViews`, `category.defaultView` |
| `MapViewClient` | ✔ | ✔ |
| `CrearAlertaButton` | ✔ | ✘ **(no está)** |
| Reenvío de atributos desconocidos | ✔ (`KNOWN_PARAMS`) | ✔ (`KNOWN_PARAMS`, sin `q`) |

**`GET /search` y `GET /categories/:slug/listings` NO devuelven lo mismo.**

- `GET /search` (Meilisearch) → `{hits, featured, totalHits, page, hitsPerPage, facets}`, con
  el bag `attributes` reconstruido, rating del vendedor, patrocinado intercalado.
- `GET /categories/:slug/listings` → `ListingsService.findByCategory`, `{items, total, page, perPage}`.
  **Sin facetas, sin atributos de filtro, sin destacados, sin patrocinado.** Es el fallback
  para cuando Meilisearch está caído, y la página lo trata como tal (fuerza vista LISTA y
  oculta el panel de filtros).
- **Divergencia real detectada:** `findByCategory` filtra con `category: { slug }`
  ([listings.service.ts:811](apps/api/src/modules/listings/listings.service.ts#L811)) — **exacto,
  sin hijas**. Meilisearch filtra con `categoryPath = slug`, que **sí** incluye las hijas. Es
  decir: en modo fallback, `/vehiculos` muestra solo los anuncios colgados directamente de
  "Vehículos" (probablemente ninguno) en vez de los de coches+motos+furgonetas. Es un bug
  preexistente, menor (solo visible con Meili caído), y **ajeno** a esta ráfaga — se anota,
  no se arregla aquí salvo que se quiera.

**Cómo se pasa de una a otra hoy.** Solo hay dos caminos, y ninguno es la redirección que
pide el ajuste 1:

1. `/busqueda` → selector "Categoría" → `update({category})` → **se queda en `/busqueda`**
   añadiendo `?category=slug` ([FilterPanel.tsx:367](apps/web/src/components/busqueda/FilterPanel.tsx#L367)).
2. `/[categoria]` → selector "Subcategoría" → `goToSubcategory` → **sí navega**, a
   `/${slug}` arrastrando todos los query params menos `page`
   ([FilterPanel.tsx:189-194](apps/web/src/components/busqueda/FilterPanel.tsx#L189)).

El caso (2) es exactamente el molde que pide el ajuste 1, y su comentario ya razona por qué
arrastrar filtros es seguro **en ese sentido concreto**: *"una hija siempre tiene AL MENOS
los atributos heredados del padre"*.

> **La redirección preservando filtros es viable** con la estructura actual: todos los filtros
> viven en query params planos, y ya existe la mecánica (`goToSubcategory`). **Pero hay una
> trampa** que el caso (2) evita por construcción y el ajuste 1 no puede evitar: ver §1.2.1.

#### 1.2.1 La trampa: los atributos NO son válidos en cualquier categoría

Desde RÁFAGA 1, `parseSearchQuery` **rechaza con 400** cualquier query param que no sea core
ni un atributo filtrable **de la categoría pedida**
([search-query.parser.ts:116-121](apps/api/src/modules/search/search-query.parser.ts#L116)).
Eso es el arreglo del leak cross-categoría, y es deseable.

Consecuencia para el ajuste 1: si el usuario está en `/busqueda?rooms=3` (válido: sin
categoría, el resolver usa la **unión global**) y elige "Coches", arrastrar `rooms=3` a
`/vehiculos/coches?rooms=3` produce **un 400 y una página rota**. El tránsito parent→child
(caso 2) es seguro por herencia; el tránsito **global→categoría** y **categoría→otra
categoría** no lo es. El diseño del ajuste 1 tiene que resolverlo (§3.2.2).

#### 1.2.2 Hallazgo lateral: `q` en `/[categoria]` funciona por accidente

`KNOWN_PARAMS` de `/[categoria]` **no incluye `q`**
([[categoria]/page.tsx:31-35](apps/web/src/app/(public)/[categoria]/page.tsx#L31)). Un
`/coches?q=golf` mete `q` en el bag `attributes`, que se hace *spread* en la llamada a
`search()`, que serializa cada clave como query param — así que acaba llegando como `q=golf`
al backend y **la búsqueda de texto funciona**. Pero:

- No aparece en el `<h1>` ni en el breadcrumb (la página no sabe que hay búsqueda de texto).
- Cuenta como "filtro de atributo activo" en `activeFilterCount`.
- "Limpiar filtros" (`clearAll`) preserva `currentFilters.q`… que `/[categoria]` **nunca
  rellena**, así que borra el texto buscado.
- "Ver todos los anuncios" del estado vacío también lo pierde.

Como el brief pide explícitamente que "buscar por texto es posible en `/busqueda`,
`/[categoria]` y portada", esto pasa de accidente a requisito y hay que formalizarlo.

### 1.3 Breadcrumbs

**Dónde están:** dos migas, ambas escritas a mano en la propia página, sin componente
compartido y sin JSON-LD.

```tsx
// /[categoria]/page.tsx:268-272
<nav aria-label="Breadcrumb">
  <Link href="/">Inicio</Link> / <span>{category.name}</span>
</nav>

// /anuncio/[slug]/page.tsx:107-116
<nav aria-label="Breadcrumb">
  <Link href="/">Inicio</Link> / <Link href={`/${listing.category.slug}`}>{listing.category.name}</Link> / <span>{listing.title}</span>
</nav>
```

**Por qué no reflejan el padre: el dato del padre no llega.** No es un olvido de la vista.

- `GET /categories/:slug` (`findBySlug`) **selecciona** `parent` — pero solo para resolver
  herencia (`attributeSchema`, `allowedListingType`, `allowedViews`, `allowedPriceUnits`) — y
  **no devuelve** ni `parent.slug` ni `parent.name` en la respuesta
  ([categories.service.ts:88-96 y 138-158](apps/api/src/modules/categories/categories.service.ts#L88)).
- `SELECT_DETAIL` de la ficha del anuncio selecciona
  `category: { select: { id, slug, name } }` — **sin `parent`**
  ([listings.service.ts:63](apps/api/src/modules/listings/listings.service.ts#L63)).
- `GET /categories` (el árbol) **sí** tiene la relación padre→hijas, pero anidada al revés:
  para saber el padre de "coches" hay que recorrer el árbol buscando quién lo tiene como hijo.
  `/[categoria]` **ya carga ese árbol** (`getCategories()`, para el mapa de atributos de card),
  así que ahí el dato *sí* es derivable hoy mismo. La ficha del anuncio **no** carga el árbol.

> **Conclusión:** el breadcrumb de categoría se podría arreglar solo en el front (derivándolo
> del árbol ya cargado), pero el de la ficha del anuncio **exige tocar el backend**. Se hace
> en el backend en ambos casos, para que haya una sola fuente de verdad.

### 1.4 `FilterableAttributesResolver` y el panel de filtros (ajuste 3)

**El backend no tiene hueco.** La cadena está completa y es correcta:

1. `FilterableAttributesResolver` deriva de `Category.attributeSchema` qué nombres son
   filtrables, con dos modos: unión global (`getAttributeTypes`) y **scoped por categoría**
   (`getAttributeTypesForCategory`), este último con la regla correcta para padres (unión de
   propio + efectivo de cada hija, porque `categoryPath = padre` mezcla anuncios de las hijas).
2. `SearchController` pasa **ese mismo mapa** como `attributeFacetNames`
   ([search.controller.ts:81](apps/api/src/modules/search/search.controller.ts#L81)).
   El comentario del código lo dice explícitamente: *"Marcar un atributo filterable:true es
   ahora suficiente por sí solo para que se convierta en un filtro de la UI"*.
3. `SearchService` interseca defensivamente con `filterableAttributes` real de Meilisearch y
   pide las facetas.
4. La respuesta lleva `facets: result.facetDistribution`.

**El hueco está en el frontend, y son seis cosas.** `FilterPanel` recibe `facets` como
`Record<string, Record<string, number>>` — **pares clave-cruda → conteo, y nada más**. No
recibe ningún `AttributeField`. De ahí:

| | Síntoma | Causa en el código |
|---|---|---|
| **F1** | El título de la sección es el **nombre crudo** del campo (`sqm`, `rooms`, `gearbox`) en vez de su `label` ("Metros cuadrados", "Habitaciones", "Cambio"). | `FACET_SECTION_LABELS[facetKey] ?? facetKey` — el diccionario solo tiene una entrada, `priceUnit` ([FilterPanel.tsx:520](apps/web/src/components/busqueda/FilterPanel.tsx#L520)). |
| **F2** | La **unidad** nunca se muestra (`120` en vez de `120 m²`). | `unit` no viaja hasta el panel. |
| **F3** | Un atributo `number` (km, m², año) se pinta como **chips de valores sueltos** ordenados por frecuencia, no como un rango mín/máx. | El bucle de facetas es único y no mira el `type` ([FilterPanel.tsx:510-546](apps/web/src/components/busqueda/FilterPanel.tsx#L510)). |
| **F4** | Un atributo `boolean` muestra chips literales `true` / `false`. | `CONDITION_LABELS[value] ?? value` no tiene entradas para booleanos. |
| **F5** | Los selects **vinculados** (`dependsOn` / `optionsByParent`, p. ej. marca→modelo) no se acotan: se ofrecen todos los modelos aunque haya una marca elegida. | El panel desconoce `dependsOn`. |
| **F6** | Un atributo filtrable **sin ningún anuncio que lo tenga** no aparece nunca como filtro. | El panel es **facet-driven**: solo pinta lo que Meilisearch devuelve en la distribución, y Meilisearch no devuelve claves con distribución vacía. |

F1-F5 son de presentación. **F6 es el hueco conceptual del ajuste 3**: "los filtros muestran
todos los campos filtrables según config" no se cumple hoy, porque la lista de filtros la
dicta el **resultado**, no la **configuración**.

> Nota: F6 es defendible como diseño (no ofrecer un filtro que daría 0 resultados). El brief
> pide lo contrario. Se propone una solución que satisface ambas cosas (§3.3).

También conviene saberlo: en `/busqueda` **sin categoría**, `attributeFacetNames` es la unión
global — con 20 categorías sembradas ya son decenas de facetas, y el panel las pinta todas
sin agrupar. Escala mal cuando el catálogo crezca.

### 1.5 Meilisearch: qué se indexa y cómo se añade un campo

**Documento** (`ListingDocument`, [search.service.ts:9-53](apps/api/src/modules/search/search.service.ts#L9)):
campos core (`id`, `title`, `description`, `price`, `currency`, `priceType`, `priceUnit`,
`type`, `condition`, `categoryId/Slug/Name`, `categoryPath[]`, `province`, `city`, `_geo`,
`slug`, `thumbnailUrl`, `images[]`, `sellerId/Name/Slug/AvatarUrl`, `sortDate`, `publishedAt`,
`boostScore`) **+ los atributos de categoría aplanados en la raíz** (`[attribute: string]: unknown`),
mediante `...attributes` *antes* de los core para que ninguno los pise.

**Configuración** (`applyFilterableAttributes`, en `onModuleInit` y en el job en caliente
`refresh-filterable-attributes`):

- `searchableAttributes`: `title, brand, model, categoryName, description` (**lista fija**).
- `filterableAttributes`: `CORE_FILTERABLE_ATTRIBUTES` **+** todas las claves del resolver.
- `sortableAttributes`: `price, publishedAt, sortDate, _geo`.
- `rankingRules`: sin `boostScore` (decisión "política C").

**Añadir un campo nuevo (p. ej. `tags`) requiere exactamente esto:**

1. Añadirlo a la interfaz `ListingDocument`.
2. Cargarlo en `INDEX_INCLUDE` (compartido por el processor y por `pnpm reindex` — el propio
   comentario advierte de que si divergen, los documentos difieren según el camino).
3. Emitirlo en `toDocument()`.
4. Añadirlo a `CORE_FILTERABLE_ATTRIBUTES` (y a `NATIVE_FACET_ATTRIBUTES` si se quiere faceta).
5. Añadirlo a `RESERVED_ATTRIBUTE_NAMES` del resolver, para que ningún atributo de categoría
   pueda llamarse igual y solaparse ([filterable-attributes.resolver.ts:11-17](apps/api/src/modules/search/filterable-attributes.resolver.ts#L11)).
6. Añadirlo a `CORE_SEARCH_QUERY_KEYS` del parser y al `SearchQueryDto`.

**¿Reindex?** Los `updateSettings` se aplican solos en cada arranque. Los **documentos ya
indexados no tendrán el campo** hasta que se reindexen. Para `tags` esto **no rompe nada**:
un documento sin `tags` simplemente no casa con `tags = "x"`, que es la semántica correcta
(ese anuncio no tiene ese tag). Un anuncio adquiere tags solo al crearse/editarse, y eso ya
encola su reindexado. Por tanto: **`pnpm reindex` es recomendable pero no obligatorio**.

**Capacidad de sugerencia:** el cliente instalado (`meilisearch@^0.47.0`) expone
`index.searchForFacetValues({ facetName, facetQuery, filter })` — búsqueda de valores dentro
de una faceta, con filtro. Es exactamente la primitiva de "autocompletar tags según texto +
categoría". Requiere que `tags` esté en `filterableAttributes` (lo estará) y, según versión
del servidor, `updateFacetSearch(true)` (soportado por el mismo cliente).

---

## 2. Bloque B — los moldes a calcar

### 2.1 El sistema de ATRIBUTOS, pieza por pieza

| Pieza | Dónde | Qué hace | Qué calca TAGS |
|---|---|---|---|
| **Almacén de la config** | `Category.attributeSchema Json @default("[]")` | Array de `AttributeField` por categoría | **NO se calca tal cual** → tabla propia (§4.1, con justificación) |
| **Tipo/contrato** | [category.types.ts:3-41](apps/api/src/modules/categories/category.types.ts#L3) `AttributeField` | `name, label, type, filterable, required, options, unit, cardAttribute…` | `Tag` = `{slug, name, order, activo}`. Plano: pertenece / no pertenece. Sin `type`, sin `value`. |
| **Herencia** | [category.types.ts:65](apps/api/src/modules/categories/category.types.ts#L65) `resolveEffectiveSchema(own, parentSchema)` | Unión; el hijo **pisa** al padre por `name`; heredados primero | `resolveEffectiveTags(own, parent)` — unión deduplicada por `tagId`. Sin colisión posible (es la misma fila). |
| **Valor por anuncio** | `Listing.attributes Json @default("{}")` | Bag clave→valor | `ListingTag` (tabla puente) — no un Json |
| **Validación al crear** | [listings.service.ts:149-161](apps/api/src/modules/listings/listings.service.ts#L149) `validateRequired` + `validateAttributeValues` + `validateLinkedSelects` sobre `filterSchemaByType(effectiveSchema, type)` | 422 si falta un requerido o el valor no está en `options` | `validateTags`: todo tag enviado debe pertenecer al set efectivo de la categoría **y** el total ≤ `maxTagsPerListing` |
| **Validación al editar** | [listings.service.ts:221-249](apps/api/src/modules/listings/listings.service.ts#L221) | Disparador **por campo**: un PATCH de solo `priceUnit` no revalida atributos (protege el *grandfathering* de anuncios antiguos) | Idéntico: solo se valida `tags` si `dto.tags !== undefined` |
| **Indexación** | `toDocument()` aplana el bag en la raíz del documento | | Campo `tags: string[]` (slugs) en la raíz |
| **Filtrables** | `FilterableAttributesResolver` (memoizado, `invalidate()` + job `refresh-filterable-attributes`) | Deriva del schema | **No hace falta resolver nada**: `tags` es un campo core fijo. Mucho más simple. |
| **Config admin** | `PATCH /admin/categories/:id` con `attributeSchema` + `AttributeSchemaEditor.tsx` (~600 líneas, editor visual con validación de límites, detección de uso, herencia mostrada como solo-lectura) | | CRUD propio (§4.4), mucho más ligero: el tag no tiene 12 propiedades, tiene 2. |
| **Wizard** | Paso `atributos` (§2.2) | | Paso `tags` (§4.5) |
| **Panel de filtros** | Facetas dinámicas (§1.4) | | Faceta `tags` con nombres resueltos (§4.7) |
| **Alertas** | `Alert.attributes Json?` + matching vía `search({listingId})` | | `Alert.tags String[]` — **fuera de alcance de esta ráfaga**, se anota (§8) |

### 2.2 El wizard de crear/editar anuncio

`PublicarWizard.tsx` (alta) y `EditarWizard.tsx` (edición) — dos componentes hermanos que
comparten los `steps/`.

**Pasos:** `categoria → fotos → datos → atributos → ubicacion → previsualizacion`
([PublicarWizard.tsx:47-54](apps/web/src/components/publicar/PublicarWizard.tsx#L47)).

**El patrón clave a calcar** ([PublicarWizard.tsx:202-204](apps/web/src/components/publicar/PublicarWizard.tsx#L202)):

```ts
// El paso 'atributos' DESAPARECE si la categoría elegida no tiene schema
const activeSteps = data.attributeSchema.length > 0
  ? ALL_STEPS
  : ALL_STEPS.filter((s) => s.id !== 'atributos');
```

`StepCategoria` fija `categoryId/Slug/Name` y trae, del mismo `GET /categories/:slug`,
`attributeSchema` (ya resuelto con herencia por el backend), `allowedListingType` y
`allowedPriceUnits`. **El wizard no resuelve herencia: la consume ya resuelta.** Ese es el
contrato que tags debe respetar.

`validateStep('atributos')` valida requeridos y selects vinculados **solo** sobre
`filterSchemaByType(schema, type)`. `buildAttributes()` coacciona a `number`/`boolean` antes
de enviar.

> **Dónde irían los tags sugeridos:** paso propio `tags`, entre `atributos` y `ubicacion`,
> con la misma regla de desaparición (sin tags efectivos en la categoría → no hay paso).

### 2.3 El buscador de portada hoy

`SearchBar.tsx`, montado en el héroe de `/` ([page.tsx:55](apps/web/src/app/(public)/page.tsx#L55)).

Tres controles (`<select>` categoría con `<optgroup>` por raíz, `<select>` provincia,
`<input type="search">`) y un submit que hace:

```ts
router.push(qs ? `/busqueda?${qs}` : '/busqueda');   // q + category + province
```

**No hay sugerencia, ni autocompletado, ni debounce, ni endpoint de sugerencias.** Es un
formulario que navega. La única "ayuda" son los chips "Populares" de debajo, que son las 6
primeras categorías del árbol enlazando a `/busqueda?category=…`.

Del lado del backend **no existe** ningún endpoint de sugerencia/autocompletado. Existe
`municipio-autocomplete` (por el nombre del e2e) para ubicación, ajeno a esto.

### 2.4 Config admin de categorías y el molde de CRUD

**Panel de categorías:** `/admin/categorias` ([page.tsx](apps/web/src/app/(admin)/admin/categorias/page.tsx),
~950 líneas, client-side). Estructura: lista de raíces → filas expandibles con hijas →
`CategoryForm` inline por fila → `SchemaEditorPanel` desplegable con `AttributeSchemaEditor`.
Reordenación con flechas ↑↓ (`PATCH /admin/categories/reorder`).

**Endpoints admin de categoría** ([admin.controller.ts:159-218](apps/api/src/modules/admin/admin.controller.ts#L159)):

```
GET    /admin/categories/searchable-keys      ← rutas ESTÁTICAS declaradas ANTES que las de :id
GET    /admin/categories
POST   /admin/categories
PATCH  /admin/categories/reorder
GET    /admin/categories/:id/attribute-usage
PATCH  /admin/categories/:id
DELETE /admin/categories/:id
```

**Molde de CRUD de catálogo configurable → `ContactReason`** (el más cercano a lo que
necesita `Tag`), documentado en el propio schema:

```prisma
/// Sin DELETE, solo desactivación (molde Banner/SponsoredAd): un motivo desactivado
/// deja de ofrecerse, pero los mensajes históricos conservan su motivoId intacto.
model ContactReason {
  id String @id @default(cuid())
  nombre String
  orden Int @default(0)
  activo Boolean @default(true)
  ...
  @@index([activo, orden])
}
```

Endpoints: `GET /` · `POST /` · `PATCH /reorder` · `PATCH /:id`. **Sin DELETE.**

**Molde de Setting** ([admin.service.ts:44-107](apps/api/src/modules/admin/admin.service.ts#L44)):
`Setting { key @id, value Json, updatedAt, updatedById }` + whitelist `SETTING_KEYS` +
`POSITIVE_INT_SETTING_KEYS` (validación ≥1) + `PATCH /admin/settings/:key` + audit log
(`SETTING_UPDATE`) + editor en `/admin/ajustes`. Ya hay 17 claves; añadir la 18ª es
mecánico.

---

# PARTE II — DISEÑO

## 3. Bloque A

### 3.1 Ajuste 2 — URLs anidadas de categoría

> El de mayor radio. Se diseña primero porque los otros dos dependen de su forma de URL.

#### 3.1.1 Esquema de rutas

```
apps/web/src/app/(public)/[categoria]/page.tsx      ✗ se sustituye por
apps/web/src/app/(public)/[...ruta]/page.tsx        ✓ catch-all
```

Resolución, con `segments = params.ruta` (H1 garantiza que solo hay 2 niveles):

| Caso | Ejemplo | Acción |
|---|---|---|
| 1 segmento, categoría **raíz** | `/vehiculos` | **Renderiza** (URL canónica) |
| 1 segmento, categoría **hija** | `/coches` | **Redirect permanente** → `/vehiculos/coches` + query intacta |
| 2 segmentos, par **válido** | `/vehiculos/coches` | **Renderiza** (URL canónica) |
| 2 segmentos, par **incoherente** | `/inmuebles/coches` | **Redirect permanente** → `/vehiculos/coches` |
| 2 segmentos, primero desconocido | `/lo-que-sea/coches` | **Redirect permanente** → `/vehiculos/coches` |
| slug hoja desconocido | `/xxx`, `/a/xxx` | `notFound()` |
| ≥3 segmentos | `/a/b/c` | `notFound()` |

**La regla es una sola:** *el último segmento manda*. Se resuelve la categoría por él y se
compara la URL pedida con su ruta canónica; si difieren, redirect permanente. Esto absorbe
de golpe las URLs viejas, las mal formadas y cualquier cambio futuro de padre de una
categoría, **sin mantener ninguna tabla de redirects**.

**Un solo helper es la fuente de verdad de la URL de categoría:**

```ts
// apps/web/src/lib/category-url.ts
export function categoryPath(cat: { slug: string; parentSlug?: string | null }): string {
  return cat.parentSlug ? `/${cat.parentSlug}/${cat.slug}` : `/${cat.slug}`;
}
export function categoryPathWithQuery(cat, params: URLSearchParams): string { … }
```

Regla de proyecto que acompaña al cambio: **nadie construye `/${slug}` a mano nunca más.**

#### 3.1.2 Redirects y SEO — el punto delicado

> ### ⚠️ CORRECCIÓN TRAS IMPLEMENTAR (A1, 2026-08-01)
>
> Lo de abajo es el diseño aprobado. **Dos cosas no sobrevivieron al contacto con el
> código real**, ambas comprobadas ejerciendo el servidor, no razonando:
>
> **1. `permanentRedirect()` en la página NO puede emitir un 308 en este proyecto.**
> Existe `apps/web/src/app/loading.tsx` en la RAÍZ de la app, así que Next envuelve
> toda ruta en un límite de Suspense y **descarga la cabecera 200 antes** de ejecutar
> el componente de página. Medido sobre el servidor real:
>
> | | `GET /coches` |
> |---|---|
> | con `app/loading.tsx` (estado real) | **200** + redirect de cliente en el payload |
> | sin `app/loading.tsx` (prueba) | **308** `Location: /vehiculos/coches` |
>
> Un 200 con redirect de cliente es, para un crawler, *"la URL vieja sigue viva"* —
> exactamente lo que A1 viene a evitar. Y quitar el `loading.tsx` global cambiaría el
> estado de carga de TODO el sitio, que no es un efecto que A1 deba causar.
>
> **Resuelto en `middleware.ts`** (`lib/category-canonical.ts`), que corre antes de
> renderizar y emite un 308 real. Se conserva la decisión de fondo de P1 —redirect
> permanente **derivado de la base de datos**, sin tabla estática que mantener, 308 y
> no 301—; lo único que cambia es dónde vive. Mapa slug→padre memoizado 60 s, con
> deduplicación de peticiones en vuelo y *fail-open* (si la API no responde, no
> redirige: la página se sirve igual). La canonicalización de la página se conserva
> como red de seguridad para cuando ese mapa esté frío.
>
> **2. El catch-all `[...ruta]` se descartó por dos rutas explícitas**:
> `[categoria]` y `[categoria]/[subcategoria]`. Medido contra la rama base:
> `/a/b/coches` daba **404 real** del router (no casaba con ninguna ruta); con el
> catch-all pasaba a **200 + UI de 404** (404 blando, por el mismo streaming) — una
> regresión de SEO justo en la ráfaga que viene a arreglar el SEO. Como el árbol tiene
> exactamente 2 niveles, modelar 2 rutas explícitas lo evita de raíz y además hace
> innecesario el "cortocircuito por longitud". Las dos rutas comparten cuerpo en
> `components/categorias/CategoryListingPage.tsx`; los `page.tsx` son envoltorios.
>
> **Deuda anotada (pre-existente, NO introducida por A1):** un slug de categoría
> inexistente (`/xxx`) responde **200 + UI de 404** en vez de un 404 real, por el
> mismo `loading.tsx`. Verificado idéntico en la rama base antes de tocar nada. A1 no
> lo agrava; arreglarlo exige tocar el loading global y se decide aparte.

**Mecanismo recomendado: `permanentRedirect()` dentro del catch-all.**

- Es **derivado de la base de datos**: si un admin mueve "coches" de padre, el redirect nuevo
  aparece solo. Ninguna lista que mantener, ningún `next.config` que reconstruir.
- Next emite **308 Permanent Redirect**. Google lo trata **exactamente igual que un 301** para
  consolidación de señales, y a diferencia del 301 preserva el método.
- Es la opción de menor superficie: no toca `middleware.ts` ni `next.config.ts`.

**Alternativas descartadas y por qué:**

| Opción | Por qué no |
|---|---|
| `redirects()` en `next.config.ts` | Es estático: habría que enumerar cada hija, y regenerar/redeployar cada vez que el admin cree o mueva una categoría. Además `permanent: true` también emite **308**, así que ni siquiera compra el "301 literal". |
| `middleware.ts` con `NextResponse.redirect(url, 301)` | Es la **única** forma de emitir un 301 literal. Coste: el middleware necesita el mapa slug→padre, lo que obliga a cachearlo en memoria con TTL y a hacer fetch al API desde el middleware. Se propone **solo si se exige el 301 literal** (§8, P1). |

**Preservación de SEO — checklist:**

1. **Toda URL vieja responde con redirect permanente a la nueva**, con query intacta. Nada
   404ea. Es el punto crítico y lo cubre la regla del §3.1.1.
2. **Canonical explícito.** `generateMetadata` del catch-all añade
   `alternates: { canonical: SITE_URL + categoryPath(cat) }`. Aunque los redirects lo cubren,
   el canonical protege ante URLs con query params que Google indexe por su cuenta.
3. **Sitemap.** Se añaden **todas** las categorías (raíces y hijas) con su URL **anidada**.
   Hoy no hay ninguna: esto es una **mejora neta** de SEO que llega con el cambio, y además
   es el canal por el que Google descubre las URLs nuevas rápido.
4. **JSON-LD `BreadcrumbList`** en `/[…ruta]` y en `/anuncio/[slug]`, coherente con la miga
   visible. No existe hoy; es la otra mejora neta.
5. **Enlaces internos.** Ningún enlace interno debe apuntar ya a la URL vieja (§3.1.4): un
   redirect que se dispara desde dentro del propio sitio es señal negativa y gasta *crawl budget*.
6. **No se cambia ningún slug.** Solo se antepone el del padre. Las hijas conservan su
   identidad; las raíces **no cambian de URL en absoluto**.

#### 3.1.3 Cambios de backend necesarios

| Cambio | Fichero | Compatibilidad |
|---|---|---|
| `findBySlug` devuelve `parent: { slug, name } \| null` | `categories.service.ts` | **Aditivo.** Ningún consumidor actual se rompe. |
| `findTree` devuelve `parentSlug` en cada hija (o el front lo deriva del anidamiento — ya lo puede hacer) | `categories.service.ts` | **Aditivo.** Recomendado igualmente para no obligar a cada consumidor a recorrer el árbol. |
| `SELECT_DETAIL.category` incluye `parent: { select: { slug, name } }` | `listings.service.ts:63` | **Aditivo** en el payload de la ficha. |
| Guarda de **slugs reservados** al crear/editar categoría | `admin.service.ts` | **Nuevo.** Ver abajo. |

**Guarda de slugs reservados (hueco latente que el cambio agranda).** El catch-all vive en la
raíz, así que compite con las rutas estáticas de primer nivel. Hoy una categoría raíz con slug
`busqueda`, `anuncio`, `blog`, `paginas`, `planes`, `contacto`, `vendedor`, `admin`, `api`,
`publicar`, `login`… ya sería **inalcanzable** en silencio. Se añade una constante
`RESERVED_ROOT_SLUGS` y un 400 explícito en `createCategory`/`updateCategory` **solo para
categorías raíz** (una hija puede llamarse `blog` sin problema: vive bajo `/x/blog`). Cierra un
agujero que ya existía.

**Efecto colateral del catch-all a documentar:** hoy `/lo/que/sea` da 404 desde el router, sin
tocar nada. Con el catch-all, ese 404 lo emite `notFound()` **después** de resolver segmentos
(y, si son 1-2, después de una llamada a `GET /categories/:slug`). Mismo resultado visible,
un roundtrip de coste. Mitigable cortocircuitando por longitud (≥3 segmentos → `notFound()`
sin consultar nada), que es lo que se propone.

#### 3.1.4 TODOS los sitios a tocar

**Frontend — generadores de URL (todos pasan por `categoryPath`):**

| # | Fichero:línea | Cambio |
|---|---|---|
| G1 | `components/categorias/CategoryGrid.tsx:11` | `categoryPath(cat)`. Salida idéntica para raíces; correcta si algún día se pintan hijas. |
| G2 | `[...ruta]/page.tsx` (`viewUrl`) | `categoryPath` + query |
| G3 | `[...ruta]/page.tsx` (`pageUrl`) | ídem |
| G4 | `[...ruta]/page.tsx` (estado vacío) | ídem |
| G5 | `anuncio/[slug]/page.tsx:110` | Breadcrumb: `Inicio > Padre > Hija > Título` usando `listing.category.parent` |
| G6 | `anuncio/[slug]/page.tsx:192` | `categoryPath(listing.category)` |
| G7 | `components/busqueda/FilterPanel.tsx:193` (`goToSubcategory`) | `categoryPath(child)` — necesita el `parentSlug`, que la página ya conoce |
| G8 | `[...ruta]/page.tsx:268` (breadcrumb) | `Inicio > Padre > Hija` (o `Inicio > Raíz`) |
| G9 | `(public)/page.tsx:61` (chips Populares) | `categoryPath(cat)` — deja de ir a `/busqueda?category=` (converge con el ajuste 1) |
| G10 | `components/blocks/ListingsBlockRenderer.tsx:42` | `categoryPath` — ídem |
| G11 | `components/busqueda/SearchBar.tsx:30` | Si hay categoría elegida → `categoryPath` + query; si no → `/busqueda` (ajuste 1) |

**Frontend — otros:**

| Fichero | Cambio |
|---|---|
| `app/sitemap.ts` | **Añadir** todas las categorías con URL anidada (`getCategories()`), `changeFrequency: 'daily'`, `priority: 0.8`. Considerar añadir también las fichas de anuncio (hoy tampoco están) — **fuera de alcance**, se anota. |
| `lib/category-url.ts` | **Nuevo.** Único constructor de URLs de categoría. |
| `types/index.ts` | `Category.parentSlug?: string` y `CategoryWithSchema.parent?: {slug,name}` |
| `lib/api/categorias.ts` | Sin cambios (los tipos ya fluyen) |

**Tests:**

| Fichero | Cambio |
|---|---|
| `e2e/categoria-meili.spec.ts:110` | `/coches?…` → `/vehiculos/coches?…` |
| `e2e/h6-6-sponsored-ads.spec.ts:77,117,140` | `/coches` → `/vehiculos/coches` |
| **`e2e/categoria-urls-anidadas.spec.ts`** | **Nuevo.** Cubre: `/coches` → 308 → `/vehiculos/coches` con query preservada; `/vehiculos` renderiza; `/inmuebles/coches` → canónica; `/xxx` → 404; `/a/b/c` → 404; breadcrumb con 3 niveles; sitemap contiene las anidadas. |
| Unitario `lib/category-url.test.ts` | **Nuevo.** |

**Backend:** los 4 cambios de §3.1.3 + sus specs.

### 3.2 Ajuste 1 — unificar `/busqueda` y `/[categoria]`

#### 3.2.1 Comportamiento

Un único componente `CategorySelect` (extraído de `FilterPanel`) presente en **las dos**
páginas, con "Todas las categorías" siempre disponible:

| Desde | Elige | Va a |
|---|---|---|
| `/busqueda?q=x&province=Madrid` | Coches | `/vehiculos/coches?q=x&province=Madrid` |
| `/busqueda?…` | Vehículos | `/vehiculos?…` |
| `/vehiculos/coches?q=x&province=Madrid` | *Todas las categorías* | `/busqueda?q=x&province=Madrid` |
| `/vehiculos/coches?…` | Motos | `/vehiculos/motos?…` |
| `/vehiculos?…` | Coches | `/vehiculos/coches?…` (sustituye al actual "Subcategoría") |

El selector "Subcategoría" de `/[categoria]` **desaparece**: queda subsumido por el selector
de categoría completo, que ya ofrece el árbol con `<optgroup>`.

Además, y por el mismo criterio de unificación: **`/busqueda?category=X` redirige
permanentemente** a la ruta canónica de esa categoría, preservando el resto de la query. Eso
mantiene vivos los enlaces existentes (G9, G10, cualquier enlace externo, cualquier bookmark)
sin dejar dos URLs compitiendo por el mismo contenido — que es exactamente el problema de SEO
que el ajuste 2 viene a arreglar.

> ### ✅ IMPLEMENTADO (A2, 2026-08-01) — un campo más del previsto
>
> El diseño pedía **un** cambio aditivo de backend (`filterable` en `allAttributes`).
> Hicieron falta **dos**: el árbol tampoco exponía `allowedListingType`, y sin él el
> cliente no puede aplicar la regla de `condition` (§3.2.2, punto 3) — no hay forma de
> saber si el destino es `SERVICE_ONLY`. Se añade con la misma resolución de herencia
> en dos pasos que ya hacía `findBySlug`, así que es el valor EFECTIVO, no el propio.
>
> Lo demás salió como estaba diseñado. La regla vive en `lib/filter-carry.ts` y el
> selector en `components/busqueda/CategorySelect.tsx`.
>
> **P3 confirmado antes de activar el redirect**, como pedía la ráfaga: no queda ningún
> generador de `/busqueda?category=` en el frontend (A1 migró los chips de portada y el
> bloque CMS), no aparece en plantillas de email ni en enlaces guardados en base de
> datos (footer, banners, patrocinados, bloques de posts/páginas — auditadas las dos
> bases), y las alertas solo renderizan texto, nunca una URL de búsqueda.

#### 3.2.2 Preservación de filtros: la regla

Al cambiar de categoría se construye la query destino así:

1. **Se descarta** `page` (cambiar de categoría es un cambio de filtro — molde `update()`).
2. **Se descarta** `category` (pasa a ser el path).
3. **Se conservan** los core: `q, type, condition, priceType, priceUnit, minPrice, maxPrice,
   province, city, lat, lng, radius, sort, view` — todos válidos en cualquier categoría.
   - Matiz `view`: si la vista actual no está en `allowedViews` de la categoría destino,
     `resolveCurrentView` ya cae al default sin romperse. Nada que hacer.
   - Matiz `condition`: si la destino es `SERVICE_ONLY`, `condition` daría 400
     (`condition no aplica a SERVICE` solo salta con `type=SERVICE` explícito, pero el filtro
     no tendría sentido). Se descarta `condition` cuando la destino es `SERVICE_ONLY`.
4. **Se filtran los atributos**: solo sobreviven los que son filtrables **en la categoría
   destino**. Los demás se caen en silencio.

El punto 4 es obligatorio: sin él, `/busqueda?rooms=3` → Coches produce un **400** (§1.2.1).

**Cómo sabe el cliente qué atributos valen en el destino.** El árbol de `GET /categories` ya
viaja a ambas páginas y trae `allAttributes` por categoría **con la herencia ya resuelta para
las hijas**. Falta un dato: `allAttributes` incluye también los `filterable: false`, y mandar
uno de esos como query param también da 400.

> **Cambio de backend (aditivo): exponer `filterable` en las entradas de `allAttributes`**
> del árbol (`toAttrDef` en `findTree`). Una propiedad más en un objeto que ya existe;
> ningún consumidor se rompe.

Con eso, el set válido del destino se calcula en cliente:

- destino **hoja** → sus `allAttributes` con `filterable === true` (ya incluye los heredados).
- destino **raíz** → los suyos **∪** los de todas sus hijas — replicando exactamente la regla
  de `getAttributeTypesForCategory` para padres (`categoryPath = padre` mezcla anuncios de las
  hijas, así que un atributo de hija es filtro legítimo ahí).
- destino **"todas"** (`/busqueda`) → no se filtra nada: la unión global acepta todo.

**Se rechaza expresamente** la alternativa de "que el backend ignore los params desconocidos
en vez de 400": ese 400 es el arreglo del leak cross-categoría de RÁFAGA 0/1. No se toca.

#### 3.2.3 Formalizar `q` en la ruta de categoría

Como consecuencia obligada (hoy funciona por accidente, §1.2.2):

- Añadir `'q'` a `KNOWN_PARAMS` de `[...ruta]/page.tsx` y pasarlo explícito a `search()`.
- Incluirlo en `currentFilters` (para que `clearAll` lo respete, como en `/busqueda`).
- Reflejarlo en el `<h1>` (`Coches — resultados para "golf"`) y en `generateMetadata`.
- Que `activeFilterCount` lo cuente como filtro de texto, no como atributo.
- El botón "Ver todos los anuncios" del estado vacío conserva la categoría y limpia el resto.

#### 3.2.4 Bonus coherente (opcional pero barato)

`CrearAlertaButton` existe en `/busqueda` y no en `/[categoria]`. Con las dos páginas
unificadas, la ausencia se vuelve arbitraria. El `alertCriteria` se construye con los mismos
valores ya parseados. **Recomendado incluirlo**; se marca como opcional en la ráfaga.

### 3.3 Ajuste 3 — que los filtros muestren todos los campos filtrables

**Diagnóstico:** el backend no tiene hueco (H4). El frontend pinta facetas **a ciegas**, y por
eso falla en seis puntos (F1-F6, §1.4).

**Diseño: invertir el eje — pasar de *facet-driven* a *schema-driven con conteos*.**

El `FilterPanel` recibe un array nuevo, `filterableFields: AttributeFieldView[]`, con la
definición efectiva de cada atributo filtrable de la categoría en scope:

```ts
interface AttributeFieldView {
  name: string; label: string; type: 'text'|'number'|'select'|'boolean';
  unit?: string; options?: string[];
  dependsOn?: string; optionsByParent?: Record<string, string[]>;
}
```

Ambas páginas ya tienen de dónde sacarlo:
- `/[…ruta]` → `category.attributeSchema` de `GET /categories/:slug` (**ya resuelto con
  herencia**), filtrado por `filterable`. Para una raíz, además, la unión con sus hijas
  (`categories` del árbol, ya cargado).
- `/busqueda` sin categoría → unión de `allAttributes` filtrables del árbol.

**Cambio de backend (aditivo):** en `toAttrDef` de `findTree`, exponer `filterable`, `type`,
`options`, `dependsOn`, `optionsByParent`. Hoy solo salen `key, label, unit, showLabel,
showUnit, appliesTo`. `GET /categories/:slug` ya devuelve el `attributeSchema` completo, así
que ahí no hace falta nada.

**Renderizado nuevo, por tipo:**

| `type` | Control | Resuelve |
|---|---|---|
| `select` | Chips con `label` de sección y opciones desde `options`, anotadas con el conteo de la faceta; las opciones con 0 resultados se muestran **deshabilitadas**, no ocultas | F1, F6 |
| `boolean` | Dos chips "Sí"/"No" | F4 |
| `number` | **Rango mín/máx** (dos inputs, molde exacto del filtro de precio ya existente: estado local + aplicar en blur/Enter), con la `unit` en el placeholder | F2, F3 |
| `text` | Input de texto (aplicar en blur/Enter) | — |
| `select` con `dependsOn` | Oculto hasta que el padre tenga valor; opciones vía `resolveLinkedOptions(field, parentValue)` (**la función ya existe** y está compartida en `lib/attribute-schema`) | F5 |

**El rango numérico implica soporte de backend** (`km_min` / `km_max` o similar): hoy los
atributos solo se filtran por **igualdad** (`${key} = ${value}` en
[search.service.ts:371-377](apps/api/src/modules/search/search.service.ts#L371)). Un filtro de
km/m²/año por valor exacto es inútil en la práctica.

> **Propuesta:** sufijos `_min`/`_max` en el query param, reconocidos por `parseSearchQuery`
> cuando la clave base es un atributo filtrable de tipo `number`, traducidos a
> `key >= n` / `key <= n` en el filtro Meilisearch. Aditivo puro: la igualdad
> (`km=120000`) sigue funcionando. Reserva implícita: ningún atributo puede llamarse
> `x_min`/`x_max` si existe `x` numérico — se añade al guard de nombres reservados.
>
> **Alternativa más barata:** dejar F3 fuera y limitarse a F1/F2/F4/F5/F6 (etiquetas, unidades,
> booleanos, vinculados, y mostrar todos los filtrables). Es media ráfaga menos. Ver §8, P4.

**F6, con matiz:** se pintan **todos** los campos filtrables según config, pero los **valores**
sin resultados se muestran deshabilitados con `(0)` en vez de desaparecer. Así se cumple la
letra del requisito sin regalar callejones sin salida.

---

## 4. Bloque B — sistema de TAGS

### 4.1 Modelo de datos

```prisma
/// Etiqueta de vocabulario controlado (sistema HERMANO del de atributos, no fusionado
/// con él: un atributo es clave→valor y vive en Listing.attributes; un tag es
/// pertenece/no-pertenece y vive en una tabla puente). Catálogo GLOBAL, asignado a
/// categorías vía CategoryTag: el mismo tag ("envío incluido") se ofrece en muchas
/// categorías sin duplicarse, se renombra en un sitio, y es la base del vocabulario
/// que sugiere el buscador de portada.
/// Sin DELETE duro, solo desactivación — molde ContactReason/Banner/SponsoredAd:
/// desactivar un tag deja de ofrecerlo y de filtrarlo, pero los anuncios que ya lo
/// tienen conservan la fila de ListingTag intacta.
model Tag {
  id        String   @id @default(cuid())
  /// Lo que viaja en la URL (?tags=cambio-automatico) y lo que se indexa en Meilisearch.
  slug      String   @unique
  /// Lo que ve el usuario.
  name      String
  orden     Int      @default(0)
  activo    Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  categories CategoryTag[]
  listings   ListingTag[]

  @@index([activo, orden])
}

/// Qué tags se OFRECEN en qué categoría. La herencia padre→hija se resuelve en
/// lectura (resolveEffectiveTags), NO se materializa aquí: una hija nunca lleva
/// filas duplicadas de lo que ya ofrece su padre — mismo criterio que
/// resolveEffectiveSchema con attributeSchema.
model CategoryTag {
  categoryId String
  category   Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)
  tagId      String
  tag        Tag      @relation(fields: [tagId], references: [id], onDelete: Cascade)
  orden      Int      @default(0)

  @@id([categoryId, tagId])
  @@index([tagId])
}

/// Qué tags TIENE un anuncio concreto. Tope por anuncio: Setting maxTagsPerListing.
model ListingTag {
  listingId String
  listing   Listing @relation(fields: [listingId], references: [id], onDelete: Cascade)
  tagId     String
  tag       Tag     @relation(fields: [tagId], references: [id], onDelete: Restrict)

  @@id([listingId, tagId])
  @@index([tagId])
}
```

**Por qué tablas y no `Category.tagSchema Json` (calcando literalmente el molde de atributos):**

1. El brief pide un **modelo `Tag` propio**.
2. Un atributo es un *schema* (definición por categoría, valor por anuncio): el Json encaja.
   Un tag es **vocabulario compartido**: "envío incluido" es el mismo concepto en 30
   categorías. En Json habría 30 copias, y renombrarlo sería reescribir 30 filas.
3. El **buscador de portada** necesita consultar el vocabulario **transversalmente** (sugerir
   sobre todos los tags, con o sin categoría). Con Json habría que cargar y aplanar el árbol
   entero en cada sugerencia.
4. `ListingTag` da **integridad referencial**: no puede existir un anuncio con un tag
   inexistente. El bag Json de atributos no la tiene (y por eso `validateAttributeValues`
   existe).
5. Se **conserva** el patrón donde importa: config por categoría, herencia padre→hija en
   lectura, indexación en Meilisearch, validación en el service, paso propio en el wizard,
   faceta en el panel. Es hermano del sistema de atributos, no una copia de su almacén.

**Migración:** aditiva pura, tres tablas nuevas. Ninguna columna existente cambia. Un anuncio
sin tags simplemente no tiene filas en `ListingTag`.

### 4.2 Herencia por categoría

```ts
// apps/api/src/modules/tags/tag.types.ts  (hermano de category.types.ts)

/**
 * Tags EFECTIVOS de una categoría: los suyos MÁS los de su padre. Unión, no
 * override — a diferencia de resolveEffectiveViews/resolveEffectivePriceUnits
 * (donde una config propia REEMPLAZA la del padre) y a diferencia también de
 * resolveEffectiveSchema (unión CON pisado por `name`): aquí no puede haber
 * colisión, porque padre e hija referencian la MISMA fila de Tag. Un tag del
 * padre ("garantía" en Vehículos) es legítimo en la hija (Coches); no hay caso
 * en que la hija quiera negar un tag del padre — si lo hubiera, se resuelve
 * quitándolo del padre, no inventando una lista de exclusión.
 * Mismo supuesto de 2 niveles (hoja → padre) que todo lo demás, garantizado por
 * assertParentIsRoot.
 */
export function resolveEffectiveTags(own: TagRef[], parent: TagRef[]): TagRef[] {
  const seen = new Set(own.map((t) => t.id));
  return [...own, ...parent.filter((t) => !seen.has(t.id))];
}
```

Orden de salida: propios primero (más específicos), heredados después — inverso al de
`resolveEffectiveSchema` **a propósito**: allí el orden es de formulario (los heredados
contextualizan primero); aquí es de sugerencia (lo específico de la categoría es más
relevante).

Solo se devuelven tags con `activo: true`.

### 4.3 Endpoints públicos

```
GET /categories/:slug/tags        → TagRef[]   (efectivos, ya resueltos con herencia, activos)
GET /tags/suggest?q=&category=    → TagSuggestion[]   (§4.8)
```

`TagRef = { id, slug, name }`. `TagSuggestion = TagRef & { count: number }`.

También se **añade** `tags: TagRef[]` a la respuesta de `GET /categories/:slug` — mismo
criterio que `allowedPriceUnits`/`allowedViews`: el wizard ya llama a ese endpoint al elegir
categoría y no debería necesitar un segundo viaje. El endpoint suelto se mantiene para el
panel de filtros y el buscador.

Cacheable en Redis por slug, invalidado al tocar la config (molde ya usado por
`SponsoredAdsService`).

### 4.4 Config admin (CRUD)

**Catálogo global de tags** — molde `ContactReason` (sin DELETE duro):

```
GET    /admin/tags                    lista completa (activos e inactivos), paginada + ?q=
POST   /admin/tags                    { name, slug? }  — slug autogenerado si falta
PATCH  /admin/tags/reorder            [{ id, orden }]        ← ruta ESTÁTICA antes que :id
PATCH  /admin/tags/:id                { name?, orden?, activo? }
GET    /admin/tags/:id/usage          { listingCount, categoryCount }  ← molde attribute-usage
```

`slug` es **inmutable** una vez creado (es la URL y lo indexado). Renombrar cambia `name`, no
`slug`. Cambiarlo requeriría redirects de URLs de filtro y reindexar todos los anuncios que lo
llevan — no compensa.

Guardas: `slug` único (409 con mensaje claro); desactivar un tag en uso avisa con el conteo
(`usage`) pero **se permite** (los anuncios lo conservan, deja de ofrecerse y de filtrarse);
no hay DELETE.

**Asignación por categoría:**

```
GET /admin/categories/:id/tags        { own: TagRef[], inherited: TagRef[] }
PUT /admin/categories/:id/tags        { tagIds: string[] }   ← reemplaza el set PROPIO
```

`inherited` viaja como **solo lectura**, exactamente como `AttributeSchemaEditor` muestra hoy
los atributos heredados (`editInherited`). El admin ve qué le llega del padre sin poder
tocarlo desde la hija.

Endpoints propios en lugar de un campo más en `PATCH /admin/categories/:id` porque el set de
tags es una relación N:M, no una propiedad escalar de la categoría — mismo criterio por el que
`reorder` y `attribute-usage` son rutas propias.

**UI:** panel `TagsEditorPanel` desplegable en cada fila de `/admin/categorias`, hermano de
`SchemaEditorPanel` — multiselect con buscador sobre el catálogo + bloque "Heredados del
padre" en gris. Y una página nueva `/admin/tags` para el catálogo global (molde
`/admin/motivos-contacto`: tabla + alta inline + flechas ↑↓ + toggle activo).

**Ajuste global:** `maxTagsPerListing` → `SETTING_KEYS` **y** `POSITIVE_INT_SETTING_KEYS`
(un tope de 0 dejaría el sistema muerto). Sin sembrar: "sin configurar" → constante
`DEFAULT_MAX_TAGS_PER_LISTING = 5`, mismo patrón que `ticketAutoCloseWindowDays`. Editor en
`/admin/ajustes` junto a los demás numéricos.

### 4.5 Wizard: elegir tags al crear/editar

**Paso nuevo `tags`**, entre `atributos` y `ubicacion`:

```ts
const ALL_STEPS = [
  { id: 'categoria' }, { id: 'fotos' }, { id: 'datos' },
  { id: 'atributos' }, { id: 'tags' }, { id: 'ubicacion' }, { id: 'previsualizacion' },
];

// Misma regla de desaparición que 'atributos' (PublicarWizard.tsx:202)
let activeSteps = ALL_STEPS;
if (data.attributeSchema.length === 0) activeSteps = activeSteps.filter(s => s.id !== 'atributos');
if (data.availableTags.length === 0)   activeSteps = activeSteps.filter(s => s.id !== 'tags');
```

`StepCategoria` guarda `availableTags` en el estado del wizard desde el mismo
`GET /categories/:slug` (§4.3). `StepTags` pinta los tags efectivos como chips
seleccionables (propios primero), con buscador si son muchos, contador `3/5` y bloqueo al
llegar al tope.

`validateStep('tags')`: nunca bloquea por "falta" (los tags **no son obligatorios**); bloquea
solo si se superó el tope — situación que la UI ya impide, igual que la validación de selects
vinculados existe "por si el estado queda obsoleto tras idas y venidas".

**Al cambiar de categoría**, los tags seleccionados que no estén en el set efectivo de la nueva
se descartan en silencio — mismo criterio con el que el wizard ya trata los atributos.

`EditarWizard` idéntico, precargando los tags actuales del anuncio.

### 4.6 Backend de anuncios

- `CreateListingDto` / `UpdateListingDto`: `tags?: string[]` (IDs o slugs — **se recomienda
  slugs**, coherente con lo que viaja en la URL y con lo indexado).
- `validateTags(tags, effectiveCategoryTags, max)`:
  - cada tag existe, está `activo` y pertenece al set **efectivo** de la categoría → si no, 422.
  - `tags.length <= max` → si no, 422 con el tope en el mensaje.
- Escritura: `deleteMany` + `createMany` de `ListingTag` dentro de la misma transacción del
  anuncio.
- **Disparador en `update()`**: se valida **solo** si `dto.tags !== undefined` **o** cambia
  `categoryId` — calcando el razonamiento ya documentado en
  [listings.service.ts:213-224](apps/api/src/modules/listings/listings.service.ts#L213)
  (un PATCH de solo precio no debe revalidar nada más). Si cambia la categoría y algún tag
  deja de ser válido, se **eliminan** los que ya no aplican (no se rechaza la edición: el
  usuario no eligió romperlos).
- **Grandfathering:** bajar `maxTagsPerListing` **no** invalida anuncios existentes. Solo se
  comprueba en escritura. Un anuncio con 8 tags y un tope nuevo de 5 sigue vivo; su siguiente
  edición que toque `tags` tendrá que bajar a 5.
- `GET /listings/:slug` devuelve `tags: TagRef[]` (para pintarlos en la ficha).

### 4.7 Indexación y filtrado

**Documento** — siguiendo exactamente los 6 pasos del §1.5:

```ts
interface ListingDocument {
  …
  /** Slugs de los tags del anuncio. Filtrable y facetable. */
  tags: string[];
  /** Nombres visibles — SOLO para relevancia de texto libre (searchableAttributes),
   *  nunca para filtrar. Canaliza "coche automático" hacia el tag correcto. */
  tagNames: string[];
}
```

1. `INDEX_INCLUDE` += `tags: { select: { tag: { select: { slug: true, name: true } } } }`
   (compartido por processor y `pnpm reindex`, como advierte su comentario).
2. `toDocument()` emite ambos arrays. **Después** del `...attributes`, como todo campo core.
3. `CORE_FILTERABLE_ATTRIBUTES` += `'tags'`.
4. `NATIVE_FACET_ATTRIBUTES` += `'tags'` (una faceta más en la misma petición, sin viaje extra
   — mismo razonamiento ya escrito para `priceUnit`).
5. `SEARCHABLE_ATTRIBUTES` += `'tagNames'`, colocado **después de `title`** y antes de
   `description` (un tag es más señal que la descripción, menos que el título).
6. `RESERVED_ATTRIBUTE_NAMES` (resolver) += `'tags'`, `'tagNames'`; `CORE_SEARCH_QUERY_KEYS`
   (parser) += `'tags'`.

**Filtro.** `SearchParams.tags?: string[]`, traducido en `search()` a **AND** (acumular tags
acota; molde de cómo ya se acumulan los filtros de atributo):

```ts
for (const t of params.tags ?? []) filters.push(`tags = "${this.escape(t)}"`);
```

**Formato en la URL: `?tags=a,b` (CSV).** Se elige sobre el multivalor repetido
(`?tags=a&tags=b`) porque todo el frontend actual asume **un valor por clave**: el helper
`str()` de ambas páginas se queda con el primero, y `FilterPanel.update()` usa
`params.set()`. CSV mantiene intactos esos helpers; el multivalor obligaría a tocarlos todos.
El DTO parte por comas y valida cada slug.

**Reindex:** no obligatorio (§1.5). Se documenta `pnpm reindex` como paso recomendado tras
desplegar para normalizar `tags: []` en los documentos viejos.

**Panel de filtros.** Sección "Etiquetas" en `FilterPanel`, alimentada por dos fuentes:
la lista de tags efectivos de la categoría (nombres, orden) y `facets.tags` (conteos por
slug). Chips multi-selección — a diferencia del resto de facetas, que son `toggleFacet`
excluyentes. Se muestran primero los que tienen resultados; los de 0, deshabilitados
(mismo criterio que §3.3).

Funciona igual en `/busqueda` (sin categoría → catálogo global activo, acotado a los que
aparecen en la faceta) y en `/[…ruta]`.

### 4.8 Buscador de portada con sugerencia de tags

**Endpoint:** `GET /tags/suggest?q=<texto>&category=<slug>&limit=8`

**Implementación recomendada — Postgres primero, Meilisearch para los conteos:**

1. Candidatos desde Postgres: `Tag` activos con `name ILIKE %q%`, acotados por `CategoryTag`
   (propios + del padre) si viene `category`. El vocabulario son **cientos de filas**, no
   millones: una consulta indexada es trivial y **puede sugerir tags con 0 anuncios**, cosa
   que una búsqueda de facetas no puede por definición.
2. Conteos con **una** llamada a
   `index.searchForFacetValues({ facetName: 'tags', facetQuery: q, filter: categoryPath })`
   — la primitiva que el cliente `^0.47.0` ya expone (§1.5).
3. Fusión: se ordena por `count desc`, luego por `orden`. Los de count 0 van al final (o se
   ocultan, según §8 P6).
4. Caché Redis por `(q, category)`, TTL corto (5 min) — molde `SponsoredAdsService`.

**Alternativa descartada:** solo `searchForFacetValues`. Es más rápido y una sola llamada,
pero nunca sugiere un tag sin anuncios y no puede ordenar por criterio editorial (`orden`).
Con un vocabulario controlado, ambas cosas importan.

**UI (`SearchBar`):** input con debounce (~250 ms) y desplegable en dos bloques:

```
┌──────────────────────────────────────────┐
│ ETIQUETAS                                │
│  ⬥ Cambio automático            (1.204)  │  → /vehiculos/coches?tags=cambio-automatico
│  ⬥ Diésel                         (890)  │
│  ⬥ Garantía                       (312)  │
├──────────────────────────────────────────┤
│ Buscar "coche automatico" en todo        │  → /busqueda?q=coche+automatico
└──────────────────────────────────────────┘
```

Los tags van **arriba y destacados**; el texto libre queda como salida de escape al final.
Eso es literalmente "el texto libre existe pero canalizado hacia tags".

**Destino al elegir un tag** — aquí es donde A y B se tocan:

- Con categoría seleccionada en el `<select>` → `categoryPath(cat) + '?tags=' + slug`.
- Sin categoría → `/busqueda?tags=' + slug`.
- Si además hay provincia → se añade `&province=`.

Se usa el **mismo helper `categoryPath`** del ajuste 2. Si el buscador se construyera antes,
habría que reescribir ese destino después.

---

## 5. La relación entre A y B, y el orden recomendado

Los tags se filtran **dentro** de las rutas de búsqueda: `?tags=` es un query param más de
`/busqueda` y de la ruta de categoría, y el buscador de portada **construye URLs de
categoría**.

**Recomendación: A antes que B. Y dentro de A: ajuste 2 → ajuste 1 → ajuste 3.**

Razones, en orden de peso:

1. **El buscador de portada (B) construye URLs de categoría.** Hacerlo antes del ajuste 2
   significa escribir `/${slug}?tags=…` y reescribirlo entero después. Con A hecho, se llama a
   `categoryPath()` y ya está.
2. **La sección "Etiquetas" del `FilterPanel` (B) se monta sobre el mismo panel que el ajuste
   3 reestructura.** Hacer B primero implica escribir la sección de tags dentro del bucle de
   facetas ciego y volver a moverla cuando llegue el ajuste 3.
3. **El ajuste 1 define la regla de qué query params sobreviven al cambiar de categoría.** Los
   tags son otro param sujeto a esa regla (un tag de "Coches" no vale en "Pisos") — y encaja
   en ella gratis si la regla ya existe. Al revés, hay que retocarla.
4. **El ajuste 2 es el de más radio y el más arriesgado (SEO).** Conviene hacerlo cuando el
   resto del sistema está quieto, no mientras se añaden filtros nuevos.
5. B no necesita nada de A para funcionar; A sí ahorra trabajo a B. La dependencia es
   **unidireccional**, y por eso el orden es obvio.

Dentro de A: **2 → 1 → 3**. El ajuste 1 construye URLs de categoría (necesita el helper del 2);
el 3 solo toca el interior del panel y es independiente de ambos, así que va al final por ser
el de menor riesgo.

---

## 6. Desglose en ráfagas

> Nada de esto se implementa hasta aprobar este documento.

### BLOQUE A

**RÁFAGA A1 — URLs anidadas de categoría (ajuste 2)** · *la más delicada*

- Backend: `findBySlug` devuelve `parent`; `findTree` devuelve `parentSlug`;
  `SELECT_DETAIL.category` incluye `parent`; guarda `RESERVED_ROOT_SLUGS`.
- Front: `lib/category-url.ts`; `[categoria]` → `[...ruta]` con la regla de canonicalización
  y `permanentRedirect`; los 11 generadores (G1-G11) pasan por el helper; breadcrumbs de
  categoría y de ficha con el padre; `canonical` en `generateMetadata`; categorías en
  `sitemap.ts`; JSON-LD `BreadcrumbList`.
- Tests: e2e nuevo de redirects/canónicas; actualizar los 4 `goto('/coches')`; unitario del helper.
- **Criterio de cierre:** `/coches?type=PRODUCT&minPrice=1000` responde redirect permanente a
  `/vehiculos/coches?type=PRODUCT&minPrice=1000`; `/vehiculos` y `/vehiculos/coches` renderizan;
  el sitemap lista las anidadas; ningún enlace interno apunta ya a la plana.

**RÁFAGA A2 — Unificación de búsqueda (ajuste 1)**

- Backend: `filterable` en `allAttributes` de `findTree` (aditivo).
- Front: `CategorySelect` compartido; regla de preservación de filtros (§3.2.2) en
  `lib/filter-carry.ts` + su test unitario; retirada del selector "Subcategoría";
  `/busqueda?category=X` → redirect permanente a la ruta canónica; formalizar `q` en la ruta
  de categoría; `CrearAlertaButton` también ahí (opcional).
- **Criterio de cierre:** desde `/busqueda?q=x&rooms=3&province=Madrid`, elegir "Coches" lleva a
  `/vehiculos/coches?q=x&province=Madrid` (**sin `rooms`, sin 400**); elegir "Todas" desde ahí
  vuelve a `/busqueda?q=x&province=Madrid`.

**RÁFAGA A3 — Panel de filtros schema-driven (ajuste 3)**

- Backend: `filterable/type/options/dependsOn/optionsByParent` en `toAttrDef`;
  soporte `_min`/`_max` para atributos `number` en parser + service (**o descartarlo**, §8 P4).
- Front: `FilterPanel` schema-driven con un control por tipo (F1-F6).
- **Criterio de cierre:** un atributo `filterable: true` de la categoría aparece **siempre**
  en el panel con su `label` y su `unit`; los numéricos como rango; los booleanos como Sí/No;
  los vinculados acotados por su padre.

### BLOQUE B

**RÁFAGA B1 — Modelo, herencia y CRUD admin**

- Migración `Tag` / `CategoryTag` / `ListingTag`; módulo `tags`; `resolveEffectiveTags` + spec;
  `GET /categories/:slug/tags` y `tags` en `GET /categories/:slug`; endpoints admin (catálogo +
  asignación por categoría); `maxTagsPerListing` en Settings; UI `/admin/tags` y
  `TagsEditorPanel` en `/admin/categorias`; semilla de tags de ejemplo en `seed.ts`.
- **Criterio de cierre:** un admin crea un tag, lo asigna a "Vehículos", y `GET
  /categories/coches/tags` lo devuelve por herencia.

**RÁFAGA B2 — Tags en el anuncio (wizard + validación + indexación)**

- `tags` en los DTOs; `validateTags`; escritura transaccional; disparador de revalidación en
  `update()`; `tags` en `GET /listings/:slug`; `ListingDocument.tags`/`tagNames`,
  `INDEX_INCLUDE`, `toDocument`, `CORE_FILTERABLE_ATTRIBUTES`, `SEARCHABLE_ATTRIBUTES`,
  reservados; `StepTags` en ambos wizards; tags visibles en la ficha.
- **Criterio de cierre:** publicar un anuncio con 3 tags → aparecen en la ficha y el documento
  de Meilisearch los lleva; intentar 6 con tope 5 → 422.

**RÁFAGA B3 — Filtrado por tags en búsqueda**

- `tags` en `CORE_SEARCH_QUERY_KEYS` + `SearchQueryDto` (CSV); filtro AND en `SearchService`;
  `tags` en `NATIVE_FACET_ATTRIBUTES`; sección "Etiquetas" en `FilterPanel` (multi-selección);
  `?tags=` incluido en la regla de preservación de filtros de A2.
- **Criterio de cierre:** `/vehiculos/coches?tags=diesel,garantia` devuelve solo anuncios con
  **ambos**; los chips reflejan el estado y los conteos.

**RÁFAGA B4 — Buscador de portada**

- `GET /tags/suggest` (Postgres + `searchForFacetValues` + caché Redis); `SearchBar` con
  debounce, desplegable de tags y salida de escape a texto libre; destino vía `categoryPath`.
- **Criterio de cierre:** escribir "auto" con "Coches" seleccionado sugiere los tags de coches
  que casan, con conteos, y elegir uno lleva a `/vehiculos/coches?tags=…`.

---

## 7. Compatibilidad: qué NO se rompe y cómo se verifica

| Riesgo | Por qué no se rompe | Verificación |
|---|---|---|
| **URLs de categoría indexadas por Google** | Regla "el último segmento manda" → toda URL vieja redirige permanentemente a la canónica, con query intacta | e2e: `/coches`, `/coches?type=PRODUCT&minPrice=1000`, `/inmuebles/coches` → 308 a la canónica |
| **Enlaces externos y bookmarks a `/busqueda?category=X`** | Redirect permanente a la canónica preservando el resto de la query | e2e |
| **Categorías raíz** | Su URL **no cambia** (`/vehiculos` sigue siendo `/vehiculos`) | e2e ya existente |
| **Contrato de `GET /search`** | **No cambia.** Se le **añaden** `tags` (opcional) y `_min`/`_max` (opcional). Toda query actual sigue válida | Specs existentes de `search-query.parser` y `filterable-attributes.resolver` deben pasar **sin tocar** |
| **Contrato de `GET /categories` y `/categories/:slug`** | Solo campos **aditivos** (`parent`, `parentSlug`, `filterable`, `type`, `options`, `tags`) | Specs de `categories.service` |
| **El 400 anti-leak cross-categoría** | Se conserva intacto. La solución del ajuste 1 filtra en cliente, no relaja el backend | Test de A2: cambiar de categoría **no** manda atributos ajenos |
| **Anuncios existentes** | `ListingTag` vacío. Ningún campo cambia. Tags nunca obligatorios | Specs de `listings.service` |
| **Anuncios ya indexados** | Un documento sin `tags` no casa con `tags = x`, que es lo correcto. Reindex recomendado, no obligatorio | Búsqueda sin `?tags=` devuelve lo mismo antes y después |
| **Atributos de categoría** | No se tocan. `tags`/`tagNames` entran en reservados para que ningún atributo colisione | Spec del resolver con un atributo llamado `tags` |
| **Wizard de categorías sin tags** | El paso `tags` desaparece, igual que hoy desaparece `atributos` | Spec de `PublicarWizard` |
| **Modo fallback (Meilisearch caído)** | No se toca. Sin facetas, sin filtros, sin tags — como hoy | e2e `categoria-meili` |
| **Alertas guardadas** | `Alert` no cambia. Las alertas no filtran por tags (fuera de alcance) | Specs de alerts |
| **Bajar `maxTagsPerListing`** | Solo se valida en escritura; los anuncios existentes se mantienen | Spec explícito de grandfathering |

**Verificación transversal recomendada antes de cerrar A1:** un script que recorra
`GET /categories`, construya la URL **vieja** de cada hija y compruebe que devuelve
redirect permanente a la nueva. Con el árbol sembrado son ~14 comprobaciones; con un catálogo
real, las que haya.

---

## 8. Preguntas abiertas (decidir antes de implementar)

**P1 — ¿308 o 301 literal?**
`permanentRedirect()` de Next emite **308**, que Google trata igual que un 301 y que es la
opción DB-truthful y de menor superficie. El brief pide "301". ¿Vale el 308 (recomendado), o
se quiere un 301 literal vía `middleware.ts` con un mapa slug→padre cacheado en memoria?

**P2 — URL incoherente: ¿redirigir o 404?**
Se propone que `/inmuebles/coches` **redirija** a `/vehiculos/coches` (el último segmento
manda). La alternativa es 404. Redirigir es mejor para SEO y para enlaces mal copiados; 404
es más estricto. ¿Se confirma redirigir?

**P3 — ¿`/busqueda?category=X` redirige?**
Se propone que sí (redirect permanente a la canónica). Unifica de verdad y evita contenido
duplicado. ¿Hay algún flujo — alertas, campañas, enlaces de terceros — donde interese que
`/busqueda?category=` siga renderizando en su sitio?

**P4 — Rango numérico (`_min`/`_max`): ¿dentro o fuera del ajuste 3?**
Hoy los atributos solo se filtran por **igualdad**. Un filtro de km o m² por valor exacto es
inútil. Añadir rangos es la mitad del trabajo de A3 y toca parser + service. ¿Entra en A3, sale
a una ráfaga propia, o se deja fuera de este hito?

**P5 — Formato de `?tags=` en la URL.**
Se recomienda **CSV** (`?tags=a,b`) porque respeta todos los helpers de un-valor-por-clave del
frontend actual. La alternativa (`?tags=a&tags=b`) es más canónica pero obliga a tocar `str()`
y `update()` en varios sitios. ¿Se confirma CSV?

**P6 — ¿El buscador de portada sugiere tags sin anuncios?**
Con el diseño Postgres-first se **puede** (útil para un catálogo joven, frustrante si el
usuario elige uno y ve 0 resultados). Opciones: (a) sugerirlos al final marcados con `(0)`,
(b) ocultarlos. Recomendación: **(a)**.

**P7 — ¿Un tag puede vivir sin categoría?**
El modelo lo permite (un `Tag` sin filas en `CategoryTag`). ¿Se ofrece globalmente en todas las
categorías, o simplemente no se ofrece en ninguna hasta asignarlo? Recomendación: **no se
ofrece hasta asignarlo** — es lo coherente con "config admin por categoría", y evita ruido.

**P8 — ¿Alertas por tags?**
`Alert` tiene columnas para cada criterio de búsqueda. Añadir `tags` sería coherente… y es una
ráfaga entera (columna, DTO, matching, UI de `/mis-alertas`, resumen). Se propone **dejarlo
fuera** de este hito y anotarlo como deuda consciente. ¿Se confirma?

**P9 — El bug del fallback de categoría padre.**
`findByCategory` filtra por slug exacto sin incluir hijas, así que con Meilisearch caído
`/vehiculos` muestra (probablemente) cero anuncios en vez de los de sus hijas. Es
preexistente y ajeno a esta ráfaga. ¿Se arregla de paso en A1 (es un `where` de tres líneas)
o se deja anotado?

**P10 — Fichas de anuncio en el sitemap.**
Tampoco están hoy. A1 toca el sitemap de todas formas. ¿Se aprovecha para añadirlas, o se
mantiene el alcance estricto?
