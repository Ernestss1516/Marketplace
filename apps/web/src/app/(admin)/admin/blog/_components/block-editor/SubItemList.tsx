'use client';

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

// Patrón compartido "lista repetible de sub-ítems" — extraído para no
// duplicarlo entre faq (items: {question,answer}[]) y hub (links:
// {label,href,description?}[]), los dos únicos bloques con arrays de
// objetos editables. Mismo molde de flechas ↑↓ que el resto del editor
// (deshabilitadas en extremos, swap en cliente) — sin drag&drop.
interface SubItemListProps<T> {
  items: T[];
  onChange: (items: T[]) => void;
  createItem: () => T;
  renderItem: (item: T, onItemChange: (patch: Partial<T>) => void) => React.ReactNode;
  addLabel: string;
  // El backend exige ArrayMinSize(1) en faq.items/hub.links — no se puede
  // bajar de 1 sub-ítem, así que "quitar" se deshabilita en ese caso en vez
  // de dejar que el guardado falle con un 400 evitable.
  minItems?: number;
  disabled?: boolean;
}

export function SubItemList<T>({
  items,
  onChange,
  createItem,
  renderItem,
  addLabel,
  minItems = 1,
  disabled,
}: SubItemListProps<T>) {
  function updateItem(index: number, patch: Partial<T>) {
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function removeItem(index: number) {
    onChange(items.filter((_, i) => i !== index));
  }

  function addItem() {
    onChange([...items, createItem()]);
  }

  function moveItem(index: number, dir: 'up' | 'down') {
    const targetIndex = dir === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="flex gap-2 rounded-md border bg-muted/10 p-3">
          <div className="flex shrink-0 flex-col">
            <button
              type="button"
              onClick={() => moveItem(index, 'up')}
              disabled={disabled || index === 0}
              className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
              title="Subir"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => moveItem(index, 'down')}
              disabled={disabled || index === items.length - 1}
              className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
              title="Bajar"
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          <div className="min-w-0 flex-1">{renderItem(item, (patch) => updateItem(index, patch))}</div>

          <button
            type="button"
            onClick={() => removeItem(index)}
            disabled={disabled || items.length <= minItems}
            className="h-6 w-6 shrink-0 self-start text-muted-foreground hover:text-destructive disabled:opacity-30"
            title={items.length <= minItems ? `Debe haber al menos ${minItems}` : 'Quitar'}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}

      <Button type="button" variant="outline" size="sm" onClick={addItem} disabled={disabled}>
        <Plus className="mr-1 h-3 w-3" />
        {addLabel}
      </Button>
    </div>
  );
}
