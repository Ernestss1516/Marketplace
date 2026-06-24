import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getPostList } from '@/lib/api/blog';
import type { PostSummary } from '@/types';
import { SITE_NAME } from '@/config';

// Must mirror next.config.ts remotePatterns so we never pass an unconfigured
// hostname to next/image (which would throw and crash the page).
function isSafeSrc(url: string): boolean {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol === 'http:' && hostname === 'localhost') return true;
    if (protocol === 'https:' && hostname.endsWith('.r2.cloudflarestorage.com')) return true;
    return false;
  } catch {
    return false;
  }
}

export const revalidate = 3600;

export const metadata: Metadata = {
  title: `Blog | ${SITE_NAME}`,
  description: 'Consejos, novedades y artículos sobre compraventa de segunda mano.',
  openGraph: {
    title: `Blog | ${SITE_NAME}`,
    description: 'Consejos, novedades y artículos sobre compraventa de segunda mano.',
  },
};

type SearchParams = { page?: string; tag?: string };

export default async function BlogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const { page: pageStr, tag } = await searchParams;
  const page = Math.max(1, Number(pageStr ?? 1));

  const { items: posts, total, perPage } = await getPostList({
    page,
    perPage: 9,
    tag,
  }).catch(() => ({ items: [], total: 0, page: 1, perPage: 9 }));

  const totalPages = Math.ceil(total / perPage);

  return (
    <div className="container mx-auto px-4 py-10">
      <header className="mb-8">
        <nav className="mb-3 text-xs text-muted-foreground" aria-label="Breadcrumb">
          <Link href="/" className="hover:underline">Inicio</Link>
          {' / '}
          <span>Blog</span>
        </nav>
        <h1 className="text-3xl font-bold">Blog</h1>
        <p className="mt-2 text-muted-foreground">
          Consejos, novedades y artículos sobre segunda mano.
        </p>
      </header>

      {tag && (
        <div className="mb-6 flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Etiqueta:</span>
          <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium">
            {tag}
          </span>
          <Link href="/blog" className="text-sm text-muted-foreground hover:underline">
            Quitar filtro ×
          </Link>
        </div>
      )}

      {posts.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">
          {tag
            ? `No hay artículos con la etiqueta "${tag}".`
            : 'Aún no hay artículos publicados.'}
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <nav
          className="mt-10 flex items-center justify-center gap-3"
          aria-label="Paginación del blog"
        >
          {page > 1 && (
            <Link
              href={buildPageUrl(page - 1, tag)}
              className="rounded border px-4 py-1.5 text-sm hover:bg-muted"
            >
              ← Anterior
            </Link>
          )}
          <span className="text-sm text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={buildPageUrl(page + 1, tag)}
              className="rounded border px-4 py-1.5 text-sm hover:bg-muted"
            >
              Siguiente →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}

function buildPageUrl(page: number, tag?: string): string {
  const params = new URLSearchParams();
  if (page > 1) params.set('page', String(page));
  if (tag) params.set('tag', tag);
  const qs = params.toString();
  return `/blog${qs ? `?${qs}` : ''}`;
}

function PostCard({ post }: { post: PostSummary }) {
  const dateStr = new Date(post.publishedAt).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <article className="group flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md">
      {post.coverUrl && isSafeSrc(post.coverUrl) ? (
        <div className="relative h-48 overflow-hidden bg-muted">
          <Image
            src={post.coverUrl}
            alt={post.title}
            fill
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
        </div>
      ) : (
        <div className="h-48 bg-muted" />
      )}

      <div className="flex flex-1 flex-col gap-3 p-5">
        {post.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {post.tags.map((tag) => (
              <Link
                key={tag}
                href={`/blog?tag=${encodeURIComponent(tag)}`}
                className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium hover:bg-primary/20"
              >
                {tag}
              </Link>
            ))}
          </div>
        )}

        <h2 className="line-clamp-2 text-lg font-semibold leading-snug">
          <Link href={`/blog/${post.slug}`} className="hover:underline">
            {post.title}
          </Link>
        </h2>

        {post.excerpt && (
          <p className="line-clamp-3 flex-1 text-sm text-muted-foreground">
            {post.excerpt}
          </p>
        )}

        <footer className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
          <span>{post.author.name}</span>
          <time dateTime={post.publishedAt}>{dateStr}</time>
        </footer>
      </div>
    </article>
  );
}
