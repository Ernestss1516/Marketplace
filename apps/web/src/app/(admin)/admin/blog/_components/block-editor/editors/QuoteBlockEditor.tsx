import type { QuoteBlock } from '@/types/blocks';
import { inputCls, textareaCls, labelCls } from './shared';

export function QuoteBlockEditor({
  block,
  onChange,
  disabled,
}: {
  block: QuoteBlock;
  onChange: (patch: Partial<QuoteBlock>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Cita *</label>
        <textarea
          value={block.text}
          onChange={(e) => onChange({ text: e.target.value })}
          className={textareaCls}
          rows={2}
          disabled={disabled}
          placeholder="La frase que quieres destacar"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Autor (opcional)</label>
        <input
          type="text"
          value={block.author ?? ''}
          onChange={(e) => onChange({ author: e.target.value || undefined })}
          className={inputCls}
          disabled={disabled}
          placeholder="Nombre de quien lo dijo"
        />
      </div>
    </div>
  );
}
