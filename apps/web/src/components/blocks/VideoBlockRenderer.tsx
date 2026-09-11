'use client';

import type { VideoBlock } from '@/types/blocks';
import { GateTerceros } from '@/components/consentimiento/GateTerceros';

// Nunca se guardó ni se guarda una URL cruda ni un iframe libre — solo
// {provider, videoId}, ya revalidados por el backend. El src del iframe se
// construye aquí, controlado, a partir de esos dos campos únicamente.
function buildEmbedSrc(block: VideoBlock): string {
  if (block.provider === 'youtube') {
    return `https://www.youtube-nocookie.com/embed/${block.videoId}`;
  }
  return `https://player.vimeo.com/video/${block.videoId}`;
}

/** El nombre con el que el marcador presenta al tercero. Sin nombre no hay consentimiento informado. */
function nombreProveedor(block: VideoBlock): string {
  return block.provider === 'youtube' ? 'YouTube' : 'Vimeo';
}

/**
 * COOKIES RÁFAGA 1 — EL IFRAME NO SE MONTA HASTA CONSENTIR.
 *
 * Ver docs/diseno-consentimiento-cookies.md §1.4.
 *
 * Antes de esto el iframe se pintaba SIEMPRE, en cualquier página del blog o del CMS que
 * llevara un bloque de vídeo, sin barrera ninguna: Vimeo recibía la IP de todo el que
 * abriera la página, con sus cookies, sin consentimiento y sin aviso. Era el
 * incumplimiento más claro que tenía la plataforma.
 *
 * ─── LOS DOS PROVEEDORES SE RETIENEN IGUAL (D-nueva-1) ──────────────────────────
 *
 * Vimeo escribe cookies propias al cargar. `youtube-nocookie` no escribe cookies de
 * seguimiento hasta el play — pero **sí recibe la IP, el referer y el user-agent al
 * cargar**, que es un tratamiento y una transferencia internacional, y sobre todo **el
 * play no es interceptable**: ocurre dentro del iframe, así que «consentir al play» es
 * fácil de decir e imposible de implementar sin sustituir el reproductor por el nuestro.
 * Retener los dos es una rama; eximir uno son dos comportamientos que mantener y explicar
 * para ahorrar un clic.
 *
 * ─── EL EDITOR DEL BACKOFFICE NO PASA POR AQUÍ (D-nueva-3) ──────────────────────
 *
 * `VideoBlockEditor.tsx:72` previsualiza con este mismo componente. No lleva ninguna
 * excepción propia: el layout de `(admin)` monta el proveedor con la categoría concedida,
 * así que allí `GateTerceros` deja pasar y el editor ve su vídeo. Una sola línea, en un
 * sitio donde se ve, en vez de un `prop` que alguien olvidaría.
 *
 * ─── POR QUÉ `'use client'`, QUE NO ESTABA ANTES ────────────────────────────────
 *
 * Descubierto midiendo el HTML servido, no razonando: como Server Component, el
 * `<iframe>` que este fichero crea se pasaba al gate (que sí es de cliente) a través de
 * la frontera RSC, y **React serializa ese elemento en el payload aunque nadie lo
 * renderice**. Resultado: la URL `player.vimeo.com` aparecía en el HTML de una página
 * que no había cargado ningún vídeo.
 *
 * No era un incumplimiento —el navegador no pedía nada, y los tests de red lo
 * confirman—, pero dejaba la barrera imposible de verificar de un vistazo: cualquiera
 * que mirase el HTML vería el dominio del tercero y no sabría decir si se está cargando.
 * Con el componente en cliente, el iframe se construye dentro del mismo árbol que el
 * gate, así que si el gate no lo pinta **no existe en ningún sitio**. Lo que queda en el
 * payload es el `videoId`, que es dato nuestro.
 */
export function VideoBlockRenderer({ block }: { block: VideoBlock }) {
  return (
    <div className="aspect-video w-full overflow-hidden rounded-lg bg-muted">
      <GateTerceros
        proveedor={nombreProveedor(block)}
        descripcion="Este vídeo"
        // El marcador ocupa el alto entero del contenedor: el iframe que sustituye lleva
        // `h-full`, así que sin esto habría salto al cargar.
        className="h-full"
        testId="gate-video"
      >
        <iframe
          src={buildEmbedSrc(block)}
          className="h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="Vídeo incrustado"
        />
      </GateTerceros>
    </div>
  );
}
