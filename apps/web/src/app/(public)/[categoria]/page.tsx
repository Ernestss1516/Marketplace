import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertCircle, Package } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ListingCard } from '@/components/anuncios/ListingCard';
import { ListingCardWide } from '@/components/anuncios/ListingCardWide';
import { SponsoredCard, isSponsoredAdHit } from '@/components/anuncios/SponsoredCard';
import { FavoritesGridProvider } from '@/components/anuncios/FavoritesGridContext';
import { CardAttributesProvider, WideCardAttributesProvider } from '@/components/anuncios/CardAttributesContext';
import { FilterPanel } from '@/components/busqueda/FilterPanel';
import { FeaturedBlock } from '@/components/busqueda/FeaturedBlock';
import { ViewSwitcher } from '@/components/busqueda/ViewSwitcher';
import MapViewClient from '@/components/busqueda/MapViewClient';
import { getCategoryBySlug, getCategories } from '@/lib/api/categorias';
import { getListingsByCategory } from '@/lib/api/anuncios';
import { search, type SearchHit } from '@/lib/api/busqueda';
import { ApiError } from '@/lib/api/client';
import { buildCardAttributeMap, buildWideCardAttributeMap, buildFullAttributeMap } from '@/lib/card-attributes';
import { resolveCurrentView, VIEW_PARAM } from '@/lib/view-mode';
import type { ListingSummary, ListingViewMode } from '@/types';

type Params = { categoria: string };
type RawParams = Record<string, string | string[] | undefined>;

const VALID_SORTS = ['publishedAt:desc', 'price:asc', 'price:desc'] as const;
type Sort = (typeof VALID_SORTS)[number];

