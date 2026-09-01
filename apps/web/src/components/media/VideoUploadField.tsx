'use client';

import { useRef, useState } from 'react';
import { AlertCircle, Loader2, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VideoPlayer } from '@/components/media/VideoPlayer';
import { captureVideoPoster } from '@/lib/media/upload';
import {
  BLOCK_VIDEO_MIME_TYPES,
  uploadBlockMedia,
  validateBlockVideoFile,
} from '@/lib/api/block-media';

/** Lo que el control devuelve al bloque que lo monta. */
export interface VideoUploadValue {
  url: string;
  poster?: string;
}

/**
 * EL CONTROL DE SUBIDA DEL VÍDEO DE BLOQUE — uno, para los dos motores.
 *
 * POR QUÉ SE COMPARTE, cuando los editores de bloque nunca se comparten. La regla del
 * proyecto (cabecera de `types/home-blocks.ts`, `diseno-portada.md` §4.0) es exacta: *se
 * comparte todo componente cuya firma NO mencione un tipo de bloque*. Ésta no lo menciona —
 * recibe una URL y un póster y devuelve una URL y un póster—, así que puede cruzar la
 * frontera igual que la cruza `VideoPlayer`. Los editores que lo montan sí son dos, uno por
 * motor, cada uno con su `onChange` tipado.
 *
 * Y AQUÍ SÍ HABÍA QUE COMPARTIR, no como en el backend: allí el *servicio* de subida se
 * escribió aparte porque su gate y su clave eran irreductibles (§2 del diseño). Esto es lo
 * contrario — la misma coreografía exacta contra el mismo endpoint—, y copiarla dos veces
 * habría duplicado el mecanismo del presign, que es el error que el diseño nombra al lado
 * del otro.
 *
 * LA COREOGRAFÍA, y el paso que deliberadamente NO da:
 *   1. Rechazo TEMPRANO en el cliente (tipo y tamaño). Mejor un «no» inmediato que 50 MB de
 *      subida para acabar en el mismo «no».
 *   2. El PÓSTER, capturado del propio fichero antes de subir — es el único momento en que
 *      está en memoria del navegador. Si falla, se sigue sin él.
 *   3. Firmar → PUT directo al almacenamiento con barra de progreso → confirmar.
 *   4. **No promociona nada.** La URL que guarda es la TEMPORAL; sacarla de `tmp/` es cosa
 *      del backend al guardar el post o la portada. Si el cliente lo hiciera, la regla de qué
 *      es definitivo viviría en dos sitios.
 */
export function VideoUploadField({
  value,
  onChange,
  token,
  disabled,
  testIdPrefix = 'block-video',
}: {
  value: VideoUploadValue;
  onChange: (patch: Partial<VideoUploadValue>) => void;
  token: string;
  disabled?: boolean;
  testIdPrefix?: string;
}) {
  const [fase, setFase] = useState<'idle' | 'leyendo' | 'subiendo' | 'confirmando'>('idle');
  const [progreso, setProgreso] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const ocupado = fase !== 'idle';

  async function subir(file: File) {
    setError(null);

    const problema = validateBlockVideoFile(file);
    if (problema) {
      setError(problema);
      return;
    }

    // El póster, antes de subir: si falla se sigue sin él. Sin póster se vive —el
    // reproductor enseña un rectángulo hasta que alguien pulsa play—, sin vídeo no.
    setFase('leyendo');
    const poster = await captureVideoPoster(file);

    setFase('subiendo');
    setProgreso(0);
    try {
      const url = await uploadBlockMedia(token, file, 'video', setProgreso);

      setFase('confirmando');
      // El póster va por su propio camino prefirmado, bajo la MISMA raíz que el vídeo: así
      // el pase de promoción del backend se lleva los dos con el mismo recorrido, y si el
      // editor se abandona los dos caducan juntos. Si falla, el vídeo se guarda igual.
      let posterUrl: string | undefined;
      if (poster) {
        try {
          posterUrl = await uploadBlockMedia(token, poster, 'poster');
        } catch {
          posterUrl = undefined;
        }
      }

      onChange({ url, poster: posterUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo subir el vídeo.');
    } finally {
      setFase('idle');
      setProgreso(0);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted-foreground">Vídeo *</span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileRef.current?.click()}
            disabled={disabled || ocupado}
            data-testid={`${testIdPrefix}-subir`}
          >
            {ocupado ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {value.url ? 'Sustituir el vídeo' : 'Subir un vídeo'}
          </Button>

          {value.url && !ocupado && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange({ url: '', poster: undefined })}
              disabled={disabled}
              data-testid={`${testIdPrefix}-quitar`}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Quitar
            </Button>
          )}

          <input
            ref={fileRef}
            type="file"
            accept={BLOCK_VIDEO_MIME_TYPES.join(',')}
            className="hidden"
            data-testid={`${testIdPrefix}-input`}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void subir(file);
            }}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          MP4, hasta 50 MB. El vídeo no queda guardado hasta que guardes la página.
        </p>
      </div>

      {fase === 'subiendo' && (
        <div data-testid={`${testIdPrefix}-progreso`}>
          <div className="h-2 w-full overflow-hidden rounded bg-muted">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${progreso}%` }} />
          </div>
          {/* Un vídeo es pesado: una barra que no se mueve es indistinguible de una
              aplicación colgada. Es la razón entera de que el PUT use XHR y no fetch. */}
          <p className="mt-1 text-xs text-muted-foreground">Subiendo… {progreso}%</p>
        </div>
      )}
      {fase === 'leyendo' && <p className="text-xs text-muted-foreground">Preparando el vídeo…</p>}
      {fase === 'confirmando' && <p className="text-xs text-muted-foreground">Comprobando…</p>}

      {error && (
        <p
          className="flex items-center gap-1 text-xs text-destructive"
          data-testid={`${testIdPrefix}-error`}
        >
          <AlertCircle className="h-3 w-3 shrink-0" />
          {error}
        </p>
      )}

      {value.url && !ocupado && (
        <VideoPlayer
          src={value.url}
          poster={value.poster}
          className="max-h-56 w-auto rounded-md border"
          testId={`${testIdPrefix}-preview`}
        />
      )}
    </div>
  );
}
