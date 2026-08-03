// Atención al usuario R5 — adjuntos, en navegador de verdad.
//
// Lo que solo se puede comprobar aquí: que el selector de ficheros existe en la
// caja de respuesta, que la validación de cliente corta ANTES de la petición (el
// usuario no espera una subida condenada), y que el adjunto que aparece en la
// burbuja se descarga por el ENDPOINT AUTENTICADO — no por una URL pública, que
// es la invariante entera de la ráfaga.
//
// La seguridad (403 del ajeno, 404 del adjunto de una nota interna, puerta de
// facturación) está ejercida en `tickets-attachments.e2e-spec.ts`, que es donde
// toca: aquí no se reimplementa: se mira la capa que el navegador aporta.
//
// USUARIO `pro-e2e` a propósito y no `seller-e2e`: abrir un ticket cuesta cupo
// (10/día, límite real de producción) y `tickets-usuario.spec.ts` ya gasta 5 con
// el seller. Repartir el usuario es más honesto que subir el límite — misma
// decisión que se tomó en R7 con `tickets-admin.spec.ts`.

import path from 'path';
import { test, expect } from './fixtures/auth';
import { loginViaApi, authedPost } from './helpers/api';

const IMAGEN = path.join(__dirname, 'fixtures', 'test-image.png');

test.describe('Tickets — adjuntos', () => {
  let proToken: string;

  test.beforeAll(async ({ request }) => {
    proToken = await loginViaApi(request, 'pro-e2e@example.com', 'Test1234!');
  });

  async function abrirTicket(
    request: Parameters<typeof authedPost>[0],
    subject: string,
  ): Promise<string> {
    const res = await authedPost(request, '/tickets', proToken, {
      subject,
      body: 'Cuerpo del ticket de prueba',
    });
    expect(res.status()).toBe(201);
    return (await res.json()).id as string;
  }

  test('adjunta una imagen, la ve en su burbuja y la descarga por el endpoint autenticado', async ({
    proContext,
    request,
  }) => {
    const id = await abrirTicket(request, 'Adjunto una captura');
    const page = await proContext.newPage();
    await page.goto(`/mis-tickets/${id}`);

    // El input está oculto (lo dispara el botón "Adjuntar"): se rellena directo,
    // que es lo que Playwright recomienda para inputs de fichero.
    //
    // CARRERA DE HIDRATACIÓN — observada con una sonda, no supuesta. El input
    // existe en el HTML servido, así que `setInputFiles` "funciona" aunque React
    // todavía no haya enganchado su `onChange`: el fichero se queda EN EL INPUT y
    // el componente nunca se entera. Medido en los fallos:
    //   ficherosEnInput: 1, nombre: "test-image.png"  →  hayLista: false, hayError: false
    // y en los aciertos:
    //   ficherosEnInput: 0 (handlePick resetea el input al procesarlo)  →  hayLista: true
    // O sea: fichero todavía en el input = el manejador no llegó a correr.
    //
    // Se reintenta la ACCIÓN, no solo la espera (mismo patrón que el envío de
    // mensajes en mensajeria-unificada y que `clicarYEsperarUrl`). El guard de
    // "ya está en la lista" evita añadir el fichero dos veces si el primer intento
    // sí llegó a registrarse y solo faltaba pintar.
    // El `setInputFiles([])` previo NO es cosmético: volver a poner el MISMO
    // fichero sobre un input que ya lo tiene no dispara otro `change`, así que
    // sin vaciarlo antes el reintento no despertaba nada (medido: el reintento
    // solo repetía el estado roto). Vaciar y volver a poner sí emite el evento.
    await expect(async () => {
      if ((await page.getByTestId('adjuntos-picker-lista').count()) === 0) {
        await page.getByTestId('adjuntos-picker-input').setInputFiles([]);
        await page.getByTestId('adjuntos-picker-input').setInputFiles(IMAGEN);
      }
      await expect(page.getByTestId('adjuntos-picker-lista')).toContainText('test-image.png', {
        timeout: 2_000,
      });
    }).toPass({ timeout: 20_000 });

    await page.getByTestId('input-respuesta').fill('Te mando la captura');
    await page.getByTestId('enviar-respuesta').click();

    // Ya en el hilo, dentro de la burbuja del mensaje.
    const adjunto = page.getByTestId('adjunto-descargar').first();
    await expect(adjunto).toContainText('test-image.png');
    // Y la lista de pendientes se vacía: lo enviado no puede quedar colgando.
    await expect(page.getByTestId('adjuntos-picker-lista')).toHaveCount(0);

    // LA DESCARGA VA AL ENDPOINT AUTENTICADO, no a una URL del bucket.
    const peticiones: string[] = [];
    page.on('request', (r) => peticiones.push(r.url()));

    const descarga = await Promise.all([
      page.waitForEvent('download'),
      adjunto.click(),
    ]).then(([d]) => d);

    expect(descarga.suggestedFilename()).toBe('test-image.png');
    expect(peticiones.some((u) => u.includes(`/api/tickets/${id}/attachments/`))).toBe(true);
    // Nada ha pedido el objeto al almacenamiento directamente.
    expect(peticiones.some((u) => u.includes('/tickets/') && u.includes(':9000'))).toBe(false);

    await page.close();
  });

  test('un tipo no admitido se rechaza EN EL NAVEGADOR, sin llegar a subir nada', async ({
    proContext,
    request,
  }) => {
    const id = await abrirTicket(request, 'Adjunto algo raro');
    const page = await proContext.newPage();
    await page.goto(`/mis-tickets/${id}`);

    const subidas: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.url().includes('/messages')) subidas.push(r.url());
    });

    // Misma carrera de hidratación que en el test de arriba: si React aún no ha
    // enganchado el `onChange`, el fichero se queda en el input y no aparece ni la
    // lista ni el error. Se reintenta la acción; el guard mira el ERROR, que es lo
    // que este caso espera (el fichero se rechaza, no se añade a la lista).
    await expect(async () => {
      if ((await page.getByTestId('adjuntos-picker-error').count()) === 0) {
        // Vaciar antes de reponer — si no, el mismo fichero no dispara `change`.
        await page.getByTestId('adjuntos-picker-input').setInputFiles([]);
        await page
          .getByTestId('adjuntos-picker-input')
          .setInputFiles({ name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') });
      }
      await expect(page.getByTestId('adjuntos-picker-error')).toContainText(
        'no es un tipo admitido',
        { timeout: 2_000 },
      );
    }).toPass({ timeout: 20_000 });
    // Ni se ha añadido a la lista de pendientes ni se ha mandado nada.
    await expect(page.getByTestId('adjuntos-picker-lista')).toHaveCount(0);
    expect(subidas).toHaveLength(0);

    await page.close();
  });
});
