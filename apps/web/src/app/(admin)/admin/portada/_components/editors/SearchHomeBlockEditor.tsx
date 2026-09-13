'use client';

import type { HomeSearchBlock } from '@/types/home-blocks';
import { inputCls, labelCls, hintCls } from './shared';

// Tope de chips. Espejo de MAX_POPULAR_CATEGORIES del backend
// (search-block.dto.ts): el <input> lo acota para que el admin no descubra el
// límite por un 400.
const MAX_POPULAR = 12;

/**
 * Editor del bloque `search`.
 *
 * QUÉ ES CONFIGURABLE Y QUÉ NO: el buscador en sí —los selectores, el campo, las
 * sugerencias de etiquetas— no se configura. Es `SearchBar`, la misma pieza que
 * usa /busqueda, y sus opciones salen del árbol de categorías y de la lista de
 * provincias, no de la portada. Lo que este bloque decide es **que el buscador
 * esté** y sus dos adornos: el texto pequeño de encima y los enlaces a
 * categorías de debajo (docs/diseno-portada.md §4.1).
 *
 * Por eso el editor es corto a propósito: no hay nada más que ofrecer sin
 * inventar campos que el modelo no tiene.
 */
export function SearchHomeBlockEditor({
  block,
  onChange,
  disabled,
}: {
  block: HomeSearchBlock;
  onChange: (patch: Partial<HomeSearchBlock>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Texto pequeño encima del buscador (opcional)</label>
        <input
          type="text"
          value={block.eyebrow ?? ''}
          onChange={(e) => onChange({ eyebrow: e.target.value || undefined })}
          className={inputCls}
          disabled={disabled}
          placeholder="p.ej. Miles de anuncios cerca de ti"
          data-testid="search-eyebrow"
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={block.showPopularCategories ?? false}
          onChange={(e) => onChange({ showPopularCategories: e.target.checked })}
          disabled={disabled}
          data-testid="search-show-popular"
        />
        Mostrar enlaces a las categorías más usadas
      </label>

      {block.showPopularCategories && (
        <div className="flex flex-col gap-1">
          <label className={labelCls}>¿Cuántas categorías?</label>
          <input
            type="number"
            min={1}
            max={MAX_POPULAR}
            value={block.popularCount ?? 6}
            onChange={(e) => {
              const n = Number(e.target.value);
              onChange({ popularCount: Number.isFinite(n) ? n : undefined });
            }}
            className={inputCls}
            disabled={disabled}
            data-testid="search-popular-count"
          />
          <p className={hintCls}>
            Se muestran las primeras del árbol de categorías, en su orden. Máximo {MAX_POPULAR}.
          </p>
        </div>
      )}

      {/* ── ESCAPARATE D · MONTAR EL BUSCADOR SOBRE EL HERO ──────────────────────── */}
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={block.overlapHero ?? false}
          onChange={(e) => onChange({ overlapHero: e.target.checked })}
          disabled={disabled}
          data-testid="search-overlap-hero"
        />
        Montar el buscador sobre la banda del hero
      </label>

      {block.overlapHero && (
        // EL AVISO, Y NO UNA BARRERA. El bloque no puede saber si es el primero —ningún
        // bloque conoce su índice, y ésa es la regla que la casilla existe para
        // respetar—, así que la comprobación no puede vivir en el código: vive aquí,
        // donde alguien acaba de marcarla. Con el buscador en tercer puesto el resultado
        // es feo, no roto.
        <p className={hintCls} data-testid="search-overlap-hint">
          El buscador sube y se solapa con el hero. Sólo queda bien si el buscador es el
          PRIMER bloque de la lista; si va más abajo, se montará sobre el bloque anterior.
          Es lo que llena el hero cuando su altura es «pantalla completa».
        </p>
      )}
    </div>
  );
}
