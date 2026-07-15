'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { Loader2, Plus, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import { getAdminCoupons, updateAdminCoupon, type AdminCoupon } from '@/lib/api/admin-coupons';
import { CouponFormDialog } from './_components/CouponFormDialog';

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function AdminCuponesPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<AdminCoupon | null>(null);

  const fetchCoupons = useCallback(
    async (p: number, active?: boolean) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminCoupons(token, { active, page: p, perPage: PER_PAGE });
        setCoupons(data.items);
        setTotal(data.total);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? `Error ${err.statusCode}: ${err.message}`
            : 'Error al cargar cupones',
        );
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    fetchCoupons(page, activeFilter);
  }, [fetchCoupons, page, activeFilter]);

  function handleFilter(value: boolean | undefined) {
    setActiveFilter(value);
    setPage(1);
  }

  function openCreate() {
    setEditingCoupon(null);
    setDialogOpen(true);
  }

  function openEdit(coupon: AdminCoupon) {
    setEditingCoupon(coupon);
    setDialogOpen(true);
  }

  async function handleToggleActive(coupon: AdminCoupon) {
    if (!token || actionLoading) return;
    setActionLoading(coupon.id);
    try {
      await updateAdminCoupon(token, coupon.id, { active: !coupon.active });
      await fetchCoupons(page, activeFilter);
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
        <h1 className="text-2xl font-bold">Cupones</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{total} cupones</span>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" />
            Nuevo cupón
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
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Código</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Recompensa</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Usos</th>
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
            ) : coupons.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  No hay cupones con los filtros seleccionados.
                </td>
              </tr>
            ) : (
              coupons.map((coupon) => (
                <tr key={coupon.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3 font-mono font-medium">{coupon.code}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {coupon.rewardType === 'CREDITS'
                      ? `${coupon.creditAmount} créditos`
                      : coupon.rewardType === 'BUMP'
                        ? `${coupon.bumpAmount} bumps`
                        : `Destacado ${coupon.featuredDurationDays}d`}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {coupon.redemptionCount}/{coupon.maxRedemptions ?? '∞'}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {formatDate(coupon.startsAt)} – {formatDate(coupon.endsAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <Badge variant={STATUS_VARIANTS[coupon.status] ?? 'outline'}>
                        {STATUS_LABELS[coupon.status] ?? coupon.status}
                      </Badge>
                      {!coupon.active && (
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
                        onClick={() => openEdit(coupon)}
                      >
                        Editar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => handleToggleActive(coupon)}
                        disabled={!!actionLoading}
                      >
                        {actionLoading === coupon.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : coupon.active ? (
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

      <CouponFormDialog
        token={token}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        coupon={editingCoupon}
        onSuccess={() => fetchCoupons(page, activeFilter)}
      />
    </div>
  );
}
