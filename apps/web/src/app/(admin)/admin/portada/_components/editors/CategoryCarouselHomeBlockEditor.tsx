'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import { uploadHomepageImage } from '@/lib/api/homepage-admin';
import { getCategories } from '@/lib/api/categorias';
import type { Category } from '@/types';
import type { HomeCategoryCarouselBlock, HomeCategoryCarouselItem } from '@/types/home-blocks';
import { inputCls, labelCls, errorCls, hintCls } from './shared';

const MAX_ITEMS = 12;

function flattenCategories(categories: Category[]): { slug: string; label: string }[] {
  const out: { slug: string; label: string }[] = [];
  for (const root of categories) {
    out.push({ slug: root.slug, label: root.name });
    for (const child of root.children ?? []) {
      out.push({ slug: child.slug, label: `${root.name} > ${child.name}` });
    }
  }
  return out;
}

export function CategoryCarouselHomeBlockEditor({
  block,
  onChange,
  token,
  disabled,
}: {
  block: HomeCategoryCarouselBlock;
  onChange: (patch: Partial<HomeCategoryCarouselBlock>) => void;
  token?: string;
  disabled?: boolean;
}) {
  const [categories, setCategories] = useState<{ slug: string; label: string }[]>([]);
  const [uploadingIdx, setUploadingIdx] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  useEffect(() => {
    getCategories()
      .then((cats) => setCategories(flattenCategories(cats)))
      .catch(() => setCategories([]));
  }, []);

  function updateItem(index: number, patch: Partial<HomeCategoryCarouselItem>) {
    onChange({ items: block.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) });
  }

  function moveItem(index: number, dir: 'up' | 'down') {
    const target = dir === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= block.items.length) return;
    const next = [...block.items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ items: next });
  }

  async function handleFile(index: number, file: File) {
    if (!token) return;
    setUploadingIdx(index);
    setUploadError(null);
    try {
      const { url } = await uploadHomepageImage(file, token);
      updateItem(index, { imageUrl: url });
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
      <div className="flex flex-col gap-1">
        <label className={labelCls}>Título de la sección (opcional)</label>
        <input
          type="text"
          value={block.title ?? ''}
          onChange={(e) => onChange({ title: e.target.value || undefined })}
          className={inputCls}
          disabled={disabled}
          placeholder="p.ej. Categorías"
          data-testid="carousel-title"
        />
      </div>

      <div className="space-y-2" data-testid="carousel-items">
        {block.items.map((item, index) => (
          <div key={index} className="flex gap-2 rounded-md border bg-muted/10 p-3">
            <div className="flex shrink-0 flex-col">
              <button
                type="button"
                onClick={() => moveItem(index, 'up')}
                disabled={disabled || index === 0}
                className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
                title="Subir"
                aria-label={`Subir categoría ${index + 1}`}
              >
                <ChevronUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => moveItem(index, 'down')}
                disabled={disabled || index === block.items.length - 1}
                className="h-4 w-4 text-muted-foreground hover:text-foreground disabled:opacity-30"
                title="Bajar"
                aria-label={`Bajar categoría ${index + 1}`}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </div>

            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-col gap-1">
                <label className={labelCls}>Categoría *</label>
                <select
                  value={item.categorySlug}
                  onChange={(e) => updateItem(index, { categorySlug: e.target.value })}
                  className={inputCls}
                  disabled={disabled}
                  data-testid={`carousel-category-${index}`}
                >
                  <option value="">Elige una categoría</option>
                  {categories.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <p className={hintCls}>El enlace se construye solo desde la categoría elegida.</p>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileRefs.current[index]?.click()}
                  disabled={disabled || uploadingIdx === index}
                  data-testid={`carousel-upload-${index}`}
                >
                  {uploadingIdx === index ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Subiendo…
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      {item.imageUrl ? 'Cambiar foto' : 'Subir foto *'}
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
                  data-testid={`carousel-file-${index}`}
                />
                {item.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt="Vista previa"
                    className="h-12 w-16 rounded border object-cover"
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
                <label className={labelCls}>Texto alternativo de la foto *</label>
                <input
                  type="text"
                  value={item.alt}
                  onChange={(e) => updateItem(index, { alt: e.target.value })}
                  className={inputCls}
                  disabled={disabled}
                  placeholder="Describe la foto (accesibilidad y SEO)"
                  data-testid={`carousel-alt-${index}`}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className={labelCls}>Nombre a mostrar (opcional)</label>
                <input
                  type="text"
                  value={item.label ?? ''}
                  onChange={(e) => updateItem(index, { label: e.target.value || undefined })}
                  className={inputCls}
                  disabled={disabled}
                  placeholder="Vacío = el nombre de la categoría"
                  data-testid={`carousel-label-${index}`}
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => onChange({ items: block.items.filter((_, i) => i !== index) })}
              // El backend exige al menos una (ArrayMinSize): mejor deshabilitar
              // que dejar que el guardado falle con un 400.
              disabled={disabled || block.items.length <= 1}
              className="h-6 w-6 shrink-0 self-start text-muted-foreground hover:text-destructive disabled:opacity-30"
              title={block.items.length <= 1 ? 'Debe quedar al menos una categoría' : 'Quitar'}
              aria-label={`Quitar categoría ${index + 1}`}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          onChange({ items: [...block.items, { categorySlug: '', imageUrl: '', alt: '' }] })
        }
        disabled={disabled || block.items.length >= MAX_ITEMS}
        title={block.items.length >= MAX_ITEMS ? `El máximo son ${MAX_ITEMS}` : undefined}
        data-testid="carousel-add-item"
      >
        <Plus className="mr-1 h-3 w-3" />
        Añadir categoría
      </Button>
    </div>
  );
}
