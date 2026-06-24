'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AlertCircle, ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  getAdminCategories,
  createAdminCategory,
  updateAdminCategory,
  reorderAdminCategories,
  deleteAdminCategory,
  type AdminCategory,
  type AdminCategoryChild,
} from '@/lib/api/admin';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

// ─── Form values ──────────────────────────────────────────────────────────────

interface CategoryFormValues {
  name: string;
  slug: string;
  iconUrl: string;
  order: string;
  schemaRaw: string;
}

const EMPTY_FORM: CategoryFormValues = {
  name: '',
  slug: '',
  iconUrl: '',
  order: '0',
  schemaRaw: '[]',
};

function toForm(cat: AdminCategoryChild): CategoryFormValues {
  return {
    name: cat.name,
    slug: cat.slug,
    iconUrl: cat.iconUrl ?? '',
    order: String(cat.order),
    schemaRaw: JSON.stringify(cat.attributeSchema ?? [], null, 2),
  };
}

function parseSchema(raw: string): { value: unknown[]; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '[]') return { value: [], error: null };
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return { value: [], error: 'El schema debe ser un array JSON.' };
    return { value: parsed, error: null };
  } catch {
    return { value: [], error: 'JSON inválido. Revisa la sintaxis.' };
  }
}

// ─── Inline category form ─────────────────────────────────────────────────────

