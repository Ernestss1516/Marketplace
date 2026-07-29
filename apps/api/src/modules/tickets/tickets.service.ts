import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, Ticket, TicketMessage, TicketStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RateLimitService } from '../../infra/redis/rate-limit.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { TicketNotificationsService } from './ticket-notifications.service';
import {
  ASSIGNED_TO_ME,
  ASSIGNED_TO_NONE,
  CreateStaffTicketInput,
  CreateUserTicketInput,
  StaffActor,
  StaffTicketFilters,
  TicketLinkInput,
} from './tickets.types';
import {
  TICKET_CREATE_LIMIT_PER_DAY,
  TICKET_CREATE_WINDOW_SECONDS,
  TICKET_MESSAGES_DEFAULT_LIMIT,
  TICKET_REOPEN_WINDOW_DAYS,
  TICKET_WINDOW_SETTING_KEY,
} from './tickets.constants';

/**
 * Contexto enlazado del hilo — compartido por las dos vías de lectura. Los
 * `select` son deliberadamente estrechos: lo justo para pintar la tarjeta de la
 * entidad enlazada. Ni el listing ni la invoice viajan enteros (el primero
 * arrastraría `phone`, que NUNCA debe salir en un payload que no sea el suyo —
 * ver la lección de Listing.phone en estado-tecnico.md).
 */
const TICKET_CONTEXT_INCLUDE = {
  topic: { select: { id: true, nombre: true } },
  user: { select: { id: true, name: true, slug: true } },
  assignedTo: { select: { id: true, name: true } },
  listing: { select: { id: true, title: true, slug: true } },
  review: { select: { id: true, rating: true } },
  invoice: { select: { id: true, number: true, status: true } },
} as const;

/**
 * Orden del hilo: DESC (más reciente primero), molde exacto de
 * `MessagingService.getConversation` — el frontend invierte el array para
 * mostrarlo. Es lo que hace posible la paginación por cursor hacia atrás
 * (`before`), que es como se lee un hilo largo: se abre por el final y se sube.
 */
const MESSAGE_ORDER = { createdAt: 'desc' } as const;

export type TicketWithMessage = { ticket: Ticket; message: TicketMessage };

/** Paginación por cursor del hilo (molde MessagesQueryDto). */
export interface TicketThreadQuery {
  /** Id del mensaje pivote: devuelve los ANTERIORES a él. */
  before?: string;
  limit?: number;
}

/**
 * Atención al usuario R1 — modelo + MÁQUINA DE ESTADOS.
 *
 * SIN controladores todavía (llegan en R2/R3): los métodos públicos de aquí son
 * la superficie que se ejercita en `test/tickets-state-machine.e2e-spec.ts`.
 *
 * Las transiciones válidas se declaran como ARRAYS ESTÁTICOS PRIVADOS, molde
 * `ListingsService.ARCHIVABLE_STATUSES`. NO se introduce ninguna abstracción de
 * máquina de estados: el proyecto no tiene ninguna (ni Listing, ni Invoice, ni
 * Report la tienen) y R1 no es el sitio para inventarla.
 *
 * `CLOSED` NO APARECE COMO ESTADO ORIGEN EN NINGUNO DE LOS CUATRO ARRAYS. Esa
 * ausencia ES el mecanismo de irreversibilidad — exactamente como
 * `ListingStatus.ARCHIVED`, del que tampoco sale ninguna transición porque
 * ningún método lo acepta como punto de partida. Añadir CLOSED a cualquiera de
 * estos arrays rompería la garantía; el test de irreversibilidad ejerce las SEIS
 * puertas de salida (take, replyAsStaff, replyAsUser, resolve, closeAsStaff,
 * closeAsUser) y confirma que todas rechazan.
 *
 * Ver docs/diseno-atencion-usuario.md §7 (matriz de transiciones T1-T11).
 */
