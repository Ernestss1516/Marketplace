'use client';

import { AlertCircle } from 'lucide-react';
import type { HomeCtaBlock } from '@/types/home-blocks';
// Espejo de cliente de isSafeContentUrl. Se reusa TAL CUAL el del blog: no
// menciona ningún tipo de bloque, así que cruza la frontera entre motores sin
// acoplar nada (docs/diseno-portada.md §4.0). El backend sigue siendo la fuente
// de verdad; esto solo pone el error junto al campo sin esperar el round-trip.
import { isSafeContentUrl, SAFE_URL_HINT } from '@/lib/blocks/validation';
import { inputCls, labelCls, hintCls, errorCls } from './shared';

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
      {/* ── ESCAPARATE C · LA BANDA ────────────────────────────────────────────────
          Con titular, el bloque deja de ser un botón suelto y pasa a ser una banda a
          color de marca. Los dos campos van PRIMERO porque son los que deciden la
          forma del bloque: el texto del botón es el detalle, no la cabecera. */}
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Titular (opcional)</label>
        <input
          type="text"
          value={block.title ?? ''}
          onChange={(e) => onChange({ title: e.target.value })}
          className={inputCls}
          disabled={disabled}
          placeholder="p.ej. ¿Tienes algo que vender?"
          data-testid="cta-title"
        />
        <p className={hintCls}>
          Con titular, el bloque se pinta como una banda destacada con el color de la marca.
          Sin él, como un botón centrado.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Frase de apoyo (opcional)</label>
        <input
          type="text"
          value={block.description ?? ''}
          onChange={(e) => onChange({ description: e.target.value })}
          className={inputCls}
          disabled={disabled}
          placeholder="p.ej. Publicar es gratis. Sin comisiones."
          data-testid="cta-description"
        />
        <p className={hintCls}>Solo se muestra si hay titular.</p>
      </div>

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
        {/* ESCAPARATE C — decirlo aquí evita que alguien cambie el estilo tres veces sin
            ver nada. La banda tiene UN reparto de color, el que garantiza que su botón se
            lea sobre ella en los cinco modelos; tres variantes más serían dos repartos
            sin garantía. Ver `CtaButton`. */}
        {block.title ? (
          <p className={hintCls}>
            Con titular, el bloque se pinta como banda y usa el color de la marca: este
            estilo solo se aplica al botón centrado (sin titular).
          </p>
        ) : null}
      </div>
    </div>
  );
}
