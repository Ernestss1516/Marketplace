import { API_URL } from '@/config';
import { categoryPath } from '@/lib/category-url';

/**
 * A1 — canonicalización de URLs de categoría PARA EL MIDDLEWARE.
 *
 * ¿Por qué en el middleware y no con `permanentRedirect()` dentro de la página,
 * que era el mecanismo aprobado (P1)?
 *
 * Porque en ESTE proyecto no puede funcionar, y se comprobó ejerciéndolo. Existe
 * un `src/app/loading.tsx` en la RAÍZ de la app, así que Next envuelve toda ruta
 * en un límite de Suspense y **descarga la cabecera con 200 antes** de que el
 * componente de página llegue a ejecutarse. Medido sobre el servidor real:
 *
 *   con app/loading.tsx:   GET /coches → 200 (+ redirect de cliente en el payload)
 *   sin app/loading.tsx:   GET /coches → 308 Location: /vehiculos/coches
 *
 * Un 200 con redirect de cliente NO consolida señales de SEO: para un crawler es
 * una página que responde 200 en la URL vieja, justo lo que A1 tiene que evitar.
 * Y quitar el `loading.tsx` global cambiaría el estado de carga de TODO el sitio,
 * que no es un efecto que A1 deba causar.
 *
 * El middleware corre ANTES de renderizar nada, así que emite un 308 de verdad.
 * Se conserva la decisión de fondo de P1 —redirect permanente derivado de la base
 * de datos, sin tabla estática que mantener—; lo único que cambia es dónde vive.
 * La página mantiene su propia canonicalización como red de seguridad (ver
 * resolveCanonicalCategory): si el mapa de aquí está frío o la API falla, el
 * usuario acaba igualmente en la URL correcta, solo que sin el 308.
 */

/** Segmentos de primer nivel que son rutas del sitio, no categorías. Espejo de
 *  RESERVED_ROOT_SLUGS en el backend (admin.service.ts), que impide crear una
 *  categoría raíz con uno de estos slugs. Aquí sirve para lo contrario: no mirar
 *  siquiera el mapa de categorías en rutas que nunca lo son — y, sobre todo,
 *  para no reescribir /anuncio/coches (un anuncio cuyo slug coincida con el de
 *  una categoría) creyendo que es una categoría mal anidada. */
const RESERVED_FIRST_SEGMENTS: ReadonlySet<string> = new Set([
  'anuncio', 'blog', 'busqueda', 'contacto', 'paginas', 'planes', 'vendedor',
  'favoritos', 'mensajes', 'mis-alertas', 'mis-anuncios', 'mis-creditos', 'mis-tickets',
  'notificaciones', 'perfil', 'publicar',
  'login', 'recuperar', 'registro', 'restablecer', 'verificar-email',
  'admin', 'api', '_next',
]);

/** El árbol es de 2 niveles (assertParentIsRoot), así que ninguna URL de
 *  categoría legítima pasa de dos segmentos. */
const MAX_CATEGORY_SEGMENTS = 2;

/** TTL del mapa en memoria. Corto: un admin que mueve una categoría de padre ve
 *  el redirect nuevo en menos de un minuto, y el coste es UNA petición por minuto
 *  y por instancia, no una por visita. */
const MAP_TTL_MS = 60_000;

interface CategoryNode {
  slug: string;
  children?: { slug: string }[];
}

/** slug → slug del padre (null si es raíz). */
type ParentMap = ReadonlyMap<string, string | null>;

let cached: { at: number; map: ParentMap } | null = null;
let inFlight: Promise<ParentMap | null> | null = null;

/**
 * Mapa slug→padre, memoizado en el módulo. Devuelve `null` si no se pudo
 * obtener: quien llama debe entonces NO redirigir (fail-open — la página sigue
 * sirviéndose, solo que en una URL no canónica, que es infinitamente mejor que
 * un 500 en toda la navegación por un fallo de la API).
 *
 * `inFlight` deduplica: una ráfaga de peticiones con el mapa frío dispara UNA
 * sola llamada, no una por petición.
 */
async function getParentMap(now: number): Promise<ParentMap | null> {
  if (cached && now - cached.at < MAP_TTL_MS) return cached.map;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch(`${API_URL}/categories`, { cache: 'no-store' });
      if (!res.ok) return null;
      const tree = (await res.json()) as CategoryNode[];
      const map = new Map<string, string | null>();
      for (const root of tree) {
        map.set(root.slug, null);
        for (const child of root.children ?? []) map.set(child.slug, root.slug);
      }
      cached = { at: now, map };
      return map;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Dada la ruta pedida, devuelve la ruta CANÓNICA a la que redirigir, o `null`
 * si no hay que redirigir (ya es canónica, no es una categoría, o no se pudo
 * resolver el mapa).
 *
 * LA REGLA ES UNA SOLA: **manda el último segmento**. Se resuelve la categoría
 * por él y se compara con la ruta pedida. Eso cubre de una vez la URL vieja
 * plana (/coches), el padre incoherente (/inmuebles/coches) y el padre
 * inexistente (/lo-que-sea/coches) — sin ninguna tabla de redirects que
 * mantener, y siguiendo al día cualquier cambio de padre que haga un admin.
 */
export async function resolveCategoryRedirect(
  pathname: string,
  now = Date.now(),
): Promise<string | null> {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0 || segments.length > MAX_CATEGORY_SEGMENTS) return null;
  if (RESERVED_FIRST_SEGMENTS.has(segments[0])) return null;

  const map = await getParentMap(now);
  if (!map) return null;

  const leaf = segments[segments.length - 1];
  if (!map.has(leaf)) return null; // no es una categoría: que la página decida (404)

  const canonical = categoryPath({ slug: leaf, parentSlug: map.get(leaf) });
  return canonical === pathname ? null : canonical;
}

/**
 * A2 (P3) — `/busqueda?category=X` es la OTRA forma de pedir una categoría, heredada de
 * antes de que existiera la ruta propia. Deja dos URLs compitiendo por el mismo
 * contenido, que es exactamente el problema de SEO que A1 vino a cerrar, así que se
 * canonicaliza igual: 308 a la ruta de la categoría, con el RESTO de la query intacto
 * (`category` se cae porque pasa a ser el path).
 *
 * Se activó tras comprobar que ningún flujo interno depende de que esa URL renderice en
 * su sitio: en el frontend ya no queda ningún generador (A1 migró los chips de portada y
 * el bloque CMS a `categoryPath`), y no aparece en plantillas de email, ni en enlaces del
 * footer, banners, patrocinados o bloques guardados en base de datos — se auditaron las
 * dos bases. Un redirect que rompe un flujo interno sería peor que la duplicación que
 * arregla; aquí no hay tal flujo.
 *
 * Devuelve la ruta destino (con query) o `null` si no aplica.
 */
export async function resolveSearchCategoryRedirect(
  pathname: string,
  search: URLSearchParams,
  now = Date.now(),
): Promise<string | null> {
  if (pathname !== '/busqueda') return null;

  const slug = search.get('category');
  if (!slug) return null;

  const map = await getParentMap(now);
  // Sin mapa no se redirige: /busqueda?category= sigue funcionando como siempre
  // (el backend acepta el param), que es el fallo seguro.
  if (!map || !map.has(slug)) return null;

  const rest = new URLSearchParams(search);
  rest.delete('category');
  const query = rest.toString();

  return categoryPath({ slug, parentSlug: map.get(slug) }) + (query ? `?${query}` : '');
}

/** Solo para tests: vacía la memoización entre casos. */
export function __resetCategoryCanonicalCache(): void {
  cached = null;
  inFlight = null;
}