@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    private readonly rateLimit: RateLimitService,
    private readonly notify: TicketNotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Transiciones permitidas (§7.3)
  // ---------------------------------------------------------------------------

  /** T3/T4 — el staff puede responder mientras el hilo siga vivo y sin resolver. */
  private static readonly STAFF_REPLYABLE: TicketStatus[] = [
    'OPEN',
    'IN_PROGRESS',
    'WAITING_USER',
  ];

  /** T5/T6/T8 — incluye RESOLVED: responder ahí ES la reapertura (T8). */
  private static readonly USER_REPLYABLE: TicketStatus[] = [
    'OPEN',
    'IN_PROGRESS',
    'WAITING_USER',
    'RESOLVED',
  ];

  /** T7 — no se resuelve lo que nadie ha atendido: OPEN no vale (hay que tomarlo). */
  private static readonly RESOLVABLE: TicketStatus[] = ['IN_PROGRESS', 'WAITING_USER'];

  /** T9/T10/T11 — cerrar se puede desde cualquier estado vivo. */
  private static readonly CLOSABLE: TicketStatus[] = [
    'OPEN',
    'IN_PROGRESS',
    'WAITING_USER',
    'RESOLVED',
  ];

  // ---------------------------------------------------------------------------
  // T1 — apertura
  // ---------------------------------------------------------------------------

  /**
   * T1 flujo (a) — el usuario abre su propio ticket. `origin` es USER y
   * `openedById === userId` por construcción: no se aceptan del llamador.
   *
   * Sin AuditLog: es una acción de usuario, no administrativa. Su rastro es el
   * propio hilo (AuditLog es "el registro de cada acción administrativa
   * sensible", ver su doc-comment en schema.prisma).
   *
   * R2 cierra el pendiente anotado en R1: la PROPIEDAD de la entidad enlazada se
   * valida aquí (`assertLinkable`), y `linkedLabel` se deriva EN EL SERVIDOR del
   * título/número real — nunca se acepta del cliente.
   */
  async createByUser(userId: string, input: CreateUserTicketInput): Promise<Ticket> {
    // Antes de tocar la BD, como el rate limit de /contacto y el de revelar
    // teléfono: quien abusa agota su cupo sin llegar a escribir nada.
    const { limited } = await this.rateLimit.checkAndIncrement(
      `tickets:create:user:${userId}`,
      TICKET_CREATE_LIMIT_PER_DAY,
      TICKET_CREATE_WINDOW_SECONDS,
    );
    if (limited) {
      throw new HttpException(
        {
          code: 'TICKET_RATE_LIMIT',
          message: 'Has abierto demasiados tickets hoy. Inténtalo mañana.',
          retryAfter: TICKET_CREATE_WINDOW_SECONDS,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    await this.assertTopicUsableInTickets(input.topicId);
    const link = await this.assertLinkable(userId, input);

    const { ticket, message } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
        data: {
          subject: input.subject,
          status: 'OPEN',
          origin: 'USER',
          topicId: input.topicId ?? null,
          userId,
          openedById: userId,
          ...link,
          lastMessageAt: new Date(),
        },
      });

      const first = await this.writeMessage(tx, created.id, userId, 'USER', input.body);
      return { ticket: created, message: first };
    });

    // R4 — TRAS EL COMMIT, nunca dentro: si la transacción falla no se avisa de
    // un ticket que no existe. Molde ContactService.submit (persiste y luego
    // notifica) y ListingsService (encola el reindexado después de escribir).
    await this.notify.staffNewActivity(ticket, message, 'new');
    return ticket;
  }

  // ---------------------------------------------------------------------------
  // Guards de enlace y de motivo (R2)
  // ---------------------------------------------------------------------------

  /**
   * EL GUARD CLAVE DE R2 — sin él, `listingId`/`reviewId`/`invoiceId` son un
   * ORÁCULO DE EXISTENCIA: cualquiera podría sondear ids ajenos y distinguir
   * "existe pero no es tuyo" de "no existe" por la respuesta.
   *
   * Por eso los dos casos comparten EXACTAMENTE la misma excepción y el mismo
   * mensaje — 422 `LINKED_ENTITY_NOT_ALLOWED`, sin decir cuál de los dos fue.
   * Un 404 para "no existe" y un 403 para "no es tuyo" sería justo la fuga que
   * esto cierra. Ejercido como ataque en `tickets-user.e2e-spec.ts`.
   *
   * Devuelve además el `linkedLabel` DERIVADO EN EL SERVIDOR del título/número
   * real. Nunca se acepta del cliente: si se aceptara, el snapshot podría mentir
   * sobre a qué apunta el ticket.
   */
  private async assertLinkable(userId: string, input: TicketLinkInput) {
    const provided = [input.listingId, input.reviewId, input.invoiceId].filter(Boolean);
    if (provided.length === 0) {
      return { listingId: null, reviewId: null, invoiceId: null, linkedLabel: null };
    }
    // Un ticket habla de UNA cosa. `linkedLabel` es un único snapshot, así que
    // dos enlaces a la vez lo dejarían ambiguo — y el diseño §2 dice "un anuncio
    // O una valoración O una factura", no varias.
    if (provided.length > 1) {
      throw new UnprocessableEntityException({
        code: 'MULTIPLE_LINKED_ENTITIES',
        message: 'Un ticket solo puede enlazar un anuncio, una valoración o una factura.',
      });
    }

    if (input.listingId) {
      const listing = await this.prisma.listing.findUnique({
        where: { id: input.listingId },
        select: { sellerId: true, title: true },
      });
      // `!listing` y "no es mío" caen en el MISMO throw, deliberadamente.
      if (!listing || listing.sellerId !== userId) this.throwNotLinkable();
      return {
        listingId: input.listingId,
        reviewId: null,
        invoiceId: null,
        linkedLabel: listing!.title,
      };
    }

    if (input.reviewId) {
      const review = await this.prisma.review.findUnique({
        where: { id: input.reviewId },
        select: { authorId: true, targetId: true, listingTitle: true, rating: true },
      });
      // Autor O receptor: ambos lados tienen motivos legítimos para consultar
      // sobre una valoración (quien la escribió y quien la recibió).
      if (!review || (review.authorId !== userId && review.targetId !== userId)) {
        this.throwNotLinkable();
      }
      return {
        listingId: null,
        reviewId: input.reviewId,
        invoiceId: null,
        linkedLabel: `Valoración ${review!.rating}★${review!.listingTitle ? ` — ${review!.listingTitle}` : ''}`,
      };
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id: input.invoiceId! },
      select: { userId: true, number: true },
    });
    if (!invoice || invoice.userId !== userId) this.throwNotLinkable();
    return {
      listingId: null,
      reviewId: null,
      invoiceId: input.invoiceId!,
      linkedLabel: `Factura ${invoice!.number ?? input.invoiceId!}`,
    };
  }

  /** Un único punto de salida para las dos causas — ver assertLinkable. */
  private throwNotLinkable(): never {
    throw new UnprocessableEntityException({
      code: 'LINKED_ENTITY_NOT_ALLOWED',
      message: 'No puedes enlazar esa entidad a un ticket.',
    });
  }

  /**
   * El motivo debe existir, estar activo y ofrecerse en tickets (scope TICKET o
   * BOTH). Un motivo PUBLIC-only es del formulario de /contacto y no pinta en un
   * ticket. Mismo criterio y mismo 400 que `ContactService.submit`: un motivo
   * inválido es un dato mal, no una señal de ataque.
   */
  private async assertTopicUsableInTickets(topicId?: string | null): Promise<void> {
    if (!topicId) return;
    const topic = await this.prisma.contactReason.findUnique({
      where: { id: topicId },
      select: { activo: true, scope: true },
    });
    if (!topic || !topic.activo || topic.scope === 'PUBLIC') {
      throw new BadRequestException('Motivo no válido');
    }
  }

  /**
   * T1 flujos (b) y (c) — la administración inicia el hilo con un usuario.
   *
   * AJUSTE SOBRE R1 (decidido tras entregarla): nace en WAITING_USER, no en OPEN.
   * El primer mensaje ya es del staff, así que la pelota está en el usuario desde
   * el minuto uno — dejarlo OPEN lo metía en la bandeja de "sin atender" cuando
   * en realidad estaba atendido y a la espera.
   *
   * Corolario NECESARIO: se asigna al agente que lo abre. `take()` solo acepta
   * OPEN (T2), así que un ticket que nace en WAITING_USER sin asignar sería
   * inalcanzable para la asignación — quedaría huérfano para siempre. Misma
   * semántica que T4: escribir como staff implica hacerse cargo.
   */
  async createByStaff(
    actor: StaffActor,
    input: CreateStaffTicketInput,
    ip?: string,
  ): Promise<Ticket> {
    // Guard estructural: `origin` USER significaría "lo abrió el usuario", que es
    // justo lo que NO ha pasado aquí. El tipo ya lo excluye; esto cubre el paso
    // de un valor sin tipar desde JS o desde un DTO futuro mal construido.
    if (input.origin !== 'ADMIN' && input.origin !== 'REPORT') {
      throw new BadRequestException('Un ticket abierto por la administración debe tener origin ADMIN o REPORT');
    }

    await this.assertTopicUsableInTickets(input.topicId);
    // Los enlaces se validan contra el USUARIO DESTINATARIO, no contra el agente:
    // `linkedLabel` (que puede llevar el número de una factura o el título de un
    // anuncio) SE LE SIRVE A ÉL en GET /tickets/:id. Enlazar aquí la factura de
    // otra persona no sería un descuido administrativo — sería filtrarle a un
    // usuario el dato de un tercero. Mismo guard que en la vía de usuario, con
    // el dueño del hilo como sujeto.
    const link = await this.assertLinkable(input.userId, input);

    const { ticket, message } = await this.prisma.$transaction(async (tx) => {
      const created = await tx.ticket.create({
        data: {
          subject: input.subject,
          status: 'WAITING_USER',
          origin: input.origin,
          topicId: input.topicId ?? null,
          userId: input.userId,
          openedById: actor.userId,
          assignedToId: actor.userId,
          reportId: input.reportId ?? null,
          ...link,
          lastMessageAt: new Date(),
        },
      });

      const first = await this.writeMessage(tx, created.id, actor.userId, 'STAFF', input.body);

      await this.auditLog.log(
        {
          action: 'TICKET_OPEN_BY_ADMIN',
          actorId: actor.userId,
          resourceType: 'Ticket',
          resourceId: created.id,
          after: { status: created.status, origin: created.origin, userId: created.userId },
          ip,
        },
        tx,
      );

      return { ticket: created, message: first };
    });

    // R4 — flujos (b)/(c): al usuario le consta que la administración ha abierto
    // un hilo con él (TICKET_OPENED, no TICKET_MESSAGE: no es una respuesta).
    await this.notify.userStaffWrote(ticket, message, true);
    return ticket;
  }

  /**
   * FLUJO (c) — abrir un hilo con el usuario reportado, a partir de un Report.
   *
   * `Report` NO SE TOCA: se LEE para resolver el destinatario y se referencia
   * desde `Ticket.reportId`. Ni su estado ni ningún campo suyo cambian aquí, y
   * la cola de moderación sigue siendo la única dueña de su ciclo de vida
   * (decisión §8.3: el triaje ya existe y está probado; lo que faltaba era el
   * canal de comunicación, no otra cola).
   *
   * El DESTINATARIO lo resuelve el SERVIDOR desde el propio reporte, en el orden
   * en que un reporte identifica a su sujeto: usuario reportado → vendedor del
   * anuncio reportado → autor de la valoración reportada. Nunca se acepta del
   * cliente: si se aceptara, este endpoint sería una vía para abrir un hilo
   * "oficial" con cualquiera usando un reporte ajeno como excusa.
   */
  async createFromReport(
    actor: StaffActor,
    reportId: string,
    input: { subject: string; body: string; topicId?: string | null },
    ip?: string,
  ): Promise<Ticket> {
    const report = await this.prisma.report.findUnique({
      where: { id: reportId },
      select: {
        id: true,
        reportedUserId: true,
        listing: { select: { sellerId: true } },
        review: { select: { authorId: true } },
      },
    });
    if (!report) throw new NotFoundException('Reporte no encontrado');

    const targetUserId =
      report.reportedUserId ?? report.listing?.sellerId ?? report.review?.authorId ?? null;
    if (!targetUserId) {
      throw new UnprocessableEntityException({
        code: 'REPORT_WITHOUT_TARGET_USER',
        message:
          'No se puede determinar el usuario de este reporte (ni usuario reportado, ni anuncio, ni valoración con autor).',
      });
    }

    return this.createByStaff(
      actor,
      {
        userId: targetUserId,
        subject: input.subject,
        body: input.body,
        origin: 'REPORT',
        topicId: input.topicId ?? null,
        reportId: report.id,
      },
      ip,
    );
  }

  // ---------------------------------------------------------------------------
  // Bandeja de staff (R3)
  // ---------------------------------------------------------------------------

  /**
   * La BANDEJA. Molde `ContactService.list` / `ModerationService.listReports`:
   * page/perPage + `$transaction([findMany, count])`.
   *
   * FILTRADO POR ROL: un MODERATOR no ve los tickets con factura enlazada. Se
   * excluyen de la LISTA, no solo del detalle — listar lo que no se puede abrir
   * sería enseñar el asunto y el nombre del usuario de un hilo de facturación a
   * quien no tiene acceso a facturación, además de producir 403 al hacer clic.
   */
  async listForStaff(actor: StaffActor, filters: StaffTicketFilters = {}) {
    const { status, origin, topicId, assignedTo, page = 1, perPage = 25 } = filters;

    const where: Prisma.TicketWhereInput = {
      ...(status && { status }),
      ...(origin && { origin }),
      ...(topicId && { topicId }),
      ...this.assignedFilter(actor, assignedTo),
      ...(actor.role === 'ADMIN' ? {} : { invoiceId: null }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          topic: { select: { id: true, nombre: true } },
          user: { select: { id: true, name: true, slug: true, email: true } },
          assignedTo: { select: { id: true, name: true } },
          _count: {
            // Pendientes de atender por el staff: lo que el usuario ha escrito y
            // nadie ha abierto todavía.
            select: { messages: { where: { side: 'USER', readByStaffAt: null } } },
          },
        },
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return {
      items: items.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        origin: t.origin,
        topic: t.topic,
        user: t.user,
        assignedTo: t.assignedTo,
        linkedLabel: t.linkedLabel,
        hasInvoice: t.invoiceId !== null,
        reportId: t.reportId,
        lastMessageAt: t.lastMessageAt,
        createdAt: t.createdAt,
        unreadFromUser: t._count.messages,
      })),
      total,
      page,
      perPage,
      pages: Math.ceil(total / perPage),
    };
  }

  /** Traduce los centinelas `me`/`none` del filtro de asignación. */
  private assignedFilter(actor: StaffActor, assignedTo?: string): Prisma.TicketWhereInput {
    if (!assignedTo) return {};
    if (assignedTo === ASSIGNED_TO_NONE) return { assignedToId: null };
    if (assignedTo === ASSIGNED_TO_ME) return { assignedToId: actor.userId };
    return { assignedToId: assignedTo };
  }

  /**
   * PUERTA ADMIN-ONLY POR CONTENIDO DE FILA. El `RolesGuard` no puede decidir
   * esto: depende de si ESTE ticket lleva factura, no de la ruta.
   *
   * Se aplica a TODAS las operaciones de staff sobre el ticket, no solo a ver y
   * responder. Un MODERATOR que pudiera resolver o cerrar un hilo que no puede
   * leer sería una incoherencia con consecuencias reales: cerraría a ciegas una
   * reclamación de facturación. La regla es "este hilo no es tuyo", y eso no
   * admite excepciones por verbo.
   */
  private assertCanHandle(ticket: Ticket, actor: StaffActor): void {
    if (ticket.invoiceId && actor.role !== 'ADMIN') {
      throw new ForbiddenException({
        code: 'TICKET_BILLING_ADMIN_ONLY',
        message: 'Los tickets con una factura enlazada solo los gestiona un administrador.',
      });
    }
  }

  /** Carga + guard de contenido, para las transiciones de staff. */
  private async loadForStaff(ticketId: string, actor: StaffActor): Promise<Ticket> {
    const ticket = await this.loadTicket(ticketId);
    this.assertCanHandle(ticket, actor);
    return ticket;
  }

  // ---------------------------------------------------------------------------
  // T2 — el staff toma el ticket
  // ---------------------------------------------------------------------------

  /** T2 — OPEN → IN_PROGRESS, asignándose el agente a sí mismo. */
  async take(ticketId: string, actor: StaffActor, ip?: string): Promise<Ticket> {
    const existing = await this.loadForStaff(ticketId, actor);
    if (existing.status !== 'OPEN') {
      throw new BadRequestException('Solo se pueden tomar tickets en estado OPEN');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.update({
        where: { id: ticketId },
        data: { status: 'IN_PROGRESS', assignedToId: actor.userId },
      });

      await this.auditLog.log(
        {
          action: 'TICKET_ASSIGN',
          actorId: actor.userId,
          resourceType: 'Ticket',
          resourceId: ticketId,
          before: { status: existing.status, assignedToId: existing.assignedToId },
          after: { status: updated.status, assignedToId: updated.assignedToId },
          ip,
        },
        tx,
      );

      return updated;
    });
  }

  /**
   * Reasignar a otro agente.
   *
   * SEGUNDA PUERTA ADMIN-ONLY POR CONTENIDO: un MODERATOR puede coger uno SIN
   * ASIGNAR o mover el SUYO, pero no quitarle el ticket a otro agente. Robar el
   * caso de un compañero es una decisión de coordinación, no de atención — y sin
   * este guard sería además la vía para saltarse "no toques lo que no llevas".
   */
  async reassign(
    ticketId: string,
    actor: StaffActor,
    assignedToId: string,
    ip?: string,
  ): Promise<Ticket> {
    const existing = await this.loadForStaff(ticketId, actor);

    const perteneceAOtro =
      existing.assignedToId !== null && existing.assignedToId !== actor.userId;
    if (perteneceAOtro && actor.role !== 'ADMIN') {
      throw new ForbiddenException({
        code: 'TICKET_REASSIGN_ADMIN_ONLY',
        message: 'Solo un administrador puede reasignar el ticket de otro agente.',
      });
    }

    const nuevo = await this.prisma.user.findUnique({
      where: { id: assignedToId },
      select: { role: true },
    });
    // Asignar a alguien que no es staff dejaría el ticket en manos de quien no
    // puede abrirlo — el mismo callejón sin salida que el corolario de R2.
    if (!nuevo || (nuevo.role !== 'ADMIN' && nuevo.role !== 'MODERATOR')) {
      throw new UnprocessableEntityException({
        code: 'ASSIGNEE_NOT_STAFF',
        message: 'Solo se puede asignar un ticket a un administrador o moderador.',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.update({
        where: { id: ticketId },
        data: { assignedToId },
      });

      await this.auditLog.log(
        {
          action: 'TICKET_ASSIGN',
          actorId: actor.userId,
          resourceType: 'Ticket',
          resourceId: ticketId,
          before: { assignedToId: existing.assignedToId },
          after: { assignedToId: updated.assignedToId },
          ip,
        },
        tx,
      );

      return updated;
    });
  }

  // ---------------------------------------------------------------------------
  // T3/T4 — respuesta del staff
  // ---------------------------------------------------------------------------

  /**
   * T3 (IN_PROGRESS → WAITING_USER) y T4 (OPEN → WAITING_USER, asignando de paso
   * al autor: responder implica tomarlo). Responder desde WAITING_USER también
   * vale — el agente puede mandar dos mensajes seguidos — y deja el estado igual.
   *
   * El `side` del mensaje se congela a STAFF AQUÍ, por el método que lo escribe.
   * Nunca se deriva de `author.role` al leer: el rol del autor puede cambiar
   * después y eso no puede reescribir el pasado del hilo.
   */
  async replyAsStaff(
    ticketId: string,
    actor: StaffActor,
    body: string,
    ip?: string,
    internal = false,
  ): Promise<TicketWithMessage> {
    const existing = await this.loadForStaff(ticketId, actor);
    if (!TicketsService.STAFF_REPLYABLE.includes(existing.status)) {
      throw new BadRequestException(
        'Solo se puede responder a tickets en estado OPEN, IN_PROGRESS o WAITING_USER',
      );
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const message = await this.writeMessage(
        tx,
        ticketId,
        actor.userId,
        'STAFF',
        body,
        internal,
      );

      // UNA NOTA INTERNA NO TOCA LA FILA DEL TICKET. Ni el estado, ni la
      // asignación, ni `lastMessageAt`. No es una respuesta al usuario: es
      // coordinación entre el equipo que ocurre "al lado" del hilo.
      //
      // Lo de `lastMessageAt` no es una preferencia — es la MISMA fuga de canal
      // lateral que R2 cerró en el contador de no leídos, con otro campo:
      // `lastMessageAt` SE LE SIRVE AL USUARIO (va en cada fila de GET /tickets
      // como "último movimiento" y en el payload del hilo). Si una nota interna
      // lo moviera, el usuario vería actividad fechada sin ningún mensaje nuevo
      // que la explique, y podría deducir que el equipo escribió algo que no
      // puede ver. Se descartó por eso, no por simplicidad. El coste —que la
      // bandeja de staff no reordene por notas internas— es real y asumido; si
      // algún día se quiere, pide una columna propia (`lastInternalNoteAt`), no
      // reutilizar una que el usuario lee.
      const ticket = internal
        ? existing
        : await tx.ticket.update({
            where: { id: ticketId },
            data: {
              status: 'WAITING_USER',
              // T4: responder sin haber tomado el ticket lo asigna al autor. `??` y no
              // asignación incondicional: no le robamos el ticket al agente que ya lo lleva.
              assignedToId: existing.assignedToId ?? actor.userId,
              lastMessageAt: message.createdAt,
            },
          });

      await this.auditLog.log(
        {
          // Acción distinta a propósito: una nota interna es una acción
          // administrativa con su propio significado, y mezclarla con
          // TICKET_REPLY en la auditoría haría imposible distinguir "le
          // respondimos al usuario" de "anotamos algo entre nosotros".
          action: internal ? 'TICKET_INTERNAL_NOTE' : 'TICKET_REPLY',
          actorId: actor.userId,
          resourceType: 'Ticket',
          resourceId: ticketId,
          before: { status: existing.status, assignedToId: existing.assignedToId },
          after: { status: ticket.status, assignedToId: ticket.assignedToId, messageId: message.id },
          ip,
        },
        tx,
      );

      return { ticket, message };
    });

    // R4 — T3/T4: el usuario recibe TICKET_MESSAGE + email con extracto y enlace.
    // Se llama SIEMPRE, también con una nota interna: `userStaffWrote` sale por la
    // puerta al ver `message.internal` (defensa 5). Es deliberado que el guard
    // esté en el camino vivo y no que aquí se evite la llamada — así la defensa
    // es la que decide, y el test que la muta la ve fallar de verdad.
    await this.notify.userStaffWrote(result.ticket, result.message, false);
    return result;
  }

  // ---------------------------------------------------------------------------
  // T5/T6/T8 — respuesta del usuario (incluye la reapertura)
  // ---------------------------------------------------------------------------

  /**
   * T5 (WAITING_USER → IN_PROGRESS), T6 (OPEN → OPEN, solo mueve lastMessageAt) y
   * T8 (RESOLVED → IN_PROGRESS: responder sobre un ticket resuelto ES reabrirlo).
   *
   * Sin AuditLog — acción de usuario. La reapertura tampoco lo escribe, y por eso
   * `TICKET_REOPEN` (listada en el diseño §7.3 entre las acciones de auditoría) NO
   * tiene emisor en R1: en la matriz aprobada la única reapertura es esta, la del
   * usuario. Si en R3 se añade una reapertura de staff, esa sí la escribirá.
   */
  async replyAsUser(ticketId: string, userId: string, body: string): Promise<TicketWithMessage> {
    const existing = await this.loadOwnedTicket(ticketId, userId);
    if (!TicketsService.USER_REPLYABLE.includes(existing.status)) {
      throw new BadRequestException(
        'Solo se puede responder a tickets en estado OPEN, IN_PROGRESS, WAITING_USER o RESOLVED',
      );
    }

    const reopening = existing.status === 'RESOLVED';
    if (reopening) await this.assertWithinReopenWindow(existing.resolvedAt);

    const nextStatus: TicketStatus =
      existing.status === 'WAITING_USER' || reopening ? 'IN_PROGRESS' : existing.status;

    const result = await this.prisma.$transaction(async (tx) => {
      const message = await this.writeMessage(tx, ticketId, userId, 'USER', body);

      const ticket = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: nextStatus,
          lastMessageAt: message.createdAt,
          // `resolvedAt` significa "resuelto AHORA", no "se resolvió alguna vez":
          // el cron de cierre automático (R8) consultará
          // `status = RESOLVED AND resolvedAt < now - 14d`, y dejarlo puesto tras
          // reabrir haría que la columna mintiera sobre el estado actual. El
          // historial de quién resolvió y cuándo vive en AuditLog (TICKET_RESOLVE),
          // que es el registro permanente — la fila guarda estado, no historia.
          ...(reopening && { resolvedAt: null }),
        },
      });

      return { ticket, message };
    });

    // R4 — al staff le consta que hay algo que atender. Se avisa SIEMPRE que el
    // usuario escribe (T5, T6 y la reapertura T8), no solo desde WAITING_USER:
    // un mensaje en un ticket OPEN sin tomar es exactamente la actividad que la
    // bandeja necesita ver, y en un ticket ya IN_PROGRESS el agente asignado
    // también quiere enterarse.
    await this.notify.staffNewActivity(result.ticket, result.message, 'reply');
    return result;
  }

  // ---------------------------------------------------------------------------
  // T7 — resolución
  // ---------------------------------------------------------------------------

  /** T7 — IN_PROGRESS | WAITING_USER → RESOLVED. Solo staff. */
  async resolve(ticketId: string, actor: StaffActor, ip?: string): Promise<Ticket> {
    const existing = await this.loadForStaff(ticketId, actor);
    if (!TicketsService.RESOLVABLE.includes(existing.status)) {
      throw new BadRequestException(
        'Solo se pueden resolver tickets en estado IN_PROGRESS o WAITING_USER',
      );
    }

    const updatedTicket = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.ticket.update({
        where: { id: ticketId },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      });

      await this.auditLog.log(
        {
          action: 'TICKET_RESOLVE',
          actorId: actor.userId,
          resourceType: 'Ticket',
          resourceId: ticketId,
          before: { status: existing.status },
          after: { status: updated.status },
          ip,
        },
        tx,
      );

      return updated;
    });

    // R4 — al usuario se le avisa con la ventana de reapertura, para que sepa
    // que "resuelto" no es "cerrado" y durante cuánto puede responder.
    await this.notify.userResolved(updatedTicket);
    return updatedTicket;
  }

  // ---------------------------------------------------------------------------
  // T9/T10/T11 — cierre (IRREVERSIBLE)
  // ---------------------------------------------------------------------------

  /**
   * NÚCLEO DE CIERRE — el ÚNICO sitio donde un ticket pasa a CLOSED.
   *
   * Las tres vías (T10 staff, T11 usuario, T9 cron) pasan por aquí, así que el
   * guard `CLOSABLE` y la escritura de `closedAt`/`closedById` viven en un solo
   * lugar. Molde `emitInvoiceCore`: el camino manual y el automático comparten
   * núcleo en vez de duplicar la transición.
   *
   * `closedById = null` significa "lo cerró el SISTEMA" (el cron), y por eso la
   * columna es nullable desde R1 — no es un hueco, es el discriminante.
   *
   * `requireStatus` añade un guard ATÓMICO sobre el estado en el propio UPDATE
   * (molde del débito de Wallet: `UPDATE ... WHERE balance >= N`). Lo usa el cron:
   * entre que su query selecciona los vencidos y llega el UPDATE, el usuario
   * puede haber reabierto el ticket (T8 → IN_PROGRESS). `assertClosable` NO
   * protege de eso —IN_PROGRESS también es cerrable—, así que sin esta condición
   * el cron cerraría un hilo que el usuario acaba de resucitar. Devuelve null si
   * la fila ya no cumple: el llamador decide (el cron lo cuenta como "no tocado").
   */
  private async closeCore(
    ticket: Ticket,
    opts: {
      closedById: string | null;
      now: Date;
      requireStatus?: TicketStatus;
      audit?: { actorId: string; ip?: string };
    },
  ): Promise<Ticket | null> {
    this.assertClosable(ticket.status);

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.ticket.updateMany({
        where: { id: ticket.id, ...(opts.requireStatus && { status: opts.requireStatus }) },
        data: { status: 'CLOSED', closedAt: opts.now, closedById: opts.closedById },
      });
      if (count === 0) return null;

      const updated = await tx.ticket.findUniqueOrThrow({ where: { id: ticket.id } });

      if (opts.audit) {
        await this.auditLog.log(
          {
            action: 'TICKET_CLOSE',
            actorId: opts.audit.actorId,
            resourceType: 'Ticket',
            resourceId: ticket.id,
            before: { status: ticket.status },
            after: { status: updated.status },
            ip: opts.audit.ip,
          },
          tx,
        );
      }

      return updated;
    });
  }

  /** T9/T10 — cierre por el staff desde cualquier estado vivo. IRREVERSIBLE. */
  async closeAsStaff(ticketId: string, actor: StaffActor, ip?: string): Promise<Ticket> {
    const existing = await this.loadForStaff(ticketId, actor);

    const updated = await this.closeCore(existing, {
      closedById: actor.userId,
      now: new Date(),
      audit: { actorId: actor.userId, ip },
    });
    // Sin `requireStatus` el UPDATE casa siempre por id; null aquí sería un
    // borrado concurrente de la fila, no un cambio de estado.
    if (!updated) throw new NotFoundException('Ticket no encontrado');
    return updated;
  }

  /**
   * T9 — CIERRE AUTOMÁTICO por vencimiento de la ventana de reapertura. Lo llama
   * el cron (`TicketsScheduleService`), nunca una request.
   *
   * `closedById = null`: lo cerró el sistema, no una persona. NO escribe AuditLog
   * — ver la justificación en `TicketsScheduleService`.
   *
   * Devuelve null si el ticket ya no está RESOLVED (lo cerró un agente, o el
   * usuario lo reabrió) entre la query del cron y este UPDATE. Eso, junto con el
   * `requireStatus`, es lo que hace el cron seguro de repetir.
   */
  async closeExpired(ticketId: string, now: Date): Promise<Ticket | null> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket || ticket.status !== 'RESOLVED') return null;

    return this.closeCore(ticket, {
      closedById: null,
      now,
      requireStatus: 'RESOLVED',
    });
  }

  /**
   * T11 — "ya no lo necesito": el usuario cierra SU ticket. IRREVERSIBLE.
   *
   * Solo si `origin = USER`. Si el hilo lo abrió la administración (flujo b) o
   * nació de una denuncia (flujo c), no es suyo para cerrarlo unilateralmente:
   * cerrarlo sería la vía para esquivar una comunicación de moderación.
   *
   * Sin AuditLog (acción de usuario), pero el cierre queda igualmente trazado en
   * la propia fila: `closedById` apunta al usuario, no a un agente.
   */
  async closeAsUser(ticketId: string, userId: string): Promise<Ticket> {
    const existing = await this.loadOwnedTicket(ticketId, userId);
    this.assertClosable(existing.status);
    if (existing.origin !== 'USER') {
      throw new ForbiddenException(
        'Solo puedes cerrar los tickets que has abierto tú; este lo inició la administración',
      );
    }

    const updated = await this.closeCore(existing, { closedById: userId, now: new Date() });
    if (!updated) throw new NotFoundException('Ticket no encontrado');
    return updated;
  }

  // ---------------------------------------------------------------------------
  // Lectura — DOS métodos separados, nunca uno con flag (§10.3.2)
  // ---------------------------------------------------------------------------

  /**
   * Vista del USUARIO. Owner-scope: 403 si el hilo no es suyo (molde
   * `InvoicingService.getInvoicePdf`).
   *
   * PRIMERA CAPA DE LA INVARIANTE DE PRIVACIDAD (§10.3): el filtro
   * `internal: false` va EN LA QUERY, no en un map posterior — las notas internas
   * no llegan siquiera a memoria por esta vía. Está puesto desde R1 aunque las
   * notas internas estén aplazadas (§14.3) y hoy nada pueda ponerlas a `true`:
   * el precedente de `Listing.phone` (un `findUnique({include})` sin `select` que
   * habría publicado un campo privado) dice que la defensa se pone ANTES de que
   * exista el dato, no después.
   *
   * Este método y `getForStaff` son deliberadamente DOS métodos y no uno con un
   * booleano `includeInternal`: un flag se pasa mal una sola vez y el fallo es
   * silencioso.
   */
  async getForUser(ticketId: string, userId: string, query: TicketThreadQuery = {}) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: TICKET_CONTEXT_INCLUDE,
    });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    if (ticket.userId !== userId) throw new ForbiddenException('Este ticket no es tuyo');

    // Acuse de lectura ANTES de leer el hilo, igual que
    // MessagingService.getConversation. El orden importa: si se marcara después,
    // el payload devolvería `readByUserAt: null` en mensajes que en BD ya están
    // leídos — un cliente que cachee esa respuesta arranca con datos falsos.
    // `internal: false` en el where: una nota interna no la "lee" el usuario,
    // porque ni siquiera la ve. Idempotente por el `readByUserAt: null` (molde
    // NotificationsService.markRead): reabrir no re-sella la fecha.
    await this.prisma.ticketMessage.updateMany({
      where: { ticketId, side: 'STAFF', internal: false, readByUserAt: null },
      data: { readByUserAt: new Date() },
    });

    const { messages, nextCursor } = await this.pageMessages(ticketId, query, {
      internal: false,
    });

    // R8 — la ventana viaja en el payload porque ya NO es una constante: el admin
    // puede cambiarla en caliente. Si el frontend la llevara cableada, ofrecería
    // "reabrir" fuera de plazo (o lo negaría dentro) en cuanto alguien tocara el
    // Setting. La UI restringe con el número real que manda el servidor.
    const reopenWindowDays = await this.getReopenWindowDays();

    return { ...ticket, messages, nextCursor, reopenWindowDays };
  }

  /**
   * "Mis tickets" — el `where` lleva SIEMPRE `userId`, que viene del JWT. Nunca
   * se acepta un userId del cliente: no hay parámetro donde colarlo.
   */
  async listForUser(userId: string, page = 1, perPage = 20) {
    const where: Prisma.TicketWhereInput = { userId };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          topic: { select: { id: true, nombre: true } },
          // Badge de no leídos: mensajes del STAFF que el usuario no ha abierto.
          // `internal: false` es imprescindible — una nota interna no puede ni
          // siquiera INCREMENTAR un contador visible para el usuario; sería una
          // fuga por canal lateral (sabría que el staff escribió algo oculto).
          _count: {
            select: {
              messages: { where: { side: 'STAFF', internal: false, readByUserAt: null } },
            },
          },
        },
      }),
      this.prisma.ticket.count({ where }),
    ]);

    return {
      items: items.map((t) => ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        origin: t.origin,
        topic: t.topic,
        linkedLabel: t.linkedLabel,
        lastMessageAt: t.lastMessageAt,
        createdAt: t.createdAt,
        unreadCount: t._count.messages,
      })),
      total,
      page,
      perPage,
      pages: Math.ceil(total / perPage),
    };
  }

  /**
   * Vista del STAFF: el hilo completo, incluidas las notas internas cuando
   * existan (contraste exacto con `getForUser`, que las filtra).
   *
   * `actor` es OBLIGATORIO — es lo que permite aplicar la puerta ADMIN-only de
   * los tickets con factura enlazada, que el `RolesGuard` no puede decidir
   * porque depende de la fila, no de la ruta. Hacerlo opcional habría dejado el
   * guard desactivado con solo olvidar un argumento.
   */
  async getForStaff(ticketId: string, actor: StaffActor) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        ...TICKET_CONTEXT_INCLUDE,
        report: { select: { id: true, reason: true, status: true } },
        messages: { orderBy: MESSAGE_ORDER },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    this.assertCanHandle(ticket, actor);

    // Acuse de lectura del lado del staff: lo que escribió el usuario queda
    // marcado al abrir. Espejo del de getForUser, con la columna del otro lado.
    await this.prisma.ticketMessage.updateMany({
      where: { ticketId, side: 'USER', readByStaffAt: null },
      data: { readByStaffAt: new Date() },
    });

    return ticket;
  }

  // ---------------------------------------------------------------------------
  // Helpers internos
  // ---------------------------------------------------------------------------

  /**
   * Paginación por cursor del hilo — molde exacto de
   * `MessagingService.getConversation`: se piden `limit + 1` para saber si hay
   * más, y el cursor es el mensaje MÁS ANTIGUO del lote (se pasa como `before`
   * para seguir subiendo). No `skip/take`: con hilos largos degrada y además se
   * descuadra si llegan mensajes nuevos entre páginas.
   *
   * `extraWhere` lo aporta el llamador: la vista de usuario pasa
   * `{ internal: false }`. Es el filtro que NUNCA debe olvidarse, por eso es un
   * parámetro obligatorio y no un opcional con default permisivo.
   */
  private async pageMessages(
    ticketId: string,
    query: TicketThreadQuery,
    extraWhere: Prisma.TicketMessageWhereInput,
  ) {
    const limit = query.limit ?? TICKET_MESSAGES_DEFAULT_LIMIT;
    let where: Prisma.TicketMessageWhereInput = { ticketId, ...extraWhere };

    if (query.before) {
      const pivot = await this.prisma.ticketMessage.findUnique({
        where: { id: query.before },
        select: { createdAt: true, ticketId: true },
      });
      // El pivote tiene que ser de ESTE hilo: si no, un id de otro ticket serviría
      // para desplazar la ventana (y, con ella, para inferir su cronología).
      if (pivot && pivot.ticketId === ticketId) {
        where = { ...where, createdAt: { lt: pivot.createdAt } };
      }
    }

    const raw = await this.prisma.ticketMessage.findMany({
      where,
      orderBy: MESSAGE_ORDER,
      take: limit + 1,
    });

    const hasMore = raw.length > limit;
    const messages = raw.slice(0, limit);
    const nextCursor = hasMore ? messages[messages.length - 1].id : null;
    return { messages, nextCursor };
  }

  /**
   * Ventana de reapertura/auto-cierre vigente, en días. ÚNICO punto de lectura:
   * lo usan el guard de T8 (aquí) y el cron de T9 (`TicketsScheduleService`), y
   * que ambos pasen por el mismo sitio es lo que impide que diverjan.
   *
   * Un valor no numérico o <= 0 en el Setting cae al default en vez de romper —
   * mismo criterio defensivo que `InvoicingService.getWindowStart`.
   */
  async getReopenWindowDays(): Promise<number> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: TICKET_WINDOW_SETTING_KEY },
    });
    const value = Number(setting?.value);
    return Number.isFinite(value) && value > 0 ? value : TICKET_REOPEN_WINDOW_DAYS;
  }

  /**
   * Ventana de reapertura (T8). Fuera de plazo, responder deja de reabrir y se
   * rechaza con el mensaje que indica la salida: abrir un ticket nuevo.
   *
   * `resolvedAt` nulo en un RESOLVED no debería pasar (`resolve()` siempre lo
   * escribe), pero si pasara se trata como fuera de ventana: ante un dato
   * incoherente, la opción segura es no reabrir. El cron de T9 hace lo simétrico
   * — tampoco lo cierra — y además deja un warning para que la anomalía salga a
   * la luz en vez de barrerse.
   */
  private async assertWithinReopenWindow(resolvedAt: Date | null): Promise<void> {
    const windowDays = await this.getReopenWindowDays();
    const deadline = resolvedAt
      ? resolvedAt.getTime() + windowDays * 24 * 60 * 60 * 1000
      : 0;
    if (Date.now() > deadline) {
      throw new BadRequestException({
        code: 'REOPEN_WINDOW_EXPIRED',
        message: `El ticket está cerrado (la ventana de reapertura de ${windowDays} días ha expirado). Abre uno nuevo.`,
      });
    }
  }

  private async loadTicket(ticketId: string): Promise<Ticket> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('Ticket no encontrado');
    return ticket;
  }

  private async loadOwnedTicket(ticketId: string, userId: string): Promise<Ticket> {
    const ticket = await this.loadTicket(ticketId);
    if (ticket.userId !== userId) throw new ForbiddenException('Este ticket no es tuyo');
    return ticket;
  }

  /**
   * Guard compartido por T9/T10/T11. Aislado en un método porque es el que hace
   * cumplir la irreversibilidad de CLOSED por las DOS vías de cierre: un CLOSED
   * no está en CLOSABLE, así que cerrar dos veces se rechaza.
   */
  private assertClosable(status: TicketStatus): void {
    if (!TicketsService.CLOSABLE.includes(status)) {
      throw new BadRequestException('Este ticket ya está cerrado');
    }
  }

  /**
   * Escritura del mensaje. `side` es un PARÁMETRO EXPLÍCITO del método que llama
   * (USER o STAFF), nunca se deduce del rol del autor — esa es la congelación.
   *
   * `internal` no se pasa: se queda en el `@default(false)` del schema. En R1 no
   * existe ninguna vía de escritura para las notas internas (decisión §14.3), y
   * esta firma es la que lo garantiza — no hay parámetro que pasar.
   */
  private writeMessage(
    tx: Prisma.TransactionClient,
    ticketId: string,
    authorId: string,
    side: 'USER' | 'STAFF',
    body: string,
    internal = false,
  ): Promise<TicketMessage> {
    // Guard estructural: una nota interna es, por definición, del equipo. Un
    // `internal: true` con `side: 'USER'` sería un mensaje del usuario que el
    // propio usuario no puede ver — un estado sin sentido que además rompería
    // los filtros (que combinan `side` e `internal`). Ninguna vía actual puede
    // producirlo; esto lo hace imposible también para las futuras.
    if (internal && side !== 'STAFF') {
      throw new BadRequestException('Una nota interna solo puede escribirla el equipo');
    }
    return tx.ticketMessage.create({ data: { ticketId, authorId, side, body, internal } });
  }

  /** Normaliza los enlaces opcionales a `null` (Prisma distingue undefined de null). */
  private linkData(input: TicketLinkInput) {
    return {
      listingId: input.listingId ?? null,
      reviewId: input.reviewId ?? null,
      invoiceId: input.invoiceId ?? null,
      linkedLabel: input.linkedLabel ?? null,
    };
  }
}
