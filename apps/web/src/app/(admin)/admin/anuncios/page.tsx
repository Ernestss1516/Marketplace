'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { AlertCircle, Loader2 } from 'lucide-react';
import {
  getAdminListings,
  changeListingStatus,
  type AdminListing,
} from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const PER_PAGE = 20;

const STATUS_FILTERS: { label: string; value: string | undefined }[] = [
  { label: 'Todos', value: undefined },
  { label: 'Activos', value: 'ACTIVE' },
  { label: 'En revisión', value: 'PENDING_REVIEW' },
  { label: 'Rechazados', value: 'REJECTED' },
  { label: 'Borrador', value: 'DRAFT' },
  { label: 'Caducados', value: 'EXPIRED' },
];

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activo',
  PENDING_REVIEW: 'En revisión',
  REJECTED: 'Rechazado',
  DRAFT: 'Borrador',
  EXPIRED: 'Caducado',
  RESERVED: 'Reservado',
  SOLD: 'Vendido',
};

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  ACTIVE: 'default',
  PENDING_REVIEW: 'secondary',
  REJECTED: 'destructive',
  DRAFT: 'outline',
  EXPIRED: 'outline',
  RESERVED: 'secondary',
  SOLD: 'outline',
};

const TARGET_STATUSES = ['ACTIVE', 'PENDING_REVIEW', 'REJECTED', 'DRAFT'];

function formatPrice(price: number, currency: string, priceType: string) {
  if (priceType === 'FREE') return 'Gratis';
  if (priceType === 'NEGOTIABLE') return 'A convenir';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(price);
}

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export default function AdminAnunciosPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [listings, setListings] = useState<AdminListing[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Inline status-change form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState('ACTIVE');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

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
    setNewStatus(listing.status);
    setReason('');
  }

  async function handleSaveStatus() {
    if (!token || !editingId || saving) return;
    setSaving(true);
    try {
      await changeListingStatus(token, editingId, newStatus, reason || undefined);
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
                        <Link
                          href={`/anuncio/${listing.slug}`}
                          target="_blank"
                          className="font-medium hover:underline line-clamp-1"
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          editingId === listing.id ? setEditingId(null) : startEdit(listing)
                        }
                      >
                        {editingId === listing.id ? 'Cancelar' : 'Cambiar estado'}
                      </Button>
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
    </div>
  );
}
