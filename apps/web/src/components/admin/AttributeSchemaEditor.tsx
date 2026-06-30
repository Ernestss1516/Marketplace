'use client';

/**
 * AttributeSchemaEditor — pure UI component for editing a category's own
 * attribute schema.  Never fetches; all data is supplied via props.
 *
 * Props contract:
 *   ownSchema        — the category's own (non-inherited) fields
 *   inheritedFields  — fields coming from the parent category (read-only here)
 *   parentName       — displayed in the "heredado de X" section header
 *   searchableKeys   — names eligible for filterable=true (from /admin/categories/searchable-keys)
 *   onChange         — called with the new own-field array whenever the list changes
 *   onHasActiveEdit  — fires true when a row is being edited, false when closed
 *   disabled         — disables all interactive elements (e.g. while saving)
 *
 * The component manages its own row-editing state internally.  The parent only
 * receives committed changes via `onChange` — in-progress edits are not surfaced.
 *
 * Ajuste 1 (filterable intent preservation):
 *   Renaming a field to a non-searchable name disables the filterable checkbox
 *   visually but does NOT clear the stored value.  If the admin renames back to a
 *   searchable name, the checkbox re-enables with the original value intact.
 *   Reconciliation (force filterable=false for non-searchable names) only happens
 *   in serializeAttributeSchema(), called by the parent just before the PATCH call.
 *
 * Ajuste 3 (unknown fields round-trip):
 *   Extra keys in an existing attributeSchema object (e.g. from past manual JSON
 *   editing) are captured in the `_extra` field and round-tripped transparently.
 *   serializeAttributeSchema() puts them back in the payload, with known fields
 *   winning on any key collision.
 */

import { useState } from 'react';
import { Plus, Trash2, Edit2, X, Info } from 'lucide-react';
import type { AttributeSchema } from '@/types';
import { Button } from '@/components/ui/button';

// ── Public types ──────────────────────────────────────────────────────────────

export interface AttributeSchemaWithExtras extends AttributeSchema {
  _extra?: Record<string, unknown>;
}

// ── Parse / serialize ─────────────────────────────────────────────────────────

const KNOWN_KEYS = ['name', 'label', 'type', 'unit', 'options', 'filterable', 'required', 'cardAttribute'];

export function parseAttributeSchema(raw: unknown[]): AttributeSchemaWithExtras[] {
  return (raw ?? []).map((item) => {
    const r = ((item ?? {}) as Record<string, unknown>);
    const extra: Record<string, unknown> = {};
    for (const k of Object.keys(r)) {
      if (!KNOWN_KEYS.includes(k)) extra[k] = r[k];
    }
    const type = (['text', 'number', 'select', 'boolean'] as const).includes(r.type as never)
      ? (r.type as AttributeSchema['type'])
      : 'text';
    return {
      name: String(r.name ?? ''),
      label: String(r.label ?? ''),
      type,
      ...(r.unit !== undefined ? { unit: String(r.unit) } : {}),
      ...(Array.isArray(r.options) ? { options: r.options as string[] } : {}),
      filterable: Boolean(r.filterable),
      required: Boolean(r.required),
      ...(r.cardAttribute ? { cardAttribute: true as const } : {}),
      ...(Object.keys(extra).length > 0 ? { _extra: extra } : {}),
    };
  });
}

/**
 * Convert internal fields back to the plain objects sent to the API.
 * Reconciles filterable: forces false for any name not in searchableKeys.
 */
export function serializeAttributeSchema(
  fields: AttributeSchemaWithExtras[],
  searchableKeys: string[],
): unknown[] {
  return fields.map(({ _extra, ...known }) => {
    const out: Record<string, unknown> = {
      ...(_extra ?? {}),
      name: known.name,
      label: known.label,
      type: known.type,
      filterable: searchableKeys.includes(known.name) ? known.filterable : false,
      required: known.required,
    };
    if (known.unit !== undefined && known.unit !== '') out.unit = known.unit;
    if (known.type === 'select' && known.options && known.options.length > 0) {
      out.options = known.options;
    }
    if (known.cardAttribute) out.cardAttribute = true;
    return out;
  });
}

