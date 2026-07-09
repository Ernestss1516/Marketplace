import type { Alert } from '@prisma/client';
import { alertToSearchParams } from './alert-to-search-params';

function buildAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'alert-1',
    userId: 'user-1',
    name: 'Mi alerta',
    q: null,
    categorySlug: null,
    type: null,
    condition: null,
    priceType: null,
    minPrice: null,
    maxPrice: null,
    province: null,
    city: null,
    attributes: null,
    lat: null,
    lng: null,
    radiusMeters: null,
    active: true,
    createdAt: new Date(),
    ...overrides,
  } as Alert;
}

describe('alertToSearchParams', () => {
  it('mapea los campos core presentes y omite los ausentes (null → undefined)', () => {
    const alert = buildAlert({
      q: 'iphone',
      categorySlug: 'moviles',
      type: 'PRODUCT',
      condition: 'GOOD',
      priceType: 'FIXED',
      province: 'Madrid',
      city: 'Madrid',
    });

    const params = alertToSearchParams(alert);

    expect(params).toMatchObject({
      q: 'iphone',
      categorySlug: 'moviles',
      type: 'PRODUCT',
      condition: 'GOOD',
      priceType: 'FIXED',
      province: 'Madrid',
      city: 'Madrid',
    });
    expect(params.minPrice).toBeUndefined();
    expect(params.maxPrice).toBeUndefined();
    expect(params.attributes).toBeUndefined();
    expect(params.geo).toBeUndefined();
    // No sort/page/hitsPerPage — presentation concerns, never part of a saved alert.
    expect(params).not.toHaveProperty('sort');
    expect(params).not.toHaveProperty('page');
    expect(params).not.toHaveProperty('hitsPerPage');
  });

  it('convierte Decimal (minPrice/maxPrice) a number', () => {
    const alert = buildAlert({
      minPrice: { toString: () => '100.5' } as unknown as Alert['minPrice'],
      maxPrice: { toString: () => '300' } as unknown as Alert['maxPrice'],
    });
    // Prisma.Decimal implements valueOf/toString such that Number() coerces correctly;
    // here we simulate that with a Decimal-like object exposing toString.
    const params = alertToSearchParams(alert);
    expect(typeof params.minPrice).toBe('number');
    expect(typeof params.maxPrice).toBe('number');
    expect(params.minPrice).toBe(100.5);
    expect(params.maxPrice).toBe(300);
  });

  it('pasa attributes ya coaccionados tal cual (números y booleanos preservados)', () => {
    const alert = buildAlert({
      attributes: { brand: 'Apple', km: 50000, negotiable: true } as unknown as Alert['attributes'],
    });

    const params = alertToSearchParams(alert);

    expect(params.attributes).toEqual({ brand: 'Apple', km: 50000, negotiable: true });
  });

  it('construye geo solo cuando lat, lng y radiusMeters están los 3 presentes', () => {
    const withGeo = buildAlert({ lat: 40.4168, lng: -3.7038, radiusMeters: 10000 });
    expect(alertToSearchParams(withGeo).geo).toEqual({
      lat: 40.4168,
      lng: -3.7038,
      radiusMeters: 10000,
    });

    const missingRadius = buildAlert({ lat: 40.4168, lng: -3.7038, radiusMeters: null });
    expect(alertToSearchParams(missingRadius).geo).toBeUndefined();

    const missingLat = buildAlert({ lat: null, lng: -3.7038, radiusMeters: 10000 });
    expect(alertToSearchParams(missingLat).geo).toBeUndefined();
  });
});
