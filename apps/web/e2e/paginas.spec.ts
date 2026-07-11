// BLOG — páginas informativas (Post.type = PAGE). Verifica que /admin/paginas
// reutiliza el flujo de publicación del blog, que la página se sirve en
// /paginas/[slug] con presentación de página (sin fecha/autor/tags/prev-next), que
// NO aparece en el feed del blog, y que un <script> literal nunca se ejecuta.
// La navegación del footer (FooterColumn/FooterItem, independiente de Post)
// tiene su propia batería en footer-admin.spec.ts — este archivo ya no prueba
// enlaces de footer hardcodeados ni el footer semi-dinámico basado en
// Post.showInFooter (retirado en el mini-hito de navegación del footer).
//
// NOTA — Sistema de bloques (Ráfaga 1): el editor de MarkdownEditor en
// PostForm quedó desconectado (Post.body ya no existe, sustituido por
// Post.blocks) — el editor de bloques llega en la Ráfaga 2. Los tests de
// contenido (renderizado, XSS) de este archivo ahora crean el Post vía API
// directa (loginViaApi/authedPost) en vez de rellenar el editor en la UI —
// ver blocks.render.e2e-spec.ts (backend) y blocks.render.spec.ts (frontend)
// para la cobertura completa del renderizado de los 9 tipos de bloque.
//
// Prerequisites: global-setup seeds admin-e2e@example.com (ADMIN) y
// editor-e2e@example.com (EDITOR).

import { test, expect } from './fixtures/auth';
import { loginViaApi, authedPost } from './helpers/api';

test.describe('Páginas informativas — /admin/paginas y /paginas/[slug]', () => {
  test('ADMIN crea y publica una página; se sirve en /paginas/[slug] con presentación de página y no aparece en el feed del blog', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/paginas/nueva');
    await page.waitForLoadState('networkidle');

    const title = `Pagina informativa ${Date.now()}`;
    await page.getByPlaceholder('Título del post', { exact: true }).fill(title);

    // Sin campo de tags — no aplica a páginas.
    await expect(page.getByPlaceholder('consejos, segunda-mano, electrónica')).toHaveCount(0);

    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 10_000 });

    await page.getByRole('button', { name: /publicar/i }).click();
    await page.waitForTimeout(1_000);

    // "Ver página ↗" en vez de "Ver en blog ↗".
    await expect(page.getByRole('link', { name: /ver página/i })).toBeVisible();

    // --- Verificar en público ---
    const publicPage = await adminContext.newPage();

    // Navegar a la página pública siguiendo el enlace "Ver página ↗" para no
    // tener que resolver el slug nosotros mismos.
    const [popup] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('link', { name: /ver página/i }).click(),
    ]);
    await popup.waitForLoadState('domcontentloaded');
    expect(popup.url()).toContain('/paginas/');

    await expect(popup.locator('h1', { hasText: title })).toBeVisible();

    // Presentación de página, no de artículo: sin fecha/autor/tags/prev-next.
    const bodyText = await popup.locator('body').innerText();
    expect(bodyText).not.toMatch(/Volver al blog/i);
    await expect(popup.locator('time')).toHaveCount(0);

    // --- No aparece en el feed del blog ---
    await publicPage.goto('/blog');
    await publicPage.waitForLoadState('networkidle');
    await expect(publicPage.getByText(title)).toHaveCount(0);

    await popup.close();
    await publicPage.close();
  });

  test('un <script> literal en un bloque de texto nunca se ejecuta (regla invariante de seguridad)', async ({
    adminContext,
    request,
  }) => {
    const adminToken = await loginViaApi(request, 'admin-e2e@example.com', 'Test1234!');
    const title = `Pagina XSS check ${Date.now()}`;

    const created = await authedPost(request, '/admin/blog', adminToken, {
      type: 'PAGE',
      title,
      blocks: [
        { id: 'b1', type: 'text', markdown: '<script>window.__xss_executed = true;</script>\n\nContenido normal.' },
      ],
    });
    expect(created.ok()).toBe(true);
    const { id, slug } = (await created.json()) as { id: string; slug: string };

    const published = await authedPost(request, `/admin/blog/${id}/publish`, adminToken, {});
    expect(published.ok()).toBe(true);

    const popup = await adminContext.newPage();
    await popup.goto(`/paginas/${slug}`);
    await popup.waitForLoadState('domcontentloaded');

    const executed = await popup.evaluate(
      () => (window as unknown as { __xss_executed?: boolean }).__xss_executed === true,
    );
    expect(executed).toBe(false);
    // El texto del script se escapa como texto plano, no desaparece en silencio.
    await expect(popup.getByText('Contenido normal.')).toBeVisible();

    await popup.close();
  });

  test('EDITOR ve "Páginas" en el nav, puede crear una página, y no ve el botón "Eliminar" en /admin/paginas', async ({
    editorContext,
  }) => {
    const page = await editorContext.newPage();
    await page.goto('/admin/paginas');
    await page.waitForLoadState('networkidle');

    const nav = page.getByTestId('admin-nav');
    await expect(nav.getByRole('link', { name: 'Páginas' })).toBeVisible();

    // Crear una página como EDITOR.
    await page.goto('/admin/paginas/nueva');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Título del post', { exact: true }).fill(`Pagina de Editor ${Date.now()}`);
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 10_000 });

    // El listado no muestra "Eliminar" para EDITOR (borrado físico ADMIN-only).
    await page.goto('/admin/paginas');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await expect(page.getByRole('button', { name: 'Eliminar' })).not.toBeVisible();
  });
});
