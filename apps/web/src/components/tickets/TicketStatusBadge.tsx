import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TicketStatus } from '@/types';

/**
 * Etiqueta y color por estado. Un solo sitio para las dos cosas: la lista y el
 * hilo pintan el mismo estado, y tenerlo duplicado es como acaban divergiendo.
 */
const STATUS_META: Record<TicketStatus, { label: string; className: string }> = {
  OPEN: { label: 'Abierto', className: 'bg-info-surface text-info-foreground hover:bg-info-surface' },
  IN_PROGRESS: { label: 'En curso', className: 'bg-amber-100 text-amber-900 hover:bg-amber-100' },
  WAITING_USER: {
    label: 'Esperando tu respuesta',
    className: 'bg-purple-100 text-purple-900 hover:bg-purple-100',
  },
  RESOLVED: { label: 'Resuelto', className: 'bg-success-surface text-success-foreground hover:bg-success-surface' },
  CLOSED: { label: 'Cerrado', className: 'bg-muted text-muted-foreground hover:bg-muted' },
};

/**
 * La etiqueta suelta, para donde no cabe la insignia de color: las dos fichas del
 * backoffice pintan el estado dentro de un `<Badge variant="outline">` que ya tenían.
 *
 * ACEPTA `string`, NO `TicketStatus`, y devuelve el valor crudo si no lo conoce. Los
 * tipos de `lib/api/admin.ts` declaran `status: string` —la ficha recibe lo que diga
 * el backend, no un enum estrechado en el cliente—, y un `STATUS_META[x].label` sobre
 * un valor futuro reventaría la ficha entera con un TypeError. Es la misma regla que
 * `etiquetaDeEstado` en `listing-status.ts`: el enum crudo es el último recurso
 * VISIBLE, nunca un fallo.
 */
export function ticketStatusLabel(status: string): string {
  return STATUS_META[status as TicketStatus]?.label ?? status;
}

export function TicketStatusBadge({
  status,
  className,
}: {
  status: TicketStatus;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <Badge variant="secondary" className={cn(meta.className, className)} data-testid="ticket-status">
      {meta.label}
    </Badge>
  );
}
