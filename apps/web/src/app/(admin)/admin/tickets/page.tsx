'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AlertCircle, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TicketStatusBadge } from '@/components/tickets/TicketStatusBadge';
import { ApiError } from '@/lib/api/client';
import {
  ASSIGNED_TO_ME,
  ASSIGNED_TO_NONE,
  getAdminTickets,
  getStaffTicketTopics,
} from '@/lib/api/admin-tickets';
import type {
  AdminTicketListItem,
  TicketOrigin,
  TicketStatus,
  TicketTopic,
} from '@/types';

const PER_PAGE = 25;
const TODOS = '__all__';

const ORIGIN_LABELS: Record<TicketOrigin, string> = {
  USER: 'Del usuario',
  ADMIN: 'Iniciado por admin',
  REPORT: 'Desde denuncia',
};

const STATUS_OPTIONS: TicketStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_USER',
  'RESOLVED',
  'CLOSED',
];

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Bandeja de tickets (R7). Client-side y sin SEO, regla del backoffice; molde
 * `/admin/mensajes-contacto` (useSession + fetch en efecto + filtros + páginas).
 *
 * FILTRADO POR ROL: no se hace aquí. El backend NO LISTA a un MODERATOR los
 * tickets con factura enlazada (R3), así que la bandeja simplemente pinta lo que
 * le llega. Replicar el filtro en el cliente daría la falsa impresión de que la
 * protección vive aquí — vive en el `where` del servidor.
 */
