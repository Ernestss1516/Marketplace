'use client';

import { AlertCircle, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isSafeContentUrl, SAFE_URL_HINT } from '@/lib/blocks/validation';
import type { HomeStepsBlock, HomeStepsColumn } from '@/types/home-blocks';
import { IconPicker } from './IconPicker';
import { inputCls, labelCls, errorCls, hintCls } from './shared';

/** Topes espejo del DTO (steps-block.dto.ts): 3 columnas, 6 pasos por columna. */
const MAX_COLUMNS = 3;
const MAX_STEPS = 6;

export function StepsHomeBlockEditor({
  block,
  onChange,
  disabled,
}: {
  block: HomeStepsBlock;
  onChange: (patch: Partial<HomeStepsBlock>) => void;
  disabled?: boolean;
}) {
  function updateColumn(index: number, patch: Partial<HomeStepsColumn>) {
    onChange({ columns: block.columns.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  }

  function moveColumn(index: number, dir: 'left' | 'right') {
    const target = dir === 'left' ? index - 1 : index + 1;
    if (target < 0 || target >= block.columns.length) return;
    const next = [...block.columns];
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ columns: next });
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Título de la sección (opcional)</label>
        <input
          type="text"
          value={block.title ?? ''}
          onChange={(e) => onChange({ title: e.target.value || undefined })}
          className={inputCls}
          disabled={disabled}
          placeholder="p.ej. Cómo funciona"
          data-testid="steps-title"
        />
      </div>

      <div className="space-y-3" data-testid="steps-columns">
        {block.columns.map((column, colIdx) => (
          <div key={colIdx} className="rounded-md border bg-muted/10 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Columna {colIdx + 1}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveColumn(colIdx, 'left')}
                  disabled={disabled || colIdx === 0}
                  className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  title="Mover a la izquierda"
                  aria-label={`Mover columna ${colIdx + 1} a la izquierda`}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveColumn(colIdx, 'right')}
                  disabled={disabled || colIdx === block.columns.length - 1}
                  className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  title="Mover a la derecha"
                  aria-label={`Mover columna ${colIdx + 1} a la derecha`}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChange({ columns: block.columns.filter((_, i) => i !== colIdx) })
                  }
                  disabled={disabled || block.columns.length <= 1}
                  className="h-4 w-4 text-muted-foreground hover:text-destructive disabled:opacity-30"
                  title={block.columns.length <= 1 ? 'Debe quedar al menos una columna' : 'Quitar columna'}
                  aria-label={`Quitar columna ${colIdx + 1}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-col gap-1">
                <label className={labelCls}>¿Para quién? *</label>
                <input
                  type="text"
                  value={column.audienceTitle}
                  onChange={(e) => updateColumn(colIdx, { audienceTitle: e.target.value })}
                  className={inputCls}
                  disabled={disabled}
                  placeholder="p.ej. Para compradores"
                  data-testid={`steps-audience-${colIdx}`}
                />
              </div>

              <IconPicker
                value={column.icon}
                onChange={(icon) => updateColumn(colIdx, { icon })}
                disabled={disabled}
                label="Icono de la columna (opcional)"
                testId={`steps-icons-${colIdx}`}
              />

              <div className="space-y-2">
                <label className={labelCls}>Pasos</label>
                {column.steps.map((step, stepIdx) => (
                  <div key={stepIdx} className="flex gap-2 rounded-md border bg-background p-2">
                    {/* El número sale del ORDEN, no de un campo: reordenar no
                        puede dejar un "3, 1, 2". */}
                    <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                      {stepIdx + 1}
                    </span>
                    <div className="min-w-0 flex-1 space-y-1">
                      <input
                        type="text"
                        value={step.title}
                        onChange={(e) =>
                          updateColumn(colIdx, {
                            steps: column.steps.map((s, i) =>
                              i === stepIdx ? { ...s, title: e.target.value } : s,
                            ),
                          })
                        }
                        className={inputCls}
                        disabled={disabled}
                        placeholder="Título del paso"
                        aria-label={`Título del paso ${stepIdx + 1} de la columna ${colIdx + 1}`}
                        data-testid={`steps-${colIdx}-title-${stepIdx}`}
                      />
                      <input
                        type="text"
                        value={step.description}
                        onChange={(e) =>
                          updateColumn(colIdx, {
                            steps: column.steps.map((s, i) =>
                              i === stepIdx ? { ...s, description: e.target.value } : s,
                            ),
                          })
                        }
                        className={inputCls}
                        disabled={disabled}
                        placeholder="Explicación del paso"
                        aria-label={`Explicación del paso ${stepIdx + 1} de la columna ${colIdx + 1}`}
                        data-testid={`steps-${colIdx}-desc-${stepIdx}`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        updateColumn(colIdx, {
                          steps: column.steps.filter((_, i) => i !== stepIdx),
                        })
                      }
                      disabled={disabled || column.steps.length <= 1}
                      className="h-5 w-5 shrink-0 self-start text-muted-foreground hover:text-destructive disabled:opacity-30"
                      title={column.steps.length <= 1 ? 'Debe quedar al menos un paso' : 'Quitar paso'}
                      aria-label={`Quitar paso ${stepIdx + 1} de la columna ${colIdx + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    updateColumn(colIdx, {
                      steps: [...column.steps, { title: '', description: '' }],
                    })
                  }
                  disabled={disabled || column.steps.length >= MAX_STEPS}
                  title={column.steps.length >= MAX_STEPS ? `El máximo son ${MAX_STEPS} pasos` : undefined}
                  data-testid={`steps-add-step-${colIdx}`}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Añadir paso
                </Button>
              </div>

              <div className="space-y-1">
                <label className={labelCls}>Enlace al final de la columna (opcional)</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <input
                    type="text"
                    value={column.cta?.label ?? ''}
                    onChange={(e) => {
                      const label = e.target.value;
                      updateColumn(colIdx, {
                        cta: label || column.cta?.href ? { label, href: column.cta?.href ?? '' } : undefined,
                      });
                    }}
                    className={inputCls}
                    disabled={disabled}
                    placeholder="Texto (p.ej. Buscar ahora →)"
                    aria-label={`Texto del enlace de la columna ${colIdx + 1}`}
                    data-testid={`steps-cta-label-${colIdx}`}
                  />
                  <input
                    type="text"
                    value={column.cta?.href ?? ''}
                    onChange={(e) => {
                      const href = e.target.value;
                      updateColumn(colIdx, {
                        cta: href || column.cta?.label ? { label: column.cta?.label ?? '', href } : undefined,
                      });
                    }}
                    className={inputCls}
                    disabled={disabled}
                    placeholder="/busqueda o https://..."
                    aria-label={`Enlace de la columna ${colIdx + 1}`}
                    data-testid={`steps-cta-href-${colIdx}`}
                  />
                </div>
                {column.cta?.href && !isSafeContentUrl(column.cta.href) ? (
                  <p className={errorCls} data-testid={`steps-cta-error-${colIdx}`}>
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {SAFE_URL_HINT}
                  </p>
                ) : (
                  <p className={hintCls}>Si pones uno, hacen falta los dos campos.</p>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange({
            columns: [
              ...block.columns,
              { audienceTitle: '', steps: [{ title: '', description: '' }] },
            ],
          })
        }
        disabled={disabled || block.columns.length >= MAX_COLUMNS}
        title={block.columns.length >= MAX_COLUMNS ? `El máximo son ${MAX_COLUMNS} columnas` : undefined}
        data-testid="steps-add-column"
      >
        <Plus className="mr-1 h-3 w-3" />
        Añadir columna
      </Button>
    </div>
  );
}
