import { unstable_cache } from 'next/cache';
import { apiFetch } from './client';

export interface FooterNavItem {
  label: string;
  href: string;
  external: boolean;
}

// name=null → columna sin encabezado en el render. Ya viene resuelto y
// ordenado desde el backend (FooterService.listPublicNav: PAGE → /paginas/
// {slug} solo si PUBLISHED, INTERNAL/EXTERNAL → url tal cual) — el frontend
// solo mapea, no reimplementa esa semántica.
export interface FooterNavColumn {
  name: string | null;
  items: FooterNavItem[];
}

function getFooterNav(): Promise<FooterNavColumn[]> {
  return apiFetch<FooterNavColumn[]>('/footer');
}

// El footer vive en un layout compartido por páginas con dinamismo dispar
// (/blog es ISR a 3600s, /busqueda es esencialmente dinámica) — atarlo al
// revalidate de una ruta concreta no tiene sentido. unstable_cache lo aísla
// por completo: la query nunca corre por request, solo cuando el TTL expira
// (red de seguridad, no la vía principal) o cuando revalidateTag('footer-nav')
// se dispara explícitamente desde FooterService (CRUD/reorder de columnas o
// ítems) o desde BlogService (publicar/despublicar/borrar una PAGE enlazada
// — ver /api/revalidate).
export const getCachedFooterNav = unstable_cache(
  () => getFooterNav(),
  ['footer-nav'],
  { revalidate: 3600, tags: ['footer-nav'] },
);
