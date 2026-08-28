// BORRADO — RÁFAGA B2: el borrado de staff, en el navegador.
//
// LA POLÍTICA, vista desde la interfaz: el dueño ARCHIVA y nunca elimina; el
// staff ELIMINA, y sólo lo que ya está archivado. Los dos pasos son la
// salvaguarda — para destruir un anuncio vivo hay que archivarlo primero.
//
// QUÉ CUBRE ESTE FICHERO Y QUÉ NO. Aquí se comprueba lo que sólo se ve en el
// navegador: que el botón aparece donde debe y no donde no, y que lo irreversible
// pide confirmación antes de tocar nada. Quién puede llamar al endpoint y desde
// qué estado lo fija `apps/api/test/borrado-politica.e2e-spec.ts`, y qué se lleva
// por delante el borrado, `borrado-inventario.e2e-spec.ts` — las tres capas por
// separado, cada una en su sitio.
//
// Fixture: `listing-archivado-e2e`, sembrado ARCHIVED en cada run por
// seed-playwright.ts. Es suyo y de nadie más, precisamente porque este test lo
// destruye.

import { test, expect } from './fixtures/auth';

const ARCHIVADO = 'Anuncio Archivado E2E';

/**
 * Filtra la lista del backoffice por estado y devuelve la fila del anuncio.
 *
 * FICHA F2 — cambia CÓMO se filtra, no qué garantiza este spec. La tira de
 * botones de estado único («Archivados») la sustituyen los chips múltiples de
 * `FiltrosAnuncios`, así que aquí se pulsa el chip por su `data-testid` en vez
 * de por su texto. Todas las aserciones de B2 siguen siendo las mismas.
 *
 * Y se espera a la RESPUESTA, no a `networkidle`: los filtros navegan y la lista
 * se recarga con un `fetch` del cliente, que `networkidle` puede no cubrir — el
 * mismo defecto que se encontró mutando el spec de F2.
 */
async function filaArchivada(page: import('@playwright/test').Page) {
  const esListado = (url: string) =>
    url.includes('/admin/listings') && !/\/admin\/listings\//.test(url);

  // (1) LA CARGA INICIAL, ESPERADA APARTE. El clic anterior salía inmediatamente
  // después del `goto`, cuando la tabla todavía no había hidratado: se perdía EN
  // SILENCIO y el filtro no llegaba a aplicarse nunca. Que la lista haya
  // respondido es la prueba de que el componente cliente está vivo — es él quien
  // hace ese `fetch`—, así que a partir de aquí el chip responde.
  await Promise.all([
    page.waitForResponse((r) => esListado(r.url()), { timeout: 20_000 }),
    page.goto('/admin/anuncios', { waitUntil: 'domcontentloaded' }),
  ]);

  // (2) Y SE ESPERA A **LA RESPUESTA FILTRADA**, no a una cualquiera. El predicado
  // anterior casaba también con la petición inicial SIN filtrar, así que el test
  // seguía con la lista completa y no se enteraba.
  //
  // Eso no era sólo un adorno: la lista sin filtrar pagina de 20 en 20, y en
  // cuanto la batería acumula más de veinte anuncios el fixture archivado se cae
  // de la primera página. El test fallaba entonces con «no encuentro la fila» —
  // señalando al dato, cuando el problema era que el filtro nunca se aplicó.
  // Y al revés es peor: con pocos anuncios PASABA sin haber filtrado nada.
  await Promise.all([
    page.waitForResponse(
      (r) => esListado(r.url()) && r.url().includes('statuses=ARCHIVED'),
      { timeout: 20_000 },
    ),
    page.getByTestId('filtro-estado-ARCHIVED').click(),
  ]);

  return page.locator('tr', { hasText: ARCHIVADO });
}

