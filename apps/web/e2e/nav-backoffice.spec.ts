// PUNTO 3 — LA REORGANIZACIÓN DE LA BARRA DEL BACKOFFICE.
//
// Diseño: docs/diseno-nav-backoffice.md. Tres cosas que son una sola (la barra):
//
//   3a  «Dashboard» → «Resumen».
//   3b  grupos que nacen abiertos y se pliegan a mano, + drawer de móvil, + el
//       defecto A3 arreglado (el aside sin breakpoint y el main sin `min-w-0`).
//   3c  «Motivos de contacto» deja el primer nivel y baja al grupo «Atención al
//       usuario» — SIN salir del nav.
//
// LO QUE ESTE FICHERO **NO** COMPRUEBA, y es deliberado: el reparto por rol. Eso lo
// pinzan `admin-roles.spec.ts` (en el navegador) y `backoffice-sections.test.ts` (sobre
// el mapa), y siguen verdes sin tocarlos porque `navSectionsFor` no ha cambiado. Aquí
// se mira sólo la ESTRUCTURA de la barra.

import { test, expect } from './fixtures/auth';

const GRUPOS = [
  'Moderación',
  'Atención al usuario',
  'Catálogo',
  'Contenido',
  'Promoción',
  'Plataforma',
];

test.describe('3a + 3b — la barra agrupada, en escritorio', () => {
  test('los seis grupos están, y NACEN ABIERTOS', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    const nav = page.getByTestId('admin-nav');
    await expect(nav).toBeVisible();

    for (const grupo of GRUPOS) {
      const cabecera = nav.getByRole('button', { name: grupo });
      await expect(cabecera).toBeVisible();
      // NACEN ABIERTOS, y no es cosmética: un menú que esconde destinos por defecto
      // produce lo mismo que el defecto R3 —una sección que nadie encuentra— para
      // quien no sepa que hay que abrir el grupo. Plegar es un acto del usuario.
      await expect(cabecera).toHaveAttribute('aria-expanded', 'true');
    }

    // Y con todo abierto siguen estando todas —26 desde que «Ilustraciones» (E7) entró
    // en el grupo «Plataforma», junto a «Marca»—, que es lo que mantiene coherentes los
    // cuatro conteos de `admin-roles.spec.ts`.
    await expect(nav.getByRole('link')).toHaveCount(26);

    // 3a — la raíz, fuera de todo grupo y con su nombre nuevo.
    await expect(nav.getByRole('link', { name: 'Resumen' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);

    await page.close();
  });

  test('plegar un grupo esconde SUS destinos y no los de los demás', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    const nav = page.getByTestId('admin-nav');
    const cabecera = nav.getByRole('button', { name: 'Plataforma' });

    await expect(nav.getByRole('link', { name: 'Ajustes' })).toBeVisible();
    await cabecera.click();

    await expect(cabecera).toHaveAttribute('aria-expanded', 'false');
    await expect(nav.getByRole('link', { name: 'Ajustes' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Facturación' })).toHaveCount(0);
    // Los otros grupos no se enteran.
    await expect(nav.getByRole('link', { name: 'Anuncios', exact: true })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Resumen' })).toBeVisible();

    // Y se vuelve a abrir: plegar es reversible, no una decisión.
    await cabecera.click();
    await expect(nav.getByRole('link', { name: 'Ajustes' })).toBeVisible();

    await page.close();
  });
});

test.describe('3c — Motivos de contacto: fuera del primer nivel, DENTRO del nav', () => {
  // LA BARRERA ANTI-REVERSIÓN, y lleva las dos mitades juntas a propósito: la primera
  // sola permitiría OCULTARLA (que es lo que R2 borró al quitar `hiddenFromNav`), y la
  // segunda sola permitiría dejarla donde estaba. Sólo las dos describen lo acordado.
  test('está dentro del grupo «Atención al usuario» y sigue visible', async ({
    moderatorContext,
  }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    const nav = page.getByTestId('admin-nav');
    const motivos = nav.getByRole('link', { name: 'Motivos de contacto' });

    // MITAD 1 — sigue en el nav. Es el mismo hecho que afirma el test «R3 CERRADO»
    // sobre `navSectionsFor`: bajar de nivel no es desaparecer.
    await expect(motivos).toBeVisible();

    // MITAD 2 — ya no es de primer nivel: al plegar su grupo, desaparece. Si estuviera
    // suelta arriba (como la raíz) esto no la afectaría.
    const atencion = nav.getByRole('button', { name: 'Atención al usuario' });
    await expect(atencion).toBeVisible();
    await atencion.click();
    await expect(motivos).toHaveCount(0);
    // Y con ella sus dos hermanas de grupo, no otras.
    await expect(nav.getByRole('link', { name: 'Mensajes de contacto' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Tickets' })).toHaveCount(0);
    await expect(nav.getByRole('link', { name: 'Reportes' })).toBeVisible();

    await page.close();
  });

  test('y sigue siendo alcanzable: desde el nav y por su ruta', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('admin-nav').getByRole('link', { name: 'Motivos de contacto' }).click();
    await page.waitForURL(/\/admin\/motivos-contacto$/, { timeout: 15_000 });

    // Y directamente por la URL, que es lo que el middleware gobierna.
    await page.goto('/admin/motivos-contacto');
    await page.waitForLoadState('networkidle');
    expect(page.url()).toContain('/admin/motivos-contacto');

    await page.close();
  });
});

test.describe('3b (A3) — en móvil el backoffice se puede usar', () => {
  test.use({ viewport: { width: 375, height: 667 } });

  test('el aside no roba columna: el contenido ocupa casi todo el ancho', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/anuncios');
    await page.waitForLoadState('networkidle');

    const caja = await page.locator('main').boundingBox();
    expect(caja).not.toBeNull();
    // ANTES: el aside fijo de 224 px más el `p-8` dejaban ~87 px de los 375. El umbral
    // se pone en 300 para que cualquier regreso a un sidebar que ocupe columna en móvil
    // lo dispare. Molde literal de `shell-cuenta.spec.ts` (UXV.2, A3).
    expect(caja!.width).toBeGreaterThan(300);

    // Y nada desborda en horizontal — la otra cara del mismo defecto, la que arregla
    // el `min-w-0` del `<main>`. `/admin/anuncios` es una tabla ancha a propósito.
    const desborda = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(desborda).toBe(false);

    await page.close();
  });

  test('el drawer abre, lista las secciones, navega y se cierra al hacerlo', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');

    // En móvil el aside está oculto; el acceso es el botón de la cabecera.
    const abrir = page.getByRole('button', { name: /abrir el menú del backoffice/i });
    await expect(abrir).toBeVisible({ timeout: 15_000 });

    await abrir.click();
    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();

    // El MISMO menú que en escritorio: mismos grupos y mismos destinos. Un solo
    // componente para las dos superficies, molde de `AccountNav`.
    for (const grupo of GRUPOS) {
      await expect(panel.getByRole('button', { name: grupo })).toBeVisible();
    }
    await expect(panel.getByRole('link')).toHaveCount(26);
    await expect(panel.getByRole('link', { name: 'Motivos de contacto' })).toBeVisible();

    await panel.getByRole('link', { name: 'Reportes' }).click();
    await page.waitForURL(/\/admin\/reportes$/, { timeout: 15_000 });
    // Se cierra al navegar: si no, el panel se queda encima de la página nueva.
    await expect(page.getByRole('dialog')).not.toBeVisible();

    await page.close();
  });
});
