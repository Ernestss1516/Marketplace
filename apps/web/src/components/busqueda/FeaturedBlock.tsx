import { Sparkles } from 'lucide-react';
import { ListingCard } from '@/components/anuncios/ListingCard';
import { PublicidadBadge } from '@/components/anuncios/PublicidadBadge';
import type { ListingSummary } from '@/types';

/**
 * Bloque "Promocionados" (política de ordenación C, RÁFAGA 1): destacados que cumplen los
 * filtros actuales, mostrados en un bloque marcado ARRIBA de la lista. Se repiten a propósito
 * en su posición natural dentro de `hits` — el bloque es la vitrina de pago, la lista sigue
 * siendo la lista real ordenada como el usuario pidió (boostScore ya no la reordena). Desde R2
 * los destacados SE TURNAN aquí por ventanas: cada uno sale un grupo por ciclo.
 *
 * ── P2B: POR QUÉ ESTE BLOQUE DICE AHORA QUE ES PUBLICIDAD ──────────────────────────────
 *
 * Hasta aquí el bloque era un icono, la palabra «Promocionados» y la rejilla, y nada más. Y
 * «Promocionados» NO DICE LO QUE PASA: se puede leer como «rebajados», como «recomendados por
 * la plataforma» o como «los mejores de la categoría». La lectura correcta —el vendedor ha
 * pagado por estar ahí— no estaba escrita en ninguna parte (auditoría §5, deuda P2B).
 *
 * R2 LO VOLVIÓ MÁS NECESARIO, no menos: desde que el bloque se turna, su contenido tampoco
 * sigue el orden que el visitante ha pedido. Alguien que ordena por «precio: menor a mayor» y
 * ve cuatro anuncios arriba puede creer razonablemente que son los más baratos, o los más
 * relevantes. No son ninguna de las dos cosas: son los que pagaron y a los que les tocaba
 * turno. Decirlo no es cortesía, es la única forma de que la vitrina no engañe.
 *
 * DOS SEÑALES, PORQUE RESPONDEN A DOS PREGUNTAS DISTINTAS. La etiqueta «Publicidad» —la misma
 * que llevan las tarjetas patrocinadas, no una palabra nueva— dice QUÉ ES ESTO. La línea de
 * debajo dice POR QUÉ ESTÁ AHÍ y, sobre todo, que no es un orden por relevancia, que es lo que
 * un comprador podría suponer.
 *
 * Y ES DISCRETA A PROPÓSITO: una etiqueta pequeña y una línea de texto menor. Lo que hace falta
 * es que quien mire pueda saberlo, no que el aviso tape lo que anuncia.
 */
export function FeaturedBlock({ listings }: { listings: ListingSummary[] }) {
  if (listings.length === 0) return null;

  return (
    // El nombre accesible lleva la palabra POR DELANTE: quien navega con lector de pantalla
    // salta de sección en sección y oye este rótulo antes que su contenido. «Anuncios
    // promocionados», que es lo que decía, le informaba tan poco como la etiqueta visible
    // informaba a los demás.
    <section className="mb-6" aria-label="Publicidad — anuncios promocionados">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-center gap-1.5 text-sm font-semibold text-warning-foreground">
          <Sparkles className="h-4 w-4" aria-hidden />
          Promocionados
        </span>
        <PublicidadBadge inline />
      </div>
      <p className="mb-3 text-xs text-muted-foreground" data-testid="aviso-publicidad">
        Estos vendedores han pagado por aparecer aquí. No es un orden por relevancia.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {listings.map((listing) => (
          <ListingCard key={`featured-${listing.id}`} listing={listing} />
        ))}
      </div>
    </section>
  );
}
