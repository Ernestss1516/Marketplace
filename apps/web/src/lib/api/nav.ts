import { unstable_cache } from 'next/cache';
import { apiFetch } from './client';

/**
 * Los 9 tipos de página de (public) donde la barra puede mostrarse. Espejo del
 * enum NavPageType del backend — el frontend no tiene Prisma, igual que
 * BannerPlacement se declara a mano en lib/api/banners.ts.
 *
 * Cada layout anidado de (public) declara el suyo como literal (RN.3), del
 * mismo modo que cada página llama a getActiveBanners('HOME').
 */
export type NavPageType =
  | 'HOME'
  | 'BUSQUEDA'
  | 'CATEGORIA'
  | 'ANUNCIO'
  | 'BLOG'
  | 'PAGINA_CMS'
  | 'VENDEDOR'
  | 'CONTACTO'
  | 'PLANES';

/**
 * Nodo YA resuelto por el backend: árbol podado por el gate recursivo, ordenado
 * y con el href calculado (PAGE → /paginas/{slug} solo si está PUBLISHED,
 * INTERNAL/EXTERNAL → url tal cual). El frontend SOLO mapea — no reimplementa
 * esa semántica, igual que con FooterNavColumn.
 *
 * `href: null` = nodo solo-desplegable: no navega, únicamente abre sus hijos.
 * Un array raíz vacío significa que la barra no debe renderizarse en absoluto.
 */
export interface NavNode {
  label: string;
  href: string | null;
  external: boolean;
  children: NavNode[];
}

function getNav(pageType: NavPageType): Promise<NavNode[]> {
  return apiFetch<NavNode[]>(`/nav?pageType=${pageType}`);
}

/**
 * DIVERGE DEL FOOTER, y a propósito: getCachedFooterNav tiene UNA entrada con
 * clave constante, porque `GET /footer` no filtra nada. Aquí el endpoint SÍ
 * filtra por tipo de página, así que la clave lleva `pageType` y hay hasta 9
 * entradas — una por NavPageType.
 *
 * POR QUÉ ESO NO COMPLICA LA INVALIDACIÓN: `unstable_cache` deriva la CLAVE de
 * `keyParts`, pero guarda los TAGS por entrada, independientes de la clave
 * (verificado en next/dist/server/web/spec-extension/unstable-cache.js: la
 * clave sale de `keyParts.join(',')`, los tags viajan aparte hasta el
 * `set` del caché). Como las 9 entradas comparten el tag 'main-nav', un solo
 * `revalidateTag('main-nav')` desde NavService o BlogService las tumba todas.
 *
 * POR QUÉ NO SE FILTRA EN EL FRONTEND (que permitiría una sola entrada): quitar
 * un hijo por `visibleOn` puede vaciar a su padre, así que filtrar por tipo
 * obliga a ejecutar el gate recursivo ENTERO. Eso metería la lógica de
 * visibilidad en Next, contra la regla del proyecto de que el negocio vive solo
 * en Nest. Ver docs/diseno-nav-dinamico.md §4.3.
 *
 * `revalidate: 3600` es red de seguridad, no la vía principal: lo normal es que
 * la entrada muera por tag en cuanto un admin toca el nav o publica/despublica
 * una página enlazada.
 */
export function getCachedNav(pageType: NavPageType): Promise<NavNode[]> {
  return unstable_cache(() => getNav(pageType), ['main-nav', pageType], {
    revalidate: 3600,
    tags: ['main-nav'],
  })();
}
