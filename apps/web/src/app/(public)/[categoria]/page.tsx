import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ListingCard } from '@/components/anuncios/ListingCard';
import { SponsoredCard, isSponsoredAdHit } from '@/components/anuncios/SponsoredCard';
import { FavoritesGridProvider } from '@/components/anuncios/FavoritesGridContext';
import { CardAttributesProvider } from '@/components/anuncios/CardAttributesContext';
import { FilterPanel } from '@/components/busqueda/FilterPanel';
import { FeaturedBlock } from '@/components/busqueda/FeaturedBlock';
import { getCategoryBySlug } from '@/lib/api/categorias';
import { getListingsByCategory } from '@/lib/api/anuncios';
import { search, type SearchHit } from '@/lib/api/busqueda';
import { ApiError } from '@/lib/api/client';
import { buildCardAttributeMapFromSchema } from '@/lib/card-attributes';
import type { ListingSummary } from '@/types';

type Params = { categoria: string };
type RawParams = Record<string, string | string[] | undefined>;

const VALID_SORTS = ['publishedAt:desc', 'price:asc', 'price:desc'] as const;
type Sort = (typeof VALID_SORTS)[number];

// Params handled explicitly; everything else is forwarded as a variable attribute filter.
const KNOWN_PARAMS = new Set([
  'page', 'sort', 'type', 'condition', 'priceType',
  'minPrice', 'maxPrice', 'province', 'city',
  'lat', 'lng', 'radius',
]);

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { categoria } = await params;
  try {
    const cat = await getCategoryBySlug(categoria);
    return {
      title: cat.name,
      description: `Anuncios de segunda mano de ${cat.name}. Compra y vende en nuestro marketplace.`,
    };
  } catch {
    return { title: 'Categoría' };
  }
}

