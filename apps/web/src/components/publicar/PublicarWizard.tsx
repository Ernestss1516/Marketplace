'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StepIndicator } from './StepIndicator';
import { StepCategoria } from './steps/StepCategoria';
import { StepFotos, type UploadedImage } from './steps/StepFotos';
import { StepDatos, type DatosData, priceTypeFromMode } from './steps/StepDatos';
import { StepAtributos } from './steps/StepAtributos';
import { StepUbicacion, type UbicacionData } from './steps/StepUbicacion';
import { StepPrevisualizacion } from './steps/StepPrevisualizacion';
import { createListing, publishListing } from '@/lib/api/anuncios';
import { toUserMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import type { Category, AttributeSchema, ListingType, Condition } from '@/types';

// ── Shared state shape ────────────────────────────────────────────────────────

export interface WizardData extends DatosData, UbicacionData {
  // Step 1
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  attributeSchema: AttributeSchema[];
  // Step 2
  images: UploadedImage[];
  // Step 4
  attributes: Record<string, string>;
}

// ── Step IDs ──────────────────────────────────────────────────────────────────

type StepId = 'categoria' | 'fotos' | 'datos' | 'atributos' | 'ubicacion' | 'previsualizacion';

const ALL_STEPS: { id: StepId; label: string }[] = [
  { id: 'categoria', label: 'Categoría' },
  { id: 'fotos', label: 'Fotos' },
  { id: 'datos', label: 'Datos' },
  { id: 'atributos', label: 'Atributos' },
  { id: 'ubicacion', label: 'Ubicación' },
  { id: 'previsualizacion', label: 'Publicar' },
];

// ── Validation ────────────────────────────────────────────────────────────────

function validateStep(id: StepId, data: WizardData): Record<string, string> {
  const errors: Record<string, string> = {};

  if (id === 'categoria') {
    if (!data.categoryId) errors.category = 'Debes seleccionar una categoría.';
  }

  if (id === 'fotos') {
    if (data.images.some((img) => img.uploading)) {
      errors.images = 'Espera a que terminen de subirse todas las fotos.';
    }
  }

  if (id === 'datos') {
    if (!data.title.trim()) errors.title = 'El título es obligatorio.';
    else if (data.title.length > 100) errors.title = 'Máximo 100 caracteres.';

    if (!data.description.trim()) errors.description = 'La descripción es obligatoria.';
    else if (data.description.length > 4000) errors.description = 'Máximo 4000 caracteres.';

    if (!data.type) errors.type = 'Elige el tipo de anuncio.';

    if (data.type === 'PRODUCT' && !data.condition) {
      errors.condition = 'Indica el estado del artículo.';
    }

    if (data.priceMode === 'fixed') {
      const num = parseFloat(data.price);
      if (!data.price || isNaN(num) || num <= 0) {
        errors.price = 'Introduce un precio mayor que 0.';
      }
    }
  }

  if (id === 'atributos') {
    for (const field of data.attributeSchema) {
      if (field.required) {
        const val = data.attributes[field.name];
        if (!val || val === '') {
          errors[field.name] = `${field.label} es obligatorio.`;
        }
      }
    }
  }

  if (id === 'ubicacion') {
    if (!data.city.trim()) errors.city = 'La ciudad es obligatoria.';
    if (!data.province.trim()) errors.province = 'La provincia es obligatoria.';
  }

  return errors;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildAttributes(
  values: Record<string, string>,
  schema: AttributeSchema[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of schema) {
    const val = values[field.name];
    if (val === undefined || val === '') continue;
    if (field.type === 'number') result[field.name] = Number(val);
    else if (field.type === 'boolean') result[field.name] = val === 'true';
    else result[field.name] = val;
  }
  return result;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface PublicarWizardProps {
  token: string;
  categories: Category[];
}

const INITIAL_DATA: WizardData = {
  // Step 1
  categoryId: '',
  categorySlug: '',
  categoryName: '',
  attributeSchema: [],
  // Step 2
  images: [],
  // Step 3
  title: '',
  description: '',
  type: '',
  condition: '',
  priceMode: 'fixed',
  price: '',
  // Step 4
  attributes: {},
  // Step 5
  city: '',
  province: '',
  postalCode: '',
};

export function PublicarWizard({ token, categories }: PublicarWizardProps) {
  const router = useRouter();
  const { run } = useApiAction();
  const [data, setData] = useState<WizardData>(INITIAL_DATA);
  const [currentStepId, setCurrentStepId] = useState<StepId>('categoria');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitState, setSubmitState] = useState<'idle' | 'saving' | 'publishing'>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingReview, setPendingReview] = useState(false);

  // Active step list — skip 'atributos' when the chosen category has no schema
  const activeSteps = data.attributeSchema.length > 0
    ? ALL_STEPS
    : ALL_STEPS.filter((s) => s.id !== 'atributos');

  const currentIndex = activeSteps.findIndex((s) => s.id === currentStepId);

  // ── State helpers ──────────────────────────────────────────────────────────

  function update(patch: Partial<WizardData>) {
    setData((prev) => ({ ...prev, ...patch }));
  }

  function updateImages(updater: UploadedImage[] | ((prev: UploadedImage[]) => UploadedImage[])) {
    setData((prev) => ({
      ...prev,
      images: typeof updater === 'function' ? updater(prev.images) : updater,
    }));
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  function goNext() {
    if (currentIndex < activeSteps.length - 1) {
      setCurrentStepId(activeSteps[currentIndex + 1].id);
    }
  }

  function goBack() {
    if (currentIndex > 0) {
      setCurrentStepId(activeSteps[currentIndex - 1].id);
      setErrors({});
    }
  }

  function handleNext() {
    const errs = validateStep(currentStepId, data);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }
    setErrors({});
    goNext();
  }

  // Category step auto-advances on leaf selection
  function handleCategoryComplete(cat: {
    categoryId: string;
    categorySlug: string;
    categoryName: string;
    attributeSchema: AttributeSchema[];
  }) {
    setData((prev) => ({ ...prev, ...cat, attributes: {} }));
    setErrors({});
    // Use the new schema to decide next step before state flush —
    // goNext reads activeSteps which is derived from current render's data,
    // so schedule with a timeout to let state settle.
    setTimeout(() => goNext(), 0);
  }

  // ── Submit ─────────────────────────────────────────────────────────────────

  async function handleSubmit(action: 'draft' | 'publish') {
    setSubmitState(action === 'draft' ? 'saving' : 'publishing');
    setSubmitError(null);

    await run(
      async () => {
        const imageIds = data.images
          .filter((img) => img.id && !img.error && !img.uploading)
          .map((img) => img.id!);

        const price = data.priceMode === 'fixed' ? parseFloat(data.price) : 0;

        const draft = await createListing(
          {
            title: data.title,
            description: data.description,
            price,
            priceType: priceTypeFromMode(data.priceMode),
            type: data.type as ListingType,
            condition: data.condition ? (data.condition as Condition) : undefined,
            categoryId: data.categoryId,
            attributes: buildAttributes(data.attributes, data.attributeSchema),
            city: data.city,
            province: data.province,
            postalCode: data.postalCode || undefined,
            imageIds: imageIds.length ? imageIds : undefined,
          },
          token,
        );

        if (action === 'publish') {
          const published = await publishListing(draft.id, token);
          if (published.status === 'PENDING_REVIEW') {
            setPendingReview(true);
            setSubmitState('idle');
            return;
          }
          router.push(`/anuncio/${draft.slug}`);
        } else {
          router.push('/mis-anuncios');
        }
      },
      {
        onError: (err) => { setSubmitError(toUserMessage(err)); setSubmitState('idle'); },
        callbackUrl: '/login?callbackUrl=%2Fpublicar',
      },
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const stepLabels = activeSteps.map((s) => s.label);
  const isLast = currentIndex === activeSteps.length - 1;

  return (
    <div className="mx-auto max-w-2xl">
      <StepIndicator steps={stepLabels} currentIndex={currentIndex} />

      <div className="rounded-xl border bg-card p-6 shadow-sm">
        {currentStepId === 'categoria' && (
          <StepCategoria
            categories={categories}
            selected={
              data.categoryId
                ? {
                    categoryId: data.categoryId,
                    categorySlug: data.categorySlug,
                    categoryName: data.categoryName,
                    attributeSchema: data.attributeSchema,
                  }
                : null
            }
            onComplete={handleCategoryComplete}
          />
        )}

        {currentStepId === 'fotos' && (
          <StepFotos
            images={data.images}
            token={token}
            onChange={updateImages}
            errors={errors}
          />
        )}

        {currentStepId === 'datos' && (
          <StepDatos
            data={{
              title: data.title,
              description: data.description,
              type: data.type,
              condition: data.condition,
              priceMode: data.priceMode,
              price: data.price,
            }}
            onChange={(patch) => update(patch as Partial<WizardData>)}
            errors={errors}
          />
        )}

        {currentStepId === 'atributos' && (
          <StepAtributos
            schema={data.attributeSchema}
            values={data.attributes}
            onChange={(attrs) => update({ attributes: attrs })}
            errors={errors}
          />
        )}

        {currentStepId === 'ubicacion' && (
          <StepUbicacion
            data={{ city: data.city, province: data.province, postalCode: data.postalCode }}
            onChange={(patch) => update(patch as Partial<WizardData>)}
            errors={errors}
          />
        )}

        {currentStepId === 'previsualizacion' && !pendingReview && (
          <StepPrevisualizacion
            data={data}
            submitState={submitState}
            submitError={submitError}
            onSaveDraft={() => handleSubmit('draft')}
            onPublish={() => handleSubmit('publish')}
          />
        )}

        {currentStepId === 'previsualizacion' && pendingReview && (
          <div className="flex flex-col items-center gap-4 py-8 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
              <Clock className="h-8 w-8 text-amber-600" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Anuncio enviado a revisión</h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                Tu anuncio contiene términos que requieren revisión. El equipo de moderación
                lo revisará y se publicará una vez aprobado.
              </p>
            </div>
            <Button onClick={() => router.push('/mis-anuncios')}>
              Ver mis anuncios
            </Button>
          </div>
        )}
      </div>

      {/* Navigation */}
      {!isLast && (
        <div className="mt-4 flex items-center justify-between">
          <Button
            variant="ghost"
            onClick={goBack}
            disabled={currentIndex === 0}
            className="gap-1"
          >
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </Button>

          {/* For category step, the user advances by selecting; hide Next */}
          {currentStepId !== 'categoria' && (
            <Button onClick={handleNext}>
              {currentIndex === activeSteps.length - 2 ? 'Revisar' : 'Siguiente'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
