import type { VideoBlock } from '@/types/blocks';

// Nunca se guardó ni se guarda una URL cruda ni un iframe libre — solo
// {provider, videoId}, ya revalidados por el backend. El src del iframe se
// construye aquí, controlado, a partir de esos dos campos únicamente.
function buildEmbedSrc(block: VideoBlock): string {
  if (block.provider === 'youtube') {
    return `https://www.youtube-nocookie.com/embed/${block.videoId}`;
  }
  return `https://player.vimeo.com/video/${block.videoId}`;
}

export function VideoBlockRenderer({ block }: { block: VideoBlock }) {
  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg bg-muted">
      <iframe
        src={buildEmbedSrc(block)}
        className="h-full w-full"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
        title="Vídeo incrustado"
      />
    </div>
  );
}