// ── Internal types ────────────────────────────────────────────────────────────

interface DraftState {
  name: string;
  label: string;
  type: AttributeSchema['type'];
  unit: string;
  options: string[];
  filterable: boolean;
  required: boolean;
  cardAttribute: boolean;
  _extra?: Record<string, unknown>;
}

function emptyDraft(): DraftState {
  return { name: '', label: '', type: 'text', unit: '', options: [], filterable: false, required: false, cardAttribute: false };
}

function toDraft(f: AttributeSchemaWithExtras): DraftState {
  return {
    name: f.name,
    label: f.label,
    type: f.type,
    unit: f.unit ?? '',
    options: f.options ? [...f.options] : [],
    filterable: f.filterable,
    required: f.required,
    cardAttribute: f.cardAttribute ?? false,
    _extra: f._extra,
  };
}

function fromDraft(d: DraftState): AttributeSchemaWithExtras {
  return {
    name: d.name.trim(),
    label: d.label.trim(),
    type: d.type,
    ...(d.unit.trim() ? { unit: d.unit.trim() } : {}),
    ...(d.type === 'select' && d.options.length > 0 ? { options: [...d.options] } : {}),
    filterable: d.filterable,
    required: d.required,
    ...(d.cardAttribute ? { cardAttribute: true as const } : {}),
    ...( d._extra ? { _extra: d._extra } : {}),
  };
}

function validateDraft(
  d: DraftState,
  rows: AttributeSchemaWithExtras[],
  editingIdx: number | null,
): string[] {
  const errors: string[] = [];
  const name = d.name.trim();
  if (!name) {
    errors.push('El nombre (key) es obligatorio');
  } else if (/\s/.test(name)) {
    errors.push('El nombre no puede tener espacios (usa guión bajo)');
  } else {
    const others = rows.filter((_, i) => i !== editingIdx).map(r => r.name);
    if (others.includes(name)) errors.push('Ya existe un atributo con este nombre');
  }
  if (!d.label.trim()) errors.push('La etiqueta visible es obligatoria');
  if (d.type === 'select' && d.options.length === 0) {
    errors.push('Un atributo de tipo select necesita al menos 1 opción');
  }
  return errors;
}

// ── Component props ───────────────────────────────────────────────────────────

interface AttributeSchemaEditorProps {
  ownSchema: AttributeSchemaWithExtras[];
  inheritedFields: AttributeSchema[];
  parentName?: string;
  searchableKeys: string[];
  onChange: (fields: AttributeSchemaWithExtras[]) => void;
  onHasActiveEdit?: (v: boolean) => void;
  disabled?: boolean;
}

// ── Main component ────────────────────────────────────────────────────────────

