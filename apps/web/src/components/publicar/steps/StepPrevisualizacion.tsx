'use client';

import { Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { WizardData } from '../PublicarWizard';

interface StepPrevisualizacionProps {
  data: WizardData;
  submitState: 'idle' | 'saving' | 'publishing';
  submitError: string | null;
  onSaveDraft: () => void;
  onPublish: () => void;
}

const CONDITION_LABELS: Record<string, string> = {
  NEW: 'Nuevo',
  LIKE_NEW: 'Como nuevo',
  GOOD: 'Buen estado',
  FAIR: 'Aceptable',
  FOR_PARTS: 'Para piezas',
};

function formatPrice(data: WizardData) {
  if (data.priceMode === 'free') return 'Gratis';
  if (data.priceMode === 'negotiable') return 'A convenir';
  const num = parseFloat(data.price);
  if (isNaN(num)) return '—';
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(num);
}

export function StepPrevisualizacion({
  data,
  submitState,
  submitError,
  onSaveDraft,
  onPublish,
}: StepPrevisualizacionProps) {
  const validImages = data.images.filter((img) => img.id && !img.error);
  const isSubmitting = submitState !== 'idle';
  const canPublish = validImages.length >= 1;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Previsualización</h2>
        <p className="text-sm text-muted-foreground">
          Revisa tu anuncio antes de publicarlo. Puedes guardar como borrador y
          publicarlo más tarde desde «Mis anuncios».
        </p>
      </div>

      {/* Thumbnail */}
      {validImages.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {validImages.slice(0, 5).map((img, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={img.localId}
              src={img.previewUrl}
              alt={`Foto ${i + 1}`}
              className={[
                'h-24 w-24 shrink-0 rounded-lg object-cover',
                i === 0 ? 'ring-2 ring-primary ring-offset-1' : '',
              ].join(' ')}
            />
          ))}
          {validImages.length > 5 && (
            <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">
              +{validImages.length - 5}
            </div>
          )}
        </div>
      )}

      {/* Summary */}
      <div className="rounded-lg border bg-card p-4 space-y-3">
        <div>
          <p className="text-lg font-semibold">{data.title || <em className="text-muted-foreground">Sin título</em>}</p>
          <p className="text-2xl font-bold text-primary">{formatPrice(data)}</p>
        </div>

        <Separator />

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Categoría</dt>
            <dd className="font-medium">{data.categoryName || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Tipo</dt>
            <dd className="font-medium">
              {data.type === 'PRODUCT' ? 'Producto' : data.type === 'SERVICE' ? 'Servicio' : '—'}
            </dd>
          </div>
          {data.condition && (
            <div>
              <dt className="text-muted-foreground">Estado</dt>
              <dd className="font-medium">{CONDITION_LABELS[data.condition] ?? data.condition}</dd>
            </div>
          )}
          <div>
            <dt className="text-muted-foreground">Ubicación</dt>
            <dd className="font-medium">
              {[data.city, data.province].filter(Boolean).join(', ') || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Fotos</dt>
            <dd className="font-medium">{validImages.length}</dd>
          </div>
        </dl>

        {/* Attributes summary */}
        {data.attributeSchema.length > 0 && Object.keys(data.attributes).length > 0 && (
          <>
            <Separator />
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              {data.attributeSchema.map((field) => {
                const val = data.attributes[field.name];
                if (!val) return null;
                return (
                  <div key={field.name}>
                    <dt className="text-muted-foreground">{field.label}</dt>
                    <dd className="font-medium">
                      {field.type === 'boolean' ? (val === 'true' ? 'Sí' : 'No') : val}
                      {field.unit ? ` ${field.unit}` : ''}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </>
        )}

        {/* Description excerpt */}
        {data.description && (
          <>
            <Separator />
            <p className="line-clamp-3 text-sm text-muted-foreground">{data.description}</p>
          </>
        )}
      </div>

      {/* Publish warning if no photos */}
      {validImages.length === 0 && (
        <p className="flex items-center gap-1.5 text-sm text-amber-600">
          <AlertCircle className="h-4 w-4 shrink-0" />
          Para publicar necesitas al menos 1 foto. Puedes guardar como borrador y añadirla
          después.
        </p>
      )}

      {/* Submit error */}
      {submitError && (
        <p className="flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {submitError}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          variant="outline"
          onClick={onSaveDraft}
          disabled={isSubmitting}
          className="sm:flex-1"
        >
          {submitState === 'saving' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar borrador
        </Button>
        <Button
          onClick={onPublish}
          disabled={isSubmitting || !canPublish}
          className="sm:flex-1"
        >
          {submitState === 'publishing' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Publicar ahora
        </Button>
      </div>
    </div>
  );
}
