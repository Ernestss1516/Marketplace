// MODERACIÓN M3 — LA COLA DEL MODERADOR, ejercida por la UI real.
//
// POR QUÉ ESTE SPEC EXISTE. Los endpoints de aprobar/rechazar ya están cubiertos
// por la batería de backend, así que el riesgo aquí NO es que la API falle: es
// que la PANTALLA llame a lo que no debe. Ése es exactamente el defecto que la
// auditoría encontró y que M2 cerró —el backoffice despachaba moderación con el
// cambio de estado genérico, saltándose el registro y los avisos— y es un defecto
// que ningún test unitario ve, porque el anuncio SÍ cambiaba de estado.
//
// El caso que más importa es el que NO es feliz: aprobar un anuncio que la puerta
// frena. La cola tiene que enseñar el motivo y dejar el anuncio donde estaba.

import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken, authedPost, authedGet, authedPatch } from './helpers/api';

const MIN_FOTOS_SETTING = 'minPhotosRuleEnabled';

/**
 * Crea un anuncio (sin fotos) y lo deja en PENDING_REVIEW.
 *
 * Se manda a la cola con la vía correctiva de administración —la máquina de
 * estados admite `DRAFT → PENDING_REVIEW`— en vez de encender la moderación
 * previa entera: este spec va de LA COLA, no del disparador. El disparador es M1
 * y tiene su propia suite de backend.
 */
async function crearPendiente(
  request: APIRequestContext,
  titulo: string,
): Promise<{ id: string; slug: string }> {
  const admin = adminApiToken();

  const cats = (await (await authedGet(request, '/categories')).json()) as {
    id: string;
    children?: { id: string }[];
  }[];
  const raiz = cats[0];
  const categoryId = raiz.children?.[0]?.id ?? raiz.id;

  const res = await authedPost(request, '/listings', admin, {
    title: titulo,
    description: 'Anuncio de la cola de moderación (e2e)',
    price: 10,
    type: 'PRODUCT',
    priceType: 'FIXED',
    condition: 'GOOD',
    categoryId,
    city: 'Madrid',
    province: 'Madrid',
    latitude: 40.4168,
    longitude: -3.7038,
  });
  if (!res.ok()) throw new Error(`[cola] crear falló: ${res.status()} ${await res.text()}`);
  const listing = (await res.json()) as { id: string; slug: string };

  const mandar = await authedPatch(request, `/admin/listings/${listing.id}/status`, admin, {
    status: 'PENDING_REVIEW',
  });
  if (!mandar.ok()) {
    throw new Error(`[cola] enviar a revisión falló: ${mandar.status()} ${await mandar.text()}`);
  }
  return listing;
}

async function estadoDe(request: APIRequestContext, id: string): Promise<string> {
  const res = await authedGet(request, `/admin/listings/${id}`, adminApiToken());
  const body = (await res.json()) as { status: string };
  return body.status;
}

async function fijarAjuste(
  request: APIRequestContext,
  key: string,
  value: unknown,
): Promise<void> {
  const res = await authedPatch(request, `/admin/settings/${key}`, adminApiToken(), { value });
  if (!res.ok()) throw new Error(`[cola] ajuste ${key} falló: ${res.status()}`);
}

/** Abre la cola y espera a que termine de cargar. */
async function abrirCola(page: Page): Promise<void> {
  await page.goto('/admin/moderacion');
  await page.waitForLoadState('networkidle');
}

