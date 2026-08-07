import type { HomeBlock, HomepageConfig } from '@/types/home-blocks';
import { apiFetch } from './client';

/**
 * Cliente de la API de admin de portada. Molde `footer-admin.ts` / `nav-admin.ts`,
 * con una diferencia de fondo: **no hay CRUD por fila**. La portada es una
 * configuración de UNA fila y los bloques son un Json dentro de ella, así que
 * solo hay leer y guardar-entero — igual que el submit de `PostForm` en el blog,
 * que manda el array `blocks` completo y no una petición por bloque.
 */

/** Cuerpo de `PATCH /admin/homepage`: reemplazo COMPLETO (hero + bloques). */
export interface UpdateHomepagePayload {
  heroStaticTitle: string;
  heroRotatingOptions?: string[];
  heroRotationMs?: number;
  heroSubtitle?: string;
  blocks: HomeBlock[];
}

export function getAdminHomepage(token: string): Promise<HomepageConfig> {
  return apiFetch<HomepageConfig>('/admin/homepage', { token });
}

export function updateHomepage(
  token: string,
  payload: UpdateHomepagePayload,
): Promise<HomepageConfig> {
  return apiFetch<HomepageConfig>('/admin/homepage', {
    method: 'PATCH',
    token,
    body: JSON.stringify(payload),
  });
}
