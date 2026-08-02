import { resolveEffectiveTags, type TagRef } from './tag.types';

const tag = (id: string, slug = id, name = id.toUpperCase()): TagRef => ({ id, slug, name });

describe('resolveEffectiveTags', () => {
  it('una hija SIN tags propios hereda los del padre tal cual', () => {
    expect(resolveEffectiveTags([], [tag('a'), tag('b')]).map((t) => t.id)).toEqual(['a', 'b']);
  });

  it('un padre sin tags no aporta nada; la hija se queda con los suyos', () => {
    expect(resolveEffectiveTags([tag('x')], []).map((t) => t.id)).toEqual(['x']);
  });

  it('UNE los dos conjuntos — no es un override como allowedViews/allowedPriceUnits', () => {
    // La diferencia importa: si fuera override, una hija con un tag propio perdería
    // todos los del padre.
    expect(resolveEffectiveTags([tag('x')], [tag('a')]).map((t) => t.id)).toEqual(['x', 'a']);
  });

  it('los PROPIOS van primero — orden de sugerencia, inverso al del schema de atributos', () => {
    const efectivos = resolveEffectiveTags([tag('propio1'), tag('propio2')], [tag('here1')]);
    expect(efectivos.map((t) => t.id)).toEqual(['propio1', 'propio2', 'here1']);
  });

  it('DEDUPLICA por id: el mismo tag asignado al padre y a la hija sale una vez', () => {
    // Puede pasar de verdad: un admin asigna "garantía" a Vehículos y también a Coches.
    const efectivos = resolveEffectiveTags([tag('g')], [tag('g'), tag('otro')]);
    expect(efectivos.map((t) => t.id)).toEqual(['g', 'otro']);
  });

  it('al deduplicar gana la instancia PROPIA (mismo id, así que da igual el contenido)', () => {
    const efectivos = resolveEffectiveTags([tag('g', 'g', 'Propio')], [tag('g', 'g', 'Heredado')]);
    expect(efectivos).toHaveLength(1);
    expect(efectivos[0].name).toBe('Propio');
  });

  it('conserva el orden de entrada dentro de cada grupo', () => {
    const efectivos = resolveEffectiveTags([tag('p1'), tag('p2')], [tag('h1'), tag('h2')]);
    expect(efectivos.map((t) => t.id)).toEqual(['p1', 'p2', 'h1', 'h2']);
  });

  it('no muta los arrays de entrada', () => {
    const own = [tag('x')];
    const parent = [tag('a')];
    resolveEffectiveTags(own, parent);
    expect(own).toHaveLength(1);
    expect(parent).toHaveLength(1);
  });

  it('dos vacíos dan vacío', () => {
    expect(resolveEffectiveTags([], [])).toEqual([]);
  });
});
