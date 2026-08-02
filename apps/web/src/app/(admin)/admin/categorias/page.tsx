'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AlertCircle, ChevronDown, ChevronUp, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  getAdminCategories,
  getSearchableKeys,
  createAdminCategory,
  updateAdminCategory,
  reorderAdminCategories,
  deleteAdminCategory,
  getCategoryAttributeUsage,
  type AdminCategory,
  type AdminCategoryChild,
} from '@/lib/api/admin';
import { getCategoryBySlug } from '@/lib/api/categorias';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AttributeSchemaEditor,
  parseAttributeSchema,
  serializeAttributeSchema,
  type AttributeSchemaWithExtras,
} from '@/components/admin/AttributeSchemaEditor';
import { TagsEditorPanel } from '@/components/admin/TagsEditorPanel';
import type { AttributeSchema, ListingTypePolicy, ListingViewMode, PriceUnit } from '@/types';

// ─── Form values (name/slug/iconUrl/allowedListingType/allowedViews/defaultView —
// schema is managed separately; order se ordena SOLO con las flechas ↑↓) ──

interface CategoryFormValues {
  name: string;
  slug: string;
  iconUrl: string;
  allowedListingType: ListingTypePolicy;
  /** RÁFAGA 2 — [] = "no configurado" (hereda del padre / default global: las 3, LISTA). */
  allowedViews: ListingViewMode[];
  /** '' = sin defaultView propio (coherente con allowedViews:[]). */
  defaultView: ListingViewMode | '';
  /** RP.2 — [] = "no configurado" (hereda del padre / default global: solo pago único). */
  allowedPriceUnits: PriceUnit[];
}

const EMPTY_FORM: CategoryFormValues = {
  name: '', slug: '', iconUrl: '', allowedListingType: 'BOTH',
  allowedViews: [], defaultView: '', allowedPriceUnits: [],
};

const POLICY_OPTIONS: { value: ListingTypePolicy; label: string }[] = [
  { value: 'BOTH', label: 'Ambos (producto y servicio)' },
  { value: 'PRODUCT_ONLY', label: 'Solo producto' },
  { value: 'SERVICE_ONLY', label: 'Solo servicio' },
];

const VIEW_OPTIONS: { value: ListingViewMode; label: string }[] = [
  { value: 'LISTA', label: 'Lista (cards estándar)' },
  { value: 'AMPLIADA', label: 'Ampliada (una columna)' },
  { value: 'MAPA', label: 'Mapa' },
];

const PRICE_UNIT_OPTIONS: { value: PriceUnit; label: string }[] = [
  { value: 'ONE_TIME', label: 'Pago único' },
  { value: 'PER_MONTH', label: 'Al mes' },
  { value: 'PER_WEEK', label: 'A la semana' },
  { value: 'PER_DAY', label: 'Al día' },
  { value: 'PER_HOUR', label: 'Por hora' },
  { value: 'PER_UNIT', label: 'Por unidad' },
  { value: 'PER_SESSION', label: 'Por sesión' },
];

function toForm(cat: AdminCategoryChild): CategoryFormValues {
  return {
    name: cat.name,
    slug: cat.slug,
    iconUrl: cat.iconUrl ?? '',
    allowedListingType: cat.allowedListingType,
    allowedViews: cat.allowedViews ?? [],
    defaultView: cat.defaultView ?? '',
    allowedPriceUnits: cat.allowedPriceUnits ?? [],
  };
}

