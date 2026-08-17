import {
  applicableSchemaFor,
  collectAttributeIssues,
  invalidValueIssues,
  linkedSelectIssues,
  missingRequiredNames,
  unknownAttributeKeys,
} from './attribute-validation';
import type { AttributeField } from './category.types';
import type { CategoryNode } from './category-tree.service';

/**
 * PUERTA — RÁFAGA 2. Los validadores COMPARTIDOS.
 *
 * QUÉ CUBRE ESTE SPEC Y QUÉ NO. Que `create()` y `update()` sigan comportándose
 * igual lo prueban las suites e2e que ya existían y NO se han tocado
 * (`listing-attributes-strict-validation`, `linked-select-attributes`,
 * `listing-attributes-applies-to`): son ellas las que fijan los mensajes y los
 * 422 del alta. Aquí se prueba lo que esas no pueden ver, porque antes no
 * existía: la forma NUEVA de preguntar —todos los motivos de una vez— y el par
 * «plegar + filtrar» que la puerta necesita para no divergir del alta.
 */

const campo = (
  name: string,
  extra: Partial<AttributeField> = {},
): AttributeField => ({
  name,
  label: name.toUpperCase(),
  type: 'text',
  filterable: false,
  required: false,
  ...extra,
} as AttributeField);

const nodo = (id: string, parentId: string | null, schema: AttributeField[]): CategoryNode => ({
  id,
  slug: id,
  name: id,
  parentId,
  attributeSchema: schema,
  allowedListingType: 'BOTH',
  allowedViews: [],
  defaultView: null,
  allowedPriceUnits: [],
  // MODERACIÓN M1 — mantenimiento de fixture: `CategoryNode` ganó un campo. Este
  // spec va de atributos, que no lo miran.
  requiresReview: false,
});

describe('attribute-validation — los detectores, uno a uno', () => {
  const schema: AttributeField[] = [
    campo('year', { type: 'number', required: true }),
    campo('fuel', { type: 'select', options: ['gasolina', 'diesel'] }),
    campo('garantia', { type: 'boolean' }),
    campo('modelo', { type: 'select', dependsOn: 'fuel', optionsByParent: { diesel: ['tdi'] } }),
  ];

  it('requerido presente vs ausente', () => {
    expect(missingRequiredNames({ year: 2020 }, schema)).toEqual([]);
    expect(missingRequiredNames({}, schema)).toEqual(['year']);
  });

  it('la PRESENCIA basta para el requerido, aunque el valor sea vacío', () => {
    // Comportamiento heredado y deliberado: cambiarlo rompería anuncios
    // existentes con la clave puesta a ''. Queda fijado aquí para que un
    // «arreglo» futuro tenga que enfrentarse a un test rojo.
    expect(missingRequiredNames({ year: '' }, schema)).toEqual([]);
  });

  it('claves huérfanas', () => {
    expect(unknownAttributeKeys({ year: 1, inventado: 'x' }, schema)).toEqual(['inventado']);
  });

  it('valores: opción, número y booleano', () => {
    expect(invalidValueIssues({ fuel: 'diesel', year: '2020', garantia: 'true' }, schema)).toEqual([]);
    expect(invalidValueIssues({ fuel: 'queroseno' }, schema)).toHaveLength(1);
    expect(invalidValueIssues({ year: 'hace mucho' }, schema)).toHaveLength(1);
    expect(invalidValueIssues({ garantia: 'quizá' }, schema)).toHaveLength(1);
  });

  it('los vinculados NO los mira el detector de valores (asimetría heredada)', () => {
    // `modelo` es un select con opciones por padre: si `invalidValueIssues` lo
    // mirase, lo daría por inválido SIEMPRE (no tiene `options` planas).
    expect(invalidValueIssues({ fuel: 'diesel', modelo: 'tdi' }, schema)).toEqual([]);
  });

  it('vinculados: coherente, incoherente y sin padre', () => {
    expect(linkedSelectIssues({ fuel: 'diesel', modelo: 'tdi' }, schema)).toEqual([]);
    expect(linkedSelectIssues({ fuel: 'gasolina', modelo: 'tdi' }, schema)).toHaveLength(1);
    expect(linkedSelectIssues({ modelo: 'tdi' }, schema)[0].code).toBe(
      'ATTRIBUTE_LINKED_PARENT_MISSING',
    );
  });

  it('`deltaKeys` respeta el grandfathering de la edición', () => {
    const roto = { fuel: 'gasolina', modelo: 'tdi' };
    // Sin delta: se mira todo y falla.
    expect(linkedSelectIssues(roto, schema)).toHaveLength(1);
    // Con un delta que no toca ni el campo ni su padre: no se re-valida.
    expect(linkedSelectIssues(roto, schema, new Set(['year']))).toEqual([]);
  });
});

