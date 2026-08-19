// FICHA F2 (P6) — LOS FILTROS DEL BACKOFFICE, EJERCIDOS POR EL NAVEGADOR.
//
// El backend está cubierto por `ficha-filtros.e2e-spec.ts` (32 casos). Aquí se
// comprueba lo que sólo se ve en la pantalla: que los controles mandan lo que
// dicen mandar, que se COMBINAN, que la URL guarda la búsqueda —el motivo entero
// de meter los filtros ahí— y que se llega al filtro de vendedor desde la ficha.
//
// LA BARRERA, en su versión de navegador: el moderador elige la categoría ABUELA
// en el selector y ve el anuncio que cuelga de la NIETA.

import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken, authedGet, authedPost, authedPatch } from './helpers/api';

async function crearAnuncio(
  request: APIRequestContext,
  opts: {
    titulo: string;
    categoryId: string;
    status?: string;
    /** Las categorías con `attributeSchema` requerido los exigen al crear (422). */
    attributes?: Record<string, unknown>;
  },
): Promise<{ id: string; slug: string }> {
  const admin = adminApiToken();
  const res = await authedPost(request, '/listings', admin, {
    title: opts.titulo,
    description: `Anuncio de prueba de filtros: ${opts.titulo}`,
    price: 33,
    type: 'PRODUCT',
    priceType: 'FIXED',
    condition: 'GOOD',
    categoryId: opts.categoryId,
    city: 'Madrid',
    province: 'Madrid',
    latitude: 40.4168,
    longitude: -3.7038,
    ...(opts.attributes && { attributes: opts.attributes }),
  });
  if (!res.ok()) throw new Error(`[f2] crear falló: ${res.status()} ${await res.text()}`);
  const listing = (await res.json()) as { id: string; slug: string };

  if (opts.status && opts.status !== 'DRAFT') {
    const r = await authedPatch(request, `/admin/listings/${listing.id}/status`, admin, {
      status: opts.status,
    });
    if (!r.ok()) throw new Error(`[f2] estado falló: ${r.status()} ${await r.text()}`);
  }
  return listing;
}

/**
 * Dos raíces del catálogo sembrado (electronica → moviles, vehiculos → coches).
 * La SEGUNDA raíz existe para el control: sin ella, un test que filtra por la
 * primera pasaría igual aunque el filtro no se hubiese aplicado.
 */
async function categorias(request: APIRequestContext) {
  const cats = (await (await authedGet(request, '/categories')).json()) as {
    id: string;
    name: string;
    children?: { id: string; name: string }[];
  }[];
  const raiz = cats[0];
  const hija = raiz.children?.[0];
  const otraRaiz = cats[1];
  if (!hija || !otraRaiz) {
    throw new Error('[f2] el catálogo sembrado no tiene dos raíces y una hija con las que probar');
  }
  return { raizId: raiz.id, hijaId: hija.id, otraRaizId: otraRaiz.id };
}

async function abrirLista(page: Page, qs = ''): Promise<void> {
  await page.goto(`/admin/anuncios${qs}`);
  await page.waitForLoadState('networkidle');
}

/**
 * Ejecuta una acción de filtrado y ESPERA A LA RESPUESTA que provoca.
 *
 * POR QUÉ NO VALE `waitForLoadState('networkidle')`, y esto se descubrió con una
 * mutación: los filtros navegan (`router.push`) y la lista se recarga con un
 * `fetch` del cliente. `networkidle` puede volver ANTES de que esa petición
 * termine, así que la aserción corre contra el render ANTERIOR — y con el filtro
 * a medio aplicar los anuncios de la consulta previa siguen en pantalla. Un test
 * escrito así pasa por el motivo equivocado: comprobado, sobrevivía a una
 * mutación que rompía la selección múltiple.
 *
 * Molde: el arreglo del flake de `nav-admin.spec.ts`, que es el mismo defecto —
 * afirmar sobre una pintura optimista antes de que la petición aterrice.
 */
async function filtrarYEsperar(page: Page, accion: () => Promise<unknown>): Promise<void> {
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/admin/listings') && !/\/admin\/listings\//.test(r.url()),
      { timeout: 20_000 },
    ),
    accion(),
  ]);
}

