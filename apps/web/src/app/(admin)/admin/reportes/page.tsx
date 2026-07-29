'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { Star } from 'lucide-react';
import { createTicketFromReport } from '@/lib/api/admin-tickets';
import {
  getReports,
  resolveReport,
  dismissReport,
  deactivateListing,
  deleteReview,
  type Report,
  type ReportStatus,
} from '@/lib/api/moderacion';
import { ApiError } from '@/lib/api/client';

const REASON_LABEL: Record<string, string> = {
  SPAM: 'Spam',
  FRAUD: 'Fraude',
  INAPPROPRIATE: 'Inapropiado',
  PROHIBITED_ITEM: 'Artículo prohibido',
  WRONG_CATEGORY: 'Categoría incorrecta',
  FAKE_REVIEW: 'Valoración falsa',
  OTHER: 'Otro',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendiente',
  REVIEWING: 'En revisión',
  RESOLVED: 'Resuelto',
  DISMISSED: 'Desestimado',
};

const STATUS_FILTERS: { label: string; value: ReportStatus | undefined }[] = [
  { label: 'Todos', value: undefined },
  { label: 'Pendientes', value: 'PENDING' },
  { label: 'En revisión', value: 'REVIEWING' },
  { label: 'Resueltos', value: 'RESOLVED' },
  { label: 'Desestimados', value: 'DISMISSED' },
];

function ReviewSnippet({ review }: { review: NonNullable<Report['review']> }) {
  return (
    <div className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs">
      <div className="mb-0.5 flex items-center gap-1 font-medium text-amber-900">
        {Array.from({ length: 5 }, (_, i) => (
          <Star
            key={i}
            className={[
              'h-3 w-3',
              i < review.rating ? 'fill-amber-500 text-amber-500' : 'fill-transparent text-amber-300',
            ].join(' ')}
            aria-hidden
          />
        ))}
        <span className="ml-1 text-amber-800">
          de {review.author.name} → {review.target.name}
        </span>
      </div>
      {review.comment && (
        <p className="line-clamp-2 text-amber-800">{review.comment}</p>
      )}
    </div>
  );
}

