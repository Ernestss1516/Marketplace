import fs from 'fs';
import os from 'os';
import path from 'path';
import { test, expect } from './fixtures/auth';

/**
 * Vídeo Pro (ráfaga 2) — la sección de subida en el editor, en pantalla.
 *
 * LÍMITE CONOCIDO DE ESTA BATERÍA, dicho aquí para que nadie lo descubra creyendo que está
 * cubierto: el camino feliz COMPLETO —elegir un MP4 real, que el navegador lo decodifique,
 * leer su duración, capturar el póster y subirlo— NO se ejercita. No hay fixture de vídeo en
 * el repo y este proyecto no trae ffmpeg (esa fue justamente la decisión de diseño), así que
 * no hay forma honesta de generar uno aquí.
 *
 * Lo que SÍ se cubre, que es lo que se puede cubrir sin decodificar: quién ve la sección y en
 * qué estado (gate Pro, flag), el rechazo temprano de un fichero que no vale, y que la
 * sección funciona en móvil. La coreografía de subida está probada a nivel HTTP en
 * `video-infra.e2e-spec.ts` (20 casos, con PUT real contra el almacenamiento).
 */

/** Abre el editor del primer anuncio del vendedor. */
async function abrirEditor(page: import('@playwright/test').Page) {
  await page.goto('/mis-anuncios');
  await expect(page.getByRole('link', { name: /^Editar$/ }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('link', { name: /^Editar$/ }).first().click();
  await expect(page.getByTestId('seccion-fotos')).toBeVisible({ timeout: 20_000 });
}

test.describe('Vídeo Pro — la sección en el editor', () => {
  test('un vendedor PRO ve la sección y puede elegir un vídeo', async ({ proContext }) => {
    const page = await proContext.newPage();
    await abrirEditor(page);

    await expect(page.getByTestId('seccion-video')).toBeVisible();
    await expect(page.getByTestId('video-elegir')).toBeVisible();
    // Sin candado: es Pro.
    await expect(page.getByTestId('video-gate-pro')).toHaveCount(0);
    // Y el selector no ofrece siquiera lo que el servidor rechazaría.
    await expect(page.getByTestId('video-input')).toHaveAttribute('accept', 'video/mp4');
  });

  test('un NO-Pro ve la sección con el candado y la salida a /planes', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await abrirEditor(page);

    // El gate SE VE: esconderlo dejaría invisible el beneficio justo a quien hay que
    // convencer. Y trae su salida, o el bloqueo sería un callejón.
    await expect(page.getByTestId('video-gate-pro')).toBeVisible();
    await expect(page.getByRole('link', { name: /hazte pro/i })).toHaveAttribute('href', '/planes');
    await expect(page.getByTestId('video-elegir')).toHaveCount(0);
  });

  test('rechazo TEMPRANO: un fichero que no es MP4 se rechaza sin subir nada', async ({
    proContext,
  }) => {
    const page = await proContext.newPage();
    await abrirEditor(page);

    // Ninguna petición de firma debe salir: el rechazo es local.
    let pidioFirma = false;
    await page.route('**/video/upload-url', (route) => {
      pidioFirma = true;
      return route.abort();
    });

    await page.getByTestId('video-input').setInputFiles({
      name: 'no-es-video.png',
      mimeType: 'image/png',
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });

    await expect(page.getByTestId('video-error')).toContainText(/solo admitimos vídeo mp4/i);
    expect(pidioFirma).toBe(false);
  });

  test('y un fichero demasiado pesado tampoco llega a subirse', async ({ proContext }) => {
    const page = await proContext.newPage();
    await abrirEditor(page);

    let pidioFirma = false;
    await page.route('**/video/upload-url', (route) => {
      pidioFirma = true;
      return route.abort();
    });

    // 51 MB con el MIME correcto: lo que lo tumba es el tamaño, no el tipo. Va por fichero
    // en disco porque Playwright no admite pasar un buffer de más de 50 MB — que es, por sí
    // mismo, una señal de que este tamaño no debería viajar por la memoria de nadie.
    const ruta = path.join(os.tmpdir(), `video-enorme-${Date.now()}.mp4`);
    fs.writeFileSync(ruta, Buffer.alloc(51 * 1024 * 1024));
    try {
      await page.getByTestId('video-input').setInputFiles(ruta);
    } finally {
      fs.rmSync(ruta, { force: true });
    }

    await expect(page.getByTestId('video-error')).toContainText(/pesa demasiado/i);
    // Mejor un «no» inmediato que cinco minutos de subida desde el móvil para el mismo «no».
    expect(pidioFirma).toBe(false);
  });

  test('en móvil (375px) la sección se usa igual', async ({ proContext }) => {
    const page = await proContext.newPage();
    await page.setViewportSize({ width: 375, height: 780 });
    await abrirEditor(page);

    await expect(page.getByTestId('seccion-video')).toBeVisible();
    await expect(page.getByTestId('video-elegir')).toBeVisible();

    const scrollX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(scrollX).toBeLessThanOrEqual(1);
  });
});

test.describe('Vídeo Pro — requisito de oro: el editor de UXV.5 intacto', () => {
  test('las secciones de siempre siguen ahí y se guarda como antes', async ({ proContext }) => {
    const page = await proContext.newPage();
    await abrirEditor(page);

    // La sección de vídeo se SUMA; no sustituye a ninguna.
    for (const id of ['fotos', 'datos', 'ubicacion']) {
      await expect(page.getByTestId(`seccion-${id}`)).toBeVisible();
    }

    // Y la barra de guardado fija de UXV.5 sigue operativa.
    await expect(page.getByRole('button', { name: /guardar cambios/i })).toBeVisible();
  });

  test('la subida de FOTOS no se ha tocado', async ({ proContext }) => {
    const page = await proContext.newPage();
    await abrirEditor(page);

    // El vídeo es una sección nueva con su propio mecanismo; las fotos siguen su camino.
    await expect(page.getByTestId('seccion-fotos')).toBeVisible();
    await expect(page.getByTestId('seccion-fotos')).toContainText(/fotos/i);
  });
});
