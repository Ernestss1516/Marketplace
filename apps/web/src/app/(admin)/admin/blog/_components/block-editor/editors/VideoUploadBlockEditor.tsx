'use client';

import type { VideoUploadBlock } from '@/types/blocks';
import { VideoUploadField } from '@/components/media/VideoUploadField';
import { inputCls, labelCls } from './shared';

/**
 * El editor del bloque VÍDEO SUBIDO.
 *
 * FINO A PROPÓSITO: toda la subida —el rechazo temprano, el póster, la firma, el PUT con
 * progreso y el confirm— vive en `VideoUploadField`, que el editor de la portada monta igual.
 * Aquí sólo queda lo que es de ESTE motor: el tipo del bloque y su `onChange`.
 *
 * NO SE PARECE AL EDITOR DEL VÍDEO INCRUSTADO, y no tienen por qué: aquel pide una URL de
 * YouTube y la parsea a `{provider, videoId}`; éste sube un fichero. Son dos bloques
 * distintos, y por eso conviven en el selector en vez de ser uno con un interruptor dentro.
 */
export function VideoUploadBlockEditor({
  block,
  onChange,
  token,
  disabled,
}: {
  block: VideoUploadBlock;
  onChange: (patch: Partial<VideoUploadBlock>) => void;
  token: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      <VideoUploadField
        value={{ url: block.url, poster: block.poster }}
        onChange={(patch) => onChange(patch)}
        token={token}
        disabled={disabled}
      />

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Pie de vídeo (opcional)</label>
        <input
          type="text"
          value={block.caption ?? ''}
          onChange={(e) => onChange({ caption: e.target.value || undefined })}
          className={inputCls}
          disabled={disabled}
          placeholder="Un texto corto debajo del vídeo"
          data-testid="block-video-caption"
        />
      </div>
    </div>
  );
}
