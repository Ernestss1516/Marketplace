import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { JwtPayload } from '../auth/auth.types';

// TODO(prod): restrict cors origin to the frontend URL (process.env.APP_URL) in production
@WebSocketGateway({ namespace: '/ws', cors: { origin: '*' } })
export class MessagingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(socket: Socket) {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) throw new Error('missing token');
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('jwt.secret'),
      });
      socket.data.userId = payload.sub;
      // Auto-join user personal room so the bandeja receives message:new without
      // having to know which conversation rooms to subscribe to
      await socket.join(`user:${payload.sub}`);
    } catch {
      socket.disconnect(true);
    }
  }

  handleDisconnect(_socket: Socket) {
    // Socket.IO cleans up room memberships automatically on disconnect
  }

  @SubscribeMessage('conversation:join')
  async handleJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { conversationId: string },
  ) {
    const userId = socket.data.userId as string | undefined;
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    const conv = await this.prisma.conversation.findUnique({
      where: { id: payload.conversationId },
      select: { buyerId: true, sellerId: true },
    });

    if (!conv || (conv.buyerId !== userId && conv.sellerId !== userId)) {
      socket.emit('error', { message: 'Forbidden' });
      return;
    }

    // socket.join is idempotent — safe to call on every reconnect ('connect' re-fires)
    await socket.join(`conv:${payload.conversationId}`);
  }

  emitNewMessage(
    conversationId: string,
    message: unknown,
    buyerId: string,
    sellerId: string,
  ) {
    const payload = { conversationId, message };
    // conv room: both participants' open ChatClients — sender deduplicates by message id
    this.server.to(`conv:${conversationId}`).emit('message:new', payload);
    // user rooms: bandeja of each participant (only receives via this room, not conv room)
    this.server.to(`user:${buyerId}`).emit('message:new', payload);
    this.server.to(`user:${sellerId}`).emit('message:new', payload);
  }
}
