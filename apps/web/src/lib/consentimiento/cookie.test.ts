/**
 * COOKIES RÁFAGA 1 — EL PARSEO DE LA COOKIE.
 *
 * Esta es la pieza que decide si alguien consintió, así que es la que más barato sale
 * probar y la que más caro sale equivocar. **El único error que este sistema no se puede
 * permitir es leer «consintió» donde no lo hay**, y de ahí que la mitad de estos casos
 * sean basura que tiene que devolver `null`.
 */

import {
  parsearConsentimiento,
  serializarConsentimiento,
  type Consentimiento,
} from './cookie';
import { VERSION_TEXTO } from './constantes';

const VALIDO: Consentimiento = {
  version: VERSION_TEXTO,
  categorias: ['terceros'],
  fecha: 1_757_548_800,
  id: 'clx123',
};

describe('parsearConsentimiento', () => {
  it('lee una cookie válida de ida y vuelta', () => {
    expect(parsearConsentimiento(serializarConsentimiento(VALIDO))).toEqual(VALIDO);
  });

  it('un RECHAZO es una decisión, no una ausencia: categorías vacías pero cookie válida', () => {
    const rechazo = { ...VALIDO, categorias: [] };
    const leido = parsearConsentimiento(serializarConsentimiento(rechazo));
    // No es `null`: quien rechazó YA decidió, y el banner de la ráfaga 2 no debe volver
    // a preguntarle. Confundir «rechazó» con «no ha decidido» es insistir a quien ya
    // dijo que no, que es otra forma de presionar para aceptar.
    expect(leido).not.toBeNull();
    expect(leido!.categorias).toEqual([]);
  });

  describe('devuelve null (= no ha decidido) ante cualquier cosa que no sea íntegra', () => {
    it.each([
      ['ausente', undefined],
      ['vacía', ''],
      ['no es JSON', 'esto-no-es-json'],
      ['JSON que no es objeto', encodeURIComponent('"hola"')],
      ['sin versión', encodeURIComponent(JSON.stringify({ c: ['terceros'], t: 1 }))],
      ['versión no textual', encodeURIComponent(JSON.stringify({ v: 9, c: [], t: 1 }))],
      ['sin fecha', encodeURIComponent(JSON.stringify({ v: VERSION_TEXTO, c: [] }))],
      ['fecha no numérica', encodeURIComponent(JSON.stringify({ v: VERSION_TEXTO, c: [], t: 'ayer' }))],
    ])('%s', (_caso, valor) => {
      expect(parsearConsentimiento(valor as string | undefined)).toBeNull();
    });
  });

  it('una versión distinta se descarta — ES el mecanismo de re-consentimiento (D5)', () => {
    const vieja = encodeURIComponent(
      JSON.stringify({ v: `${VERSION_TEXTO}-anterior`, c: ['terceros'], t: 1 }),
    );
    // Si el admin sube la versión del texto, la cookie vieja deja de valer y se vuelve a
    // preguntar. Sin esto, un cambio de texto no re-preguntaría a nadie.
    expect(parsearConsentimiento(vieja)).toBeNull();
  });

  it('descarta categorías desconocidas en vez de arrastrarlas', () => {
    const conBasura = encodeURIComponent(
      JSON.stringify({ v: VERSION_TEXTO, c: ['terceros', 'marketing', 42], t: 1 }),
    );
    const leido = parsearConsentimiento(conBasura);
    // `marketing` no existe en este producto (no hay un solo tercero publicitario). Si
    // algún día existiera, la versión habría cambiado y la cookie ya no valdría.
    expect(leido!.categorias).toEqual(['terceros']);
  });

  it('sin `id` sigue siendo válida: la prueba pudo no registrarse (fail-open)', () => {
    const sinId = encodeURIComponent(JSON.stringify({ v: VERSION_TEXTO, c: ['terceros'], t: 1 }));
    const leido = parsearConsentimiento(sinId);
    // El backend puede estar caído cuando el usuario decide. Su voluntad se respeta
    // igual; lo que falta es la prueba, no la decisión.
    expect(leido).not.toBeNull();
    expect(leido!.id).toBeNull();
    expect(leido!.categorias).toEqual(['terceros']);
  });
});
