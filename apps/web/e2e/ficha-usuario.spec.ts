// FICHA DE USUARIO U3 (P2) — la ficha completa, por el navegador.
//
// El gate está probado por la API en `usuario-ficha-gate.e2e-spec.ts` (7), que es
// donde importa: el dato no sale del servidor. Aquí se comprueba la otra mitad —
// que la PANTALLA respeta el mismo reparto, que el «ver todo» se ve, que las
// acciones de U2 funcionan desde la ficha, y que el enlace de F1 lleva aquí.

import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken, authedGet, authedPost, loginViaApi } from './helpers/api';

/**
 * Un anuncio del VENDEDOR sembrado, y de paso SU id.
 *
 * El anuncio lo crea el vendedor, no el admin: la ficha que se mira es la suya y
 * un anuncio del administrador no aparecería en ella.
 *
 * Y el id del vendedor sale de la ficha de administración del anuncio, no de su
 * perfil público: `GET /users/:slug` **no expone el id** a propósito
 * (`findBySlug` lo saca del objeto antes de devolverlo). Pedirlo por ahí sería
 * pedirle a la API pública que filtrara identificadores internos.
 */
async function crearAnuncio(
  request: APIRequestContext,
  titulo: string,
): Promise<{ id: string; sellerId: string }> {
  const sellerToken = await loginViaApi(request, 'seller-e2e@example.com', 'Test1234!');
  const cats = (await (await authedGet(request, '/categories')).json()) as {
    id: string;
    children?: { id: string }[];
  }[];
  const raiz = cats[0];
  const res = await authedPost(request, '/listings', sellerToken, {
    title: titulo,
    description: 'Anuncio para la ficha de usuario.',
    price: 15,
    type: 'PRODUCT',
    priceType: 'FIXED',
    condition: 'GOOD',
    categoryId: raiz.children?.[0]?.id ?? raiz.id,
    city: 'Madrid',
    province: 'Madrid',
    latitude: 40.4168,
    longitude: -3.7038,
  });
  if (!res.ok()) throw new Error(`[u3] crear falló: ${res.status()} ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };

  const detalle = await authedGet(request, `/admin/listings/${id}`, adminApiToken());
  const { seller } = (await detalle.json()) as { seller: { id: string } };
  return { id, sellerId: seller.id };
}

/**
 * El id del vendedor sembrado. Lo usan los tests que sólo LEEN: no dejan rastro
 * y necesitan sus anuncios. Ver `crearAnuncio` para por qué se saca así.
 */
async function idDeSeller(request: APIRequestContext): Promise<string> {
  const { sellerId } = await crearAnuncio(request, `U3 base ${Date.now()}`);
  return sellerId;
}

/**
 * UN USUARIO RECIÉN CREADO, SÓLO PARA UN TEST — y no es una comodidad.
 *
 * Los tests que CONCEDEN Pro o mueven saldo NO pueden hacerlo sobre el vendedor
 * sembrado: es compartido, y otras suites lo dan por FREE y con el historial de
 * movimientos vacío. Hacerlo rompía cuatro tests de `h8-c2-listing-stats`,
 * `planes` y `pulido` — comprobado, no supuesto. Cada test que muta se trae su
 * propio usuario.
 */
async function usuarioNuevo(request: APIRequestContext): Promise<string> {
  const email = `u3-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const res = await request.post('http://localhost:3001/api/auth/register', {
    data: { name: 'U3 Aislado', email, password: 'Test1234!' },
  });
  if (!res.ok()) throw new Error(`[u3] registro falló: ${res.status()} ${await res.text()}`);

  // El id no viene en el registro; se busca por la lista de administración, que
  // filtra por texto sobre nombre y email.
  const lista = await authedGet(
    request,
    `/admin/users?q=${encodeURIComponent(email)}`,
    adminApiToken(),
  );
  const { items } = (await lista.json()) as { items: { id: string }[] };
  if (!items?.length) throw new Error(`[u3] no se encontró el usuario recién creado ${email}`);
  return items[0].id;
}

/** Espera a la respuesta que provoca una acción del bloque de dinero. */
async function accionYEsperar(page: Page, accion: () => Promise<unknown>): Promise<void> {
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/admin/billing/users/'), { timeout: 20_000 }),
    accion(),
  ]);
}

