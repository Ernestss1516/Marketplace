'use client';

import { useRef, useState } from 'react';
import { AlertCircle, Loader2, Upload } from 'lucide-react';
import type { ImageTextBlock, ImageTextLayout } from '@/types/blocks';
import { uploadBlockImage } from '@/lib/api/blog-admin';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import MarkdownEditorClient from '../../MarkdownEditorClient';
import { inputCls, labelCls, errorCls } from './shared';

const LAYOUT_OPTIONS: { value: ImageTextLayout; label: string }[] = [
  { value: 'imageLeft', label: 'Imagen a la izquierda' },
  { value: 'imageRight', label: 'Imagen a la derecha' },
];

// Composición pura: la parte de imagen reusa uploadBlockImage() (mismo
// endpoint que el bloque `image`, molde sponsored-ads); la parte de texto
// reusa MarkdownEditorClient tal cual (mismo componente que el bloque
// `text`). Cero validación/lógica nueva, solo reagrupa.
export function ImageTextBlockEditor({
  block,
  onChange,
  token,
  disabled,
}: {
  block: ImageTextBlock;
  onChange: (patch: Partial<ImageTextBlock>) => void;
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
      onChange({ image: { ...block.image, url } });
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
                {block.image.url ? 'Cambiar imagen' : 'Subir imagen'}
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
        {block.image.url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={block.image.url}
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
          value={block.image.alt}
          onChange={(e) => onChange({ image: { ...block.image, alt: e.target.value } })}
          className={inputCls}
          disabled={disabled}
          placeholder="Describe la imagen (accesibilidad y SEO)"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Pie de foto (opcional)</label>
        <input
          type="text"
          value={block.image.caption ?? ''}
          onChange={(e) => onChange({ image: { ...block.image, caption: e.target.value || undefined } })}
          className={inputCls}
          disabled={disabled}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Posición de la imagen</label>
        <select
          value={block.layout}
          onChange={(e) => onChange({ layout: e.target.value as ImageTextLayout })}
          className={inputCls}
          disabled={disabled}
        >
          {LAYOUT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Texto *</label>
        <MarkdownEditorClient
          value={block.markdown}
          onChange={(markdown) => onChange({ markdown })}
          token={token}
          disabled={disabled}
        />
      </div>
    </div>
  );
}
