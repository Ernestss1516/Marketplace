// CAMBIO PRODUCTO/SERVICIO — RÁFAGA 5 (verificación integral), costura D: el
// admin configura allowedListingType/appliesTo/dependsOn+optionsByParent por
// la UI REAL de /admin/categorias (nunca antes ejercida en Playwright para
// estas features — R2/R3/selects-vinculados solo se probaron vía API directa
// o RTL con mocks). Luego se hace un POST crudo a /listings, con el token de
// una sesión real, para confirmar que el backend coincide EXACTAMENTE con lo
// que la UI acaba de configurar — no solo que el formulario se ve bien.
//
// Solo verificación: no se cambia ningún comportamiento de producción aquí.
// Si algo diverge (UI permite guardar algo que el backend rechaza distinto de
// lo esperado, o viceversa), es un bug real encontrado por R5, no un ajuste
// de test.

import { test, expect } from './fixtures/auth';
import { adminApiToken, authedPost, authedGet } from './helpers/api';

test.describe('R5 — Admin UI real: allowedListingType + appliesTo + dependsOn (costura D)', () => {
  test('ADMIN configura por UI una categoría SERVICE_ONLY con appliesTo y un par vinculado; el backend aplica EXACTAMENTE esa política', async ({
    adminContext,
    request,
  }) => {
    const ts = Date.now();
    const name = `R5 Admin Tipo ${ts}`;
    const slug = `r5-admin-tipo-${ts}`;

    const page = await adminContext.newPage();
    await page.goto('/admin/categorias');
    await page.waitForLoadState('networkidle');

    // ── 1. Crear categoría raíz con allowedListingType=SERVICE_ONLY ───────────
    await page.getByRole('button', { name: 'Nueva categoría raíz' }).click();

    const [nombreInput, slugInput] = await page.getByRole('textbox').all();
    await nombreInput.fill(name);
    await slugInput.fill(slug);
    await page.getByTestId('allowed-listing-type-select').selectOption('SERVICE_ONLY');

    // ── 2. Atributo appliesTo=[SERVICE]: "Especialidad" ───────────────────────
    await page.getByTestId('add-attribute-btn').click();
    await page.getByTestId('attr-name-input').fill('specialty5');
    await page.getByTestId('attr-label-input').fill('Especialidad');
    // Ambos marcados por defecto — desmarcar Producto deja solo [SERVICE].
    await page.getByTestId('applies-to-product-checkbox').uncheck();
    await expect(page.getByTestId('applies-to-service-checkbox')).toBeChecked();
    await page.getByTestId('attr-confirm-btn').click();

    // ── 3. Par vinculado: "Marca" (select plano) → "Modelo" (dependsOn) ───────
    await page.getByTestId('add-attribute-btn').click();
    await page.getByTestId('attr-name-input').fill('marca5');
    await page.getByTestId('attr-label-input').fill('Marca');
    await page.getByTestId('attr-type-select').selectOption('select');
    await page.getByTestId('option-input').fill('Alfa');
    await page.getByRole('button', { name: 'Añadir' }).click();
    await page.getByTestId('option-input').fill('Beta');
    await page.getByRole('button', { name: 'Añadir' }).click();
    await page.getByTestId('attr-confirm-btn').click();

    await page.getByTestId('add-attribute-btn').click();
    await page.getByTestId('attr-name-input').fill('modelo5');
    await page.getByTestId('attr-label-input').fill('Modelo');
    await page.getByTestId('attr-type-select').selectOption('select');
    await page.getByTestId('attr-depends-on-select').selectOption('marca5');
    await expect(page.getByTestId('linked-options-editor')).toBeVisible();

    const alfaInput = page.getByTestId('linked-option-input-Alfa');
    await alfaInput.fill('A1');
    await alfaInput.press('Enter');
    await alfaInput.fill('A2');
    await alfaInput.press('Enter');

    const betaInput = page.getByTestId('linked-option-input-Beta');
    await betaInput.fill('B1');
    await betaInput.press('Enter');

    await page.getByTestId('attr-confirm-btn').click();

    // ── 4. Guardar la categoría completa (nombre + política + schema) ────────
    await page.getByRole('button', { name: 'Guardar' }).click();
    await expect(page.getByText(name)).toBeVisible({ timeout: 10_000 });

    // ── 5. Confirmar por API (GET público) que el backend persistió TAL CUAL ─
    const getRes = await authedGet(request, `/categories/${slug}`);
    expect(getRes.status()).toBe(200);
    const category = await getRes.json();
    expect(category.allowedListingType).toBe('SERVICE_ONLY');

    interface SchemaField {
      name: string;
      appliesTo?: string[];
      options?: string[];
      dependsOn?: string;
      optionsByParent?: Record<string, string[]>;
    }
    const bySchemaName = (n: string) =>
      (category.attributeSchema as SchemaField[]).find((f) => f.name === n);
    expect(bySchemaName('specialty5')?.appliesTo).toEqual(['SERVICE']);
    expect(bySchemaName('marca5')?.options).toEqual(['Alfa', 'Beta']);
    expect(bySchemaName('modelo5')).toMatchObject({
      dependsOn: 'marca5',
      optionsByParent: { Alfa: ['A1', 'A2'], Beta: ['B1'] },
    });

    // ── 6. COHERENCIA: POST crudo /listings con type=PRODUCT en una categoría
    //      SERVICE_ONLY → 422 (mismo backend que acaba de aceptar la config).
    const adminToken = adminApiToken();
    const rejectRes = await authedPost(request, '/listings', adminToken, {
      title: `R5 Producto rechazado ${ts}`,
      description: 'Construido crudo para probar la coherencia UI/backend de R5.',
      price: 100,
      type: 'PRODUCT',
      condition: 'GOOD',
      priceType: 'FIXED',
      categoryId: category.id,
      attributes: {},
      city: 'Madrid',
      province: 'Madrid',
    });
    expect(rejectRes.status()).toBe(422);

    // Control positivo: el mismo backend SÍ acepta un SERVICE en la misma
    // categoría — prueba que el 422 de arriba es por la política de tipo,
    // no por otra cosa mal construida en el payload.
    const acceptRes = await authedPost(request, '/listings', adminToken, {
      title: `R5 Servicio aceptado ${ts}`,
      description: 'Construido crudo para probar la coherencia UI/backend de R5.',
      price: 100,
      type: 'SERVICE',
      priceType: 'FIXED',
      categoryId: category.id,
      attributes: {},
      city: 'Madrid',
      province: 'Madrid',
    });
    expect(acceptRes.status()).toBe(201);
  });
});