export default function AdminReportesPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [reports, setReports] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<ReportStatus | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const fetchReports = useCallback(
    async (status?: ReportStatus) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getReports(token, { status });
        setReports(data.items);
        setTotal(data.total);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(`Error ${err.statusCode}: ${err.message}`);
        } else {
          setError('Error inesperado al cargar los reportes');
        }
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    fetchReports(statusFilter);
  }, [fetchReports, statusFilter]);

  async function handleAction(action: () => Promise<unknown>, reportId: string) {
    setPendingId(reportId);
    try {
      await action();
      await fetchReports(statusFilter);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Error ${err.statusCode}: ${err.message}`
          : 'Error al ejecutar la acción';
      alert(msg);
    } finally {
      setPendingId(null);
    }
  }

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
        <h1 className="text-2xl font-bold">Reportes y denuncias</h1>
        <span className="text-sm text-muted-foreground">{total} total</span>
      </div>

      {/* Status filter */}
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={String(f.value)}
            onClick={() => setStatusFilter(f.value)}
            className={[
              'rounded-full px-3 py-1 text-sm font-medium transition-colors',
              statusFilter === f.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted hover:bg-muted/80',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 p-4 font-mono text-sm text-red-800">
          {error}
        </div>
      )}

      {loading && (
        <div className="py-12 text-center text-muted-foreground">Cargando reportes…</div>
      )}

      {!loading && !error && reports.length === 0 && (
        <div className="py-12 text-center text-muted-foreground">
          No hay reportes{statusFilter ? ` en estado "${STATUS_LABEL[statusFilter]}"` : ''}.
        </div>
      )}

      {!loading && reports.length > 0 && (
        <div className="overflow-x-auto rounded border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-3 text-left font-medium">Motivo</th>
                <th className="p-3 text-left font-medium">Recurso</th>
                <th className="p-3 text-left font-medium">Reportado por</th>
                <th className="p-3 text-left font-medium">Estado</th>
                <th className="p-3 text-left font-medium">Fecha</th>
                <th className="p-3 text-left font-medium">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {reports.map((r) => {
                const isPending = pendingId === r.id;
                const isOpen = r.status === 'PENDING' || r.status === 'REVIEWING';

                return (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="p-3">
                      <span className="font-medium">{REASON_LABEL[r.reason] ?? r.reason}</span>
                      {r.description && (
                        <p className="mt-0.5 text-xs text-muted-foreground">{r.description}</p>
                      )}
                    </td>

                    <td className="p-3">
                      {r.listing ? (
                        <>
                          <a
                            href={`/anuncio/${r.listing.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {r.listing.title}
                          </a>
                          <p className="text-xs text-muted-foreground">Anuncio</p>
                        </>
                      ) : r.reportedUser ? (
                        <>
                          <a
                            href={`/vendedor/${r.reportedUser.slug}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue-600 hover:underline"
                          >
                            {r.reportedUser.name}
                          </a>
                          <p className="text-xs text-muted-foreground">Usuario</p>
                        </>
                      ) : r.review ? (
                        <ReviewSnippet review={r.review} />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>

                    <td className="p-3 text-muted-foreground">
                      {r.reporter?.name ?? '—'}
                    </td>

                    <td className="p-3">
                      <span
                        className={[
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          r.status === 'PENDING' && 'bg-yellow-100 text-yellow-800',
                          r.status === 'REVIEWING' && 'bg-blue-100 text-blue-800',
                          r.status === 'RESOLVED' && 'bg-green-100 text-green-800',
                          r.status === 'DISMISSED' && 'bg-gray-100 text-gray-600',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>

                    <td className="p-3 text-muted-foreground">
                      {new Date(r.createdAt).toLocaleDateString('es-ES', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                      })}
                    </td>

                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        {isOpen && (
                          <>
                            <button
                              disabled={isPending}
                              onClick={() =>
                                handleAction(() => resolveReport(r.id, token), r.id)
                              }
                              className="rounded bg-green-600 px-2 py-1 text-xs text-white hover:bg-green-700 disabled:opacity-50"
                            >
                              {isPending ? '…' : 'Resolver'}
                            </button>
                            <button
                              disabled={isPending}
                              onClick={() =>
                                handleAction(() => dismissReport(r.id, token), r.id)
                              }
                              className="rounded bg-gray-500 px-2 py-1 text-xs text-white hover:bg-gray-600 disabled:opacity-50"
                            >
                              {isPending ? '…' : 'Desestimar'}
                            </button>
                          </>
                        )}
                        {r.listing && r.listing.status === 'ACTIVE' && (
                          <button
                            disabled={isPending}
                            onClick={() =>
                              handleAction(
                                () =>
                                  deactivateListing(
                                    r.listing!.id,
                                    token,
                                    `Retirado por reporte ${r.id}`,
                                  ),
                                r.id,
                              )
                            }
                            className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {isPending ? '…' : 'Retirar anuncio'}
                          </button>
                        )}
                        {r.review && isOpen && (
                          <button
                            disabled={isPending}
                            onClick={() =>
                              handleAction(
                                async () => {
                                  await deleteReview(r.review!.id, token);
                                  await resolveReport(r.id, token);
                                },
                                r.id,
                              )
                            }
                            className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {isPending ? '…' : 'Eliminar reseña'}
                          </button>
                        )}

                        {/* Atención al usuario R7 — FLUJO (c). Abre un hilo con el
                            usuario reportado. El destinatario lo resuelve el
                            SERVIDOR desde el propio Report (nunca se manda desde
                            aquí), y el Report NO se modifica: resolver la denuncia
                            y cerrar el hilo son acciones independientes.
                            Si ya hay hilo, se enlaza en vez de ofrecer abrir otro. */}
                        {r.tickets && r.tickets.length > 0 ? (
                          <Link
                            href={`/admin/tickets/${r.tickets[0].id}`}
                            className="rounded border border-blue-600 px-2 py-1 text-xs text-blue-700 hover:bg-blue-50"
                            data-testid="enlace-hilo-reporte"
                          >
                            Hilo abierto ({r.tickets[0].status})
                          </Link>
                        ) : (
                          <button
                            disabled={isPending}
                            onClick={() =>
                              handleAction(
                                () =>
                                  createTicketFromReport(
                                    r.id,
                                    {
                                      subject: 'Sobre una denuncia recibida',
                                      body:
                                        'Hola, nos ha llegado una denuncia relacionada con tu actividad ' +
                                        'en la plataforma y queremos contrastarla contigo antes de tomar ' +
                                        'ninguna decisión. ¿Puedes contarnos tu versión?',
                                    },
                                    token,
                                  ),
                                r.id,
                              )
                            }
                            className="rounded bg-blue-600 px-2 py-1 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
                            data-testid="contactar-reportado"
                          >
                            {isPending ? '…' : 'Contactar al reportado'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
