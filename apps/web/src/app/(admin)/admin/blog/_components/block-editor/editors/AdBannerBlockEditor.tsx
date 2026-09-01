'use client';

import { useRef, useState } from 'react';
import { AlertCircle, Loader2, Upload } from 'lucide-react';
import type { AdBannerBlock } from '@/types/blocks';
import { uploadBlockImage } from '@/lib/api/blog-admin';
import { ApiError } from '@/lib/api/client';
import { isSafeContentUrl, SAFE_URL_HINT } from '@/lib/blocks/validation';
import { Button } from '@/components/ui/button';
import { inputCls, labelCls, errorCls, textareaCls } from './shared';

/**
 * El editor del bloque de PUBLICIDAD. Composición de dos editores que ya existen: la subida
 * de imagen de `ImageBlockEditor` (`uploadBlockImage` → `POST /admin/blog/upload-image`,
 * prefijo `blocks/`) y el campo de enlace de `CtaBlockEditor` (validación en vivo con
 * `isSafeContentUrl`, el espejo cliente del validador del backend).
 *
 * SÓLO LA IMAGEN LLEVA ASTERISCO. Los demás campos son opcionales de verdad y se dice cuáles
 * son, en vez de dejar que el editor lo descubra guardando.
 */
export function AdBannerBlockEditor({
  block,
  onChange,
  token,
  disabled,
}: {
  block: AdBannerBlock;
  onChange: (patch: Partial<AdBannerBlock>) => void;
  token: string;
  disabled?: boolean;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const hrefError = Boolean(block.href) && !isSafeContentUrl(block.href!);
  // AVISO, NO ERROR: un botón con texto y sin destino no se pinta, y eso es imposible de
  // adivinar mirando el editor. El esquema no lo rechaza a propósito (ver el DTO) — sería
  // tumbar el guardado del post entero por un bloque a medio rellenar.
  const ctaSinDestino = Boolean(block.ctaLabel) && !block.href;

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
            data-testid="block-adbanner-input"
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
        <label className={labelCls}>Texto alternativo (opcional)</label>
        <input
          type="text"
          value={block.image.alt ?? ''}
          onChange={(e) =>
            onChange({ image: { ...block.image, alt: e.target.value || undefined } })
          }
          className={inputCls}
          disabled={disabled}
          placeholder="Si lo dejas vacío se usa el título, y si no hay, se marca como decorativa"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Título (opcional)</label>
        <input
          type="text"
          value={block.title ?? ''}
          onChange={(e) => onChange({ title: e.target.value || undefined })}
          className={inputCls}
          disabled={disabled}
          data-testid="block-adbanner-title"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Descripción (opcional)</label>
        <textarea
          rows={2}
          value={block.description ?? ''}
          onChange={(e) => onChange({ description: e.target.value || undefined })}
          className={textareaCls}
          disabled={disabled}
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Texto del botón (opcional)</label>
          <input
            type="text"
            value={block.ctaLabel ?? ''}
            onChange={(e) => onChange({ ctaLabel: e.target.value || undefined })}
            className={inputCls}
            disabled={disabled}
            placeholder="p.ej. Ver oferta"
            data-testid="block-adbanner-cta"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Enlace (opcional)</label>
          <input
            type="text"
            value={block.href ?? ''}
            onChange={(e) => onChange({ href: e.target.value || undefined })}
            className={inputCls}
            disabled={disabled}
            placeholder="/publicar o https://..."
            data-testid="block-adbanner-href"
          />
          {hrefError && (
            <p className={errorCls}>
              <AlertCircle className="h-3 w-3 shrink-0" />
              {SAFE_URL_HINT}
            </p>
          )}
        </div>
      </div>

      {ctaSinDestino && (
        <p className={errorCls} data-testid="block-adbanner-aviso-cta">
          <AlertCircle className="h-3 w-3 shrink-0" />
          El botón no se mostrará hasta que le pongas un enlace.
        </p>
      )}

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={block.openInNewTab ?? false}
          onChange={(e) => onChange({ openInNewTab: e.target.checked || undefined })}
          disabled={disabled}
          data-testid="block-adbanner-nueva-pestana"
        />
        Abrir el enlace en una pestaña nueva
      </label>
    </div>
  );
}
