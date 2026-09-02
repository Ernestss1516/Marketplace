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
import { getActiveBanners } from '@/lib/api/banners';
import { BannerList } from '@/components/banners/BannerList';
import { buildCardAttributeMapFromSchema } from '@/lib/card-attributes';
import { filterSchemaByType } from '@/lib/attribute-schema';
import { categoryPath } from '@/lib/category-url';
import { breadcrumbJsonLd } from '@/lib/breadcrumb-json-ld';
import { ApiError } from '@/lib/api/client';
import { SITE_NAME, SITE_URL } from '@/config';
// I18N T3-B — `CONDITION_LABELS` estaba escrito aquí, y era una de las SEIS copias
// del mismo mapa que había en el repo.
import { CONDICION_LABELS as CONDITION_LABELS, etiquetaDeEstado } from '@/lib/etiquetas-enums';

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

// I18N T3-B — igual que en la tarjeta: lo que esto declara NO es cómo se llama
// «RESERVED», es que en la ficha pública **sólo** ese estado lleva insignia. Un
// anuncio vendido o caducado ni siquiera llega aquí (la ficha no lo sirve), así que la
// lista es de uno. El texto sale ya de la fuente.
const ESTADOS_CON_INSIGNIA = new Set(['RESERVED']);

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

  // Category schema, related listings and banners — fail gracefully, non-blocking.
  // El banner es un settled más: en la página que más tráfico recibe del sitio,
  // un endpoint de avisos caído no puede llevarse por delante la ficha.
  const [categoryResult, relatedResult, bannersResult] = await Promise.allSettled([
    getCategoryBySlug(listing.category.slug),
    getListingsByCategory(listing.category.slug, { perPage: 5 }),
    getActiveBanners('ANUNCIO'),
  ]);

  const schema =
    categoryResult.status === 'fulfilled' ? categoryResult.value.attributeSchema : [];
  const relatedItems =
    relatedResult.status === 'fulfilled'
      ? relatedResult.value.items.filter((l) => l.slug !== slug).slice(0, 4)
      : [];
  const banners = bannersResult.status === 'fulfilled' ? bannersResult.value : [];

  // Filtrado por tipo solo para ESTE anuncio — el `schema` sin filtrar se
  // sigue usando más abajo para el mapa de atributos de los relacionados,
  // que pueden ser de un tipo distinto al de este anuncio.
  const visibleSchema = filterSchemaByType(schema, listing.type);

  const statusLabel = ESTADOS_CON_INSIGNIA.has(listing.status)
    ? etiquetaDeEstado(listing.status)
    : undefined;
  const location = [listing.city, listing.province].filter(Boolean).join(', ');

  // A1 (URLs anidadas) — los ancestros de la categoría, para la miga completa
  // (Inicio > Vehículos > Coches > Deportivos > Título) y su URL canónica.
  //
  // PROFUNDIDAD N: se usa la CADENA (`ancestors`), no el padre suelto. Con el
  // padre solo, un anuncio de una categoría de nivel 4 enseñaba una miga a la
  // que le faltaban dos escalones y enlazaba a `/nivel3/nivel4` — una URL no
  // canónica que el middleware acaba redirigiendo. No rompía; mentía.
  //
  // La preferencia de fuentes no cambia: primero `getCategoryBySlug` (siempre
  // fresco), luego el `parent` que viaja en el blob del anuncio cacheado 5 min en
  // Redis —que puede faltar justo tras desplegar—, y si ninguno lo trae, se
  // degrada a la URL plana, que redirige. Nunca rompe.
  const categoriaFresca = categoryResult.status === 'fulfilled' ? categoryResult.value : undefined;
  const ancestros =
    categoriaFresca?.ancestors ??
    (categoriaFresca?.parent ? [categoriaFresca.parent] : undefined) ??
    (listing.category.parent ? [listing.category.parent] : []);

  const categoryHref = categoryPath({
    slug: listing.category.slug,
    ancestorSlugs: ancestros.map((a) => a.slug),
  });

  const breadcrumbTrail = [
    // Cada escalón con SU propia URL canónica: la de sus propios ancestros.
    ...ancestros.map((ancestro, i) => ({
      name: ancestro.name,
      path: categoryPath({
        slug: ancestro.slug,
        ancestorSlugs: ancestros.slice(0, i).map((a) => a.slug),
      }),
    })),
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

        {/* ARRIBA, bajo la miga y a ancho completo — decisión de producto tomada
            para esta página en concreto (docs/diseno-banners-ubicaciones.md §4.3,
            opción A1): es la superficie con más tráfico del sitio, así que un
            aviso de servicio que no se vea aquí no se ve en ninguna parte. El
            coste asumido es que empuja la galería hacia abajo; la contrapartida
            es disciplina editorial —avisos, no promociones—, que se ejerce al
            publicar, no con una regla en el frontend (el negocio vive en Nest). */}
        {banners.length > 0 && (
          <div className="mb-4">
            <BannerList banners={banners} />
          </div>
        )}

        <div className="grid gap-8 md:grid-cols-[1fr_320px]">
          {/* ── Left column ── */}
          <div className="space-y-6">
            <ListingGallery
              images={listing.images}
              title={listing.title}
              videoUrl={listing.videoUrl}
              videoPosterUrl={listing.videoPosterUrl}
            />

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

            {/* B2 pintó los chips; B3 los ENLAZA — el destino filtrado ya existe.
                Cierra el círculo: una etiqueta en la ficha lleva a la búsqueda de todo
                lo que la lleva, dentro de la misma categoría del anuncio.

                Se reutiliza `categoryHref` —el mismo que ya usa el breadcrumb— en vez de
                recalcular la ruta: ahí el padre ya está resuelto (incluso cuando el
                payload viene de una caché vieja sin `parent`), así que el enlace del tag
                y el de la categoría no pueden divergir.

                Misma regla de desaparición que los atributos: sin tags, sin sección. */}
            {listing.tags && listing.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5" data-testid="ficha-tags">
                {listing.tags.map((tag) => (
                  <Link
                    key={tag.slug}
                    href={`${categoryHref}?tags=${encodeURIComponent(tag.slug)}`}
                    className="rounded-full border bg-muted/40 px-2.5 py-1 text-xs font-medium transition-colors hover:border-primary/50 hover:bg-accent"
                  >
                    {tag.name}
                  </Link>
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
              nextBumpAt={listing.nextBumpAt}
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
