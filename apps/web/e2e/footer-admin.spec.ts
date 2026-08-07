// FOOTER NAV — /admin/footer (columnas + ítems, molde admin/categorias) +
// consumo en el footer público. Sustituye a footer-paginas.spec.ts: el footer
// ya no se deriva de Post.showInFooter/footerOrder/footerGroup, vive en su
// propia estructura (FooterColumn/FooterItem) gestionada desde esta pantalla.
//
// Prerequisites: global-setup seeds admin-e2e@example.com (ADMIN).

import { test, expect } from './fixtures/auth';
import type { Page } from '@playwright/test';
import { clicarYEsperarUrl } from './helpers/nav';

/**
 * Espera a que el footer PÚBLICO refleje un cambio hecho en el backoffice.
 *
 * La revalidación es *fire-and-forget*: el backend responde 200 a la mutación y
 * DESPUÉS dispara el POST a `/api/revalidate` sin esperarlo. Hay por tanto una
 * ventana de consistencia eventual —corta, pero real— entre "el admin guardó" y
 * "el footer público ya lo muestra". Leer el footer al instante es muestrear un
 * sistema en movimiento; es exactamente lo que hacía `waitForCard` antes de la
 * ráfaga 2a, y da el mismo tipo de rojo.
 *
 * El cableado de la revalidación está BIEN (las 8 mutaciones de FooterService
 * llaman a `revalidateTag('footer-nav')`, con tests unitarios que lo afirman):
 * aquí no se toca producto, solo se espera al ESTADO en vez de al instante.
 *
 * Recarga en cada intento a propósito: el footer se sirve por SSR con caché por
 * tag, así que sin una carga nueva no hay contenido nuevo que ver por mucho que
 * se reintente el `expect`.
 */
async function esperarFooterPublico(
  publicPage: Page,
  cumple: (headings: string[]) => boolean,
  queSeEspera: string,
): Promise<void> {
  await expect(async () => {
    await publicPage.goto('/');
    const headings = await publicPage.locator('footer h3').allTextContents();
    if (!cumple(headings)) {
      throw new Error(`${queSeEspera} — encabezados ahora: ${JSON.stringify(headings)}`);
    }
  }).toPass({ timeout: 20_000 });
}

