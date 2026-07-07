'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StepIndicator } from './StepIndicator';
import { StepFotos, type UploadedImage } from './steps/StepFotos';
import { StepDatos, type DatosData, priceTypeFromMode } from './steps/StepDatos';
import { StepAtributos } from './steps/StepAtributos';
import { StepUbicacion, type UbicacionData } from './steps/StepUbicacion';
import { updateListing } from '@/lib/api/anuncios';
import { toUserMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import type { AttributeSchema, Condition } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EditarWizardData extends DatosData, UbicacionData {
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  attributeSchema: AttributeSchema[];
  images: UploadedImage[];
  attributes: Record<string, string>;
}

type StepId = 'fotos' | 'datos' | 'atributos' | 'ubicacion';

const ALL_STEPS: { id: StepId; label: string }[] = [
  { id: 'fotos', label: 'Fotos' },
  { id: 'datos', label: 'Datos' },
  { id: 'atributos', label: 'Atributos' },
  { id: 'ubicacion', label: 'Ubicación' },
];

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

function validateStep(id: StepId, data: EditarWizardData): Record<string, string> {
  const errors: Record<string, string> = {};

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

    // type es inmutable tras crear (RÁFAGA 1) — no se valida aquí, siempre viene de initialData.
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
        if (!val || val === '') errors[field.name] = `${field.label} es obligatorio.`;
      }
    }
  }

  if (id === 'ubicacion') {
    if (!data.city.trim()) errors.city = 'La ciudad es obligatoria.';
    if (!data.province.trim()) errors.province = 'La provincia es obligatoria.';
  }

  return errors;
}

// ── Component ─────────────────────────────────────────────────────────────────

interface EditarWizardProps {
  listingId: string;
  token: string;
  initialData: EditarWizardData;
}

export function EditarWizard({ listingId, token, initialData }: EditarWizardProps) {
  const router = useRouter();
  const { run } = useApiAction();
  const [data, setData] = useState<EditarWizardData>(initialData);
  const [currentStepId, setCurrentStepId] = useState<StepId>('fotos');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Skip atributos if the category has no schema
  const activeSteps = data.attributeSchema.length > 0
    ? ALL_STEPS
    : ALL_STEPS.filter((s) => s.id !== 'atributos');

  const currentIndex = activeSteps.findIndex((s) => s.id === currentStepId);
  const isLast = currentIndex === activeSteps.length - 1;

  // ── State helpers ────────────────────────────────────────────────────────

  function update(patch: Partial<EditarWizardData>) {
    setData((prev) => ({ ...prev, ...patch }));
  }

  function updateImages(updater: UploadedImage[] | ((prev: UploadedImage[]) => UploadedImage[])) {
    setData((prev) => ({
      ...prev,
      images: typeof updater === 'function' ? updater(prev.images) : updater,
    }));
  }

  // ── Navigation ───────────────────────────────────────────────────────────

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
    if (!isLast) {
      setCurrentStepId(activeSteps[currentIndex + 1].id);
    }
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  async function handleSave() {
    const errs = validateStep(currentStepId, data);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setSaving(true);
    setSaveError(null);

    await run(
      async () => {
        const validImageIds = data.images
          .filter((img) => img.id && !img.error && !img.uploading)
          .map((img) => img.id!);

        await updateListing(
          listingId,
          {
            title: data.title,
            description: data.description,
            condition: data.condition ? (data.condition as Condition) : undefined,
            price: data.priceMode === 'fixed' ? parseFloat(data.price) : 0,
            priceType: priceTypeFromMode(data.priceMode),
            attributes: buildAttributes(data.attributes, data.attributeSchema),
            city: data.city,
            province: data.province,
            postalCode: data.postalCode || undefined,
            imageIds: validImageIds,
          },
          token,
        );

        router.push('/mis-anuncios');
      },
      {
        onError: (err) => { setSaveError(toUserMessage(err)); setSaving(false); },
        callbackUrl: '/login?callbackUrl=%2Fmis-anuncios',
      },
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const stepLabels = activeSteps.map((s) => s.label);

  return (
    <div className="mx-auto max-w-2xl">
      {/* Category info — read-only, no changing category in edit */}
      {data.categoryName && (
        <p className="mb-4 text-sm text-muted-foreground">
          Categoría: <span className="font-medium text-foreground">{data.categoryName}</span>
        </p>
      )}

      <StepIndicator steps={stepLabels} currentIndex={currentIndex} />

      <div className="rounded-xl border bg-card p-6 shadow-sm">
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
            onChange={(patch) => update(patch as Partial<EditarWizardData>)}
            errors={errors}
            readOnlyType
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
          <>
            <StepUbicacion
              data={{ city: data.city, province: data.province, postalCode: data.postalCode }}
              onChange={(patch) => update(patch as Partial<EditarWizardData>)}
              errors={errors}
            />

            {saveError && (
              <p className="mt-4 flex items-center gap-1.5 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {saveError}
              </p>
            )}
          </>
        )}
      </div>

      {/* Navigation */}
      <div className="mt-4 flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={goBack}
          disabled={currentIndex === 0 || saving}
          className="gap-1"
        >
          <ChevronLeft className="h-4 w-4" />
          Anterior
        </Button>

        {isLast ? (
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Guardar cambios
          </Button>
        ) : (
          <Button onClick={handleNext}>Siguiente</Button>
        )}
      </div>
    </div>
  );
}
