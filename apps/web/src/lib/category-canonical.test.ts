// A1 — canonicalización de URLs de categoría en el middleware. Es lo que emite el
// 308 real (la página no puede: app/loading.tsx fuerza streaming y la cabecera 200
// sale antes — ver el comentario largo de category-canonical.ts).

import { resolveCategoryRedirect, __resetCategoryCanonicalCache } from './category-canonical';

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

  it('≥3 segmentos: ni se mira (el árbol es de 2 niveles)', async () => {
    expect(await resolveCategoryRedirect('/a/b/coches')).toBeNull();
    expect(await resolveCategoryRedirect('/a/b/c/d')).toBeNull();
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
