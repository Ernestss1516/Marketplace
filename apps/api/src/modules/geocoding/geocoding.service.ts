import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Timeout for each geocoding HTTP call (ms). Nominatim can take 1-2 s; 3 s is a safe ceiling. */
const GEOCODING_TIMEOUT_MS = 3000;

/**
 * Thrown for failures worth retrying (timeout, network error, 429, 5xx) — the
 * caller (IndexingProcessor's geocode job) lets this propagate so BullMQ's
 * attempts/backoff actually retries. A permanent failure (bad 4xx, no results)
 * is NOT an error — geocode() keeps resolving `null` for those, as before.
 */
export class TransientGeocodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientGeocodingError';
  }
}

@Injectable()
export class GeocodingService {
  private readonly logger = new Logger(GeocodingService.name);
  private readonly provider: string;
  private readonly maptilerKey: string | undefined;
  /** Sent as User-Agent to Nominatim; required by their usage policy. */
  private readonly userAgent: string;

  constructor(private readonly config: ConfigService) {
    this.provider = this.config.get<string>('geocoding.provider', 'nominatim');
    this.maptilerKey = this.config.get<string | undefined>('geocoding.maptilerKey');
    const appUrl = this.config.get<string>('appUrl', 'http://localhost:3000');
    // Nominatim policy: UA must identify the application with a valid contact point.
    this.userAgent = `Marketplace-MVP/1.0 (+${appUrl})`;
  }

  /**
   * Returns coordinates for a Spanish location string.
   * Resolves `null` for permanent failures (bad 4xx, empty result) — a null
   * result must never block listing creation/update. Throws
   * `TransientGeocodingError` for failures worth retrying (timeout, network
   * error, 429, 5xx) — callers that want retry semantics (the BullMQ geocode
   * job) let it propagate; callers that want "never throws" (the backfill
   * script) must catch it themselves.
   */
  async geocode(
    city: string,
    province: string,
    postalCode?: string,
  ): Promise<GeoPoint | null> {
    if (!city || !province) {
      this.logger.warn(`Geocoding skipped: city="${city}" province="${province}" are required`);
      return null;
    }
    this.logger.log(
      `Geocoding [${this.provider}]: city="${city}" province="${province}" postalCode="${postalCode ?? ''}"`,
    );
    try {
      const result = this.provider === 'maptiler'
        ? await this.geocodeMaptiler(city, province, postalCode)
        : await this.geocodeNominatim(city, province, postalCode);
      if (!result) {
        this.logger.warn(`Geocoding [${this.provider}]: no result for "${city}, ${province}"`);
      } else {
        this.logger.log(`Geocoding [${this.provider}]: resolved "${city}, ${province}" → ${result.lat},${result.lng}`);
      }
      return result;
    } catch (err) {
      if (err instanceof TransientGeocodingError) {
        this.logger.warn(`Geocoding [${this.provider}] TRANSIENT for "${city}, ${province}": ${err.message}`);
        throw err;
      }
      // Unexpected non-transient exception (e.g. malformed JSON) — degrade to
      // null instead of retrying indefinitely on a bug that retries can't fix.
      this.logger.warn(`Geocoding [${this.provider}] ERROR for "${city}, ${province}": ${String(err)}`);
      return null;
    }
  }

  /**
   * Some INE province names are bilingual ("Alicante/Alacant", "Araba/Álava").
   * Nominatim handles them correctly but the Spanish-only form is more reliable.
   * Also handles "A Coruña" (no slash) correctly — only strips at the slash boundary.
   */
  private normalizeProvinceForGeocoder(province: string): string {
    const slashIdx = province.indexOf('/');
    return slashIdx === -1 ? province : province.slice(0, slashIdx).trim();
  }

  private async geocodeNominatim(
    city: string,
    province: string,
    postalCode?: string,
  ): Promise<GeoPoint | null> {
    const normalizedProvince = this.normalizeProvinceForGeocoder(province);
    const result = await this.nominatimQuery(city, normalizedProvince, postalCode);
    if (result) return result;
    // Postal codes in user input are often wrong or from the wrong district.
    // Retry without it — city + province is sufficient for Nominatim.
    if (postalCode) {
      this.logger.log(`Nominatim: retrying "${city}, ${normalizedProvince}" without postalCode`);
      return this.nominatimQuery(city, normalizedProvince, undefined);
    }
    return null;
  }

  private async nominatimQuery(
    city: string,
    province: string,
    postalCode?: string,
  ): Promise<GeoPoint | null> {
    const parts = [postalCode, city, province, 'España'].filter(Boolean);
    const q = encodeURIComponent(parts.join(', '));
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&countrycodes=es&format=json&limit=1&addressdetails=0`;

    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(GEOCODING_TIMEOUT_MS),
        headers: { 'User-Agent': this.userAgent },
      });
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      throw new TransientGeocodingError(`Nominatim ${isTimeout ? 'timeout' : 'network error'}: ${String(err)}`);
    }

    if (!res.ok) {
      // 429 (rate limit) / 5xx are transient — worth a BullMQ retry with backoff.
      // Other 4xx (bad request) is permanent: retrying the same query won't help.
      if (res.status === 429 || res.status >= 500) {
        throw new TransientGeocodingError(`Nominatim HTTP ${res.status}`);
      }
      this.logger.warn(`Nominatim HTTP ${res.status} for "${city}, ${province}"`);
      return null;
    }

    const data = (await res.json()) as Array<{ lat: string; lon: string }>;
    if (!data.length) return null;

    return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
  }

  private async geocodeMaptiler(
    city: string,
    province: string,
    postalCode?: string,
  ): Promise<GeoPoint | null> {
    if (!this.maptilerKey) {
      this.logger.warn('MAPTILER_API_KEY not set; falling back to null');
      return null;
    }

    const query = encodeURIComponent(
      [postalCode, city, province].filter(Boolean).join(' '),
    );
    const url = `https://api.maptiler.com/geocoding/${query}.json?country=es&key=${this.maptilerKey}&limit=1`;

    let res: Response;
    try {
      res = await fetch(url, {
        signal: AbortSignal.timeout(GEOCODING_TIMEOUT_MS),
      });
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      throw new TransientGeocodingError(`MapTiler ${isTimeout ? 'timeout' : 'network error'}: ${String(err)}`);
    }

    if (!res.ok) {
      if (res.status === 429 || res.status >= 500) {
        throw new TransientGeocodingError(`MapTiler HTTP ${res.status}`);
      }
      return null;
    }

    const data = (await res.json()) as {
      features?: Array<{ center?: [number, number] }>;
    };
    const center = data.features?.[0]?.center;
    if (!center) return null;

    // MapTiler returns [lng, lat]
    return { lat: center[1], lng: center[0] };
  }
}
