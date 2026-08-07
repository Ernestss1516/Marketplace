// PORTADA — /admin/portada (RP.3). El editor con el que un ADMIN configura la
// home: el hero (campo propio) y el array de bloques.
//
// Va ANTES que los 5 tipos caros a propósito: a partir de aquí ningún tipo nace
// sin forma de configurarlo.
//
// Lo que se prueba aquí y no puede probarse en otro sitio:
//   - las DOS ZONAS: el hero no es un bloque, no se mueve ni se quita;
//   - el TOPE de 6 palabras rotativas como BARRERA de UI (no un aviso): al
//     llegar a 6 no se puede añadir la séptima. No es capricho — la animación
//     es CSS y solo hay reglas @keyframes para 2…6;
//   - que guardar REVALIDA: el cambio se ve en / sin reiniciar nada;
//   - el gate de rol: la portada es configuración, solo ADMIN.
//
// La config es estado GLOBAL compartido con el resto de la batería, así que se
// restaura al terminar. El token de API no cuesta ningún login (lo obtiene
// globalSetup una vez para toda la corrida).

import { test, expect } from './fixtures/auth';
import type { Page } from '@playwright/test';
import { PORTADA_SEMILLA, restaurarPortada } from './helpers/portada';

const TITULO_SEMILLA = PORTADA_SEMILLA.heroStaticTitle;

/**
 * Cada test parte de la config sembrada.
 *
 * NO es celo: varios de estos tests GUARDAN, y sin esto cada uno heredaba lo que
 * dejó el anterior. Se vio: el test del enlace inválido añadía un segundo botón
 * sobre el que ya había guardado el test previo, y `getByTestId('cta-href')`
 * pasaba a resolver dos elementos. Un `afterAll` no basta — hace falta el estado
 * conocido ANTES de cada uno.
 *
 * La semilla viene de helpers/portada.ts, no de una copia local: cuando cada
 * spec llevaba la suya, se quedó atrás al crecer el seed en RP.4 y estos tests
 * "restauraban" una portada sin `steps` ni `grid`.
 */
test.beforeEach(async ({ request }) => {
  await restaurarPortada(request);
});

test.afterAll(async ({ request }) => {
  await restaurarPortada(request);
});

/** Abre el editor y espera a que cargue la config. */
async function abrirEditor(page: Page) {
  await page.goto('/admin/portada');
  await expect(page.getByTestId('zona-hero')).toBeVisible();
  await expect(page.getByTestId('zona-bloques')).toBeVisible();
}

/**
 * Recarga la portada pública hasta que refleje lo guardado. La invalidación por
 * tag es fire-and-forget, así que hay una ventana real.
 *
 * `waitUntil: 'load'` y locators PLANOS, nunca `getByRole`: un elemento sin caja
 * de layout no está en el árbol de accesibilidad y `getByRole` devolvería 0
 * aunque el nodo esté en el DOM (lección de RP.2).
 */
async function esperarEnLaPortada(page: Page, texto: string) {
  await expect(async () => {
    await page.goto('/', { waitUntil: 'load' });
    if ((await page.getByText(texto, { exact: false }).count()) === 0) {
      throw new Error(`la portada aún no muestra "${texto}"`);
    }
  }).toPass({ timeout: 30_000 });
}

