'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AlertCircle, ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  getAdminNav,
  createNavItem,
  updateNavItem,
  deleteNavItem,
  reorderNavItems,
  type AdminNavItem,
  type NavItemType,
} from '@/lib/api/nav-admin';
import type { NavPageType } from '@/lib/api/nav';
import { getAdminPosts, type AdminPostSummary } from '@/lib/api/blog-admin';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// Los 9 tipos de página de (public). Espejo del enum NavPageType del backend
// (el frontend no tiene Prisma), igual que BannerPlacement en lib/api/banners.ts.
const PAGE_TYPES: { value: NavPageType; label: string }[] = [
  { value: 'HOME', label: 'Portada' },
  { value: 'BUSQUEDA', label: 'Búsqueda' },
  { value: 'CATEGORIA', label: 'Categoría' },
  { value: 'ANUNCIO', label: 'Ficha de anuncio' },
  { value: 'BLOG', label: 'Blog' },
  { value: 'PAGINA_CMS', label: 'Página informativa' },
  { value: 'VENDEDOR', label: 'Perfil de vendedor' },
  { value: 'CONTACTO', label: 'Contacto' },
  { value: 'PLANES', label: 'Planes' },
];

// El selector de destino tiene CUATRO opciones, no tres: la primera es el
// destino ausente, que en el footer no existe. '' se mapea a type=null.
type DestinationChoice = '' | NavItemType;

// ─── Form ───────────────────────────────────────────────────────────────────

interface NodeFormValues {
  label: string;
  /** '' = nodo raíz. */
  parentId: string;
  type: DestinationChoice;
  pageId: string;
  url: string;
  active: boolean;
  visibleOn: NavPageType[];
}

function emptyForm(parentId: string): NodeFormValues {
  return { label: '', parentId, type: '', pageId: '', url: '', active: true, visibleOn: [] };
}

function itemToForm(item: AdminNavItem): NodeFormValues {
  return {
    label: item.label,
    parentId: item.parentId ?? '',
    type: item.type ?? '',
    pageId: item.pageId ?? '',
    url: item.url ?? '',
    active: item.active,
    visibleOn: item.visibleOn,
  };
}

const inputCls =
  'w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50';
const labelCls = 'text-xs font-medium text-muted-foreground';

