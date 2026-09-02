'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { AlertCircle, Loader2, Plus } from 'lucide-react';
import {
  getAdminPosts,
  publishAdminPost,
  unpublishAdminPost,
  deleteAdminPost,
  type AdminPostSummary,
} from '@/lib/api/blog-admin';
import { ApiError } from '@/lib/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

const PER_PAGE = 20;

const STATUS_FILTERS: { label: string; value: string | undefined }[] = [
  { label: 'Todas', value: undefined },
  { label: 'Borrador', value: 'DRAFT' },
  { label: 'Publicada', value: 'PUBLISHED' },
];

// I18N T3-B — estaba en la lista y en el editor, idéntico. «Publicada» concuerda con
// «la página»: es una VARIANTE declarada de la del blog, no una divergencia.
import { ESTADO_PAGINA_LABELS as STATUS_LABELS } from '@/lib/etiquetas-enums';

const STATUS_VARIANTS: Record<string, 'default' | 'outline'> = {
  DRAFT: 'outline',
  PUBLISHED: 'default',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  });
}

export default function AdminPaginasPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;
  const currentUserIsAdmin = session?.user.role === 'ADMIN';

  const [pages, setPages] = useState<AdminPostSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchPages = useCallback(
    async (p: number, status?: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminPosts(token, { status, type: 'PAGE', page: p, perPage: PER_PAGE });
        setPages(data.items);
        setTotal(data.total);
      } catch (err) {
        setError(
          err instanceof ApiError
            ? `Error ${err.statusCode}: ${err.message}`
            : 'Error al cargar páginas',
        );
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    fetchPages(page, statusFilter);
  }, [fetchPages, page, statusFilter]);

  function handleFilter(status?: string) {
    setStatusFilter(status);
    setPage(1);
  }

  async function handlePublish(item: AdminPostSummary) {
    if (!token || actionLoading) return;
    setActionLoading(`pub-${item.id}`);
    try {
      await publishAdminPost(token, item.id);
      await fetchPages(page, statusFilter);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Error al publicar');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleUnpublish(item: AdminPostSummary) {
    if (!token || actionLoading) return;
    setActionLoading(`unpub-${item.id}`);
    try {
      await unpublishAdminPost(token, item.id);
      await fetchPages(page, statusFilter);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Error al despublicar');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDelete(item: AdminPostSummary) {
    if (
      !token ||
      !window.confirm(`¿Eliminar la página "${item.title}"? Esta acción no se puede deshacer.`)
    )
      return;
    setActionLoading(`del-${item.id}`);
    try {
      await deleteAdminPost(token, item.id);
      await fetchPages(page, statusFilter);
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Error al eliminar');
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
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Páginas</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{total} páginas</span>
          <Button size="sm" asChild>
            <Link href="/admin/paginas/nueva">
              <Plus className="mr-1 h-4 w-4" />
              Nueva página
            </Link>
          </Button>
        </div>
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
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Título</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Estado</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Autor</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Publicada</th>
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
            ) : pages.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  No hay páginas con los filtros seleccionados.
                </td>
              </tr>
            ) : (
              pages.map((item) => (
                <tr key={item.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/paginas/${item.id}/editar`}
                      className="line-clamp-1 font-medium hover:underline"
                    >
                      {item.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_VARIANTS[item.status] ?? 'outline'}>
                      {STATUS_LABELS[item.status] ?? item.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{item.author.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDate(item.publishedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="outline" size="sm" className="h-7 px-2 text-xs" asChild>
                        <Link href={`/admin/paginas/${item.id}/editar`}>Editar</Link>
                      </Button>
                      {item.status === 'DRAFT' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => handlePublish(item)}
                          disabled={!!actionLoading}
                        >
                          {actionLoading === `pub-${item.id}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            'Publicar'
                          )}
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => handleUnpublish(item)}
                          disabled={!!actionLoading}
                        >
                          {actionLoading === `unpub-${item.id}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            'Despublicar'
                          )}
                        </Button>
                      )}
                      {/* Eliminar: ADMIN-only, como en /admin/blog */}
                      {currentUserIsAdmin && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          onClick={() => handleDelete(item)}
                          disabled={!!actionLoading}
                        >
                          {actionLoading === `del-${item.id}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            'Eliminar'
                          )}
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
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
