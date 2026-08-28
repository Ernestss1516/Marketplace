// H8 Bloque D fase 4 — Playwright E2E: banners de difusión + enlaces compartibles.
//
// Backend (CRUD admin, getActiveBanners por placement, 403 moderator, AuditLog)
// ya cubierto en h8-d4-banners.e2e-spec.ts (Jest). Aquí solo lo verificable
// end-to-end: el admin crea banners y aparecen/desaparecen en la web según
// ubicación/estado, el descarte persiste, y el botón compartir funciona.

import type { APIRequestContext } from '@playwright/test';
import { request as apiRequest } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken, authedGet, authedPatch, authedPost } from './helpers/api';

/**
 * Los valores del enum, no sus etiquetas. Antes este helper llevaba un mapa
 * `'Home' → 'banner-placement-HOME'` que era una copia más de las etiquetas; con
 * catorce ubicaciones esa copia es justo lo que la ráfaga B1 vino a eliminar, así
 * que aquí se nombra la ubicación por su valor, que ES el `data-testid`.
 */
type Placement =
  | 'HOME' | 'BUSQUEDA' | 'CATEGORIA' | 'ANUNCIO' | 'BLOG' | 'VENDEDOR' | 'PLANES' | 'CONTACTO'
  | 'MIS_ANUNCIOS' | 'PERFIL' | 'PERFIL_FACTURACION' | 'PERFIL_SUSCRIPCION'
  | 'MIS_ALERTAS' | 'MIS_CREDITOS';

/** Las ocho superficies públicas que entrega B1. Las de cuenta van en B2. */
const PUBLICAS: Placement[] = [
  'HOME', 'BUSQUEDA', 'CATEGORIA', 'ANUNCIO', 'BLOG', 'VENDEDOR', 'PLANES', 'CONTACTO',
];

