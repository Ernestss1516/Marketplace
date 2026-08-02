import type { Category, CategoryWithSchema, TagSuggestion } from '@/types';
import { apiFetch } from './client';

export function getCategories(): Promise<Category[]> {
  return apiFetch<Category[]>('/categories');
}

export function getCategoryBySlug(slug: string): Promise<CategoryWithSchema> {
  return apiFetch<CategoryWithSchema>(`/categories/${slug}`);
}

/**
 * B4 — sugerencias de etiqueta para el buscador de portada.
 *
 * Público (sin token) y con `cache: 'no-store'`: el conteo cambia con cada publicación
 * y el backend ya cachea 5 min en Redis, así que una segunda capa aquí solo añadiría
 * desfase. Un fallo devuelve lista vacía en vez de propagar: el buscador debe seguir
 * funcionando sin sugerencias.
 */
export async function suggestTags(
  q: string,
  category?: string,
  signal?: AbortSignal,
): Promise<TagSuggestion[]> {
  const params = new URLSearchParams({ q });
  if (category) params.set('category', category);
  try {
    return await apiFetch<TagSuggestion[]>(`/tags/suggest?${params}`, {
      cache: 'no-store',
      signal,
    });
  } catch {
    return [];
  }
}
