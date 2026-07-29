import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
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
import { JwtAuthGuard } from '../../common/guards';
import { CurrentUser } from '../../common/decorators';
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
    private readonly attachments: TicketAttachmentsService,
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
  @ApiResponse({
    status: 422,
    description: 'Adjunto no admitido: tipo, tamaño o número de ficheros',
  })
  // R5 — la ruta acepta AHORA multipart además de JSON. El interceptor de multer
  // solo actúa sobre peticiones `multipart/form-data`; un cuerpo JSON sigue
  // llegando exactamente igual que antes (por eso las suites de R2/R3, que envían
  // JSON, no notan el cambio). Los límites de multer son el TOPE DE MEMORIA, no la
  // regla de negocio: esa la aplica el servicio con un 422 que dice cuál se ha
  // pasado. Ver `tickets.constants.ts`.
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
    @Body() dto: SendTicketMessageDto,
    @UploadedFiles() files?: Express.Multer.File[],
  ) {
    return this.tickets.replyAsUser(id, user.userId, dto.body, files ?? []);
  }

  /**
   * R5 — DESCARGA DE UN ADJUNTO. Molde `GET /billing/invoices/:id/pdf`: endpoint
   * AUTENTICADO que baja el objeto de R2 y lo devuelve como `StreamableFile`.
   *
   * **NO HAY, Y NO PUEDE HABER, UNA URL PÚBLICA.** Es la diferencia entera con
   * `media`: allí la respuesta de subida ES una URL servida por el bucket; aquí
   * el fichero solo existe detrás de este endpoint, que revalida el acceso en
   * CADA descarga. Revocar el acceso es dejar de pasar por él.
   */
  @Get(':id/attachments/:attachmentId')
  @ApiOperation({ summary: 'Descargar un adjunto de un hilo propio' })
  @ApiParam({ name: 'id', description: 'ID del ticket' })
  @ApiParam({ name: 'attachmentId', description: 'ID del adjunto' })
  @ApiResponse({ status: 200, description: 'El fichero' })
  @ApiResponse({ status: 403, description: 'Este ticket no es tuyo' })
  @ApiResponse({
    status: 404,
    description:
      'El adjunto no existe, no es de este ticket, o pertenece a una nota interna del staff ' +
      '(para el usuario, una nota interna no existe)',
  })
  async downloadAttachment(
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: JwtUser,
  ): Promise<StreamableFile> {
    const { buffer, filename, mimeType } = await this.attachments.downloadForUser(
      id,
      attachmentId,
      user.userId,
    );
    return new StreamableFile(buffer, {
      type: mimeType,
      disposition: attachmentDisposition(filename),
    });
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
