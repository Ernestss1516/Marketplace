import type { Metadata } from 'next';
import {
  CategoryListingPage,
  categoryMetadata,
  type RawParams,
} from '@/components/categorias/CategoryListingPage';

/**
 * A1 — categoría RAÍZ: /vehiculos. Su URL NO cambia con las rutas anidadas.
 * La hija vive en `[categoria]/[subcategoria]` y comparte todo el cuerpo con
 * esta: aquí solo se decide de qué segmentos se compone la ruta.
 */
type Params = { categoria: string };

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { categoria } = await params;
  return categoryMetadata(categoria);
}

export default async function CategoriaRaizPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<RawParams>;
}) {
  const { categoria } = await params;
  return <CategoryListingPage segments={[categoria]} searchParams={searchParams} />;
}
