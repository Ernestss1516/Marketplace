import { Suspense } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle, LayoutGrid, Map, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ListingCard } from '@/components/anuncios/ListingCard';
import { FavoritesGridProvider } from '@/components/anuncios/FavoritesGridContext';
import { CardAttributesProvider } from '@/components/anuncios/CardAttributesContext';
import { FilterPanel } from '@/components/busqueda/FilterPanel';
import MapViewClient from '@/components/busqueda/MapViewClient';
import { search, type SearchResponse } from '@/lib/api/busqueda';
import { getCategories } from '@/lib/api/categorias';
import { buildCardAttributeMap } from '@/lib/card-attributes';

const KNOWN_PARAMS = new Set([
  'q', 'category', 'type', 'condition', 'priceType',
  'minPrice', 'maxPrice', 'province', 'city', 'sort', 'page', 'hitsPerPage',
  'lat', 'lng', 'radius',
  'view', // lista | mapa — view toggle, must NOT be forwarded as an attribute filter
]);

const VALID_SORTS = ['price:asc', 'price:desc', 'publishedAt:desc'] as const;
type Sort = (typeof VALID_SORTS)[number];

type RawParams = Record<string, string | string[] | undefined>;

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined;
}

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}): Promise<Metadata> {
  const raw = await searchParams;
  const q = str(raw.q);
  return {
    title: q ? `"${q}" — Búsqueda` : 'Búsqueda',
    description: q
      ? `Resultados de búsqueda para "${q}" en Marketplace`
      : 'Busca anuncios de segunda mano en Marketplace',
  };
}

