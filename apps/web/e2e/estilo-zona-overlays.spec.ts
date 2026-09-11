import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';

/**
 * ══ RESIDUO 1 · LOS OVERLAYS HEREDAN LOS TOKENS DE SU ZONA ═══════════════════════════
 *
 * LO QUE ESTABA ROTO, medido en E6 con una sonda en el navegador: los diálogos, menús y
 * selectores de Radix se montan en `<body>`, o sea FUERA del `[data-zona="…"]` que
 * envuelve el árbol de la zona. Como la zona funciona por HERENCIA de custom properties,
 * un diálogo del backoffice se quedaba con los tokens de la BASE — se animaba 50 ms más
 * lento de lo que su zona pide y usaba los grises saturados en vez de los desaturados.
 *
 * EL ARREGLO es el mecanismo de siempre aplicado donde el portal lo había roto: el
 * contenido portalado declara su propia `data-zona`, la de donde se abrió. El porqué
 * completo está en `src/components/estilo/zona.tsx`.
 *
 * ── POR QUÉ SE MIDE `getComputedStyle` Y NO EL ATRIBUTO ──────────────────────────────
 *
 * Porque el atributo es el medio, no el fin. Que un nodo lleve `data-zona="backoffice"`
 * no demuestra que esté RECIBIENDO los tokens del backoffice: podría estar escrito en el
 * nodo equivocado, o el bloque de la zona podría no llegar a emitirse. Lo que aquí se
 * afirma es el resultado — el valor que el navegador computa DENTRO de la capa — y de
 * paso se contrasta contra el del `<html>`, para que un token que coincidiera por
 * casualidad no se cuele como verde.
 *
 * Que los CUATRO componentes genéricos declaran la zona —se usen donde se usen— lo
 * comprueba `src/components/estilo/zona.test.tsx`: aquí sólo se puede medir donde cada
 * overlay existe hoy, y hoy el backoffice no monta ni un `dropdown-menu`.
 *
 * Los valores esperados no se inventan: son los que el Modelo 0 declara para cada zona
 * en `apps/api/src/modules/estilo/estilo.constants.ts`.
 */

/** Modelo 0: la BASE, que es también lo que ve la zona pública (no tiene bloque propio). */
const BASE = { duracion: '150ms', accent: '210 40% 96.1%' };

/** Modelo 0 · `ajustesPorZona`. */
const ZONAS = {
  backoffice: { duracion: '100ms', accent: '210 16% 96.1%', mutedForeground: '215.4 10% 41%' },
  cuenta: { duracion: '120ms', accent: '210 28% 96.1%' },
  blog: { duracion: '120ms', background: '40 33% 99%' },
};

/** Los tokens que el navegador computa en ese nodo, ya sin espacios. */
async function tokens(nodo: Locator) {
  return nodo.evaluate((el) => {
    const c = getComputedStyle(el);
    const leer = (n: string) => c.getPropertyValue(n).trim();
    return {
      duracion: leer('--motion-duration'),
      accent: leer('--accent'),
      mutedForeground: leer('--muted-foreground'),
      background: leer('--background'),
      zona: el.getAttribute('data-zona'),
    };
  });
}

/** Lo mismo en el `<html>`: el contraste que convierte «coincide» en «hereda de SU zona». */
async function tokensDeLaBase(page: Page) {
  return page.evaluate(() => {
    const c = getComputedStyle(document.documentElement);
    return {
      duracion: c.getPropertyValue('--motion-duration').trim(),
      accent: c.getPropertyValue('--accent').trim(),
    };
  });
}

/**
 * ── BARRERA 1 + 2 · EL BACKOFFICE ────────────────────────────────────────────────────
 *
 * Las tres capas genéricas que el backoffice monta hoy. La cuarta —`dropdown-menu`— no
 * se usa en ninguna pantalla de `(admin)`, así que se mide en la cuenta, más abajo.
 */
test.describe('Backoffice — la zona que RESTA llega a sus capas', () => {
  test('el SELECTOR de la bandeja usa los tokens del backoffice, no los de la base', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/mensajes-contacto');

    await page.getByRole('combobox').first().click();
    const capa = page.getByRole('listbox');
    await expect(capa).toBeVisible();

    const t = await tokens(capa);
    expect(t.zona).toBe('backoffice');
    expect(t.duracion).toBe(ZONAS.backoffice.duracion);
    expect(t.accent).toBe(ZONAS.backoffice.accent);
    // No sólo el tempo: el gris desaturado que la zona baja es LO QUE SE VE.
    expect(t.mutedForeground).toBe(ZONAS.backoffice.mutedForeground);

    // Y lo que hace que esto signifique algo: en el `<html>` siguen los de la base. La
    // capa NO está leyendo del `<body>` —que es donde el portal la cuelga—, está leyendo
    // de sí misma.
    expect(await tokensDeLaBase(page)).toEqual(BASE);

    await page.close();
  });

  test('el DIÁLOGO de «nuevo banner» también, velo incluido', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/banners');

    await page.getByRole('button', { name: 'Nuevo banner' }).click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();

    const t = await tokens(dialogo);
    expect(t.zona).toBe('backoffice');
    expect(t.duracion).toBe(ZONAS.backoffice.duracion);
    expect(t.accent).toBe(ZONAS.backoffice.accent);

    /**
     * EL VELO NO CUELGA DEL CONTENIDO —Radix da a cada uno su propio portal—, así que no
     * hereda nada de él y necesita su propia declaración. Se comprueba aparte porque un
     * arreglo que sólo marcara el contenido pasaría el aserto de arriba y dejaría el velo
     * animándose a un tempo distinto del de la capa que cubre.
     *
     * Se cuenta lo que lleva zona FUERA del shell del backoffice —o sea, lo portalado—:
     * con el diálogo abierto tienen que ser exactamente dos, velo y contenido.
     */
    const portalados = await page.evaluate(() => {
      const shell = document.querySelector('[data-zona="backoffice"]')!;
      return Array.from(document.querySelectorAll('[data-zona]'))
        .filter((el) => el !== shell && !shell.contains(el))
        .map((el) => el.getAttribute('data-zona'));
    });
    expect(portalados).toEqual(['backoffice', 'backoffice']);

    await page.close();
  });

  test('el AVISO de «volver a fábrica» también', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/estilo');

    // Sólo se ABRE; confirmar repintaría la instancia entera y esta batería comparte
    // estado con el resto.
    await page.getByTestId('volver-a-fabrica').click();
    const aviso = page.getByRole('alertdialog');
    await expect(aviso).toBeVisible();

    const t = await tokens(aviso);
    expect(t.zona).toBe('backoffice');
    expect(t.duracion).toBe(ZONAS.backoffice.duracion);
    expect(t.accent).toBe(ZONAS.backoffice.accent);

    await aviso.getByRole('button', { name: 'Cancelar' }).click();
    await page.close();
  });
});

