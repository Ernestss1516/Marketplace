/**
 * VÍDEO DE BLOQUE V2 — el editor y el render. **Las barreras.**
 *
 * QUÉ SE PRUEBA AQUÍ: la vuelta entera, en pantalla y contra el almacenamiento de verdad —
 * elegir «Vídeo subido» en el selector, subir un MP4 (firma → PUT directo a MinIO →
 * confirm), guardar, y que la página pública lo pinte con el reproductor de siempre. Y que la
 * URL guardada **no lleva `tmp/`**: eso lo hace el pase de promoción de V1 al guardar, y es lo
 * que impide que la regla de ciclo de vida del bucket se lleve por delante un vídeo publicado.
 *
 * POR QUÉ AQUÍ SÍ SE PUEDE SUBIR UN MP4 DE VERDAD, cuando `video-editor.spec.ts` dice que no.
 * Aquel necesita que el navegador **decodifique** el fichero: mide la duración real, porque el
 * vídeo Pro tiene un límite de 60 s. Este camino **no tiene límite de duración** (decisión de
 * V1: el servidor no puede comprobarla sin ffmpeg, así que fingir el número era peor que no
 * tenerlo), así que nada necesita decodificar nada y unos bytes con el tipo `video/mp4` bastan
 * para ejercitar la coreografía entera. Es una ventaja concreta de aquella decisión.
 *
 * LO QUE ESTO NO CUBRE, dicho para que nadie lo dé por cubierto: la CAPTURA DEL PÓSTER. Como
 * el fichero no es decodificable, `captureVideoPoster` devuelve `null` y el bloque se guarda
 * sin póster — que es exactamente el respaldo previsto («un póster roto no debe impedir
 * publicar»), así que de paso queda probado ese respaldo. Que el póster se promociona igual
 * que el vídeo cuando sí existe está probado en `video-bloque-v1.e2e-spec.ts`, con un fichero
 * real contra MinIO.
 *
 * Ver `docs/diseno-video-bloque.md` §5, §6 y §10.
 */

