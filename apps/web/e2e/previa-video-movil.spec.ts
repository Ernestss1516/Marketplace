import { test, expect } from './fixtures/auth';
import { loginViaApi } from './helpers/api';

/**
 * PREVIA DE VÍDEO EN MÓVIL — LOS BYTES, EN UN NAVEGADOR DE VERDAD.
 *
 * POR QUÉ ESTA BATERÍA EXISTE, TENIENDO YA LA UNITARIA. `previa-video-tap.test.tsx` comprueba
 * el DOM: que la capa no está montada, que se monta al tocar. Eso es una **consecuencia** de lo
 * que de verdad importa, no lo que importa. Lo que el diseño promete es un número —**cero bytes
 * descargados hasta que el usuario lo pide**— y ese número sólo se puede medir donde hay una
 * red: aquí se cuentan las peticiones reales al almacenamiento.
 *
 * Es la misma distinción que el proyecto ya hace con `preload="none"` en la ficha: el atributo
 * es la técnica, el byte que no viaja es la garantía.
 *
 * ── LA SUPERFICIE: FAVORITOS ────────────────────────────────────────────────────
 *
 * `/favoritos` monta `ListingCard` —o sea, el mismo `CardPhotoCarousel` que las once listas— y
 * **sale de Postgres**, no de Meilisearch. Se elige por eso: medir bytes exige que la tarjeta
 * esté en pantalla de forma determinista, y esperar a que un documento se indexe añadiría a
 * esta medición una fuente de inestabilidad que no tiene nada que ver con lo que se mide.
 *
 * ── CÓMO SE SIEMBRA EL VÍDEO SIN UN MP4 ─────────────────────────────────────────
 *
 * `video-editor.spec.ts` ya dejó escrito el límite: no hay fixture de vídeo en el repo y este
 * proyecto no trae ffmpeg a propósito. Pero **el servidor no decodifica nada** —valida tipo y
 * tamaño, y comprueba contra el almacenamiento que lo prometido aterrizó—, así que la
 * coreografía real (firmar → PUT → confirmar) se puede recorrer entera con bytes arbitrarios
 * marcados como `video/mp4`. Es exactamente lo que hace `video-infra.e2e-spec.ts`.
 *
 * El SPRITE, en cambio, sí es una imagen de verdad: el navegador tiene que poder decodificarla
 * para pintarla, y las capturas tienen que enseñar algo. Son cinco franjas de color (330 bytes)
 * en la proporción 5:1 que el CSS espera, así que en las capturas se ve de un vistazo **qué
 * fotograma** está enseñando la ventana.
 */

/** El sprite: 5 franjas de color, 500×100, WebP. Real y decodificable — y 330 bytes. */
const SPRITE_WEBP = Buffer.from(
  'UklGRkIBAABXRUJQVlA4IDYBAAAwFgCdASr0AWQAPm02mUkkIyKhIz84SIANiWdu4XShDN1f038Jdep6B+IH4c04D5AN//z//dAP8AAfmREt4zHiM99B1t53XBS/FIx2GUeszEjHXg2CIR2s0cDNsEQxLjIETEjFSMoUP4hHpsJBjxKZpn+szEirlxj/INgiEeIjH+zN/WZiRjrwbBEI7WaOBm2CIYlxkCJiRipGUKH8Qj02Egx4lM0z/WZiRVy4x/kGwRCPERj/Zm/rMEAA/vuZgAaCwiWt0gj+Wj8NQH9lh/OMf+RX/x6PFRbVrRj/JCx/C9T9fyu/pGqGgG99lz9W8NNaZ0y/crLBRJ4ix6PuQ5uXwa9n4vAfFS+iXn3jknTZD81SxCgngNRkK0y5LOPkFchsXTSwVyGxXyCuQ2LppYK5DYr5BQAA',
  'base64',
);

/**
 * La PORTADA del anuncio: gris con una banda, 400×400. Tiene que ser **claramente distinta**
 * del sprite, o las capturas no probarían nada: con la misma imagen en los dos sitios, «antes»
 * y «después» del toque se ven idénticos aunque la previa esté puesta. Pasó en la primera
 * corrida de esta batería.
 */
