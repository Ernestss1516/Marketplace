'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AlertCircle, ChevronDown, ChevronRight, Loader2, Search } from 'lucide-react';
import {
  getAdminUsers,
  getAdminUser,
  suspendUser,
  banUser,
  reinstateUser,
  type AdminUser,
  type AdminUserDetail,
} from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const PER_PAGE = 20;

const STATUS_FILTERS: { label: string; value: string | undefined }[] = [
  { label: 'Todos', value: undefined },
  { label: 'Activos', value: 'ACTIVE' },
  { label: 'Suspendidos', value: 'SUSPENDED' },
  { label: 'Baneados', value: 'BANNED' },
];

const ROLE_FILTERS: { label: string; value: string | undefined }[] = [
  { label: 'Todos', value: undefined },
  { label: 'Usuario', value: 'USER' },
  { label: 'Moderador', value: 'MODERATOR' },
  { label: 'Admin', value: 'ADMIN' },
];

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Activo',
  SUSPENDED: 'Suspendido',
  BANNED: 'Baneado',
};

const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  ACTIVE: 'default',
  SUSPENDED: 'secondary',
  BANNED: 'destructive',
};

const ROLE_LABELS: Record<string, string> = {
  USER: 'Usuario',
  MODERATOR: 'Moderador',
  ADMIN: 'Admin',
};