// Params handled explicitly; everything else is forwarded as a variable attribute filter.
const KNOWN_PARAMS = new Set([
  'page', 'sort', 'type', 'condition', 'priceType',
  'minPrice', 'maxPrice', 'province', 'city',
  'lat', 'lng', 'radius', 'view',
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

  // Load category metadata (h1, breadcrumb, card attribute defs, allowedViews). 404 if not found.
  let category: Awaited<ReturnType<typeof getCategoryBySlug>>;
  try {
    category = await getCategoryBySlug(categoria);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) notFound();
    throw err;
  }

  // RÁFAGA 2 — vistas: la categoría define el menú (category.allowedViews, ya
  // resuelto con herencia por el backend), el usuario elige del menú.
  const viewRaw = str(raw.view);
  const currentView = resolveCurrentView(viewRaw, category.allowedViews, category.defaultView);
  const isMapView = currentView === 'MAPA';

  const page = isMapView ? 1 : Math.max(1, Number(str(raw.page) ?? 1));
  // Igual que /busqueda: el mapa trae hasta 200 hits sin paginar para pintar todos los marcadores.
  const hitsPerFetch = isMapView ? 200 : 24;

  // ── Fetch listings ──────────────────────────────────────────────────────────
  // Primary: Meilisearch (facets + attribute filters + proximity).
  // Fallback: Postgres (no facets, basic sort only) when Meili is unavailable.
  //
  // BUG encontrado y arreglado: esta página construía el mapa de atributos de
  // card a partir del schema de la ÚNICA categoría de la URL
  // (`buildCardAttributeMapFromSchema(categoria, category.attributeSchema)`,
  // keyeado solo por `categoria`). Al navegar una categoría PADRE (p. ej.
  // /vehiculos, que mezcla anuncios de sus hijas coches/motos/furgonetas vía
  // categoryPath de Meilisearch), cada listing trae su PROPIO categorySlug de
  // hoja ("coches", "motos"...) — que no existía como clave en ese mapa de una
  // sola entrada, así que CardAttrsDisplay no encontraba nada y no mostraba
  // atributos. /busqueda no tenía este problema porque ya construye el mapa a
  // partir del ÁRBOL COMPLETO (`getCategories()` + `buildCardAttributeMap`),
  // que trae una entrada por cada categoría (padres Y hojas). Unificado aquí:
  // misma fuente de datos que /busqueda, no dos caminos que puedan divergir.
  let hits: SearchHit[] = [];
  let featured: ListingSummary[] = [];
  let total = 0;
  let hitsPerPage = 24;
  let facets: Record<string, Record<string, number>> | undefined;
  let fallbackMode = false;

  // Fetched independently of the search-or-fallback branch below (own promise,
  // in flight in parallel) so it's available either way — including during a
  // Meilisearch outage, when the page still renders the Postgres-fallback grid.
  const categoriesPromise = getCategories().catch(() => []);

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
      hitsPerPage: hitsPerFetch,
      ...attributes,
    });
    hits = result.hits;
    featured = result.featured ?? [];
    total = result.totalHits;
    hitsPerPage = result.hitsPerPage;
    facets = result.facets;
  } catch {
    // Meilisearch unavailable — degrade to Postgres (no facets, no attribute filters,
    // no mapa/ampliada: esas vistas dependen de datos que solo trae el documento de
    // Meilisearch — se fuerza LISTA mientras dure el fallback, ver render más abajo).
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

  const categories = await categoriesPromise;

  // BUG A (auditoría de filtros) — hijas de ESTA categoría, si tiene. Una hoja (no
  // aparece como nodo de nivel superior en el árbol) resuelve a [] sin más: no hay en
  // qué acotar. Alimenta el selector "Subcategoría" del FilterPanel.
  const subcategories = (categories.find((c) => c.slug === categoria)?.children ?? [])
    .map((child) => ({ slug: child.slug, name: child.name }));

  const totalPages = isMapView ? 0 : Math.ceil(total / hitsPerPage) || 0;
  // H6.6 — igual que en /busqueda: el patrocinado (si lo hay) va intercalado en
  // `hits`; favoritos solo conoce anuncios reales.
  const listingHits = hits.filter((h): h is ListingSummary => !isSponsoredAdHit(h));

  function viewUrl(target: ListingViewMode): string {
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(raw)) {
      if (key === 'page' || key === 'view') continue;
      const v = str(val);
      if (v) params.set(key, v);
    }
    if (target !== category.defaultView) params.set('view', VIEW_PARAM[target]);
    return `/${categoria}?${params.toString()}`;
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

  // Stable key for MapView: remounts when search params change (except view/page) — mismo criterio que /busqueda.
  const mapKey = Object.entries(raw)
    .filter(([k]) => k !== 'view' && k !== 'page')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? (v[0] ?? '') : (v ?? '')}`)
    .join('&');

  // Fallback mode fuerza LISTA (ver comentario más arriba) — el switcher no tiene sentido ahí.
  const effectiveView = fallbackMode ? 'LISTA' : currentView;

  return (
    <div className="container mx-auto px-4 pb-16 pt-8">
      <nav className="mb-4 text-xs text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/" className="hover:underline">Inicio</Link>
        {' / '}
        <span>{category.name}</span>
      </nav>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">{category.name}</h1>
          {total > 0 && (
            <p className="text-sm text-muted-foreground">
              {total} {total === 1 ? 'anuncio' : 'anuncios'}
            </p>
          )}
        </div>
        {!fallbackMode && (
          <ViewSwitcher allowedViews={category.allowedViews} currentView={currentView} buildUrl={viewUrl} />
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
                subcategories={subcategories}
              />
            </Suspense>
          </aside>
        )}

        <main className="min-w-0 flex-1">
          {/* Basado en `total` (anuncios reales), no en `hits.length`: un patrocinado
              inyectado no debe disfrazar una categoría sin anuncios como "con resultados". */}
          {total > 0 ? (
            <>
              {!fallbackMode && effectiveView === 'MAPA' ? (
                <MapViewClient
                  key={mapKey}
                  hits={listingHits}
                  totalHits={total}
                  listUrl={viewUrl('LISTA')}
                  attributeMap={buildFullAttributeMap(categories)}
                />
              ) : (
                <CardAttributesProvider cardAttributeMap={buildCardAttributeMap(categories)}>
                  <WideCardAttributesProvider cardAttributeMap={buildWideCardAttributeMap(categories)}>
                    <FavoritesGridProvider
                      listingIds={[...new Set([...featured.map((l) => l.id), ...listingHits.map((l) => l.id)])]}
                    >
                      <FeaturedBlock listings={featured} />
                      {effectiveView === 'AMPLIADA' ? (
                        <div className="flex flex-col gap-3">
                          {hits.map((hit, i) =>
                            isSponsoredAdHit(hit) ? (
                              <SponsoredCard key={`sponsored-${hit.id}`} ad={hit} />
                            ) : (
                              <ListingCardWide key={hit.id} listing={hit} priority={i < 4} />
                            ),
                          )}
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                          {hits.map((hit, i) =>
                            isSponsoredAdHit(hit) ? (
                              <SponsoredCard key={`sponsored-${hit.id}`} ad={hit} />
                            ) : (
                              <ListingCard key={hit.id} listing={hit} priority={i < 4} />
                            ),
                          )}
                        </div>
                      )}
                    </FavoritesGridProvider>
                  </WideCardAttributesProvider>
                </CardAttributesProvider>
              )}

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
