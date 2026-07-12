'use client';

import { useRef, useState } from 'react';
import { AlertCircle, Loader2, Upload } from 'lucide-react';
import type { StepsBlock, StepItem } from '@/types/blocks';
import { uploadBlockImage } from '@/lib/api/blog-admin';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { SubItemList } from '../SubItemList';
import { inputCls, textareaCls, labelCls, errorCls } from './shared';

// Subcomponente con estado propio de subida (uploading/error) — cada ítem de
// la lista necesita el suyo, no uno compartido por todo el bloque. Mismo
// molde de botón que ImageBlockEditor, solo que la imagen es opcional aquí.
function StepItemFields({
  item,
  onItemChange,
  token,
  disabled,
}: {
  item: StepItem;
  onItemChange: (patch: Partial<StepItem>) => void;
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
      onItemChange({ image: url });
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Error al subir la imagen');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={item.title}
        onChange={(e) => onItemChange({ title: e.target.value })}
        className={inputCls}
        disabled={disabled}
        placeholder="Título del paso"
      />
      <textarea
        value={item.description}
        onChange={(e) => onItemChange({ description: e.target.value })}
        className={textareaCls}
        rows={2}
        disabled={disabled}
        placeholder="Descripción"
      />
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
              {item.image ? 'Cambiar imagen' : 'Añadir imagen (opcional)'}
            </>
          )}
        </Button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
        {item.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.image} alt="Preview" className="h-10 w-10 rounded object-cover" />
        )}
      </div>
      {uploadError && (
        <p className={errorCls}>
          <AlertCircle className="h-3 w-3 shrink-0" />
          {uploadError}
        </p>
      )}
    </div>
  );
}

// Mismo molde de array repetible que FaqBlockEditor/HubBlockEditor (R2) —
// reutiliza SubItemList tal cual, sin generalizarlo (ya era genérico).
export function StepsBlockEditor({
  block,
  onChange,
  token,
  disabled,
}: {
  block: StepsBlock;
  onChange: (patch: Partial<StepsBlock>) => void;
  token: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Título de la sección (opcional)</label>
        <input
          type="text"
          value={block.title ?? ''}
          onChange={(e) => onChange({ title: e.target.value || undefined })}
          className={inputCls}
          disabled={disabled}
          placeholder="p.ej. Cómo funciona"
        />
      </div>

      <SubItemList<StepItem>
        items={block.items}
        onChange={(items) => onChange({ items })}
        createItem={() => ({ title: '', description: '' })}
        addLabel="Añadir paso"
        disabled={disabled}
        renderItem={(item, onItemChange) => (
          <StepItemFields item={item} onItemChange={onItemChange} token={token} disabled={disabled} />
        )}
      />
    </div>
  );
}
