/**
 * BÚSQUEDA+TAGS — RÁFAGA A1: URLs anidadas de categoría.
 *
 * ESTE ES EL CRITERIO DE CIERRE DE A1. El riesgo de la ráfaga es de SEO —URLs
 * viejas que dejan de resolver—, así que la verificación NO es una muestra: el
 * primer bloque recorre `GET /categories` y comprueba TODAS las hijas del árbol,
 * una por una. Si mañana se siembra una categoría nueva, este test la cubre solo.
 *
 * Contrato que se verifica:
 *   - Toda URL vieja de HIJA (/coches) → 308 a la canónica (/vehiculos/coches).
 *   - La query se preserva INTACTA en el redirect (una URL indexada con filtros
 *     debe llegar a la nueva con los mismos filtros).
 *   - Las RAÍCES no cambian de URL: /vehiculos sigue respondiendo 200.
 *   - Un padre incoherente (/inmuebles/coches) redirige a la canónica: manda el
 *     último segmento.
 *   - Un slug inexistente es 404, y ≥3 segmentos es 404 SIN consultar la API.
 *   - Breadcrumb de 3 niveles, JSON-LD BreadcrumbList, canonical y sitemap.
 */

import { test, expect, type APIRequestContext } from '@playwright/test';

interface ApiCategory {
  slug: string;
  name: string;
  children?: { slug: string; name: string; parentSlug?: string }[];
}

async function fetchTree(request: APIRequestContext): Promise<ApiCategory[]> {
  const res = await request.get('http://localhost:3001/api/categories');
  expect(res.ok(), 'GET /categories debe responder para poder recorrer el árbol').toBeTruthy();
  return (await res.json()) as ApiCategory[];
}

/** Petición SIN seguir redirects — necesario para ver el 308 y su Location. */
function raw(request: APIRequestContext, path: string) {
  return request.get(path, { maxRedirects: 0 });
}

