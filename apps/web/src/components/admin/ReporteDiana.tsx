import Link from 'next/link';
import { Star } from 'lucide-react';
import { adminListingHref, adminUserHref } from '@/lib/admin-links';
import type { Report } from '@/lib/api/moderacion';

/**
 * CONTRA QUÉ VA UNA DENUNCIA — y qué se enseña cuando eso ya no existe.
 *
 * ─── EL DEFECTO QUE CIERRA ───────────────────────────────────────────────────
 *
 * La cola decidía así:
 *
 *   {r.listing ? … : r.reportedUser ? … : r.review ? … : <span>—</span>}
 *
 * Y ese último `—` era el agujero. `Report.listingId` y `Report.reviewId` son
 * `SetNull` **a propósito**: B1 los cambió desde `Cascade` porque con `Cascade`
 * el denunciado podía destruir la denuncia borrando su propio anuncio. La
 * denuncia sobrevive… y la cola se quedaba sin poder decir de qué era.
 *
 * Para eso mismo se crearon los snapshots —`listingTitle`, `reportedUserName`,
 * `reviewComment`, `reviewAuthorName`—, cada uno con su porqué escrito en el
 * schema. **Viajaban en la respuesta desde el primer día y nadie los leía.**
 *
 * ─── LA REGLA: RESPALDO, NO SUSTITUTO ────────────────────────────────────────
 *
 * Si la relación existe, manda la relación y se enlaza. Si no existe pero hay
 * snapshot, se pinta el snapshot **con marca de que ya no existe y SIN enlace**:
 * un enlace a un id que se fue sería una promesa rota, y peor que no ofrecerlo.
 * Sólo cuando no hay ni una cosa ni la otra queda el guion — que entonces sí es
 * la verdad.
 *
 * EL USUARIO ELIMINADO ES EL CASO RARO, y por eso se comprueba aparte: eliminar
 * una cuenta NO borra su fila, la vacía (`name` pasa a «Usuario eliminado»). Así
 * que `reportedUser` NO es `null` y aun así el nombre ya no dice contra quién
 * era. De ahí que `reportedUserName` gane sobre la relación cuando existe: es la
 * única forma de que la denuncia siga nombrando a alguien.
 */

/** «Ya no existe»: el mismo aviso para los tres casos, para que se lea igual. */
function Fantasma({ children, tipo }: { children: React.ReactNode; tipo: string }) {
  return (
    <span data-testid="reporte-diana-fantasma">
      <span className="text-muted-foreground line-through">{children}</span>
      <span className="ml-1 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
        {tipo} ya no existe
      </span>
    </span>
  );
}

export function ReporteDiana({ reporte }: { reporte: Report }) {
  const r = reporte;

  // ── Anuncio ────────────────────────────────────────────────────────────────
  if (r.listing) {
    return (
      <span data-testid="reporte-diana">
        <Link href={adminListingHref(r.listing.id)} className="text-primary hover:underline">
          {r.listing.title}
        </Link>
        <span className="block text-xs text-muted-foreground">Anuncio</span>
      </span>
    );
  }
  if (r.listingTitle) {
    return (
      <span data-testid="reporte-diana">
        <Fantasma tipo="Anuncio">{r.listingTitle}</Fantasma>
        <span className="block text-xs text-muted-foreground">Anuncio</span>
      </span>
    );
  }

  // ── Usuario ────────────────────────────────────────────────────────────────
  if (r.reportedUser) {
    // El snapshot GANA al nombre de la relación cuando lo hay: si la cuenta se
    // eliminó, la fila sigue viva pero su `name` ya no nombra a nadie.
    const nombre = r.reportedUserName ?? r.reportedUser.name;
    return (
      <span data-testid="reporte-diana">
        {/* A la ficha de STAFF, no al perfil público: éste puede estar suspendido
            —que es el caso típico de un denunciado— y allí no hay nada que moderar. */}
        <Link href={adminUserHref(r.reportedUser.id)} className="text-primary hover:underline">
          {nombre}
        </Link>
        <span className="block text-xs text-muted-foreground">Usuario</span>
      </span>
    );
  }
  if (r.reportedUserName) {
    return (
      <span data-testid="reporte-diana">
        <Fantasma tipo="Usuario">{r.reportedUserName}</Fantasma>
        <span className="block text-xs text-muted-foreground">Usuario</span>
      </span>
    );
  }

  // ── Valoración ─────────────────────────────────────────────────────────────
  if (r.review) {
    return (
      <span className="block" data-testid="reporte-diana">
        <span className="block rounded border border-warning-border bg-warning px-2 py-1.5 text-xs">
          <span className="mb-0.5 flex items-center gap-1 font-medium text-warning-foreground">
            {Array.from({ length: 5 }, (_, i) => (
              <Star
                key={i}
                className={[
                  'h-3 w-3',
                  i < r.review!.rating
                    ? 'fill-rating text-rating'
                    : 'fill-transparent text-muted-foreground',
                ].join(' ')}
                aria-hidden
              />
            ))}
            {/* AUTOR Y DESTINATARIO, ENLAZADOS. Eran texto plano: para juzgar si
                una reseña es falsa hay que poder abrir a los dos —quién la
                escribió y a quién le cayó— y desde aquí no se llegaba a ninguno.
                El `id` que hace falta se añadió al `select` del backend en esta
                misma ráfaga: sólo venían `name` y `slug`, y la ficha de staff es
                por id. */}
            <span className="ml-1 text-warning-foreground">
              de{' '}
              <Link
                href={adminUserHref(r.review.author.id)}
                className="underline underline-offset-2"
                data-testid="reporte-enlace-autor"
              >
                {r.review.author.name}
              </Link>{' '}
              →{' '}
              <Link
                href={adminUserHref(r.review.target.id)}
                className="underline underline-offset-2"
                data-testid="reporte-enlace-destinatario"
              >
                {r.review.target.name}
              </Link>
            </span>
          </span>
          {r.review.comment && <span className="block text-warning-foreground">{r.review.comment}</span>}
        </span>
        <span className="block text-xs text-muted-foreground">Valoración</span>
      </span>
    );
  }
  if (r.reviewComment || r.reviewAuthorName) {
    return (
      <span className="block" data-testid="reporte-diana">
        <Fantasma tipo="Valoración">
          {r.reviewAuthorName ? `de ${r.reviewAuthorName}` : 'Valoración'}
          {r.reviewComment ? `: «${r.reviewComment}»` : ''}
        </Fantasma>
        <span className="block text-xs text-muted-foreground">Valoración</span>
      </span>
    );
  }

  return <span className="text-muted-foreground">—</span>;
}
