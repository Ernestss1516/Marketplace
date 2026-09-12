import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken } from './helpers/api';

/**
 * ══ EL QUINTO MODELO, EN PANTALLA ════════════════════════════════════════════════════
 *
 * Mismo reparto que `estilo-premium.spec.ts`, que es el molde rodado: el registro, la
 * derivación y AA se comprueban en el backend; aquí sólo lo que exige que el registro, la
 * API y la pantalla estén las tres.
 *
 * Lo propio de este modelo, y por lo que el fichero no es una copia:
 *
 *  · los COLORES SON MUY SATURADOS, y eso mueve la elección de letra a sitios donde los
 *    otros modelos no la mueven: el cian y el lima llevan letra OSCURA y el fucsia CLARA.
 *    Si alguien retoca uno «para que brille más», la pareja se invierte y el color sigue
 *    viéndose — el fallo silencioso que esta comprobación caza;
 *  · «Suave» NO rebaja la marca (una versión no la toca) sino el papel, el texto, el trazo
 *    y el anillo. Aquí se afirma lo que cambia Y lo que no, porque lo segundo es lo que el
 *    nombre de la versión podría prometer de más;
 *  · la pila de titulares es la cuarta distinta (geométrica redonda) y vuelve a pasar por
 *    el filtro que descarta comillas.
 *
 * DEJA LA INSTANCIA COMO LA ENCONTRÓ: el `afterEach` restaura el Modelo 0 pase lo que
 * pase. Guardar aquí repinta la plataforma y la batería de capturas fotografía el Modelo 0.
 */

const API = 'http://localhost:3001';

const COLORES_0 = {
  primary: '221.2 83.2% 53.3%',
  secondary: '210 40% 96.1%',
  accent: '210 40% 96.1%',
  neutral: '210 40% 96.1%',
};

/** Los de fábrica de `vibrante`. Ver `estilo.constants.ts`. */
const COLORES_VIBRANTE = {
  primary: '330 78% 45%',
  secondary: '186 82% 42%',
  accent: '92 72% 44%',
  neutral: '30 24% 92%',
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
    throw new Error(
      `[vibrante] no se pudo activar ${modelo}@${version}: ${res.status()} ${await res.text()}`,
    );
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
      primaryFg: leer('--primary-foreground'),
      secondary: leer('--secondary'),
      secondaryFg: leer('--secondary-foreground'),
      accent: leer('--accent'),
      accentFg: leer('--accent-foreground'),
      ring: leer('--ring'),
      radius: leer('--radius'),
      duracion: leer('--motion-duration'),
      heading: leer('--font-heading'),
    };
  });
}

