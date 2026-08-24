import { Suspense } from 'react';
import { notFound, permanentRedirect } from 'next/navigation';
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
import { CrearAlertaButton } from '@/components/busqueda/CrearAlertaButton';
import MapViewClient from '@/components/busqueda/MapViewClient';
import { getCategoryBySlug, getCategories } from '@/lib/api/categorias';
import { getListingsByCategory } from '@/lib/api/anuncios';
import { search, type SearchHit } from '@/lib/api/busqueda';
import { ApiError } from '@/lib/api/client';
import { buildCardAttributeMap, buildWideCardAttributeMap, buildFullAttributeMap } from '@/lib/card-attributes';
import { categoryPath, categoryPathWithQuery } from '@/lib/category-url';
import { filterableFieldsForCategory } from '@/lib/filterable-fields';
import { availableTagsForCategory } from '@/lib/available-tags';
import { breadcrumbJsonLd } from '@/lib/breadcrumb-json-ld';
import { resolveCurrentView, VIEW_PARAM } from '@/lib/view-mode';
import { SITE_URL } from '@/config';
import type { AlertCriteria, CategoryWithSchema, ListingSummary, ListingViewMode } from '@/types';

export type RawParams = Record<string, string | string[] | undefined>;

const VALID_SORTS = ['publishedAt:desc', 'price:asc', 'price:desc'] as const;
type Sort = (typeof VALID_SORTS)[number];

// Params handled explicitly; everything else is forwarded as a variable attribute filter.
//
// A2 — `q` es NUEVO aquí, y su ausencia era un bug real aunque la búsqueda "funcionara":
// al no estar en esta lista, `q` caía en el bag de atributos, se hacía spread en la
// llamada a search() y acababa llegando al backend como `q` DE CASUALIDAD. Funcionaba,
// pero la página no sabía que había una búsqueda de texto: no salía en el <h1> ni en el
// title, contaba como "filtro de atributo" y —lo peor— "Limpiar filtros" la BORRABA
// (clearAll conserva currentFilters.q, que esta página nunca rellenaba).
const KNOWN_PARAMS = new Set([
  'q',
  'page', 'sort', 'type', 'condition', 'priceType',
  'minPrice', 'maxPrice', 'province', 'city',
  'lat', 'lng', 'radius', 'view',
  // V-4 — «solo con vídeo»: global, no un atributo de esta categoría.
  'conVideo',
]);

function str(v: string | string[] | undefined): string | undefined {
  return typeof v === 'string' ? v : Array.isArray(v) ? v[0] : undefined;
}

/**
 * PROFUNDIDAD N — RÁFAGA 3. La cadena de ancestros de una categoría, de la raíz
 * al padre inmediato.
 *
 * Acepta las DOS formas de la respuesta a propósito: `ancestors` (la nueva, con
 * la cadena entera) y `parent` (la anterior, un solo nivel). No es cortesía: la
 * ficha de anuncio se cachea 5 min en Redis, así que justo tras desplegar hay
 * respuestas servidas SIN el campo nuevo — y para una categoría de 1-2 niveles,
 * que es lo único que existe hasta que un admin cree algo más hondo, las dos
 * formas dan exactamente la misma URL. Se degrada, no revienta.
 */
function ancestorSlugsDe(cat: {
  ancestors?: { slug: string }[] | null;
  parent?: { slug: string } | null;
}): string[] {
  if (cat.ancestors && cat.ancestors.length > 0) return cat.ancestors.map((a) => a.slug);
  return cat.parent ? [cat.parent.slug] : [];
}

/**
 * A1 — metadatos compartidos por las dos rutas de categoría (1 y 2 segmentos).
 * `canonical` explícita: los redirects ya evitan que la URL vieja se indexe, pero
 * el canonical protege además de las variantes con query params que un crawler
 * descubra por su cuenta (/vehiculos/coches?page=2&sort=…).
 */