export default async function CategoriaPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<RawParams>;
}) {
  const { categoria } = await params;
  const raw = await searchParams;

  const page = Math.max(1, Number(str(raw.page) ?? 1));
  const sortRaw = str(raw.sort);
  const sort: Sort = (VALID_SORTS as readonly string[]).includes(sortRaw ?? '')
    ? (sortRaw as Sort)
    : 'publishedAt:desc';

  const typeRaw = str(raw.type);
  const type = typeRaw === 'PRODUCT' || typeRaw === 'SERVICE' ? typeRaw : undefined;

  const conditionRaw = str(raw.condition);
  const condition =
    conditionRaw === 'NEW' || conditionRaw === 'LIKE_NEW' || conditionRaw === 'GOOD' ||
    conditionRaw === 'FAIR' || conditionRaw === 'FOR_PARTS'
      ? conditionRaw
      : undefined;

  const priceTypeRaw = str(raw.priceType);
  const priceType =
    priceTypeRaw === 'FIXED' || priceTypeRaw === 'FREE' || priceTypeRaw === 'NEGOTIABLE'
      ? priceTypeRaw
      : undefined;

  const minPriceStr = str(raw.minPrice);
  const maxPriceStr = str(raw.maxPrice);
  const minPrice = minPriceStr ? Number(minPriceStr) : undefined;
  const maxPrice = maxPriceStr ? Number(maxPriceStr) : undefined;
  const province = str(raw.province);
  const city = str(raw.city);

  const latStr = str(raw.lat);
  const lngStr = str(raw.lng);
  const radiusStr = str(raw.radius);
  const lat = latStr && !isNaN(Number(latStr)) ? Number(latStr) : undefined;
  const lng = lngStr && !isNaN(Number(lngStr)) ? Number(lngStr) : undefined;
  const radius = radiusStr && !isNaN(Number(radiusStr)) ? Number(radiusStr) : undefined;
  const proximityActive = lat != null && lng != null && radius != null;

  // When proximity is active and no explicit sort, omit sort so SearchService uses _geoPoint distance.
  const sortForApi: Sort | undefined = proximityActive && !sortRaw ? undefined : sort;

  // Forward any extra URL param as a variable attribute filter (fuel, rooms, gender, etc.)
  const attributes: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (!KNOWN_PARAMS.has(key)) {
      const v = str(val);
      if (v) attributes[key] = v;
    }
  }

  // Load category metadata (h1, breadcrumb, card attribute defs). 404 if not found.
  let category: Awaited<ReturnType<typeof getCategoryBySlug>>;
  try {
    category = await getCategoryBySlug(categoria);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) notFound();
    throw err;
  }

  // ── Fetch listings ──────────────────────────────────────────────────────────
  // Primary: Meilisearch (facets + attribute filters + proximity).
  // Fallback: Postgres (no facets, basic sort only) when Meili is unavailable.
  let hits: SearchHit[] = [];
  let featured: ListingSummary[] = [];
  let total = 0;
  let hitsPerPage = 24;
  let facets: Record<string, Record<string, number>> | undefined;
  let fallbackMode = false;

  try {
    const result = await search({
      category: categoria,
      ...(type && { type }),
      ...(condition && { condition }),
      ...(priceType && { priceType }),
      ...(minPrice !== undefined && !isNaN(minPrice) && { minPrice }),
      ...(maxPrice !== undefined && !isNaN(maxPrice) && { maxPrice }),
      ...(province && { province }),
      ...(city && { city }),
      ...(sortForApi && { sort: sortForApi }),
      ...(proximityActive && { lat, lng, radius }),
      page,
      hitsPerPage: 24,
      ...attributes,
    });
    hits = result.hits;
    featured = result.featured ?? [];
    total = result.totalHits;
    hitsPerPage = result.hitsPerPage;
    facets = result.facets;
  } catch {
    // Meilisearch unavailable — degrade to Postgres (no facets, no attribute filters).
    fallbackMode = true;
    try {
      const fallback = await getListingsByCategory(categoria, { page, sort });
      hits = fallback.items;
      total = fallback.total;
      hitsPerPage = fallback.perPage;
    } catch {
      // Both sources failed — render empty state below.
    }
  }

  const totalPages = Math.ceil(total / hitsPerPage) || 0;
  // H6.6 — igual que en /busqueda: el patrocinado (si lo hay) va intercalado en
  // `hits`; favoritos solo conoce anuncios reales.
  const listingHits = hits.filter((h): h is ListingSummary => !isSponsoredAdHit(h));

  function pageUrl(p: number): string {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(raw)) {
      if (key !== 'page') {
        const v = str(val);
        if (v) params.set(key, v);
      }
    }
    params.set('page', String(p));
    return `/${categoria}?${params.toString()}`;
  }

  const currentFilters = {
    type: typeRaw,
    condition: conditionRaw,
    priceType: priceTypeRaw,
    minPrice: minPriceStr,
    maxPrice: maxPriceStr,
    province,
    city,
    sort: sortRaw,
    lat: latStr,
    lng: lngStr,
    radius: radiusStr,
    attributes,
  };

  const activeFilterCount = [
    typeRaw, conditionRaw, priceTypeRaw, province, city, minPriceStr, maxPriceStr,
    ...Object.values(attributes),
    proximityActive ? 'geo' : undefined,
  ].filter(Boolean).length;

  return (
    <div className="container mx-auto px-4 pb-16 pt-8">
      <nav className="mb-4 text-xs text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/" className="hover:underline">Inicio</Link>
        {' / '}
        <span>{category.name}</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl font-bold">{category.name}</h1>
        {total > 0 && (
          <p className="text-sm text-muted-foreground">
            {total} {total === 1 ? 'anuncio' : 'anuncios'}
          </p>
        )}
      </div>

      {/* Fallback banner — shown when Meilisearch is unavailable */}
      {fallbackMode && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          Los filtros avanzados no están disponibles ahora mismo. Mostrando resultados básicos.
        </div>
      )}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Filter sidebar — hidden in fallback mode (no facets available) */}
        {!fallbackMode && (
          <aside
            className="w-full lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:w-64 lg:shrink-0 lg:overflow-y-auto"
            aria-label="Filtros"
          >
            <Suspense fallback={null}>
              {/* categories={[]} hides the category picker: the category is already
                  fixed in the URL path and must not be re-selectable here. */}
              <FilterPanel
                categories={[]}
                facets={facets}
                currentFilters={currentFilters}
                activeFilterCount={activeFilterCount}
                allowedListingType={category.allowedListingType}
              />
            </Suspense>
          </aside>
        )}

        <main className="min-w-0 flex-1">
          {/* Basado en `total` (anuncios reales), no en `hits.length`: un patrocinado
              inyectado no debe disfrazar una categoría sin anuncios como "con resultados". */}
          {total > 0 ? (
            <>
              <CardAttributesProvider
                cardAttributeMap={buildCardAttributeMapFromSchema(
                  categoria,
                  category.attributeSchema ?? [],
                )}
              >
                <FavoritesGridProvider
                  listingIds={[...new Set([...featured.map((l) => l.id), ...listingHits.map((l) => l.id)])]}
                >
                  <FeaturedBlock listings={featured} />
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {hits.map((hit) =>
                      isSponsoredAdHit(hit) ? (
                        <SponsoredCard key={`sponsored-${hit.id}`} ad={hit} />
                      ) : (
                        <ListingCard key={hit.id} listing={hit} />
                      ),
                    )}
                  </div>
                </FavoritesGridProvider>
              </CardAttributesProvider>

              {totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-3">
                  {page > 1 ? (
                    <Button variant="outline" asChild>
                      <Link href={pageUrl(page - 1)}>Anterior</Link>
                    </Button>
                  ) : (
                    <Button variant="outline" disabled>Anterior</Button>
                  )}
                  <span className="text-sm text-muted-foreground">
                    Página {page} de {totalPages}
                  </span>
                  {page < totalPages ? (
                    <Button variant="outline" asChild>
                      <Link href={pageUrl(page + 1)}>Siguiente</Link>
                    </Button>
                  ) : (
                    <Button variant="outline" disabled>Siguiente</Button>
                  )}
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col items-center py-24 text-center">
              <Package className="mb-4 h-12 w-12 text-muted-foreground/40" aria-hidden />
              <h2 className="mb-1 text-lg font-semibold">
                {activeFilterCount > 0
                  ? 'Sin resultados con estos filtros'
                  : `No hay anuncios en ${category.name}`}
              </h2>
              <p className="mb-6 text-sm text-muted-foreground">
                {activeFilterCount > 0
                  ? 'Prueba a eliminar algunos filtros.'
                  : 'Sé el primero en publicar algo aquí.'}
              </p>
              <Button asChild>
                <Link href={activeFilterCount > 0 ? `/${categoria}` : '/publicar'}>
                  {activeFilterCount > 0 ? 'Ver todos los anuncios' : 'Publicar anuncio'}
                </Link>
              </Button>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
