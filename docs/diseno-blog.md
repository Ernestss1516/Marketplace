# Diseño del módulo Blog — Fase B, Hito 2

> ## ✅ ESTADO: IMPLEMENTADO — y con la arquitectura central REEMPLAZADA
>
> **Diseño de RB.1 (2026-06-24), implementado en RB.2–RB.4.** Revisado en la auditoría de
> documentación del **2026-08-04**. **Donde el diseño y la implementación difieran, gana la
> implementación.**
>
> ### ⚠️ Esto no es «el diseño con el estado actualizado». El cuerpo del post se REEMPLAZÓ.
>
> Este documento propone el contenido como **`body String` en Markdown**, editado en un
> `<textarea>` y pintado con `react-markdown`. Eso **se construyó y funcionó**, y después
> **se descartó**: hoy el contenido vive en **`blocks Json`, un array ordenado de bloques
> tipados, con 13 tipos y un editor visual**. `Post.body` **ya no existe** en el schema.
>
> | | Este diseño (RB.1) | Hoy |
> |---|---|---|
> | Almacenamiento del cuerpo | `body String @db.Text` (Markdown crudo) | **`blocks Json @default("[]")`** — array ordenado |
> | Autoría | `<textarea>` (y después `@uiw/react-md-editor`) | **Editor visual por bloques**: añadir, reordenar, borrar, con preview |
> | Renderizado | Un `<MarkdownBody>` para todo el cuerpo | **13 renderizadores**, uno por tipo, tras un `BlockRenderer` |
> | Tipos de contenido | Uno (Markdown) | **13** — 12 estáticos + `listings`, el primer bloque **dinámico** |
> | Alcance | Solo artículos de blog | **`PostType { POST, PAGE }`** — también páginas informativas |
> | Autoría por rol | Solo ADMIN | **EDITOR, MODERATOR y ADMIN** (borrado permanente sigue ADMIN-only) |
>
> **Por qué se cambió** (Hito 7, fase 7.2 — «blog enriquecido y hub de contenido»): el
> objetivo pasó de *publicar artículos* a que **un admin no técnico compusiera páginas** con
> imágenes intercaladas, FAQ, pasos ilustrados, fichas y llamadas a la acción. Un blob de
> Markdown no da eso: obliga a escribir HTML a mano —justo lo que la invariante de seguridad
> de §2.2 prohíbe— o a renunciar al formato. El sistema de bloques resuelve las dos cosas a
> la vez: cada pieza tiene su forma validada y su renderizador, y el admin no escribe markup.
>
> ### Lo que SOBREVIVIÓ intacto
>
> - **La invariante de seguridad de §2.2**, que es lo más valioso del documento:
>   `react-markdown` + `remark-gfm` + `rehype-sanitize`, **SIN `rehype-raw`**. No desapareció
>   con el Markdown: **se heredó al bloque `text`**, que reutiliza literalmente la misma
>   tubería. Ver §2.
> - **Toda la estrategia SEO de §3** — slugs, metadatos, JSON-LD, sitemap, ISR con
>   revalidación on-demand — se construyó como se diseñó y sigue vigente, con una excepción
>   nueva que el bloque dinámico obligó a añadir (§3.5).
> - **El encaje de §5**: módulo autónomo, portada vía `/media/upload` sin URLs externas,
>   patrón admin con `AuditLog` en toda mutación.
>
> **Para la crónica** del reemplazo —las tres ráfagas del sistema de bloques, con su
> validación y sus hallazgos— la referencia es `estado-tecnico.md`, secciones «Sistema de
> bloques — Ráfaga 1/2/3». **Para el inventario de endpoints**, `docs/contratos-api.md`.

---

## Resumen ejecutivo

El blog es un módulo de contenido editorial **propiedad exclusiva de los admins**:
escriben, publican y gestionan posts desde el backoffice. El objetivo es SEO:
cada post genera una página estática (ISR) con metadatos completos, OpenGraph y
Article structured data. No hay comentarios, ni publicación por usuarios.

Andamiaje existente auditado:
- **Cero scaffold de blog** — no existe ningún fichero, ruta ni modelo.
- **ISR webhook genérico** (`POST /api/revalidate?secret=&path=`) ya implementado
  y listo para usar.
- **Sitemap** es estático; hay que convertirlo a `async` para incluir los slugs
  de los posts.
- **Módulo media** (`POST /media/upload`) reutilizable para subir la imagen de
  portada; devuelve una URL lista para almacenar.
- **Patrón admin** establecido: `@Roles(Role.ADMIN)`, `AuditLogService.log()` en
  toda mutación, controllers separados por dominio.

---

## 1. Modelo de datos