const REPORT_REASON_LABELS: Record<string, string> = {
  SPAM: 'Spam',
  FRAUD: 'Fraude',
  INAPPROPRIATE: 'Inapropiado',
  PROHIBITED_ITEM: 'Artículo prohibido',
  WRONG_CATEGORY: 'Categoría incorrecta',
  OTHER: 'Otro',
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

function formatPrice(price: number, currency: string, priceType: string) {
  if (priceType === 'FREE') return 'Gratis';
  if (priceType === 'NEGOTIABLE') return 'A convenir';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(price);
}

function UserDetailPanel({
  userId,
  token,
}: {
  userId: string;
  token: string;
}) {
  const [data, setData] = useState<AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getAdminUser(token, userId)
      .then(setData)
      .catch((e: unknown) =>
        setError(e instanceof ApiError ? `Error ${e.statusCode}: ${e.message}` : 'Error al cargar'),
      )
      .finally(() => setLoading(false));
  }, [token, userId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando detalle...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-2 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" />
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      {/* Last listings */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Últimos anuncios ({data.listings.length})
        </h3>
        {data.listings.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin anuncios.</p>
        ) : (
          <div className="space-y-1">
            {data.listings.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="line-clamp-1 flex-1 font-medium">{l.title}</span>
                <span className="shrink-0 text-muted-foreground">
                  {formatPrice(l.price, l.currency, l.priceType)}
                </span>
                <Badge
                  variant={
                    l.status === 'ACTIVE'
                      ? 'default'
                      : l.status === 'REJECTED'
                        ? 'destructive'
                        : 'outline'
                  }
                  className="shrink-0 text-[10px]"
                >
                  {l.status === 'ACTIVE'
                    ? 'Activo'
                    : l.status === 'PENDING_REVIEW'
                      ? 'Revisión'
                      : l.status === 'REJECTED'
                        ? 'Rechazado'
                        : l.status === 'DRAFT'
                          ? 'Borrador'
                          : l.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reports received */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Reportes recibidos ({data.reportsReceived.length})
        </h3>
        {data.reportsReceived.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sin reportes.</p>
        ) : (
          <div className="space-y-1">
            {data.reportsReceived.map((r) => (
              <div key={r.id} className="flex items-center gap-2 text-xs">
                <Badge variant="outline" className="shrink-0 text-[10px]">
                  {REPORT_REASON_LABELS[r.reason] ?? r.reason}
                </Badge>
                <span className="text-muted-foreground">{r.status}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">{formatDate(r.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Audit log */}
      {data.auditLogs.length > 0 && (
        <div className="md:col-span-2">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Acciones administrativas ({data.auditLogs.length})
          </h3>
          <div className="space-y-1">
            {data.auditLogs.slice(0, 5).map((log) => (
              <div key={log.id} className="flex items-center gap-2 text-xs">
                <span className="font-mono font-medium">{log.action}</span>
                <span className="text-muted-foreground">por {log.actor.name}</span>
                <span className="ml-auto shrink-0 text-muted-foreground">
                  {formatDate(log.createdAt)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function AdminUsuariosPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [roleFilter, setRoleFilter] = useState<string | undefined>(undefined);
  const [q, setQ] = useState('');
  const [inputQ, setInputQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Expanded detail row
  const [detailId, setDetailId] = useState<string | null>(null);

  // Action in-flight
  const [pendingId, setPendingId] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  const fetchUsers = useCallback(
    async (p: number, status?: string, role?: string, search?: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminUsers(token, { status, role, q: search, page: p });
        setUsers(data.items);
        setTotal(data.total);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? `Error ${err.statusCode}: ${err.message}`
            : 'Error inesperado al cargar usuarios',
        );
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    fetchUsers(page, statusFilter, roleFilter, q);
  }, [fetchUsers, page, statusFilter, roleFilter, q]);

  function handleFilter(type: 'status' | 'role', value?: string) {
    if (type === 'status') setStatusFilter(value);
    else setRoleFilter(value);
    setPage(1);
    setDetailId(null);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setQ(inputQ.trim());
    setPage(1);
    setDetailId(null);
  }

  async function handleAction(
    action: () => Promise<unknown>,
    userId: string,
  ) {
    setPendingId(userId);
    try {
      await action();
      await fetchUsers(page, statusFilter, roleFilter, q);
      if (detailId === userId) setDetailId(null);
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
        <h1 className="text-2xl font-bold">Usuarios</h1>
        <span className="text-sm text-muted-foreground">{total} en total</span>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="mb-4 flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            ref={searchRef}
            type="text"
            value={inputQ}
            onChange={(e) => setInputQ(e.target.value)}
            placeholder="Buscar por nombre o email..."
            className="w-full rounded-md border bg-background py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <Button type="submit" variant="outline" size="sm">
          Buscar
        </Button>
        {q && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setInputQ('');
              setQ('');
              setPage(1);
            }}
          >
            Limpiar
          </Button>
        )}
      </form>

      {/* Filters */}
      <div className="mb-2 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={String(f.value)}
            onClick={() => handleFilter('status', f.value)}
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
      <div className="mb-4 flex flex-wrap gap-2">
        {ROLE_FILTERS.map((f) => (
          <button
            key={String(f.value)}
            onClick={() => handleFilter('role', f.value)}
            className={[
              'rounded-full px-3 py-1 text-sm font-medium transition-colors',
              roleFilter === f.value
                ? 'bg-secondary text-secondary-foreground'
                : 'bg-muted/50 text-muted-foreground hover:bg-muted',
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
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Usuario</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Rol</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Estado</th>
              <th className="px-4 py-3 text-center font-medium text-muted-foreground">Anuncios</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Registro</th>
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
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">
                  No hay usuarios con los filtros seleccionados.
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const isAdmin = user.role === 'ADMIN';
                const isPending = pendingId === user.id;
                const isExpanded = detailId === user.id;

                return (
                  <>
                    <tr key={user.id} className="hover:bg-muted/20">
                      <td className="px-4 py-3">
                        <div>
                          <p className="font-medium">{user.name}</p>
                          <p className="text-xs text-muted-foreground">{user.email}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={isAdmin ? 'destructive' : 'outline'}>
                          {ROLE_LABELS[user.role] ?? user.role}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={STATUS_VARIANTS[user.status] ?? 'outline'}>
                          {STATUS_LABELS[user.status] ?? user.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center tabular-nums">
                        {user._count.listings}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(user.createdAt)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap justify-end gap-1">
                          {/* Detail toggle */}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDetailId(isExpanded ? null : user.id)}
                            className="h-7 px-2 text-xs"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                            Ver
                          </Button>

                          {/* Status actions — not shown for ADMINs */}
                          {!isAdmin && (
                            <>
                              {user.status === 'ACTIVE' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  disabled={isPending}
                                  onClick={() =>
                                    handleAction(() => suspendUser(token, user.id), user.id)
                                  }
                                >
                                  {isPending ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    'Suspender'
                                  )}
                                </Button>
                              )}
                              {(user.status === 'ACTIVE' || user.status === 'SUSPENDED') && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                                  disabled={isPending}
                                  onClick={() =>
                                    handleAction(() => banUser(token, user.id), user.id)
                                  }
                                >
                                  {isPending ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    'Banear'
                                  )}
                                </Button>
                              )}
                              {(user.status === 'SUSPENDED' || user.status === 'BANNED') && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  disabled={isPending}
                                  onClick={() =>
                                    handleAction(() => reinstateUser(token, user.id), user.id)
                                  }
                                >
                                  {isPending ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    'Reinstaurar'
                                  )}
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded detail panel */}
                    {isExpanded && (
                      <tr key={`${user.id}-detail`}>
                        <td colSpan={6} className="bg-muted/20 px-6 py-4">
                          <UserDetailPanel userId={user.id} token={token} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })
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
