# Auditoría de viabilidad — La profundidad del árbol de categorías (2 → 4 niveles)

> **Qué es este documento.** Auditoría de **viabilidad y diseño-preliminar**. No implementa, no
> diseña en detalle, no resuelve las decisiones: las plantea con opciones y trade-off.
>
> **De qué parte.** De [`docs/mapa-categorias-y-ciclo-vida.md`](mapa-categorias-y-ciclo-vida.md),
> Bloque 1, que ya inventarió los ~33 puntos donde vive el «2» y estableció el hallazgo central:
> **la herencia es de un solo salto**. Aquí no se re-inventaría — se verifica en detalle lo que el
> diseño necesita y se responde al **cómo**.
>
> Fecha: 2026-08-11. Rama `rafaga-a-maquina-estados-cuota` (post-ráfaga A), commit `37ee0d1`.

---

## Índice

- [LA DECISIÓN ESTRUCTURANTE — 4 duro vs N configurable](#la-decisión-estructurante--4-duro-vs-n-configurable)
- [BLOQUE 1 — La herencia: de un salto a N niveles](#bloque-1--la-herencia-de-un-salto-a-n-niveles)
- [BLOQUE 2 — Búsqueda e índice](#bloque-2--búsqueda-e-índice)
- [BLOQUE 3 — El frontend (el mayor riesgo)](#bloque-3--el-frontend-el-mayor-riesgo)
- [BLOQUE 4 — Migración, decisiones y riesgos](#bloque-4--migración-decisiones-y-riesgos)
- [Verificación de completitud — los 33 puntos](#verificación-de-completitud--los-33-puntos)

---

# LA DECISIÓN ESTRUCTURANTE — 4 duro vs N configurable

**Va primero porque cambia el tamaño de todo lo demás. Pero el hallazgo de esta auditoría es que
lo cambia MUCHO MENOS de lo que parece**, y conviene decirlo antes de presentar el trade-off:

> El trabajo caro (recorrer la cadena de ancestros, plegar las 5 resoluciones sobre ella, reescribir
> el routing y los recorridos del frontend) es **idéntico en las dos opciones**. En el momento en
> que el código deja de mirar «el padre» y pasa a mirar «la cadena», ya está resolviendo N. El
> límite —sea 4, sea otro— es después **una comparación de longitud, una línea**.

## Las dos opciones

| | **(A) Límite duro 4** | **(B) N niveles, tope configurable** |
|---|---|---|
| Qué cambia en la herencia | La resolución debe subir hasta 4 → o un bucle, o `parent:{select:{parent:{select:{parent:…}}}}` anidado 3 veces en **cada uno de los 8 puntos de carga** | Un bucle sobre la cadena. **Una sola función** `getAncestorChain` |
| Coste del límite | Un `4` nuevo, cableado donde antes estaba el `2` | Una constante única (o un `Setting`), leída en un sitio |
| Trabajo real | ≈ el mismo que (B) — ver arriba | ≈ el mismo que (A) |
| Frontend | Idéntico en ambas (routing, migas, recorridos) | Idéntico |
| Reindexado | Idéntico | Idéntico |
| El próximo cambio (a 5, o a 3) | **Repite este proyecto** | Cambiar un número |
| Riesgo residual | Un número mágico nuevo repartido; si un sitio se queda en 2 y otro va a 4, la herencia se rompe **en silencio** | El tope vive en un dato; una resolución que no pliegue la cadena es un bug localizable |

**Por qué (A) no ahorra lo que promete, verificado contra el código.** La forma «barata» de (A)
sería anidar `select`s. Los 8 puntos de carga hacen hoy cosas como
[categories.service.ts:157-172](apps/api/src/modules/categories/categories.service.ts#L157-L172):

```
parent: { select: { slug, name, attributeSchema, allowedListingType, allowedViews, defaultView, allowedPriceUnits } }
```

Para 4 niveles eso son **tres anidamientos** de ese mismo bloque de 7 campos, en 8 sitios, cada uno
con su `?.` defensivo — más código, más frágil y más difícil de leer que el bucle, y **sigue siendo
un número mágico**. La versión legible de (A) es un bucle con `if (depth > 4) parar`, que es
literalmente (B) con el tope en duro.

**Dónde SÍ hay diferencia real, y es pequeña:** (B) invita a exponer el tope como `Setting`
editable, lo que añade la clave al whitelist, su validación y su lectura (§4.2 del mapa: 5 sitios,
3 ficheros). Eso es media hora, no un proyecto. Y hay un aviso del mapa que aplica: en este repo
**hay dos ajustes muertos** (`listingExpiryDays`, `contactRequiresVerification`) — un tope
configurable que nadie lee sería el tercero.

**Variante intermedia que merece estar sobre la mesa:** herencia N de verdad + tope como **constante
única exportada** (`MAX_CATEGORY_DEPTH = 4`), sin `Setting`. Elimina la clase de problema, deja el
número en un solo sitio, y no añade un ajuste que mantener. Es el molde que ya usa `NAV_MAX_DEPTH`
para el árbol del menú ([nav.service.ts:310-324](apps/api/src/modules/nav/nav.service.ts#L310-L324)),
que además **sí permite mover nodos** — el precedente más cercano que existe en el repo.

> **Decisión de Ernest.** No se resuelve aquí. Lo que esta auditoría aporta: (A) no es
> significativamente más barata, y su ahorro se paga con el mismo tipo de fragilidad que este
> proyecto viene a quitar.

**Todo lo que sigue está escrito para N**, porque la forma del trabajo es la misma; donde el tope
importe, se señala.

---

# BLOQUE 1 — La herencia: de un salto a N niveles

## 1.1 EL HALLAZGO: las 5 resoluciones YA tienen forma de pliegue

Es la mejor noticia de esta auditoría, y es verificable. Las cinco funciones tienen **la misma
firma**: `(propio, efectivoDelPadre) → efectivo`. Eso es exactamente la firma de un **reductor**.

Es decir: **no hay que reescribir sus cuerpos.** Hay que dejar de llamarlas UNA vez y pasar a
plegarlas sobre la cadena, de la raíz hacia la hoja.

```
efectivo = cadenaRaizAHoja.reduce((acc, nodo) => resolveX(nodo.propio, acc), semilla)
```

Verificación de que la semántica se conserva en cada una:

| Función | Línea | Regla actual | Al plegar raíz→hoja |
|---|---|---|---|
| `resolveEffectiveSchema` | [category.types.ts:65-73](apps/api/src/modules/categories/category.types.ts#L65-L73) | `[...heredados_sin_colisión, ...propios]`; el hijo pisa por `name` | El nieto pisa al hijo, que pisa al padre. **El más profundo gana**, que es lo esperado. Orden: ancestros primero, propios al final — se conserva la lógica de formulario |
| `resolveEffectivePolicy` | [:122-129](apps/api/src/modules/categories/category.types.ts#L122-L129) | `BOTH` es neutro; ante contradicción gana el padre, defensivamente | Se propaga sin cambios: una restricción de un ancestro sobrevive a los descendientes `BOTH` |
| `resolveEffectiveViews` | [:181-189](apps/api/src/modules/categories/category.types.ts#L181-L189) | Override COMPLETO: `[]` = no configurado → hereda | El primer ancestro configurado desde la hoja hacia arriba gana. Correcto |
| `resolveEffectivePriceUnits` | [:218-224](apps/api/src/modules/categories/category.types.ts#L218-L224) | Ídem | Ídem |
| `resolveEffectiveTags` | [tag.types.ts:36-39](apps/api/src/modules/tags/tag.types.ts#L36-L39) | Unión; **propios PRIMERO** (orden de sugerencia) | Plegando, el resultado queda hoja → padre → abuelo → raíz: «lo más específico primero», que es exactamente la generalización de la regla actual |

**Semántica multinivel a decidir (no se resuelve aquí):** los cinco casos de arriba describen
«**cada nivel sobreescribe al ancestro**». Es la extrapolación natural y la que conserva el
comportamiento actual con 2 niveles. La alternativa —**acumular** (un nieto no puede quitar lo que
puso el abuelo)— no tiene ningún precedente en el código actual y cambiaría el significado con 2
niveles, así que sería un cambio de producto, no una generalización.

⚠️ **Un punto que sí cambia y hay que mirar:** el patrón de «resolución en dos pasos» que hoy
escriben los llamantes a mano —el padre resuelve contra `null`, luego el hijo contra el efectivo
del padre, [categories.service.ts:191-211](apps/api/src/modules/categories/categories.service.ts#L191-L211)
y [listings.service.ts:1500-1503](apps/api/src/modules/listings/listings.service.ts#L1500-L1503)—
**desaparece**: lo sustituye el pliegue con semilla `null`. Si un sitio conserva el two-step y otro
pliega, ese sitio hereda de un solo nivel **en silencio**. Es el riesgo nº 1 del proyecto (§4.3).

## 1.2 Los 8 puntos de carga: la centralización

Hoy cada uno emite su propia consulta con un `parent` de un nivel (mapa §1.2). Para N necesitan la
**cadena**. La pregunta del encargo —¿se puede centralizar?— tiene respuesta clara: **sí, y el
molde ya existe en el repo**.

### Las tres formas de obtener la cadena

**(a) Árbol completo en memoria, memoizado. ← el molde ya está escrito.**

`FilterableAttributesResolver` **ya carga TODAS las categorías en una sola consulta y las memoiza**
— [filterable-attributes.resolver.ts:151-164](apps/api/src/modules/search/filterable-attributes.resolver.ts#L151-L164):

```
this.prisma.category.findMany({ select: { slug, attributeSchema, parent: { select: { slug } } } })
```

…con invalidación explícita ya cableada tras editar una categoría
([:147-149](apps/api/src/modules/search/filterable-attributes.resolver.ts#L147-L149), disparada
desde [admin.service.ts:1071-1073](apps/api/src/modules/admin/admin.service.ts#L1071-L1073)).

- **Coste: 1 consulta, y la cadena se construye en memoria en O(profundidad).** Cero consultas por
  resolución. Las categorías son decenas de filas, no millones — es el mismo razonamiento que ya
  justifica cachear el vocabulario de tags entero ([tags.service.ts:113](apps/api/src/modules/tags/tags.service.ts#L113)).
- Limitación conocida y ya documentada: la memoización es **por proceso**; un despliegue
  multi-instancia necesitaría pub/sub ([:143-145](apps/api/src/modules/search/filterable-attributes.resolver.ts#L143-L145)).
  Es deuda **preexistente**, no la introduce este proyecto.

**(b) Materialized path / `ancestorIds` en `Category`.** Desnormalización.

- A favor: permite filtrar descendientes **en SQL** sin recursión — resuelve de un golpe el fallback
  de Postgres (§2.4) y `deleteCategory`.
- En contra: hay que mantenerlo. Hoy sería casi gratis porque **`parentId` es inmutable**
  (`UpdateCategoryDto` no lo admite, mapa §1.1) — pero si la profundidad se vuelve configurable, es
  muy probable que se quiera «mover una rama», y ahí el mantenimiento del path es real.
- Nota: **ya existe un path materializado, pero en Meilisearch** (`categoryPath` en el documento),
  no en Postgres.

**(c) CTE recursiva (`$queryRaw`).** Una consulta, sin desnormalizar. Precedente de raw SQL en el
repo: [admin.service.ts:1141](apps/api/src/modules/admin/admin.service.ts#L1141),
[billing.service.ts:650](apps/api/src/modules/billing/billing.service.ts#L650). En contra: se sale
del tipado de Prisma y hay que escribirla bien; y si ya tienes (a), no aporta.

**Lo que NO conviene:** subir la cadena con una consulta por nivel. 4 niveles = 4 viajes por
resolución, y `create()`/`update()` de anuncio resuelven en la ruta caliente de publicación.

### La forma de la centralización

Un único lector — molde `bump-cooldown.ts` («la ventana se define donde se aplica y se sirve ya
resuelta»):

```
getAncestorChain(categoryId): CategoryNode[]   // [raíz, …, hoja]
getDescendantIds(categoryId): string[]         // para filtros y facetas
getDepth(categoryId): number                   // para la guarda de creación
```

Sobre esa base, las 5 resoluciones se sirven ya plegadas. **Lo que hoy hay son 13 sitios subiendo
un nivel cada uno a su manera; lo que debe quedar es un lector y 13 consumidores.**

⚠️ **Riesgo de ciclo de módulos, verificado.** `FilterableAttributesResolver` vive en `SearchModule`.
Si la centralización se hiciera dentro de él, `ListingsModule` y `AdminModule` tendrían que importar
`SearchModule` (hoy `AdminModule` **ya** lo importa, `ListingsModule` **no**). Lo limpio es un
`CategoryTreeService` en `CategoriesModule` —dependencia natural, ya la importa quien la necesita—
y que el resolver de búsqueda pase a consumirlo en vez de tener su propia copia del árbol. Eso
además **borra una duplicación que ya existe hoy**.

---

# BLOQUE 2 — Búsqueda e índice

## 2.1 `categoryPath`: el filtro YA es N-ready

**Segundo mejor hallazgo.** El filtro por categoría **no necesita ningún cambio**:

```
filters.push(`categoryPath = "${slug}"`)   // search.service.ts:400
```

Meilisearch evalúa esto sobre un array como «¿contiene este valor?». Con un `categoryPath` de 4
elementos, filtrar por la raíz sigue devolviendo todos sus descendientes — **sin tocar una línea del
filtro**. Lo confirma el propio doc del proyecto (estado-tecnico, §«categoryPath jerárquico»).

**Lo único que cambia es la CONSTRUCCIÓN del documento** —
[search.service.ts:513-516](apps/api/src/modules/search/search.service.ts#L513-L516):

```
categoryPath: [ listing.category.slug, ...(parent ? [parent.slug] : []) ]   // hoy: 1 o 2
                ↓
categoryPath: [ hoja, ...ancestrosDeAbajoAArriba ]                          // N
```

…alimentado por `getAncestorChain` (§1.2), no por `INDEX_INCLUDE`.

## 2.2 `INDEX_INCLUDE`: es el sitio que ya avisa de esto

[search.service.ts:186-196](apps/api/src/modules/search/search.service.ts#L186-L196) lleva escrita
la receta desde antes de este proyecto:

> *"If the category tree ever grows to 3+ levels the include must walk further up the chain
> (parent.parent…) and `toDocument` must build the full ancestor array instead of checking only one
> level."*

Con la centralización, la mejor versión es **no anidar `select`s**: quitar `parent` del include y
que `toDocument` pida la cadena al servicio de árbol. Detalle que importa: `INDEX_INCLUDE` se
exporta a propósito para que el processor y `pnpm reindex` usen **exactamente el mismo include**
([:188-191](apps/api/src/modules/search/search.service.ts#L188-L191)) — si uno construyera el path
con la cadena y otro con el `parent`, el mismo anuncio tendría documentos distintos según por dónde
se indexara. **Ese invariante hay que conservarlo.**

## 2.3 El reindexado: menos urgente de lo que parece

- Hace falta un reindexado completo cuando cambie la forma de `categoryPath`. El comando existe:
  `pnpm reindex` hace `clearAll()` + repoblar, con `waitForTask` para que el documento sea
  **consultable** antes de dar por hecho el trabajo ([:354-359](apps/api/src/modules/search/search.service.ts#L354-L359)).
- **Punto de des-riesgo:** para las categorías actuales (1-2 niveles) el `categoryPath` calculado
  con el algoritmo nuevo es **byte-idéntico** al actual. Es decir: el despliegue no rompe nada
  aunque el reindexado tarde, y solo es imprescindible **una vez existan categorías de nivel ≥3**.
  Eso permite desplegar el backend y reindexar después, sin ventana de inconsistencia.

## 2.4 Los dos sitios de búsqueda que SÍ se rompen si se olvidan

**(1) El fallback de Postgres** — [listings.service.ts:941-946](apps/api/src/modules/listings/listings.service.ts#L941-L946):

```
category: { OR: [{ slug: categorySlug }, { parent: { slug: categorySlug } }] }
```

Es el equivalente SQL de `categoryPath` para cuando Meili no responde, y **no escala**: con 4
niveles, navegar una raíz dejaría fuera a los nietos y bisnietos. Ya hay un test dedicado a que el
fallback reproduzca lo que reemplaza (`category-listings-fallback.e2e-spec.ts`), lo que es una
buena red. Opciones: `categoryId: { in: getDescendantIds(...) }` (limpio, usa la centralización) o
un `OR` anidado de profundidad N (feo y con el número dentro).

**(2) `FilterableAttributesResolver.mergeSchemasForCategory`** —
[filterable-attributes.resolver.ts:117-137](apps/api/src/modules/search/filterable-attributes.resolver.ts#L117-L137).
Sube un nivel **y baja un nivel**:

- Para una HOJA: propio + padre → debe ser **propio + toda la cadena**.
- Para un PADRE: propio + cada hija → debe ser **propio + todos los DESCENDIENTES**, porque navegar
  una categoría de nivel 2 mezcla anuncios de niveles 3 y 4, y un atributo de bisnieto es un filtro
  legítimo ahí.

Si esto se queda a un nivel, el síntoma es el bug que la RÁFAGA 1 ya arregló una vez: un filtro
legítimo devuelve **400** o desaparece de la UI, sin explicación.

## 2.5 Migas / breadcrumbs

Backend: `findBySlug` devuelve hoy `parent: { slug, name } | null`
([categories.service.ts:220-222](apps/api/src/modules/categories/categories.service.ts#L220-L222)).
Para N debe devolver la **cadena** (`ancestors: [{slug,name}, …]`).

**Puede ser aditivo:** dejar `parent` (el ancestro inmediato) y añadir `ancestors`. Eso evita romper
consumidores durante la migración — y hay uno concreto que lo agradece: la ficha se cachea 5 min en
Redis, así que tras desplegar hay respuestas servidas **sin** el campo nuevo
([listings.service.ts:75-78](apps/api/src/modules/listings/listings.service.ts#L75-L78)), y el
frontend ya está escrito para degradar cuando el dato falta. Mismo criterio para el `LISTING_INCLUDE`
de la ficha ([:79-81](apps/api/src/modules/listings/listings.service.ts#L79-L81)).

Frontend: `trail` pasa de `[padre?, actual]` a `[...ancestros, actual]`
([CategoryListingPage.tsx:371-376](apps/web/src/components/categorias/CategoryListingPage.tsx#L371-L376)).
El JSON-LD sale del **mismo** `trail`, así que se generaliza solo — invariante que conviene conservar.

---

# BLOQUE 3 — El frontend (el mayor riesgo)

13 de los 33 puntos, y es donde se rompe algo **visible**. Se trata aquí con detalle.

## 3.1 El routing de Next

**Hoy** (verificado): dos rutas fijas —
[`(public)/[categoria]/page.tsx`](apps/web/src/app/(public)/[categoria]/page.tsx) y
[`(public)/[categoria]/[subcategoria]/page.tsx`](apps/web/src/app/(public)/[categoria]/[subcategoria]/page.tsx)—
que comparten cuerpo (`CategoryListingPage`) y solo deciden de qué segmentos se compone la ruta. El
comentario de la segunda lo dice: *"Dos segmentos y no más: el árbol tiene exactamente 2 niveles,
así que /a/b/c no casa con ninguna ruta y sigue dando el 404 real del router"*.

| Opción | Valoración |
|---|---|
| **Catch-all `[...ruta]`** | Una sola ruta para cualquier profundidad. Es lo natural para N |
| **4 rutas fijas anidadas** | Funciona sin sorpresas y conserva el 404 del router, pero son 4 ficheros casi idénticos y **vuelve a cablear el número** en la estructura de carpetas |

⚠️ **El riesgo concreto del catch-all: los soft 404.** Hoy `/a/b/c` **no casa con ninguna ruta** y
Next devuelve un 404 real. Con catch-all, `/a/b/c` **sí casa**, llega al componente, y si este no
llama a `notFound()` explícitamente el servidor responde **200 con una página de "no encontrado"**.
Para un crawler eso es una página válida — exactamente la clase de problema de SEO que la ráfaga A1
de categorías (el 308) vino a cerrar. Mitigación: `notFound()` obligatorio cuando el último segmento
no resuelve, **y un test que compruebe el código HTTP, no el contenido**.

⚠️ **Segundo efecto del catch-all: la lista de slugs reservados pasa a ser crítica.** Hoy
`RESERVED_ROOT_SLUGS` (backend, [admin.service.ts:159-169](apps/api/src/modules/admin/admin.service.ts#L159-L169))
y su espejo `RESERVED_FIRST_SEGMENTS` (frontend, [category-canonical.ts:37-43](apps/web/src/lib/category-canonical.ts#L37-L43))
existen porque una categoría raíz llamada `blog` sería inalcanzable. Con catch-all el segmento
estático sigue ganando (Next resuelve el literal antes que el dinámico), así que el comportamiento
no empeora — pero **las dos listas son espejo manual y ya pueden divergir hoy**. Vale la pena
mirarlas en el mismo proyecto.

## 3.2 SEO: qué URLs cambian — la respuesta corta es *ninguna*

Esto es lo que más preocupaba y la conclusión es tranquilizadora, verificada:

- La forma canónica es «cadena completa de ancestros»:
  `categoryPath()` hace `parentSlug ? '/{padre}/{slug}' : '/{slug}'`
  ([category-url.ts:35-37](apps/web/src/lib/category-url.ts#L35-L37)).
- Generalizado a N: `'/' + [...ancestros, slug].join('/')`.
- **Para las categorías que existen hoy (1-2 niveles), esa fórmula produce exactamente la misma
  URL.** `/vehiculos` sigue siendo `/vehiculos`; `/vehiculos/coches` sigue siendo `/vehiculos/coches`.

**Ninguna URL existente cambia mientras nadie re-parente una categoría.** Y re-parentar hoy **no es
posible**: `UpdateCategoryDto` no admite `parentId` (mapa §1.1). Si este proyecto añadiera «mover
una rama», ahí sí nacería un problema de redirects — y merece ser una decisión aparte (§4.2).

**Y el mecanismo de canonicalización ya generaliza solo.** `resolveCategoryRedirect`
([category-canonical.ts:111-127](apps/web/src/lib/category-canonical.ts#L111-L127)) implementa una
regla que no depende de la profundidad: *"manda el ÚLTIMO segmento"* — resuelve la categoría por él,
reconstruye la canónica y compara. Para N solo hacen falta dos cambios mecánicos:

1. `MAX_CATEGORY_SEGMENTS = 2` → el tope nuevo ([:45-47](apps/web/src/lib/category-canonical.ts#L45-L47)).
2. El mapa `slug → padre` ([:84-87](apps/web/src/lib/category-canonical.ts#L84-L87)) → `slug → cadena`.

La regla en sí **no se toca**, y sigue cubriendo de un golpe la URL plana vieja, el padre incoherente
y el padre inexistente. Es el punto mejor preparado de todo el frontend.

## 3.3 `categoryPath()` y `CategoryUrlParts`: el cambio de tipo que se propaga

`CategoryUrlParts` es `{ slug, parentSlug? }` y es la **fuente única** de la URL de categoría — con
una regla de proyecto explícita de que nadie construye `/${slug}` a mano, porque antes había 11
sitios que lo hacían ([category-url.ts:5-9](apps/web/src/lib/category-url.ts#L5-L9)).

Para N el tipo necesita la cadena (`ancestorSlugs: string[]`). Eso toca a todos los consumidores.
**Mitigación barata:** aceptar los dos y derivar —`ancestorSlugs ?? (parentSlug ? [parentSlug] : [])`—
para poder migrar los consumidores uno a uno sin un big-bang, y con el mismo espíritu «degrada, no
revienta» que ya tiene la función hoy para payloads cacheados sin `parentSlug`
([:27-34](apps/web/src/lib/category-url.ts#L27-L34)).

De dónde sale la cadena: hoy `findTree` inyecta `parentSlug: root.slug` en cada hija
([categories.service.ts:120-125](apps/api/src/modules/categories/categories.service.ts#L120-L125))
precisamente para que ningún consumidor tenga que recorrer el árbol al revés. **Ese mismo criterio
generaliza**: que el backend inyecte `ancestorSlugs` en cada nodo.

## 3.4 Los recorridos del árbol: todos tienen la misma forma

Cinco ficheros hacen «raíz + un nivel de hijas» y pasan a ser recursivos. Es trabajo mecánico y
repetitivo, pero **conceptualmente idéntico**:

| Fichero | Patrón actual | Pasa a ser |
|---|---|---|
| [filter-carry.ts:99-111, 144-155](apps/web/src/lib/filter-carry.ts#L99-L111) | Busca el destino en raíz/hija; si es raíz, añade lo de sus hijas | Busca en todo el árbol; añade lo de **todos los descendientes** |
| [card-attributes.ts:45-54, 62-73, 99-108](apps/web/src/lib/card-attributes.ts#L45-L54) | 3 mapas `slug→atributos` con doble bucle | Un walker recursivo, 3 usos |
| [filterable-fields.ts:80-86, 101-116](apps/web/src/lib/filterable-fields.ts#L80-L86) | Unión raíz + hijas | Unión sobre descendientes |
| [available-tags.ts:39, 56-58](apps/web/src/lib/available-tags.ts#L39) | Ídem con tags | Ídem |
| [sitemap.ts:102-113](apps/web/src/app/sitemap.ts#L102-L113) | `flatMap(root => [root, ...children])` | Walker recursivo |
| [category-url.ts:59-70](apps/web/src/lib/category-url.ts#L59-L70) `findCategoryUrlParts` | Doble bucle | Búsqueda recursiva que devuelve la cadena |

**Oportunidad:** los seis quieren lo mismo (`descendientesDe(slug)`, `buscarEnArbol(slug)`,
`recorrerArbol()`). Un `lib/category-tree.ts` con 3 helpers evita seis recursiones distintas —
mismo argumento que `getAncestorChain` en el backend.

✅ **Sin cambios:** el tipo público `Category` en [types/index.ts:156](apps/web/src/types/index.ts#L156)
ya declara `children?: Category[]`, **recursivo**. El tipo aguanta N; lo que no aguanta es el código
que lo recorre.

## 3.5 ⚠️ `CategorySelect`: una limitación de HTML, no de código

[CategorySelect.tsx:62-73](apps/web/src/components/busqueda/CategorySelect.tsx#L62-L73) usa
`<optgroup>` con `<option>` dentro.

**`<optgroup>` no se puede anidar: el estándar HTML no lo permite.** Un `<select>` nativo expresa
como mucho **dos niveles** de agrupación. Esto no se arregla escribiendo mejor el componente.

Opciones (decisión de producto, no técnica): opciones planas con sangría por caracteres o `padding`;
dos selects en cascada; o sustituirlo por un combobox. Es el único punto de los 33 donde el
obstáculo **no es el código sino el widget**, y por eso se señala aparte.

(Su helper `findTarget` [:80-93](apps/web/src/components/busqueda/CategorySelect.tsx#L80-L93) es un
doble bucle más, que se resuelve con el walker común de §3.4.)

## 3.6 El backoffice de categorías

Es el punto con más superficie del frontend, y hoy tiene **el árbol de 2 niveles escrito en el JSX**:
un bucle de raíces y, dentro, un bucle de hijas
([page.tsx:895-1005](apps/web/src/app/(admin)/admin/categorias/page.tsx#L895-L1005)).

| Punto | Hoy | Para N |
|---|---|---|
| Render de filas | Dos bucles anidados a mano, `indent: boolean` ([:401-404](apps/web/src/app/(admin)/admin/categorias/page.tsx#L401-L404)) | Componente **recursivo**; `indent` pasa de booleano a **nivel** |
| «Nueva subcategoría» | Solo en la fila raíz ([:992-1001](apps/web/src/app/(admin)/admin/categorias/page.tsx#L992-L1001)) — es lo que impide el 3.er nivel en la UI | En cualquier fila cuya profundidad < tope. **Aquí es donde el tope se ve** |
| Herencia mostrada al crear | Hardcodea *"Parent is a root category → its effective schema = its own schema"* ([:664](apps/web/src/app/(admin)/admin/categorias/page.tsx#L664)) | Debe resolver la **cadena** del padre elegido — si no, el admin ve un «heredarás X» falso |
| Reordenar | `moveRoot` + `moveChild`, dos funciones ([:755-777](apps/web/src/app/(admin)/admin/categorias/page.tsx#L755-L777)) | Una sola: reordenar **entre hermanos**, sea cual sea el nivel |
| `nextOrderFor` | Hermanos = raíces o `children` del padre ([:671-677](apps/web/src/app/(admin)/admin/categorias/page.tsx#L671-L677)) | Hermanos = hijos del padre, genérico |
| Tipo del cliente | `children: AdminCategoryChild[]` — el hijo **no** tiene `children` ([lib/api/admin.ts:215](apps/web/src/lib/api/admin.ts#L215)) | Tipo recursivo |
| Panel de schema | `buildSchemaPanel(cat, children)` — comentario: *"la única que puede tener hijas en el modelo de 2 niveles"* ([:803-805](apps/web/src/app/(admin)/admin/categorias/page.tsx#L803-L805)) | Cualquier nodo puede tener hijas |

Y en el backend, `AdminService.getCategories` ([admin.service.ts:506-542](apps/api/src/modules/admin/admin.service.ts#L506-L542))
devuelve `parentId: null` + un nivel de `children`: **un nieto sería invisible en el backoffice**.
Es el mismo síntoma que `assertParentIsRoot` documenta ([:852-869](apps/api/src/modules/admin/admin.service.ts#L852-L869)).

---

# BLOQUE 4 — Migración, decisiones y riesgos

## 4.1 Migración de datos: aditiva, y puede que inexistente

- **Las categorías actuales (1-2 niveles) siguen siendo válidas.** Un árbol de 2 niveles es un caso
  particular de uno de N. No hay dato que arreglar.
- **Sin migración de BD** si se elige la opción (a) del §1.2 (árbol en memoria). El modelo ya admite
  N: `parentId` es una auto-relación sin tope, sin `CHECK`, con `@@index([parentId])` (mapa §1.1).
- **Con migración aditiva** si se elige (b) materialized path: columna nueva + backfill. Aun así es
  aditiva y reversible.
- **Meilisearch:** reindexado necesario, pero **no urgente** — para los datos actuales el documento
  nuevo es idéntico al viejo (§2.3).
- ⚠️ **La guarda que hay que sustituir, no borrar.** `assertParentIsRoot`
  ([admin.service.ts:870-881](apps/api/src/modules/admin/admin.service.ts#L870-L881)) pasa a
  `assertMaxDepth`. Si se elimina sin sustituto, el árbol queda **sin tope ninguno** y vuelve el
  problema que esa guarda cerró: nodos invisibles y herencia perdida en silencio. El molde exacto ya
  existe: `NavService.assertMaxDepth` + `assertNoCycle`
  ([nav.service.ts:310-324](apps/api/src/modules/nav/nav.service.ts#L310-L324)).

## 4.2 Las decisiones (con opciones, sin resolver)

| # | Decisión | Opciones | Nota de esta auditoría |
|---|---|---|---|
| **D1** | **4 duro vs N configurable** | (A) tope 4 cableado · (B) N + constante única · (C) N + `Setting` | El trabajo es ≈ el mismo (ver arriba). (C) añade el riesgo del «ajuste muerto» que el mapa ya documentó dos veces |
| **D2** | Semántica multinivel | **Sobreescribe** (cada nivel pisa al ancestro) · Acumula | Sobreescribir es la extrapolación que conserva el comportamiento actual; acumular sería un cambio de producto |
| **D3** | Cómo cargar ancestros | (a) árbol en memoria memoizado · (b) materialized path · (c) CTE | (a) tiene molde escrito y cuesta 1 consulta. (b) resuelve además el fallback SQL y el borrado |
| **D4** | Routing frontend | Catch-all `[...ruta]` · 4 rutas fijas | El catch-all obliga a `notFound()` explícito o aparecen **soft 404** |
| **D5** | Tope de creación en el admin | Fijo · Configurable · Por rama | Es donde el tope se hace visible (botón «Nueva subcategoría») |
| **D6** | ¿Se permite **mover** una categoría de padre? | No (como hoy) · Sí | **Fuera del encargo, pero conviene decidirlo explícitamente**: hoy es imposible, y es justo lo que haría necesarios los redirects de SEO. Si se dice «no», el riesgo SEO de este proyecto es **cero** |
| **D7** | Contrato de la API de categorías | Aditivo (`parent` + `ancestors`) · Sustitutivo | Aditivo permite desplegar sin coordinar frontend, y encaja con las respuestas cacheadas 5 min |

## 4.3 Riesgos, por gravedad

**R1 — Herencia rota en silencio (el más grave).** Si uno de los 33 puntos se queda subiendo un
nivel, no hay error: simplemente un atributo heredado no aparece, o un filtro deja de existir. Es
exactamente el fallo que `assertParentIsRoot` documenta haber visto («desaparecía por completo de
`GET /categories`… en silencio, sin error»). Mitigaciones concretas:
- La **centralización** (§1.2) reduce la superficie de 13 lugares a 1.
- Un test de árbol de **4 niveles de verdad** en el seed de test, ejercido de punta a punta
  (atributos heredados del bisabuelo, filtros, URL, miga). Sin ese fixture, ningún test ve el bug.
- Grep de cierre: que no quede ni un `parent: {` de un nivel ni un `children` sin recursión.

**R2 — Soft 404 en el catch-all (SEO).** §3.1. Mitigación: `notFound()` explícito + test del código
HTTP.

**R3 — Rendimiento de la resolución.** Solo si se implementa mal (una consulta por nivel). Con (a)
son 0 consultas extra. Ojo: la resolución está en la ruta caliente de `create()`/`update()` de
anuncio, no de búsqueda — y **las búsquedas no tocan nada de esto**: `SearchService` no tiene una
sola llamada a `this.prisma` (verificado en la auditoría de la puerta, §2.7).

**R4 — Reindexado.** Acotado y ya desriesgado (§2.3): el documento no cambia para los datos actuales.

**R5 — SEO de URLs.** **Cero si D6 = «no se mueven categorías»** (§3.2). Si se permite mover, hace
falta un plan de redirects — y ahí sí conviene el materialized path, para saber qué URLs cambiaron.

**R6 — `<optgroup>`.** §3.5. No es un riesgo de rotura sino de diseño: hay que decidir el widget.

---

# Verificación de completitud — los 33 puntos

Cruce uno a uno contra el mapa §1.9. **Ninguno queda sin plan.**

### Guarda (1)

| # | Punto | Plan |
|---|---|---|
| 1 | `assertParentIsRoot` [admin.service.ts:870-881](apps/api/src/modules/admin/admin.service.ts#L870-L881) | **Se sustituye** por `assertMaxDepth` (molde `NavService`). No se borra (§4.1) |

### Resolución de herencia (5)

| # | Punto | Plan |
|---|---|---|
| 2 | `resolveEffectiveSchema` | **Cuerpo sin cambios.** Se pliega sobre la cadena (§1.1) |
| 3 | `resolveEffectivePolicy` | Ídem |
| 4 | `resolveEffectiveViews` | Ídem |
| 5 | `resolveEffectivePriceUnits` | Ídem |
| 6 | `resolveEffectiveTags` | Ídem |

### Puntos de carga (8)

| # | Punto | Plan |
|---|---|---|
| 7 | `findTree` [categories.service.ts:43-54](apps/api/src/modules/categories/categories.service.ts#L43-L54) | **Se reescribe**: árbol recursivo + inyectar `ancestorSlugs` (§3.3) |
| 8 | `findBySlug` [:157-172](apps/api/src/modules/categories/categories.service.ts#L157-L172) | **Se reescribe** a cadena; respuesta aditiva `ancestors` (D7, §2.5) |
| 9 | `ListingsService.create` [:182-185](apps/api/src/modules/listings/listings.service.ts#L182-L185) | **Se centraliza**: pide la cadena y pliega |
| 10 | `ListingsService.update` [:292-295](apps/api/src/modules/listings/listings.service.ts#L292-L295) | Ídem |
| 11 | `validateCardAttributeLimitByType` [admin.service.ts:558-565](apps/api/src/modules/admin/admin.service.ts#L558-L565) | Ídem (efectivo = cadena completa) |
| 12 | `assertCardAttributeChangeDoesNotBreakChildren` [:676-679](apps/api/src/modules/admin/admin.service.ts#L676-L679) | **Se reescribe**: hijas directas → **todos los descendientes** (editar la raíz afecta al bisnieto) |
| 13 | `assertNoRangeSuffixCollision` [:609-624](apps/api/src/modules/admin/admin.service.ts#L609-L624) | **Se reescribe**: ámbito = cadena de ancestros + todos los descendientes |
| 14 | `FilterableAttributesResolver.mergeSchemasForCategory` [:117-137](apps/api/src/modules/search/filterable-attributes.resolver.ts#L117-L137) | **Se reescribe** (§2.4). Su `loadCategories` es candidato a **ser** la centralización |

### Búsqueda / indexado (3)

| # | Punto | Plan |
|---|---|---|
| 15 | `INDEX_INCLUDE` [search.service.ts:197-205](apps/api/src/modules/search/search.service.ts#L197-L205) | **Se reescribe**: quitar `parent`, la cadena la da el servicio de árbol (§2.2) |
| 16 | Construcción de `categoryPath` [:513-516](apps/api/src/modules/search/search.service.ts#L513-L516) | **Se reescribe** a la cadena completa. **El filtro NO se toca** (§2.1) |
| 17 | Fallback Postgres [listings.service.ts:941-946](apps/api/src/modules/listings/listings.service.ts#L941-L946) | **Se reescribe** a `categoryId in descendientes` (§2.4) |

### Otros consumidores backend (3)

| # | Punto | Plan |
|---|---|---|
| 18 | `sponsored-ads.service.ts:52-68` | **Se reescribe**: `[cat, parent]` → cadena de ancestros |
| 19 | `tags.service.ts:86-90, 203-209, 475-480` | **Se reescribe**: `[id, parentId]` → ids de la cadena. Ojo a la caché Redis por slug (invalidar) |
| 20 | `AdminService.getCategories` [:506-542](apps/api/src/modules/admin/admin.service.ts#L506-L542) · `assertPolicyChangeDoesNotBreakChildren` [:762-795](apps/api/src/modules/admin/admin.service.ts#L762-L795) · `assertPriceUnitsChangeDoesNotBreakListings` [:823-850](apps/api/src/modules/admin/admin.service.ts#L823-L850) | **Se reescriben**: árbol recursivo el primero; los dos guards, de hijas directas a **descendientes** (si no, restringir una raíz deja huérfanos a los nietos sin avisar) |

### Frontend (13)

| # | Punto | Plan |
|---|---|---|
| 21 | `category-url.ts` | **Se reescribe** `categoryPath` (join de la cadena) + `findCategoryUrlParts` recursivo; `CategoryUrlParts` acepta ambos durante la migración (§3.3) |
| 22 | `category-canonical.ts` | **Cambio mínimo**: `MAX_CATEGORY_SEGMENTS` y el mapa `slug→cadena`. **La regla del 308 no se toca** (§3.2) |
| 23 | Rutas `[categoria]/[subcategoria]` | **Se reescribe** — D4. Con `notFound()` explícito (R2) |
| 24 | `sitemap.ts:102-113` | **Se reescribe**: walker recursivo |
| 25 | Miga de `CategoryListingPage` [:371-376](apps/web/src/components/categorias/CategoryListingPage.tsx#L371-L376) | **Se reescribe**: `trail` = cadena. JSON-LD sale del mismo `trail` (§2.5) |
| 26 | Miga de la ficha [anuncio/[slug]/page.tsx:113-120](apps/web/src/app/(public)/anuncio/[slug]/page.tsx#L113-L120) | Ídem, alimentada por `LISTING_INCLUDE` |
| 27 | `filter-carry.ts` | **Se reescribe** con el walker común (§3.4) |
| 28 | `card-attributes.ts` | Ídem |
| 29 | `filterable-fields.ts` | Ídem |
| 30 | `available-tags.ts` | Ídem |
| 31 | `CategorySelect.tsx` | **Decisión de widget** — `<optgroup>` no anida (§3.5) |
| 32 | `CategoryCarouselHomeBlockRenderer` + `SearchTableHomeBlockRenderer` | **Se reescriben**: `flatMap(c => [c, ...children])` → walker recursivo |
| 33 | `/admin/categorias/page.tsx` | **Se reescribe**: componente recursivo, botón por nivel, herencia real al crear, un solo reorder (§3.6) |

### Puntos que NO necesitan cambio (confirmados)

- El **modelo Prisma**: ya admite N (§4.1).
- El **filtro de Meilisearch** `categoryPath = "slug"`: ya es N-ready (§2.1).
- El **tipo `Category`** del frontend: ya es recursivo ([types/index.ts:156](apps/web/src/types/index.ts#L156)).
- La **regla** de `resolveCategoryRedirect`: independiente de la profundidad (§3.2).
- Los **cuerpos de las 5 funciones** de resolución: ya tienen forma de pliegue (§1.1).
- La **ruta de lectura de búsqueda**: `SearchService` no toca Postgres (R3).

---

# Resumen ejecutivo

**Viabilidad: alta, con más superficie que dificultad.** No hay ningún obstáculo estructural: el
modelo ya admite N niveles, el filtro de Meili ya es N-ready, la regla del 308 ya generaliza, el
tipo del frontend ya es recursivo, y —lo más importante— **las cinco funciones de resolución ya
tienen forma de pliegue, así que sus cuerpos no cambian**. Lo que hay es mucho punto que tocar (33),
casi todo mecánico y repetitivo.

**Lo que de verdad decide el tamaño no es 4-vs-N** (el trabajo es ≈ el mismo), sino **si se
centraliza**. Con un `getAncestorChain` único, la mitad de los 33 puntos pasan a ser consumidores de
una función. Sin él, son 13 recursiones distintas y R1 (herencia rota en silencio) se vuelve casi
seguro.

**El riesgo mayor no es el que parecía.** El SEO —la preocupación de partida— resulta ser **cero
mientras no se puedan mover categorías de padre**, cosa que hoy es imposible y que conviene decidir
explícitamente (D6). El riesgo real es **R1: una resolución que se quede subiendo un nivel**, que no
da error y solo se ve como «falta un atributo». Su mitigación no es código sino **un fixture de
prueba con 4 niveles de verdad** — sin él, ningún test puede ver el fallo.

**Sobre el orden respecto a la puerta de validación:** si la puerta acaba revalidando atributos
(decisión D2 de aquella auditoría), llama a `resolveEffectiveSchema` — así que **la profundidad
primero** evita rehacerla. Si la puerta no revalida atributos, las dos son independientes.