> ## 🔄 El modelo REAL — `blocks Json`, no `body String`
>
> ```prisma
> enum PostStatus { DRAFT, PUBLISHED }
> enum PostType   { POST, PAGE }          // ← NO estaba en este diseño
>
> model Post {
>   id              String     @id @default(cuid())
>   type            PostType   @default(POST)   // POST = artículo · PAGE = página informativa
>   title           String
>   slug            String     @unique
>   excerpt         String?    @db.Text
>   blocks          Json       @default("[]")   // ← SUSTITUYE a `body String`
>   status          PostStatus @default(DRAFT)
>   coverUrl        String?
>   metaTitle       String?
>   metaDescription String?    @db.Text
>   tags            String[]   @default([])
>   authorId        String
>   author          User       @relation("PostAuthor", …)
>   publishedAt     DateTime?
>   createdAt       DateTime   @default(now())
>   updatedAt       DateTime   @updatedAt
> }
> ```
>
> **`blocks` es un array ORDENADO: la posición en el array ES el orden.** No hay campo
> `order` por bloque —a diferencia de `FooterItem`— porque no son filas separadas: viven
> todas en el Json de una única fila `Post`.
>
> **La migración fue un corte limpio, sin backfill.** Las filas de desarrollo que había
> quedaron con `blocks: []`: era contenido de relleno, no merecía un script de envoltura.
> Hubo que generarla a mano (`prisma migrate diff` → editar el `.sql` → `migrate deploy`)
> porque un `DROP COLUMN` sobre filas no nulas exige un prompt que un entorno no interactivo
> no puede confirmar.
>
> ### Dos cosas que este diseño no preveía y que el modelo ganó después
>
> **`PostType`** — el mismo modelo cubre artículos de blog (`POST`, en `/blog/[slug]`) y
> páginas informativas (`PAGE`, en `/paginas/[slug]`). Se distinguen por `type`, no por una
> tabla aparte: comparten el 100 % del modelo, del CRUD y del sistema de bloques; lo único
> que cambia es la presentación (una página no tiene fecha, autor, tags ni navegación
> anterior/siguiente) y el JSON-LD (`WebPage` en vez de `BlogPosting`).
>
> **Los campos de footer se fueron.** El `Post` llegó a tener `showInFooter`, `footerOrder`
> y `footerGroup`. **Se retiraron**: la navegación del footer es ahora una entidad propia
> (`FooterColumn` + `FooterItem`). Lo que queda del lado del blog es la relación inversa:
> `FooterItem.pageId` es FK a `Post` con **`onDelete: Restrict`** más un precheck explícito
> en `BlogService.adminDelete`. Es decir: **borrar una página enlazada desde el footer se
> rechaza con un 400 legible**, en vez de reventar por FK o dejar el ítem apuntando al
> vacío.

### 1.1 Enum y modelo `Post` *(diseño original — `body String`, reemplazado)*

```prisma
enum PostStatus {
  DRAFT       // borrador, no visible públicamente
  PUBLISHED   // publicado, indexado en sitemap
}

model Post {
  id              String     @id @default(cuid())
  title           String
  /// Slug único para la URL pública: /blog/{slug}
  slug            String     @unique
  /// Resumen corto: aparece en la tarjeta de listado y como meta description
  /// si no hay metaDescription explícita.
  excerpt         String?    @db.Text
  /// Cuerpo del post almacenado en Markdown raw.
  body            String     @db.Text @default("")
  status          PostStatus @default(DRAFT)
  /// URL de la imagen de portada (obtenida vía POST /media/upload).
  coverUrl        String?

  // ── SEO opcional: si son null se usan title / excerpt como fallback ─────
  metaTitle       String?
  metaDescription String?    @db.Text

  /// Etiquetas planas como slugs (p.ej. ["consejos", "segunda-mano"]).
  /// PostgreSQL array; filtro con has() en Prisma.
  tags            String[]   @default([])

  // ── Autoría ──────────────────────────────────────────────────────────────
  authorId        String
  author          User       @relation("PostAuthor", fields: [authorId], references: [id])

  publishedAt     DateTime?
  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt

  @@index([status, publishedAt])
}
```

Añadir en el modelo `User` existente:
```prisma
posts  Post[]  @relation("PostAuthor")
```

### 1.2 Decisiones de diseño del modelo

| Decisión | Alternativa descartada | Razón |
|---|---|---|
| `tags String[]` (array PostgreSQL) | Modelo `PostTag` + join table | El blog es MVP; array plano es suficiente y Prisma lo soporta nativamente con `has()` |
| `coverUrl String?` | FK a `ListingImage` | Una portada por post ≠ galería; la URL es suficiente. El admin sube la imagen vía `POST /media/upload` y almacena la URL directamente |
| `body @db.Text` (Markdown raw) | HTML almacenado | Markdown es portable, editable y regenerable; HTML almacenado introduce riesgo de XSS |
| `metaTitle/metaDescription` opcionales | Solo title/excerpt | Permite override SEO sin cambiar el contenido visible |
| `authorId` → FK a `User` | Campo de texto libre | Mantiene la integridad referencial; en el backoffice el autor es el admin autenticado |

### 1.3 Migración

Nombre: `add_blog_post` (séptima migración, tras `add_audit_log_and_settings`).

```sql
-- CreateEnum
CREATE TYPE "PostStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "excerpt" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "status" "PostStatus" NOT NULL DEFAULT 'DRAFT',
    "coverUrl" TEXT,
    "metaTitle" TEXT,
    "metaDescription" TEXT,
    "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "authorId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Post_slug_key" ON "Post"("slug");
CREATE INDEX "Post_status_publishedAt_idx" ON "Post"("status", "publishedAt");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
```

Sin dato de backfill — la tabla empieza vacía.