// ─── Inline category form (name / slug / iconUrl / allowedListingType — el orden se
// cambia solo con las flechas ↑↓ de la lista, no desde aquí) ────────────────

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
          <label className="text-xs font-medium text-muted-foreground">Tipo de anuncio permitido</label>
          <select
            value={values.allowedListingType}
            onChange={(e) => onChange({ allowedListingType: e.target.value as ListingTypePolicy })}
            className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={saving}
            data-testid="allowed-listing-type-select"
          >
            {POLICY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">
            Vistas de resultados permitidas
            <span className="ml-1 font-normal text-muted-foreground/70">
              (vacío = hereda del padre, o las 3 con Lista por defecto)
            </span>
          </label>
          <div className="flex flex-wrap gap-4">
            {VIEW_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={values.allowedViews.includes(opt.value)}
                  onChange={(e) => {
                    const nextAllowed = e.target.checked
                      ? [...values.allowedViews, opt.value]
                      : values.allowedViews.filter((v) => v !== opt.value);
                    // Si se desmarca la vista que era la por defecto, se limpia también —
                    // mismo criterio que el backend (nunca dejar un defaultView huérfano).
                    const nextDefault = nextAllowed.includes(values.defaultView as ListingViewMode)
                      ? values.defaultView
                      : '';
                    onChange({ allowedViews: nextAllowed, defaultView: nextDefault });
                  }}
                  disabled={saving}
                  className="h-3.5 w-3.5 rounded"
                  data-testid={`allowed-view-${opt.value.toLowerCase()}`}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label className="text-xs font-medium text-muted-foreground">
            Formatos de precio permitidos
            <span className="ml-1 font-normal text-muted-foreground/70">
              (vacío = hereda del padre, o solo pago único)
            </span>
          </label>
          <div className="flex flex-wrap gap-4" data-testid="allowed-price-units-checkbox">
            {PRICE_UNIT_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={values.allowedPriceUnits.includes(opt.value)}
                  onChange={(e) => {
                    // Override total, no fusión: la lista propia sustituye entera a
                    // la del padre. Sin campo "por defecto" asociado que limpiar
                    // (a diferencia de allowedViews/defaultView) — el wizard
                    // preselecciona ONE_TIME o el primero de la lista.
                    onChange({
                      allowedPriceUnits: e.target.checked
                        ? [...values.allowedPriceUnits, opt.value]
                        : values.allowedPriceUnits.filter((u) => u !== opt.value),
                    });
                  }}
                  disabled={saving}
                  className="h-3.5 w-3.5 rounded"
                  data-testid={`allowed-price-unit-${opt.value.toLowerCase()}`}
                />
                {opt.label}
              </label>
            ))}
          </div>
        </div>
        {values.allowedViews.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-muted-foreground">Vista por defecto</label>
            <select
              value={values.defaultView}
              onChange={(e) => onChange({ defaultView: e.target.value as ListingViewMode })}
              className="rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={saving}
              data-testid="default-view-select"
            >
              <option value="">— Elegir —</option>
              {VIEW_OPTIONS.filter((opt) => values.allowedViews.includes(opt.value)).map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}
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
        <Button size="sm" variant="outline" onClick={onCancel} disabled={saving} data-testid="cancel-category-form">
          Cancelar
        </Button>
      </div>
    </div>
  );
}

// ─── Schema editor sub-panel (name/iconUrl form + attribute editor) ───────────

interface SchemaEditorPanelProps {
  catId: string;
  ownSchema: AttributeSchemaWithExtras[];
  inherited: AttributeSchema[];
  parentName?: string;
  searchableKeys: string[];
  loadingInherited: boolean;
  modified: boolean;
  saving: boolean;
  error: string | null;
  hasActiveEdit: boolean;
  onFieldsChange: (fields: AttributeSchemaWithExtras[]) => void;
  onSave: () => void;
  onHasActiveEdit: (v: boolean) => void;
  checkAttributeUsage?: (oldKey: string) => Promise<number>;
  /**
   * Solo cuando se edita una categoría RAÍZ que ya tiene hijas — su propio
   * schema (crudo, sin fusionar). AttributeSchemaEditor lo usa para mostrar,
   * mientras se edita/añade un atributo del PADRE, el impacto que tendría en
   * CADA hija (su schema efectivo resultante) — un contador, no solo el error
   * de validación que ya existía al guardar (assertCardAttributeChangeDoesNotBreakChildren).
   */
  childCategories?: { name: string; attributeSchema: AttributeSchema[] }[];
}

