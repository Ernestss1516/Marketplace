// EL HUECO DEL BANNER QUE NO SE PINTA — los píxeles, en un navegador de verdad.
//
// Diagnóstico completo en docs/diagnostico-hueco-banner-invisible.md. Las pruebas
// de estructura (que no quede nodo, que el envoltorio lleve `empty:hidden`) están
// en src/components/banners/hueco-banner-invisible.test.tsx; aquí se mide lo
// único que zanja la discusión: **cuántos píxeles ocupa el banner que no se ve.**
//
// ── LOS TRES ESTADOS QUE SE COMPARAN, Y POR QUÉ SON TRES ────────────────────
//
//   SIN         — no hay banner en esa ubicación. Es el ideal: la página limpia.
//   CON         — el banner se pinta. Debe ocupar su espacio, el de su página.
//   DESCARTADO  — el servidor SÍ lo manda (activo, en fecha, en esa ubicación) y
//                 el visitante ya le dio a la ×. **Es el estado que dejaba hueco**,
//                 y el único de los cuatro caminos de «invisible» que se decide en
//                 el cliente: los otros tres (apagado, fuera de fecha, otra
//                 ubicación) los resuelve Postgres y el HTML nace sin nada.
//
// La afirmación que se comprueba es una igualdad, no un umbral:
// **DESCARTADO == SIN, al píxel.** «Como si no existiera» no admite «casi».
//
// Y la otra mitad, que es la que impide arreglar el hueco a lo bruto quitando el
// espaciado: **CON − SIN == la caja del banner**, su alto más el margen que esa
// página le declara (16, 24 o 32 px según la ubicación). Si alguien «arregla» el
// hueco dejando el banner visible pegado a lo de al lado, esto se cae.

import type { APIRequestContext, Page } from '@playwright/test';
import { request as apiRequest } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken, authedGet, authedPatch, authedPost } from './helpers/api';

const DISMISSED_KEY = 'dismissed-banners';

/**
 * Las tres formas de envoltorio que tenía el defecto, una por cada una.
 *
 * `espaciado` es el número que la página declara en su `className` — el mismo que
 * antes llevaba el `<div>` envoltorio. Está escrito a mano y no leído del CSS a
 * propósito: si alguien cambia el `mb-8` de /planes por un `mb-4`, esta prueba
 * tiene que obligarle a venir aquí y decirlo, no adaptarse en silencio.
 *
 * `propiedad` DICE CUÁL DE LAS DOS ES, y no es un detalle de implementación: la
 * portada usa PADDING (`pt-4`) y las otras MARGEN (`mb-6`/`mb-8`), y las dos no se
 * miden igual. El padding va DENTRO de la caja del elemento —entra en su
 * `getBoundingClientRect().height`— y el margen va fuera. Confundirlas fue lo
 * primero que falló al escribir esta prueba: la portada contaba sus 16 px dos
 * veces. Es, además, la misma distinción que explica el diagnóstico (§2.1): el
 * padding de la portada era el único hueco que no podía colapsar ni por
 * casualidad.
 *
 * `ancla` es el elemento estable que va JUSTO DEBAJO del banner en esa página; lo
 * que se mide es su posición absoluta en el documento.
 */
const PAGINAS = [
  {
    nombre: 'portada — `pt-4` (padding: el único que no podía colapsar ni por suerte)',
    placement: 'HOME' as const,
    ruta: '/',
    espaciado: 16,
    propiedad: 'padding-top' as const,
    // La banda del hero, por su variable de ambiente: es el primer elemento
    // después del banner y lo emite siempre HomeHeroBanda, para todos los modelos.
    ancla: 'section[style*="--hero-ambiente"]',
  },
  {
    nombre: 'contacto — `mb-6` (el caso de seis de las diez páginas)',
    placement: 'CONTACTO' as const,
    ruta: '/contacto',
    espaciado: 24,
    propiedad: 'margin-bottom' as const,
    ancla: 'form',
  },
  {
    nombre: 'planes — `mb-8` (el hueco más grande del censo)',
    placement: 'PLANES' as const,
    ruta: '/planes',
    espaciado: 32,
    propiedad: 'margin-bottom' as const,
    ancla: '.grid.max-w-4xl',
  },
];