test.describe('Admin — /admin/footer', () => {
  test('crear columna, renombrarla, y crear un ítem tipo página → aparece en el footer público', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    const suffix = Date.now();

    // 1. Crear una página informativa para poder enlazarla desde el footer.
    const pageTitle = `Pagina Footer Admin ${suffix}`;
    await page.goto('/admin/paginas/nueva');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Título del post', { exact: true }).fill(pageTitle);
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 10_000 });
    await page.getByRole('button', { name: /publicar/i }).click();
    await page.waitForTimeout(500);

    // 2. Crear una columna en /admin/footer.
    const columnName = `Legal ${suffix}`;
    await page.goto('/admin/footer');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Nueva columna' }).click();
    await page.getByPlaceholder('p.ej. Legal').fill(columnName);
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByText(columnName, { exact: true })).toBeVisible();

    // 3. Añadir un ítem tipo "Página del CMS" apuntando a la página creada.
    const columnBlock = page.locator('div.rounded-md.border').filter({ hasText: columnName }).first();
    await columnBlock.getByRole('button', { name: 'Nuevo ítem' }).click();
    // selectOption no admite RegExp en `label` (solo string exacto) — la opción
    // lleva un sufijo condicional "(borrador)" que no controlamos aquí, así que
    // resolvemos el value real localizando la <option> por texto y seleccionando
    // por value en vez de por label.
    const pageOptionValue = await page
      .getByTestId('item-page-select')
      .locator('option', { hasText: pageTitle })
      .getAttribute('value');
    await page.getByTestId('item-page-select').selectOption(pageOptionValue!);
    // El label se prerrellena con el título de la página — no hace falta escribirlo.
    await expect(page.getByTestId('item-label-input')).toHaveValue(pageTitle);
    await page.getByTestId('item-submit-btn').click();
    await expect(page.getByText(`Página: ${pageTitle}`)).toBeVisible();

    // 4. Verificar que aparece en el footer público.
    const publicPage = await adminContext.newPage();
    await publicPage.goto('/');
    await publicPage.waitForLoadState('networkidle');
    await expect(publicPage.locator('footer h3', { hasText: columnName })).toBeVisible();
    await expect(publicPage.locator('footer').getByRole('link', { name: pageTitle })).toBeVisible();

    await publicPage.close();
  });

  test('ítem tipo ruta interna y tipo URL externa se resuelven correctamente en el footer público', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    const suffix = Date.now();
    const columnName = `Ayuda ${suffix}`;
    const internalLabel = `Buscar Interno ${suffix}`;
    const externalLabel = `Blog Externo ${suffix}`;

    await page.goto('/admin/footer');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Nueva columna' }).click();
    await page.getByPlaceholder('p.ej. Legal').fill(columnName);
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByText(columnName, { exact: true })).toBeVisible();

    const columnBlock = page.locator('div.rounded-md.border').filter({ hasText: columnName }).first();

    // Ítem INTERNAL
    await columnBlock.getByRole('button', { name: 'Nuevo ítem' }).click();
    await page.getByTestId('item-label-input').fill(internalLabel);
    await page.getByTestId('item-type-select').selectOption('INTERNAL');
    await page.getByTestId('item-internal-url-input').fill('/busqueda');
    await page.getByTestId('item-submit-btn').click();
    await expect(page.getByText('Ruta: /busqueda')).toBeVisible();

    // Ítem EXTERNAL
    await columnBlock.getByRole('button', { name: 'Nuevo ítem' }).click();
    await page.getByTestId('item-label-input').fill(externalLabel);
    await page.getByTestId('item-type-select').selectOption('EXTERNAL');
    await page.getByTestId('item-external-url-input').fill('https://example.com/blog-externo');
    await page.getByTestId('item-submit-btn').click();
    await expect(page.getByText('Externa: https://example.com/blog-externo')).toBeVisible();

    const publicPage = await adminContext.newPage();
    await publicPage.goto('/');
    await publicPage.waitForLoadState('networkidle');

    const internalLink = publicPage.locator('footer').getByRole('link', { name: internalLabel });
    await expect(internalLink).toHaveAttribute('href', '/busqueda');
    await expect(internalLink).not.toHaveAttribute('target', '_blank');

    const externalLink = publicPage.locator('footer').getByRole('link', { name: externalLabel });
    await expect(externalLink).toHaveAttribute('href', 'https://example.com/blog-externo');
    await expect(externalLink).toHaveAttribute('target', '_blank');
    await expect(externalLink).toHaveAttribute('rel', 'noopener noreferrer');

    await publicPage.close();
  });

  test('despublicar la página enlazada → el ítem desaparece del footer público sin borrarse', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    const suffix = Date.now();
    const pageTitle = `Pagina Draft Footer ${suffix}`;
    const columnName = `ColDraft ${suffix}`;

    await page.goto('/admin/paginas/nueva');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Título del post', { exact: true }).fill(pageTitle);
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 10_000 });
    await page.getByRole('button', { name: /publicar/i }).click();
    await page.waitForTimeout(500);

    await page.goto('/admin/footer');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Nueva columna' }).click();
    await page.getByPlaceholder('p.ej. Legal').fill(columnName);
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByText(columnName, { exact: true })).toBeVisible();

    const columnBlock = page.locator('div.rounded-md.border').filter({ hasText: columnName }).first();
    await columnBlock.getByRole('button', { name: 'Nuevo ítem' }).click();
    // selectOption no admite RegExp en `label` (solo string exacto) — la opción
    // lleva un sufijo condicional "(borrador)" que no controlamos aquí, así que
    // resolvemos el value real localizando la <option> por texto y seleccionando
    // por value en vez de por label.
    const pageOptionValue = await page
      .getByTestId('item-page-select')
      .locator('option', { hasText: pageTitle })
      .getAttribute('value');
    await page.getByTestId('item-page-select').selectOption(pageOptionValue!);
    await page.getByTestId('item-submit-btn').click();
    await expect(page.getByText(`Página: ${pageTitle}`)).toBeVisible();

    const publicPage = await adminContext.newPage();
    await publicPage.goto('/');
    await publicPage.waitForLoadState('networkidle');
    await expect(publicPage.locator('footer').getByRole('link', { name: pageTitle })).toBeVisible();

    // Despublicar la página — el ítem del footer sigue existiendo pero se omite del público.
    await page.goto('/admin/paginas');
    await page.waitForLoadState('networkidle');
    // Clic sobre un <Link> del listado → navegación de cliente: por el helper,
    // que repite el clic si el router se queda wedged (e2e/helpers/nav.ts).
    await clicarYEsperarUrl(
      page,
      page.getByRole('link', { name: pageTitle }),
      (url) => /\/admin\/paginas\/.+\/editar/.test(url.pathname),
    );
    await page.getByRole('button', { name: /despublicar/i }).click();
    await page.waitForTimeout(500);

    await publicPage.goto('/');
    await publicPage.waitForLoadState('networkidle');
    await expect(publicPage.locator('footer').getByRole('link', { name: pageTitle })).toHaveCount(0);

    // El admin lo sigue viendo, con el badge de "en borrador".
    await page.goto('/admin/footer');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('en borrador — no se muestra')).toBeVisible();

    await publicPage.close();
  });

  test('reordenar columnas con las flechas ↑↓ cambia el orden en el footer público', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    const suffix = Date.now();
    const colA = `ColA ${suffix}`;
    const colB = `ColB ${suffix}`;

    await page.goto('/admin/footer');
    await page.waitForLoadState('networkidle');

    // La columna se crea CON un ítem a propósito. `listPublicNav` termina con
    // `.filter((column) => column.items.length > 0)`: una columna VACÍA no sale
    // en el footer público, y es deliberado —lo dice el comentario de
    // `adminListStructure`: "a diferencia de listPublicNav, incluye
    // columnas/ítems vacíos"—. Una columna sin enlaces no pinta nada.
    //
    // Este test creaba las dos columnas vacías y luego esperaba verlas en el
    // footer público, así que fallaba por su PREMISA, no por lo que afirma. Se
    // veía en el propio fallo: el footer mostraba las columnas de otros tests
    // (que sí añaden ítems) y nunca estas dos. Lo que el test prueba —que
    // reordenar en el admin cambia el orden público— no cambia.
    async function createColumn(name: string) {
      await page.getByRole('button', { name: 'Nueva columna' }).click();
      await page.getByPlaceholder('p.ej. Legal').fill(name);
      await page.getByRole('button', { name: 'Crear' }).click();
      await expect(page.getByText(name, { exact: true })).toBeVisible();

      // Un ítem cualquiera (ruta interna, sin depender del CMS) para que la
      // columna sea visible públicamente.
      const bloque = page.locator('div.rounded-md.border').filter({ hasText: name }).first();
      await bloque.getByRole('button', { name: 'Nuevo ítem' }).click();
      await page.getByTestId('item-label-input').fill(`Enlace ${name}`);
      await page.getByTestId('item-type-select').selectOption('INTERNAL');
      await page.getByTestId('item-internal-url-input').fill('/busqueda');
      await page.getByTestId('item-submit-btn').click();
      await expect(page.getByText(`Ruta: /busqueda`).first()).toBeVisible();
    }

    await createColumn(colA);
    await createColumn(colB);

    // colA fue creada primero → aparece antes que colB por defecto.
    const publicPage = await adminContext.newPage();
    await esperarFooterPublico(
      publicPage,
      (h) => h.includes(colA) && h.includes(colB) && h.indexOf(colA) < h.indexOf(colB),
      `se esperaba "${colA}" ANTES que "${colB}" (orden de creación)`,
    );

    // Subir colB por encima de colA.
    const colBBlock = page.locator('div.rounded-md.border').filter({ hasText: colB }).first();
    await colBBlock.getByTitle('Subir').first().click();

    // Lo que este test prueba —que reordenar en admin cambia el orden público—
    // no cambia: solo se espera a que la revalidación llegue en vez de leer el
    // footer 500 ms después y confiar.
    await esperarFooterPublico(
      publicPage,
      (h) => h.includes(colA) && h.includes(colB) && h.indexOf(colB) < h.indexOf(colA),
      `tras subir "${colB}", se esperaba que fuera ANTES que "${colA}"`,
    );

    await publicPage.close();
  });

  test('eliminar una columna borra también sus ítems (cascade) — confirmación previa', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    const suffix = Date.now();
    const columnName = `ColBorrar ${suffix}`;
    const itemLabel = `ItemBorrar ${suffix}`;

    await page.goto('/admin/footer');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Nueva columna' }).click();
    await page.getByPlaceholder('p.ej. Legal').fill(columnName);
    await page.getByRole('button', { name: 'Crear' }).click();
    await expect(page.getByText(columnName, { exact: true })).toBeVisible();

    const columnBlock = page.locator('div.rounded-md.border').filter({ hasText: columnName }).first();
    await columnBlock.getByRole('button', { name: 'Nuevo ítem' }).click();
    await page.getByTestId('item-label-input').fill(itemLabel);
    await page.getByTestId('item-type-select').selectOption('INTERNAL');
    await page.getByTestId('item-internal-url-input').fill('/publicar');
    await page.getByTestId('item-submit-btn').click();
    await expect(page.getByText(itemLabel)).toBeVisible();

    page.on('dialog', (dialog) => dialog.accept());
    const deleteColumnBtn = columnBlock.locator('button.text-destructive').first();
    await deleteColumnBtn.click();
    await page.waitForTimeout(500);

    await expect(page.getByText(columnName, { exact: true })).not.toBeVisible();
  });
});
