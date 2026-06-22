import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Timeout for each geocoding HTTP call (ms). Slow providers must not block publication. */
const GEOCODING_TIMEOUT_MS = 1500;

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
   * Always resolves — returns null on any error, timeout, or empty result.
   * A null result must never block listing creation/update.
   */
  async geocode(
    city: string,
    province: string,
    postalCode?: string,
  ): Promise<GeoPoint | null> {
    try {
      if (this.provider === 'maptiler') {
        return await this.geocodeMaptiler(city, province, postalCode);
      }
      return await this.geocodeNominatim(city, province, postalCode);
    } catch (err) {
      this.logger.warn(
        `Geocoding failed for "${city}, ${province}": ${String(err)}`,
      );
      return null;
    }
  }

  private async geocodeNominatim(
    city: string,
    province: string,
    postalCode?: string,
  ): Promise<GeoPoint | null> {
    const parts = [postalCode, city, province, 'España'].filter(Boolean);
    const q = encodeURIComponent(parts.join(', '));
    const url = `https://nominatim.openstreetmap.org/search?q=${q}&countrycodes=es&format=json&limit=1&addressdetails=0`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(GEOCODING_TIMEOUT_MS),
      headers: { 'User-Agent': this.userAgent },
    });

    if (!res.ok) return null;

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

    const res = await fetch(url, {
      signal: AbortSignal.timeout(GEOCODING_TIMEOUT_MS),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as {
      features?: Array<{ center?: [number, number] }>;
    };
    const center = data.features?.[0]?.center;
    if (!center) return null;

    // MapTiler returns [lng, lat]
    return { lat: center[1], lng: center[0] };
  }
}
