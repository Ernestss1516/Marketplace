/**
 * EL FORMATO DEL TELÉFONO — la regla, y las dos barreras que impiden que se parta en dos.
 *
 * Este módulo existe porque «qué es un teléfono español» tenía que responderse dos veces:
 * RECONOCERLO en texto libre (el detector) y CANONIZARLO (la columna de búsqueda y, más
 * adelante, la lista de bloqueo). Dos implementaciones de la misma regla es como divergen,
 * así que viven juntas — y aquí se AFIRMA que siguen de acuerdo.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { esPhonePattern, normalizarTelefono, camposDeTelefono } from './phone-format';

describe('canonizar un teléfono', () => {
  it.each([
    ['654123456', 'ya canónico'],
    ['654 123 456', 'con espacios'],
    ['654-12-34-56', 'con guiones'],
    ['654.123.456', 'con puntos'],
    ['+34 654 123 456', 'con prefijo internacional'],
    ['0034654123456', 'con 00 34'],
    ['  654123456  ', 'con espacios alrededor'],
  ])('«%s» (%s) → 654123456', (entrada) => {
    expect(normalizarTelefono(entrada)).toBe('654123456');
  });

  it.each([
    ['12345', 'demasiado corto'],
    ['123456789', 'no empieza por 6-9'],
    ['65412345678', 'demasiado largo'],
    ['no soy un teléfono', 'no tiene dígitos'],
    ['+44 20 7946 0958', 'un teléfono de otro país'],
    ['', 'vacío'],
  ])('«%s» (%s) → null', (entrada) => {
    // NO ADIVINA. Canonizar a medias haría casar cosas que no son el mismo número, que es
    // peor que no encontrar nada.
    expect(normalizarTelefono(entrada)).toBeNull();
  });

  it('null y undefined no revientan', () => {
    expect(normalizarTelefono(null)).toBeNull();
    expect(normalizarTelefono(undefined)).toBeNull();
  });
});

describe('LA BARRERA — el patrón y el normalizador siguen de acuerdo', () => {
  it('TODO lo que el detector reconoce, el normalizador lo canoniza a nueve dígitos', () => {
    // Es la barrera que justifica que los dos vivan en el mismo fichero. Si alguien amplía
    // el patrón (para aceptar otro separador, otro prefijo) y no toca el normalizador, el
    // detector encontraría números que la búsqueda no sabría canonizar — y un teléfono
    // detectado que no se puede buscar es media función.
    const texto = [
      'llama al 654123456',
      'o al 654 123 456',
      'o al 654-12-34-56',
      'o al +34 654 123 456',
      'o al 0034 654 123 456',
      'fijo: 912345678',
      'otro: 7 3 4 1 2 3 4 5 6',
    ].join(' · ');

    const reconocidos = [...texto.matchAll(esPhonePattern())].map((m) => m[0]);
    expect(reconocidos.length).toBeGreaterThan(5);

    for (const bruto of reconocidos) {
      expect(normalizarTelefono(bruto)).toMatch(/^[6-9]\d{8}$/);
    }
  });
});

describe('LA BARRERA — los dos campos no se pueden desparear', () => {
  it('`camposDeTelefono` emite siempre los dos', () => {
    expect(camposDeTelefono('+34 654 123 456')).toEqual({
      phone: '+34 654 123 456',
      phoneNormalized: '654123456',
    });
    // Un teléfono que no es español se GUARDA (la validación del DTO lo admite) pero no se
    // puede canonizar: el visible queda y el buscable no. Es correcto y es explícito.
    expect(camposDeTelefono('+44 20 7946 0958')).toEqual({
      phone: '+44 20 7946 0958',
      phoneNormalized: null,
    });
    expect(camposDeTelefono(null)).toEqual({ phone: null, phoneNormalized: null });
  });

  it('NADIE escribe `phone` sobre un Listing sin pasar por `camposDeTelefono`', () => {
    // La barrera de verdad, y lee el fuente porque es lo único que puede afirmarlo: el par
    // se puede desparear con un `phone: x` suelto en cualquier `prisma.listing.create/update`
    // futuro, y el fallo sería INVISIBLE — la pantalla del vendedor se ve perfecta y el
    // anuncio simplemente no aparece al buscar su teléfono.
    const fuente = readFileSync(
      join(__dirname, '..', '..', 'listings', 'listings.service.ts'),
      'utf8',
    );
    expect(fuente.length).toBeGreaterThan(1000); // red del propio test

    // Ninguna línea escribe la clave `phone:` a pelo dentro de un `data`. La única forma de
    // que aparezca es a través del emisor compartido.
    const sueltas = fuente
      .split('\n')
      .filter((l) => /^\s*(\.\.\.\(.*)?phone:\s/.test(l) && !l.includes('camposDeTelefono'));
    expect(sueltas).toEqual([]);
    expect(fuente).toContain('camposDeTelefono(');
  });
});
