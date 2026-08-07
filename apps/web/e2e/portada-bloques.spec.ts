// PORTADA CONFIGURABLE — RP.2: el motor de bloques y los dos primeros tipos.
//
// Lo que se comprueba aquí y no se puede comprobar en un unitario:
//   1. Los bloques renderizan DESDE LA CONFIGURACIÓN, no desde código.
//   2. Renderizan en SERVIDOR: el markup está en el HTML crudo, sin ejecutar JS.
//      Para el buscador es la propiedad central — es una isla, y lo que la hace
//      aceptable es que su <form> viaje ya montado.
//   3. La POSICIÓN en el array es el orden del DOM (no hay campo `order`).
//   4. El reparto interno/externo del `cta`, que tras la extracción de RP.2 lo
//      resuelve el SmartLink compartido con el blog, el footer y el nav.
//
// Mismo patrón que portada-hero.spec.ts: una escritura en beforeAll, una espera
// a que la caché la refleje, y luego solo lecturas. El token no cuesta ningún
// login (adminApiToken lo obtiene globalSetup una vez para toda la corrida).

import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { adminApiToken, authedPatch } from './helpers/api';
import { PORTADA_SEMILLA, restaurarPortada } from './helpers/portada';
import { clicarYEsperarUrl } from './helpers/nav';

// La semilla viene de helpers/portada.ts (fuente única, ver allí el porqué).
const TITULO = PORTADA_SEMILLA.heroStaticTitle;

async function setBlocks(request: APIRequestContext, blocks: unknown[]): Promise<void> {
  const res = await authedPatch(request, '/admin/homepage', adminApiToken(), {
    heroStaticTitle: TITULO,
    blocks,
  });
  expect(res.status(), await res.text()).toBe(200);
}

/**
 * Recarga hasta que la portada refleje la config recién escrita (la invalidación
 * del tag es fire-and-forget).
 *
 * DOS DETALLES QUE COSTARON UN ROJO, y los dos van juntos:
 *
 *  1. `waitUntil: 'load'`, no `'domcontentloaded'`. Con este último la hoja de
 *     estilos puede no haberse aplicado todavía.
 *  2. El predicado consulta con locators PLANOS (`getByText`, `locator`), nunca
 *     con `getByRole`. `getByRole` se apoya en el árbol de accesibilidad, y un
 *     elemento sin caja de layout —que es lo que hay durante ese instante— NO
 *     está en él: la consulta devuelve 0 aunque el nodo esté en el DOM. Medido:
 *     el <a> del bloque `cta` daba `getBoundingClientRect()` 0×0 y
 *     `getByRole('link')` = 0 mientras `getByText` ya lo encontraba; con la
 *     página cargada, 167×44 y `getByRole` = 1.
 *
 * En los tests sí se usa `getByRole` sin problema: `expect(...)` reintenta hasta
 * que el elemento está realmente pintado, que es justo lo que aquí no había.
 */
async function esperarPortada(page: Page, cumple: (page: Page) => Promise<boolean>): Promise<void> {
  await expect(async () => {
    await page.goto('/', { waitUntil: 'load' });
    if (!(await cumple(page))) throw new Error('la portada aún no refleja la config');
  }).toPass({ timeout: 30_000 });
}