---

## 2. Formato del cuerpo: SISTEMA DE BLOQUES

> ## 🔄 El cuerpo ya no es un Markdown. Es un array de bloques tipados.
>
> **Pero la invariante de seguridad de §2.2 sobrevivió intacta** — solo cambió de sitio.
> Sigue leyéndose §2.2: es la regla vigente, aplicada ahora al bloque `text`.
>
> ### Los 13 tipos
>
> Unión discriminada por `type`, con **espejo exacto** entre los DTOs del backend
> (`modules/blog/dto/blocks/*.dto.ts`) y los tipos del frontend
> (`apps/web/src/types/blocks.ts`). Todos extienden `BaseBlock{id}`.
>
> | # | `type` | Forma | Renderizador |
> |---|---|---|---|
> | 1 | `text` | `{markdown}` | `TextBlockRenderer` → **`MarkdownBody`** (§2.2) |
> | 2 | `faq` | `{title?, items[{question, answer}]}` | `FaqBlockRenderer` |
> | 3 | `hub` | `{title?, links[{label, href, description?}]}` | `HubBlockRenderer` |
> | 4 | `image` | `{url, alt, caption?, position?, width?}` | `ImageBlockRenderer` |
> | 5 | `cta` | `{label, href, style?}` | `CtaBlockRenderer` |
> | 6 | `quote` | `{text, author?}` | `QuoteBlockRenderer` |
> | 7 | `video` | `{provider, videoId}` | `VideoBlockRenderer` |
> | 8 | `separator` | `{}` | `SeparatorBlockRenderer` |
> | 9 | `table` | `{headers[], rows[][]}` | `TableBlockRenderer` |
> | 10 | `imageText` | `{image{url,alt,caption?}, markdown, layout}` | `ImageTextBlockRenderer` |
> | 11 | `steps` | `{title?, items[{title, description, image?}]}` | `StepsBlockRenderer` |
> | 12 | `profile` | `{image?, name?, attributes[{label, value}]}` | `ProfileBlockRenderer` |
> | 13 | **`listings`** | referencia a categoría/filtros — **DINÁMICO** | `ListingsBlockRenderer` |
>
> Los 1–9 llegaron en la Ráfaga 1; los 10–13 en la Ráfaga 3. **Añadir un tipo toca un solo
> punto de registro**: su `*-block.dto.ts` y la lista de `ValidBlocksArray()`
> (`block.dto.ts`); ni `CreatePostDto` ni `UpdatePostDto` se tocan. Tope de **100 bloques**
> por post, como guardarraíl contra payloads abusivos.
>
> ### La validación es PROFUNDA, y hay una razón concreta
>
> `class-transformer` con `discriminator` sobre `type`: cada elemento del array se valida
> contra **su propia clase**, y el `ValidationPipe` global (`whitelist` +
> `forbidNonWhitelisted`) rechaza un `type` desconocido o una propiedad de más.
>
> **Contraste deliberado con un precedente que NO se siguió:** `Category.attributeSchema`
> valida solo `@IsArray()` superficialmente. Es tolerable ahí porque nunca se interpola en un
> atributo HTML real. **Los bloques sí lo hacen** —`image.url`, `cta.href`, `hub.links[].href`
> acaban en un `src` o un `href`—, así que aquí la validación es campo a campo. Con dos
> validadores compartidos (`common/validators/safe-url.ts`):
>
> - **`@IsSafeContentUrl()`** para `cta.href` y `hub.links[].href`: ruta relativa `/…` o
>   absoluta http/https, **nunca `javascript:` ni `data:`**.
> - **`@IsOwnStorageUrl()`** para `image.url`: debe empezar por nuestro propio storage. Mismo
>   criterio *upload-only, sin URLs externas* que ya tenía `coverUrl`.
> - **Vídeo: nunca una URL cruda ni un iframe libre.** Solo se guarda `{provider, videoId}`;
>   el cliente parsea la URL que pega el admin y el backend **revalida** el formato del
>   `videoId` según el `provider` hermano.
>
> Es la misma lógica de §2.2 llevada un paso más allá: si el contenido va a acabar en un
> atributo HTML, se valida en el servidor, no se confía en que el autor sea admin.
>
> ### El bloque `listings` — el único dinámico, y su consecuencia
>
> Los 12 primeros son **autocontenidos**: lo que se ve es lo que está guardado. `listings` no:
> se resuelve contra el estado vivo del marketplace en cada render.
>
> **Consecuencia de caché, que es la decisión importante:** en Next, la frescura de una página
> ISR la gobierna el **mínimo `revalidate` entre todos los `fetch()` que la generan**, no solo
> el `export const revalidate` del segmento. Como el bloque pide los anuncios con
> `next: { revalidate: 180 }` (3 min), **una página que contiene un bloque `listings` deja de
> refrescarse cada hora y pasa a hacerlo cada 3 minutos.** Solo esas: cada URL es una entrada
> de caché independiente. Un `/paginas/quienes-somos` sin bloque dinámico sigue con su hora.
>
> ### El editor visual
>
> Sustituye al `<textarea>` de §2.3. Un admin **no técnico** compone la página añadiendo,
> reordenando y borrando bloques, con preview. El `BlockRenderer` es **síncrono y compartido**
> entre el SSR público y el preview del editor — contrato que el bloque dinámico tuvo que
> respetar sin romperlo. Las imágenes se suben por `POST /admin/blog/upload-image` (prefijo
> `blocks/`). Cubierto por `block-editor-full.spec.ts` (los 13 tipos) y `block-listings.spec.ts`.

