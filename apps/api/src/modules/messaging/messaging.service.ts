import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesQueryDto } from './dto/messages-query.dto';

const CONTACTABLE_STATUSES: string[] = ['ACTIVE', 'RESERVED'];

/**
 * AJUSTES RÁFAGA A — EL SEGUNDO AJUSTE MUERTO, Y AQUÍ ESTÁ SU LECTOR.
 *
 * `contactRequiresVerification` llevaba desde el MVP sembrado (`value: true`), editable en
 * `/admin/ajustes` y con una descripción que prometía «los usuarios con email no verificado no
 * podrán iniciar conversaciones». **No lo leía nadie.** Ver docs/auditoria-ajustes-backoffice.md §3.
 *
 * ── POR QUÉ SE CONECTA AQUÍ Y SÓLO AQUÍ ───────────────────────────────────────────────────
 *
 * `startConversation` es el ÚNICO punto por el que nace una conversación, así que es el único
 * sitio donde «iniciar» significa algo. **No se toca `sendMessage`**, y es deliberado: la
 * descripción que este repo lleva meses enseñando dice *iniciar conversaciones*, no *escribir*.
 * Frenar también los mensajes de un hilo ya abierto sería hacer más de lo que el ajuste promete
 * —y dejaría a medias una conversación en la que la otra persona ya está esperando respuesta—.
 * El código se ha escrito contra la descripción, que es la dirección correcta cuando la
 * descripción es la que lleva meses a la vista de quien administra.
 *
 * ── RECHAZA, NO DEGRADA ───────────────────────────────────────────────────────────────────
 *
 * Su hermano `emailVerifiedToPublishEnabled` DEGRADA (deja el anuncio en borrador con un aviso)
 * porque publicar tiene un estado intermedio donde caer. Contactar no lo tiene: o se crea la
 * conversación o no. Así que rechaza, con un mensaje que dice la salida —verificar el correo—
 * en vez de un «no puedes» a secas.
 *
 * ── SIN FILA, NO EXIGE NADA ───────────────────────────────────────────────────────────────
 *
 * `=== true` y no `!== false`: una instancia sin la fila se comporta como hasta hoy. La fila la
 * siembra el seed con `true`, así que en las instancias existentes la exigencia SÍ pasa a
 * aplicarse — es lo que el ajuste dice que hace, y se apaga con un clic en `/admin/ajustes`.
 */
export const CONTACT_REQUIRES_VERIFICATION_SETTING = 'contactRequiresVerification';

const SELECT_USER_STUB = {
  id: true,
  name: true,
  slug: true,
  avatarUrl: true,
} as const;

const SELECT_LISTING_STUB = {
  id: true,
  title: true,
  slug: true,
  images: {
    take: 1,
    orderBy: { order: 'asc' as const },
    select: { url: true },
  },
} as const;

/** La forma del anuncio dentro de una conversación. `id` y `slug` son nulos cuando el anuncio ya no existe. */
export interface ListingStubDto {
  id: string | null;
  title: string;
  slug: string | null;
  thumbnailUrl: string | null;
}

/**
 * BORRADO B1 — EL ANUNCIO DE UNA CONVERSACIÓN PUEDE HABER DESAPARECIDO.
 *
 * Desde B1 `Conversation.listingId` es `SetNull`: el hilo sobrevive al borrado del
 * anuncio (los mensajes son de dos personas, no del anuncio — ver el schema). Eso
 * obliga a que la bandeja sepa pintar una conversación huérfana, y esta función es
 * el único sitio donde se decide cómo.
 *
 * SE DEVUELVE UN OBJETO, NUNCA `null`, y con el TÍTULO siempre puesto: el hilo se
 * sigue reconociendo por el anuncio del que hablaba. Lo que se pierde es lo que no
 * puede sobrevivir:
 *
 *  · `id`/`slug` a `null` → el cliente no puede enlazar a una ficha que no existe,
 *    y el tipo se lo dice en vez de dejarle construir un enlace roto.
 *  · `thumbnailUrl` a `null` → la miniatura vivía en R2 y se borra con el anuncio.
 *
 * `title` cae al snapshot `listingTitle`, y de ahí al genérico sólo si la
 * conversación es anterior a la migración de B1 y su anuncio ya se había borrado.
 */