test.describe('Editor de portada — hero', () => {
  test('el ADMIN ve las dos zonas y el preview con la config actual', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await abrirEditor(page);

    // El titular actual llega cargado, no en blanco.
    await expect(page.getByTestId('hero-static-title')).toHaveValue(TITULO_SEMILLA);

    // El preview reusa los MISMOS componentes que el sitio público, así que
    // enseña el titular de verdad.
    const preview = page.getByTestId('portada-preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator('h1')).toContainText(TITULO_SEMILLA);

    // El hero no es un bloque: no aparece en la lista de bloques ni tiene
    // flechas ni botón de quitar.
    await expect(page.getByTestId('zona-bloques')).not.toContainText('Titular');
    await page.close();
  });

  test('el preview refleja lo escrito ANTES de guardar', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await abrirEditor(page);

    await page.getByTestId('hero-static-title').fill('Titular de prueba');
    await expect(page.getByTestId('portada-preview').locator('h1')).toContainText(
      'Titular de prueba',
    );
    await page.close();
  });

  test('el tope de 6 palabras rotativas es una BARRERA, no un aviso', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await abrirEditor(page);

    const añadir = page.getByTestId('hero-add-rotating');
    await expect(añadir).toBeEnabled();

    for (let i = 0; i < 6; i++) {
      await añadir.click();
      await page.getByTestId(`hero-rotating-${i}`).fill(`opcion${i + 1}`);
    }

    await expect(page.getByTestId('hero-rotating-count')).toHaveText('6 de 6');
    // La séptima NO se puede añadir.
    await expect(añadir).toBeDisabled();
    await expect(page.getByTestId('hero-rotating-max')).toBeVisible();

    // Y al quitar una, vuelve a poder añadirse.
    await page.getByRole('button', { name: 'Quitar opción 6' }).click();
    await expect(añadir).toBeEnabled();
    await page.close();
  });

  test('el título fijo vacío bloquea el guardado con el motivo escrito', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await abrirEditor(page);

    await page.getByTestId('hero-static-title').fill('');
    await expect(page.getByTestId('hero-title-error')).toBeVisible();
    await expect(page.getByTestId('guardar-portada')).toBeDisabled();
    await expect(page.getByTestId('portada-validacion')).toBeVisible();
    await page.close();
  });

  test('editar el hero y guardar: la portada lo muestra', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await abrirEditor(page);

    await page.getByTestId('hero-static-title').fill('Encuentra tu');
    await page.getByTestId('hero-add-rotating').click();
    await page.getByTestId('hero-rotating-0').fill('coche');
    await page.getByTestId('hero-add-rotating').click();
    await page.getByTestId('hero-rotating-1').fill('bici');
    await page.getByTestId('hero-subtitle').fill('Subtítulo de prueba');
    await page.getByTestId('hero-rotation-ms').fill('2500');

    await page.getByTestId('guardar-portada').click();
    await expect(page.getByTestId('portada-guardada')).toBeVisible();

    // Guardar dispara revalidateTag: la portada lo refleja sin reiniciar nada.
    const publica = await adminContext.newPage();
    await esperarEnLaPortada(publica, 'Encuentra tu');

    const h1 = publica.locator('h1').first();
    await expect(h1).toContainText('coche');
    await expect(h1).toContainText('bici');
    // La velocidad configurada llega al motor de CSS: ciclo = 2500 × 2 palabras.
    await expect(publica.locator('.hero-rot-item').first()).toHaveCSS(
      'animation-duration',
      '5s',
    );
    await expect(publica.getByText('Subtítulo de prueba')).toBeVisible();

    await publica.close();
    await page.close();
  });
});

