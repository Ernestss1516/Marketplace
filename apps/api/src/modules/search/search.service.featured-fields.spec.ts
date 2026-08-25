/**
 * ROTACIÓN DE DESTACADOS — R1: las dos marcas de tiempo del destacado en el documento.
 *
 * QUÉ SE FIJA AQUÍ Y POR QUÉ AQUÍ. `featuredStartsAt`/`featuredExpiresAt` salen del
 * entitlement vigente en el momento de indexar, y esa correspondencia es lógica pura: dado
 * un anuncio y un instante, el documento es uno y sólo uno. Probarlo por e2e metería la cola
 * de BullMQ y Meilisearch por medio y haría depender el resultado de cuándo se lea el
 * documento — el falso verde que ya se pagó una vez con los tags (ver
 * search.service.todocument.spec.ts). El e2e comprueba lo que sólo él puede comprobar (que
 * los campos llegan al índice REAL); el reparto de responsabilidades es ése.
 *
 * LAS MUTACIONES QUE ESTO MATA:
 *  · emitir los campos sólo cuando hay destacado (en vez de `null`) → Meilisearch
 *    distingue "nulo" de "ausente", y R2 filtraría con la sintaxis equivocada;
 *  · sacar las fechas de un entitlement caducado o revocado;
 *  · dejar que `boostScore` y las marcas de tiempo cuenten historias distintas;
 *  · quedarse con el primer candidato en vez de elegir, que haría depender el documento del
 *    orden en que Postgres devuelva las filas.
 */

import { SearchService, INDEX_INCLUDE, featuredVigente } from './search.service';

const ARBOL_DE_UN_NODO = new Map([
  [
    'cat-1',
    {
      id: 'cat-1',
      slug: 'coches',
      name: 'Coches',
      parentId: null,
      attributeSchema: [],
      allowedListingType: 'BOTH' as const,
      allowedViews: [],
      defaultView: null,
      allowedPriceUnits: [],
    },
  ],
]);

function fakeListing(entitlements: unknown[]) {
  return {
    id: 'listing-1',
    title: 'Coche gris',
    description: 'Descripción',
    price: { toString: () => '1000' },
    currency: 'EUR',
    priceType: 'FIXED',
    priceUnit: 'ONE_TIME',
    type: 'PRODUCT',
    condition: 'GOOD',
    slug: 'coche-gris',
    sellerId: 'seller-1',
    latitude: null,
    longitude: null,
    province: 'Madrid',
    city: 'Madrid',
    publishedAt: new Date('2026-01-01T00:00:00Z'),
    bumpedAt: null,
    attributes: {},
    category: { id: 'cat-1', slug: 'coches', name: 'Coches', parent: null },
    images: [],
    entitlements,
    seller: { name: 'Vendedor', slug: 'vendedor', avatarUrl: null },
    tags: [],
  };
}

/** `toDocument` es privado: se invoca por su nombre, que es lo que se está probando. */
function toDocument(entitlements: unknown[]): Record<string, unknown> {
  const service = Object.create(SearchService.prototype) as {
    toDocument: (l: unknown, arbol: unknown) => Record<string, unknown>;
  };
  return service.toDocument(fakeListing(entitlements), ARBOL_DE_UN_NODO);
}

const EN_UNA_SEMANA = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const HACE_UNA_HORA = new Date(Date.now() - 60 * 60 * 1000);
const CONCEDIDO = new Date('2026-08-20T10:00:00Z');