function toListingStub(
  listing: { id: string; title: string; slug: string; images: { url: string }[] } | null,
  snapshotTitle: string | null,
): ListingStubDto {
  if (listing) {
    return {
      id: listing.id,
      title: listing.title,
      slug: listing.slug,
      thumbnailUrl: listing.images[0]?.url ?? null,
    };
  }
  return {
    id: null,
    title: snapshotTitle ?? 'Anuncio eliminado',
    slug: null,
    thumbnailUrl: null,
  };
}

@Injectable()
export class MessagingService {
  constructor(private readonly prisma: PrismaService) {}

  async findConversations(userId: string) {
    const convs = await this.prisma.conversation.findMany({
      where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        listing: { select: SELECT_LISTING_STUB },
        buyer: { select: SELECT_USER_STUB },
        seller: { select: SELECT_USER_STUB },
        // Fetch only unread incoming messages to compute the count
        messages: {
          where: { senderId: { not: userId }, readAt: null },
          select: { id: true },
        },
      },
    });

    return {
      items: convs.map((conv) => ({
        id: conv.id,
        lastMessageAt: conv.lastMessageAt,
        unreadCount: conv.messages.length,
        listing: toListingStub(conv.listing, conv.listingTitle),
        otherUser: conv.buyerId === userId ? conv.seller : conv.buyer,
      })),
    };
  }

  /**
   * Ciclo de vida RÁFAGA 1 — usuarios con conversación abierta sobre ESTE
   * anuncio, para el selector de comprador/cliente al cerrar un Deal
   * (quick-pick; el buscador libre de GET /users/search cubre lo demás).
   * Filtra por sellerId en la propia query — el llamador (ListingsService)
   * ya comprueba la propiedad del anuncio antes de delegar aquí.
   */
  async findContactsForListing(listingId: string, sellerId: string) {
    const convs = await this.prisma.conversation.findMany({
      where: { listingId, sellerId },
      orderBy: { lastMessageAt: 'desc' },
      select: { lastMessageAt: true, buyer: { select: SELECT_USER_STUB } },
    });
    return convs.map((c) => ({ ...c.buyer, lastMessageAt: c.lastMessageAt }));
  }

  async startConversation(buyerId: string, dto: CreateConversationDto) {
    // BORRADO B1 — se trae también el TÍTULO: es el snapshot que mantiene la
    // bandeja legible si el anuncio desaparece después (`Conversation.listingTitle`).
    // Se toma al crear, no en el borrado — ver la nota del campo en el schema.
    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
      select: { id: true, sellerId: true, status: true, title: true },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    if (listing.sellerId === buyerId) {
      throw new BadRequestException('No puedes contactar con tu propio anuncio');
    }
    if (!CONTACTABLE_STATUSES.includes(listing.status)) {
      throw new BadRequestException('Este anuncio no admite nuevas conversaciones');
    }

    // Return existing conversation without adding a duplicate message
    const existing = await this.prisma.conversation.findUnique({
      where: { listingId_buyerId: { listingId: dto.listingId, buyerId } },
      select: { id: true, listingId: true, createdAt: true },
    });
    if (existing) return existing;

    /**
     * AJUSTES RÁFAGA A — la exigencia de correo verificado, si está encendida.
     *
     * JUSTO AQUÍ, y la posición es la mitad de la decisión: **después** del atajo de la
     * conversación ya existente. Así frena únicamente lo que el ajuste dice que frena —abrir
     * un hilo NUEVO— y no le cierra a nadie el acceso a una conversación que ya tenía. Ponerlo
     * más arriba habría dejado sin su bandeja a quien contactó antes de que se encendiera el
     * ajuste, que es un daño que el ajuste nunca prometió.
     *
     * Después también de las comprobaciones sobre el anuncio: contactar con el propio anuncio
     * o con uno no contactable sigue diciendo ese motivo, que es más concreto que éste.
     */
    await this.assertPuedeIniciarConversacion(buyerId);

    return this.prisma.conversation.create({
      data: {
        listingId: dto.listingId,
        listingTitle: listing.title,
        buyerId,
        sellerId: listing.sellerId,
        lastMessageAt: new Date(),
        messages: { create: { senderId: buyerId, body: dto.message } },
      },
      select: { id: true, listingId: true, createdAt: true },
    });
  }

  /**
   * ¿Puede este usuario ABRIR una conversación nueva?
   *
   * Dos consultas cortas y sólo cuando hace falta: si el ajuste está apagado —o no tiene fila—
   * no se pregunta por el usuario siquiera. Mismo criterio que las reglas de la puerta, que no
   * tocan una tabla mientras su interruptor esté apagado.
   *
   * TOLERANTE CON LA CONFIGURACIÓN ROTA en la dirección segura: cualquier valor que no sea
   * exactamente `true` (un `"sí"`, un `1`, un `null`) se lee como apagado. Un ajuste mal escrito
   * no puede empezar a frenar gente por su cuenta.
   */
  private async assertPuedeIniciarConversacion(buyerId: string): Promise<void> {
    const ajuste = await this.prisma.setting.findUnique({
      where: { key: CONTACT_REQUIRES_VERIFICATION_SETTING },
      select: { value: true },
    });
    if (ajuste?.value !== true) return;

    const usuario = await this.prisma.user.findUnique({
      where: { id: buyerId },
      select: { emailVerified: true },
    });
    if (usuario?.emailVerified) return;

    throw new ForbiddenException(
      'Verifica tu correo electrónico para poder contactar con los vendedores. ' +
        'Tienes el enlace de verificación en el correo de bienvenida, y puedes pedir otro desde tu perfil.',
    );
  }

  async getConversation(id: string, userId: string, query: MessagesQueryDto) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        listing: { select: SELECT_LISTING_STUB },
        buyer: { select: SELECT_USER_STUB },
        seller: { select: SELECT_USER_STUB },
      },
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada');
    if (conv.buyerId !== userId && conv.sellerId !== userId) {
      throw new ForbiddenException('No tienes acceso a esta conversación');
    }

    // Auto-mark incoming messages as read on open
    await this.prisma.message.updateMany({
      where: { conversationId: id, senderId: { not: userId }, readAt: null },
      data: { readAt: new Date() },
    });

    const limit = query.limit ?? 50;
    let where: Prisma.MessageWhereInput = { conversationId: id };

    if (query.before) {
      const pivot = await this.prisma.message.findUnique({
        where: { id: query.before },
        select: { createdAt: true },
      });
      if (pivot) {
        where = { conversationId: id, createdAt: { lt: pivot.createdAt } };
      }
    }

    // Fetch newest-first; frontend reverses for display. +1 to detect hasMore.
    const raw = await this.prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });

    const hasMore = raw.length > limit;
    const messages = raw.slice(0, limit);
    // nextCursor is the oldest message in this batch — pass as `before` to go further back
    const nextCursor = hasMore ? messages[messages.length - 1].id : null;

    return {
      id: conv.id,
      listing: toListingStub(conv.listing, conv.listingTitle),
      otherUser: conv.buyerId === userId ? conv.seller : conv.buyer,
      messages,
      nextCursor,
    };
  }

  async sendMessage(conversationId: string, senderId: string, dto: SendMessageDto) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { id: true, buyerId: true, sellerId: true },
    });
    if (!conv) throw new NotFoundException('Conversación no encontrada');
    if (conv.buyerId !== senderId && conv.sellerId !== senderId) {
      throw new ForbiddenException('No tienes acceso a esta conversación');
    }

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: { conversationId, senderId, body: dto.body },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);

    return { message, buyerId: conv.buyerId, sellerId: conv.sellerId };
  }
}
