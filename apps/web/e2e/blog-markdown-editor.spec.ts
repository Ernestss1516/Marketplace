// BLOG — editor de markdown estilo GitHub (@uiw/react-md-editor), ahora
// montado DENTRO del bloque `text` del editor de bloques (Ráfaga 2), no
// directo en PostForm como antes de la Ráfaga 1. Verifica que el editor
// WYSIWYG-de-sintaxis funciona igual que antes (reuso literal de
// MarkdownEditor.tsx — cero cambios en ese componente), que el markdown se
// guarda y se publica correctamente, y que la regla invariante de seguridad
// se mantiene: un <script> literal escrito en el editor nunca se ejecuta, ni
// en el preview del editor de bloques ni en la página pública del post.
//
// Prerequisites: global-setup seeds admin-e2e@example.com (ADMIN).

import { test, expect } from './fixtures/auth';
import { clicarYEsperarUrl } from './helpers/nav';

test.describe('Editor de markdown (bloque "Texto") en /admin/blog/nuevo', () => {
  test('ADMIN añade un bloque de texto con formato variado, lo guarda y lo publica; el público lo renderiza igual', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/blog/nuevo');
    await page.waitForLoadState('networkidle');

    const titleInput = page.getByPlaceholder('Título del post', { exact: true });
    await expect(titleInput).toBeVisible();

    const title = `Post editor rico ${Date.now()}`;
    await titleInput.fill(title);

    // Añadir un bloque de texto — el editor arranca vacío (Ráfaga 2).
    await page.getByRole('button', { name: 'Añadir bloque' }).click();
    await page.getByText('Texto', { exact: true }).click();

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
    // 2b: el clic sobre este <Link> a veces no conmuta el router (bug de Next
    // #57565). OBSERVADO con una sonda en este mismo spec: tras el clic la URL
    // seguía siendo "/blog" y el <h1> del markdown "faltaba" únicamente porque
    // nunca se salió de la lista — el markdown renderiza perfectamente cuando la
    // navegación sí ocurre. Reintentar el CLIC (no la espera) es lo único que
    // recupera el router; ver e2e/helpers/nav.ts.
    await clicarYEsperarUrl(
      page,
      page.getByRole('link', { name: title, exact: true }),
      (url) => url.pathname.startsWith('/blog/'),
    );
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

    await page.getByRole('button', { name: 'Añadir bloque' }).click();
    await page.getByText('Texto', { exact: true }).click();

    const editorTextarea = page.locator('.w-md-editor-text-input');
    await expect(editorTextarea).toBeVisible();
    await editorTextarea.click();
    await editorTextarea.fill(
      'Texto normal.\n\n<script>window.__xss_executed = true;</script>\n',
    );

    // Preview del editor de bloques (BlockEditor, reutiliza el mismo
    // BlockRenderer que el sitio público — tubería react-markdown +
    // remark-gfm + rehype-sanitize, sin rehype-raw) — el script no debe
    // ejecutarse aquí tampoco.
    await page.getByRole('button', { name: /ver preview/i }).click();
    await page.waitForTimeout(300);
    const executedInEditor = await page.evaluate(() => (window as unknown as { __xss_executed?: boolean }).__xss_executed === true);
    expect(executedInEditor).toBe(false);
    await expect(page.getByText('Texto normal.')).toBeVisible();

    await page.getByRole('button', { name: /ocultar preview/i }).click();
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/blog\/.+\/editar/, { timeout: 10_000 });
    await page.getByRole('button', { name: /publicar/i }).click();
    await page.waitForTimeout(1_000);

    // Verificar también en la página pública.
    await page.goto('/blog');
    await page.waitForLoadState('networkidle');
    // 2b: el clic sobre este <Link> a veces no conmuta el router (bug de Next
    // #57565). OBSERVADO con una sonda en este mismo spec: tras el clic la URL
    // seguía siendo "/blog" y el <h1> del markdown "faltaba" únicamente porque
    // nunca se salió de la lista — el markdown renderiza perfectamente cuando la
    // navegación sí ocurre. Reintentar el CLIC (no la espera) es lo único que
    // recupera el router; ver e2e/helpers/nav.ts.
    await clicarYEsperarUrl(
      page,
      page.getByRole('link', { name: title, exact: true }),
      (url) => url.pathname.startsWith('/blog/'),
    );
    await page.waitForLoadState('domcontentloaded');

    const executedPublic = await page.evaluate(() => (window as unknown as { __xss_executed?: boolean }).__xss_executed === true);
    expect(executedPublic).toBe(false);
    await expect(page.getByText('Texto normal.')).toBeVisible();
  });
});
