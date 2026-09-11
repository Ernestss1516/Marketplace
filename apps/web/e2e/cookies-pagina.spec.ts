// COOKIES RÁFAGA 3 — LA PÁGINA DE COOKIES, DE BORRADOR A PUBLICADA.
//
// Ver docs/diseno-consentimiento-cookies.md §5.
//
// Lo que sólo se puede comprobar aquí, con el sistema entero en pie:
//   · en BORRADOR la página no es pública, y el banner sigue con su detalle en línea —
//     nunca un 404 desde el aviso legal;
//   · PUBLICARLA es el único acto necesario: el «Más información» pasa a navegar a ella
//     sin que nadie toque un ajuste;
//   · el panel de preferencias de dentro cambia el consentimiento de verdad, y eso llega
//     al gate;
//   · y al publicarla entra en el sitemap sola.
//
// Parte SIN cookie de consentimiento: el fixture siembra una decisión para las specs que
// no van de cookies (ver fixtures/auth.ts), y aquí hace falta el estado de primera visita.

import { test, expect } from './fixtures/auth';
import { adminApiToken, authedPost } from './helpers/api';
import {
  PAGINA_COOKIES_BLOQUES,
  PAGINA_COOKIES_TITULO,
} from '../../api/prisma/seed-pagina-cookies';

/** La ruta real del ajuste: se restaura al final para no dejar la base tocada. */
const RUTA_AJUSTE = '/admin/cookies-config';

async function ponerPolicyUrl(request: Parameters<typeof authedPost>[0], url: string) {
  const res = await request.put(`http://localhost:3001/api${RUTA_AJUSTE}`, {
    headers: { Authorization: `Bearer ${adminApiToken()}` },
    data: { policyUrl: url },
  });
  expect(res.ok(), `no se pudo fijar policyUrl: ${await res.text()}`).toBeTruthy();
}

/** Crea la página con el MISMO contenido que siembra el seed. En borrador. */
async function crearPaginaCookies(request: Parameters<typeof authedPost>[0], slug: string) {
  const creada = await authedPost(request, '/admin/blog', adminApiToken(), {
    type: 'PAGE',
    title: PAGINA_COOKIES_TITULO,
    slug,
    blocks: PAGINA_COOKIES_BLOQUES,
  });
  expect(creada.ok(), `crear la página falló: ${await creada.text()}`).toBeTruthy();
  return (await creada.json()) as { id: string; slug: string };
}

test.beforeEach(async ({ page }) => {
  await page.context().clearCookies({ name: 'mp_consent' });
});

test.describe('BARRERA — en borrador no hay 404 por ninguna vía', () => {
  test('la página no es pública, y el banner despliega su detalle en línea', async ({
    page,
    request,
  }) => {
    const slug = `cookies-draft-${Date.now()}`;
    await crearPaginaCookies(request, slug);
    await ponerPolicyUrl(request, `/paginas/${slug}`);

    // 1. La página, en borrador, NO SE SIRVE.
    //
    // Se comprueba el CONTENIDO y no el código de estado, y hay motivo: el `loading.tsx`
    // de la raíz hace que `notFound()` degrade a un «404 blando» —200 con la interfaz de
    // no encontrado—, algo que este repo ya tiene documentado en `middleware.ts:74-88`.
    // Lo que la barrera protege es que el borrador no llegue al público, y eso se mide
    // mirando si su texto aparece.
    const publica = await request.get(`/paginas/${slug}`);
    const html = await publica.text();
    expect(html).not.toContain('Cookies propias');
    expect(html).not.toContain('mp_consent');

    // 2. Y el banner NO enlaza a ella: despliega el detalle donde está, que es el
    // respaldo que dejó montado la ráfaga 2. El visitante ve información, no un error.
    await page.goto('/busqueda');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('banner-cookies-mas').click();

    await expect(page.getByTestId('banner-cookies-detalle')).toBeVisible();
    await expect(page.getByTestId('banner-cookies-politica')).toHaveCount(0);

    await ponerPolicyUrl(request, '');
  });
});

test.describe('BARRERA — publicarla es el único acto necesario', () => {
  test('al publicar, el «ver más» pasa a enlazar a la página', async ({ page, request }) => {
    const slug = `cookies-pub-${Date.now()}`;
    const { id } = await crearPaginaCookies(request, slug);
    await ponerPolicyUrl(request, `/paginas/${slug}`);

    // Nadie vuelve a los ajustes: sólo se publica.
    const publicada = await authedPost(request, `/admin/blog/${id}/publish`, adminApiToken(), {});
    expect(publicada.ok()).toBeTruthy();

    await page.goto('/busqueda');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('banner-cookies-mas').click();

    const enlace = page.getByTestId('banner-cookies-politica');
    await expect(enlace).toBeVisible();
    await expect(enlace).toHaveAttribute('href', `/paginas/${slug}`);

    // Y lleva a una página que existe de verdad.
    await enlace.click();
    await expect(page).toHaveURL(new RegExp(`/paginas/${slug}$`));
    await expect(page.getByRole('heading', { name: PAGINA_COOKIES_TITULO })).toBeVisible();

    await ponerPolicyUrl(request, '');
  });

  test('publicada, entra en el sitemap sola', async ({ request }) => {
    const slug = `cookies-sitemap-${Date.now()}`;
    const { id } = await crearPaginaCookies(request, slug);
    await authedPost(request, `/admin/blog/${id}/publish`, adminApiToken(), {});

    // El sitemap ya recoge toda PAGE publicada (sitemap.ts): no hubo que tocarlo, y este
    // caso existe para que siga siendo verdad.
    const res = await request.get('/sitemap.xml');
    expect(res.ok()).toBeTruthy();
    expect(await res.text()).toContain(`/paginas/${slug}`);
  });
});

