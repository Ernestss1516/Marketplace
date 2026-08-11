import type { Metadata } from 'next';
import {
  CategoryListingPage,
  categoryMetadata,
  type RawParams,
} from '@/components/categorias/CategoryListingPage';

/**
 * PROFUNDIDAD N — RÁFAGA 3. Categoría de TERCER nivel:
 * /vehiculos/coches/deportivos.
 *
 * SEGMENTOS FIJOS Y NO UN CATCH-ALL `[...ruta]`, y no es preferencia estética.
 * Un catch-all capturaría además cualquier ruta profunda inexistente, y en el
 * componente `notFound()` NO produce un 404 real: `app/loading.tsx` en la raíz
 * hace que Next mande la cabecera 200 antes de ejecutar la página, así que
 * saldría un 404 BLANDO (200 + UI de 404). Está medido en este repo, y es el
 * mismo mecanismo por el que el 308 tuvo que mudarse al middleware.
 *
 * El precio es que el número de rutas ES el tope de profundidad, repetido en la
 * estructura de carpetas. Es un cable RUIDOSO y por eso se acepta: si alguien
 * sube `CATEGORY_MAX_DEPTH` sin añadir la carpeta, la URL del nivel nuevo
 * sencillamente no resuelve y se ve al primer intento — lo contrario de una
 * herencia rota en silencio.
 *
 * Lo que garantiza el 404 real de una cadena FALSA (`/a/b/c`) es la guarda del
 * middleware (`isUnknownCategoryPath`), que corre antes de renderizar.
 */
type Params = { categoria: string; subcategoria: string; nivel3: string };

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<RawParams>;
}): Promise<Metadata> {
  const [{ nivel3 }, raw] = await Promise.all([params, searchParams]);
  const q = typeof raw.q === 'string' ? raw.q : undefined;
  // Manda el ÚLTIMO segmento — el mismo criterio que la canonicalización.
  return categoryMetadata(nivel3, q);
}

export default async function CategoriaNivel3Page({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<RawParams>;
}) {
  const { categoria, subcategoria, nivel3 } = await params;
  return (
    <CategoryListingPage
      segments={[categoria, subcategoria, nivel3]}
      searchParams={searchParams}
    />
  );
}
