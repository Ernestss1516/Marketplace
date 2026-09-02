import { ValidationError } from '@nestjs/common';
import { fabricaDeErroresDeValidacion, traducirErroresDeValidacion } from './validacion-mensajes';

/**
 * i18n T5 — BARRERA 4: los rechazos de DTO, en español.
 *
 * Los mensajes ingleses de entrada NO están inventados: son los que produce `class-validator`
 * de verdad, copiados de una ejecución real (`{ isNotEmpty: 'title should not be empty',
 * maxLength: 'title must be shorter than or equal to 120 characters' }`). Si la librería
 * cambiara su redacción, los anclajes de extracción dejarían de casar — y entonces el
 * mensaje sale sin el número, que es el modo de fallo elegido a propósito: incompleto pero
 * cierto, nunca un número inventado. Los tres últimos casos vigilan justo eso.
 */

function error(property: string, constraints: Record<string, string>, children: ValidationError[] = []) {
  return { property, constraints, children } as ValidationError;
}

describe('Traducción de los rechazos de DTO', () => {
  it('las reglas de presencia', () => {
    expect(traducirErroresDeValidacion([error('title', { isNotEmpty: 'title should not be empty' })]))
      .toEqual(['«title» no puede estar vacío']);
  });

  it('los tipos', () => {
    expect(
      traducirErroresDeValidacion([
        error('title', { isString: 'title must be a string' }),
        error('price', { isInt: 'price must be an integer number' }),
        error('activo', { isBoolean: 'activo must be a boolean value' }),
      ]),
    ).toEqual([
      '«title» tiene que ser texto',
      '«price» tiene que ser un número entero',
      '«activo» tiene que ser verdadero o falso',
    ]);
  });

  it('los rangos y las longitudes CONSERVAN el número del mensaje original', () => {
    // Es la mitad útil del mensaje: «no puede ser menor que» a secas no le dice a nadie
    // cuál es el mínimo.
    expect(
      traducirErroresDeValidacion([
        error('price', { min: 'price must not be less than 0' }),
        error('price', { max: 'price must not be greater than 999999' }),
        error('title', { maxLength: 'title must be shorter than or equal to 120 characters' }),
        error('title', { minLength: 'title must be longer than or equal to 3 characters' }),
        error('tags', { arrayMaxSize: 'tags must contain no more than 5 elements' }),
        error('tags', { arrayMinSize: 'tags must contain at least 1 elements' }),
      ]),
    ).toEqual([
      '«price» no puede ser menor que 0',
      '«price» no puede ser mayor que 999999',
      '«title» no puede tener más de 120 caracteres',
      '«title» tiene que tener al menos 3 caracteres',
      '«tags» no puede tener más de 5 elementos',
      '«tags» tiene que tener al menos 1 elementos',
    ]);
  });

  it('los conjuntos cerrados conservan los valores admitidos SIN traducirlos', () => {
    // Son valores del contrato de la API, no texto para leer: traducirlos daría un mensaje
    // bonito con el que no se puede corregir la petición.
    expect(
      traducirErroresDeValidacion([
        error('status', { isEnum: 'status must be one of the following values: ACTIVE, PAUSED' }),
      ]),
    ).toEqual(['«status» tiene que ser uno de estos valores: ACTIVE, PAUSED']);
  });

  it('el campo que SOBRA (forbidNonWhitelisted) se distingue del campo mal puesto', () => {
    expect(traducirErroresDeValidacion([error('inventado', { whitelistValidation: 'property inventado should not exist' })]))
      .toEqual(['«inventado» no es un campo admitido']);
  });

  it('los errores ANIDADOS dicen el camino entero, no sólo la raíz', () => {
    // Con `@ValidateNested` (25 usos) un fallo dentro de un bloque de portada saldría como
    // «blocks no es válido» sin decir cuál ni por qué.
    const anidado = error('blocks', {}, [
      error('0', {}, [error('title', { isNotEmpty: 'title should not be empty' })]),
    ]);
    expect(traducirErroresDeValidacion([anidado])).toEqual(['«blocks.0.title» no puede estar vacío']);
  });

  it('una regla DESCONOCIDA se deja pasar tal cual', () => {
    // Los validadores propios del proyecto (`IsSafeContentUrl`, `IsFiscalTaxId`…) ya escriben
    // en español en su `defaultMessage()`. Pisarlos con un genérico sería empeorarlos.
    const propio = '«coverUrl» debe ser una URL de nuestro propio almacenamiento (subida vía upload)';
    expect(traducirErroresDeValidacion([error('coverUrl', { isOwnStorageUrl: propio })])).toEqual([propio]);
  });

  /**
   * LA REGRESIÓN QUE ESTA SUITE NO VIO Y EL e2e SÍ, fijada aquí para que no vuelva.
   *
   * La primera versión traducía por NOMBRE de regla y nada más, así que pisaba los 11 DTOs
   * que ya llevan un `message:` escrito a mano en español. `homepage.e2e-spec.ts` lo cazó:
   * «Cada tarjeta de la rejilla necesita una imagen o un icono.» se convertía en
   * «"blocks.0.items.0.media" es obligatorio» — correcto, genérico y PEOR.
   *
   * Ahora cada regla tiene que reconocer además el texto DE FÁBRICA. Lo que no lo sea, es de
   * alguien y no se toca.
   */
  it('un `message:` propio del DTO NO se pisa, aunque su regla esté mapeada', () => {
    const propio = 'Cada tarjeta de la rejilla necesita una imagen o un icono.';
    expect(traducirErroresDeValidacion([error('media', { isDefined: propio })])).toEqual([propio]);
  });

  it('y tampoco un `message:` propio en una regla con argumentos', () => {
    const propio = 'El título no puede pasar de 120 caracteres, que es lo que cabe en la tarjeta.';
    expect(traducirErroresDeValidacion([error('title', { maxLength: propio })])).toEqual([propio]);
  });

  it('si `class-validator` cambiara su redacción, el mensaje pasa TAL CUAL', () => {
    // El modo de fallo elegido: se pierde la traducción de esa regla —se ve en inglés, como
    // hoy— pero nunca se emite una frase con un número inventado, y el rechazo se produce
    // igual. Degradar a lo que había, nunca a algo falso.
    const raro = 'price is too small';
    expect(traducirErroresDeValidacion([error('price', { min: raro })])).toEqual([raro]);
  });

  it('un número en el NOMBRE del campo no se confunde con el límite', () => {
    // La razón de que los anclajes sean específicos de cada regla y no un `\d+` suelto.
    expect(traducirErroresDeValidacion([error('nivel3', { maxLength: 'nivel3 must be shorter than or equal to 40 characters' })]))
      .toEqual(['«nivel3» no puede tener más de 40 caracteres']);
  });

  it('varias reglas del mismo campo salen todas', () => {
    expect(
      traducirErroresDeValidacion([
        error('title', {
          isNotEmpty: 'title should not be empty',
          maxLength: 'title must be shorter than or equal to 120 characters',
        }),
      ]),
    ).toHaveLength(2);
  });
});

describe('La fábrica conserva la FORMA que el frontend espera', () => {
  it('devuelve un 400 con `message` como ARRAY', () => {
    // `client.ts` hace `String(body.message)`; con un array lo une por comas. Cambiar la
    // forma a una cadena única cambiaría lo que lee el admin, aunque el idioma fuera el
    // correcto. Lo único que esta ráfaga cambia es el IDIOMA.
    const ex = fabricaDeErroresDeValidacion([error('title', { isNotEmpty: 'title should not be empty' })]);
    const body = ex.getResponse() as { statusCode: number; message: unknown };

    expect(ex.getStatus()).toBe(400);
    expect(Array.isArray(body.message)).toBe(true);
    expect(body.message).toEqual(['«title» no puede estar vacío']);
  });
});
