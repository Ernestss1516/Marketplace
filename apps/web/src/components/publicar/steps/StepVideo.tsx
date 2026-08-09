'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { Film, Loader2, Lock, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useApiAction } from '@/lib/api/use-api-action';
import {
  captureVideoPoster,
  confirmVideo,
  createVideoUploadUrl,
  putToStorage,
  readVideoFileInfo,
  removeVideo,
  uploadPoster,
  validateVideoFile,
  type VideoConfig,
} from '@/lib/api/video';

/**
 * La sección VÍDEO del editor (vídeo Pro, ráfaga 2).
 *
 * ENTRA POR EL SEAM QUE UXV.5 DEJÓ ESCRITO en `EditarForm`, que ya cableó `proStatus` hasta
 * aquí precisamente para esto.
 *
 * EL GATE SE VE, NO SE ESCONDE (molde `EstadisticasClient`): un no-Pro encuentra la sección
 * con su candado y su enlace a los planes. Esconderla dejaría invisible el beneficio justo a
 * quien hay que convencer — la lección de UXV.6. El FLAG es otra cosa: si la feature está
 * apagada, la sección no existe para nadie, y de eso se encarga `resolveEditSections`.
 *
 * LA SUBIDA NO PASA POR LA API. El navegador pide una firma, sube directo al almacenamiento
 * y luego confirma; el anuncio solo queda marcado con vídeo cuando la subida ha terminado
 * bien, así que un fallo a mitad no lo deja a medias.
 */

export interface VideoState {
  videoUrl: string | null;
  videoPosterUrl: string | null;
}

interface Props {
  listingId: string;
  token: string;
  config: VideoConfig;
  isPro: boolean;
  video: VideoState;
  onChange: (v: VideoState) => void;
}

type Fase = 'idle' | 'leyendo' | 'subiendo' | 'confirmando';

