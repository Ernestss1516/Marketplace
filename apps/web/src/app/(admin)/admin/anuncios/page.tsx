'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import {
  getAdminListings,
  changeListingStatus,
  deleteAdminListing,
  type AdminListing,
} from '@/lib/api/admin';
import { approveListing, rejectListing } from '@/lib/api/moderacion';
import { elegirAccionDeEstado } from './moderacion-routing';
import {
  STATUS_LABELS,
  STATUS_VARIANTS,
  TARGET_STATUSES,
  formatDate,
  formatPrice,
} from './listing-status';
import { ApiError } from '@/lib/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const PER_PAGE = 20;

const STATUS_FILTERS: { label: string; value: string | undefined }[] = [
  { label: 'Todos', value: undefined },
  { label: 'Activos', value: 'ACTIVE' },
  { label: 'En revisión', value: 'PENDING_REVIEW' },
  { label: 'Rechazados', value: 'REJECTED' },
  { label: 'Borrador', value: 'DRAFT' },
  { label: 'Caducados', value: 'EXPIRED' },
  // BORRADO B2 — el archivo tiene que ser NAVEGABLE, porque es de donde se
  // elimina. Antes no había filtro: los archivados sólo salían en «Todos», y
  // encima sin etiqueta (ver STATUS_LABELS), pintando el enum crudo.
  { label: 'Archivados', value: 'ARCHIVED' },
];

// FICHA F1 — las etiquetas, variantes, destinos y formateadores se extraen a
// `listing-status.ts` porque la ficha necesita EXACTAMENTE los mismos. Copiarlos
// habría reabierto el defecto que B2 cerró aquí (un estado sin etiqueta pinta el
// enum crudo), sólo que en una pantalla nueva.

