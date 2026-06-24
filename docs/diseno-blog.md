# Diseño del módulo Blog — Fase B, Hito 2

> Fecha: 2026-06-24 · Estado: **borrador pendiente de aprobación**
> Ráfaga de diseño: RB.1 · Implementación: RB.2 – RB.4

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

### 1.1 Enum y modelo `Post`

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

## 2. Formato del cuerpo: Markdown

### 2.1 Almacenamiento

`Post.body` almacena **Markdown raw** (texto plano, GFM — GitHub Flavored Markdown).
El backend lo devuelve tal cual en la respuesta JSON; no hay procesado de HTML
en el servidor.

### 2.2 Renderizado en el frontend

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

### 2.3 Editor en el backoffice

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

## 6. Orden de ráfagas RB.2 – RB.4

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

- **Sin paginación por tag en la URL SEO-friendly**: la URL de filtro por etiqueta
  es `/blog?tag=slug`, no `/blog/etiqueta/slug`. Es suficiente para MVP; si se
  quiere una página de tag dedicada con SEO propio, requiere una ráfaga adicional.
- **Sin búsqueda en el blog**: los posts no se indexan en Meilisearch. Para el MVP,
  el blog es editorial (pocas decenas de posts) y no necesita búsqueda de texto
  completo. Fácil de añadir después.
- **Cover image huérfana**: el upload de portada genera un `ListingImage` con
  `listingId: null` (deuda preexistente compartida con el flujo de anuncios).
- **OG image dinámica**: el endpoint `/api/og` existe pero devuelve 501. Para las
  fichas de blog podría generarse una imagen OG automática; queda fuera del alcance
  de esta fase.
- **Sin autor múltiple**: un post tiene exactamente un autor (el admin que lo crea).
  Co-autoría no está modelada.
