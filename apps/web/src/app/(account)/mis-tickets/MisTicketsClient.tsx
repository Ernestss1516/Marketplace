'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Link2, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TicketStatusBadge } from '@/components/tickets/TicketStatusBadge';
import type { TicketListItem, TicketStatus } from '@/types';

/** Estados que cuentan como "vivo" para el filtro rápido de la lista. */
const ABIERTOS: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED'];

function formatFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

interface Props {
  items: TicketListItem[];
  page: number;
  pages: number;
  total: number;
  initialFilter: 'abiertos' | 'todos';
}

export function MisTicketsClient({ items, page, pages, total, initialFilter }: Props) {
  const [filtro, setFiltro] = useState<'abiertos' | 'todos'>(initialFilter);

  const visibles = useMemo(
    () => (filtro === 'todos' ? items : items.filter((t) => ABIERTOS.includes(t.status))),
    [items, filtro],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2" role="group" aria-label="Filtrar tickets">
        <Button
          size="sm"
          variant={filtro === 'abiertos' ? 'default' : 'outline'}
          onClick={() => setFiltro('abiertos')}
          data-testid="filtro-abiertos"
        >
          Abiertos
        </Button>
        <Button
          size="sm"
          variant={filtro === 'todos' ? 'default' : 'outline'}
          onClick={() => setFiltro('todos')}
          data-testid="filtro-todos"
        >
          Todos
        </Button>
        <span className="ml-auto text-sm text-muted-foreground">{total} en total</span>
      </div>

      {visibles.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No hay tickets abiertos. Cambia a «Todos» para ver los cerrados.
        </p>
      ) : (
        <ul className="space-y-3" data-testid="lista-tickets">
          {visibles.map((t) => (
            <li key={t.id}>
              <Link
                href={`/mis-tickets/${t.id}`}
                className="block rounded-lg border p-4 transition-colors hover:bg-muted/50"
                data-testid="ticket-item"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{t.subject}</span>
                      {t.unreadCount > 0 && (
                        <Badge variant="destructive" data-testid="ticket-unread">
                          {t.unreadCount}
                        </Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                      {t.topic && <span>{t.topic.nombre}</span>}
                      {t.linkedLabel && (
                        <span className="inline-flex items-center gap-1">
                          <Link2 className="h-3.5 w-3.5" />
                          {t.linkedLabel}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare className="h-3.5 w-3.5" />
                        {formatFecha(t.lastMessageAt)}
                      </span>
                    </div>
                  </div>

                  <TicketStatusBadge status={t.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <Button variant="outline" size="sm" asChild disabled={page <= 1}>
            <Link href={`/mis-tickets?page=${page - 1}`} aria-disabled={page <= 1}>
              Anterior
            </Link>
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {page} de {pages}
          </span>
          <Button variant="outline" size="sm" asChild disabled={page >= pages}>
            <Link href={`/mis-tickets?page=${page + 1}`} aria-disabled={page >= pages}>
              Siguiente
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}