function uniqueTitle(prefix: string) {
  return `${prefix} ${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

/** Crea un banner vigente en esas ubicaciones y devuelve su id. */
async function crearBanner(
  request: APIRequestContext,
  opts: { title: string; placements: string[] },
): Promise<string> {
  const now = Date.now();
  const res = await authedPost(request, '/admin/banners', adminApiToken(), {
    title: opts.title,
    text: 'Un aviso de una sola línea, para que el alto sea estable entre medidas.',
    placements: opts.placements,
    startsAt: new Date(now - 60_000).toISOString(),
    endsAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (!res.ok()) {
    throw new Error(`[hueco] crear banner falló: ${res.status()} ${await res.text()}`);
  }
  return ((await res.json()) as { id: string }).id;
}

/**
 * Posición absoluta del ancla en el documento, en píxeles.
 *
 * `scrollY + top` y no `offsetTop`: el ancla no siempre es hija directa del
 * mismo contenedor posicionado en las tres páginas, y `offsetTop` mide contra su
 * `offsetParent`, que puede cambiar. Esto mide contra el documento, que es lo que
 * el visitante ve moverse.
 */
async function posicionDelAncla(page: Page, ruta: string, ancla: string): Promise<number> {
  await page.goto(ruta);
  await page.waitForLoadState('networkidle');
  const locator = page.locator(ancla).first();
  await expect(locator, `el ancla \`${ancla}\` de ${ruta} tiene que existir`).toBeVisible();
  return locator.evaluate((el) => Math.round(el.getBoundingClientRect().top + window.scrollY));
}

/** Marca un id como descartado ANTES de que corra nada de la página. */
async function marcarComoDescartado(page: Page, id: string) {
  await page.addInitScript(
    ([clave, bannerId]) => {
      localStorage.setItem(clave, JSON.stringify([bannerId]));
    },
    [DISMISSED_KEY, id] as const,
  );
}

/**
 * Apaga los banners que enciende este spec.
 *
 * ⚠ VA EN `beforeEach`, NO SÓLO EN `afterAll`, y eso lo enseñó un rojo. Cada
 * prueba de aquí empieza midiendo la página SIN banner, y el banner que dejó
 * encendido la prueba ANTERIOR (no hay DELETE: el modelo sólo desactiva, y viven
 * 30 días) entraba en esa medida base. La barrera no dependía de lo que mide sino
 * del orden del fichero — y eso sale flaky, no rojo, que es peor.
 *
 * No hay DELETE de banners a propósito (decisión del modelo), así que se
 * desactivan; el filtro es el prefijo con el que los crea este fichero.
 */
async function apagarBannersDeEsteSpec(ctx: APIRequestContext) {
  const admin = adminApiToken();
  const res = await authedGet(ctx, '/admin/banners?active=true&perPage=100', admin);
  if (!res.ok()) return;
  const { items } = (await res.json()) as { items: { id: string; title: string }[] };
  for (const banner of items.filter((b) => b.title.startsWith('E2E Hueco'))) {
    await authedPatch(ctx, `/admin/banners/${banner.id}`, admin, { active: false });
  }
}

test.beforeEach(async ({ request }) => {
  await apagarBannersDeEsteSpec(request);
});