test.describe('P2/U3 — la ficha de usuario', () => {
  test('LA BARRERA: un MODERATOR ve la ficha pero NO el dinero — ni en el DOM ni por la API', async ({
    moderatorContext,
    request,
  }) => {
    const userId = await idDeSeller(request);

    const page = await moderatorContext.newPage();
    // Se vigila si el navegador llega a PEDIR el detalle de facturación: para un
    // moderador ese componente ni se monta, así que la petición no debe existir.
    const peticionesDeDinero: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/admin/billing/users/')) peticionesDeDinero.push(r.url());
    });

    await page.goto(`/admin/usuarios/${userId}`);
    await expect(page.getByTestId('ficha-usuario')).toBeVisible();

    // Ve al usuario y lo relacionado...
    await expect(page.getByTestId('usuario-email')).toBeVisible();
    await expect(page.getByTestId('usuario-anuncios')).toBeVisible();
    await expect(page.getByTestId('usuario-historial')).toBeVisible();

    // ...y NO el bloque de dinero.
    await expect(page.getByTestId('bloque-dinero')).toHaveCount(0);
    await expect(page.getByTestId('saldo-creditos')).toHaveCount(0);
    await expect(page.getByTestId('pro-conceder')).toHaveCount(0);

    // Y ni siquiera lo pidió.
    expect(peticionesDeDinero).toHaveLength(0);
  });

  test('un ADMIN sí ve el bloque de dinero y sus acciones', async ({ adminContext, request }) => {
    const userId = await idDeSeller(request);

    const page = await adminContext.newPage();
    await page.goto(`/admin/usuarios/${userId}`);

    await expect(page.getByTestId('bloque-dinero')).toBeVisible();
    await expect(page.getByTestId('saldo-creditos')).toBeVisible();
    await expect(page.getByTestId('saldo-bumps')).toBeVisible();
    await expect(page.getByTestId('pro-conceder')).toBeVisible();
    // REVOCAR NO APARECE sin un Pro manual que revocar. El backend rechaza
    // revocar el de un cliente de pago (U2); esto es que la ficha no ofrezca el
    // botón cuando no hay nada suyo que retirar.
    await expect(page.getByTestId('pro-revocar')).toHaveCount(0);
  });

  test('EL VER TODO: la ficha enseña lo relacionado, y el anuncio enlaza a SU ficha', async ({
    moderatorContext,
    request,
  }) => {
    const { id: anuncioId, sellerId: userId } = await crearAnuncio(
      request,
      `U3 anuncio ${Date.now()}`,
    );

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/usuarios/${userId}`);

    await expect(page.getByTestId('usuario-valoraciones-recibidas')).toBeVisible();
    await expect(page.getByTestId('usuario-reportes-hechos')).toBeVisible();
    await expect(page.getByTestId('usuario-tickets')).toBeVisible();

    // El círculo con F1: del usuario a la ficha de su anuncio.
    await page.getByTestId(`usuario-anuncio-${anuncioId}`).click();
    await page.waitForURL(`**/admin/anuncios/${anuncioId}`);
    await expect(page.getByTestId('ficha-anuncio')).toBeVisible();
  });

  test('y el enlace de la ficha de ANUNCIO lleva a la ficha del vendedor (F1 re-apuntado)', async ({
    moderatorContext,
    request,
  }) => {
    const { id: anuncioId } = await crearAnuncio(request, `U3 vuelta ${Date.now()}`);

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${anuncioId}`);
    await page.getByTestId('ficha-enlace-vendedor').click();

    // La ruta nueva, no la lista con parámetros.
    await page.waitForURL(/\/admin\/usuarios\/[^/?]+$/);
    await expect(page.getByTestId('ficha-usuario')).toBeVisible();
  });

  test('conceder Pro manual desde la ficha: aparece con su PROCEDENCIA y sin cuota', async ({
    adminContext,
    request,
  }) => {
    const userId = await usuarioNuevo(request);

    const page = await adminContext.newPage();
    await page.goto(`/admin/usuarios/${userId}`);
    await expect(page.getByTestId('bloque-dinero')).toBeVisible();

    // La fecha es obligatoria: sin ella el botón está deshabilitado.
    await expect(page.getByTestId('pro-conceder')).toBeDisabled();

    const dentroDeUnMes = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    await page.getByTestId('pro-conceder-hasta').fill(dentroDeUnMes);
    await page.getByTestId('pro-conceder-motivo').fill('Compensación por incidencia');
    await expect(page.getByTestId('pro-conceder')).toBeEnabled();

    await accionYEsperar(page, () => page.getByTestId('pro-conceder').click());

    // Se ve QUE es Pro y CÓMO lo es — y que no trae cuota mensual (D-1).
    await expect(page.getByTestId('pro-manual')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('pro-sin-cuota')).toBeVisible();
    // Y ahora sí aparece revocar, que antes no estaba.
    await expect(page.getByTestId('pro-revocar')).toBeVisible();
  });

  test('dar bumps desde la ficha sube el saldo', async ({ adminContext, request }) => {
    const userId = await usuarioNuevo(request);

    const page = await adminContext.newPage();
    await page.goto(`/admin/usuarios/${userId}`);
    await expect(page.getByTestId('saldo-bumps')).toBeVisible();
    const antes = Number((await page.getByTestId('saldo-bumps').textContent()) ?? '0');

    await page.getByTestId('bumps-dar-cantidad').fill('5');
    await page.getByTestId('bumps-dar-motivo').fill('Compensación de soporte');
    await accionYEsperar(page, () => page.getByTestId('bumps-dar-enviar').click());

    await expect(page.getByTestId('saldo-bumps')).toHaveText(String(antes + 5), {
      timeout: 20_000,
    });
  });

  test('quitar más saldo del que hay lo deja en cero, y la ficha lo DICE', async ({
    adminContext,
    request,
  }) => {
    const userId = await usuarioNuevo(request);

    const page = await adminContext.newPage();
    await page.goto(`/admin/usuarios/${userId}`);
    await expect(page.getByTestId('saldo-bumps')).toBeVisible();

    // Se pone saldo AQUÍ en vez de heredarlo del test anterior: si el saldo ya
    // fuera cero, el backend rechazaría el débito con un 400 y este test pasaría
    // a comprobar otra cosa sin avisar. Cada test se monta su estado.
    await page.getByTestId('bumps-dar-cantidad').fill('3');
    await page.getByTestId('bumps-dar-motivo').fill('Saldo de partida para el test');
    await accionYEsperar(page, () => page.getByTestId('bumps-dar-enviar').click());
    await expect(page.getByTestId('saldo-bumps')).not.toHaveText('0', { timeout: 20_000 });

    await page.getByTestId('bumps-quitar-cantidad').fill('9999');
    await page.getByTestId('bumps-quitar-motivo').fill('Corrección de una concesión');
    await accionYEsperar(page, () => page.getByTestId('bumps-quitar-enviar').click());

    await expect(page.getByTestId('saldo-bumps')).toHaveText('0', { timeout: 20_000 });
    // El suelo no se esconde: se dice cuánto se descontó de verdad.
    await expect(page.getByTestId('dinero-aviso')).toContainText('todo el saldo disponible');
  });
});
