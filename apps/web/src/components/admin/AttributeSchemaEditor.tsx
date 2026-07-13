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
 *
 * Rename-with-data warning (Fase 5.2 cierre):
 *   Renaming the `name` of an EXISTING row (not adding a new one) triggers an
 *   optional `checkAttributeUsage(oldKey)` lookup. If it resolves to a count > 0,
 *   the admin is warned that listings still hold data under the old key before
 *   the rename is committed — see PROBLEMA 3c in the integrity audit: renaming
 *   never migrates Listing.attributes, so the old key becomes orphaned data. This
 *   only warns; it never migrates anything.
 */

import { useState } from 'react';
import { Plus, Trash2, Edit2, X, Info, Loader2, ChevronUp, ChevronDown } from 'lucide-react';
import type { AttributeSchema, ListingType } from '@/types';
import { Button } from '@/components/ui/button';

// ── Public types ──────────────────────────────────────────────────────────────

export interface AttributeSchemaWithExtras extends AttributeSchema {
  _extra?: Record<string, unknown>;
}

// ── Parse / serialize ─────────────────────────────────────────────────────────

const KNOWN_KEYS = ['name', 'label', 'type', 'unit', 'options', 'filterable', 'required', 'cardAttribute', 'wideCardAttribute', 'showLabel', 'showUnit', 'appliesTo', 'dependsOn', 'optionsByParent'];

// RÁFAGA 3 — mismo default que resolveShowLabel/resolveShowUnit en el backend
// (category.types.ts): ausente ⇒ oculta el label si hay unidad, muestra la
// unidad si la hay. Reproduce la regla hardcodeada previa a esta ráfaga.
function defaultShowLabel(unit: string): boolean {
  return !unit.trim();
}
const DEFAULT_SHOW_UNIT = true;

function cloneOptionsByParent(o: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, [...v]]));
}

// ATRIBUTOS EN CARD — respetar producto/servicio. Mismo cálculo que
// countAttributesByType en el backend (category.types.ts) — duplicado aquí porque
// no hay paquete compartido entre api/web (mismo criterio que toAttrDef arriba).
// Un atributo sin appliesTo (aplica a ambos) cuenta en las dos cuentas; el tope
// (2 para card, 6 para wideCard) se valida POR TIPO, no globalmente.
type TypeCounts = { PRODUCT: number; SERVICE: number };
type CardFlag = 'cardAttribute' | 'wideCardAttribute';

function countByType(
  fields: { cardAttribute?: boolean; wideCardAttribute?: boolean; appliesTo?: ListingType[] }[],
  flag: CardFlag,
): TypeCounts {
  const counts: TypeCounts = { PRODUCT: 0, SERVICE: 0 };
  for (const f of fields) {
    if (!f[flag]) continue;
    if (!f.appliesTo || f.appliesTo.includes('PRODUCT')) counts.PRODUCT++;
    if (!f.appliesTo || f.appliesTo.includes('SERVICE')) counts.SERVICE++;
  }
  return counts;
}

// IMPACTO EN HIJAS (contador, no solo validación al guardar) — mirrors
// resolveEffectiveSchema (category.types.ts, backend): la hija SIEMPRE gana
// sobre el padre en un mismo `name` — misma duplicación que countByType/
// toAttrDef arriba, por la misma razón (no hay paquete compartido api/web).
// `own` (la hija) y `parentSchema` (el padre, con el draft ya aplicado) pueden
// ser formas ligeramente distintas — countByType solo necesita el subconjunto
// común (cardAttribute/wideCardAttribute/appliesTo), así que el resultado se
// tipa como unión en vez de forzar un único T.
function mergeEffective<A extends { name: string }, B extends { name: string }>(
  own: A[],
  parentSchema: B[],
): (A | B)[] {
  if (!parentSchema.length) return own;
  const ownNames = new Set(own.map((f) => f.name));
  const inherited = parentSchema.filter((f) => !ownNames.has(f.name));
  return [...inherited, ...own];
}