test.describe('Vibrante — el quinto modelo', () => {
  test.afterEach(async ({ request }) => {
    await ponerModelo(request, 'modelo-0', '1', COLORES_0);
  });

  test('B2 — el catálogo lo ofrece con sus dos versiones, y elegirlo lo aplica', async ({
    adminContext,
    page,
  }) => {
    const admin = await adminContext.newPage();
    await admin.goto('/admin/estilo');

    const selectorModelo = admin.getByTestId('selector-modelo');
    await expect(selectorModelo.locator('option[value="vibrante"]')).toHaveCount(1);

    await selectorModelo.selectOption('vibrante');

    const selectorVersion = admin.getByTestId('selector-version');
    await expect(selectorVersion).toHaveValue('pop');
    await expect(selectorVersion.locator('option')).toHaveCount(2);
    // El valor es el identificador y el texto es el nombre (E14-B1).
    await expect(selectorVersion.locator('option')).toHaveText(['Pop', 'Suave']);

    // Sus colores de fábrica, no los del modelo anterior.
    await expect(admin.getByTestId('valor-primary')).toHaveValue('330 78% 45%');
    await expect(admin.getByTestId('valor-accent')).toHaveValue('92 72% 44%');

    await admin.getByTestId('guardar-estilo').click();
    await expect(admin.getByTestId('hay-cambios')).toHaveCount(0, { timeout: 15_000 });

    // Aplicado de verdad, medido en una página pública y no en la previa del admin: la
    // previa la pinta el borrador local, así que un guardado que no llegara se vería igual.
    const t = await tema(page, '/planes');
    expect(t.primary).toBe('330 78% 45%');
    expect(t.radius).toBe('0.875rem');
    expect(t.duracion).toBe('140ms');

    await admin.close();
  });

  /**
   * ⚠ B4 — QUÉ LETRA GANÓ SOBRE CADA UNO DE LOS TRES, Y AQUÍ NO ES UN DETALLE.
   *
   * `contraste-modelos.spec.ts` ya exige que las tres parejas cumplan 4,5:1; lo que esto
   * fija es CUÁL de las dos letras ganó, que es la información que se pierde en un verde.
   *
   * En este modelo el reparto es asimétrico y frágil: el fucsia al 45 % lleva letra CLARA
   * (5,09:1) y el cian y el lima llevan OSCURA (6,66 y 7,62). Están los tres a pocos puntos
   * de luz de invertirse, y una inversión no rompe nada visible — el color se sigue viendo,
   * sólo deja de leerse. Es exactamente el modo de fallo que el bronce de Premium documentó.
   */
  test('B4 — el fucsia lleva letra clara; el cian y el lima, oscura', async ({
    request,
    page,
  }) => {
    await ponerModelo(request, 'vibrante', 'pop', COLORES_VIBRANTE);
    const t = await tema(page, '/planes');

    // Los dos candidatos del modelo. La máquina elige midiendo, no el registro.
    expect(t.primaryFg).toBe('30 30% 98%');
    expect(t.secondaryFg).toBe('320 35% 12%');
    expect(t.accentFg).toBe('320 35% 12%');
  });

  /**
   * ⚠ B5 — «POP» Y «SUAVE» SON DISTINTAS, Y LA MARCA NO ES LO QUE LAS DISTINGUE.
   *
   * Ésta es la afirmación que más dice de este modelo, porque el nombre de la versión
   * promete algo que el mecanismo no da: «Suave» NO puede rebajar el fucsia, el cian ni el
   * lima —son los cuatro colores del admin y una versión los hereda tal cual (decisión #2,
   * y E14 dejó la marca fuera de lo que una versión deriva)—.
   *
   * Lo que sí rebaja: el papel, el texto, el trazo y **el anillo de foco**, que es el único
   * token de familia cromática que una versión puede calmar porque se DERIVA del primario.
   * Se afirman las dos mitades: lo que cambia y lo que tiene que seguir igual.
   */
  test('B5 — «Suave» rebaja el papel y el anillo, y deja la marca intacta', async ({
    request,
    page,
  }) => {
    await ponerModelo(request, 'vibrante', 'pop', COLORES_VIBRANTE);
    const pop = await tema(page, '/planes');

    await ponerModelo(request, 'vibrante', 'suave', COLORES_VIBRANTE);
    const suave = await tema(page, '/planes');

    // Lo que un ambiente promete: lienzo, texto y trazo.
    expect(suave.background).not.toBe(pop.background);
    expect(suave.foreground).not.toBe(pop.foreground);
    expect(suave.border).not.toBe(pop.border);
    expect(suave.duracion).toBe('180ms');

    // El anillo SÍ se rebaja, y por derivación: 26 puntos menos de saturación.
    expect(pop.ring).toBe('330 78% 45%');
    expect(suave.ring).toBe('330 52% 51%');

    // Y LA MARCA NO. Que esto se mantenga es tan parte del contrato como que lo de arriba
    // cambie: el día que «Suave» necesite de verdad otros colores, será otro MODELO.
    expect(suave.primary).toBe(pop.primary);
    expect(suave.secondary).toBe(pop.secondary);
    expect(suave.accent).toBe(pop.accent);
  });

  /**
   * B6 — LA FUENTE LLEGA. Cuarta vez que se comprueba y cuarta pila distinta: el filtro de
   * `estilo-css.ts` descarta comillas EN SILENCIO, así que cada modelo con tipografía propia
   * tiene que demostrar la suya.
   */
  test('B6 — --font-heading se emite, se computa y pinta el titular', async ({
    request,
    page,
  }) => {
    await ponerModelo(request, 'vibrante', 'pop', COLORES_VIBRANTE);

    const t = await tema(page, '/planes');
    expect(t.heading).toContain('Futura');
    expect(t.heading).toContain('Century Gothic');
    expect(t.heading).not.toContain('var(--font-sans)');

    const familiaDelTitular = await page
      .locator('h1')
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(familiaDelTitular).toContain('Futura');
  });
});