export function AttributeSchemaEditor({
  ownSchema,
  inheritedFields,
  parentName,
  searchableKeys,
  onChange,
  onHasActiveEdit,
  disabled = false,
}: AttributeSchemaEditorProps) {
  const [rows, setRows] = useState<AttributeSchemaWithExtras[]>(() => [...ownSchema]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null); // -1 = adding new
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [draftErrors, setDraftErrors] = useState<string[]>([]);
  const [deletingIdx, setDeletingIdx] = useState<number | null>(null);
  const [optionInput, setOptionInput] = useState('');

  const inheritedCardCount = inheritedFields.filter(f => f.cardAttribute).length;

  function notify(active: boolean) {
    onHasActiveEdit?.(active);
  }

  function startEdit(idx: number) {
    setEditingIdx(idx);
    setDraft(toDraft(rows[idx]));
    setDraftErrors([]);
    setDeletingIdx(null);
    setOptionInput('');
    notify(true);
  }

  function startNew() {
    setEditingIdx(-1);
    setDraft(emptyDraft());
    setDraftErrors([]);
    setDeletingIdx(null);
    setOptionInput('');
    notify(true);
  }

  function cancelEdit() {
    setEditingIdx(null);
    setDraft(null);
    setDraftErrors([]);
    setOptionInput('');
    notify(false);
  }

  function commitDraft() {
    if (!draft) return;
    const errors = validateDraft(draft, rows, editingIdx);
    if (errors.length) { setDraftErrors(errors); return; }
    const updated = fromDraft(draft);
    const newRows = editingIdx === -1
      ? [...rows, updated]
      : rows.map((r, i) => (i === editingIdx ? updated : r));
    setRows(newRows);
    onChange(newRows);
    setEditingIdx(null);
    setDraft(null);
    setDraftErrors([]);
    setOptionInput('');
    notify(false);
  }

  function startDelete(idx: number) {
    setDeletingIdx(idx);
    if (editingIdx !== null) { setEditingIdx(null); setDraft(null); notify(false); }
  }

  function confirmDelete() {
    if (deletingIdx === null) return;
    const newRows = rows.filter((_, i) => i !== deletingIdx);
    setRows(newRows);
    onChange(newRows);
    setDeletingIdx(null);
  }

  function addOption() {
    const val = optionInput.trim();
    if (!val || !draft || draft.options.includes(val)) return;
    setDraft(prev => prev ? { ...prev, options: [...prev.options, val] } : prev);
    setOptionInput('');
  }

  function removeOption(opt: string) {
    setDraft(prev => prev ? { ...prev, options: prev.options.filter(o => o !== opt) } : prev);
  }

  // Whether cardAttribute checkbox should be disabled for the current draft
  function cardDisabled(): boolean {
    if (!draft) return false;
    const otherOwnCard = rows.filter((r, i) => i !== editingIdx && r.cardAttribute).length;
    return inheritedCardCount + otherOwnCard >= 2 && !draft.cardAttribute;
  }

  const canInteract = !disabled && editingIdx === null && deletingIdx === null;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-3">
      {/* Inherited section */}
      {inheritedFields.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Heredados de{' '}
            <span className="normal-case font-medium">{parentName ?? 'la categoría padre'}</span>
          </p>
          <div className="rounded-md border divide-y divide-border bg-muted/30">
            {inheritedFields.map(f => (
              <div
                key={f.name}
                className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground select-none"
                title="Editable desde la categoría padre"
              >
                <code className="w-24 shrink-0 truncate">{f.name}</code>
                <span className="flex-1 min-w-0 truncate">{f.label}</span>
                <TypeBadge type={f.type} />
                {f.unit && <span className="text-muted-foreground/70">{f.unit}</span>}
                <FieldFlag v={f.required} label="req" />
                <FieldFlag v={f.filterable} label="filt" />
                <FieldFlag v={Boolean(f.cardAttribute)} label="card" />
                <span className="rounded border border-muted-foreground/20 bg-background px-1.5 py-0.5 text-[9px] text-muted-foreground">
                  heredado
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Own fields section */}
      <div>
        {inheritedFields.length > 0 && rows.length > 0 && (
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Propios
          </p>
        )}

        {rows.length === 0 && editingIdx !== -1 && (
          <p className="py-2 text-xs text-muted-foreground">
            Sin atributos propios. Usa el botón de abajo para añadir.
          </p>
        )}

        <div className={rows.length > 0 || editingIdx === -1 ? 'rounded-md border divide-y divide-border' : ''}>
          {rows.map((row, idx) => {
            if (deletingIdx === idx) {
              return (
                <div key={`del-${idx}`} className="flex items-center gap-2 px-3 py-2 text-xs bg-destructive/5">
                  <span className="flex-1">
                    ¿Eliminar <strong>{row.label || row.name}</strong>?
                  </span>
                  <Button
                    size="sm"
                    variant="destructive"
                    className="h-6 px-2 text-[11px]"
                    onClick={confirmDelete}
                    disabled={disabled}
                  >
                    Sí
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setDeletingIdx(null)}
                    disabled={disabled}
                  >
                    No
                  </Button>
                </div>
              );
            }

            if (editingIdx === idx) {
              return (
                <div key={`edit-${idx}`} className="px-3 py-3 bg-muted/10">
                  <FieldForm
                    draft={draft!}
                    onChange={setDraft}
                    errors={draftErrors}
                    searchableKeys={searchableKeys}
                    cardAttributeDisabled={cardDisabled()}
                    optionInput={optionInput}
                    setOptionInput={setOptionInput}
                    onAddOption={addOption}
                    onRemoveOption={removeOption}
                    onCommit={commitDraft}
                    onCancel={cancelEdit}
                    disabled={disabled}
                  />
                </div>
              );
            }

            return (
              <div key={`row-${idx}`} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/20">
                <code className="w-24 shrink-0 truncate">{row.name}</code>
                <span className="flex-1 min-w-0 truncate">{row.label}</span>
                <TypeBadge type={row.type} />
                {row.unit && <span className="text-muted-foreground/70">{row.unit}</span>}
                <FieldFlag v={row.required} label="req" />
                <FieldFlag v={row.filterable} label="filt" />
                <FieldFlag v={Boolean(row.cardAttribute)} label="card" />
                {canInteract && (
                  <div className="ml-auto flex shrink-0 gap-0.5">
                    <button
                      onClick={() => startEdit(idx)}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      title="Editar"
                      data-testid={`edit-attr-${row.name}`}
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => startDelete(idx)}
                      className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="Eliminar"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* New-field form at the bottom of the list */}
          {editingIdx === -1 && (
            <div className={rows.length > 0 ? 'px-3 py-3 bg-muted/10' : 'rounded-md border px-3 py-3 bg-muted/10'}>
              <FieldForm
                draft={draft!}
                onChange={setDraft}
                errors={draftErrors}
                searchableKeys={searchableKeys}
                cardAttributeDisabled={cardDisabled()}
                optionInput={optionInput}
                setOptionInput={setOptionInput}
                onAddOption={addOption}
                onRemoveOption={removeOption}
                onCommit={commitDraft}
                onCancel={cancelEdit}
                disabled={disabled}
              />
            </div>
          )}
        </div>
      </div>

      {/* Add-attribute button */}
      {canInteract && (
        <button
          onClick={startNew}
          className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          data-testid="add-attribute-btn"
        >
          <Plus className="h-3.5 w-3.5" />
          Añadir atributo
        </button>
      )}
    </div>
  );
}

// ── FieldForm ─────────────────────────────────────────────────────────────────

interface FieldFormProps {
  draft: DraftState;
  onChange: (d: DraftState) => void;
  errors: string[];
  searchableKeys: string[];
  cardAttributeDisabled: boolean;
  optionInput: string;
  setOptionInput: (v: string) => void;
  onAddOption: () => void;
  onRemoveOption: (o: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  disabled: boolean;
}

function FieldForm({
  draft,
  onChange,
  errors,
  searchableKeys,
  cardAttributeDisabled,
  optionInput,
  setOptionInput,
  onAddOption,
  onRemoveOption,
  onCommit,
  onCancel,
  disabled,
}: FieldFormProps) {
  function set(partial: Partial<DraftState>) {
    onChange({ ...draft, ...partial });
  }

  // Filterable checkbox: disabled when name is not in searchableKeys.
  // Value is PRESERVED (Ajuste 1) — not cleared on disable.
  const filterableDisabled = !searchableKeys.includes(draft.name.trim()) && draft.name.trim() !== '';

  return (
    <div className="space-y-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {draft.name || 'Nuevo atributo'}
      </p>

      <div className="grid grid-cols-2 gap-2">
        {/* key / name */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">key (name) *</label>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="brand"
            className="rounded border bg-background px-2 py-1.5 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={disabled}
            data-testid="attr-name-input"
          />
        </div>
        {/* label */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Etiqueta visible *</label>
          <input
            type="text"
            value={draft.label}
            onChange={(e) => set({ label: e.target.value })}
            placeholder="Marca"
            className="rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={disabled}
            data-testid="attr-label-input"
          />
        </div>
        {/* type */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Tipo</label>
          <select
            value={draft.type}
            onChange={(e) => set({ type: e.target.value as AttributeSchema['type'] })}
            className="rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={disabled}
            data-testid="attr-type-select"
          >
            <option value="text">text</option>
            <option value="number">number</option>
            <option value="select">select</option>
            <option value="boolean">boolean</option>
          </select>
        </div>
        {/* unit */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Unidad</label>
          <input
            type="text"
            value={draft.unit}
            onChange={(e) => set({ unit: e.target.value })}
            placeholder="km, CV, m²…"
            className="rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={disabled}
          />
        </div>
      </div>

      {/* Options editor — only visible for select type */}
      {draft.type === 'select' && (
        <div className="space-y-1.5" data-testid="options-editor">
          <span className="text-[11px] font-medium text-muted-foreground">Opciones *</span>
          <div className="flex flex-wrap gap-1">
            {draft.options.map(opt => (
              <span
                key={opt}
                className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs"
              >
                {opt}
                <button
                  onClick={() => onRemoveOption(opt)}
                  className="text-muted-foreground hover:text-destructive"
                  disabled={disabled}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-1">
            <input
              type="text"
              value={optionInput}
              onChange={(e) => setOptionInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddOption(); } }}
              placeholder="Nueva opción…"
              className="flex-1 rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={disabled}
              data-testid="option-input"
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={onAddOption}
              disabled={disabled || !optionInput.trim()}
            >
              Añadir
            </Button>
          </div>
        </div>
      )}

      {/* Checkbox row */}
      <div className="flex flex-wrap gap-5">
        {/* required */}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={draft.required}
            onChange={(e) => set({ required: e.target.checked })}
            disabled={disabled}
            className="h-3.5 w-3.5 rounded"
          />
          required
        </label>

        {/* filterable */}
        <label
          className={`flex items-center gap-1.5 text-xs ${filterableDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
          title={
            filterableDisabled
              ? `"${draft.name.trim()}" no está en VARIABLE_ATTRIBUTE_KEYS. Para habilitarlo, añádelo al backend.`
              : undefined
          }
        >
          <input
            type="checkbox"
            checked={draft.filterable}
            onChange={(e) => { if (!filterableDisabled) set({ filterable: e.target.checked }); }}
            disabled={disabled || filterableDisabled}
            className="h-3.5 w-3.5 rounded"
            data-testid="filterable-checkbox"
          />
          filterable
          {filterableDisabled && (
            <Info className="h-3 w-3 text-muted-foreground" />
          )}
        </label>

        {/* cardAttribute */}
        <label
          className={`flex items-center gap-1.5 text-xs ${cardAttributeDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
          title={
            cardAttributeDisabled
              ? 'Ya hay 2 atributos de tarjeta en el schema efectivo (máximo permitido)'
              : undefined
          }
        >
          <input
            type="checkbox"
            checked={draft.cardAttribute}
            onChange={(e) => { if (!cardAttributeDisabled) set({ cardAttribute: e.target.checked }); }}
            disabled={disabled || cardAttributeDisabled}
            className="h-3.5 w-3.5 rounded"
            data-testid="card-attribute-checkbox"
          />
          cardAttribute
          {cardAttributeDisabled && (
            <Info className="h-3 w-3 text-muted-foreground" />
          )}
        </label>
      </div>

      {/* Validation errors */}
      {errors.length > 0 && (
        <ul className="space-y-0.5">
          {errors.map(e => (
            <li key={e} className="text-xs text-destructive">{e}</li>
          ))}
        </ul>
      )}

      {/* Confirm / Cancel */}
      <div className="flex gap-2">
        <Button size="sm" onClick={onCommit} disabled={disabled} data-testid="attr-confirm-btn">
          Confirmar
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={disabled} data-testid="cancel-attr-edit">
          Cancelar
        </Button>
      </div>
    </div>
  );
}

// ── Small display helpers ─────────────────────────────────────────────────────

function TypeBadge({ type }: { type: string }) {
  const cls: Record<string, string> = {
    text:    'bg-blue-50 text-blue-700 border-blue-200',
    number:  'bg-orange-50 text-orange-700 border-orange-200',
    select:  'bg-purple-50 text-purple-700 border-purple-200',
    boolean: 'bg-green-50 text-green-700 border-green-200',
  };
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls[type] ?? 'bg-muted'}`}>
      {type}
    </span>
  );
}

function FieldFlag({ v, label }: { v: boolean; label: string }) {
  return (
    <span className={`text-[10px] tabular-nums ${v ? 'text-foreground' : 'text-muted-foreground/30'}`}>
      {label}:{v ? '✓' : '—'}
    </span>
  );
}