export function StepVideo({ listingId, token, config, isPro, video, onChange }: Props) {
  const { run } = useApiAction();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fase, setFase] = useState<Fase>('idle');
  const [progreso, setProgreso] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const ocupado = fase !== 'idle';

  // ── El gate Pro, visible ───────────────────────────────────────────────────
  if (!isPro) {
    return (
      <div>
        <Cabecera />
        <div
          className="mt-4 flex flex-col items-center gap-3 rounded-lg border border-dashed p-6 text-center"
          data-testid="video-gate-pro"
        >
          <Lock className="h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            Añadir un vídeo a tus anuncios es una ventaja del plan Pro.
          </p>
          <Button asChild size="sm">
            <Link href="/planes">Hazte Pro</Link>
          </Button>
        </div>
      </div>
    );
  }

  async function subir(file: File) {
    setError(null);

    // 1. Rechazo TEMPRANO en el cliente. Mejor un «no» inmediato que cinco minutos de
    //    subida desde el móvil para acabar en el mismo «no».
    const problema = validateVideoFile(file, config);
    if (problema) {
      setError(problema);
      return;
    }

    setFase('leyendo');
    let info;
    try {
      // La duración REAL, que solo se puede medir aquí (el servidor no lee el fichero).
      info = await readVideoFileInfo(file);
    } catch (e) {
      setFase('idle');
      setError(e instanceof Error ? e.message : 'No hemos podido leer el vídeo.');
      return;
    }
    if (info.durationSeconds > config.maxDurationSeconds) {
      setFase('idle');
      setError(
        `El vídeo dura ${info.durationSeconds} s y el máximo son ${config.maxDurationSeconds} s. ` +
          'Recórtalo desde la galería de tu móvil y vuelve a intentarlo.',
      );
      return;
    }

    // 2. El póster, antes de subir: si falla, se sigue sin él (la ficha usará la portada).
    const poster = await captureVideoPoster(file);

    setFase('subiendo');
    setProgreso(0);

    await run(
      async () => {
        // 3. FIRMAR — el servidor revalida todo y devuelve un permiso acotado.
        const firma = await createVideoUploadUrl(token, {
          listingId,
          contentType: file.type,
          sizeBytes: file.size,
          durationSeconds: info.durationSeconds,
        });

        // 4. SUBIR DIRECTO al almacenamiento. Los bytes no pasan por la API.
        await putToStorage(firma.uploadUrl, file, firma.requiredHeaders, setProgreso);

        const posterUrl = poster ? await uploadPoster(token, poster) : undefined;

        // 5. CONFIRMAR — solo ahora el anuncio queda marcado con vídeo.
        setFase('confirmando');
        return confirmVideo(token, listingId, {
          key: firma.key,
          durationSeconds: info.durationSeconds,
          posterUrl,
        });
      },
      {
        successMessage: 'Vídeo guardado. Ya se verá en tu anuncio.',
        onSuccess: (res) => {
          onChange({ videoUrl: res.videoUrl, videoPosterUrl: res.videoPosterUrl });
        },
        // Inline y no toast: el error pertenece a esta sección y sacarlo de aquí lo
        // separaría de lo que el usuario está mirando (regla FEEDBACK-D2 de UXV.3).
        onError: (err) => setError(err instanceof Error ? err.message : 'No se pudo subir el vídeo.'),
      },
    );

    setFase('idle');
    setProgreso(0);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function quitar() {
    setError(null);
    setFase('confirmando');
    await run(() => removeVideo(token, listingId), {
      successMessage: 'Vídeo quitado del anuncio.',
      onSuccess: () => onChange({ videoUrl: null, videoPosterUrl: null }),
      onError: (err) => setError(err instanceof Error ? err.message : 'No se pudo quitar el vídeo.'),
    });
    setFase('idle');
  }

  return (
    <div data-testid="seccion-video-contenido">
      <Cabecera />

      {/* UN vídeo por anuncio: si ya hay, esto REEMPLAZA. No se acumulan. */}
      {video.videoUrl && (
        <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border p-3">
          <div className="relative h-20 w-32 shrink-0 overflow-hidden rounded bg-muted">
            {video.videoPosterUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- póster de storage propio; el visor real llega en la ráfaga de visualización
              <img src={video.videoPosterUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center">
                <Film className="h-6 w-6 text-muted-foreground" aria-hidden />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Este anuncio ya tiene vídeo.</p>
            <p className="text-xs text-muted-foreground">
              Si subes otro, sustituirá al actual: solo se muestra uno por anuncio.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={quitar}
            disabled={ocupado}
            data-testid="video-quitar"
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Quitar
          </Button>
        </div>
      )}

      <div className="mt-4">
        <input
          ref={inputRef}
          type="file"
          accept={config.allowedMimeTypes.join(',')}
          className="sr-only"
          data-testid="video-input"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void subir(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          disabled={ocupado}
          onClick={() => inputRef.current?.click()}
          data-testid="video-elegir"
        >
          {ocupado ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          {video.videoUrl ? 'Sustituir el vídeo' : 'Subir un vídeo'}
        </Button>

        {fase === 'subiendo' && (
          <div className="mt-3" data-testid="video-progreso">
            <div className="h-2 w-full overflow-hidden rounded bg-muted">
              <div
                className="h-full bg-primary transition-[width]"
                style={{ width: `${progreso}%` }}
              />
            </div>
            {/* Vídeo es pesado: una barra que no se mueve es indistinguible de una app colgada. */}
            <p className="mt-1 text-xs text-muted-foreground">Subiendo… {progreso}%</p>
          </div>
        )}
        {fase === 'confirmando' && (
          <p className="mt-3 text-xs text-muted-foreground">Guardando…</p>
        )}
        {fase === 'leyendo' && (
          <p className="mt-3 text-xs text-muted-foreground">Comprobando el vídeo…</p>
        )}

        {error && (
          <p className="mt-3 text-sm text-destructive" data-testid="video-error">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

function Cabecera() {
  return (
    <>
      <h2 className="text-lg font-semibold">Vídeo</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Un vídeo corto enseñando el artículo. Máximo 60 segundos, en MP4 — que es lo que graba
        tu móvil.
      </p>
    </>
  );
}
