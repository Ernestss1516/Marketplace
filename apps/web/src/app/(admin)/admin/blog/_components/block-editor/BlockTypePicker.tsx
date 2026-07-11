'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { BLOCK_TYPE_META, BLOCK_TYPE_ORDER, type BlockType } from './blockDefaults';

// Panel de tarjetas (no un <select>/dropdown compacto): cada tipo necesita
// espacio para su nombre Y su descripción en lenguaje claro — es el
// requisito central de "usable por un admin no técnico", que un dropdown de
// una sola línea no puede transmitir.
export function BlockTypePicker({
  onPick,
  disabled,
}: {
  onPick: (type: BlockType) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)} disabled={disabled}>
        <Plus className="mr-1 h-4 w-4" />
        Añadir bloque
      </Button>
    );
  }

  return (
    <div className="rounded-md border bg-muted/10 p-3" data-testid="block-type-picker">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">¿Qué quieres añadir?</p>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Cancelar
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {BLOCK_TYPE_ORDER.map((type) => {
          const meta = BLOCK_TYPE_META[type];
          const Icon = meta.icon;
          return (
            <button
              key={type}
              type="button"
              onClick={() => {
                onPick(type);
                setOpen(false);
              }}
              className="flex items-start gap-2 rounded-md border bg-background p-3 text-left transition-colors hover:bg-muted/50"
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>
                <span className="block text-sm font-medium">{meta.label}</span>
                <span className="block text-xs text-muted-foreground">{meta.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
