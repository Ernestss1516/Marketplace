'use client';

import { useRef, useState } from 'react';
import { AlertCircle, Loader2, Upload, X } from 'lucide-react';
import type { ProfileBlock, ProfileAttribute } from '@/types/blocks';
import { uploadBlockImage } from '@/lib/api/blog-admin';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { SubItemList } from '../SubItemList';
import { inputCls, labelCls, errorCls } from './shared';

export function ProfileBlockEditor({
  block,
  onChange,
  token,
  disabled,
}: {
  block: ProfileBlock;
  onChange: (patch: Partial<ProfileBlock>) => void;
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
      onChange({ image: { url, alt: block.image?.alt ?? block.name ?? '' } });
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
        <label className={labelCls}>Foto (opcional)</label>
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
                {block.image ? 'Cambiar foto' : 'Subir foto'}
              </>
            )}
          </Button>
          {block.image && (
            <button
              type="button"
              onClick={() => onChange({ image: undefined })}
              disabled={disabled}
              className="text-muted-foreground hover:text-destructive"
              title="Quitar foto"
            >
              <X className="h-4 w-4" />
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        </div>
        {uploadError && (
          <p className={errorCls}>
            <AlertCircle className="h-3 w-3 shrink-0" />
            {uploadError}
          </p>
        )}
        {block.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={block.image.url} alt="Preview" className="mt-1 h-20 w-20 rounded-full border object-cover" />
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Nombre (opcional)</label>
        <input
          type="text"
          value={block.name ?? ''}
          onChange={(e) => onChange({ name: e.target.value || undefined })}
          className={inputCls}
          disabled={disabled}
          placeholder="p.ej. Ana García"
        />
      </div>

      <SubItemList<ProfileAttribute>
        items={block.attributes}
        onChange={(attributes) => onChange({ attributes })}
        createItem={() => ({ label: '', value: '' })}
        addLabel="Añadir atributo"
        disabled={disabled}
        renderItem={(item, onItemChange) => (
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={item.label}
              onChange={(e) => onItemChange({ label: e.target.value })}
              className={inputCls}
              disabled={disabled}
              placeholder="Etiqueta (p.ej. Experiencia)"
            />
            <input
              type="text"
              value={item.value}
              onChange={(e) => onItemChange({ value: e.target.value })}
              className={inputCls}
              disabled={disabled}
              placeholder="Valor (p.ej. 10 años)"
            />
          </div>
        )}
      />
    </div>
  );
}
