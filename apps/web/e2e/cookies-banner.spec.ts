// COOKIES RÁFAGA 2 — EL BANNER, EN UN NAVEGADOR DE VERDAD.
//
// Ver docs/diseno-consentimiento-cookies.md §3.
//
// Lo que sólo se puede comprobar aquí y no en jsdom:
//   · que el banner y el GATE se coordinan por el evento, sin proveedor central — aceptar
//     en el banner carga el vídeo que estaba retenido, en la misma página y sin recargar;
//   · que aceptar/rechazar SOBREVIVE a la recarga (la cookie es real, con sus flags);
//   · que la HIDRATACIÓN sigue intacta con el banner montado en la raíz, que es la
//     lección que dejó la ráfaga 1 y sólo se ve en `next start`;
//   · que el banner no tapa lo que hay debajo.
//
// PARTE SIN COOKIE, al revés que el resto de la batería: el fixture siembra una decisión
// para las specs que no van de cookies (ver fixtures/auth.ts) y aquí hace falta el estado
// «primera visita».

import { test, expect } from './fixtures/auth';
import { adminApiToken, authedPost } from './helpers/api';

test.beforeEach(async ({ page }) => {
  await page.context().clearCookies({ name: 'mp_consent' });
});

test.describe('El banner aparece, decide y se va', () => {
  test('primera visita: aparece con las tres opciones al mismo nivel', async ({ page }) => {
    await page.goto('/busqueda');
    await page.waitForLoadState('networkidle');

    const banner = page.getByTestId('banner-cookies');
    await expect(banner).toBeVisible();

    const aceptar = page.getByTestId('banner-cookies-aceptar');
    const rechazar = page.getByTestId('banner-cookies-rechazar');
    const mas = page.getByTestId('banner-cookies-mas');
    await expect(aceptar).toBeVisible();
    await expect(rechazar).toBeVisible();
    await expect(mas).toBeVisible();

    // LA BARRERA DEL RGPD: rechazar no puede pesar menos que aceptar. Se comparan las
    // clases y el tamaño real en pantalla, que es lo que ve la persona.
    expect(await rechazar.getAttribute('class')).toBe(await aceptar.getAttribute('class'));
    const cajaA = await aceptar.boundingBox();
    const cajaR = await rechazar.boundingBox();
    expect(cajaR!.height).toBeCloseTo(cajaA!.height, 0);
  });

  test('ACEPTAR se recuerda entre recargas', async ({ page }) => {
    await page.goto('/busqueda');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('banner-cookies-aceptar').click();
    await expect(page.getByTestId('banner-cookies')).toHaveCount(0);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('banner-cookies')).toHaveCount(0);

    const cookie = (await page.context().cookies()).find((c) => c.name === 'mp_consent');
    expect(cookie).toBeTruthy();
    expect(decodeURIComponent(cookie!.value)).toContain('terceros');
  });

  test('RECHAZAR también se recuerda — no se insiste a quien dijo que no', async ({ page }) => {
    await page.goto('/busqueda');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('banner-cookies-rechazar').click();
    await expect(page.getByTestId('banner-cookies')).toHaveCount(0);

    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('banner-cookies')).toHaveCount(0);

    const cookie = (await page.context().cookies()).find((c) => c.name === 'mp_consent');
    expect(cookie).toBeTruthy();
    // Decisión guardada, pero sin categorías: el gate sigue reteniendo.
    expect(decodeURIComponent(cookie!.value)).not.toContain('terceros');
  });

  test('el banner NO tapa el contenido: reserva su hueco', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await page.goto('/busqueda');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('banner-cookies')).toBeVisible();

    // Con el banner fixed y sin compensar, el final del documento quedaba debajo y sus
    // controles eran inalcanzables (lo cazó `bump-programado` en móvil).
    const padding = await page.evaluate(() =>
      parseInt(getComputedStyle(document.body).paddingBottom || '0', 10),
    );
    expect(padding).toBeGreaterThan(0);
  });
});

