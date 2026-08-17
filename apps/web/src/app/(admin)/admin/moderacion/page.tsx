'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Loader2, Undo2, XCircle } from 'lucide-react';
import { getAdminListings, changeListingStatus, type AdminListing } from '@/lib/api/admin';
import { approveListing, rejectListing } from '@/lib/api/moderacion';
import { elegirAccionDeEstado } from '../anuncios/moderacion-routing';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';

const PER_PAGE = 20;

/**
 * MODERACIÓN M3 — LA COLA DEL MODERADOR.
 *
 * POR QUÉ UNA PANTALLA PROPIA y no un filtro de `/admin/anuncios`. La auditoría
 * encontró que la cola *de facto* era ese filtro, y de ahí salían los dos
 * problemas que M2 cerró: el moderador cambiaba estados con el selector genérico,
 * que esquivaba el registro y los avisos. Una lista genérica invita a tratar la
 * moderación como «cambiar un campo»; una cola invita a **despacharla**, que es
 * lo que es: trabajo pendiente con tres desenlaces y ninguno más.
 *
 * ESTA PANTALLA NO TIENE LÓGICA DE MODERACIÓN. Todo lo que decide está detrás:
 * a qué endpoint va cada acción lo dice `elegirAccionDeEstado` (la función pura
 * de M2, reutilizada — NO se repite aquí), si un anuncio puede aprobarse lo dice
 * la puerta, y los avisos los manda el backend. Aquí sólo se pinta y se llama.
 *
 * APROBAR PUEDE FALLAR, y ése es el caso que esta pantalla existe para manejar
 * bien. Desde M2, aprobar comprueba las reglas del ANUNCIO: un anuncio sin fotos
 * —con esa regla encendida— no se puede aprobar. La cola muestra el motivo EN LA
 * FILA y el anuncio SE QUEDA, porque el moderador tiene que poder hacer lo otro:
 * devolvérselo al vendedor para que lo complete.
 */

/** Las tres salidas de `PENDING_REVIEW`, y ninguna más. */
type Accion = 'aprobar' | 'rechazar' | 'devolver';

