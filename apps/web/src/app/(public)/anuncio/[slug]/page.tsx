import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { ListingGallery } from '@/components/anuncios/ListingGallery';
import { ContactButton } from '@/components/anuncios/ContactButton';
import { PhoneButton } from '@/components/anuncios/PhoneButton';
import { ShareButton } from '@/components/anuncios/ShareButton';
import { SellerCard } from '@/components/anuncios/SellerCard';
import { AttributeList } from '@/components/anuncios/AttributeList';
import { ListingCard } from '@/components/anuncios/ListingCard';
import { formatListingPrice } from '@/components/anuncios/listing-card-shared';
import { ReportButton } from '@/components/anuncios/ReportButton';
import { FavoriteButton } from '@/components/anuncios/FavoriteButton';
import { ListingViewTracker } from '@/components/anuncios/ListingViewTracker';
import { ListingOwnerActions } from '@/components/anuncios/ListingOwnerActions';
import { FavoritesGridProvider } from '@/components/anuncios/FavoritesGridContext';
import { CardAttributesProvider } from '@/components/anuncios/CardAttributesContext';
import { getListing, getListingsByCategory } from '@/lib/api/anuncios';
import { getCategoryBySlug } from '@/lib/api/categorias';
import { buildCardAttributeMapFromSchema } from '@/lib/card-attributes';
import { filterSchemaByType } from '@/lib/attribute-schema';
import { categoryPath } from '@/lib/category-url';
import { breadcrumbJsonLd } from '@/lib/breadcrumb-json-ld';
import { ApiError } from '@/lib/api/client';
import { SITE_NAME, SITE_URL } from '@/config';

type Params = { slug: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const listing = await getListing(slug);
    const description = listing.description.slice(0, 160);
    return {
      title: listing.title,
      description,
      alternates: { canonical: `${SITE_URL}/anuncio/${slug}` },
      openGraph: {
        title: `${listing.title} | ${SITE_NAME}`,
        description,
        images: listing.images[0] ? [{ url: listing.images[0].url }] : [],
      },
    };
  } catch {
    return { title: 'Anuncio' };
  }
}

const STATUS_LABELS: Partial<Record<string, string>> = {
  RESERVED: 'Reservado',
};

const CONDITION_LABELS: Record<string, string> = {
  NEW: 'Nuevo',
  LIKE_NEW: 'Como nuevo',
  GOOD: 'Buen estado',
  FAIR: 'Aceptable',
  FOR_PARTS: 'Para piezas',
};


