import type { Alert } from '@prisma/client';
import type { SearchParams } from '../search/search.service';

/**
 * Converts a saved Alert back into the SearchParams shape SearchService.search()
 * expects. Reused by the creation preview (B2) and, later, by the matching job
 * (B3). No sort/page/hitsPerPage — those are presentation concerns the caller
 * decides, never part of the alert's stored criteria.
 */
export function alertToSearchParams(alert: Alert): SearchParams {
  return {
    q: alert.q ?? undefined,
    categorySlug: alert.categorySlug ?? undefined,
    type: alert.type ?? undefined,
    condition: alert.condition ?? undefined,
    priceType: alert.priceType ?? undefined,
    minPrice: alert.minPrice != null ? Number(alert.minPrice) : undefined,
    maxPrice: alert.maxPrice != null ? Number(alert.maxPrice) : undefined,
    province: alert.province ?? undefined,
    city: alert.city ?? undefined,
    attributes:
      alert.attributes != null
        ? (alert.attributes as Record<string, string | number | boolean>)
        : undefined,
    geo:
      alert.lat != null && alert.lng != null && alert.radiusMeters != null
        ? { lat: alert.lat, lng: alert.lng, radiusMeters: alert.radiusMeters }
        : undefined,
  };
}
