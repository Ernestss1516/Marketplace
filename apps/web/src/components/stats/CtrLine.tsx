import type { ListingCtr } from '@/types';
import { RatioLine } from './RatioLine';

/**
 * ESTADÍSTICAS A2 — el CTR, contado con palabras de CTR.
 *
 * Sólo aporta la REDACCIÓN. Cuándo hay porcentaje y cuándo no, cómo se formatea y que los
 * conteos lo acompañen lo decide `RatioLine`, que comparte con el ratio de me gusta: un
 * solo tratamiento de muestra pequeña para los dos ratios del panel.
 *
 * Lo propio del CTR es el caso **mayor que 1**, que el otro ratio no puede dar: significa
 * que el anuncio recibe más visitas que apariciones en búsqueda porque el tráfico le llega
 * por otras vías (enlace directo, favoritos, el perfil del vendedor, un bloque de portada
 * —que a propósito no cuenta impresiones—). Se cuenta con esas palabras en vez de pintar
 * «300%», que sería literal y aun así ilegible.
 */
export function CtrLine({ ctr }: { ctr?: ListingCtr }) {
  return (
    <RatioLine
      testId="stats-ctr"
      ratio={
        ctr && {
          value: ctr.value,
          count: ctr.views,
          sample: ctr.impressions,
          minSample: ctr.minImpressions,
        }
      }
      countNoun={{ one: 'visita', many: 'visitas' }}
      sampleNoun={{ one: 'aparición', many: 'apariciones' }}
      whatIsMissing="qué parte de tus apariciones acaba en visita"
      sentence={(percent) => (
        <>
          Un {percent} de las veces que apareces en una búsqueda, alguien entra a tu anuncio
        </>
      )}
      overOne={(counts) => (
        <>
          Recibes <strong>más visitas que apariciones</strong> en búsqueda{counts}: te están
          llegando por otras vías — un enlace directo, favoritos o tu perfil de vendedor.
        </>
      )}
    />
  );
}
