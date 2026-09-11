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

/**
 * COOKIES RÁFAGA 1 (D3) — ¿pidió el usuario ESTA vista, o le vino dada?
 *
 * Ver docs/diseno-consentimiento-cookies.md §1.5.
 *
 * La diferencia importa porque el mapa carga tiles desde MapTiler, un tercero que recibe
 * la IP del visitante. D3 dice que **pulsar «Mapa» es pedir el mapa**, y pedirlo es
 * consentirlo; pero aterrizar en una categoría cuyo `defaultView` es `MAPA` no es pedir
 * nada, y ahí el tercero no puede cargar sin más.
 *
 * **La señal ya existía y no hubo que inventarla**: `resolveCurrentView` recibe el
 * parámetro CRUDO de la URL, así que «venía `?view=mapa`» distingue los dos casos. Esta
 * función sólo le pone nombre a esa comparación para que el gate no la reimplemente.
 *
 * Un enlace compartido con `?view=mapa` cuenta como solicitud: abrir un enlace a un mapa
 * es pedir un mapa. Y como es una propiedad de la URL y no del usuario, **es cacheable**
 * — puede viajar en el HTML estático sin romper el ISR. Ésa es la razón por la que D3
 * sale barato.
 */
export function usuarioPidioVista(
  viewParam: string | undefined,
  allowedViews: ListingViewMode[],
  view: ListingViewMode,
): boolean {
  const parsed = viewParam ? PARAM_TO_VIEW[viewParam] : undefined;
  return parsed === view && allowedViews.includes(view);
}