describe('collectAttributeIssues — TODOS los motivos a la vez', () => {
  const schema: AttributeField[] = [
    campo('year', { type: 'number', required: true }),
    campo('fuel', { type: 'select', options: ['gasolina', 'diesel'] }),
  ];

  it('un anuncio que incumple tres cosas devuelve tres motivos, no uno', () => {
    // ES LA RAZÓN DE SER DE LA DECISIÓN D-MOTIVOS. Con el comportamiento del
    // alta (lanzar al primero) el vendedor tendría que corregir, reintentar y
    // descubrir el siguiente, tres veces.
    const issues = collectAttributeIssues({ fuel: 'queroseno', sobra: 1 }, schema);

    expect(issues.map((i) => i.code).sort()).toEqual([
      'ATTRIBUTE_REQUIRED_MISSING',
      'ATTRIBUTE_UNKNOWN',
      'ATTRIBUTE_VALUE_INVALID',
    ]);
    // Cada motivo apunta a SU atributo: es lo que deja al editor señalar el campo.
    expect(issues.map((i) => i.field).sort()).toEqual(['fuel', 'sobra', 'year']);
    expect(issues.every((i) => i.message.length > 0)).toBe(true);
  });

  it('un anuncio que cumple no devuelve ninguno', () => {
    expect(collectAttributeIssues({ year: 2020, fuel: 'diesel' }, schema)).toEqual([]);
  });
});

describe('applicableSchemaFor — plegar la cadena Y filtrar por tipo', () => {
  // Cadena de 4 niveles con configuración repartida, mismo criterio que el
  // fixture de BD: con datos de 2 niveles, plegar 1 y plegar N dan lo mismo y
  // ninguna aserción distinguiría un pliegue roto.
  const cadena = [
    nodo('raiz', null, [campo('deRaiz'), campo('redefinido', { label: 'DE LA RAÍZ' })]),
    nodo('n2', 'raiz', [campo('deNivel2')]),
    nodo('n3', 'n2', [campo('redefinido', { label: 'DEL NIVEL 3' })]),
    nodo('hoja', 'n3', [campo('deHoja')]),
  ];

  it('la hoja hereda de TODA la cadena, y el más profundo gana', () => {
    const efectivo = applicableSchemaFor(cadena, 'PRODUCT');
    expect(efectivo.map((f) => f.name).sort()).toEqual([
      'deHoja',
      'deNivel2',
      'deRaiz',
      'redefinido',
    ]);
    // Redefinido UNA vez, y con la etiqueta del nivel más profundo que lo define.
    expect(efectivo.filter((f) => f.name === 'redefinido')).toHaveLength(1);
    expect(efectivo.find((f) => f.name === 'redefinido')?.label).toBe('DEL NIVEL 3');
  });

  it('filtra por el tipo del anuncio DESPUÉS de plegar', () => {
    const conTipos = [
      nodo('raiz', null, [
        campo('soloProducto', { appliesTo: ['PRODUCT'] }),
        campo('soloServicio', { appliesTo: ['SERVICE'] }),
        campo('ambos'),
      ]),
      nodo('hoja', 'raiz', []),
    ];

    expect(applicableSchemaFor(conTipos, 'PRODUCT').map((f) => f.name)).toEqual([
      'soloProducto',
      'ambos',
    ]);
    expect(applicableSchemaFor(conTipos, 'SERVICE').map((f) => f.name)).toEqual([
      'soloServicio',
      'ambos',
    ]);
  });

  it('una cadena de un solo nodo devuelve su propio schema', () => {
    expect(applicableSchemaFor([cadena[0]], 'PRODUCT').map((f) => f.name)).toEqual([
      'deRaiz',
      'redefinido',
    ]);
  });
});
