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
import { adminApiToken, authedPatch } from './helpers/api';
import { PORTADA_SEMILLA, restaurarPortada } from './helpers/portada';

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
      await page.getByRole('button', { name: 'Buscar' }).click();
      await page.waitForURL(/\/busqueda\?.*q=bicicleta/);
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
