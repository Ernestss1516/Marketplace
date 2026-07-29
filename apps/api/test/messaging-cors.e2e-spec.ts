import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'net';
import { createTestApp } from './helpers/create-app';
import { DEFAULT_APP_ORIGIN } from 'src/config/app-origin';

/**
 * R9 PASO 1 — el CORS del `MessagingGateway`, EJERCIDO.
 *
 * Suite NUEVA y no un añadido a `messaging.e2e-spec.ts` por una razón concreta:
 * aquella conecta con `transports: ['websocket']`, y **el protocolo WebSocket no
 * pasa por CORS**. Es decir, `messaging.e2e-spec.ts` seguiría verde con el CORS
 * puesto, con el CORS quitado y con el CORS mal — no prueba nada sobre esto (y
 * es correcto que no lo pruebe: su objeto es la mensajería).
 *
 * Donde el CORS sí decide es en el HANDSHAKE DE POLLING, que es con lo que un
 * navegador abre la conexión antes de subir a WebSocket. Así que se ataca ahí:
 * una petición de handshake con `Origin` permitido y otra con `Origin` ajeno,
 * comprobando la cabecera `Access-Control-Allow-Origin` que es la que hace que
 * el navegador deje pasar la respuesta o la descarte.
 */
describe('MessagingGateway — CORS del handshake (R9 paso 1) e2e', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    app = await createTestApp();
    // listen(0) — el gateway solo existe con un servidor escuchando de verdad.
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    base = `http://localhost:${port}`;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  /** Handshake de engine.io tal y como lo abre un navegador (polling, EIO v4). */
  function handshake(origin: string) {
    return fetch(`${base}/socket.io/?EIO=4&transport=polling`, { headers: { Origin: origin } });
  }

  it('el origen del frontend está PERMITIDO: la respuesta lo autoriza explícitamente', async () => {
    const res = await handshake(DEFAULT_APP_ORIGIN);

    expect(res.status).toBe(200);
    // Con `origin: '*'` esta cabecera valía `*`. Ahora nombra el origen concreto:
    // eso es exactamente el cierre del TODO(prod).
    expect(res.headers.get('access-control-allow-origin')).toBe(DEFAULT_APP_ORIGIN);
  });

  it('ATAQUE — un origen ajeno NO recibe autorización, así que el navegador lo descarta', async () => {
    const res = await handshake('http://evil.example.com');

    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    // Y no se cuela por el comodín: si alguien devolviera `*` otra vez, esto lo ve.
    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('el preflight OPTIONS distingue igual entre los dos orígenes', async () => {
    const permitido = await fetch(`${base}/socket.io/?EIO=4&transport=polling`, {
      method: 'OPTIONS',
      headers: { Origin: DEFAULT_APP_ORIGIN, 'Access-Control-Request-Method': 'GET' },
    });
    expect(permitido.headers.get('access-control-allow-origin')).toBe(DEFAULT_APP_ORIGIN);

    const ajeno = await fetch(`${base}/socket.io/?EIO=4&transport=polling`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://evil.example.com', 'Access-Control-Request-Method': 'GET' },
    });
    expect(ajeno.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('sin cabecera Origin (cliente que no es un navegador) el handshake sigue funcionando', async () => {
    // Importante que NO se rompa: el CORS es una defensa del navegador, no un
    // control de acceso. Quien autoriza de verdad es el token del handshake, y
    // los clientes de servidor (y los propios e2e de mensajería) no mandan Origin.
    const res = await fetch(`${base}/socket.io/?EIO=4&transport=polling`);
    expect(res.status).toBe(200);
  });
});
