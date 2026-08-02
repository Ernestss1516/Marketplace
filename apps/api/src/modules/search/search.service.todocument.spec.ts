/**
 * B2 — ORDEN DE LOS CAMPOS en `toDocument`.
 *
 * Los atributos de categoría se esparcen PRIMERO y los campos core se emiten DESPUÉS,
 * para que un atributo que reutilice un nombre reservado no pueda pisar el campo real
 * del documento. `tags`/`tagNames` entran en esa lista con B2.
 *
 * Es un test UNITARIO a propósito. El orden de las claves de un objeto literal es
 * lógica pura y determinista; comprobarlo a través de un e2e (crear → publicar → cola
 * BullMQ → Meilisearch → getDocument) mete tres asíncronos por medio y hace que el
 * resultado dependa de cuándo se lea el documento. Se descubrió ejerciéndolo: la
 * validación por mutación (emitir `tags` ANTES del spread) salía VERDE o ROJA según
 * los milisegundos que tardara el test en llegar a la aserción. Aquí no hay carrera
 * posible: si alguien mueve `tags` arriba del spread, esto se pone rojo siempre.
 */

import { SearchService } from './search.service';

/** Lo mínimo que `toDocument` toca. El resto de campos no intervienen en el orden. */
function fakeListing(overrides: Record<string, unknown> = {}) {
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
    entitlements: [],
    seller: { name: 'Vendedor', slug: 'vendedor', avatarUrl: null },
    tags: [
      { tag: { slug: 'cambio-automatico', name: 'Cambio automático' } },
      { tag: { slug: 'garantia', name: 'Con garantía' } },
    ],
    ...overrides,
  };
}

/** `toDocument` es privado: se invoca por su nombre, que es lo que se está probando. */
function toDocument(listing: unknown): Record<string, unknown> {
  const service = Object.create(SearchService.prototype) as {
    toDocument: (l: unknown) => Record<string, unknown>;
  };
  return service.toDocument(listing);
}

describe('SearchService.toDocument — los campos core ganan a los atributos', () => {
  it('emite tags y tagNames desde las etiquetas del anuncio', () => {
    const doc = toDocument(fakeListing());
    expect(doc.tags).toEqual(['cambio-automatico', 'garantia']);
    expect(doc.tagNames).toEqual(['Cambio automático', 'Con garantía']);
  });

  it('un atributo llamado `tags` NO pisa los slugs de las etiquetas', () => {
    const doc = toDocument(fakeListing({ attributes: { tags: 'valor-del-atributo' } }));
    expect(doc.tags).toEqual(['cambio-automatico', 'garantia']);
  });

  it('un atributo llamado `tagNames` tampoco pisa los nombres', () => {
    const doc = toDocument(fakeListing({ attributes: { tagNames: 'otra-cosa' } }));
    expect(doc.tagNames).toEqual(['Cambio automático', 'Con garantía']);
  });

  it('la misma protección que ya tenían los campos core de siempre', () => {
    // `type` es el caso histórico (la colisión type/itemType del seed): sirve de
    // control de que este test mide el orden y no algo específico de los tags.
    const doc = toDocument(fakeListing({ attributes: { type: 'PISADO', price: 999 } }));
    expect(doc.type).toBe('PRODUCT');
    expect(doc.price).toBe(1000);
  });

  it('un anuncio SIN etiquetas emite arrays vacíos, no undefined', () => {
    // Un `undefined` no viajaría en el JSON y el documento se quedaría sin el campo,
    // que no es lo mismo que "sin etiquetas" a la hora de filtrar.
    const doc = toDocument(fakeListing({ tags: [] }));
    expect(doc.tags).toEqual([]);
    expect(doc.tagNames).toEqual([]);
  });
});
