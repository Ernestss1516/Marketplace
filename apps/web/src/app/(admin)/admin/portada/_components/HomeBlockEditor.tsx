'use client';

import type { HomeBlock } from '@/types/home-blocks';
import { HomeBlockEditorRow } from './HomeBlockEditorRow';
import { HomeBlockTypePicker } from './HomeBlockTypePicker';
import { createDefaultHomeBlock, type HomeBlockType } from './homeBlockDefaults';

/**
 * Editor del array de bloques de portada. Molde literal de `BlockEditor.tsx` del
 * blog: el estado ES el array, y añadir/mover/borrar son manipulaciones puras de
 * array en cliente — sin transacción multi-fila, porque los bloques no son filas
 * sino un único Json de una fila.
 *
 * No guarda nada: el guardado (un solo PATCH con la config entera) lo dispara el
 * botón de la página, igual que el submit de `PostForm` en el blog.
 *
 * A diferencia del blog, aquí NO hay preview propio: el preview de la portada
 * incluye el hero, que no es un bloque, así que vive en la página y abarca las
 * dos zonas (docs/diseno-portada.md §6).
 */
export function HomeBlockEditor({
  blocks,
  token,
  onChange,
  disabled,
}: {
  blocks: HomeBlock[];
  token?: string;
  onChange: (blocks: HomeBlock[]) => void;
  disabled?: boolean;
}) {
  function updateBlock(index: number, block: HomeBlock) {
    onChange(blocks.map((b, i) => (i === index ? block : b)));
  }

  function moveBlock(index: number, dir: 'up' | 'down') {
    const targetIndex = dir === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    onChange(next);
  }

  function deleteBlock(index: number) {
    onChange(blocks.filter((_, i) => i !== index));
  }

  function addBlock(type: HomeBlockType) {
    onChange([...blocks, createDefaultHomeBlock(type)]);
  }

  return (
    <div className="space-y-3">
      {blocks.length === 0 && (
        <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
          La portada no tiene ningún bloque. El titular sigue mostrándose; todo lo demás se añade
          aquí.
        </p>
      )}

      <div className="space-y-2" data-testid="home-blocks-list">
        {blocks.map((block, index) => (
          <HomeBlockEditorRow
            key={block.id}
            block={block}
            isFirst={index === 0}
            isLast={index === blocks.length - 1}
            onChange={(updated) => updateBlock(index, updated)}
            onMoveUp={() => moveBlock(index, 'up')}
            onMoveDown={() => moveBlock(index, 'down')}
            onDelete={() => deleteBlock(index)}
            token={token}
            disabled={disabled}
          />
        ))}
      </div>

      <HomeBlockTypePicker onPick={addBlock} disabled={disabled} />
    </div>
  );
}
