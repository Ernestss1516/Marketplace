// CAMBIO PRODUCTO/SERVICIO — RÁFAGA 5 (verificación integral): flujos de
// COSTURA que ninguna batería aislada (R0-R4 + orden-por-flechas +
// selects-vinculados) ejerce enteros. Cada test cruza varias ráfagas en un
// solo flujo real (navegador + backend + Meilisearch), no solo su pieza:
//   A. SERVICE_ONLY (R2) → wizard fuerza tipo (R3) → ficha coherente (R4).
//   B. Herencia de política (R1) en un flujo real, no solo unit/API aislada.
//   C. Transiciones del wizard (R3) hasta el resultado final buscable/visible,
//      con aserción explícita de AUSENCIA de residuo del estado intermedio.
//   E. appliesTo + dependsOn (selects vinculados) compuestos en el wizard
//      real — hasta ahora solo probados como función pura.
//   F. Facetas por tipo (R4) + selects vinculados + Meilisearch juntos.
//
// Setup de categorías vía API admin directa (rápido) — la UI real de admin
// para estas features ya se prueba en admin-categorias-tipo.spec.ts (costura
// D); aquí el foco es wizard→búsqueda→ficha, no el editor.
//
// Solo verificación: ningún comportamiento de producción cambia aquí. Un
// fallo que revele una divergencia real es un bug encontrado por R5, no un
// ajuste de test.

import path from 'path';
import { test, expect } from './fixtures/auth';
import { adminApiToken, authedPost, pollSearch } from './helpers/api';

interface CatRef {
  id: string;
  slug: string;
  name: string;
}

const FOTO_FIXTURE = path.join(__dirname, 'fixtures', 'test-image.png');