function parseAppliesTo(value: unknown): ListingType[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const valid = value.filter((v): v is ListingType => v === 'PRODUCT' || v === 'SERVICE');
  // Ausente o {PRODUCT,SERVICE} completo son equivalentes ("aplica a ambos") —
  // no conservar un array de 2 elementos evita reescribir datos ya migrados.
  return valid.length > 0 && valid.length < 2 ? valid : undefined;
}

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
    const appliesTo = parseAppliesTo(r.appliesTo);
    const dependsOn = typeof r.dependsOn === 'string' && r.dependsOn ? r.dependsOn : undefined;
    const optionsByParent =
      dependsOn && r.optionsByParent && typeof r.optionsByParent === 'object' && !Array.isArray(r.optionsByParent)
        ? Object.fromEntries(
            Object.entries(r.optionsByParent as Record<string, unknown>)
              .filter(([, v]) => Array.isArray(v))
              .map(([k, v]) => [k, (v as unknown[]).filter((x): x is string => typeof x === 'string')]),
          )
        : undefined;
    return {
      name: String(r.name ?? ''),
      label: String(r.label ?? ''),
      type,
      ...(r.unit !== undefined ? { unit: String(r.unit) } : {}),
      ...(Array.isArray(r.options) ? { options: r.options as string[] } : {}),
      filterable: Boolean(r.filterable),
      required: Boolean(r.required),
      ...(r.cardAttribute ? { cardAttribute: true as const } : {}),
      ...(r.wideCardAttribute ? { wideCardAttribute: true as const } : {}),
      // Tri-state (true / false / ausente): a diferencia de cardAttribute (booleano plano,
      // default false), aquí "ausente" significa "calcular el default a partir de unit" — así
      // que un `false` explícito debe distinguirse de "no configurado", no colapsarse a él.
      ...(typeof r.showLabel === 'boolean' ? { showLabel: r.showLabel } : {}),
      ...(typeof r.showUnit === 'boolean' ? { showUnit: r.showUnit } : {}),
      ...(appliesTo ? { appliesTo } : {}),
      ...(dependsOn ? { dependsOn } : {}),
      ...(optionsByParent ? { optionsByParent } : {}),
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
    if (known.wideCardAttribute) out.wideCardAttribute = true;
    // fromDraft() ya decidió si showLabel/showUnit deben persistirse (solo cuando difieren
    // del default calculado a partir de unit) — aquí solo se pasa lo que ya viene en la row.
    if (known.showLabel !== undefined) out.showLabel = known.showLabel;
    if (known.showUnit !== undefined) out.showUnit = known.showUnit;
    if (known.appliesTo) out.appliesTo = known.appliesTo;
    if (known.type === 'select' && known.dependsOn) {
      out.dependsOn = known.dependsOn;
      if (known.optionsByParent) out.optionsByParent = known.optionsByParent;
    }
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
  wideCardAttribute: boolean;
  /** RÁFAGA 3 — siempre concretos en el draft (el checkbox necesita un booleano real);
   * la ambigüedad "ausente = calcular default" solo existe en el JSON persistido, resuelta
   * al entrar en toDraft() y vuelta a colapsar en fromDraft() si coincide con el default. */
  showLabel: boolean;
  showUnit: boolean;
  /** Ambos marcados (default) = comportamiento actual, sin restricción de tipo. */
  appliesTo: ListingType[];
  /** Name del atributo select del que depende, o '' si es un select plano. */
  dependsOn: string;
  /** Opciones válidas por valor del padre. Solo relevante si dependsOn !== ''. */
  optionsByParent: Record<string, string[]>;
  _extra?: Record<string, unknown>;
}

/** Vista previa de cómo queda el atributo en la card, con un valor de ejemplo (RÁFAGA 3). */
function previewText(d: Pick<DraftState, 'label' | 'unit' | 'type' | 'showLabel' | 'showUnit'>): string {
  const label = d.label.trim() || 'Etiqueta';
  const exampleValue = d.type === 'boolean' ? 'Sí' : '150.000';
  const value = d.showUnit && d.unit.trim() ? `${exampleValue} ${d.unit.trim()}` : exampleValue;
  return d.showLabel ? `${label}: ${value}` : value;
}

/** Candidato a "padre" en un select vinculado: otro select sin su propio dependsOn (un solo nivel, sin cadenas). */
interface ParentCandidate {
  name: string;
  label: string;
  options: string[];
}