function uniqueTitle(prefix: string) {
  return `${prefix} ${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

/**
 * APAGA LO QUE ESTE SPEC ENCIENDE, y desde B1 no es cortesía sino requisito.
 *
 * Un banner vive treinta días y la batería comparte UNA base
 * (`workers: 1`, `fullyParallel: false`): mientras el placement era HOME, lo que
 * se filtraba a los specs siguientes era un aviso en la portada y nadie lo
 * notaba. Con las ocho ubicaciones públicas, estos banners se pintarían en la
 * búsqueda, la categoría, la ficha, el blog, los planes, el vendedor y el
 * contacto durante el resto de la batería — desplazando la maquetación que otros
 * specs miden.
 *
 * No hay DELETE de banners (decisión del modelo: solo se desactivan), así que se
 * desactivan. El filtro por título es el mismo prefijo con el que los crea este
 * fichero, y todos salen de aquí.
 */
test.afterAll(async () => {
  const ctx = await apiRequest.newContext();
  try {
    const admin = adminApiToken();
    const res = await authedGet(ctx, '/admin/banners?active=true&perPage=100', admin);
    if (!res.ok()) return;
    const { items } = (await res.json()) as { items: { id: string; title: string }[] };
    for (const banner of items.filter((b) => b.title.startsWith('E2E '))) {
      await authedPatch(ctx, `/admin/banners/${banner.id}`, admin, { active: false });
    }
  } finally {
    await ctx.dispose();
  }
});

/**
 * Crea un banner vigente hablando directo con el API. Para las pruebas de
 * RENDERIZADO (barrera 4) no hace falta pasar por el diálogo: lo que se está
 * comprobando es que cada página pinta lo que le toca, no el formulario — que
 * tiene su propia prueba más abajo, esa sí por la UI.
 */
async function createBannerViaApi(
  request: APIRequestContext,
  opts: { title: string; text: string; placements: Placement[] },
) {
  const now = Date.now();
  const res = await authedPost(request, '/admin/banners', adminApiToken(), {
    title: opts.title,
    text: opts.text,
    placements: opts.placements,
    startsAt: new Date(now - 60_000).toISOString(),
    endsAt: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (!res.ok()) {
    throw new Error(`[banners] crear falló: ${res.status()} ${await res.text()}`);
  }
}

async function createBanner(
  page: import('@playwright/test').Page,
  opts: {
    title: string;
    text: string;
    placements: Placement[];
    linkUrl?: string;
    linkText?: string;
    variant?: 'Info' | 'Promo' | 'Aviso';
    shareable?: boolean;
  },
) {
  await page.goto('/admin/banners');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Nuevo banner' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.locator('#banner-title').fill(opts.title);
  await page.locator('#banner-text').fill(opts.text);
  if (opts.linkUrl) await page.locator('#banner-link-url').fill(opts.linkUrl);
  if (opts.linkText) await page.locator('#banner-link-text').fill(opts.linkText);
  for (const placement of opts.placements) {
    await page.getByTestId(`banner-placement-${placement}`).click();
  }
  if (opts.variant) {
    await page.locator('#banner-variant').click();
    await page.getByRole('option', { name: opts.variant }).click();
  }
  if (opts.shareable) {
    await page.getByTestId('banner-shareable').click();
  }

  const now = new Date();
  const later = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  const toLocal = (d: Date) => d.toISOString().slice(0, 16);
  await page.locator('#banner-starts-at').fill(toLocal(new Date(now.getTime() - 60_000)));
  await page.locator('#banner-ends-at').fill(toLocal(later));

  await page.getByRole('button', { name: 'Crear banner' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 });
}

test.describe('Admin — gestión de banners', () => {
  test('crea un banner y lo ve en el listado con sus ubicaciones', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    const title = uniqueTitle('E2E Banner');

    await createBanner(page, {
      title,
      text: 'Texto de prueba del banner',
      placements: ['HOME', 'MIS_ANUNCIOS'],
    });

    const row = page.locator('tr').filter({ hasText: title });
    await expect(row).toBeVisible();
    // «Portada», no «Home»: al consolidar las etiquetas en una sola fuente se
    // adoptó el nombre que ya usaba el selector de /admin/nav para esta misma
    // página. Dos pantallas del backoffice la llamaban distinto.
    await expect(row).toContainText('Portada');
    await expect(row).toContainText('Mis anuncios');
    await expect(row).toContainText('Vigente');
  });

  test('desactivar un banner desde el listado lo quita de la web', async ({ adminContext }) => {
    const adminPage = await adminContext.newPage();
    const title = uniqueTitle('E2E Deactivate');

    await createBanner(adminPage, {
      title,
      text: 'Se desactiva y desaparece',
      placements: ['HOME'],
    });

    const homePage = await adminContext.newPage();
    await homePage.goto('/');
    await expect(homePage.getByText(title)).toBeVisible({ timeout: 10_000 });

    const row = adminPage.locator('tr').filter({ hasText: title });
    await row.getByRole('button', { name: 'Desactivar' }).click();
    await expect(row.getByText('Inactivo')).toBeVisible({ timeout: 10_000 });

    await homePage.reload();
    await expect(homePage.getByText(title)).not.toBeVisible();
  });

  // ── Ampliación de ubicaciones (B1) — BARRERA 3: el selector ────────────────

  test('el selector ofrece las catorce ubicaciones, agrupadas, y guarda de los dos grupos', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    const title = uniqueTitle('E2E Catorce');

    await page.goto('/admin/banners');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Nuevo banner' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    // Las catorce están, una por valor del enum. Si alguien añade un valor y no
    // aparece aquí es que se le olvidó meterlo en PLACEMENT_GROUPS — que es lo
    // que el tipo derivado impide, y esto lo confirma de punta a punta.
    for (const p of [...PUBLICAS, 'MIS_ANUNCIOS', 'PERFIL', 'PERFIL_FACTURACION',
      'PERFIL_SUSCRIPCION', 'MIS_ALERTAS', 'MIS_CREDITOS'] as Placement[]) {
      await expect(dialog.getByTestId(`banner-placement-${p}`)).toBeVisible();
    }

    // Y los dos grupos se nombran: es la primera pregunta de quien crea un banner.
    await expect(dialog.getByText('Páginas públicas')).toBeVisible();
    await expect(dialog.getByText('Zona de cuenta')).toBeVisible();

    // El botón de guardar sigue ALCANZABLE con el selector a catorce — sin el
    // `max-h/overflow-y-auto` del diálogo, este clic caía fuera de la ventana.
    await page.locator('#banner-title').fill(title);
    await page.locator('#banner-text').fill('Una de cada grupo');
    await dialog.getByTestId('banner-placement-CONTACTO').click();
    await dialog.getByTestId('banner-placement-MIS_CREDITOS').click();

    const now = new Date();
    const toLocal = (d: Date) => d.toISOString().slice(0, 16);
    await page.locator('#banner-starts-at').fill(toLocal(new Date(now.getTime() - 60_000)));
    await page
      .locator('#banner-ends-at')
      .fill(toLocal(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)));

    await page.getByRole('button', { name: 'Crear banner' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    const row = page.locator('tr').filter({ hasText: title });
    await expect(row).toContainText('Contacto');
    await expect(row).toContainText('Mi saldo');
  });

  test('«Todas» marca el grupo entero y el listado resume en vez de enumerar', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    const title = uniqueTitle('E2E Grupo');

    await page.goto('/admin/banners');
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'Nuevo banner' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await page.locator('#banner-title').fill(title);
    await page.locator('#banner-text').fill('Aviso de servicio en toda la web pública');

    // Un aviso de servicio quiere las ocho públicas: ocho clics era la fricción
    // que hace que el aviso no se publique.
    await dialog.getByRole('button', { name: 'Todas' }).first().click();
    for (const p of PUBLICAS) {
      await expect(dialog.getByTestId(`banner-placement-${p}`)).toBeChecked();
    }

    const now = new Date();
    const toLocal = (d: Date) => d.toISOString().slice(0, 16);
    await page.locator('#banner-starts-at').fill(toLocal(new Date(now.getTime() - 60_000)));
    await page
      .locator('#banner-ends-at')
      .fill(toLocal(new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)));
    await page.getByRole('button', { name: 'Crear banner' }).click();
    await expect(dialog).not.toBeVisible({ timeout: 10_000 });

    // Ocho ubicaciones enumeradas eran ~110 caracteres que reventaban la celda.
    const row = page.locator('tr').filter({ hasText: title });
    await expect(row).toContainText('8 ubicaciones');
  });

  test('el filtro por ubicación acota el listado', async ({ adminContext, request }) => {
    const soloContacto = uniqueTitle('E2E FiltroContacto');
    const soloBlog = uniqueTitle('E2E FiltroBlog');
    await createBannerViaApi(request, {
      title: soloContacto,
      text: 'x',
      placements: ['CONTACTO'],
    });
    await createBannerViaApi(request, { title: soloBlog, text: 'x', placements: ['BLOG'] });

    const page = await adminContext.newPage();
    await page.goto('/admin/banners');
    await page.waitForLoadState('networkidle');

    // El API aceptaba este filtro desde el primer día; la UI nunca lo pintó.
    await page.getByTestId('banner-placement-filter').selectOption('CONTACTO');
    await expect(page.locator('tr').filter({ hasText: soloContacto })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('tr').filter({ hasText: soloBlog })).not.toBeVisible();
  });
});

test.describe('Banners en la web', () => {
  test('banner con ambos placements aparece en home y en mis-anuncios; con uno solo, aparece solo ahí', async ({
    adminContext,
    sellerContext,
  }) => {
    const adminPage = await adminContext.newPage();
    const bothTitle = uniqueTitle('E2E Both');
    const homeOnlyTitle = uniqueTitle('E2E HomeOnly');

    await createBanner(adminPage, {
      title: bothTitle,
      text: 'Aparece en ambas ubicaciones',
      placements: ['HOME', 'MIS_ANUNCIOS'],
    });
    await createBanner(adminPage, {
      title: homeOnlyTitle,
      text: 'Solo en home',
      placements: ['HOME'],
    });

    const homePage = await sellerContext.newPage();
    await homePage.goto('/');
    await expect(homePage.getByText(bothTitle)).toBeVisible({ timeout: 10_000 });
    await expect(homePage.getByText(homeOnlyTitle)).toBeVisible();

    const misAnunciosPage = await sellerContext.newPage();
    await misAnunciosPage.goto('/mis-anuncios');
    await expect(misAnunciosPage.getByText(bothTitle)).toBeVisible({ timeout: 10_000 });
    await expect(misAnunciosPage.getByText(homeOnlyTitle)).not.toBeVisible();
  });

  test('cerrar un banner (×) lo oculta y no reaparece tras recargar', async ({
    adminContext,
    buyerContext,
  }) => {
    const adminPage = await adminContext.newPage();
    const title = uniqueTitle('E2E Dismiss');

    await createBanner(adminPage, {
      title,
      text: 'Este banner se descarta',
      placements: ['HOME'],
    });

    const page = await buyerContext.newPage();
    await page.goto('/');
    const banner = page.locator('[data-testid="banner"]').filter({ hasText: title });
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await banner.getByTestId('banner-dismiss-button').click();
    await expect(banner).not.toBeVisible();

    await page.reload();
    await expect(page.locator('[data-testid="banner"]').filter({ hasText: title })).not.toBeVisible();
  });

  test('banner con enlace y compartible: el enlace navega y el botón compartir copia al portapapeles', { tag: '@2b' }, async ({
    adminContext,
    buyerContext,
  }) => {
    const adminPage = await adminContext.newPage();
    const title = uniqueTitle('E2E Share');

    await createBanner(adminPage, {
      title,
      text: 'Banner compartible con enlace',
      placements: ['HOME'],
      linkUrl: '/planes',
      linkText: 'Ver planes',
      variant: 'Promo',
      shareable: true,
    });

    await buyerContext.grantPermissions(['clipboard-read', 'clipboard-write']);
    const page = await buyerContext.newPage();
    // Fuerza la ruta de "escritorio" (portapapeles) de forma determinista,
    // sin depender de si el Chromium de CI expone navigator.share.
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, 'share', { value: undefined, configurable: true });
    });
    await page.goto('/');

    const banner = page.locator('[data-testid="banner"]').filter({ hasText: title });
    await expect(banner).toBeVisible({ timeout: 10_000 });

    await banner.getByRole('link', { name: 'Ver planes' }).click();
    await expect(page).toHaveURL(/\/planes/);

    await page.goBack();
    const bannerAgain = page.locator('[data-testid="banner"]').filter({ hasText: title });
    await bannerAgain.getByTestId('banner-share-button').click();
    await expect(bannerAgain.getByTestId('banner-share-button')).toContainText('Enlace copiado');

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('/planes');
  });
});

// ── Ampliación de ubicaciones (B1) — BARRERA 4: las ocho superficies públicas ──
//
// UN SOLO BANNER marcado en las ocho, y un recorrido. Ocho tests separados
// comprobarían ocho veces lo mismo y costarían ocho arranques de página en CI;
// lo que de verdad varía entre ellas es la FORMA (dos columnas, columna de
// lectura, ficha, formulario), y eso se cubre igual recorriéndolas.

test.describe('Ubicaciones públicas (B1)', () => {
  /** Un post publicado, para poder visitar /blog/[slug]. */
  async function postPublicado(request: APIRequestContext): Promise<string> {
    const admin = adminApiToken();
    const creado = await authedPost(request, '/admin/blog', admin, {
      title: uniqueTitle('E2E Banner Post'),
      excerpt: 'Post de apoyo para la barrera de banners.',
      // `id` es obligatorio en todo bloque (BlockDto) — molde de paginas.spec.ts:86.
      blocks: [{ id: 'b1', type: 'text', markdown: 'Contenido de prueba.' }],
    });
    if (!creado.ok()) {
      throw new Error(`[banners] crear post falló: ${creado.status()} ${await creado.text()}`);
    }
    const post = (await creado.json()) as { id: string; slug: string };
    const publicado = await authedPost(request, `/admin/blog/${post.id}/publish`, admin, {});
    if (!publicado.ok()) {
      throw new Error(`[banners] publicar post falló: ${publicado.status()}`);
    }
    return post.slug;
  }

  test('un banner en las ocho ubicaciones públicas se pinta en las ocho páginas', async ({
    request,
    buyerContext,
  }) => {
    const title = uniqueTitle('E2E Publicas');
    const soloBlog = uniqueTitle('E2E SoloBlog');
    await createBannerViaApi(request, {
      title,
      text: 'Aviso en toda la web pública',
      placements: PUBLICAS,
    });
    // El negativo importa tanto como el positivo: si TODO saliera en TODAS
    // partes, el filtro por ubicación no estaría haciendo nada.
    await createBannerViaApi(request, { title: soloBlog, text: 'Solo blog', placements: ['BLOG'] });

    const slugPost = await postPublicado(request);
    const page = await buyerContext.newPage();

    const rutas: { placement: Placement; url: string }[] = [
      { placement: 'HOME', url: '/' },
      { placement: 'BUSQUEDA', url: '/busqueda' },
      { placement: 'CATEGORIA', url: '/vehiculos/coches' },
      { placement: 'ANUNCIO', url: '/anuncio/listing-rf11-e2e' },
      { placement: 'BLOG', url: '/blog' },
      { placement: 'BLOG', url: `/blog/${slugPost}` },
      { placement: 'VENDEDOR', url: '/vendedor/vendedor-e2e' },
      { placement: 'PLANES', url: '/planes' },
      { placement: 'CONTACTO', url: '/contacto' },
    ];

    for (const { placement, url } of rutas) {
      await page.goto(url);
      await expect(
        page.locator('[data-testid="banner"]').filter({ hasText: title }),
        `el banner de ${placement} debería verse en ${url}`,
      ).toBeVisible({ timeout: 10_000 });

      if (url !== '/blog' && !url.startsWith('/blog/')) {
        await expect(
          page.locator('[data-testid="banner"]').filter({ hasText: soloBlog }),
          `el banner de solo-BLOG NO debería verse en ${url}`,
        ).not.toBeVisible();
      }
    }
  });

  test('en la ficha de anuncio el banner va ARRIBA, por delante del título', async ({
    request,
    buyerContext,
  }) => {
    const title = uniqueTitle('E2E FichaArriba');
    await createBannerViaApi(request, {
      title,
      text: 'Aviso de servicio en la ficha',
      placements: ['ANUNCIO'],
    });

    const page = await buyerContext.newPage();
    await page.goto('/anuncio/listing-rf11-e2e');

    const banner = page.locator('[data-testid="banner"]').filter({ hasText: title });
    await expect(banner).toBeVisible({ timeout: 10_000 });

    // «Arriba» dicho como se ve, no como se escribe: por encima del <h1> del
    // anuncio. Es la decisión de producto de esta página (§4.3, opción A1).
    const cajaBanner = await banner.boundingBox();
    const cajaTitulo = await page.locator('h1').first().boundingBox();
    expect(cajaBanner).not.toBeNull();
    expect(cajaTitulo).not.toBeNull();
    expect(cajaBanner!.y).toBeLessThan(cajaTitulo!.y);
  });

  test('en categoría el banner convive con la búsqueda: no dispara el fallback a Postgres', async ({
    request,
    buyerContext,
  }) => {
    const title = uniqueTitle('E2E CategoriaFallback');
    await createBannerViaApi(request, {
      title,
      text: 'Aviso en categoría',
      placements: ['CATEGORIA'],
    });

    const page = await buyerContext.newPage();
    await page.goto('/vehiculos/coches');

    await expect(
      page.locator('[data-testid="banner"]').filter({ hasText: title }),
    ).toBeVisible({ timeout: 10_000 });

    // El fetch del banner vive FUERA del try/catch de Meilisearch, así que no
    // puede degradar la búsqueda. Si alguien lo metiera dentro, un banner caído
    // pintaría este aviso y escondería el panel de filtros.
    await expect(
      page.getByText('Los filtros avanzados no están disponibles ahora mismo'),
    ).not.toBeVisible();
    await expect(page.locator('aside[aria-label="Filtros"]')).toBeVisible();
  });
});
