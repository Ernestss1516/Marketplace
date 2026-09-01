import type { AdBannerBlock } from '@/types/blocks';
import { isSafeSrc } from '@/lib/image-domains';
import { Button } from '@/components/ui/button';
import { SmartLink } from '@/components/shared/SmartLink';

/**
 * PUBLICIDAD EXTERNA — composición de piezas ya validadas: la imagen es la de
 * `ImageBlockRenderer`/`ImageTextBlockRenderer` (un `<img>` plano tras `isSafeSrc`, porque el
 * bloque no guarda dimensiones y `next/image` las necesita) y el enlace es el de `cta`
 * (`SmartLink`, que reparte interno/externo y **impone el `rel` de seguridad**).
 *
 * CADA CAMPO OPCIONAL SE PINTA SÓLO SI ESTÁ. Un banner que es únicamente una imagen —la
 * forma más común— no deja ni un hueco, ni un separador suelto, ni un botón vacío.
 *
 * EL BOTÓN NECESITA LAS DOS COSAS, texto y destino: con `ctaLabel` pero sin `href` no habría
 * dónde ir, y con `href` pero sin texto no habría qué leer. El esquema no rechaza ese estado
 * a medias a propósito (ver el DTO); quien avisa es el editor, junto al campo.
 *
 * `rel="sponsored"`: es un enlace PUBLICITARIO, y así se le dice a los buscadores para que no
 * le pasen autoridad. Va junto al `noopener`/`noreferrer`, no en su lugar — `SmartLink`
 * compone los tokens y los de seguridad no se pueden quitar.
 */
export function AdBannerBlockRenderer({ block }: { block: AdBannerBlock }) {
  if (!isSafeSrc(block.image.url)) return null;

  const tieneBoton = Boolean(block.ctaLabel && block.href);

  return (
    <aside
      // `aside` y no `div`: es contenido tangencial al artículo, no parte de su hilo.
      className="overflow-hidden rounded-lg border bg-muted/20"
      data-testid="bloque-publicidad"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={block.image.url}
        // Sin `alt` propio se cae al título; sin ninguno de los dos, cadena vacía — la
        // imagen se declara DECORATIVA, que es lo correcto: mejor que un lector de pantalla
        // la ignore a que lea el nombre del fichero.
        alt={block.image.alt ?? block.title ?? ''}
        className="w-full"
      />

      {(block.title || block.description || tieneBoton) && (
        <div className="space-y-3 p-4">
          {block.title && <p className="text-base font-semibold">{block.title}</p>}
          {block.description && (
            <p className="text-sm text-muted-foreground">{block.description}</p>
          )}
          {tieneBoton && (
            <Button asChild size="sm">
              <SmartLink
                href={block.href!}
                newTab={block.openInNewTab}
                rel="sponsored"
                data-testid="bloque-publicidad-enlace"
              >
                {block.ctaLabel}
              </SmartLink>
            </Button>
          )}
        </div>
      )}
    </aside>
  );
}
