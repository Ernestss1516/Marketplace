import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { CategoryGrid } from '@/components/categorias/CategoryGrid';
import { BannerList } from '@/components/banners/BannerList';
import { HomeHero } from '@/components/home/HomeHero';
import { HomeBlockRenderer } from '@/components/home/HomeBlockRenderer';
import { getCategories } from '@/lib/api/categorias';
import { getActiveBanners } from '@/lib/api/banners';
import { getCachedHomepageConfig, FALLBACK_HOMEPAGE_CONFIG } from '@/lib/api/homepage';
import { resolveHomeListingsData } from '@/lib/home-blocks/resolve-listings';
import { buildCardAttributeMap } from '@/lib/card-attributes';


export default async function HomePage() {
  // RP.1 — el hero deja de estar escrito a mano y viene de la configuración de
  // portada (cacheada aparte, ver lib/api/homepage.ts). Todo lo demás sigue
  // hardcodeado y lo sustituyen las ráfagas siguientes: el buscador y sus
  // adornos en RP.2, "Cómo funciona" y las señales de confianza en RP.4, las
  // categorías y los anuncios recientes en RP.5.
  const [homepage, categories, banners] = await Promise.all([
    getCachedHomepageConfig().catch(() => FALLBACK_HOMEPAGE_CONFIG),
    getCategories().catch(() => [] as Awaited<ReturnType<typeof getCategories>>),
    getActiveBanners('HOME').catch(() => []),
  ]);

  // Los bloques dinámicos se resuelven ANTES del render y en paralelo entre sí
  // (Promise.all dentro), de modo que `HomeBlockRenderer` sigue siendo síncrono y
  // no hay waterfall. Va después del Promise.all de arriba porque necesita
  // `homepage.blocks` para saber qué pedir.
  const listingsData = await resolveHomeListingsData(homepage.blocks).catch(() => ({}));

  // ANDAMIO TRANSITORIO — desaparece en RP.6.
  //
  // Ya no queda nada intercalado: desde RP.5, Categorías y Recién publicados son
  // bloques. Lo único que este reparto sigue haciendo es mantener el BUSCADOR
  // dentro de la banda del hero, que es donde está en la portada actual; el resto
  // de bloques se pintan debajo, en el orden del array.
  //
  // RP.6 lo retira junto con el eyebrow y el botón que aún se escriben a mano, y
  // la página queda como fija §5.1: hero y, debajo, todos los bloques.
  //
  // El motor no se entera: ningún bloque conoce su índice y los `switch` con
  // assertUnreachable siguen igual de homogéneos.
  const bloquesDelHero = homepage.blocks.filter((b) => b.type === 'search');
  const bloquesDebajo = homepage.blocks.filter((b) => b.type !== 'search');

  // Se calcula UNA vez para toda la página y baja por props hasta el provider de
  // atributos de las tarjetas — no una vez por bloque.
  const cardAttributeMap = buildCardAttributeMap(categories);

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
        {/* SIGUE ESCRITO A MANO, y es una divergencia consciente de §8.
            §8 pide retirar esta rejilla en RP.5 porque el bloque
            `categoryCarousel` la sustituye. El bloque está hecho, con su editor y
            su upload — pero cada categoría necesita una FOTO SUBIDA
            (`imageUrl` es @IsOwnStorageUrl, no admite una URL inventada), y una
            semilla no puede subir ficheros. Retirar esto sin poder sembrar el
            carrusel dejaría la portada SIN la sección de categorías, que es
            precisamente lo que ninguna ráfaga debe hacer.
            Lo cambia el admin desde /admin/portada en cuanto tenga las fotos; en
            ese momento esta sección se borra. Ver docs/estado-tecnico.md. */}
        {categories.length > 0 && (
          <section className="py-12">
            <h2 className="mb-4 text-xl font-semibold">Categorías</h2>
            <CategoryGrid categories={categories} />
          </section>
        )}

        {/* RP.5 — "Recién publicados" ya no se escribe aquí: es el bloque
            `listings` de la configuración, con sus dos providers recuperados. */}
        {bloquesDebajo.length > 0 && (
          <div className="py-12">
            <HomeBlockRenderer
              blocks={bloquesDebajo}
              categories={categories}
              listingsData={listingsData}
              cardAttributeMap={cardAttributeMap}
            />
          </div>
        )}
      </div>
    </>
  );
}
