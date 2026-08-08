import { sanitizeReturnTo, withReturnTo } from './return-to';

/**
 * UXV.3 (A7-flujo) — el destino de vuelta llega DEL CLIENTE y acaba dentro de una
 * petición de pago firmada, así que su validación es superficie de seguridad, no un
 * detalle de UX. Esta batería fija sobre todo lo que NO debe pasar.
 */
describe('sanitizeReturnTo', () => {
  describe('admite exactamente los destinos del producto', () => {
    it.each(['/mis-anuncios', '/anuncio/iphone-13-128gb', '/anuncio/a1'])(
      'acepta %s',
      (ruta) => {
        expect(sanitizeReturnTo(ruta)).toBe(ruta);
      },
    );
  });

  describe('rechaza todo lo demás', () => {
    it.each([
      // EL CASO QUE JUSTIFICA LA ALLOWLIST: un `startsWith('/')` lo daría por bueno y el
      // navegador lo trata como URL absoluta protocol-relative → redirección abierta.
      ['protocol-relative', '//evil.com'],
      ['protocol-relative con backslash', '/\\evil.com'],
      ['absoluta http', 'http://evil.com'],
      ['absoluta https', 'https://evil.com'],
      ['javascript:', 'javascript:alert(1)'],
      ['data:', 'data:text/html,<script>alert(1)</script>'],
      ['ruta interna NO contemplada', '/admin/usuarios'],
      ['ruta interna de la cartera', '/mis-creditos'],
      ['travesía', '/anuncio/../admin'],
      ['con querystring inyectada', '/mis-anuncios?x=1'],
      ['con fragmento', '/mis-anuncios#x'],
      ['con salto de línea', '/mis-anuncios\n'],
      ['relativa sin barra', 'mis-anuncios'],
      ['vacía', ''],
    ])('rechaza %s', (_caso, valor) => {
      expect(sanitizeReturnTo(valor)).toBeNull();
    });

    it('rechaza lo que se pasa de largo, aunque encaje en la forma', () => {
      expect(sanitizeReturnTo('/anuncio/' + 'a'.repeat(300))).toBeNull();
    });

    it('no revienta con undefined ni null', () => {
      expect(sanitizeReturnTo(undefined)).toBeNull();
      expect(sanitizeReturnTo(null)).toBeNull();
    });
  });
});

describe('withReturnTo', () => {
  const base = 'https://app.example/mis-creditos/exito';

  it('cuelga el destino válido, codificado', () => {
    expect(withReturnTo(base, '/anuncio/iphone-13')).toBe(
      `${base}?volver=${encodeURIComponent('/anuncio/iphone-13')}`,
    );
  });

  it('devuelve la URL intacta cuando el destino no es válido — un returnTo malo NO tumba el cobro', () => {
    expect(withReturnTo(base, '//evil.com')).toBe(base);
    expect(withReturnTo(base, undefined)).toBe(base);
  });
});
