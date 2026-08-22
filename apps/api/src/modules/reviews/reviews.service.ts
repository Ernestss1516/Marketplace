import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { isP2002 } from '../../common/prisma/is-p2002';
import { CreateReviewDto } from './dto/create-review.dto';
import { UpdateReviewDto } from './dto/update-review.dto';

const EDIT_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * 7b — «LAS QUE SIGUEN CONTANDO», en un solo sitio.
 *
 * Una valoración retirada por el equipo sobrevive como fila —para que la denuncia que la
 * motivó no muera con ella y para poder restaurarla— pero **deja de existir para el
 * público**: ni en el perfil, ni en la media, ni en la estrella de las tarjetas.
 *
 * VIVE COMO CONSTANTE Y NO ESCRITO A MANO EN CADA `where` porque son CINCO lectores
 * públicos en este fichero y uno de ellos (`getRatingSummaries`) está setenta líneas más
 * abajo, lejos de los otros cuatro. Escribir `retiredAt: null` cinco veces es cinco
 * ocasiones de olvidarlo una, y el olvido no se ve: la pantalla funciona, sólo que la
 * reputación de alguien sigue arrastrando lo que el equipo retiró.
 *
 * LO QUE **NO** LO LLEVA, y es deliberado: los lectores del BACKOFFICE. Un moderador tiene
 * que ver las retiradas —marcadas— para poder restaurarlas; retirar no es esconderle la
 * valoración a quien la modera. Ver el inventario en `docs/diseno-valoraciones-mod.md` §2.
 */
const VIGENTES = { retiredAt: null } as const;

