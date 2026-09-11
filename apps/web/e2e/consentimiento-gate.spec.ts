// COOKIES RÁFAGA 1 — EL GATE, MEDIDO EN LA RED.
//
// Ver docs/diseno-consentimiento-cookies.md §1 y §7.
//
// ─── POR QUÉ ESTE FICHERO ES EL QUE IMPORTA ──────────────────────────────────────────
//
// Todo lo demás (jest, el DOM, las capturas) comprueba lo que se PINTA. Esto comprueba
// lo que SALE POR EL CABLE, que es exactamente lo que la ley regula: no importa que el
// iframe esté oculto o que el mapa no se vea — si el navegador pidió algo a
// player.vimeo.com, el tercero ya tiene la IP del visitante y el incumplimiento ya
// ocurrió.
//
// Por eso la aserción central no es «no se ve el vídeo» sino «cero peticiones a estos
// dominios». Es la única forma de probar consentimiento PREVIO en vez de consentimiento
// decorativo.
//
// ─── LA MUTACIÓN QUE TIENE QUE CAZAR ─────────────────────────────────────────────────
//
// Quitar `<GateTerceros>` de VideoBlockRenderer (o de MapViewClient) y volver a montar
// el iframe directamente. Con eso, `peticionesA()` deja de estar vacío y estos tests se
// ponen rojos. Verificado a mano antes de cerrar la ráfaga.

import type { Page, Request } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken, authedPost } from './helpers/api';

/** Los dominios que el gate retiene. Espejo de `lib/consentimiento/constantes.ts`. */
const TERCEROS = ['player.vimeo.com', 'youtube-nocookie.com', 'api.maptiler.com'];

/**
 * Registra TODA petición de red hacia los terceros retenidos.
 *
 * Se engancha a `request` y no a `response`: lo que hay que cazar es que el navegador lo
 * PIDA. Que el tercero conteste o no, o que la respuesta llegue a tiempo, es irrelevante
 * — su servidor ya ha visto la IP.
 */
function espiarTerceros(page: Page): string[] {
  const vistas: string[] = [];
  page.on('request', (req: Request) => {
    const url = req.url();
    if (TERCEROS.some((d) => url.includes(d))) vistas.push(url);
  });
  return vistas;
}

/**
 * Crea y publica una página del CMS con un bloque de vídeo del proveedor pedido.
 * Molde de `paginas.spec.ts:82-93`: crear y publicar son dos llamadas.
 */
async function crearPaginaConVideo(
  request: Parameters<typeof authedPost>[0],
  provider: 'youtube' | 'vimeo',
): Promise<string> {
  const token = adminApiToken();

  const creada = await authedPost(request, '/admin/blog', token, {
    type: 'PAGE',
    title: `Gate ${provider} ${Date.now()}`,
    blocks: [
      {
        id: 'v1',
        type: 'video',
        provider,
        // IDs con la forma que el backend revalida; no se llegan a pedir a nadie.
        videoId: provider === 'youtube' ? 'dQw4w9WgXcQ' : '76979871',
      },
    ],
  });
  expect(creada.ok(), `crear la página falló: ${await creada.text()}`).toBeTruthy();
  const { id, slug } = (await creada.json()) as { id: string; slug: string };

  const publicada = await authedPost(request, `/admin/blog/${id}/publish`, token, {});
  expect(publicada.ok(), `publicar la página falló: ${await publicada.text()}`).toBeTruthy();

  return slug;
}

