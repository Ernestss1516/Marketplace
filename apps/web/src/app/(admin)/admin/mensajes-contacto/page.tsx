'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AlertCircle, Settings } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ApiError } from '@/lib/api/client';
import {
  getAdminContactMessages,
  type AdminContactMessage,
  type ContactEstado,
} from '@/lib/api/admin-contact-messages';
import { getAdminContactReasons, type AdminContactReason } from '@/lib/api/admin-contact-reasons';

const PER_PAGE = 20;

// I18N T3-B — idéntico en la bandeja y en la ficha.
import { ESTADO_CONTACTO_LABELS as ESTADO_LABELS } from '@/lib/etiquetas-enums';

const ESTADO_VARIANTS: Record<ContactEstado, 'default' | 'secondary' | 'outline'> = {
  NUEVO: 'default',
  LEIDO: 'secondary',
  RESPONDIDO: 'outline',
  CERRADO: 'outline',
};

const ALL_MOTIVOS = '__all__';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AdminContactMessagesPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [messages, setMessages] = useState<AdminContactMessage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [estadoFilter, setEstadoFilter] = useState<ContactEstado | undefined>(undefined);
  // RC.2 — TODOS los motivos (incluidos inactivos): hay mensajes históricos
  // con un motivo ya desactivado y el filtro debe poder encontrarlos.
  const [motivos, setMotivos] = useState<AdminContactReason[]>([]);
  const [motivoFilter, setMotivoFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMessages = useCallback(
    async (p: number, estado?: ContactEstado, motivoId?: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminContactMessages(token, {
          estado,
          motivoId,
          page: p,
          perPage: PER_PAGE,
        });
        setMessages(data.items);
        setTotal(data.total);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? `Error ${err.statusCode}: ${err.message}`
            : 'Error al cargar los mensajes',
        );
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    fetchMessages(page, estadoFilter, motivoFilter);
  }, [fetchMessages, page, estadoFilter, motivoFilter]);

  useEffect(() => {
    if (!token) return;
    getAdminContactReasons(token)
      .then(setMotivos)
      .catch(() => setMotivos([]));
  }, [token]);

  function handleEstadoFilter(value: ContactEstado | undefined) {
    setEstadoFilter(value);
    setPage(1);
  }

  function handleMotivoFilter(value: string) {
    setMotivoFilter(value === ALL_MOTIVOS ? undefined : value);
    setPage(1);
  }

  const totalPages = Math.ceil(total / PER_PAGE);

  if (!token) {
    return (
      <div className="rounded border border-yellow-300 bg-yellow-50 p-4 text-yellow-800">
        Sesión no disponible. Recarga la página o inicia sesión de nuevo.
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Mensajes de contacto</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{total} mensajes</span>
          <Button variant="outline" size="sm" asChild className="gap-1">
            <Link href="/admin/motivos-contacto">
              <Settings className="h-4 w-4" />
              Motivos
            </Link>
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-2">
          {[
            { label: 'Todos', value: undefined },
            ...(Object.keys(ESTADO_LABELS) as ContactEstado[]).map((estado) => ({
              label: ESTADO_LABELS[estado],
              value: estado,
            })),
          ].map((f) => (
            <button
              key={String(f.value)}
              onClick={() => handleEstadoFilter(f.value)}
              className={[
                'rounded-full px-3 py-1 text-sm font-medium transition-colors',
                estadoFilter === f.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80',
              ].join(' ')}
            >
              {f.label}
            </button>
          ))}
        </div>

        <Select value={motivoFilter ?? ALL_MOTIVOS} onValueChange={handleMotivoFilter}>
          <SelectTrigger className="w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_MOTIVOS}>Todos los motivos</SelectItem>
            {motivos.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.nombre}
                {!m.activo && ' (inactivo)'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Remitente</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Motivo</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Mensaje</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Estado</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Recibido</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 5 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))
            ) : messages.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  No hay mensajes con los filtros seleccionados.
                </td>
              </tr>
            ) : (
              messages.map((message) => (
                <tr key={message.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/mensajes-contacto/${message.id}`}
                      className="font-medium hover:underline"
                    >
                      {message.email}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{message.motivo.nombre}</td>
                  {/* Texto plano interpolado por React (auto-escapado) — el
                      remitente no está autenticado, este contenido NUNCA se
                      renderiza como HTML (defensa XSS, RC.1). */}
                  <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                    {message.mensaje}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={ESTADO_VARIANTS[message.estado]}>
                      {ESTADO_LABELS[message.estado]}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDate(message.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages || loading}
          >
            Siguiente
          </Button>
        </div>
      )}
    </div>
  );
}