const DESTINO: Record<Accion, string> = {
  aprobar: 'ACTIVE',
  rechazar: 'REJECTED',
  devolver: 'DRAFT',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

function diasEsperando(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export default function AdminModeracionPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [items, setItems] = useState<AdminListing[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Fila en curso, para deshabilitar sus botones mientras responde el servidor. */
  const [busyId, setBusyId] = useState<string | null>(null);
  /** El motivo de rechazo que escribe el moderador, por fila. */
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  /**
   * POR QUÉ NO SE PUDO APROBAR, por fila. Es el hueco que M2 abrió y que esta
   * pantalla cierra: sin esto, pulsar «Aprobar» sobre un anuncio sin fotos no
   * haría nada visible y el moderador se quedaría mirando la pantalla.
   */
  const [rechazos, setRechazos] = useState<Record<string, string>>({});

  const fetchCola = useCallback(
    async (p: number) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminListings(token, {
          // La cola es EXACTAMENTE los pendientes. Ningún otro estado.
          status: 'PENDING_REVIEW',
          page: p,
          perPage: PER_PAGE,
          // Lo que lleva más tiempo esperando, primero.
          order: 'oldest',
        });
        setItems(data.items);
        setTotal(data.total);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? `Error ${err.statusCode}: ${err.message}`
            : 'Error inesperado al cargar la cola',
        );
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    fetchCola(page);
  }, [fetchCola, page]);

  async function ejecutar(listing: AdminListing, accion: Accion) {
    if (!token || busyId) return;
    setBusyId(listing.id);
    setRechazos((prev) => ({ ...prev, [listing.id]: '' }));
    const motivo = motivos[listing.id]?.trim() || undefined;

    try {
      // LA MISMA decisión que usa `/admin/anuncios`, no una copia. Si algún día
      // cambia qué endpoint corresponde a qué transición, cambia en un sitio.
      const via = elegirAccionDeEstado(listing.status, DESTINO[accion]);
      if (via === 'approve') {
        await approveListing(listing.id, token);
      } else if (via === 'reject') {
        await rejectListing(listing.id, token, motivo);
      } else {
        await changeListingStatus(token, listing.id, DESTINO[accion], motivo);
      }
      // Despachado: desaparece de la cola.
      await fetchCola(page);
    } catch (err) {
      if (err instanceof ApiError) {
        // El motivo que da la puerta («Añade al menos 1 foto…») va TAL CUAL: lo
        // escribe el backend, que es quien sabe por qué no se puede aprobar.
        setRechazos((prev) => ({ ...prev, [listing.id]: err.message }));
      } else {
        setRechazos((prev) => ({ ...prev, [listing.id]: 'No se ha podido completar la acción.' }));
      }
    } finally {
      setBusyId(null);
    }
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
        <div>
          <h1 className="text-2xl font-bold">Cola de revisión</h1>
          <p className="text-sm text-muted-foreground">
            Anuncios esperando aprobación. Los que llevan más tiempo, primero.
          </p>
        </div>
        <span className="text-sm text-muted-foreground" data-testid="cola-total">
          {total} pendiente{total === 1 ? '' : 's'}
        </span>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-md border bg-muted/30" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div
          className="rounded-md border border-dashed p-10 text-center text-sm text-muted-foreground"
          data-testid="cola-vacia"
        >
          No hay anuncios esperando revisión.
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((listing) => {
            const dias = diasEsperando(listing.updatedAt);
            const bloqueado = busyId === listing.id;
            return (
              <div
                key={listing.id}
                className="rounded-md border bg-background p-4"
                data-testid={`cola-item-${listing.id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/anuncio/${listing.slug}`}
                      target="_blank"
                      className="font-medium hover:underline"
                    >
                      {listing.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {listing.seller?.name ?? '—'} · {listing.category?.name ?? '—'} · en cola
                      desde {formatDate(listing.updatedAt)}
                      {dias !== null && dias > 0 && ` (${dias} día${dias === 1 ? '' : 's'})`}
                    </p>
                  </div>
                </div>

                {/* El motivo viaja con el rechazo y con la devolución: las dos le
                    llegan al vendedor, y «no» sin explicación no es accionable. */}
                <input
                  type="text"
                  value={motivos[listing.id] ?? ''}
                  onChange={(e) =>
                    setMotivos((prev) => ({ ...prev, [listing.id]: e.target.value }))
                  }
                  placeholder="Motivo (se le envía al vendedor al rechazar o devolver)"
                  data-testid={`cola-motivo-${listing.id}`}
                  className="mt-3 w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={bloqueado}
                />

                {rechazos[listing.id] && (
                  <p
                    className="mt-2 flex items-start gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200"
                    data-testid={`cola-bloqueo-${listing.id}`}
                  >
                    <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      No se ha podido aprobar: {rechazos[listing.id]} El anuncio sigue en la cola;
                      puedes devolverlo al vendedor para que lo corrija.
                    </span>
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => ejecutar(listing, 'aprobar')}
                    disabled={bloqueado}
                    data-testid={`cola-aprobar-${listing.id}`}
                  >
                    {bloqueado ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Aprobar
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => ejecutar(listing, 'rechazar')}
                    disabled={bloqueado}
                    data-testid={`cola-rechazar-${listing.id}`}
                  >
                    <XCircle className="mr-1.5 h-3.5 w-3.5" />
                    Rechazar
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => ejecutar(listing, 'devolver')}
                    disabled={bloqueado}
                    data-testid={`cola-devolver-${listing.id}`}
                  >
                    <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                    Devolver a borrador
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
          >
            Siguiente
          </Button>
        </div>
      )}
    </div>
  );
}