describe('toDocument — las marcas de tiempo del destacado (R1)', () => {
  it('un destacado vigente deja su concesión y su fin en el documento, en segundos', () => {
    const doc = toDocument([{ startsAt: CONCEDIDO, expiresAt: EN_UNA_SEMANA }]);

    expect(doc.boostScore).toBe(1);
    expect(doc.featuredStartsAt).toBe(Math.floor(CONCEDIDO.getTime() / 1000));
    expect(doc.featuredExpiresAt).toBe(Math.floor(EN_UNA_SEMANA.getTime() / 1000));
  });

  it('SEGUNDOS, no milisegundos — la unidad con la que R2 comparará contra el reloj', () => {
    // Un descuido de mil aquí no rompe nada visible en R1 y en R2 haría que TODOS los
    // destacados parecieran caducados (o ninguno). Se fija en la ráfaga que crea el campo.
    const doc = toDocument([{ startsAt: CONCEDIDO, expiresAt: EN_UNA_SEMANA }]);
    const segundos = doc.featuredStartsAt as number;

    expect(segundos).toBe(1_787_220_000); // 2026-08-20T10:00:00Z, comprobado aparte
    expect(String(segundos)).toHaveLength(10);
  });

  it('sin destacado los campos son NULL, no ausentes', () => {
    // La diferencia importa: en Meilisearch `campo IS NULL` casa con los nulos explícitos,
    // pero un atributo que no viaja en el JSON necesita `NOT campo EXISTS`. Si esto se
    // relaja, R2 tendría que escribir un filtro distinto — o vaciar el bloque sin avisar.
    const doc = toDocument([]);

    expect(doc.boostScore).toBe(0);
    expect(doc.featuredStartsAt).toBeNull();
    expect(doc.featuredExpiresAt).toBeNull();
    expect('featuredStartsAt' in doc).toBe(true);
    expect('featuredExpiresAt' in doc).toBe(true);
  });

  it('un destacado CADUCADO no deja marcas: ni destaca ni entra en el anillo', () => {
    const doc = toDocument([{ startsAt: CONCEDIDO, expiresAt: HACE_UNA_HORA }]);

    expect(doc.boostScore).toBe(0);
    expect(doc.featuredStartsAt).toBeNull();
    expect(doc.featuredExpiresAt).toBeNull();
  });

  it('un destacado SIN caducidad destaca y entra en el anillo, con fin nulo', () => {
    // `Entitlement.expiresAt` nulo está previsto en el esquema (créditos manuales de
    // soporte). `featuredExpiresAt: null` significa aquí "no caduca", y no se confunde con
    // "no destacado" porque quien pregunte por la vigencia lo hará con boostScore = 1
    // delante.
    const doc = toDocument([{ startsAt: CONCEDIDO, expiresAt: null }]);

    expect(doc.boostScore).toBe(1);
    expect(doc.featuredStartsAt).toBe(Math.floor(CONCEDIDO.getTime() / 1000));
    expect(doc.featuredExpiresAt).toBeNull();
  });

  it('boostScore y featuredStartsAt cuentan SIEMPRE la misma historia', () => {
    // La incoherencia que esto prohíbe: un documento destacado que R2 no sabría dónde
    // colocar en el anillo, o un no-destacado con fecha de turno.
    for (const entitlements of [
      [],
      [{ startsAt: CONCEDIDO, expiresAt: HACE_UNA_HORA }],
      [{ startsAt: CONCEDIDO, expiresAt: EN_UNA_SEMANA }],
      [{ startsAt: CONCEDIDO, expiresAt: null }],
    ]) {
      const doc = toDocument(entitlements);
      expect(doc.boostScore === 1).toBe(doc.featuredStartsAt !== null);
    }
  });
});

describe('featuredVigente — elegir no es quedarse con el primero', () => {
  const AHORA = new Date('2026-08-25T12:00:00Z');
  const CORTO = { startsAt: CONCEDIDO, expiresAt: new Date('2026-08-26T12:00:00Z') };
  const LARGO = { startsAt: CONCEDIDO, expiresAt: new Date('2026-09-30T12:00:00Z') };
  const PERMANENTE = { startsAt: CONCEDIDO, expiresAt: null };
  const CADUCADO = { startsAt: CONCEDIDO, expiresAt: new Date('2026-08-01T12:00:00Z') };

  it('gana el que mantiene destacado el anuncio más tiempo, venga en el orden que venga', () => {
    expect(featuredVigente([CORTO, LARGO], AHORA)).toBe(LARGO);
    expect(featuredVigente([LARGO, CORTO], AHORA)).toBe(LARGO);
  });

  it('el que no caduca gana a cualquiera, venga en el orden que venga', () => {
    expect(featuredVigente([PERMANENTE, LARGO], AHORA)).toBe(PERMANENTE);
    expect(featuredVigente([LARGO, PERMANENTE], AHORA)).toBe(PERMANENTE);
  });

  it('los caducados no compiten', () => {
    expect(featuredVigente([CADUCADO], AHORA)).toBeNull();
    expect(featuredVigente([CADUCADO, CORTO], AHORA)).toBe(CORTO);
  });

  it('sin candidatos, null', () => {
    expect(featuredVigente([], AHORA)).toBeNull();
  });
});

describe('INDEX_INCLUDE — el dato viaja en el include que YA se cargaba', () => {
  it('pide startsAt y expiresAt del entitlement, y sólo eso', () => {
    // BARRERA "sin consulta extra", en su forma estructural: la fecha de concesión llega
    // al documento porque se pide UNA COLUMNA MÁS de unas filas que ya viajaban desde
    // RF.8, no porque alguien consulte la tabla al construir el documento. El e2e lo
    // confirma contando las lecturas reales; esto lo fija donde se decide.
    expect(INDEX_INCLUDE.entitlements.select).toEqual({ startsAt: true, expiresAt: true });
    expect(INDEX_INCLUDE.entitlements.where).toEqual({
      type: 'FEATURED_LISTING',
      revokedAt: null,
    });
  });
});
