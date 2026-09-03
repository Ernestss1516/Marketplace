'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AlertCircle, ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  getAdminFooter,
  createFooterColumn,
  updateFooterColumn,
  deleteFooterColumn,
  reorderFooterColumns,
  createFooterItem,
  updateFooterItem,
  deleteFooterItem,
  reorderFooterItems,
  type AdminFooterColumn,
  type AdminFooterItem,
  type FooterItemType,
} from '@/lib/api/footer-admin';
import { getAdminPosts, type AdminPostSummary } from '@/lib/api/blog-admin';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SesionNoDisponible } from '@/app/(admin)/components/SesionNoDisponible';

// ─── Item form (create/edit — destino discriminado por type) ────────────────

interface ItemFormValues {
  columnId: string;
  label: string;
  type: FooterItemType;
  pageId: string;
  url: string;
}

function emptyItemForm(columnId: string): ItemFormValues {
  return { columnId, label: '', type: 'PAGE', pageId: '', url: '' };
}

function itemToForm(item: AdminFooterItem): ItemFormValues {
  return {
    columnId: item.columnId,
    label: item.label,
    type: item.type,
    pageId: item.pageId ?? '',
    url: item.url ?? '',
  };
}

function ItemForm({
  values,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
  columns,
  pages,
  pagesLoading,
  pagesError,
}: {
  values: ItemFormValues;
  onChange: (v: Partial<ItemFormValues>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
  columns: AdminFooterColumn[];
  pages: AdminPostSummary[];
  pagesLoading: boolean;
  pagesError: string | null;
}) {
  const inputCls =
    'w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50';
  const labelCls = 'text-xs font-medium text-muted-foreground';

  return (
    <div className="rounded-md border bg-muted/20 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Texto visible *</label>
          <input
            type="text"
            value={values.label}
            onChange={(e) => onChange({ label: e.target.value })}
            className={inputCls}
            disabled={saving}
            data-testid="item-label-input"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={labelCls}>Columna</label>
          <select
            value={values.columnId}
            onChange={(e) => onChange({ columnId: e.target.value })}
            className={inputCls}
            disabled={saving}
            data-testid="item-column-select"
          >
            {columns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name ?? '(sin encabezado)'}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className={labelCls}>Destino</label>
          <select
            value={values.type}
            onChange={(e) =>
              onChange({ type: e.target.value as FooterItemType, pageId: '', url: '' })
            }
            className={inputCls}
            disabled={saving}
            data-testid="item-type-select"
          >
            <option value="PAGE">Página del CMS</option>
            <option value="INTERNAL">Ruta interna del sitio</option>
            <option value="EXTERNAL">URL externa</option>
          </select>
        </div>

        {values.type === 'PAGE' && (
          <div className="flex flex-col gap-1 sm:col-span-2">
            <label className={labelCls}>Página *</label>
            {pagesLoading ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Cargando páginas…
              </div>
            ) : pagesError ? (
              // Antes esto era un `.catch` mudo: si la carga fallaba, el admin veía
              // un desplegable vacío sin ninguna explicación y no podía enlazar
              // NINGUNA página. Así estuvo roto sin que nadie lo notara (el
              // backend devolvía 400 por pedir perPage por encima de su tope).
              // Un fallo de carga tiene que VERSE.
              <p
                className="text-xs text-destructive"
                role="alert"
                data-testid="item-page-select-error"
              >
                {pagesError}
              </p>
            ) : (
              <select
                value={values.pageId}
                onChange={(e) => {
                  const page = pages.find((p) => p.id === e.target.value);
                  onChange({
                    pageId: e.target.value,
                    // Prerrellena el label con el título de la página — solo si el
                    // admin todavía no ha escrito uno propio.
                    ...(page && !values.label ? { label: page.title } : {}),
                  });
                }}
                className={inputCls}
                disabled={saving}
                data-testid="item-page-select"
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
              data-testid="item-internal-url-input"
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
              data-testid="item-external-url-input"
            />
            <p className="text-xs text-muted-foreground">
              Se abrirá en una pestaña nueva (target=&quot;_blank&quot;).
            </p>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={onSave} disabled={saving || !values.label} data-testid="item-submit-btn">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Guardar'}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

// ─── Item row ─────────────────────────────────────────────────────────────

function destinationSummary(item: AdminFooterItem): string {
  if (item.type === 'PAGE') return item.page ? `Página: ${item.page.title}` : 'Página (no encontrada)';
  if (item.type === 'INTERNAL') return `Ruta: ${item.url}`;
  return `Externa: ${item.url}`;
}

function ItemRow({
  item,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
  isDeleting,
  deleteError,
}: {
  item: AdminFooterItem;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isDeleting: boolean;
  deleteError: string | null;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 rounded-md py-1.5 hover:bg-muted/20 px-2 -mx-2">
        <div className="flex flex-col">
          <button
            onClick={onMoveUp}
            disabled={isFirst}
            className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Subir"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            onClick={onMoveDown}
            disabled={isLast}
            className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Bajar"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 min-w-0">
          <span className="text-sm font-medium">{item.label}</span>
          <span className="ml-2 text-xs text-muted-foreground">{destinationSummary(item)}</span>
          {item.type === 'PAGE' && item.page?.status === 'DRAFT' && (
            <Badge variant="outline" className="ml-2 text-[10px] text-warning-foreground border-warning-border">
              en borrador — no se muestra
            </Badge>
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

// ─── Page ─────────────────────────────────────────────────────────────────

export default function AdminFooterPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [columns, setColumns] = useState<AdminFooterColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const [pages, setPages] = useState<AdminPostSummary[]>([]);
  const [pagesLoading, setPagesLoading] = useState(true);
  const [pagesError, setPagesError] = useState<string | null>(null);

  // Rename inline
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // New column
  const [showNewColumn, setShowNewColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState('');
  const [newColumnSaving, setNewColumnSaving] = useState(false);
  const [newColumnError, setNewColumnError] = useState<string | null>(null);

  // Column delete
  const [deletingColumnId, setDeletingColumnId] = useState<string | null>(null);
  const [columnDeleteErrors, setColumnDeleteErrors] = useState<Record<string, string>>({});

  // Item create/edit
  const [itemFormColumnId, setItemFormColumnId] = useState<string | null>(null); // "new item" open in this column
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [itemForm, setItemForm] = useState<ItemFormValues>(emptyItemForm(''));
  const [itemSaving, setItemSaving] = useState(false);
  const [itemError, setItemError] = useState<string | null>(null);

  // Item delete
  const [deletingItemId, setDeletingItemId] = useState<string | null>(null);
  const [itemDeleteErrors, setItemDeleteErrors] = useState<Record<string, string>>({});

  const fetchColumns = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminFooter(token);
      setColumns(data.sort((a, b) => a.order - b.order));
    } catch (err) {
      setError(
        err instanceof ApiError ? `Error ${err.statusCode}: ${err.message}` : 'Error al cargar el footer',
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchColumns();
  }, [fetchColumns]);

  useEffect(() => {
    if (!token) return;
    setPagesError(null);
    getAdminPosts(token, { type: 'PAGE', perPage: 200 })
      .then((res) => setPages(res.items))
      .catch((err) => {
        // NO se traga: antes había aquí un `.catch` vacío y por eso este bug vivió
        // invisible — el backend respondía 400 ("perPage must not be greater than
        // 50") y el selector salía vacío, sin que el admin pudiera enlazar ninguna
        // página ni enterarse de por qué.
        console.error('[admin/footer] no se pudieron cargar las páginas del CMS', err);
        setPagesError(
          `No se pudieron cargar las páginas: ${
            err instanceof Error ? err.message : String(err)
          }. Recarga la página; si persiste, revisa la API.`,
        );
      })
      .finally(() => setPagesLoading(false));
  }, [token]);

  // ── Rename ──────────────────────────────────────────────────────────────

  function startRename(col: AdminFooterColumn) {
    setRenamingId(col.id);
    setRenameValue(col.name ?? '');
    setRenameError(null);
  }

  async function saveRename(id: string) {
    if (!token || renameSaving) return;
    setRenameSaving(true);
    setRenameError(null);
    try {
      await updateFooterColumn(token, id, { name: renameValue });
      setRenamingId(null);
      await fetchColumns();
    } catch (err) {
      setRenameError(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setRenameSaving(false);
    }
  }

  // ── Create column ───────────────────────────────────────────────────────

  async function handleCreateColumn() {
    if (!token || newColumnSaving) return;
    setNewColumnSaving(true);
    setNewColumnError(null);
    try {
      const order = columns.length === 0 ? 0 : Math.max(...columns.map((c) => c.order)) + 1;
      await createFooterColumn(token, { name: newColumnName || undefined, order });
      setShowNewColumn(false);
      setNewColumnName('');
      await fetchColumns();
    } catch (err) {
      setNewColumnError(err instanceof ApiError ? err.message : 'Error al crear la columna');
    } finally {
      setNewColumnSaving(false);
    }
  }

  // ── Delete column ───────────────────────────────────────────────────────

  async function handleDeleteColumn(col: AdminFooterColumn) {
    if (!token) return;
    const itemCount = col.items.length;
    const msg =
      itemCount > 0
        ? `¿Eliminar la columna "${col.name ?? '(sin encabezado)'}"? Se eliminarán también sus ${itemCount} ítem(s).`
        : `¿Eliminar la columna "${col.name ?? '(sin encabezado)'}"?`;
    if (!window.confirm(msg)) return;

    setDeletingColumnId(col.id);
    setColumnDeleteErrors((prev) => { const n = { ...prev }; delete n[col.id]; return n; });
    try {
      await deleteFooterColumn(token, col.id);
      await fetchColumns();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Error al eliminar la columna';
      setColumnDeleteErrors((prev) => ({ ...prev, [col.id]: message }));
    } finally {
      setDeletingColumnId(null);
    }
  }

  // ── Reorder columns (molde admin/categorias moveRoot) ──────────────────

  async function moveColumn(id: string, dir: 'up' | 'down') {
    const sorted = [...columns].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((c) => c.id === id);
    const neighborIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (neighborIdx < 0 || neighborIdx >= sorted.length) return;

    const aOrder = sorted[idx].order;
    const bOrder = sorted[neighborIdx].order;
    const swapped = sorted.map((c) => {
      if (c.id === sorted[idx].id) return { ...c, order: bOrder };
      if (c.id === sorted[neighborIdx].id) return { ...c, order: aOrder };
      return c;
    });
    setColumns(swapped.sort((a, b) => a.order - b.order));

    if (reordering || !token) return;
    setReordering(true);
    try {
      await reorderFooterColumns(token, [
        { id: sorted[idx].id, order: bOrder },
        { id: sorted[neighborIdx].id, order: aOrder },
      ]);
    } catch {
      await fetchColumns();
    } finally {
      setReordering(false);
    }
  }

  async function moveItem(columnId: string, itemId: string, dir: 'up' | 'down') {
    const column = columns.find((c) => c.id === columnId);
    if (!column) return;
    const sorted = [...column.items].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((i) => i.id === itemId);
    const neighborIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (neighborIdx < 0 || neighborIdx >= sorted.length) return;

    const aOrder = sorted[idx].order;
    const bOrder = sorted[neighborIdx].order;
    const updatedItems = sorted.map((i) => {
      if (i.id === sorted[idx].id) return { ...i, order: bOrder };
      if (i.id === sorted[neighborIdx].id) return { ...i, order: aOrder };
      return i;
    });
    setColumns((prev) =>
      prev.map((c) => (c.id === columnId ? { ...c, items: updatedItems.sort((a, b) => a.order - b.order) } : c)),
    );

    if (reordering || !token) return;
    setReordering(true);
    try {
      await reorderFooterItems(token, [
        { id: sorted[idx].id, order: bOrder },
        { id: sorted[neighborIdx].id, order: aOrder },
      ]);
    } catch {
      await fetchColumns();
    } finally {
      setReordering(false);
    }
  }

  // ── Create/edit item ────────────────────────────────────────────────────

  function openNewItem(columnId: string) {
    setItemFormColumnId(columnId);
    setEditingItemId(null);
    setItemForm(emptyItemForm(columnId));
    setItemError(null);
  }

  function openEditItem(item: AdminFooterItem) {
    setEditingItemId(item.id);
    setItemFormColumnId(null);
    setItemForm(itemToForm(item));
    setItemError(null);
  }

  function closeItemForm() {
    setItemFormColumnId(null);
    setEditingItemId(null);
  }

  async function handleSaveItem() {
    if (!token || itemSaving) return;
    setItemSaving(true);
    setItemError(null);
    try {
      const destination =
        itemForm.type === 'PAGE'
          ? { type: 'PAGE' as const, pageId: itemForm.pageId }
          : { type: itemForm.type, url: itemForm.url };

      if (editingItemId) {
        await updateFooterItem(token, editingItemId, {
          columnId: itemForm.columnId,
          label: itemForm.label,
          ...destination,
        });
      } else {
        await createFooterItem(token, {
          columnId: itemForm.columnId,
          label: itemForm.label,
          ...destination,
        });
      }
      closeItemForm();
      await fetchColumns();
    } catch (err) {
      setItemError(err instanceof ApiError ? err.message : 'Error al guardar el ítem');
    } finally {
      setItemSaving(false);
    }
  }

  async function handleDeleteItem(item: AdminFooterItem) {
    if (!token || !window.confirm(`¿Eliminar "${item.label}" del footer?`)) return;
    setDeletingItemId(item.id);
    setItemDeleteErrors((prev) => { const n = { ...prev }; delete n[item.id]; return n; });
    try {
      await deleteFooterItem(token, item.id);
      await fetchColumns();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Error al eliminar el ítem';
      setItemDeleteErrors((prev) => ({ ...prev, [item.id]: message }));
    } finally {
      setDeletingItemId(null);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (!token) {
    return (
      <SesionNoDisponible />
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Footer</h1>
          <p className="text-sm text-muted-foreground">
            Columnas y enlaces que se muestran en el pie de página del sitio público.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowNewColumn((v) => !v)}>
          <Plus className="mr-1 h-4 w-4" />
          Nueva columna
        </Button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {showNewColumn && (
        <div className="mb-4 rounded-md border bg-muted/20 p-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">
              Nombre de la columna (vacío = sin encabezado)
            </label>
            <input
              type="text"
              value={newColumnName}
              onChange={(e) => setNewColumnName(e.target.value)}
              className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={newColumnSaving}
              placeholder="p.ej. Legal"
            />
          </div>
          {newColumnError && (
            <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {newColumnError}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={handleCreateColumn} disabled={newColumnSaving}>
              {newColumnSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Crear'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowNewColumn(false)} disabled={newColumnSaving}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando footer...
        </div>
      )}

      {!loading && columns.length === 0 && !error && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No hay columnas todavía. Crea la primera con el botón de arriba.
        </p>
      )}

      <div className="space-y-3">
        {columns.map((col, idx) => (
          <div key={col.id} className="rounded-md border bg-background p-3">
            {/* Column header */}
            <div className="flex items-center gap-2 pb-2">
              <div className="flex flex-col">
                <button
                  onClick={() => moveColumn(col.id, 'up')}
                  disabled={idx === 0}
                  className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  title="Subir"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  onClick={() => moveColumn(col.id, 'down')}
                  disabled={idx === columns.length - 1}
                  className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  title="Bajar"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>

              {renamingId === col.id ? (
                <div className="flex flex-1 items-center gap-2">
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="flex-1 rounded-md border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    disabled={renameSaving}
                    placeholder="(sin encabezado)"
                    autoFocus
                  />
                  <Button size="sm" className="h-7 px-2 text-xs" onClick={() => saveRename(col.id)} disabled={renameSaving}>
                    {renameSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Guardar'}
                  </Button>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setRenamingId(null)} disabled={renameSaving}>
                    Cancelar
                  </Button>
                </div>
              ) : (
                <div className="flex flex-1 items-center gap-2">
                  <span className="font-medium text-sm">
                    {col.name ?? <span className="italic text-muted-foreground">(sin encabezado)</span>}
                  </span>
                  <Button variant="outline" size="sm" className="h-6 px-2 text-xs" onClick={() => startRename(col)}>
                    Renombrar
                  </Button>
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                onClick={() => handleDeleteColumn(col)}
                disabled={deletingColumnId === col.id}
              >
                {deletingColumnId === col.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              </Button>
            </div>

            {renameError && renamingId === col.id && (
              <div className="mb-2 flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {renameError}
              </div>
            )}
            {columnDeleteErrors[col.id] && (
              <div className="mb-2 flex items-center gap-1.5 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
                <AlertCircle className="h-3 w-3 shrink-0" />
                {columnDeleteErrors[col.id]}
              </div>
            )}

            {/* Items */}
            <div className="ml-6 space-y-0.5 border-l pl-4">
              {col.items
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((item, itemIdx) =>
                  editingItemId === item.id ? (
                    <ItemForm
                      key={item.id}
                      values={itemForm}
                      onChange={(v) => setItemForm((prev) => ({ ...prev, ...v }))}
                      onSave={handleSaveItem}
                      onCancel={closeItemForm}
                      saving={itemSaving}
                      error={itemError}
                      columns={columns}
                      pages={pages}
                      pagesLoading={pagesLoading}
                      pagesError={pagesError}
                    />
                  ) : (
                    <ItemRow
                      key={item.id}
                      item={item}
                      isFirst={itemIdx === 0}
                      isLast={itemIdx === col.items.length - 1}
                      onMoveUp={() => moveItem(col.id, item.id, 'up')}
                      onMoveDown={() => moveItem(col.id, item.id, 'down')}
                      onEdit={() => openEditItem(item)}
                      onDelete={() => handleDeleteItem(item)}
                      isDeleting={deletingItemId === item.id}
                      deleteError={itemDeleteErrors[item.id] ?? null}
                    />
                  ),
                )}

              {itemFormColumnId === col.id && (
                <div className="pt-1">
                  <ItemForm
                    values={itemForm}
                    onChange={(v) => setItemForm((prev) => ({ ...prev, ...v }))}
                    onSave={handleSaveItem}
                    onCancel={closeItemForm}
                    saving={itemSaving}
                    error={itemError}
                    columns={columns}
                    pages={pages}
                    pagesLoading={pagesLoading}
                      pagesError={pagesError}
                  />
                </div>
              )}

              <button
                onClick={() => (itemFormColumnId === col.id ? closeItemForm() : openNewItem(col.id))}
                className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="h-3 w-3" />
                Nuevo ítem
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
