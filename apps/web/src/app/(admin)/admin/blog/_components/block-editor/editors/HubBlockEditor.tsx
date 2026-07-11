import { AlertCircle } from 'lucide-react';
import type { HubBlock, HubLink } from '@/types/blocks';
import { isSafeContentUrl, SAFE_URL_HINT } from '@/lib/blocks/validation';
import { SubItemList } from '../SubItemList';
import { inputCls, labelCls, errorCls } from './shared';

export function HubBlockEditor({
  block,
  onChange,
  disabled,
}: {
  block: HubBlock;
  onChange: (patch: Partial<HubBlock>) => void;
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
          placeholder="p.ej. Enlaces relacionados"
        />
      </div>

      <SubItemList<HubLink>
        items={block.links}
        onChange={(links) => onChange({ links })}
        createItem={() => ({ label: '', href: '' })}
        addLabel="Añadir enlace"
        disabled={disabled}
        renderItem={(item, onItemChange) => {
          const hrefError = item.href && !isSafeContentUrl(item.href);
          return (
            <div className="space-y-2">
              <input
                type="text"
                value={item.label}
                onChange={(e) => onItemChange({ label: e.target.value })}
                className={inputCls}
                disabled={disabled}
                placeholder="Texto del enlace"
              />
              <input
                type="text"
                value={item.href}
                onChange={(e) => onItemChange({ href: e.target.value })}
                className={inputCls}
                disabled={disabled}
                placeholder="/busqueda o https://..."
              />
              {hrefError && (
                <p className={errorCls}>
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  {SAFE_URL_HINT}
                </p>
              )}
              <input
                type="text"
                value={item.description ?? ''}
                onChange={(e) => onItemChange({ description: e.target.value || undefined })}
                className={inputCls}
                disabled={disabled}
                placeholder="Descripción (opcional)"
              />
            </div>
          );
        }}
      />
    </div>
  );
}