export default async function AnuncioPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;

  let listing;
  try {
    listing = await getListing(slug);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) notFound();
    throw err;
  }

  // Category schema and related listings — fail gracefully, non-blocking
  const [categoryResult, relatedResult] = await Promise.allSettled([
    getCategoryBySlug(listing.category.slug),
    getListingsByCategory(listing.category.slug, { perPage: 5 }),
  ]);

  const schema =
    categoryResult.status === 'fulfilled' ? categoryResult.value.attributeSchema : [];
  const relatedItems =
    relatedResult.status === 'fulfilled'
      ? relatedResult.value.items.filter((l) => l.slug !== slug).slice(0, 4)
      : [];

  // Filtrado por tipo solo para ESTE anuncio — el `schema` sin filtrar se
  // sigue usando más abajo para el mapa de atributos de los relacionados,
  // que pueden ser de un tipo distinto al de este anuncio.
  const visibleSchema = filterSchemaByType(schema, listing.type);

  const statusLabel = STATUS_LABELS[listing.status];
  const location = [listing.city, listing.province].filter(Boolean).join(', ');

  // A1 (URLs anidadas) — el padre de la categoría, para la miga completa
  // (Inicio > Vehículos > Coches > Título) y la URL canónica de la categoría.
  // Se prefiere el de `getCategoryBySlug` (siempre fresco) sobre el del propio
  // anuncio, que viaja dentro del blob cacheado 5 min en Redis y puede faltar
  // justo tras desplegar. Si ninguno lo trae, la miga cae a 2 niveles y el
  // enlace a la URL plana (que redirige) — se degrada, nunca rompe.
  const categoryParent =
    (categoryResult.status === 'fulfilled' ? categoryResult.value.parent : undefined) ??
    listing.category.parent ??
    null;
  const categoryHref = categoryPath({
    slug: listing.category.slug,
    parentSlug: categoryParent?.slug,
  });

  const breadcrumbTrail = [
    ...(categoryParent
      ? [{ name: categoryParent.name, path: categoryPath({ slug: categoryParent.slug }) }]
      : []),
    { name: listing.category.name, path: categoryHref },
    { name: listing.title, path: `/anuncio/${listing.slug}` },
  ];

  return (
    // pb-24 reserves space on mobile so the fixed contact bar doesn't overlap content
    <div className="pb-24 md:pb-0">
      <ListingViewTracker slug={slug} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd(breadcrumbTrail)) }}
      />
      <div className="container mx-auto px-4 py-6">
        {/* Breadcrumb — refleja el árbol de categorías (A1). El JSON-LD de arriba
            se genera de la MISMA lista, no de una copia paralela. */}
        <nav className="mb-4 text-xs text-muted-foreground" aria-label="Breadcrumb">
          <Link href="/" className="hover:underline">Inicio</Link>
          {breadcrumbTrail.map((crumb, i) => (
            <span key={crumb.path}>
              {' / '}
              {i === breadcrumbTrail.length - 1 ? (
                <span className="line-clamp-1">{crumb.name}</span>
              ) : (
                <Link href={crumb.path} className="hover:underline">{crumb.name}</Link>
              )}
            </span>
          ))}
        </nav>

        <div className="grid gap-8 md:grid-cols-[1fr_320px]">
          {/* ── Left column ── */}
          <div className="space-y-6">
            <ListingGallery images={listing.images} title={listing.title} />

            {/* Title + status + price */}
            <div>
              <div className="mb-1 flex flex-wrap items-start gap-2">
                <h1 className="flex-1 text-2xl font-bold leading-tight">{listing.title}</h1>
                {statusLabel && <Badge variant="secondary">{statusLabel}</Badge>}
              </div>
              <p className="text-3xl font-extrabold text-primary">
                {formatListingPrice(listing.price, listing.currency, listing.priceType, listing.priceUnit)}
              </p>
            </div>

            {/* Category attributes — filtrados por tipo: un anuncio SERVICE
                no muestra labels de atributos solo-PRODUCT (mismo helper
                que el wizard). */}
            {visibleSchema.length > 0 && (
              <AttributeList
                schema={visibleSchema}
                values={listing.attributes as Record<string, unknown>}
              />
            )}

            {/* B2 — etiquetas del anuncio. Misma regla de desaparición que los
                atributos: sin tags no se pinta la sección, en vez de un hueco con un
                título vacío. Todavía NO enlazan a ninguna búsqueda filtrada — el
                filtro por tags es B3; poner el href ahora llevaría a un 400. */}
            {listing.tags && listing.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5" data-testid="ficha-tags">
                {listing.tags.map((tag) => (
                  <span
                    key={tag.slug}
                    className="rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-medium"
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            )}

            {/* Condition */}
            {listing.condition && (
              <p className="text-sm">
                <span className="text-muted-foreground">Estado: </span>
                <span className="font-medium">
                  {CONDITION_LABELS[listing.condition] ?? listing.condition}
                </span>
              </p>
            )}

            {/* Description */}
            <div>
              <h2 className="mb-2 text-base font-semibold">Descripción</h2>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {listing.description}
              </p>
            </div>

            {/* Location */}
            {location && (
              <div>
                <h2 className="mb-1 text-base font-semibold">Ubicación</h2>
                <p className="text-sm text-muted-foreground">{location}</p>
              </div>
            )}
          </div>

          {/* ── Right column (desktop sidebar) ── */}
          <div className="space-y-4">
            <ContactButton listingId={listing.id} />
            {listing.hasPhone && <PhoneButton listingId={listing.id} />}
            <ShareButton url={`${SITE_URL}/anuncio/${slug}`} title={listing.title} />
            <FavoriteButton listingId={listing.id} />
            <ListingOwnerActions
              listingId={listing.id}
              sellerSlug={listing.seller.slug}
              listingStatus={listing.status}
              featuredUntil={listing.featuredUntil}
            />
            <SellerCard seller={listing.seller} publishedAt={listing.publishedAt} />
            <ReportButton listingId={listing.id} />
          </div>
        </div>

        {/* Related listings */}
        {relatedItems.length > 0 && (
          <section className="mt-12">
            <h2 className="mb-4 text-lg font-semibold">
              Más anuncios en{' '}
              <Link href={categoryHref} className="hover:underline">
                {listing.category.name}
              </Link>
            </h2>
            <CardAttributesProvider cardAttributeMap={buildCardAttributeMapFromSchema(listing.category.slug, schema)}>
              <FavoritesGridProvider listingIds={relatedItems.map((i) => i.id)}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {relatedItems.map((item) => (
                    <ListingCard key={item.id} listing={item} />
                  ))}
                </div>
              </FavoritesGridProvider>
            </CardAttributesProvider>
          </section>
        )}
      </div>
    </div>
  );
}
