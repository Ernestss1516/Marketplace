'use client';

import { useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import { isSafeContentUrl, SAFE_URL_HINT } from '@/lib/blocks/validation';
import { uploadHomepageImage } from '@/lib/api/homepage-admin';
import {
  GRID_COLUMNS,
  type GridColumns,
  type HomeGridBlock,
  type HomeGridCell,
} from '@/types/home-blocks';
import { IconPicker } from './IconPicker';
import { inputCls, labelCls, errorCls, hintCls } from './shared';

const COLUMN_LABELS: Record<GridColumns, string> = {
  1: '1 por fila',
  2: '2 por fila',
  3: '3 por fila',
  4: '4 por fila',
  6: '6 por fila',
};

/**
 * Qué lleva la tarjeta. Desde el ajuste 6 **no hay opción «ninguna»**: `media` es obligatorio
 * y ofrecerla sería ofrecer un guardado que el backend rechaza.
 */
type MediaKind = 'icon' | 'image';

/**
 * `''` para una tarjeta ANTIGUA sin media — el `<select>` se queda sin elegir y, al lado, un
 * aviso. Es la única forma de que una portada guardada antes del ajuste 6 se pueda arreglar:
 * si el desplegable se autoseleccionara a «icono», el editor estaría inventando un dato que
 * nadie eligió, y bastaría con guardar sin mirar para que se colara.
 *
 * El tipo dice que `media` existe siempre; esto es justo el caso en que la fila no cumple el
 * tipo, así que se lee con cuidado y no se confía en el compilador.
 */
function mediaKindOf(cell: HomeGridCell): MediaKind | '' {
  return cell.media?.kind ?? '';
}

export function GridHomeBlockEditor({
  block,
  onChange,
  token,
  disabled,
}: {
  block: HomeGridBlock;
  onChange: (patch: Partial<HomeGridBlock>) => void;
  token?: string;
  disabled?: boolean;
}) {
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  function updateCell(index: number, patch: Partial<HomeGridCell>) {
    onChange({ items: block.items.map((c, i) => (i === index ? { ...c, ...patch } : c)) });
  }

  function moveCell(index: number, dir: 'up' | 'down') {
    const target = dir === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= block.items.length) return;
    const next = [...block.items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ items: next });
  }

  function setMediaKind(index: number, kind: MediaKind) {
    if (kind === 'icon') return updateCell(index, { media: { kind: 'icon', name: 'star' } });
    // Al pasar a imagen se deja el hueco: la URL la pone el upload, nunca se
    // escribe a mano (@IsOwnStorageUrl la rechazaría).
    return updateCell(index, { media: { kind: 'image', url: '', alt: '' } });
  }

  async function handleFile(index: number, file: File) {
    if (!token) return;
    setUploadingIdx(index);
    setUploadError(null);
    try {
      const { url } = await uploadHomepageImage(file, token);
      const cell = block.items[index];
      const alt = cell.media?.kind === 'image' ? cell.media.alt : '';
      updateCell(index, { media: { kind: 'image', url, alt } });
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Error al subir la imagen');
    } finally {
      setUploadingIdx(null);
      const input = fileRefs.current[index];
      if (input) input.value = '';
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Título de la sección (opcional)</label>
          <input
            type="text"
            value={block.title ?? ''}
            onChange={(e) => onChange({ title: e.target.value || undefined })}
            className={inputCls}
            disabled={disabled}
            placeholder="p.ej. Por qué fiarte"
            data-testid="grid-title"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={labelCls}>Tarjetas por fila</label>
          <select
            value={block.columns}
            onChange={(e) => onChange({ columns: Number(e.target.value) as GridColumns })}
            className={inputCls}
            disabled={disabled}
            data-testid="grid-columns"
          >
            {GRID_COLUMNS.map((n) => (
              <option key={n} value={n}>
                {COLUMN_LABELS[n]}
              </option>
            ))}
          </select>
          <p className={hintCls}>En móvil se reagrupan solas para que quepan.</p>
        </div>
      </div>

      <div className="space-y-2" data-testid="grid-cells">
        {block.items.map((cell, index) => {
          const kind = mediaKindOf(cell);
          const hrefError = cell.href && !isSafeContentUrl(cell.href);

          return (
            <div key={index} className="flex gap-2 rounded-md border bg-muted/10 p-3">
              <div className="flex shrink-0 flex-col">
                <button
                  type="button"
                  onClick={() => moveCell(index, 'up')}
                  disabled={disabled || index === 0}
                  className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  title="Subir"
                  aria-label={`Subir tarjeta ${index + 1}`}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => moveCell(index, 'down')}
                  disabled={disabled || index === block.items.length - 1}
                  className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
                  title="Bajar"
                  aria-label={`Bajar tarjeta ${index + 1}`}
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              </div>

              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-col gap-1">
                  <label className={labelCls}>Texto (opcional)</label>
                  <input
                    type="text"
                    value={cell.title ?? ''}
                    // `|| undefined`: una cadena vacía se guarda como AUSENTE, no como "".
                    // El DTO rechaza `""` a propósito (@IsNotEmpty bajo @IsOptional), y así
                    // borrar el texto a mano deja la tarjeta sin título en vez de dar un 400.
                    onChange={(e) => updateCell(index, { title: e.target.value || undefined })}
                    className={inputCls}
                    disabled={disabled}
                    placeholder="p.ej. Anuncios moderados"
                    data-testid={`grid-cell-title-${index}`}
                  />
                  <p className={hintCls}>Puedes dejarlo vacío: una tarjeta puede ser sólo la imagen.</p>
                </div>

                <div className="flex flex-col gap-1">
                  <label className={labelCls}>Descripción (opcional)</label>
                  <input
                    type="text"
                    value={cell.description ?? ''}
                    onChange={(e) => updateCell(index, { description: e.target.value || undefined })}
                    className={inputCls}
                    disabled={disabled}
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className={labelCls}>Enlace (opcional)</label>
                  <input
                    type="text"
                    value={cell.href ?? ''}
                    onChange={(e) => updateCell(index, { href: e.target.value || undefined })}
                    className={inputCls}
                    disabled={disabled}
                    placeholder="/busqueda o https://..."
                    data-testid={`grid-cell-href-${index}`}
                  />
                  {hrefError ? (
                    <p className={errorCls} data-testid={`grid-cell-href-error-${index}`}>
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      {SAFE_URL_HINT}
                    </p>
                  ) : (
                    <p className={hintCls}>Sin enlace, la tarjeta es solo informativa.</p>
                  )}
                </div>

                <div className="flex flex-col gap-1">
                  <label className={labelCls}>Imagen o icono *</label>
                  <select
                    value={kind}
                    onChange={(e) => setMediaKind(index, e.target.value as MediaKind)}
                    className={inputCls}
                    disabled={disabled}
                    data-testid={`grid-cell-media-kind-${index}`}
                  >
                    {/* Sólo para una tarjeta ANTIGUA que se guardó sin media: da la opción
                        vacía donde pararse. No es elegible — `disabled` — porque guardar así
                        daría un 400. */}
                    {kind === '' && (
                      <option value="" disabled>
                        — elige imagen o icono —
                      </option>
                    )}
                    <option value="icon">Un icono</option>
                    <option value="image">Una imagen</option>
                  </select>
                  {kind === '' && (
                    <p className={errorCls} data-testid={`grid-cell-media-falta-${index}`}>
                      <AlertCircle className="h-3 w-3 shrink-0" />
                      Esta tarjeta se guardó sin imagen ni icono. Elige una para poder guardar.
                    </p>
                  )}
                </div>

                {cell.media?.kind === 'icon' && (
                  <IconPicker
                    value={cell.media.name}
                    allowNone={false}
                    label="Elige el icono"
                    disabled={disabled}
                    testId={`grid-cell-icons-${index}`}
                    onChange={(name) =>
                      name && updateCell(index, { media: { kind: 'icon', name } })
                    }
                  />
                )}

                {cell.media?.kind === 'image' && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => fileRefs.current[index]?.click()}
                        disabled={disabled || uploadingIdx === index}
                        data-testid={`grid-cell-upload-${index}`}
                      >
                        {uploadingIdx === index ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Subiendo…
                          </>
                        ) : (
                          <>
                            <Upload className="mr-2 h-4 w-4" />
                            {cell.media.url ? 'Cambiar imagen' : 'Subir imagen'}
                          </>
                        )}
                      </Button>
                      <input
                        ref={(el) => {
                          fileRefs.current[index] = el;
                        }}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleFile(index, file);
                        }}
                        data-testid={`grid-cell-file-${index}`}
                      />
                      {cell.media.url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={cell.media.url}
                          alt="Vista previa"
                          className="h-12 w-12 rounded border object-cover"
                        />
                      )}
                    </div>

                    {uploadError && uploadingIdx === null && (
                      <p className={errorCls}>
                        <AlertCircle className="h-3 w-3 shrink-0" />
                        {uploadError}
                      </p>
                    )}

                    <div className="flex flex-col gap-1">
                      <label className={labelCls}>Texto alternativo *</label>
                      <input
                        type="text"
                        value={cell.media.alt}
                        onChange={(e) =>
                          updateCell(index, {
                            media: { kind: 'image', url: (cell.media as { url: string }).url, alt: e.target.value },
                          })
                        }
                        className={inputCls}
                        disabled={disabled}
                        placeholder="Describe la imagen (accesibilidad y SEO)"
                        data-testid={`grid-cell-alt-${index}`}
                      />
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => onChange({ items: block.items.filter((_, i) => i !== index) })}
                // El backend exige al menos una tarjeta (ArrayMinSize): mejor
                // deshabilitar que dejar que el guardado falle con un 400.
                disabled={disabled || block.items.length <= 1}
                className="h-6 w-6 shrink-0 self-start text-muted-foreground hover:text-destructive disabled:opacity-30"
                title={block.items.length <= 1 ? 'Debe quedar al menos una tarjeta' : 'Quitar'}
                aria-label={`Quitar tarjeta ${index + 1}`}
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        // Nace CON icono: desde el ajuste 6 `media` es obligatorio, y una tarjeta que
        // arranca inválida obligaría a descubrirlo con un 400 al guardar.
        onClick={() =>
          onChange({ items: [...block.items, { media: { kind: 'icon', name: 'star' } }] })
        }
        disabled={disabled}
        data-testid="grid-add-cell"
      >
        <Plus className="mr-1 h-3 w-3" />
        Añadir tarjeta
      </Button>
    </div>
  );
}
