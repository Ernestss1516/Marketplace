'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import type { HomeBlock } from '@/types/home-blocks';
import { HOME_BLOCK_TYPE_META, homeBlockHasContent } from './homeBlockDefaults';
import { CtaHomeBlockEditor } from './editors/CtaHomeBlockEditor';
import { SearchHomeBlockEditor } from './editors/SearchHomeBlockEditor';

function assertUnreachable(block: never): never {
  throw new Error(`Tipo de bloque de portada no soportado: ${JSON.stringify(block)}`);
}

/**
 * Switch exhaustivo — mismo patrón y misma garantía que `HomeBlockRenderer`:
 * cuando RP.4 añada `grid` a la unión `HomeBlock`, ESTE fichero deja de compilar
 * hasta que alguien escriba su editor. Es lo que impide que nazca un tipo sin
 * forma de configurarlo, que es justo el motivo de que el editor vaya en RP.3 y
 * no al final.
 */
function renderEditor(
  block: HomeBlock,
  onChange: (block: HomeBlock) => void,
  disabled?: boolean,
) {
  switch (block.type) {
    case 'search':
      return (
        <SearchHomeBlockEditor
          block={block}
          onChange={(patch) => onChange({ ...block, ...patch })}
          disabled={disabled}
        />
      );
    case 'cta':
      return (
        <CtaHomeBlockEditor
          block={block}
          onChange={(patch) => onChange({ ...block, ...patch })}
          disabled={disabled}
        />
      );
    default:
      return assertUnreachable(block);
  }
}

export function HomeBlockEditorRow({
  block,
  isFirst,
  isLast,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
  disabled,
}: {
  block: HomeBlock;
  isFirst: boolean;
  isLast: boolean;
  onChange: (block: HomeBlock) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  disabled?: boolean;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const meta = HOME_BLOCK_TYPE_META[block.type];
  const Icon = meta.icon;

  // Confirmación SOLO si hay algo escrito: pedirla siempre entrena a ignorarla.
  function handleDeleteClick() {
    if (homeBlockHasContent(block) && !confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    onDelete();
  }

  return (
    <div className="rounded-md border bg-background" data-testid={`home-block-row-${block.type}`}>
      <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2">
        <div className="flex shrink-0 flex-col">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={disabled || isFirst}
            className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Subir"
            aria-label={`Subir ${meta.label}`}
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={disabled || isLast}
            className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Bajar"
            aria-label={`Bajar ${meta.label}`}
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>

        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">{meta.label}</span>

        <div className="ml-auto flex items-center gap-2">
          {confirmingDelete && (
            <span className="text-xs text-destructive">¿Seguro? Se perderá el contenido.</span>
          )}
          <button
            type="button"
            onClick={handleDeleteClick}
            onBlur={() => setConfirmingDelete(false)}
            disabled={disabled}
            className={confirmingDelete ? 'text-destructive' : 'text-muted-foreground hover:text-destructive'}
            title="Quitar bloque"
            aria-label={`Quitar ${meta.label}`}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="p-3">{renderEditor(block, onChange, disabled)}</div>
    </div>
  );
}
