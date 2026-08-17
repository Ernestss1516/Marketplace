'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { StepFotos, type UploadedImage } from './steps/StepFotos';
import { StepDatos, type DatosData, priceTypeFromMode } from './steps/StepDatos';
import { StepAtributos } from './steps/StepAtributos';
import { StepTags } from './steps/StepTags';
import { StepUbicacion, type UbicacionData } from './steps/StepUbicacion';
import { StepVideo, type VideoState } from './steps/StepVideo';
import { updateListing, type PhotoLimits } from '@/lib/api/anuncios';
import { toUserMessage } from '@/lib/api/client';
import { useApiAction } from '@/lib/api/use-api-action';
import { useRequireAuth } from '@/hooks/use-require-auth';
import { useUnsavedChanges } from '@/hooks/use-unsaved-changes';
import { filterSchemaByType, resolveLinkedOptions } from '@/lib/attribute-schema';
import type { ProStatus } from '@/lib/api/billing';
import type { VideoConfig } from '@/lib/api/video';
import type { AttributeSchema, Condition, PriceUnit, TagRef } from '@/types';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EditarFormData extends DatosData, UbicacionData {
  categoryId: string;
  categorySlug: string;
  categoryName: string;
  attributeSchema: AttributeSchema[];
  /** RP.3 — formatos efectivos de la categoría YA ASIGNADA (aquí no se puede cambiar de
   *  categoría, así que la lista es fija durante toda la edición). */
  allowedPriceUnits: PriceUnit[];
  /** B2 — tags efectivos de la categoría del anuncio. */
  availableTags: TagRef[];
  /** B2 — tope vigente (maxTagsPerListing). */
  maxTags: number;
  images: UploadedImage[];
  attributes: Record<string, string>;
  /** B2 — slugs ya asignados al anuncio, precargados. */
  tags: string[];
}

type SectionId = 'fotos' | 'video' | 'datos' | 'atributos' | 'tags' | 'ubicacion';

interface Section {
  id: SectionId;
  label: string;
}

const ALL_SECTIONS: Section[] = [
  { id: 'fotos', label: 'Fotos' },
  { id: 'video', label: 'Vídeo' },
  { id: 'datos', label: 'Datos' },
  { id: 'atributos', label: 'Atributos' },
  { id: 'tags', label: 'Etiquetas' },
  { id: 'ubicacion', label: 'Ubicación' },
];

/**
 * UXV.5 — qué secciones tiene la edición de ESTE anuncio.
 *
 * Hoy aplica las mismas dos reglas de desaparición que el alta (`resolveActiveSteps`): sin
 * `attributeSchema` no hay sección de atributos, y sin tags efectivos no hay de etiquetas.
 * Se replica en vez de importarse porque aquí son SECCIONES y allí PASOS, y a partir de
 * esta ráfaga los dos flujos divergen a propósito.
 *
 * EL SEAM DEL VÍDEO PRO, YA USADO. `proStatus` se cableó hasta aquí en UXV.5 para que ese
 * proyecto no tuviera que atravesar la página, el formulario y la sección antes de escribir
 * una línea de vídeo. Ahora se cobra: la sección de vídeo aparece SIEMPRE que la feature
 * esté encendida, y el gate Pro va DENTRO de ella (molde `EstadisticasClient`: candado y
 * «Hazte Pro»). Esconderla a un no-Pro dejaría invisible el beneficio justo a quien hay que
 * convencer — la lección de UXV.6.
 *
 * EL FLAG ES OTRA COSA QUE EL GATE, y por eso decide aquí y no dentro de la sección: apagado,
 * la feature no existe para nadie, ni para un Pro. `videoConfig` ausente = sin datos = no se
 * ofrece, que es el comportamiento correcto también cuando la API no responde.
 */