function CategoryForm({
  title,
  values,
  onChange,
  onSave,
  onCancel,
  saving,
  error,
}: {
  title: string;
  values: CategoryFormValues;
  onChange: (v: Partial<CategoryFormValues>) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <div className="rounded-md border bg-muted/20 p-4">
      <p className="mb-3 text-sm font-medium">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Nombre *</label>
          <input
            type="text"
            value={values.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={saving}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Slug *</label>
          <input
            type="text"
            value={values.slug}
            onChange={(e) => onChange({ slug: e.target.value })}
            className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={saving}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Icon URL</label>
          <input
            type="text"
            value={values.iconUrl}
            onChange={(e) => onChange({ iconUrl: e.target.value })}
            placeholder="https://..."
            className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={saving}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Orden</label>
          <input
            type="number"
            value={values.order}
            onChange={(e) => onChange({ order: e.target.value })}
            min={0}
            className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={saving}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">
          Attribute Schema{' '}
          <span className="font-normal">(JSON array, opcional)</span>
        </label>
        <textarea
          value={values.schemaRaw}
          onChange={(e) => onChange({ schemaRaw: e.target.value })}
          rows={5}
          spellCheck={false}
          className="resize-y rounded-md border bg-background px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          disabled={saving}
        />
      </div>
      {error && (
        <div className="mt-2 flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={onSave} disabled={saving || !values.name || !values.slug}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Guardar'}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

// ─── Category row ─────────────────────────────────────────────────────────────

function CategoryRow({
  cat,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onEdit,
  onDelete,
  isEditing,
  isDeleting,
  deleteError,
  editForm,
  onEditChange,
  onEditSave,
  onEditCancel,
  editSaving,
  editError,
  indent,
}: {
  cat: AdminCategoryChild;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isEditing: boolean;
  isDeleting: boolean;
  deleteError: string | null;
  editForm: CategoryFormValues;
  onEditChange: (v: Partial<CategoryFormValues>) => void;
  onEditSave: () => void;
  onEditCancel: () => void;
  editSaving: boolean;
  editError: string | null;
  indent: boolean;
}) {
  return (
    <div className={indent ? 'ml-6 border-l pl-4' : ''}>
      <div className="flex items-center gap-2 rounded-md py-2 hover:bg-muted/20 px-2 -mx-2">
        {/* Reorder */}
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

        {/* Info */}
        <div className="flex-1 min-w-0">
          <span className="font-medium text-sm">{cat.name}</span>
          <span className="ml-2 text-xs text-muted-foreground">{cat.slug}</span>
          {(cat.attributeSchema?.length ?? 0) > 0 && (
            <Badge variant="outline" className="ml-2 text-[10px]">
              {cat.attributeSchema.length} atribs
            </Badge>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 gap-1">
          <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={onEdit}>
            {isEditing ? 'Cerrar' : 'Editar'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            onClick={onDelete}
            disabled={isDeleting}
          >
            {isDeleting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      {/* Delete error */}
      {deleteError && (
        <div className="mb-1 flex items-center gap-1.5 rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {deleteError}
        </div>
      )}

      {/* Edit form */}
      {isEditing && (
        <div className="mb-2">
          <CategoryForm
            title={`Editando: ${cat.name}`}
            values={editForm}
            onChange={onEditChange}
            onSave={onEditSave}
            onCancel={onEditCancel}
            saving={editSaving}
            error={editError}
          />
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminCategoriasPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<CategoryFormValues>(EMPTY_FORM);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Create state: undefined = hidden, null = root, string = parentId
  const [createParentId, setCreateParentId] = useState<string | null | undefined>(undefined);
  const [createForm, setCreateForm] = useState<CategoryFormValues>(EMPTY_FORM);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Delete state
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});

  // Reorder in-flight
  const [reordering, setReordering] = useState(false);

  const fetchCategories = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminCategories(token);
      setCategories(data.sort((a, b) => a.order - b.order));
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `Error ${err.statusCode}: ${err.message}`
          : 'Error al cargar categorías',
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  // ── Edit ──────────────────────────────────────────────────────────────────

  function startEdit(cat: AdminCategoryChild) {
    if (editingId === cat.id) {
      setEditingId(null);
      return;
    }
    setEditingId(cat.id);
    setEditForm(toForm(cat));
    setEditError(null);
    setCreateParentId(undefined);
  }

  async function handleEditSave() {
    if (!token || !editingId || editSaving) return;
    const { value: schema, error: schemaErr } = parseSchema(editForm.schemaRaw);
    if (schemaErr) { setEditError(schemaErr); return; }

    setEditSaving(true);
    setEditError(null);
    try {
      await updateAdminCategory(token, editingId, {
        name: editForm.name,
        slug: editForm.slug,
        iconUrl: editForm.iconUrl || undefined,
        order: parseInt(editForm.order) || 0,
        attributeSchema: schema,
      });
      setEditingId(null);
      await fetchCategories();
    } catch (err) {
      setEditError(
        err instanceof ApiError ? err.message : 'Error al guardar',
      );
    } finally {
      setEditSaving(false);
    }
  }

  // ── Create ────────────────────────────────────────────────────────────────

  function openCreate(parentId: string | null) {
    setCreateParentId(parentId);
    setCreateForm(EMPTY_FORM);
    setCreateError(null);
    setEditingId(null);
  }

  async function handleCreateSave() {
    if (!token || createSaving || createParentId === undefined) return;
    const { value: schema, error: schemaErr } = parseSchema(createForm.schemaRaw);
    if (schemaErr) { setCreateError(schemaErr); return; }

    setCreateSaving(true);
    setCreateError(null);
    try {
      await createAdminCategory(token, {
        name: createForm.name,
        slug: createForm.slug,
        parentId: createParentId ?? undefined,
        iconUrl: createForm.iconUrl || undefined,
        order: parseInt(createForm.order) || 0,
        attributeSchema: schema,
      });
      setCreateParentId(undefined);
      await fetchCategories();
    } catch (err) {
      setCreateError(
        err instanceof ApiError ? err.message : 'Error al crear',
      );
    } finally {
      setCreateSaving(false);
    }
  }

  // ── Delete ────────────────────────────────────────────────────────────────

  async function handleDelete(id: string, name: string) {
    if (!token || !window.confirm(`¿Eliminar la categoría "${name}"?`)) return;
    setDeletingId(id);
    setDeleteErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });
    try {
      await deleteAdminCategory(token, id);
      await fetchCategories();
    } catch (err) {
      const msg =
        err instanceof ApiError ? err.message : 'Error al eliminar la categoría';
      setDeleteErrors((prev) => ({ ...prev, [id]: msg }));
    } finally {
      setDeletingId(null);
    }
  }

  // ── Reorder ───────────────────────────────────────────────────────────────

  async function moveRoot(catId: string, dir: 'up' | 'down') {
    const sorted = [...categories].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((c) => c.id === catId);
    const neighborIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (neighborIdx < 0 || neighborIdx >= sorted.length) return;

    const aOrder = sorted[idx].order;
    const bOrder = sorted[neighborIdx].order;
    const swapped = sorted.map((c) => {
      if (c.id === sorted[idx].id) return { ...c, order: bOrder };
      if (c.id === sorted[neighborIdx].id) return { ...c, order: aOrder };
      return c;
    });
    setCategories(swapped.sort((a, b) => a.order - b.order));

    if (reordering) return;
    setReordering(true);
    try {
      await reorderAdminCategories(token!, [
        { id: sorted[idx].id, order: bOrder },
        { id: sorted[neighborIdx].id, order: aOrder },
      ]);
    } catch {
      await fetchCategories();
    } finally {
      setReordering(false);
    }
  }

  async function moveChild(parentId: string, childId: string, dir: 'up' | 'down') {
    const parent = categories.find((c) => c.id === parentId);
    if (!parent) return;
    const sorted = [...parent.children].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((c) => c.id === childId);
    const neighborIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (neighborIdx < 0 || neighborIdx >= sorted.length) return;

    const aOrder = sorted[idx].order;
    const bOrder = sorted[neighborIdx].order;
    const updatedChildren = sorted.map((c) => {
      if (c.id === sorted[idx].id) return { ...c, order: bOrder };
      if (c.id === sorted[neighborIdx].id) return { ...c, order: aOrder };
      return c;
    });
    setCategories((prev) =>
      prev.map((c) =>
        c.id === parentId
          ? { ...c, children: updatedChildren.sort((a, b) => a.order - b.order) }
          : c,
      ),
    );

    if (reordering) return;
    setReordering(true);
    try {
      await reorderAdminCategories(token!, [
        { id: sorted[idx].id, order: bOrder },
        { id: sorted[neighborIdx].id, order: aOrder },
      ]);
    } catch {
      await fetchCategories();
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

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Categorías</h1>
        <Button
          size="sm"
          onClick={() =>
            createParentId === null ? setCreateParentId(undefined) : openCreate(null)
          }
        >
          <Plus className="mr-1 h-4 w-4" />
          Nueva categoría raíz
        </Button>
      </div>

      {/* Global error */}
      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Root create form */}
      {createParentId === null && (
        <div className="mb-4">
          <CategoryForm
            title="Nueva categoría raíz"
            values={createForm}
            onChange={(v) => setCreateForm((prev) => ({ ...prev, ...v }))}
            onSave={handleCreateSave}
            onCancel={() => setCreateParentId(undefined)}
            saving={createSaving}
            error={createError}
          />
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando categorías...
        </div>
      )}

      {!loading && categories.length === 0 && !error && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No hay categorías. Crea la primera con el botón de arriba.
        </p>
      )}

      {/* Category tree */}
      <div className="space-y-3">
        {categories.map((cat, catIdx) => (
          <div key={cat.id} className="rounded-md border bg-background p-3">
            {/* Parent row */}
            <CategoryRow
              cat={cat}
              isFirst={catIdx === 0}
              isLast={catIdx === categories.length - 1}
              onMoveUp={() => moveRoot(cat.id, 'up')}
              onMoveDown={() => moveRoot(cat.id, 'down')}
              onEdit={() => startEdit(cat)}
              onDelete={() => handleDelete(cat.id, cat.name)}
              isEditing={editingId === cat.id}
              isDeleting={deletingId === cat.id}
              deleteError={deleteErrors[cat.id] ?? null}
              editForm={editForm}
              onEditChange={(v) => setEditForm((prev) => ({ ...prev, ...v }))}
              onEditSave={handleEditSave}
              onEditCancel={() => setEditingId(null)}
              editSaving={editSaving}
              editError={editError}
              indent={false}
            />

            {/* Children */}
            {cat.children.length > 0 && (
              <div className="mt-2 space-y-1">
                {cat.children
                  .slice()
                  .sort((a, b) => a.order - b.order)
                  .map((child, childIdx) => (
                    <CategoryRow
                      key={child.id}
                      cat={child}
                      isFirst={childIdx === 0}
                      isLast={childIdx === cat.children.length - 1}
                      onMoveUp={() => moveChild(cat.id, child.id, 'up')}
                      onMoveDown={() => moveChild(cat.id, child.id, 'down')}
                      onEdit={() => startEdit(child)}
                      onDelete={() => handleDelete(child.id, child.name)}
                      isEditing={editingId === child.id}
                      isDeleting={deletingId === child.id}
                      deleteError={deleteErrors[child.id] ?? null}
                      editForm={editForm}
                      onEditChange={(v) => setEditForm((prev) => ({ ...prev, ...v }))}
                      onEditSave={handleEditSave}
                      onEditCancel={() => setEditingId(null)}
                      editSaving={editSaving}
                      editError={editError}
                      indent
                    />
                  ))}
              </div>
            )}

            {/* Subcategory create form */}
            {createParentId === cat.id && (
              <div className="mt-2 ml-6 pl-4 border-l">
                <CategoryForm
                  title={`Nueva subcategoría de "${cat.name}"`}
                  values={createForm}
                  onChange={(v) => setCreateForm((prev) => ({ ...prev, ...v }))}
                  onSave={handleCreateSave}
                  onCancel={() => setCreateParentId(undefined)}
                  saving={createSaving}
                  error={createError}
                />
              </div>
            )}

            {/* Add subcategory button */}
            <div className="mt-2 ml-6">
              <button
                onClick={() =>
                  createParentId === cat.id ? setCreateParentId(undefined) : openCreate(cat.id)
                }
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <Plus className="h-3 w-3" />
                Nueva subcategoría
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
