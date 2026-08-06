// NAV PRINCIPAL — /admin/nav (RN.4, última ráfaga del sistema). CRUD del árbol
// desde el backoffice: hasta RN.3 el nav solo se configuraba por endpoint.
//
// Combina los dos moldes que el diseño señala: el editor de nodo viene de
// /admin/footer (campos condicionales por tipo de destino, selector de páginas,
// badge de borrador, confirmación que anuncia el cascade) y la gestión del
// árbol de /admin/categorias (dos niveles, crear hijo bajo un padre, reordenar
// hermanos con ↑↓).
//
// Lo que NINGUNO de los dos moldes puede enseñar, y por eso se prueba aquí:
//   - destino OPCIONAL (un nodo solo-desplegable es válido; el footer lo exigía);
//   - MOVER un nodo de padre, y que el rechazo del backend llegue LEGIBLE;
//   - `active` y `visibleOn`, que el footer no tiene.
//
// El árbol es estado GLOBAL del sitio (la barra sale en todo (public)), así que
// cada test limpia lo suyo al terminar.
//
// Prerequisites: global-setup siembra admin-e2e / moderator-e2e / editor-e2e.

import { test, expect } from './fixtures/auth';
import type { Page } from '@playwright/test';

const NODE = '[data-testid="nav-node"]';

function nodo(page: Page, label: string) {
  return page.locator(`${NODE}[data-label="${label}"]`);
}

/** Rellena el formulario abierto y guarda. `destino` null = solo desplegable. */
async function rellenar(
  page: Page,
  values: {
    label: string;
    destino: null | { type: 'INTERNAL' | 'EXTERNAL'; url: string };
    parent?: string;
    visibleOn?: string[];
    active?: boolean;
  },
) {
  const form = page.getByTestId('node-form');
  await form.getByTestId('node-label-input').fill(values.label);

  if (values.parent !== undefined) {
    await form.getByTestId('node-parent-select').selectOption({ label: values.parent });
  }

  await form.getByTestId('node-type-select').selectOption(values.destino ? values.destino.type : '');
  if (values.destino) {
    const testid =
      values.destino.type === 'INTERNAL' ? 'node-internal-url-input' : 'node-external-url-input';
    await form.getByTestId(testid).fill(values.destino.url);
  }

  if (values.active === false) await form.getByTestId('node-active-checkbox').uncheck();
  for (const pt of values.visibleOn ?? []) {
    await form.getByTestId('node-visible-on').getByRole('checkbox', { name: pt }).check();
  }

  await form.getByTestId('node-submit-btn').click();
}

/** Borra un nodo aceptando el confirm del navegador; devuelve su texto. */
async function borrar(page: Page, label: string): Promise<string> {
  let mensaje = '';
  page.once('dialog', (d) => {
    mensaje = d.message();
    d.accept();
  });
  await nodo(page, label).getByRole('button', { name: `Eliminar ${label}` }).click();
  await expect(nodo(page, label)).toHaveCount(0);
  return mensaje;
}

