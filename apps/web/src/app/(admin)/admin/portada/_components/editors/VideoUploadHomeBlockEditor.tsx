'use client';

import type { HomeVideoUploadBlock } from '@/types/home-blocks';
import { VideoUploadField } from '@/components/media/VideoUploadField';
import { inputCls, labelCls } from './shared';

/**
 * El editor del bloque VÍDEO SUBIDO de la portada. Hermano del del blog y, como él, fino: la
 * subida entera vive en `VideoUploadField`, compartido — su firma no menciona ningún tipo de
 * bloque, que es la condición para cruzar la frontera entre los dos motores.
 *
 * `token` es opcional en los editores de portada (así lo declara `HomeBlockEditorRow`), pero
 * subir sin él no es posible: sin sesión no hay firma. Cuando falta, el control no se monta y
 * se dice por qué, en vez de ofrecer un botón que fallaría al pulsarlo.
 */
export function VideoUploadHomeBlockEditor({
  block,
  onChange,
  token,
  disabled,
}: {
  block: HomeVideoUploadBlock;
  onChange: (patch: Partial<HomeVideoUploadBlock>) => void;
  token?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-3">
      {token ? (
        <VideoUploadField
          value={{ url: block.url, poster: block.poster }}
          onChange={(patch) => onChange(patch)}
          token={token}
          disabled={disabled}
          testIdPrefix="home-block-video"
        />
      ) : (
        <p className="text-xs text-muted-foreground">
          Vuelve a entrar para poder subir un vídeo.
        </p>
      )}

      <div className="flex flex-col gap-1">
        <label className={labelCls}>Pie de vídeo (opcional)</label>
        <input
          type="text"
          value={block.caption ?? ''}
          onChange={(e) => onChange({ caption: e.target.value || undefined })}
          className={inputCls}
          disabled={disabled}
          placeholder="Un texto corto debajo del vídeo"
          data-testid="home-block-video-caption"
        />
      </div>
    </div>
  );
}
