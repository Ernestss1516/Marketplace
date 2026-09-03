'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AlertCircle, CheckCircle2, ExternalLink, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import { getAdminHomepage, updateHomepage } from '@/lib/api/homepage-admin';
import { isSafeContentUrl } from '@/lib/blocks/validation';
import type { HomeBlock } from '@/types/home-blocks';
import { HeroEditor, MAX_ROTATING, type HeroValues } from './_components/HeroEditor';
import { HomeBlockEditor } from './_components/HomeBlockEditor';
import { PortadaPreview } from './_components/PortadaPreview';

/**
 * Editor de la portada — `/admin/portada`. Solo ADMIN.
 *
 * DOS ZONAS, y esa separación no es de maquetación: **el hero es campo propio de
 * la configuración, no un bloque** (docs/diseno-portada.md §2.3 y §9). Sacarlo
 * del array es lo que permite que ningún bloque conozca su posición y que el
 * `switch` con `assertUnreachable` del renderizador siga siendo homogéneo. Aquí
 * eso se ve: el hero no se puede mover ni quitar, los bloques sí.
 *
 * UN SOLO BOTÓN DE GUARDAR que manda la config entera (hero + array), porque los
 * bloques no son filas sino un Json de una fila — mismo contrato que el submit
 * de `PostForm` en el blog. Guardar dispara `revalidateTag('homepage-config')`
 * en el backend, así que la portada refleja el cambio sin reiniciar nada.
 *
 * SIN borrador/publicado (decisión 2 del diseño): guardar ES publicar. Por eso
 * el preview de arriba es obligatorio y no un extra.
 */

const MIN_MS = 1500;
const MAX_MS = 10000;

interface FormState extends HeroValues {
  blocks: HomeBlock[];
}

const EMPTY: FormState = {
  heroStaticTitle: '',
  heroRotatingOptions: [],
  heroRotationMs: 3000,
  heroSubtitle: '',
  blocks: [],
};

/**
 * Lo que impediría un 400. El backend sigue siendo la fuente de verdad — esto
 * solo evita el viaje de ida y vuelta y dice DÓNDE está el problema.
 */
function validate(values: FormState): string | null {
  if (!values.heroStaticTitle.trim()) {
    return 'El título fijo del hero no puede estar vacío.';
  }
  if (values.heroRotatingOptions.length > MAX_ROTATING) {
    return `Como mucho ${MAX_ROTATING} palabras rotativas.`;
  }
  if (values.heroRotationMs < MIN_MS || values.heroRotationMs > MAX_MS) {
    return `La velocidad debe estar entre ${MIN_MS} y ${MAX_MS} ms.`;
  }
  for (const block of values.blocks) {
    if (block.type === 'cta') {
      if (!block.label.trim() || !block.href.trim()) {
        return 'Hay un botón destacado sin texto o sin enlace.';
      }
      if (!isSafeContentUrl(block.href)) {
        return 'Hay un botón destacado con un enlace no válido.';
      }
    }

    if (block.type === 'grid') {
      for (const cell of block.items) {
        // AJUSTE 6 — se invirtió qué falta hace: el TEXTO ya no es obligatorio (una tarjeta
        // puede ser sólo una imagen) y el MEDIA sí lo es. Este aviso se adelanta al 400 del
        // backend, que es lo único que vería el admin si la comprobación no estuviera aquí —
        // y le pasaría a una portada guardada ANTES del ajuste, con tarjetas sin media.
        if (!cell.media) return 'Hay una tarjeta de la rejilla sin imagen ni icono.';
        if (cell.href && !isSafeContentUrl(cell.href)) {
          return 'Hay una tarjeta de la rejilla con un enlace no válido.';
        }
        if (cell.media?.kind === 'image') {
          if (!cell.media.url) return 'Hay una tarjeta a la que le falta subir la imagen.';
          // El alt no es opcional: sin él la imagen es invisible para quien no
          // la ve, y el backend lo rechaza igualmente.
          if (!cell.media.alt.trim()) {
            return 'Hay una imagen de la rejilla sin texto alternativo.';
          }
        }
      }
    }

    if (block.type === 'categoryCarousel') {
      for (const item of block.items) {
        if (!item.categorySlug) return 'Hay una categoría del carrusel sin elegir.';
        if (!item.imageUrl) return 'Hay una categoría del carrusel a la que le falta la foto.';
        if (!item.alt.trim()) return 'Hay una foto del carrusel sin texto alternativo.';
      }
    }

    if (block.type === 'steps') {
      for (const column of block.columns) {
        if (!column.audienceTitle.trim()) return 'Hay una columna de pasos sin público.';
        for (const step of column.steps) {
          if (!step.title.trim() || !step.description.trim()) {
            return 'Hay un paso sin título o sin explicación.';
          }
        }
        if (column.cta) {
          // O los dos campos o ninguno: un enlace sin texto no se puede pintar.
          if (!column.cta.label.trim() || !column.cta.href.trim()) {
            return 'Hay un enlace de columna al que le falta el texto o la dirección.';
          }
          if (!isSafeContentUrl(column.cta.href)) {
            return 'Hay un enlace de columna con una dirección no válida.';
          }
        }
      }
    }
  }
  return null;
}

