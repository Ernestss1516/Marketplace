# Diseño — Profundidad N del árbol de categorías

> **Qué es este documento.** El diseño de la implementación, con las ráfagas ordenadas y los
> detalles pendientes fijados. **Cero código.** No implementa.
>
> **De qué parte.** De [`docs/auditoria-profundidad-categorias.md`](auditoria-profundidad-categorias.md)
> (el «cómo») y de [`docs/mapa-categorias-y-ciclo-vida.md`](mapa-categorias-y-ciclo-vida.md) §1
> (los 33 puntos). La auditoría resolvió la viabilidad; esto ordena el trabajo.
>
> **Decisiones ya confirmadas por Ernest:** N niveles con tope en constante única (valor 4, **no**
> `Setting`); **no se re-parenta**; el selector del admin lo decide este diseño.
>
> Fecha: 2026-08-11. Verificado sobre `rafaga-a-maquina-estados-cuota`, commit `37ee0d1`.

---

## Dos correcciones a la auditoría, verificadas contra el código

Al comprobar los moldes para este diseño aparecieron dos cosas que cambian decisiones. Van primero
porque afectan a lo que sigue.

### C1 — `NAV_MAX_DEPTH` ya existe, vale 2, y es de OTRO árbol

`NAV_MAX_DEPTH = 2` está definido en [nav.types.ts:14](apps/api/src/modules/nav/nav.types.ts#L14) y
es el tope del **menú del sitio** (`NavItem`), un árbol distinto que no comparte código con
`Category`. Reutilizar ese nombre para categorías sería **una colisión con otro valor**: dos topes
llamados igual, uno 2 y otro 4.

**Este diseño usa `CATEGORY_MAX_DEPTH = 4`**, siguiendo el *molde* de `NAV_MAX_DEPTH` (que es a lo
que apuntaba la auditoría), no su nombre. Detalle en §A.

### C2 — El catch-all + `notFound()` NO produce un 404 real en este proyecto

La auditoría propuso catch-all `[...ruta]` con `notFound()` explícito como mitigación del soft-404.
**Esa mitigación no funciona aquí, y el propio código lo dice tras haberlo medido** —
[CategoryListingPage.tsx:131-137](apps/web/src/components/categorias/CategoryListingPage.tsx#L131-L137):

> *"Son dos rutas explícitas y no un catch-all `[...ruta]` a propósito: … un catch-all en la raíz
> capturaría además cualquier ruta profunda inexistente (/a/b/c/d), que hoy devuelve un 404 REAL del
> router. Con el catch-all pasaría a ser un **404 blando (200 + UI de 404, por el streaming que
> impone `app/loading.tsx`)** — una regresión de SEO justo en la ráfaga que viene a arreglar el SEO."*

Es el **mismo mecanismo** que ya obligó a mover el redirect 308 al middleware: `app/loading.tsx`
existe en la raíz (verificado), envuelve toda ruta en Suspense y **manda la cabecera 200 antes de
ejecutar el componente**. Por eso `permanentRedirect()` degradaba a redirect de cliente, y por eso
`notFound()` degradaría a 404 blando. Está medido sobre el servidor real
([category-canonical.ts:10-28](apps/web/src/lib/category-canonical.ts#L10-L28)).

**Consecuencia:** el routing se diseña con **segmentos fijos**, no con catch-all. Detalle en §D.1.

---

# A. `CATEGORY_MAX_DEPTH` — la constante única

**Dónde vive:** [`apps/api/src/modules/categories/category.types.ts`](apps/api/src/modules/categories/category.types.ts).
Es el fichero puro que ya exporta las 5 resoluciones y los defaults globales
(`DEFAULT_EFFECTIVE_VIEWS`, `DEFAULT_ALLOWED_PRICE_UNITS`), y **ya lo importan** `AdminService`,
`ListingsService` y `FilterableAttributesResolver`. No hace falta cablear nada nuevo.

**Valor:** `4`. **Semántica a fijar en el propio comentario:** número de niveles contando la raíz
como nivel 1 — raíz → hija → nieta → bisnieta. (Hoy el sistema es «2» con ese mismo criterio.)

**Quién la usa — dos sitios, y solo dos:**

1. `assertMaxDepth` en `AdminService` (sustituye a `assertParentIsRoot`) — §E.1.
2. El backoffice, para decidir si una fila ofrece «Nueva subcategoría» — §D.4.

**Por qué constante y no `Setting`** (queda escrito en el comentario, que es donde servirá):

- La profundidad **no se cambia a menudo**: es una decisión de modelo de negocio, no un parámetro
  operativo. Los `Setting` del repo son cosas que se tocan (cuotas, precios, interruptores).
- Un `Setting` decorativo sería el tercer ajuste muerto: el mapa (§4.4) documentó que
  `listingExpiryDays` y `contactRequiresVerification` están declarados, sembrados, editables y
  **con cero lectores**. Un tope de profundidad que el admin puede mover pero que 33 puntos no
  respetan sería mucho peor que decorativo: sería **peligroso**.
- Bajarlo obligaría a migrar datos (categorías existentes por debajo del nuevo tope quedarían
  huérfanas de UI). Un valor que no se puede bajar con seguridad no debe ofrecerse como editable.
  Es exactamente el razonamiento que ya lleva escrito `NAV_MAX_DEPTH`
  ([nav.types.ts:10-13](apps/api/src/modules/nav/nav.types.ts#L10-L13)): *"Subirlo a 3 es cambiar
  este número y hacer el trabajo de render; bajarlo obligaría a migrar datos."*

---

# B. `getAncestorChain` — EL UN SOLO LECTOR

**Es la pieza central del diseño**, porque es la mitigación estructural de R1 (herencia rota en
silencio). El principio, en una frase:

> Ninguna resolución sube la cadena por su cuenta. Hay **un** lector; las demás son consumidoras.
> Si el lector sube bien, suben todas; si sube mal, fallan todas a la vez — y eso se ve.

Es el mismo criterio que ya aplica `bump-cooldown.ts` (la ventana se define donde se aplica y se
sirve ya resuelta) y `category-url.ts` (única fuente de la URL de categoría, tras haber tenido 11
generadores divergentes).

## B.1 Dónde vive

**`CategoryTreeService`, nuevo, en `CategoriesModule`.**

Verificado por qué ahí y no en `SearchModule`, que es donde vive hoy el árbol memoizado: si la
centralización viviera en `FilterableAttributesResolver`, entonces `ListingsModule` tendría que
importar `SearchModule` — y hoy **no lo hace** (`AdminModule` sí). `CategoriesModule` es la
dependencia natural y no crea ciclos.

**Y absorbe una duplicación que ya existe:** `FilterableAttributesResolver.loadCategories`
([filterable-attributes.resolver.ts:151-164](apps/api/src/modules/search/filterable-attributes.resolver.ts#L151-L164))
ya carga **todas** las categorías en una consulta y las memoiza, con `invalidate()` cableado
([:147-149](apps/api/src/modules/search/filterable-attributes.resolver.ts#L147-L149)) y disparado
tras editar una categoría ([admin.service.ts:1071-1073](apps/api/src/modules/admin/admin.service.ts#L1071-L1073)).
El resolver de búsqueda pasa a **consumir** el servicio nuevo en vez de tener su propia copia del
árbol. Una caché, un invalidador.

## B.2 Qué expone

| Operación | Devuelve | Quién la consume |
|---|---|---|
| `getAncestorChain(categoryId)` | Cadena **raíz → hoja**, incluida la propia categoría | Las 5 resoluciones, `toDocument`, migas |
| `getDescendantIds(categoryId)` | Todos los descendientes (cualquier profundidad) | Fallback Postgres, las 2 guardas (§E.2), `mergeSchemasForCategory` |
| `getDepth(categoryId)` | Profundidad (raíz = 1) | `assertMaxDepth` |
| `getTree()` | Árbol completo, recursivo | `findTree`, `getCategories` del admin |

**Coste: 0 consultas extra.** Una consulta al calentar la memoización; la cadena se construye en
memoria en O(profundidad). Categorías son decenas de filas — el mismo razonamiento que ya justifica
cachear el vocabulario de tags entero ([tags.service.ts:113](apps/api/src/modules/tags/tags.service.ts#L113)).

**Orden de la cadena: raíz → hoja, y es una decisión, no un detalle.** Es el orden en el que se
pliega (§B.3) y el orden natural de la miga. Los sitios que necesitan el orden inverso (`categoryPath`,
tags) lo invierten explícitamente en su punto de uso, y así queda visible.

⚠️ **Límite heredado que hay que dejar escrito:** la memoización es **por proceso**; un despliegue
multi-instancia necesitaría pub/sub para invalidar en todas. Es deuda **preexistente** — ya está
documentada en [filterable-attributes.resolver.ts:143-145](apps/api/src/modules/search/filterable-attributes.resolver.ts#L143-L145)
— y este proyecto **no la agrava ni la resuelve**; solo hereda el mismo comportamiento en un sitio
en vez de en dos.

## B.3 Las 5 resoluciones: se pliegan, no se reescriben

Las cinco tienen firma `(propio, efectivoDelPadre) → efectivo`, que es la de un reductor. **Sus
cuerpos no se tocan.** Lo que cambia es la invocación: de una llamada a un `reduce` sobre la cadena,
con la semilla que hoy pasan los llamantes.

| Función | Semilla | Semántica al plegar raíz→hoja |
|---|---|---|
| `resolveEffectiveSchema` [:65-73](apps/api/src/modules/categories/category.types.ts#L65-L73) | `[]` | El más profundo **gana** por `name`. Orden: ancestros primero, propios al final — se conserva la lógica de formulario |
| `resolveEffectivePolicy` [:122-129](apps/api/src/modules/categories/category.types.ts#L122-L129) | `'BOTH'` | Una restricción de cualquier ancestro sobrevive a los descendientes `BOTH` |
| `resolveEffectiveViews` [:181-189](apps/api/src/modules/categories/category.types.ts#L181-L189) | `null` | Override completo: gana el **primer ancestro configurado** mirando desde la hoja hacia arriba |
| `resolveEffectivePriceUnits` [:218-224](apps/api/src/modules/categories/category.types.ts#L218-L224) | `null` | Ídem |
| `resolveEffectiveTags` [tag.types.ts:36-39](apps/api/src/modules/tags/tag.types.ts#L36-L39) | `[]` | Unión. El resultado queda hoja → padre → abuelo → raíz: **lo más específico primero**, la generalización exacta de la regla actual |

### La semántica de herencia N-nivel, fijada

**Cada nivel sobreescribe a sus ancestros.** No acumula. Es la extrapolación que conserva el
comportamiento actual con 2 niveles; «acumular» (que un nieto no pueda cambiar lo que puso el
abuelo) no tiene ningún precedente en el código y cambiaría el significado de las categorías que ya
existen.

### El patrón que DESAPARECE, y es el que más peligro tiene

Hoy los llamantes escriben la resolución en **dos pasos a mano**: el padre resuelve contra `null`,
luego el hijo contra el efectivo del padre —
[categories.service.ts:191-211](apps/api/src/modules/categories/categories.service.ts#L191-L211) y
[listings.service.ts:1500-1503](apps/api/src/modules/listings/listings.service.ts#L1500-L1503).

Ese two-step **se elimina**: lo sustituye el pliegue. **Si un sitio se queda con el two-step, hereda
de un solo nivel y no da error.** Es R1 en su forma concreta. Cierre: al terminar la Ráfaga 1 no
puede quedar ni una llamada a las 5 funciones fuera del pliegue — es un grep de cierre, y el fixture
de §G lo detecta si se escapa.

---

# C. `categoryPath`, índice y filtro

## C.1 Construcción

`toDocument` deja de leer `listing.category.parent` y pide la cadena a `CategoryTreeService`:

```
categoryPath = [hoja, ...ancestros de abajo a arriba]     // invierte la cadena raíz→hoja
```

**Byte-idéntico para lo existente, verificado:** para una hoja de nivel 2 la cadena es
`[raíz, hoja]`, invertida `[hoja, raíz]` — exactamente lo que produce hoy
[search.service.ts:513-516](apps/api/src/modules/search/search.service.ts#L513-L516). Para una raíz,
`[raíz]`. **Ningún documento actual cambia.**

## C.2 El filtro NO se toca

`categoryPath = "slug"` ([search.service.ts:400](apps/api/src/modules/search/search.service.ts#L400))
es contención en array en Meilisearch: con un path de 4 elementos, filtrar por la raíz sigue trayendo
descendientes de cualquier profundidad. **Cero cambios.** Tampoco cambia `CORE_FILTERABLE_ATTRIBUTES`
ni la reserva del nombre en `RESERVED_ATTRIBUTE_NAMES`.

## C.3 `INDEX_INCLUDE` y el invariante que hay que conservar

Se quita `parent` del include: la cadena la da el servicio. **El invariante que NO se puede perder**
es el que ya está escrito en [search.service.ts:186-196](apps/api/src/modules/search/search.service.ts#L186-L196):
el processor de indexación y `pnpm reindex` deben construir el documento **por el mismo camino**, o
un mismo anuncio tendrá documentos distintos según por dónde se indexe. Como ahora el path viene de
un servicio y no del include, el invariante se refuerza solo — pero conviene que el comentario lo
diga, porque el `INDEX_INCLUDE` deja de ser el único punto compartido.

## C.4 El reindexado: cuándo y cómo se dispara

- **No hace falta al desplegar** (§C.1: los documentos actuales no cambian). Esto permite desplegar
  backend y reindexar después, sin ventana de inconsistencia.
- **Hace falta la primera vez que se cree una categoría de nivel ≥3**, y solo para los anuncios de
  esa subcadena.
- **Cómo:** el camino ya existe y ya se dispara al editar una categoría —
  `indexingQueue.add('refresh-filterable-attributes')` desde `createCategory`/`updateCategory`
  ([admin.service.ts:953-955](apps/api/src/modules/admin/admin.service.ts#L953-L955),
  [:1071-1073](apps/api/src/modules/admin/admin.service.ts#L1071-L1073)). **Ese job refresca los
  `filterableAttributes` de Meili, no reindexa anuncios.** Decisión de diseño: al crear una
  categoría con profundidad ≥3, encolar además un reindexado de los anuncios de la subcadena
  (`getDescendantIds` da el conjunto). Es aditivo y acotado — no un reindexado global.
- **Molde de espera:** `indexListing` ya usa `waitForTask` para que el documento sea *consultable*
  antes de dar el trabajo por hecho ([:354-359](apps/api/src/modules/search/search.service.ts#L354-L359)).

## C.5 Los dos sitios de búsqueda que sí cambian

1. **Fallback Postgres** — [listings.service.ts:941-946](apps/api/src/modules/listings/listings.service.ts#L941-L946).
   `OR: [{slug}, {parent:{slug}}]` → `categoryId: { in: getDescendantIds(cat) + [cat.id] }`.
   Ya hay un test dedicado a que el fallback reproduzca lo que reemplaza
   (`category-listings-fallback.e2e-spec.ts`) — es la red que hay que extender a 4 niveles.
2. **`mergeSchemasForCategory`** — [filterable-attributes.resolver.ts:117-137](apps/api/src/modules/search/filterable-attributes.resolver.ts#L117-L137).
   Sube un nivel y baja un nivel; pasa a **cadena completa hacia arriba** y **todos los
   descendientes hacia abajo**. Si se queda a un nivel, el síntoma es el bug que la RÁFAGA 1 ya
   arregló una vez: un filtro legítimo devuelve 400 o desaparece de la UI.

---

# D. El frontend

## D.1 Routing: segmentos fijos (por C2)

**Decisión: cuatro rutas explícitas**, `[categoria]` / `[categoria]/[subcategoria]` /
`…/[nivel3]` / `…/[nivel4]`, todas delegando en `CategoryListingPage` como ya hacen las dos actuales.

| | **Segmentos fijos (elegido)** | Catch-all `[...ruta]` |
|---|---|---|
| 404 de una ruta profunda inexistente | **404 real del router** — no casa con nada | **404 blando (200)**, medido en este proyecto (C2) |
| Ficheros | 4 casi idénticos (~35 líneas de delegación cada uno) | 1 |
| El número | Aparece en la **estructura de carpetas** | No aparece |
| Al querer un 5.º nivel | La ruta **no existe** → falla ruidosamente | Funcionaría en silencio con la herencia rota si el backend no acompaña |

**El argumento decisivo no es la estética: es que el 404 real es la propiedad que este proyecto ya
pagó por proteger.** Toda la ráfaga A1 de categorías (el 308 en el middleware, con su medición) se
hizo para que un crawler no viera 200 donde debía ver una redirección. Introducir ahora un 200 donde
debe haber un 404 sería deshacer ese trabajo desde el otro lado.

El «número cableado en carpetas» es un cable **estructural y ruidoso**: si alguien sube
`CATEGORY_MAX_DEPTH` a 5 sin añadir la ruta, la URL de nivel 5 **no resuelve** — se ve al instante.
Es lo contrario de R1, que es silencioso. Se mitiga con una nota en la constante: *«subir este valor
exige añadir la ruta correspondiente en apps/web»*, igual que `NAV_MAX_DEPTH` avisa de que subirlo
«es cambiar este número y hacer el trabajo de render».

**Escape hatch documentado, para no cerrar la puerta:** si algún día la profundidad debe ser
realmente dinámica, la vía es catch-all **+ validación en el middleware** (que sí corre antes del
render, que es justo por lo que el 308 funciona allí). No se diseña ahora porque no hace falta.

## D.2 URLs, canonicalización y sitemap

- **`categoryPath()`** → `'/' + [...ancestros, slug].join('/')`. Para 1-2 niveles produce
  **exactamente la misma URL** que hoy. Ninguna URL existente cambia (y §F garantiza que no puedan
  cambiar).
- **`CategoryUrlParts`** pasa de `{slug, parentSlug?}` a admitir `ancestorSlugs`. **Aditivo durante
  la migración**: derivar `ancestorSlugs ?? (parentSlug ? [parentSlug] : [])`, con el mismo espíritu
  «degrada, no revienta» que la función ya tiene para payloads cacheados sin `parentSlug`
  ([category-url.ts:27-34](apps/web/src/lib/category-url.ts#L27-L34)). Esto importa de verdad: la
  ficha se cachea 5 min en Redis, así que tras desplegar hay respuestas **sin** el campo nuevo.
- **De dónde sale la cadena en el cliente:** el backend la inyecta en cada nodo, mismo criterio por
  el que hoy inyecta `parentSlug` en cada hija
  ([categories.service.ts:120-125](apps/api/src/modules/categories/categories.service.ts#L120-L125)):
  *"para que ningún consumidor tenga que recorrer el árbol al revés"*.
- **Canonicalización 308:** la regla *"manda el último segmento"*
  ([category-canonical.ts:105-109](apps/web/src/lib/category-canonical.ts#L105-L109)) **no se toca**
  — es independiente de la profundidad. Solo cambian `MAX_CATEGORY_SEGMENTS` (2 → 4) y el mapa
  `slug→padre` → `slug→cadena`. Sigue cubriendo de un golpe la URL plana vieja, el padre incoherente
  y el padre inexistente.
- **Sitemap:** `flatMap(root => [root, ...children])` → walker recursivo.
- **Migas:** `trail` = cadena completa. **Invariante a conservar:** el JSON-LD se genera del *mismo*
  `trail` que la miga visible ([CategoryListingPage.tsx:371-383](apps/web/src/components/categorias/CategoryListingPage.tsx#L371-L383)),
  no de una copia paralela.

## D.3 Los recorridos del árbol: un helper común

Seis ficheros hacen «raíz + un nivel de hijas» (mapa §1.7). Todos quieren lo mismo, así que el
diseño añade **`lib/category-tree.ts`** en el frontend, hermano de `getAncestorChain` en el backend:
`buscarEnArbol(slug)`, `descendientesDe(slug)`, `recorrerArbol()`.

Consumidores: `filter-carry.ts`, `card-attributes.ts` (3 mapas), `filterable-fields.ts`,
`available-tags.ts`, `sitemap.ts`, `findCategoryUrlParts`, los dos renderers de portada.

✅ **Sin cambios:** el tipo `Category` ([types/index.ts:156](apps/web/src/types/index.ts#L156)) ya
declara `children?: Category[]` — recursivo. Aguanta N.

## D.4 Los selectores — y un hallazgo que reduce el trabajo

Hay **dos** selectores de categoría, y solo uno es problema:

**✅ `StepCategoria` (wizard de publicar) — YA es N-niveles. Cero cambios.**
Verificado: es un navegador por niveles con `path` de ancestros —
`currentLevel = path.length === 0 ? categories : path[path.length-1].children`
([StepCategoria.tsx:31-36](apps/web/src/components/publicar/steps/StepCategoria.tsx#L31-L36))— con
miga y `goBack(index)` genéricos ([:71-73](apps/web/src/components/publicar/steps/StepCategoria.tsx#L71-L73)),
y hoja detectada por «no tiene hijos» ([:38-42](apps/web/src/components/publicar/steps/StepCategoria.tsx#L38-L42)).
**No asume profundidad en ninguna línea.** Es un 34.º punto que el mapa no listaba y que funciona ya.

**⚠️ `CategorySelect` (buscador) — `<optgroup>` no anida.** Es límite del estándar HTML: un `<select>`
nativo expresa como mucho 2 niveles de agrupación.

### Decisión para el selector del admin (y para `CategorySelect`)

| Opción | A favor | En contra |
|---|---|---|
| **Path aplanado** en un `<select>` normal («Vehículos › Coches › Deportivos») | Sin componente nuevo. Accesible por defecto. Toda la profundidad visible de un vistazo. Buscable con el teclado del navegador | Con muchas categorías la lista se hace larga; las etiquetas crecen |
| **Drill-down** (navegación por niveles) | Ya existe y está probado en el repo (`StepCategoria`) | Más clics para llegar a una hoja; el usuario no ve todo a la vez |

**Recomendación: path aplanado**, por tres razones concretas:

1. **El caso de uso es distinto al del wizard.** Publicar es *elegir* una categoría desde cero
   (explorar). Filtrar en la búsqueda y editar en el backoffice es *saltar a una que ya conoces* —
   ahí una lista plana buscable gana a navegar tres niveles.
2. **`CategorySelect` conserva la forma que tiene** (un `<select>` con `onChange` → `router.push`).
   El cambio es cómo se generan las `<option>`, no el componente. Trabajo mínimo, riesgo mínimo.
3. **El backoffice ya muestra el árbol completo con sangría** (§D.5); un selector adicional que
   obligue a navegar sería redundante con el árbol que se ve al lado.

**Nota de alcance:** el separador `›` es contenido de cara al usuario. Y el path aplanado necesita
justo lo que §D.2 ya añade —la cadena de ancestros en cada nodo—, así que sale casi gratis.

## D.5 El backoffice de categorías

El árbol de 2 niveles está **escrito en el JSX**: un bucle de raíces y dentro un bucle de hijas
([page.tsx:895-1005](apps/web/src/app/(admin)/admin/categorias/page.tsx#L895-L1005)).

| Punto | Hoy | Diseño |
|---|---|---|
| Render | Dos bucles anidados; `indent: boolean` | **Componente recursivo**; `indent` pasa de booleano a **nivel** (sangría proporcional) |
| «Nueva subcategoría» | Solo en la fila raíz ([:992-1001](apps/web/src/app/(admin)/admin/categorias/page.tsx#L992-L1001)) | En cualquier fila con `nivel < CATEGORY_MAX_DEPTH`. **Es donde el tope se hace visible**; el botón desaparece en el nivel 4, sin mensaje de error |
| Herencia al crear | Hardcodea *"Parent is a root category → its effective schema = its own schema"* ([:664](apps/web/src/app/(admin)/admin/categorias/page.tsx#L664)) | Resolver la **cadena** del padre elegido. Si no, el admin ve un «heredarás X» **falso** |
| Reordenar | `moveRoot` + `moveChild` ([:755-777](apps/web/src/app/(admin)/admin/categorias/page.tsx#L755-L777)) | **Una** función: reordenar entre hermanos, sea cual sea el nivel |
| `nextOrderFor` | Raíces o `children` del padre | Hijos del padre, genérico |
| Tipo cliente | `children: AdminCategoryChild[]` (el hijo no tiene `children`) ([lib/api/admin.ts:215](apps/web/src/lib/api/admin.ts#L215)) | Tipo recursivo |
| `buildSchemaPanel` | Solo la raíz recibe `children` ([:803-805](apps/web/src/app/(admin)/admin/categorias/page.tsx#L803-L805)) | Cualquier nodo puede tener hijas |

Y en backend, `AdminService.getCategories`
([admin.service.ts:506-542](apps/api/src/modules/admin/admin.service.ts#L506-L542)) devuelve
`parentId: null` + un nivel: **un nieto sería invisible en el backoffice**.

---

# E. Las guardas

## E.1 `assertParentIsRoot` → `assertMaxDepth`

**Se sustituye, no se borra.** Si se elimina sin sustituto, el árbol queda sin tope y vuelve el
problema que esa guarda cerró: nodos invisibles y herencia perdida, en silencio
([admin.service.ts:852-869](apps/api/src/modules/admin/admin.service.ts#L852-L869)).

Molde: `NavService.assertMaxDepth` ([nav.service.ts:310-324](apps/api/src/modules/nav/nav.service.ts#L310-L324)).
**Con una simplificación**: allí son *dos* reglas porque el nav sí permite mover nodos (y un nodo
movido arrastra hijos). Aquí **no se re-parenta** (§F), así que basta la primera: la profundidad del
padre + 1 no puede pasar de `CATEGORY_MAX_DEPTH`. El mensaje debe decir el tope y la profundidad
alcanzada, no solo «no».

## E.2 Las dos guardas que cuentan hijos DIRECTOS

Es el punto más fácil de olvidar de todo el proyecto, porque **hoy funcionan**: con 2 niveles,
«hijos directos» y «descendientes» son lo mismo.

| Guarda | Hoy | Con N niveles, si no se toca |
|---|---|---|
| `assertPolicyChangeDoesNotBreakChildren` [:762-795](apps/api/src/modules/admin/admin.service.ts#L762-L795) | Lee hijas directas ([:768-771](apps/api/src/modules/admin/admin.service.ts#L768-L771)) y cuenta anuncios en `[categoría + hijas]` ([:786-789](apps/api/src/modules/admin/admin.service.ts#L786-L789)) | Restringir una raíz a `PRODUCT_ONLY` **no vería** una nieta `SERVICE_ONLY` ni los anuncios de servicio de los nietos. La contradicción se guarda y la incoherencia aparece después, sin aviso |
| `assertPriceUnitsChangeDoesNotBreakListings` [:823-850](apps/api/src/modules/admin/admin.service.ts#L823-L850) | Hijas directas sin config propia ([:833-840](apps/api/src/modules/admin/admin.service.ts#L833-L840)) | Un nieto que hereda del abuelo (porque ni él ni su padre configuran nada) quedaría con anuncios en un formato ya no permitido |

**Rediseño de ambas: recorrer descendientes con `getDescendantIds`.** Y en la segunda, con un
matiz que el código actual ya razona bien y hay que generalizar: solo son afectados los descendientes
que **realmente heredan** — la cadena se corta en el primer descendiente con config propia, porque el
override es total. Es decir, no es «todos los descendientes» sino «todos los descendientes
alcanzables sin cruzar un nodo configurado».

Se conserva el molde de mensaje de las dos: **conteo exacto y 400 con el número**, no un aviso vago.

## E.3 La tercera guarda, que sí está bien pero conviene mirar

`assertCardAttributeChangeDoesNotBreakChildren` ([:672-702](apps/api/src/modules/admin/admin.service.ts#L672-L702))
tiene el mismo patrón «hijas directas» y el mismo problema: editar la raíz puede dejar a una **nieta**
con más de 2 `cardAttribute` en su schema efectivo. Va con las otras dos.

Y `assertNoRangeSuffixCollision` ([:602-643](apps/api/src/modules/admin/admin.service.ts#L602-L643))
define su ámbito como «propio + padre + hijas»: pasa a «cadena de ancestros + todos los descendientes».

---

# F. No re-parentar — formalizado

**Hoy es imposible de facto**, no por decisión escrita: `UpdateCategoryDto` sencillamente no declara
`parentId`, y `updateCategory` se apoya en ello con un comentario de paso
([admin.service.ts:975-977](apps/api/src/modules/admin/admin.service.ts#L975-L977)).

**Este diseño lo convierte en decisión explícita**, en tres sitios:

1. En `UpdateCategoryDto`: un comentario que diga **por qué** no está `parentId`, no solo que no está.
2. En `CATEGORY_MAX_DEPTH`: la nota de que el tope es seguro de comprobar **solo al crear** porque el
   padre es inmutable — que es lo que permite prescindir de la segunda regla de `NavService.assertMaxDepth`.
3. En este documento: **el motivo es SEO.** La URL de una categoría es su cadena de ancestros; mover
   una rama cambia la URL de esa categoría *y la de todos sus descendientes* de golpe, y exigiría un
   plan de redirects permanentes que hoy no existe. Con `parentId` inmutable, **el riesgo SEO de este
   proyecto es cero**: ninguna URL existente puede cambiar.

Si algún día se quiere mover ramas, es un proyecto propio: necesita el segundo guard del nav
(arrastre de hijos), un materialized path para saber qué URLs cambiaron, y redirects 308 por cada
descendiente.

---

# G. El fixture de 4 niveles — la mitigación central de R1

**Sin esto, R1 es invisible**: con datos de 2 niveles, una resolución que sube 1 nivel y una que sube
N dan **exactamente el mismo resultado**. Todos los tests pasarían con la herencia rota.

## G.1 Dos fixtures, no uno

**(1) Fixture PURO, para las 5 resoluciones.** Objetos en memoria, sin BD. Prueba el pliegue en sí:
que el bisnieto pisa al nieto que pisa al hijo que pisa a la raíz; que una restricción del abuelo
sobrevive; que el override de vistas gana desde el primer ancestro configurado. Va junto a
`category.types.spec.ts`, que ya existe y ya prueba estas funciones de forma pura.

**(2) Fixture de BD, para la cadena de punta a punta.** Cuatro categorías encadenadas con
**configuración en cada nivel** (atributos propios, uno redefinido más abajo, una política, unas
vistas, unos tags), más un anuncio en la hoja. Prueba lo que el fixture puro no puede: que
`getAncestorChain` carga bien, que `categoryPath` sale con 4 elementos, que el filtro por la raíz
trae el anuncio del bisnieto, que la miga tiene 4 escalones, que la URL es `/a/b/c/d`.

## G.2 Dónde vive el de BD — restricción verificada

**No puede ir en `seed-test.ts`.** Las categorías son **datos estáticos compartidos**: `cleanDb` las
excluye a propósito porque *"multiple Jest workers run suites in parallel and share the same DB"*
([helpers/db.ts](apps/api/test/helpers/db.ts)), y varias suites dependen del orden y del recuento de
las raíces sembradas — `seed-test.ts` llega a resetear `order` explícitamente para que un `.first()`
sea determinista. Añadir una raíz nueva al seed puede desestabilizar suites ajenas.

**Va como helper de test que cada suite crea en su `beforeAll`**, con slugs únicos.
`reset-categories-between-suites.ts` **ya lo limpia solo**: fotografía los ids al empezar la suite y
borra el delta al terminar, precisamente para que ninguna suite envenene a la siguiente. El fixture
encaja en esa barrera sin tocarla.

Forma: `test/helpers/deep-category-tree.ts` → crea la cadena, devuelve los 4 ids/slugs, y cualquier
suite lo usa en una línea.

## G.3 Qué debe detectar (la lista de aserciones que hacen visible R1)

1. Un atributo definido **solo en la raíz** llega al **bisnieto**. ← si una resolución sube 1 nivel, falla
2. Un atributo redefinido en el nivel 3 **pisa** al de la raíz para el nivel 4
3. `allowedListingType` restringido en la raíz **restringe** al bisnieto
4. `allowedViews`/`allowedPriceUnits` del nivel 2 ganan al default global en el nivel 4
5. Los tags del bisnieto incluyen los de los 3 ancestros, **en orden de especificidad**
6. `categoryPath` del anuncio del bisnieto tiene **4** elementos
7. Filtrar la búsqueda por la **raíz** devuelve el anuncio del **bisnieto**
8. El fallback de Postgres (Meili caído) devuelve **lo mismo** que Meili
9. La miga de `/a/b/c/d` tiene 4 escalones y el JSON-LD coincide
10. Crear un **5.º** nivel se rechaza con el tope en el mensaje
11. `assertPolicyChangeDoesNotBreakChildren` **ve** un conflicto en el nivel 4 (§E.2)

**Regla de oro del proyecto:** ninguna ráfaga se da por terminada sin que su parte de esta lista pase.

---

# El orden de ráfagas

**Principio:** la herencia primero y probada a fondo, porque es lo que R1 amenaza y porque todo lo
demás la consume. Nada de frontend antes de que el backend devuelva cadenas de verdad.

## Ráfaga 1 — El corazón: la cadena y el pliegue (backend, invisible)

`CATEGORY_MAX_DEPTH` · `CategoryTreeService` (`getAncestorChain`/`getDescendantIds`/`getDepth`/`getTree`,
absorbiendo la caché del resolver de búsqueda) · las 5 resoluciones plegadas en los 8 puntos de carga
· `assertParentIsRoot` → `assertMaxDepth` · **los dos fixtures** · formalizar no-re-parentar.

- **Sin efecto visible**: nadie puede crear todavía un nivel 3 por la UI, así que el comportamiento
  observable no cambia. Es lo que la hace segura.
- **Criterio de cierre:** aserciones 1-5 y 10 de §G.3; y el grep de cierre — ni una llamada a las 5
  funciones fuera del pliegue, ni un two-step superviviente.

## Ráfaga 2 — Índice, guardas y backoffice (ya se pueden crear 4 niveles)

`categoryPath` desde la cadena · `INDEX_INCLUDE` · el reindexado acotado al crear nivel ≥3 ·
fallback Postgres · `mergeSchemasForCategory` · **las 3+1 guardas a descendientes** (§E.2, §E.3) ·
`AdminService.getCategories` recursivo · el backoffice recursivo con botón por nivel y herencia real.

- **Es la ráfaga que abre la puerta**: al terminarla, un admin puede crear un nivel 3 y 4 y los
  anuncios se indexan y filtran bien. El frontend público aún no sabe pintar esas URLs — por eso va
  antes la 2 que la 3, pero **conviene no crear categorías profundas en producción hasta la 3**.
- **Criterio de cierre:** aserciones 6-8 y 11.

## Ráfaga 3 — El frontend público (lo visible)

Las 2 rutas nuevas (niveles 3 y 4) · `categoryPath()`/`CategoryUrlParts` con cadena ·
`MAX_CATEGORY_SEGMENTS` y el mapa del middleware · sitemap · migas · `lib/category-tree.ts` y sus 6+
consumidores · `CategorySelect` con path aplanado.

- **Criterio de cierre:** aserción 9, más una regresión explícita: **las URLs de 1-2 niveles siguen
  respondiendo idénticas** y `/a/b/c/d/e` sigue dando **404 real** (código HTTP, no contenido).

## Por qué este orden y no otro

- La 1 no rompe nada porque no hay datos de nivel ≥3 que la ejerciten en producción.
- La 2 depende de la 1 (todo pide la cadena) y de sus fixtures.
- La 3 depende de la 2 (necesita que el backend sirva cadenas y que existan categorías profundas que
  probar).
- **Alternativa considerada y descartada:** hacer el frontend antes que las guardas. Dejaría un
  hueco en el que un admin puede crear un nivel 4 cuyas restricciones de política/precio no se
  comprueban — incoherencias de datos silenciosas, justo lo que este proyecto viene a evitar.

---

# Los 33 puntos, asignados

Ninguno sin ráfaga. Numeración del mapa §1.9.

| # | Punto | Ráfaga |
|---|---|---|
| 1 | `assertParentIsRoot` → `assertMaxDepth` | **1** |
| 2-6 | Las 5 resoluciones (cuerpos intactos; se pliegan) | **1** |
| 7 | `findTree` | **1** (recursivo) + **3** (inyectar `ancestorSlugs`) |
| 8 | `findBySlug` | **1** (cadena) + **3** (`ancestors` en la respuesta) |
| 9 | `ListingsService.create` | **1** |
| 10 | `ListingsService.update` | **1** |
| 11 | `validateCardAttributeLimitByType` | **1** |
| 12 | `assertCardAttributeChangeDoesNotBreakChildren` | **2** (§E.3) |
| 13 | `assertNoRangeSuffixCollision` | **2** (§E.3) |
| 14 | `FilterableAttributesResolver.mergeSchemasForCategory` | **2** · su caché la absorbe la **1** |
| 15 | `INDEX_INCLUDE` | **2** |
| 16 | Construcción de `categoryPath` (el filtro no se toca) | **2** |
| 17 | Fallback Postgres | **2** |
| 18 | `sponsored-ads.service.ts` | **2** → ⚠️ **no se ejecutó en la 2; cerrado en la ráfaga de huecos** (ver abajo) |
| 19 | `tags.service.ts` (×3, + invalidar caché Redis por slug) | **1** (resolución) + **2** (caché) |
| 20 | `getCategories` admin · las 2 guardas de política/precios | **2** |
| 21 | `category-url.ts` | **3** |
| 22 | `category-canonical.ts` + middleware | **3** |
| 23 | Rutas de Next (2 nuevas, segmentos fijos) | **3** |
| 24 | `sitemap.ts` | **3** |
| 25 | Miga de categoría (+ JSON-LD del mismo `trail`) | **3** |
| 26 | Miga de la ficha (+ `LISTING_INCLUDE`) | **3** |
| 27 | `filter-carry.ts` | **3** |
| 28 | `card-attributes.ts` | **3** |
| 29 | `filterable-fields.ts` | **3** |
| 30 | `available-tags.ts` | **3** |
| 31 | `CategorySelect.tsx` (path aplanado) | **3** |
| 32 | Renderers de portada (carrusel + tabla) | **3** |
| 33 | `/admin/categorias` | **2** |

### Sin cambios (verificado)

Modelo Prisma · filtro `categoryPath` de Meili · tipo `Category` del frontend · la regla de
`resolveCategoryRedirect` · los cuerpos de las 5 resoluciones · la ruta de lectura de búsqueda
(`SearchService` no toca Postgres) · **`StepCategoria` del wizard** (ya es N-niveles, §D.4).

---

# Resumen

**Tres piezas sostienen el diseño:** `getAncestorChain` como único lector (mata R1 por
construcción), el fixture de 4 niveles (hace visible lo que R1 esconde), y el orden de ráfagas
(herencia probada antes que nada que la consuma).

**Dos correcciones a la auditoría, verificadas:** el nombre `NAV_MAX_DEPTH` ya está ocupado por otro
árbol con otro valor → `CATEGORY_MAX_DEPTH`; y el catch-all con `notFound()` **no da un 404 real en
este proyecto** por `app/loading.tsx` → segmentos fijos.

**Un hallazgo que quita trabajo:** el selector del wizard de publicar ya es N-niveles y no se toca.

**El riesgo SEO es cero** mientras `parentId` sea inmutable, y este diseño lo formaliza en tres
sitios en vez de dejarlo como una ausencia.

---

# Addendum — Los huecos que quedaron abiertos (ráfaga posterior)

Las tres ráfagas se dieron por completas con **tres huecos silenciosos** que sólo se vieron después,
al leer el código para la medición M2. Ninguno daba error: los tres eran incoherencias calladas, de
la misma familia que R1. Se cerraron en una ráfaga aparte.

**Cómo se escaparon, que es lo que importa para la próxima vez:** el cruce de completitud se hizo
comprobando que cada punto estuviera *asignado* a una ráfaga, no que estuviera *ejecutado*. Una
tabla de asignaciones no es una lista de verificación.

| Hueco | Qué pasaba | Por qué se escapó |
|---|---|---|
| **Patrocinados en 2 niveles** (punto 18) | Un patrocinado de una raíz no aparecía al navegar un nivel 3-4 | Estaba en la tabla como «ráfaga 2» y nunca se ejecutó. El grep de cierre lo vio y se dio por asignado |
| **Caché de patrocinados** (no listado) | `invalidateCacheForCategory` sólo invalidaba hijas directas: nietas y bisnietas servían el valor viejo hasta el TTL | Consecuencia del anterior, en el mismo fichero. No estaba en la tabla |
| **`assertPolicyConsistentWithParent`** (no listado) | Comparaba contra el valor PROPIO del padre, no contra el efectivo: `raíz PRODUCT_ONLY → hija BOTH → nieta SERVICE_ONLY` se aceptaba y la declaración se ignoraba en silencio | §E.2/§E.3 sólo cubrieron las guardas «hacia abajo». Esta mira hacia los ancestros y no se contempló |

**La lección de método:** el diseño clasificó las guardas por *dirección* («hacia arriba» y «hacia
abajo») pero sólo auditó una. Cuando una jerarquía cambia de profundidad, **las dos direcciones
cambian**, y ninguna avisa cuando se queda corta.

También se corrigieron seis comentarios que afirmaban un tope de 2 niveles ya inexistente —dos de
ellos citando `assertParentIsRoot`, una función borrada en la ráfaga 1— y se eliminó
`INDEX_INCLUDE.category.parent`, que desde la ráfaga 2 era un JOIN en cada indexado que ya no leía
nadie.
