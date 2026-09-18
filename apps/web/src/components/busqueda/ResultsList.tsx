import { ListingCard } from '@/components/anuncios/ListingCard';
import { ListingCardWide } from '@/components/anuncios/ListingCardWide';
import { SponsoredCard, isSponsoredAdHit } from '@/components/anuncios/SponsoredCard';
import type { SearchHit } from '@/lib/api/busqueda';

/**
 * LA LISTA DE RESULTADOS — una sola, para las dos rutas que la pintan.
 *
 * ── POR QUÉ ESTÁ AQUÍ Y NO EN CADA PÁGINA ────────────────────────────────────────────
 *
 * `/busqueda` y `/[categoria]` pintaban este mismo bloque copiado línea a línea: el mismo
 * `map`, el mismo reparto entre patrocinado y anuncio, las mismas clases de rejilla. Dos
 * copias de una decisión que tiene que ser una — **qué formato de tarjeta corresponde al
 * modo de lista activo** — es exactamente la forma que tenía el fallo que esto arregla: si
 * mañana alguien añade un modo o cambia un formato en una ruta y no en la otra, el
 * patrocinado (o el anuncio) vuelve a desentonar en la que se quedó atrás.
 *
 * ── MODO ↔ FORMATO, EN UN SITIO ──────────────────────────────────────────────────────
 *
 *   AMPLIADA → una columna, tarjeta ancha  → `ListingCardWide` / `SponsoredCard` «wide»
 *   LISTA    → rejilla, tarjeta cuadrada   → `ListingCard`     / `SponsoredCard` «grid»
 *
 * MAPA no llega aquí: esa vista pinta `MapViewClient` con los anuncios reales, y un
 * patrocinado no tiene coordenadas que poner en un mapa.
 *
 * El patrocinado recibe SIEMPRE la variante que le toca a la lista —es la misma expresión
 * que decide la del anuncio normal, no una segunda decisión que se pueda olvidar— y
 * conserva su marca: la etiqueta «Publicidad» y el `rel="sponsored"` van dentro de
 * `SponsoredCard`, no aquí.
 */
export function ResultsList({
  hits,
  view,
  /** Cuántas tarjetas de cabecera priorizan su foto (above the fold). */
  priorityCount = 4,
}: {
  hits: SearchHit[];
  view: 'LISTA' | 'AMPLIADA';
  priorityCount?: number;
}) {
  if (view === 'AMPLIADA') {
    return (
      <div className="flex flex-col gap-3" data-testid="resultados-ampliada">
        {hits.map((hit, i) =>
          isSponsoredAdHit(hit) ? (
            <SponsoredCard key={`sponsored-${hit.id}`} ad={hit} variant="wide" />
          ) : (
            <ListingCardWide key={hit.id} listing={hit} priority={i < priorityCount} />
          ),
        )}
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
      data-testid="resultados-rejilla"
    >
      {hits.map((hit, i) =>
        isSponsoredAdHit(hit) ? (
          <SponsoredCard key={`sponsored-${hit.id}`} ad={hit} variant="grid" />
        ) : (
          <ListingCard key={hit.id} listing={hit} priority={i < priorityCount} />
        ),
      )}
    </div>
  );
}
