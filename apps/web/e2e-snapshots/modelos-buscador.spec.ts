import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../e2e/fixtures/auth';
import { adminApiToken } from '../e2e/helpers/api';
import {
  esperarPortadaEscaparate,
  ponerPortadaEscaparate,
  restaurarPortada,
} from '../e2e/helpers/portada';
import { preparar } from './preparar';

/**
 * ══ BUSCADOR · BQ-D — EL DIÁLOGO, REVESTIDO POR LOS CINCO MODELOS ════════════════════
 *
 * El punto 3 del encargo, literal: **«correcto en escritorio y móvil, para cada modelo y
 * versión»**. Las capturas del catálogo se toman todas con el Modelo 0 —es el estado
 * actual y por eso sirve de baseline—, así que hasta aquí nadie había mirado el diálogo
 * filtrable con ningún otro.
 *
 * ── QUÉ PRUEBA ESTO QUE NO PRUEBE LA INVARIANCIA ───────────────────────────────────
 *
 * `estilo-invariancia.spec.ts` ya recorre los cinco modelos del catálogo sobre la portada
 * y afirma algo muy fuerte: **el árbol no cambia**. Pero compara el DOM ignorando `class`
 * y `style`, o sea que es ciega por construcción a lo único que estas capturas miran: que
 * el revestimiento LLEGUE y que el resultado se pueda mirar sin vergüenza.
 *
 * Las dos juntas son la frontera entera: la invariancia dice que ningún modelo
 * REORGANIZA; esto dice que cada modelo REVISTE. Ninguna de las dos afirma la otra.
 *
 * ── POR QUÉ CUATRO Y NO CINCO ──────────────────────────────────────────────────────
 *
 * El quinto es el Modelo 0 y ya está capturado en `overlays.spec.ts`
 * (`buscador-dialogo-categoria`), con la misma receta y el mismo encuadre. Repetirlo aquí
 * sería mantener dos ficheros que tienen que decir lo mismo.
 *
 * ── LO QUE CADA UNO TIENE QUE ENSEÑAR ──────────────────────────────────────────────
 *
 * El diálogo no sabe que estos modelos existen: no hay un solo `if` por modelo en
 * `dialogo-filtrable`. Lo que cambia entre estas cuatro fotos —el lienzo de la capa, el
 * color del resaltado, el radio, la familia tipográfica, el grosor del icono, el velo— son
 * todos tokens que la capa hereda de `html:root` por ser la portada la zona BASE.
 *
 * ⚠ **Y `premium@oscuro` ES LA QUE DE VERDAD IMPORTA.** Es la única versión del catálogo
 * que invierte la luz, y es donde se ve si una capa flotante se separa de su fondo o se
 * funde con él. En un tema oscuro la elevación no la da la sombra —«una sombra negra sobre
 * un lienzo carbón no se ve», dice el propio modelo— sino la LUZ: por eso su rampa sube la
 * capa flotante a 16 % sobre un lienzo al 8 %.
 */

const API = 'http://localhost:3001';

/** Los de fábrica de cada modelo. Salen de `estilo.constants.ts`, como en la invariancia. */
const COLORES_0 = {
  primary: '221.2 83.2% 53.3%',
  secondary: '210 40% 96.1%',
  accent: '210 40% 96.1%',
  neutral: '210 40% 96.1%',
};
const COLORES_FRESCO = {
  primary: '222 76% 50%',
  secondary: '188 62% 46%',
  accent: '262 65% 55%',
  neutral: '214 14% 93%',
};
const COLORES_PREMIUM = {
  primary: '220 45% 30%',
  secondary: '220 30% 45%',
  accent: '42 58% 48%',
  neutral: '220 6% 92%',
};
const COLORES_VIBRANTE = {
  primary: '330 78% 45%',
  secondary: '186 82% 42%',
  accent: '92 72% 44%',
  neutral: '30 24% 92%',
};

