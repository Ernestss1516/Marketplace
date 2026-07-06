import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { getPost } from '@/lib/api/blog';
import { ApiError } from '@/lib/api/client';
import { SITE_NAME, SITE_URL } from '@/config';
import { isSafeSrc } from '@/lib/image-domains';
import { MarkdownBody } from '@/components/blog/MarkdownBody';

export const revalidate = 3600;

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const post = await getPost(slug);
    const title = post.metaTitle ?? post.title;
    const description = post.metaDescription ?? post.excerpt ?? undefined;
    return {
      title: `${title} | ${SITE_NAME}`,
      description,
      openGraph: {
        title,
        description,
        type: 'article',
        publishedTime: post.publishedAt,
        authors: [post.author.name],
        images: post.coverUrl ? [{ url: post.coverUrl }] : [],
      },
    };
  } catch {
    return { title: 'Artículo del blog' };
  }
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;

  let post;
  try {
    post = await getPost(slug);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) notFound();
    throw err;
  }

  const dateStr = new Date(post.publishedAt).toLocaleDateString('es-ES', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt ?? undefined,
    image: post.coverUrl ?? undefined,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    author: { '@type': 'Person', name: post.author.name },
    url: `${SITE_URL}/blog/${post.slug}`,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="container mx-auto px-4 py-10">
        <nav className="mb-6 text-xs text-muted-foreground" aria-label="Breadcrumb">
          <Link href="/" className="hover:underline">Inicio</Link>
          {' / '}
          <Link href="/blog" className="hover:underline">Blog</Link>
          {' / '}
          <span className="line-clamp-1">{post.title}</span>
        </nav>

        <article className="mx-auto max-w-3xl">
          {/* Tags */}
          {post.tags.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/blog?tag=${encodeURIComponent(tag)}`}
                  className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium hover:bg-primary/20"
                >
                  {tag}
                </Link>
              ))}
            </div>
          )}

          {/* Title */}
          <h1 className="mb-4 text-3xl font-bold leading-tight md:text-4xl">
            {post.title}
          </h1>

          {/* Meta: author + date */}
          <div className="mb-6 flex items-center gap-3 text-sm text-muted-foreground">
            <span>{post.author.name}</span>
            <span aria-hidden>·</span>
            <time dateTime={post.publishedAt}>{dateStr}</time>
          </div>

          {/* Cover image — only rendered when URL is from our storage */}
          {post.coverUrl && isSafeSrc(post.coverUrl) && (
            <div className="relative mb-8 h-64 w-full overflow-hidden rounded-xl bg-muted md:h-80">
              <Image
                src={post.coverUrl}
                alt={post.title}
                fill
                className="object-cover"
                priority
                sizes="(max-width: 768px) 100vw, 768px"
              />
            </div>
          )}

          {/* Body: Markdown rendered server-side via el mismo <MarkdownBody>
              que usan /paginas/[slug] y el preview de PostForm — ver el
              comentario de seguridad en ese componente. */}
          <MarkdownBody body={post.body} />
        </article>

        {/* Back link */}
        <div className="mx-auto mt-12 max-w-3xl">
          <Link
            href="/blog"
            className="text-sm text-muted-foreground hover:underline"
          >
            ← Volver al blog
          </Link>
        </div>
      </div>
    </>
  );
}
