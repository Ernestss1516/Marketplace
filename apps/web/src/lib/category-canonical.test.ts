// A1 — canonicalización de URLs de categoría en el middleware. Es lo que emite el
// 308 real (la página no puede: app/loading.tsx fuerza streaming y la cabecera 200
// sale antes — ver el comentario largo de category-canonical.ts).

import {
  isUnknownCategoryPath,
  resolveCategoryRedirect,
  resolveSearchCategoryRedirect,
  __resetCategoryCanonicalCache,
} from './category-canonical';

const TREE = [
  { slug: 'vehiculos', children: [{ slug: 'coches' }, { slug: 'motos' }] },
  { slug: 'inmuebles', children: [{ slug: 'pisos' }] },
  { slug: 'servicios', children: [] },
];

const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

function okTree() {
  return Promise.resolve({ ok: true, json: () => Promise.resolve(TREE) });
}

beforeEach(() => {
  __resetCategoryCanonicalCache();
  fetchMock.mockReset();
  fetchMock.mockImplementation(okTree);
});

describe('resolveCategoryRedirect — manda el último segmento', () => {
  it('URL vieja plana de una hija → canónica anidada', async () => {
    expect(await resolveCategoryRedirect('/coches')).toBe('/vehiculos/coches');
  });

  it('padre incoherente → canónica del último segmento', async () => {
    expect(await resolveCategoryRedirect('/inmuebles/coches')).toBe('/vehiculos/coches');
  });

  it('padre inexistente → canónica del último segmento', async () => {
    expect(await resolveCategoryRedirect('/lo-que-sea/coches')).toBe('/vehiculos/coches');
  });

  it('la canónica de una hija NO redirige', async () => {
    expect(await resolveCategoryRedirect('/vehiculos/coches')).toBeNull();
  });

  it('una raíz NO redirige: su URL no cambia con A1', async () => {
    expect(await resolveCategoryRedirect('/vehiculos')).toBeNull();
    expect(await resolveCategoryRedirect('/servicios')).toBeNull();
  });

  it('una raíz con un segundo segmento que no es hija suya redirige a la raíz sola', async () => {
    // "manda el último segmento" no aplica aquí: 'vehiculos' ES el último segmento
    // de /inmuebles/vehiculos y es raíz, así que su canónica es /vehiculos.
    expect(await resolveCategoryRedirect('/inmuebles/vehiculos')).toBe('/vehiculos');
  });
});

