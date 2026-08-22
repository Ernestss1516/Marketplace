/**
 * FICHA F2 (P6) — LOS FILTROS VIVEN EN LA URL, Y ES UNA DECISIÓN.
 *
 * POR QUÉ LA URL Y NO ESTADO DEL COMPONENTE. Un filtro que sólo existe en
 * memoria no se puede compartir («mira estos tres, están todos del mismo
 * vendedor»), no sobrevive a la vuelta atrás del navegador —el moderador entra
 * en una ficha y vuelve a una lista en blanco, que era lo que pasaba antes— y no
 * se puede enlazar desde otra pantalla. Con la URL, `/admin/anuncios?sellerId=X`
 * es un enlace que cualquiera puede poner, y de hecho la ficha lo pone.
 *
 * SE EXTRAE A UN MÓDULO PURO —y no se resuelve con `useSearchParams` esparcido
 * por el componente— por el mismo motivo que `moderacion-routing.ts`: es una
 * traducción con reglas (qué se omite, qué se normaliza, cuándo se resetea la
 * página), y así se puede probar sin montar la pantalla.
 *
 * LA REGLA QUE GOBIERNA TODO: **lo que está en su valor por defecto NO se
 * escribe en la URL.** Sin eso, `/admin/anuncios` recién abierto se convertiría
 * en un churro de ocho parámetros vacíos y nadie querría compartirlo.
 */

import type { AdminListingsFilters, AdminListingsOrder } from '@/lib/api/admin';

/** Los órdenes ofrecidos en la UI, con la pregunta que responde cada uno. */
export const ORDENES: { value: AdminListingsOrder; label: string }[] = [
  { value: 'recent', label: 'Movido recientemente' },
  { value: 'oldest', label: 'Sin mover hace más tiempo' },
  { value: 'created-desc', label: 'Creado (nuevo primero)' },
  { value: 'created-asc', label: 'Creado (viejo primero)' },
  { value: 'price-desc', label: 'Precio (mayor primero)' },
  { value: 'price-asc', label: 'Precio (menor primero)' },
  { value: 'reports-desc', label: 'Más denunciados' },
];

const ORDENES_VALIDOS = new Set(ORDENES.map((o) => o.value));

/** El orden por defecto. Omitirlo y mandarlo son lo mismo — ver `aQueryString`. */
export const ORDEN_POR_DEFECTO: AdminListingsOrder = 'recent';

/**
 * Lee los filtros de la URL. Todo lo desconocido se ignora en silencio en vez de
 * romper la pantalla: una URL compartida puede venir de una versión anterior, y
 * el coste de un parámetro que sobra es cero.
 */
export function leerFiltros(params: URLSearchParams): AdminListingsFilters {
  const orden = params.get('order');
  const lista = (clave: string) => {
    const v = params
      .get(clave)
      ?.split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return v?.length ? v : undefined;
  };

  return {
    q: params.get('q') || undefined,
    statuses: lista('statuses'),
    categoryId: params.get('categoryId') || undefined,
    sellerId: params.get('sellerId') || undefined,
    hasReports: leerBooleano(params.get('hasReports')),
    needsRevalidation: leerBooleano(params.get('needsRevalidation')),
    // ETIQUETA INTERNA (P1, E2) — el sexto eje, con la misma forma que los demás.
    triage: lista('triage'),
    watched: leerBooleano(params.get('watched')),
    // PUNTO 6 · RÁFAGA A — el séptimo eje, con la misma forma que los demás. Que entre
    // otra vez «con un campo en el DTO, una línea en el `where` y un par de claves aquí»
    // es lo que F2 prometió, y van tres ejes seguidos sin que la forma cambie.
    hasDetections: leerBooleano(params.get('hasDetections')),
    detector: leerDetector(params.get('detector')),
    // A1 — «viene de una IP marcada». Otro eje con la misma forma; no es un detector.
    ipFlagged: leerBooleano(params.get('ipFlagged')),
    // Teléfono, provincia y municipio: tres ejes más con la misma forma. Van SUELTOS y no
    // dentro de `q` — «de Toledo» y «menciona Toledo» son preguntas distintas, y un
    // identificador como el teléfono se busca entero (igual que la IP).
    phone: params.get('phone') || undefined,
    province: params.get('province') || undefined,
    city: params.get('city') || undefined,
    createdFrom: params.get('createdFrom') || undefined,
    createdTo: params.get('createdTo') || undefined,
    order:
      orden && ORDENES_VALIDOS.has(orden as AdminListingsOrder)
        ? (orden as AdminListingsOrder)
        : undefined,
    page: leerPagina(params.get('page')),
  };
}

/**
 * `undefined` = sin filtro; `true`/`false` = las dos preguntas contrarias. No se
 * colapsa el ausente en `false`, porque «los que NO tienen denuncias» es una
 * pregunta útil y distinta de «me da igual».
 */
