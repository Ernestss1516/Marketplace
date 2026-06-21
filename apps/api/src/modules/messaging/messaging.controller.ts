import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { MessagingService } from './messaging.service';
import { MessagingGateway } from './messaging.gateway';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesQueryDto } from './dto/messages-query.dto';

@ApiTags('Messaging')
@ApiBearerAuth('access-token')
@Controller('conversations')
@UseGuards(JwtAuthGuard)
export class MessagingController {
  constructor(
    private readonly messagingService: MessagingService,
    private readonly messagingGateway: MessagingGateway,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Bandeja de conversaciones del usuario autenticado' })
  @ApiResponse({
    status: 200,
    description: 'Lista de conversaciones ordenadas por último mensaje, con unreadCount',
  })
  findAll(@CurrentUser() user: JwtUser) {
    return this.messagingService.findConversations(user.userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Iniciar (o recuperar) una conversación sobre un anuncio',
    description:
      'Crea la conversación y añade el primer mensaje. Si ya existe para ese (anuncio, comprador), ' +
      'devuelve la existente sin duplicar mensajes. Solo para anuncios ACTIVE o RESERVED.',
  })
  @ApiResponse({ status: 201, description: 'Conversación creada o recuperada: { id, listingId, createdAt }' })
  @ApiResponse({ status: 400, description: 'Anuncio propio o en estado no contactable' })
  @ApiResponse({ status: 404, description: 'Anuncio no encontrado' })
  start(@CurrentUser() user: JwtUser, @Body() dto: CreateConversationDto) {
    return this.messagingService.startConversation(user.userId, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Mensajes de una conversación (cursor-based, más recientes primero)',
    description:
      'Devuelve los mensajes en orden DESC (newest first). El frontend invierte el array para mostrarlos. ' +
      'Usa ?before=<messageId> para cargar mensajes más antiguos (scroll hacia arriba). ' +
      'Al acceder se marcan como leídos los mensajes recibidos pendientes.',
  })
  @ApiParam({ name: 'id', description: 'ID de la conversación' })
  @ApiResponse({ status: 200, description: 'Conversación con mensajes y nextCursor' })
  @ApiResponse({ status: 403, description: 'No participas en esta conversación' })
  @ApiResponse({ status: 404, description: 'Conversación no encontrada' })
  getOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Query() query: MessagesQueryDto,
  ) {
    return this.messagingService.getConversation(id, user.userId, query);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Enviar un mensaje en una conversación' })
  @ApiParam({ name: 'id', description: 'ID de la conversación' })
  @ApiResponse({ status: 201, description: 'Mensaje creado' })
  @ApiResponse({ status: 403, description: 'No participas en esta conversación' })
  @ApiResponse({ status: 404, description: 'Conversación no encontrada' })
  async sendMessage(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: SendMessageDto,
  ) {
    const { message, buyerId, sellerId } = await this.messagingService.sendMessage(
      id,
      user.userId,
      dto,
    );
    this.messagingGateway.emitNewMessage(id, message, buyerId, sellerId);
    return message;
  }
}