describe('resolveCategoryRedirect — qué NO toca', () => {
  it('rutas del sitio con un segmento', async () => {
    for (const p of ['/busqueda', '/publicar', '/blog', '/login', '/admin', '/perfil']) {
      expect(await resolveCategoryRedirect(p)).toBeNull();
    }
  });

  it('un anuncio cuyo slug coincide con el de una categoría NO se reescribe', async () => {
    // Sin la lista de primeros segmentos reservados, /anuncio/coches acabaría
    // redirigido a /vehiculos/coches: el anuncio se volvería inalcanzable.
    expect(await resolveCategoryRedirect('/anuncio/coches')).toBeNull();
    expect(await resolveCategoryRedirect('/blog/coches')).toBeNull();
    expect(await resolveCategoryRedirect('/mis-anuncios/coches')).toBeNull();
  });

  /**
   * PROFUNDIDAD N — RÁFAGA 3: REGLA ACTUALIZADA. Este caso decía que ≥3
   * segmentos «ni se miran, el árbol es de 2 niveles». Ya no: el árbol admite
   * hasta CATEGORY_MAX_DEPTH (4), así que 3 y 4 segmentos SÍ son rutas de
   * categoría candidatas y hay que resolverlas.
   *
   * Lo que se conserva es el corte por arriba, que es lo que este caso protegía
   * de verdad: pasado el tope no se consulta nada. Sube de 2 a 4.
   */
  it('un padre incoherente de 3 segmentos SÍ se canonicaliza (el árbol llega a 4 niveles)', async () => {
    // Manda el último segmento: `coches` es hija de `vehiculos`, así que la
    // ruta pedida no es la suya y se redirige a la canónica.
    expect(await resolveCategoryRedirect('/a/b/coches')).toBe('/vehiculos/coches');
  });

  it('pasado el tope de segmentos no se consulta nada', async () => {
    expect(await resolveCategoryRedirect('/a/b/c/d/e')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('la raíz del sitio', async () => {
    expect(await resolveCategoryRedirect('/')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un slug que no es ninguna categoría: lo resuelve la página (404), no el middleware', async () => {
    expect(await resolveCategoryRedirect('/xxx-no-existe')).toBeNull();
  });
});

// A2 (P3) — /busqueda?category=X es la otra forma, heredada, de pedir una categoría.
// Se canonicaliza a su ruta propia para no dejar dos URLs compitiendo por el mismo
// contenido (el problema de SEO que A1 vino a cerrar).
describe('resolveSearchCategoryRedirect', () => {
  const buscar = (qs: string) => resolveSearchCategoryRedirect('/busqueda', new URLSearchParams(qs));

  it('redirige a la ruta de la categoría y QUITA `category` (pasa a ser el path)', async () => {
    expect(await buscar('category=coches')).toBe('/vehiculos/coches');
  });

  it('una raíz va a su URL plana', async () => {
    expect(await buscar('category=vehiculos')).toBe('/vehiculos');
  });

  it('conserva el RESTO de la query intacto', async () => {
    const destino = await buscar('category=coches&q=golf&province=Madrid&minPrice=1000');
    const url = new URL(destino!, 'http://x');
    expect(url.pathname).toBe('/vehiculos/coches');
    expect(url.searchParams.get('q')).toBe('golf');
    expect(url.searchParams.get('province')).toBe('Madrid');
    expect(url.searchParams.get('minPrice')).toBe('1000');
    expect(url.searchParams.has('category')).toBe(false);
  });

  it('/busqueda SIN category no redirige: es la búsqueda global de siempre', async () => {
    expect(await buscar('q=golf')).toBeNull();
    expect(await buscar('')).toBeNull();
  });

  it('una categoría que no existe no redirige (que responda /busqueda como siempre)', async () => {
    expect(await buscar('category=no-existe')).toBeNull();
  });

  it('no toca ninguna otra ruta', async () => {
    const qs = new URLSearchParams('category=coches');
    expect(await resolveSearchCategoryRedirect('/', qs)).toBeNull();
    expect(await resolveSearchCategoryRedirect('/blog', qs)).toBeNull();
    expect(await resolveSearchCategoryRedirect('/vehiculos/coches', qs)).toBeNull();
  });

  it('si la API no responde NO redirige: /busqueda?category= sigue funcionando (fail-open)', async () => {
    fetchMock.mockRejectedValue(new Error('API caída'));
    expect(await buscar('category=coches')).toBeNull();
  });
});

describe('resolveCategoryRedirect — caché y tolerancia a fallos', () => {
  it('memoiza el árbol: varias rutas seguidas hacen UNA sola petición', async () => {
    await resolveCategoryRedirect('/coches', 1_000);
    await resolveCategoryRedirect('/motos', 1_000);
    await resolveCategoryRedirect('/pisos', 1_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('pasado el TTL vuelve a pedirlo — un cambio de padre se refleja en <1 min', async () => {
    await resolveCategoryRedirect('/coches', 1_000);
    await resolveCategoryRedirect('/coches', 1_000 + 61_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('si la API falla NO redirige (fail-open): la página se sirve, aunque sea en URL no canónica', async () => {
    fetchMock.mockRejectedValue(new Error('API caída'));
    expect(await resolveCategoryRedirect('/coches')).toBeNull();
  });

  it('una respuesta no-OK tampoco redirige', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: () => Promise.resolve([]) });
    expect(await resolveCategoryRedirect('/coches')).toBeNull();
  });

  it('un fallo no envenena la caché: la siguiente petición vuelve a intentarlo', async () => {
    fetchMock.mockRejectedValueOnce(new Error('caída puntual'));
    expect(await resolveCategoryRedirect('/coches')).toBeNull();

    fetchMock.mockImplementation(okTree);
    expect(await resolveCategoryRedirect('/coches')).toBe('/vehiculos/coches');
  });

  it('una ráfaga concurrente con la caché fría dispara UNA sola petición', async () => {
    const [a, b, c] = await Promise.all([
      resolveCategoryRedirect('/coches'),
      resolveCategoryRedirect('/motos'),
      resolveCategoryRedirect('/pisos'),
    ]);
    expect([a, b, c]).toEqual(['/vehiculos/coches', '/vehiculos/motos', '/inmuebles/pisos']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * PROFUNDIDAD N — RÁFAGA 3. La guarda que produce el 404 REAL de las rutas
 * NUEVAS (3-4 segmentos).
 *
 * Existe porque al añadir esas rutas, una URL profunda inválida pasa a casar con
 * una ruta de Next y llega al componente — donde `notFound()` sólo puede producir
 * un 404 blando (200 + UI), por el `app/loading.tsx` de la raíz.
 */
describe('isUnknownCategoryPath — el 404 real de las rutas nuevas', () => {
  it('NO actúa sobre 1 ni 2 segmentos: ahí todo queda como estaba', async () => {
    // Es la contención que importa. La primera versión de esta guarda actuaba
    // desde 1 segmento «de propina» —para cerrar el 404 blando preexistente— y
    // eso cambiaba el comportamiento de rutas que esta ráfaga no debía tocar.
    expect(await isUnknownCategoryPath('/no-existe')).toBe(false);
    expect(await isUnknownCategoryPath('/vehiculos/no-existe')).toBe(false);
    // Ni siquiera consulta el árbol: no es asunto suyo.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('3 y 4 segmentos cuyo último segmento no es categoría → 404', async () => {
    expect(await isUnknownCategoryPath('/a/b/c')).toBe(true);
    expect(await isUnknownCategoryPath('/a/b/c/d')).toBe(true);
  });

  it('3 segmentos cuyo último segmento SÍ es categoría → no es un 404 (lo canonicaliza el 308)', async () => {
    expect(await isUnknownCategoryPath('/a/b/coches')).toBe(false);
  });

  it('pasado el tope de segmentos no es asunto suyo (lo 404-ea el router)', async () => {
    expect(await isUnknownCategoryPath('/a/b/c/d/e')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('un primer segmento reservado no es una ruta de categoría', async () => {
    expect(await isUnknownCategoryPath('/anuncio/b/c')).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sin árbol (API caída) NO se 404-ea nada: fail-open', async () => {
    fetchMock.mockRejectedValue(new Error('API caída'));
    expect(await isUnknownCategoryPath('/a/b/c')).toBe(false);
  });

  /**
   * LA REGRESIÓN QUE ESTA GUARDA PROVOCÓ EN CI, fijada aquí.
   *
   * El mapa es una FOTO con TTL: una categoría creada DESPUÉS de la foto no está
   * en ella, y no por eso deja de existir. La primera versión concluía «no está
   * en la caché ⇒ no existe» y devolvía 404 sobre categorías legítimas recién
   * creadas — dos suites de Playwright se pusieron rojas por eso.
   *
   * Un 404 es una afirmación fuerte: antes de hacerla se recarga el mapa.
   */
  it('una categoría MÁS NUEVA que la foto cacheada NO se 404-ea: se reconsulta antes de afirmar', async () => {
    // 1) Se calienta la caché con un árbol que todavía no tiene `nueva`.
    expect(await isUnknownCategoryPath('/a/b/c')).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2); // foto inicial + confirmación

    // 2) La categoría se crea DESPUÉS. La foto cacheada sigue sin conocerla.
    fetchMock.mockImplementation(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve([...TREE, { slug: 'raiz-nueva', children: [{ slug: 'hija-nueva', children: [{ slug: 'nueva' }] }] }]),
      }),
    );

    // 3) Sin la reconsulta esto sería un 404 sobre una categoría que existe.
    expect(await isUnknownCategoryPath('/raiz-nueva/hija-nueva/nueva')).toBe(false);
  });
});
