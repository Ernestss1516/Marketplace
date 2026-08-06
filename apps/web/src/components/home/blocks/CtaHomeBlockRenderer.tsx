import type { HomeCtaBlock } from '@/types/home-blocks';
import { CtaButton } from '@/components/shared/CtaButton';

/**
 * Bloque `cta` de portada. Server Component, cero JS.
 *
 * Traduce el bloque de PORTADA a las props planas de `CtaButton`, que es el
 * mismo componente que usa el bloque `cta` del BLOG. Lo que se comparte es el
 * presentacional; los dos tipos de bloque (`HomeCtaBlock` y `CtaBlock`) siguen
 * viviendo cada uno en su motor y no se importan entre sí — es la regla de
 * docs/diseno-portada.md §4.0: nada cuya firma lleve un tipo de bloque cruza la
 * frontera.
 */
export function CtaHomeBlockRenderer({ block }: { block: HomeCtaBlock }) {
  return <CtaButton label={block.label} href={block.href} style={block.style ?? 'primary'} />;
}
