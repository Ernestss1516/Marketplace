'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Loader2, Plus, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import { getAdminBanners, updateAdminBanner, type AdminBanner } from '@/lib/api/admin-banners';
import {
  ALL_PLACEMENTS,
  PLACEMENT_GROUPS,
  PLACEMENT_LABELS,
  type BannerPlacement,
} from '@/lib/api/banners';
import { BannerFormDialog } from './_components/BannerFormDialog';

const PER_PAGE = 20;

// I18N T3-B — este mapa estaba escrito a mano en CUATRO pantallas (banners,
// campañas, cupones y publicidad patrocinada), idéntico en las cuatro: el récord de
// copias del repo. Cuatro sitios que responden la misma pregunta la responden ya con
// las mismas palabras, y desde un solo sitio.
import { ESTADO_VIGENCIA_LABELS as STATUS_LABELS } from '@/lib/etiquetas-enums';
import { SesionNoDisponible } from '@/app/(admin)/components/SesionNoDisponible';

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline'> = {
  upcoming: 'secondary',
  live: 'default',
  ended: 'outline',
};

/**
 * Resumen de la celda «Ubicaciones».
 *
 * Con dos ubicaciones, enumerarlas cabía de sobra. Con catorce, un banner puesto
 * en todas producía una celda de ~180 caracteres que reventaba el ancho de la
 * tabla y no se leía igual. Se enumera hasta tres; a partir de ahí se cuenta, y
 * el detalle completo vive en el `title` (y en el formulario, que es donde se
 * edita de verdad).
 */
function resumirPlacements(placements: BannerPlacement[]): { texto: string; detalle: string } {
  const nombres = placements.map((p) => PLACEMENT_LABELS[p]);
  const detalle = nombres.join(', ');
  if (placements.length === ALL_PLACEMENTS.length) return { texto: 'Todas', detalle };
  if (placements.length > 3) return { texto: `${placements.length} ubicaciones`, detalle };
  return { texto: detalle, detalle };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AdminBannersPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [banners, setBanners] = useState<AdminBanner[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(undefined);
  // '' = todas. El API ya aceptaba este filtro desde el primer día
  // (ListBannersDto.placement) y la UI nunca lo pintó: con dos ubicaciones no
  // hacía falta, con catorce «enséñame qué hay publicado en la ficha de anuncio»
  // es la pregunta natural.
  const [placementFilter, setPlacementFilter] = useState<BannerPlacement | ''>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBanner, setEditingBanner] = useState<AdminBanner | null>(null);

  const fetchBanners = useCallback(
    async (p: number, active?: boolean, placement?: BannerPlacement | '') => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminBanners(token, {
          active,
          ...(placement && { placement }),
          page: p,
          perPage: PER_PAGE,
        });
        setBanners(data.items);
        setTotal(data.total);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? `Error ${err.statusCode}: ${err.message}`
            : 'Error al cargar banners',
        );
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    fetchBanners(page, activeFilter, placementFilter);
  }, [fetchBanners, page, activeFilter, placementFilter]);

  function handleFilter(value: boolean | undefined) {
    setActiveFilter(value);
    setPage(1);
  }

  function handlePlacementFilter(value: BannerPlacement | '') {
    setPlacementFilter(value);
    setPage(1);
  }

  function openCreate() {
    setEditingBanner(null);
    setDialogOpen(true);
  }

  function openEdit(banner: AdminBanner) {
    setEditingBanner(banner);
    setDialogOpen(true);
  }

  async function handleToggleActive(banner: AdminBanner) {
    if (!token || actionLoading) return;
    setActionLoading(banner.id);
    try {
      await updateAdminBanner(token, banner.id, { active: !banner.active });
      await fetchBanners(page, activeFilter, placementFilter);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Error al cambiar el estado');
    } finally {
      setActionLoading(null);
    }
  }

  const totalPages = Math.ceil(total / PER_PAGE);

  if (!token) {
    return (
      <SesionNoDisponible />
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Banners</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{total} banners</span>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            Nuevo banner
          </Button>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
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

        {/* Filtro por ubicación — agrupado igual que el selector del formulario,
            para que las dos pantallas se lean con el mismo mapa. */}
        <select
          value={placementFilter}
          onChange={(e) => handlePlacementFilter(e.target.value as BannerPlacement | '')}
          aria-label="Filtrar por ubicación"
          data-testid="banner-placement-filter"
          className="ml-auto rounded-md border bg-background px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="">Todas las ubicaciones</option>
          {PLACEMENT_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.values.map((value) => (
                <option key={value} value={value}>
                  {PLACEMENT_LABELS[value]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
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
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Título</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Ubicaciones</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Vigencia</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Estado</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground">Acciones</th>
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
            ) : banners.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  No hay banners con los filtros seleccionados.
                </td>
              </tr>
            ) : (
              banners.map((banner) => (
                <tr key={banner.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-medium">{banner.title}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {(() => {
                      const { texto, detalle } = resumirPlacements(banner.placements);
                      return <span title={detalle}>{texto}</span>;
                    })()}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDate(banner.startsAt)} – {formatDate(banner.endsAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <Badge variant={STATUS_VARIANTS[banner.status] ?? 'outline'}>
                        {STATUS_LABELS[banner.status] ?? banner.status}
                      </Badge>
                      {!banner.active && (
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
                        onClick={() => openEdit(banner)}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleToggleActive(banner)}
                        disabled={!!actionLoading}
                      >
                        {actionLoading === banner.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : banner.active ? (
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

      <BannerFormDialog
        token={token}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        banner={editingBanner}
        onSuccess={() => fetchBanners(page, activeFilter, placementFilter)}
      />
    </div>
  );
}