### 2.1 Almacenamiento *(reemplazado — se conserva como registro del enfoque inicial)*

`Post.body` almacenaba **Markdown raw** (texto plano, GFM). El backend lo devolvía tal cual
en la respuesta JSON; no había procesado de HTML en el servidor.

> **Hoy:** `Post.body` no existe. El cuerpo es `blocks Json`, y el Markdown vive **dentro**
> de los bloques `text` e `imageText`, con la misma tubería de §2.2.

### 2.2 Renderizado del Markdown — ✅ INVARIANTE VIGENTE

> ## 🔒 Esta sección NO se reemplazó. Es la regla de seguridad viva del proyecto.
>
> El cuerpo dejó de ser Markdown, pero el Markdown no desapareció: vive dentro de los bloques
> **`text`** e **`imageText`**, y **usa exactamente esta tubería, sin una sola variación**.
> Está centralizada en un único componente, `components/blog/MarkdownBody.tsx`, que es el que
> reutiliza `TextBlockRenderer` — no hay una segunda ruta de renderizado de Markdown en el
> proyecto.
>
> La regla está anotada en **tres sitios** del código para que no se pierda: en
> `MarkdownBody.tsx`, en `TextBlockRenderer.tsx` y en el propio `TextBlockDto` del backend
> (*«Markdown, no rich text — reutiliza tal cual la tubería ya auditada … SIN `rehype-raw`»*).
>
> **Sigue siendo una regla invariante: nadie añade `rehype-raw`.** Y el argumento de abajo
> —«aunque la autoría sea solo-admin, el contenido se sirve públicamente»— se ha vuelto **más
> fuerte, no menos**: desde BLOG-EDITOR la autoría ya no es solo-admin, sino que la comparten
> **EDITOR, MODERATOR y ADMIN**. Más manos con acceso de escritura es exactamente el escenario
> que esta defensa cubre.
>
> Verificado por `blog-markdown-editor.spec.ts`, que comprueba que un `<script>` literal
> escrito en el editor **nunca se ejecuta**.

**Decisión:** `react-markdown` + `remark-gfm` + `rehype-sanitize` (schema por
defecto). **No se añade `rehype-raw`.**

```tsx
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize from 'rehype-sanitize';

// Server Component — procesado en el servidor (SSR/ISR), no en el navegador.
<ReactMarkdown
  remarkPlugins={[remarkGfm]}
  rehypePlugins={[rehypeSanitize]}
  className="prose max-w-none"
>
  {post.body}
</ReactMarkdown>
```

**Por qué esta combinación:**

- `react-markdown` sin `rehype-raw` ya escapa cualquier HTML literal en el cuerpo
  Markdown (p.ej. `<script>` se renderiza como texto, nunca se ejecuta). Es el
  comportamiento por defecto del paquete.
- `rehype-sanitize` añade una segunda línea de defensa: elimina atributos
  peligrosos (`onclick`, `href=javascript:`, etc.) de los elementos HTML que
  `react-markdown` sí genera como parte del AST (links, imágenes…). Usa el schema
  por defecto de `hast-util-sanitize`, que es conservador y mantiene lo semántico.
- **Rationale de la defensa en profundidad:** aunque la autoría es solo-admin, el
  contenido se sirve públicamente vía SSR. Si una cuenta admin fuera comprometida,
  un `<script>` en `body` afectaría a todos los lectores. Con esta configuración,
  incluso si alguien inyecta HTML malicioso, no se ejecuta.
- No añadir `rehype-raw` es la regla invariante: si en el futuro alguien lo añade
  para soporte de HTML embebido, `rehype-sanitize` sigue siendo necesario.

`prose` de Tailwind Typography (`@tailwindcss/typography`) provee el estilo
tipográfico.

### 2.3 Editor en el backoffice *(reemplazado — dos veces)*

> **El `<textarea>` de abajo tuvo dos sucesores.** Primero un editor de Markdown estilo
> GitHub (`@uiw/react-md-editor`, con toggle de preview), que sustituyó al textarea plano;
> y después el **editor visual por bloques**, que es lo que hay hoy. El editor de Markdown
> **no se tiró**: quedó reconectado como el editor del bloque `text` (`MarkdownEditorClient`),
> así que la pieza sobrevivió aunque dejara de ser la interfaz principal.
>
> La frase de abajo —«no se requiere un editor WYSIWYG pesado en el MVP»— fue correcta para
> el MVP y **dejó de serlo** cuando el objetivo pasó a ser que un admin no técnico compusiera
> páginas. Ver el bloque de §2.

El formulario de creación/edición usa un `<textarea>` para el Markdown con
preview en vivo en el lado cliente (client component dentro del layout admin).
No se requiere un editor WYSIWYG pesado en el MVP; un `<textarea>` + `react-markdown`
en modo preview es suficiente.

---

