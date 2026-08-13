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

/**
 * PROFUNDIDAD N — RÁFAGA 3. Espejo de `CATEGORY_MAX_DEPTH` (api,
 * category.types.ts): ninguna URL de categoría legítima tiene más segmentos que
 * niveles admite el árbol. Duplicado aquí por lo mismo que el resto de espejos
 * api↔web: no hay paquete compartido.
 *
 * Subirlo exige además añadir la ruta correspondiente en `app/(public)` — ver la
 * nota de la constante en el backend.
 */
const MAX_CATEGORY_SEGMENTS = 4;

/** TTL del mapa en memoria. Corto: un admin que mueve una categoría de padre ve
 *  el redirect nuevo en menos de un minuto, y el coste es UNA petición por minuto
 *  y por instancia, no una por visita. */
const MAP_TTL_MS = 60_000;

interface CategoryNode {
  slug: string;
  children?: CategoryNode[];
}

/**
 * slug → CADENA de ancestros (de la raíz al padre inmediato). `[]` = raíz.
 *
 * PROFUNDIDAD N — RÁFAGA 3: era `slug → slug del padre`. Guardar la cadena
 * entera es lo que permite reconstruir la URL canónica de cualquier nivel sin
 * volver a recorrer el árbol.
 */
type AncestorMap = ReadonlyMap<string, string[]>;

let cached: { at: number; map: AncestorMap } | null = null;
let inFlight: Promise<AncestorMap | null> | null = null;

/**
 * Mapa slug→cadena de ancestros, memoizado en el módulo. Devuelve `null` si no
 * se pudo obtener: quien llama debe entonces NO redirigir (fail-open — la página
 * sigue sirviéndose, solo que en una URL no canónica, que es infinitamente mejor
 * que un 500 en toda la navegación por un fallo de la API).
 *
 * `inFlight` deduplica: una ráfaga de peticiones con el mapa frío dispara UNA
 * sola llamada, no una por petición.
 */
async function getAncestorMap(now: number, forzarRecarga = false): Promise<AncestorMap | null> {
  if (!forzarRecarga && cached && now - cached.at < MAP_TTL_MS) return cached.map;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await fetch(`${API_URL}/categories`, { cache: 'no-store' });
      if (!res.ok) return null;
      const tree = (await res.json()) as CategoryNode[];
      const map = new Map<string, string[]>();
      // PROFUNDIDAD N — RÁFAGA 3: recorrido recursivo. Era un doble bucle
      // (raíces → hijas), que dejaba fuera del mapa cualquier categoría más
      // profunda: su URL no se habría podido canonicalizar nunca.
      const recorrer = (nodos: CategoryNode[], ancestros: string[]) => {
        for (const nodo of nodos) {
          map.set(nodo.slug, ancestros);
          recorrer(nodo.children ?? [], [...ancestros, nodo.slug]);
        }
      };
      recorrer(tree, []);
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

  const map = await getAncestorMap(now);
  if (!map) return null;

  const leaf = segments[segments.length - 1];
  if (!map.has(leaf)) return null; // no es una categoría: que la página decida (404)

  const canonical = categoryPath({ slug: leaf, ancestorSlugs: map.get(leaf) });
  return canonical === pathname ? null : canonical;
}

/**
 * A partir de cuántos segmentos actúa la guarda de 404. Ver `isUnknownCategoryPath`.
 */
const PROFUNDIDAD_MINIMA_PARA_GUARDA = 3;

/**
 * PROFUNDIDAD N — RÁFAGA 3. ¿Esta ruta CASA con una ruta de categoría NUEVA pero
 * NO es una categoría? Es decir: ¿hay que producir un 404 REAL antes de renderizar?
 *
 * POR QUÉ HACE FALTA. Hasta esta ráfaga sólo existían las rutas de 1 y 2
 * segmentos, así que `/a/b/c` no casaba con ninguna y el ROUTER daba un 404 de
 * verdad. Al añadir las rutas de nivel 3 y 4, esas URLs pasan a casar y llegan al
 * componente — y ahí `notFound()` NO produce un 404 real: `app/loading.tsx` en la
 * raíz hace que Next mande la cabecera 200 antes de ejecutar la página, así que
 * sale un 404 BLANDO (200 + UI de 404). Está medido en este repo, y es el mismo
 * mecanismo por el que el 308 tuvo que mudarse al middleware.
 *
 * SÓLO A PARTIR DE 3 SEGMENTOS, y esto es una corrección deliberada. La primera
 * versión aplicaba la guarda desde 1 segmento «de propina», para cerrar de paso
 * el 404 blando que ya existía en `/xxx-no-existe`. Eso CAMBIABA el
 * comportamiento de rutas que esta ráfaga no debía tocar, y rompió el criterio de
 * cierre del trabajo de URLs anidadas (`/inmuebles` respondió 404 en CI: ver
 * abajo). La guarda existe para tapar la regresión que introducen las rutas
 * nuevas, no para mejorar lo que ya estaba: 1 y 2 segmentos se comportan
 * EXACTAMENTE como antes. El 404 blando de una raíz inexistente sigue anotado
 * como deuda aparte, igual que estaba.
 *
 * LA AUSENCIA EN LA CACHÉ NO ES PRUEBA DE INEXISTENCIA. `getAncestorMap` es una
 * FOTO con TTL de un minuto: una categoría creada después de la foto no está en
 * ella y no por eso deja de existir. Fue justo lo que falló en CI —una categoría
 * que la propia batería acababa de crear respondió 404—, así que antes de afirmar
 * que una ruta no existe se RECARGA el mapa y se vuelve a mirar. Un 404 es una
 * afirmación fuerte y destructiva: se paga una petición por confirmarla.
 *
 * FAIL-OPEN: sin mapa (API caída) devuelve `false` — se prefiere servir un 404
 * blando a 404-ear una categoría legítima por un fallo de red.
 */
export async function isUnknownCategoryPath(
  pathname: string,
  now = Date.now(),
): Promise<boolean> {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length < PROFUNDIDAD_MINIMA_PARA_GUARDA) return false;
  if (segments.length > MAX_CATEGORY_SEGMENTS) return false;
  if (RESERVED_FIRST_SEGMENTS.has(segments[0])) return false;

  const leaf = segments[segments.length - 1];

  const map = await getAncestorMap(now);
  if (!map) return false;
  if (map.has(leaf)) return false;

  // No está en la foto. Puede que no exista... o que sea MÁS NUEVA que la foto.
  const fresco = await getAncestorMap(now, true);
  if (!fresco) return false;
  return !fresco.has(leaf);
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

  const map = await getAncestorMap(now);
  // Sin mapa no se redirige: /busqueda?category= sigue funcionando como siempre
  // (el backend acepta el param), que es el fallo seguro.
  if (!map || !map.has(slug)) return null;

  const rest = new URLSearchParams(search);
  rest.delete('category');
  const query = rest.toString();

  return categoryPath({ slug, ancestorSlugs: map.get(slug) }) + (query ? `?${query}` : '');
}

/** Solo para tests: vacía la memoización entre casos. */
export function __resetCategoryCanonicalCache(): void {
  cached = null;
  inFlight = null;
}
