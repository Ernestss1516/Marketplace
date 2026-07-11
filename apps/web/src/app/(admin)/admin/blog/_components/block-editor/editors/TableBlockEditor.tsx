import { Plus, Trash2 } from 'lucide-react';
import type { TableBlock } from '@/types/blocks';
import { Button } from '@/components/ui/button';
import { inputCls } from './shared';

// El bloque más caro del editor: grid dinámico. La invariante
// `rows[i].length === headers.length` (exigida por el backend en
// BlogService.assertTableBlocksValid) se mantiene POR CONSTRUCCIÓN aquí —
// añadir/quitar columna siempre toca `headers` Y todas las filas a la vez en
// la misma llamada a onChange, así que nunca existe un estado intermedio
// inconsistente que pueda llegar a guardarse.
export function TableBlockEditor({
  block,
  onChange,
  disabled,
}: {
  block: TableBlock;
  onChange: (patch: Partial<TableBlock>) => void;
  disabled?: boolean;
}) {
  function updateHeader(index: number, value: string) {
    onChange({ headers: block.headers.map((h, i) => (i === index ? value : h)) });
  }

  function addColumn() {
    onChange({
      headers: [...block.headers, `Columna ${block.headers.length + 1}`],
      rows: block.rows.map((row) => [...row, '']),
    });
  }

  function removeColumn(index: number) {
    if (block.headers.length <= 1) return;
    onChange({
      headers: block.headers.filter((_, i) => i !== index),
      rows: block.rows.map((row) => row.filter((_, i) => i !== index)),
    });
  }

  function addRow() {
    onChange({ rows: [...block.rows, block.headers.map(() => '')] });
  }

  function removeRow(rowIndex: number) {
    onChange({ rows: block.rows.filter((_, i) => i !== rowIndex) });
  }

  function updateCell(rowIndex: number, colIndex: number, value: string) {
    onChange({
      rows: block.rows.map((row, ri) =>
        ri === rowIndex ? row.map((cell, ci) => (ci === colIndex ? value : cell)) : row,
      ),
    });
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {block.headers.map((header, colIndex) => (
                <th key={colIndex} className="min-w-[120px] border-b p-1.5">
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={header}
                      onChange={(e) => updateHeader(colIndex, e.target.value)}
                      className={inputCls}
                      disabled={disabled}
                      placeholder={`Columna ${colIndex + 1}`}
                    />
                    <button
                      type="button"
                      onClick={() => removeColumn(colIndex)}
                      disabled={disabled || block.headers.length <= 1}
                      className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-30"
                      title={block.headers.length <= 1 ? 'Debe haber al menos 1 columna' : 'Quitar columna'}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </th>
              ))}
              <th className="p-1.5">
                <Button type="button" size="sm" variant="outline" onClick={addColumn} disabled={disabled}>
                  <Plus className="mr-1 h-3 w-3" />
                  Columna
                </Button>
              </th>
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, colIndex) => (
                  <td key={colIndex} className="border-b p-1.5">
                    <input
                      type="text"
                      value={cell}
                      onChange={(e) => updateCell(rowIndex, colIndex, e.target.value)}
                      className={inputCls}
                      disabled={disabled}
                    />
                  </td>
                ))}
                <td className="border-b p-1.5">
                  <button
                    type="button"
                    onClick={() => removeRow(rowIndex)}
                    disabled={disabled}
                    className="text-muted-foreground hover:text-destructive"
                    title="Quitar fila"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={addRow} disabled={disabled}>
        <Plus className="mr-1 h-3 w-3" />
        Añadir fila
      </Button>
    </div>
  );
}