export async function categoryMetadata(slug: string, q?: string): Promise<Metadata> {
  try {
    const cat = await getCategoryBySlug(slug);
    return {
      // A2 — con búsqueda de texto el título lo dice, igual que en /busqueda. Antes `q`
      // no llegaba hasta aquí y dos búsquedas distintas dentro de la misma categoría
      // compartían title y description.
      title: q ? `"${q}" en ${cat.name}` : cat.name,
      description: q
        ? `Resultados de "${q}" en ${cat.name}.`
        : `Anuncios de segunda mano de ${cat.name}. Compra y vende en nuestro marketplace.`,
      alternates: {
        canonical: `${SITE_URL}${categoryPath({ slug: cat.slug, ancestorSlugs: ancestorSlugsDe(cat) })}`,
      },
    };
  } catch {
    return { title: 'Categoría' };
  }
}

/**
 * A1 — resolución y canonicalización. LA REGLA ES UNA SOLA: **manda el último
 * segmento**. Se resuelve la categoría por él y se compara la URL pedida con su
 * ruta canónica; si difieren, redirect permanente. Eso absorbe de una vez la URL
 * vieja plana (/coches), el padre incoherente (/inmuebles/coches) y el padre
 * inexistente (/lo-que-sea/coches), sin ninguna tabla de redirects que mantener.
 *
 * OJO — el 308 de verdad lo emite el MIDDLEWARE, no esto: `app/loading.tsx` en la
 * raíz hace que Next mande la cabecera 200 antes de ejecutar este componente, así
 * que aquí `permanentRedirect()` solo puede producir un redirect de cliente sobre
 * un 200 (medido; ver lib/category-canonical.ts). Esto se conserva como RED DE
 * SEGURIDAD: si el mapa del middleware está frío o su fetch falló, el usuario
 * acaba igualmente en la URL correcta. Para el crawler manda el middleware.
 */
async function resolveCanonicalCategory(
  segments: string[],
  raw: RawParams,
): Promise<CategoryWithSchema> {
  const leafSlug = segments[segments.length - 1];

  let category: CategoryWithSchema;
  try {
    category = await getCategoryBySlug(leafSlug);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) notFound();
    throw err;
  }

  const canonical = categoryPath({ slug: category.slug, ancestorSlugs: ancestorSlugsDe(category) });
  const requested = `/${segments.join('/')}`;
  if (requested !== canonical) {
    // La query se preserva SIEMPRE: una URL vieja indexada con filtros
    // (/coches?type=PRODUCT&minPrice=1000) debe llegar a la nueva con los mismos
    // filtros, o el redirect degrada el resultado en vez de conservarlo.
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(raw)) {
      const v = str(val);
      if (v) params.set(key, v);
    }
    permanentRedirect(
      categoryPathWithQuery({ slug: category.slug, ancestorSlugs: ancestorSlugsDe(category) }, params),
    );
  }

  return category;
}

/**
 * Listado de una categoría. Lo comparten las CUATRO rutas que pueden servirlo,
 * una por nivel: `/[categoria]` … `/[categoria]/[subcategoria]/[nivel3]/[nivel4]`.
 *
 * SEGMENTOS FIJOS Y NO UN CATCH-ALL `[...ruta]` (PROFUNDIDAD N — RÁFAGA 3). Un
 * catch-all capturaría además cualquier ruta profunda inexistente, y aquí
 * `notFound()` NO produce un 404 real: `app/loading.tsx` en la raíz hace que Next
 * mande la cabecera 200 antes de ejecutar esta página, así que saldría un 404
 * BLANDO (200 + UI de 404) — una regresión de SEO. Está medido en este repo, y es
 * el mismo mecanismo por el que el 308 vive en el middleware.
 *
 * Con una carpeta por nivel, cinco segmentos siguen sin casar con ninguna ruta y
 * mueren en el 404 real del router. Y para las cadenas FALSAS que sí casan
 * (`/a/b/c`), el 404 real lo garantiza `isUnknownCategoryPath` en el middleware,
 * que corre antes de renderizar.
 */