const PORTADA_WEBP = Buffer.from(
  'UklGRtwBAABXRUJQVlA4INABAABQLACdASqQAZABPm02mUkkIyKhIrh4AIANiWlu4XaB/vn+mBHfh5YASk0+EJH1jzamnwhI+sebU0+EJH1jzamnwhI+sebU0+EJH1jzamnwhI+sebU0+EJH1jzamnwhI+sebU0+EJH1jzamnwhI+sebU0+EJH1jzamnwhI+sebU0+EJH1jzamnwhI+seZkH01Nh8tJZoRqqcknsOj64fLSWaEaqnJJ7Do+uHz77U7QBYSvTiCxDdiFkCqsebU0+EJH1jzamnwhI+sebU0+EJH1jzamnwhI+sebU0+EJH1jzamnwhI+kLRrJKlQxnKrIBAIBAMYqBXsNh3FKhjOSFsOJxOJxPZlivrUojI+PoDBqFwHCEj6x5tTT4QkfWPNqafCEj6x5tTT4QkfWPNqafCEj6x5tTT4QkfWPNqafCEj6x5tTT4QkfWPNqafCEj6x5tTT4QkfWPNqafCEj6x5tTT4QkfWPNqafCEj6QAA/v8UjfnlvyVM2GkAAAAAAAAAABBDxe1r2rDsqugxdBjiKu971wIAAAAANLeFI6lyuvegflR1c0dZShKJM6yzPYsSyo6uaOspQlEmdZZnsWJZUdY5CkFAAAAAAAAAAAAAAAAAAA==',
  'base64',
);

const API = 'http://localhost:3001';
/** El prefijo del sprite en el almacenamiento — lo que se cuenta para medir los bytes. */
const PREFIJO_SPRITE = 'listing-previews/';

/** Un teléfono: dos columnas, sin hover y con dedo. Es el dispositivo del que va todo esto. */
test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
});

type Sembrado = { id: string; title: string };

/**
 * Le pone vídeo y sprite a un anuncio activo del vendedor Pro, por los caminos reales, y lo
 * deja en los favoritos de ese mismo usuario.
 */
async function sembrarAnuncioConSprite(
  request: import('@playwright/test').APIRequestContext,
): Promise<{ token: string; anuncios: Sembrado[] }> {
  const token = await loginViaApi(request, 'pro-e2e@example.com', 'Test1234!');
  const cabeceras = { Authorization: `Bearer ${token}` };

  const lista = await request.get(`${API}/api/users/me/listings?page=1`, { headers: cabeceras });
  expect(lista.ok()).toBeTruthy();
  const items = ((await lista.json()) as { items: { id: string; title: string; status: string }[] })
    .items.filter((l) => l.status === 'ACTIVE');

  expect(items.length).toBeGreaterThanOrEqual(1);
  const elegidos = items.slice(0, 1);

  for (const anuncio of elegidos) {
    /**
     * 0. UNA FOTO, PORQUE SIN ELLA NO HAY TARJETA QUE MEDIR. `CardPhotoCarousel` con
     *    `images` vacío pinta «Sin foto» y sale antes de llegar al indicador — así que el
     *    anuncio del seed, que no trae imágenes, no tendría botón que tocar. Se sube por el
     *    camino real (`POST /media/upload` → `PATCH /listings/:id` con `imageIds`).
     */
    const subidaFoto = await request.post(`${API}/api/media/upload`, {
      headers: cabeceras,
      multipart: {
        file: { name: 'portada.webp', mimeType: 'image/webp', buffer: PORTADA_WEBP },
      },
    });
    expect(subidaFoto.ok()).toBeTruthy();
    const foto = (await subidaFoto.json()) as { id: string };

    const conFoto = await request.patch(`${API}/api/listings/${anuncio.id}`, {
      headers: cabeceras,
      data: { imageIds: [foto.id] },
    });
    expect(conFoto.ok()).toBeTruthy();

    // 1. Firmar el vídeo. El servidor revalida el gate entero (flag + Pro + anuncio suyo
    //    y activo) antes de emitir el permiso.
    const firmaVideo = await request.post(`${API}/api/video/upload-url`, {
      headers: cabeceras,
      data: {
        listingId: anuncio.id,
        contentType: 'video/mp4',
        sizeBytes: 1024,
        durationSeconds: 10,
      },
    });
    expect(firmaVideo.ok()).toBeTruthy();
    const video = (await firmaVideo.json()) as { uploadUrl: string; key: string };

    // 2. PUT directo al almacenamiento, con el tamaño exacto que se firmó (va dentro de la
    //    firma: un cuerpo de otro tamaño lo rechazaría el propio almacenamiento).
    const subidaVideo = await request.put(video.uploadUrl, {
      headers: { 'Content-Type': 'video/mp4' },
      data: Buffer.alloc(1024),
    });
    expect(subidaVideo.ok()).toBeTruthy();

    // 3. Y el sprite, por su camino hermano.
    const firmaSprite = await request.post(`${API}/api/video/preview-url`, {
      headers: cabeceras,
      data: {
        listingId: anuncio.id,
        contentType: 'image/webp',
        sizeBytes: SPRITE_WEBP.length,
      },
    });
    expect(firmaSprite.ok()).toBeTruthy();
    const sprite = (await firmaSprite.json()) as { uploadUrl: string; key: string };

    const subidaSprite = await request.put(sprite.uploadUrl, {
      headers: { 'Content-Type': 'image/webp' },
      data: SPRITE_WEBP,
    });
    expect(subidaSprite.ok()).toBeTruthy();

    // 4. Confirmar: los dos viajan juntos, porque un sprite sin su vídeo no significa nada.
    const confirmacion = await request.post(`${API}/api/video/listings/${anuncio.id}/confirm`, {
      headers: cabeceras,
      data: { key: video.key, durationSeconds: 10, previewKey: sprite.key },
    });
    expect(confirmacion.ok()).toBeTruthy();

    // 5. A favoritos, que es la lista donde se va a medir.
    await request.post(`${API}/api/favorites/${anuncio.id}`, { headers: cabeceras });
  }

  return { token, anuncios: elegidos };
}

