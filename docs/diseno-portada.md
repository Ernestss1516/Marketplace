# Diseño — Configurador de portada (motor de bloques propio + hero con título rotativo)

> Documento de diseño (2026-08-06). Recoge la auditoría del código real y el diseño
> acordado. Las ráfagas RP.1–RP.6 implementan lo aquí descrito.
>
> **Objetivo:** que la portada (`/`) deje de ser un fichero de 195 líneas escritas a mano
> y pase a ser **una configuración global editable por un ADMIN**: un hero con título
> parcialmente rotativo y un array ordenado de bloques de 7 tipos. Todo renderizado en
> **servidor**; la interactividad entra como islas sobre contenido que ya está en el HTML.
>
> **Alcance cerrado:** solo la portada. El blog y las páginas informativas conservan **su**
> motor de bloques intacto — este es un motor **nuevo y separado**, no una extensión de
> aquel.
>
> Toda afirmación sobre el blog, el footer, el nav, `Category` o `Banner` está verificada
> contra el fichero y la línea citados, no contra la documentación. Se hicieron
> **dos hallazgos que contradicen comentarios del propio código** — están marcados con ⚠ y
> recogidos en §10.

---

## 0. Las cuatro desviaciones que separan este motor del blog

El sistema de bloques del blog ([`Post.blocks`](../apps/api/prisma/schema.prisma#L1683), 13
tipos) es el molde y se copia hasta donde da: array Json ordenado, unión discriminada,
un DTO por tipo, `switch` exhaustivo con `assertUnreachable` en render y en editor,
renderizadores Server Component, markdown solo por `MarkdownBody`.

Pero **cuatro decisiones cambian cosas de raíz**, y son las cuatro que hay que diseñar bien:

| | Blog (hoy) | Portada (este diseño) |
|---|---|---|
| **1. El hero** | No existe. Todos los bloques son iguales y **ninguno conoce su índice** ([`BlockRenderer.tsx:89-93`](../apps/web/src/components/blocks/BlockRenderer.tsx#L89-L93): un `<div>` por bloque dentro de un `space-y-8`). | El hero es **campo propio de la config**, fuera del array. El motor de bloques se queda exactamente igual de homogéneo: ningún bloque conoce su posición y el `switch` con `assertUnreachable` se preserva intacto. Ver §2.3 y §3. |
| **2. Los pasos** | `StepsBlock` es **una secuencia única** de `{title, description, image?}` ([`types/blocks.ts:103-113`](../apps/web/src/types/blocks.ts#L103-L113)). | El bloque de pasos de portada tiene **N columnas con audiencia**, cada una con su título, sus pasos y su CTA — que es lo que la home pinta hoy a mano ([`(home)/page.tsx:119-161`](../apps/web/src/app/(public)/(home)/page.tsx#L119-L161)). No reusa `StepsBlockRenderer`. Ver §4.4. |
| **3. Las listas de anuncios** | `categorySlug` **obligatorio** ([`listings-block.dto.ts:22-25`](../apps/api/src/modules/blog/dto/blocks/listings-block.dto.ts#L22-L25)) y **sin** `FavoritesGridProvider`/`CardAttributesProvider`, renuncia consciente y documentada ([`ListingsBlockRenderer.tsx:24-27`](../apps/web/src/components/blocks/ListingsBlockRenderer.tsx#L24-L27)). | `categorySlug` **opcional** (ausente = recientes globales, como [`(home)/page.tsx:23`](../apps/web/src/app/(public)/(home)/page.tsx#L23)) y **recupera los dos providers** — la portada no puede perder el corazón de favorito ni la línea de atributos que hoy sí tiene. Ver §4.6. |
| **4. La tabla de búsquedas** | No hay nada parecido. No existe primitiva `Tabs` en [`components/ui/`](../apps/web/src/components/ui/) (hay `accordion`, `dialog`, `dropdown-menu`, `select`, `table`…). | Pestañas **con el contenido de todas ellas en el HTML servido** — son cientos de enlaces internos y son el motivo de existir del bloque. Patrón de tabs SSR diseñado desde cero. Ver §4.7. |

Y una simplificación en la dirección contraria: **la config no tiene borrador/publicado, ni
slug, ni FK a `Post`**. Los enlaces son cadenas validadas (`@IsSafeContentUrl`), como
`FooterItem.url`, así que **no hay borrado protegido que diseñar** — nada de la danza
`onDelete: Restrict` + precheck que el blog sí necesita.

---

## 1. Decisiones de partida (cerradas, no se reabren)

| # | Decisión | Motivo |
|---|---|---|
| 1 | **Motor NUEVO propio**, no extensión del blog | Los 4 puntos de §0. Extender el del blog obligaría a que `Post.blocks` aceptase tipos que una página informativa nunca debe tener (un buscador, una tabla de provincias) y a que `BlockRenderer` cargase el árbol de categorías siempre. |
| 2 | **UNA config global editable**, sin borrador/publicado | Es una sola página. Un flujo de publicación exige duplicar el estado y una UI de diff; el precio del "se ve al guardar" se paga con el **preview del editor** (§6), que el blog ya tiene ([`BlockEditor.tsx:121-127`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/BlockEditor.tsx#L121-L127)). |
| 3 | **SSR innegociable** | Los 13 renderizadores del blog son Server Components (`grep "use client"` en [`components/blocks/`](../apps/web/src/components/blocks/): cero coincidencias). La interactividad entra importando primitivas cliente desde un renderizador servidor — patrón ya en producción: `FaqBlockRenderer` es servidor y usa `<Accordion>`, que sí es `'use client'` ([`FaqBlockRenderer.tsx:11-20`](../apps/web/src/components/blocks/FaqBlockRenderer.tsx#L11-L20) + [`ui/accordion.tsx:1`](../apps/web/src/components/ui/accordion.tsx#L1)). |
| 4 | **No se toca el `auth()` del layout raíz** | [`app/layout.tsx:18`](../apps/web/src/app/layout.tsx#L18) y [`Header.tsx:9`](../apps/web/src/components/layout/Header.tsx#L9) leen cookies ⇒ toda `(public)` se renderiza por petición. **La página sigue dinámica; lo que se cachea es la config.** Aceptado. |
| 5 | **Banners de campaña siguen aparte** | `Banner` es un sistema propio y completo (modelo, `/admin/banners`, ventana `startsAt/endsAt`, `variant`, descarte persistente). Este diseño solo decide su **posición** respecto al hero (§5.4). |
| 6 | **Hero = campo separado**, no bloque ni `blocks[0]` | Preserva la homogeneidad del motor (§0.1). |
| 7 | **Ubicaciones = las 52 provincias** de [`lib/provincias.ts`](../apps/web/src/lib/provincias.ts) | Constante de frontend, SSR trivial, cero coste. Los municipios son 380 KB en `public/` que hoy solo se cargan por `fetch` de cliente ([`MunicipioAutocomplete.tsx:82`](../apps/web/src/components/municipio/MunicipioAutocomplete.tsx#L82)) — inservibles para una tabla SSR. |
| 8 | **Listas: providers recuperados + `categorySlug` opcional** | §0.3. |
| 9 | **Carrusel: imagen PROPIA del bloque**, no `Category.iconUrl` | `iconUrl` es un icono de 48 px ([`CategoryGrid.tsx:15-24`](../apps/web/src/components/categorias/CategoryGrid.tsx#L15-L24)) que además hoy es **texto libre sin validar** (input `https://…` en [`admin/categorias/page.tsx:129-139`](../apps/web/src/app/(admin)/admin/categorias/page.tsx#L129-L139), DTO con solo `@IsOptional() @IsString()` en [`create-category.dto.ts:16-18`](../apps/api/src/modules/admin/dto/create-category.dto.ts#L16-L18)). El carrusel de portada quiere fotografías grandes, subidas y validadas. |
| 10 | **Pasos con columnas/audiencias** | §0.2. |
| 11 | **Los 7 tipos bastan**; los huérfanos de la home se expresan con ellos | Chips "Populares" ≈ `grid` o `categoryCarousel`; las 4 señales de confianza ≈ `grid` con icono + texto (§4.3). |

---

## 2. Modelo de datos

### 2.1 Fila única — **DECISIÓN: tabla propia, no `Setting`**

Existe un precedente de configuración global: `Setting` ([`schema.prisma:1012-1023`](../apps/api/prisma/schema.prisma#L1012-L1023)),
clave-valor con `value Json`, editado por `PATCH /admin/settings/:key` contra una allowlist
de claves ([`admin.service.ts:46+`](../apps/api/src/modules/admin/admin.service.ts#L46)).

**Se rechaza reusarlo.** `Setting.value` es un `Json` opaco por diseño: el tipo concreto
depende de la clave y **no hay DTO que lo valide campo a campo**. Meter ahí un array de
bloques con imágenes y enlaces significaría o bien no validar nada (inaceptable: `href` y
`src` acaban en atributos reales del DOM, que es justo lo que `@IsSafeContentUrl` existe
para evitar), o bien inventar una validación condicional por clave dentro de
`AdminService`. Misma lógica por la que `NavItem` no reusó `FooterItem`: dos sistemas que
deben poder divergir no comparten tabla.

**Fila única** con `id` de valor fijo y `upsert` siempre sobre ese id. La fila se siembra en
`seed.ts` (molde: `Setting` se siembra con `createMany` + `skipDuplicates` para no pisar
valores que el admin haya cambiado). El servicio **nunca** hace `create` ni `delete`: solo
`upsert` y `findUnique`, así que el invariante "exactamente una fila" no depende de que
nadie se equivoque.

### 2.2 Schema propuesto

```prisma
// ============================================================================
//  PORTADA CONFIGURABLE — configuración global de la home (/). Fila ÚNICA.
//  Motor de bloques PROPIO, hermano del de Post.blocks pero independiente: la
//  portada tiene tipos que una página informativa nunca debe tener (buscador,
//  tabla de búsquedas) y un hero que el blog no tiene. Ver docs/diseno-portada.md.
// ============================================================================

model HomepageConfig {
  /// Fila única. El servicio SIEMPRE hace upsert sobre este id: no hay create
  /// ni delete, así que "exactamente una fila" no depende de la disciplina de
  /// nadie. Sembrada en seed.ts.
  id String @id @default("singleton")

  // ── HERO ────────────────────────────────────────────────────────────────
  // Campos propios, FUERA del array de bloques: el hero es la única pieza de
  // la portada cuyo comportamiento depende de su posición, y sacarlo del array
  // es lo que permite que ningún bloque conozca su índice (§0.1).

  /// Parte FIJA del <h1>. Obligatoria y no vacía: la portada siempre tiene un
  /// <h1> con texto real, no es configurable "no tener título" (SEO).
  heroStaticTitle String

  /// Opciones que rotan tras la parte fija. [] = título totalmente estático,
  /// sin animación (caso degenerado soportado, no un error). Tope 6 — el tope
  /// NO es estético, es la consecuencia de resolver la rotación en CSS puro
  /// (§3.2): una regla @keyframes estática por cada N soportado.
  heroRotatingOptions String[] @default([])

  /// Milisegundos que cada opción permanece visible. Acotado en el DTO
  /// [1500, 10000]: por debajo es ilegible, por encima parece rota.
  heroRotationMs Int @default(3000)

  /// Subtítulo bajo el <h1>. Texto plano, no markdown — un <h1> con un
  /// párrafo debajo no necesita la tubería de sanitización, y no abrirla es
  /// una superficie de seguridad menos.
  heroSubtitle String?

  // ── BLOQUES ─────────────────────────────────────────────────────────────

  /// Array ORDENADO (la posición ES el orden, no hay campo `order` por bloque)
  /// de objetos { id, type, ...datos }, unión discriminada por `type`. Molde
  /// exacto de Post.blocks (schema.prisma:1683). 7 tipos — ver §2.4.
  /// Validado en profundidad en el DTO (discriminador class-transformer) y en
  /// el servicio (reglas cruzadas: §2.5 nivel 3).
  blocks Json @default("[]")

  updatedAt   DateTime @updatedAt
  /// Admin que guardó por última vez (null en el seed inicial), igual que
  /// Setting.updatedById.
  updatedById String?
}
```

**Sin migración de datos.** La fila semilla reproduce la portada actual con los tipos que
vayan existiendo en cada ráfaga (§8) — no hay contenido previo que convertir, porque hoy la
portada es código, no datos.

### 2.3 El hero como campo, no como bloque — **consecuencia 1**

Lo que se gana sacándolo del array:

1. **El motor sigue homogéneo.** `HomeBlockRenderer` puede seguir siendo el `switch`
   exhaustivo con `assertUnreachable(block: never)` del molde ([`BlockRenderer.tsx:21-23`](../apps/web/src/components/blocks/BlockRenderer.tsx#L21-L23)),
   donde el compilador es la garantía de que esquema y render nunca divergen. Un
   `blocks[0]` con trato especial rompería esa propiedad: el renderizador tendría que
   recibir el índice y ramificar por él.
2. **El hero puede sangrar a ancho completo** sin inventar un concepto de layout en el
   motor. El hero actual vive en una `<section>` con fondo propio **fuera** del `container`
   ([`(home)/page.tsx:45`](../apps/web/src/app/(public)/(home)/page.tsx#L45)), mientras el
   resto va dentro de uno ([`:80`](../apps/web/src/app/(public)/(home)/page.tsx#L80)). Como
   el hero no pasa por `HomeBlockRenderer`, la página lo envuelve como quiera y el array
   conserva su `space-y-*` uniforme. **Confirmado: no hay conflicto.**
3. **Es obligatorio.** Un bloque se puede borrar; un campo `String` no vacío, no. La
   portada nunca se queda sin `<h1>`.

Lo que se pierde: el hero **no se puede reordenar**. Va siempre primero. Es exactamente lo
que se quiere.

### 2.4 Los 7 tipos — unión discriminada

`type` en inglés (regla del proyecto: código en inglés, contenido de cara al usuario en
español), etiquetas en español en el editor. Molde literal de
[`types/blocks.ts`](../apps/web/src/types/blocks.ts) y de los `*-block.dto.ts`.

| `type` | Etiqueta del editor | §  | Naturaleza |
|---|---|---|---|
| `search` | Buscador | §4.1 | Adapta (reuso directo de `SearchBar`) |
| `categoryCarousel` | Carrusel de categorías | §4.2 | Nuevo |
| `grid` | Rejilla de tarjetas | §4.3 | Nuevo |
| `steps` | Pasos por audiencia | §4.4 | Nuevo (más rico que el del blog) |
| `cta` | Botón destacado | §4.5 | Adapta (comparte el presentacional) |
| `listings` | Anuncios | §4.6 | Adapta (con dos cambios de fondo) |
| `searchTable` | Tabla de búsquedas | §4.7 | Nuevo íntegro |

TypeScript en `apps/web/src/types/home-blocks.ts` — **fichero propio, no `types/blocks.ts`**.
La `BaseHomeBlock` copia el contrato del blog: `id` generado en cliente con `generateId()`
([`lib/utils.ts:16-21`](../apps/web/src/lib/utils.ts#L16-L21)) y persistido tal cual, para
tener keys de React estables y poder reordenar sin bugs de índice; el backend solo valida
que sea una cadena no vacía y nunca lo reescribe ([`base-block.dto.ts:7-12`](../apps/api/src/modules/blog/dto/blocks/base-block.dto.ts#L7-L12)).

### 2.5 Validación en tres niveles

Copia exacta de la arquitectura del blog, verificada en fichero:

**Nivel 1 — el array.** Un `ValidHomeBlocksArray()` empaquetado con `applyDecorators`, molde
literal de [`block.dto.ts:43-70`](../apps/api/src/modules/blog/dto/blocks/block.dto.ts#L43-L70):
`IsArray()` + `ArrayMaxSize()` + `ValidateNested({each:true})` + `Type(() => BaseHomeBlockDto,
{discriminator:{property:'type', subTypes:[…7…]}, keepDiscriminatorProperty:true})`.
Tope de bloques: **30** (el blog usa 100 porque un artículo largo lo justifica; una portada
con 30 bloques ya es una portada rota). **Único punto donde se declaran los subtipos**: un
octavo tipo se registra aquí y en su propio `*-block.dto.ts`, en ningún sitio más.

**Nivel 2 — el campo.** Un `*-block.dto.ts` por tipo, con los validadores compartidos que
ya existen ([`safe-url.ts`](../apps/api/src/common/validators/safe-url.ts)):

- **Toda imagen: `@IsOwnStorageUrl()`** ([`:51-55`](../apps/api/src/common/validators/safe-url.ts#L51-L55)) — upload-only, nunca URL pegada. Igual que `ImageBlockDto.url` ([`image-block.dto.ts:15`](../apps/api/src/modules/blog/dto/blocks/image-block.dto.ts#L15)).
- **Todo enlace: `@IsSafeContentUrl()`** ([`:58-75`](../apps/api/src/common/validators/safe-url.ts#L58-L75)) — ruta relativa `/…` o absoluta http/https; nunca `javascript:`/`data:`.
- **Todo `alt` obligatorio y con `@MaxLength(300)`**, como el bloque `image` del blog ([`:20-23`](../apps/api/src/modules/blog/dto/blocks/image-block.dto.ts#L20-L23)): una imagen sin alt es un bloque mal formado, no un caso opcional.
- Las sub-listas repetibles siguen el molde `HubLinkDto`/`StepItemDto`: `@ArrayMinSize(1)` + `@ArrayMaxSize(n)` + `@ValidateNested({each:true})` + `@Type(() => XDto)` ([`hub-block.dto.ts:39-43`](../apps/api/src/modules/blog/dto/blocks/hub-block.dto.ts#L39-L43)).

**Nivel 3 — cruzado, en el servicio.** Lo que depende de estado externo o del array completo
no cabe en un decorador de campo — criterio explícito del blog
([`blog.service.ts:389-395`](../apps/api/src/modules/blog/blog.service.ts#L389-L395)):

| Regla | Molde |
|---|---|
| Todo `categorySlug` presente (en `listings`, `categoryCarousel`, `searchTable`) **existe** en `Category` — una sola query con `slug: { in: [...] }` para todos los slugs del array | [`assertListingsBlocksValid`](../apps/api/src/modules/blog/blog.service.ts#L396-L423) |
| Máximo **4** bloques `listings` (cada uno es una consulta a Meilisearch por render) | `MAX_LISTINGS_BLOCKS_PER_PAGE` |
| Máximo **1** bloque `search` y **1** `searchTable` | Nuevo. Dos buscadores en la portada es un error de configuración, no un caso de uso; dos tablas de búsquedas duplican cientos de enlaces internos y diluyen el SEO en vez de sumarlo |
| En `steps`, al menos 1 columna; en `grid`, al menos 1 celda | `ArrayMinSize` (nivel 2, no hace falta subirlo) |

**Lo que NO se valida en el backend: los nombres de provincia.** Ver §4.7.

---

## 3. El hero y el título rotativo

Es la pieza genuinamente nueva. **No hay ningún precedente de texto animado en el repo**:
`grep` de `typewriter|rotating|rotativ|framer-motion|@keyframes|animate-\[` sobre
`apps/web/src` → **cero coincidencias**; lo único declarado en
[`tailwind.config.ts:53-73`](../apps/web/tailwind.config.ts#L53-L73) es
`accordion-down`/`accordion-up`, de Radix.

### 3.1 Marcado servido

```html
<section>                                    <!-- ancho completo, fuera del container -->
  <h1>
    Compra y vende
    <span class="hero-rot hero-rot-3" style="--rot-ms:3000">
      <span class="hero-rot-item" style="--i:0">coches</span>
      <span class="hero-rot-item" style="--i:1" aria-hidden="true">bicicletas</span>
      <span class="hero-rot-item" style="--i:2" aria-hidden="true">muebles</span>
    </span>
  </h1>
  <p>…heroSubtitle…</p>
</section>
```

Tres propiedades que este marcado garantiza:

1. **El `<h1>` contiene texto real en el HTML servido.** No hay un `<h1>` vacío que JS
   rellene. Sin JS, sin hidratación y sin CSS, el `<h1>` sigue diciendo algo.
2. **Cero salto de layout.** `.hero-rot` es `inline-grid` y todos los `.hero-rot-item`
   ocupan `grid-area: 1/1`: la caja mide lo que la opción más ancha y no cambia al rotar.
3. **La velocidad viaja como custom property inline** (`--rot-ms`), no como clase de
   Tailwind — es un valor por instancia que el admin fija, y Tailwind solo genera clases
   estáticas.

### 3.2 CSS puro vs island — **DECISIÓN: CSS puro**

| | CSS puro (elegido) | Island (`useState` + `setInterval`) |
|---|---|---|
| Robustez | Funciona sin hidratación, sin JS, con JS fallando | Si la hidratación no llega, el `<h1>` se queda congelado en la primera opción — **aceptable**, pero es una dependencia gratuita |
| Peso | 0 KB de JS | Un componente cliente más en la ruta más visitada del sitio |
| Nº de opciones | **Acotado**: una regla `@keyframes` estática por cada N soportado (N = 2…6) | Cualquier N |
| Control (pausa al hover, avance manual) | No | Sí |
| `prefers-reduced-motion` | Una media query | Hay que implementarlo a mano con `matchMedia` |

Se elige **CSS puro**, y **el tope de 6 opciones es el precio explícito de esa elección**
(por eso está escrito en el schema, §2.2, y no como un límite estético). Es un precio
barato: un `<h1>` con más de 6 variantes es un `<h1>` que ya nadie lee. El control por
hover no se echa en falta en un titular decorativo — y su ausencia elimina la pregunta
"¿qué pasa si el usuario deja el ratón encima justo cuando el crawler mide LCP?".

**Mecanismo.** En `globals.css`, dentro de `@layer utilities`:

- Base: `.hero-rot-item { opacity: 0 }` y `.hero-rot-item:first-child { opacity: 1 }`.
  Sin animaciones aplicadas (o con ellas deshabilitadas), **se ve exactamente la primera
  opción** — que es también la única que el lector de pantalla anuncia (§3.3). Los dos
  modos degradados coinciden, que es justo lo que se quiere.
- Cada ítem: `animation-duration: calc(var(--rot-ms) * var(--n) * 1ms)`,
  `animation-delay: calc(var(--rot-ms) * var(--i) * 1ms)`, `animation-iteration-count: infinite`.
- `animation-name` lo fija la clase `.hero-rot-{n}` del contenedor: cinco reglas
  `@keyframes hero-rot-2 … hero-rot-6`, cada una con el ítem visible durante su
  `1/n` del ciclo y un cruce corto de opacidad. Son estáticas y las escribe una persona
  una vez; **no se generan en runtime** (Tailwind no las vería y el purge se las llevaría).
- `N = 0` → no se emite el `<span class="hero-rot">` en absoluto, solo el título fijo.
  `N = 1` → se emite el `<span>` sin clase `.hero-rot-{n}` ni animación.

### 3.3 Accesibilidad — **DECISIÓN: una sola opción semántica**

El problema real: con las N opciones en el `<h1>`, un lector de pantalla leería
*"Compra y vende coches bicicletas muebles"*.

**Solución: `aria-hidden="true"` en las opciones 2…N.** El nombre accesible del `<h1>` pasa
a ser `heroStaticTitle + heroRotatingOptions[0]` — una frase coherente y completa. Las demás
son decoración visual.

Se descartan dos alternativas:

- **`aria-live` en el contenedor**: anunciaría un cambio de titular cada 3 segundos. Es
  hostil, y además el contenido no es una actualización de estado que el usuario necesite
  conocer: es un adorno.
- **Sacar las N-1 opciones fuera del `<h1>`** (un `<h1>` con la primera + un `<span>`
  hermano con las demás): rompe el punto 2 de §3.1 (el ancho de la caja) y obliga a
  posicionar en absoluto, con el salto de layout de vuelta.

Además, **obligatorio** (no lo hay hoy en ningún sitio del repo):

```css
@media (prefers-reduced-motion: reduce) {
  .hero-rot-item { animation: none; }
}
```

Con la regla base de §3.2, eso deja visible la primera opción y solo la primera: el usuario
con movimiento reducido ve **exactamente** lo que el lector de pantalla oye.

### 3.4 Qué ve el crawler — **DECISIÓN: se acepta la duplicación**

El `<h1>` servido contiene las N variantes. Es duplicación de contenido dentro de un mismo
encabezado, y **es aceptable** por dos razones concretas:

1. **No es texto oculto.** Cada opción es visible durante `1/N` del ciclo; ninguna está
   permanentemente fuera de pantalla ni con `display:none`. No hay nada que se parezca a
   cloaking: lo que el crawler lee es literalmente lo que el usuario acaba viendo.
2. Son **variantes del mismo encabezado**, no encabezados distintos: "Compra y vende
   coches / bicicletas / muebles" describe la misma página con los términos por los que
   de verdad se busca.

El tope de 6 (§3.2) también acota esto: un `<h1>` no se convierte en una lista de palabras
clave.

### 3.5 Ancho completo

El hero no pasa por `HomeBlockRenderer` (§2.3), así que la página lo envuelve en su propia
`<section>` a sangre, exactamente como hoy
([`(home)/page.tsx:45-78`](../apps/web/src/app/(public)/(home)/page.tsx#L45-L78)). El array
de bloques conserva su envoltura uniforme. **Ninguno de los dos necesita saber del otro.**

---

## 4. Los 7 bloques

### 4.0 Doctrina de reuso — **DECISIÓN: se comparte lo presentacional de props planas**

El encargo delegó cómo compartir renderizadores entre dos motores sin acoplarlos. Regla,
en una línea:

> **Se comparte todo componente cuya firma NO mencione un tipo de bloque. Nada cuya firma
> lleve un `Block` cruza la frontera entre motores.**

El acoplamiento no lo produce el JSX: lo produce el **tipo**. `CtaBlockRenderer({block:
CtaBlock})` importa `CtaBlock` de `@/types/blocks`, que es el sistema de tipos del blog;
si la portada lo llama, cualquier cambio en el `CtaBlock` del blog rompe la portada y
viceversa. Pero el *contenido* de ese renderizador — el mapa estilo→variante y el reparto
interno/externo ([`CtaBlockRenderer.tsx:5-31`](../apps/web/src/components/blocks/CtaBlockRenderer.tsx#L5-L31)) —
no depende de ningún bloque.

Aplicación concreta:

| Pieza | Qué se hace | Por qué |
|---|---|---|
| **`SmartLink`** (interno `<Link>` / externo `<a target="_blank" rel="noopener noreferrer">`) | **Extraer a `components/shared/`.** Hoy está **cuadruplicado literalmente**: [`CtaBlockRenderer.tsx:11-13`](../apps/web/src/components/blocks/CtaBlockRenderer.tsx#L11-L13), [`HubBlockRenderer.tsx:6-8`](../apps/web/src/components/blocks/HubBlockRenderer.tsx#L6-L8), [`Footer.tsx:26-38`](../apps/web/src/components/layout/Footer.tsx#L26-L38), [`MainNav.tsx:9-19`](../apps/web/src/components/layout/MainNav.tsx#L9-L19) | Props planas (`href`, `external?`, `className`, `children`). Cero tipos de bloque. Lo necesitan `cta`, `grid`, `steps` y `searchTable` |
| **`CtaButton`** (`{label, href, style}`) | **Extraer a `components/shared/`**; los renderizadores `cta` de **ambos** motores lo llaman desde su propio fichero | El renderizador del blog se queda donde está y solo adelgaza |
| **`SearchBar`** | **Reuso directo, cero refactor** | Ya tiene props planas (`{defaultValue?, categories?}`, [`SearchBar.tsx:12-16`](../apps/web/src/components/busqueda/SearchBar.tsx#L12-L16)) y vive en `components/busqueda/`, territorio neutral |
| **`ListingCard`** | **Reuso directo, cero refactor** | Props planas (`{listing, priority?}`), ya compartido hoy entre la home y el bloque del blog |
| **`resolve-listings.ts`** | **Se copia el patrón, no el código**: `lib/home-blocks/resolve-listings.ts` propio | Su firma es `(blocks: Block[])` — es exactamente lo que la regla prohíbe cruzar. Son ~20 líneas de `Promise.all`; el coste de duplicarlas es mucho menor que el de acoplar los dos sistemas de tipos |
| **`StepsBlockRenderer`, `HubBlockRenderer`, `CategoryGrid`** | **No se comparten** | Los dos primeros porque la versión de portada es estructuralmente distinta (§4.4, §4.3); `CategoryGrid` porque el carrusel lleva imagen propia y control de desplazamiento (§4.2) |

Se descarta explícitamente **(a) importar el renderizador del blog y adaptar el tipo**
(mete un tipo del blog en la firma pública de la portada, que es el acoplamiento que se
quería evitar) y **(c) duplicar** el presentacional (diverge: el reparto interno/externo ya
ha divergido cuatro veces).

---

### 4.1 `search` — Buscador · **adapta · island sobre markup SSR**

**Reusa:** `SearchBar` tal cual ([`components/busqueda/SearchBar.tsx`](../apps/web/src/components/busqueda/SearchBar.tsx)).

Es `'use client'`, pero su markup es un `<form>` nativo con dos `<select>` y un
`<input type="search">`: **está entero en el HTML servido** y funciona sin JS. El JS solo
añade sugerencias de etiquetas con debounce ([`:43-66`](../apps/web/src/components/busqueda/SearchBar.tsx#L43-L66))
y navegación con flechas.

El renderizador de bloque es **Server Component** y le pasa el árbol de categorías, que la
página ya cargó (`SearchBar` no hace query propia, lo recibe por props —
[`:14`](../apps/web/src/components/busqueda/SearchBar.tsx#L14)). Las provincias son la
constante `PROVINCIAS`, sin coste.

**Config del bloque:** `{ id, type:'search', eyebrow?, showPopularCategories?, popularCount? }`.
El *eyebrow* ("Miles de anuncios cerca de ti", hoy [`:48-50`](../apps/web/src/app/(public)/(home)/page.tsx#L48-L50))
y los chips de categorías populares ([`:56-69`](../apps/web/src/app/(public)/(home)/page.tsx#L56-L69))
entran aquí y no en el hero: son vecindad del buscador, no del titular.

### 4.2 `categoryCarousel` — Carrusel de categorías · **nuevo · island de desplazamiento sobre SSR**

**Base:** [`CategoryGrid.tsx`](../apps/web/src/components/categorias/CategoryGrid.tsx), que
ya resuelve el 80 %: **cero JS**, scroll horizontal CSS nativo en móvil
(`overflow-x-auto snap-x`, [`:8`](../apps/web/src/components/categorias/CategoryGrid.tsx#L8)),
todas las categorías en el HTML.

**No reusa `CardPhotoCarousel`** ([`CardPhotoCarousel.tsx`](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx)):
monta **un solo `<Image>`, el de `index`**, por decisión de rendimiento explícita
([`:21-32`](../apps/web/src/components/anuncios/CardPhotoCarousel.tsx#L21-L32)). Es
exactamente lo contrario de lo que se necesita aquí.

**Config:** `{ id, type:'categoryCarousel', title?, items: [{ categorySlug, imageUrl, alt, label? }] }`
— 1…12 ítems, `imageUrl` con `@IsOwnStorageUrl`, `alt` obligatorio, `label?` para poder
acortar el nombre de la categoría sin tocar `Category` (mismo criterio que `FooterItem.label`
y `NavItem.label` respecto a `Post.title`).

**Render (servidor):**
- Resuelve cada `categorySlug` contra el árbol ya cargado con `findCategoryUrlParts()` y
  construye el `href` con `categoryPath()` ([`category-url.ts:35-70`](../apps/web/src/lib/category-url.ts#L35-L70)).
  **Regla de proyecto: nadie construye `/${slug}` a mano** ([`:5-9`](../apps/web/src/lib/category-url.ts#L5-L9)).
- **Un slug que ya no existe se omite**, no rompe la fila ni deja un enlace a un 404. Es la
  doctrina "se acepta al escribir, se oculta al leer" que el nav ya adoptó, y aquí es
  necesaria porque no hay FK que proteja el borrado de una categoría.
- Imagen: `<img>` plano + `isSafeSrc()` como guarda de render, molde
  [`ImageBlockRenderer.tsx:17-25`](../apps/web/src/components/blocks/ImageBlockRenderer.tsx#L17-L25) — ver §7.

**Island:** solo las flechas ‹ › que hacen `scrollBy` sobre el contenedor. Sin estado de
"foto actual", sin montar/desmontar nada. Si no hidrata, el usuario sigue pudiendo
arrastrar y hacer scroll: **la funcionalidad completa está en CSS; el island es una
comodidad**.

> **CORRECCIÓN (RP.5/RP.6) — este bloque NO retira `CategoryGrid`.**
>
> §8 daba por hecho que, al existir el carrusel, la rejilla escrita a mano en la home
> desaparecía. Al implementarlo se vio que esa previsión no se puede cumplir: el carrusel
> exige una **foto subida por categoría** (`imageUrl` con `@IsOwnStorageUrl`, arriba), y
> **una semilla no puede subir ficheros**. Retirar la rejilla dejaría toda instalación
> nueva —y la de test— sin sección de categorías en la portada, que es exactamente lo que
> ninguna ráfaga puede hacer.
>
> **Decisión firme:** `CategoryGrid` **se queda como fallback** de la página, no como
> andamio pendiente de retirar. La página la pinta si —y solo si— no hay ningún bloque
> `categoryCarousel` configurado, y en el sitio donde estaba: justo antes del primer
> bloque `listings`. El día que un admin suba las fotos y configure el carrusel, la
> rejilla deja de pintarse sola, sin tocar código.
>
> Es la única excepción, junto con los banners, al "la portada la pinta entera el motor"
> de §5.1, y está escrita en el propio `(home)/page.tsx`.

### 4.3 `grid` — Rejilla de tarjetas · **nuevo · SSR puro, cero JS**

Cubre dos huérfanos de la home a la vez: los chips "Populares" y la fila de 4 señales de
confianza ([`:163-176`](../apps/web/src/app/(public)/(home)/page.tsx#L163-L176)).

**Config:** `{ id, type:'grid', title?, columns: 1|2|3|4|6, items: [Cell] }` con
`Cell = { media?, title, description?, href? }`.

**`media` es una unión discriminada — DECISIÓN:**

```ts
type GridMedia =
  | { kind: 'image'; url: string; alt: string }   // @IsOwnStorageUrl + alt obligatorio
  | { kind: 'icon';  name: HomeIconName }         // @IsIn(HOME_ICON_NAMES)
```

Por qué no solo imagen: las 4 señales de confianza usan iconos lucide de 16 px
(`ShieldCheck`, `MessageCircle`, `Star`, `Sparkles`). Obligar a subir un PNG para eso es
absurdo y se ve peor.

Por qué **allowlist cerrada** y no un nombre libre de lucide: un nombre arbitrario obliga a
resolver el icono en runtime, lo que rompe el tree-shaking de `lucide-react` y arrastra la
librería entera al bundle de una ruta que hoy no la carga completa. Se declara un
`ICON_MAP: Record<HomeIconName, LucideIcon>` estático (~12 iconos) en el renderizador, y el
DTO valida con `@IsIn(HOME_ICON_NAMES)`. El editor lo pinta como una rejilla de iconos para
elegir, no como un campo de texto.

`href` y `description` son **opcionales**: las señales de confianza no enlazan a ningún
sitio. Celda sin `href` → `<div>`; con `href` → `SmartLink` (§4.0).

`columns` se mapea a un `Record<1|2|3|4|6, string>` de clases **estáticas** de Tailwind
(`'sm:grid-cols-2 md:grid-cols-4'`…), nunca a una clase interpolada: Tailwind purga lo que
no ve escrito.

### 4.4 `steps` — Pasos por audiencia · **nuevo · SSR puro** — **desviación 2**

**No reusa `StepsBlockRenderer`.** El del blog es una secuencia única; la portada necesita
lo que hoy pinta a mano: dos columnas con encabezado de audiencia, tres pasos numerados
cada una y un enlace de cierre por columna
([`(home)/page.tsx:119-161`](../apps/web/src/app/(public)/(home)/page.tsx#L119-L161) +
`TrustStep` local en [`:183-195`](../apps/web/src/app/(public)/(home)/page.tsx#L183-L195)).

**Config:**

```ts
{
  id, type: 'steps',
  title?: string,                          // "Cómo funciona"
  columns: [{                              // 1..3
    audienceTitle: string,                 // "Para compradores"
    icon?: HomeIconName,                   // misma allowlist que grid (§4.3)
    steps: [{ title, description }],       // 1..6
    cta?: { label, href },                 // "Buscar ahora →"
  }],
}
```

Dos cosas que **no** se copian del blog aquí: la imagen por paso (`StepItem.image`,
[`types/blocks.ts:106`](../apps/web/src/types/blocks.ts#L106)) —la home no la usa y añade
una superficie de upload por nada— y el `title` como único encabezado, porque aquí hay dos
niveles (título del bloque + título de columna).

La numeración (`1`, `2`, `3` en círculo) la pone el renderizador a partir del índice del
paso, igual que hoy; no es un campo.

### 4.5 `cta` — Botón destacado · **adapta · SSR puro**

El más barato de los siete. Config idéntica a la del blog: `{ id, type:'cta', label, href,
style?: 'primary'|'secondary'|'outline' }`, con `href` bajo `@IsSafeContentUrl`.

El renderizador de portada es tres líneas: llama a `CtaButton` (§4.0). Cubre el "¿Tienes
algo que vender? Publica gratis" actual ([`:71-75`](../apps/web/src/app/(public)/(home)/page.tsx#L71-L75)).

### 4.6 `listings` — Anuncios · **adapta · SSR** — **desviación 3**

**Config:** `{ id, type:'listings', title?, categorySlug?, limit: 4|6|8|12, sort?:
'recent'|'featured', showAllLink? }`.

**Cambio 1 — `categorySlug` OPCIONAL.** Ausente ⇒ `search({ sort, hitsPerPage: limit })` sin
`category`, que es literalmente lo que hace la home hoy
([`:23`](../apps/web/src/app/(public)/(home)/page.tsx#L23)). El DTO del blog lo exige
([`listings-block.dto.ts:22-25`](../apps/api/src/modules/blog/dto/blocks/listings-block.dto.ts#L22-L25))
porque en un artículo "los anuncios recientes de todo el sitio" no significa nada; en la
portada es el caso principal.

Consecuencias que el diseño asume:
- `showAllLink` sin categoría apunta a `/busqueda?sort=publishedAt:desc`, como hoy
  ([`:97`](../apps/web/src/app/(public)/(home)/page.tsx#L97)); con categoría, a
  `categoryPath()`, como el bloque del blog ([`ListingsBlockRenderer.tsx:49-52`](../apps/web/src/components/blocks/ListingsBlockRenderer.tsx#L49-L52)).
- Sin `category`, `SearchController` **nunca** inyecta un patrocinado (nota verificada en
  [`(home)/page.tsx:29-31`](../apps/web/src/app/(public)/(home)/page.tsx#L29-L31)). El filtro
  `isSponsoredAdHit` se mantiene igualmente como guarda de tipos, igual que hoy.

**Cambio 2 — se recuperan los dos providers.** El renderizador envuelve la rejilla en
`<CardAttributesProvider cardAttributeMap>` + `<FavoritesGridProvider listingIds>`, molde
[`(home)/page.tsx:102-110`](../apps/web/src/app/(public)/(home)/page.tsx#L102-L110).

> **Esto NO rompe el SSR, y es el punto que hay que entender del diseño.** Ambos providers
> son `'use client'` ([`CardAttributesContext.tsx:1`](../apps/web/src/components/anuncios/CardAttributesContext.tsx#L1),
> [`FavoritesGridContext.tsx:1`](../apps/web/src/components/anuncios/FavoritesGridContext.tsx#L1)),
> pero reciben los `ListingCard` **como `children` creados en un Server Component**, así que
> las tarjetas se renderizan en servidor y su HTML viaja en la respuesta. El cliente solo
> monta el contexto alrededor. Es el mismo patrón que la home ya usa hoy y el mismo que
> usará la tabla de búsquedas (§4.7).

`cardAttributeMap` se calcula **una vez a nivel de página** con `buildCardAttributeMap(categories)`
([`card-attributes.ts:45-54`](../apps/web/src/lib/card-attributes.ts#L45-L54)) y se pasa por
props al renderizador, no por bloque.

**Resolución de datos:** `lib/home-blocks/resolve-listings.ts` propio (§4.0), molde
[`resolve-listings.ts:45-65`](../apps/web/src/lib/blocks/resolve-listings.ts#L45-L65): todos
los bloques `listings` en un `Promise.all` **antes** del render, y el renderizador recibe
`data` ya resuelta. Así `HomeBlockRenderer` sigue siendo **síncrono**, que es lo que permite
compartirlo con el preview del editor ([`BlockRenderer.tsx:25-31`](../apps/web/src/components/blocks/BlockRenderer.tsx#L25-L31)).

Se conserva el `revalidate` corto propio de la búsqueda (180 s,
[`:13`](../apps/web/src/lib/blocks/resolve-listings.ts#L13)) pasado a `search()` vía
`fetchOptions.next` ([`busqueda.ts:41-52`](../apps/web/src/lib/api/busqueda.ts#L41-L52)).
Nota: la portada es dinámica (decisión 4), así que aquí ese TTL actúa sobre la caché de
`fetch`, no sobre un ISR de ruta.

**Estado vacío:** el bloque se oculta (`return null`), molde
[`ListingsBlockRenderer.tsx:46-47`](../apps/web/src/components/blocks/ListingsBlockRenderer.tsx#L46-L47).
El aviso al admin de "esta categoría no tiene anuncios" vive en el editor, como en
[`ListingsBlockEditor.tsx:104-110`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/editors/ListingsBlockEditor.tsx#L104-L110).

### 4.7 `searchTable` — Tabla de búsquedas · **nuevo íntegro · island de visibilidad** — **desviación 4**

Es el bloque con más valor SEO y el único sin precedente alguno.

**Config:**

```ts
{
  id, type: 'searchTable',
  title?: string,
  tabs: [                                   // 1..3, el admin elige cuáles y en qué orden
    | { kind: 'locations';   label: string }                       // las 52 provincias
    | { kind: 'categories';  label: string; includeChildren?: boolean }
    | { kind: 'combos';      label: string;
        items: [{ categorySlug, province }] }                      // 1..60 pares
  ],
  columns?: 2 | 3 | 4,                      // reparto visual de los enlaces
}
```

**Fuentes de datos, todas ya disponibles y todas SSR:**

| Pestaña | Fuente | Enlace generado |
|---|---|---|
| `locations` | `PROVINCIAS`, 52 constantes ([`lib/provincias.ts:9`](../apps/web/src/lib/provincias.ts#L9)) | `/busqueda?province=…` — mismo destino al que navega hoy el buscador sin categoría ([`SearchBar.tsx:97-99`](../apps/web/src/components/busqueda/SearchBar.tsx#L97-L99)) |
| `categories` | el árbol que la página ya cargó | `categoryPath(cat)` ([`category-url.ts:35-37`](../apps/web/src/lib/category-url.ts#L35-L37)) |
| `combos` | pares configurados | `categoryPathWithQuery(parts, new URLSearchParams({province}))` ([`:43-49`](../apps/web/src/lib/category-url.ts#L43-L49)) → `/vehiculos/coches?province=Madrid` |

Los tres pasan **siempre** por los helpers de `category-url.ts`; nunca se concatena una URL
a mano (regla del repo, [`:5-9`](../apps/web/src/lib/category-url.ts#L5-L9)).

**Validación de `province` — DECISIÓN: no se valida en el backend, se filtra al leer.**
`PROVINCIAS` es una constante **de frontend**; el backend no tiene la lista (filtra
`province` como coincidencia exacta contra Meilisearch). Duplicarla en la API crearía una
segunda copia de 52 cadenas que hay que mantener sincronizada a mano — el mismo riesgo que
[`lib/provincias.ts:1-8`](../apps/web/src/lib/provincias.ts#L1-L8) ya documenta respecto a
`municipios.json`, pero multiplicado. En su lugar:

- el DTO valida solo forma (`@IsString @MaxLength(60)`);
- **el editor ofrece un `<select>` de `PROVINCIAS`**, así que un typo es prácticamente
  imposible de introducir;
- **el renderizador omite la combinación cuya provincia no esté en `PROVINCIAS`** — misma
  doctrina "se acepta al escribir, se oculta al leer" que el nav adoptó y que este diseño
  ya aplica a los `categorySlug` colgados (§4.2).

Se registra la alternativa rechazada: duplicar la lista en `apps/api/src/common/`. Se puede
adoptar más adelante sin cambiar nada del render.

**El patrón de tabs SSR — DECISIÓN: island propio, no Radix.**

`@radix-ui/react-tabs` no está instalado, y su comportamiento por defecto es **desmontar el
panel inactivo** (haría falta `forceMount` + ocultar a mano). Instalar una dependencia para
después desactivar su comportamiento principal no compensa. El island propio son ~40 líneas:

```
HomeSearchTabs  ('use client')
  props: tabs: { id, label, panel: React.ReactNode }[]   ← panel ya renderizado en servidor
  estado: activeId
  render: <div role="tablist">  <button role="tab" aria-selected aria-controls id> … </button>
          {tabs.map(t => <div role="tabpanel" aria-labelledby hidden={t.id !== activeId}>{t.panel}</div>)}
```

Lo esencial: **los paneles llegan como `ReactNode` creados en el Server Component**, igual
que los `ListingCard` dentro de `FavoritesGridProvider` (§4.6). Los cientos de enlaces se
renderizan en servidor y están en el HTML; el cliente solo mueve un atributo `hidden`.

Teclado: `role="tablist"` + flechas ←/→ + `tabIndex` móvil (roving), `Home`/`End`. Es lo
mismo que Radix daría, escrito a mano porque el resto de Radix no hace falta aquí.

**Trade-off asumido, escrito:** los paneles 2 y 3 se sirven **con** el atributo `hidden`
puesto desde servidor (no se pintan los tres y luego se ocultan). El contenido está en el
HTML y sus enlaces se rastrean y siguen; a cambio, Google pondera algo menos el contenido
que solo es visible tras interacción. La alternativa —los tres paneles visibles a la vez—
destruye la interfaz, que es el motivo de que haya pestañas. Se elige el `hidden` de
servidor también para evitar el parpadeo que tendría pintarlos todos y ocultarlos al
hidratar — el mismo criterio de "el primer render coincide con el SSR" que `BannerList` ya
documenta y acepta ([`BannerList.tsx:64-70`](../apps/web/src/components/banners/BannerList.tsx#L64-L70)).

---

## 5. Render, caché y revalidación

### 5.1 La página

`(public)/(home)/page.tsx` (movida ahí en RN.3) pasa a:

```
export default async function HomePage() {
  const [config, categories, banners] = await Promise.all([
    getCachedHomepageConfig().catch(() => FALLBACK),   // ← cacheada, §5.2
    getCategories().catch(() => []),
    getActiveBanners('HOME').catch(() => []),
  ]);

  const listingsData = await resolveHomeListingsData(config.blocks);   // §4.6

  return (
    <>
      {banners.length > 0 && <BannerList banners={banners} />}         // §5.4
      <HomeHero config={config} />                                     // §3
      <HomeBlockRenderer
        blocks={config.blocks}
        categories={categories}
        cardAttributeMap={buildCardAttributeMap(categories)}
        listingsData={listingsData}
      />
    </>
  );
}
```

Tres propiedades del molde que se conservan literalmente:

- **Todo `.catch` degrada, nunca rompe.** Es como está hoy
  ([`(home)/page.tsx:21-27`](../apps/web/src/app/(public)/(home)/page.tsx#L21-L27)) y como
  está el footer ([`Footer.tsx:9`](../apps/web/src/components/layout/Footer.tsx#L9)) y el
  nav ([`MainNav.tsx:39`](../apps/web/src/components/layout/MainNav.tsx#L39)). `FALLBACK`
  es un hero mínimo con el título por defecto y `blocks: []`: **con el backend caído la
  portada sigue teniendo `<h1>`, header, nav y footer**.
- **`HomeBlockRenderer` es síncrono** y con `switch` exhaustivo + `assertUnreachable`
  ([`BlockRenderer.tsx:21-23`](../apps/web/src/components/blocks/BlockRenderer.tsx#L21-L23)).
  El octavo tipo sin `case` rompe el build.
- **El árbol de categorías se carga UNA vez** a nivel de página y se pasa por props
  (`search`, `categoryCarousel`, `listings` y `searchTable` lo necesitan). El blog lo carga
  dentro de su resolver ([`resolve-listings.ts:51-62`](../apps/web/src/lib/blocks/resolve-listings.ts#L51-L62))
  porque allí la mayoría de páginas no lo necesita; en la portada casi todos los bloques sí.

### 5.2 Caché — molde footer, **el caso más simple de los dos**

```ts
// lib/api/homepage.ts
export const getCachedHomepageConfig = unstable_cache(
  () => apiFetch<HomepageConfig>('/homepage'),
  ['homepage-config'],
  { revalidate: 3600, tags: ['homepage-config'] },
);
```

Copia literal de [`footer.ts:31-35`](../apps/web/src/lib/api/footer.ts#L31-L35): **una
entrada, clave constante, un tag**. No es el caso del nav, que necesita 9 entradas porque
su endpoint filtra por tipo de página ([`nav.ts:43-65`](../apps/web/src/lib/api/nav.ts#L43-L65));
`GET /homepage` no filtra nada.

`revalidate: 3600` es **red de seguridad, no la vía principal**: lo normal es que la entrada
muera por tag en cuanto un admin guarda.

**Invalidación:** `HomepageService.update()` llama a
`revalidateService.revalidateTag('homepage-config')`, molde
[`nav.service.ts:117`](../apps/api/src/modules/nav/nav.service.ts#L117) y
[`footer`](../apps/api/src/modules/footer/footer.service.ts). La cadena completa ya existe y
está verificada: `RevalidateService` hace `POST {APP_URL}/api/revalidate?secret&tag`
fire-and-forget con timeout de 3 s ([`revalidate.service.ts:37-64`](../apps/api/src/common/revalidate/revalidate.service.ts#L37-L64))
→ el route handler llama a `revalidateTag(tag)` ([`api/revalidate/route.ts:13-17`](../apps/web/src/app/api/revalidate/route.ts#L13-L17)).
**No hay que tocar nada de esa cadena.**

**Lo que NO invalida la config — y por qué está bien.** Borrar una categoría, publicar una
página o cambiar un anuncio **no** bustean `'homepage-config'`: la config no ha cambiado.
Lo que cambia es el mundo contra el que se resuelve, y eso se resuelve **en cada render**
(la página es dinámica, decisión 4) y se filtra al leer (§4.2, §4.7). Es la consecuencia
limpia de cachear la configuración y no los datos resueltos, y evita por completo el
acoplamiento cruzado que el blog sí necesita ([`blog.service.ts:449-456`](../apps/api/src/modules/blog/blog.service.ts#L449-L456)
tiene que bustear `'footer-nav'` y `'main-nav'`).

### 5.3 Contrato de la API

| Método | Ruta | Auth | Devuelve |
|---|---|---|---|
| `GET` | `/homepage` | público | La config completa (hero + `blocks`). Un solo `findUnique` |
| `GET` | `/admin/homepage` | `@Roles(Role.ADMIN)` | Lo mismo. Existe por simetría con el resto del backoffice y para no depender del endpoint público en el editor |
| `PATCH` | `/admin/homepage` | `@Roles(Role.ADMIN)` | `upsert` de **toda** la config (hero + array completo) + `auditLog.log` + `revalidateTag` |
| `POST` | `/admin/homepage/upload-image` | `@Roles(Role.ADMIN)` | `{ url }`. Molde [`blog-admin.controller.ts:68-88`](../apps/api/src/modules/blog/blog-admin.controller.ts#L68-L88): `memoryStorage`, tope de tamaño, allowlist MIME (JPEG/PNG/WebP), `R2Service.upload()` + `getPublicUrl()` con prefijo `homepage/` |

**Un solo `PATCH` con el objeto entero**, no un CRUD por bloque: los bloques no son filas,
son un Json de una fila — el mismo motivo por el que el editor del blog manda el array
completo en el submit del formulario y no una petición por bloque
([`BlockEditor.tsx:12-17`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/BlockEditor.tsx#L12-L17)).

**Rol: `ADMIN`.** Verificado: los dos sistemas de configuración global del sitio son
`@Roles(Role.ADMIN)` a nivel de clase — [`footer-admin.controller.ts:31`](../apps/api/src/modules/footer/footer-admin.controller.ts#L31)
y [`nav-admin.controller.ts:28`](../apps/api/src/modules/nav/nav-admin.controller.ts#L28).
El blog es más permisivo (`EDITOR, MODERATOR, ADMIN`) porque es contenido, no configuración.
La portada es configuración. **Upload propio y no el del blog** precisamente para que el rol
del upload coincida con el rol de quien puede usar el resultado.

### 5.4 Integración con lo que permanece

Orden real del DOM, verificado:

```
RootLayout                          app/layout.tsx:17-25   ← await auth() (dinámico)
 └ (public)/layout.tsx:4-12         <Header/> sticky top-0 z-50
                                    <main class="min-h-screen">
 │   └ (home)/layout.tsx:6-13         <MainNav pageType="HOME"/>     ← RN.3, DENTRO del main
 │       └ (home)/page.tsx            <BannerList/> · <HomeHero/> · <HomeBlockRenderer/>
                                    </main>
                                    <Footer/>   ← columnas dinámicas + barra estática, un solo componente
```

**El hero no puede asumir que hay nav encima.** `MainNav` devuelve `null` —sin `<nav>`, sin
contenedor y sin borde— si no hay ningún nodo visible ("gate total",
[`MainNav.tsx:41-44`](../apps/web/src/components/layout/MainNav.tsx#L41-L44)). El hero debe
verse igual de bien pegado al nav que pegado al `<header>` sticky. En la práctica: su
espaciado superior es propio, no heredado de un margen del nav.

**Apilamiento.** `Header` es `z-50` ([`Header.tsx:23`](../apps/web/src/components/layout/Header.tsx#L23)),
`NavDropdown` es `z-40` a propósito, por debajo ([`NavDropdown.tsx:74`](../apps/web/src/components/layout/NavDropdown.tsx#L74)).
**El hero y todos los bloques se quedan por debajo de `z-40`.** Ningún elemento de la
portada debe tapar el header ni un submenú abierto.

**Banners — DECISIÓN: siguen ENCIMA del hero, exactamente donde están hoy**
([`(home)/page.tsx:36-40`](../apps/web/src/app/(public)/(home)/page.tsx#L36-L40)).

| | Encima del hero (elegido) | Debajo del hero |
|---|---|---|
| Aviso urgente ("mantenimiento el sábado") | Se ve al entrar | Enterrado bajo un hero a media pantalla — que es tanto como no publicarlo |
| Estabilidad vertical del hero | El hero baja cuando hay banner activo | El hero no se mueve |
| Cambio respecto a hoy | Ninguno | Habría que justificarlo |

Pesa más la primera fila: un banner que no se ve no cumple su función, y su presencia es
excepcional y temporal (`startsAt`/`endsAt`). El nav ya tomó la decisión simétrica —la barra
va **encima** del `BannerList`, "chrome sobre contenido"—, y esto la respeta: chrome
(header, nav) → aviso (banner) → contenido (hero, bloques).

---

## 6. Editor de admin — `/admin/portada`

Página cliente (todo `(admin)` lo es), un solo formulario con dos zonas y **un solo botón de
guardar** que manda toda la config.

**Zona 1 — Hero.** `heroStaticTitle` (texto), `heroRotatingOptions` (lista repetible con
`SubItemList`, tope 6, con el motivo del tope escrito cuando se llega — molde
[`SubItemList.tsx`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/SubItemList.tsx),
que ya deshabilita "quitar" en el mínimo y lo explica en el `title` del botón,
[`:83-86`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/SubItemList.tsx#L83-L86)),
`heroRotationMs` (número con unidad visible: "cada N segundos"), `heroSubtitle`.

**Zona 2 — Bloques.** `HomeBlockEditor`, molde literal de
[`BlockEditor.tsx`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/BlockEditor.tsx):

| Pieza | Molde verificado |
|---|---|
| Estado = el array; añadir/mover/borrar son manipulaciones puras de array | [`BlockEditor.tsx:78-96`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/BlockEditor.tsx#L78-L96) |
| Reordenar con flechas ↑↓ (sin drag&drop), deshabilitadas en los extremos | [`BlockEditorRow.tsx:102-119`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/BlockEditorRow.tsx#L102-L119) |
| Borrar con confirmación **solo si el bloque tiene contenido** (`blockHasContent`) | [`blockDefaults.ts:96-129`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/blockDefaults.ts#L96-L129) |
| Selector de tipo como **panel de tarjetas** con nombre + descripción en lenguaje claro, no un `<select>` | [`BlockTypePicker.tsx:8-11`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/BlockTypePicker.tsx#L8-L11) |
| `HOME_BLOCK_TYPE_META` con etiquetas sin jerga ("Tabla de búsquedas", no "searchTable") y orden fijo de simple a elaborado | [`blockDefaults.ts:25-57`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/blockDefaults.ts#L25-L57) |
| `createDefaultHomeBlock(type)` que arranca las sub-listas con 1 ítem, porque el backend exige `ArrayMinSize(1)` | [`blockDefaults.ts:59-93`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/blockDefaults.ts#L59-L93) |
| `switch` exhaustivo con `assertUnreachable` **también aquí** | [`BlockEditorRow.tsx:21-63`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/BlockEditorRow.tsx#L21-L63) |
| Clases compartidas `inputCls`/`labelCls`/`errorCls` | [`editors/shared.ts`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/editors/shared.ts) |
| Upload por bloque con estado *subiendo/error* junto al campo | [`ImageBlockEditor.tsx:35-49`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/editors/ImageBlockEditor.tsx#L35-L49) |
| Aviso "esta categoría no tiene anuncios ahora mismo" con `search({hitsPerPage:1})` | [`ListingsBlockEditor.tsx:52-72`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/editors/ListingsBlockEditor.tsx#L52-L72) |

**El preview es obligatorio aquí, no opcional.** Sin borrador/publicado (decisión 2),
guardar es publicar. El preview reusa el **mismo `HomeBlockRenderer`** que el sitio público
—que por eso es síncrono— resolviendo los datos de `listings` en un efecto cliente
equivalente, exactamente como [`BlockEditor.tsx:44-76`](../apps/web/src/app/(admin)/admin/blog/_components/block-editor/BlockEditor.tsx#L44-L76).
El preview incluye el hero, con la rotación funcionando: es la única forma de que el admin
juzgue si `heroRotationMs` es legible antes de que lo vea el mundo.

**Validación de cliente**: espejo de `isSafeContentUrl` para dar el error junto al campo sin
esperar el round-trip, con el backend siempre como fuente de verdad — el fichero
[`lib/blocks/validation.ts:1-6`](../apps/web/src/lib/blocks/validation.ts#L1-L6) ya lo
explica y se reusa tal cual (no menciona ningún tipo de bloque: cruza la frontera de §4.0
sin problema).

Entrada nueva en `AdminNav`.

---

## 7. ⚠ La trampa de las dos allowlists de imágenes

Afecta a **`categoryCarousel` y `grid`**, los dos bloques con imagen, y es una trampa que ya
existe hoy en el blog:

| Momento | Comprobación | Fuente |
|---|---|---|
| Al **guardar** (backend) | `isOwnStorageUrl` = `value.startsWith(process.env.S3_PUBLIC_URL)` | [`safe-url.ts:51-55`](../apps/api/src/common/validators/safe-url.ts#L51-L55) |
| Al **pintar** (frontend) | `isSafeSrc` contra `remotePatterns` = `http://localhost` y `https://*.r2.cloudflarestorage.com` | [`image-domains.ts:1-18`](../apps/web/src/lib/image-domains.ts#L1-L18) |

**Son dos listas independientes.** Si `S3_PUBLIC_URL` apunta a un dominio que no está en
`remotePatterns`, el backend acepta la imagen y el frontend la descarta **en silencio**
(`return null`, [`ImageBlockRenderer.tsx:18`](../apps/web/src/components/blocks/ImageBlockRenderer.tsx#L18)).
El mismo `remotePatterns` alimenta `images.remotePatterns` de
[`next.config.ts`](../apps/web/next.config.ts), así que un desajuste rompe además cualquier
`next/image`.

**Lo que este diseño exige:**

1. Todo renderizador de portada con imagen llama a `isSafeSrc()` **y degrada a un
   fallback visible** (la inicial de la categoría en un círculo, como
   [`CategoryGrid.tsx:25-29`](../apps/web/src/components/categorias/CategoryGrid.tsx#L25-L29),
   o el icono en `grid`), **nunca deja un hueco**. Es la diferencia con el bloque `image`
   del blog, que sí desaparece: en un artículo una imagen menos es aceptable; en una
   rejilla de portada deja un agujero en la maquetación.
2. `<img>` plano y no `next/image`, porque estos bloques no guardan dimensiones — mismo
   criterio y misma justificación escrita que
   [`ImageBlockRenderer.tsx:11-16`](../apps/web/src/components/blocks/ImageBlockRenderer.tsx#L11-L16)
   y [`StepsBlockRenderer.tsx:17-20`](../apps/web/src/components/blocks/StepsBlockRenderer.tsx#L17-L20).
3. **Nota de despliegue** en el README de infraestructura: `S3_PUBLIC_URL` debe estar
   cubierto por `remotePatterns`. Es la única mitigación real del desajuste.

---

## 8. Ráfagas de implementación

Seis ráfagas. **La propiedad que las ordena: la fila semilla reproduce la portada actual con
los tipos que existan en cada momento, y cada ráfaga sustituye la sección hardcodeada
correspondiente por su bloque.** No hay ningún punto intermedio en el que la portada pierda
algo que hoy tiene.

### RP.1 — Backend: config global, hero y esqueleto del motor
- Migración: `HomepageConfig` (§2.2). Fila semilla en `seed.ts` con el hero actual
  (`heroStaticTitle: "Compra y vende de segunda mano"`) y `blocks: []`.
- `BaseHomeBlockDto`, `ValidHomeBlocksArray()` y los **dos primeros tipos**: `cta` y
  `search`. El motor queda ejercitado de extremo a extremo con el coste mínimo.
- `HomepageService`: `get()`, `update()` con las reglas cruzadas de §2.5 nivel 3,
  `uploadImage()`.
- `HomepageController` (público) + `HomepageAdminController` (`@Roles(Role.ADMIN)`).
- `auditLog.log` + `revalidateTag('homepage-config')` en `update()`.
- e2e (`homepage.e2e-spec.ts`), molde `blocks.e2e-spec.ts`.
- **Sin frontend. La portada no cambia.**

### RP.2 — Frontend público: hero SSR rotativo + motor + los 2 primeros bloques
- `lib/api/homepage.ts` con `getCachedHomepageConfig()` (§5.2) y el `FALLBACK`.
- `HomeHero` + las 5 reglas `@keyframes` + la media query de `prefers-reduced-motion` (§3).
- `HomeBlockRenderer` (síncrono, `switch` + `assertUnreachable`) y los renderizadores `cta`
  y `search`.
- Extracción de `SmartLink` y `CtaButton` a `components/shared/` (§4.0) y adelgazamiento de
  `CtaBlockRenderer`/`HubBlockRenderer` del blog para que los usen. **Sin cambio visible.**
- `(home)/page.tsx`: hero y buscador pasan a venir de la config; **el resto de la home sigue
  hardcodeado debajo**.
- e2e: `<h1>` con texto real en el HTML servido; primera opción sin `aria-hidden` y el resto
  con él; portada entera con la API caída (`FALLBACK`).

### RP.3 — Editor de admin `/admin/portada`
- `lib/api/homepage-admin.ts` (molde `footer-admin.ts`/`nav-admin.ts`).
- Formulario del hero + `HomeBlockEditor` con los tipos existentes + preview (§6) + entrada
  en `AdminNav`.
- e2e (`portada-admin.spec.ts`), molde `nav-admin.spec.ts`.
- **A partir de aquí, todo tipo nuevo entra con su DTO + su renderizador + su editor en la
  misma ráfaga.** No vuelve a haber un tipo sin forma de configurarlo.

### RP.4 — Bloques estáticos: `grid` y `steps`
- DTOs, `HomeIconName` + allowlist + `ICON_MAP`, renderizadores, editores (incluido el
  selector visual de iconos), upload de imagen de celda.
- Se retiran del código la sección "Cómo funciona" y la fila de señales de confianza; pasan
  a la fila semilla como bloques.

### RP.5 — Bloques dinámicos: `listings` y `categoryCarousel`
- `lib/home-blocks/resolve-listings.ts`; renderizador con los dos providers (§4.6).
- Carrusel: renderizador servidor + island de desplazamiento + upload por categoría +
  omisión de slugs colgados.
- Se retiran "Recién publicados" y los chips "Populares"; pasan a la semilla.
- **`CategoryGrid` NO se retira** — ver la corrección de §4.2. Se queda como fallback de la
  página mientras no haya un `categoryCarousel` configurado, porque el carrusel exige fotos
  subidas y una semilla no puede subirlas. Esta línea decía lo contrario y era la
  contradicción §8↔§4.2; queda resuelta a favor del fallback.

### RP.6 — `searchTable` y limpieza final
- DTO con las 3 clases de pestaña, renderizador servidor de los 3 paneles, island
  `HomeSearchTabs` con teclado (§4.7), editor con `<select>` de `PROVINCIAS` para las
  combinaciones.
- `(home)/page.tsx` queda reducido a lo de §5.1 **salvo dos excepciones escritas**: los
  banners (sistema propio y completo, §5.4) y el fallback `CategoryGrid` (§4.2). El resto
  —eyebrow, buscador dentro de la banda del hero, botón "Publica gratis"— se retira y pasa a
  la semilla como bloques.
- e2e: los enlaces de las 3 pestañas presentes en el HTML servido; navegación por teclado.

**Orden y dependencias:** RP.1 → RP.2 → RP.3 → {RP.4, RP.5, RP.6} (las tres últimas son
independientes entre sí y pueden reordenarse o paralelizarse). Entre RP.1 y RP.3 la config
solo se puebla por seed — es exactamente el intervalo que el nav ya aceptó entre RN.1 y
RN.4, y aquí es más corto.

---

## 9. Registro de decisiones

### Cerradas antes del diseño (encargo)

Motor nuevo propio · una config global sin borrador · SSR innegociable · no tocar el `auth()`
del layout raíz · banners aparte · hero como campo separado · ubicaciones = provincias ·
listas con providers y categoría opcional · carrusel con imagen propia · pasos con columnas ·
los 7 tipos bastan.

### Tomadas **en** este diseño (lo que quedaba delegado)

| # | Decisión | §  |
|---|---|---|
| 1 | **Tabla propia de fila única (`HomepageConfig`), no `Setting`.** `Setting.value` es un Json opaco sin validación por campo; los `href`/`src` de la portada acaban en atributos reales del DOM y necesitan DTO. | §2.1 |
| 2 | **Rotación en CSS puro**, no island. Sobrevive sin hidratación y sin JS, 0 KB. **El precio explícito es el tope de 6 opciones**, porque hace falta una regla `@keyframes` estática por cada N. Se renuncia a pausa-al-hover. | §3.2 |
| 3 | **A11y: `aria-hidden="true"` en las opciones 2…N.** El nombre accesible del `<h1>` es *estático + primera opción*: una frase, no una ristra. Se descartan `aria-live` (hostil) y sacar las opciones fuera del `<h1>` (reintroduce el salto de layout). | §3.3 |
| 4 | **`prefers-reduced-motion: reduce` ⇒ sin animación y solo la primera opción visible.** Coincide exactamente con lo que oye un lector de pantalla. No existe hoy en el repo; se introduce aquí. | §3.3 |
| 5 | **Se acepta la duplicación de variantes en el `<h1>` de cara al crawler**: no es texto oculto (cada opción se ve en su turno) y son variantes del mismo encabezado. El tope de 6 lo acota. | §3.4 |
| 6 | **Doctrina de reuso: se comparte lo presentacional de props planas; nada cuya firma lleve un tipo de bloque cruza entre motores.** ⇒ `SmartLink` y `CtaButton` se extraen a `components/shared/`; `SearchBar` y `ListingCard` se reusan tal cual; `resolve-listings` se copia como patrón, no como código. | §4.0 |
| 7 | **`grid`: `media` como unión discriminada `image` / `icon`**, con **allowlist cerrada** de nombres de icono. Un nombre libre de lucide obligaría a resolver en runtime y arrastraría la librería entera al bundle de la portada. | §4.3 |
| 8 | **Tabs propios (~40 líneas), no Radix Tabs.** No está instalado y desmonta el panel inactivo por defecto: instalarlo para desactivar su comportamiento principal no compensa. Los paneles llegan al island como `ReactNode` renderizados en servidor. | §4.7 |
| 9 | **Los paneles 2 y 3 se sirven con `hidden` desde servidor.** El contenido y sus enlaces están en el HTML; se asume la menor ponderación del contenido tras interacción a cambio de no destruir la interfaz ni provocar parpadeo. Mismo criterio que `BannerList`. | §4.7 |
| 10 | **`province` no se valida en el backend**: `<select>` en el editor + omisión al leer si no está en `PROVINCIAS`. Evita una segunda copia de 52 cadenas que mantener sincronizada. Alternativa registrada por si se quiere endurecer. | §4.7 |
| 11 | **Slug de categoría colgado ⇒ se omite al leer**, no se rechaza al escribir. No hay FK que proteja el borrado de una categoría, y la doctrina "se acepta al escribir, se oculta al leer" ya está adoptada en el nav. | §4.2 |
| 12 | **Banners ENCIMA del hero** (sin cambio respecto a hoy). Un aviso bajo un hero a media pantalla no cumple su función; su presencia es excepcional y temporal. | §5.4 |
| 13 | **Rol `ADMIN`** para la config y **para su propio endpoint de upload**, no `EDITOR`. Los dos sistemas de configuración global del sitio (footer, nav) son `ADMIN`; el blog es más laxo porque es contenido. El upload propio mantiene alineados el rol de subir y el de usar lo subido. | §5.3 |
| 14 | **Los renderizadores de portada con imagen degradan a un fallback visible**, no desaparecen como el bloque `image` del blog: en una rejilla de portada un hueco rompe la maquetación. | §7 |
| 15 | **Un solo `PATCH` con la config entera**, sin CRUD por bloque: los bloques no son filas. | §5.3 |

### Pendientes de afinar en implementación (no bloquean la aprobación)

- Textos exactos de etiquetas, descripciones del selector de tipo y mensajes de error.
- Composición final de la allowlist de iconos (~12) y su rejilla de selección en el editor.
- Si la rotación se implementa con las 5 reglas `@keyframes` por N (lo especificado) o con
  la variante `translateY` + `steps(var(--n))`, que sería genérica para cualquier N y
  eliminaría el tope de 6. **La variante no se adopta ahora** porque `steps(var(--n))`
  depende de sustitución de custom properties dentro de una función de temporización, y da
  un corte seco en vez de un fundido. Si en implementación se valida, el tope de 6 puede
  levantarse sin tocar el modelo.
- Tope exacto de ítems por bloque (`categoryCarousel` 12, `combos` 60, `steps` 3 columnas ×
  6 pasos) — son números de cordura, ajustables sin migración.
- Si `heroSubtitle` acaba admitiendo negrita. **Recomendación: no.** Abrir la tubería de
  markdown para un subtítulo es superficie de seguridad a cambio de casi nada.

---

## 10. Nota sobre lo que este diseño modifica de lo ya construido

Muy poco, y todo acotado:

1. **`(public)/(home)/page.tsx` se vacía progresivamente** (RP.2→RP.6) hasta quedar en las
   ~20 líneas de §5.1. La URL no cambia. `(home)/layout.tsx`, `(public)/layout.tsx`,
   `Header.tsx`, `MainNav.tsx` y `Footer.tsx` **no se tocan**.
2. **`CtaBlockRenderer` y `HubBlockRenderer` del blog adelgazan** en RP.2 para usar
   `SmartLink`/`CtaButton` extraídos (§4.0). Es refactor sin cambio de comportamiento, con
   los tests del blog como red. `Footer.tsx` y `MainNav.tsx` pueden adoptar `SmartLink`
   después; **no es requisito de ninguna ráfaga** y se deja fuera para no mezclar.
3. **Nada del blog, el footer o el nav cambia de contrato.** No hay FK nueva, ni tag de
   caché nuevo que otro servicio tenga que bustear, ni precheck de borrado que ampliar —
   a diferencia de lo que el nav sí tuvo que hacerle a `BlogService`.

### ⚠ Dos divergencias encontradas al verificar (no las corrige este diseño)

1. **`schema.prisma:1678-1679` dice que `Post.blocks` tiene "9 tipos" y los enumera; son
   13.** El mismo error está en [`types/blocks.ts:1-2`](../apps/web/src/types/blocks.ts#L1-L2)
   ("espejo exacto de los 9 DTOs"). Los comentarios se quedaron en la Ráfaga 1 del blog;
   `block.dto.ts:39` sí dice 13. Es solo comentario, pero es exactamente el tipo de deriva
   que este documento evita citando línea a línea.
2. **`Category.iconUrl` no tiene ninguna validación de URL**: input de texto libre en el
   admin y `@IsOptional() @IsString()` en el DTO, mientras cualquier imagen de bloque exige
   `@IsOwnStorageUrl`. La decisión 9 del encargo (imagen propia del carrusel) esquiva el
   problema para la portada, pero **`iconUrl` sigue ahí** y se pinta con `next/image` en
   `CategoryGrid`. Queda anotado para `docs/pendientes.md`; no es alcance de esta ráfaga.
   **Nota RP.6:** al quedarse `CategoryGrid` como fallback permanente (§4.2), esta deriva ya
   no caduca sola con el tiempo. Sigue sin ser alcance de la portada, pero ahora convive con
   ella indefinidamente.