export function resolveEditSections(
  data: Pick<EditarFormData, 'attributeSchema' | 'availableTags'>,
  proStatus?: ProStatus | null,
  videoConfig?: { enabled: boolean } | null,
): Section[] {
  let secciones = ALL_SECTIONS;
  if (!videoConfig?.enabled) secciones = secciones.filter((s) => s.id !== 'video');
  if (data.attributeSchema.length === 0) secciones = secciones.filter((s) => s.id !== 'atributos');
  if (data.availableTags.length === 0) secciones = secciones.filter((s) => s.id !== 'tags');
  return secciones;
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

/**
 * La validación de cada sección, IDÉNTICA a la que tenía cada paso del wizard. Lo único
 * que cambia es cuándo se ejecuta: antes al pulsar «Siguiente» de ese paso, ahora todas al
 * guardar. Ninguna regla se ha relajado.
 */
function validateSection(id: SectionId, data: EditarFormData): Record<string, string> {
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

    // type es inmutable tras crear (RÁFAGA 1) — siempre viene de initialData.
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

  if (id === 'tags') {
    // Nunca bloquea por falta (no son obligatorios); solo por pasarse del tope. Aquí
    // importa más que en el alta: un anuncio antiguo puede llevar más tags que el tope
    // actual, y este aviso es lo que le dice al vendedor cuántos quitar.
    if (data.tags.length > data.maxTags) {
      errors.tags = `Como máximo ${data.maxTags} etiquetas; el anuncio tiene ${data.tags.length}.`;
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

interface Props {
  listingId: string;
  token: string;
  initialData: EditarFormData;
  /**
   * UXV.5 lo cableó hasta aquí antes de que hiciera falta; el vídeo Pro lo usa para decidir
   * si la sección de vídeo se muestra activa o con su candado.
   */
  proStatus?: ProStatus | null;
  /** Vídeo Pro — configuración vigente. Ausente o apagada: la sección no existe. */
  videoConfig?: VideoConfig | null;
  /** PUERTA regla #3 — topes de fotos vigentes, del backend. Mismo molde que videoConfig. */
  photoLimits: PhotoLimits;
  /** El vídeo que el anuncio ya tiene, si tiene. */
  initialVideo?: VideoState;
}

/**
 * UXV.5 (A4) — EDITAR ≠ PUBLICAR.
 *
 * LO QUE HABÍA: la edición reusaba el wizard del alta. `StepIndicator` no era clicable y
 * «Guardar cambios» solo existía en el ÚLTIMO paso, así que corregir una errata del título
 * obligaba a pulsar «Siguiente» cuatro veces —validando de paso todo lo que hubiera por
 * medio— antes de poder guardar. Y no había ni «Cancelar» ni aviso: salir descartaba en
 * silencio.
 *
 * LO QUE HAY (EDITOR-D1): una página con las secciones apiladas y una barra de guardado
 * fija. El vendedor va a lo que venía a tocar, lo toca y guarda. Publicar sigue siendo un
 * wizard —ahí el usuario NO sabe qué falta y guiarlo tiene sentido—; los dos flujos
 * divergen a propósito, que es justo lo que A4 reprochaba que no ocurriera.
 *
 * Los cinco `Step*` se reusan TAL CUAL: ya eran componentes de presentación que reciben
 * `data`/`onChange`/`errors` y pintan su propio `<h2>`. No se ha reescrito ninguno.
 */
export function EditarForm({
  listingId,
  token,
  initialData,
  proStatus,
  videoConfig,
  initialVideo,
  photoLimits,
}: Props) {
  const router = useRouter();
  const { run } = useApiAction();
  const { loginUrl } = useRequireAuth();

  const [data, setData] = useState<EditarFormData>(initialData);
  // RP.3 — formato con el que se abrió la edición. Se congela al montar para poder enviar
  // `priceUnit` SOLO si el vendedor lo cambia: así una edición que no lo toca no lo
  // revalida contra la categoría, que es el grandfathering que garantiza update() (RP.1).
  const [initialPriceUnit] = useState<PriceUnit>(initialData.priceUnit);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  // El vídeo NO forma parte de : se guarda por su propio flujo (subida prefirmada +
  // confirmación), no con «Guardar cambios». Mezclarlo haría que el aviso de cambios sin
  // guardar mintiera — un vídeo ya subido no es un cambio pendiente.
  const [video, setVideo] = useState<VideoState>(
    initialVideo ?? { videoUrl: null, videoPosterUrl: null },
  );

  const secciones = useMemo(
    () => resolveEditSections(data, proStatus, videoConfig),
    [data, proStatus, videoConfig],
  );
  const refs = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});

  const guard = useUnsavedChanges(dirty);

  // ── State helpers ────────────────────────────────────────────────────────

  function update(patch: Partial<EditarFormData>) {
    setDirty(true);
    setData((prev) => ({ ...prev, ...patch }));
  }

  function updateImages(updater: UploadedImage[] | ((prev: UploadedImage[]) => UploadedImage[])) {
    setDirty(true);
    setData((prev) => ({
      ...prev,
      images: typeof updater === 'function' ? updater(prev.images) : updater,
    }));
  }

  function irASeccion(id: SectionId) {
    refs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── Submit ───────────────────────────────────────────────────────────────

  async function handleSave() {
    // TODAS las secciones se validan, no solo la que el usuario tocó: guardar envía el
    // anuncio entero, así que un dato inválido en una sección que ni abrió lo rechazaría
    // el backend igualmente. Mejor decírselo aquí y llevarle al sitio.
    const errs: Record<string, string> = {};
    let primeraConError: SectionId | null = null;
    for (const s of secciones) {
      const e = validateSection(s.id, data);
      if (Object.keys(e).length > 0 && !primeraConError) primeraConError = s.id;
      Object.assign(errs, e);
    }
    setErrors(errs);
    if (primeraConError) {
      irASeccion(primeraConError);
      return;
    }

    setSaving(true);
    setSaveError(null);

    await run(
      async () => {
        const validImageIds = data.images
          .filter((img) => img.id && !img.error && !img.uploading)
          .map((img) => img.id!);

        const nextPriceUnit: PriceUnit = data.priceMode === 'free' ? 'ONE_TIME' : data.priceUnit;

        await updateListing(
          listingId,
          {
            title: data.title,
            description: data.description,
            condition: data.condition ? (data.condition as Condition) : undefined,
            price: data.priceMode === 'fixed' ? parseFloat(data.price) : 0,
            priceType: priceTypeFromMode(data.priceMode),
            // Igual que en el alta, "Gratis" no lleva formato. Y solo se envía si CAMBIÓ
            // (ver initialPriceUnit).
            ...(nextPriceUnit !== initialPriceUnit && { priceUnit: nextPriceUnit }),
            attributes: buildAttributes(
              data.attributes,
              filterSchemaByType(data.attributeSchema, data.type),
            ),
            // B2 — se envían SIEMPRE (no solo si cambian, a diferencia de priceUnit): el DTO
            // trata `tags` como reemplazo completo, así que omitirlos dejaría intactos los
            // que hubiera y una deselección no se guardaría nunca.
            tags: data.tags,
            city: data.city,
            province: data.province,
            postalCode: data.postalCode || undefined,
            phone: data.phone.trim(),
            imageIds: validImageIds,
          },
          token,
        );

        // Antes de navegar: si no, el guard de cambios sin guardar interceptaría su propia
        // salida y preguntaría por unos cambios que acaban de guardarse.
        setDirty(false);
        router.push('/mis-anuncios');
      },
      {
        // UXV.3 — canal común. Guardar terminaba en silencio: se navegaba al listado y el
        // usuario deducía que había ido bien porque no había error.
        successMessage: 'Cambios guardados.',
        onError: (err) => {
          setSaveError(toUserMessage(err));
          setSaving(false);
        },
        callbackUrl: loginUrl,
      },
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const hayErrores = Object.keys(errors).length > 0;

  return (
    <div className="mx-auto max-w-2xl pb-24">
      {data.categoryName && (
        <p className="mb-4 text-sm text-muted-foreground">
          Categoría: <span className="font-medium text-foreground">{data.categoryName}</span>
        </p>
      )}

      {/* Índice de secciones: sustituye al StepIndicator, que era puro display y NO
          clicable — es decir, enseñaba el camino sin dejarte tomar atajos. Aquí cada
          entrada lleva a su sección. */}
      <nav className="mb-6 flex flex-wrap gap-2 border-b pb-4" aria-label="Secciones del anuncio">
        {secciones.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => irASeccion(s.id)}
            className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="space-y-6">
        {secciones.map((s) => (
          <section
            key={s.id}
            ref={(el) => {
              refs.current[s.id] = el;
            }}
            data-testid={`seccion-${s.id}`}
            className="scroll-mt-24 rounded-xl border bg-card p-6 shadow-sm"
          >
            {s.id === 'fotos' && (
              <StepFotos
                images={data.images}
                token={token}
                onChange={updateImages}
                errors={errors}
                maxPhotos={photoLimits.max}
                minPhotos={photoLimits.min}
                minEnforced={photoLimits.minEnforced}
              />
            )}

            {s.id === 'video' && videoConfig && (
              <StepVideo
                listingId={listingId}
                token={token}
                config={videoConfig}
                isPro={Boolean(proStatus?.isPro)}
                video={video}
                onChange={setVideo}
              />
            )}

            {s.id === 'datos' && (
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
                onChange={(patch) => update(patch as Partial<EditarFormData>)}
                errors={errors}
                readOnlyType
                allowedPriceUnits={data.allowedPriceUnits}
              />
            )}

            {s.id === 'atributos' && (
              <StepAtributos
                schema={filterSchemaByType(data.attributeSchema, data.type)}
                values={data.attributes}
                onChange={(attrs) => update({ attributes: attrs })}
                errors={errors}
              />
            )}

            {s.id === 'tags' && (
              <StepTags
                available={data.availableTags}
                selected={data.tags}
                max={data.maxTags}
                onChange={(tags) => update({ tags })}
                errors={errors}
              />
            )}

            {s.id === 'ubicacion' && (
              <StepUbicacion
                data={{
                  city: data.city,
                  province: data.province,
                  postalCode: data.postalCode,
                  phone: data.phone,
                }}
                onChange={(patch) => update(patch as Partial<EditarFormData>)}
                errors={errors}
              />
            )}
          </section>
        ))}
      </div>

      {/*
        BARRA DE GUARDADO FIJA — el corazón de A4. Antes «Guardar cambios» solo existía al
        final del wizard; ahora está siempre a la vista, se haya tocado la sección que se
        haya tocado. `sticky bottom-0` y no `fixed`: así vive dentro de la columna de
        contenido del shell (UXV.2) y no se solapa con el menú lateral ni con el drawer.
      */}
      <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 border-t bg-background/95 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <Button onClick={handleSave} disabled={saving} data-testid="guardar-cambios">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar cambios
        </Button>
        <Button
          variant="outline"
          disabled={saving}
          onClick={() => guard.requestNavigation('/mis-anuncios')}
          data-testid="cancelar-edicion"
        >
          Cancelar
        </Button>

        {dirty && !saving && (
          <span className="text-xs text-muted-foreground" data-testid="aviso-sin-guardar">
            Tienes cambios sin guardar.
          </span>
        )}

        {(saveError || hayErrores) && (
          <p className="flex basis-full items-center gap-1.5 text-sm text-destructive">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {saveError ?? 'Revisa los campos marcados antes de guardar.'}
          </p>
        )}
      </div>

      {/* Salir con cambios pendientes: pregunta en vez de descartar en silencio. */}
      <AlertDialog
        open={guard.pendingHref !== null}
        onOpenChange={(o) => !o && guard.cancelNavigation()}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Salir sin guardar?</AlertDialogTitle>
            <AlertDialogDescription>
              Has hecho cambios en este anuncio que todavía no se han guardado. Si sales ahora,
              se pierden.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={guard.confirmNavigation}
            >
              Salir y descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