function SchemaEditorPanel({
  catId,
  ownSchema,
  inherited,
  parentName,
  searchableKeys,
  loadingInherited,
  modified,
  saving,
  error,
  hasActiveEdit,
  onFieldsChange,
  onSave,
  onHasActiveEdit,
  checkAttributeUsage,
  childCategories,
}: SchemaEditorPanelProps) {
  return (
    <div className="mt-4 rounded-md border bg-muted/10 p-4">
      <div className="mb-3 flex items-center gap-2">
        <p className="text-sm font-medium">Atributos</p>
        {modified && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-amber-600">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            Sin guardar
          </span>
        )}
      </div>

      {loadingInherited ? (
        <div className="flex items-center gap-1.5 py-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          Cargando schema heredado…
        </div>
      ) : (
        <AttributeSchemaEditor
          key={catId}
          ownSchema={ownSchema}
          inheritedFields={inherited}
          parentName={parentName}
          searchableKeys={searchableKeys}
          onChange={onFieldsChange}
          onHasActiveEdit={onHasActiveEdit}
          disabled={saving}
          checkAttributeUsage={checkAttributeUsage}
          childCategories={childCategories}
        />
      )}

      {error && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3">
        <Button
          size="sm"
          variant={modified ? 'default' : 'outline'}
          onClick={onSave}
          disabled={saving || !modified || hasActiveEdit}
          data-testid="save-schema-btn"
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Guardar atributos'}
        </Button>
        {hasActiveEdit && (
          <span className="text-xs text-muted-foreground">
            Confirma o cancela el campo en edición primero
          </span>
        )}
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
  schemaPanel,
  tagsPanel,
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
  schemaPanel: SchemaEditorPanelProps | null;
  /** B1 — panel de tags, hermano del de atributos. Null cuando no se está editando. */
  tagsPanel: { categoryId: string; categoryName: string; token: string } | null;
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
            {isDeleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
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

      {/* Edit panel */}
      {isEditing && (
        <div className="mb-2 space-y-0">
          <CategoryForm
            title={`Editando: ${cat.name}`}
            values={editForm}
            onChange={onEditChange}
            onSave={onEditSave}
            onCancel={onEditCancel}
            saving={editSaving}
            error={editError}
          />
          {schemaPanel && <SchemaEditorPanel {...schemaPanel} />}
          {tagsPanel && <TagsEditorPanel {...tagsPanel} />}
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

  // Searchable keys — loaded once on mount
  const [searchableKeys, setSearchableKeys] = useState<string[]>([]);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<CategoryFormValues>(EMPTY_FORM);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Schema editor state for edit mode
  const [editOwnSchema, setEditOwnSchema] = useState<AttributeSchemaWithExtras[]>([]);
  const [editInherited, setEditInherited] = useState<AttributeSchema[]>([]);
  const [editParentName, setEditParentName] = useState<string | undefined>();
  const [loadingInherited, setLoadingInherited] = useState(false);
  const [schemaModified, setSchemaModified] = useState(false);
  const [schemaSaving, setSchemaSaving] = useState(false);
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [schemaHasActiveEdit, setSchemaHasActiveEdit] = useState(false);

  // Create state: undefined = hidden, null = root, string = parentId
  const [createParentId, setCreateParentId] = useState<string | null | undefined>(undefined);
  const [createForm, setCreateForm] = useState<CategoryFormValues>(EMPTY_FORM);
  const [createSaving, setCreateSaving] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createOwnSchema, setCreateOwnSchema] = useState<AttributeSchemaWithExtras[]>([]);
  const [createInherited, setCreateInherited] = useState<AttributeSchema[]>([]);
  const [createParentName, setCreateParentName] = useState<string | undefined>();
  const [createSchemaHasActiveEdit, setCreateSchemaHasActiveEdit] = useState(false);

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

  // Load searchable keys once the token is available
  useEffect(() => {
    if (!token) return;
    getSearchableKeys(token)
      .then(({ keys }) => setSearchableKeys(keys))
      .catch(() => { /* silent — filterable checkboxes will all appear disabled */ });
  }, [token]);

  // ── Edit ────────────────────────────────────────────────────────────────────

  function startEdit(cat: AdminCategoryChild, parent?: { slug: string; name: string }) {
    if (editingId === cat.id) {
      setEditingId(null);
      return;
    }
    setEditingId(cat.id);
    setEditForm(toForm(cat));
    setEditError(null);
    setEditOwnSchema(parseAttributeSchema(cat.attributeSchema as unknown[]));
    setEditInherited([]);
    setEditParentName(undefined);
    setSchemaModified(false);
    setSchemaError(null);
    setSchemaHasActiveEdit(false);
    setCreateParentId(undefined);

    // Lazy fetch effective schema to extract inherited fields
    if (parent) {
      setLoadingInherited(true);
      setEditParentName(parent.name);
      getCategoryBySlug(parent.slug)
        .then((effective) => {
          const ownNames = new Set((cat.attributeSchema ?? []).map((f) => (f as AttributeSchema).name));
          setEditInherited(effective.attributeSchema.filter((f) => !ownNames.has(f.name)));
        })
        .catch(() => { /* non-fatal — inherited section stays empty */ })
        .finally(() => setLoadingInherited(false));
    }
  }

  async function handleEditSave() {
    if (!token || !editingId || editSaving) return;

    if (schemaModified) {
      setEditError(
        'Tienes atributos sin guardar. Guarda los cambios de atributos primero, o guárdalos por separado con "Guardar atributos".',
      );
      return;
    }

    setEditSaving(true);
    setEditError(null);
    try {
      await updateAdminCategory(token, editingId, {
        name: editForm.name,
        slug: editForm.slug,
        iconUrl: editForm.iconUrl || undefined,
        allowedListingType: editForm.allowedListingType,
        allowedViews: editForm.allowedViews,
        ...(editForm.defaultView && { defaultView: editForm.defaultView }),
        allowedPriceUnits: editForm.allowedPriceUnits,
      });
      setEditingId(null);
      await fetchCategories();
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Error al guardar');
    } finally {
      setEditSaving(false);
    }
  }

  async function handleSaveSchema() {
    if (!token || !editingId || schemaSaving) return;
    setSchemaSaving(true);
    setSchemaError(null);
    try {
      const serialized = serializeAttributeSchema(editOwnSchema, searchableKeys);
      await updateAdminCategory(token, editingId, { attributeSchema: serialized });
      setSchemaModified(false);
      await fetchCategories();
    } catch (err) {
      setSchemaError(err instanceof ApiError ? err.message : 'Error al guardar atributos');
    } finally {
      setSchemaSaving(false);
    }
  }

  // ── Create ──────────────────────────────────────────────────────────────────

  function openCreate(parentId: string | null) {
    setCreateParentId(parentId);
    setCreateForm(EMPTY_FORM);
    setCreateError(null);
    setCreateOwnSchema([]);
    setCreateInherited([]);
    setCreateParentName(undefined);
    setCreateSchemaHasActiveEdit(false);
    setEditingId(null);

    if (parentId) {
      const parent = categories.find((c) => c.id === parentId);
      if (parent) {
        setCreateParentName(parent.name);
        // Parent is a root category → its effective schema = its own schema
        setCreateInherited(parseAttributeSchema(parent.attributeSchema as unknown[]) as AttributeSchema[]);
      }
    }
  }

  /** Nace al final de su nivel (raíces, o hijos del padre elegido) — nunca colisiona. */
  function nextOrderFor(parentId: string | null): number {
    const siblings = parentId
      ? categories.find((c) => c.id === parentId)?.children ?? []
      : categories;
    if (siblings.length === 0) return 0;
    return Math.max(...siblings.map((c) => c.order)) + 1;
  }

  async function handleCreateSave() {
    if (!token || createSaving || createParentId === undefined) return;

    setCreateSaving(true);
    setCreateError(null);
    try {
      await createAdminCategory(token, {
        name: createForm.name,
        slug: createForm.slug,
        parentId: createParentId ?? undefined,
        iconUrl: createForm.iconUrl || undefined,
        order: nextOrderFor(createParentId),
        allowedListingType: createForm.allowedListingType,
        allowedViews: createForm.allowedViews,
        ...(createForm.defaultView && { defaultView: createForm.defaultView }),
        allowedPriceUnits: createForm.allowedPriceUnits,
        attributeSchema: serializeAttributeSchema(createOwnSchema, searchableKeys),
      });
      setCreateParentId(undefined);
      setCreateOwnSchema([]);
      await fetchCategories();
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Error al crear');
    } finally {
      setCreateSaving(false);
    }
  }

  // ── Delete ──────────────────────────────────────────────────────────────────

  async function handleDelete(id: string, name: string) {
    if (!token || !window.confirm(`¿Eliminar la categoría "${name}"?`)) return;
    setDeletingId(id);
    setDeleteErrors((prev) => { const n = { ...prev }; delete n[id]; return n; });
    try {
      await deleteAdminCategory(token, id);
      await fetchCategories();
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : 'Error al eliminar la categoría';
      setDeleteErrors((prev) => ({ ...prev, [id]: msg }));
    } finally {
      setDeletingId(null);
    }
  }

  // ── Reorder ─────────────────────────────────────────────────────────────────

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

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!token) {
    return (
      <div className="rounded border border-yellow-300 bg-yellow-50 p-4 text-yellow-800">
        Sesión no disponible. Recarga la página o inicia sesión de nuevo.
      </div>
    );
  }

  // Schema panel props for the currently-editing category (shared between root and child rows).
  // `children` solo se pasa desde la fila RAÍZ (la única que puede tener hijas en el
  // modelo de 2 niveles) — ver childCategories en SchemaEditorPanelProps.
  function buildSchemaPanel(cat: AdminCategoryChild, children?: AdminCategoryChild[]): SchemaEditorPanelProps {
    return {
      catId: cat.id,
      ownSchema: editOwnSchema,
      inherited: editInherited,
      parentName: editParentName,
      searchableKeys,
      loadingInherited,
      modified: schemaModified,
      saving: schemaSaving,
      error: schemaError,
      hasActiveEdit: schemaHasActiveEdit,
      onFieldsChange: (fields) => { setEditOwnSchema(fields); setSchemaModified(true); },
      onSave: handleSaveSchema,
      onHasActiveEdit: setSchemaHasActiveEdit,
      checkAttributeUsage: (key) =>
        getCategoryAttributeUsage(token!, cat.id, key).then((r) => r.count),
      childCategories: children?.map((c) => ({ name: c.name, attributeSchema: c.attributeSchema })),
    };
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
        <div className="mb-4 space-y-0">
          <CategoryForm
            title="Nueva categoría raíz"
            values={createForm}
            onChange={(v) => setCreateForm((prev) => ({ ...prev, ...v }))}
            onSave={handleCreateSave}
            onCancel={() => setCreateParentId(undefined)}
            saving={createSaving}
            error={createError}
          />
          <div className="mt-2 rounded-md border bg-muted/10 p-4">
            <p className="mb-3 text-sm font-medium">Atributos</p>
            <AttributeSchemaEditor
              key="create-root"
              ownSchema={createOwnSchema}
              inheritedFields={[]}
              searchableKeys={searchableKeys}
              onChange={setCreateOwnSchema}
              onHasActiveEdit={setCreateSchemaHasActiveEdit}
              disabled={createSaving}
            />
          </div>
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
              schemaPanel={editingId === cat.id ? buildSchemaPanel(cat, cat.children) : null}
              tagsPanel={
                editingId === cat.id && token
                  ? { categoryId: cat.id, categoryName: cat.name, token }
                  : null
              }
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
                      onEdit={() => startEdit(child, { slug: cat.slug, name: cat.name })}
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
                      schemaPanel={editingId === child.id ? buildSchemaPanel(child) : null}
                      tagsPanel={
                        editingId === child.id && token
                          ? { categoryId: child.id, categoryName: child.name, token }
                          : null
                      }
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
                <div className="mt-2 rounded-md border bg-muted/10 p-4">
                  <p className="mb-3 text-sm font-medium">Atributos</p>
                  {createInherited.length > 0 && (
                    <p className="mb-2 text-xs text-muted-foreground">
                      La subcategoría heredará los atributos de <strong>{createParentName}</strong>.
                      Aquí defines solo los suyos propios.
                    </p>
                  )}
                  <AttributeSchemaEditor
                    key={`create-${cat.id}`}
                    ownSchema={createOwnSchema}
                    inheritedFields={createInherited}
                    parentName={createParentName}
                    searchableKeys={searchableKeys}
                    onChange={setCreateOwnSchema}
                    onHasActiveEdit={setCreateSchemaHasActiveEdit}
                    disabled={createSaving}
                  />
                </div>
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