function emptyDraft(): DraftState {
  return {
    name: '', label: '', type: 'text', unit: '', options: [],
    filterable: false, required: false, cardAttribute: false, wideCardAttribute: false,
    showLabel: defaultShowLabel(''), showUnit: DEFAULT_SHOW_UNIT,
    appliesTo: ['PRODUCT', 'SERVICE'],
    dependsOn: '', optionsByParent: {},
  };
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
    wideCardAttribute: f.wideCardAttribute ?? false,
    // Mismo default que resolveShowLabel/resolveShowUnit en el backend.
    showLabel: f.showLabel ?? defaultShowLabel(f.unit ?? ''),
    showUnit: f.showUnit ?? DEFAULT_SHOW_UNIT,
    appliesTo: f.appliesTo ? [...f.appliesTo] : ['PRODUCT', 'SERVICE'],
    dependsOn: f.dependsOn ?? '',
    optionsByParent: f.optionsByParent ? cloneOptionsByParent(f.optionsByParent) : {},
    _extra: f._extra,
  };
}

/**
 * dependsOnValid: false cuando el padre elegido ya no está entre los
 * candidatos disponibles (borrado/renombrado/ya no es select plano) — en ese
 * caso se guarda como select plano (tolerante, no bloquea el guardado).
 */
function fromDraft(d: DraftState, dependsOnValid: boolean): AttributeSchemaWithExtras {
  const useLinked = d.type === 'select' && Boolean(d.dependsOn) && dependsOnValid;
  return {
    name: d.name.trim(),
    label: d.label.trim(),
    type: d.type,
    ...(d.unit.trim() ? { unit: d.unit.trim() } : {}),
    ...(d.type === 'select' && !useLinked && d.options.length > 0 ? { options: [...d.options] } : {}),
    filterable: d.filterable,
    required: d.required,
    ...(d.cardAttribute ? { cardAttribute: true as const } : {}),
    ...(d.wideCardAttribute ? { wideCardAttribute: true as const } : {}),
    // Solo se persiste si difiere del default calculado a partir de la unidad ACTUAL del
    // draft — así un atributo cuyo admin nunca toca estos checkboxes se guarda
    // byte-idéntico a antes de RÁFAGA 3 (misma lógica que appliesTo, dos líneas más abajo).
    ...(d.showLabel !== defaultShowLabel(d.unit) ? { showLabel: d.showLabel } : {}),
    ...(d.showUnit !== DEFAULT_SHOW_UNIT ? { showUnit: d.showUnit } : {}),
    // Ambos marcados → omitir el campo (attributeSchema byte-idéntico al de
    // antes de RÁFAGA 2 para quien nunca toca estos checkboxes).
    ...(d.appliesTo.length < 2 ? { appliesTo: [...d.appliesTo] } : {}),
    ...(useLinked ? { dependsOn: d.dependsOn } : {}),
    ...(useLinked && Object.keys(d.optionsByParent).length > 0
      ? { optionsByParent: cloneOptionsByParent(d.optionsByParent) }
      : {}),
    ...( d._extra ? { _extra: d._extra } : {}),
  };
}

function validateDraft(
  d: DraftState,
  rows: AttributeSchemaWithExtras[],
  editingIdx: number | null,
  dependsOnValid: boolean,
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
  if (d.type === 'select') {
    const useLinked = Boolean(d.dependsOn) && dependsOnValid;
    if (!useLinked && d.options.length === 0) {
      errors.push('Un atributo de tipo select necesita al menos 1 opción');
    }
    if (useLinked && !Object.values(d.optionsByParent).some((arr) => arr.length > 0)) {
      errors.push('Añade al menos una opción para algún valor del atributo del que depende');
    }
  }
  if (d.appliesTo.length === 0) {
    errors.push('Selecciona al menos un tipo (Producto o Servicio)');
  }
  return errors;
}