export default function AdminTicketsPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [items, setItems] = useState<AdminTicketListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>(TODOS);
  const [origin, setOrigin] = useState<string>(TODOS);
  const [assignedTo, setAssignedTo] = useState<string>(TODOS);
  const [topicId, setTopicId] = useState<string>(TODOS);
  /** #15 — la cola del soporte prioritario, aislable. */
  const [soloPro, setSoloPro] = useState(false);
  const [topics, setTopics] = useState<TicketTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTickets = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminTickets(token, {
        page,
        perPage: PER_PAGE,
        ...(status !== TODOS && { status: status as TicketStatus }),
        ...(origin !== TODOS && { origin: origin as TicketOrigin }),
        ...(assignedTo !== TODOS && { assignedTo }),
        ...(topicId !== TODOS && { topicId }),
        ...(soloPro && { soloPro: true }),
      });
      setItems(data.items);
      setTotal(data.total);
      setPages(data.pages);
    } catch (err) {
      setError(
        err instanceof ApiError && err.statusCode === 403
          ? 'No tienes acceso a esta sección.'
          : 'No se han podido cargar los tickets.',
      );
    } finally {
      setLoading(false);
    }
  }, [token, page, status, origin, assignedTo, topicId, soloPro]);

  useEffect(() => {
    void fetchTickets();
  }, [fetchTickets]);

  useEffect(() => {
    if (!token) return;
    void getStaffTicketTopics(token)
      .then(setTopics)
      .catch(() => setTopics([]));
  }, [token]);

  /** Cualquier cambio de filtro vuelve a la página 1: si no, se queda en una página que ya no existe. */
  function onFilterChange(setter: (v: string) => void) {
    return (e: React.ChangeEvent<HTMLSelectElement>) => {
      setter(e.target.value);
      setPage(1);
    };
  }

  const selectClass =
    'h-9 rounded-md border border-input bg-background px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Tickets</h1>
        <Button asChild size="sm">
          <Link href="/admin/tickets/nuevo">
            <Plus className="mr-2 h-4 w-4" />
            Abrir hilo con un usuario
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={onFilterChange(setStatus)}
          className={selectClass}
          aria-label="Filtrar por estado"
          data-testid="filtro-estado"
        >
          <option value={TODOS}>Todos los estados</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <select
          value={origin}
          onChange={onFilterChange(setOrigin)}
          className={selectClass}
          aria-label="Filtrar por origen"
          data-testid="filtro-origen"
        >
          <option value={TODOS}>Todos los orígenes</option>
          {(Object.keys(ORIGIN_LABELS) as TicketOrigin[]).map((o) => (
            <option key={o} value={o}>
              {ORIGIN_LABELS[o]}
            </option>
          ))}
        </select>

        <select
          value={assignedTo}
          onChange={onFilterChange(setAssignedTo)}
          className={selectClass}
          aria-label="Filtrar por agente"
          data-testid="filtro-asignado"
        >
          <option value={TODOS}>Cualquier agente</option>
          <option value={ASSIGNED_TO_ME}>Míos</option>
          <option value={ASSIGNED_TO_NONE}>Sin asignar</option>
        </select>

        {topics.length > 0 && (
          <select
            value={topicId}
            onChange={onFilterChange(setTopicId)}
            className={selectClass}
            aria-label="Filtrar por motivo"
            data-testid="filtro-motivo"
          >
            <option value={TODOS}>Todos los motivos</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nombre}
              </option>
            ))}
          </select>
        )}

        {/* #15 — LA COLA DEL SOPORTE PRIORITARIO, aislable.
            Un botón y no un `select` de tres posiciones como los de al lado: «los tickets
            de los que NO son Pro» no es una pregunta que nadie se haga —el resto de la
            bandeja ya es eso—, así que sobra la tercera opción. */}
        <button
          type="button"
          onClick={() => {
            setSoloPro((v) => !v);
            setPage(1);
          }}
          aria-pressed={soloPro}
          data-testid="filtro-solo-pro"
          className={`h-9 rounded-md border px-3 text-sm transition-colors ${
            soloPro ? 'border-foreground/20 bg-muted font-medium' : 'text-muted-foreground hover:bg-muted/50'
          }`}
        >
          Solo Pro
        </button>

        <span className="ml-auto text-sm text-muted-foreground">{total} tickets</span>
      </div>

      {error && (
        <div
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {loading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          No hay tickets con estos filtros.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm" data-testid="bandeja-tickets">
            <thead className="border-b bg-muted/40 text-left">
              <tr>
                <th className="px-4 py-2 font-medium">Asunto</th>
                <th className="px-4 py-2 font-medium">Usuario</th>
                <th className="px-4 py-2 font-medium">Estado</th>
                <th className="px-4 py-2 font-medium">Origen</th>
                <th className="px-4 py-2 font-medium">Agente</th>
                <th className="px-4 py-2 font-medium">Movimiento</th>
              </tr>
            </thead>
            <tbody>
              {items.map((t) => (
                <tr key={t.id} className="border-b last:border-0 hover:bg-muted/30" data-testid="fila-ticket">
                  <td className="px-4 py-2">
                    <Link href={`/admin/tickets/${t.id}`} className="font-medium hover:underline">
                      {t.subject}
                    </Link>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {t.topic && <span>{t.topic.nombre}</span>}
                      {t.linkedLabel && <span>· {t.linkedLabel}</span>}
                      {t.unreadFromUser > 0 && (
                        <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                          {t.unreadFromUser} sin leer
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <span>{t.user.name}</span>
                      {/* #15 — «SOPORTE PRIORITARIO», HECHO VISIBLE. Va junto al NOMBRE y no
                          al asunto porque es una propiedad de la PERSONA, no del ticket: lo
                          que dice es «este cliente paga Pro», y por eso su consulta destaca.
                          Refleja si es Pro AHORA, no si lo era al abrirlo. */}
                      {t.userIsPro && (
                        <Badge
                          variant="secondary"
                          className="h-4 px-1.5 text-[10px]"
                          data-testid="ticket-autor-pro"
                          title="Cliente Pro — soporte prioritario"
                        >
                          Pro
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{t.user.email}</div>
                  </td>
                  <td className="px-4 py-2">
                    <TicketStatusBadge status={t.status} />
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{ORIGIN_LABELS[t.origin]}</td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {t.assignedTo?.name ?? <span className="italic">sin asignar</span>}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{formatDate(t.lastMessageAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {page} de {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pages}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </Button>
        </div>
      )}
    </div>
  );
}