/**
 * ── BARRERA 2 · EL CUARTO OVERLAY, DONDE SÍ SE USA ───────────────────────────────────
 */
test.describe('Cuenta — el menú y el aviso de una tarjeta', () => {
  test('el MENÚ de acciones usa los 120 ms y el gris de la cuenta', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');

    await page.getByTestId('btn-mas-acciones').first().click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible({ timeout: 10_000 });

    const t = await tokens(menu);
    expect(t.zona).toBe('cuenta');
    expect(t.duracion).toBe(ZONAS.cuenta.duracion);
    expect(t.accent).toBe(ZONAS.cuenta.accent);
    expect(await tokensDeLaBase(page)).toEqual(BASE);

    await page.close();
  });
});

/**
 * ── BARRERA 1 · Y LA BASE SIGUE SIENDO LA BASE ───────────────────────────────────────
 *
 * El control negativo del mecanismo: en el sitio público NO se escribe `data-zona`
 * —`public` es el registro base y no tiene bloque propio—, así que la capa hereda de
 * `html:root` y se ve exactamente igual que antes de esta ráfaga. Si un día alguien
 * marcara los overlays con una zona «por simetría», esto se pone rojo.
 */
test.describe('Público — la capa hereda de la base, sin zona que declarar', () => {
  test('el menú de «Compartir» de una ficha no lleva zona y usa los 150 ms', async ({ page }) => {
    await page.goto('/anuncio/listing-rf11-e2e');

    await page.getByRole('button', { name: 'Compartir' }).click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    const t = await tokens(menu);
    expect(t.zona).toBeNull();
    expect(t.duracion).toBe(BASE.duracion);
    expect(t.accent).toBe(BASE.accent);
  });
});

/**
 * ── BARRERA 1 · EL BLOG ──────────────────────────────────────────────────────────────
 *
 * ⚠ ESTE SE MIDE CON UNA SONDA, Y HAY QUE DECIR POR QUÉ. El blog NO monta hoy ninguna
 * capa genérica: sus dos plantillas son texto, y la única que tendría (`MainNav`) sólo
 * aparece si el árbol de navegación trae nodos con hijos, que es estado global de la
 * batería y mutarlo desde aquí acoplaría esta spec con `nav-publico`.
 *
 * Así que se comprueba la mitad que sí se puede comprobar aquí, y es justo la que el
 * portal ponía en duda: que un nodo colgado de `<body>` —fuera del subárbol del blog—
 * recibe los tokens del blog por declarar la zona. La otra mitad —que los cuatro
 * componentes la declaran— la fija el test unitario, que sí puede montarlos en el blog.
 *
 * La sonda se inyecta en `<body>` a mano, exactamente donde Radix cuelga sus portales.
 */
test.describe('Blog — la zona que TIÑE alcanza lo portalado', () => {
  test('un nodo colgado de <body> con la zona del blog recibe los tokens del blog', async ({
    page,
  }) => {
    await page.goto('/blog');
    // El envoltorio de la zona existe: sin esto la sonda mediría sobre una página que no
    // es el blog y el verde no diría nada.
    await expect(page.locator('[data-zona="blog"]')).toHaveCount(1);

    const medido = await page.evaluate(() => {
      const sonda = document.createElement('div');
      sonda.setAttribute('data-zona', 'blog');
      document.body.appendChild(sonda);
      const c = getComputedStyle(sonda);
      const r = {
        duracion: c.getPropertyValue('--motion-duration').trim(),
        background: c.getPropertyValue('--background').trim(),
      };
      sonda.remove();
      return r;
    });

    expect(medido.duracion).toBe(ZONAS.blog.duracion);
    expect(medido.background).toBe(ZONAS.blog.background);
    // Y sin la zona, el mismo nodo en el mismo sitio se queda con la base: es el
    // contraste que convierte lo de arriba en una afirmación.
    expect(await tokensDeLaBase(page)).toEqual(BASE);
  });
});
