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
  StreamableFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import { JwtAuthGuard, RolesGuard } from '../../common/guards';
import { CurrentUser, Roles } from '../../common/decorators';
import { JwtUser } from '../auth/auth.types';
import { TicketsService } from './tickets.service';
import {
  TicketAttachmentsService,
  attachmentDisposition,
} from './ticket-attachments.service';
import {
  TICKET_ATTACHMENT_MULTER_MAX_BYTES,
  TICKET_ATTACHMENT_MULTER_MAX_FILES,
} from './tickets.constants';
import { StaffActor } from './tickets.types';
import { ListAdminTicketsDto } from './dto/list-admin-tickets.dto';
import { CreateAdminTicketDto } from './dto/create-admin-ticket.dto';
import { CreateTicketFromReportDto } from './dto/create-ticket-from-report.dto';
import { ReassignTicketDto } from './dto/reassign-ticket.dto';
import { SendStaffMessageDto } from './dto/send-staff-message.dto';

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
  constructor(
    private readonly tickets: TicketsService,
    private readonly attachments: TicketAttachmentsService,
  ) {}

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
    summary: 'Responder como staff (T3/T4), o dejar una NOTA INTERNA',
    description:
      'Con `internal: false` (o ausente) es una respuesta al usuario: OPEN o IN_PROGRESS → ' +
      'WAITING_USER, y asigna el ticket al autor si no lo llevaba nadie. ' +
      'Con `internal: true` es una NOTA INTERNA: se guarda en el hilo, la ve solo el equipo, y ' +
      'NO toca el ticket (ni estado, ni asignación, ni "último movimiento" — ese campo lo lee el ' +
      'usuario) ni dispara ningún aviso.',
  })
  @ApiResponse({ status: 400, description: 'El ticket está cerrado o resuelto' })
  @ApiResponse({ status: 422, description: 'Adjunto no admitido: tipo, tamaño o número' })
  // R5 — igual que la ruta de usuario: multipart además de JSON, con los límites
  // de multer como tope de memoria y el 422 del servicio como regla de negocio.
  @ApiConsumes('application/json', 'multipart/form-data')
  @UseInterceptors(
    FilesInterceptor('files', TICKET_ATTACHMENT_MULTER_MAX_FILES, {
      storage: memoryStorage(),
      limits: { fileSize: TICKET_ATTACHMENT_MULTER_MAX_BYTES },
    }),
  )
  reply(
    @Param('id') id: string,
    @CurrentUser() user: JwtUser,
    @Body() dto: SendStaffMessageDto,
    @Ip() ip: string,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.tickets.replyAsStaff(
      id,
      this.actor(user),
      dto.body,
      ip,
      dto.internal ?? false,
      files ?? [],
    );
  }

  /**
   * R5 — descarga de un adjunto desde el lado del staff. Mismo molde FACTURA que
   * la del usuario, con dos diferencias:
   *
   * - las notas internas SÍ se sirven (el staff es su destinatario);
   * - se aplica la puerta ADMIN-only por contenido de fila: un MODERATOR no baja
   *   el adjunto de un ticket con factura enlazada, igual que no puede abrirlo.
   *   Poder descargar el fichero de un hilo que no se puede leer sería la puerta
   *   de atrás de esa puerta.
   */
  @Get(':id/attachments/:attachmentId')
  @ApiOperation({ summary: 'Descargar un adjunto de un ticket (staff)' })
  @ApiParam({ name: 'id', description: 'ID del ticket' })
  @ApiParam({ name: 'attachmentId', description: 'ID del adjunto' })
  @ApiResponse({ status: 200, description: 'El fichero' })
  @ApiResponse({ status: 403, description: 'Ticket con factura: solo ADMIN' })
  @ApiResponse({ status: 404, description: 'El adjunto no existe o no es de este ticket' })
  async downloadAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: JwtUser,
  ): Promise<StreamableFile> {
    const { buffer, filename, mimeType } = await this.attachments.downloadForStaff(
      id,
      attachmentId,
      this.actor(user),
    );
    return new StreamableFile(buffer, {
      type: mimeType,
      disposition: attachmentDisposition(filename),
    });
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
