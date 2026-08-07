'use client';

import { AlertCircle, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { inputCls, labelCls, hintCls, errorCls } from './editors/shared';

/**
 * TOPE DE OPCIONES ROTATIVAS = 6, y la UI lo IMPIDE, no lo avisa.
 *
 * No es una preferencia estética: la rotación está resuelta en CSS puro y los
 * porcentajes de un `@keyframes` no admiten `calc()`, así que hay cinco reglas
 * escritas a mano (`hero-rot-2` … `hero-rot-6`, en globals.css). Con una séptima
 * opción no habría clase que aplicar y el titular se quedaría CONGELADO en la
 * primera — un fallo silencioso, que es la peor clase.
 *
 * El backend valida lo mismo (MAX_HERO_ROTATING_OPTIONS en update-homepage.dto.ts);
 * esto evita que el admin lo descubra por un 400.
 */
export const MAX_ROTATING = 6;

/** Espejo de MIN/MAX_HERO_ROTATION_MS del backend. */
const MIN_MS = 1500;
const MAX_MS = 10000;

export interface HeroValues {
  heroStaticTitle: string;
  heroRotatingOptions: string[];
  heroRotationMs: number;
  heroSubtitle: string;
}

export function HeroEditor({
  values,
  onChange,
  disabled,
}: {
  values: HeroValues;
  onChange: (patch: Partial<HeroValues>) => void;
  disabled?: boolean;
}) {
  const options = values.heroRotatingOptions;
  const atMax = options.length >= MAX_ROTATING;
  const tituloVacio = !values.heroStaticTitle.trim();
  const velocidadFuera = values.heroRotationMs < MIN_MS || values.heroRotationMs > MAX_MS;

  function setOption(index: number, value: string) {
    onChange({ heroRotatingOptions: options.map((o, i) => (i === index ? value : o)) });
  }

  function addOption() {
    if (atMax) return;
    onChange({ heroRotatingOptions: [...options, ''] });
  }

  function removeOption(index: number) {
    onChange({ heroRotatingOptions: options.filter((_, i) => i !== index) });
  }

  function moveOption(index: number, dir: 'up' | 'down') {
    const target = dir === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ heroRotatingOptions: next });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Título fijo *</label>
        <input
          type="text"
          value={values.heroStaticTitle}
          onChange={(e) => onChange({ heroStaticTitle: e.target.value })}
          className={inputCls}
          disabled={disabled}
          placeholder="p.ej. Compra y vende"
          data-testid="hero-static-title"
        />
        {tituloVacio ? (
          <p className={errorCls} data-testid="hero-title-error">
            <AlertCircle className="h-3 w-3 shrink-0" />
            La portada siempre necesita un titular: este campo no puede quedarse vacío.
          </p>
        ) : (
          <p className={hintCls}>
            Es el titular de la portada. Si añades palabras rotativas abajo, se muestran
            justo detrás de este texto.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Palabras que rotan (opcional)</label>
        <p className={hintCls}>
          Se van alternando detrás del título fijo. Sin ninguna, el titular es fijo.
        </p>

        <div className="mt-2 space-y-2" data-testid="hero-rotating-list">
          {options.map((option, index) => (
            <div key={index} className="flex gap-2 rounded-md border bg-muted/10 p-2">
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  onClick={() => moveOption(index, 'up')}
                  disabled={disabled || index === 0}
                  className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  title="Subir"
                  aria-label={`Subir opción ${index + 1}`}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveOption(index, 'down')}
                  disabled={disabled || index === options.length - 1}
                  className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  title="Bajar"
                  aria-label={`Bajar opción ${index + 1}`}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>

              <input
                type="text"
                value={option}
                onChange={(e) => setOption(index, e.target.value)}
                className={inputCls}
                disabled={disabled}
                placeholder="p.ej. coches"
                aria-label={`Palabra rotativa ${index + 1}`}
                data-testid={`hero-rotating-${index}`}
              />

              <button
                type="button"
                onClick={() => removeOption(index)}
                disabled={disabled}
                className="h-6 w-6 shrink-0 self-center text-muted-foreground hover:text-destructive disabled:opacity-30"
                title="Quitar"
                aria-label={`Quitar opción ${index + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>

        <div className="mt-2 flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addOption}
            // BARRERA, no aviso: al llegar a 6 no se puede añadir la séptima.
            disabled={disabled || atMax}
            title={
              atMax
                ? `El máximo es ${MAX_ROTATING}: la animación tiene una regla de estilo por cada número de palabras, y no hay una para ${MAX_ROTATING + 1}.`
                : 'Añadir palabra'
            }
            data-testid="hero-add-rotating"
          >
            <Plus className="mr-1 h-3 w-3" />
            Añadir palabra
          </Button>
          <span className="text-xs text-muted-foreground" data-testid="hero-rotating-count">
            {options.length} de {MAX_ROTATING}
          </span>
        </div>

        {atMax && (
          <p className={hintCls} data-testid="hero-rotating-max">
            Has llegado al máximo de {MAX_ROTATING} palabras. La animación necesita una regla de
            estilo distinta para cada cantidad, y están escritas hasta {MAX_ROTATING}.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Velocidad</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={MIN_MS}
              max={MAX_MS}
              step={500}
              value={values.heroRotationMs}
              onChange={(e) => onChange({ heroRotationMs: Number(e.target.value) })}
              className={inputCls}
              disabled={disabled}
              data-testid="hero-rotation-ms"
            />
            <span className="shrink-0 text-xs text-muted-foreground">ms por palabra</span>
          </div>
          {velocidadFuera ? (
            <p className={errorCls}>
              <AlertCircle className="h-3 w-3 shrink-0" />
              Entre {MIN_MS} y {MAX_MS} ms. Por debajo no da tiempo a leerla; por encima parece
              que se ha quedado parada.
            </p>
          ) : (
            <p className={hintCls}>
              Cada palabra se ve {(values.heroRotationMs / 1000).toFixed(1)} segundos.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className={labelCls}>Subtítulo (opcional)</label>
          <input
            type="text"
            value={values.heroSubtitle}
            onChange={(e) => onChange({ heroSubtitle: e.target.value })}
            className={inputCls}
            disabled={disabled}
            placeholder="Una frase corta bajo el titular"
            data-testid="hero-subtitle"
          />
          <p className={hintCls}>Texto sencillo, sin formato.</p>
        </div>
      </div>
    </div>
  );
}