## 3. Estrategia SEO

### 3.1 Slugs

- Generado automáticamente desde `title` al crear (similar a los anuncios):
  `slugify(title) + '-' + randomHex(6)`.
- **Editable** por el admin antes de publicar.
- Restricción `UNIQUE` en BD.
- URL pública: `/blog/{slug}`.

### 3.2 Metadatos y OpenGraph

En `app/(public)/blog/[slug]/page.tsx`:

```ts
export async function generateMetadata({ params }): Promise<Metadata> {
  const post = await getPost(params.slug);  // notFound() si no existe o no es PUBLISHED
  return {
    title: post.metaTitle ?? post.title,
    description: post.metaDescription ?? post.excerpt ?? undefined,
    openGraph: {
      title: post.metaTitle ?? post.title,
      description: post.metaDescription ?? post.excerpt ?? undefined,
      type: 'article',
      publishedTime: post.publishedAt ?? undefined,
      authors: [post.author.name],
      images: post.coverUrl ? [{ url: post.coverUrl }] : [],
    },
  };
}
```

### 3.3 Article structured data (JSON-LD)

Embebido en el componente de la página de detalle:

```tsx
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'BlogPosting',
  headline: post.title,
  description: post.excerpt ?? undefined,
  image: post.coverUrl ?? undefined,
  datePublished: post.publishedAt?.toISOString(),
  dateModified: post.updatedAt.toISOString(),
  author: { '@type': 'Person', name: post.author.name },
  url: `${SITE_URL}/blog/${post.slug}`,
};

// En el JSX (fuera del <article>):
<script
  type="application/ld+json"
  dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
/>
```

### 3.4 Sitemap dinámico

Convertir `apps/web/src/app/sitemap.ts` de función síncrona a `async` y añadir
los posts publicados.

**Solo se incluyen posts PUBLISHED:** `getPostList()` llama al endpoint público
`GET /blog`, que filtra por `status = PUBLISHED` en Prisma. Los borradores nunca
llegan al sitemap porque nunca llegan a esa query.

```ts
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const { items: posts } = await getPostList({ perPage: 500 }); // solo PUBLISHED
  return [
    { url: SITE_URL, lastModified: new Date(), changeFrequency: 'daily', priority: 1 },
    { url: `${SITE_URL}/busqueda`, changeFrequency: 'hourly', priority: 0.9 },
    { url: `${SITE_URL}/blog`, changeFrequency: 'weekly', priority: 0.8 },
    ...posts.map(p => ({
      url: `${SITE_URL}/blog/${p.slug}`,
      lastModified: p.updatedAt,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ];
}
```

### 3.5 ISR y revalidación on-demand

> **✅ Construido como se diseñó, con dos matices posteriores.**
>
> **1. El `RevalidateService` se extrajo y se comparte.** El blog fue el primer productor de
> llamadas al webhook, como anticipa esta sección; después el módulo `Footer` necesitó lo
> mismo, así que la lógica se sacó del blog a un `RevalidateService` común. Sigue siendo
> *fire-and-forget*: **que la revalidación falle no bloquea la respuesta al admin.**
>
> **2. El `revalidate = 3600` ya no gobierna solo.** Una página que contenga un bloque
> `listings` baja su frescura efectiva a **3 minutos**, porque en Next manda el mínimo
> `revalidate` de todos los `fetch()` que generan la ruta — no el del segmento. Solo afecta a
> las URLs que llevan ese bloque. Detalle en §2.

**Estado del webhook:** el endpoint `POST /api/revalidate?secret=&path=` existe
en `apps/web/src/app/api/revalidate/route.ts` (13 líneas, implementado en Fase 5).
No tiene test propio, pero su lógica es trivial: verifica el secret y llama
`revalidatePath(path)` de Next.js. **Es la primera vez que el backend lo invoca**
— el blog es el primer productor de llamadas a este webhook.

Las páginas públicas del blog usan ISR con tiempo largo:

```ts
// apps/web/src/app/(public)/blog/page.tsx
export const revalidate = 3600; // 1 hora

// apps/web/src/app/(public)/blog/[slug]/page.tsx
export const revalidate = 3600;
```

Además, `BlogService` (NestJS) llama al webhook **fire-and-forget** tras cualquier
mutación que afecte al estado publicado de un post:

```ts
// BlogService (NestJS)
private revalidate(path: string): void {
  const url = `${process.env.APP_URL}/api/revalidate`
    + `?secret=${process.env.REVALIDATE_SECRET}&path=${encodeURIComponent(path)}`;
  fetch(url, { method: 'POST', signal: AbortSignal.timeout(3000) }).catch(() => {});
}
```

| Acción admin | Paths revalidados |
|---|---|
| Publicar post | `/blog`, `/blog/{slug}` |
| Actualizar post publicado | `/blog/{slug}` |
| Despublicar post | `/blog`, `/blog/{slug}` |
| Eliminar post publicado | `/blog`, `/blog/{slug}` |

**Cobertura de `/blog?tag=`:** `revalidatePath('/blog')` en Next.js App Router
invalida **todas las entradas de caché** de la ruta `/blog`, incluyendo todas las
variantes de query string (`?tag=`, `?page=`, etc.). Next.js no segmenta la caché
por query params en ISR salvo que se configure explícitamente `dynamicParams`. Por
tanto, una sola llamada a `revalidate('/blog')` es suficiente para invalidar el
listado en todas sus formas filtradas.