export async function CategoryListingPage({
  segments,
  searchParams,
}: {
  segments: string[];
  searchParams: Promise<RawParams>;
}) {
  const raw = await searchParams;

  // Resuelve la categoría y garantiza que esta URL es la canónica (o redirige).
  const category = await resolveCanonicalCategory(segments, raw);
  const categoria = category.slug;
  // PROFUNDIDAD N — RÁFAGA 3: la CADENA de ancestros sustituye al padre suelto.
  // `ancestorSlugsDe` acepta las dos formas (la nueva `ancestors` y el `parent`
  // heredado), así que una respuesta cacheada sin el campo nuevo sigue dando una
  // URL válida en vez de romper.
  const ancestorSlugs = ancestorSlugsDe(category);
  const basePath = categoryPath({ slug: categoria, ancestorSlugs });

  // A2 — `q` como filtro de primera: parseado explícito, igual que en /busqueda.
  const q = str(raw.q);

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
  // V-4 — sólo el `true` literal cuenta; cualquier otra cosa es no filtrar.
  const conVideo = str(raw.conVideo) === 'true' ? 'true' : undefined;

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
      ...(q && { q }),
      ...(type && { type }),
      ...(condition && { condition }),
      ...(priceType && { priceType }),
      ...(minPrice !== undefined && !isNaN(minPrice) && { minPrice }),
      ...(maxPrice !== undefined && !isNaN(maxPrice) && { maxPrice }),
      ...(province && { province }),
      ...(city && { city }),
      ...(conVideo && { conVideo: true }),
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
    return categoryPathWithQuery({ slug: categoria, ancestorSlugs }, params);
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
    return categoryPathWithQuery({ slug: categoria, ancestorSlugs }, params);
  }

  const currentFilters = {
    // A2 — sin esto, "Limpiar filtros" borraba la búsqueda de texto: clearAll conserva
    // `currentFilters.q`, y esta página nunca lo rellenaba.
    q,
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

  // A2 — `q` cuenta como filtro de texto. Antes se colaba en `attributes` y se contaba
  // ahí, que es lo mismo en el número pero no en el significado (y arrastraba el resto
  // de consecuencias del bag: ver KNOWN_PARAMS).
  const activeFilterCount = [
    q,
    typeRaw, conditionRaw, priceTypeRaw, province, city, minPriceStr, maxPriceStr,
    ...Object.values(attributes),
    // B3 — las etiquetas cuentan como UN filtro, no una por slug: el badge dice
    // "cuántos filtros tengo puestos", y "Etiquetas" es una sección como "Provincia".
    str(raw.tags),
    proximityActive ? 'geo' : undefined,
  ].filter(Boolean).length;

  // A2 — mismos criterios ya parseados que la búsqueda global, para que el botón de
  // alerta guarde exactamente lo que el usuario está viendo. `categorySlug` es la
  // categoría de la RUTA, que aquí es fija.
  const alertCriteria: AlertCriteria = {
    ...(q && { q }),
    categorySlug: categoria,
    ...(type && { type }),
    ...(condition && { condition }),
    ...(priceType && { priceType }),
    ...(minPrice !== undefined && !isNaN(minPrice) && { minPrice }),
    ...(maxPrice !== undefined && !isNaN(maxPrice) && { maxPrice }),
    ...(province && { province }),
    ...(city && { city }),
    ...(Object.keys(attributes).length > 0 && { attributes }),
    ...(proximityActive && { lat, lng, radius }),
  };

  // Stable key for MapView: remounts when search params change (except view/page) — mismo criterio que /busqueda.
  const mapKey = Object.entries(raw)
    .filter(([k]) => k !== 'view' && k !== 'page')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? (v[0] ?? '') : (v ?? '')}`)
    .join('&');

  // Fallback mode fuerza LISTA (ver comentario más arriba) — el switcher no tiene sentido ahí.
  const effectiveView = fallbackMode ? 'LISTA' : currentView;

  // A1 — la miga refleja el árbol: Inicio > Vehículos > Coches (o Inicio > Vehículos
  // en una raíz). El JSON-LD se genera de la MISMA lista que la miga visible, no de
  // una copia paralela que pueda divergir de lo que ve el usuario.
  // PROFUNDIDAD N — RÁFAGA 3: la miga es la CADENA COMPLETA
  // (Inicio > Vehículos > Coches > Deportivos > Clásicos), no el padre y ya. Cada
  // escalón lleva SU propia URL canónica, que es la de sus propios ancestros —
  // de ahí el `slice(0, i)`.
  //
  // Para una categoría de 1-2 niveles esto produce exactamente la miga de antes.
  // El JSON-LD sigue saliendo de ESTA misma lista, no de una copia paralela.
  const ancestorsChain = category.ancestors ?? (category.parent ? [category.parent] : []);
  const trail = [
    ...ancestorsChain.map((ancestro, i) => ({
      name: ancestro.name,
      path: categoryPath({
        slug: ancestro.slug,
        ancestorSlugs: ancestorsChain.slice(0, i).map((a) => a.slug),
      }),
    })),
    { name: category.name, path: basePath },
  ];

  return (
    <div className="container mx-auto px-4 pb-16 pt-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(trail)) }}
      />
      <nav className="mb-4 text-xs text-muted-foreground" aria-label="Breadcrumb">
        <Link href="/" className="hover:underline">Inicio</Link>
        {trail.map((crumb, i) => (
          <span key={crumb.path}>
            {' / '}
            {i === trail.length - 1 ? (
              <span>{crumb.name}</span>
            ) : (
              <Link href={crumb.path} className="hover:underline">{crumb.name}</Link>
            )}
          </span>
        ))}
      </nav>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-2">
        <div>
          {/* A2 — la búsqueda de texto se ve. Antes `q` filtraba de verdad pero en
              silencio: el usuario leía "Coches" sin saber por qué faltaban anuncios. */}
          <h1 className="text-2xl font-bold">
            {q ? `${category.name} — resultados para "${q}"` : category.name}
          </h1>
          {total > 0 && (
            <p className="text-sm text-muted-foreground">
              {total} {total === 1 ? 'anuncio' : 'anuncios'}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* A2 — también aquí, no solo en /busqueda: con las dos páginas unificadas,
              poder guardar la búsqueda en una y no en la otra era arbitrario. */}
          <CrearAlertaButton criteria={alertCriteria} />
          {!fallbackMode && (
            <ViewSwitcher allowedViews={category.allowedViews} currentView={currentView} buildUrl={viewUrl} />
          )}
        </div>
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
              {/* A2 — el árbol COMPLETO, no `[]`. Antes se ocultaba el selector aquí
                  ("la categoría ya está fijada en la ruta") y a cambio se ofrecía un
                  selector de "Subcategoría" que solo bajaba un nivel: desde /coches no
                  había forma de ir a /pisos ni de volver a la búsqueda global sin
                  editar la URL. Ahora es el mismo control en las dos páginas, con
                  `currentCategorySlug` marcando dónde estás. */}
              <FilterPanel
                categories={categories}
                facets={facets}
                currentFilters={currentFilters}
                activeFilterCount={activeFilterCount}
                allowedListingType={category.allowedListingType}
                currentCategorySlug={categoria}
                filterableFields={filterableFieldsForCategory(
                  category.attributeSchema,
                  categories,
                  categoria,
                )}
                // B3 — etiquetas ofrecidas en ESTA categoría (efectivas: la herencia
                // padre→hija ya viene resuelta en el árbol).
                availableTags={availableTagsForCategory(categories, categoria)}
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
                <Link href={activeFilterCount > 0 ? basePath : '/publicar'}>
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