test.describe('A1 — URLs anidadas de categoría', () => {
  // ── CRITERIO DE CIERRE: verificación TRANSVERSAL sobre TODO el árbol ───────
  test('TODA hija del árbol redirige permanentemente de su URL vieja a la anidada', async ({ request }) => {
    const tree = await fetchTree(request);

    const children = tree.flatMap((root) =>
      (root.children ?? []).map((child) => ({ parent: root.slug, slug: child.slug })),
    );
    // Si esto falla, el árbol sembrado no tiene hijas y el test no probaría nada.
    expect(children.length, 'el árbol debe tener hijas que verificar').toBeGreaterThan(0);

    const fallos: string[] = [];
    for (const { parent, slug } of children) {
      const res = await raw(request, `/${slug}`);
      const location = res.headers()['location'];
      const esperado = `/${parent}/${slug}`;
      if (res.status() !== 308 || location !== esperado) {
        fallos.push(`/${slug} → ${res.status()} ${location ?? '(sin Location)'} (esperado 308 ${esperado})`);
      }
    }

    // Se acumulan y se reportan TODOS los fallos de una vez: si se rompen 5
    // categorías, verlas las 5 dice mucho más que abortar en la primera.
    expect(fallos, `Hijas cuya URL vieja no redirige a la canónica:\n${fallos.join('\n')}`).toEqual([]);
    console.log(`[A1] ${children.length} hijas verificadas: todas redirigen 308 a su URL anidada.`);
  });

  // La contrapartida, también sobre TODO el árbol: la URL canónica de una raíz es la
  // plana (/vehiculos), es decir, ninguna raíz ha ganado un prefijo de padre.
  //
  // Se comprueba SIN renderizar, con una sonda: se pide /{sonda}/{raiz}. Como manda
  // el último segmento, el servidor resuelve la raíz y redirige a SU canónica — y esa
  // canónica es justo lo que este test quiere leer. Si una raíz empezara a resolverse
  // como hija, el Location traería un prefijo y el test fallaría.
  //
  // Pedir /{raiz} directamente sería la comprobación ingenua, pero como una raíz NO
  // redirige, cada petición renderiza su página entera: la base de test arrastra ~1.800
  // categorías de otras baterías y eso son ~1.800 SSR (>5 min, y con 5xx de datos
  // sucios ajenos a A1). La sonda mide exactamente la misma propiedad —qué canónica
  // asigna el servidor a cada raíz— al coste de un redirect. Las raíces sembradas sí
  // se piden de verdad, en el test siguiente.
  test('NINGUNA raíz del árbol gana prefijo de padre: su canónica sigue siendo /{raiz}', async ({ request }) => {
    test.setTimeout(180_000);
    const tree = await fetchTree(request);
    expect(tree.length, 'el árbol debe tener raíces que verificar').toBeGreaterThan(0);

    const fallos: string[] = [];
    for (const root of tree) {
      const res = await raw(request, `/zzz-sonda-a1/${root.slug}`);
      const location = res.headers()['location'];
      if (res.status() !== 308 || location !== `/${root.slug}`) {
        fallos.push(`/${root.slug} → canónica ${location ?? `(sin redirect, ${res.status()})`} (esperado /${root.slug})`);
      }
    }

    expect(fallos, `Raíces cuya URL canónica ha cambiado:\n${fallos.join('\n')}`).toEqual([]);
    console.log(`[A1] ${tree.length} raíces verificadas: todas conservan su URL plana como canónica.`);
  });

  test('las raíces sembradas siguen sirviéndose con 200 (no solo "sin redirect")', async ({ request }) => {
    for (const slug of ['vehiculos', 'inmuebles']) {
      expect((await raw(request, `/${slug}`)).status(), `/${slug} debe seguir respondiendo 200`).toBe(200);
    }
  });

  // ── Preservación de la query en el redirect ────────────────────────────────
  test('el redirect preserva la query intacta — una URL vieja con filtros no pierde los filtros', async ({ request }) => {
    const res = await raw(request, '/coches?type=PRODUCT&minPrice=1000');
    expect(res.status()).toBe(308);

    const location = res.headers()['location'];
    const url = new URL(location, 'http://localhost:3000');
    expect(url.pathname).toBe('/vehiculos/coches');
    expect(url.searchParams.get('type')).toBe('PRODUCT');
    expect(url.searchParams.get('minPrice')).toBe('1000');
  });

  // ── "Manda el último segmento" ─────────────────────────────────────────────
  test('un padre incoherente redirige a la canónica: /inmuebles/coches → /vehiculos/coches', async ({ request }) => {
    const res = await raw(request, '/inmuebles/coches');
    expect(res.status()).toBe(308);
    expect(res.headers()['location']).toBe('/vehiculos/coches');
  });

  test('un padre inexistente también redirige a la canónica del último segmento', async ({ request }) => {
    const res = await raw(request, '/lo-que-sea/coches');
    expect(res.status()).toBe(308);
    expect(res.headers()['location']).toBe('/vehiculos/coches');
  });

  test('la URL canónica se sirve directamente, sin redirect', async ({ request }) => {
    const res = await raw(request, '/vehiculos/coches');
    expect(res.status()).toBe(200);
  });

  // ── 404s ───────────────────────────────────────────────────────────────────
  test('≥3 segmentos sigue dando un 404 REAL del router — no lo absorbe la ruta de categoría', async ({ request }) => {
    // Esta es la razón de modelar 2 rutas explícitas ([categoria] y
    // [categoria]/[subcategoria]) en vez de un catch-all [...ruta]: el catch-all
    // habría capturado también estas rutas y las habría convertido en un 404
    // BLANDO (200 + UI de 404, por el streaming que impone app/loading.tsx) —
    // una regresión de SEO justo en la ráfaga que viene a arreglar el SEO.
    //
    // El caso fuerte es /a/b/coches: el último segmento ES una categoría válida.
    // Si la ruta de categoría lo capturara, respondería 308 a /vehiculos/coches.
    // Un 404 demuestra que no casa con ninguna ruta, igual que antes de A1.
    expect((await raw(request, '/a/b/coches')).status()).toBe(404);
    expect((await raw(request, '/a/b/c/d')).status()).toBe(404);
  });

  test('un slug de categoría inexistente pinta el 404 (comportamiento heredado, sin cambios)', async ({ page }) => {
    // OJO — estado PRE-EXISTENTE, medido contra la rama base antes de tocar nada:
    // un slug desconocido devuelve 200 con la UI de 404 (404 "blando"), porque
    // `app/loading.tsx` en la raíz hace que Next mande la cabecera antes de que la
    // página llame a notFound(). Ya era así con la ruta /[categoria] anterior, así
    // que A1 no lo introduce ni lo empeora. Se afirma lo que de verdad se garantiza
    // —que el usuario ve la página de "no encontrada"— en vez de codificar como
    // deseado un estado que no lo es. Arreglarlo exige tocar el loading global:
    // fuera del alcance de A1, anotado para decidir aparte.
    await page.goto('/xxx-no-existe');
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();

    await page.goto('/vehiculos/xxx-no-existe');
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible();
  });

  // ── Breadcrumb, JSON-LD y canonical ────────────────────────────────────────
  test('la miga de una hija refleja el árbol: Inicio > Vehículos > Coches', async ({ page }) => {
    await page.goto('/vehiculos/coches');

    const crumb = page.getByLabel('Breadcrumb');
    await expect(crumb.getByRole('link', { name: 'Inicio' })).toBeVisible();
    // El padre es un ENLACE navegable (antes ni siquiera aparecía).
    await expect(crumb.getByRole('link', { name: 'Vehículos' })).toHaveAttribute('href', '/vehiculos');
    // La hoja es texto, no enlace: ya estás en ella.
    await expect(crumb).toContainText('Coches');
  });

  test('la miga de una raíz sigue siendo de dos niveles: Inicio > Vehículos', async ({ page }) => {
    await page.goto('/vehiculos');
    const crumb = page.getByLabel('Breadcrumb');
    await expect(crumb.getByRole('link', { name: 'Inicio' })).toBeVisible();
    await expect(crumb).toContainText('Vehículos');
    // Sin padre que enlazar: "Vehículos" es la hoja de la miga aquí.
    await expect(crumb.getByRole('link', { name: 'Vehículos' })).toHaveCount(0);
  });

  test('JSON-LD BreadcrumbList presente y coherente con la miga visible', async ({ page }) => {
    await page.goto('/vehiculos/coches');

    const bloques = await page.locator('script[type="application/ld+json"]').allTextContents();
    const breadcrumb = bloques
      .map((t) => JSON.parse(t) as Record<string, unknown>)
      .find((j) => j['@type'] === 'BreadcrumbList');

    expect(breadcrumb, 'debe existir un bloque BreadcrumbList').toBeDefined();
    const items = breadcrumb!.itemListElement as { position: number; name: string; item: string }[];
    expect(items.map((i) => i.name)).toEqual(['Inicio', 'Vehículos', 'Coches']);
    expect(items.map((i) => i.position)).toEqual([1, 2, 3]);
    expect(items[2].item).toContain('/vehiculos/coches');
  });

  test('la ficha de un anuncio lleva su miga de 4 niveles y el JSON-LD correspondiente', async ({ page, request }) => {
    // Se busca un anuncio de la categoría cuya FICHA responda de verdad. No vale
    // coger el primer hit y confiar: el índice de la base de test arrastra documentos
    // huérfanos de baterías anteriores (21 documentos de "coches" indexados frente a
    // 12 anuncios ACTIVE reales), y un hit rancio da un 404 que no dice nada sobre A1.
    const res = await request.get('http://localhost:3001/api/search?category=coches&hitsPerPage=20');
    const body = (await res.json()) as { hits: { slug: string }[] };

    // Se pregunta al BACKEND, no a la página: `/anuncio/{slug}` responde 200 aunque el
    // anuncio no exista (404 blando por el streaming — ver el test de 404 de arriba),
    // así que su código de estado no distingue vivo de rancio. `GET /listings/{slug}`
    // sí devuelve un 404 real.
    let slugVivo: string | null = null;
    for (const hit of body.hits) {
      if (!hit.slug) continue;
      const ficha = await request.get(`http://localhost:3001/api/listings/${hit.slug}`);
      if (ficha.status() === 200) {
        slugVivo = hit.slug;
        break;
      }
    }
    test.skip(slugVivo === null, 'sin ninguna ficha viva en coches — nada que verificar aquí');

    await page.goto(`/anuncio/${slugVivo}`);

    const crumb = page.getByLabel('Breadcrumb');
    await expect(crumb.getByRole('link', { name: 'Vehículos' })).toHaveAttribute('href', '/vehiculos');
    await expect(crumb.getByRole('link', { name: 'Coches' })).toHaveAttribute('href', '/vehiculos/coches');

    const bloques = await page.locator('script[type="application/ld+json"]').allTextContents();
    const breadcrumb = bloques
      .map((t) => JSON.parse(t) as Record<string, unknown>)
      .find((j) => j['@type'] === 'BreadcrumbList');
    expect(breadcrumb, 'la ficha también declara su BreadcrumbList').toBeDefined();
    const items = breadcrumb!.itemListElement as { name: string }[];
    expect(items.slice(0, 3).map((i) => i.name)).toEqual(['Inicio', 'Vehículos', 'Coches']);
  });

  test('la canónica apunta a la URL anidada', async ({ page }) => {
    await page.goto('/vehiculos/coches');
    const canonical = page.locator('link[rel="canonical"]');
    await expect(canonical).toHaveAttribute('href', /\/vehiculos\/coches$/);
  });

  // ── Sitemap ────────────────────────────────────────────────────────────────
  //
  // Se comprueba contra las categorías SEMBRADAS, no contra el árbol vivo, y la razón
  // es de producción, no de comodidad: `sitemap.ts` es una ruta ESTÁTICA — Next la
  // prerenderiza en `next build` (existe `.next/server/app/sitemap.xml.body`), así que
  // su contenido es el del build, no el de la base de datos en el momento de pedirlo.
  // Exigir que coincida con el árbol vivo haría fallar el test cuando build y runtime
  // apuntan a bases distintas, sin que nada de A1 esté mal. Lo que A1 garantiza —que
  // las categorías estén, y con la URL anidada— sí se comprueba, sobre las que el seed
  // asegura en cualquier base. La cobertura "todo el árbol" la dan los tests de
  // redirect de arriba, que no dependen del build.
  test('el sitemap incluye las categorías y SIEMPRE con la URL anidada', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    const base = 'http://localhost:3000';

    // Antes de A1 el sitemap no tenía NINGUNA categoría.
    expect(xml, 'la raíz sembrada debe estar').toContain(`<loc>${base}/vehiculos</loc>`);
    expect(xml, 'la hija sembrada debe estar, anidada').toContain(`<loc>${base}/vehiculos/coches</loc>`);

    // Y NUNCA con su URL plana: un sitemap que anuncia URLs que redirigen manda al
    // crawler a hacer un salto extra por cada una.
    expect(xml).not.toContain(`<loc>${base}/coches</loc>`);
    expect(xml).not.toContain(`<loc>${base}/moviles</loc>`);
  });

  // ── Enlaces internos: ninguno apunta ya a la URL plana de una hija ─────────
  test('los enlaces de categoría de la portada ya son canónicos (no gastan un redirect)', async ({ page, request }) => {
    const tree = await fetchTree(request);
    const hijas = new Set(tree.flatMap((r) => (r.children ?? []).map((c) => c.slug)));

    await page.goto('/');
    const hrefs = await page.locator('a[href]').evaluateAll((as) =>
      as.map((a) => a.getAttribute('href') ?? ''),
    );

    // Un enlace interno a la URL PLANA de una hija dispararía un redirect desde
    // dentro del propio sitio: gasta crawl budget y es señal negativa.
    const planos = hrefs.filter((h) => hijas.has(h.replace(/^\//, '').split('?')[0]));
    expect(planos, `Enlaces a la URL plana de una hija: ${planos.join(', ')}`).toEqual([]);
  });
});
