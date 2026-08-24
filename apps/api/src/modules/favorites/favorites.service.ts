import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { isP2002 } from '../../common/prisma/is-p2002';
import { ReviewsService } from '../reviews/reviews.service';
import { SELECT_SUMMARY, attachSellerRatings, toSummary } from '../listings/listing-summary';

/**
 * FUGA DE PRIVACIDAD — LO QUE ESTE `select` SUSTITUYE, Y POR QUÉ ES UN `select` Y NO UN
 * `include`.
 *
 * Aquí había un `include: { listing: { include: { category, images, seller } } }`. Un
 * `include` sin `select` devuelve **todos los escalares** de la fila, así que `/favorites`
 * servía el anuncio ENTERO:
 *
 *   · `phone` — el teléfono publicado del anuncio. La ficha pública lo descarta
 *     explícitamente antes de cachear y de responder («PRIVACIDAD — CRÍTICO»,
 *     ListingsService.findBySlug) y sólo se sirve por `GET /listings/:id/phone`, que está
 *     **autenticado, limitado por hora (por usuario y por IP) y sólo para anuncios ACTIVE**.
 *     Por esta puerta salía sin límite, sin registro, veinte por página y fuera cual fuera
 *     el estado del anuncio: marcar favoritos era un recolector de teléfonos que esquivaba
 *     el rate limit hecho para impedirlo.
 *   · `phoneNormalized` — el mismo teléfono, en la forma que usa la detección.
 *   · `lastOwnerIp` — la **dirección IP** del vendedor. El backoffice la trata como dato
 *     de staff y la saca del objeto antes de listar (`AdminService`, «la lista enseña si
 *     está marcada, no cuál es»).
 *   · `triage`, `watched` — etiquetas INTERNAS de moderación.
 *   · `needsRevalidation` — estado de gestión, sólo de la vista del propietario.
 *   · `videoUrl`, `videoPosterUrl` — rompían el cero-bytes-de-vídeo-en-listas: una tarjeta
 *     con la dirección puede descargar el vídeo.
 *
 * SE ARREGLA POR LA RAÍZ, no quitando `phone` a mano. `/favorites` era la ÚNICA de las once
 * listas que no pasaba por `toSummary`, y ese era el defecto: no que a alguien se le
 * olvidara filtrar, sino que había una segunda forma que podía divergir —y divergió—. Ahora
 * pide el MISMO `select` que las otras diez y pasa por la MISMA función. Un campo sensible
 * nuevo en `Listing` no puede volver a salir por aquí, porque esto es una lista blanca.
 *
 * Ver docs/auditoria-pro-video.md, «Hallazgo colateral».
 */
const FAVORITE_SELECT = {
  id: true,
  listingId: true,
  createdAt: true,
  listing: { select: SELECT_SUMMARY },
} satisfies Prisma.FavoriteSelect;

type FavoriteRow = Prisma.FavoriteGetPayload<{ select: typeof FAVORITE_SELECT }>;

@Injectable()
export class FavoritesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reviews: ReviewsService,
  ) {}

  /**
   * Un favorito con su anuncio en la forma SEGURA de tarjeta. La reputación del vendedor se
   * añade en lote, igual que en las otras diez listas — sin ella las tarjetas de favoritos
   * decían «Nuevo» de todo vendedor, incluido uno con cincuenta valoraciones.
   */
  private async toSafeFavorites(rows: FavoriteRow[]) {
    const resumenes = await attachSellerRatings(
      this.reviews,
      rows.map((r) => toSummary(r.listing)),
    );
    return rows.map((row, i) => ({
      id: row.id,
      listingId: row.listingId,
      createdAt: row.createdAt,
      listing: resumenes[i],
    }));
  }

  async add(userId: string, listingId: string) {
    // El favorito recién creado se devuelve con la MISMA forma segura que la lista: es el
    // mismo dato por otra puerta, y una puerta con su propia forma es cómo se cuela lo que
    // la otra filtra.
    const crear = async (): Promise<FavoriteRow> =>
      this.prisma.favorite.create({
        data: { userId, listingId },
        select: FAVORITE_SELECT,
      });

    let row: FavoriteRow;
    try {
      row = await crear();
    } catch (err) {
      if (isP2002(err)) {
        // Already favorited — return existing record (idempotent)
        row = await this.prisma.favorite.findUniqueOrThrow({
          where: { userId_listingId: { userId, listingId } },
          select: FAVORITE_SELECT,
        });
      } else if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
        throw new NotFoundException(`Listing ${listingId} not found`);
      } else {
        throw err;
      }
    }

    return (await this.toSafeFavorites([row]))[0];
  }

  async remove(userId: string, listingId: string): Promise<void> {
    try {
      await this.prisma.favorite.delete({
        where: { userId_listingId: { userId, listingId } },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        // Not found — succeed silently (idempotent)
        return;
      }
      throw err;
    }
  }

  async batchCheck(userId: string, listingIds: string[]): Promise<string[]> {
    const rows = await this.prisma.favorite.findMany({
      where: { userId, listingId: { in: listingIds } },
      select: { listingId: true },
    });
    return rows.map((r) => r.listingId);
  }

  async isFavorited(userId: string, listingId: string): Promise<boolean> {
    const fav = await this.prisma.favorite.findUnique({
      where: { userId_listingId: { userId, listingId } },
      select: { id: true },
    });
    return fav !== null;
  }

  async findByUser(userId: string, page: number, perPage: number) {
    const [rows, total] = await Promise.all([
      this.prisma.favorite.findMany({
        where: { userId },
        select: FAVORITE_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.favorite.count({ where: { userId } }),
    ]);
    const items = await this.toSafeFavorites(rows);
    return { items, total, page, perPage, pages: Math.ceil(total / perPage) };
  }
}
