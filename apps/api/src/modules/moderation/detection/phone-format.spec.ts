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

    // LO QUE SE VIGILA ES LA FORMA DE UNA ESCRITURA: el teléfono que se guarda viene SIEMPRE
    // de la entrada del usuario — `dto.phone` al crear, `fields.phone` al editar—, y ésas son
    // las dos únicas fuentes posibles. Una escritura futura vendría igual de un DTO.
    //
    // DOS INTENTOS ANTERIORES FALLARON, y se dejan escritos porque explican esta forma:
    //
    //   · acotar a `prisma.listing.create(` dejó la barrera SIN DIENTES —el alta no escribe
    //     por ahí sino por `createWithUniqueSlug`, que recibe el `data` ya construido—, y la
    //     mutación pasó. Una barrera que no cae con su propia mutación no vale nada;
    //   · mirar TODA línea con `phone:` daba falsos positivos con las LECTURAS: el argumento
    //     `DetectableText` del motor (A2) y el `return { phone }` de `getPhone`. Una barrera
    //     que grita sin motivo acaba desactivada, que es como mueren.
    //
    // Lo que NO cubre, y conviene saberlo: una escritura que copiara el teléfono de otra
    // variable (`phone: otroAnuncio.phone`). No es el fallo probable —el probable es volver a
    // guardar lo que llega del DTO— y cubrirlo exigiría analizar el fichero de verdad.
    const escriturasDesdeElDto = fuente
      .split('\n')
      .filter((l) => /phone:\s*(dto|fields)\./.test(l));

    expect(escriturasDesdeElDto).toEqual([]);
    // Y el emisor compartido se usa en LOS DOS caminos. Se afirma sobre las llamadas
    // concretas y no sobre cuántas veces aparece el nombre: contar ocurrencias también
    // cuenta las de los comentarios, y un test que se rompe al escribir un comentario es un
    // test que acaba borrado.
    expect(fuente).toContain('camposDeTelefono(dto.phone)');
    expect(fuente).toContain('camposDeTelefono(fields.phone)');
  });
});
