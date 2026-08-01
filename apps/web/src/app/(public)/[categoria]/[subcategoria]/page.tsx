import type { Metadata } from 'next';
import {
  CategoryListingPage,
  categoryMetadata,
  type RawParams,
} from '@/components/categorias/CategoryListingPage';

/**
 * A1 — categoría HIJA anidada bajo su padre: /vehiculos/coches. Esta es la ruta
 * nueva de la ráfaga; la URL vieja y plana (/coches) llega aquí por el 308 del
 * middleware.
 *
 * Dos segmentos y no más: el árbol tiene exactamente 2 niveles, así que /a/b/c
 * no casa con ninguna ruta y sigue dando el 404 real del router, como siempre.
 * Los prefijos estáticos (/anuncio/x, /blog/x, /paginas/x, /vendedor/x…) ganan a
 * esta ruta porque Next resuelve el segmento literal antes que el dinámico.
 */
type Params = { categoria: string; subcategoria: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { subcategoria } = await params;
  // Manda el ÚLTIMO segmento — el mismo criterio que la canonicalización.
  return categoryMetadata(subcategoria);
}

export default async function CategoriaHijaPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<RawParams>;
}) {
  const { categoria, subcategoria } = await params;
  return (
    <CategoryListingPage segments={[categoria, subcategoria]} searchParams={searchParams} />
  );
}
