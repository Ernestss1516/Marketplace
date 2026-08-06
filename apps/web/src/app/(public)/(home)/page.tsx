import Link from 'next/link';
import { MessageCircle, Search as SearchIcon, ShieldCheck, Sparkles, Star, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CategoryGrid } from '@/components/categorias/CategoryGrid';
import { ListingCard } from '@/components/anuncios/ListingCard';
import { FavoritesGridProvider } from '@/components/anuncios/FavoritesGridContext';
import { CardAttributesProvider } from '@/components/anuncios/CardAttributesContext';
import { isSponsoredAdHit } from '@/components/anuncios/SponsoredCard';
import { BannerList } from '@/components/banners/BannerList';
import { HomeHero } from '@/components/home/HomeHero';
import { HomeBlockRenderer } from '@/components/home/HomeBlockRenderer';
import { getCategories } from '@/lib/api/categorias';
import { search, type SearchResponse } from '@/lib/api/busqueda';
import type { ListingSummary } from '@/types';
import { getActiveBanners } from '@/lib/api/banners';
import { getCachedHomepageConfig, FALLBACK_HOMEPAGE_CONFIG } from '@/lib/api/homepage';
import { buildCardAttributeMap } from '@/lib/card-attributes';


export default async function HomePage() {
  // RP.1 — el hero deja de estar escrito a mano y viene de la configuración de
  // portada (cacheada aparte, ver lib/api/homepage.ts). Todo lo demás sigue
  // hardcodeado y lo sustituyen las ráfagas siguientes: el buscador y sus
  // adornos en RP.2, "Cómo funciona" y las señales de confianza en RP.4, las
  // categorías y los anuncios recientes en RP.5.
  const [homepage, categories, recentResult, banners] = await Promise.all([
    getCachedHomepageConfig().catch(() => FALLBACK_HOMEPAGE_CONFIG),
    getCategories().catch(() => [] as Awaited<ReturnType<typeof getCategories>>),
    search({ sort: 'publishedAt:desc', hitsPerPage: 8 }).catch(
      (): SearchResponse => ({ hits: [], totalHits: 0, page: 1, hitsPerPage: 8 }),
    ),
    getActiveBanners('HOME').catch(() => []),
  ]);

  // Nunca pasa `category`, así que SearchController nunca inyecta un patrocinado
  // aquí — el filtro es una guarda de tipos defensiva, no una necesidad funcional.
  const recent = recentResult.hits.filter((h): h is ListingSummary => !isSponsoredAdHit(h));

  return (
    <>
      {banners.length > 0 && (
        <div className="container mx-auto px-4 pt-4">
          <BannerList banners={banners} />
        </div>
      )}

      {/* Héroe — el buscador es el elemento tipográfico y visual más grande de la
          página, por encima del propio titular: la "acción principal" del brief no
          se ilustra, se convierte literalmente en lo más grande de la pantalla. */}
      <section className="border-b bg-primary/5">
        <div className="container mx-auto px-4 py-14 md:py-20">
          <div className="mx-auto max-w-4xl text-center">
            {/* El eyebrow se queda escrito a mano y ENCIMA del <h1>. El bloque
                `search` tiene su propio campo `eyebrow` (§4.1) y funciona, pero
                el bloque se pinta DEBAJO del titular: moverlo ahí ahora cambiaría
                el orden visual de la portada, que no es lo que pide esta ráfaga.
                Se resuelve en la limpieza final de RP.6, cuando la página entera
                se reordena. */}
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-primary">
              Miles de anuncios cerca de ti
            </p>
            <HomeHero config={homepage} />

            {/* RP.2 — el buscador y sus chips ya vienen de la configuración.
                TRANSITORIO: el renderizador va DENTRO de la banda del hero
                porque los dos únicos tipos que existen hoy (`search`, `cta`)
                viven ahí en la portada actual. En cuanto RP.4 traiga bloques que
                NO son del hero (rejilla, pasos), esto sale de la <section> al
                sitio que fija §5.1: hero primero, bloques después. */}
            <HomeBlockRenderer blocks={homepage.blocks} categories={categories} />

            {/* Sigue a mano: el bloque `cta` ya existe y renderiza, pero el botón
                compartido es `size="lg"` (el del blog) y este es `size="sm"`.
                Cambiarlo sería una modificación visual que esta ráfaga no pide;
                el modelo no tiene campo de tamaño y no se inventa uno. Pasa a
                bloque cuando RP.4-6 reordenen la portada. */}
            <div className="mt-8">
              <Button asChild variant="outline" size="sm">
                <Link href="/publicar">¿Tienes algo que vender? Publica gratis</Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <div className="container mx-auto px-4 pb-16">
        {/* Categorías */}
        {categories.length > 0 && (
          <section className="py-12">
            <h2 className="mb-4 text-xl font-semibold">Categorías</h2>
            <CategoryGrid categories={categories} />
          </section>
        )}

        {/* Recién publicados — vía Meilisearch (search), no el listado Postgres: así los
            anuncios con boostScore muestran su badge "Destacado" de forma natural. Desde
            la política de ordenación C (RÁFAGA 1) boostScore ya no reordena la lista, así
            que esto son de verdad los más recientes — antes un destacado antiguo podía
            colarse por delante de un anuncio genuinamente nuevo. */}
        <section className="py-12">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Recién publicados</h2>
            <Link href="/busqueda?sort=publishedAt:desc" className="text-sm font-medium text-primary hover:underline">
              Ver todos
            </Link>
          </div>
          {recent.length > 0 ? (
            <CardAttributesProvider cardAttributeMap={buildCardAttributeMap(categories)}>
              <FavoritesGridProvider listingIds={recent.map((l) => l.id)}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                  {recent.map((listing) => (
                    <ListingCard key={listing.id} listing={listing} />
                  ))}
                </div>
              </FavoritesGridProvider>
            </CardAttributesProvider>
          ) : (
            <p className="py-8 text-center text-muted-foreground">
              Aún no hay anuncios publicados.
            </p>
          )}
        </section>

        {/* Confianza / cómo funciona — atiende a las dos audiencias por igual. */}
        <section className="border-t py-12">
          <h2 className="mb-8 text-center text-xl font-semibold">Cómo funciona</h2>
          <div className="grid gap-10 md:grid-cols-2 md:gap-16">
            <div>
              <h3 className="mb-5 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <SearchIcon className="h-4 w-4" /> Para compradores
              </h3>
              <ol className="space-y-5">
                <TrustStep n={1} title="Busca lo que necesitas">
                  Usa el buscador o explora por categorías hasta encontrarlo.
                </TrustStep>
                <TrustStep n={2} title="Contacta con el vendedor">
                  Pregunta tus dudas por mensajería interna, sin dar tu teléfono.
                </TrustStep>
                <TrustStep n={3} title="Queda y valora">
                  Cierra el trato en persona y deja tu opinión al vendedor.
                </TrustStep>
              </ol>
              <Button asChild variant="link" className="mt-2 h-auto p-0">
                <Link href="/busqueda">Buscar ahora →</Link>
              </Button>
            </div>

            <div>
              <h3 className="mb-5 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                <Upload className="h-4 w-4" /> Para vendedores
              </h3>
              <ol className="space-y-5">
                <TrustStep n={1} title="Publica gratis">
                  Sube fotos y describe tu artículo en un par de minutos.
                </TrustStep>
                <TrustStep n={2} title="Gestiona tus mensajes">
                  Responde a los interesados desde tu bandeja de mensajes.
                </TrustStep>
                <TrustStep n={3} title="Destaca tu anuncio (opcional)">
                  Dale más visibilidad si quieres vender más rápido.
                </TrustStep>
              </ol>
              <Button asChild variant="link" className="mt-2 h-auto p-0">
                <Link href="/publicar">Publicar anuncio →</Link>
              </Button>
            </div>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 border-t pt-8 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" /> Anuncios moderados
            </span>
            <span className="flex items-center gap-2">
              <MessageCircle className="h-4 w-4" /> Mensajería sin compartir tu teléfono
            </span>
            <span className="flex items-center gap-2">
              <Star className="h-4 w-4" /> Valoraciones entre usuarios
            </span>
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Publicar es gratis
            </span>
          </div>
        </section>
      </div>
    </>
  );
}

function TrustStep({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {n}
      </span>
      <div>
        <p className="font-medium leading-snug">{title}</p>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
    </li>
  );
}