const SELECT_AUTHOR = {
  id: true,
  name: true,
  slug: true,
  avatarUrl: true,
} as const;

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reputación RÁFAGA 3 — elegibilidad ya NO mira Conversation, mira Deal:
   * un trato real (verificable O declarado) habilita valorar; solo hablar,
   * ya no. `verified` se congela en el momento de crear — es "¿algún Deal
   * de este par sobre este listing es verificable?", NUNCA se ancla a un
   * Deal concreto (sin dealId) a propósito: Deal no tiene límite de
   * repetición (RÁFAGA 1), así que anclar a "un" Deal abriría la puerta a
   * multiplicar el peso de una review repitiendo tratos con el mismo par.
   * El unique [authorId, targetId, listingId] ya limita a una review por
   * par por listing, sin importar cuántos Deals haya entre ellos.
   */
  private async findDealsBetween(authorId: string, listingId: string, targetId: string) {
    return this.prisma.deal.findMany({
      where: {
        listingId,
        OR: [
          { sellerId: authorId, buyerId: targetId },
          { buyerId: authorId, sellerId: targetId },
        ],
      },
      select: { conversationId: true, listingTitle: true },
    });
  }

  async create(authorId: string, dto: CreateReviewDto) {
    if (authorId === dto.targetId) {
      throw new BadRequestException('No puedes valorarte a ti mismo');
    }

    const deals = await this.findDealsBetween(authorId, dto.listingId, dto.targetId);
    if (deals.length === 0) {
      throw new ForbiddenException(
        'Solo puedes valorar a usuarios con los que has cerrado un trato sobre este anuncio',
      );
    }
    const verified = deals.some((d) => d.conversationId != null);

    try {
      return await this.prisma.review.create({
        data: {
          rating: dto.rating,
          comment: dto.comment,
          authorId,
          targetId: dto.targetId,
          listingId: dto.listingId,
          // Snapshot ya disponible en el propio Deal — no hace falta cargar
          // el Listing en vivo (sobrevive igual aunque el anuncio se borre).
          listingTitle: deals[0].listingTitle,
          verified,
        },
        include: { author: { select: SELECT_AUTHOR } },
      });
    } catch (err) {
      if (isP2002(err)) {
        throw new ConflictException('Ya has valorado a este usuario para este anuncio');
      }
      throw err;
    }
  }

  async getEligibility(authorId: string, listingId: string, targetId: string) {
    if (authorId === targetId) {
      return { canReview: false, alreadyReviewed: false };
    }

    const [deals, existing] = await Promise.all([
      this.findDealsBetween(authorId, listingId, targetId),
      // 7b — SIN `VIGENTES`, y es el único lector «público» que no lo lleva. Una
      // valoración retirada SIGUE OCUPANDO su `@@unique([authorId, targetId, listingId])`,
      // así que su autor no puede escribir otra sobre el mismo anuncio — y decirle que sí
      // puede sería mentirle: el `create` reventaría con un P2002. Además es lo correcto:
      // retirar significa «esto no debió publicarse», y dejar reescribirla invitaría a
      // repetirla. Ver `docs/diseno-valoraciones-mod.md` §2.
      this.prisma.review.findUnique({
        where: { authorId_targetId_listingId: { authorId, targetId, listingId } },
        select: { id: true, createdAt: true },
      }),
    ]);

    return {
      canReview: deals.length > 0 && !existing,
      // Anticipa a la UI si la review se marcará verificada o no antes de enviarla.
      wouldBeVerified: deals.some((d) => d.conversationId != null),
      alreadyReviewed: !!existing,
      existingReview: existing ?? null,
    };
  }

  async listForUser(slug: string, cursor?: string, limit = 10) {
    const user = await this.prisma.user.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const targetId = user.id;
    const take = limit + 1;

    let whereWithCursor: Prisma.ReviewWhereInput = { targetId, ...VIGENTES };
    if (cursor) {
      const pivot = await this.prisma.review.findUnique({
        where: { id: cursor },
        select: { createdAt: true },
      });
      // El pivote se busca SIN filtrar por retirada a propósito: si una valoración se
      // retira mientras alguien pagina, su cursor sigue siendo un ancla válida en el
      // tiempo. Lo que no puede es aparecer en `items`, y de eso se encarga `VIGENTES`.
      if (pivot) {
        whereWithCursor = { targetId, ...VIGENTES, createdAt: { lt: pivot.createdAt } };
      }
    }

    // Reputación RÁFAGA 3 — average/count/distribution cuentan SOLO verified=true
    // (el bloque de confianza); `items` muestra TODAS (verificadas y no), cada
    // una con su propio `verified`, para que la lista pública no censure
    // opinión real solo porque el trato no pasó por el chat. unverifiedCount
    // permite mostrarlas sin mezclarlas con la puntuación de confianza.
    const [raw, aggregate, groupBy, unverifiedCount] = await Promise.all([
      this.prisma.review.findMany({
        where: whereWithCursor,
        orderBy: { createdAt: 'desc' },
        take,
        include: { author: { select: SELECT_AUTHOR } },
      }),
      this.prisma.review.aggregate({
        where: { targetId, verified: true, ...VIGENTES },
        _avg: { rating: true },
        _count: { rating: true },
      }),
      this.prisma.review.groupBy({
        by: ['rating'],
        where: { targetId, verified: true, ...VIGENTES },
        _count: true,
      }),
      this.prisma.review.count({ where: { targetId, verified: false, ...VIGENTES } }),
    ]);

    const hasMore = raw.length > limit;
    const items = raw.slice(0, limit);
    const nextCursor = hasMore ? items[items.length - 1].id : null;

    const count = aggregate._count.rating;
    const average =
      count > 0 ? Math.round((aggregate._avg.rating ?? 0) * 10) / 10 : null;

    const distribution: Record<string, number> = {
      '1': 0,
      '2': 0,
      '3': 0,
      '4': 0,
      '5': 0,
    };
    for (const row of groupBy) {
      distribution[String(row.rating)] = row._count;
    }

    return { average, count, distribution, unverifiedCount, items, nextCursor };
  }

  async edit(id: string, authorId: string, dto: UpdateReviewDto) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Valoración no encontrada');
    if (review.authorId !== authorId) {
      throw new ForbiddenException('No tienes permiso para editar esta valoración');
    }
    if (Date.now() > review.createdAt.getTime() + EDIT_WINDOW_MS) {
      throw new ForbiddenException('El plazo de edición de 72 horas ha expirado');
    }

    return this.prisma.review.update({
      where: { id },
      data: { ...dto, editedAt: new Date() },
      include: { author: { select: SELECT_AUTHOR } },
    });
  }

  async remove(id: string, authorId: string) {
    const review = await this.prisma.review.findUnique({ where: { id } });
    if (!review) throw new NotFoundException('Valoración no encontrada');
    if (review.authorId !== authorId) {
      throw new ForbiddenException('No tienes permiso para borrar esta valoración');
    }
    if (Date.now() > review.createdAt.getTime() + EDIT_WINDOW_MS) {
      throw new ForbiddenException('El plazo de borrado de 72 horas ha expirado');
    }

    await this.prisma.review.delete({ where: { id } });
  }

  /**
   * Escaparate RÁFAGA 4 — media/conteo VERIFICADOS de varios usuarios a la vez,
   * para enriquecer una página de listado (cards) o una ficha sin N+1: una
   * sola query agrupada por los sellerId presentes en esa página, mismo molde
   * que featuredMap/favoritesCountMap en ListingsService.findMine.
   *
   * Medido antes de construir esto (ver estado-tecnico.md, "Escaparate —
   * RÁFAGA 4"): con 88k reviews sintéticas y el peor caso adversarial (40
   * "power sellers" con 385-498 reviews cada uno), esta consulta cuesta
   * ~2.8ms — ruido frente al resto de la petición. On-the-fly, sin
   * desnormalizar: una sola fuente de verdad, cero riesgo de desincronización.
   */
  async getRatingSummaries(
    userIds: string[],
  ): Promise<Map<string, { average: number | null; count: number }>> {
    const map = new Map<string, { average: number | null; count: number }>();
    if (userIds.length === 0) return map;

    const rows = await this.prisma.review.groupBy({
      by: ['targetId'],
      // 7b — `VIGENTES` AQUÍ ES EL QUE MÁS FÁCIL SE OLVIDA, y el que más daño haría: este
      // método vive lejos de `listForUser` y lo consumen la BÚSQUEDA, la PORTADA y la
      // ficha pública. Sin él, una valoración retirada seguiría pesando en la estrella
      // que ve un comprador en cada tarjeta, mientras el perfil del vendedor —que sí
      // filtra— diría otra cosa. Dos verdades sobre la misma reputación.
      where: { targetId: { in: userIds }, verified: true, ...VIGENTES },
      _avg: { rating: true },
      _count: { rating: true },
    });

    for (const row of rows) {
      map.set(row.targetId, {
        average: Math.round((row._avg.rating ?? 0) * 10) / 10,
        count: row._count.rating,
      });
    }
    return map;
  }
}
