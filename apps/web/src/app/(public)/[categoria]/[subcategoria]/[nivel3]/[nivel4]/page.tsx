import type { Metadata } from 'next';
import {
  CategoryListingPage,
  categoryMetadata,
  type RawParams,
} from '@/components/categorias/CategoryListingPage';

/**
 * PROFUNDIDAD N — RÁFAGA 3. Categoría de CUARTO nivel, el más profundo que
 * admite `CATEGORY_MAX_DEPTH`: /vehiculos/coches/deportivos/clasicos.
 *
 * Es la última carpeta a propósito: cinco segmentos no casan con ninguna ruta y
 * siguen dando el 404 real del router, igual que `/a/b/c` antes de esta ráfaga.
 * Ver la nota de la ruta de nivel 3 sobre por qué segmentos fijos y no catch-all.
 */
type Params = {
  categoria: string;
  subcategoria: string;
  nivel3: string;
  nivel4: string;
};

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<RawParams>;
}): Promise<Metadata> {
  const [{ nivel4 }, raw] = await Promise.all([params, searchParams]);
  const q = typeof raw.q === 'string' ? raw.q : undefined;
  return categoryMetadata(nivel4, q);
}

export default async function CategoriaNivel4Page({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<RawParams>;
}) {
  const { categoria, subcategoria, nivel3, nivel4 } = await params;
  return (
    <CategoryListingPage
      segments={[categoria, subcategoria, nivel3, nivel4]}
      searchParams={searchParams}
    />
  );
}
