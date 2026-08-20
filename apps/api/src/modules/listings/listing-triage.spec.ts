import {
  MANUAL_TRIAGE_TARGETS,
  isManualTriageTarget,
  triageAfterOwnerEdit,
} from './listing-triage';

/**
 * ETIQUETA INTERNA (P1) — las reglas del triaje, pinzadas en aislamiento.
 *
 * Se prueban aquí, sin base de datos, porque son decisiones puras: qué pasa al
 * editar y qué puede poner una persona a mano. El e2e comprueba que el servicio
 * las USA; esto comprueba que dicen lo que deben decir. Molde:
 * `moderacion-routing.test.ts` (M2).
 */
describe('triageAfterOwnerEdit — la única transición automática', () => {
  it('REVIEWED → EDITED: el juicio del staff acaba de caducar', () => {
    expect(triageAfterOwnerEdit('REVIEWED')).toBe('EDITED');
  });

  it('NEW se queda NEW — LA GUARDA, y es la mitad de la regla', () => {
    // Nadie lo había mirado, así que editarlo no produce información nueva.
    // Marcarlo EDITED destruiría el dato que sí sirve («sigue sin revisar»)
    // para poner uno vacío.
    expect(triageAfterOwnerEdit('NEW')).toBe('NEW');
  });

  it('EDITED se queda EDITED: ya está señalado, volver a señalarlo no añade nada', () => {
    expect(triageAfterOwnerEdit('EDITED')).toBe('EDITED');
  });

  it('es idempotente: editar dos veces seguidas no encadena estados', () => {
    expect(triageAfterOwnerEdit(triageAfterOwnerEdit('REVIEWED'))).toBe('EDITED');
    expect(triageAfterOwnerEdit(triageAfterOwnerEdit('NEW'))).toBe('NEW');
  });
});

describe('isManualTriageTarget — qué puede poner una persona', () => {
  it('REVIEWED sí: es un juicio, y los juicios son de quien modera', () => {
    expect(isManualTriageTarget('REVIEWED')).toBe(true);
  });

  it('NEW sí: es cómo se DESHACE un «revisado» puesto por error', () => {
    expect(isManualTriageTarget('NEW')).toBe(true);
  });

  it('EDITED NO: afirma un HECHO que sólo el sistema puede saber', () => {
    // «El dueño cambió esto después de que lo revisaran» no es una opinión.
    expect(isManualTriageTarget('EDITED')).toBe(false);
  });

  it('el conjunto manual son exactamente esos dos', () => {
    expect([...MANUAL_TRIAGE_TARGETS].sort()).toEqual(['NEW', 'REVIEWED']);
  });
});

describe('la ortogonalidad, vista desde el fichero', () => {
  it('el CÓDIGO del triaje no conoce ningún estado de anuncio', async () => {
    // Si algún día hace falta importar `ListingStatus` aquí, es la señal de que
    // los dos ejes se están fundiendo. Este test es lo que hace que se note.
    //
    // Se miran las LÍNEAS DE CÓDIGO, no el fichero entero: la cabecera nombra
    // `ListingStatus` y `PENDING_REVIEW` a propósito, para explicar de qué hay
    // que mantener esto separado. Prohibir la palabra en la prosa castigaría
    // justo al comentario que defiende la regla.
    const fs = await import('fs/promises');
    const fuente = await fs.readFile(`${__dirname}/listing-triage.ts`, 'utf8');
    const codigo = fuente
      .replace(/\/\*[\s\S]*?\*\//g, '') // bloques /* */ y /** */
      .replace(/\/\/.*$/gm, ''); // líneas //

    expect(codigo).not.toMatch(/ListingStatus/);
    expect(codigo).not.toMatch(/PENDING_REVIEW|needsRevalidation/);
    // Y lo que sí debe conocer, para que el test no pase por estar vacío.
    expect(codigo).toMatch(/ListingTriage/);
  });
});