/** Cuenta las peticiones al prefijo del sprite que el navegador llega a emitir. */
function contarSprites(page: import('@playwright/test').Page): () => number {
  const pedidas: string[] = [];
  page.on('request', (req) => {
    if (req.url().includes(PREFIJO_SPRITE)) pedidas.push(req.url());
  });
  return () => pedidas.length;
}

test.describe('Previa de vídeo en móvil — el toque', () => {
  test('B-1 y B-2: cero bytes hasta el toque, y un solo sprite después', async ({
    proContext,
    request,
  }, testInfo) => {
    await sembrarAnuncioConSprite(request);

    const page = await proContext.newPage();
    const sprites = contarSprites(page);

    await page.goto('/favoritos');
    const botones = page.getByTestId('card-tiene-video');
    await expect(botones.first()).toBeVisible({ timeout: 20_000 });

    // Un recorrido completo de la lista, que es donde la opción A habría cobrado sus 888 KB:
    // al entrar en viewport, cada tarjeta con vídeo habría pedido su sprite.
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(500);
    await page.mouse.wheel(0, -2000);
    await page.waitForTimeout(500);

    // ── B-1 — CERO BYTES POR DEFECTO ─────────────────────────────────────────────
    expect(sprites()).toBe(0);
    await expect(page.getByTestId('card-video-preview')).toHaveCount(0);

    const rutaMovilantesdeltoque = testInfo.outputPath('movil-antes-del-toque.png');
    await page.screenshot({ animations: 'disabled', path: rutaMovilantesdeltoque });
    await testInfo.attach('movil-antes-del-toque.png', { path: rutaMovilantesdeltoque, contentType: 'image/png' });

    // ── B-2 — EL TOQUE ANUNCIA ───────────────────────────────────────────────────
    await botones.first().tap();

    await expect(page.getByTestId('card-video-preview')).toHaveCount(1);
    // El número entero de esta ráfaga: UN sprite, y sólo porque se ha pedido.
    await expect.poll(sprites, { timeout: 5_000 }).toBe(1);

    const rutaMoviltraseltoque = testInfo.outputPath('movil-tras-el-toque.png');
    await page.screenshot({ animations: 'disabled', path: rutaMoviltraseltoque });
    await testInfo.attach('movil-tras-el-toque.png', { path: rutaMoviltraseltoque, contentType: 'image/png' });

    await page.close();
  });

  test('B-3: el botón se puede tocar de verdad (≥44×44) y sigue en su esquina', async ({
    proContext,
    request,
  }) => {
    await sembrarAnuncioConSprite(request);

    const page = await proContext.newPage();
    await page.goto('/favoritos');
    const boton = page.getByTestId('card-tiene-video').first();
    await expect(boton).toBeVisible({ timeout: 20_000 });

    /**
     * AQUÍ SE MIDE LA ZONA SENSIBLE, NO LA PÍLDORA — y por eso esta barrera vive en un
     * navegador y no en jsdom, que no calcula geometría. La píldora mide ~52×20: es la medida
     * correcta para no tapar la foto, y menos de la mitad del mínimo recomendado para un dedo.
     * Lo que tiene que llegar a 44×44 es el área que responde al toque, que la extiende un
     * pseudo-elemento sin pintar nada.
     */
    const zona = await boton.evaluate((el) => {
      const despues = getComputedStyle(el, '::after');
      const caja = el.getBoundingClientRect();
      const foto = el.closest('div')!.getBoundingClientRect();
      const px = (v: string) => (v.endsWith('px') ? Math.abs(parseFloat(v)) : 0);
      return {
        ancho: caja.width + px(despues.left) + px(despues.right),
        alto: caja.height + px(despues.top) + px(despues.bottom),
        pildoraAlto: caja.height,
        // ¿Está la píldora DENTRO del contenedor de la media, abajo a la derecha?
        dentro: caja.left >= foto.left && caja.right <= foto.right + 1 && caja.top >= foto.top,
        enLaEsquina: foto.right - caja.right < 20 && foto.bottom - caja.bottom < 20,
      };
    });

    expect(zona.ancho).toBeGreaterThanOrEqual(44);
    expect(zona.alto).toBeGreaterThanOrEqual(44);
    // Y la píldora NO ha crecido para conseguirlo: sigue siendo la de siempre sobre la foto.
    expect(zona.pildoraAlto).toBeLessThan(30);

    /**
     * Y SIGUE DONDE ESTABA — la barrera que faltaba, escrita después de que pasara.
     *
     * La primera versión del botón llevaba `relative` junto al `absolute` que el indicador ya
     * traía. En jsdom conviven; en un navegador gana la que Tailwind emite más tarde, y la
     * píldora se fue **a la esquina de arriba a la izquierda, medio fuera de la tarjeta**. Todos
     * los tests seguían verdes: lo cazó una captura. Esto es esa captura convertida en barrera.
     */
    expect(zona.dentro).toBe(true);
    expect(zona.enLaEsquina).toBe(true);

    await page.close();
  });
});

