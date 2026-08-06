import { unstable_cache } from 'next/cache';
import type { HomepageConfig } from '@/types/home-blocks';
import { apiFetch } from './client';

/**
 * Config servida si la API no responde. NO es un caso teórico: la portada es la
 * ruta más visitada del sitio y no puede quedarse sin `<h1>` porque el backend
 * esté reiniciando. Misma red de seguridad que el `.catch(() => [])` del footer
 * (Footer.tsx:9) y del nav (MainNav.tsx:39), pero aquí el fallback tiene que
 * llevar contenido: una lista vacía se puede no pintar, un titular no.
 *
 * Reproduce el <h1> que la home pintaba a mano antes de RP.1.
 */
export const FALLBACK_HOMEPAGE_CONFIG: HomepageConfig = {
  heroStaticTitle: 'Compra y vende de segunda mano',
  heroRotatingOptions: [],
  heroRotationMs: 3000,
  heroSubtitle: null,
  blocks: [],
};

function getHomepageConfig(): Promise<HomepageConfig> {
  return apiFetch<HomepageConfig>('/homepage');
}

/**
 * UNA entrada, clave constante, un tag — molde exacto de `getCachedFooterNav`
 * (footer.ts:31-35), y NO el del nav, que necesita nueve entradas porque su
 * endpoint filtra por tipo de página. `GET /homepage` no filtra nada.
 *
 * POR QUÉ unstable_cache y no el revalidate de la ruta: la portada se renderiza
 * DINÁMICAMENTE en cada petición —el layout raíz hace `await auth()`
 * (app/layout.tsx:18), igual que `Header` (Header.tsx:9)— y eso no se toca
 * (docs/diseno-portada.md, decisión 4). unstable_cache aísla la config de esa
 * dinámica por completo: la consulta no corre por request, solo cuando expira el
 * TTL o cuando `revalidateTag('homepage-config')` se dispara desde
 * HomepageService al guardar en el backoffice.
 *
 * `revalidate: 3600` es red de seguridad, no la vía principal: lo normal es que
 * la entrada muera por tag en cuanto un admin toca la portada.
 */
export const getCachedHomepageConfig = unstable_cache(
  () => getHomepageConfig(),
  ['homepage-config'],
  { revalidate: 3600, tags: ['homepage-config'] },
);
