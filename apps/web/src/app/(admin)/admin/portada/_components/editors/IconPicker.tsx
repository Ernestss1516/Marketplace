'use client';

import { HOME_ICON_NAMES, type HomeIconName } from '@/types/home-blocks';
import { HOME_ICONS, HOME_ICON_LABELS } from '@/components/home/home-icons';
import { labelCls } from './shared';

/**
 * Selector de icono: una REJILLA de iconos donde se elige pulsando, no un campo
 * de texto con el nombre técnico. El diseño lo pide así (§4.3) por el mismo
 * motivo que el selector de tipo de bloque es un panel de tarjetas: un admin no
 * técnico no tiene por qué saber que el escudo se llama `shield-check`.
 *
 * La lista es cerrada, así que la rejilla es la lista entera — no hace falta
 * buscador ni paginación.
 */
export function IconPicker({
  value,
  onChange,
  disabled,
  label = 'Icono',
  allowNone = true,
  testId,
}: {
  value: HomeIconName | undefined;
  onChange: (name: HomeIconName | undefined) => void;
  disabled?: boolean;
  label?: string;
  allowNone?: boolean;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className={labelCls}>{label}</label>
      <div className="flex flex-wrap gap-1" data-testid={testId}>
        {allowNone && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            disabled={disabled}
            className={`rounded-md border px-2 py-1 text-xs transition-colors ${
              value === undefined ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'
            }`}
            title="Sin icono"
          >
            Sin icono
          </button>
        )}
        {HOME_ICON_NAMES.map((name) => {
          const Icon = HOME_ICONS[name];
          const selected = value === name;
          return (
            <button
              key={name}
              type="button"
              onClick={() => onChange(name)}
              disabled={disabled}
              // El nombre accesible es la etiqueta en español, no el slug: es lo
              // que un lector de pantalla debe anunciar.
              aria-label={HOME_ICON_LABELS[name]}
              aria-pressed={selected}
              title={HOME_ICON_LABELS[name]}
              className={`rounded-md border p-2 transition-colors ${
                selected ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'
              }`}
              data-testid={`icon-${name}`}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