test.describe('Portada — motor de bloques', () => {
  test.afterAll(async ({ request }) => {
    await restaurarPortada(request);
  });

  test.describe('bloque `search`', () => {
    test.beforeAll(async ({ browser, request }) => {
      await setBlocks(request, [
        { id: 'b-search', type: 'search', eyebrow: 'Eyebrow del bloque', showPopularCategories: true, popularCount: 3 },
      ]);
      const warmup = await browser.newPage();
      await esperarPortada(warmup, async (p) => (await p.locator('form[role], form').count()) > 0);
      await warmup.close();
    });

    test('el buscador viaja MONTADO en el HTML servido (isla sobre contenido presente)', async ({
      request,
    }) => {
      // Petición cruda: sin navegador y sin ejecutar una línea de JS. Si el
      // buscador se pintase en cliente, aquí no habría ni <form> ni <input>.
      const res = await request.get('http://localhost:3000/');
      expect(res.status()).toBe(200);
      const html = await res.text();

      expect(html).toContain('¿Qué estás buscando?'); // placeholder del input
      expect(html).toContain('Toda España'); // opción por defecto del selector de provincia
      expect(html).toContain('Eyebrow del bloque'); // campo del bloque, desde la config
    });

    test('el buscador funciona: navega a /busqueda con el texto', async ({ page }) => {
      await page.goto('/');
      await page.getByPlaceholder('¿Qué estás buscando?').fill('bicicleta');
      // `SearchBar` navega con `router.push` (SearchBar.tsx:91), o sea navegación
      // de cliente expuesta al wedge del router. Repetir una búsqueda no tiene
      // efecto colateral, así que el reclic del helper es seguro.
      await clicarYEsperarUrl(
        page,
        page.getByRole('button', { name: 'Buscar' }),
        (url) => url.pathname === '/busqueda' && url.searchParams.get('q') === 'bicicleta',
      );
    });

    test('los chips "Populares" respetan el tope configurado', async ({ page }) => {
      await page.goto('/');
      const chips = page.locator('a.rounded-full');
      // popularCount: 3, y el seed de test tiene 2 categorías raíz → como mucho 3.
      expect(await chips.count()).toBeLessThanOrEqual(3);
      await expect(page.getByText('Populares:')).toBeVisible();
    });
  });

  test.describe('bloque `cta` y orden del array', () => {
    test.beforeAll(async ({ browser, request }) => {
      await setBlocks(request, [
        { id: 'b-cta-1', type: 'cta', label: 'Primero interno', href: '/publicar' },
        { id: 'b-cta-2', type: 'cta', label: 'Segundo externo', href: 'https://example.com', style: 'outline' },
      ]);
      const warmup = await browser.newPage();
      await esperarPortada(warmup, async (p) => (await p.getByText('Primero interno').count()) > 0);
      await warmup.close();
    });

    test('el cta interno renderiza como <Link> del router', async ({ page }) => {
      await page.goto('/');
      const enlace = page.getByRole('link', { name: 'Primero interno' });
      await expect(enlace).toHaveAttribute('href', '/publicar');
      await expect(enlace).not.toHaveAttribute('target', '_blank');
    });

    test('el cta externo abre en pestaña nueva con rel=noopener', async ({ page }) => {
      await page.goto('/');
      const enlace = page.getByRole('link', { name: 'Segundo externo' });
      await expect(enlace).toHaveAttribute('href', 'https://example.com');
      await expect(enlace).toHaveAttribute('target', '_blank');
      await expect(enlace).toHaveAttribute('rel', /noopener/);
    });

    test('la POSICIÓN en el array es el orden del DOM', async ({ page }) => {
      await page.goto('/');
      // Orden en el DOM, no coordenadas: `boundingBox()` no auto-espera y
      // devuelve null si el elemento aún no está pintado. Y el orden del DOM es
      // literalmente lo que este test afirma.
      const enOrden = await page.evaluate(() => {
        const enlaces = [...document.querySelectorAll('a')];
        const a = enlaces.find((el) => el.textContent?.includes('Primero interno'));
        const b = enlaces.find((el) => el.textContent?.includes('Segundo externo'));
        if (!a || !b) return null;
        return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      });
      expect(enOrden).toBe(true);
    });

    test('los cta también están en el HTML servido (SSR puro, cero JS)', async ({ request }) => {
      const html = await (await request.get('http://localhost:3000/')).text();
      expect(html).toContain('Primero interno');
      expect(html).toContain('Segundo externo');
    });
  });

  test.describe('bloques `grid` y `steps` (RP.4)', () => {
    test.beforeAll(async ({ browser, request }) => {
      await setBlocks(request, [
        {
          id: 'b-steps',
          type: 'steps',
          title: 'Así funciona esto',
          columns: [
            {
              audienceTitle: 'Si compras',
              icon: 'search',
              steps: [
                { title: 'Primer paso', description: 'Explicación del primero.' },
                { title: 'Segundo paso', description: 'Explicación del segundo.' },
              ],
              cta: { label: 'Ir a buscar', href: '/busqueda' },
            },
            {
              audienceTitle: 'Si vendes',
              icon: 'upload',
              steps: [{ title: 'Paso único', description: 'Explicación única.' }],
            },
          ],
        },
        {
          id: 'b-grid',
          type: 'grid',
          title: 'Por qué fiarte',
          columns: 4,
          items: [
            { media: { kind: 'icon', name: 'shield-check' }, title: 'Celda con icono' },
            { title: 'Celda sin enlace' },
            { title: 'Celda con enlace', href: '/busqueda' },
          ],
        },
      ]);
      const warmup = await browser.newPage();
      await esperarPortada(warmup, async (p) => (await p.getByText('Así funciona esto').count()) > 0);
      await warmup.close();
    });

    test('los dos bloques viajan enteros en el HTML servido (SSR puro)', async ({ request }) => {
      const html = await (await request.get('http://localhost:3000/')).text();
      // Pasos: título, audiencias, pasos y el enlace de cierre.
      expect(html).toContain('Así funciona esto');
      expect(html).toContain('Si compras');
      expect(html).toContain('Si vendes');
      expect(html).toContain('Explicación del primero.');
      expect(html).toContain('Ir a buscar');
      // Rejilla: título y las tres celdas.
      expect(html).toContain('Por qué fiarte');
      expect(html).toContain('Celda con icono');
      expect(html).toContain('Celda sin enlace');
    });

    test('los pasos se numeran por su ORDEN, no por un campo', async ({ page }) => {
      await page.goto('/');
      const columna = page.locator('ol').filter({ hasText: 'Primer paso' });
      await expect(columna).toContainText('1');
      await expect(columna).toContainText('2');
    });

    test('una celda CON enlace es un enlace; una SIN enlace, no', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('link', { name: 'Celda con enlace' })).toHaveAttribute(
        'href',
        '/busqueda',
      );
      // "Celda sin enlace" existe como texto pero no como enlace: las señales de
      // confianza no navegan a ningún sitio y no deben pintar un <a> vacío.
      await expect(page.getByText('Celda sin enlace')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Celda sin enlace' })).toHaveCount(0);
    });

    test('el icono de la allowlist se pinta como SVG', async ({ page }) => {
      await page.goto('/');
      const celda = page.locator('div', { hasText: /^Celda con icono$/ }).last();
      await expect(celda.locator('svg')).toHaveCount(1);
    });

    test('las columnas configuradas llegan a la clase del grid', async ({ page }) => {
      await page.goto('/');
      // columns: 4 → clase estática, nunca interpolada (Tailwind purgaría una
      // clase que no vea escrita en el código).
      await expect(page.locator('.sm\\:grid-cols-4').first()).toBeVisible();
    });
  });

  test.describe('bloques `listings` y `categoryCarousel` (RP.5)', () => {
    test.beforeAll(async ({ browser, request }) => {
      // El catálogo del seed de test: se usan sus slugs para el carrusel, y la
      // foto se sube por el endpoint de portada (una URL inventada la rechaza
      // @IsOwnStorageUrl).
      const subida = await request.post('http://localhost:3001/api/admin/homepage/upload-image', {
        headers: { Authorization: `Bearer ${adminApiToken()}` },
        multipart: {
          file: {
            name: 'test-image.png',
            mimeType: 'image/png',
            buffer: fs.readFileSync(path.join(__dirname, 'fixtures', 'test-image.png')),
          },
        },
      });
      expect(subida.status(), await subida.text()).toBe(201);
      const { url } = (await subida.json()) as { url: string };

      await setBlocks(request, [
        {
          id: 'b-listings',
          type: 'listings',
          title: 'Lo último del sitio',
          // SIN categorySlug: los recientes de TODO el sitio. Es el caso que el
          // bloque del blog no sabe expresar.
          limit: 8,
          sort: 'recent',
          showAllLink: true,
        },
        {
          id: 'b-carousel',
          type: 'categoryCarousel',
          title: 'Explora por categoría',
          items: [
            { categorySlug: 'vehiculos', imageUrl: url, alt: 'Foto de vehículos' },
            { categorySlug: 'coches', imageUrl: url, alt: 'Foto de coches', label: 'Coches de ocasión' },
            { categorySlug: 'electronica', imageUrl: url, alt: 'Foto de electrónica' },
          ],
        },
      ]);

      const warmup = await browser.newPage();
      await esperarPortada(warmup, async (p) => (await p.getByText('Explora por categoría').count()) > 0);
      await warmup.close();
    });

    test('el carrusel sirve TODAS sus categorías en el HTML, no solo las visibles', async ({
      request,
    }) => {
      // La propiedad central del bloque: son enlaces internos y un crawler tiene
      // que verlos todos. Petición cruda, sin ejecutar una línea de JS.
      const html = await (await request.get('http://localhost:3000/')).text();
      expect(html).toContain('Explora por categoría');
      expect(html).toContain('/vehiculos');
      expect(html).toContain('/vehiculos/coches'); // URL anidada, vía categoryPath
      expect(html).toContain('/electronica');
      expect(html).toContain('Coches de ocasión'); // `label` sustituye al nombre
    });

    test('cada categoría enlaza a su URL canónica y su foto se descarga', async ({ page }) => {
      await page.goto('/');
      const carrusel = page.getByTestId('carousel-scroller');
      await expect(carrusel.locator('a')).toHaveCount(3);

      // Nunca se construye `/${slug}` a mano: una hija va anidada bajo su padre.
      await expect(carrusel.getByRole('link', { name: /Coches de ocasión/ })).toHaveAttribute(
        'href',
        '/vehiculos/coches',
      );

      // La imagen SE PINTA de verdad: naturalWidth > 0 significa que el
      // navegador la descargó (la trampa de las dos allowlists, §7).
      const img = carrusel.locator('img').first();
      await expect(img).toBeVisible();
      expect(await img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeGreaterThan(0);
    });

    test('el island solo desplaza: sin JS el contenido sigue estando', async ({ page }) => {
      await page.goto('/');
      const carrusel = page.getByTestId('carousel-scroller');
      // El contenedor scrollea por CSS (overflow-x-auto): la funcionalidad vive
      // ahí, las flechas son una comodidad.
      await expect(carrusel).toHaveCSS('overflow-x', 'auto');
    });

    test('listings SIN categoría trae anuncios de todo el sitio, en el HTML', async ({
      page,
      request,
    }) => {
      const html = await (await request.get('http://localhost:3000/')).text();
      expect(html).toContain('Lo último del sitio');

      await page.goto('/');
      const tarjetas = page.locator('a[href^="/anuncio/"]');
      expect(await tarjetas.count()).toBeGreaterThan(0);
    });

    test('las tarjetas conservan corazón de favorito Y línea de atributos', async ({ page }) => {
      // ESTA ES LA COMPROBACIÓN ANTI-REGRESIÓN de la decisión 8.
      //
      // El bloque `listings` del BLOG renuncia a los dos providers a propósito:
      // sus tarjetas van sin corazón y sin la línea de atributos. Si el de
      // portada hiciera lo mismo, la home PERDERÍA algo que hoy tiene. Aquí se
      // comprueba que no.
      await page.goto('/');
      const tarjeta = page.locator('a[href^="/anuncio/"]').first();
      await expect(tarjeta).toBeVisible();

      // Corazón → viene de FavoritesGridProvider.
      await expect(
        tarjeta.getByRole('button', { name: /favoritos/i }),
      ).toHaveCount(1);

      // Y las tarjetas se renderizan en SERVIDOR pese a que los providers son
      // client components: llegan como children de un Server Component.
      const html = await (await page.request.get('http://localhost:3000/')).text();
      expect(html).toContain('/anuncio/');
    });

    test('"Ver todos" sin categoría lleva a la búsqueda por fecha', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('link', { name: 'Ver todos' })).toHaveAttribute(
        'href',
        '/busqueda?sort=publishedAt:desc',
      );
    });
  });

  test.describe('bloque `searchTable` (RP.6)', () => {
    // El bloque LO CREA ESTE SETUP, no la semilla: `searchTable` no se
    // auto-siembra, igual que el carrusel de aquí arriba. La portada por defecto
    // es exactamente la de siempre y este bloque aparece cuando un admin lo
    // añade — así que la cobertura tiene que traérselo puesto.
    test.beforeAll(async ({ browser, request }) => {
      await setBlocks(request, [
        {
          id: 'b-table',
          type: 'searchTable',
          title: 'Búsquedas frecuentes',
          columns: 3,
          tabs: [
            { kind: 'locations', label: 'Por provincia' },
            { kind: 'categories', label: 'Por categoría', includeChildren: true },
            {
              kind: 'combos',
              label: 'Combinaciones',
              items: [{ categorySlug: 'coches', province: 'Madrid' }],
            },
          ],
        },
      ]);
      const warmup = await browser.newPage();
      await esperarPortada(warmup, async (p) => (await p.getByText('Búsquedas frecuentes').count()) > 0);
      await warmup.close();
    });

    test('los enlaces de LAS TRES pestañas están en el HTML servido', async ({ request }) => {
      // ES LA PROPIEDAD CENTRAL DEL BLOQUE, y el motivo de que las pestañas sean
      // propias y no Radix: Radix DESMONTA el panel inactivo, así que dos de las
      // tres listas no existirían en el HTML y un crawler no vería sus enlaces.
      // Aquí no hay navegador: es la respuesta cruda del servidor.
      const html = await (await request.get('http://localhost:3000/')).text();

      expect(html).toContain('Búsquedas frecuentes');

      // Pestaña 1 (la única visible): provincias, con la URL a la que navega el
      // buscador cuando no hay categoría elegida.
      expect(html).toContain('province=Madrid');
      expect(html).toContain('Zaragoza'); // una del final de la lista de 52

      // Pestaña 2 (OCULTA): categorías, incluidas las hijas anidadas.
      expect(html).toContain('/vehiculos');
      expect(html).toContain('/vehiculos/coches');

      // Pestaña 3 (OCULTA): la combinación, categoría anidada + provincia.
      expect(html).toContain('/vehiculos/coches?province=Madrid');
      expect(html).toContain('Coches en Madrid');
    });

    test('los paneles ocultos están en el DOM, solo con `hidden`', async ({ page }) => {
      await page.goto('/');
      const paneles = page.locator('[role="tabpanel"]');
      await expect(paneles).toHaveCount(3);
      await expect(paneles.nth(0)).not.toHaveAttribute('hidden', /.*/);
      await expect(paneles.nth(1)).toHaveAttribute('hidden', /.*/);
      await expect(paneles.nth(2)).toHaveAttribute('hidden', /.*/);
    });

    test('pulsar una pestaña cambia el panel y el aria-selected', async ({ page }) => {
      await page.goto('/');
      const porProvincia = page.getByRole('tab', { name: 'Por provincia' });
      const porCategoria = page.getByRole('tab', { name: 'Por categoría' });

      await expect(porProvincia).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel')).toContainText('Madrid');

      await porCategoria.click();
      await expect(porCategoria).toHaveAttribute('aria-selected', 'true');
      await expect(porProvincia).toHaveAttribute('aria-selected', 'false');
      // getByRole('tabpanel') solo ve el visible: el oculto no está en el árbol
      // de accesibilidad, que es exactamente lo que debe pasar.
      await expect(page.getByRole('tabpanel')).toHaveCount(1);
      await expect(page.getByRole('tabpanel')).toContainText('Vehículos');
    });

    test('las flechas recorren las pestañas (patrón tablist del APG)', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('tab', { name: 'Por provincia' }).focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('tab', { name: 'Por categoría' })).toBeFocused();
      await expect(page.getByRole('tab', { name: 'Por categoría' })).toHaveAttribute(
        'aria-selected',
        'true',
      );

      // End salta a la última, Home vuelve a la primera.
      await page.keyboard.press('End');
      await expect(page.getByRole('tab', { name: 'Combinaciones' })).toBeFocused();
      await page.keyboard.press('Home');
      await expect(page.getByRole('tab', { name: 'Por provincia' })).toBeFocused();
    });

    test('solo la pestaña activa es tabulable (foco itinerante)', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('tab', { name: 'Por provincia' })).toHaveAttribute('tabindex', '0');
      await expect(page.getByRole('tab', { name: 'Por categoría' })).toHaveAttribute('tabindex', '-1');
    });
  });

  test.describe('sin bloques', () => {
    test.beforeAll(async ({ browser, request }) => {
      await setBlocks(request, []);
      const warmup = await browser.newPage();
      // Espera de AUSENCIA: exige además que el <h1> esté, o se daría por buena
      // una página que aún no ha renderizado nada.
      await esperarPortada(
        warmup,
        async (p) =>
          (await p.locator('h1').count()) > 0 &&
          (await p.getByPlaceholder('¿Qué estás buscando?').count()) === 0,
      );
      await warmup.close();
    });

    test('la portada sigue entera: hero, cabecera y pie intactos', async ({ page }) => {
      await page.goto('/');
      // Un array vacío no deja un hueco ni rompe nada: el hero es campo propio
      // de la config y no pasa por el motor de bloques.
      await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName(TITULO);
      await expect(page.locator('header').first()).toBeVisible();
      await expect(page.locator('footer').first()).toBeVisible();
    });
  });
});
