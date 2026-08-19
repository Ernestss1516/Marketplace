/**
 * FICHA F1 — LAS ETIQUETAS DE ESTADO, EN UN SOLO SITIO.
 *
 * Vivían dentro de `anuncios/page.tsx`. La ficha (`anuncios/[id]/page.tsx`)
 * necesita exactamente las mismas, y copiarlas habría creado dos verdades sobre
 * cómo se llama un estado — el mismo defecto que B2 arregló aquí mismo cuando
 * `PAUSED` y `ARCHIVED` faltaban en el mapa y la tabla pintaba el enum crudo.
 * Una pantalla nueva es justo cuando esa copia se hace.
 *
 * Molde: `moderacion-routing.ts`, en esta misma carpeta — una regla compartida
 * que se extrae para poder probarla y para que no se bifurque.
 */

/** Los nueve estados del ciclo de vida, con su nombre en español. */
export const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activo',
  PENDING_REVIEW: 'En revisión',
  REJECTED: 'Rechazado',
  DRAFT: 'Borrador',
  EXPIRED: 'Caducado',
  RESERVED: 'Reservado',
  SOLD: 'Vendido',
  PAUSED: 'Pausado',
  ARCHIVED: 'Archivado',
};

export const STATUS_VARIANTS: Record<
  string,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  ACTIVE: 'default',
  PENDING_REVIEW: 'secondary',
  REJECTED: 'destructive',
  DRAFT: 'outline',
  EXPIRED: 'outline',
  RESERVED: 'secondary',
  SOLD: 'outline',
  PAUSED: 'outline',
  ARCHIVED: 'outline',
};

/**
 * BORRADO B2 — `ARCHIVED` entra como destino: archivar es el paso PREVIO
 * obligatorio para eliminar. Es irreversible —ARCHIVED es terminal— y el
 * selector no puede confirmarlo por sí solo, así que la máquina de estados es
 * quien lo protege: desde ARCHIVED no sale ninguna transición.
 */
export const TARGET_STATUSES = ['ACTIVE', 'PENDING_REVIEW', 'REJECTED', 'DRAFT', 'ARCHIVED'];

/** Etiqueta legible, con el enum crudo como último recurso visible. */
export function etiquetaDeEstado(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function formatPrice(price: number, currency: string, priceType: string): string {
  if (priceType === 'FREE') return 'Gratis';
  if (priceType === 'NEGOTIABLE') return 'A convenir';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(price);
}

export function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

/** Con hora — la ficha y el historial necesitan el «cuándo» exacto. */
export function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
