import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken } from './helpers/api';

/**
 * ══ EL TERCER MODELO, EN PANTALLA ════════════════════════════════════════════════════
 *
 * `fresco-confianza` es PURO REGISTRO: no toca un solo `.tsx`, así que su existencia se
 * demuestra en el navegador o no se demuestra. Lo que se comprueba aquí es lo que sólo
 * existe cuando el registro, la API y la pantalla se juntan:
 *
 *  · que el catálogo lo OFRECE, con sus dos versiones — un modelo que no se puede elegir
 *    no está añadido, está escrito;
 *  · que elegirlo lo APLICA de verdad en las páginas;
 *  · que «Claro» y «Nítido» se ven DISTINTAS. Es la cicatriz de Cálido/Editorial: las
 *    versiones existían como etiqueta desde E4a y `resolverTokens` no las miraba, así que
 *    el desplegable prometía dos ambientes y daba uno;
 *  · que `--font-heading` LLEGA. Es la otra cicatriz del mismo modelo: el filtro de
 *    inyección de `lib/estilo-css.ts` descarta en silencio cualquier valor con comillas, y
 *    la primera pila de fuentes se cayó entera sin un solo error por ninguna parte. Un
 *    token que no llega no se ve, y lo que no se ve no se arregla.
 *
 * ── DEJA LA INSTANCIA COMO LA ENCONTRÓ ──────────────────────────────────────────────
 *
 * Mismo compromiso que `admin-estilo.spec.ts` y por el mismo motivo: guardar aquí repinta
 * la plataforma entera, y la batería de capturas fotografía el Modelo 0. El `afterEach`
 * restaura SIEMPRE, falle lo que falle.
 */

const API = 'http://localhost:3001';

/** Los de fábrica del Modelo 0 — lo que la instancia tiene que volver a tener al salir. */
const COLORES_0 = {
  primary: '221.2 83.2% 53.3%',
  secondary: '210 40% 96.1%',
  accent: '210 40% 96.1%',
  neutral: '210 40% 96.1%',
};

async function ponerModelo(
  request: APIRequestContext,
  modelo: string,
  version: string,
  colores: Record<string, string>,
): Promise<void> {
  const res = await request.put(`${API}/api/admin/estilo`, {
    headers: { Authorization: `Bearer ${adminApiToken()}` },
    data: { modelo, version, colores },
  });
  if (!res.ok()) {
    throw new Error(`[fresco] no se pudo activar ${modelo}@${version}: ${res.status()} ${await res.text()}`);
  }
}

/**
 * Los tokens que el navegador computa en la raíz. Se mide el RESULTADO —lo que el
 * navegador entiende— y no el texto del `<style>`: un valor descartado por el filtro de
 * inyección sigue estando en el registro, y sólo la computación dice si llegó.
 */
async function tema(page: Page, ruta: string) {
  await page.goto(ruta);
  await page.waitForLoadState('domcontentloaded');
  return page.evaluate(() => {
    const r = getComputedStyle(document.documentElement);
    const leer = (n: string) => r.getPropertyValue(n).trim();
    return {
      background: leer('--background'),
      foreground: leer('--foreground'),
      border: leer('--border'),
      primary: leer('--primary'),
      radius: leer('--radius'),
      duracion: leer('--motion-duration'),
      heading: leer('--font-heading'),
    };
  });
}

