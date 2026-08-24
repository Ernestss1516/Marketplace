'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import {
  getAdminCategories,
  getAdminListings,
  changeListingStatus,
  deleteAdminListing,
  type AdminCategory,
  type AdminListing,
  type AdminListingsFilters,
} from '@/lib/api/admin';
import { FiltrosAnuncios } from './_components/FiltrosAnuncios';
import { VideoIndicator } from '@/components/anuncios/VideoIndicator';
import { aQueryString, conFiltro, leerFiltros } from './filtros-url';
import { approveListing, rejectListing } from '@/lib/api/moderacion';
import { elegirAccionDeEstado } from './moderacion-routing';
import {
  STATUS_LABELS,
  STATUS_VARIANTS,
  TARGET_STATUSES,
  formatDate,
  formatPrice,
} from './listing-status';
import { etiquetaDeTriage, varianteDeTriage } from './listing-triage';
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

// FICHA F1 — las etiquetas, variantes, destinos y formateadores se extraen a
// `listing-status.ts` porque la ficha necesita EXACTAMENTE los mismos. Copiarlos
// habría reabierto el defecto que B2 cerró aquí (un estado sin etiqueta pinta el
// enum crudo), sólo que en una pantalla nueva.
//
// FICHA F2 — la tira de botones de estado ÚNICO (`STATUS_FILTERS`) desaparece:
// la sustituyen los chips múltiples de `FiltrosAnuncios`, que hacen todo lo que
// hacía aquélla y además responden a las preguntas que son CONJUNTOS
// («borrador o pendiente»). Los nueve estados están, incluido `ARCHIVED` —que
// B2 tuvo que añadir a mano— porque la lista sale del enum y no de una copia.

export default function AdminAnunciosPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;
  // BORRADO B2 — eliminar es ADMIN-only dentro de una sección MODERATOR: es la
  // ÚNICA acción irreversible sobre un anuncio (aprobar, rechazar, desactivar y
  // restaurar se deshacen). El backend lo impone con @MinRole(ADMIN); esto es que
  // la UI no le prometa al moderador un botón que le va a responder 403.
  const puedeEliminar = session?.user.role === 'ADMIN';

  // FICHA F2 — LOS FILTROS VIVEN EN LA URL. Así una búsqueda se comparte, la
  // vuelta atrás del navegador devuelve a lo que estabas mirando (antes volvías
  // a la lista en blanco), y otra pantalla puede enlazar a un filtro concreto —
  // que es justo lo que hace la ficha con «ver todo lo de este vendedor».
  const router = useRouter();
  const searchParams = useSearchParams();
  const filtros = useMemo(
    () => leerFiltros(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const page = filtros.page ?? 1;

  const [listings, setListings] = useState<AdminListing[]>([]);
  const [total, setTotal] = useState(0);
  const [categorias, setCategorias] = useState<AdminCategory[]>([]);
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
    async (f: AdminListingsFilters) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminListings(token, { ...f, perPage: PER_PAGE });
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
    void fetchListings(filtros);
  }, [fetchListings, filtros]);

  // El selector de categoría necesita el árbol completo; se pide una vez.
  useEffect(() => {
    if (!token) return;
    getAdminCategories(token)
      .then(setCategorias)
      .catch(() => setCategorias([]));
  }, [token]);

  /** Navegar es lo que dispara la recarga: el estado real está en la URL. */
  function aplicar(filtrosNuevos: AdminListingsFilters) {
    setEditingId(null);
    const qs = aQueryString(filtrosNuevos);
    router.push(qs ? `/admin/anuncios?${qs}` : '/admin/anuncios');
  }

  function cambiarFiltro(cambio: Partial<AdminListingsFilters>) {
    aplicar(conFiltro(filtros, cambio));
  }

  function irAPagina(p: number) {
    aplicar({ ...filtros, page: p });
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
      await fetchListings(filtros);
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
      await fetchListings(filtros);
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

      <FiltrosAnuncios
        filtros={filtros}
        categorias={categorias}
        total={total}
        onCambiar={cambiarFiltro}
        onLimpiar={() => aplicar({})}
      />

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
                          {/* VÍDEO #13 — el MISMO indicador que las tarjetas públicas,
                              en su variante en línea. Aquí no hay foto sobre la que
                              superponerlo, pero sí hay una razón para que esté: el vídeo
                              es lo más caro de moderar (hay que verlo), y hasta ahora
                              sólo se sabía entrando en la ficha de una en una.

                              Llega `hasVideo`, nunca la URL: la lista no monta ningún
                              `<video>` y no podría aunque quisiera. */}
                          {listing.hasVideo && (
                            <span className="ml-2 align-middle">
                              <VideoIndicator inline />
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
                      {/* ETIQUETA INTERNA (P1, E2) — DEBAJO del estado y no al
                          lado: son ejes distintos, y en una fila estrecha dos
                          insignias pegadas se leen como una sola. */}
                      <div
                        className="mt-1 flex flex-wrap gap-1"
                        data-testid={`anuncio-triage-${listing.id}`}
                      >
                        <Badge
                          variant={varianteDeTriage(listing.triage)}
                          className="text-[10px]"
                        >
                          {etiquetaDeTriage(listing.triage)}
                        </Badge>
                        {listing.watched && (
                          <Badge variant="secondary" className="text-[10px]">
                            En observación
                          </Badge>
                        )}
                      </div>
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
            onClick={() => irAPagina(Math.max(1, page - 1))}
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
            onClick={() => irAPagina(Math.min(totalPages, page + 1))}
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
