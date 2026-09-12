import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken } from './helpers/api';

/**
 * ══ EL CUARTO MODELO, EN PANTALLA ════════════════════════════════════════════════════
 *
 * Mismo reparto que `estilo-fresco-confianza.spec.ts`, que es el molde rodado: el
 * registro, la derivación y AA se comprueban en el backend; aquí sólo lo que exige que el
 * registro, la API y la pantalla estén las tres.
 *
 * Lo propio de este modelo, y por lo que el fichero no es una copia:
 *
 *  · el ACENTO DE BRONCE es el único color de una paleta monocroma, y es el que casi no
 *    llega: al 48 % de luz sólo cumple con letra OSCURA. Se comprueba que
 *    `accent-foreground` acabó siendo la oscura, porque si un día alguien sube el acento
 *    «para que brille más», esa pareja se rompe en silencio — el color seguiría viéndose;
 *  · la pila de titulares es OTRA (Optima/Palatino, humanistas de libro) y vuelve a pasar
 *    por el filtro que descarta comillas.
 *
 * DEJA LA INSTANCIA COMO LA ENCONTRÓ: el `afterEach` restaura el Modelo 0 pase lo que
 * pase. Guardar aquí repinta la plataforma y la batería de capturas fotografía el
 * Modelo 0.
 */

const API = 'http://localhost:3001';

const COLORES_0 = {
  primary: '221.2 83.2% 53.3%',
  secondary: '210 40% 96.1%',
  accent: '210 40% 96.1%',
  neutral: '210 40% 96.1%',
};

/** Los de fábrica de `premium`. Ver `estilo.constants.ts`. */
const COLORES_PREMIUM = {
  primary: '220 45% 30%',
  secondary: '220 30% 45%',
  accent: '42 58% 48%',
  neutral: '220 6% 92%',
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
    throw new Error(`[premium] no se pudo activar ${modelo}@${version}: ${res.status()} ${await res.text()}`);
  }
}

/** Lo que el navegador COMPUTA en la raíz — no el texto del `<style>`. */
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
      accent: leer('--accent'),
      accentFg: leer('--accent-foreground'),
      radius: leer('--radius'),
      duracion: leer('--motion-duration'),
      heading: leer('--font-heading'),
    };
  });
}

