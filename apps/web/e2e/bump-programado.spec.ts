import { test, expect } from './fixtures/auth';
import { abrirPromocionar } from './helpers/promocion';

/**
 * Bump automático (ráfaga 4) — configurar, ver y gestionar, en pantalla.
 *
 * LA PRUEBA QUE MÁS IMPORTA es D8: que el usuario DE PAGO llegue a programar. El menú `▾` de
 * la tarjeta solo se pinta cuando el bump sale gratis, así que si la configuración viviera
 * solo ahí quedaría fuera justo quien más querría programar. `sellerContext` es un vendedor
 * sin cuota Pro y sin saldo de bumps: su camino es el botón único «Promocionar», y por ahí
 * tiene que poder llegar.
 */

/** Abre el diálogo y elige el producto «programar». */
async function abrirProgramar(page: import('@playwright/test').Page) {
  await abrirPromocionar(page);
  const dialogo = page.getByRole('dialog');
  await dialogo.getByLabel(/Programar bumps|Editar bumps programados/).first().click();
  await expect(page.getByTestId('programar-intervalo')).toBeVisible({ timeout: 15_000 });
}

test.describe('Bump automático — configurar desde «Promocionar» (D8)', () => {
  test('el usuario DE PAGO llega a programar por el botón único, sin pasar por el ▾', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');
    await expect(page.getByTestId('btn-promocionar').first()).toBeVisible({ timeout: 20_000 });

    // Sin bump gratis no hay botón partido: el ▾ no existe. Ese era el hallazgo de la
    // auditoría, y por eso la configuración NO puede vivir solo ahí.
    expect(await page.getByTestId('btn-promocionar-mas').first().count()).toBe(0);

    await abrirProgramar(page);

    // Y el diálogo advierte de que el precio se lee al aplicarse (D10): no se congela,
    // porque congelarlo crearía una segunda verdad del precio.
    await expect(page.getByRole('dialog')).toContainText(/el precio puede variar/i);
    await expect(page.getByRole('dialog')).toContainText(/hora peninsular/i);
  });

  test('programa una subida y lo confirma con un toast', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');
    await expect(page.getByTestId('btn-promocionar').first()).toBeVisible({ timeout: 20_000 });

    await abrirProgramar(page);
    await page.getByTestId('programar-intervalo').selectOption('7');
    await page.getByTestId('programar-hora').selectOption('20');
    await page.getByTestId('promo-confirmar-programar').click();

    // UXV.3 — canal único de feedback: el éxito de una acción puntual se cuenta con toast.
    await expect(page.getByText(/bumps programados cada 7 días/i)).toBeVisible({ timeout: 15_000 });

    // Y el estado aparece en la tarjeta, que es donde el usuario mira.
    await expect(page.getByTestId('estado-bump-programado').first()).toContainText(
      /próximo bump/i,
      { timeout: 15_000 },
    );
  });

  test('en móvil (375px) el diálogo se usa igual', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.setViewportSize({ width: 375, height: 780 });
    await page.goto('/mis-anuncios');
    await expect(page.getByTestId('btn-promocionar').first()).toBeVisible({ timeout: 20_000 });

    await abrirProgramar(page);

    // Los dos selectores caben y son operables sin scroll horizontal.
    await page.getByTestId('programar-intervalo').selectOption('2');
    await page.getByTestId('programar-hora').selectOption('8');
    await expect(page.getByTestId('promo-confirmar-programar')).toBeVisible();

    const scrollX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(scrollX).toBeLessThanOrEqual(1);
  });
});

test.describe('Bump automático — gestionar en /mis-creditos', () => {
  test('la programación se ve, se pausa y se reanuda a mano (D2)', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();

    // Se crea desde el anuncio, que es donde se crea de verdad.
    await page.goto('/mis-anuncios');
    await expect(page.getByTestId('btn-promocionar').first()).toBeVisible({ timeout: 20_000 });
    await abrirProgramar(page);
    await page.getByTestId('programar-intervalo').selectOption('3');
    await page.getByTestId('promo-confirmar-programar').click();
    await expect(page.getByText(/bumps programados cada 3 días/i)).toBeVisible({ timeout: 15_000 });

    // Y se gestiona donde el usuario pregunta por su dinero.
    await page.goto('/mis-creditos');
    const lista = page.getByTestId('bumps-programados');
    await expect(lista).toBeVisible({ timeout: 20_000 });
    await expect(lista.getByTestId('estado-programacion').first()).toContainText(/próximo bump/i);

    await lista.getByRole('button', { name: /pausar/i }).first().click();
    await expect(page.getByText(/bumps programados en pausa/i).first()).toBeVisible({ timeout: 15_000 });

    // D2 — reanudar es un ACTO del usuario, no un efecto de haber recargado saldo.
    await expect(lista.getByRole('button', { name: /reanudar/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await lista.getByRole('button', { name: /reanudar/i }).first().click();
    await expect(page.getByText(/bumps programados reanudados/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });

  test('el historial de subidas se abre desde la propia programación', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-creditos');
    await expect(page.getByTestId('bumps-programados')).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('ver-turnos').first().click();

    // D6 no notifica cada bump aplicado para no inundar la campana; la trazabilidad vive
    // aquí, así que tiene que estar a un clic.
    await expect(page.getByTestId('turnos').first()).toBeVisible({ timeout: 15_000 });
  });

  test('cancelar pide confirmación: es irreversible y se lleva el historial', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-creditos');
    const lista = page.getByTestId('bumps-programados');
    await expect(lista).toBeVisible({ timeout: 20_000 });

    await lista.getByRole('button', { name: /cancelar/i }).first().click();

    // Mismo molde que archivar un anuncio o emitir una factura.
    await expect(page.getByRole('alertdialog')).toContainText(/dejará de subirse solo/i);
    await page.getByRole('button', { name: /^volver$/i }).click();
    await expect(lista).toBeVisible();
  });
});

test.describe('Bump automático — requisito de oro: UXV.4 intacto', () => {
  test('«Promocionar» sigue ofreciendo subir y destacar como antes', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');
    await expect(page.getByTestId('btn-promocionar').first()).toBeVisible({ timeout: 20_000 });

    await abrirPromocionar(page);
    const dialogo = page.getByRole('dialog');

    // Los dos productos de UXV.4 siguen ahí; «programar» se suma, no sustituye.
    await expect(dialogo.getByLabel(/Subir al inicio/).first()).toBeVisible();
    await expect(dialogo.getByLabel(/^Destacar/).first()).toBeVisible();
    await expect(dialogo.getByLabel(/Programar bumps|Editar bumps programados/).first()).toBeVisible();
  });
});
