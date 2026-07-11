'use client';

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type { VideoBlock } from '@/types/blocks';
import { parseVideoUrl } from '@/lib/blocks/validation';
import { VideoBlockRenderer } from '@/components/blocks/VideoBlockRenderer';
import { inputCls, labelCls, errorCls } from './shared';

function reconstructUrl(block: VideoBlock): string {
  if (!block.videoId) return '';
  return block.provider === 'youtube'
    ? `https://www.youtube.com/watch?v=${block.videoId}`
    : `https://vimeo.com/${block.videoId}`;
}

// El admin pega la URL tal cual la copió de YouTube/Vimeo — el cliente la
// parsea a {provider, videoId} (nunca se guarda la URL cruda) y muestra el
// preview con el MISMO VideoBlockRenderer que usa el sitio público. Si la
// URL no se reconoce, error claro en vez de guardar algo roto — el backend
// revalida el formato de todas formas (ver VideoBlockDto).
export function VideoBlockEditor({
  block,
  onChange,
  disabled,
}: {
  block: VideoBlock;
  onChange: (patch: Partial<VideoBlock>) => void;
  disabled?: boolean;
}) {
  const [rawUrl, setRawUrl] = useState(() => reconstructUrl(block));
  const [parseError, setParseError] = useState<string | null>(null);

  function handleUrlChange(value: string) {
    setRawUrl(value);
    if (!value.trim()) {
      setParseError(null);
      return;
    }
    const parsed = parseVideoUrl(value);
    if (parsed) {
      onChange(parsed);
      setParseError(null);
    } else {
      setParseError('No reconocemos esta URL como de YouTube o Vimeo. Copia el enlace tal cual desde el navegador o la app.');
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1">
        <label className={labelCls}>URL de YouTube o Vimeo *</label>
        <input
          type="text"
          value={rawUrl}
          onChange={(e) => handleUrlChange(e.target.value)}
          className={inputCls}
          disabled={disabled}
          placeholder="https://www.youtube.com/watch?v=... o https://vimeo.com/..."
        />
        {parseError && (
          <p className={errorCls}>
            <AlertCircle className="h-3 w-3 shrink-0" />
            {parseError}
          </p>
        )}
      </div>

      {block.videoId && !parseError && (
        <div className="max-w-md">
          <p className="mb-1 text-xs text-muted-foreground">Preview:</p>
          <VideoBlockRenderer block={block} />
        </div>
      )}
    </div>
  );
}
