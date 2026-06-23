'use client';

import { useRef } from 'react';
import { X, ArrowUp, ArrowDown, ImagePlus, AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { uploadMedia } from '@/lib/api/media';
import { generateId } from '@/lib/utils';

export interface UploadedImage {
  localId: string;
  id?: string;
  url?: string;
  previewUrl: string;
  uploading: boolean;
  error?: string;
}

interface StepFotosProps {
  images: UploadedImage[];
  token: string;
  onChange: (updater: UploadedImage[] | ((prev: UploadedImage[]) => UploadedImage[])) => void;
  errors: Record<string, string>;
}

const MAX_PHOTOS = 15;

export function StepFotos({ images, token, onChange, errors }: StepFotosProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const validImages = images.filter((img) => !img.error);
  const remaining = MAX_PHOTOS - validImages.length;

  async function handleFiles(fileList: FileList) {
    const files = Array.from(fileList).slice(0, remaining);
    if (files.length === 0) return;

    const newEntries: UploadedImage[] = files.map((file) => ({
      localId: generateId(),
      previewUrl: URL.createObjectURL(file),
      uploading: true,
    }));

    onChange((prev) => [...prev, ...newEntries]);

    // Upload each file independently; update state as each finishes
    await Promise.allSettled(
      files.map(async (file, i) => {
        const { localId } = newEntries[i];
        try {
          const result = await uploadMedia(file, token);
          onChange((prev) =>
            prev.map((img) =>
              img.localId === localId
                ? { ...img, id: result.id, url: result.url, uploading: false }
                : img,
            ),
          );
        } catch {
          onChange((prev) =>
            prev.map((img) =>
              img.localId === localId
                ? { ...img, error: 'Error al subir', uploading: false }
                : img,
            ),
          );
        }
      }),
    );
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
      // reset so the same file can be re-selected after an error
      e.target.value = '';
    }
  }

  function remove(localId: string) {
    onChange((prev) => {
      const img = prev.find((i) => i.localId === localId);
      if (img?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(img.previewUrl);
      return prev.filter((i) => i.localId !== localId);
    });
  }

  function move(localId: string, dir: -1 | 1) {
    onChange((prev) => {
      const idx = prev.findIndex((i) => i.localId === localId);
      if (idx < 0) return prev;
      const next = [...prev];
      const swap = idx + dir;
      if (swap < 0 || swap >= next.length) return prev;
      [next[idx], next[swap]] = [next[swap], next[idx]];
      return next;
    });
  }

  function retry(localId: string, previewUrl: string) {
    // Re-fetch the blob from the preview URL — only works while blob is alive
    fetch(previewUrl)
      .then((r) => r.blob())
      .then((blob) => {
        const file = new File([blob], 'retry.jpg', { type: blob.type });
        onChange((prev) =>
          prev.map((img) =>
            img.localId === localId ? { ...img, error: undefined, uploading: true } : img,
          ),
        );
        return uploadMedia(file, token).then((result) => {
          onChange((prev) =>
            prev.map((img) =>
              img.localId === localId
                ? { ...img, id: result.id, url: result.url, uploading: false }
                : img,
            ),
          );
        });
      })
      .catch(() => {
        onChange((prev) =>
          prev.map((img) =>
            img.localId === localId
              ? { ...img, error: 'Error al subir', uploading: false }
              : img,
          ),
        );
      });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Fotos</h2>
        <p className="text-sm text-muted-foreground">
          Añade hasta {MAX_PHOTOS} fotos. La primera será la portada. Para publicar se
          necesita al menos 1 foto.
        </p>
      </div>

      {errors.images && (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {errors.images}
        </p>
      )}

      {/* Upload zone */}
      {remaining > 0 && (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            data-testid="foto-input"
            onChange={handleInputChange}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/30 px-6 py-8 text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          >
            <ImagePlus className="h-8 w-8" />
            <span className="text-sm font-medium">
              Añadir fotos ({validImages.length}/{MAX_PHOTOS})
            </span>
            <span className="text-xs">Haz clic para seleccionar</span>
          </button>
        </>
      )}

      {/* Grid of thumbnails */}
      {images.length > 0 && (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
          {images.map((img, idx) => (
            <li key={img.localId} className="relative aspect-square">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.previewUrl}
                alt={`Foto ${idx + 1}`}
                className={[
                  'h-full w-full rounded-lg object-cover',
                  img.error ? 'opacity-50' : '',
                ].join(' ')}
              />

              {/* Overlay: loading */}
              {img.uploading && (
                <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
                  <Loader2 className="h-6 w-6 animate-spin text-white" />
                </div>
              )}

              {/* Overlay: error */}
              {img.error && !img.uploading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 rounded-lg bg-black/50 p-1">
                  <AlertCircle className="h-5 w-5 text-red-400" />
                  <button
                    type="button"
                    onClick={() => retry(img.localId, img.previewUrl)}
                    className="text-xs font-medium text-white underline"
                  >
                    Reintentar
                  </button>
                </div>
              )}

              {/* Controls (only when not uploading/errored) */}
              {!img.uploading && !img.error && (
                <>
                  {/* Cover badge */}
                  {idx === 0 && (
                    <span className="absolute left-1 top-1 rounded bg-primary px-1 py-0.5 text-[10px] font-medium text-primary-foreground">
                      Portada
                    </span>
                  )}

                  {/* Remove */}
                  <button
                    type="button"
                    onClick={() => remove(img.localId)}
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5 text-white hover:bg-black/80"
                    aria-label="Eliminar foto"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>

                  {/* Reorder */}
                  <div className="absolute bottom-1 right-1 flex gap-0.5">
                    {idx > 0 && (
                      <button
                        type="button"
                        onClick={() => move(img.localId, -1)}
                        className="rounded bg-black/60 p-0.5 text-white hover:bg-black/80"
                        aria-label="Mover antes"
                      >
                        <ArrowUp className="h-3 w-3" />
                      </button>
                    )}
                    {idx < images.length - 1 && (
                      <button
                        type="button"
                        onClick={() => move(img.localId, 1)}
                        className="rounded bg-black/60 p-0.5 text-white hover:bg-black/80"
                        aria-label="Mover después"
                      >
                        <ArrowDown className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