test.describe('Borrado B2 — el staff elimina desde /admin/anuncios', () => {
  test('el filtro «Archivados» existe y la fila se lee (antes pintaba el enum crudo)', async ({
    adminContext,
  }) => {
    // Hasta B2 no había filtro de archivados —sólo salían en «Todos»— y encima
    // sin etiqueta: la insignia mostraba literalmente ARCHIVED.
    const page = await adminContext.newPage();
    const fila = await filaArchivada(page);

    await expect(fila).toBeVisible({ timeout: 15_000 });
    await expect(fila).toContainText('Archivado');
    await expect(fila).not.toContainText('ARCHIVED');
    await page.close();
  });

  test('un MODERATOR NO ve el botón de eliminar (es la única acción irreversible)', async ({
    moderatorContext,
  }) => {
    // El backend responde 403 igualmente; esto es que la UI no le prometa un
    // botón que iba a fallarle.
    const page = await moderatorContext.newPage();
    const fila = await filaArchivada(page);

    await expect(fila).toBeVisible({ timeout: 15_000 });
    await expect(fila.getByRole('button', { name: 'Eliminar' })).toHaveCount(0);
    // Pero sí puede archivar: su parte del trabajo no cambia.
    await expect(fila.getByRole('button', { name: 'Cambiar estado' })).toBeVisible();
    await page.close();
  });

  test('un ADMIN no ve «Eliminar» en un anuncio que NO está archivado', async ({
    adminContext,
  }) => {
    // La otra mitad de la regla: el botón no está por rol, está por rol Y estado.
    const page = await adminContext.newPage();
    await page.goto('/admin/anuncios', { waitUntil: 'domcontentloaded' });
    // FICHA F2 — el chip de estado, igual que en `filaArchivada`.
    await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/admin/listings') && !/\/admin\/listings\//.test(r.url()),
        { timeout: 20_000 },
      ),
      page.getByTestId('filtro-estado-ACTIVE').click(),
    ]);

    const filaActiva = page.locator('tbody tr').first();
    await expect(filaActiva).toBeVisible({ timeout: 15_000 });
    await expect(filaActiva.getByRole('button', { name: 'Eliminar' })).toHaveCount(0);
    await page.close();
  });

  test('eliminar pide confirmación, y cancelar NO borra', async ({ adminContext }) => {
    const page = await adminContext.newPage();

    let llamado = false;
    await page.route('**/admin/listings/*', async (route) => {
      if (route.request().method() === 'DELETE') {
        llamado = true;
        await route.fulfill({ status: 204, body: '' });
        return;
      }
      await route.fallback();
    });

    const fila = await filaArchivada(page);
    await expect(fila).toBeVisible({ timeout: 15_000 });
    await fila.getByRole('button', { name: 'Eliminar' }).click();

    const dialogo = page.getByRole('alertdialog');
    await expect(dialogo).toBeVisible({ timeout: 10_000 });
    // El diálogo dice QUÉ sobrevive: es la única oportunidad de que quien pulsa
    // sepa lo que está destruyendo y lo que no.
    await expect(dialogo).toContainText(/no se puede deshacer/i);
    await expect(dialogo).toContainText(/denuncias/i);
    await expect(dialogo).toContainText(/conversaciones/i);
    expect(llamado).toBe(false);

    await dialogo.getByRole('button', { name: 'Cancelar' }).click();
    await expect(dialogo).not.toBeVisible();
    expect(llamado).toBe(false);
    await page.close();
  });

  // VA EL ÚLTIMO del fichero a propósito: destruye el fixture. El `upsert` del
  // seed lo repone en el siguiente run, pero dentro de ESTA corrida ya no está.
  test('confirmar elimina de verdad, y el anuncio desaparece de la lista', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    const fila = await filaArchivada(page);
    await expect(fila).toBeVisible({ timeout: 15_000 });

    await fila.getByRole('button', { name: 'Eliminar' }).click();
    const dialogo = page.getByRole('alertdialog');
    await expect(dialogo).toBeVisible({ timeout: 10_000 });
    await dialogo.getByRole('button', { name: 'Eliminar' }).click();

    // La lista se recarga sola tras borrar.
    await expect(page.locator('tr', { hasText: ARCHIVADO })).toHaveCount(0, { timeout: 15_000 });
    await page.close();
  });
});
