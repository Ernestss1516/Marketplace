import { INestApplication } from '@nestjs/common';
import { AddressInfo } from 'net';
import { createTestApp } from './helpers/create-app';
import { DEFAULT_APP_ORIGIN } from 'src/config/app-origin';

/**
 * DESPLIEGUE GRUPO A — el CORS de la API HTTP, EJERCIDO.
 *
 * ── LA OTRA MITAD DE `messaging-cors.e2e-spec.ts` ────────────────────────────────────────
 *
 * Aquella suite cerró el CORS del gateway de WebSockets (R9 paso 1). Ésta cierra el de la API
 * HTTP, que se dejó fuera a propósito por tener un radio de explosión mucho mayor. Se escribe
 * con el mismo molde porque el defecto era el mismo —`Access-Control-Allow-Origin` para
 * cualquiera— y porque así las dos mitades se leen juntas.
 *
 * ── LO QUE DE VERDAD SE VIGILA AQUÍ: LA FORMA DEL VALOR ─────────────────────────────────
 *
 * `origin: [appOrigin()]` (array de uno) y `origin: appOrigin()` (cadena) **parecen lo
 * mismo y no lo son**. Con la CADENA, el paquete `cors` emite la cabecera con ese valor sin
 * comparar con el `Origin` de la petición: el navegador sigue protegiendo, pero la respuesta
 * es idéntica para todo el mundo y **un test del origen ajeno seguiría en verde**. Eso ya
 * pasó una vez, en el gateway, y se descubrió ejerciéndolo. El caso del origen ajeno de más
 * abajo es el que distingue las dos formas, y es la razón de que esta suite exista.
 *
 * ── POR QUÉ SE ATACA UNA RUTA PÚBLICA Y SIN AUTENTICAR ──────────────────────────────────
 *
 * Porque el CORS se resuelve ANTES que los guards: lo que se mide es la cabecera, no el
 * cuerpo. Usar una ruta autenticada mezclaría dos veredictos y un 401 podría leerse como
 * «bloqueado por CORS» cuando no lo está.
 */
describe('API HTTP — CORS restringido al origen del frontend (grupo A) e2e', () => {
  let app: INestApplication;
  let base: string;

  /** Ruta pública, sin JWT y siempre presente: el árbol de categorías. */
  const RUTA = '/api/categories';

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0);
    const { port } = app.getHttpServer().address() as AddressInfo;
    base = `http://localhost:${port}`;
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  it('el origen del frontend está PERMITIDO: la respuesta lo autoriza explícitamente', async () => {
    const res = await fetch(`${base}${RUTA}`, { headers: { Origin: DEFAULT_APP_ORIGIN } });

    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe(DEFAULT_APP_ORIGIN);
  });

  it('ATAQUE — un origen ajeno NO recibe autorización, así que el navegador lo descarta', async () => {
    const res = await fetch(`${base}${RUTA}`, { headers: { Origin: 'http://evil.example.com' } });

    // ESTE es el caso que sólo pasa con la forma de ARRAY. Con `origin: appOrigin()`
    // (cadena) la cabecera llegaría igual y este test seguiría verde sin proteger nada.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('y no se cuela por el comodín: si alguien devolviera `*` otra vez, esto lo ve', async () => {
    // La mutación exacta que este fichero existe para matar: volver a `app.enableCors()`
    // sin argumentos. Con ella, la cabecera vale `*` y esto se cae.
    const res = await fetch(`${base}${RUTA}`, { headers: { Origin: 'http://evil.example.com' } });

    expect(res.headers.get('access-control-allow-origin')).not.toBe('*');
  });

  it('el preflight OPTIONS distingue igual entre los dos orígenes', async () => {
    const permitido = await fetch(`${base}${RUTA}`, {
      method: 'OPTIONS',
      headers: {
        Origin: DEFAULT_APP_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    expect(permitido.headers.get('access-control-allow-origin')).toBe(DEFAULT_APP_ORIGIN);

    const ajeno = await fetch(`${base}${RUTA}`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://evil.example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization,content-type',
      },
    });
    expect(ajeno.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('sin cabecera Origin (cliente que no es un navegador) la API sigue respondiendo', async () => {
    // Importante que NO se rompa, y es la parte que más fácil se estropea al «endurecer»
    // el CORS: quien autoriza de verdad es el JWT, no esto. Los clientes de servidor, los
    // webhooks de Stripe y Redsys, y la mayoría de los propios e2e no mandan `Origin`.
    const res = await fetch(`${base}${RUTA}`);
    expect(res.status).toBe(200);
  });

  it('un origen que sólo se PARECE al bueno tampoco pasa', async () => {
    // Sufijo y prefijo: `midominio.es.evil.com` y `http://localhost:3000.evil.com` son el
    // molde clásico de comparar orígenes con `startsWith`/`endsWith` en vez de por igualdad.
    for (const origen of [
      `${DEFAULT_APP_ORIGIN}.evil.com`,
      'http://evil.com/http://localhost:3000',
      'https://localhost:3000',
    ]) {
      const res = await fetch(`${base}${RUTA}`, { headers: { Origin: origen } });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    }
  });
});
