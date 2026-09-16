import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from '../e2e/fixtures/auth';
import { adminApiToken } from '../e2e/helpers/api';
import { NOMBRE_FICHA, RUTA_BLOG } from '../e2e/helpers/contenido-editorial';
import { preparar } from './preparar';

/**
 * ══ LA FICHA, REVESTIDA POR LOS CINCO MODELOS ════════════════════════════════════════
 *
 * El encargo, literal: «por modelo/versión — la estructura es COMÚN, el sabor por tokens».
 * Esto es la mitad visual de esa frase. La otra mitad la firma
 * `e2e/estilo-invariancia.spec.ts`, y las dos hacen falta porque ninguna implica la otra:
 *
 *  · la invariancia compara el DOM IGNORANDO `class` y `style`, así que es ciega por
 *    construcción a lo único que estas fotos miran —que el revestimiento LLEGUE—;
 *  · estas fotos son ciegas a la estructura: cinco fichas preciosas y reorganizadas
 *    pasarían en verde.
 *
 * Juntas dicen la frontera entera: ningún modelo reorganiza, y cada modelo reviste.
 *
 * ── POR QUÉ CINCO Y NO CUATRO, AL REVÉS QUE `modelos-buscador.spec.ts` ─────────────
 *
 * Aquel deja fuera el Modelo 0 porque su diálogo ya está fotografiado en `overlays.spec.ts`
 * CON EL MISMO ENCUADRE. Aquí no ocurre: el Modelo 0 de la ficha sólo existe dentro de
 * `publico-blog-articulo`, que es una captura de página entera donde la ficha es una
 * franja pequeña entre otros seis bloques. Una comparación por modelo con un encuadre
 * distinto para uno de los cinco no es una comparación. Así que el Modelo 0 tiene su foto,
 * y las cinco se miran de una sentada — que es además lo que se enseña para aprobar el
 * aspecto.
 *
 * ── EL ENCUADRE LLEVA MARGEN A PROPÓSITO ──────────────────────────────────────────
 *
 * Se fotografía la caja de la ficha MÁS 24 px por cada lado, en vez de la caja pelada. Un
 * `toHaveScreenshot()` sobre el elemento recorta por su caja de borde: la sombra cae
 * fuera y se pierde justo lo que esta ráfaga añade —que la tarjeta se SEPARE del fondo—.
 * Con el margen entran la sombra y el lienzo de alrededor, que es contra lo que se separa.
 *
 * ⚠ ESTO CAMBIA EL MODELO ACTIVO DE LA INSTANCIA. El `afterAll` lo devuelve al Modelo 0
 * pase lo que pase: esta spec corre dentro de la batería compartida y un tema fugado
 * repintaría todas las capturas siguientes —tomadas con el Modelo 0— poniéndolas rojas en
 * masa y apuntando a cualquier sitio menos a aquí.
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
 * El nombre de la captura lleva modelo Y versión: el eje de versión cambia el aspecto
 * tanto como el de modelo — `premium@claro` y `premium@oscuro` son el mismo modelo y no se
 * parecen en nada. Es donde mejor se ve si una tarjeta se separa del fondo o se funde con
 * él: en un tema oscuro la elevación no la da la sombra, la da la luz.
 */
const MODELOS: readonly [captura: string, modelo: string, version: string, colores: Record<string, string>][] = [
  ['modelo-0', 'modelo-0', '1', COLORES_0],
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
    throw new Error(`[ficha] no se pudo activar ${modelo}@${version}: ${res.status()} ${await res.text()}`);
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

const MARGEN = 24;

test.describe('Escaparate — la ficha por modelo', () => {
  test.afterAll(async ({ request }) => {
    await ponerModelo(request, 'modelo-0', '1', COLORES_0);
  });

  for (const [captura, modelo, version, colores] of MODELOS) {
    test(`ficha-${captura}`, async ({ page, request }) => {
      if (modelo === 'modelo-0') {
        await ponerModelo(request, 'modelo-0', '1', COLORES_0);
      } else {
        // El Modelo 0 primero, para tener contra qué contrastar: si el PUT de abajo no
        // llegara a la página, las dos lecturas coincidirían y la foto saldría del modelo
        // equivocado sin que nada se quejara.
        await ponerModelo(request, 'modelo-0', '1', COLORES_0);
        await page.goto(RUTA_BLOG);
        const temaCero = await temaDe(page);

        await ponerModelo(request, modelo, version, colores);

        // El `revalidateTag('estilo')` del PUT es fire-and-forget, así que la primera
        // visita puede servirse todavía del tema anterior. Se espera a que la página
        // REFLEJE el cambio, no a que el PUT responda.
        await expect(async () => {
          await page.goto(RUTA_BLOG, { waitUntil: 'load' });
          expect(await temaDe(page)).not.toBe(temaCero);
        }).toPass({ timeout: 30_000 });
      }

      await preparar(page, RUTA_BLOG);

      const ficha = page.getByTestId('bloque-ficha');
      // La red del contenido, igual que los MARCADORES de la invariancia: si el bloque
      // `profile` desapareciera del seed, esto fallaría diciendo qué falta en vez de
      // fotografiar un hueco y llamarlo baseline.
      await expect(ficha).toContainText(NOMBRE_FICHA);
      await ficha.scrollIntoViewIfNeeded();

      const caja = await ficha.boundingBox();
      if (!caja) throw new Error('[ficha] la tarjeta no tiene caja: no hay nada que fotografiar');

      await expect(page).toHaveScreenshot(`ficha-${captura}.png`, {
        clip: {
          x: Math.max(0, caja.x - MARGEN),
          y: Math.max(0, caja.y - MARGEN),
          width: caja.width + MARGEN * 2,
          height: caja.height + MARGEN * 2,
        },
      });
    });
  }
});
