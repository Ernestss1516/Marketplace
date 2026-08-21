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
}: {
  rating: number;
  comment: string | null;
  createdAt: string;
  /** El OTRO lado: quien la escribió (`recibida`) o quien la recibió (`dada`). */
  persona: { id: string; name: string | null };
  relacion: 'recibida' | 'dada';
}) {
  return (
    <li className="space-y-0.5 border-l-2 py-1 pl-3 text-sm">
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
      </div>
      {comment && <p className="text-xs leading-relaxed text-muted-foreground">{comment}</p>}
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
