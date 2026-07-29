import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { TicketsService } from './tickets.service';
import { StaffActor } from './tickets.types';
import { ListAdminTicketsDto } from './dto/list-admin-tickets.dto';
import { CreateAdminTicketDto } from './dto/create-admin-ticket.dto';
import { CreateTicketFromReportDto } from './dto/create-ticket-from-report.dto';
import { ReassignTicketDto } from './dto/reassign-ticket.dto';
import { SendTicketMessageDto } from './dto/send-ticket-message.dto';

/**
 * Atención al usuario R3 — API de STAFF. Bandeja, transiciones y los flujos
 * (b) admin→usuario y (c) contactar-al-reportado.
 *
 * `@Roles(MODERATOR, ADMIN)` a nivel de clase, molde `ModerationController`.
 * Controlador SEPARADO del de usuario (mismo reparto que ContactModule): las dos
 * superficies tienen guards, DTOs y payloads distintos, y mezclarlas sería el
 * camino más corto a servir una por la puerta de la otra.
 *
 * DOS PUERTAS ADMIN-ONLY que el `RolesGuard` NO puede vigilar, porque dependen
 * del CONTENIDO de la fila y no de la ruta — viven en el servicio:
 *   · un ticket con `invoiceId` enlazada es ADMIN-only (facturación lo es en todo
 *     el proyecto). El MODERATOR ni lo ve en la bandeja ni puede operarlo.
 *   · reasignar el ticket de OTRO agente es ADMIN-only.
 *
 * SIN notificaciones ni email todavía: eso es R4. Aquí solo transiciones y
 * AuditLog.
 */
@ApiTags('Admin — Tickets')
@ApiBearerAuth('access-token')
@Controller('admin/tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.MODERATOR, Role.ADMIN)
export class AdminTicketsController {
  constructor(private readonly tickets: TicketsService) {}

  /** El actor que consume el servicio: id + ROL (el rol es lo que abre las dos puertas). */
  private actor(user: JwtUser): StaffActor {
    return { userId: user.userId, role: user.role };
  }

  // ─── Bandeja ───────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({
    summary: 'Bandeja de tickets',
    description:
      'Orden por último movimiento. Filtros por estado, origen, motivo y agente ' +
      "(`assignedTo=me` los míos, `assignedTo=none` sin asignar). Un MODERATOR NO ve " +
      'aquí los tickets con factura enlazada.',
  })
  list(@CurrentUser() user: JwtUser, @Query() query: ListAdminTicketsDto) {
    return this.tickets.listForStaff(this.actor(user), query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ver un hilo completo (incluidas las notas internas del staff)',
    description: 'Marca como leídos los mensajes del usuario pendientes.',
  })
  @ApiParam({ name: 'id', description: 'ID del ticket' })
  @ApiResponse({ status: 403, description: 'Ticket con factura enlazada y el actor no es ADMIN' })
  @ApiResponse({ status: 404, description: 'Ticket no encontrado' })
  getOne(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.tickets.getForStaff(id, this.actor(user));
  }

  // ─── Transiciones de staff ─────────────────────────────────────────────────

  @Post(':id/take')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Tomar el ticket (T2: OPEN → IN_PROGRESS, auto-asignación)' })
  @ApiResponse({ status: 400, description: 'Solo se pueden tomar tickets en estado OPEN' })
  take(@Param('id') id: string, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.tickets.take(id, this.actor(user), ip);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Responder como staff (T3/T4)',
    description:
      'OPEN o IN_PROGRESS → WAITING_USER; responder sin haber tomado el ticket lo asigna de paso. ' +
      'El mensaje sale siempre con side STAFF e internal=false — las notas internas siguen aplazadas.',
  })
  @ApiResponse({ status: 400, description: 'El ticket está cerrado o resuelto' })
  reply(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: SendTicketMessageDto,
    @Ip() ip: string,
  ) {
    return this.tickets.replyAsStaff(id, this.actor(user), dto.body, ip);
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Marcar como resuelto (T7: IN_PROGRESS | WAITING_USER → RESOLVED)' })
  @ApiResponse({ status: 400, description: 'Solo desde IN_PROGRESS o WAITING_USER' })
  resolve(@Param('id') id: string, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.tickets.resolve(id, this.actor(user), ip);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cerrar (T10) — IRREVERSIBLE' })
  @ApiResponse({ status: 400, description: 'El ticket ya está cerrado' })
  close(@Param('id') id: string, @CurrentUser() user: JwtUser, @Ip() ip: string) {
    return this.tickets.closeAsStaff(id, this.actor(user), ip);
  }

  @Post(':id/reassign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reasignar a otro agente',
    description:
      'Un MODERATOR puede coger uno sin asignar o mover el suyo; quitarle el ticket a OTRO agente ' +
      'es ADMIN-only.',
  })
  @ApiResponse({ status: 403, description: 'El ticket lo lleva otro agente y el actor no es ADMIN' })
  @ApiResponse({ status: 422, description: 'El destinatario no es ADMIN ni MODERATOR' })
  reassign(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: ReassignTicketDto,
    @Ip() ip: string,
  ) {
    return this.tickets.reassign(id, this.actor(user), dto.assignedToId, ip);
  }

  // ─── Flujos (b) y (c) ──────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'FLUJO (b) — abrir un hilo con un usuario concreto',
    description:
      'origin=ADMIN. Nace en WAITING_USER y asignado al agente que lo abre. El usuario se elige ' +
      'con GET /users/search. Los enlaces se validan contra el usuario DESTINATARIO.',
  })
  @ApiResponse({ status: 201, description: 'Ticket creado' })
  @ApiResponse({ status: 422, description: 'Entidad enlazada no válida para ese usuario' })
  createForUser(
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateAdminTicketDto,
    @Ip() ip: string,
  ) {
    return this.tickets.createByStaff(this.actor(user), { ...dto, origin: 'ADMIN' }, ip);
  }

  @Post('from-report/:reportId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'FLUJO (c) — contactar con el usuario reportado, desde un Report',
    description:
      'origin=REPORT con reportId enlazado. El Report NO se modifica: se lee para resolver el ' +
      'destinatario y se referencia. Resolver el reporte y cerrar el ticket son acciones ' +
      'independientes. El destinatario lo resuelve el SERVIDOR — el body no puede elegirlo.',
  })
  @ApiParam({ name: 'reportId', description: 'ID del Report de moderación' })
  @ApiResponse({ status: 201, description: 'Ticket creado' })
  @ApiResponse({ status: 404, description: 'Reporte no encontrado' })
  @ApiResponse({ status: 422, description: 'El reporte no identifica a ningún usuario' })
  createFromReport(
    @Param('reportId') reportId: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: CreateTicketFromReportDto,
    @Ip() ip: string,
  ) {
    return this.tickets.createFromReport(this.actor(user), reportId, dto, ip);
  }
}