async function uploadPhotoAndAdvance(page: import('@playwright/test').Page) {
  await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible({ timeout: 8_000 });
  await page.locator('[data-testid="foto-input"]').setInputFiles(FOTO_FIXTURE);
  await expect(page.locator('span').filter({ hasText: 'Portada' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Siguiente' }).click();
}

test.describe('R5 — flujo transversal producto/servicio (costuras A, B, C, E, F)', () => {
  let adminToken: string;
  let svcCat: CatRef;
  let poParent: CatRef;
  let poChild: CatRef;
  let bothA: CatRef;
  let bothB: CatRef;
  let linkedCat: CatRef;
  let linkedCatF: CatRef;

  test.beforeAll(async ({ request }) => {
    adminToken = adminApiToken();
    const ts = Date.now();

    async function createCategory(body: Record<string, unknown>): Promise<CatRef> {
      const res = await authedPost(request, '/admin/categories', adminToken, body);
      if (res.status() !== 201) {
        throw new Error(
          `[R5 setup] no se pudo crear categoría "${body.slug}": ${res.status()} ${await res.text()}`,
        );
      }
      const created = await res.json();
      return { id: created.id as string, slug: created.slug as string, name: created.name as string };
    }

    svcCat = await createCategory({
      name: `R5 Servicio Only ${ts}`,
      slug: `r5-svc-${ts}`,
      allowedListingType: 'SERVICE_ONLY',
      attributeSchema: [
        { name: 'zona', label: 'Zona de cobertura', type: 'text', filterable: false, required: false },
      ],
    });

    poParent = await createCategory({
      name: `R5 Padre PO ${ts}`,
      slug: `r5-po-parent-${ts}`,
      allowedListingType: 'PRODUCT_ONLY',
      attributeSchema: [
        { name: 'materialP', label: 'Material', type: 'text', filterable: false, required: false },
      ],
    });
    // Sin allowedListingType propio → BOTH por defecto → hereda PRODUCT_ONLY del padre (R1).
    poChild = await createCategory({
      name: `R5 Hijo Hereda ${ts}`,
      slug: `r5-po-child-${ts}`,
      parentId: poParent.id,
      attributeSchema: [
        { name: 'acabadoP', label: 'Acabado', type: 'text', filterable: false, required: false },
      ],
    });

    bothA = await createCategory({
      name: `R5 Both A ${ts}`,
      slug: `r5-both-a-${ts}`,
      attributeSchema: [
        { name: 'comunA', label: 'Común A', type: 'text', filterable: false, required: false },
        {
          name: 'soloProductoA', label: 'Solo Producto A', type: 'text',
          filterable: false, required: true, appliesTo: ['PRODUCT'],
        },
        {
          name: 'soloServicioA', label: 'Solo Servicio A', type: 'text',
          filterable: false, required: true, appliesTo: ['SERVICE'],
        },
      ],
    });
    bothB = await createCategory({
      name: `R5 Both B ${ts}`,
      slug: `r5-both-b-${ts}`,
      attributeSchema: [
        { name: 'comunB', label: 'Común B', type: 'text', filterable: false, required: false },
        {
          name: 'soloProductoB', label: 'Solo Producto B', type: 'text',
          filterable: false, required: true, appliesTo: ['PRODUCT'],
        },
        {
          name: 'soloServicioB', label: 'Solo Servicio B', type: 'text',
          filterable: false, required: true, appliesTo: ['SERVICE'],
        },
      ],
    });

    // gearbox/fuel (no marcaLink/modeloLink): las facetas de búsqueda usan
    // FACET_ATTRIBUTES, una lista curada a mano en search.service.ts,
    // independiente del mecanismo dinámico de R0 — un nombre de atributo
    // completamente nuevo NUNCA aparece como faceta aunque sea filterable:true
    // (comportamiento existente y deliberado, no un hueco de R5). gearbox/fuel
    // sí están en esa lista, igual que en search-facets-by-type.e2e-spec.ts.
    linkedCat = await createCategory({
      name: `R5 Linked ${ts}`,
      slug: `r5-linked-${ts}`,
      attributeSchema: [
        {
          name: 'gearbox', label: 'Cambio', type: 'select', filterable: true, required: false,
          options: ['Manual', 'Automatico'], appliesTo: ['PRODUCT'],
        },
        {
          name: 'fuel', label: 'Combustible', type: 'select', filterable: true, required: false,
          dependsOn: 'gearbox',
          optionsByParent: { Manual: ['Gasolina', 'Diesel'], Automatico: ['Hibrido'] },
          appliesTo: ['PRODUCT'],
        },
      ],
    });

    // Categoría propia para F — NO se reutiliza linkedCat: si E publicara ahí
    // también, su propio anuncio PRODUCT (gearbox=Manual/fuel=Gasolina) se
    // sumaría al recuento de facetas de F y F dejaría de ser autocontenido.
    linkedCatF = await createCategory({
      name: `R5 Linked F ${ts}`,
      slug: `r5-linked-f-${ts}`,
      attributeSchema: [
        {
          name: 'gearbox', label: 'Cambio', type: 'select', filterable: true, required: false,
          options: ['Manual', 'Automatico'], appliesTo: ['PRODUCT'],
        },
        {
          name: 'fuel', label: 'Combustible', type: 'select', filterable: true, required: false,
          dependsOn: 'gearbox',
          optionsByParent: { Manual: ['Gasolina', 'Diesel'], Automatico: ['Hibrido'] },
          appliesTo: ['PRODUCT'],
        },
      ],
    });
  });

  // ── A ────────────────────────────────────────────────────────────────────

  test('A. SERVICE_ONLY: wizard no pregunta tipo, publica como SERVICE, ficha oculta Condición y muestra el atributo', async ({ proContext }) => {
    const page = await proContext.newPage();
    const TITLE = `R5 Flujo A ${Date.now()}`;

    await page.goto('/publicar');
    await expect(page.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible();
    await page.getByRole('button', { name: svcCat.name, exact: true }).click();

    await uploadPhotoAndAdvance(page);

    await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
    await expect(page.getByLabel('Producto')).not.toBeVisible();
    await expect(page.getByLabel('Servicio')).not.toBeVisible();
    await expect(page.getByText('El tipo no se puede cambiar tras crear el anuncio.')).toBeVisible();
    await page.locator('#title').fill(TITLE);
    await page.locator('#description').fill('Descripción de prueba R5 flujo A.');
    await page.locator('#price').fill('50');
    await page.getByRole('button', { name: 'Siguiente' }).click();

    await expect(page.getByRole('heading', { name: 'Atributos' })).toBeVisible();
    await page.locator('#attr-zona').fill('Madrid capital');
    await page.getByRole('button', { name: 'Siguiente' }).click();

    await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
    await page.locator('#city').fill('Madrid');
    await page.locator('#province').fill('Madrid');
    await page.getByRole('button', { name: 'Revisar' }).click();

    await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
    await page.getByRole('button', { name: 'Publicar ahora' }).click();
    await page.waitForURL('**/anuncio/**', { timeout: 20_000 });

    await expect(page.locator('h1')).toContainText(TITLE);
    await expect(page.getByText('Estado:')).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Características' })).toBeVisible();
    await expect(page.locator('dt').filter({ hasText: 'Zona de cobertura' })).toBeVisible();
    await expect(page.locator('dd').filter({ hasText: 'Madrid capital' })).toBeVisible();
  });

  // ── B ────────────────────────────────────────────────────────────────────

  test('B. Categoría hija hereda PRODUCT_ONLY del padre (sin política propia): wizard fuerza PRODUCT, ficha coherente', async ({ proContext }) => {
    const page = await proContext.newPage();
    const TITLE = `R5 Flujo B ${Date.now()}`;

    await page.goto('/publicar');
    await expect(page.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible();
    await page.getByRole('button', { name: poParent.name, exact: true }).click();
    await page.getByRole('button', { name: poChild.name, exact: true }).click();

    await uploadPhotoAndAdvance(page);

    await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
    await expect(page.getByLabel('Producto')).not.toBeVisible();
    await expect(page.getByLabel('Servicio')).not.toBeVisible();
    await expect(page.getByText('El tipo no se puede cambiar tras crear el anuncio.')).toBeVisible();
    await page.locator('#title').fill(TITLE);
    await page.locator('#description').fill('Descripción de prueba R5 flujo B (herencia).');
    await page.locator('#condition').click();
    await page.getByRole('option', { name: 'Buen estado' }).click();
    await page.locator('#price').fill('200');
    await page.getByRole('button', { name: 'Siguiente' }).click();

    await expect(page.getByRole('heading', { name: 'Atributos' })).toBeVisible();
    await page.locator('#attr-acabadoP').fill('Mate');
    await page.getByRole('button', { name: 'Siguiente' }).click();

    await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
    await page.locator('#city').fill('Madrid');
    await page.locator('#province').fill('Madrid');
    await page.getByRole('button', { name: 'Revisar' }).click();

    await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
    await page.getByRole('button', { name: 'Publicar ahora' }).click();
    await page.waitForURL('**/anuncio/**', { timeout: 20_000 });

    await expect(page.locator('h1')).toContainText(TITLE);
    await expect(page.getByText('Estado:')).toBeVisible();
    await expect(page.locator('dt').filter({ hasText: 'Acabado' })).toBeVisible();
    await expect(page.locator('dd').filter({ hasText: 'Mate' })).toBeVisible();
  });

  // ── C ────────────────────────────────────────────────────────────────────

  test('C. BOTH con transición de tipo Y de categoría: el resultado final no arrastra residuo del estado intermedio', async ({ proContext }) => {
    const page = await proContext.newPage();
    const TITLE = `R5 Flujo C ${Date.now()}`;

    await page.goto('/publicar');
    await expect(page.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible();
    await page.getByRole('button', { name: bothA.name, exact: true }).click();

    await uploadPhotoAndAdvance(page);

    await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
    await page.getByLabel('Servicio').click();
    await page.locator('#title').fill(TITLE);
    await page.locator('#description').fill('Descripción de prueba R5 flujo C (transiciones).');
    await page.locator('#price').fill('80');
    await page.getByRole('button', { name: 'Siguiente' }).click();

    await expect(page.getByRole('heading', { name: 'Atributos' })).toBeVisible();
    await expect(page.locator('#attr-soloProductoA')).not.toBeVisible();
    await page.locator('#attr-comunA').fill('valor comun A');
    await page.locator('#attr-soloServicioA').fill('valor servicio A');

    // Retrocede hasta el selector de categoría: atributos → datos → fotos → categoría.
    await page.getByRole('button', { name: 'Anterior' }).click();
    await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
    await page.getByRole('button', { name: 'Anterior' }).click();
    await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible();
    await page.getByRole('button', { name: 'Anterior' }).click();
    await expect(page.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible();

    // Cambia a la categoría HERMANA (también BOTH) — resetea attributes en memoria.
    await page.getByRole('button', { name: bothB.name, exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Fotos' })).toBeVisible({ timeout: 8_000 });
    await page.getByRole('button', { name: 'Siguiente' }).click(); // la foto ya estaba subida

    await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
    // El tipo se conservó (SERVICE — política BOTH no lo resetea al cambiar de categoría);
    // ahora se cambia explícitamente a PRODUCT.
    await page.getByLabel('Producto').click();
    await page.locator('#condition').click();
    await page.getByRole('option', { name: 'Buen estado' }).click();
    await page.getByRole('button', { name: 'Siguiente' }).click();

    await expect(page.getByRole('heading', { name: 'Atributos' })).toBeVisible();
    await expect(page.locator('#attr-soloServicioB')).not.toBeVisible();
    await page.locator('#attr-comunB').fill('valor comun B');
    await page.locator('#attr-soloProductoB').fill('valor producto B');
    await page.getByRole('button', { name: 'Siguiente' }).click();

    await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
    await page.locator('#city').fill('Madrid');
    await page.locator('#province').fill('Madrid');
    await page.getByRole('button', { name: 'Revisar' }).click();

    await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
    await page.getByRole('button', { name: 'Publicar ahora' }).click();
    await page.waitForURL('**/anuncio/**', { timeout: 20_000 });

    // ASERCIÓN DOBLE — (1) el estado final refleja PRODUCT con los atributos de catB.
    await expect(page.locator('h1')).toContainText(TITLE);
    await expect(page.getByText('Estado:')).toBeVisible();
    await expect(page.locator('dt').filter({ hasText: 'Común B' })).toBeVisible();
    await expect(page.locator('dd').filter({ hasText: 'valor comun B' })).toBeVisible();
    await expect(page.locator('dt').filter({ hasText: 'Solo Producto B' })).toBeVisible();
    await expect(page.locator('dd').filter({ hasText: 'valor producto B' })).toBeVisible();

    // (2) NINGÚN residuo de catA ni del campo solo-servicio de catB.
    await expect(page.getByText('Común A')).not.toBeVisible();
    await expect(page.getByText('valor comun A')).not.toBeVisible();
    await expect(page.getByText('Solo Servicio A')).not.toBeVisible();
    await expect(page.getByText('valor servicio A')).not.toBeVisible();
    await expect(page.getByText('Solo Servicio B')).not.toBeVisible();
  });

  // ── E ────────────────────────────────────────────────────────────────────

  test('E. BOTH con select vinculado appliesTo=[PRODUCT]: invisible en SERVICE; reactivo (deshabilitado→opciones correctas) en PRODUCT', async ({ proContext }) => {
    const page = await proContext.newPage();
    const TITLE = `R5 Flujo E ${Date.now()}`;

    await page.goto('/publicar');
    await expect(page.getByRole('heading', { name: 'Elige una categoría' })).toBeVisible();
    await page.getByRole('button', { name: linkedCat.name, exact: true }).click();

    await uploadPhotoAndAdvance(page);

    await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
    await page.getByLabel('Servicio').click();
    await page.locator('#title').fill(TITLE);
    await page.locator('#description').fill('Descripción de prueba R5 flujo E (select vinculado + appliesTo).');
    await page.locator('#price').fill('9000');
    await page.getByRole('button', { name: 'Siguiente' }).click();

    // SERVICE: ni Cambio ni Combustible aparecen (ambos appliesTo=[PRODUCT]) —
    // el schema filtrado queda vacío, por lo que StepAtributos ni siquiera
    // renderiza su <h2> "Atributos" (solo lo hace con schema.length > 0).
    await expect(page.getByText('Esta categoría no requiere atributos adicionales.')).toBeVisible();
    await expect(page.getByLabel('Cambio')).not.toBeVisible();
    await expect(page.getByLabel('Combustible')).not.toBeVisible();

    await page.getByRole('button', { name: 'Anterior' }).click();
    await expect(page.getByRole('heading', { name: 'Datos del anuncio' })).toBeVisible();
    await page.getByLabel('Producto').click();
    await page.locator('#condition').click();
    await page.getByRole('option', { name: 'Buen estado' }).click();
    await page.getByRole('button', { name: 'Siguiente' }).click();

    // PRODUCT: ambos aparecen. Combustible deshabilitado hasta elegir Cambio.
    await expect(page.getByRole('heading', { name: 'Atributos' })).toBeVisible();
    await expect(page.getByLabel('Cambio')).toBeVisible();
    await expect(page.getByLabel('Combustible')).toBeDisabled();

    await page.getByLabel('Cambio').click();
    await page.getByRole('option', { name: 'Manual' }).click();
    await expect(page.getByLabel('Combustible')).toBeEnabled();
    await page.getByLabel('Combustible').click();
    await expect(page.getByRole('option', { name: 'Gasolina' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Diesel' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Hibrido' })).not.toBeVisible();
    await page.getByRole('option', { name: 'Gasolina' }).click();

    await page.getByRole('button', { name: 'Siguiente' }).click();
    await expect(page.getByRole('heading', { name: 'Ubicación' })).toBeVisible();
    await page.locator('#city').fill('Madrid');
    await page.locator('#province').fill('Madrid');
    await page.getByRole('button', { name: 'Revisar' }).click();

    await expect(page.getByRole('heading', { name: 'Previsualización' })).toBeVisible();
    await page.getByRole('button', { name: 'Publicar ahora' }).click();
    await page.waitForURL('**/anuncio/**', { timeout: 20_000 });

    await expect(page.locator('h1')).toContainText(TITLE);
    await expect(page.locator('dt').filter({ hasText: 'Cambio' })).toBeVisible();
    await expect(page.locator('dd').filter({ hasText: 'Manual' })).toBeVisible();
    await expect(page.locator('dt').filter({ hasText: 'Combustible' })).toBeVisible();
    await expect(page.locator('dd').filter({ hasText: 'Gasolina' })).toBeVisible();
  });

  // ── F ────────────────────────────────────────────────────────────────────
  // Autocontenido (no depende de E): publica sus propios anuncios crudos vía
  // API en SU PROPIA categoría vinculada (linkedCatF, no la de E) — si
  // compartiera categoría con E, el PRODUCT que publica E ahí también
  // contaría en las facetas y F dejaría de ser diagnosticable de forma
  // independiente.

  test('F. Facetas por tipo (R4) + select vinculado + Meilisearch juntos', async ({ request }) => {
    const ts = Date.now();

    async function createAndPublish(type: 'PRODUCT' | 'SERVICE', attributes: Record<string, unknown>) {
      const createRes = await authedPost(request, '/listings', adminToken, {
        title: `R5 Flujo F ${type} ${ts}`,
        description: 'Descripción de prueba R5 flujo F (facetas + vínculos).',
        price: 100,
        type,
        ...(type === 'PRODUCT' ? { condition: 'GOOD' } : {}),
        priceType: 'FIXED',
        categoryId: linkedCatF.id,
        attributes,
        city: 'Madrid',
        province: 'Madrid',
      });
      expect(createRes.status()).toBe(201);
      const { id } = await createRes.json();

      const publishRes = await authedPost(request, `/listings/${id}/publish`, adminToken, {});
      expect(publishRes.status()).toBe(200);
      return id as string;
    }

    await createAndPublish('SERVICE', {});
    await createAndPublish('PRODUCT', { gearbox: 'Manual', fuel: 'Gasolina' });

    const serviceView = await pollSearch(
      request,
      { category: linkedCatF.slug, type: 'SERVICE' },
      (body) => body.hits.length > 0,
    );
    const gearboxFacetService = serviceView.facets?.gearbox;
    const fuelFacetService = serviceView.facets?.fuel;
    expect(gearboxFacetService === undefined || Object.keys(gearboxFacetService).length === 0).toBe(true);
    expect(fuelFacetService === undefined || Object.keys(fuelFacetService).length === 0).toBe(true);

    const productView = await pollSearch(
      request,
      { category: linkedCatF.slug, type: 'PRODUCT' },
      (body) => Boolean(body.facets?.fuel && Object.keys(body.facets.fuel).length > 0),
    );
    expect(productView.facets?.fuel).toEqual({ Gasolina: 1 });
    expect(productView.facets?.gearbox).toEqual({ Manual: 1 });
  });
});
