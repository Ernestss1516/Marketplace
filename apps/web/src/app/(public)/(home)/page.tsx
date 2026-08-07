import { CategoryGrid } from '@/components/categorias/CategoryGrid';
import { BannerList } from '@/components/banners/BannerList';
import { HomeHero } from '@/components/home/HomeHero';
import { HomeBlockRenderer } from '@/components/home/HomeBlockRenderer';
import { getCategories } from '@/lib/api/categorias';
import { getActiveBanners } from '@/lib/api/banners';
import { getCachedHomepageConfig, FALLBACK_HOMEPAGE_CONFIG } from '@/lib/api/homepage';
import { resolveHomeListingsData } from '@/lib/home-blocks/resolve-listings';
import { buildCardAttributeMap } from '@/lib/card-attributes';


/**
 * Portada. Desde RP.6 la pinta ENTERA el motor de bloques, con dos excepciones
 * que no son contenido configurable:
 *
 *  - Los BANNERS, que son un sistema propio y completo (modelo, backoffice,
 *    ventana temporal, descarte persistente) y siguen encima del hero.
 *  - La REJILLA DE CATEGORÍAS, que se queda como fallback mientras no haya un
 *    bloque `categoryCarousel` configurado. El carrusel exige fotos SUBIDAS por
 *    categoría (`@IsOwnStorageUrl`) y una semilla no puede subir ficheros, así
 *    que retirarla dejaría la portada sin categorías. Ver la nota más abajo.
 *
 * El hero no pasa por el motor: es campo propio de la configuración, y por eso
 * ningún bloque conoce su índice (docs/diseno-portada.md §2.3).
 */
export default async function HomePage() {
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

  // Se calcula UNA vez para toda la página y baja por props hasta el provider de
  // atributos de las tarjetas — no una vez por bloque.
  const cardAttributeMap = buildCardAttributeMap(categories);

  // ── Dónde va la rejilla de categorías (fallback) ──────────────────────────
  //
  // La rejilla solo se pinta si NO hay un `categoryCarousel` configurado: el
  // carrusel es su sustituto natural y no deben salir los dos.
  //
  // Y va donde está hoy: JUSTO ANTES del primer bloque de anuncios. No es una
  // regla del motor —ningún bloque conoce su índice— sino de esta página, y
  // responde a la lógica editorial de la portada: primero se enseña por dónde
  // explorar, luego lo que hay. Si no hubiera bloque de anuncios, va al final.
  //
  // El día que alguien configure el carrusel, esto deja de pintarse y la página
  // pasa a ser hero + bloques, sin excepciones.
  const hayCarrusel = homepage.blocks.some((b) => b.type === 'categoryCarousel');
  const mostrarRejilla = !hayCarrusel && categories.length > 0;
  const corte = mostrarRejilla ? homepage.blocks.findIndex((b) => b.type === 'listings') : -1;
  const bloquesAntes = corte === -1 ? homepage.blocks : homepage.blocks.slice(0, corte);
  const bloquesDespues = corte === -1 ? [] : homepage.blocks.slice(corte);

  const rendererProps = {
    categories,
    listingsData,
    cardAttributeMap,
  };

  return (
    <>
      {banners.length > 0 && (
        <div className="container mx-auto px-4 pt-4">
          <BannerList banners={banners} />
        </div>
      )}

      {/* Banda del hero, a sangre y con su propio fondo. Contiene el hero y NADA
          MÁS: el buscador, su eyebrow y el botón de publicar eran andamio y ahora
          son bloques, en su posición del array (§3.5 y §5.1 del diseño). */}
      <section className="border-b bg-primary/5">
        <div className="container mx-auto px-4 py-14 md:py-20">
          <div className="mx-auto max-w-4xl text-center">
            <HomeHero config={homepage} />
          </div>
        </div>
      </section>

      <div className="container mx-auto space-y-12 px-4 py-12">
        <HomeBlockRenderer blocks={bloquesAntes} {...rendererProps} />

        {/* Fallback, NO andamio: §8 daba por retirada esta rejilla en RP.5 y esa
            previsión no se cumplió. El bloque `categoryCarousel` que la sustituye
            exige una FOTO SUBIDA por categoría (`imageUrl` es @IsOwnStorageUrl,
            no admite una URL inventada) y una semilla no puede subir ficheros:
            retirarla dejaría toda instalación nueva SIN sección de categorías.
            Se pinta solo mientras no haya carrusel configurado; el día que un
            admin suba las fotos desde /admin/portada, desaparece sola.
            Corregido en docs/diseno-portada.md §4.2 y §8. */}
        {mostrarRejilla && (
          <section>
            <h2 className="mb-4 text-xl font-semibold">Categorías</h2>
            <CategoryGrid categories={categories} />
          </section>
        )}

        {bloquesDespues.length > 0 && (
          <HomeBlockRenderer blocks={bloquesDespues} {...rendererProps} />
        )}
      </div>
    </>
  );
}