/** Y al final, para no filtrar a los specs siguientes — la batería comparte base. */
test.afterAll(async () => {
  const ctx = await apiRequest.newContext();
  try {
    await apagarBannersDeEsteSpec(ctx);
  } finally {
    await ctx.dispose();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BARRERAS 1 y 2 — invisible colapsa a cero; visible ocupa lo suyo
// ─────────────────────────────────────────────────────────────────────────────

test.describe('El banner invisible no ocupa; el visible ocupa lo que su página declara', () => {
  for (const pagina of PAGINAS) {
    test(`${pagina.nombre}`, async ({ page, request }) => {
      // 1. SIN — la página tal cual, antes de que exista el banner.
      const sin = await posicionDelAncla(page, pagina.ruta, pagina.ancla);
      // Si otro spec dejó un banner encendido en esta ubicación, la línea base no
      // es la línea base. Se dice aquí y no se descubre veinte líneas más abajo
      // como un desajuste de píxeles sin explicación.
      await expect(
        page.getByTestId('banner-list'),
        `la medida base de ${pagina.ruta} exige que no haya ningún banner vivo en ${pagina.placement}`,
      ).toHaveCount(0);

      // 2. CON — el banner se pinta.
      const id = await crearBanner(request, {
        title: uniqueTitle('E2E Hueco'),
        placements: [pagina.placement],
      });
      const con = await posicionDelAncla(page, pagina.ruta, pagina.ancla);
      const lista = page.getByTestId('banner-list');
      await expect(lista).toBeVisible();
      const caja = await lista.evaluate((el) => {
        const estilo = getComputedStyle(el);
        return {
          alto: Math.round(el.getBoundingClientRect().height),
          margenVertical:
            Math.round(parseFloat(estilo.marginTop)) + Math.round(parseFloat(estilo.marginBottom)),
          paddingTop: Math.round(parseFloat(estilo.paddingTop)),
          marginBottom: Math.round(parseFloat(estilo.marginBottom)),
        };
      });

      // BARRERA 2a — el espaciado que la página declara está EN LA RAÍZ del
      // componente, que es lo que hace que el `null` se lo lleve consigo. Si
      // alguien lo devuelve a un envoltorio, aquí saldrá 0.
      const declarado = pagina.propiedad === 'padding-top' ? caja.paddingTop : caja.marginBottom;
      expect(
        declarado,
        `el \`${pagina.propiedad}\` de ${pagina.ruta} tiene que estar en la raíz de banner-list`,
      ).toBe(pagina.espaciado);

      // BARRERA 2b — y lo que la página crece es EXACTAMENTE la caja del banner:
      // su alto (que ya incluye el padding) más lo que quede fuera, el margen. Ni
      // pegado —que sería crecer sólo el alto sin margen donde se declaró uno— ni
      // descolgado.
      expect(
        con - sin,
        `con el banner visible, ${pagina.ruta} debe crecer su caja: alto ${caja.alto} + margen ${caja.margenVertical}`,
      ).toBe(caja.alto + caja.margenVertical);

      // 3. DESCARTADO — el servidor lo sigue mandando; el visitante ya lo cerró.
      await marcarComoDescartado(page, id);
      const descartado = await posicionDelAncla(page, pagina.ruta, pagina.ancla);
      await expect(page.getByTestId('banner-list')).toHaveCount(0);

      // BARRERA 1 — IGUALDAD, no umbral.
      //
      // En la portada, antes del arreglo esto valía `sin + 16`: su espaciado es
      // PADDING y el padding no colapsa con nada. En las otras dos valía `sin`
      // igualmente, porque su espaciado es MARGEN y el hermano de arriba ya trae
      // el suyo, que lo absorbe — el envoltorio estaba, pero no costaba píxeles
      // (docs/diagnostico-hueco-banner-invisible.md §2.1). Se comprueban las tres
      // de todos modos: lo que la igualdad defiende en esas dos es que el día que
      // ese hermano pierda su margen, el hueco no aparezca.
      expect(
        descartado,
        `el banner descartado tiene que colapsar a CERO: ${pagina.ruta} debe quedar exactamente como sin banner`,
      ).toBe(sin);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BARRERA 3 — sin CLS al aparecer el banner
// ─────────────────────────────────────────────────────────────────────────────

test.describe('BARRERA 3 — el banner aparece sin mover nada', () => {
  type Medida = { total: number; fuentes: string[] };
  type Ventana = Window & { __cls: number; __fuentes: string[] };

  /**
   * El instrumento de `buscador-dialogos.spec.ts`, con UNA diferencia que importa:
   * se instala con `addInitScript` y `buffered: true`.
   *
   * El de allí mide el salto que provoca una INTERACCIÓN posterior, así que se
   * arma después de cargar. Aquí lo que se vigila es la carga misma —¿el banner
   * nace en el HTML o se reserva y se rellena?—, y un observador armado después
   * de `load` llega tarde a su propia pregunta. `buffered: true` recupera las
   * entradas anteriores a su instalación.
   *
   * GUARDA LAS FUENTES, y por el mismo motivo que allí: un 0,001 sin saber de
   * dónde sale obliga a adivinar. `hadRecentInput` se descarta porque el propio
   * estándar de CLS no cuenta lo que el usuario provocó.
   */
  async function armar(page: Page) {
    await page.addInitScript(() => {
      const w = window as unknown as Ventana;
      w.__cls = 0;
      w.__fuentes = [];
      new PerformanceObserver((lista) => {
        for (const entrada of lista.getEntries()) {
          const desplazamiento = entrada as PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
            sources?: { node?: Element; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[];
          };
          if (desplazamiento.hadRecentInput) continue;
          w.__cls += desplazamiento.value;
          for (const fuente of desplazamiento.sources ?? []) {
            const nodo = fuente.node;
            const nombre = nodo
              ? `${nodo.tagName.toLowerCase()}${nodo.className ? '.' + String(nodo.className).split(/\s+/).slice(0, 3).join('.') : ''}`
              : '(sin nodo)';
            const dy = Math.round(fuente.currentRect.y - fuente.previousRect.y);
            w.__fuentes.push(`${nombre}  Δy=${dy}`);
          }
        }
      }).observe({ type: 'layout-shift', buffered: true });
    });
  }

  async function leer(page: Page): Promise<Medida> {
    return page.evaluate(() => {
      const w = window as unknown as Ventana;
      return { total: w.__cls, fuentes: w.__fuentes };
    });
  }

  test('el instrumento NO da verde por no medir: un salto inyectado lo dispara', async ({ page }) => {
    // ⚠ EL GUARD. Un medidor de CLS que devuelve 0 porque no está escuchando da
    // exactamente el mismo número que uno que mide una página perfecta, y el
    // segundo no vale nada sin descartar el primero. Aquí se le mete un salto a
    // mano —80 px de contenido insertado por delante— y se exige que lo vea.
    await armar(page);
    await page.goto('/planes');
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      const intruso = document.createElement('div');
      intruso.style.height = '80px';
      document.body.prepend(intruso);
    });
    // Un frame para que el observador emita la entrada.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    const medida = await leer(page);
    expect(medida.total, 'con un salto inyectado el instrumento tiene que acusarlo').toBeGreaterThan(0);
    expect(medida.fuentes.length).toBeGreaterThan(0);
  });

  /**
   * ⚠ POR QUÉ ESTO NO EXIGE UN CERO PELADO, Y CÓMO SE DECIDIÓ.
   *
   * La primera versión exigía `total === 0`, como hace `buscador-dialogos`. Salió
   * **flaky**: unas corridas daban 0 y otras 0,000053 **con la lista de fuentes
   * VACÍA** — un desplazamiento sin nodo al que atribuirlo, del orden de una
   * centésima de píxel repartida por la página. Y salía **igual con banner y sin
   * él**, que es el dato que decide: no es el banner, es el suelo de ruido de la
   * página (tipografía que asienta, redondeos sub-píxel).
   *
   * Un cero pelado aquí no mediría el banner: mediría la suerte de la corrida. Así
   * que la barrera se escribe como la afirmación que de verdad se quiere hacer,
   * en dos mitades que sí son del banner:
   *
   *   1. **CON no es peor que SIN.** La misma página, medida las dos veces en la
   *      misma corrida. Si el banner reservara para rellenar después, CON se
   *      dispararía y SIN no.
   *   2. **Ninguna fuente es el banner.** Si algo se mueve por su culpa, el
   *      instrumento guarda el nodo y aquí se lee su nombre.
   *
   * Y el TECHO —0,001— no es un número de compromiso: un hueco de 24 px que
   * apareciera o desapareciera en un viewport de 720 px da un CLS del orden de
   * 0,03, **seiscientas veces** el ruido medido. El defecto que esta prueba
   * persigue no cabe por debajo de ese techo ni de lejos.
   */
  const TECHO_DE_RUIDO = 0.001;

  test('el banner no empeora el CLS: nace en el HTML, no se reserva para rellenar', async ({
    page,
    request,
  }) => {
    // SIN — el suelo de ruido de esta misma página, en esta misma corrida.
    await armar(page);
    await page.goto('/planes');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('banner-list')).toHaveCount(0);
    const sin = await leer(page);

    await crearBanner(request, {
      title: uniqueTitle('E2E Hueco CLS'),
      placements: ['PLANES'],
    });

    // CON — el banner se pinta desde el servidor.
    await page.goto('/planes');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('banner-list')).toBeVisible();
    const con = await leer(page);

    expect(
      con.total,
      `CLS con banner ${con.total} vs sin banner ${sin.total}; fuentes: ${JSON.stringify(con.fuentes)}`,
    ).toBeLessThanOrEqual(Math.max(sin.total, TECHO_DE_RUIDO));

    expect(
      con.fuentes.filter((f) => f.includes('banner')),
      'ninguna fuente del salto puede ser el banner',
    ).toEqual([]);
  });
});
