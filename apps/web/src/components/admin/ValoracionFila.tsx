import Link from 'next/link';

/**
 * 7a — UNA VALORACIÓN, COMO LA LEE EL STAFF.
 *
 * QUÉ ARREGLA. Las dos fichas del backoffice recibían de la API `rating`, `comment`,
 * `createdAt` y la contraparte de cada valoración, y **se callaban casi todo**: la de
 * usuario pintaba estrellas y un nombre, y la de anuncio estrellas, nombre y el
 * comentario sin fecha. El dato llegaba y no se enseñaba, así que un moderador no podía
 * juzgar una valoración —que es lo que va a tener que hacer— sin salir a otra pantalla.
 *
 * MOLDE: `components/valoraciones/ReviewsSection.tsx`, la tarjeta pública. Se conserva su
 * ORDEN de lectura —quién, cuántas estrellas, cuándo, y debajo el texto— para que staff y
 * visitante lean lo mismo en el mismo sitio. Lo que no se copia es su peso visual: aquí
 * son filas de un panel lateral, no tarjetas de una página.
 *
 * LO QUE NO PUEDE MOSTRAR, y no es un olvido: `verified`, `editedAt` y `listingTitle` no
 * vienen en el `select` de ninguna de las dos fichas. Enseñarlos es ampliar la respuesta
 * del backend, y 7a es sólo pintar lo que ya llega.
 *
 * 7b LEVANTA ESA LIMITACIÓN PARA DOS DE LOS TRES. `verified` y el estado de retirada ya
 * viajan, porque moderar sin ellos es moderar a ciegas: `verified` dice si esa valoración
 * CUENTA para la media —retirar una que no cuenta no cambia la reputación de nadie— y
 * `retiredAt` dice si el trabajo ya está hecho. `editedAt` y `listingTitle` siguen sin
 * venir; la limitación de 7a sigue en pie para ellos.
 *
 * COMPONENTE COMPARTIDO desde el primer uso: las dos fichas enseñan lo mismo y tenerlo
 * dos veces es como acaban divergiendo (`listing-status.ts` lo documenta habiéndolo
 * pagado ya).
 */
export function ValoracionFila({
  rating,
  comment,
  createdAt,
  persona,
  relacion,
  verified,
  retiredAt,
  retiredReason,
  acciones,
}: {
  rating: number;
  comment: string | null;
  createdAt: string;
  /** El OTRO lado: quien la escribió (`recibida`) o quien la recibió (`dada`). */
  persona: { id: string; name: string | null };
  relacion: 'recibida' | 'dada';
  /** 7b — cuenta para la media (`true`) o es opinión sin trato verificable (`false`). */
  verified?: boolean;
  /** 7b — `null` = vigente. Con fecha, la fila se pinta apagada y tachada. */
  retiredAt?: string | null;
  retiredReason?: string | null;
  /**
   * 7b — los botones, INYECTADOS. La fila se queda presentacional (la pinta también la
   * ficha de anuncio, que no tiene por qué traer el cableado de moderación), y quien
   * quiera acciones pasa su propio bloque.
   */
  acciones?: React.ReactNode;
}) {
  const retirada = !!retiredAt;
  return (
    <li
      className={`space-y-0.5 border-l-2 py-1 pl-3 text-sm ${
        retirada ? 'border-amber-400 opacity-60' : ''
      }`}
      data-testid={retirada ? 'valoracion-retirada' : 'valoracion-vigente'}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        {/* Las cinco SIEMPRE, en claro y en oscuro: `'★'.repeat(rating)` a secas obliga a
            contar puntas para saber si son tres de cinco o tres de tres. */}
        <span className="font-medium tabular-nums" title={`${rating} de 5`}>
          <span className="text-amber-500">{'★'.repeat(rating)}</span>
          <span className="text-muted-foreground">{'☆'.repeat(5 - rating)}</span>
        </span>
        <span className="text-xs text-muted-foreground">
          {relacion === 'recibida' ? 'de' : 'a'}{' '}
          {/* Al backoffice del otro lado, no al perfil público: quien lee esto está
              moderando, y lo siguiente que va a querer es su ficha. */}
          <Link href={`/admin/usuarios/${persona.id}`} className="hover:underline">
            {persona.name ?? '—'}
          </Link>
        </span>
        <span className="text-xs text-muted-foreground">· {formatearFecha(createdAt)}</span>
        {/* Sólo cuando NO cuenta: marcar las verificadas sería ruido en la mayoría de las
            filas. Lo que el moderador necesita saber es cuándo su decisión no moverá la
            media. `verified === false` explícito, no `!verified`: sin el campo (la ficha
            de anuncio antes de 7b) no se afirma nada. */}
        {verified === false && (
          <span className="text-xs text-muted-foreground" title="No cuenta para la media">
            · sin trato verificado
          </span>
        )}
        {retirada && (
          <span
            className="rounded bg-amber-100 px-1.5 text-xs text-amber-800"
            title={retiredReason ?? undefined}
          >
            Retirada
          </span>
        )}
      </div>
      {comment && (
        <p
          className={`text-xs leading-relaxed text-muted-foreground ${
            retirada ? 'line-through' : ''
          }`}
        >
          {comment}
        </p>
      )}
      {/* El motivo, en claro y no sólo en el `title` del distintivo: es el registro de por
          qué alguien del equipo la retiró, y quien la va a restaurar tiene que leerlo. */}
      {retirada && retiredReason && (
        <p className="text-xs text-amber-700">Motivo: {retiredReason}</p>
      )}
      {acciones && <div className="flex flex-wrap gap-2 pt-1">{acciones}</div>}
    </li>
  );
}

function formatearFecha(iso: string): string {
  return new Date(iso).toLocaleDateString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
