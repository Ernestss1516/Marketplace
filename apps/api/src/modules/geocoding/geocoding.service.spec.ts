import type { ConfigService } from '@nestjs/config';
import { GeocodingService, TransientGeocodingError } from './geocoding.service';

function buildConfigStub(overrides: Record<string, unknown> = {}): ConfigService {
  return {
    get: jest.fn((key: string, defaultValue?: unknown) => overrides[key] ?? defaultValue),
  } as unknown as ConfigService;
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe('GeocodingService — transitorio vs permanente', () => {
  let fetchSpy: jest.SpyInstance;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Nominatim (provider por defecto)', () => {
    let service: GeocodingService;

    beforeEach(() => {
      service = new GeocodingService(buildConfigStub());
    });

    it('lanza TransientGeocodingError en timeout (AbortError)', async () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(abortError);

      await expect(service.geocode('Madrid', 'Madrid')).rejects.toThrow(TransientGeocodingError);
    });

    it('lanza TransientGeocodingError en fallo de red', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('fetch failed: ECONNREFUSED'));

      await expect(service.geocode('Madrid', 'Madrid')).rejects.toThrow(TransientGeocodingError);
    });

    it('lanza TransientGeocodingError en HTTP 429 (rate limit)', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(429, []));

      await expect(service.geocode('Madrid', 'Madrid')).rejects.toThrow(TransientGeocodingError);
    });

    it('lanza TransientGeocodingError en HTTP 5xx', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(503, []));

      await expect(service.geocode('Madrid', 'Madrid')).rejects.toThrow(TransientGeocodingError);
    });

    it('devuelve null (sin lanzar) en HTTP 4xx permanente (no 429)', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(400, []));

      await expect(service.geocode('Madrid', 'Madrid')).resolves.toBeNull();
    });

    it('devuelve null (sin lanzar) cuando la respuesta es ok pero sin resultados', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, []));

      await expect(service.geocode('Ciudad Inexistente', 'Madrid')).resolves.toBeNull();
    });

    it('devuelve las coordenadas cuando la respuesta es ok y tiene resultado', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(jsonResponse(200, [{ lat: '40.4168', lon: '-3.7038' }]));

      await expect(service.geocode('Madrid', 'Madrid')).resolves.toEqual({ lat: 40.4168, lng: -3.7038 });
    });

    it('reintenta sin postalCode si la primera consulta (con postalCode) no da resultado, y ambas llamadas no son transitorias', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValueOnce(jsonResponse(200, []))
        .mockResolvedValueOnce(jsonResponse(200, [{ lat: '40.4168', lon: '-3.7038' }]));

      await expect(service.geocode('Madrid', 'Madrid', '28001')).resolves.toEqual({ lat: 40.4168, lng: -3.7038 });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('no llama a fetch y devuelve null si falta city o province', async () => {
      fetchSpy = jest.spyOn(global, 'fetch');

      await expect(service.geocode('', 'Madrid')).resolves.toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('es idempotente: dos llamadas iguales devuelven el mismo resultado', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(jsonResponse(200, [{ lat: '40.4168', lon: '-3.7038' }]));

      const first = await service.geocode('Madrid', 'Madrid');
      const second = await service.geocode('Madrid', 'Madrid');
      expect(first).toEqual(second);
    });
  });

  describe('MapTiler', () => {
    let service: GeocodingService;

    beforeEach(() => {
      service = new GeocodingService(
        buildConfigStub({ 'geocoding.provider': 'maptiler', 'geocoding.maptilerKey': 'test-key' }),
      );
    });

    it('lanza TransientGeocodingError en HTTP 5xx', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(500, {}));

      await expect(service.geocode('Madrid', 'Madrid')).rejects.toThrow(TransientGeocodingError);
    });

    it('devuelve null (sin lanzar) en HTTP 4xx permanente', async () => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(400, {}));

      await expect(service.geocode('Madrid', 'Madrid')).resolves.toBeNull();
    });

    it('devuelve las coordenadas (lng/lat invertido en la respuesta de MapTiler)', async () => {
      fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(jsonResponse(200, { features: [{ center: [-3.7038, 40.4168] }] }));

      await expect(service.geocode('Madrid', 'Madrid')).resolves.toEqual({ lat: 40.4168, lng: -3.7038 });
    });
  });
});
