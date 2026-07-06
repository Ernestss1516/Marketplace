'use client';

import { useRef, useState } from 'react';
import { AlertCircle, Eye, EyeOff, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { uploadMedia } from '@/lib/api/media';
import { ApiError } from '@/lib/api/client';
import { MarkdownBody } from '@/components/blog/MarkdownBody';
import MarkdownEditorClient from './MarkdownEditorClient';

export interface PostFormValues {
  title: string;
  slug: string;
  excerpt: string;
  body: string;
  tags: string;
  coverUrl: string;
  metaTitle: string;
  metaDescription: string;
}

export const EMPTY_POST_FORM: PostFormValues = {
  title: '',
  slug: '',
  excerpt: '',
  body: '',
  tags: '',
  coverUrl: '',
  metaTitle: '',
  metaDescription: '',
};

interface PostFormProps {
  values: PostFormValues;
  onChange: (patch: Partial<PostFormValues>) => void;
  onSubmit: () => void;
  submitLabel: string;
  isSubmitting: boolean;
  submitError: string | null;
  token: string;
  showSlugHint?: boolean;
  // Las páginas informativas (type=PAGE) no tienen tags — /admin/paginas pasa false.
  showTagsField?: boolean;
}

export function PostForm({
  values,
  onChange,
  onSubmit,
  submitLabel,
  isSubmitting,
  submitError,
  token,
  showSlugHint = false,
  showTagsField = true,
}: PostFormProps) {
  const [showPreview, setShowPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const { url } = await uploadMedia(file, token);
      onChange({ coverUrl: url });
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : 'Error al subir la imagen');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  const inputCls =
    'w-full rounded-md border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50';
  const textareaCls =
    'w-full resize-y rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50';
  const labelCls = 'text-xs font-medium text-muted-foreground';

  return (
    <div className="space-y-5">
      {/* Title */}
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Título *</label>
        <input
          type="text"
          value={values.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className={inputCls}
          disabled={isSubmitting}
          placeholder="Título del post"
        />
      </div>

      {/* Slug */}
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Slug</label>
        <input
          type="text"
          value={values.slug}
          onChange={(e) => onChange({ slug: e.target.value })}
          className={inputCls}
          disabled={isSubmitting}
          placeholder={showSlugHint ? 'Dejar vacío para generar automáticamente' : undefined}
        />
        {showSlugHint && (
          <p className="text-xs text-muted-foreground">
            Si se deja vacío, el backend lo genera desde el título.
          </p>
        )}
      </div>

      {/* Excerpt */}
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Resumen (excerpt)</label>
        <textarea
          value={values.excerpt}
          onChange={(e) => onChange({ excerpt: e.target.value })}
          className={textareaCls}
          rows={2}
          disabled={isSubmitting}
          placeholder="Breve descripción para el listado y meta description"
        />
      </div>

      {/* Body + Preview toggle */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className={labelCls}>Cuerpo (Markdown GFM)</label>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {showPreview ? (
              <>
                <EyeOff className="h-3 w-3" /> Ocultar preview
              </>
            ) : (
              <>
                <Eye className="h-3 w-3" /> Ver preview
              </>
            )}
          </button>
        </div>
        <MarkdownEditorClient
          value={values.body}
          onChange={(body) => onChange({ body })}
          token={token}
          disabled={isSubmitting}
        />
        {showPreview && (
          <div className="rounded-md border bg-muted/20 p-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Preview
            </p>
            {values.body ? (
              <MarkdownBody body={values.body} className="prose prose-neutral max-w-none text-sm dark:prose-invert" />
            ) : (
              <p className="text-sm italic text-muted-foreground">Sin contenido aún.</p>
            )}
          </div>
        )}
      </div>

      {/* Tags — no aplica a páginas informativas */}
      {showTagsField && (
        <div className="flex flex-col gap-1">
          <label className={labelCls}>Etiquetas (separadas por coma)</label>
          <input
            type="text"
            value={values.tags}
            onChange={(e) => onChange({ tags: e.target.value })}
            className={inputCls}
            disabled={isSubmitting}
            placeholder="consejos, segunda-mano, electrónica"
          />
        </div>
      )}

      {/* Cover image — upload-only, no external URLs */}
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Imagen de portada</label>
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={isSubmitting || uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Subiendo…
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                {values.coverUrl ? 'Cambiar imagen' : 'Subir imagen'}
              </>
            )}
          </Button>
          {values.coverUrl && (
            <button
              type="button"
              onClick={() => onChange({ coverUrl: '' })}
              disabled={isSubmitting}
              className="text-xs text-muted-foreground hover:text-destructive transition-colors"
            >
              Quitar
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>
        {uploadError && (
          <p className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" />
            {uploadError}
          </p>
        )}
        {values.coverUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={values.coverUrl}
            alt="Preview portada"
            className="mt-1 h-28 w-auto rounded-md border object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = 'none';
            }}
          />
        )}
      </div>

      {/* SEO fields — collapsed by default */}
      <details className="rounded-md border">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium hover:bg-muted/30">
          Campos SEO opcionales
        </summary>
        <div className="space-y-4 px-4 pb-4 pt-3">
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Meta título</label>
            <input
              type="text"
              value={values.metaTitle}
              onChange={(e) => onChange({ metaTitle: e.target.value })}
              className={inputCls}
              disabled={isSubmitting}
              placeholder="Si está vacío, se usa el título del post"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className={labelCls}>Meta descripción</label>
            <textarea
              value={values.metaDescription}
              onChange={(e) => onChange({ metaDescription: e.target.value })}
              className={textareaCls}
              rows={2}
              disabled={isSubmitting}
              placeholder="Si está vacío, se usa el excerpt"
            />
          </div>
        </div>
      </details>

      {submitError && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {submitError}
        </div>
      )}

      <Button
        onClick={onSubmit}
        disabled={isSubmitting || !values.title}
        className="w-full sm:w-auto"
      >
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {submitLabel}
      </Button>
    </div>
  );
}
