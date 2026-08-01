import { SITE_URL } from '@/config';

/**
 * A1 — JSON-LD `BreadcrumbList` (schema.org) para las migas de categoría y de ficha.
 *
 * Ahora que las URLs reflejan el árbol (/vehiculos/coches), la jerarquía es un dato
 * real que merece la pena declarar: Google la usa para pintar la ruta en el resultado
 * de búsqueda en vez de la URL cruda.
 *
 * Se construye siempre a partir de la MISMA lista que renderiza la miga visible, no
 * de una copia paralela — un breadcrumb estructurado que no coincide con el visible
 * es exactamente lo que las directrices de datos estructurados prohíben.
 *
 * "Inicio" se antepone aquí, así que quien llama pasa solo el rastro de categorías
 * (y, en la ficha, el título del anuncio).
 */
export interface BreadcrumbCrumb {
  name: string;
  /** Ruta absoluta del sitio (empezando por "/"). */
  path: string;
}

export function breadcrumbJsonLd(trail: BreadcrumbCrumb[]) {
  const items = [{ name: 'Inicio', path: '/' }, ...trail];
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((crumb, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: crumb.name,
      item: `${SITE_URL}${crumb.path}`,
    })),
  };
}
