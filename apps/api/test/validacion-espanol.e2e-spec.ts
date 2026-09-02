import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';

/**
 * i18n T5 — BARRERA 4: los rechazos de DTO llegan en español POR LA RED.
 *
 * ── POR QUÉ ESTA SUITE EXISTE SI YA HAY UNA UNITARIA ────────────────────────────────────
 *
 * `validacion-mensajes.spec.ts` prueba la FUNCIÓN. Esto prueba que está CABLEADA. Son cosas
 * distintas y la segunda es la que se rompe sola: la `exceptionFactory` se pasa en dos sitios
 * —`main.ts` y `test/helpers/create-app.ts`— y basta con que alguien añada una opción al
 * `ValidationPipe` de uno de los dos y arrastre el objeto entero para que la traducción
 * desaparezca sin que ningún test unitario se entere.
 *
 * Es la misma razón por la que `messaging-cors.e2e-spec.ts` ataca el handshake de verdad en
 * vez de comprobar la constante del decorador.
 *
 * ── SE ATACA UNA RUTA PÚBLICA Y ANÓNIMA A PROPÓSITO ────────────────────────────────────
 *
 * El `ValidationPipe` corre en todas, y una ruta sin JWT deja el veredicto en una sola cosa:
 * el cuerpo de la respuesta. Con una ruta de admin habría que autenticar primero y un 401
 * podría confundirse con un rechazo de validación.
 */
describe('Validación de DTOs — en español, de punta a punta (i18n T5) e2e', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
    await app.init();
  }, 60_000);

  afterAll(async () => {
    await app.close();
  });

  /** `GET /api/search` valida su query con un DTO; `hitsPerPage` es numérico y acotado. */
  const buscar = (query: string) => request(app.getHttpServer()).get(`/api/search?${query}`);

  it('un campo que SOBRA se rechaza en español (forbidNonWhitelisted)', async () => {
    const res = await buscar('inventado=1').expect(400);

    const mensajes = res.body.message as string[];
    expect(Array.isArray(mensajes)).toBe(true);
    expect(mensajes.join(' ')).toContain('«inventado» no es un campo admitido');
  });

  it('y NO queda ni una palabra del texto de fábrica de class-validator', async () => {
    // La mitad que importa: que el mensaje esté en español no basta si al lado sigue
    // colándose el inglés de la librería.
    const res = await buscar('inventado=1').expect(400);

    const texto = (res.body.message as string[]).join(' ');
    for (const ingles of ['should not', 'must be', 'must not', 'should be']) {
      expect(texto).not.toContain(ingles);
    }
  });

  it('un valor de tipo equivocado también', async () => {
    const res = await buscar('hitsPerPage=muchos').expect(400);

    const texto = (res.body.message as string[]).join(' ');
    expect(texto).toMatch(/«hitsPerPage»/);
    expect(texto).toMatch(/número/);
  });

  it('la FORMA no cambia: 400 con `message` como array', async () => {
    // `client.ts` hace `String(body.message)` y con un array lo une por comas. Esta ráfaga
    // cambia el idioma, no el contrato.
    const res = await buscar('inventado=1').expect(400);

    expect(res.body.statusCode).toBe(400);
    expect(Array.isArray(res.body.message)).toBe(true);
  });

  it('una petición VÁLIDA sigue pasando (la validación no se ha aflojado)', async () => {
    // La red de esta suite: traducir mensajes de rechazo es fácil de «arreglar» dejando de
    // rechazar. Sin este caso, un pipe desactivado pondría los cuatro anteriores en rojo…
    // y alguien podría hacerlos verdes quitando la validación.
    await buscar('hitsPerPage=5').expect(200);
  });
});