function NodeForm({
  values,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
  pages,
  pagesLoading,
  pagesError,
  parentOptions,
}: {
  values: NodeFormValues;
  onChange: (v: Partial<NodeFormValues>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  pages: AdminPostSummary[];
  pagesLoading: boolean;
  pagesError: string | null;
  /** Raíces a las que este nodo puede colgarse. Vacío = solo puede ser raíz. */
  parentOptions: { id: string; label: string }[];
}) {
  function toggleVisibleOn(value: NavPageType) {
    onChange({
      visibleOn: values.visibleOn.includes(value)
        ? values.visibleOn.filter((v) => v !== value)
        : [...values.visibleOn, value],
    });
  }

  return (
    <div className="rounded-md border bg-muted/20 p-3" data-testid="node-form">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Texto visible *</label>
          <input
            type="text"
            value={values.label}
            onChange={(e) => onChange({ label: e.target.value })}
            className={inputCls}
            disabled={saving}
            data-testid="node-label-input"
          />
        </div>

        {/* MOVER = cambiar de padre. No hay drag&drop ni endpoint aparte: es un
            PATCH con parentId, igual que "mover de columna" en el footer. El
            backend rechaza mover algo que quedaría a un tercer nivel o crearía
            un ciclo, y ese mensaje se pinta abajo tal cual. */}
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Cuelga de</label>
          <select
            value={values.parentId}
            onChange={(e) => onChange({ parentId: e.target.value })}
            className={inputCls}
            disabled={saving}
            data-testid="node-parent-select"
          >
            <option value="">— Menú principal (raíz) —</option>
            {parentOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className={labelCls}>Destino</label>
          <select
            value={values.type}
            onChange={(e) =>
              // Al cambiar el tipo se limpian los campos del anterior — mismo
              // criterio que el editor del footer: el destino se manda entero.
              onChange({ type: e.target.value as DestinationChoice, pageId: '', url: '' })
            }
            className={inputCls}
            disabled={saving}
            data-testid="node-type-select"
          >
            <option value="">Sin destino (solo desplegable)</option>
            <option value="PAGE">Página del CMS</option>
            <option value="INTERNAL">Ruta interna del sitio</option>
            <option value="EXTERNAL">URL externa</option>
          </select>
          {values.type === '' && (
            <p className="text-xs text-muted-foreground">
              Un menú sin destino no navega: solo abre sus submenús. Necesita al menos un
              submenú visible o no se mostrará en el sitio.
            </p>
          )}
        </div>

        {values.type === 'PAGE' && (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className={labelCls}>Página *</label>
            {pagesLoading ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Cargando páginas…
              </div>
            ) : pagesError ? (
              // Un fallo de carga tiene que VERSE: el mismo `.catch` mudo dejó
              // el selector del footer vacío y sin explicación durante meses.
              <p className="text-xs text-destructive" role="alert" data-testid="node-page-select-error">
                {pagesError}
              </p>
            ) : (
              <select
                value={values.pageId}
                onChange={(e) => {
                  const page = pages.find((p) => p.id === e.target.value);
                  onChange({
                    pageId: e.target.value,
                    ...(page && !values.label ? { label: page.title } : {}),
                  });
                }}
                className={inputCls}
                disabled={saving}
                data-testid="node-page-select"
              >
                <option value="">— Selecciona una página —</option>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title} {p.status === 'DRAFT' ? '(borrador)' : ''}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {values.type === 'INTERNAL' && (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className={labelCls}>Ruta interna *</label>
            <input
              type="text"
              value={values.url}
              onChange={(e) => onChange({ url: e.target.value })}
              placeholder="/busqueda"
              className={inputCls}
              disabled={saving}
              data-testid="node-internal-url-input"
            />
            <p className="text-xs text-muted-foreground">
              Debe empezar por &quot;/&quot;. No se valida contra rutas reales del sitio.
            </p>
          </div>
        )}

        {values.type === 'EXTERNAL' && (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className={labelCls}>URL externa *</label>
            <input
              type="text"
              value={values.url}
              onChange={(e) => onChange({ url: e.target.value })}
              placeholder="https://..."
              className={inputCls}
              disabled={saving}
              data-testid="node-external-url-input"
            />
            <p className="text-xs text-muted-foreground">
              Se abrirá en una pestaña nueva (target=&quot;_blank&quot;).
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={values.active}
              onChange={(e) => onChange({ active: e.target.checked })}
              disabled={saving}
              className="h-4 w-4 rounded border-input"
              data-testid="node-active-checkbox"
            />
            <span className="text-sm">Activo</span>
          </label>
          <p className="text-xs text-muted-foreground">
            Desactivarlo oculta también sus submenús: no se promocionan a menú principal.
          </p>
        </div>

        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className={labelCls}>Se muestra en</label>
          <div className="flex flex-wrap gap-x-4 gap-y-1" data-testid="node-visible-on">
            {PAGE_TYPES.map((pt) => (
              <label key={pt.value} className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={values.visibleOn.includes(pt.value)}
                  onChange={() => toggleVisibleOn(pt.value)}
                  disabled={saving}
                  className="h-3.5 w-3.5 rounded border-input"
                />
                {pt.label}
              </label>
            ))}
          </div>
          {/* Vacío = TODAS, no "ninguna". Se dice con palabras porque una lista
              sin marcar se lee justo al revés. */}
          <p className="text-xs text-muted-foreground">
            {values.visibleOn.length === 0
              ? 'Sin marcar ninguna: se muestra en TODAS las páginas.'
              : `Solo en ${values.visibleOn.length} tipo(s) de página.`}
          </p>
        </div>
      </div>

      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive" role="alert" data-testid="node-form-error">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={onSave} disabled={saving || !values.label} data-testid="node-submit-btn">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Guardar'}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

// ─── Row ────────────────────────────────────────────────────────────────────

function destinationSummary(item: AdminNavItem): string {
  if (item.type === null) return 'Sin destino (solo desplegable)';
  if (item.type === 'PAGE') return item.page ? `Página: ${item.page.title}` : 'Página (no encontrada)';
  if (item.type === 'INTERNAL') return `Ruta: ${item.url}`;
  return `Externa: ${item.url}`;
}

function NodeRow({
  item,
  isFirst,
  isLast,
  childCount,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
  isDeleting,
  deleteError,
  indent,
}: {
  item: AdminNavItem;
  isFirst: boolean;
  isLast: boolean;
  childCount: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  deleteError: string | null;
  indent: boolean;
}) {
  // Un nodo sin destino y sin hijos es válido al escribir pero el gate lo poda
  // al leer, así que el admin tiene que VER que no se está mostrando.
  const invalido = item.type === null && childCount === 0;

  return (
    <div data-testid="nav-node" data-label={item.label}>
      <div
        className={`flex items-center gap-2 rounded-md px-2 py-1.5 -mx-2 hover:bg-muted/20 ${
          item.active ? '' : 'opacity-50'
        }`}
      >
        <div className="flex flex-col">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Subir"
            aria-label={`Subir ${item.label}`}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Bajar"
            aria-label={`Bajar ${item.label}`}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>

        <div className="min-w-0 flex-1">
          <span className={`text-sm font-medium ${indent ? 'text-muted-foreground' : ''}`}>{item.label}</span>
          <span className="ml-2 text-xs text-muted-foreground">{destinationSummary(item)}</span>

          {!item.active && (
            <Badge variant="outline" className="ml-2 text-[10px]">
              inactivo
            </Badge>
          )}
          {item.type === 'PAGE' && item.page?.status === 'DRAFT' && (
            <Badge variant="outline" className="ml-2 border-amber-300 text-[10px] text-amber-600">
              en borrador — no se muestra
            </Badge>
          )}
          {invalido && (
            <Badge
              variant="outline"
              className="ml-2 border-amber-300 text-[10px] text-amber-600"
              data-testid="badge-sin-destino"
            >
              sin destino y sin submenús — no se muestra
            </Badge>
          )}
          {item.visibleOn.length > 0 && (
            <span className="ml-2 text-[10px] text-muted-foreground">
              solo en: {item.visibleOn.join(', ')}
            </span>
          )}
        </div>

        <div className="flex shrink-0 gap-1">
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onEdit}>
            Editar
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={isDeleting}
            aria-label={`Eliminar ${item.label}`}
          >
            {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </Button>
        </div>
      </div>
      {deleteError && (
        <div className="mb-1 flex items-center gap-1.5 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {deleteError}
        </div>
      )}
    </div>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function AdminNavPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [roots, setRoots] = useState<AdminNavItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const [pages, setPages] = useState<AdminPostSummary[]>([]);
  const [pagesLoading, setPagesLoading] = useState(true);
  const [pagesError, setPagesError] = useState<string | null>(null);

  // Form: creando bajo un padre ('' = raíz) o editando un nodo concreto.
  const [creatingUnder, setCreatingUnder] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<NodeFormValues>(emptyForm(''));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});

  const fetchTree = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminNav(token);
      setRoots(data.sort((a, b) => a.order - b.order));
    } catch (err) {
      setError(
        err instanceof ApiError ? `Error ${err.statusCode}: ${err.message}` : 'Error al cargar el nav',
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchTree();
  }, [fetchTree]);

  useEffect(() => {
    if (!token) return;
    setPagesError(null);
    getAdminPosts(token, { type: 'PAGE', perPage: 50 })
      .then((res) => setPages(res.items))
      .catch((err) => {
        console.error('[admin/nav] no se pudieron cargar las páginas del CMS', err);
        setPagesError(
          `No se pudieron cargar las páginas: ${
            err instanceof Error ? err.message : String(err)
          }. Recarga la página; si persiste, revisa la API.`,
        );
      })
      .finally(() => setPagesLoading(false));
  }, [token]);

  const childrenOf = (root: AdminNavItem) =>
    (root.children ?? []).slice().sort((a, b) => a.order - b.order);

  // ── Form open/close ───────────────────────────────────────────────────────

  function openCreate(parentId: string) {
    setCreatingUnder(parentId);
    setEditingId(null);
    setForm(emptyForm(parentId));
    setFormError(null);
  }

  function openEdit(item: AdminNavItem) {
    setEditingId(item.id);
    setCreatingUnder(null);
    setForm(itemToForm(item));
    setFormError(null);
  }

  function closeForm() {
    setCreatingUnder(null);
    setEditingId(null);
    setFormError(null);
  }

  /**
   * Padres a los que un nodo puede colgarse: solo RAÍCES, porque el árbol admite
   * 2 niveles. Se excluye el propio nodo (colgarse de sí mismo) y, si el nodo
   * tiene hijos, se excluyen todas las raíces: moverlo dejaría a sus hijos en un
   * tercer nivel. El backend valida esto igualmente (assertMaxDepth/assertNoCycle);
   * aquí se evita ofrecer lo que se va a rechazar.
   */
  function parentOptionsFor(itemId: string | null): { id: string; label: string }[] {
    if (itemId) {
      const self = roots.find((r) => r.id === itemId);
      if (self && childrenOf(self).length > 0) return [];
    }
    return roots.filter((r) => r.id !== itemId).map((r) => ({ id: r.id, label: r.label }));
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  function nextOrderFor(parentId: string): number {
    const siblings = parentId ? childrenOf(roots.find((r) => r.id === parentId) ?? ({} as AdminNavItem)) : roots;
    return siblings.length === 0 ? 0 : Math.max(...siblings.map((s) => s.order)) + 1;
  }

  async function handleSave() {
    if (!token || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      // El destino viaja SIEMPRE entero (type + su campo), nunca a medias: es lo
      // que el backend exige para no dejar un campo del tipo anterior colgando.
      const destino =
        form.type === ''
          ? { type: null }
          : form.type === 'PAGE'
            ? { type: 'PAGE' as const, pageId: form.pageId }
            : { type: form.type, url: form.url };

      if (editingId) {
        await updateNavItem(token, editingId, {
          label: form.label,
          parentId: form.parentId || null,
          active: form.active,
          visibleOn: form.visibleOn,
          ...destino,
        });
      } else {
        await createNavItem(token, {
          label: form.label,
          ...(form.parentId ? { parentId: form.parentId } : {}),
          order: nextOrderFor(form.parentId),
          active: form.active,
          visibleOn: form.visibleOn,
          ...destino,
        });
      }
      closeForm();
      await fetchTree();
    } catch (err) {
      // El rechazo del backend (profundidad, ciclo, destino incoherente) llega
      // aquí con su mensaje legible y se pinta tal cual — nunca un error crudo.
      setFormError(err instanceof ApiError ? err.message : 'Error al guardar el menú');
    } finally {
      setSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(item: AdminNavItem) {
    if (!token) return;
    const n = childrenOf(item).length;
    const msg =
      n > 0
        ? `¿Eliminar "${item.label}"? Se eliminarán también sus ${n} submenú(s).`
        : `¿Eliminar "${item.label}"?`;
    if (!window.confirm(msg)) return;

    setDeletingId(item.id);
    setDeleteErrors((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    try {
      await deleteNavItem(token, item.id);
      await fetchTree();
    } catch (err) {
      setDeleteErrors((prev) => ({
        ...prev,
        [item.id]: err instanceof ApiError ? err.message : 'Error al eliminar',
      }));
    } finally {
      setDeletingId(null);
    }
  }

  // ── Reorder (swap con el hermano vecino, molde footer/categorias) ─────────

  async function move(siblings: AdminNavItem[], id: string, dir: 'up' | 'down') {
    const sorted = [...siblings].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((s) => s.id === id);
    const neighbor = dir === 'up' ? idx - 1 : idx + 1;
    if (neighbor < 0 || neighbor >= sorted.length) return;

    const aOrder = sorted[idx].order;
    const bOrder = sorted[neighbor].order;

    // Optimista: se pinta el swap antes de que responda el backend; si falla, un
    // refetch revierte. Una sola función para los dos niveles — en el footer y
    // en categorías este mismo algoritmo está escrito dos veces.
    setRoots((prev) =>
      prev
        .map((root) => {
          const swap = (n: AdminNavItem) =>
            n.id === sorted[idx].id
              ? { ...n, order: bOrder }
              : n.id === sorted[neighbor].id
                ? { ...n, order: aOrder }
                : n;
          return { ...swap(root), children: (root.children ?? []).map(swap) };
        })
        .sort((a, b) => a.order - b.order),
    );

    if (reordering || !token) return;
    setReordering(true);
    try {
      await reorderNavItems(token, [
        { id: sorted[idx].id, order: bOrder },
        { id: sorted[neighbor].id, order: aOrder },
      ]);
    } catch {
      await fetchTree();
    } finally {
      setReordering(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (!token) {
    return (
      <div className="rounded border border-yellow-300 bg-yellow-50 p-4 text-yellow-800">
        Sesión no disponible. Recarga la página o inicia sesión de nuevo.
      </div>
    );
  }

  const formNode = (
    <NodeForm
      values={form}
      onChange={(v) => setForm((prev) => ({ ...prev, ...v }))}
      onSave={handleSave}
      onCancel={closeForm}
      saving={saving}
      error={formError}
      pages={pages}
      pagesLoading={pagesLoading}
      pagesError={pagesError}
      parentOptions={parentOptionsFor(editingId)}
    />
  );

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Navegación</h1>
          <p className="text-sm text-muted-foreground">
            Menús y submenús de la barra bajo la cabecera del sitio público. Si no hay ningún
            menú visible, la barra no se muestra.
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => (creatingUnder === '' ? closeForm() : openCreate(''))}
          data-testid="new-root-btn"
        >
          <Plus className="mr-1 h-4 w-4" />
          Nuevo menú
        </Button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {creatingUnder === '' && <div className="mb-4">{formNode}</div>}

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando navegación...
        </div>
      )}

      {!loading && roots.length === 0 && !error && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No hay menús todavía. Crea el primero con el botón de arriba.
        </p>
      )}

      <div className="space-y-3">
        {roots.map((root, rootIdx) => {
          const children = childrenOf(root);
          return (
            <div key={root.id} className="rounded-md border bg-background p-3">
              {editingId === root.id ? (
                formNode
              ) : (
                <NodeRow
                  item={root}
                  isFirst={rootIdx === 0}
                  isLast={rootIdx === roots.length - 1}
                  childCount={children.length}
                  onMoveUp={() => move(roots, root.id, 'up')}
                  onMoveDown={() => move(roots, root.id, 'down')}
                  onEdit={() => openEdit(root)}
                  onDelete={() => handleDelete(root)}
                  isDeleting={deletingId === root.id}
                  deleteError={deleteErrors[root.id] ?? null}
                  indent={false}
                />
              )}

              <div className="ml-6 space-y-0.5 border-l pl-4">
                {children.map((child, childIdx) =>
                  editingId === child.id ? (
                    <div key={child.id} className="py-1">
                      {formNode}
                    </div>
                  ) : (
                    <NodeRow
                      key={child.id}
                      item={child}
                      isFirst={childIdx === 0}
                      isLast={childIdx === children.length - 1}
                      childCount={0}
                      onMoveUp={() => move(children, child.id, 'up')}
                      onMoveDown={() => move(children, child.id, 'down')}
                      onEdit={() => openEdit(child)}
                      onDelete={() => handleDelete(child)}
                      isDeleting={deletingId === child.id}
                      deleteError={deleteErrors[child.id] ?? null}
                      indent
                    />
                  ),
                )}

                {creatingUnder === root.id && <div className="pt-1">{formNode}</div>}

                <button
                  onClick={() => (creatingUnder === root.id ? closeForm() : openCreate(root.id))}
                  className="mt-1 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  data-testid={`new-child-btn-${root.label}`}
                >
                  <Plus className="h-3 w-3" />
                  Nuevo submenú
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
