// MENSAJERÍA C1 — las dos superficies de metadato en el backoffice.
//
// El backend está cubierto por `mensajeria-backoffice.e2e-spec.ts` (Jest): que
// listar NO marca como leído, que el cuerpo no sale, las dos caras del usuario,
// el snapshot del anuncio borrado, los permisos y la paginación.
//
// Aquí sólo lo que no se ve sin navegador: que las secciones existen donde deben,
// que la de usuario separa las dos caras, y que **no hay forma de abrir un hilo**
// — la mitad invasiva es C2 y desde esta pantalla no se llega a ella.

import type { APIRequestContext } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken, authedGet, authedPost, loginViaApi } from './helpers/api';

const API_BASE = 'http://localhost:3001';

/** Un anuncio ACTIVE del vendedor. */
async function crearAnuncio(request: APIRequestContext, titulo: string): Promise<string> {
  const sellerToken = await loginViaApi(request, 'seller-e2e@example.com', 'Test1234!');
  const cats = (await (await authedGet(request, '/categories')).json()) as {
    id: string;
    children?: { id: string }[];
  }[];
  const raiz = cats[0];
  const res = await authedPost(request, '/listings', sellerToken, {
    title: titulo,
    description: 'Anuncio de apoyo para el spec de mensajería.',
    price: 25,
    type: 'PRODUCT',
    priceType: 'FIXED',
    condition: 'GOOD',
    categoryId: raiz.children?.[0]?.id ?? raiz.id,
    city: 'Madrid',
    province: 'Madrid',
    latitude: 40.4168,
    longitude: -3.7038,
  });
  if (!res.ok()) throw new Error(`[msg] crear anuncio: ${res.status()} ${await res.text()}`);
  const listing = (await res.json()) as { id: string };

  const activar = await request.patch(`${API_BASE}/api/admin/listings/${listing.id}/status`, {
    headers: { Authorization: `Bearer ${adminApiToken()}` },
    data: { status: 'ACTIVE', reason: 'Alta para el spec de mensajería' },
  });
  if (!activar.ok()) throw new Error(`[msg] activar: ${activar.status()}`);
  return listing.id;
}

/** El comprador escribe al vendedor: eso crea la conversación. */
async function escribir(request: APIRequestContext, listingId: string, mensaje: string) {
  const buyerToken = await loginViaApi(request, 'buyer-e2e@example.com', 'Test1234!');
  const res = await authedPost(request, '/conversations', buyerToken, {
    listingId,
    message: mensaje,
  });
  if (!res.ok()) throw new Error(`[msg] conversación: ${res.status()} ${await res.text()}`);
  return (await res.json()) as { id: string };
}

test.describe('Mensajería en el backoffice — desde el anuncio', () => {
  test('la ficha enseña QUIÉN habló y cuándo, y NO ofrece abrir el hilo', async ({
    request,
    moderatorContext,
  }) => {
    const listingId = await crearAnuncio(request, `Con conversación ${Date.now()}`);
    await escribir(request, listingId, 'Hola, ¿sigue disponible? — contenido privado');

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${listingId}`);

    const panel = page.getByTestId('ficha-conversaciones');
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel.getByTestId('conversacion-fila')).toHaveCount(1);
    // Los dos interlocutores, enlazados a sus fichas de staff.
    await expect(panel.getByRole('link', { name: 'Comprador E2E' })).toHaveAttribute(
      'href',
      /\/admin\/usuarios\//,
    );
    await expect(panel).toContainText('1 mensaje');

    // LO QUE NO ESTÁ, y es el punto de C1: el contenido no se ve ni se puede abrir.
    await expect(page.getByText('contenido privado')).toHaveCount(0);
    await expect(panel).toContainText('El contenido de los mensajes no se abre desde aquí');
  });
});

test.describe('Mensajería en el backoffice — desde el usuario', () => {
  test('LA BARRERA: las dos caras salen SEPARADAS — como comprador y como vendedor', async ({
    request,
    moderatorContext,
  }) => {
    // El vendedor recibe un mensaje por SU anuncio…
    const suyo = await crearAnuncio(request, `Suyo ${Date.now()}`);
    await escribir(request, suyo, 'Pregunta sobre tu anuncio');

    const usuarios = (await (
      await authedGet(request, '/admin/users?q=seller-e2e', adminApiToken())
    ).json()) as { items: { id: string }[] };
    const vendedorId = usuarios.items[0].id;

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/usuarios/${vendedorId}`);

    // …así que aparece en «como vendedor»…
    const comoVendedor = page.getByTestId('usuario-conversaciones-vendedor');
    await expect(comoVendedor).toBeVisible({ timeout: 15_000 });
    await expect(comoVendedor.getByTestId('conversacion-fila').first()).toBeVisible();

    // …y la otra cara existe y está etiquetada, aunque esté vacía. Es lo que un
    // `where` de una sola cara incumple en silencio: sin las dos secciones, media
    // mensajería de la persona sería invisible sin que nada fallara.
    const comoComprador = page.getByTestId('usuario-conversaciones-comprador');
    await expect(comoComprador).toBeVisible();
    await expect(page.getByText('Conversaciones como comprador')).toBeVisible();
    await expect(page.getByText('Conversaciones como vendedor')).toBeVisible();
  });

  test('un hilo cuyo anuncio se borró sigue diciendo de qué iba, sin enlace muerto', async ({
    request,
    moderatorContext,
  }) => {
    const titulo = `Se borra ${Date.now()}`;
    const listingId = await crearAnuncio(request, titulo);
    await escribir(request, listingId, 'Mensaje sobre un anuncio que va a desaparecer');

    // Archivar y eliminar: es la única vía (el borrado exige ARCHIVED + ADMIN).
    await request.patch(`${API_BASE}/api/admin/listings/${listingId}/status`, {
      headers: { Authorization: `Bearer ${adminApiToken()}` },
      data: { status: 'ARCHIVED', reason: 'Para el spec' },
    });
    const borrado = await request.delete(`${API_BASE}/api/admin/listings/${listingId}`, {
      headers: { Authorization: `Bearer ${adminApiToken()}` },
    });
    if (!borrado.ok()) throw new Error(`[msg] borrar: ${borrado.status()}`);

    const usuarios = (await (
      await authedGet(request, '/admin/users?q=buyer-e2e', adminApiToken())
    ).json()) as { items: { id: string }[] };

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/usuarios/${usuarios.items[0].id}`);

    const panel = page.getByTestId('usuario-conversaciones-comprador');
    await expect(panel).toBeVisible({ timeout: 15_000 });

    // El `SetNull` conserva el hilo; el snapshot conserva de qué iba.
    const fantasma = panel.getByTestId('conversacion-anuncio-fantasma').filter({ hasText: titulo });
    await expect(fantasma).toBeVisible();
    // Y sin enlace muerto al anuncio que ya no está.
    await expect(panel.getByRole('link', { name: titulo })).toHaveCount(0);
  });
});
