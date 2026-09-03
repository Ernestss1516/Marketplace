'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { createTicketFromReport } from '@/lib/api/admin-tickets';
import {
  getReports,
  resolveReport,
  dismissReport,
  deactivateListing,
  retireReview,
  startReviewReport,
  type Report,
  type ReportStatus,
} from '@/lib/api/moderacion';
import { ApiError } from '@/lib/api/client';
import { ReporteDiana } from '@/components/admin/ReporteDiana';
import { adminReportHref, adminTicketHref, adminUserHref } from '@/lib/admin-links';
import { SesionNoDisponible } from '@/app/(admin)/components/SesionNoDisponible';
// Las etiquetas COMPARTIDAS. Esta pantalla llevaba su propio `REASON_LABEL` y su
// propio `STATUS_LABEL`, idénticos a los de `etiquetas.ts` —que además dice en su
// comentario que los copió de aquí—. Dos copias del mismo diccionario es como la
// ficha de ticket acabó pintando el enum en crudo: nadie sabía cuál era la buena.
import {
  ESTADO_REPORTE_LABELS,
  MOTIVO_REPORTE_LABELS,
  etiqueta,
  ticketStatusLabel,
} from '@/lib/etiquetas-enums';

const STATUS_FILTERS: { label: string; value: ReportStatus | undefined }[] = [
  { label: 'Todos', value: undefined },
  { label: 'Pendientes', value: 'PENDING' },
  { label: 'En revisión', value: 'REVIEWING' },
  { label: 'Resueltos', value: 'RESOLVED' },
  { label: 'Desestimados', value: 'DISMISSED' },
];