test.describe('BARRERA 1 — sin consentimiento, el tercero NO recibe nada', () => {
  for (const provider of ['vimeo', 'youtube'] as const) {
    test(`${provider}: cero peticiones y marcador en su lugar`, async ({ page, request }) => {
      const slug = await crearPaginaConVideo(request, provider);
      const vistas = espiarTerceros(page);

      await page.goto(`/paginas/${slug}`);
      await page.waitForLoadState('networkidle');

      // LO QUE CIERRA EL INCUMPLIMIENTO.
      expect(vistas, `el navegador contactó a un tercero sin consentimiento: ${vistas.join(', ')}`)
        .toEqual([]);

      // Y el iframe no está en el DOM: no es que esté oculto, es que no se ha montado.
      await expect(page.locator('iframe')).toHaveCount(0);

      // En su lugar hay algo que informa, no un hueco.
      const marcador = page.getByTestId('gate-video');
      await expect(marcador).toBeVisible();
      await expect(marcador).toContainText(provider === 'vimeo' ? 'Vimeo' : 'YouTube');
    });
  }

  test('YouTube se retiene igual que Vimeo (D-nueva-1), pese al dominio nocookie', async ({
    page,
    request,
  }) => {
    // `youtube-nocookie` no escribe cookies de seguimiento al cargar, pero SÍ recibe la
    // IP, el referer y el user-agent — y el play no es interceptable desde fuera del
    // iframe. Por eso no hay excepción para él.
    const slug = await crearPaginaConVideo(request, 'youtube');
    const vistas = espiarTerceros(page);

    await page.goto(`/paginas/${slug}`);
    await page.waitForLoadState('networkidle');

    expect(vistas.filter((u) => u.includes('youtube'))).toEqual([]);
  });
});

test.describe('BARRERA 2 — el marcador no toca al tercero', () => {
  test('ni una miniatura: el marcador es diseño propio', async ({ page, request }) => {
    const slug = await crearPaginaConVideo(request, 'youtube');
    const vistas = espiarTerceros(page);

    await page.goto(`/paginas/${slug}`);
    await page.waitForLoadState('networkidle');

    // Un marcador que pidiera la miniatura a img.youtube.com o a la API de Vimeo para
    // decorarse estaría llamando al tercero para anunciar que no llama al tercero.
    // `VideoBlock` no guarda póster (types/blocks.ts:70-74), así que la tentación existe.
    const miniaturas = vistas.concat(
      await page.locator('img').evaluateAll((imgs) =>
        imgs.map((i) => (i as HTMLImageElement).src).filter((s) => /youtube|vimeo|ytimg/.test(s)),
      ),
    );
    expect(miniaturas).toEqual([]);
  });
});

test.describe('BARRERA 3 — MapTiler y D3', () => {
  test('?view=mapa: el usuario lo pidió, así que carga CON aviso', async ({ page }) => {
    await page.goto('/busqueda?view=mapa');
    await page.waitForLoadState('networkidle');

    // Pedir el mapa es consentir MapTiler (D3), así que el mapa se monta...
    await expect(page.getByTestId('map-view')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('gate-mapa')).toHaveCount(0);

    // ...pero NO en silencio. Sin este aviso, D3 sería una exención silenciosa, que es
    // justo lo que la decisión no autoriza.
    await expect(page.getByTestId('gate-mapa-aviso')).toBeVisible();
    await expect(page.getByTestId('gate-mapa-aviso')).toContainText('MapTiler');
  });

  test('sin ?view=mapa no se contacta a MapTiler en absoluto', async ({ page }) => {
    const vistas = espiarTerceros(page);

    await page.goto('/busqueda');
    await page.waitForLoadState('networkidle');

    // En vista lista el mapa ni se plantea — pero la aserción es sobre la red, que es lo
    // que cuenta.
    expect(vistas).toEqual([]);
  });
});

