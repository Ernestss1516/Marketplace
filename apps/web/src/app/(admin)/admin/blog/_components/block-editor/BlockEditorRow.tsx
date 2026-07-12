'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import type { Block } from '@/types/blocks';
import { BLOCK_TYPE_META, blockHasContent } from './blockDefaults';
import { SeparatorBlockEditor } from './editors/SeparatorBlockEditor';
import { QuoteBlockEditor } from './editors/QuoteBlockEditor';
import { CtaBlockEditor } from './editors/CtaBlockEditor';
import { TextBlockEditor } from './editors/TextBlockEditor';
import { ImageBlockEditor } from './editors/ImageBlockEditor';
import { FaqBlockEditor } from './editors/FaqBlockEditor';
import { HubBlockEditor } from './editors/HubBlockEditor';
import { VideoBlockEditor } from './editors/VideoBlockEditor';
import { TableBlockEditor } from './editors/TableBlockEditor';
import { ImageTextBlockEditor } from './editors/ImageTextBlockEditor';
import { StepsBlockEditor } from './editors/StepsBlockEditor';
import { ProfileBlockEditor } from './editors/ProfileBlockEditor';
import { ListingsBlockEditor } from './editors/ListingsBlockEditor';

function assertUnreachable(block: never): never {
  throw new Error(`Tipo de bloque no soportado: ${JSON.stringify(block)}`);
}

// Switch exhaustivo — mismo patrón que BlockRenderer.tsx (components/blocks/):
// si se añade un 14º tipo sin su editor aquí, el build falla.
function renderEditor(
  block: Block,
  onChange: (block: Block) => void,
  token: string,
  disabled?: boolean,
) {
  switch (block.type) {
    case 'separator':
      return <SeparatorBlockEditor />;
    case 'quote':
      return <QuoteBlockEditor block={block} onChange={(patch) => onChange({ ...block, ...patch })} disabled={disabled} />;
    case 'cta':
      return <CtaBlockEditor block={block} onChange={(patch) => onChange({ ...block, ...patch })} disabled={disabled} />;
    case 'text':
      return <TextBlockEditor block={block} onChange={(patch) => onChange({ ...block, ...patch })} token={token} disabled={disabled} />;
    case 'image':
      return <ImageBlockEditor block={block} onChange={(patch) => onChange({ ...block, ...patch })} token={token} disabled={disabled} />;
    case 'faq':
      return <FaqBlockEditor block={block} onChange={(patch) => onChange({ ...block, ...patch })} disabled={disabled} />;
    case 'hub':
      return <HubBlockEditor block={block} onChange={(patch) => onChange({ ...block, ...patch })} disabled={disabled} />;
    case 'video':
      return <VideoBlockEditor block={block} onChange={(patch) => onChange({ ...block, ...patch })} disabled={disabled} />;
    case 'table':
      return <TableBlockEditor block={block} onChange={(patch) => onChange({ ...block, ...patch })} disabled={disabled} />;
    case 'imageText':
      return <ImageTextBlockEditor block={block} onChange={(patch) => onChange({ ...block, ...patch })} token={token} disabled={disabled} />;
    case 'steps':
      return <StepsBlockEditor block={block} onChange={(patch) => onChange({ ...block, ...patch })} token={token} disabled={disabled} />;
    case 'profile':
      return <ProfileBlockEditor block={block} onChange={(patch) => onChange({ ...block, ...patch })} token={token} disabled={disabled} />;
    case 'listings':
      return <ListingsBlockEditor block={block} onChange={(patch) => onChange({ ...block, ...patch })} disabled={disabled} />;
    default:
      return assertUnreachable(block);
  }
}

export function BlockEditorRow({
  block,
  isFirst,
  isLast,
  onChange,
  onMoveUp,
  onMoveDown,
  onDelete,
  token,
  disabled,
}: {
  block: Block;
  isFirst: boolean;
  isLast: boolean;
  onChange: (block: Block) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  token: string;
  disabled?: boolean;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const meta = BLOCK_TYPE_META[block.type];
  const Icon = meta.icon;

  function handleDeleteClick() {
    if (blockHasContent(block) && !confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    onDelete();
  }

  return (
    <div className="rounded-md border bg-background" data-testid={`block-row-${block.type}`}>
      <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-2">
        <div className="flex shrink-0 flex-col">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={disabled || isFirst}
            className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Subir"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={disabled || isLast}
            className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
            title="Bajar"
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
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="p-3">{renderEditor(block, onChange, token, disabled)}</div>
    </div>
  );
}
