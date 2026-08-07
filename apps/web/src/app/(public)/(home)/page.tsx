import Link from 'next/link';
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

  // ANDAMIO TRANSITORIO — desaparece en RP.6, cuando ya no quede nada a mano.
  //
  // El array de bloques es PLANO y ordenado, pero dos secciones de la portada
  // siguen escritas en este fichero (Categorías y Recién publicados, hasta RP.5)
  // y en la página van EN MEDIO: entre el buscador y "Cómo funciona". Con una
  // sola llamada al renderizador no hay forma de intercalarlas sin reordenar la
  // portada, así que la PÁGINA —no el motor— reparte en dos.
  //
  // Se reparte por `search` y nada más: es el único bloque que hoy vive dentro de
  // la banda del hero. Cualquier otro tipo, incluido un `cta`, se pinta abajo con
  // el resto, que es donde lo pondría el admin. Ningún bloque conoce su índice y
  // el `switch` con assertUnreachable sigue igual de homogéneo — esto es
  // maquetación de una página en transición, no una regla del motor.
  const bloquesDelHero = homepage.blocks.filter((b) => b.type === 'search');
  const bloquesDebajo = homepage.blocks.filter((b) => b.type !== 'search');

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

            {/* El buscador y sus chips vienen de la configuración desde RP.2. */}
            <HomeBlockRenderer blocks={bloquesDelHero} categories={categories} />

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

        {/* RP.4 — "Cómo funciona" y las cuatro señales de confianza ya no se
            escriben aquí: son los bloques `steps` y `grid` de la configuración.
            Junto a ellos se pinta cualquier otro bloque que el admin añada. */}
        {bloquesDebajo.length > 0 && (
          <section className="border-t py-12">
            <HomeBlockRenderer blocks={bloquesDebajo} categories={categories} />
          </section>
        )}
      </div>
    </>
  );
}