test.describe('BARRERA — los huecos se ven en la página servida', () => {
  test('el aviso de «no terminada» y los PENDIENTE llegan al HTML', async ({ page, request }) => {
    const slug = `cookies-huecos-${Date.now()}`;
    const { id } = await crearPaginaCookies(request, slug);
    await authedPost(request, `/admin/blog/${id}/publish`, adminApiToken(), {});

    await page.goto(`/paginas/${slug}`);
    await page.waitForLoadState('networkidle');

    // Que estén en el módulo del seed no basta: hay que verlos en la página. Un marcador
    // que se pierde por el camino es peor que no tenerlo, porque nadie lo echa de menos.
    await expect(page.getByText(/ESTA PÁGINA NO ESTÁ TERMINADA/)).toBeVisible();
    await expect(page.getByText(/No la publiques todavía/)).toBeVisible();
    expect(await page.locator('body').innerText()).toContain('PENDIENTE: nombre real');
    expect(await page.locator('body').innerText()).toContain('PENDIENTE: duración real');
  });

  test('declara la cookie propia y los tres terceros', async ({ page, request }) => {
    const slug = `cookies-inventario-${Date.now()}`;
    const { id } = await crearPaginaCookies(request, slug);
    await authedPost(request, `/admin/blog/${id}/publish`, adminApiToken(), {});

    await page.goto(`/paginas/${slug}`);
    await page.waitForLoadState('networkidle');
    const texto = await page.locator('body').innerText();

    // `mp_consent` es una cookie más y la escribimos nosotros: omitirla sería mentir en
    // el documento que existe para no mentir.
    expect(texto).toContain('mp_consent');
    expect(texto).toContain('Vimeo');
    expect(texto).toContain('YouTube');
    expect(texto).toContain('MapTiler');
  });
});

test.describe('BARRERA — el panel de la página decide de verdad', () => {
  test('permitir desde la página abre un vídeo retenido en otra', async ({ page, request }) => {
    const slugPolitica = `cookies-panel-${Date.now()}`;
    const { id } = await crearPaginaCookies(request, slugPolitica);
    await authedPost(request, `/admin/blog/${id}/publish`, adminApiToken(), {});

    // Una página con un vídeo, para comprobar el efecto donde de verdad importa.
    const conVideo = await authedPost(request, '/admin/blog', adminApiToken(), {
      type: 'PAGE',
      title: `Vídeo tras el panel ${Date.now()}`,
      blocks: [{ id: 'v1', type: 'video', provider: 'vimeo', videoId: '76979871' }],
    });
    const video = (await conVideo.json()) as { id: string; slug: string };
    await authedPost(request, `/admin/blog/${video.id}/publish`, adminApiToken(), {});

    // De partida, el gate retiene.
    await page.goto(`/paginas/${video.slug}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('gate-video')).toBeVisible();

    // Se decide desde la política, que es donde uno acaba de informarse.
    await page.goto(`/paginas/${slugPolitica}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('panel-preferencias-estado')).toContainText(/No permitido/);
    await page.getByTestId('panel-preferencias-permitir').click();
    await expect(page.getByTestId('panel-preferencias-estado')).toContainText(/Permitido/);

    // Y la decisión vale en toda la plataforma, no sólo aquí.
    await page.goto(`/paginas/${video.slug}`);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('iframe')).toHaveCount(1);
    await expect(page.getByTestId('gate-video')).toHaveCount(0);
  });

  test('y permite retirarlo, con el gate volviendo a retener', async ({ page, request }) => {
    const slug = `cookies-retirar-${Date.now()}`;
    const { id } = await crearPaginaCookies(request, slug);
    await authedPost(request, `/admin/blog/${id}/publish`, adminApiToken(), {});

    await page.goto(`/paginas/${slug}`);
    await page.waitForLoadState('networkidle');

    await page.getByTestId('panel-preferencias-permitir').click();
    await expect(page.getByTestId('panel-preferencias-estado')).toContainText(/Permitido/);

    // RGPD: retirar tan fácil como dar, y desde el mismo sitio.
    await page.getByTestId('panel-preferencias-retirar').click();
    await expect(page.getByTestId('panel-preferencias-estado')).toContainText(/No permitido/);

    const cookie = (await page.context().cookies()).find((c) => c.name === 'mp_consent');
    expect(decodeURIComponent(cookie!.value)).not.toContain('terceros');
  });
});
