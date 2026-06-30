// RC5.3 — Playwright E2E: editor visual de atributos por categoría.
//
// Verifica que:
//   1. ADMIN carga /admin/categorias sin errores
//   2. MODERATOR es redirigido desde /admin/categorias (no en MODERATOR_ALLOWED_PATHS)
//   3. ADMIN puede editar una categoría y añadir un atributo de tipo text
//   4. filterable está deshabilitado para un name no-buscable (ej. "color")
//   5. filterable está habilitado para un name buscable (ej. "brand")
//   6. AJUSTE 1: renombrar brand→colour (deshabilita filterable) → volver a brand
//      recupera el valor previo (la intención no se pierde)
//   7. cardAttribute se deshabilita al llegar a 2 marcados en el schema efectivo
//   8. El textarea JSON original ya no está presente

import { test, expect } from './fixtures/auth';

test.describe('Admin — /admin/categorias (ADMIN)', () => {
  test('ADMIN carga la página y ve el árbol de categorías', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/categorias');
    await page.waitForLoadState('networkidle');

    expect(page.url()).toContain('/admin/categorias');
    await expect(page.getByRole('heading', { name: 'Categorías' })).toBeVisible();
    // The old JSON textarea must NOT be present
    await expect(page.locator('textarea')).not.toBeVisible();
  });

  test('Editor de atributos: añadir atributo de tipo text', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/categorias');
    await page.waitForLoadState('networkidle');

    // Open edit for "Electrónica" (the first root category in the test seed)
    const editBtn = page.getByRole('button', { name: 'Editar' }).first();
    await editBtn.click();
    await page.waitForTimeout(400);

    // The "Atributos" section and "Añadir atributo" button should be visible
    await expect(page.getByTestId('add-attribute-btn')).toBeVisible();

    // Click "Añadir atributo" to open the new-field form
    await page.getByTestId('add-attribute-btn').click();
    await page.waitForTimeout(200);

    // Fill in name and label
    await page.getByTestId('attr-name-input').fill('brand');
    await page.getByTestId('attr-label-input').fill('Marca');

    // Confirm
    await page.getByTestId('attr-confirm-btn').click();
    await page.waitForTimeout(200);

    // The row for "brand" should now appear in the list
    await expect(page.locator('code').filter({ hasText: 'brand' })).toBeVisible();

    // Clean up: save with schema (saves to DB)
    await page.getByTestId('save-schema-btn').click();
    await page.waitForTimeout(600);
  });

  test('filterable deshabilitado para name no-buscable ("color")', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/categorias');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Editar' }).first().click();
    await page.waitForTimeout(400);

    await page.getByTestId('add-attribute-btn').click();
    await page.waitForTimeout(200);

    // Type a non-searchable name
    await page.getByTestId('attr-name-input').fill('color');

    // The filterable checkbox should be disabled
    const filterCb = page.getByTestId('filterable-checkbox');
    await expect(filterCb).toBeDisabled();

    // Cancel without saving
    await page.getByRole('button', { name: 'Cancelar' }).click();
  });

  test('filterable habilitado para name buscable ("brand")', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/categorias');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Editar' }).first().click();
    await page.waitForTimeout(400);

    await page.getByTestId('add-attribute-btn').click();
    await page.waitForTimeout(200);

    await page.getByTestId('attr-name-input').fill('brand');

    // filterable should be ENABLED for "brand" (a VARIABLE_ATTRIBUTE_KEY)
    const filterCb = page.getByTestId('filterable-checkbox');
    await expect(filterCb).toBeEnabled();

    await page.getByRole('button', { name: 'Cancelar' }).click();
  });

  test('AJUSTE 1: renombrar brand→colour→brand recupera la intención de filterable', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/categorias');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Editar' }).first().click();
    await page.waitForTimeout(400);

    await page.getByTestId('add-attribute-btn').click();
    await page.waitForTimeout(200);

    // Start with a searchable name and mark filterable
    await page.getByTestId('attr-name-input').fill('brand');
    const filterCb = page.getByTestId('filterable-checkbox');
    await expect(filterCb).toBeEnabled();
    await filterCb.check();
    expect(await filterCb.isChecked()).toBe(true);

    // Rename to a non-searchable name — checkbox disables but value is preserved
    await page.getByTestId('attr-name-input').fill('colour');
    await expect(filterCb).toBeDisabled();
    // The checked state is preserved even though disabled (Ajuste 1)
    expect(await filterCb.isChecked()).toBe(true);

    // Rename back to "brand" — filterable re-enables WITH previous value (true)
    await page.getByTestId('attr-name-input').fill('brand');
    await expect(filterCb).toBeEnabled();
    expect(await filterCb.isChecked()).toBe(true);

    await page.getByRole('button', { name: 'Cancelar' }).click();
  });

  test('cardAttribute se deshabilita en el 3er campo tras marcar 2', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/categorias');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Editar' }).first().click();
    await page.waitForTimeout(400);

    // Add first attribute with cardAttribute=true
    await page.getByTestId('add-attribute-btn').click();
    await page.waitForTimeout(200);
    await page.getByTestId('attr-name-input').fill('attr1');
    await page.getByTestId('attr-label-input').fill('Atributo 1');
    await page.getByTestId('card-attribute-checkbox').check();
    await page.getByTestId('attr-confirm-btn').click();
    await page.waitForTimeout(200);

    // Add second attribute with cardAttribute=true
    await page.getByTestId('add-attribute-btn').click();
    await page.waitForTimeout(200);
    await page.getByTestId('attr-name-input').fill('attr2');
    await page.getByTestId('attr-label-input').fill('Atributo 2');
    await page.getByTestId('card-attribute-checkbox').check();
    await page.getByTestId('attr-confirm-btn').click();
    await page.waitForTimeout(200);

    // Start adding a third attribute — cardAttribute should be disabled
    await page.getByTestId('add-attribute-btn').click();
    await page.waitForTimeout(200);
    await page.getByTestId('attr-name-input').fill('attr3');
    await page.getByTestId('attr-label-input').fill('Atributo 3');
    const cardCb = page.getByTestId('card-attribute-checkbox');
    await expect(cardCb).toBeDisabled();

    await page.getByRole('button', { name: 'Cancelar' }).click();
  });

  test('type=select muestra el editor de opciones', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/categorias');
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Editar' }).first().click();
    await page.waitForTimeout(400);

    await page.getByTestId('add-attribute-btn').click();
    await page.waitForTimeout(200);

    // Options editor should NOT be visible for "text" type
    await expect(page.getByTestId('options-editor')).not.toBeVisible();

    // Change to "select" — options editor should appear
    await page.getByTestId('attr-type-select').selectOption('select');
    await expect(page.getByTestId('options-editor')).toBeVisible();

    // Add an option
    await page.getByTestId('option-input').fill('Rojo');
    await page.getByRole('button', { name: 'Añadir' }).click();
    await expect(page.locator('span').filter({ hasText: 'Rojo' })).toBeVisible();

    await page.getByRole('button', { name: 'Cancelar' }).click();
  });
});

test.describe('Admin — /admin/categorias (MODERATOR bloqueado)', () => {
  test('MODERATOR → /admin/categorias redirige a /', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/categorias');
    await page.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 8_000 });
    expect(page.url()).not.toContain('/admin');
  });
});