test.describe('BARRERA 5 — el reparto caché/cliente', () => {
  test('el HTML servido (sin cookie) trae el marcador, nunca el iframe', async ({
    page,
    request,
  }) => {
    const slug = await crearPaginaConVideo(request, 'vimeo');

    // Se pide el HTML CRUDO, sin ejecutar JavaScript: es exactamente lo que guarda el
    // ISR (`revalidate = 3600` en paginas/[slug]/page.tsx:10) y lo que recibe el primer
    // visitante — y también lo que recibiría, del caché, uno que SÍ hubiera consentido.
    const res = await request.get(`/paginas/${slug}`);
    const html = await res.text();

    // El peor caso del diseño tiene que ser «no cargar el tercero», nunca al revés: si
    // la respuesta cacheada llevara el iframe, se estaría sirviendo el consentimiento de
    // un visitante a todos los demás.
    //
    // LA URL DEL TERCERO NO APARECE NI COMO DATO. Esta aserción es más dura de lo que la
    // ley exige (lo que importa es que no se PIDA, y eso lo cubre la barrera 1), y se
    // mantiene así a propósito: mientras el dominio no esté en el HTML, la barrera se
    // puede verificar de un vistazo. Fue esta línea la que descubrió que el iframe
    // viajaba en el payload RSC — ver el comentario de `'use client'` en
    // VideoBlockRenderer.
    expect(html).not.toContain('player.vimeo.com');
    expect(html).toContain('gate-video');

    // Y el marcador ya está en ese HTML, así que no hay salto al hidratar: el cliente
    // AÑADE el iframe si hay consentimiento, no quita uno que ya estaba.
    await page.goto(`/paginas/${slug}`);
    await expect(page.getByTestId('gate-video')).toBeVisible();
  });
});

test.describe('El marcador da la opción de consentir (sin banner todavía)', () => {
  test('«Permitir contenido de terceros» carga el vídeo y lo recuerda', async ({
    page,
    request,
  }) => {
    const slug = await crearPaginaConVideo(request, 'youtube');
    await page.goto(`/paginas/${slug}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Permitir contenido de terceros' }).click();

    // Ahora sí: el iframe se monta.
    await expect(page.locator('iframe')).toHaveCount(1);
    await expect(page.getByTestId('gate-video')).toHaveCount(0);

    // Y la decisión sobrevive a una recarga — es lo que hace que el gate no sea una
    // molestia por página.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('iframe')).toHaveCount(1);

    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'mp_consent')).toBeTruthy();
  });

  test('«Cargar solo esta vez» carga el vídeo pero NO escribe cookie', async ({
    page,
    request,
  }) => {
    const slug = await crearPaginaConVideo(request, 'youtube');
    await page.goto(`/paginas/${slug}`);
    await page.waitForLoadState('networkidle');

    await page.getByRole('button', { name: 'Cargar solo esta vez' }).click();
    await expect(page.locator('iframe')).toHaveCount(1);

    // Lo que hace que esta opción exista: ver un vídeo suelto no consiente todos los
    // terceros del sitio durante seis meses.
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === 'mp_consent')).toBeUndefined();

    // Y al recargar vuelve el marcador: «esta vez» significa esta vez.
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('gate-video')).toBeVisible();
  });
});

test.describe('BARRERA 4 — el preview del backoffice carga (D-nueva-3)', () => {
  test('el editor ve el vídeo que acaba de pegar, no el marcador', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/paginas/nueva');
    await page.waitForLoadState('networkidle');

    await page.getByPlaceholder('Título del post', { exact: true }).fill(`Preview ${Date.now()}`);
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 15_000 });

    // Añadir un bloque de vídeo y pegar una URL. Molde de `block-editor-full.spec.ts:37`.
    await page.getByRole('button', { name: 'Añadir bloque' }).click();
    await page.getByTestId('block-type-picker').getByText('Vídeo incrustado', { exact: true }).click();

    const fila = page.getByTestId('block-row-video');
    await fila.getByPlaceholder(/youtube\.com/).fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    // El admin acaba de PEDIR ese vídeo escribiendo su dirección: enseñarle un marcador
    // sería absurdo. Lo resuelve el ConsentProvider del layout de (admin).
    await expect(fila.locator('iframe')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('gate-video')).toHaveCount(0);

    await page.close();
  });
});
