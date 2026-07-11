import { AlertCircle } from 'lucide-react';
import type { CtaBlock } from '@/types/blocks';
import { isSafeContentUrl, SAFE_URL_HINT } from '@/lib/blocks/validation';
import { inputCls, labelCls, errorCls } from './shared';

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
