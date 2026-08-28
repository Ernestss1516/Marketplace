import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Package, MapPin, CalendarDays, Crown, BadgeCheck } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ListingCard } from '@/components/anuncios/ListingCard';
import { FavoritesGridProvider } from '@/components/anuncios/FavoritesGridContext';
import { CardAttributesProvider } from '@/components/anuncios/CardAttributesContext';
import { auth } from '@/lib/auth';
import { getSellerProfile } from '@/lib/api/usuarios';
import { getListingsBySellerSlug } from '@/lib/api/anuncios';
import { getUserReviews } from '@/lib/api/valoraciones';
import { getCategories } from '@/lib/api/categorias';
import { getActiveBanners } from '@/lib/api/banners';
import { BannerList } from '@/components/banners/BannerList';
import { buildCardAttributeMap } from '@/lib/card-attributes';
import { ApiError } from '@/lib/api/client';
import { ReviewsSection } from '@/components/valoraciones/ReviewsSection';
import { ValorarDesdePerfil } from '@/components/valoraciones/ValorarDesdePerfil';
import { SITE_NAME } from '@/config';

type Params = { slug: string };
// valorar/target: deep-link desde la notificación REVIEW_REQUEST (Reputación
// RÁFAGA 3) — el único punto de entrada para valorar un Deal sin conversación
// asociada (ver ValorarDesdePerfil).
type SearchParams = { page?: string; valorar?: string; target?: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  try {
    const seller = await getSellerProfile(slug);
    return {
      title: `${seller.name} | ${SITE_NAME}`,
      description: seller.bio ?? `Anuncios de ${seller.name} en ${SITE_NAME}.`,
    };
  } catch {
    return { title: `Vendedor | ${SITE_NAME}` };
  }
}

export default async function VendedorPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { slug } = await params;
  const { page: pageStr, valorar: valorarListingId, target: valorarTargetId } = await searchParams;
  const page = Math.max(1, Number(pageStr ?? 1));
  const session = await auth();

  let seller;
  try {
    seller = await getSellerProfile(slug);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) notFound();
    throw err;
  }

  const [{ items, total, perPage }, reviewsData, categories, banners] = await Promise.all([
    getListingsBySellerSlug(slug, { page }).catch(() => ({ items: [], total: 0, page, perPage: 24 })),
    getUserReviews(slug).catch(() => ({ average: null, count: 0, distribution: {}, unverifiedCount: 0, items: [], nextCursor: null })),
    getCategories().catch(() => [] as Awaited<ReturnType<typeof getCategories>>),
    getActiveBanners('VENDEDOR').catch(() => []),
  ]);

  const totalPages = Math.ceil(total / perPage) || 0;

  const memberSince = new Intl.DateTimeFormat('es-ES', {
    month: 'long',
    year: 'numeric',
  }).format(new Date(seller.memberSince));

  const location = [seller.city, seller.province].filter(Boolean).join(', ');

  return (
    <div className="container mx-auto px-4 pb-16 pt-8">
      {/* Perfil del vendedor */}
      <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-6">
        <Avatar className="h-20 w-20 shrink-0 text-2xl">
          <AvatarImage src={seller.avatarUrl} alt={seller.name} />
          <AvatarFallback>{seller.name[0]?.toUpperCase()}</AvatarFallback>
        </Avatar>

        <div className="flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{seller.name}</h1>
            {seller.isPro && (
              <Badge className="gap-1" data-testid="seller-pro-badge">
                <Crown className="h-3 w-3" aria-hidden />
                Pro
              </Badge>
            )}
            {seller.trusted && (
              <Badge
                variant="outline"
                className="gap-1 border-green-300 bg-green-50 text-green-700 hover:bg-green-50"
                data-testid="seller-trusted-badge"
              >
                <BadgeCheck className="h-3 w-3" aria-hidden />
                Vendedor de confianza
              </Badge>
            )}
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {location && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                {location}
              </span>
            )}
            <span className="flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              Miembro desde {memberSince}
            </span>
          </div>

          {seller.bio && (
            <p className="pt-1 text-sm text-muted-foreground">{seller.bio}</p>
          )}
        </div>
      </div>

      {/* Debajo de la identidad del vendedor y encima de sus anuncios: la página
          dice primero de quién es. */}
      {banners.length > 0 && (
        <div className="mb-8">
          <BannerList banners={banners} />
        </div>
      )}

      {/* Valorar desde notificación — Reputación RÁFAGA 3, único punto de
          entrada para un Deal sin conversación asociada (ver ValorarDesdePerfil) */}
      {valorarListingId && valorarTargetId && session?.user.accessToken && (
        <ValorarDesdePerfil
          listingId={valorarListingId}
          targetId={valorarTargetId}
          targetName={seller.name}
          token={session.user.accessToken}
        />
      )}

      {/* Anuncios activos */}
      <div className="mb-4 flex items-baseline gap-2">
        <h2 className="text-lg font-semibold">Anuncios activos</h2>
        {total > 0 && (
          <span className="text-sm text-muted-foreground">
            {total} {total === 1 ? 'anuncio' : 'anuncios'}
          </span>
        )}
      </div>

      {items.length > 0 ? (
        <>
          <CardAttributesProvider cardAttributeMap={buildCardAttributeMap(categories)}>
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
                  <Link href={`/vendedor/${slug}?page=${page - 1}`}>Anterior</Link>
                </Button>
              )}
              <span className="text-sm text-muted-foreground">
                Página {page} de {totalPages}
              </span>
              {page < totalPages && (
                <Button variant="outline" asChild>
                  <Link href={`/vendedor/${slug}?page=${page + 1}`}>Siguiente</Link>
                </Button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center py-24 text-center">
          <Package className="mb-4 h-12 w-12 text-muted-foreground/40" aria-hidden />
          <h2 className="mb-1 text-lg font-semibold">
            {seller.name} no tiene anuncios activos
          </h2>
          <p className="mb-6 text-sm text-muted-foreground">
            Explora otros anuncios en el marketplace.
          </p>
          <Button asChild>
            <Link href="/">Ver anuncios</Link>
          </Button>
        </div>
      )}

      {/* Valoraciones recibidas */}
      <div className="mt-12">
        {/* esMiPerfil habilita la entrada "¿Ayuda con esta valoración?" — solo
            para el destinatario, que es quien puede abrir ese ticket (R6). */}
        <ReviewsSection
          data={reviewsData}
          sellerName={seller.name}
          esMiPerfil={session?.user.slug === slug}
        />
      </div>
    </div>
  );
}