import type { Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { restaurarPortada } from './helpers/portada';

/** Unos bytes con el tipo correcto. No hace falta que sea reproducible: ver la cabecera. */
const MP4_SINTETICO = {
  name: 'video-e2e.mp4',
  mimeType: 'video/mp4',
  buffer: Buffer.from('bloque de vídeo e2e — bytes de prueba'),
};

async function addBlock(page: Page, label: string) {
  await page.getByRole('button', { name: 'Añadir bloque' }).click();
  await page.getByTestId('block-type-picker').getByText(label, { exact: true }).click();
}

/** Sube el MP4 en la fila del bloque y espera a que la URL aterrice en el bloque. */
async function subirVideo(fila: Locator) {
  await fila.getByTestId('block-video-input').setInputFiles(MP4_SINTETICO);
  // El preview sólo se monta cuando el bloque ya tiene URL: es la señal de que los tres
  // pasos (firmar, subir, confirmar) han terminado.
  await expect(fila.getByTestId('block-video-preview')).toBeVisible({ timeout: 30_000 });
}

test.describe('Vídeo subido — el selector, la subida y el render', () => {
  test('EDITOR crea una página con un vídeo subido, la publica, y el público lo ve', async ({
    editorContext,
  }) => {
    test.setTimeout(120_000);
    const page = await editorContext.newPage();
    const suffix = Date.now();
    const title = `Página con vídeo subido ${suffix}`;

    await page.goto('/admin/paginas/nueva');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Título del post', { exact: true }).fill(title);

    // ── BARRERA: los DOS vídeos conviven en el selector ─────────────────────
    // La mutación que mata esto es tocar el embed al añadir el nuevo. Aquí se ve que
    // siguen siendo dos opciones distintas y que la del embed conserva su sitio.
    await page.getByRole('button', { name: 'Añadir bloque' }).click();
    const picker = page.getByTestId('block-type-picker');
    await expect(picker.getByText('Vídeo incrustado', { exact: true })).toBeVisible();
    await expect(picker.getByText('Vídeo subido', { exact: true })).toBeVisible();
    await picker.getByText('Vídeo subido', { exact: true }).click();

    const fila = page.getByTestId('block-row-videoUpload');
    await expect(fila).toBeVisible();

    // ── BARRERA: la subida de punta a punta, con los bytes FUERA de la API ──
    // Se vigila que el PUT del navegador va contra el almacenamiento y NO contra nuestra
    // API: es la garantía B-1 de V1, vista desde el otro lado del cable.
    const putsAlAlmacenamiento: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PUT') putsAlAlmacenamiento.push(req.url());
    });

    await subirVideo(fila);

    expect(putsAlAlmacenamiento.length).toBeGreaterThan(0);
    for (const url of putsAlAlmacenamiento) {
      expect(url).not.toContain('/api/');
    }

    await fila.getByTestId('block-video-caption').fill(`Pie del vídeo ${suffix}`);

    // ── Guardar y publicar ──────────────────────────────────────────────────
    await page.getByRole('button', { name: 'Guardar borrador' }).click();
    await page.waitForURL(/\/admin\/paginas\/.+\/editar/, { timeout: 15_000 });
    await page.getByRole('button', { name: /publicar/i }).click();
    await page.waitForTimeout(1_000);

    // ── BARRERA B-2, vista desde la interfaz: lo guardado NO lleva `tmp/` ───
    // El editor guarda la URL TEMPORAL y es el BACKEND quien la promociona al escribir la
    // fila. Tras guardar se navega a la pantalla de edición, que recarga el post del
    // servidor: lo que se ve aquí es, por tanto, lo que de verdad quedó persistido. Si
    // llevara `tmp/`, la regla de ciclo de vida borraría en 24 h un vídeo ya publicado.
    const filaGuardada = page.getByTestId('block-row-videoUpload');
    await expect(filaGuardada.getByTestId('block-video-preview')).toBeVisible({ timeout: 20_000 });
    const srcTrasGuardar = await filaGuardada.getByTestId('block-video-preview').getAttribute('src');
    expect(srcTrasGuardar).not.toContain('/tmp/');
    expect(srcTrasGuardar).toContain('blocks-videos/');

    // ── BARRERA: el público lo ve, con el reproductor de siempre ────────────
    const [popup] = await Promise.all([
      page.context().waitForEvent('page'),
      page.getByRole('link', { name: /ver página/i }).click(),
    ]);
    await popup.waitForLoadState('networkidle');

    const video = popup.getByTestId('bloque-video-subido');
    await expect(video).toBeVisible();

    // preload="none": abrir la página NO descarga el vídeo. Es la disciplina que
    // `VideoPlayer` trae de serie, y la mutación que la mata es escribir un `<video>` a
    // mano en el renderizador del bloque en vez de reutilizarlo.
    await expect(video).toHaveAttribute('preload', 'none');
    await expect(video).toHaveAttribute('controls', '');
    expect(await video.getAttribute('autoplay')).toBeNull();
    expect(await video.getAttribute('src')).not.toContain('/tmp/');

    await expect(popup.getByText(`Pie del vídeo ${suffix}`)).toBeVisible();

    await popup.close();
  });

  test('el vídeo INCRUSTADO sigue funcionando igual — el nuevo no lo tocó', async ({
    editorContext,
  }) => {
    // BARRERA B-5. El embed conserva su tipo, su editor (pegar la URL de YouTube y que se
    // parsee) y su render (un iframe de youtube-nocookie). Lo único que cambió es su
    // etiqueta en el selector, para que se distinga del vídeo subido.
    const page = await editorContext.newPage();
    const suffix = Date.now();

    await page.goto('/admin/paginas/nueva');
    await page.waitForLoadState('networkidle');
    await page.getByPlaceholder('Título del post', { exact: true }).fill(`Embed intacto ${suffix}`);

    await addBlock(page, 'Vídeo incrustado');
    const fila = page.getByTestId('block-row-video');
    await fila.getByPlaceholder(/youtube\.com/).fill('https://www.youtube.com/watch?v=dQw4w9WgXcQ');

    // El parseo a {provider, videoId} y el iframe controlado, intactos.
    await expect(fila.locator('iframe[src*="youtube-nocookie.com/embed/dQw4w9WgXcQ"]')).toBeVisible();

    // Y no hay ni rastro del control de subida en este bloque: son dos tipos, no uno con un
    // interruptor dentro.
    await expect(fila.getByTestId('block-video-input')).toHaveCount(0);
  });

  test('la PORTADA tiene el mismo bloque, con su propio motor', async ({
    adminContext,
    request,
  }) => {
    // Los dos motores son independientes (otro registro, otro renderizador, otro editor),
    // así que que funcione en el blog no dice nada de la portada. Se comprueba aparte.
    //
    // La portada es una fila ÚNICA compartida por toda la batería, así que este test la deja
    // como la encontró — `restaurarPortada`, el mismo contrato que el resto de specs de
    // portada. Se restaura al final pase lo que pase.
    test.setTimeout(120_000);
    const page = await adminContext.newPage();

    try {
      await page.goto('/admin/portada');
      await expect(page.getByTestId('zona-bloques')).toBeVisible({ timeout: 20_000 });

      await page.getByTestId('zona-bloques').getByRole('button', { name: 'Añadir bloque' }).click();
      await page
        .getByTestId('home-block-type-picker')
        .getByTestId('home-block-type-videoUpload')
        .click();

      const fila = page.getByTestId('home-block-row-videoUpload');
      await expect(fila).toBeVisible();

      await fila.getByTestId('home-block-video-input').setInputFiles(MP4_SINTETICO);
      await expect(fila.getByTestId('home-block-video-preview')).toBeVisible({ timeout: 30_000 });

      await page.getByTestId('guardar-portada').click();

      // Tras guardar, la página repuebla su estado con lo que devuelve el servidor, así que
      // esta URL es la PERSISTIDA: promocionada fuera de `tmp/` por el backend.
      await expect
        .poll(
          async () => fila.getByTestId('home-block-video-preview').getAttribute('src'),
          { timeout: 20_000 },
        )
        .toMatch(/blocks-videos\/(?!tmp\/)/);
    } finally {
      await restaurarPortada(request);
    }
  });
});
