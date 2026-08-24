import type { ListingCtr } from '@/types';

/**
 * ESTADÍSTICAS A2 — cómo se CUENTA el CTR, que es tan importante como calcularlo.
 *
 * La regla de cuándo el número es publicable vive en el backend (`listing-ctr.ts`): aquí
 * llega ya decidida, en forma de `value: null`. Este componente solo elige las palabras,
 * y hay tres casos que decir de tres maneras distintas:
 *
 *  · **Muestra pequeña** (`value === null`) — NO se enseña un porcentaje. Se dice cuántas
 *    apariciones faltan. «2 de 3 = 67%» sería un número rotundo sobre ruido, y un
 *    vendedor que lo lea y decida no tocar su anuncio habrá decidido sobre nada.
 *  · **Normal** — el porcentaje, y debajo los conteos con los que se ha hecho, para que
 *    se pueda juzgar por sí mismo.
 *  · **Más visitas que apariciones** (`value > 1`) — pasa de verdad, y no es un error:
 *    significa que el tráfico llega por otras vías (enlace directo, favoritos, el perfil
 *    del vendedor, un bloque de portada). Se dice tal cual, porque leer «un 300% entra»
 *    sin explicación sería peor que no enseñar nada.
 *
 * Vive en `components/stats/` junto a `StatsChart` —y no dentro del panel del vendedor—
 * porque el backoffice (B1) enseñará el mismo cociente y debe contarlo igual: una sola
 * redacción, no dos que se separen con el tiempo.
 */

const porcentaje = (valor: number) =>
  new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 1 }).format(valor);

export function CtrLine({ ctr }: { ctr?: ListingCtr }) {
  if (!ctr) return null;

  const conteos = (
    <span className="text-muted-foreground">
      {' '}
      ({ctr.views} {ctr.views === 1 ? 'visita' : 'visitas'} sobre {ctr.impressions}{' '}
      {ctr.impressions === 1 ? 'aparición' : 'apariciones'})
    </span>
  );

  if (ctr.value === null) {
    return (
      <p data-testid="stats-ctr-insufficient">
        Todavía no se puede calcular qué parte de tus apariciones acaba en visita: con pocas
        apariciones el porcentaje engaña más que informa. Hacen falta al menos{' '}
        <strong>{ctr.minImpressions}</strong> y llevas <strong>{ctr.impressions}</strong>.
      </p>
    );
  }

  if (ctr.value > 1) {
    return (
      <p data-testid="stats-ctr-value">
        Recibes <strong>más visitas que apariciones</strong> en búsqueda{conteos}: te están
        llegando por otras vías — un enlace directo, favoritos o tu perfil de vendedor.
      </p>
    );
  }

  return (
    <p data-testid="stats-ctr-value">
      Un <strong>{porcentaje(ctr.value)}</strong> de las veces que apareces en una búsqueda,
      alguien entra a tu anuncio{conteos}.
    </p>
  );
}
