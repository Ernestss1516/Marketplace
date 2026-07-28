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
import { useRequireAuth } from '@/hooks/use-require-auth';
import { filterSchemaByType, resolveLinkedOptions } from '@/lib/attribute-schema';
import type { AttributeSchema, Condition, PriceUnit } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EditarWizardData extends DatosData, UbicacionData {
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  attributeSchema: AttributeSchema[];
  /** RP.3 — formatos efectivos de la categoría YA ASIGNADA (aquí no se puede
   *  cambiar de categoría, así que la lista es fija durante toda la edición). */
  allowedPriceUnits: PriceUnit[];
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
    // Tipo y categoría son inmutables aquí — sin transición posible, pero el
    // filtrado por tipo sigue aplicando (mismo criterio que en publicar).
    for (const field of filterSchemaByType(data.attributeSchema, data.type)) {
      if (field.required) {
        const val = data.attributes[field.name];
        if (!val || val === '') errors[field.name] = `${field.label} es obligatorio.`;
      }
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
    if (data.phone.trim() && !/^[0-9+\-\s()]{6,20}$/.test(data.phone.trim())) {
      errors.phone = 'Introduce un teléfono válido (6-20 caracteres).';
    }
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
  const { loginUrl } = useRequireAuth();
  const [data, setData] = useState<EditarWizardData>(initialData);
  // RP.3 — formato con el que se abrió la edición. Se congela al montar para
  // poder enviar `priceUnit` SOLO si el vendedor lo cambia: así una edición que
  // no lo toca no lo revalida contra la categoría, que es exactamente el
  // grandfathering que garantiza update() en el backend (RP.1). Un anuncio
  // antiguo cuyo formato ya no encajara podría seguir editando título o precio.
  const [initialPriceUnit] = useState<PriceUnit>(initialData.priceUnit);
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

        const nextPriceUnit: PriceUnit =
          data.priceMode === 'free' ? 'ONE_TIME' : data.priceUnit;

        await updateListing(
          listingId,
          {
            title: data.title,
            description: data.description,
            condition: data.condition ? (data.condition as Condition) : undefined,
            price: data.priceMode === 'fixed' ? parseFloat(data.price) : 0,
            priceType: priceTypeFromMode(data.priceMode),
            // Igual que en el alta, "Gratis" no lleva formato. Y solo se envía si
            // CAMBIÓ (ver initialPriceUnit): omitirlo evita revalidar el formato
            // de un anuncio cuya edición no lo tocaba.
            ...(nextPriceUnit !== initialPriceUnit && { priceUnit: nextPriceUnit }),
            attributes: buildAttributes(data.attributes, filterSchemaByType(data.attributeSchema, data.type)),
            city: data.city,
            province: data.province,
            postalCode: data.postalCode || undefined,
            phone: data.phone.trim(),
            imageIds: validImageIds,
          },
          token,
        );

        router.push('/mis-anuncios');
      },
      {
        onError: (err) => { setSaveError(toUserMessage(err)); setSaving(false); },
        callbackUrl: loginUrl,
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
              priceUnit: data.priceUnit,
            }}
            onChange={(patch) => update(patch as Partial<EditarWizardData>)}
            errors={errors}
            readOnlyType
            allowedPriceUnits={data.allowedPriceUnits}
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
          <>
            <StepUbicacion
              data={{ city: data.city, province: data.province, postalCode: data.postalCode, phone: data.phone }}
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
