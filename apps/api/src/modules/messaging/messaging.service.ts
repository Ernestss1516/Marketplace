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
        listing: {
          id: conv.listing.id,
          title: conv.listing.title,
          slug: conv.listing.slug,
          thumbnailUrl: conv.listing.images[0]?.url ?? null,
        },
        otherUser: conv.buyerId === userId ? conv.seller : conv.buyer,
      })),
    };
  }

  async startConversation(buyerId: string, dto: CreateConversationDto) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
      select: { id: true, sellerId: true, status: true },
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

    return this.prisma.conversation.create({
      data: {
        listingId: dto.listingId,
        buyerId,
        sellerId: listing.sellerId,
        lastMessageAt: new Date(),
        messages: { create: { senderId: buyerId, body: dto.message } },
      },
      select: { id: true, listingId: true, createdAt: true },
    });
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
      listing: {
        id: conv.listing.id,
        title: conv.listing.title,
        slug: conv.listing.slug,
        thumbnailUrl: conv.listing.images[0]?.url ?? null,
      },
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
