'use client';

import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { Block } from '@/types/blocks';
import { BlockRenderer } from '@/components/blocks/BlockRenderer';
import { search, type SearchResponse } from '@/lib/api/busqueda';
import { BlockEditorRow } from './BlockEditorRow';
import { BlockTypePicker } from './BlockTypePicker';
import { createDefaultBlock, type BlockType } from './blockDefaults';

// Contenedor del editor de bloques — sustituye al MarkdownEditor de
// Post.body. El estado es simplemente el array `blocks`: añadir/reordenar/
// borrar son manipulaciones del array en cliente (sin transacción
// multi-fila, a diferencia de categorías/footer — no son filas separadas,
// es un único array Json en una fila `Post`). El guardado real (POST/PATCH
// del array completo) lo dispara el submit de PostForm, no este componente.
export function BlockEditor({
  blocks,
  onChange,
  token,
  disabled,
}: {
  blocks: Block[];
  onChange: (blocks: Block[]) => void;
  token: string;
  disabled?: boolean;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const [listingsData, setListingsData] = useState<Record<string, SearchResponse>>({});

  // El preview reusa el mismo BlockRenderer que el sitio público, pero
  // BlockRenderer es síncrono — así que el bloque `listings` necesita sus
  // datos ya resueltos (ver ListingsBlockRenderer). En público se resuelven
  // por SSR (lib/blocks/resolve-listings.ts); aquí, en un efecto cliente
  // equivalente, misma fuente (search()). Clave derivada (no `blocks`
  // completo) para no relanzar la consulta en cada tecla de campos
  // ajenos al bloque `listings`.
  const listingsKey = blocks
    .filter((b): b is Extract<Block, { type: 'listings' }> => b.type === 'listings')
    .map((b) => `${b.id}:${b.categorySlug}:${b.limit}:${b.sort ?? ''}`)
    .join('|');

  useEffect(() => {
    if (!showPreview) return;
    const listingsBlocks = blocks.filter(
      (b): b is Extract<Block, { type: 'listings' }> => b.type === 'listings' && !!b.categorySlug,
    );
    if (listingsBlocks.length === 0) {
      setListingsData({});
      return;
    }
    let cancelled = false;
    Promise.all(
      listingsBlocks.map(async (b) => {
        try {
          const result = await search({
            category: b.categorySlug,
            hitsPerPage: b.limit,
            sort: b.sort === 'featured' ? 'sortDate:desc' : 'publishedAt:desc',
          });
          return [b.id, result] as const;
        } catch {
          return [b.id, undefined] as const;
        }
      }),
    ).then((entries) => {
      if (cancelled) return;
      const resolved = entries.filter((e): e is [string, SearchResponse] => e[1] !== undefined);
      setListingsData(Object.fromEntries(resolved));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showPreview, listingsKey]);

  function updateBlock(index: number, block: Block) {
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

  function addBlock(type: BlockType) {
    onChange([...blocks, createDefaultBlock(type)]);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">Contenido</p>
        {blocks.length > 0 && (
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {showPreview ? (
              <>
                <EyeOff className="h-3 w-3" /> Ocultar preview
              </>
            ) : (
              <>
                <Eye className="h-3 w-3" /> Ver preview
              </>
            )}
          </button>
        )}
      </div>

      {showPreview ? (
        <div className="rounded-md border bg-muted/20 p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Preview — así se ve publicado
          </p>
          <BlockRenderer blocks={blocks} listingsData={listingsData} />
        </div>
      ) : (
        <>
          {blocks.length === 0 && (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              Sin contenido todavía. Añade el primer bloque abajo.
            </p>
          )}

          <div className="space-y-2">
            {blocks.map((block, index) => (
              <BlockEditorRow
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

          <BlockTypePicker onPick={addBlock} disabled={disabled} />
        </>
      )}
    </div>
  );
}
