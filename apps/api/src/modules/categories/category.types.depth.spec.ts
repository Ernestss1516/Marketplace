import {
  CATEGORY_MAX_DEPTH,
  resolveEffectiveSchema,
  resolveEffectivePolicy,
  resolveEffectiveViews,
  resolveEffectivePriceUnits,
  type AttributeField,
  type EffectiveViews,
} from './category.types';
import { resolveEffectiveTags, type TagRef } from '../tags/tag.types';
import type { ListingTypePolicy, ListingViewMode, PriceUnit } from '@prisma/client';

/**
 * PROFUNDIDAD N — RÁFAGA 1. FIXTURE PURO de 4 niveles.
 *
 * POR QUÉ EXISTE ESTE FICHERO, Y POR QUÉ 4 NIVELES Y NO 2.
 *
 * El riesgo central de pasar a N niveles (R1 de la auditoría) es que una
 * resolución se quede subiendo UN nivel cuando debería subir N. Ese fallo **no
 * da ningún error**: el bisnieto simplemente no hereda del abuelo, en silencio.
 *
 * Y aquí está lo importante: **con datos de 2 niveles ese fallo es invisible**.
 * Para una hija, «fusionar con el padre» y «plegar la cadena» dan EXACTAMENTE
 * el mismo resultado, así que ninguna prueba escrita sobre 2 niveles puede
 * distinguir una implementación correcta de una rota. Hace falta un abuelo y un
 * bisabuelo para que las dos cosas dejen de coincidir. Eso es lo único que
 * aporta este fichero, y es la razón de que exista.
 *
 * Este es el fixture PURO: objetos en memoria, sin BD. Prueba el PLIEGUE en sí
 * —que las 5 funciones, aplicadas en cadena, componen bien—. Su hermano de BD
 * (`test/helpers/deep-category-tree.ts` + `test/category-depth.e2e-spec.ts`)
 * prueba lo que este no puede: que la cadena se carga bien de Postgres y que
 * llega hasta el documento indexado y la API.
 *
 * Molde: `category.types.spec.ts`, que ya prueba estas mismas funciones de
 * forma pura. Este fichero añade el eje que allí no existe: la profundidad.
 */

// ---------------------------------------------------------------------------
// El fixture: raíz → hijo → nieto → bisnieto, con configuración en CADA nivel
// ---------------------------------------------------------------------------

interface NodoFixture {
  attributeSchema: AttributeField[];
  allowedListingType: ListingTypePolicy;
  allowedViews: ListingViewMode[];
  defaultView: ListingViewMode | null;
  allowedPriceUnits: PriceUnit[];
  tags: TagRef[];
}

const attr = (name: string, label: string, extra: Partial<AttributeField> = {}): AttributeField => ({
  name,
  label,
  type: 'text',
  filterable: false,
  required: false,
  ...extra,
});

const tag = (slug: string): TagRef => ({ id: `tag-${slug}`, slug, name: slug });

/** RAÍZ (nivel 1) — «Vehículos». Pone lo genérico. */
const raiz: NodoFixture = {
  attributeSchema: [
    attr('deRaiz', 'Sólo de la raíz'),
    attr('redefinido', 'Etiqueta de la RAÍZ'),
  ],
  allowedListingType: 'PRODUCT_ONLY', // restringe desde arriba
  allowedViews: [],
  defaultView: null,
  allowedPriceUnits: [],
  tags: [tag('de-raiz')],
};

/** NIVEL 2 — «Coches». Configura vistas y formatos; no toca la política. */
const nivel2: NodoFixture = {
  attributeSchema: [attr('deNivel2', 'Sólo del nivel 2')],
  allowedListingType: 'BOTH', // neutro: no contradice a la raíz
  allowedViews: ['LISTA', 'MAPA'],
  defaultView: 'MAPA',
  allowedPriceUnits: ['PER_MONTH'],
  tags: [tag('de-nivel2')],
};

/** NIVEL 3 — «Deportivos». REDEFINE un atributo de la raíz. */
const nivel3: NodoFixture = {
  attributeSchema: [
    attr('deNivel3', 'Sólo del nivel 3'),
    attr('redefinido', 'Etiqueta del NIVEL 3'),
  ],
  allowedListingType: 'BOTH',
  allowedViews: [],
  defaultView: null,
  allowedPriceUnits: [],
  tags: [tag('de-nivel3')],
};

/** NIVEL 4 — «Clásicos», la hoja. Lo más específico. */
const bisnieto: NodoFixture = {
  attributeSchema: [attr('deBisnieto', 'Sólo del bisnieto')],
  allowedListingType: 'BOTH',
  allowedViews: [],
  defaultView: null,
  allowedPriceUnits: [],
  tags: [tag('de-bisnieto')],
};

/** La cadena tal y como la sirve `CategoryTreeService`: RAÍZ → HOJA. */
const cadena: NodoFixture[] = [raiz, nivel2, nivel3, bisnieto];

// ---------------------------------------------------------------------------
// Los pliegues, escritos igual que en los llamantes de producción
// ---------------------------------------------------------------------------

const plegarSchema = (c: NodoFixture[]) =>
  c.reduce<AttributeField[]>((acc, n) => resolveEffectiveSchema(n.attributeSchema, acc), []);

const plegarPolitica = (c: NodoFixture[]) =>
  c.reduce<ListingTypePolicy>((acc, n) => resolveEffectivePolicy(n.allowedListingType, acc), 'BOTH');

const plegarVistas = (c: NodoFixture[]) =>
  c.reduce<EffectiveViews | null>(
    (acc, n) => resolveEffectiveViews({ allowedViews: n.allowedViews, defaultView: n.defaultView }, acc),
    null,
  ) as EffectiveViews;

