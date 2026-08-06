import type { CtaBlock } from '@/types/blocks';
import { CtaButton } from '@/components/shared/CtaButton';

// El reparto interno/externo y el mapa estilo→variante viven ahora en
// components/shared/CtaButton, compartido con el bloque `cta` del motor de
// PORTADA. Lo que cruza la frontera entre los dos motores son props planas,
// nunca el tipo `CtaBlock` (docs/diseno-portada.md §4.0) — por eso este fichero
// sigue existiendo: es quien traduce el bloque del blog a esas props.
export function CtaBlockRenderer({ block }: { block: CtaBlock }) {
  return <CtaButton label={block.label} href={block.href} style={block.style ?? 'primary'} />;
}