export default function AdminPortadaPage() {
  const { data: session } = useSession();
  const token = (session?.user as { accessToken?: string } | undefined)?.accessToken;

  const [values, setValues] = useState<FormState>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);

  const fetchConfig = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    try {
      const config = await getAdminHomepage(token);
      setValues({
        heroStaticTitle: config.heroStaticTitle,
        heroRotatingOptions: config.heroRotatingOptions,
        heroRotationMs: config.heroRotationMs,
        heroSubtitle: config.heroSubtitle ?? '',
        blocks: config.blocks,
      });
      setDirty(false);
    } catch (err) {
      setLoadError(
        err instanceof ApiError
          ? `Error ${err.statusCode}: ${err.message}`
          : 'Error al cargar la portada',
      );
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  function patch(p: Partial<FormState>) {
    setValues((prev) => ({ ...prev, ...p }));
    setDirty(true);
    setSaved(false);
  }

  const validationError = validate(values);

  async function handleSave() {
    if (!token || validationError) return;
    setSaving(true);
    setSaveError(null);
    try {
      const config = await updateHomepage(token, {
        heroStaticTitle: values.heroStaticTitle.trim(),
        heroRotatingOptions: values.heroRotatingOptions.map((o) => o.trim()).filter(Boolean),
        heroRotationMs: values.heroRotationMs,
        // Vacío = se borra: el cuerpo es un reemplazo completo, no un parche.
        heroSubtitle: values.heroSubtitle.trim() || undefined,
        blocks: values.blocks,
      });
      // Se repuebla con lo que devolvió el servidor, no con lo que se mandó: si
      // el backend normalizó algo (recortes, opciones vacías descartadas), lo
      // que se ve es lo que quedó guardado de verdad.
      setValues({
        heroStaticTitle: config.heroStaticTitle,
        heroRotatingOptions: config.heroRotatingOptions,
        heroRotationMs: config.heroRotationMs,
        heroSubtitle: config.heroSubtitle ?? '',
        blocks: config.blocks,
      });
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setSaveError(
        err instanceof ApiError
          ? `Error ${err.statusCode}: ${err.message}`
          : 'Error al guardar la portada',
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground">Cargando portada...</p>;
  }

  if (loadError) {
    return (
      <div className="space-y-3">
        <p className="flex items-center gap-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" />
          {loadError}
        </p>
        <Button variant="outline" size="sm" onClick={() => void fetchConfig()}>
          Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Portada</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lo que se guarda aquí es lo que se publica: la portada no tiene borrador.
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link href="/" target="_blank" rel="noopener noreferrer">
            Ver portada <ExternalLink className="ml-1 h-3 w-3" />
          </Link>
        </Button>
      </div>

      <PortadaPreview
        heroStaticTitle={values.heroStaticTitle}
        heroRotatingOptions={values.heroRotatingOptions}
        heroRotationMs={values.heroRotationMs}
        heroSubtitle={values.heroSubtitle}
        blocks={values.blocks}
      />

      {/* ── ZONA 1: el hero ─────────────────────────────────────────────── */}
      <section className="space-y-3 rounded-md border p-4" data-testid="zona-hero">
        <div>
          <h2 className="text-sm font-semibold">Titular</h2>
          <p className="text-xs text-muted-foreground">
            Siempre va el primero y no se puede quitar: es el encabezado de la página.
          </p>
        </div>
        <HeroEditor
          values={values}
          onChange={(p) => patch(p)}
          disabled={saving}
        />
      </section>

      {/* ── ZONA 2: los bloques ─────────────────────────────────────────── */}
      <section className="space-y-3 rounded-md border p-4" data-testid="zona-bloques">
        <div>
          <h2 className="text-sm font-semibold">Bloques</h2>
          <p className="text-xs text-muted-foreground">
            Se muestran bajo el titular, en este orden. Muévelos con las flechas.
          </p>
        </div>
        <HomeBlockEditor
          blocks={values.blocks}
          onChange={(blocks) => patch({ blocks })}
          // El token baja hasta los editores que suben imágenes (rejilla).
          token={token}
          disabled={saving}
        />
      </section>

      {/* ── Guardar ─────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 border-t pt-4">
        <Button
          onClick={() => void handleSave()}
          disabled={saving || !!validationError || !dirty}
          data-testid="guardar-portada"
        >
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Guardar portada
        </Button>

        {validationError && (
          <p className="flex items-center gap-1 text-sm text-destructive" data-testid="portada-validacion">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {validationError}
          </p>
        )}
        {!validationError && !dirty && !saved && (
          <span className="text-sm text-muted-foreground">Sin cambios sin guardar.</span>
        )}
        {saved && (
          <span className="flex items-center gap-1 text-sm text-success-foreground" data-testid="portada-guardada">
            <CheckCircle2 className="h-4 w-4" /> Guardado. La portada ya lo muestra.
          </span>
        )}
        {saveError && (
          <p className="flex items-center gap-1 text-sm text-destructive" data-testid="portada-error">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {saveError}
          </p>
        )}
      </div>
    </div>
  );
}
