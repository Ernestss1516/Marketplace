import type { ListingViewMode } from '@/types';

// RÁFAGA 2 — vistas configurables. Valores de URL en español, coherentes con
// el resto de rutas públicas (CLAUDE.md: contenido de cara al usuario en
// español). 'mapa' ya existía como valor de `?view=`; se preserva para no
// romper enlaces compartidos anteriores a esta ráfaga.
export const VIEW_PARAM: Record<ListingViewMode, string> = {
  LISTA: 'lista',
  AMPLIADA: 'ampliada',
  MAPA: 'mapa',
};

const PARAM_TO_VIEW: Record<string, ListingViewMode> = {
  lista: 'LISTA',
  ampliada: 'AMPLIADA',
  mapa: 'MAPA',
};

/**
 * Resuelve la vista actual a partir de `?view=` de la URL. Si el parámetro es
 * inválido, ausente, o la categoría no lo permite, cae al `defaultView` de la
 * categoría — la categoría define el menú (allowedViews), el usuario elige
 * del menú; nunca se ofrece (ni se aplica en silencio) una vista fuera de él.
 */
export function resolveCurrentView(
  viewParam: string | undefined,
  allowedViews: ListingViewMode[],
  defaultView: ListingViewMode,
): ListingViewMode {
  const parsed = viewParam ? PARAM_TO_VIEW[viewParam] : undefined;
  return parsed && allowedViews.includes(parsed) ? parsed : defaultView;
}
