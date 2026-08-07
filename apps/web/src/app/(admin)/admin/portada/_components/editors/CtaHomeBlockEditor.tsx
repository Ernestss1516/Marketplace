'use client';

import { AlertCircle } from 'lucide-react';
import type { HomeCtaBlock } from '@/types/home-blocks';
// Espejo de cliente de isSafeContentUrl. Se reusa TAL CUAL el del blog: no
// menciona ningún tipo de bloque, así que cruza la frontera entre motores sin
// acoplar nada (docs/diseno-portada.md §4.0). El backend sigue siendo la fuente
// de verdad; esto solo pone el error junto al campo sin esperar el round-trip.
import { isSafeContentUrl, SAFE_URL_HINT } from '@/lib/blocks/validation';
import { inputCls, labelCls, errorCls } from './shared';

const STYLE_OPTIONS: { value: NonNullable<HomeCtaBlock['style']>; label: string }[] = [
  { value: 'primary', label: 'Destacado (relleno)' },
  { value: 'secondary', label: 'Secundario' },
  { value: 'outline', label: 'Contorno' },
];

export function CtaHomeBlockEditor({
  block,
  onChange,
  disabled,
}: {
  block: HomeCtaBlock;
  onChange: (patch: Partial<HomeCtaBlock>) => void;
  disabled?: boolean;
}) {
  const hrefError = block.href && !isSafeContentUrl(block.href);

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Texto del botón *</label>
        <input
          type="text"
          value={block.label}
          onChange={(e) => onChange({ label: e.target.value })}
          className={inputCls}
          disabled={disabled}
          placeholder="p.ej. Publica tu anuncio gratis"
          data-testid="cta-label"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Enlace *</label>
        <input
          type="text"
          value={block.href}
          onChange={(e) => onChange({ href: e.target.value })}
          className={inputCls}
          disabled={disabled}
          placeholder="/publicar o https://..."
          data-testid="cta-href"
        />
        {hrefError && (
          <p className={errorCls} data-testid="cta-href-error">
            <AlertCircle className="h-3 w-3 shrink-0" />
            {SAFE_URL_HINT}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Estilo</label>
        <select
          value={block.style ?? 'primary'}
          onChange={(e) => onChange({ style: e.target.value as HomeCtaBlock['style'] })}
          className={inputCls}
          disabled={disabled}
        >
          {STYLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
