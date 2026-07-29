// Atención al usuario R9 PASO 2 — tiempo real en navegador, con DOS SESIONES.
//
// Lo que este test aporta y `tickets-realtime.e2e-spec.ts` no puede: que el HOOK
// del frontend (`useTicketSocket`) se suscribe de verdad, que el mensaje entrante
// se PINTA en el hilo sin recargar, y que no aparece duplicado. El e2e de gateway
// prueba que el evento sale; esto prueba que llega a la pantalla.
//
// La semántica de seguridad (sala ajena, nota interna, puerta de facturación) NO
// se repite aquí: está ejercida con sockets reales en el e2e de backend, que es
// su sitio. Aquí solo la capa que aporta el navegador.
//
// `pro-e2e` por el mismo motivo que en `tickets-adjuntos.spec.ts`: abrir tickets
// gasta cupo (10/día) y el seller ya gasta 5 en `tickets-usuario.spec.ts`.

import { test, expect } from './fixtures/auth';
import { loginViaApi, authedPost } from './helpers/api';

test.describe('Tickets — tiempo real', () => {
  let proToken: string;

  test.beforeAll(async ({ request }) => {
    proToken = await loginViaApi(request, 'pro-e2e@example.com', 'Test1234!');
  });

  test('el usuario ve aparecer la respuesta del staff sin recargar la página', async ({
    proContext,
    adminContext,
    request,
  }) => {
    const res = await authedPost(request, '/tickets', proToken, {
      subject: 'Tiempo real',
      body: 'Espero respuesta en vivo',
    });
    expect(res.status()).toBe(201);
    const id = (await res.json()).id as string;

    // Sesión del usuario, con el hilo abierto y suscrito a `ticket:<id>`.
    const usuario = await proContext.newPage();
    await usuario.goto(`/mis-tickets/${id}`);
    await expect(usuario.getByTestId('hilo-mensajes')).toContainText('Espero respuesta en vivo');

    // Margen para que el socket conecte y emita su `ticket:join` (el 'connect' del
    // hook). Sin esto la carrera es real: el POST podría emitir antes del join.
    await usuario.waitForTimeout(1500);

    // Sesión del agente, en otra ventana, respondiendo por la UI de staff.
    const agente = await adminContext.newPage();
    await agente.goto(`/admin/tickets/${id}`);
    await agente.getByTestId('input-respuesta-staff').fill('Respondiendo en vivo');
    await agente.getByTestId('enviar-respuesta-staff').click();

    // LO QUE SE PRUEBA: aparece en el hilo del usuario SIN NAVEGAR NI RECARGAR.
    await expect(usuario.getByTestId('hilo-mensajes')).toContainText('Respondiendo en vivo', {
      timeout: 10_000,
    });

    // Y una sola vez: el hook deduplica por id (el mensaje llega por la sala del
    // hilo y el usuario está además en su sala personal).
    await usuario.waitForTimeout(800);
    expect(await usuario.getByText('Respondiendo en vivo', { exact: true }).count()).toBe(1);

    await usuario.close();
    await agente.close();
  });
});
