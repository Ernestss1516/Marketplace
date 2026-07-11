'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { Loader2, Plus, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import {
  getAdminSponsoredAds,
  updateAdminSponsoredAd,
  type AdminSponsoredAd,
} from '@/lib/api/admin-sponsored-ads';
import { SponsoredAdFormDialog } from './_components/SponsoredAdFormDialog';

const PER_PAGE = 20;

const STATUS_LABELS: Record<string, string> = {
  upcoming: 'Próximamente',
  live: 'Vigente',
  ended: 'Terminado',
};

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  upcoming: 'secondary',
  live: 'default',
  ended: 'outline',
};

function formatWindow(startsAt: string | null, endsAt: string | null): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    });
  if (!startsAt && !endsAt) return 'Sin límite';
  if (startsAt && endsAt) return `${fmt(startsAt)} – ${fmt(endsAt)}`;
  if (startsAt) return `Desde ${fmt(startsAt)}`;
  return `Hasta ${fmt(endsAt!)}`;
}

export default function AdminSponsoredAdsPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [ads, setAds] = useState<AdminSponsoredAd[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAd, setEditingAd] = useState<AdminSponsoredAd | null>(null);

  const fetchAds = useCallback(
    async (p: number, active?: boolean) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminSponsoredAds(token, { active, page: p, perPage: PER_PAGE });
        setAds(data.items);
        setTotal(data.total);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? `Error ${err.statusCode}: ${err.message}`
            : 'Error al cargar patrocinados',
        );
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    fetchAds(page, activeFilter);
  }, [fetchAds, page, activeFilter]);

  function handleFilter(value: boolean | undefined) {
    setActiveFilter(value);
    setPage(1);
  }

  function openCreate() {
    setEditingAd(null);
    setDialogOpen(true);
  }

  function openEdit(ad: AdminSponsoredAd) {
    setEditingAd(ad);
    setDialogOpen(true);
  }

  async function handleToggleActive(ad: AdminSponsoredAd) {
    if (!token || actionLoading) return;
    setActionLoading(ad.id);
    try {
      await updateAdminSponsoredAd(token, ad.id, { active: !ad.active });
      await fetchAds(page, activeFilter);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Error al cambiar el estado');
    } finally {
      setActionLoading(null);
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
        <h1 className="text-2xl font-bold">Patrocinados</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{total} patrocinados</span>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            Nuevo patrocinado
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { label: 'Todos', value: undefined },
          { label: 'Activos', value: true },
          { label: 'Inactivos', value: false },
        ].map((f) => (
          <button
            key={String(f.value)}
            onClick={() => handleFilter(f.value)}
            className={[
              'rounded-full px-3 py-1 text-sm font-medium transition-colors',
              activeFilter === f.value
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80',
            ].join(' ')}
          >
            {f.label}
          </button>
        ))}
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
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Imagen</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Título</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Categoría</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Vigencia</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Estado</th>
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
            ) : ads.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  No hay patrocinados con los filtros seleccionados.
                </td>
              </tr>
            ) : (
              ads.map((ad) => (
                <tr key={ad.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="relative h-10 w-10 overflow-hidden rounded bg-muted">
                      <Image src={ad.imageUrl} alt={ad.title} fill className="object-cover" sizes="40px" />
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium">{ad.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">{ad.category.name}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatWindow(ad.startsAt, ad.endsAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <Badge variant={STATUS_VARIANTS[ad.status] ?? 'outline'}>
                        {STATUS_LABELS[ad.status] ?? ad.status}
                      </Badge>
                      {!ad.active && (
                        <Badge variant="outline" className="text-muted-foreground">
                          Inactivo
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => openEdit(ad)}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleToggleActive(ad)}
                        disabled={!!actionLoading}
                      >
                        {actionLoading === ad.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : ad.active ? (
                          'Desactivar'
                        ) : (
                          'Activar'
                        )}
                      </Button>
                    </div>
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

      <SponsoredAdFormDialog
        token={token}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        ad={editingAd}
        onSuccess={() => fetchAds(page, activeFilter)}
      />
    </div>
  );
}
