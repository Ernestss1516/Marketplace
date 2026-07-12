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
import { useRequireAuth } from '@/hooks/use-require-auth';
import { filterSchemaByType, resolveLinkedOptions } from '@/lib/attribute-schema';
import type { Category, AttributeSchema, ListingType, ListingTypePolicy, Condition } from '@/types';

// ── Shared state shape ────────────────────────────────────────────────────────

export interface WizardData extends DatosData, UbicacionData {
  // Step 1
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  attributeSchema: AttributeSchema[];
  allowedListingType: ListingTypePolicy;
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
    // Solo los campos que aplican al tipo elegido pueden bloquear el avance —
    // un requerido de PRODUCT no debe exigirse a un anuncio SERVICE.
    for (const field of filterSchemaByType(data.attributeSchema, data.type)) {
      if (field.required) {
        const val = data.attributes[field.name];
        if (!val || val === '') {
          errors[field.name] = `${field.label} es obligatorio.`;
        }
      }
      // Selects vinculados: si el campo tiene valor, debe ser una opción
      // válida para el valor actual de su padre (la UI ya lo impide en el
      // caso normal — deshabilitado hasta elegir el padre, opciones acotadas
      // — pero el estado puede quedar obsoleto tras idas y venidas).
      if (field.dependsOn) {
        const val = data.attributes[field.name];
        if (val) {
          const parentVal = data.attributes[field.dependsOn];
          if (!resolveLinkedOptions(field, parentVal).includes(val)) {
            errors[field.name] = `${field.label} no es válido para el valor elegido.`;
          }
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
  initialLocation?: { city?: string; province?: string; postalCode?: string };
}

const INITIAL_DATA: WizardData = {
  // Step 1
  categoryId: '',
  categorySlug: '',
  categoryName: '',
  attributeSchema: [],
  allowedListingType: 'BOTH',
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

export function PublicarWizard({ token, categories, initialLocation }: PublicarWizardProps) {
  const router = useRouter();
  const { run } = useApiAction();
  const { loginUrl } = useRequireAuth();
  const [data, setData] = useState<WizardData>({
    ...INITIAL_DATA,
    city: initialLocation?.city || '',
    province: initialLocation?.province || '',
    postalCode: initialLocation?.postalCode || '',
  });
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
    allowedListingType: ListingTypePolicy;
  }) {
    setData((prev) => ({
      ...prev,
      ...cat,
      attributes: {},
      // La política de la nueva categoría manda: PRODUCT_ONLY/SERVICE_ONLY fija
      // el tipo sin preguntar; BOTH conserva la elección previa (si la había).
      type:
        cat.allowedListingType === 'PRODUCT_ONLY' ? 'PRODUCT'
        : cat.allowedListingType === 'SERVICE_ONLY' ? 'SERVICE'
        : prev.type,
      condition: cat.allowedListingType === 'SERVICE_ONLY' ? '' : prev.condition,
    }));
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
            // CRÍTICO: construir sobre el schema FILTRADO por tipo — solo se envían
            // los atributos que aplican al tipo final, aunque la memoria conserve
            // valores de un tipo anterior (idas y venidas en el wizard).
            attributes: buildAttributes(data.attributes, filterSchemaByType(data.attributeSchema, data.type)),
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
        callbackUrl: loginUrl,
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
                    allowedListingType: data.allowedListingType,
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
            readOnlyType={data.allowedListingType !== 'BOTH'}
          />
        )}

        {currentStepId === 'atributos' && (
          <StepAtributos
            schema={filterSchemaByType(data.attributeSchema, data.type)}
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
