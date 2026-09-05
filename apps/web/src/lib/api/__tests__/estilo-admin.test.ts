import type { ApiErrorContrastFailure } from '../client';
import {
  COLOR_CULPABLE,
  comoColorCss,
  fallosPorRanura,
  textoDeFallo,
  tripleteAHexParaSelector,
} from '../estilo-admin';

/**
 * E9 — LA TRADUCCIÓN DEL 422 DE CONTRASTE AL CAMPO QUE HAY QUE MOVER.
 *
 * Esto es lo que separa un aviso útil de uno inútil, así que se prueba aparte de la
 * pantalla: la alternativa —«no cumple el contraste mínimo» y ya— es un mensaje que
 * obliga al admin a probar combinaciones a ciegas entre cuatro colores, que es
 * exactamente lo que el backend evitó al molestarse en medir y mandar la lista.
 */

const fallo = (
  pareja: string,
  contrasteActual: number,
  contrasteMinimo = 4.5,
): ApiErrorContrastFailure => ({ pareja, contrasteActual, contrasteMinimo });

describe('fallosPorRanura — cada fallo va al color que lo mueve', () => {
  it('las tres parejas de marca señalan a SU color', () => {
    const { porRanura, sinUbicar } = fallosPorRanura([
      fallo('letra sobre el color principal', 3.1),
      fallo('letra sobre el secundario', 2.4),
      fallo('letra sobre el de resalte', 1.9),
    ]);

    expect(porRanura.primary).toHaveLength(1);
    expect(porRanura.secondary).toHaveLength(1);
    expect(porRanura.accent).toHaveLength(1);
    expect(sinUbicar).toEqual([]);
  });

  it('todo lo que sale de la RAMPA señala al neutro, que es el único mando que la mueve', () => {
    // El admin no tiene un control para «el fondo» ni para «el texto de la tarjeta»:
    // `resolverTokens` los deriva del neutro con las franjas del modelo. Mandarle estos
    // fallos a cualquier otro campo sería señalar un color que no los cambia.
    const { porRanura, sinUbicar } = fallosPorRanura([
      fallo('texto base sobre el fondo', 3.9),
      fallo('texto atenuado sobre el fondo', 3.2),
      fallo('texto de la tarjeta', 4.1),
      fallo('texto de la capa flotante', 4.0),
      fallo('borde de campo sobre el fondo', 2.1, 3),
    ]);

    expect(porRanura.neutral).toHaveLength(5);
    expect(sinUbicar).toEqual([]);
  });

  it('el anillo de foco va al PRINCIPAL, aunque la frase diga «sobre el fondo»', () => {
    // `tokens.ring = colores.primary` — es el principal literal, no un derivado del
    // neutro. Éste es el único caso en el que la frase del backend despista, y es
    // justamente el que un mapeo escrito a ojo se equivocaría.
    const { porRanura } = fallosPorRanura([fallo('anillo de foco sobre el fondo', 2.2, 3)]);
    expect(porRanura.primary).toHaveLength(1);
    expect(porRanura.neutral).toBeUndefined();
  });

  it('varios fallos del mismo color se acumulan en su campo', () => {
    const { porRanura } = fallosPorRanura([
      fallo('texto base sobre el fondo', 3.9),
      fallo('texto de la tarjeta', 4.1),
    ]);
    expect(porRanura.neutral?.map((f) => f.pareja)).toEqual([
      'texto base sobre el fondo',
      'texto de la tarjeta',
    ]);
  });

  it('una pareja DESCONOCIDA no se pierde: sale por `sinUbicar`', () => {
    // La red del mapeo por texto. Si el backend renombrara una pareja o añadiera una,
    // el fallo seguiría llegando al admin con su ratio —arriba, no en el campo— en vez
    // de desaparecer sin dejar rastro. El espejo de `apps/api` es lo que impide que eso
    // ocurra en primer lugar; esto es lo que pasa si ocurre igualmente.
    const { porRanura, sinUbicar } = fallosPorRanura([fallo('una pareja que nadie mapeó', 1.2)]);
    expect(sinUbicar).toHaveLength(1);
    expect(Object.keys(porRanura)).toEqual([]);
  });

  it('sin fallos no hay nada que pintar', () => {
    expect(fallosPorRanura([])).toEqual({ porRanura: {}, sinUbicar: [] });
  });

  it('las cuatro ranuras del mapa son las cuatro configurables, y ninguna más', () => {
    expect(new Set(Object.values(COLOR_CULPABLE))).toEqual(
      new Set(['primary', 'secondary', 'accent', 'neutral']),
    );
  });
});

describe('textoDeFallo — el ratio medido, que es el dato que el admin necesita', () => {
  it('lleva el actual Y el mínimo, en el formato de la interfaz', () => {
    // Sin el mínimo al lado, un «3,1:1» no le dice a nadie si va corto o sobrado.
    expect(textoDeFallo(fallo('letra sobre el color principal', 3.1))).toBe(
      'letra sobre el color principal: 3,1:1 — necesita 4,5:1',
    );
  });

  it('el umbral de interfaz (3:1) se escribe sin decimales de relleno', () => {
    expect(textoDeFallo(fallo('anillo de foco sobre el fondo', 2.24, 3))).toBe(
      'anillo de foco sobre el fondo: 2,24:1 — necesita 3:1',
    );
  });
});

describe('tripleteAHexParaSelector — sólo para poner valor en `<input type="color">`', () => {
  it('convierte el azul del Modelo 0', () => {
    expect(tripleteAHexParaSelector('221.2 83.2% 53.3%')).toBe('#2563eb');
  });

  it('los extremos de la rampa', () => {
    expect(tripleteAHexParaSelector('0 0% 100%')).toBe('#ffffff');
    expect(tripleteAHexParaSelector('0 0% 0%')).toBe('#000000');
  });

  it('devuelve null en vez de inventar un color cuando no es un triplete', () => {
    // Enseñar un gris en el mando le haría creer al admin que ése es su color.
    expect(tripleteAHexParaSelector('#2563eb')).toBeNull();
    expect(tripleteAHexParaSelector('morado')).toBeNull();
    expect(tripleteAHexParaSelector('221.2 830% 53.3%')).toBeNull();
  });
});

describe('comoColorCss — la muestra se pinta sin pasar por ninguna conversión', () => {
  it('el triplete se envuelve en hsl()', () => {
    expect(comoColorCss('221.2 83.2% 53.3%')).toBe('hsl(221.2 83.2% 53.3%)');
  });

  it('el hexadecimal se deja tal cual, con o sin almohadilla', () => {
    expect(comoColorCss('#2563eb')).toBe('#2563eb');
    expect(comoColorCss('2563eb')).toBe('#2563eb');
  });
});