export default async function BusquedaPage({
  searchParams,
}: {
  searchParams: Promise<RawParams>;
}) {
  const raw = await searchParams;

  const q = str(raw.q);
  const category = str(raw.category);
  const province = str(raw.province);
  const city = str(raw.city);

  const viewRaw = str(raw.view);
  const isMapView = viewRaw === 'mapa';

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

  // Proximity params
  const latStr = str(raw.lat);
  const lngStr = str(raw.lng);
  const radiusStr = str(raw.radius);
  const lat = latStr && !isNaN(Number(latStr)) ? Number(latStr) : undefined;
  const lng = lngStr && !isNaN(Number(lngStr)) ? Number(lngStr) : undefined;
  const radius = radiusStr && !isNaN(Number(radiusStr)) ? Number(radiusStr) : undefined;
  const proximityActive = lat != null && lng != null && radius != null;

  // Sort: when proximity is active and no explicit sort is in the URL, do NOT send
  // sort to the API so SearchService applies _geoPoint distance ordering instead.
  const sortRaw = str(raw.sort);
  const sortForApi: Sort | undefined = (VALID_SORTS as readonly string[]).includes(sortRaw ?? '')
    ? (sortRaw as Sort)
    : undefined;

  // Map mode fetches up to 200 hits (no pagination) so all markers are shown.
  // List mode uses 24 hits per page with normal pagination.
  const hitsPerFetch = isMapView ? 200 : 24;

  const page = isMapView ? 1 : Math.max(1, parseInt(str(raw.page) ?? '1', 10));

  const minPriceStr = str(raw.minPrice);
  const maxPriceStr = str(raw.maxPrice);
  const minPrice = minPriceStr ? Number(minPriceStr) : undefined;
  const maxPrice = maxPriceStr ? Number(maxPriceStr) : undefined;

  const attributes: Record<string, string> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (!KNOWN_PARAMS.has(key)) {
      const v = str(val);
      if (v) attributes[key] = v;
    }
  }

  const [categoriesResult, searchResult] = await Promise.allSettled([
    getCategories(),
    search({
      ...(q && { q }),
      ...(category && { category }),
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
      hitsPerPage: hitsPerFetch,
      ...attributes,
    }),
  ]);

  const categories = categoriesResult.status === 'fulfilled' ? categoriesResult.value : [];
  const searchError = searchResult.status === 'rejected';
  const data: SearchResponse | null =
    searchResult.status === 'fulfilled' ? searchResult.value : null;

  const totalHits = data?.totalHits ?? 0;
  const hits = data?.hits ?? [];
  const facets = data?.facets;
  const hitsPerPage = data?.hitsPerPage ?? hitsPerFetch;
  const totalPages = isMapView ? 0 : Math.ceil(totalHits / hitsPerPage);

  // Build URL for the view toggle: preserves all filters, resets page, sets/clears view.
  function viewUrl(target: 'lista' | 'mapa'): string {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(raw)) {
      if (key === 'page' || key === 'view') continue;
      const v = str(val);
      if (v) params.set(key, v);
    }
    if (target === 'mapa') params.set('view', 'mapa');
    return `/busqueda?${params.toString()}`;
  }

  function pageUrl(p: number): string {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(raw)) {
      if (key !== 'page') {
        const v = str(val);
        if (v) params.set(key, v);
      }
    }
    params.set('page', String(p));
    return `/busqueda?${params.toString()}`;
  }

  const currentFilters = {
    q,
    category,
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
    category, typeRaw, conditionRaw, priceTypeRaw,
    province, city, minPriceStr, maxPriceStr,
    ...Object.values(attributes),
    proximityActive ? 'geo' : undefined,
  ].filter(Boolean).length;

  // Stable key for MapView: remounts when search params change (except view/page).
  // This ensures the map refreshes when filters are applied.
  const mapKey = Object.entries(raw)
    .filter(([k]) => k !== 'view' && k !== 'page')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? (v[0] ?? '') : (v ?? '')}`)
    .join('&');

  return (
    <div className="container mx-auto px-4 pb-16 pt-8">
      <nav className="mb-6 text-xs text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/" className="hover:underline">Inicio</Link>
        {' / '}
        <span>{q ? `Búsqueda: "${q}"` : 'Búsqueda'}</span>
      </nav>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {/* Sidebar */}
        <aside
          className="w-full lg:sticky lg:top-4 lg:w-64 lg:shrink-0 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"
          aria-label="Filtros"
        >
          <Suspense fallback={null}>
            <FilterPanel
              categories={categories}
              facets={facets}
              currentFilters={currentFilters}
              activeFilterCount={activeFilterCount}
            />
          </Suspense>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1">
          {/* Header: title + count + view toggle */}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <h1 className="text-lg font-semibold">
                {q ? `Resultados para "${q}"` : 'Todos los anuncios'}
              </h1>
              {!searchError && totalHits > 0 && (
                <span className="text-sm text-muted-foreground">
                  {totalHits.toLocaleString('es-ES')}{' '}
                  {totalHits === 1 ? 'anuncio' : 'anuncios'}
                </span>
              )}
            </div>

            {/* Lista / Mapa toggle */}
            <div className="flex overflow-hidden rounded-md border" role="group" aria-label="Cambiar vista">
              <Button
                variant={!isMapView ? 'secondary' : 'ghost'}
                size="sm"
                className="rounded-none border-r"
                asChild
              >
                <Link
                  href={viewUrl('lista')}
                  aria-current={!isMapView ? 'page' : undefined}
                >
                  <LayoutGrid className="mr-1.5 h-4 w-4" />
                  Lista
                </Link>
              </Button>
              <Button
                variant={isMapView ? 'secondary' : 'ghost'}
                size="sm"
                className="rounded-none"
                asChild
              >
                <Link
                  href={viewUrl('mapa')}
                  aria-current={isMapView ? 'page' : undefined}
                >
                  <Map className="mr-1.5 h-4 w-4" />
                  Mapa
                </Link>
              </Button>
            </div>
          </div>

          {/* Error state */}
          {searchError && (
            <div className="flex flex-col items-center py-24 text-center">
              <AlertCircle className="mb-4 h-12 w-12 text-destructive/60" aria-hidden />
              <h2 className="mb-1 text-lg font-semibold">No se pudo realizar la búsqueda</h2>
              <p className="mb-6 text-sm text-muted-foreground">
                El servicio de búsqueda no está disponible. Inténtalo de nuevo en unos momentos.
              </p>
              <Button asChild variant="outline">
                <Link href={q ? `/busqueda?q=${encodeURIComponent(q)}` : '/busqueda'}>
                  Reintentar
                </Link>
              </Button>
            </div>
          )}

          {/* Empty state */}
          {!searchError && totalHits === 0 && (
            <div className="flex flex-col items-center py-24 text-center">
              <Package className="mb-4 h-12 w-12 text-muted-foreground/40" aria-hidden />
              <h2 className="mb-1 text-lg font-semibold">
                {q ? `Sin resultados para "${q}"` : 'Sin resultados'}
              </h2>
              <p className="mb-6 text-sm text-muted-foreground">
                Prueba con otras palabras o elimina algunos filtros.
              </p>
              <Button asChild variant="outline">
                <Link href="/">Volver al inicio</Link>
              </Button>
            </div>
          )}

          {/* Map view */}
          {!searchError && hits.length > 0 && isMapView && (
            <MapViewClient key={mapKey} hits={hits} />
          )}

          {/* List view: grid + pagination */}
          {!searchError && hits.length > 0 && !isMapView && (
            <>
              <CardAttributesProvider cardAttributeMap={buildCardAttributeMap(categories)}>
                <FavoritesGridProvider listingIds={hits.map((l) => l.id)}>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                    {hits.map((listing) => (
                      <ListingCard key={listing.id} listing={listing} />
                    ))}
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
          )}
        </main>
      </div>
    </div>
  );
}
