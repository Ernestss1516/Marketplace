import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TicketStatus } from '@/types';

/**
 * Etiqueta y color por estado. Un solo sitio para las dos cosas: la lista y el
 * hilo pintan el mismo estado, y tenerlo duplicado es como acaban divergiendo.
 */
const STATUS_META: Record<TicketStatus, { label: string; className: string }> = {
  OPEN: { label: 'Abierto', className: 'bg-blue-100 text-blue-800 hover:bg-blue-100' },
  IN_PROGRESS: { label: 'En curso', className: 'bg-amber-100 text-amber-900 hover:bg-amber-100' },
  WAITING_USER: {
    label: 'Esperando tu respuesta',
    className: 'bg-purple-100 text-purple-900 hover:bg-purple-100',
  },
  RESOLVED: { label: 'Resuelto', className: 'bg-green-100 text-green-800 hover:bg-green-100' },
  CLOSED: { label: 'Cerrado', className: 'bg-muted text-muted-foreground hover:bg-muted' },
};

export function ticketStatusLabel(status: TicketStatus): string {
  return STATUS_META[status].label;
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
