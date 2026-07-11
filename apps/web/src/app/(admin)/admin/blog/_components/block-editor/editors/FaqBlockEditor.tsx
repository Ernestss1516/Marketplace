import type { FaqBlock, FaqItem } from '@/types/blocks';
import { SubItemList } from '../SubItemList';
import { inputCls, textareaCls, labelCls } from './shared';

// answer: textarea simple, no el MarkdownEditor completo — una respuesta de
// FAQ suele ser 1-2 frases; montar un editor con toolbar por cada ítem sería
// más fricción que ayuda para el caso de uso típico. El backend igualmente
// la renderiza vía MarkdownBody (mismo rehype-sanitize), así que sigue
// siendo segura aunque no tenga toolbar de formato.
export function FaqBlockEditor({
  block,
  onChange,
  disabled,
}: {
  block: FaqBlock;
  onChange: (patch: Partial<FaqBlock>) => void;
  disabled?: boolean;
}) {
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
          placeholder="p.ej. Preguntas frecuentes"
        />
      </div>

      <SubItemList<FaqItem>
        items={block.items}
        onChange={(items) => onChange({ items })}
        createItem={() => ({ question: '', answer: '' })}
        addLabel="Añadir pregunta"
        disabled={disabled}
        renderItem={(item, onItemChange) => (
          <div className="space-y-2">
            <input
              type="text"
              value={item.question}
              onChange={(e) => onItemChange({ question: e.target.value })}
              className={inputCls}
              disabled={disabled}
              placeholder="Pregunta"
            />
            <textarea
              value={item.answer}
              onChange={(e) => onItemChange({ answer: e.target.value })}
              className={textareaCls}
              rows={2}
              disabled={disabled}
              placeholder="Respuesta"
            />
          </div>
        )}
      />
    </div>
  );
}