El fallo de revalidación no bloquea la respuesta al admin (catch silencioso).
Dentro del TTL de 1 hora, la versión cacheada sigue activa; al expirar, Next.js
la regenera automáticamente desde la API.

Variables de entorno requeridas en el backend (nuevas respecto a la Fase 7):
`APP_URL` (URL del frontend, p.ej. `http://localhost:3000`) y `REVALIDATE_SECRET`
(mismo valor que el de `apps/web`). Ambas se añaden a `apps/api/.env.example`.

---

## 4. Endpoints

> ## ✅ Construidos — con dos diferencias
>
> **1. `body` ya no viaja: viaja `blocks`.** Donde abajo dice «incluye `body` (Markdown
> raw)», hoy es el array de bloques. El listado sigue sin devolverlo, por la misma razón de
> siempre (payloads grandes).
>
> **2. Hay dos endpoints públicos más, para las páginas informativas:**
> `GET /paginas` y `GET /paginas/:slug` — mismo contrato, filtrando `type = PAGE`. Los de
> `/blog` filtran `type = POST`. En el lado admin, `GET /admin/blog?type=POST|PAGE` sirve a
> ambos; **sin `type` devuelve posts y páginas mezclados**, así que el frontend siempre lo
> envía explícito.
>
> **Los roles de §4.2 también cambiaron:** el CRUD no es ADMIN-only. `EDITOR`, `MODERATOR` y
> `ADMIN` crean, editan, publican y despublican; **solo ADMIN borra permanentemente**. Es la
> aplicación del criterio de roles del Hito 5.1 — *contenido reversible para los tres, acción
> irreversible para ADMIN*. La matriz completa está en `docs/diseno-backoffice.md` §0.1.
>
> **El inventario verificado de endpoints está en `docs/contratos-api.md`**, que es la
> referencia operativa. Lo de aquí es el diseño.

### 4.1 Públicos (sin autenticación)

**`GET /blog`**

Lista paginada de posts publicados.

- Query: `?page=1&perPage=10&tag=slug-etiqueta`
- Respuesta: `{ items, total, page, perPage }`
- Cada item incluye: `id, title, slug, excerpt, coverUrl, publishedAt, updatedAt, tags, author.name`
- No incluye `body` (evita payloads grandes en el listado).
- Orden: `publishedAt DESC`.

**`GET /blog/:slug`**

Detalle completo de un post publicado.

- 404 si no existe o `status !== PUBLISHED`.
- Respuesta: todos los campos del modelo + `author.name`.
- Incluye `body` (Markdown raw).

### 4.2 Admin (protegidos con `@Roles(Role.ADMIN)`)

Montados en `BlogAdminController` dentro de `blog.module.ts`. Prefijo: `/admin/blog`.

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/admin/blog` | Lista todos los posts (cualquier estado). Query: `?page&perPage&status` |
| `GET` | `/admin/blog/:id` | Detalle completo por ID (no por slug, para el formulario de edición) |
| `POST` | `/admin/blog` | Crear post en estado DRAFT. Body: `CreatePostDto` |
| `PATCH` | `/admin/blog/:id` | Actualizar campos (título, body, tags, cover, metas…). Body: `UpdatePostDto` |
| `POST` | `/admin/blog/:id/publish` | DRAFT → PUBLISHED. Fija `publishedAt`, dispara revalidación |
| `POST` | `/admin/blog/:id/unpublish` | PUBLISHED → DRAFT. Limpia `publishedAt`, dispara revalidación |
| `DELETE` | `/admin/blog/:id` | Elimina el post. Solo se permite en DRAFT (o PUBLISHED si el admin lo confirma). Dispara revalidación si estaba publicado |

Todas las mutaciones (`POST`, `PATCH`, `DELETE`) llaman a `AuditLogService.log()`:

| Acción | `action` (AuditLog) | `resourceType` |
|---|---|---|
| Crear | `POST_CREATE` | `"Post"` |
| Publicar | `POST_PUBLISH` | `"Post"` |
| Despublicar | `POST_UNPUBLISH` | `"Post"` |
| Actualizar | `POST_UPDATE` | `"Post"` |
| Eliminar | `POST_DELETE` | `"Post"` |

Patrón `before`/`after` idéntico al de `AdminService`:
```ts
const before = { status: post.status, title: post.title };
await this.prisma.post.update({ ... });
await this.auditLog.log({ action: 'POST_PUBLISH', before, after: { status: 'PUBLISHED' }, ... });
```

### 4.3 DTOs relevantes

**`CreatePostDto`**
```ts
title: string          // @IsString @IsNotEmpty
slug?: string          // @IsOptional — autogenerado si ausente
excerpt?: string       // @IsOptional
body?: string          // @IsOptional — puede estar vacío en borradores
coverUrl?: string      // @IsOptional @IsUrl
tags?: string[]        // @IsOptional @IsArray @IsString({ each: true })
metaTitle?: string     // @IsOptional
metaDescription?: string  // @IsOptional
```

**`UpdatePostDto`** — PartialType(CreatePostDto)

**`ListAdminPostsDto`**
```ts
page?: number          // @IsOptional @IsInt @Min(1) @Default(1)
perPage?: number       // @IsOptional @IsInt @Min(1) @Max(50) @Default(10)
status?: PostStatus    // @IsOptional @IsEnum
```

---

## 5. Encaje con lo existente

### 5.1 Módulo NestJS: `blog.module.ts`

El módulo es autónomo — no se añade lógica al `AdminModule` existente para
no aumentar más su tamaño. Importa `PrismaModule` y `AuditLogModule`.

```
apps/api/src/modules/blog/
  blog.module.ts
  blog.service.ts           // lógica pública + admin
  blog.controller.ts        // GET /blog, GET /blog/:slug
  blog-admin.controller.ts  // /admin/blog (CRUD + publish/unpublish)
  dto/
    create-post.dto.ts
    update-post.dto.ts
    list-admin-posts.dto.ts
    list-public-posts.dto.ts
