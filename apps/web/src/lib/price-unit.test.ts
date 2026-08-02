// La función se movió de `components/publicar/steps/StepDatos.tsx` (módulo
// 'use client') a este módulo compartido, porque un Server Component la llamaba
// y en producción eso reventaba la página de editar anuncio. Estos casos fijan
// que del traslado NO salió ningún cambio de comportamiento: la resolución del
// formato de precio es exactamente la de antes.
import { resolvePriceUnitSelection } from './price-unit';

describe('resolvePriceUnitSelection — se conserva el formato, no se inventa', () => {
  it('mantiene el formato ACTUAL si la categoría lo permite (editar no pisa lo que eligió el vendedor)', () => {
    expect(resolvePriceUnitSelection(['ONE_TIME', 'PER_MONTH'], 'PER_MONTH')).toBe('PER_MONTH');
  });

  it('cae a ONE_TIME si el actual ya no está permitido', () => {
    expect(resolvePriceUnitSelection(['ONE_TIME', 'PER_HOUR'], 'PER_MONTH')).toBe('ONE_TIME');
  });

  it('sin formato actual, prefiere ONE_TIME cuando está permitido', () => {
    expect(resolvePriceUnitSelection(['PER_HOUR', 'ONE_TIME'])).toBe('ONE_TIME');
  });

  it('si ONE_TIME no está permitido, coge el primero de la lista', () => {
    expect(resolvePriceUnitSelection(['PER_HOUR', 'PER_DAY'], 'PER_MONTH')).toBe('PER_HOUR');
  });

  it('lista vacía → ONE_TIME (el mismo default que aplica el backend)', () => {
    expect(resolvePriceUnitSelection([])).toBe('ONE_TIME');
    expect(resolvePriceUnitSelection([], 'PER_MONTH')).toBe('ONE_TIME');
  });

  it('nunca devuelve un formato fuera de `allowed` mientras la lista no esté vacía', () => {
    const allowed = ['PER_WEEK', 'PER_SESSION'] as const;
    for (const current of [undefined, 'ONE_TIME', 'PER_MONTH'] as const) {
      expect(allowed).toContain(resolvePriceUnitSelection([...allowed], current));
    }
  });
});
