# Diseño — Navegación dinámica configurable (barra bajo el header)

> Documento de diseño (2026-08-06). Recoge la auditoría del código real y el diseño
> acordado. Las ráfagas RN.1–RN.4 implementan lo aquí descrito.
>
> **Objetivo:** una barra de navegación bajo el header del sitio público, con menús y
> submenús desplegables, configurable al 100% desde el backoffice por un ADMIN, que se
> muestra u oculta según el **tipo de página** y que **desaparece por completo si no hay
> nada que enseñar**.
>
> **Alcance cerrado:** solo `(public)`. El header solo existe ahí; `(account)`, `(admin)`
> y `(auth)` tienen su propia navegación y quedan fuera.
>
> Toda afirmación sobre el footer, `Category` o `Banner` de este documento está verificada
> contra el fichero y la línea citados, no contra la documentación.

---

## 0. Las dos consecuencias que separan este sistema del footer

El footer dinámico (`FooterColumn` + `FooterItem`) es el molde y se reusa hasta donde da.
Pero **una sola decisión —el destino es opcional— cambia dos cosas de raíz**, y son las dos
que hay que diseñar bien:

| | Footer (hoy) | Nav (este diseño) |
|---|---|---|
| **1. Validación del destino** | `type` es obligatorio (`FooterItem.type FooterItemType`, [`schema.prisma:1744`](../apps/api/prisma/schema.prisma#L1744)). Todo ítem tiene destino, siempre. | `type` es **nullable**. Un nodo sin destino es legítimo *si y solo si* tiene hijos. Un nodo sin destino **y sin hijos** es inválido: no lleva a ningún sitio ni abre nada. |
| **2. Gate de vacío** | Plano y de un nivel: se descartan las columnas sin ítems visibles ([`footer.service.ts:57`](../apps/api/src/modules/footer/footer.service.ts#L57)), pero el `<footer>` se sigue pintando con el copyright ([`Footer.tsx:48-51`](../apps/web/src/components/layout/Footer.tsx#L48-L51)). | **Recursivo y total**: la visibilidad de un nodo depende de la de sus hijos, se resuelve de abajo arriba, y si la raíz queda vacía **la barra entera no se renderiza**. |

Todo lo demás —CRUD, auditoría, revalidación, caché, borrado protegido— es el molde del
footer aplicado tal cual.

---

## 1. Decisiones de partida (cerradas, no se reabren)

| # | Decisión | Motivo |
|---|---|---|
| 1 | **Solo `(public)`** | `<Header/>` se monta en un único sitio: [`(public)/layout.tsx:7`](../apps/web/src/app/(public)/layout.tsx#L7). Grep de `<Header` en `apps/web`: una sola coincidencia. `(admin)` tiene su propio shell con `AdminNav` ([`(admin)/layout.tsx:8-19`](../apps/web/src/app/(admin)/layout.tsx#L8-L19)), `(account)` su sidebar ([`(account)/layout.tsx:3-13`](../apps/web/src/app/(account)/layout.tsx#L3-L13)), `(auth)` una caja centrada. No hay "debajo del header" fuera de `(public)`. |
| 2 | **Árbol auto-referencial** (`parentId`), no dos tablas | El footer es plano por construcción: `FooterColumn` **no tiene destino** (solo `name String?`, [`schema.prisma:1729`](../apps/api/prisma/schema.prisma#L1729)) y `FooterItem` **no tiene hijos** (no hay `parentId`). Molde de árbol: `Category` ([`schema.prisma:411-464`](../apps/api/prisma/schema.prisma#L411-L464)). |
| 3 | **Destino opcional en todo nodo** | Un nodo puede ser solo-desplegable, clicable, o clicable *y* con hijos. |
| 4 | **`active Boolean` explícito** | El footer no tiene ningún flag de activación; su única "desactivación" es indirecta (la página enlazada no está `PUBLISHED`). Precedente de flag explícito: `Banner.active` ([`schema.prisma:1611`](../apps/api/prisma/schema.prisma#L1611)), `Tag.activo` ([`schema.prisma:501`](../apps/api/prisma/schema.prisma#L501)), `SponsoredAd.active`. |
| 5 | **Visibilidad por array de tipos**, patrón `BannerPlacement` | `Banner.placements BannerPlacement[]` + filtro server-side `placements: { has: placement }` ([`banners.service.ts:24-34`](../apps/api/src/modules/banners/banners.service.ts#L24-L34)); cada página declara el suyo como literal ([`(public)/page.tsx:26`](../apps/web/src/app/(public)/page.tsx#L26) `getActiveBanners('HOME')`). **No se deriva del `pathname`** — ver §4.1 para el porqué técnico. |

---

## 2. Modelo de datos

### 2.1 Schema propuesto

```prisma
// ============================================================================
//  NAVEGACIÓN PRINCIPAL — barra bajo el header del sitio público. Árbol propio
//  (menús → submenús), independiente del contenido (Post) y del footer
//  (FooterColumn/FooterItem, que es plano y no escala a submenús).
// ============================================================================

/// Tipo de destino de un NavItem. Mismos tres valores y misma semántica que
/// FooterItemType — enum aparte, y no reutilizado, porque los dos sistemas
/// deben poder divergir sin arrastrarse (p. ej. si el nav añadiera un destino
/// "categoría" que el footer no necesita).
enum NavItemType {
  PAGE
  INTERNAL
  EXTERNAL
}

/// Tipos de página de (public) donde un NavItem puede mostrarse. Derivado del
/// árbol REAL de app/(public), no de una lista conceptual — ver §3.
/// Nombres en español como BannerPlacement.MIS_ANUNCIOS: nombran rutas de cara
/// al usuario, no conceptos de código.
enum NavPageType {
  HOME        // (public)/page.tsx
  BUSQUEDA    // (public)/busqueda
  CATEGORIA   // (public)/[categoria] y [categoria]/[subcategoria]
  ANUNCIO     // (public)/anuncio/[slug]
  BLOG        // (public)/blog y blog/[slug]
  PAGINA_CMS  // (public)/paginas/[slug]
  VENDEDOR    // (public)/vendedor/[slug]
  CONTACTO    // (public)/contacto
  PLANES      // (public)/planes (y sus /exito, /cancelado)
}

model NavItem {
  id String @id @default(cuid())

  /// Auto-relación: un nodo puede colgar de otro. null = nodo raíz (primer
  /// nivel de la barra). Cascade: borrar un menú se lleva su subárbol — es una
  /// acción consciente del admin y la UI anuncia cuántos descendientes se van
  /// ANTES de confirmar (mismo criterio que FooterItem.column, y a diferencia
  /// de Category.parentId, que es SET NULL físico + rechazo en el servicio
  /// porque una categoría sí tiene terceros colgando, ver §6.1).
  parentId String?
  parent   NavItem?  @relation("NavTree", fields: [parentId], references: [id], onDelete: Cascade)
  children NavItem[] @relation("NavTree")

  /// Texto visible — independiente de Post.title, igual que FooterItem.label.
  label String
  order Int     @default(0)

  /// Desactivar oculta el nodo Y su subárbol (un hijo de un padre inactivo no
  /// se promociona a raíz). Es el interruptor rápido que el footer NO tiene.
  active Boolean @default(true)

  /// NULLABLE — ésta es la diferencia estructural con FooterItem.type. null =
  /// nodo solo-desplegable (sin destino, abre sus hijos). La coherencia con
  /// pageId/url y la regla "sin destino ⇒ obligatorio tener hijos" se validan
  /// en el servicio, no aquí — ver §2.3.
  type NavItemType?

  /// Solo type=PAGE. onDelete: Restrict, igual que FooterItem.page — borrar una
  /// página enlazada desde el nav debe dar un 400 legible (precomprobado en
  /// BlogService.adminDelete, que a partir de ahora cuenta las DOS tablas).
  pageId String?
  page   Post?   @relation(fields: [pageId], references: [id], onDelete: Restrict)

  /// type=INTERNAL (ruta relativa) o type=EXTERNAL (URL absoluta). null si
  /// type=PAGE o si type es null.
  url String?

  /// Tipos de página donde se muestra. [] = SIN FILTRO (se muestra en todas) —
  /// diverge a propósito de Banner.placements, que prohíbe el vacío. Ver §3.3.
  visibleOn NavPageType[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([parentId, order])
}
```

Y en `Post`, la relación inversa junto a la que ya existe
([`schema.prisma:1701-1705`](../apps/api/prisma/schema.prisma#L1701-L1705)):

```prisma
  /// Ítems del footer que enlazan a esta página (type=PAGE).
  footerItems FooterItem[]
  /// Ítems del nav principal que enlazan a esta página (type=PAGE). Segunda
  /// fuente de enlaces: el precheck de borrado debe contar las dos.
  navItems    NavItem[]
```

> No hace falta `@relation("...")` nombrada en `Post`: son dos modelos distintos, sin
> ambigüedad. La auto-relación de `NavItem` **sí** necesita nombre (`"NavTree"`), igual que
> `Category` usa `"CategoryTree"` ([`schema.prisma:421-422`](../apps/api/prisma/schema.prisma#L421-L422)).

### 2.2 Profundidad máxima — **DECISIÓN: 2 niveles**

El modelo (`parentId` auto-referencial) soporta N niveles. La **política** los acota a 2:
raíz (barra) + un nivel de hijos (desplegable). Se valida en el servicio contra una
constante única `NAV_MAX_DEPTH = 2`.

Trade-off escrito:

- **A favor de 2.** Es literalmente lo que pide el encargo ("menús/submenús desplegables").
  Es la profundidad que `Category` renderiza de hecho: el `select` del servicio público baja
  a `children` y **no anida un segundo `children`** dentro ([`categories.service.ts:23-56`](../apps/api/src/modules/categories/categories.service.ts#L23-L56)),
  y el admin pinta exactamente dos niveles
  (`moveRoot` / `moveChild`, [`(admin)/admin/categorias/page.tsx:726-790`](../apps/web/src/app/(admin)/admin/categorias/page.tsx#L726-L790)). Un tercer nivel en una barra horizontal
  obliga a *flyouts* laterales, que son el caso conocido de mala accesibilidad en táctil.
- **En contra.** Si mañana se quiere un tercer nivel, hay que tocar el render.
- **Por qué el coste de equivocarse es bajo.** El tope es una constante validada en el
  servicio, **no una restricción de schema**: subirlo a 3 es cambiar un número y hacer el
  trabajo de UI. Bajarlo, en cambio, obligaría a migrar datos. Empezar acotado es la
  dirección barata.

### 2.3 Regla de coherencia del destino — **consecuencia 1**

Vive en `NavService.assertItemDestination`, **en el servicio, no en el DTO** — mismo estilo
que `FooterService.assertItemDestination` ([`footer.service.ts:292-316`](../apps/api/src/modules/footer/footer.service.ts#L292-L316)) y que
`Post.assertFooterFieldsAllowed`. El DTO solo valida la forma de cada campo por separado;
Prisma no valida esta coherencia por sí solo y no hay CHECK de schema.

**Caso A — `type != null` (nodo con destino).** Idéntico al footer, sin inventar nada:

| `type` | Obligatorio | Prohibido | Validación extra |
|---|---|---|---|
| `PAGE` | `pageId` | `url` | El `Post` existe y es `type=PAGE`, nunca un post de blog (`assertPageDestination`, [`footer.service.ts:322-328`](../apps/api/src/modules/footer/footer.service.ts#L322-L328)) |
| `INTERNAL` | `url` empezando por `/` | `pageId` | Ninguna. **No existe registro de rutas reales** en el proyecto: una ruta inexistente se acepta y solo se descubre como 404 en runtime — limitación heredada y aceptada del footer ([`create-footer-item.dto.ts:18-24`](../apps/api/src/modules/footer/dto/create-footer-item.dto.ts#L18-L24)) |
| `EXTERNAL` | `url` absoluta http(s), vía `isAbsoluteHttpUrl` | `pageId` | Ninguna |

**Caso B — `type == null` (nodo sin destino). REGLA NUEVA, sin precedente en el footer:**

> **Un nodo sin destino DEBE tener al menos un hijo.** Una hoja sin destino es inválida: no
> lleva a ningún sitio ni abre nada — es un texto muerto en la barra.

Consecuencias operativas de esa regla, que hay que resolver explícitamente porque afectan a
tres operaciones distintas:

1. **Al crear** un nodo sin destino: no puede tener hijos todavía (acaba de nacer). Se
   acepta y queda **temporalmente inválido**; el gate recursivo (§5) simplemente **no lo
   pinta** hasta que tenga un hijo visible. No se lanza error — bloquear la creación haría
   imposible construir un menú desplegable (habría que crear al hijo antes que al padre).
   La UI de admin lo marca con un badge *"sin destino y sin hijos — no se muestra"*, calcado
   del badge *"en borrador — no se muestra"* del footer ([`(admin)/admin/footer/page.tsx:282-286`](../apps/web/src/app/(admin)/admin/footer/page.tsx#L282-L286)).
2. **Al editar** un nodo quitándole el destino (`type` → null): se acepta igual, con el
   mismo tratamiento. Es reversible y el gate lo cubre.
3. **Al borrar** el último hijo de un nodo sin destino: **no se bloquea**. El padre queda
   inválido y deja de pintarse solo. Bloquear aquí sería un error confuso ("no puedes
   borrar esto por culpa de otra cosa") a cambio de nada: el gate ya garantiza que nunca
   se pinta un desplegable vacío.

> **Por qué "inválido pero aceptado" y no un 400.** El invariante que de verdad importa es
> *"nunca se pinta un nodo que no lleva ni abre nada"*, y ése lo garantiza el **gate**, que
> corre en cada lectura. Convertirlo además en un 400 de escritura solo añadiría orden
> obligatorio a las operaciones del admin (padre después del hijo, borrar hijos en cierto
> orden) sin mejorar ni una garantía. **Se valida en lectura, no en escritura** — y se
> documenta en la UI para que el admin vea el estado, no lo sufra.

### 2.4 Qué **no** se copia del footer

- **No hay dos tablas.** Un `FooterColumn` no es un enlace y un `FooterItem` no tiene hijos;
  aquí todo nodo es lo mismo a cualquier nivel.
- **No se hereda la ausencia de `active`.**
- **No se hereda el gate parcial**: el footer conserva su copyright cuando no hay columnas;
  la barra del nav no deja rastro.

---

## 3. Tipos de página

### 3.1 La lista — **DECISIÓN: 9 valores**

Derivada del árbol real de `app/(public)` (verificado fichero a fichero), no de una lista
conceptual:

| `NavPageType` | Ruta(s) reales |
|---|---|
| `HOME` | `(public)/page.tsx` |
| `BUSQUEDA` | `(public)/busqueda/page.tsx` |
| `CATEGORIA` | `(public)/[categoria]/page.tsx`, `(public)/[categoria]/[subcategoria]/page.tsx` |
| `ANUNCIO` | `(public)/anuncio/[slug]/page.tsx` |
| `BLOG` | `(public)/blog/page.tsx`, `(public)/blog/[slug]/page.tsx` |
| `PAGINA_CMS` | `(public)/paginas/[slug]/page.tsx` |
| `VENDEDOR` | `(public)/vendedor/[slug]/page.tsx` |
| `CONTACTO` | `(public)/contacto/page.tsx` |
| `PLANES` | `(public)/planes/page.tsx` (+ `/exito`, `/cancelado`) |

### 3.2 Colapso de `BLOG_INDICE`/`BLOG_POST` y `CATEGORIA`/`SUBCATEGORIA` — **DECISIÓN: se colapsan**

- `CATEGORIA` cubre categoría y subcategoría: **renderizan por el mismo componente**
  (`CategoryListingPage`), así que separarlas sería una distinción que ni el código ni el
  usuario perciben.
- `BLOG` cubre índice y post.

Trade-off: la granularidad fina no cuesta nada en el modelo (es un valor de enum) pero sí en
la UI de admin (más casillas que marcar en cada nodo) y en el mecanismo de montaje (§4.2).
**Lo que decide es la asimetría del coste de rectificar:** añadir un valor a un enum de
Prisma es una migración aditiva sin backfill —precedente verificado: `ContactReasonScope` se
añadió con `@default(PUBLIC)` y las filas existentes recibieron el default al aplicar la
migración, sin backfill ([`schema.prisma:1774-1783`](../apps/api/prisma/schema.prisma#L1774-L1783))—, mientras que **fusionar** dos valores ya usados obliga a
reescribir los arrays `visibleOn` de todas las filas. Empezar grueso es la dirección barata.

Además, el colapso encaja exactamente con el mecanismo de montaje elegido en §4.2: un solo
layout en `(public)/blog/` cubre índice y post sin tocar ninguna página.

### 3.3 `visibleOn` vacío — **DECISIÓN: `[]` = se muestra en TODAS**

`[]` significa *"sin filtro"*, no *"en ninguna"*.

- **Por qué.** El caso mayoritario de un nav ("Inicio", "Publicar", "Ayuda") es aparecer en
  todas partes. Si `[]` significara "en ninguna", el estado por defecto de un nodo recién
  creado sería *invisible*, y el admin tendría que marcar las 9 casillas para el caso más
  común.
- **Precedente en el repo.** `Category.allowedViews ListingViewMode[] @default([])`
  documenta literalmente `[] = "no configurado"` con caída a un default global
  ([`schema.prisma:435-440`](../apps/api/prisma/schema.prisma#L435-L440)); `allowedPriceUnits` sigue el mismo criterio ([`schema.prisma:447-455`](../apps/api/prisma/schema.prisma#L447-L455)).
- **Divergencia consciente de `Banner`.** `Banner.placements` **prohíbe** el vacío
  (validado en el DTO, [`schema.prisma:1601`](../apps/api/prisma/schema.prisma#L1601)). Es lo correcto allí: un banner sin ubicación es
  peso muerto, nunca aparece. Aquí es al revés, y por eso se diverge a propósito.
- **En la UI de admin**, el multi-select muestra el estado vacío como *"En todas las
  páginas"*, no como una lista sin marcar — que el significado se lea, no se deduzca.

---

## 4. Detección del tipo de página y punto de montaje

### 4.1 Por qué el tipo lo declara la página y no se deriva del `pathname`

Tres vías evaluadas contra el código; dos se descartan por motivos verificables:

1. **`usePathname()` en la barra.** Obliga a que la barra sea Client Component. El footer se
   diseñó explícitamente para evitarlo ("Grid CSS puro, sin acordeón: mantiene Footer como
   Server Component", [`Footer.tsx:13-15`](../apps/web/src/components/layout/Footer.tsx#L13-L15)). Además `(public)/[categoria]` es un catch-all de un
   segmento: clasificar `/foo` exigiría saber si es categoría o 404, lógica que ya vive en
   `lib/category-canonical.ts`. **Descartada.**
2. **Middleware inyectando una cabecera + `headers()` en el layout.** Técnicamente posible
   (el middleware ya corre en todas las rutas, [`middleware.ts:97-99`](../apps/web/src/middleware.ts#L97-L99)), pero leer `headers()`
   **fuerza render dinámico de todo el árbol de `(public)`** y mata el ISR ya configurado:
   `export const revalidate = 3600` en [`(public)/blog/page.tsx:9`](../apps/web/src/app/(public)/blog/page.tsx#L9) y en
   [`(public)/paginas/[slug]/page.tsx:10`](../apps/web/src/app/(public)/paginas/[slug]/page.tsx#L10). En una plataforma read-heavy y SEO-crítica eso es
   descalificatorio. **Descartada.**
3. **Declaración explícita (patrón `BannerPlacement`).** Cada ruta declara su tipo como
   literal, exactamente como `getActiveBanners('HOME')` en la home y
   `getActiveBanners('MIS_ANUNCIOS')` en mis-anuncios ([`(account)/mis-anuncios/page.tsx:47`](../apps/web/src/app/(account)/mis-anuncios/page.tsx#L47)).
   **Elegida** (decisión de partida 5).

### 4.2 Dónde se declara — **DECISIÓN: un layout anidado por tipo, no en cada página**

Aquí hay que **ajustar el punto de inserción del encargo**, y conviene decirlo claro:

> **`(public)/layout.tsx` NO puede montar la barra.** Un layout de servidor no recibe
> `pathname` ni sabe qué hijo está renderizando, así que no puede saber el `NavPageType`.
> El montaje es en **layouts anidados, uno por tipo de página**, dentro de `(public)`.
> El resultado visual es idéntico (§4.4).

Nueve layouts nuevos, uno por valor del enum — mapeo 1:1 —, cada uno de 5 líneas:

```
app/(public)/
  layout.tsx                    ← INTACTO (Header + main + Footer)
  (home)/layout.tsx             ← NavPageType.HOME     (route group; page.tsx se mueve aquí)
  (home)/page.tsx
  busqueda/layout.tsx           ← BUSQUEDA
  [categoria]/layout.tsx        ← CATEGORIA   (cubre también [subcategoria])
  anuncio/layout.tsx            ← ANUNCIO
  blog/layout.tsx               ← BLOG        (cubre índice y [slug])
  paginas/layout.tsx            ← PAGINA_CMS
  vendedor/layout.tsx           ← VENDEDOR
  contacto/layout.tsx           ← CONTACTO
  planes/layout.tsx             ← PLANES      (cubre /exito y /cancelado)
```

Cada uno:

```tsx
import { MainNav } from '@/components/layout/MainNav';

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <MainNav pageType="BUSQUEDA" />
      {children}
    </>
  );
}
```

**Por qué layouts anidados y no `<MainNav pageType="…"/>` como primer hijo de cada página**
(que sería el calco literal de `getActiveBanners`): un layout **cubre por herencia toda ruta
que cuelgue de él**. Una futura `/blog/categoria/x` hereda la barra sin que nadie se acuerde;
una futura *página* tendría que acordarse, y el fallo sería silencioso (barra ausente, nadie
se entera). El coste es 9 ficheros triviales y mover `page.tsx` de la home a un route group
`(home)` — un cambio de ruta de fichero que **no altera la URL**.

`(home)` es necesario porque `(public)/page.tsx` no puede tener un layout propio sin
capturar a todos sus hermanos.

### 4.3 Contrato del endpoint y **decisión de caché**

**DECISIÓN: opción (b) — una entrada de caché por tipo de página, filtrado íntegro en el
backend.** Se decide **en contra** de la recomendación tentativa del encargo (opción (a):
cachear la estructura entera y filtrar en el render). El motivo:

> Si el frontend filtrara por `pageType`, tendría que ejecutar **todo el gate recursivo**
> (§5) — porque quitar un hijo por `visibleOn` puede vaciar a su padre, y ese re-podado no
> se puede separar del resto de la poda. Eso metería el algoritmo de visibilidad completo en
> Next, contra la regla innegociable de `CLAUDE.md`: *"NestJS es la única fuente de verdad
> de la lógica de negocio. Ninguna regla de negocio vive en Next."* Y contra el molde del
> footer, cuyo servicio devuelve el `href` y la estructura **ya resueltos** para que el
> frontend solo mapee ([`footer.service.ts:28-32`](../apps/api/src/modules/footer/footer.service.ts#L28-L32), [`lib/api/footer.ts:10-13`](../apps/web/src/lib/api/footer.ts#L10-L13)).

El coste de (b) es acotado y pequeño, y por eso se puede pagar: **como mucho 9 entradas de
caché** (una por valor del enum), de unos pocos KB cada una, y ≤9 llamadas a la API por hora
en lugar de 1. La invalidación **no se complica**: `unstable_cache` invalida por *tag*, no
por clave, así que un único `revalidateTag('main-nav')` sigue tumbando las nueve entradas.

```
GET /nav?pageType=HOME     (público, sin guard — como GET /footer y GET /banners)
```

Respuesta: el árbol **ya podado, ordenado y con `href` resuelto**. El frontend solo mapea.

```ts
interface NavNode {
  label: string;
  href: string | null;      // null = solo-desplegable
  external: boolean;        // href absoluto → target="_blank"
  children: NavNode[];      // [] en las hojas
}
// GET /nav?pageType=X  →  NavNode[]   (vacío = la barra no se pinta)
```

Frontend, calcado de [`lib/api/footer.ts:31-35`](../apps/web/src/lib/api/footer.ts#L31-L35):

```ts
const getCachedNav = (pageType: NavPageType) =>
  unstable_cache(
    () => apiFetch<NavNode[]>(`/nav?pageType=${pageType}`),
    ['main-nav', pageType],          // ← clave por tipo
    { revalidate: 3600, tags: ['main-nav'] },  // ← tag ÚNICO: una invalidación las tumba todas
  )();
```

Y el componente, con la misma red de seguridad que el footer
([`Footer.tsx:9`](../apps/web/src/components/layout/Footer.tsx#L9)): `await getCachedNav(pageType).catch(() => [])` — **un backend caído deja
el sitio sin barra, nunca roto**.

> Nota de infraestructura: como en el footer, **Redis y Meilisearch no intervienen**. La
> caché es la de Next (`unstable_cache`); el backend consulta Postgres en cada petición que
> le llegue, que con esta caché son ≤9 por hora.

### 4.4 Inserción visual y CSS

```
(public)/layout.tsx
  <Header />                     sticky top-0 z-50, h-16      ← INTACTO
  <main className="min-h-screen">
      <MainNav pageType="…" />   ← el layout anidado lo pinta aquí, primer hijo de <main>
      … contenido de la página …
  </main>
  <Footer />
```

`<main>` **no tiene padding** ([`(public)/layout.tsx:8`](../apps/web/src/app/(public)/layout.tsx#L8): `className="min-h-screen"`), así que
una barra a ancho completo como primer hijo queda pegada al borde inferior del header. El
resultado es visualmente el mismo que insertarla entre `<Header/>` y `<main>`.

**DECISIÓN — no es sticky.** La barra scrollea con el contenido; solo el header queda fijo.

- El header es `sticky top-0 z-50` con un contenedor `h-16` ([`Header.tsx:23-24`](../apps/web/src/components/layout/Header.tsx#L23-L24)). Una
  segunda barra pegada exigiría `top-16` — es decir, **duplicar la altura del header como
  número mágico en otro fichero**, que rompe en silencio el día que el header cambie de alto.
- Dos barras fijas se comen ~7rem de viewport en móvil, en un sitio cuyo contenido principal
  son rejillas de tarjetas.
- Los desplegables tendrían que escapar del contexto de apilamiento del `sticky`.
- Es **reversible en una clase** si se decide lo contrario: añadir `sticky top-16 z-40`.

Estilo base: `border-b bg-background`, contenedor `container mx-auto px-4`, `z-40` en los
desplegables (por debajo del `z-50` del header, que debe seguir ganando).

**DECISIÓN — orden en la home: la barra va ENCIMA del `BannerList`.** El layout `(home)`
pinta `<MainNav/>` antes de `{children}`, y el `BannerList` es hoy el primer elemento del
contenido de la home ([`(public)/page.tsx:36-40`](../apps/web/src/app/(public)/page.tsx#L36-L40)). Es el orden correcto: la barra es *chrome*
(persistente, en el mismo sitio en todas las páginas) y el banner es *contenido* (transitorio
y descartable por el usuario, [`BannerList.tsx:79-85`](../apps/web/src/components/banners/BannerList.tsx#L79-L85)). El chrome va por encima del contenido; si
fuera al revés, la barra bailaría verticalmente según hubiera banner o no.

### 4.5 Componentes

Split servidor/cliente calcado de `Header` + `HeaderAuthNav` ([`Header.tsx:41`](../apps/web/src/components/layout/Header.tsx#L41)):

| Componente | Tipo | Responsabilidad |
|---|---|---|
| `components/layout/MainNav.tsx` | **Server**, async | `getCachedNav(pageType)`, `.catch(() => [])`, y **`if (nodes.length === 0) return null`** — el gate total. Pinta los nodos raíz sin hijos como `<Link>`/`<a>` directos. |
| `components/layout/NavDropdown.tsx` | **Client** (`'use client'`) | Solo los nodos raíz **con hijos**. Radix `DropdownMenu`, ya en el repo y ya usado en el header ([`ui/dropdown-menu.tsx`](../apps/web/src/components/ui/dropdown-menu.tsx), [`HeaderAuthNav.tsx:7-13`](../apps/web/src/components/layout/HeaderAuthNav.tsx#L7-L13)). Da teclado y táctil gratis; un desplegable CSS-only no. |

No hace falta añadir dependencias: `@radix-ui/react-dropdown-menu` ya está en
[`apps/web/package.json:21`](../apps/web/package.json#L21). **No** se usa `navigation-menu` de shadcn (no está instalado y
`dropdown-menu` cubre 2 niveles de sobra).

Un nodo raíz que tiene **destino y además hijos** se pinta como enlace clicable con un
disparador de desplegable adyacente (`⌄`), para no obligar a elegir entre navegar y abrir.

---

## 5. El gate recursivo — **consecuencia 2**

Todo ocurre en `NavService.listPublicNav(pageType)`. Es el equivalente de
`FooterService.listPublicNav` ([`footer.service.ts:33-58`](../apps/api/src/modules/footer/footer.service.ts#L33-L58)), pero recursivo.

### 5.1 Regla de visibilidad

Un nodo es visible si y solo si se cumplen **las tres**:

1. `active === true`;
2. **pasa el filtro de tipo de página**: `visibleOn.length === 0 || visibleOn.includes(pageType)`;
3. **lleva a algún sitio o abre algo**:
   - tiene **destino visible** — con la salvedad de que un destino `type=PAGE` solo cuenta
     si su `Post` está `PUBLISHED` (mismo criterio que el footer,
     [`footer.service.ts:50`](../apps/api/src/modules/footer/footer.service.ts#L50)); **o**
   - tiene **al menos un hijo visible** (recursivo).

De (3) sale lo que de verdad importa: **un desplegable cuyos hijos están todos ocultos se
oculta él también** — no queda un botón que abre un menú vacío. Y un nodo `PAGE` cuya página
pasó a borrador, si además no tiene hijos, desaparece.

### 5.2 Algoritmo de poda (abajo→arriba)

Una sola query trae el árbol entero (son decenas de filas, no miles), se monta en memoria y
se poda en una pasada post-orden:

```
prune(node, pageType) -> NavNode | null
  1. si !node.active                                      → null   (corta el subárbol entero)
  2. si node.visibleOn.length > 0
        y !node.visibleOn.includes(pageType)              → null
  3. children := node.children
                   .ordenados por order asc
                   .map(c => prune(c, pageType))
                   .filter(no null)                        ← PRIMERO los hijos: post-orden
  4. href := resolveHref(node)                             ← null si no hay destino visible
       type=PAGE      → page.status === PUBLISHED ? `/paginas/${page.slug}` : null
       type=INTERNAL  → node.url
       type=EXTERNAL  → node.url
       type=null      → null
  5. si href === null y children.length === 0             → null   ← EL GATE
  6. devolver { label, href, external: type===EXTERNAL, children }

listPublicNav(pageType) =
    raíces (parentId=null) ordenadas por order asc
      .map(r => prune(r, pageType))
      .filter(no null)
```

- El paso **3 antes del 5** es lo que hace que la poda sea de abajo arriba: cuando se decide
  si un nodo sobrevive, sus hijos ya están podados.
- El paso **1 corta el subárbol completo**: un hijo de un padre desactivado no se promociona.
- Si `listPublicNav` devuelve `[]`, `MainNav` devuelve `null` y **la barra no existe en el
  DOM**. Precedente de gate total: `BannerList` hace `if (visible.length === 0) return null`
  ([`BannerList.tsx:96`](../apps/web/src/components/banners/BannerList.tsx#L96)).

### 5.3 Casos que el diseño debe cubrir (y que serán los tests de §8, RN.1)

| Caso | Resultado esperado |
|---|---|
| Nodo con destino, sin hijos, activo, `visibleOn=[]` | Visible en las 9 páginas |
| Nodo con destino, `visibleOn=[HOME]`, en `/busqueda` | Oculto |
| Padre sin destino con 2 hijos, uno inactivo | Visible, con 1 hijo |
| Padre sin destino con todos los hijos ocultos por `visibleOn` | **Oculto** (nada que desplegar) |
| Padre **con** destino y todos los hijos ocultos | **Visible** como enlace simple, sin desplegable |
| Padre activo con `active=false` y un hijo activo | Padre e hijo **ocultos** (el corte es de subárbol) |
| Nodo `type=PAGE` cuya página pasó a `DRAFT`, sin hijos | Oculto |
| Nodo `type=PAGE` en `DRAFT` **con** un hijo visible | Visible como solo-desplegable (`href=null`) |
| Nodo sin destino recién creado, sin hijos | Oculto (§2.3, caso 1) |
| Todos los nodos ocultos | `[]` → **la barra no se renderiza** |

---

## 6. Borrado protegido

### 6.1 `parentId` → **`onDelete: Cascade`** (decidido)

Borrar un menú se lleva su subárbol. Se sigue el molde del **footer**, no el de `Category`, y
la diferencia tiene un motivo verificado:

- **Footer**: `FooterItem.columnId` es `Cascade` ([`schema.prisma:1739`](../apps/api/prisma/schema.prisma#L1739)) y el servicio lo
  razona explícitamente: *"es una acción consciente del admin, no un efecto secundario
  oculto: la UI muestra cuántos ítems se van con la columna ANTES de confirmar (…) no hay un
  tercero externo que pueda sorprenderse — el propio admin es quien pidió borrar la
  columna"* ([`footer.service.ts:123-128`](../apps/api/src/modules/footer/footer.service.ts#L123-L128)).
- **Category**: la FK física es `ON DELETE SET NULL`
  ([`migrations/20260620100046_init/migration.sql:231`](../apps/api/prisma/migrations/20260620100046_init/migration.sql)), pero `deleteCategory` **rechaza** con
  400 si hay subcategorías ([`admin.service.ts:1136-1140`](../apps/api/src/modules/admin/admin.service.ts#L1136-L1140)). Ahí es lo correcto porque de una
  categoría cuelgan terceros —anuncios de otros usuarios, patrocinados— que sí se
  sorprenderían.

De un `NavItem` no cuelga ningún tercero. **Aplica el razonamiento del footer.** La UI
anuncia el número exacto de descendientes antes de confirmar (§7).

### 6.2 `pageId` → `Post` con `onDelete: Restrict` + precheck ampliado

Igual que `FooterItem.page` ([`schema.prisma:1746-1750`](../apps/api/prisma/schema.prisma#L1746-L1750)). Y —**esto es una modificación
obligatoria de código existente, no algo nuevo**— el precheck de
`BlogService.adminDelete` debe contar **las dos tablas**. Hoy cuenta solo `footerItem`
([`blog.service.ts:326-333`](../apps/api/src/modules/blog/blog.service.ts#L326-L333)):

```ts
// HOY
if (post.type === PostType.PAGE) {
  const footerItemCount = await this.prisma.footerItem.count({ where: { pageId: id } });
  if (footerItemCount > 0) throw new BadRequestException(`… enlazada desde ${footerItemCount} sitio(s) del footer`);
}
```

Sin ampliarlo, borrar una página enlazada **solo desde el nav** pasa el precheck y revienta
contra la constraint física como **500 sin controlar** — exactamente el fallo que el precheck
del footer existe para evitar. El mensaje ampliado debe distinguir footer y nav, para que el
admin sepa dónde ir a desenlazar.

### 6.3 Lo que ya protege el nav sin tocar nada

El slug de una `PAGE` publicada es **inmutable** ([`blog.service.ts:190-200`](../apps/api/src/modules/blog/blog.service.ts#L190-L200), código
`SLUG_IMMUTABLE`). Esa garantía ya cubre al nav igual que al footer: un `href` resuelto como
`/paginas/{slug}` no se puede quedar roto por un renombrado.

### 6.4 Invalidación de caché al cambiar una página

`BlogService.revalidatePostPaths` dispara hoy `revalidateTag('footer-nav')` cuando una `PAGE`
se publica/despublica/borra ([`blog.service.ts:430-438`](../apps/api/src/modules/blog/blog.service.ts#L430-L438)) — porque eso es justo lo que puede
cambiar si un ítem que la referencia se pinta o no. **Debe añadirse `revalidateTag('main-nav')`
en el mismo sitio**, por el mismo motivo exacto.

---

## 7. CRUD de admin — `/admin/nav`

Nueva sección. Entrada en `AdminNav` con `roles: ['ADMIN']`, junto a la de Footer
([`(admin)/components/AdminNav.tsx:21`](../apps/web/src/app/(admin)/components/AdminNav.tsx#L21)). Sin ella la sección es invisible; sin el path en
`middleware.ts` sería inaccesible para roles restringidos — pero al ser ADMIN-only basta el
ítem del nav, porque ADMIN tiene acceso total ([`middleware.ts:86-94`](../apps/web/src/middleware.ts#L86-L94)).

### 7.1 Backend

Módulo `modules/nav/` calcado de `modules/footer/` ([`footer.module.ts`](../apps/api/src/modules/footer/footer.module.ts): `PrismaModule`,
`AuditLogModule`, `RevalidateModule`; dos controllers, un service).

| Método | Ruta | Guards |
|---|---|---|
| `GET` | `/nav?pageType=X` | ninguno (público) |
| `GET` | `/admin/nav` | `JwtAuthGuard, RolesGuard` + `@Roles(ADMIN)` |
| `POST` | `/admin/nav/items` | ídem |
| `PATCH` | `/admin/nav/items/reorder` | ídem |
| `PATCH` | `/admin/nav/items/:id` | ídem |
| `DELETE` | `/admin/nav/items/:id` | ídem |

> **Gotcha obligatorio:** `items/reorder` se declara **ANTES** de `items/:id`, o Nest captura
> `"reorder"` como `:id`. Ya documentado dos veces en el repo
> ([`footer-admin.controller.ts:41-43`](../apps/api/src/modules/footer/footer-admin.controller.ts#L41-L43)).

- `GET /admin/nav` devuelve la estructura **completa sin filtrar** —incluidos nodos
  inactivos, nodos con página en borrador y nodos temporalmente inválidos— con el
  `page.status` incluido, para que la UI pinte los badges. Mismo criterio que
  `adminListStructure` ([`footer.service.ts:62-75`](../apps/api/src/modules/footer/footer.service.ts#L62-L75)).
- `reorder` recibe **solo los hermanos afectados**, no el árbol entero; DTO calcado de
  `ReorderFooterItemsDto` / `ReorderCategoriesDto` (`items: [{id, order}]`, ambos idénticos).
- **Toda** mutación: `auditLog.log({ action: 'NAV_ITEM_CREATE' | ... })` +
  `revalidateService.revalidateTag('main-nav')`. Sin excepción — en el footer son 8 de 8
  ([`footer.service.ts`](../apps/api/src/modules/footer/footer.service.ts), líneas 93, 119, 144, 161, 192, 240, 258, 275). `RevalidateService` ya
  es genérico y compartido, no hay que tocarlo ([`revalidate.service.ts:5-9`](../apps/api/src/common/revalidate/revalidate.service.ts#L5-L9)).
- `updateItem` con `parentId` en el payload = **mover en el árbol**. No hay endpoint aparte,
  igual que "mover de columna" en el footer es mandar `columnId` en el update
  ([`footer.service.ts:196-201`](../apps/api/src/modules/footer/footer.service.ts#L196-L201)). Validaciones propias del árbol al mover:
  **no crear ciclos** (un nodo no puede colgar de sí mismo ni de un descendiente suyo) y
  **no superar `NAV_MAX_DEPTH`**.
- Tocar `type`/`pageId`/`url` exige mandar la **combinación completa** del destino en el
  mismo payload, no mezclarla con lo guardado — misma regla y mismo motivo que el footer
  ([`footer.service.ts:196-214`](../apps/api/src/modules/footer/footer.service.ts#L196-L214)).

### 7.2 Frontend — `(admin)/admin/nav/page.tsx`

`'use client'`, token de `useSession()`, estado con `useState`, sin librerías nuevas: es la
mezcla de dos páginas que ya existen.

**De `admin/categorias`** ([`(admin)/admin/categorias/page.tsx:726-790`](../apps/web/src/app/(admin)/admin/categorias/page.tsx#L726-L790)) — árbol y reorden:

- Render de 2 niveles con indentación (el borde izquierdo `ml-6 border-l pl-4` del footer).
- `moveNode(id, dir)` = **swap de `order` con el hermano vecino** + optimistic update +
  `PATCH .../reorder` con solo los 2 afectados; en error, refetch para revertir. `moveRoot` y
  `moveChild` del footer y de categorías son el mismo algoritmo escrito dos veces
  ([`(admin)/admin/footer/page.tsx:464-524`](../apps/web/src/app/(admin)/admin/footer/page.tsx#L464-L524)); aquí se escribe **una sola** función,
  parametrizada por la lista de hermanos.

**De `admin/footer`** ([`(admin)/admin/footer/page.tsx`](../apps/web/src/app/(admin)/admin/footer/page.tsx)) — editor de nodo:

- Campos condicionales por `type`, limpiando `pageId`/`url` al cambiarlo (líneas 108-206).
- Selector de páginas con `getAdminPosts(token, { type: 'PAGE', perPage: 200 })` y **error
  visible, nunca `.catch` mudo** — hay un bug documentado por haberlo hecho mal (líneas
  376-394). El `perPage` tiene tope en el backend: respetarlo.
- Badge *"en borrador — no se muestra"* (líneas 282-286).
- Confirmación de borrado que **anuncia la consecuencia** (líneas 440-447).

**Propio del nav** (lo que no existe en ninguna de las dos):

| Control | Comportamiento |
|---|---|
| Selector de destino | Cuatro opciones, no tres: **"Sin destino (solo desplegable)"**, "Página del CMS", "Ruta interna", "URL externa". La primera es `type=null`. |
| `active` | Checkbox por nodo. Un nodo inactivo se pinta atenuado **con todo su subárbol atenuado**, para que se vea que el corte arrastra. |
| `visibleOn` | Multi-select de los 9 `NavPageType`. **Ninguno marcado se muestra como "En todas las páginas"**, no como lista vacía (§3.3). |
| Badge de nodo inválido | *"sin destino y sin hijos — no se muestra"* cuando `type=null` y `children=[]` (§2.3). |
| Crear hijo | Botón "Nuevo submenú" en cada nodo raíz. Deshabilitado a `NAV_MAX_DEPTH`, con el motivo escrito, no solo gris. |
| Borrar | `window.confirm` que dice **cuántos descendientes** se van: *"¿Eliminar «Ayuda»? Se eliminarán también sus N submenú(s)."* — el cascade se anuncia, nunca sorprende. |
| Previsualización | Selector de `NavPageType` que muestra **cómo queda la barra en ese tipo de página** (aplicando el gate). Es lo que hace comprensible la interacción de `active` × `visibleOn` × gate recursivo, que de otro modo solo se descubre publicando. |

---

## 8. Ráfagas de implementación

Cuatro ráfagas. Cada una cierra en verde y deja el sistema coherente.

### RN.1 — Backend: modelo y servicio

- Migración: enums `NavItemType`, `NavPageType`; modelo `NavItem`; relación inversa
  `Post.navItems`.
- `NavService`: `listPublicNav(pageType)` con el algoritmo de poda de §5.2,
  `adminListStructure()`, `assertItemDestination` (§2.3), `assertNoCycle`, `assertMaxDepth`.
- **Tests unitarios del gate** (`nav.service.spec.ts`) — la tabla de §5.3 completa. Es la
  ráfaga que más test necesita: el gate recursivo es lo único genuinamente nuevo.
- Sin endpoints todavía.

### RN.2 — Backend: endpoints, auditoría y revalidación

- `NavController` (público) y `NavAdminController` (`admin/nav`), con `*/reorder` antes de
  `*/:id`.
- DTOs (create/update/reorder), `NavModule`, registro en `app.module.ts`.
- `auditLog.log` + `revalidateTag('main-nav')` en las 5 mutaciones.
- **Ampliar `BlogService.adminDelete`** para contar también `navItem` (§6.2) y **añadir
  `revalidateTag('main-nav')` a `revalidatePostPaths`** (§6.4). Actualizar
  `blog.service.spec.ts`, que hoy cubre el precheck del footer.
- e2e (`nav.e2e-spec.ts`), molde `footer.e2e-spec.ts`.

### RN.3 — Frontend: render público

- `lib/api/nav.ts` con `getCachedNav(pageType)` (§4.3).
- `components/layout/MainNav.tsx` (server, con el gate `return null`) y
  `NavDropdown.tsx` (client, Radix).
- Los 9 layouts anidados de §4.2 + mover `(public)/page.tsx` a `(public)/(home)/page.tsx`.
  `(public)/layout.tsx` **no se toca**.
- e2e: barra ausente sin datos; presente con datos; desplegable con teclado; un tipo de
  página que oculta un nodo.

### RN.4 — Frontend: CRUD de admin

- `lib/api/nav-admin.ts` (molde `lib/api/footer-admin.ts`).
- `(admin)/admin/nav/page.tsx` (§7.2) + entrada en `AdminNav`.
- e2e (`nav-admin.spec.ts`), molde `footer-admin.spec.ts`.

**Orden y dependencias:** RN.1 → RN.2 → {RN.3, RN.4} (las dos últimas solo dependen de RN.2 y
pueden ir en paralelo). La barra no aparece en el sitio hasta RN.3, y hasta RN.4 solo se
puede poblar por seed/SQL — no hay estado intermedio roto de cara al usuario.

---

## 9. Registro de decisiones

### Cerradas antes del diseño (encargo)

Alcance solo `(public)` · árbol auto-referencial · destino opcional · `active` explícito ·
visibilidad por array de tipos estilo `BannerPlacement`.

### Tomadas **en** este diseño (lo que quedaba abierto)

| # | Decisión | §  |
|---|---|---|
| 1 | **Profundidad máxima 2** (raíz + un nivel), como constante validada en el servicio, no como restricción de schema — subirla luego es un número; bajarla sería migrar datos. | §2.2 |
| 2 | **`BLOG_INDICE`/`BLOG_POST` y `CATEGORIA`/`SUBCATEGORIA` se colapsan** → 9 valores de enum. Añadir un valor después es una migración aditiva sin backfill (precedente `ContactReasonScope`); fusionar dos ya usados obliga a reescribir datos. | §3.2 |
| 3 | **`visibleOn` vacío = se muestra en TODAS.** Precedente: `Category.allowedViews []` = "no configurado". Divergencia consciente de `Banner.placements`, que prohíbe el vacío. | §3.3 |
| 4 | **Caché: opción (b)**, una entrada por tipo (`['main-nav', pageType]`) con **tag único** `'main-nav'`. **Se decide contra la recomendación tentativa del encargo**: la opción (a) obligaría a ejecutar el gate recursivo entero en Next, contra la regla innegociable de `CLAUDE.md`. Coste acotado: ≤9 entradas pequeñas, invalidación igual de simple. | §4.3 |
| 5 | **La barra NO se monta en `(public)/layout.tsx`** —un layout de servidor no puede conocer el tipo de página— sino en **9 layouts anidados**, uno por tipo, mapeo 1:1 con el enum. Visualmente idéntico; a prueba de olvidos, porque un layout cubre por herencia toda ruta que cuelgue de él. | §4.2 |
| 6 | **No sticky.** Evita duplicar `h-16` como número mágico en otro fichero, no come viewport en móvil y no complica el apilamiento de los desplegables. Reversible en una clase. | §4.4 |
| 7 | **La barra va ENCIMA del `BannerList`** en la home: chrome sobre contenido, y así no baila verticalmente según haya banner o no. | §4.4 |
| 8 | **`parentId` con `onDelete: Cascade`** (molde footer), no el rechazo-con-400 de `Category`: de un `NavItem` no cuelgan terceros. La UI anuncia el número de descendientes antes de confirmar. | §6.1 |
| 9 | **Nodo sin destino y sin hijos: se acepta al escribir y se oculta al leer**, no se rechaza con 400. El invariante lo garantiza el gate; un 400 solo impondría orden a las operaciones del admin sin ganar nada. | §2.3 |
| 10 | **Desplegables con Radix `DropdownMenu`** (ya instalado y ya usado en el header), no CSS-only: teclado y táctil. | §4.5 |

### Pendientes de afinar en implementación (no bloquean la aprobación)

- Textos exactos de los mensajes de error y de las confirmaciones.
- Estilo visual fino de la barra (altura, separadores, comportamiento en móvil: ¿scroll
  horizontal o menú hamburguesa propio?).
- Si la previsualización por tipo de página (§7.2) entra en RN.4 o se pospone.
- Si `NAV_MAX_DEPTH` se expone como `Setting` de admin ([`/admin/ajustes`](../apps/web/src/app/(admin)/admin/ajustes/page.tsx)) o se queda como
  constante de código. **Recomendación: constante** — subirlo exige trabajo de UI que un
  ajuste en caliente no puede provocar por sí solo.

---

## 10. Nota sobre lo que este diseño modifica de lo ya construido

Tres puntos, todos en la ráfaga RN.2, que conviene tener a la vista porque tocan código que
hoy funciona:

1. `BlogService.adminDelete` — el precheck pasa a contar `footerItem` **y** `navItem` (§6.2).
2. `BlogService.revalidatePostPaths` — añade `revalidateTag('main-nav')` junto al
   `'footer-nav'` que ya dispara (§6.4).
3. `(public)/page.tsx` se **mueve** a `(public)/(home)/page.tsx` (§4.2). La URL no cambia.

Nada más de lo existente se toca. En particular: **`Header.tsx` y `(public)/layout.tsx`
quedan intactos**, que era el requisito de convivencia del encargo.