export default function AdminAnunciosPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;
  // BORRADO B2 — eliminar es ADMIN-only dentro de una sección MODERATOR: es la
  // ÚNICA acción irreversible sobre un anuncio (aprobar, rechazar, desactivar y
  // restaurar se deshacen). El backend lo impone con @MinRole(ADMIN); esto es que
  // la UI no le prometa al moderador un botón que le va a responder 403.
  const puedeEliminar = session?.user.role === 'ADMIN';

  const [listings, setListings] = useState<AdminListing[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline status-change form
  const [editingId, setEditingId] = useState<string | null>(null);
  /** MODERACIÓN M2 — estado de PARTIDA del anuncio que se está editando. */
  const [editingStatus, setEditingStatus] = useState('');
  const [newStatus, setNewStatus] = useState('ACTIVE');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  /** BORRADO B2 — la fila pendiente de confirmar su eliminación, o null. */
  const [aEliminar, setAEliminar] = useState<AdminListing | null>(null);

  const fetchListings = useCallback(
    async (p: number, status?: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminListings(token, { status, page: p, perPage: PER_PAGE });
        setListings(data.items);
        setTotal(data.total);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? `Error ${err.statusCode}: ${err.message}`
            : 'Error inesperado al cargar anuncios',
        );
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    fetchListings(page, statusFilter);
  }, [fetchListings, page, statusFilter]);

  function handleFilter(status?: string) {
    setStatusFilter(status);
    setPage(1);
    setEditingId(null);
  }

  function startEdit(listing: AdminListing) {
    setEditingId(listing.id);
    // MODERACIÓN M2 — el estado de PARTIDA, no sólo el destino: es lo que decide
    // si este cambio es una acción de moderación o un cambio de estado normal.
    setEditingStatus(listing.status);
    setNewStatus(listing.status);
    setReason('');
  }

  async function handleSaveStatus() {
    if (!token || !editingId || saving) return;
    setSaving(true);
    try {
      // MODERACIÓN M2 — aprobar y rechazar van por SU endpoint, que es el que
      // registra y avisa al vendedor. Ver `moderacion-routing.ts`.
      const accion = elegirAccionDeEstado(editingStatus, newStatus);
      if (accion === 'approve') {
        await approveListing(editingId, token);
      } else if (accion === 'reject') {
        await rejectListing(editingId, token, reason || undefined);
      } else {
        await changeListingStatus(token, editingId, newStatus, reason || undefined);
      }
      setEditingId(null);
      await fetchListings(page, statusFilter);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Error ${err.statusCode}: ${err.message}`
          : 'Error al cambiar el estado';
      alert(msg);
    } finally {
      setSaving(false);
    }
  }

  /**
   * BORRADO B2 — eliminar de verdad. Sólo llega aquí un ADMIN y sólo desde una
   * fila ARCHIVED (el backend lo vuelve a comprobar: esto es ergonomía, no la
   * salvaguarda). Se confirma antes con `AlertDialog`, que es la regla del
   * proyecto para lo irreversible.
   */
  async function handleDelete() {
    if (!token || !aEliminar || saving) return;
    setSaving(true);
    try {
      await deleteAdminListing(token, aEliminar.id);
      setAEliminar(null);
      await fetchListings(page, statusFilter);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Error ${err.statusCode}: ${err.message}`
          : 'Error al eliminar el anuncio';
      alert(msg);
    } finally {
      setSaving(false);
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
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Anuncios</h1>
        <span className="text-sm text-muted-foreground">{total} en total</span>
      </div>

      {/* Status filter chips */}
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={String(f.value)}
            onClick={() => handleFilter(f.value)}
            className={[
              'rounded-full px-3 py-1 text-sm font-medium transition-colors',
              statusFilter === f.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Anuncio</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Vendedor</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Estado</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Precio</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Publicado</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="animate-pulse">
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 rounded bg-muted" />
                    </td>
                  ))}
                </tr>
              ))
            ) : listings.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  No hay anuncios con los filtros seleccionados.
                </td>
              </tr>
            ) : (
              listings.map((listing) => (
                <>
                  <tr key={listing.id} className="hover:bg-muted/20">
                    <td className="px-4 py-3">
                      <div className="max-w-[240px]">
                        {/* FICHA F1 — el título lleva a la FICHA, no a la página
                            pública. Esta lista tiene filtros de Borrador y
                            Archivados, así que el enlace anterior daba 404 en
                            todas esas filas: la pública sólo sirve ACTIVE. */}
                        <Link
                          href={`/admin/anuncios/${listing.id}`}
                          className="font-medium hover:underline line-clamp-1"
                          data-testid={`anuncio-enlace-${listing.id}`}
                        >
                          {listing.title}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {listing.category.name}
                          {listing._count.reports > 0 && (
                            <span className="ml-2 text-destructive font-medium">
                              {listing._count.reports} reporte(s)
                            </span>
                          )}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-xs">
                        <p className="font-medium">{listing.seller.name}</p>
                        <p className="text-muted-foreground">{listing.seller.email}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_VARIANTS[listing.status] ?? 'outline'}>
                        {STATUS_LABELS[listing.status] ?? listing.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatPrice(listing.price, listing.currency, listing.priceType)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(listing.publishedAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            editingId === listing.id ? setEditingId(null) : startEdit(listing)
                          }
                        >
                          {editingId === listing.id ? 'Cancelar' : 'Cambiar estado'}
                        </Button>
                        {/* BORRADO B2 — sólo un ADMIN, y sólo sobre un ARCHIVED.
                            Las dos condiciones son las mismas que impone el
                            backend: aquí no se protege nada, se evita prometer
                            un botón que iba a responder 400 o 403. Para
                            eliminar algo vivo hay que archivarlo antes, con el
                            selector de al lado — y ese segundo paso ES la
                            salvaguarda. */}
                        {puedeEliminar && listing.status === 'ARCHIVED' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => setAEliminar(listing)}
                          >
                            Eliminar
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Inline status-change form */}
                  {editingId === listing.id && (
                    <tr key={`${listing.id}-edit`}>
                      <td colSpan={6} className="bg-muted/30 px-6 py-4">
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="flex flex-col gap-1">
                            <label className="text-xs font-medium text-muted-foreground">
                              Nuevo estado
                            </label>
                            <select
                              value={newStatus}
                              onChange={(e) => setNewStatus(e.target.value)}
                              className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            >
                              {TARGET_STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {STATUS_LABELS[s] ?? s}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="flex flex-1 flex-col gap-1 min-w-[200px]">
                            <label className="text-xs font-medium text-muted-foreground">
                              Razón (opcional)
                            </label>
                            <input
                              type="text"
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              placeholder="Motivo del cambio..."
                              className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                            />
                          </div>
                          <Button
                            size="sm"
                            onClick={handleSaveStatus}
                            disabled={saving || newStatus === listing.status}
                          >
                            {saving ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              'Confirmar'
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
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

      {/* BORRADO B2 — confirmación de lo irreversible. Regla del proyecto:
          «acción irreversible ⇒ AlertDialog antes y aviso después». La
          descripción dice QUÉ sobrevive y qué no, porque es la única
          oportunidad de que quien pulsa sepa lo que está destruyendo. */}
      <AlertDialog open={aEliminar !== null} onOpenChange={(o) => !o && setAEliminar(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este anuncio archivado?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará «{aEliminar?.title}» de forma permanente, con sus fotos, sus
              favoritos y sus estadísticas. Las denuncias, las conversaciones, los tratos
              y las valoraciones se conservan. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleDelete()}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
