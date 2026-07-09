import type { Alert } from '@/types';

const CONDITION_LABELS: Record<string, string> = {
  NEW: 'Nuevo',
  LIKE_NEW: 'Como nuevo',
  GOOD: 'Buen estado',
  FAIR: 'Aceptable',
  FOR_PARTS: 'Para piezas',
};

/** Human-readable one-liner for an alert's criteria, e.g. "moviles · 100€–300€ · Madrid". */
export function formatAlertCriteria(alert: Alert): string {
  const parts: string[] = [];
  if (alert.q) parts.push(`"${alert.q}"`);
  if (alert.categorySlug) parts.push(alert.categorySlug);
  if (alert.type) parts.push(alert.type === 'PRODUCT' ? 'Productos' : 'Servicios');
  if (alert.condition) parts.push(CONDITION_LABELS[alert.condition] ?? alert.condition);

  if (alert.minPrice != null || alert.maxPrice != null) {
    const min = alert.minPrice != null ? `${alert.minPrice}€` : null;
    const max = alert.maxPrice != null ? `${alert.maxPrice}€` : null;
    parts.push(min && max ? `${min}–${max}` : min ? `desde ${min}` : `hasta ${max}`);
  }

  if (alert.city) parts.push(alert.city);
  else if (alert.province) parts.push(alert.province);

  return parts.length > 0 ? parts.join(' · ') : 'Todos los anuncios';
}