/**
 * ESCRITORIO — LA BARRERA DEL CAMBIO NULO.
 *
 * Todo lo de arriba añade un camino; esto comprueba que **no ha tocado el que ya había**. El
 * hover sigue montando la capa, y sigue montándola SIN `data-tap`: si el ratón empezara a
 * marcarla, la animación de escritorio dejaría de depender de `@media (hover: hover)` y la
 * decisión de producto (b) se habría desactivado sin que nadie tocara esa consulta.
 */
test.describe('Escritorio — el hover, intacto', () => {
  test.use({ viewport: { width: 1280, height: 900 }, hasTouch: false, isMobile: false });

  test('el ratón sigue encendiendo la previa, y sin `data-tap`', async ({
    proContext,
    request,
  }, testInfo) => {
    await sembrarAnuncioConSprite(request);

    const page = await proContext.newPage();
    await page.goto('/favoritos');
    const tarjeta = page.getByTestId('chasis-rejilla').first();
    await expect(tarjeta).toBeVisible({ timeout: 20_000 });

    const rutaEscritorioantesdelhover = testInfo.outputPath('escritorio-antes-del-hover.png');
    await page.screenshot({ animations: 'disabled', path: rutaEscritorioantesdelhover });
    await testInfo.attach('escritorio-antes-del-hover.png', { path: rutaEscritorioantesdelhover, contentType: 'image/png' });

    await tarjeta.hover();

    const capa = page.getByTestId('card-video-preview');
    await expect(capa).toHaveCount(1);
    await expect(capa).not.toHaveAttribute('data-tap', 'true');

    const rutaEscritorioconhover = testInfo.outputPath('escritorio-con-hover.png');
    await page.screenshot({ animations: 'disabled', path: rutaEscritorioconhover });
    await testInfo.attach('escritorio-con-hover.png', { path: rutaEscritorioconhover, contentType: 'image/png' });

    await page.close();
  });
});
