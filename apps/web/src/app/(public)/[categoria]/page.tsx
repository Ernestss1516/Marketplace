import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ListingCard } from '@/components/anuncios/ListingCard';
import { FavoritesGridProvider } from '@/components/anuncios/FavoritesGridContext';
import { CardAttributesProvider } from '@/components/anuncios/CardAttributesContext';
import { SortSelect } from '@/components/categorias/SortSelect';
import { getCategoryBySlug } from '@/lib/api/categorias';
import { getListingsByCategory } from '@/lib/api/anuncios';
import { ApiError } from '@/lib/api/client';
import { buildCardAttributeMapFromSchema } from '@/lib/card-attributes';

type Params = { categoria: string };
type SearchParams = { page?: string; sort?: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { categoria } = await params;
  try {
    const cat = await getCategoryBySlug(categoria);
    return { title: cat.name };
  } catch {
    return { title: 'Categoría' };
  }
}

export default async function CategoriaPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { categoria } = await params;
  const { page: pageStr, sort = 'publishedAt:desc' } = await searchParams;
  const page = Math.max(1, Number(pageStr ?? 1));

  let category;
  try {
    category = await getCategoryBySlug(categoria);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) notFound();
    throw err;
  }

  const { items, total, perPage } = await getListingsByCategory(categoria, {
    page,
    sort,
  }).catch(() => ({ items: [], total: 0, page, perPage: 24 }));

  const totalPages = Math.ceil(total / perPage) || 0;

  return (
    <div className="container mx-auto px-4 pb-16 pt-8">
      {/* Encabezado */}
      <nav className="mb-2 text-xs text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/" className="hover:underline">
          Inicio
        </Link>
        {' / '}
        <span>{category.name}</span>
      </nav>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{category.name}</h1>
          {total > 0 && (
            <p className="text-sm text-muted-foreground">
              {total} {total === 1 ? 'anuncio' : 'anuncios'}
            </p>
          )}
        </div>
        <Suspense fallback={null}>
          <SortSelect value={sort} />
        </Suspense>
      </div>

      {items.length > 0 ? (
        <>
          <CardAttributesProvider cardAttributeMap={buildCardAttributeMapFromSchema(categoria, category.attributeSchema ?? [])}>
            <FavoritesGridProvider listingIds={items.map((l) => l.id)}>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {items.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </div>
            </FavoritesGridProvider>
          </CardAttributesProvider>

          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-3">
              {page > 1 && (
                <Button variant="outline" asChild>
                  <Link href={`/${categoria}?page=${page - 1}&sort=${sort}`}>
                    Anterior
                  </Link>
                </Button>
              )}
              <span className="text-sm text-muted-foreground">
                Página {page} de {totalPages}
              </span>
              {page < totalPages && (
                <Button variant="outline" asChild>
                  <Link href={`/${categoria}?page=${page + 1}&sort=${sort}`}>
                    Siguiente
                  </Link>
                </Button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center py-24 text-center">
          <Package className="mb-4 h-12 w-12 text-muted-foreground/40" aria-hidden />
          <h2 className="mb-1 text-lg font-semibold">
            No hay anuncios en {category.name}
          </h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Sé el primero en publicar algo aquí.
          </p>
          <Button asChild>
            <Link href="/publicar">Publicar anuncio</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