const plegarFormatos = (c: NodoFixture[]) =>
  c.reduce<PriceUnit[] | null>((acc, n) => resolveEffectivePriceUnits(n.allowedPriceUnits, acc), null) as PriceUnit[];

/** Los tags se pliegan de la HOJA hacia la raíz (lo más específico primero). */
const plegarTags = (c: NodoFixture[]) =>
  [...c].reverse().reduce<TagRef[]>((acc, n) => resolveEffectiveTags(acc, n.tags), []);

// ---------------------------------------------------------------------------

describe('Herencia N niveles — el pliegue de las 5 resoluciones (fixture puro de 4 niveles)', () => {
  describe('R1 — lo que sólo se ve con más de 2 niveles', () => {
    it('[1] el BISNIETO hereda un atributo definido sólo en la RAÍZ', () => {
      // LA aserción de R1: con una resolución de un salto, `deRaiz` no llega.
      const efectivo = plegarSchema(cadena);
      expect(efectivo.map((f) => f.name)).toContain('deRaiz');
    });

    it('[1b] el bisnieto acumula los atributos de los CUATRO niveles', () => {
      expect(plegarSchema(cadena).map((f) => f.name).sort()).toEqual(
        ['deBisnieto', 'deNivel2', 'deNivel3', 'deRaiz', 'redefinido'].sort(),
      );
    });

    it('[2] un atributo redefinido en el NIVEL 3 pisa al de la raíz para el nivel 4', () => {
      const redefinido = plegarSchema(cadena).find((f) => f.name === 'redefinido');
      expect(redefinido?.label).toBe('Etiqueta del NIVEL 3');
      // Y no está dos veces: el pliegue deduplica por `name`, no concatena.
      expect(plegarSchema(cadena).filter((f) => f.name === 'redefinido')).toHaveLength(1);
    });

    it('[3] una política restringida en la RAÍZ alcanza al bisnieto', () => {
      // Los niveles 2-4 son BOTH (neutro): la restricción del abuelo sobrevive.
      expect(plegarPolitica(cadena)).toBe('PRODUCT_ONLY');
    });

    it('[4] vistas y formatos del NIVEL 2 ganan al default global en el nivel 4', () => {
      // Ni el 3 ni el 4 configuran nada: hereda de dos niveles más arriba.
      expect(plegarVistas(cadena)).toEqual({ allowedViews: ['LISTA', 'MAPA'], defaultView: 'MAPA' });
      expect(plegarFormatos(cadena)).toEqual(['PER_MONTH']);
    });

    it('[5] los tags del bisnieto incluyen los 4 niveles, de lo específico a lo general', () => {
      expect(plegarTags(cadena).map((t) => t.slug)).toEqual([
        'de-bisnieto',
        'de-nivel3',
        'de-nivel2',
        'de-raiz',
      ]);
    });
  });

  describe('Retrocompatibilidad — el pliegue NO cambia nada para 2 niveles', () => {
    // Esta es la otra mitad del contrato de la ráfaga: efecto visible cero.
    // Se compara el pliegue contra la invocación de dos pasos que había antes.
    const dosNiveles = [raiz, nivel2];

    it('schema: plegar [raíz, hija] == fusionar la hija con el schema de la raíz', () => {
      const antes = resolveEffectiveSchema(nivel2.attributeSchema, raiz.attributeSchema);
      expect(plegarSchema(dosNiveles)).toEqual(antes);
    });

    it('política: plegar == resolver la hija contra el efectivo de la raíz', () => {
      const raizEfectiva = resolveEffectivePolicy(raiz.allowedListingType, 'BOTH');
      const antes = resolveEffectivePolicy(nivel2.allowedListingType, raizEfectiva);
      expect(plegarPolitica(dosNiveles)).toEqual(antes);
    });

    it('vistas: plegar == el two-step (padre contra null, hija contra el padre)', () => {
      const padre = resolveEffectiveViews(
        { allowedViews: raiz.allowedViews, defaultView: raiz.defaultView },
        null,
      );
      const antes = resolveEffectiveViews(
        { allowedViews: nivel2.allowedViews, defaultView: nivel2.defaultView },
        padre,
      );
      expect(plegarVistas(dosNiveles)).toEqual(antes);
    });

    it('formatos: plegar == el two-step', () => {
      const padre = resolveEffectivePriceUnits(raiz.allowedPriceUnits, null);
      const antes = resolveEffectivePriceUnits(nivel2.allowedPriceUnits, padre);
      expect(plegarFormatos(dosNiveles)).toEqual(antes);
    });

    it('tags: plegar == resolveEffectiveTags(propios, del padre)', () => {
      const antes = resolveEffectiveTags(nivel2.tags, raiz.tags);
      expect(plegarTags(dosNiveles)).toEqual(antes);
    });

    it('una RAÍZ sola resuelve exactamente como antes', () => {
      expect(plegarSchema([raiz])).toEqual(raiz.attributeSchema);
      expect(plegarPolitica([raiz])).toBe('PRODUCT_ONLY');
      expect(plegarFormatos([raiz])).toEqual(['ONE_TIME']); // el default global
      expect(plegarVistas([raiz])).toEqual({
        allowedViews: ['LISTA', 'AMPLIADA', 'MAPA'],
        defaultView: 'LISTA',
      });
    });
  });

  describe('La constante del tope', () => {
    it('CATEGORY_MAX_DEPTH vale 4 y NO es el NAV_MAX_DEPTH del menú (que vale 2)', () => {
      expect(CATEGORY_MAX_DEPTH).toBe(4);
    });

    it('el fixture ejercita exactamente la profundidad máxima', () => {
      // Si alguien sube el tope, este fixture deja de cubrir el caso límite.
      expect(cadena).toHaveLength(CATEGORY_MAX_DEPTH);
    });
  });
});
