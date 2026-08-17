'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Clock, MailWarning } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StepIndicator } from './StepIndicator';
import { StepCategoria } from './steps/StepCategoria';
import { StepFotos, type UploadedImage } from './steps/StepFotos';
import {
  StepDatos,
  type DatosData,
  priceTypeFromMode,
} from './steps/StepDatos';
import { resolvePriceUnitSelection } from '@/lib/price-unit';
import { StepAtributos } from './steps/StepAtributos';
import { StepTags } from './steps/StepTags';
import { StepUbicacion, type UbicacionData } from './steps/StepUbicacion';
import { StepPrevisualizacion } from './steps/StepPrevisualizacion';
import { createListing, publishListing } from '@/lib/api/anuncios';
import { toUserMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { filterSchemaByType, resolveLinkedOptions } from '@/lib/attribute-schema';
import type { Category, AttributeSchema, ListingType, ListingTypePolicy, Condition, PriceUnit, TagRef } from '@/types';

// ── Shared state shape ────────────────────────────────────────────────────────

export interface WizardData extends DatosData, UbicacionData {
  // Step 1
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  attributeSchema: AttributeSchema[];
  allowedListingType: ListingTypePolicy;
  /** RP.3 — formatos efectivos de la categoría; acotan el selector de StepDatos. */
  allowedPriceUnits: PriceUnit[];
  /** B2 — tags efectivos de la categoría. Vacío → el paso 'tags' no existe. */
  availableTags: TagRef[];
  /** B2 — tope vigente (maxTagsPerListing), tal como lo da el backend. */
  maxTags: number;
  // Step 2
  images: UploadedImage[];
  // Step 4
  attributes: Record<string, string>;
  /** B2 — slugs elegidos. Se descartan en silencio los que no valgan al cambiar de categoría. */
  tags: string[];
}

// ── Step IDs ──────────────────────────────────────────────────────────────────

type StepId = 'categoria' | 'fotos' | 'datos' | 'atributos' | 'tags' | 'ubicacion' | 'previsualizacion';

const ALL_STEPS: { id: StepId; label: string }[] = [
  { id: 'categoria', label: 'Categoría' },
  { id: 'fotos', label: 'Fotos' },
  { id: 'datos', label: 'Datos' },
  { id: 'atributos', label: 'Atributos' },
  { id: 'tags', label: 'Etiquetas' },
  { id: 'ubicacion', label: 'Ubicación' },
  { id: 'previsualizacion', label: 'Publicar' },
];

/**
 * B2 — REGLA DE DESAPARICIÓN, encadenada. 'atributos' ya desaparecía sin schema;
 * 'tags' desaparece sin tags efectivos. Las dos conviven: un wizard puede no tener
 * ninguno de los dos pasos, uno, o los dos. Se extrae a función porque ahora la usan
 * los dos wizards y `handleCategoryComplete`, que necesita saber el próximo paso
 * ANTES de que el estado se haya volcado.
 */
export function resolveActiveSteps<T extends { id: string; label: string }>(
  steps: T[],
  d: { attributeSchema: unknown[]; availableTags: unknown[] },
): T[] {
  let activos = steps;
  if (d.attributeSchema.length === 0) activos = activos.filter((s) => s.id !== 'atributos');
  if (d.availableTags.length === 0) activos = activos.filter((s) => s.id !== 'tags');
  return activos;
}

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

  if (id === 'tags') {
    // NUNCA bloquea por falta: los tags son opcionales. Lo único que bloquea es
    // pasarse del tope — situación que la UI ya impide (los no marcados se
    // deshabilitan al llegar al límite), pero que el estado puede alcanzar tras idas
    // y venidas si un admin baja el tope a media sesión. Mismo motivo por el que se
    // revalidan los selects vinculados.
    if (data.tags.length > data.maxTags) {
      errors.tags = `Como máximo ${data.maxTags} etiquetas; has elegido ${data.tags.length}.`;
    }
  }

  if (id === 'ubicacion') {
    if (!data.city.trim()) errors.city = 'La ciudad es obligatoria.';
    if (!data.province.trim()) errors.province = 'La provincia es obligatoria.';
    // Opcional — solo se valida el formato si el usuario escribió algo (mismo
    // patrón que el backend, LISTING_PHONE_REGEX).
    if (data.phone.trim() && !/^[0-9+\-\s()]{6,20}$/.test(data.phone.trim())) {
      errors.phone = 'Introduce un teléfono válido (6-20 caracteres).';
    }
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
  initialPhone?: string;
}

const INITIAL_DATA: WizardData = {
  // Step 1
  categoryId: '',
  categorySlug: '',
  categoryName: '',
  attributeSchema: [],
  allowedListingType: 'BOTH',
  allowedPriceUnits: [],
  availableTags: [],
  maxTags: 0,
  // Step 2
  images: [],
  // Step 3
  title: '',
  description: '',
  type: '',
  condition: '',
  priceMode: 'fixed',
  price: '',
  priceUnit: 'ONE_TIME',
  // Step 4
  attributes: {},
  tags: [],
  // Step 5
  city: '',
  province: '',
  postalCode: '',
  phone: '',
};

export function PublicarWizard({ token, categories, initialLocation, initialPhone }: PublicarWizardProps) {
  const router = useRouter();
  const { run } = useApiAction();
  const { loginUrl } = useRequireAuth();
  const [data, setData] = useState<WizardData>({
    ...INITIAL_DATA,
    city: initialLocation?.city || '',
    province: initialLocation?.province || '',
    postalCode: initialLocation?.postalCode || '',
    phone: initialPhone || '',
  });
  const [currentStepId, setCurrentStepId] = useState<StepId>('categoria');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitState, setSubmitState] = useState<'idle' | 'saving' | 'publishing'>('idle');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pendingReview, setPendingReview] = useState(false);
  /** PUERTA regla #2 — el aviso cuando el anuncio se queda en borrador. */
  const [publishBlocked, setPublishBlocked] = useState<string | null>(null);

  // Skip 'atributos' sin schema y 'tags' sin tags efectivos (ver resolveActiveSteps).
  const activeSteps = resolveActiveSteps(ALL_STEPS, data);

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
    allowedPriceUnits: PriceUnit[];
    availableTags: TagRef[];
    maxTags: number;
  }) {
    setData((prev) => ({
      ...prev,
      ...cat,
      attributes: {},
      // B2 — los tags que la NUEVA categoría no ofrece se descartan EN SILENCIO, el
      // mismo criterio con el que los atributos se reinician arriba. Los que sí
      // siguen valiendo se conservan: rehacer la selección tras un cambio de
      // categoría sería fricción gratuita cuando el tag es válido en las dos.
      tags: prev.tags.filter((slug) => cat.availableTags.some((t) => t.slug === slug)),
      // La política de la nueva categoría manda: PRODUCT_ONLY/SERVICE_ONLY fija
      // el tipo sin preguntar; BOTH conserva la elección previa (si la había).
      type:
        cat.allowedListingType === 'PRODUCT_ONLY' ? 'PRODUCT'
        : cat.allowedListingType === 'SERVICE_ONLY' ? 'SERVICE'
        : prev.type,
      condition: cat.allowedListingType === 'SERVICE_ONLY' ? '' : prev.condition,
      // RP.3 — mismo criterio que `type`: los formatos de la NUEVA categoría
      // mandan. Se conserva la elección previa solo si sigue permitida; si no,
      // cae a ONE_TIME o al primero. Sin esto, volver atrás y cambiar de
      // categoría dejaría un formato que la nueva rechazaría con 422.
      priceUnit: resolvePriceUnitSelection(cat.allowedPriceUnits, prev.priceUnit),
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
            // "Gratis" nunca lleva formato — se envía ONE_TIME, que es lo que
            // toda categoría sin configurar permite y el default del backend.
            priceUnit: data.priceMode === 'free' ? 'ONE_TIME' : data.priceUnit,
            type: data.type as ListingType,
            condition: data.condition ? (data.condition as Condition) : undefined,
            categoryId: data.categoryId,
            // CRÍTICO: construir sobre el schema FILTRADO por tipo — solo se envían
            // los atributos que aplican al tipo final, aunque la memoria conserve
            // valores de un tipo anterior (idas y venidas en el wizard).
            attributes: buildAttributes(data.attributes, filterSchemaByType(data.attributeSchema, data.type)),
            // B2 — mismo criterio que los atributos: se envía lo que sigue siendo
            // válido para la categoría ACTUAL, no lo que la memoria arrastre de una
            // categoría anterior. `handleCategoryComplete` ya poda, esto es el cinturón.
            tags: data.tags.filter((slug) => data.availableTags.some((t) => t.slug === slug)),
            city: data.city,
            province: data.province,
            postalCode: data.postalCode || undefined,
            phone: data.phone.trim() || undefined,
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
          // PUERTA regla #2 — el anuncio se guardó pero NO llegó al mercado
          // (hoy: correo sin verificar). Mismo tratamiento que la revisión: se
          // le dice al usuario qué ha pasado y qué hacer, en vez de llevarlo a
          // una ficha que no existe públicamente.
          if (published.status === 'DRAFT') {
            setPublishBlocked(
              published.publishBlocked?.message ??
                'Tu anuncio se ha guardado como borrador y todavía no está publicado.',
            );
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
                    allowedPriceUnits: data.allowedPriceUnits,
                    availableTags: data.availableTags,
                    maxTags: data.maxTags,
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
              priceUnit: data.priceUnit,
            }}
            onChange={(patch) => update(patch as Partial<WizardData>)}
            errors={errors}
            readOnlyType={data.allowedListingType !== 'BOTH'}
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

        {currentStepId === 'tags' && (
          <StepTags
            available={data.availableTags}
            selected={data.tags}
            max={data.maxTags}
            onChange={(tags) => update({ tags })}
            errors={errors}
          />
        )}

        {currentStepId === 'ubicacion' && (
          <StepUbicacion
            data={{ city: data.city, province: data.province, postalCode: data.postalCode, phone: data.phone }}
            onChange={(patch) => update(patch as Partial<WizardData>)}
            errors={errors}
          />
        )}

        {/*
          PUERTA regla #2 — el anuncio EXISTE y está guardado; lo único que falta
          es un paso del usuario. Por eso el aviso no es rojo ni habla de error:
          dice qué ha pasado, dónde está su trabajo y cómo desbloquearlo.
        */}
        {currentStepId === 'previsualizacion' && publishBlocked && (
          <div
            className="flex flex-col items-center gap-4 py-8 text-center"
            data-testid="publicar-bloqueado"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-amber-100">
              <MailWarning className="h-8 w-8 text-amber-600" />
            </div>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">Guardado como borrador</h2>
              <p className="max-w-sm text-sm text-muted-foreground">{publishBlocked}</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button onClick={() => router.push('/verificar-email')}>Verificar mi correo</Button>
              <Button variant="outline" onClick={() => router.push('/mis-anuncios')}>
                Ver mis anuncios
              </Button>
            </div>
          </div>
        )}

        {currentStepId === 'previsualizacion' && !pendingReview && !publishBlocked && (
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
