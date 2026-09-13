import { AlertCircle } from 'lucide-react';
import type { CtaBlock } from '@/types/blocks';
import { isSafeContentUrl, SAFE_URL_HINT } from '@/lib/blocks/validation';
import { inputCls, labelCls, hintCls, errorCls } from './shared';

const STYLE_OPTIONS: { value: NonNullable<CtaBlock['style']>; label: string }[] = [
  { value: 'primary', label: 'Destacado (relleno)' },
  { value: 'secondary', label: 'Secundario' },
  { value: 'outline', label: 'Contorno' },
];

export function CtaBlockEditor({
  block,
  onChange,
  disabled,
}: {
  block: CtaBlock;
  onChange: (patch: Partial<CtaBlock>) => void;
  disabled?: boolean;
}) {
  const hrefError = block.href && !isSafeContentUrl(block.href);

  return (
    <div className="space-y-3">
      {/* ── ESCAPARATE C · LA CAJA ────────────────────────────────────────────────
          Gemelo del editor del bloque `cta` de portada. Con titular, el bloque deja de
          ser un botón suelto y pasa a ser una caja con el color de la marca. */}
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Titular (opcional)</label>
        <input
          type="text"
          value={block.title ?? ''}
          onChange={(e) => onChange({ title: e.target.value })}
          className={inputCls}
          disabled={disabled}
          placeholder="p.ej. ¿Algo no encaja en un anuncio?"
          data-testid="cta-title"
        />
        <p className={hintCls}>
          Con titular, el bloque se pinta como una caja destacada con el color de la marca.
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
          placeholder="p.ej. Denunciarlo lleva veinte segundos."
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
          placeholder="p.ej. Publicar anuncio"
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
        />
        {hrefError && (
          <p className={errorCls}>
            <AlertCircle className="h-3 w-3 shrink-0" />
            {SAFE_URL_HINT}
          </p>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Estilo</label>
        <select
          value={block.style ?? 'primary'}
          onChange={(e) => onChange({ style: e.target.value as CtaBlock['style'] })}
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