test.describe('Editor de portada — bloques', () => {
  test('añadir un botón destacado, guardar y verlo en la portada', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await abrirEditor(page);

    await page.getByTestId('home-add-block').click();
    await page.getByTestId('home-block-type-cta').click();

    // El selector usa lenguaje claro, no el nombre técnico del tipo.
    await expect(page.getByTestId('home-block-row-cta')).toBeVisible();
    await expect(page.getByTestId('zona-bloques')).toContainText('Botón destacado');

    await page.getByTestId('cta-label').fill('Vende lo que no usas');
    await page.getByTestId('cta-href').fill('/publicar');

    await page.getByTestId('guardar-portada').click();
    await expect(page.getByTestId('portada-guardada')).toBeVisible();

    const publica = await adminContext.newPage();
    await esperarEnLaPortada(publica, 'Vende lo que no usas');
    await expect(publica.getByRole('link', { name: 'Vende lo que no usas' })).toHaveAttribute(
      'href',
      '/publicar',
    );
    await publica.close();
    await page.close();
  });

  test('un enlace no válido avisa junto al campo y bloquea el guardado', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await abrirEditor(page);

    await page.getByTestId('home-add-block').click();
    await page.getByTestId('home-block-type-cta').click();
    await page.getByTestId('cta-label').fill('Malo');
    await page.getByTestId('cta-href').fill('javascript:alert(1)');

    await expect(page.getByTestId('cta-href-error')).toBeVisible();
    await expect(page.getByTestId('guardar-portada')).toBeDisabled();
    await page.close();
  });

  test('mover y quitar bloques: el orden del editor es el de la portada', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await abrirEditor(page);

    const filas = page.getByTestId('home-blocks-list').locator('[data-testid^="home-block-row-"]');
    // Cuenta RELATIVA, nunca absoluta: la semilla crece con cada ráfaga (RP.4 le
    // añadió `steps` y `grid`) y un número fijo aquí caduca en silencio.
    const alEmpezar = await filas.count();

    // Se añade un botón, que entra AL FINAL.
    await page.getByTestId('home-add-block').click();
    await page.getByTestId('home-block-type-cta').click();
    await page.getByTestId('cta-label').fill('Botón de orden');
    await page.getByTestId('cta-href').fill('/publicar');
    await expect(filas).toHaveCount(alEmpezar + 1);

    // Y se sube hasta el principio, sea cual sea el tamaño de la semilla.
    const subir = page.getByRole('button', { name: 'Subir Botón destacado' });
    for (let i = 0; i < alEmpezar; i++) {
      await subir.click();
    }
    await expect(filas.first()).toHaveAttribute('data-testid', 'home-block-row-cta');

    await page.getByTestId('guardar-portada').click();
    await expect(page.getByTestId('portada-guardada')).toBeVisible();

    const publica = await adminContext.newPage();
    await esperarEnLaPortada(publica, 'Botón de orden');

    // El botón va ahora ANTES que "Cómo funciona", igual que en el editor.
    //
    // Se compara contra el bloque de PASOS y no contra el buscador a propósito:
    // hasta RP.6 la página reparte los bloques en dos sitios (el `search` va en
    // la banda del hero, el resto debajo — ver el andamio de (home)/page.tsx),
    // así que un `cta` nunca puede preceder al buscador por mucho que se suba en
    // el editor. Entre los bloques que se pintan JUNTOS, el orden del array sí
    // manda, y eso es lo que este test afirma.
    //
    // Se compara el ORDEN EN EL DOM, no coordenadas: `boundingBox()` devuelve
    // null si el elemento todavía no está pintado y —a diferencia de
    // `expect()`— no auto-espera, así que medir posiciones aquí es una carrera.
    const botonAntesDePasos = await publica.evaluate(() => {
      const cta = [...document.querySelectorAll('a')].find((a) =>
        a.textContent?.includes('Botón de orden'),
      );
      const pasos = [...document.querySelectorAll('h2')].find((h) =>
        h.textContent?.includes('Cómo funciona'),
      );
      if (!cta || !pasos) return null;
      // DOCUMENT_POSITION_FOLLOWING: los pasos vienen DESPUÉS del botón.
      return Boolean(cta.compareDocumentPosition(pasos) & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    expect(botonAntesDePasos, 'el botón debe preceder a "Cómo funciona" en el DOM').toBe(true);
    await publica.close();

    // Quitar el botón: como TIENE contenido, el primer clic pide confirmación.
    await page.getByRole('button', { name: 'Quitar Botón destacado' }).click();
    await expect(page.getByTestId('zona-bloques')).toContainText('¿Seguro?');
    await page.getByRole('button', { name: 'Quitar Botón destacado' }).click();
    await expect(filas).toHaveCount(alEmpezar);

    await page.getByTestId('guardar-portada').click();
    await expect(page.getByTestId('portada-guardada')).toBeVisible();
    await page.close();
  });
});

test.describe('Editor de portada — gate de rol', () => {
  test('la entrada aparece en el menú de un ADMIN', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin');
    await expect(page.getByTestId('admin-nav').getByRole('link', { name: 'Portada' })).toBeVisible();
    await page.close();
  });

  test('un MODERATOR no entra: la portada es configuración, no contenido', async ({
    moderatorContext,
  }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/portada');
    await expect(page).toHaveURL(/^http:\/\/localhost:3000\/$/);
    await page.close();
  });

  test('un EDITOR tampoco entra (sí edita el blog, pero no la portada)', async ({
    editorContext,
  }) => {
    const page = await editorContext.newPage();
    await page.goto('/admin/portada');
    await expect(page).toHaveURL(/^http:\/\/localhost:3000\/$/);
    await page.close();
  });
});
