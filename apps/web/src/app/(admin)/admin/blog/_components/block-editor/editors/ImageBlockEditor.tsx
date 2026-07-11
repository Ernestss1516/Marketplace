'use client';

import { useRef, useState } from 'react';
import { AlertCircle, Loader2, Upload } from 'lucide-react';
import type { ImageBlock, ImagePosition } from '@/types/blocks';
import { uploadBlockImage } from '@/lib/api/blog-admin';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { inputCls, labelCls, errorCls } from './shared';

const POSITION_OPTIONS: { value: ImagePosition; label: string }[] = [
  { value: 'left', label: 'Izquierda' },
  { value: 'center', label: 'Centro' },
  { value: 'right', label: 'Derecha' },
  { value: 'full', label: 'Ancho completo' },
];

// Upload-only, sin URL externa (mismo criterio que coverUrl) — molde
// sponsored-ads vía uploadBlockImage() → POST /admin/blog/upload-image.
export function ImageBlockEditor({
  block,
  onChange,
  token,
  disabled,
}: {
  block: ImageBlock;
  onChange: (patch: Partial<ImageBlock>) => void;
  token: string;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const { url } = await uploadBlockImage(file, token);
      onChange({ url });
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Error al subir la imagen');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Imagen *</label>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={disabled || uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Subiendo…
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                {block.url ? 'Cambiar imagen' : 'Subir imagen'}
              </>
            )}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
            data-testid="block-image-input"
          />
        </div>
        {uploadError && (
          <p className={errorCls}>
            <AlertCircle className="h-3 w-3 shrink-0" />
            {uploadError}
          </p>
        )}
        {block.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={block.url}
            alt="Preview"
            className="mt-1 h-28 w-auto rounded-md border object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Texto alternativo *</label>
        <input
          type="text"
          value={block.alt}
          onChange={(e) => onChange({ alt: e.target.value })}
          className={inputCls}
          disabled={disabled}
          placeholder="Describe la imagen (accesibilidad y SEO)"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Pie de foto (opcional)</label>
        <input
          type="text"
          value={block.caption ?? ''}
          onChange={(e) => onChange({ caption: e.target.value || undefined })}
          className={inputCls}
          disabled={disabled}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Posición</label>
          <select
            value={block.position ?? 'center'}
            onChange={(e) => onChange({ position: e.target.value as ImagePosition })}
            className={inputCls}
            disabled={disabled}
          >
            {POSITION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Ancho % (opcional)</label>
          <input
            type="number"
            min={1}
            max={100}
            value={block.width ?? ''}
            onChange={(e) => onChange({ width: e.target.value ? Number(e.target.value) : undefined })}
            className={inputCls}
            disabled={disabled}
            placeholder="100"
          />
        </div>
      </div>
    </div>
  );
}
