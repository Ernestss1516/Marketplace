import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getPage } from '@/lib/api/blog';
import { ApiError } from '@/lib/api/client';
import { SITE_NAME, SITE_URL } from '@/config';
import { BlockRenderer } from '@/components/blocks/BlockRenderer';
import { resolveListingsBlocksData } from '@/lib/blocks/resolve-listings';

export const revalidate = 3600;

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const page = await getPage(slug);
    const title = page.metaTitle ?? page.title;
    const description = page.metaDescription ?? page.excerpt ?? undefined;
    return {
      title: `${title} | ${SITE_NAME}`,
      description,
      openGraph: {
        title,
        description,
        // 'website', no 'article' — una página informativa no es una entrada de
        // blog. Sin publishedTime/authors: no es contenido con fecha ni autor.
        type: 'website',
        images: page.coverUrl ? [{ url: page.coverUrl }] : [],
      },
    };
  } catch {
    return { title: SITE_NAME };
  }
}

export default async function InfoPagePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;

  let page;
  try {
    page = await getPage(slug);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) notFound();
    throw err;
  }

  // Ver ListingsBlockRenderer + lib/blocks/resolve-listings.ts.
  const { data: listingsData, categories: blockCategories } =
    await resolveListingsBlocksData(page.blocks);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: page.title,
    description: page.excerpt ?? undefined,
    url: `${SITE_URL}/paginas/${page.slug}`,
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
          <span className="line-clamp-1">{page.title}</span>
        </nav>

        {/* Presentación de página, no de artículo: solo título + contenido —
            sin fecha/autor/tags/anterior-siguiente. */}
        <article className="mx-auto max-w-3xl">
          <h1 className="mb-8 text-3xl font-bold leading-tight md:text-4xl">
            {page.title}
          </h1>

          <BlockRenderer
            blocks={page.blocks}
            listingsData={listingsData}
            categories={blockCategories}
          />
        </article>
      </div>
    </>
  );
}