test.describe('F2 — filtros y ordenación de /admin/anuncios', () => {
  test('LA BARRERA: filtrar por la categoría PADRE encuentra el anuncio de la HIJA', async ({
    moderatorContext,
    request,
  }) => {
    const { raizId, hijaId, otraRaizId } = await categorias(request);
    const ts = Date.now();
    const enLaHija = await crearAnuncio(request, {
      titulo: `F2 nav hija ${ts}`,
      categoryId: hijaId,
    });
    // EL CONTROL, y no es adorno: sin un anuncio de OTRA rama, este test pasaría
    // igual si el filtro no se hubiese aplicado en absoluto — la lista sin
    // filtrar también contiene al de la hija.
    const enOtraRama = await crearAnuncio(request, {
      titulo: `F2 nav otra rama ${ts}`,
      categoryId: otraRaizId,
      // La segunda raíz sembrada (vehículos) exige `year` y `km`; sin ellos la
      // creación responde 422. Es una particularidad de la semilla, no del filtro.
      attributes: { year: 2020, km: 90000 },
    });

    const page = await moderatorContext.newPage();
    await abrirLista(page);
    await expect(page.getByTestId(`anuncio-enlace-${enOtraRama.id}`)).toBeVisible();

    // Elegir el PADRE en el selector...
    await filtrarYEsperar(page, () =>
      page.getByTestId('filtro-categoria').selectOption(raizId),
    );

    // ...y aparece el anuncio que cuelga de la HIJA. Con un filtro exacto la
    // lista saldría vacía y el moderador leería «esta rama no tiene nada».
    await expect(page.getByTestId(`anuncio-enlace-${enLaHija.id}`)).toBeVisible();
    // Y el de la otra rama YA NO está: el filtro se ha aplicado de verdad.
    await expect(page.getByTestId(`anuncio-enlace-${enOtraRama.id}`)).toHaveCount(0);
  });

  test('texto libre encuentra un DRAFT — lo que /busqueda no puede ver', async ({
    moderatorContext,
    request,
  }) => {
    // Meilisearch indexa sólo ACTIVE. Que esto funcione es la prueba, desde la
    // pantalla, de que los filtros van a Postgres.
    const { hijaId } = await categorias(request);
    const ts = Date.now();
    const borrador = await crearAnuncio(request, {
      titulo: `F2 borradorunico ${ts}`,
      categoryId: hijaId,
      status: 'DRAFT',
    });

    const page = await moderatorContext.newPage();
    await abrirLista(page);

    await page.getByTestId('filtro-texto').fill(`borradorunico ${ts}`);
    await filtrarYEsperar(page, () => page.getByTestId('filtro-buscar').click());

    await expect(page.getByTestId(`anuncio-enlace-${borrador.id}`)).toBeVisible();
    await expect(page.getByTestId('filtros-total')).toContainText('1 resultado');
  });

  test('los estados son MÚLTIPLES y se combinan con el texto', async ({
    moderatorContext,
    request,
  }) => {
    const { hijaId } = await categorias(request);
    const ts = Date.now();
    const marca = `F2combi${ts}`;
    const borrador = await crearAnuncio(request, {
      titulo: `${marca} borrador`,
      categoryId: hijaId,
      status: 'DRAFT',
    });
    const pendiente = await crearAnuncio(request, {
      titulo: `${marca} pendiente`,
      categoryId: hijaId,
      status: 'PENDING_REVIEW',
    });
    const activo = await crearAnuncio(request, {
      titulo: `${marca} activo`,
      categoryId: hijaId,
      status: 'ACTIVE',
    });

    const page = await moderatorContext.newPage();
    await abrirLista(page);

    await page.getByTestId('filtro-texto').fill(marca);
    await filtrarYEsperar(page, () => page.getByTestId('filtro-buscar').click());

    // Dos estados marcados a la vez — la pregunta que con un filtro único
    // obligaba a mirar la lista dos veces sin poder compararlas.
    await filtrarYEsperar(page, () => page.getByTestId('filtro-estado-DRAFT').click());
    await filtrarYEsperar(page, () =>
      page.getByTestId('filtro-estado-PENDING_REVIEW').click(),
    );

    // Los DOS chips quedan marcados: es la afirmación que distingue «múltiple»
    // de «único», y no depende de qué anuncios haya pintados.
    await expect(page.getByTestId('filtro-estado-DRAFT')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByTestId('filtro-estado-PENDING_REVIEW')).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await expect(page.getByTestId(`anuncio-enlace-${borrador.id}`)).toBeVisible();
    await expect(page.getByTestId(`anuncio-enlace-${pendiente.id}`)).toBeVisible();
    await expect(page.getByTestId(`anuncio-enlace-${activo.id}`)).toHaveCount(0);
  });

  test('la búsqueda vive en la URL: se comparte y sobrevive a una recarga', async ({
    moderatorContext,
    request,
  }) => {
    // El motivo entero de meter los filtros en la URL. Antes, volver atrás desde
    // una ficha devolvía a la lista en blanco.
    const { hijaId } = await categorias(request);
    const ts = Date.now();
    const borrador = await crearAnuncio(request, {
      titulo: `F2 urlvive ${ts}`,
      categoryId: hijaId,
      status: 'DRAFT',
    });

    const page = await moderatorContext.newPage();
    await abrirLista(page);
    await page.getByTestId('filtro-texto').fill(`urlvive ${ts}`);
    await filtrarYEsperar(page, () => page.getByTestId('filtro-buscar').click());

    await expect(page).toHaveURL(/[?&]q=/);
    const compartida = page.url();

    // Otra pestaña abre la misma URL y ve lo mismo, sin tocar un solo control.
    const otra = await moderatorContext.newPage();
    await otra.goto(compartida);
    await otra.waitForLoadState('networkidle');
    await expect(otra.getByTestId(`anuncio-enlace-${borrador.id}`)).toBeVisible();

    // Y «Limpiar» devuelve la URL limpia de entrada.
    await filtrarYEsperar(page, () => page.getByTestId('filtros-limpiar').click());
    await expect(page).toHaveURL(/\/admin\/anuncios$/);
  });

  test('desde la ficha, «ver todos sus anuncios» filtra por ese vendedor', async ({
    moderatorContext,
    request,
  }) => {
    // El filtro por vendedor existía en el backend desde siempre y NO había
    // forma de invocarlo. Ahora es un enlace, porque los filtros son URL.
    const { hijaId } = await categorias(request);
    const ts = Date.now();
    const anuncio = await crearAnuncio(request, {
      titulo: `F2 delvendedor ${ts}`,
      categoryId: hijaId,
      status: 'ACTIVE',
    });

    const page = await moderatorContext.newPage();
    await page.goto(`/admin/anuncios/${anuncio.id}`);
    await page.getByTestId('ficha-ver-anuncios-vendedor').click();

    await page.waitForURL(/\/admin\/anuncios\?sellerId=/);

    await expect(page.getByTestId('filtro-vendedor-activo')).toBeVisible();
    await expect(page.getByTestId(`anuncio-enlace-${anuncio.id}`)).toBeVisible();
  });

  test('la cola de moderación (M3) sigue funcionando igual', async ({
    moderatorContext,
    request,
  }) => {
    // REQUISITO DE ORO: `/admin/moderacion` llama al MISMO endpoint con
    // `status=PENDING_REVIEW&order=oldest`. F2 añade ejes al lado, sin tocar
    // esos dos — y esto es lo que lo comprueba desde fuera.
    const { hijaId } = await categorias(request);
    const ts = Date.now();
    const pendiente = await crearAnuncio(request, {
      titulo: `F2 cola intacta ${ts}`,
      categoryId: hijaId,
      status: 'PENDING_REVIEW',
    });

    const page = await moderatorContext.newPage();
    await page.goto('/admin/moderacion');
    await page.waitForLoadState('networkidle');

    await expect(page.getByTestId(`cola-item-${pendiente.id}`)).toBeVisible();
  });
});
