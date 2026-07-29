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
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { TicketsService } from './tickets.service';
import { ContactReasonsService } from '../contact/contact-reasons.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { SendTicketMessageDto } from './dto/send-ticket-message.dto';
import { ListTicketsDto } from './dto/list-tickets.dto';
import { TicketThreadQueryDto } from './dto/ticket-thread-query.dto';

/**
 * Atención al usuario R2 — API de USUARIO. Todas las rutas autenticadas y
 * OWNER-SCOPED: el usuario solo ve y toca lo suyo. Molde `InvoicingController`
 * (owner-scope con 403 explícito) + `MessagingController` (hilo con cursor).
 *
 * NINGUNA ruta acepta un `userId`: siempre sale del JWT vía `@CurrentUser()`. No
 * hay parámetro donde colar el de otra persona.
 *
 * La API de STAFF (bandeja, tomar, resolver, cerrar, abrir hilo) es R3 y vivirá
 * en su propio controlador bajo `/admin/tickets`, con `@Roles(MODERATOR, ADMIN)`.
 */
@ApiTags('Tickets')
@ApiBearerAuth('access-token')
@Controller('tickets')
@UseGuards(JwtAuthGuard)
export class TicketsController {
  constructor(
    private readonly tickets: TicketsService,
    private readonly contactReasons: ContactReasonsService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Abrir un ticket de atención al usuario (flujo a)',
    description:
      'Crea el hilo en estado OPEN con el primer mensaje (side USER). Puede enlazar UNA entidad ' +
      'del marketplace: un anuncio propio, una valoración escrita o recibida, o una factura propia.',
  })
  @ApiResponse({ status: 201, description: 'Ticket creado' })
  @ApiResponse({ status: 400, description: 'Motivo no válido' })
  @ApiResponse({
    status: 422,
    description:
      'No puedes enlazar esa entidad (misma respuesta tanto si no existe como si no es tuya — ' +
      'deliberado: no se filtra la existencia de ids ajenos), o se enlazó más de una.',
  })
  @ApiResponse({ status: 429, description: 'Límite diario de tickets alcanzado' })
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateTicketDto) {
    return this.tickets.createByUser(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Mis tickets, ordenados por último movimiento' })
  @ApiResponse({ status: 200, description: 'Lista paginada con unreadCount por ticket' })
  list(@CurrentUser() user: JwtUser, @Query() query: ListTicketsDto) {
    return this.tickets.listForUser(user.userId, query.page, query.perPage);
  }

  /**
   * Motivos ofrecibles al abrir un ticket: activos y de ámbito TICKET o BOTH.
   *
   * Endpoint propio y NO reutilizar `GET /contacto/motivos`: ese es el del
   * formulario público y sirve el ámbito contrario (PUBLIC + BOTH). Tampoco
   * `GET /admin/contact-reasons`, que es ADMIN-only y devuelve también los
   * inactivos.
   *
   * DECLARADO ANTES QUE `:id` a propósito — si fuera después, Nest resolvería
   * `/tickets/topics` contra la ruta dinámica y buscaría un ticket con id
   * "topics" (mismo motivo por el que `reorder` va antes que `:id` en
   * FooterAdminController).
   */
  @Get('topics')
  @ApiOperation({ summary: 'Motivos disponibles para abrir un ticket (scope TICKET o BOTH)' })
  listTopics() {
    return this.contactReasons.listActive(['TICKET', 'BOTH']);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ver un hilo propio (mensajes más recientes primero, cursor-based)',
    description:
      'Usa ?before=<messageId> para cargar mensajes más antiguos. Al abrir, marca como leídos ' +
      'los mensajes del staff pendientes. Las notas internas del staff NUNCA se devuelven.',
  })
  @ApiParam({ name: 'id', description: 'ID del ticket' })
  @ApiResponse({ status: 200, description: 'Ticket con mensajes y nextCursor' })
  @ApiResponse({ status: 403, description: 'Este ticket no es tuyo' })
  @ApiResponse({ status: 404, description: 'Ticket no encontrado' })
  getOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Query() query: TicketThreadQueryDto,
  ) {
    return this.tickets.getForUser(id, user.userId, query);
  }

  /**
   * Responder. Dispara las transiciones automáticas de la matriz: T5
   * (WAITING_USER → IN_PROGRESS), T6 (OPEN sin cambio) y T8 (RESOLVED →
   * IN_PROGRESS: responder ES reabrir, dentro de la ventana de 14 días).
   *
   * NO hay `POST /tickets/:id/reopen` aparte, a propósito. La matriz aprobada
   * (§7.2) modela T8 como EFECTO de responder, no como transición propia: un
   * endpoint de reapertura sin mensaje devolvería el ticket a la bandeja del
   * agente sin nada nuevo que leer, y crearía un segundo camino a IN_PROGRESS
   * que habría que mantener en sincronía con este. Reabrir es escribir.
   */
  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Responder en un hilo propio (reabre si estaba RESOLVED)' })
  @ApiParam({ name: 'id', description: 'ID del ticket' })
  @ApiResponse({ status: 201, description: 'Mensaje creado; devuelve el ticket con su nuevo estado' })
  @ApiResponse({
    status: 400,
    description: 'Ticket cerrado, o ventana de reapertura de 14 días expirada',
  })
  @ApiResponse({ status: 403, description: 'Este ticket no es tuyo' })
  reply(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: SendTicketMessageDto,
  ) {
    return this.tickets.replyAsUser(id, user.userId, dto.body);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cerrar un ticket propio (T11) — IRREVERSIBLE',
    description:
      'Solo tickets de origin=USER. Un hilo iniciado por la administración (ADMIN/REPORT) no lo ' +
      'puede cerrar el usuario: sería la vía para esquivar una comunicación de moderación.',
  })
  @ApiParam({ name: 'id', description: 'ID del ticket' })
  @ApiResponse({ status: 200, description: 'Ticket cerrado' })
  @ApiResponse({ status: 400, description: 'El ticket ya está cerrado' })
  @ApiResponse({ status: 403, description: 'No es tuyo, o lo inició la administración' })
  close(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.tickets.closeAsUser(id, user.userId);
  }
}
