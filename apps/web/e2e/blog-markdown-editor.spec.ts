// BLOG — editor de markdown estilo GitHub (@uiw/react-md-editor) en PostForm.
//
// Verifica que el editor WYSIWYG-de-sintaxis reemplaza el textarea sin romper el
// resto del formulario, que el markdown escrito se guarda y se publica
// correctamente, y que la regla invariante de seguridad se mantiene: un <script>
// literal escrito en el editor nunca se ejecuta, ni en el preview del admin ni en
// la página pública del post.
//
// Prerequisites: global-setup seeds admin-e2e@example.com (ADMIN).

import { test, expect } from './fixtures/auth';

test.describe('Editor de markdown en /admin/blog/nuevo', () => {
  test('ADMIN escribe un post con formato variado, lo guarda y lo publica; el público lo renderiza igual', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/blog/nuevo');
    await page.waitForLoadState('networkidle');

    const titleInput = page.getByPlaceholder('Título del post', { exact: true });
    await expect(titleInput).toBeVisible();

    const title = `Post editor rico ${Date.now()}`;
    await titleInput.fill(title);

    // El editor de @uiw/react-md-editor renderiza un <textarea> real bajo
    // .w-md-editor-text-input en modo "edit" (fijado así en MarkdownEditor.tsx —
    // el modo live/preview de esta librería nunca se habilita, ver el comentario
    // de seguridad en ese archivo).
    const editorTextarea = page.locator('.w-md-editor-text-input');
    await expect(editorTextarea).toBeVisible();

    const bodyMarkdown =
      '# Titulo de prueba\n\n' +
      '**negrita** y *cursiva*, una [cita a docs](https://example.com/docs) y:\n\n' +
      '- item uno\n- item dos\n\n' +
      '> Una cita en bloque\n';
    await editorTextarea.click();
    await editorTextarea.fill(bodyMarkdown);

    // El resto del formulario sigue intacto — nada se resetea al escribir en el editor.
    await expect(titleInput).toHaveValue(title);

    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/blog\/.+\/editar/, { timeout: 10_000 });

    await page.getByRole('button', { name: /publicar/i }).click();
    await page.waitForTimeout(1_000);

    // --- Verificar en /blog público (si no se publicó de verdad, el post no
    // aparecerá aquí y el test fallará al no encontrar el link) ---
    await page.goto('/blog');
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: new RegExp(title.slice(0, 20)) }).click();
    await page.waitForLoadState('domcontentloaded');

    const article = page.locator('article, main').first();
    await expect(article.locator('h1', { hasText: 'Titulo de prueba' })).toBeVisible();
    await expect(article.locator('strong', { hasText: 'negrita' })).toBeVisible();
    await expect(article.locator('em', { hasText: 'cursiva' })).toBeVisible();
    await expect(article.locator('blockquote')).toBeVisible();
    await expect(article.locator('li')).toHaveCount(2);
  });

  test('un <script> literal escrito en el editor nunca se ejecuta (regla invariante de seguridad)', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/blog/nuevo');
    await page.waitForLoadState('networkidle');

    const titleInput = page.getByPlaceholder('Título del post', { exact: true });
    const title = `Post XSS check ${Date.now()}`;
    await titleInput.fill(title);

    const editorTextarea = page.locator('.w-md-editor-text-input');
    await expect(editorTextarea).toBeVisible();
    await editorTextarea.click();
    await editorTextarea.fill(
      'Texto normal.\n\n<script>window.__xss_executed = true;</script>\n',
    );

    // Preview del propio editor (toggle existente en PostForm, tubería
    // react-markdown + remark-gfm + rehype-sanitize, sin rehype-raw) — el script
    // no debe ejecutarse aquí tampoco.
    await page.getByRole('button', { name: /ver preview/i }).click();
    await page.waitForTimeout(300);
    const executedInEditor = await page.evaluate(() => (window as unknown as { __xss_executed?: boolean }).__xss_executed === true);
    expect(executedInEditor).toBe(false);

    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/blog\/.+\/editar/, { timeout: 10_000 });
    await page.getByRole('button', { name: /publicar/i }).click();
    await page.waitForTimeout(1_000);

    // Verificar también en la página pública.
    await page.goto('/blog');
    await page.waitForLoadState('networkidle');
    await page.getByRole('link', { name: new RegExp(title.slice(0, 20)) }).click();
    await page.waitForLoadState('domcontentloaded');

    const executedPublic = await page.evaluate(() => (window as unknown as { __xss_executed?: boolean }).__xss_executed === true);
    expect(executedPublic).toBe(false);
  });
});