test.describe('M3 — la cola del moderador', () => {
  test('despacha las tres salidas: aprobar, rechazar y devolver', async ({
    adminContext,
    request,
  }) => {
    const ts = Date.now();
    const aprobable = await crearPendiente(request, `Cola aprobar ${ts}`);
    const rechazable = await crearPendiente(request, `Cola rechazar ${ts}`);
    const devolvible = await crearPendiente(request, `Cola devolver ${ts}`);

    const page = await adminContext.newPage();
    await abrirCola(page);

    // Los tres están en la cola, que es donde se despacha el trabajo pendiente.
    await expect(page.getByTestId(`cola-item-${aprobable.id}`)).toBeVisible();
    await expect(page.getByTestId(`cola-item-${rechazable.id}`)).toBeVisible();
    await expect(page.getByTestId(`cola-item-${devolvible.id}`)).toBeVisible();

    // ── APROBAR: sale de la cola y queda publicado ──────────────────────────
    await page.getByTestId(`cola-aprobar-${aprobable.id}`).click();
    await expect(page.getByTestId(`cola-item-${aprobable.id}`)).toHaveCount(0, { timeout: 20_000 });
    expect(await estadoDe(request, aprobable.id)).toBe('ACTIVE');

    // ── RECHAZAR con motivo ─────────────────────────────────────────────────
    await page.getByTestId(`cola-motivo-${rechazable.id}`).fill('Las fotos no son del producto');
    await page.getByTestId(`cola-rechazar-${rechazable.id}`).click();
    await expect(page.getByTestId(`cola-item-${rechazable.id}`)).toHaveCount(0, { timeout: 20_000 });
    expect(await estadoDe(request, rechazable.id)).toBe('REJECTED');

    // ── DEVOLVER A BORRADOR: la tercera salida ──────────────────────────────
    await page.getByTestId(`cola-devolver-${devolvible.id}`).click();
    await expect(page.getByTestId(`cola-item-${devolvible.id}`)).toHaveCount(0, { timeout: 20_000 });
    expect(await estadoDe(request, devolvible.id)).toBe('DRAFT');

    // Y ninguno de los tres vuelve: la cola son los pendientes y sólo ellos.
    await abrirCola(page);
    for (const l of [aprobable, rechazable, devolvible]) {
      await expect(page.getByTestId(`cola-item-${l.id}`)).toHaveCount(0);
    }
  });

  test('APROBAR QUE NO PROCEDE: la cola enseña el motivo y el anuncio se queda', async ({
    adminContext,
    request,
  }) => {
    // EL CASO QUE CONECTA CON M2. Desde M2, aprobar comprueba las reglas del
    // ANUNCIO: un anuncio sin fotos no se puede aprobar con esa regla encendida.
    // Sin el manejo de este caso, el moderador pulsaría «Aprobar» y no pasaría
    // nada visible en la pantalla.
    const sinFotos = await crearPendiente(request, `Cola sin fotos ${Date.now()}`);

    await fijarAjuste(request, MIN_FOTOS_SETTING, true);
    try {
      const page = await adminContext.newPage();
      await abrirCola(page);

      await page.getByTestId(`cola-aprobar-${sinFotos.id}`).click();

      // El motivo, EN LA FILA, y con la salida que le queda al moderador.
      const bloqueo = page.getByTestId(`cola-bloqueo-${sinFotos.id}`);
      await expect(bloqueo).toBeVisible({ timeout: 20_000 });
      await expect(bloqueo).toContainText(/foto/i);
      await expect(bloqueo).toContainText(/sigue en la cola/i);

      // Y el anuncio NO se ha movido.
      await expect(page.getByTestId(`cola-item-${sinFotos.id}`)).toBeVisible();
      expect(await estadoDe(request, sinFotos.id)).toBe('PENDING_REVIEW');

      // La salida funciona: devolverlo al vendedor sí procede.
      await page.getByTestId(`cola-devolver-${sinFotos.id}`).click();
      await expect(page.getByTestId(`cola-item-${sinFotos.id}`)).toHaveCount(0, {
        timeout: 20_000,
      });
      expect(await estadoDe(request, sinFotos.id)).toBe('DRAFT');
    } finally {
      // El ajuste es GLOBAL y la batería lo comparte: se apaga pase lo que pase.
      await fijarAjuste(request, MIN_FOTOS_SETTING, false);
    }
  });

  test('un MODERATOR también entra en la cola', async ({ moderatorContext }) => {
    // La cola es trabajo de moderación, así que un MODERATOR la ve igual que un
    // ADMIN — mismo criterio que /admin/reportes.
    const page = await moderatorContext.newPage();
    await page.goto('/admin/moderacion');
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: 'Cola de revisión' })).toBeVisible();
  });

  test('un usuario sin rol NO entra', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/admin/moderacion');
    // El middleware saca de /admin a quien no tiene rol de backoffice.
    await page.waitForURL((url) => !url.pathname.startsWith('/admin/moderacion'), {
      timeout: 15_000,
    });
  });
});
