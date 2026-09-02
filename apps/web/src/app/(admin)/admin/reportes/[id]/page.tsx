'use client';

/**
 * LA FICHA DE UNA DENUNCIA.
 *
 * QUÉ ARREGLA. `GET /moderation/reports/:id` existía desde el primer día y no lo
 * llamaba nadie: servía MÁS que el listado —el correo del denunciante y el
 * vendedor del anuncio denunciado— y no había pantalla que lo pidiera. La cola era
 * el único sitio donde se veía una denuncia, y una tabla de seis columnas no puede
 * enseñar una descripción larga, quién la resolvió, y todos los enlaces a la vez.
 *
 * Y RESUELVE UN ENLACE QUE NO PODÍA EXISTIR: el panel «Desde una denuncia» de un
 * ticket mandaba a `/admin/reportes`, la lista entera, porque no había ficha a la
 * que apuntar. El moderador tenía que buscar la suya entre todas.
 *
 * LA COLA SIGUE SIENDO LA HERRAMIENTA DE TRABAJO. Aquí no se duplican sus acciones
 * de triaje: quien viene a resolver diez denuncias lo hace en la tabla, sin abrir
 * diez pestañas. Esta pantalla es para MIRAR una en profundidad.
 */

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { AlertCircle, ChevronLeft } from 'lucide-react';
import { getReport, type ReportDetail } from '@/lib/api/moderacion';
import { ApiError } from '@/lib/api/client';
import { ReporteDiana } from '@/components/admin/ReporteDiana';
import { adminListingHref, adminTicketHref, adminUserHref } from '@/lib/admin-links';
import {
  ESTADO_REPORTE_LABELS,
  MOTIVO_REPORTE_LABELS,
  etiqueta,
  etiquetaDeEstado,
  ticketStatusLabel,
} from '@/lib/etiquetas-enums';

function fechaHora(iso: string) {
  return new Date(iso).toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {titulo}
      </h2>
      {children}
    </section>
  );
}

export default function AdminFichaReportePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [data, setData] = useState<ReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      setData(await getReport(id, token));
    } catch (err) {
      setError(
        err instanceof ApiError ? `Error ${err.statusCode}: ${err.message}` : 'Error al cargar',
      );
    } finally {
      setLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  if (!token) {
    return (
      <div className="rounded border border-yellow-300 bg-yellow-50 p-4 text-yellow-800">
        Sesión no disponible. Recarga la página o inicia sesión de nuevo.
      </div>
    );
  }

  if (loading) {
    return <p className="py-12 text-center text-sm text-muted-foreground">Cargando…</p>;
  }

  if (error || !data) {
    return (
      <div className="space-y-4">
        <Link
          href="/admin/reportes"
          className="inline-flex items-center text-sm text-muted-foreground hover:underline"
        >
          <ChevronLeft className="mr-1 h-4 w-4" />
          Reportes
        </Link>
        <div
          className="flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
          role="alert"
        >
          <AlertCircle className="h-4 w-4" />
          {error ?? 'Denuncia no encontrada.'}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="ficha-reporte">
      <Link
        href="/admin/reportes"
        className="inline-flex items-center text-sm text-muted-foreground hover:underline"
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        Reportes
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">
          {etiqueta(MOTIVO_REPORTE_LABELS, data.reason)}
        </h1>
        <span
          className={[
            'rounded-full px-2 py-0.5 text-xs font-medium',
            data.status === 'PENDING' && 'bg-yellow-100 text-yellow-800',
            data.status === 'REVIEWING' && 'bg-blue-100 text-blue-800',
            data.status === 'RESOLVED' && 'bg-green-100 text-green-800',
            data.status === 'DISMISSED' && 'bg-gray-100 text-gray-600',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {etiqueta(ESTADO_REPORTE_LABELS, data.status)}
        </span>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Bloque titulo="Contra qué va">
            <ReporteDiana reporte={data} />
            {/* El vendedor del anuncio denunciado — un dato que SÓLO sirve este
                endpoint y que el listado no tiene. Denunciar un anuncio es, casi
                siempre, denunciar a quien lo puso. */}
            {data.listing?.seller && (
              <p className="mt-2 text-sm text-muted-foreground">
                Lo publica{' '}
                <Link
                  href={adminUserHref(data.listing.seller.id)}
                  className="underline underline-offset-2"
                  data-testid="ficha-reporte-vendedor"
                >
                  {data.listing.seller.name}
                </Link>
              </p>
            )}
          </Bloque>

          <Bloque titulo="Qué dice la denuncia">
            {/* SIN `line-clamp`, a diferencia de la tabla: es el motivo por el que
                esta pantalla existe. En la cola la descripción se recorta a dos
                líneas para que la fila no crezca; aquí se lee entera. */}
            {data.description ? (
              <p className="whitespace-pre-wrap text-sm">{data.description}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Sin descripción: quien denunció sólo eligió el motivo.
              </p>
            )}
          </Bloque>

          {data.tickets && data.tickets.length > 0 && (
            <Bloque titulo="Hilos abiertos con el denunciado">
              <ul className="space-y-1">
                {data.tickets.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={adminTicketHref(t.id)}
                      className="text-sm hover:underline"
                      data-testid="ficha-reporte-hilo"
                    >
                      {/* I18N T2 (D5) — decía «Hilo OPEN». */}
                      Hilo {ticketStatusLabel(t.status)}
                    </Link>
                  </li>
                ))}
              </ul>
            </Bloque>
          )}
        </div>

        <aside className="space-y-4">
          <Bloque titulo="Quién denunció">
            {data.reporter ? (
              <>
                <Link
                  href={adminUserHref(data.reporter.id)}
                  className="text-sm font-medium hover:underline"
                  data-testid="ficha-reporte-reportante"
                >
                  {data.reporter.name}
                </Link>
                {/* El correo sólo lo sirve este endpoint. Es lo que permite
                    responder fuera de la plataforma si hace falta. */}
                <p className="text-xs text-muted-foreground">{data.reporter.email}</p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">—</p>
            )}
          </Bloque>

          <Bloque titulo="Cuándo">
            <p className="text-sm">Recibida el {fechaHora(data.createdAt)}</p>
            {/* Los dos campos que no se pintaban en NINGUNA parte. Una denuncia
                cerrada no decía quién la cerró — que es lo primero que se pregunta
                cuando alguien reclama la decisión. */}
            {data.resolvedAt && (
              <p className="mt-1 text-sm text-muted-foreground" data-testid="ficha-reporte-resolucion">
                Cerrada el {fechaHora(data.resolvedAt)}
                {data.resolvedBy && ` por ${data.resolvedBy.name}`}
              </p>
            )}
          </Bloque>

          {data.listing && (
            <Bloque titulo="El anuncio">
              <Link
                href={adminListingHref(data.listing.id)}
                className="text-sm hover:underline"
              >
                {data.listing.title}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">
                {/* I18N T2 (D6) — decía «Estado: ACTIVE». */}
                Estado: {etiquetaDeEstado(data.listing.status)}
              </p>
            </Bloque>
          )}
        </aside>
      </div>
    </div>
  );
}