/**
 * Los cuatro que faltaban. El nombre de la captura lleva modelo Y versión porque el eje de
 * versión es tan capaz de cambiar el aspecto como el de modelo — `premium@claro` y
 * `premium@oscuro` son el mismo modelo y no se parecen en nada.
 */
const MODELOS: readonly [captura: string, modelo: string, version: string, colores: Record<string, string>][] = [
  ['fresco-confianza', 'fresco-confianza', 'claro', COLORES_FRESCO],
  ['premium-claro', 'premium', 'claro', COLORES_PREMIUM],
  ['premium-oscuro', 'premium', 'oscuro', COLORES_PREMIUM],
  ['vibrante-pop', 'vibrante', 'pop', COLORES_VIBRANTE],
];

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
    throw new Error(`[BQ-D] no se pudo activar ${modelo}@${version}: ${res.status()} ${await res.text()}`);
  }
}

/** La huella del tema en la página: lo que tiene que CAMBIAR al cambiar de modelo. */
async function temaDe(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raiz = getComputedStyle(document.documentElement);
    return ['--background', '--primary', '--radius', '--font-sans']
      .map((t) => raiz.getPropertyValue(t).trim())
      .join(' | ');
  });
}

test.describe('Escaparate — el diálogo del buscador por modelo', () => {
  test.beforeAll(async ({ browser, request }) => {
    await ponerPortadaEscaparate(request);
    const calentamiento = await browser.newPage();
    await esperarPortadaEscaparate(calentamiento);
    await calentamiento.close();
  });

  test.afterAll(async ({ request }) => {
    /**
     * ⚠ SE DEJA TODO COMO SE ENCONTRÓ, Y LAS DOS COSAS IMPORTAN.
     *
     * La portada, por el contrato que ya cumplen los demás specs. **Y el MODELO**, que es
     * más grave: esto corre dentro de la batería compartida y un tema fugado repintaría
     * todas las capturas siguientes — que están tomadas con el Modelo 0 y se pondrían
     * rojas en masa, apuntando a cualquier sitio menos a aquí.
     */
    await ponerModelo(request, 'modelo-0', '1', COLORES_0);
    await restaurarPortada(request);
  });

  for (const [captura, modelo, version, colores] of MODELOS) {
    test(`buscador-dialogo-${captura}`, async ({ page, request }) => {
      // El Modelo 0 primero, para tener contra qué contrastar: si el PUT de abajo no
      // llegara a la página, las dos lecturas coincidirían y la foto saldría del modelo
      // equivocado sin que nada se quejara.
      await ponerModelo(request, 'modelo-0', '1', COLORES_0);
      await page.goto('/');
      const temaCero = await temaDe(page);

      await ponerModelo(request, modelo, version, colores);

      /**
       * El `revalidateTag('estilo')` que dispara el PUT es fire-and-forget, así que la
       * primera visita puede servirse todavía del tema anterior. Se espera a que la página
       * REFLEJE el cambio, no a que el PUT responda — mismo cuidado que `esperarPortada…`.
       */
      await expect(async () => {
        await page.goto('/', { waitUntil: 'load' });
        expect(await temaDe(page)).not.toBe(temaCero);
      }).toPass({ timeout: 30_000 });

      await preparar(page, '/');

      // Con TECLADO y no con ratón: al hacer clic el puntero queda sobre una fila y
      // `onMouseEnter` la resalta, así que la foto saldría con dos filas marcadas o con una
      // distinta según dónde caiga el cursor. Mismo motivo que en `overlays.spec.ts`.
      await page.getByLabel('Categoría').focus();
      await page.keyboard.press('Enter');

      const dialogo = page.getByRole('dialog');
      await expect(dialogo).toBeVisible();
      // La capa llega por `next/dynamic`: sin esperar a una fila, la foto podría salir con
      // el diálogo montado y la lista todavía vacía.
      await expect(dialogo.getByRole('option').first()).toBeVisible();

      await expect(page).toHaveScreenshot(`buscador-dialogo-${captura}.png`);
    });
  }
});