export default function AdminReportesPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [reports, setReports] = useState<Report[]>([]);
  const [total, setTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState<ReportStatus | undefined>(undefined);
  // El API paginaba de 24 en 24 desde el principio y la interfaz no pasaba `page`
  // ni pintaba controles: se leía «N total» y sólo se podía trabajar con las 24
  // primeras. Con 25 denuncias, la 25.ª era inalcanzable.
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const fetchReports = useCallback(
    async (status: ReportStatus | undefined, p: number) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getReports(token, { status, page: p });
        setReports(data.items);
        setTotal(data.total);
        setPerPage(data.perPage);
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
    fetchReports(statusFilter, page);
  }, [fetchReports, statusFilter, page]);

  /** Cambiar de filtro vuelve a la página 1: la 3 de «Todos» no es la 3 de «Pendientes». */
  function cambiarFiltro(value: ReportStatus | undefined) {
    setStatusFilter(value);
    setPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  async function handleAction(action: () => Promise<unknown>, reportId: string) {
    setPendingId(reportId);
    try {
      await action();
      await fetchReports(statusFilter, page);
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
      <SesionNoDisponible />
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
            onClick={() => cambiarFiltro(f.value)}
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
          No hay reportes
          {statusFilter ? ` en estado "${etiqueta(ESTADO_REPORTE_LABELS, statusFilter)}"` : ''}.
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
                      {/* El motivo abre la FICHA de la denuncia. La tabla enseña lo
                          justo para triar; el detalle completo —descripción entera,
                          quién la resolvió, todos los enlaces— vive en su pantalla. */}
                      <Link
                        href={adminReportHref(r.id)}
                        className="font-medium hover:underline"
                        data-testid="reporte-enlace-ficha"
                      >
                        {etiqueta(MOTIVO_REPORTE_LABELS, r.reason)}
                      </Link>
                      {r.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                          {r.description}
                        </p>
                      )}
                    </td>

                    {/* Contra qué va, con los snapshots de respaldo si ya no existe.
                        Ver components/admin/ReporteDiana.tsx. */}
                    <td className="p-3">
                      <ReporteDiana reporte={r} />
                    </td>

                    <td className="p-3 text-muted-foreground">
                      {/* ENLAZADO. Era texto plano, y el backend ya servía su `id`:
                          un denunciante compulsivo sólo se ve abriendo su ficha, y
                          desde la cola no se podía llegar a ella. */}
                      {r.reporter ? (
                        <Link
                          href={adminUserHref(r.reporter.id)}
                          className="hover:underline"
                          data-testid="reporte-enlace-reportante"
                        >
                          {r.reporter.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>

                    <td className="p-3">
                      <span
                        className={[
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          r.status === 'PENDING' && 'bg-warning-strong text-warning-foreground',
                          r.status === 'REVIEWING' && 'bg-info-surface text-info-foreground',
                          r.status === 'RESOLVED' && 'bg-success-surface text-success-foreground',
                          r.status === 'DISMISSED' && 'bg-neutral-surface text-neutral-foreground',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {etiqueta(ESTADO_REPORTE_LABELS, r.status)}
                      </span>
                      {/* QUIÉN LA CERRÓ Y CUÁNDO. Los dos campos viajaban en la
                          respuesta y no se pintaban en ninguna parte: una denuncia
                          resuelta no decía por quién, que es justo lo que se
                          pregunta cuando alguien reclama la decisión. */}
                      {r.resolvedBy && (
                        <p className="mt-1 text-xs text-muted-foreground" data-testid="reporte-resuelto-por">
                          por {r.resolvedBy.name}
                          {r.resolvedAt &&
                            ` · ${new Date(r.resolvedAt).toLocaleDateString('es-ES')}`}
                        </p>
                      )}
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
                        {/* «La estoy mirando yo», sin cerrarla. El endpoint existía
                            desde el principio y NADIE lo llamaba, así que `REVIEWING`
                            era un filtro que no podía tener contenido: se ofrecía «En
                            revisión» en la barra y ninguna denuncia podía llegar
                            nunca a ese estado. */}
                        {r.status === 'PENDING' && (
                          <button
                            disabled={isPending}
                            onClick={() =>
                              handleAction(() => startReviewReport(r.id, token), r.id)
                            }
                            className="rounded bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 hover:bg-blue-200 disabled:opacity-50"
                            data-testid="reporte-empezar-revision"
                          >
                            {isPending ? '…' : 'La reviso yo'}
                          </button>
                        )}
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
                        {/* 7b — AQUÍ ARDÍA. Este botón llamaba a `deleteReview`, que borraba
                            la fila; el `Cascade` de `Report.reviewId` se llevaba por delante
                            ESTA MISMA denuncia, y el `resolveReport` de la línea siguiente
                            respondía 404 sobre un reporte que acababa de destruir. El
                            moderador veía un error tras una acción que sí había surtido
                            efecto. Retirar es lógico: la fila vive, la denuncia sobrevive y
                            el `resolveReport` encuentra su reporte. */}
                        {r.review && isOpen && !r.review.retiredAt && (
                          <button
                            disabled={isPending}
                            onClick={() =>
                              handleAction(
                                async () => {
                                  await retireReview(
                                    r.review!.id,
                                    token,
                                    `Retirada por denuncia ${r.id}`,
                                  );
                                  await resolveReport(r.id, token);
                                },
                                r.id,
                              )
                            }
                            className="rounded bg-red-600 px-2 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {isPending ? '…' : 'Retirar valoración'}
                          </button>
                        )}
                        {r.review?.retiredAt && (
                          <span className="rounded bg-amber-100 px-2 py-1 text-xs text-amber-800">
                            Valoración retirada
                          </span>
                        )}

                        {/* Atención al usuario R7 — FLUJO (c). Abre un hilo con el
                            usuario reportado. El destinatario lo resuelve el
                            SERVIDOR desde el propio Report (nunca se manda desde
                            aquí), y el Report NO se modifica: resolver la denuncia
                            y cerrar el hilo son acciones independientes.
                            Si ya hay hilo, se enlaza en vez de ofrecer abrir otro. */}
                        {r.tickets && r.tickets.length > 0 ? (
                          <Link
                            href={adminTicketHref(r.tickets[0].id)}
                            className="rounded border border-blue-600 px-2 py-1 text-xs text-blue-700 hover:bg-blue-50"
                            data-testid="enlace-hilo-reporte"
                          >
                            {/* I18N T2 (D4) — decía «Hilo abierto (OPEN)». Al traducir
                                el estado, «abierto» pasaba a sobrar: «Hilo abierto
                                (Abierto)» se lee mal y «Hilo abierto (Cerrado)» se
                                contradice. La palabra estaba ahí supliendo a un enum
                                que no se entendía; ahora el estado lo dice él. */}
                            Hilo ({ticketStatusLabel(r.tickets[0].status)})
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

      {/* LA PAGINACIÓN, que el API servía y la interfaz no usaba. */}
      {!loading && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between" data-testid="reportes-paginacion">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="rounded border px-3 py-1 text-sm disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="text-sm text-muted-foreground">
            Página {page} de {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="rounded border px-3 py-1 text-sm disabled:opacity-40"
            data-testid="reportes-siguiente"
          >
            Siguiente
          </button>
        </div>
      )}
    </div>
  );
}
