// BLOG — footer semi-dinámico (Post.showInFooter/footerOrder) + columnas
// agrupadas por footerGroup (BLOG-FOOTER-COLUMNAS). El footer lista páginas
// informativas desde la BD (fuente única), cacheado (unstable_cache, nunca
// query por request) y revalidado por evento (revalidateTag) al
// publicar/despublicar/editar una página marcada. Verifica que el footer
// refleja la BD de punta a punta: aparece al marcar+publicar, respeta el
// orden (dentro y entre columnas), agrupa por footerGroup (o queda sin
// encabezado si no tiene grupo), y desaparece al despublicar/desmarcar.
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

    // Ambas páginas se crearon sin footerGroup → columna sin encabezado, pero
    // dentro de esa columna deben seguir apareciendo en orden de footerOrder.
    // Se busca en todo el <footer> (no solo <nav>) — los enlaces de páginas ya
    // no viven en el <nav> de navegación estática, sino en la grilla de columnas.
    const linkTexts = await publicPage.locator('footer').getByRole('link').allTextContents();
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

  test('una página con footerGroup se muestra bajo una columna con ese encabezado', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    const suffix = Date.now();
    const title = `Pagina Con Grupo ${suffix}`;
    const group = `GrupoColumna${suffix}`;

    await page.goto('/admin/paginas/nueva');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Título del post', { exact: true }).fill(title);
    await page.getByLabel('Mostrar en el footer').check();
    await page.getByLabel('Grupo/columna del footer').fill(group);
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 10_000 });
    await page.getByRole('button', { name: /publicar/i }).click();
    await page.waitForTimeout(1_000);

    const publicPage = await adminContext.newPage();
    await publicPage.goto('/');
    await publicPage.waitForLoadState('networkidle');

    await expect(publicPage.locator('footer h3', { hasText: group })).toBeVisible();
    // El enlace debe estar dentro de la misma columna que su encabezado.
    const column = publicPage.locator('footer > div > div').filter({ has: publicPage.locator('h3', { hasText: group }) });
    await expect(column.getByRole('link', { name: title })).toBeVisible();

    await publicPage.close();
  });

  test('una página sin footerGroup aparece en una columna SIN encabezado (no desaparece)', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    const title = `Pagina Sin Grupo Columna ${Date.now()}`;

    await page.goto('/admin/paginas/nueva');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Título del post', { exact: true }).fill(title);
    await page.getByLabel('Mostrar en el footer').check();
    // footerGroup deliberadamente vacío.
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 10_000 });
    await page.getByRole('button', { name: /publicar/i }).click();
    await page.waitForTimeout(1_000);

    const publicPage = await adminContext.newPage();
    await publicPage.goto('/');
    await publicPage.waitForLoadState('networkidle');

    const link = publicPage.getByRole('link', { name: title });
    await expect(link).toBeVisible();
    // La columna que contiene el enlace no tiene ningún <h3> (columna sin título).
    const column = link.locator('xpath=ancestor::div[1]');
    await expect(column.locator('h3')).toHaveCount(0);

    await publicPage.close();
  });

  test('columnas ordenadas por el footerOrder mínimo del grupo, no por orden de creación', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    const suffix = Date.now();
    const legalGroup = `Legal${suffix}`;
    const ayudaGroup = `Ayuda${suffix}`;

    async function createGroupedPage(title: string, group: string, order: string) {
      await page.goto('/admin/paginas/nueva');
      await page.waitForLoadState('networkidle');
      await page.getByPlaceholder('Título del post', { exact: true }).fill(title);
      await page.getByLabel('Mostrar en el footer').check();
      await page.getByLabel('Orden en el footer').fill(order);
      await page.getByLabel('Grupo/columna del footer').fill(group);
      await page.getByRole('button', { name: 'Guardar borrador' }).click();
      await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 10_000 });
      await page.getByRole('button', { name: /publicar/i }).click();
      await page.waitForTimeout(1_000);
    }

    // Se crea "Ayuda" (footerOrder alto) ANTES que "Legal" (footerOrder bajo)
    // para probar que el orden de columnas depende del campo, no de creación.
    await createGroupedPage(`Pagina Ayuda ${suffix}`, ayudaGroup, '50');
    await createGroupedPage(`Pagina Legal ${suffix}`, legalGroup, '5');

    const publicPage = await adminContext.newPage();
    await publicPage.goto('/');
    await publicPage.waitForLoadState('networkidle');

    const headings = await publicPage.locator('footer h3').allTextContents();
    expect(headings.indexOf(legalGroup)).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf(ayudaGroup)).toBeGreaterThanOrEqual(0);
    expect(headings.indexOf(legalGroup)).toBeLessThan(headings.indexOf(ayudaGroup));

    await publicPage.close();
  });

  test('el campo "Grupo/columna del footer" sugiere grupos existentes vía datalist', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    const suffix = Date.now();
    const group = `GrupoSugerido${suffix}`;

    // Crear una página con ese grupo (no hace falta publicarla — las
    // sugerencias no filtran por estado, ver BlogService.listFooterGroups()).
    await page.goto('/admin/paginas/nueva');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Título del post', { exact: true }).fill(`Pagina Origen Grupo ${suffix}`);
    await page.getByLabel('Mostrar en el footer').check();
    await page.getByLabel('Grupo/columna del footer').fill(group);
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 10_000 });

    // Nueva página → el datalist debe sugerir el grupo recién creado de
    // inmediato (endpoint fresco, sin caché — a diferencia del footer público).
    await page.goto('/admin/paginas/nueva');
    await page.waitForLoadState('networkidle');
    await page.getByLabel('Mostrar en el footer').check();
    await expect(page.locator(`#footer-group-suggestions option[value="${group}"]`)).toHaveCount(1);
  });
});