test.describe('BARRERA — el banner manda sobre el gate, por el evento', () => {
  test('aceptar en el banner carga un vídeo retenido, sin recargar', async ({ page, request }) => {
    const token = adminApiToken();
    const creada = await authedPost(request, '/admin/blog', token, {
      type: 'PAGE',
      title: `Banner y gate ${Date.now()}`,
      blocks: [{ id: 'v1', type: 'video', provider: 'vimeo', videoId: '76979871' }],
    });
    const { id, slug } = (await creada.json()) as { id: string; slug: string };
    await authedPost(request, `/admin/blog/${id}/publish`, token, {});

    await page.goto(`/paginas/${slug}`);
    await page.waitForLoadState('networkidle');

    // De partida: el gate retiene y el banner pregunta.
    await expect(page.getByTestId('gate-video')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);

    await page.getByTestId('banner-cookies-aceptar').click();

    // Y AQUÍ ESTÁ LO QUE SE PRUEBA: el banner y el gate no comparten proveedor —el
    // central rompía la hidratación (ráfaga 1)—, así que se coordinan por un evento de
    // navegador. Si ese evento se perdiera, el vídeo seguiría retenido hasta recargar.
    await expect(page.locator('iframe')).toHaveCount(1);
    await expect(page.getByTestId('gate-video')).toHaveCount(0);
  });

  test('rechazar deja el vídeo retenido', async ({ page, request }) => {
    const token = adminApiToken();
    const creada = await authedPost(request, '/admin/blog', token, {
      type: 'PAGE',
      title: `Banner rechazo ${Date.now()}`,
      blocks: [{ id: 'v1', type: 'video', provider: 'vimeo', videoId: '76979871' }],
    });
    const { id, slug } = (await creada.json()) as { id: string; slug: string };
    await authedPost(request, `/admin/blog/${id}/publish`, token, {});

    await page.goto(`/paginas/${slug}`);
    await page.waitForLoadState('networkidle');
    await page.getByTestId('banner-cookies-rechazar').click();

    await expect(page.getByTestId('gate-video')).toBeVisible();
    await expect(page.locator('iframe')).toHaveCount(0);
  });
});

test.describe('Preferencias desde el footer', () => {
  test('reabre el panel y permite retirar lo aceptado', async ({ page }) => {
    await page.goto('/busqueda');
    await page.waitForLoadState('networkidle');
    await page.getByTestId('banner-cookies-aceptar').click();
    await expect(page.getByTestId('banner-cookies')).toHaveCount(0);

    // RGPD: retirar tiene que ser tan fácil como dar, y desde cualquier página.
    await page.getByTestId('footer-preferencias-cookies').click();
    await expect(page.getByTestId('banner-cookies')).toBeVisible();
    await expect(page.getByTestId('banner-cookies-detalle')).toBeVisible();

    await page.getByTestId('banner-cookies-rechazar').click();

    const cookie = (await page.context().cookies()).find((c) => c.name === 'mp_consent');
    expect(decodeURIComponent(cookie!.value)).not.toContain('terceros');
  });
});

test.describe('BARRERA — la hidratación sigue intacta', () => {
  test('el banner en la raíz NO duplica el árbol', async ({ page }) => {
    // LA LECCIÓN DE LA RÁFAGA 1, convertida en barrera. El `ConsentProvider` central
    // envolvía `{children}` y al hidratar React montaba una segunda copia de la página
    // entera. El banner de esta ráfaga va como HERMANO, fuera de AuthProvider —la
    // posición del <Toaster/>—, así que esto tiene que seguir dando uno de cada.
    await page.goto('/busqueda');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('header')).toHaveCount(1);
    await expect(page.locator('footer')).toHaveCount(1);
    await expect(page.getByTestId('banner-cookies')).toHaveCount(1);
  });
});