test.describe('Fresco / Confianza — el tercer modelo', () => {
  test.afterEach(async ({ request }) => {
    // Pase lo que pase: esta batería es compartida y un tema fugado repinta todo lo que
    // venga detrás.
    await ponerModelo(request, 'modelo-0', '1', COLORES_0);
  });

  test('B2 — el catálogo lo ofrece, con sus dos versiones, y elegirlo lo aplica', async ({
    adminContext,
    page,
  }) => {
    const admin = await adminContext.newPage();
    await admin.goto('/admin/estilo');

    const selectorModelo = admin.getByTestId('selector-modelo');
    await expect(selectorModelo).toBeVisible();

    // ESTÁ EN LA LISTA. Sin esto, el resto del test podría pasar por la API y el modelo
    // seguiría sin poder elegirse desde la pantalla, que es lo que «elegible» significa.
    await expect(selectorModelo.locator('option[value="fresco-confianza"]')).toHaveCount(1);

    await selectorModelo.selectOption('fresco-confianza');

    // Las DOS versiones, y en su orden: la pantalla salta a la primera al cambiar de
    // modelo porque la que tuviera puesta puede no existir aquí.
    const selectorVersion = admin.getByTestId('selector-version');
    await expect(selectorVersion).toHaveValue('claro');
    await expect(selectorVersion.locator('option')).toHaveCount(2);
    await expect(selectorVersion.locator('option[value="nitido"]')).toHaveCount(1);

    // E14-B1 — el identificador viaja, el nombre se lee. Aquí la diferencia es una tilde
    // que el identificador no puede llevar: «nitido» se pinta «Nítido».
    await expect(selectorVersion.locator('option')).toHaveText(['Claro', 'Nítido']);

    // Y trae SUS colores de fábrica, no los del modelo anterior.
    await expect(admin.getByTestId('valor-primary')).toHaveValue('222 76% 50%');

    await admin.getByTestId('guardar-estilo').click();
    await expect(admin.getByTestId('hay-cambios')).toHaveCount(0, { timeout: 15_000 });

    // APLICADO DE VERDAD, medido en una página pública y no en la previa del admin: la
    // previa la pinta el borrador local, así que un guardado que no llegara a la
    // plataforma se vería igual de bien ahí.
    const t = await tema(page, '/planes');
    expect(t.primary).toBe('222 76% 50%');
    expect(t.duracion).toBe('120ms');

    await admin.close();
  });

  /**
   * B5 — LAS VERSIONES SON DISTINTAS DE VERDAD.
   *
   * `estilo.spec.ts` ya lo exige sobre los tokens resueltos, que es donde vive la regla.
   * Esto lo comprueba un paso más allá —en el navegador, sobre lo que el usuario ve—
   * porque entre una cosa y otra hay tres piezas que pueden tragarse la diferencia: el
   * guardado, la caché del frontend y el bloque de estilo.
   */
  test('B5 — «Claro» y «Nítido» pintan temas distintos en la página', async ({
    request,
    page,
  }) => {
    const colores = {
      primary: '222 76% 50%',
      secondary: '188 62% 46%',
      accent: '262 65% 55%',
      neutral: '214 14% 93%',
    };

    await ponerModelo(request, 'fresco-confianza', 'claro', colores);
    const claro = await tema(page, '/planes');

    await ponerModelo(request, 'fresco-confianza', 'nitido', colores);
    const nitido = await tema(page, '/planes');

    // Lienzo, texto y trazo: lo que un «ambiente» promete. Si esto fuera igual, la versión
    // volvería a ser una etiqueta.
    expect(nitido.background).not.toBe(claro.background);
    expect(nitido.foreground).not.toBe(claro.foreground);
    expect(nitido.border).not.toBe(claro.border);
    // Y un eje, que es la otra mitad de lo que una versión puede cambiar.
    expect(claro.radius).toBe('0.25rem');
    expect(nitido.radius).toBe('0.125rem');
    expect(nitido.duracion).toBe('110ms');

    // LO QUE NO PUEDE CAMBIAR: los cuatro colores son del MODELO, no de la versión
    // (decisión #2). Que esto se mantenga igual es tan parte del contrato como que lo
    // de arriba cambie.
    expect(nitido.primary).toBe(claro.primary);
  });

  /**
   * B6 — LA FUENTE LLEGA, que es una afirmación distinta de «la fuente está escrita».
   *
   * LA CICATRIZ: `VALOR_SEGURO` (lib/estilo-css.ts) no admite comillas, así que
   * `'Iowan Old Style'` hizo que el token entero se descartara y los titulares del
   * Cálido/Editorial salieran en sans. No hubo error, ni aviso, ni nada: el valor
   * simplemente no se emitió.
   *
   * Se mide lo que el navegador COMPUTA. Un token descartado deja `--font-heading` con lo
   * que herede de `globals.css` —la pila del Modelo 0—, así que basta con exigir que la
   * geométrica esté ahí.
   */
  test('B6 — --font-heading se emite y el navegador lo computa (el filtro no se lo come)', async ({
    request,
    page,
  }) => {
    await ponerModelo(request, 'fresco-confianza', 'claro', {
      primary: '222 76% 50%',
      secondary: '188 62% 46%',
      accent: '262 65% 55%',
      neutral: '214 14% 93%',
    });

    const t = await tema(page, '/planes');
    expect(t.heading).toContain('Avenir Next');
    expect(t.heading).toContain('Segoe UI');
    // Y NO es el valor del Modelo 0: si el filtro se lo hubiera comido, aquí habría
    // quedado `var(--font-sans)`, que es lo que declara `globals.css`.
    expect(t.heading).not.toContain('var(--font-sans)');

    // Y se APLICA, no sólo se declara: un `h1` de la página tiene que estar pintándose con
    // ella. Es el paso que separa «el token llegó» de «el titular cambió».
    const familiaDelTitular = await page
      .locator('h1')
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(familiaDelTitular).toContain('Avenir Next');
  });
});