```

`BlogModule` se importa en `AppModule` junto al resto de módulos de dominio.

### 5.2 Imagen de portada (módulo media)

El admin sube la portada vía el endpoint ya existente:
```
POST /media/upload  →  { id, url }
```
Copia el `url` al campo `coverUrl` del post en la petición `PATCH /admin/blog/:id`.
La imagen queda como `ListingImage` huérfana con `listingId: null` (deuda
conocida compartida con el flujo de anuncios; no se introduce deuda nueva).

### 5.3 Patrón admin (Fase 7)

`BlogAdminController` replica exactamente el patrón de `AdminController`:
```ts
@ApiTags('Admin Blog')
@ApiBearerAuth('access-token')
@Controller('admin/blog')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class BlogAdminController { ... }
```

### 5.4 ISR webhook existente

El webhook en `apps/web/src/app/api/revalidate/route.ts` ya acepta cualquier
`path` — no necesita modificarse. Solo hay que asegurarse de que `REVALIDATE_SECRET`
esté definida también en `apps/api/.env` y `apps/api/.env.example`.

### 5.5 Frontend: estructura de carpetas

```
apps/web/src/app/
  (public)/
    blog/
      page.tsx              // GET /blog → listado ISR
      [slug]/
        page.tsx            // GET /blog/:slug → detalle ISR + OG + JSON-LD
  (admin)/
    admin/
      blog/
        page.tsx            // GET /admin/blog → tabla de posts
        nuevo/
          page.tsx          // formulario crear post (client component)
        [id]/
          editar/
            page.tsx        // formulario editar post + publish/unpublish
```

El layout `(admin)` ya existe y protege la ruta por rol admin via middleware.

`<AdminNav>` se actualiza con un enlace a `/admin/blog`.

---

## 6. Orden de ráfagas RB.2 – RB.4 — CERRADAS, y otras cinco después

> ## ✅ Las tres ráfagas de este diseño se cerraron. El blog necesitó cinco más.
>
> | Ráfaga | Qué cerró |
> |---|---|
> | **RB.2** ✅ | Backend: modelo `Post`, CRUD admin, endpoints públicos |
> | **RB.3** ✅ | Frontend público: `/blog`, `/blog/[slug]`, metadatos, JSON-LD, sitemap |
> | **RB.4** ✅ | Backoffice: `/admin/blog`, `PostForm`, publicar/despublicar |
>
> **Lo que vino después, y que este diseño no preveía:**
>
> | Ráfaga | Qué añadió |
> |---|---|
> | **Editor de Markdown** ✅ | Sustituye el `<textarea>` por `@uiw/react-md-editor` con preview |
> | **BLOG-PAGINAS** ✅ | `PostType`, `/paginas/[slug]`, `/admin/paginas`, JSON-LD `WebPage` |
> | **Bloques — Ráfaga 1** ✅ | El **reemplazo**: `body String` → `blocks Json`, 9 tipos, validación profunda y 9 renderizadores — **sin editor todavía** |
> | **Bloques — Ráfaga 2** ✅ | El editor visual completo (cierra el sistema de contenido) |
> | **Bloques — Ráfaga 3** ✅ | 4 tipos más (3 estáticos + `listings`, el primer dinámico) → **13** |
> | **BLOG-EDITOR** ✅ | El rol `EDITOR`, acotado a blog y páginas |
> | **BLOG-FOOTER-COLUMNAS** ✅ | Saca la navegación del footer de `Post` a entidad propia |
>
> **Una nota de método que merece quedar escrita:** la Ráfaga 1 construyó modelo, validación
> y los 9 renderizadores **sin editor**, y la Ráfaga 2 lo añadió encima. Partirlo así permitió
> que la Ráfaga 3 demostrara lo que el diseño de bloques prometía: **añadir 3 tipos estáticos
> fue pura composición de piezas ya existentes**, sin tocar `CreatePostDto`, `UpdatePostDto`
> ni el `SubItemList` extraído en la Ráfaga 2. El cuarto (`listings`) sí obligó a pensar,
> porque introdujo contenido que no vive en el bloque.

### RB.2 — Backend blog (≈ 2 h)

1. Añadir `PostStatus` enum + modelo `Post` (con `User.posts`) al `schema.prisma`.
2. Generar y aplicar migración `add_blog_post` (`npx prisma migrate dev`).
3. Implementar `blog.module.ts`, `blog.service.ts`, `blog.controller.ts`,
   `blog-admin.controller.ts` con todos los endpoints del §4.
4. DTOs con class-validator.
5. `AuditLog` en todas las mutaciones admin.
6. Revalidación fire-and-forget en publish/unpublish/delete.
7. Añadir `APP_URL` + `REVALIDATE_SECRET` a `apps/api/.env.example`.
8. Registrar `BlogModule` en `AppModule`.

### RB.3 — Frontend público (≈ 2 h)

1. Función cliente `apps/web/src/lib/api/blog.ts`: `getPostList()`, `getPost(slug)`.
2. Página `/blog` — listado con cards (title, excerpt, cover, fecha, autor, tags).
3. Página `/blog/[slug]` — detalle:
   - Server Component con Markdown rendering (`react-markdown` + `remark-gfm` +
     clase `prose` de `@tailwindcss/typography`).
   - `generateMetadata()` con OG (`og:type: article`).
   - JSON-LD `BlogPosting` en `<script type="application/ld+json">`.
   - `notFound()` si slug no existe o no es PUBLISHED.
4. Actualizar `sitemap.ts` → async, incluir `/blog` y slugs de posts publicados.

### RB.4 — Backoffice blog (≈ 2 h)

1. Función cliente `apps/web/src/lib/api/blog-admin.ts`: CRUD + publish/unpublish.
2. `/admin/blog` — tabla paginada con chips de filtro por estado.
3. `/admin/blog/nuevo` — formulario: title, slug (autogenerado + editable), excerpt,
   body (textarea + toggle preview), coverUrl (upload vía `/media/upload`), tags
   (input multi-valor), metaTitle, metaDescription.
4. `/admin/blog/[id]/editar` — mismo formulario precargado + botones
   Publicar / Despublicar / Eliminar con confirmación.
5. Añadir enlace "Blog" a `<AdminNav>`.

---

## 7. Variables de entorno nuevas

| Variable | App | Descripción |
|---|---|---|
| `APP_URL` | `apps/api` | URL base del frontend (p.ej. `http://localhost:3000`). Usada para llamar al webhook de revalidación. |
| `REVALIDATE_SECRET` | `apps/api` | El mismo secret que ya existe en `apps/web`. Ambas apps deben compartirlo. |