test.describe('Admin — /admin/nav', () => {
  test('MODERATOR y EDITOR no pueden entrar; ADMIN sí', async ({
    moderatorContext,
    editorContext,
    adminContext,
  }) => {
    for (const ctx of [moderatorContext, editorContext]) {
      const page = await ctx.newPage();
      await page.goto('/admin/nav');
      await page.waitForLoadState('networkidle');
      // El middleware manda fuera de /admin a quien no tenga el rol.
      expect(page.url()).not.toContain('/admin/nav');
      await page.close();
    }

    const page = await adminContext.newPage();
    await page.goto('/admin/nav');
    await expect(page.getByRole('heading', { name: 'Navegación' })).toBeVisible();
    // Y la sección aparece en el nav del backoffice.
    await expect(page.getByTestId('admin-nav').getByRole('link', { name: 'Navegación' })).toBeVisible();
  });

  test('crea un menú raíz con destino y un submenú anidado bajo él', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/nav');

    await page.getByTestId('new-root-btn').click();
    await rellenar(page, { label: 'Comprar', destino: { type: 'INTERNAL', url: '/busqueda' } });
    await expect(nodo(page, 'Comprar')).toBeVisible();
    await expect(nodo(page, 'Comprar')).toContainText('Ruta: /busqueda');

    await page.getByTestId('new-child-btn-Comprar').click();
    await rellenar(page, { label: 'Ofertas', destino: { type: 'INTERNAL', url: '/busqueda?sort=precio' } });
    await expect(nodo(page, 'Ofertas')).toBeVisible();

    // El hijo cuelga del padre, no es otra raíz: vive dentro de su tarjeta.
    const tarjetaPadre = page.locator('div.rounded-md.border', { has: nodo(page, 'Comprar') }).first();
    await expect(tarjetaPadre.locator(`${NODE}[data-label="Ofertas"]`)).toHaveCount(1);

    await borrar(page, 'Comprar');
  });

  test('un nodo SIN destino es válido, y se avisa mientras no tenga submenús', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/nav');

    // Ésta es LA diferencia con el footer: destino opcional.
    await page.getByTestId('new-root-btn').click();
    await rellenar(page, { label: 'Ayuda', destino: null });

    await expect(nodo(page, 'Ayuda')).toContainText('Sin destino (solo desplegable)');
    // Sin hijos todavía no lleva a ningún sitio: el gate lo poda y el admin lo ve.
    await expect(nodo(page, 'Ayuda').getByTestId('badge-sin-destino')).toBeVisible();

    await page.getByTestId('new-child-btn-Ayuda').click();
    await rellenar(page, { label: 'Contacto', destino: { type: 'INTERNAL', url: '/contacto' } });

    // Con un hijo ya abre algo: el aviso desaparece.
    await expect(nodo(page, 'Ayuda').getByTestId('badge-sin-destino')).toHaveCount(0);

    await borrar(page, 'Ayuda');
  });

  test('editar: cambiar el tipo limpia el campo anterior, y active/visibleOn se guardan', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/nav');

    await page.getByTestId('new-root-btn').click();
    await rellenar(page, { label: 'Editable', destino: { type: 'INTERNAL', url: '/busqueda' } });
    await expect(nodo(page, 'Editable')).toBeVisible();

    await nodo(page, 'Editable').getByRole('button', { name: 'Editar' }).click();
    const form = page.getByTestId('node-form');

    // Al cambiar de tipo, el campo del tipo anterior desaparece y el nuevo nace vacío.
    await form.getByTestId('node-type-select').selectOption('EXTERNAL');
    await expect(form.getByTestId('node-internal-url-input')).toHaveCount(0);
    await expect(form.getByTestId('node-external-url-input')).toHaveValue('');

    await form.getByTestId('node-external-url-input').fill('https://example.com');
    await form.getByTestId('node-active-checkbox').uncheck();
    await form.getByTestId('node-visible-on').getByRole('checkbox', { name: 'Portada' }).check();
    await form.getByTestId('node-submit-btn').click();

    const fila = nodo(page, 'Editable');
    await expect(fila).toContainText('Externa: https://example.com');
    await expect(fila).toContainText('inactivo');
    await expect(fila).toContainText('solo en: HOME');

    await borrar(page, 'Editable');
  });

  test('reordenar hermanos con ↑↓ cambia el orden', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/nav');

    await page.getByTestId('new-root-btn').click();
    await rellenar(page, { label: 'Primero', destino: { type: 'INTERNAL', url: '/a' } });
    await expect(nodo(page, 'Primero')).toBeVisible();
    await page.getByTestId('new-root-btn').click();
    await rellenar(page, { label: 'Segundo', destino: { type: 'INTERNAL', url: '/b' } });
    await expect(nodo(page, 'Segundo')).toBeVisible();

    const labels = async () => page.locator(NODE).evaluateAll((ns) => ns.map((n) => n.getAttribute('data-label')));
    expect(await labels()).toEqual(['Primero', 'Segundo']);

    await nodo(page, 'Segundo').getByRole('button', { name: 'Subir Segundo' }).click();
    await expect.poll(labels).toEqual(['Segundo', 'Primero']);

    // Persiste: no era solo el pintado optimista. Se sondea porque tras el
    // reload el árbol se carga por fetch — leerlo al instante da la lista vacía.
    await page.reload();
    await expect.poll(labels).toEqual(['Segundo', 'Primero']);

    await borrar(page, 'Primero');
    await borrar(page, 'Segundo');
  });

  test('MOVER un nodo de padre, y el rechazo por profundidad llega LEGIBLE', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/nav');

    await page.getByTestId('new-root-btn').click();
    await rellenar(page, { label: 'Raiz A', destino: { type: 'INTERNAL', url: '/a' } });
    await expect(nodo(page, 'Raiz A')).toBeVisible();
    await page.getByTestId('new-root-btn').click();
    await rellenar(page, { label: 'Raiz B', destino: { type: 'INTERNAL', url: '/b' } });
    await expect(nodo(page, 'Raiz B')).toBeVisible();

    // Mover "Raiz B" para que cuelgue de "Raiz A" = editar su padre.
    await nodo(page, 'Raiz B').getByRole('button', { name: 'Editar' }).click();
    await page.getByTestId('node-form').getByTestId('node-parent-select').selectOption({ label: 'Raiz A' });
    await page.getByTestId('node-form').getByTestId('node-submit-btn').click();

    const tarjetaA = page.locator('div.rounded-md.border', { has: nodo(page, 'Raiz A') }).first();
    await expect(tarjetaA.locator(`${NODE}[data-label="Raiz B"]`)).toHaveCount(1);

    // Ahora un tercer nivel: crear un hijo de "Raiz B", que ya es submenú. La UI
    // no ofrece a "Raiz B" como padre posible, así que el desplegable solo lista
    // raíces reales — se comprueba que "Raiz B" NO está entre las opciones.
    await page.getByTestId('new-root-btn').click();
    const opciones = await page
      .getByTestId('node-form')
      .getByTestId('node-parent-select')
      .locator('option')
      .allTextContents();
    expect(opciones).toContain('Raiz A');
    expect(opciones).not.toContain('Raiz B');
    await page.getByTestId('node-form').getByRole('button', { name: 'Cancelar' }).click();

    await borrar(page, 'Raiz A'); // cascade: se lleva a Raiz B
    await expect(nodo(page, 'Raiz B')).toHaveCount(0);
  });

  test('el backend rechaza con mensaje legible si el movimiento arrastraría nietos', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/nav');

    // Padre con un hijo + otra raíz.
    await page.getByTestId('new-root-btn').click();
    await rellenar(page, { label: 'Con hijo', destino: { type: 'INTERNAL', url: '/c' } });
    await expect(nodo(page, 'Con hijo')).toBeVisible();
    await page.getByTestId('new-child-btn-Con hijo').click();
    await rellenar(page, { label: 'El hijo', destino: { type: 'INTERNAL', url: '/h' } });
    await expect(nodo(page, 'El hijo')).toBeVisible();

    await page.getByTestId('new-root-btn').click();
    await rellenar(page, { label: 'Destino', destino: { type: 'INTERNAL', url: '/d' } });
    await expect(nodo(page, 'Destino')).toBeVisible();

    // La UI ya no ofrece mover "Con hijo" (arrastraría a "El hijo" a un tercer
    // nivel), así que el desplegable de padres le sale vacío. Es la guarda de la
    // UI; la del backend está probada en nav.e2e-spec.ts contra la API.
    await nodo(page, 'Con hijo').getByRole('button', { name: 'Editar' }).click();
    const opciones = await page
      .getByTestId('node-form')
      .getByTestId('node-parent-select')
      .locator('option')
      .allTextContents();
    expect(opciones).toEqual(['— Menú principal (raíz) —']);
    await page.getByTestId('node-form').getByRole('button', { name: 'Cancelar' }).click();

    // Y el borrado anuncia el cascade con el número exacto.
    const mensaje = await borrar(page, 'Con hijo');
    expect(mensaje).toContain('1 submenú');
    await expect(nodo(page, 'El hijo')).toHaveCount(0);

    await borrar(page, 'Destino');
  });

  test('un rechazo del backend se pinta LEGIBLE en el formulario, no como error crudo', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/nav');

    // La UI no ofrece padres que producirían profundidad 3, así que ese rechazo
    // concreto no se puede provocar desde aquí (está probado contra la API en
    // nav.e2e-spec.ts). Lo que sí se ejercita es el MISMO camino de error —
    // ApiError → formError → el aviso del formulario— con una validación que la
    // UI deja pasar a propósito: una ruta interna sin "/" delante.
    await page.getByTestId('new-root-btn').click();
    const form = page.getByTestId('node-form');
    await form.getByTestId('node-label-input').fill('Ruta mala');
    await form.getByTestId('node-type-select').selectOption('INTERNAL');
    await form.getByTestId('node-internal-url-input').fill('busqueda'); // sin "/"
    await form.getByTestId('node-submit-btn').click();

    // El mensaje del backend, tal cual, dentro del formulario: ni un 500, ni un
    // error crudo, ni un formulario que se cierra como si hubiera guardado.
    await expect(form.getByTestId('node-form-error')).toContainText(
      'Una ruta interna debe empezar por "/"',
    );
    await expect(nodo(page, 'Ruta mala')).toHaveCount(0);

    // Y se puede corregir sin perder lo escrito.
    await form.getByTestId('node-internal-url-input').fill('/busqueda');
    await form.getByTestId('node-submit-btn').click();
    await expect(nodo(page, 'Ruta mala')).toBeVisible();

    await borrar(page, 'Ruta mala');
  });

  test('destino PAGE en borrador se marca como no visible', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    const titulo = `Pagina Nav Admin ${Date.now()}`;

    // Página en BORRADOR (no se publica).
    await page.goto('/admin/paginas/nueva');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Título del post', { exact: true }).fill(titulo);
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 10_000 });

    await page.goto('/admin/nav');
    await page.getByTestId('new-root-btn').click();
    const form = page.getByTestId('node-form');
    await form.getByTestId('node-type-select').selectOption('PAGE');
    await form.getByTestId('node-page-select').selectOption({ label: `${titulo} (borrador)` });
    await form.getByTestId('node-submit-btn').click();

    // El label se prerrellena con el título de la página al elegirla.
    await expect(nodo(page, titulo)).toContainText('en borrador — no se muestra');

    await borrar(page, titulo);
  });
});