/** Candidatos a "padre": selects (propios, excluyendo el que se edita, + heredados) sin su propio dependsOn. */
function collectParentCandidates(
  rows: AttributeSchemaWithExtras[],
  inheritedFields: AttributeSchema[],
  excludeIdx: number | null,
): ParentCandidate[] {
  const inheritedCandidates = inheritedFields
    .filter((f) => f.type === 'select' && !f.dependsOn)
    .map((f) => ({ name: f.name, label: f.label, options: f.options ?? [] }));
  const ownCandidates = rows
    .filter((r, i) => i !== excludeIdx && r.type === 'select' && !r.dependsOn)
    .map((r) => ({ name: r.name, label: r.label, options: r.options ?? [] }));
  return [...inheritedCandidates, ...ownCandidates];
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
  /**
   * Resolves how many listings have data under `oldKey`. Only supplied when
   * editing an EXISTING category (a category must exist to have listings).
   * Omit for the create-category flow, where no rename can ever have data.
   */
  checkAttributeUsage?: (oldKey: string) => Promise<number>;
  /**
   * IMPACTO EN HIJAS — solo se pasa cuando esta categoría es una RAÍZ que YA
   * tiene subcategorías. Sin esto, editar el PADRE solo mostraba el error de
   * validación AL GUARDAR (assertCardAttributeChangeDoesNotBreakChildren, ya
   * existente) — nada visible mientras se edita, a diferencia del contador de
   * la propia categoría. Con esto, cada hija se recalcula en vivo con el
   * schema del padre TAL COMO quedaría con el draft actual (confirmado en
   * vivo con Ernest: quería ver el impacto, no solo el error al guardar).
   */
  childCategories?: { name: string; attributeSchema: AttributeSchema[] }[];
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
  checkAttributeUsage,
  childCategories,
}: AttributeSchemaEditorProps) {
  const [rows, setRows] = useState<AttributeSchemaWithExtras[]>(() => [...ownSchema]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null); // -1 = adding new
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [draftErrors, setDraftErrors] = useState<string[]>([]);
  const [deletingIdx, setDeletingIdx] = useState<number | null>(null);
  const [optionInput, setOptionInput] = useState('');
  const [checkingUsage, setCheckingUsage] = useState(false);

  /** Fields OTHER than the one currently being edited/added — the base to check the
   * draft's own flag against (heredados + propios salvo la fila en edición). */
  function otherFields(): (AttributeSchema | AttributeSchemaWithExtras)[] {
    return [...inheritedFields, ...rows.filter((_, i) => i !== editingIdx)];
  }

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

  async function commitDraft() {
    if (!draft) return;
    const parentCandidates = collectParentCandidates(rows, inheritedFields, editingIdx);
    const dependsOnValid = !draft.dependsOn || parentCandidates.some((p) => p.name === draft.dependsOn);
    const errors = validateDraft(draft, rows, editingIdx, dependsOnValid);
    if (errors.length) { setDraftErrors(errors); return; }
    const updated = fromDraft(draft, dependsOnValid);

    // Renaming (not creating) an existing key that already has listing data:
    // warn before committing. Never migrates — only informs the admin.
    const isRename = editingIdx !== null && editingIdx !== -1 && rows[editingIdx].name !== updated.name;
    if (isRename && checkAttributeUsage) {
      setCheckingUsage(true);
      let count = 0;
      try {
        count = await checkAttributeUsage(rows[editingIdx as number].name);
      } catch {
        count = 0; // fail-open: a failed check must never block saving
      } finally {
        setCheckingUsage(false);
      }
      if (count > 0) {
        const oldName = rows[editingIdx as number].name;
        const proceed = window.confirm(
          `${count} anuncio(s) tienen datos bajo la clave '${oldName}'. Al renombrarla a ` +
          `'${updated.name}', esos datos quedarán huérfanos (no se muestran ni se migran). ¿Continuar?`,
        );
        if (!proceed) return;
      }
    }

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

  /**
   * El orden de los atributos propios es su posición en `rows` — no hay campo
   * `order` separado. Mover es un simple swap de posiciones; se persiste con
   * el guardado de `attributeSchema` ya existente (sin endpoint nuevo).
   */
  function moveRow(idx: number, dir: 'up' | 'down') {
    const neighborIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (neighborIdx < 0 || neighborIdx >= rows.length) return;
    const newRows = [...rows];
    [newRows[idx], newRows[neighborIdx]] = [newRows[neighborIdx], newRows[idx]];
    setRows(newRows);
    onChange(newRows);
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

  // Whether cardAttribute checkbox should be disabled for the current draft.
  // ATRIBUTOS EN CARD — respetar producto/servicio: el tope se comprueba SOLO para
  // los tipos a los que aplica ESTE draft (draft.appliesTo) — marcarlo nunca se
  // bloquea por culpa de un tipo al que el atributo ni siquiera aplica.
  function cardDisabled(): boolean {
    if (!draft || draft.cardAttribute) return false;
    const counts = countByType(otherFields(), 'cardAttribute');
    return draft.appliesTo.some((t) => counts[t] >= 2);
  }

  // RÁFAGA 2 — mismo mecanismo que cardDisabled() pero con tope 6 para la vista ampliada.
  function wideCardDisabled(): boolean {
    if (!draft || draft.wideCardAttribute) return false;
    const counts = countByType(otherFields(), 'wideCardAttribute');
    return draft.appliesTo.some((t) => counts[t] >= 6);
  }

  /** Cuentas POR TIPO a mostrar en la UI (incluye el propio draft si está marcado) —
   * para que el admin entienda "Producto: 2/2 · Servicio: 1/2" en vez de un tope
   * global que parecería arbitrario cuando hay más de 2 atributos de card marcados. */
  function displayCounts(flag: CardFlag): TypeCounts {
    const counts = countByType(otherFields(), flag);
    if (draft?.[flag]) {
      for (const t of draft.appliesTo) counts[t]++;
    }
    return counts;
  }

  /**
   * IMPACTO EN HIJAS — el schema PROPIO de esta categoría (no el efectivo: esta
   * categoría, si tiene hijas, es una raíz sin padre propio) tal como quedaría
   * con el draft actual ya aplicado — mismo criterio que usa commitDraft() para
   * construir `newRows`, pero recalculado en cada render (sin comprometer nada)
   * para que el impacto se vea MIENTRAS se edita, no solo tras guardar.
   */
  function proposedOwnSchema(): { name: string; cardAttribute?: boolean; wideCardAttribute?: boolean; appliesTo?: ListingType[] }[] {
    const base = rows.map((r) => ({ name: r.name, cardAttribute: r.cardAttribute, wideCardAttribute: r.wideCardAttribute, appliesTo: r.appliesTo }));
    if (!draft) return base;
    const draftEntry = {
      name: draft.name.trim(),
      cardAttribute: draft.cardAttribute || undefined,
      wideCardAttribute: draft.wideCardAttribute || undefined,
      appliesTo: draft.appliesTo.length < 2 ? draft.appliesTo : undefined,
    };
    return editingIdx === -1 ? [...base, draftEntry] : base.map((r, i) => (i === editingIdx ? draftEntry : r));
  }

  /** Por cada hija: su schema efectivo con el schema del padre TAL COMO quedaría
   * con este draft — mismo mergeEffective que ya usa el backend (resolveEffectiveSchema),
   * no un cálculo nuevo que pueda divergir. */
  function childrenImpact(flag: CardFlag): { name: string; counts: TypeCounts }[] {
    if (!childCategories || childCategories.length === 0) return [];
    const proposedParent = proposedOwnSchema();
    return childCategories.map((child) => ({
      name: child.name,
      counts: countByType(mergeEffective(child.attributeSchema, proposedParent), flag),
    }));
  }

  const canInteract = !disabled && editingIdx === null && deletingIdx === null;
  const parentCandidates = collectParentCandidates(rows, inheritedFields, editingIdx);

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
                <FieldFlag v={Boolean(f.wideCardAttribute)} label="wcard" />
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
                    wideCardAttributeDisabled={wideCardDisabled()}
                    cardCounts={displayCounts('cardAttribute')}
                    wideCardCounts={displayCounts('wideCardAttribute')}
                    cardChildrenImpact={childrenImpact('cardAttribute')}
                    wideCardChildrenImpact={childrenImpact('wideCardAttribute')}
                    optionInput={optionInput}
                    setOptionInput={setOptionInput}
                    onAddOption={addOption}
                    onRemoveOption={removeOption}
                    onCommit={commitDraft}
                    onCancel={cancelEdit}
                    disabled={disabled}
                    checkingUsage={checkingUsage}
                    parentCandidates={parentCandidates}
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
                <FieldFlag v={Boolean(row.wideCardAttribute)} label="wcard" />
                {row.dependsOn && (
                  <span className="text-[10px] text-muted-foreground" title={`Depende de "${row.dependsOn}"`}>
                    ↳ {row.dependsOn}
                  </span>
                )}
                {canInteract && (
                  <div className="ml-auto flex shrink-0 gap-0.5">
                    <button
                      onClick={() => moveRow(idx, 'up')}
                      disabled={idx === 0}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                      title="Subir"
                      data-testid={`move-up-attr-${row.name}`}
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => moveRow(idx, 'down')}
                      disabled={idx === rows.length - 1}
                      className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
                      title="Bajar"
                      data-testid={`move-down-attr-${row.name}`}
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
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
                wideCardAttributeDisabled={wideCardDisabled()}
                cardCounts={displayCounts('cardAttribute')}
                wideCardCounts={displayCounts('wideCardAttribute')}
                cardChildrenImpact={childrenImpact('cardAttribute')}
                wideCardChildrenImpact={childrenImpact('wideCardAttribute')}
                optionInput={optionInput}
                setOptionInput={setOptionInput}
                onAddOption={addOption}
                onRemoveOption={removeOption}
                onCommit={commitDraft}
                onCancel={cancelEdit}
                disabled={disabled}
                parentCandidates={parentCandidates}
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
  wideCardAttributeDisabled: boolean;
  /** ATRIBUTOS EN CARD — respetar producto/servicio: cuentas POR TIPO ya incluyendo
   * el propio draft si está marcado, para mostrar "Producto: X/2 · Servicio: Y/2". */
  cardCounts: TypeCounts;
  wideCardCounts: TypeCounts;
  /** IMPACTO EN HIJAS — vacío si esta categoría no tiene hijas. */
  cardChildrenImpact: { name: string; counts: TypeCounts }[];
  wideCardChildrenImpact: { name: string; counts: TypeCounts }[];
  optionInput: string;
  setOptionInput: (v: string) => void;
  onAddOption: () => void;
  onRemoveOption: (o: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  disabled: boolean;
  checkingUsage?: boolean;
  parentCandidates: ParentCandidate[];
}

function FieldForm({
  draft,
  onChange,
  errors,
  searchableKeys,
  cardAttributeDisabled,
  wideCardAttributeDisabled,
  cardCounts,
  wideCardCounts,
  cardChildrenImpact,
  wideCardChildrenImpact,
  optionInput,
  setOptionInput,
  onAddOption,
  onRemoveOption,
  onCommit,
  onCancel,
  disabled,
  checkingUsage = false,
  parentCandidates,
}: FieldFormProps) {
  function set(partial: Partial<DraftState>) {
    onChange({ ...draft, ...partial });
  }

  const parentField = parentCandidates.find((p) => p.name === draft.dependsOn);
  const isDependsOnBroken = Boolean(draft.dependsOn) && !parentField;
  const useLinkedEditor = draft.type === 'select' && Boolean(draft.dependsOn) && !isDependsOnBroken;

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

      {/* dependsOn — select vinculado a otro select ya definido (un solo nivel, sin cadenas) */}
      {draft.type === 'select' && (
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-muted-foreground">Depende de (opcional)</label>
          <select
            value={draft.dependsOn}
            onChange={(e) => set({ dependsOn: e.target.value, ...(e.target.value ? {} : { optionsByParent: {} }) })}
            className="rounded border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={disabled}
            data-testid="attr-depends-on-select"
          >
            <option value="">— Ninguno (select plano) —</option>
            {parentCandidates.map((p) => (
              <option key={p.name} value={p.name}>{p.label} ({p.name})</option>
            ))}
            {isDependsOnBroken && (
              <option value={draft.dependsOn}>{draft.dependsOn} (no disponible)</option>
            )}
          </select>
          {isDependsOnBroken && (
            <p className="text-[11px] text-amber-600">
              El atributo del que depende ya no está disponible — se guardará como select plano.
            </p>
          )}
        </div>
      )}

      {/* Options editor — select plano (sin dependsOn, o dependsOn roto/tolerado como plano) */}
      {draft.type === 'select' && !useLinkedEditor && (
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

      {/* Options editor — select vinculado: un sub-editor de chips por cada valor del padre */}
      {useLinkedEditor && parentField && (
        <LinkedOptionsEditor
          parentField={parentField}
          optionsByParent={draft.optionsByParent}
          onChange={(next) => set({ optionsByParent: next })}
          disabled={disabled}
        />
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
              ? `"${draft.name.trim()}" aún no es filtrable en el backend. Guarda el esquema; se habilitará como filtro de búsqueda en el próximo reinicio del servidor.`
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
              ? `Ya hay 2 atributos de card estándar marcados para el/los tipo(s) de este atributo ` +
                `(Producto: ${cardCounts.PRODUCT}/2 · Servicio: ${cardCounts.SERVICE}/2)`
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

        {/* wideCardAttribute — RÁFAGA 2: hasta 6 en el schema efectivo, independiente de cardAttribute */}
        <label
          className={`flex items-center gap-1.5 text-xs ${wideCardAttributeDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
          title={
            wideCardAttributeDisabled
              ? `Ya hay 6 atributos de vista ampliada marcados para el/los tipo(s) de este atributo ` +
                `(Producto: ${wideCardCounts.PRODUCT}/6 · Servicio: ${wideCardCounts.SERVICE}/6)`
              : undefined
          }
        >
          <input
            type="checkbox"
            checked={draft.wideCardAttribute}
            onChange={(e) => { if (!wideCardAttributeDisabled) set({ wideCardAttribute: e.target.checked }); }}
            disabled={disabled || wideCardAttributeDisabled}
            className="h-3.5 w-3.5 rounded"
            data-testid="wide-card-attribute-checkbox"
          />
          wideCardAttribute
          {wideCardAttributeDisabled && (
            <Info className="h-3 w-3 text-muted-foreground" />
          )}
        </label>

        {/* showLabel / showUnit — RÁFAGA 3: dos ejes independientes de cómo se muestra el
            atributo en card (no un enum de 3 modos). showUnit solo tiene sentido con unidad. */}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={draft.showLabel}
            onChange={(e) => set({ showLabel: e.target.checked })}
            disabled={disabled}
            className="h-3.5 w-3.5 rounded"
            data-testid="show-label-checkbox"
          />
          showLabel
        </label>
        {draft.unit.trim() && (
          <label className="flex cursor-pointer items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={draft.showUnit}
              onChange={(e) => set({ showUnit: e.target.checked })}
              disabled={disabled}
              className="h-3.5 w-3.5 rounded"
              data-testid="show-unit-checkbox"
            />
            showUnit
          </label>
        )}

        {/* appliesTo — a qué tipo(s) de anuncio aplica este atributo (ambos = default, comportamiento actual) */}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={draft.appliesTo.includes('PRODUCT')}
            onChange={(e) => {
              const next = e.target.checked
                ? [...draft.appliesTo, 'PRODUCT' as const]
                : draft.appliesTo.filter((t) => t !== 'PRODUCT');
              set({ appliesTo: next });
            }}
            disabled={disabled}
            className="h-3.5 w-3.5 rounded"
            data-testid="applies-to-product-checkbox"
          />
          Producto
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={draft.appliesTo.includes('SERVICE')}
            onChange={(e) => {
              const next = e.target.checked
                ? [...draft.appliesTo, 'SERVICE' as const]
                : draft.appliesTo.filter((t) => t !== 'SERVICE');
              set({ appliesTo: next });
            }}
            disabled={disabled}
            className="h-3.5 w-3.5 rounded"
            data-testid="applies-to-service-checkbox"
          />
          Servicio
        </label>
      </div>

      {/* ATRIBUTOS EN CARD — respetar producto/servicio: cuentas POR TIPO (no un tope
          global) — un atributo "ambos" cuenta en las dos. Incluye el propio draft si
          está marcado, para que el admin vea el estado que se guardaría. */}
      <p className="text-[11px] text-muted-foreground" data-testid="card-attribute-counts">
        Card estándar — Producto: {cardCounts.PRODUCT}/2 · Servicio: {cardCounts.SERVICE}/2
        {' · '}Card ampliada — Producto: {wideCardCounts.PRODUCT}/6 · Servicio: {wideCardCounts.SERVICE}/6
      </p>

      {/* IMPACTO EN HIJAS — solo aparece editando una categoría RAÍZ con
          subcategorías. Un anuncio publicado EN el padre nunca ve los atributos
          de una hija (la herencia va padre→hija, no al revés) — esto no es "lo
          que verá la card del padre", es informativo: cuánto quedaría cada hija
          si se guarda el cambio actual, para no descubrirlo con el error al
          guardar (assertCardAttributeChangeDoesNotBreakChildren, backend). */}
      {cardChildrenImpact.length > 0 && (
        <div className="space-y-1 rounded-md border border-dashed p-2" data-testid="children-impact">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Impacto en subcategorías
          </p>
          {cardChildrenImpact.map((child, i) => {
            const wide = wideCardChildrenImpact[i];
            const exceeds =
              child.counts.PRODUCT > 2 || child.counts.SERVICE > 2 ||
              wide.counts.PRODUCT > 6 || wide.counts.SERVICE > 6;
            return (
              <p
                key={child.name}
                className={`text-[11px] ${exceeds ? 'font-medium text-destructive' : 'text-muted-foreground'}`}
                data-testid={`child-impact-${child.name}`}
              >
                {exceeds && '⚠ '}
                {child.name} — Card: Producto {child.counts.PRODUCT}/2 · Servicio {child.counts.SERVICE}/2
                {' · '}Ampliada: Producto {wide.counts.PRODUCT}/6 · Servicio {wide.counts.SERVICE}/6
              </p>
            );
          })}
        </div>
      )}

      {/* Vista previa (RÁFAGA 3) — cómo queda el atributo en la card con un valor de ejemplo */}
      <p className="text-[11px] text-muted-foreground" data-testid="attr-preview">
        Vista previa: <span className="font-medium text-foreground">{previewText(draft)}</span>
      </p>

      {/* Validation errors */}
      {errors.length > 0 && (
        <ul className="space-y-0.5">
          {errors.map(e => (
            <li key={e} className="text-xs text-destructive">{e}</li>
          ))}
        </ul>
      )}

      {/* Confirm / Cancel */}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={onCommit} disabled={disabled || checkingUsage} data-testid="attr-confirm-btn">
          {checkingUsage ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirmar'}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel} disabled={disabled || checkingUsage} data-testid="cancel-attr-edit">
          Cancelar
        </Button>
        {checkingUsage && (
          <span className="text-xs text-muted-foreground">Comprobando uso…</span>
        )}
      </div>
    </div>
  );
}

// ── LinkedOptionsEditor ───────────────────────────────────────────────────────

/**
 * Sub-editor de `optionsByParent`: un mini editor de chips por cada opción
 * actual del atributo padre (`parentField.options`), rellenando de qué
 * opciones dispone hoy para no obligar a recordarlas. Entradas huérfanas de
 * `optionsByParent` (valores de padre que ya no existen) simplemente no se
 * muestran — son inertes, no molestan (se preservan en el objeto igualmente
 * porque este componente solo añade/quita dentro de las claves visibles).
 */
function LinkedOptionsEditor({
  parentField,
  optionsByParent,
  onChange,
  disabled,
}: {
  parentField: ParentCandidate;
  optionsByParent: Record<string, string[]>;
  onChange: (next: Record<string, string[]>) => void;
  disabled: boolean;
}) {
  const [inputs, setInputs] = useState<Record<string, string>>({});

  function addOption(parentValue: string) {
    const val = (inputs[parentValue] ?? '').trim();
    if (!val) return;
    const current = optionsByParent[parentValue] ?? [];
    if (current.includes(val)) return;
    onChange({ ...optionsByParent, [parentValue]: [...current, val] });
    setInputs((prev) => ({ ...prev, [parentValue]: '' }));
  }

  function removeOption(parentValue: string, opt: string) {
    onChange({
      ...optionsByParent,
      [parentValue]: (optionsByParent[parentValue] ?? []).filter((o) => o !== opt),
    });
  }

  if (parentField.options.length === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        &quot;{parentField.label}&quot; todavía no tiene opciones propias — añade opciones ahí primero.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="linked-options-editor">
      <span className="text-[11px] font-medium text-muted-foreground">
        Opciones por valor de &quot;{parentField.label}&quot; *
      </span>
      {parentField.options.map((parentValue) => (
        <div key={parentValue} className="space-y-1 rounded border bg-background/50 p-2">
          <p className="text-[11px] font-medium">{parentValue}</p>
          <div className="flex flex-wrap gap-1">
            {(optionsByParent[parentValue] ?? []).map((opt) => (
              <span key={opt} className="flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs">
                {opt}
                <button
                  onClick={() => removeOption(parentValue, opt)}
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
              value={inputs[parentValue] ?? ''}
              onChange={(e) => setInputs((prev) => ({ ...prev, [parentValue]: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOption(parentValue); } }}
              placeholder="Nueva opción…"
              className="flex-1 rounded border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={disabled}
              data-testid={`linked-option-input-${parentValue}`}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => addOption(parentValue)}
              disabled={disabled || !(inputs[parentValue] ?? '').trim()}
            >
              Añadir
            </Button>
          </div>
        </div>
      ))}
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
