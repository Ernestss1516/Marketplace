// BLOG — footer semi-dinámico (Post.showInFooter/footerOrder). El footer lista
// páginas informativas desde la BD (fuente única), cacheado (unstable_cache,
// nunca query por request) y revalidado por evento (revalidateTag) al
// publicar/despublicar/editar una página marcada. Verifica que el footer
// refleja la BD de punta a punta: aparece al marcar+publicar, respeta el orden,
// y desaparece al despublicar/desmarcar.
//
// Prerequisites: global-setup seeds admin-e2e@example.com (ADMIN).

import { test, expect } from './fixtures/auth';

test.describe('Footer semi-dinámico — páginas informativas', () => {
  test('marcar una página + publicar → aparece en el footer; despublicar → desaparece', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/paginas/nueva');
    await page.waitForLoadState('networkidle');

    const title = `Pagina Footer ${Date.now()}`;
    await page.getByPlaceholder('Título del post', { exact: true }).fill(title);
    await page.getByLabel('Mostrar en el footer').check();

    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 10_000 });

    await page.getByRole('button', { name: /publicar/i }).click();
    // Deja tiempo al fire-and-forget revalidateTag('footer-pages') para completar
    // antes de comprobar el footer — la vía principal es el evento, no el TTL.
    await page.waitForTimeout(1_500);

    const publicPage = await adminContext.newPage();
    await publicPage.goto('/');
    await publicPage.waitForLoadState('networkidle');
    await expect(publicPage.getByRole('link', { name: title })).toBeVisible();

    // --- Despublicar → el enlace desaparece del footer ---
    await page.getByRole('button', { name: /despublicar/i }).click();
    await page.waitForTimeout(1_500);

    await publicPage.goto('/');
    await publicPage.waitForLoadState('networkidle');
    await expect(publicPage.getByRole('link', { name: title })).toHaveCount(0);

    await publicPage.close();
  });

  test('dos páginas en el footer con footerOrder distinto salen en el orden correcto', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    const suffix = Date.now();
    const titleFirst = `Footer Orden A ${suffix}`;
    const titleSecond = `Footer Orden B ${suffix}`;

    async function createFooterPage(title: string, order: string) {
      await page.goto('/admin/paginas/nueva');
      await page.waitForLoadState('networkidle');
      await page.getByPlaceholder('Título del post', { exact: true }).fill(title);
      await page.getByLabel('Mostrar en el footer').check();
      await page.getByLabel('Orden en el footer').fill(order);
      await page.getByRole('button', { name: 'Guardar borrador' }).click();
      await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 10_000 });
      await page.getByRole('button', { name: /publicar/i }).click();
      await page.waitForTimeout(1_000);
    }

    // Crear el de orden MAYOR primero, para probar que el resultado depende del
    // campo footerOrder y no del orden de creación/publicación.
    await createFooterPage(titleSecond, '20');
    await createFooterPage(titleFirst, '10');

    const publicPage = await adminContext.newPage();
    await publicPage.goto('/');
    await publicPage.waitForLoadState('networkidle');

    const footerNav = publicPage.locator('footer nav');
    const linkTexts = await footerNav.getByRole('link').allTextContents();
    const indexFirst = linkTexts.indexOf(titleFirst);
    const indexSecond = linkTexts.indexOf(titleSecond);
    expect(indexFirst).toBeGreaterThanOrEqual(0);
    expect(indexSecond).toBeGreaterThanOrEqual(0);
    expect(indexFirst).toBeLessThan(indexSecond);

    await publicPage.close();
  });

  test('desmarcar "Mostrar en el footer" en una página publicada la quita del footer sin despublicarla', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/paginas/nueva');
    await page.waitForLoadState('networkidle');

    const title = `Pagina Footer Toggle ${Date.now()}`;
    await page.getByPlaceholder('Título del post', { exact: true }).fill(title);
    await page.getByLabel('Mostrar en el footer').check();
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 10_000 });
    await page.getByRole('button', { name: /publicar/i }).click();
    await page.waitForTimeout(1_000);

    const publicPage = await adminContext.newPage();
    await publicPage.goto('/');
    await publicPage.waitForLoadState('networkidle');
    await expect(publicPage.getByRole('link', { name: title })).toBeVisible();

    // Desmarcar el checkbox y guardar — la página sigue PUBLISHED, solo deja de
    // listarse en el footer.
    await page.getByLabel('Mostrar en el footer').uncheck();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await page.waitForTimeout(1_500);

    await publicPage.goto('/');
    await publicPage.waitForLoadState('networkidle');
    await expect(publicPage.getByRole('link', { name: title })).toHaveCount(0);

    // La página sigue accesible directamente — solo el enlace del footer se fue.
    await expect(page.getByRole('link', { name: /ver página/i })).toBeVisible();

    await publicPage.close();
  });
});