Ambas se añaden a `apps/api/.env.example` y a la documentación de despliegue.

---

## 8. Limitaciones conocidas y deuda

> **Estado a 2026-08-04.** La lista original sigue siendo casi toda válida — nada de esto se
> cerró—, con una corrección y dos añadidos.

**Sigue abierto, y ahora con más peso del que tenía:**

- **⚠️ Sin página de tag con URL propia.** La URL de filtro por etiqueta sigue siendo
  `/blog?tag=slug`, no `/blog/etiqueta/slug`. Se anotó aquí como «suficiente para MVP», y
  **la fase 7.2 del Hito 7 la declaró explícitamente dentro de su alcance… y no la cerró.**
  Para un proyecto cuyo canal principal de captación es el SEO, es una página de aterrizaje
  por tema que no existe. Recogida en `docs/pendientes.md` §4.2.
- **Sin búsqueda en el blog**: los posts siguen sin indexarse en Meilisearch. El razonamiento
  —blog editorial, pocas decenas de entradas— sigue siendo válido.
- **Cover image huérfana**: sigue igual, y ahora es un caso concreto de una deuda mayor
  —**no existe `DELETE /media/:id` ni recolección de huérfanas**—, que la fase 7.2 también
  declaró en su alcance y tampoco cerró. `docs/pendientes.md` §4.2.
- **Sin autor múltiple**: un post sigue teniendo exactamente un autor. Con tres roles capaces
  de editar (EDITOR, MODERATOR, ADMIN), el campo `authorId` registra a **quien lo creó**, no
  a quien lo ha tocado después; el rastro de ediciones vive en `AuditLog`.

**Corregido respecto a la lista original:**

- ~~*OG image dinámica: el endpoint `/api/og` existe pero devuelve 501*~~ → El blog **sí**
  genera metadatos OpenGraph completos, con `og:type: 'article'`, `publishedTime`, `authors`
  e imagen. Lo que no hay es una imagen OG **compuesta al vuelo** para las entradas sin
  portada, como sí tienen las fichas de anuncio (`opengraph-image.tsx`).

**Deuda nueva, que llegó con el sistema de bloques:**

- **Una página con bloque `listings` deja de ser autocontenida**, y por tanto su caché pasa
  de 1 h a 3 min (ver §2). No es un fallo —es el precio correcto de un bloque dinámico—, pero
  **hay que saberlo antes de meter un `listings` en una página de mucho tráfico**: multiplica
  por 20 la frecuencia de regeneración de esa URL.
- **El tope de 100 bloques por post no se avisa en la UI**: el backend lo rechaza, pero el
  editor no lo anticipa. Irrelevante en la práctica (100 bloques es muchísimo más de lo que
  cualquier página real necesita), anotado por completitud.