test.describe('Premium — el cuarto modelo', () => {
  test.afterEach(async ({ request }) => {
    await ponerModelo(request, 'modelo-0', '1', COLORES_0);
  });

  test('B2 — el catálogo lo ofrece con sus TRES versiones, y elegirlo lo aplica', async ({
    adminContext,
    page,
  }) => {
    const admin = await adminContext.newPage();
    await admin.goto('/admin/estilo');

    const selectorModelo = admin.getByTestId('selector-modelo');
    await expect(selectorModelo.locator('option[value="premium"]')).toHaveCount(1);

    await selectorModelo.selectOption('premium');

    const selectorVersion = admin.getByTestId('selector-version');
    await expect(selectorVersion).toHaveValue('claro');
    // E14-B2 — TRES desde que «Oscuro» existe.
    await expect(selectorVersion.locator('option')).toHaveCount(3);
    await expect(selectorVersion.locator('option[value="claro-intenso"]')).toHaveCount(1);
    await expect(selectorVersion.locator('option[value="oscuro"]')).toHaveCount(1);

    /**
     * E14-B1 — EL VALOR ES EL IDENTIFICADOR Y EL TEXTO ES EL NOMBRE, y las dos mitades
     * hacen falta. Los tres asertos de arriba fijan el identificador, que es lo que viaja
     * en el PUT; éste fija que **lo que el admin LEE no es ese identificador**. Antes ponía
     * «claro-intenso», con su guion, en una pantalla donde el modelo de al lado ya decía
     * «Premium».
     *
     * Es además la prueba de que el nombre llega del CATÁLOGO y no de un literal de esta
     * pantalla: el frontend no conoce a Premium ni a ninguno de los otros tres.
     */
    await expect(selectorVersion.locator('option')).toHaveText([
      'Claro',
      'Claro intenso',
      'Oscuro',
    ]);

    // Sus colores de fábrica, no los del modelo anterior.
    await expect(admin.getByTestId('valor-primary')).toHaveValue('220 45% 30%');
    await expect(admin.getByTestId('valor-accent')).toHaveValue('42 58% 48%');

    await admin.getByTestId('guardar-estilo').click();
    await expect(admin.getByTestId('hay-cambios')).toHaveCount(0, { timeout: 15_000 });

    // Aplicado de verdad, medido en una página pública y no en la previa del admin: la
    // previa la pinta el borrador local, así que un guardado que no llegara se vería igual.
    const t = await tema(page, '/planes');
    expect(t.primary).toBe('220 45% 30%');
    expect(t.duracion).toBe('220ms');
    expect(t.radius).toBe('0.125rem');

    await admin.close();
  });

  /**
   * B4-bis — EL BRONCE LLEVA LETRA OSCURA, Y ESO NO ES UN DETALLE.
   *
   * `contraste-modelos.spec.ts` ya exige que la pareja cumpla 4,5:1; lo que esto fija es
   * CUÁL de las dos letras ganó, que es la información que se pierde en un verde. Con
   * letra clara el bronce daría 2,71:1, así que si alguien sube el acento «para que
   * brille» la pareja se invierte y el aserto de allí empieza a medir otra cosa. Aquí se
   * ve en la página, que es donde el usuario lo sufriría.
   */
  test('B4-bis — el acento de bronce se pinta con la letra OSCURA', async ({
    request,
    page,
  }) => {
    await ponerModelo(request, 'premium', 'claro', COLORES_PREMIUM);
    const t = await tema(page, '/planes');

    expect(t.accent).toBe('42 58% 48%');
    // La oscura del modelo, no la clara. Ver `textoSobre` en `estilo.constants.ts`.
    expect(t.accentFg).toBe('220 40% 10%');
  });

  test('B5 — «Claro» y «Claro intenso» pintan temas distintos', async ({ request, page }) => {
    await ponerModelo(request, 'premium', 'claro', COLORES_PREMIUM);
    const claro = await tema(page, '/planes');

    await ponerModelo(request, 'premium', 'claro-intenso', COLORES_PREMIUM);
    const intenso = await tema(page, '/planes');

    // Lienzo, texto y trazo: lo que un ambiente promete.
    expect(intenso.background).not.toBe(claro.background);
    expect(intenso.foreground).not.toBe(claro.foreground);
    expect(intenso.border).not.toBe(claro.border);
    // Y un eje.
    expect(intenso.duracion).toBe('180ms');
    expect(claro.duracion).toBe('220ms');

    // LO QUE NO PUEDE CAMBIAR: los cuatro colores son del MODELO (decisión #2). Que esto
    // se mantenga es tan parte del contrato como que lo de arriba cambie — y es
    // exactamente el límite que dejó «Oscuro contenido» fuera de esta ráfaga.
    expect(intenso.primary).toBe(claro.primary);
    expect(intenso.accent).toBe(claro.accent);
  });

  /**
   * B6 — LA FUENTE LLEGA. Tercera vez que se comprueba y tercera pila distinta: el filtro
   * de `estilo-css.ts` descarta comillas EN SILENCIO, así que cada modelo con tipografía
   * propia tiene que demostrar la suya.
   */
  test('B6 — --font-heading se emite, se computa y pinta el titular', async ({
    request,
    page,
  }) => {
    await ponerModelo(request, 'premium', 'claro', COLORES_PREMIUM);

    const t = await tema(page, '/planes');
    expect(t.heading).toContain('Optima');
    expect(t.heading).toContain('Palatino Linotype');
    expect(t.heading).not.toContain('var(--font-sans)');

    const familiaDelTitular = await page
      .locator('h1')
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(familiaDelTitular).toContain('Optima');
  });

  /**
   * ══ E14-B2 · «OSCURO» LLEGA A LA PÁGINA, Y LLEGA ENTERO ════════════════════════════
   *
   * El backend ya tiene medido todo lo que se puede medir sin navegador: AA por zona, la
   * coherencia de polaridad, la completitud de superficies. Lo que sólo se puede comprobar
   * aquí es que **el lienzo invertido atraviesa las tres piezas del camino** —el
   * `<style>` del layout, el filtro de `estilo-css.ts` y la cascada— y que no se queda a
   * medias por el camino, que es como se cayó el `font-heading` con comillas: en silencio.
   *
   * Se mide lo que la ráfaga A abrió, una cosa por campo:
   *
   *  · la RAMPA → el lienzo es oscuro y el texto claro;
   *  · el FOCO → el anillo NO es el primario, es su derivado aclarado;
   *  · los SEMÁNTICOS → el rojo es el claro del molde oscuro, no el del modelo;
   *  · las ZONAS → el backoffice repinta en carbón, no en blanco.
   */
  test('B7 — la versión «Oscuro» invierte el lienzo, y el foco, los avisos y las zonas la siguen', async ({
    request,
    page,
    adminContext,
  }) => {
    await ponerModelo(request, 'premium', 'oscuro', COLORES_PREMIUM);

    const claro = { background: '220 14% 99%' };
    const t = await tema(page, '/planes');

    // La rampa: lienzo carbón y texto casi blanco. El de «Claro» es 220 14% 99%.
    expect(t.background).toBe('220 24% 8%');
    expect(t.foreground).toBe('220 16% 95%');
    expect(t.background).not.toBe(claro.background);

    // El foco: derivado del primario, no el primario. Éste es el token que descartó la
    // versión cuando se pidió (1,85:1 sobre el carbón).
    const anillo = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ring').trim(),
    );
    expect(anillo).toBe('220 45% 70%');
    expect(anillo).not.toBe(t.primary);

    // Los semánticos, girados: el rojo de un tema oscuro es CLARO.
    const rojo = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--destructive').trim(),
    );
    expect(rojo).toBe('0 85% 68%');

    // Y las zonas: el backoffice resta EN OSCURO. Sin `ajustesPorZona` por versión, aquí
    // saldría el blanco del bloque del modelo sobre el texto claro de la versión — 1,12:1.
    const admin = await adminContext.newPage();
    await admin.goto('/admin/anuncios');
    await admin.waitForLoadState('domcontentloaded');
    const lienzoDelBackoffice = await admin
      .locator('[data-zona="backoffice"]')
      .first()
      .evaluate((el) => getComputedStyle(el).getPropertyValue('--background').trim());
    expect(lienzoDelBackoffice).toBe('220 24% 8%');
    await admin.close();
  });
});