function leerBooleano(valor: string | null): boolean | undefined {
  if (valor === 'true') return true;
  if (valor === 'false') return false;
  return undefined;
}

/**
 * PUNTO 6 · RÁFAGA A — un detector desconocido se IGNORA, no rompe la pantalla.
 *
 * Mismo criterio que el resto del módulo («todo lo desconocido se ignora en silencio»): una
 * URL compartida puede venir de una versión anterior, o de una posterior con un detector que
 * aquí todavía no existe. Mandarlo tal cual al backend sería un 400 por un enlace pegado.
 */
const DETECTORES = new Set(['WORD', 'PHONE', 'PHONE_LIST']);

function leerDetector(valor: string | null): AdminListingsFilters['detector'] {
  return valor && DETECTORES.has(valor)
    ? (valor as AdminListingsFilters['detector'])
    : undefined;
}

function leerPagina(valor: string | null): number {
  const n = Number(valor);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * Escribe los filtros en una query string, OMITIENDO todo lo que está por
 * defecto. `aQueryString({})` devuelve `''`, así que la lista sin filtrar tiene
 * la URL limpia con la que se entra.
 */
export function aQueryString(filtros: AdminListingsFilters): string {
  const qs = new URLSearchParams();
  if (filtros.q?.trim()) qs.set('q', filtros.q.trim());
  if (filtros.statuses?.length) qs.set('statuses', filtros.statuses.join(','));
  if (filtros.categoryId) qs.set('categoryId', filtros.categoryId);
  if (filtros.sellerId) qs.set('sellerId', filtros.sellerId);
  if (filtros.hasReports !== undefined) qs.set('hasReports', String(filtros.hasReports));
  if (filtros.needsRevalidation !== undefined) {
    qs.set('needsRevalidation', String(filtros.needsRevalidation));
  }
  if (filtros.triage?.length) qs.set('triage', filtros.triage.join(','));
  if (filtros.watched !== undefined) qs.set('watched', String(filtros.watched));
  if (filtros.hasDetections !== undefined) {
    qs.set('hasDetections', String(filtros.hasDetections));
  }
  if (filtros.detector) qs.set('detector', filtros.detector);
  if (filtros.ipFlagged !== undefined) qs.set('ipFlagged', String(filtros.ipFlagged));
  if (filtros.phone?.trim()) qs.set('phone', filtros.phone.trim());
  if (filtros.province?.trim()) qs.set('province', filtros.province.trim());
  if (filtros.city?.trim()) qs.set('city', filtros.city.trim());
  if (filtros.createdFrom) qs.set('createdFrom', filtros.createdFrom);
  if (filtros.createdTo) qs.set('createdTo', filtros.createdTo);
  if (filtros.order && filtros.order !== ORDEN_POR_DEFECTO) qs.set('order', filtros.order);
  if (filtros.page && filtros.page > 1) qs.set('page', String(filtros.page));
  return qs.toString();
}

/**
 * ¿Hay algún filtro puesto? Gobierna si se ofrece «Limpiar». La PÁGINA y el
 * ORDEN no cuentan: no acotan el conjunto, sólo cómo se mira, y ofrecer
 * «limpiar» por estar en la página 2 sería confuso.
 */
export function hayFiltros(filtros: AdminListingsFilters): boolean {
  return Boolean(
    filtros.q?.trim() ||
      filtros.statuses?.length ||
      filtros.categoryId ||
      filtros.sellerId ||
      filtros.hasReports !== undefined ||
      filtros.needsRevalidation !== undefined ||
      filtros.triage?.length ||
      filtros.watched !== undefined ||
      filtros.hasDetections !== undefined ||
      filtros.detector ||
      filtros.ipFlagged !== undefined ||
      filtros.phone?.trim() ||
      filtros.province?.trim() ||
      filtros.city?.trim() ||
      filtros.createdFrom ||
      filtros.createdTo,
  );
}

/**
 * Tocar cualquier control DEVUELVE A LA PÁGINA 1, y es un arreglo, no un
 * detalle: filtrar estando en la página 7 de un conjunto que ahora tiene dos
 * deja la pantalla vacía, y eso se lee como «el filtro no ha encontrado nada».
 *
 * Vale también para el ORDEN, que sí conserva el conjunto: se reordena para ver
 * lo que ha quedado ARRIBA —lo más caro, lo más denunciado—, y quedarse en la
 * página 7 después de pedirlo no le sirve a nadie.
 */
export function conFiltro(
  filtros: AdminListingsFilters,
  cambio: Partial<AdminListingsFilters>,
): AdminListingsFilters {
  return { ...filtros, ...cambio, page: 1 };
}
