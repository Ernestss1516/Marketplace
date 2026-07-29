import { randomUUID } from 'crypto';
import { INestApplication, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaClient, Role, Ticket, TicketStatus } from '@prisma/client';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { TicketsService } from 'src/modules/tickets/tickets.service';
import { StaffActor } from 'src/modules/tickets/tickets.types';

/**
 * Atención al usuario R1 — la MÁQUINA DE ESTADOS ejercida contra la BD real.
 *
 * Corre por la capa de SERVICIO, no por HTTP, porque R1 no tiene controladores
 * todavía (llegan en R2/R3). Aun así vive en `test/` y no como `.spec.ts` unitario
 * junto al servicio: la máquina de estados es una transición de FILA (guard →
 * UPDATE → AuditLog dentro de una $transaction), y con un Prisma mockeado se
 * estaría probando el `if`, no la transición. Aquí cada aserción lee de Postgres
 * lo que realmente quedó escrito.
 *
 * Se ejerce el camino MALO tanto como el bueno: cada guard tiene su test de
 * rechazo, y `CLOSED` tiene el suyo propio por las SEIS vías de salida posibles.
 *
 * Ver docs/diseno-atencion-usuario.md §7 (matriz T1-T11).
 */
describe('Tickets — máquina de estados (R1) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tickets: TicketsService;

  let userId: string;
  let otherUserId: string;
  let staffId: string;
  /**
   * Actor de staff. R3 pasó los métodos de staff de `actorId: string` a un
   * `StaffActor { userId, role }`: el rol hace falta para las dos puertas que el
   * RolesGuard no puede vigilar (ticket con factura, reasignar el de otro). Es
   * mantenimiento de fixture por cambio de FIRMA — ninguna aserción cambia.
   */
  let staff: StaffActor;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    tickets = app.get(TicketsService);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb(prisma);
    userId = (await createUser('USER')).id;
    otherUserId = (await createUser('USER')).id;
    staffId = (await createUser('ADMIN')).id;
    staff = { userId: staffId, role: 'ADMIN' };
  });

  async function createUser(role: Role) {
    const id = randomUUID().slice(0, 8);
    return prisma.user.create({
      data: { email: `tk-${id}@test.local`, name: `Tk ${id}`, slug: `tk-${id}`, role },
    });
  }

  /** Abre un ticket de usuario (T1) y lo lleva al estado pedido por transiciones REALES. */
  async function ticketInState(status: TicketStatus): Promise<Ticket> {
    let ticket = await tickets.createByUser(userId, { subject: 'Asunto', body: 'Hola' });
    if (status === 'OPEN') return ticket;

    ticket = await tickets.take(ticket.id, staff); // OPEN → IN_PROGRESS
    if (status === 'IN_PROGRESS') return ticket;

    ({ ticket } = await tickets.replyAsStaff(ticket.id, staff, 'Te leo')); // → WAITING_USER
    if (status === 'WAITING_USER') return ticket;

    ticket = await tickets.resolve(ticket.id, staff); // → RESOLVED
    if (status === 'RESOLVED') return ticket;

    return tickets.closeAsStaff(ticket.id, staff); // → CLOSED
  }

  const auditFor = (ticketId: string) =>
    prisma.auditLog.findMany({ where: { resourceType: 'Ticket', resourceId: ticketId } });

  const messagesOf = (ticketId: string) =>
    prisma.ticketMessage.findMany({ where: { ticketId }, orderBy: { createdAt: 'asc' } });

  // ===========================================================================
  // T1 — apertura
  // ===========================================================================

  describe('T1 — apertura', () => {
    it('(a) el usuario abre su ticket: OPEN, origin USER, primer mensaje side USER', async () => {
      const ticket = await tickets.createByUser(userId, {
        subject: 'No puedo editar mi anuncio',
        body: 'Me da error al guardar',
      });

      expect(ticket.status).toBe('OPEN');
      expect(ticket.origin).toBe('USER');
      expect(ticket.userId).toBe(userId);
      expect(ticket.openedById).toBe(userId);
      expect(ticket.assignedToId).toBeNull();
      expect(ticket.resolvedAt).toBeNull();
      expect(ticket.closedAt).toBeNull();

      const msgs = await messagesOf(ticket.id);
      expect(msgs).toHaveLength(1);
      expect(msgs[0].side).toBe('USER');
      expect(msgs[0].authorId).toBe(userId);
      expect(msgs[0].internal).toBe(false);
    });

    it('(a) NO escribe AuditLog — es una acción de usuario, no administrativa', async () => {
      const ticket = await tickets.createByUser(userId, { subject: 'S', body: 'B' });
      expect(await auditFor(ticket.id)).toHaveLength(0);
    });

    /**
     * CAMBIO DE PRODUCTO DELIBERADO (decidido tras entregar R1, ver R2): un hilo
     * abierto por el staff nace en WAITING_USER y ASIGNADO al agente que lo abre,
     * no en OPEN sin asignar. Su primer mensaje ya es del staff, así que la
     * pelota está en el usuario desde el minuto uno.
     *
     * Lo de "asignado" no es cosmético: `take()` solo acepta OPEN (T2), así que
     * un ticket nacido en WAITING_USER sin asignar sería inasignable para
     * siempre. La aserción de abajo es la que vigila ese corolario.
     */
    it('(b) el staff abre un hilo: WAITING_USER, asignado al agente, primer mensaje side STAFF', async () => {
      const ticket = await tickets.createByStaff(staff, {
        userId,
        subject: 'Revisión de tu cuenta',
        body: 'Necesitamos que confirmes un dato',
        origin: 'ADMIN',
      });

      expect(ticket.status).toBe('WAITING_USER');
      expect(ticket.assignedToId).toBe(staffId); // corolario: si no, quedaría inasignable
      expect(ticket.origin).toBe('ADMIN');
      expect(ticket.userId).toBe(userId); // el DUEÑO es el destinatario…
      expect(ticket.openedById).toBe(staffId); // …no quien lo abrió

      const msgs = await messagesOf(ticket.id);
      expect(msgs[0].side).toBe('STAFF');
      expect(msgs[0].authorId).toBe(staffId);
    });

    it('(c) desde un Report: origin REPORT y reportId enlazado, sin tocar el Report', async () => {
      const report = await prisma.report.create({
        data: { reason: 'SPAM', reporterId: otherUserId, reportedUserId: userId },
      });

      const ticket = await tickets.createByStaff(staff, {
        userId,
        subject: 'Sobre una denuncia recibida',
        body: 'Nos han reportado tu anuncio',
        origin: 'REPORT',
        reportId: report.id,
      });

      expect(ticket.origin).toBe('REPORT');
      expect(ticket.reportId).toBe(report.id);

      // El Report queda EXACTAMENTE como estaba: el ticket lo referencia, no lo gestiona.
      const after = await prisma.report.findUniqueOrThrow({ where: { id: report.id } });
      expect(after).toEqual(report);
    });

    it('(b/c) escribe AuditLog TICKET_OPEN_BY_ADMIN', async () => {
      const ticket = await tickets.createByStaff(staff, {
        userId,
        subject: 'S',
        body: 'B',
        origin: 'ADMIN',
      });

      const logs = await auditFor(ticket.id);
      expect(logs).toHaveLength(1);
      expect(logs[0].action).toBe('TICKET_OPEN_BY_ADMIN');
      expect(logs[0].actorId).toBe(staffId);
    });

    it('rechaza origin USER en la vía de staff (sería mentir sobre quién abrió el hilo)', async () => {
      await expect(
        tickets.createByStaff(staff, {
          userId,
          subject: 'S',
          body: 'B',
          origin: 'USER' as never,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ===========================================================================
  // T2 — take
  // ===========================================================================

  describe('T2 — el staff toma el ticket', () => {
    it('OPEN → IN_PROGRESS, asignándose el agente, con AuditLog TICKET_ASSIGN', async () => {
      const ticket = await ticketInState('OPEN');

      const taken = await tickets.take(ticket.id, staff);

      expect(taken.status).toBe('IN_PROGRESS');
      expect(taken.assignedToId).toBe(staffId);

      const logs = await auditFor(ticket.id);
      expect(logs.map((l) => l.action)).toEqual(['TICKET_ASSIGN']);
      expect(logs[0].before).toEqual({ status: 'OPEN', assignedToId: null });
      expect(logs[0].after).toEqual({ status: 'IN_PROGRESS', assignedToId: staffId });
    });

    it('RECHAZA tomar un ticket que no está OPEN', async () => {
      const ticket = await ticketInState('IN_PROGRESS');
      await expect(tickets.take(ticket.id, staff)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // ===========================================================================
  // T3 / T4 — respuesta del staff
  // ===========================================================================

  describe('T3/T4 — respuesta del staff', () => {
    it('T3: IN_PROGRESS → WAITING_USER, con AuditLog TICKET_REPLY', async () => {
      const ticket = await ticketInState('IN_PROGRESS');

      const { ticket: updated, message } = await tickets.replyAsStaff(ticket.id, staff, 'Ya lo miramos');

      expect(updated.status).toBe('WAITING_USER');
      expect(message.side).toBe('STAFF');

      const logs = await auditFor(ticket.id);
      expect(logs.map((l) => l.action)).toEqual(['TICKET_ASSIGN', 'TICKET_REPLY']);
    });

    it('T4: OPEN → WAITING_USER y ASIGNA al autor de paso (responder implica tomarlo)', async () => {
      const ticket = await ticketInState('OPEN');
      expect(ticket.assignedToId).toBeNull();

      const { ticket: updated } = await tickets.replyAsStaff(ticket.id, staff, 'Respondemos ya');

      expect(updated.status).toBe('WAITING_USER');
      expect(updated.assignedToId).toBe(staffId);
    });

    it('no le roba el ticket al agente que ya lo lleva', async () => {
      const otherAgent = await createUser('MODERATOR');
      const ticket = await ticketInState('OPEN');
      await tickets.take(ticket.id, staff);

      const { ticket: updated } = await tickets.replyAsStaff(ticket.id, { userId: otherAgent.id, role: 'MODERATOR' as const }, 'Aporto yo');

      expect(updated.assignedToId).toBe(staffId); // sigue siendo el primero
    });

    it('responder desde WAITING_USER es válido y deja el estado igual', async () => {
      const ticket = await ticketInState('WAITING_USER');
      const { ticket: updated } = await tickets.replyAsStaff(ticket.id, staff, 'Añado un dato');
      expect(updated.status).toBe('WAITING_USER');
    });

    it('RECHAZA responder sobre un ticket RESOLVED (hay que reabrirlo primero)', async () => {
      const ticket = await ticketInState('RESOLVED');
      await expect(tickets.replyAsStaff(ticket.id, staff, 'x')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  // ===========================================================================
  // T5 / T6 / T8 — respuesta del usuario
  // ===========================================================================

  describe('T5/T6/T8 — respuesta del usuario', () => {
    it('T5: WAITING_USER → IN_PROGRESS', async () => {
      const ticket = await ticketInState('WAITING_USER');
      const { ticket: updated, message } = await tickets.replyAsUser(ticket.id, userId, 'Ahí va');
      expect(updated.status).toBe('IN_PROGRESS');
      expect(message.side).toBe('USER');
    });

    it('T6: OPEN → OPEN (solo mueve el hilo, no el estado)', async () => {
      const ticket = await ticketInState('OPEN');
      const { ticket: updated } = await tickets.replyAsUser(ticket.id, userId, 'Se me olvidaba…');
      expect(updated.status).toBe('OPEN');
    });

    it('T8: RESOLVED → IN_PROGRESS (responder ES reabrir) y limpia resolvedAt', async () => {
      const ticket = await ticketInState('RESOLVED');
      expect(ticket.resolvedAt).not.toBeNull();

      const { ticket: updated } = await tickets.replyAsUser(ticket.id, userId, 'Sigue sin ir');

      expect(updated.status).toBe('IN_PROGRESS');
      expect(updated.resolvedAt).toBeNull();
    });

    it('NINGUNA respuesta de usuario escribe AuditLog (su rastro es el hilo)', async () => {
      const ticket = await ticketInState('WAITING_USER');
      const before = (await auditFor(ticket.id)).length;

      await tickets.replyAsUser(ticket.id, userId, 'Respondo');

      expect(await auditFor(ticket.id)).toHaveLength(before);
    });

    it('RECHAZA con 403 responder en un ticket ajeno (owner-scope)', async () => {
      const ticket = await ticketInState('OPEN');
      await expect(tickets.replyAsUser(ticket.id, otherUserId, 'no es mío')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // ===========================================================================
  // T7 — resolución
  // ===========================================================================

  describe('T7 — resolución', () => {
    it.each<TicketStatus>(['IN_PROGRESS', 'WAITING_USER'])(
      'desde %s → RESOLVED, con resolvedAt y AuditLog TICKET_RESOLVE',
      async (from) => {
        const ticket = await ticketInState(from);

        const resolved = await tickets.resolve(ticket.id, staff);

        expect(resolved.status).toBe('RESOLVED');
        expect(resolved.resolvedAt).toBeInstanceOf(Date);
        expect((await auditFor(ticket.id)).map((l) => l.action)).toContain('TICKET_RESOLVE');
      },
    );

    it('RECHAZA resolver un ticket OPEN — nadie lo ha atendido todavía', async () => {
      const ticket = await ticketInState('OPEN');
      await expect(tickets.resolve(ticket.id, staff)).rejects.toBeInstanceOf(BadRequestException);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe('OPEN');
    });
  });

  // ===========================================================================
  // T9 / T10 / T11 — cierre
  // ===========================================================================

  describe('T9/T10 — cierre por el staff', () => {
    it.each<TicketStatus>(['OPEN', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED'])(
      'cierra desde %s, con closedAt/closedById y AuditLog TICKET_CLOSE',
      async (from) => {
        const ticket = await ticketInState(from);

        const closed = await tickets.closeAsStaff(ticket.id, staff);

        expect(closed.status).toBe('CLOSED');
        expect(closed.closedAt).toBeInstanceOf(Date);
        expect(closed.closedById).toBe(staffId);
        expect((await auditFor(ticket.id)).map((l) => l.action)).toContain('TICKET_CLOSE');
      },
    );
  });

  describe('T11 — el usuario cierra su propio ticket', () => {
    it('cierra un ticket origin=USER, con closedById apuntando al usuario y SIN AuditLog', async () => {
      const ticket = await ticketInState('OPEN');

      const closed = await tickets.closeAsUser(ticket.id, userId);

      expect(closed.status).toBe('CLOSED');
      expect(closed.closedById).toBe(userId);
      expect(await auditFor(ticket.id)).toHaveLength(0);
    });

    it.each<'ADMIN' | 'REPORT'>(['ADMIN', 'REPORT'])(
      'RECHAZA cerrar un ticket origin=%s — no es suyo para cerrarlo unilateralmente',
      async (origin) => {
        const ticket = await tickets.createByStaff(staff, {
          userId,
          subject: 'S',
          body: 'B',
          origin,
        });

        await expect(tickets.closeAsUser(ticket.id, userId)).rejects.toBeInstanceOf(ForbiddenException);
        // WAITING_USER, no OPEN: los hilos abiertos por el staff nacen ahí (ver T1 (b)).
        expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).status).toBe(
          'WAITING_USER',
        );
      },
    );

    it('RECHAZA con 403 cerrar el ticket de otro', async () => {
      const ticket = await ticketInState('OPEN');
      await expect(tickets.closeAsUser(ticket.id, otherUserId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  // ===========================================================================
  // CLOSED es un pozo sin salida — el test clave de R1
  // ===========================================================================

  describe('CLOSED es IRREVERSIBLE (molde ARCHIVED)', () => {
    it('NINGUNA de las seis vías de salida tiene efecto; el ticket sigue CLOSED e intacto', async () => {
      const closed = await ticketInState('CLOSED');
      const messagesBefore = (await messagesOf(closed.id)).length;
      const auditBefore = (await auditFor(closed.id)).length;

      // Las seis únicas puertas que existen para salir de un estado.
      await expect(tickets.take(closed.id, staff)).rejects.toBeInstanceOf(BadRequestException);
      await expect(tickets.replyAsStaff(closed.id, staff, 'x')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(tickets.replyAsUser(closed.id, userId, 'x')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(tickets.resolve(closed.id, staff)).rejects.toBeInstanceOf(BadRequestException);
      await expect(tickets.closeAsStaff(closed.id, staff)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      await expect(tickets.closeAsUser(closed.id, userId)).rejects.toBeInstanceOf(
        BadRequestException,
      );

      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: closed.id } });
      expect(after.status).toBe('CLOSED');
      expect(after.closedAt).toEqual(closed.closedAt);
      expect(after.closedById).toBe(closed.closedById);
      // Ni un mensaje colado ni una entrada de auditoría de más por los intentos.
      expect(await messagesOf(closed.id)).toHaveLength(messagesBefore);
      expect(await auditFor(closed.id)).toHaveLength(auditBefore);
    });

    it('CLOSED no figura como estado ORIGEN en ninguno de los cuatro arrays de transición', () => {
      // La irreversibilidad NO es un `if (status === 'CLOSED')` suelto: es la
      // AUSENCIA de CLOSED en las listas. Este test la vigila directamente, para
      // que añadirlo a una de ellas rompa la suite y no solo el comportamiento.
      const arrays = ['STAFF_REPLYABLE', 'USER_REPLYABLE', 'RESOLVABLE', 'CLOSABLE'] as const;
      const statics = TicketsService as unknown as Record<string, TicketStatus[]>;
      for (const name of arrays) {
        expect(statics[name]).toBeDefined();
        expect(statics[name]).not.toContain('CLOSED');
      }
    });
  });

  // ===========================================================================
  // side congelado
  // ===========================================================================

  describe('side congelado al escribir', () => {
    it('un mensaje de STAFF sigue siendo STAFF aunque su autor deje de ser staff', async () => {
      const ticket = await ticketInState('IN_PROGRESS');
      const { message } = await tickets.replyAsStaff(ticket.id, staff, 'Respuesta oficial');
      expect(message.side).toBe('STAFF');

      // El agente es degradado a USER después de escribir.
      await prisma.user.update({ where: { id: staffId }, data: { role: 'USER' } });

      const reread = await prisma.ticketMessage.findUniqueOrThrow({ where: { id: message.id } });
      expect(reread.side).toBe('STAFF'); // el pasado del hilo no se reescribe
      expect((await prisma.user.findUniqueOrThrow({ where: { id: staffId } })).role).toBe('USER');
    });

    it('un mensaje de USER escrito por alguien que LUEGO es ADMIN sigue siendo USER', async () => {
      const ticket = await ticketInState('WAITING_USER');
      const { message } = await tickets.replyAsUser(ticket.id, userId, 'Soy el usuario');

      await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });

      const reread = await prisma.ticketMessage.findUniqueOrThrow({ where: { id: message.id } });
      expect(reread.side).toBe('USER');
    });
  });

  // ===========================================================================
  // lastMessageAt
  // ===========================================================================

  describe('lastMessageAt (denormalizado)', () => {
    it('avanza con CADA mensaje, lo escriba el usuario o el staff', async () => {
      const ticket = await ticketInState('OPEN');
      const t0 = ticket.lastMessageAt;

      const { ticket: afterStaff } = await tickets.replyAsStaff(ticket.id, staff, 'staff');
      expect(afterStaff.lastMessageAt.getTime()).toBeGreaterThan(t0.getTime());

      const { ticket: afterUser } = await tickets.replyAsUser(ticket.id, userId, 'user');
      expect(afterUser.lastMessageAt.getTime()).toBeGreaterThanOrEqual(
        afterStaff.lastMessageAt.getTime(),
      );

      // Coincide con el createdAt del último mensaje, no con un `new Date()` aparte.
      const msgs = await messagesOf(ticket.id);
      expect(afterUser.lastMessageAt).toEqual(msgs[msgs.length - 1].createdAt);
    });
  });

  // ===========================================================================
  // Invariante de privacidad — primera capa (§10.3)
  // ===========================================================================

  describe('getForUser / getForStaff — notas internas', () => {
    /**
     * Las notas internas están APLAZADAS (§14.3): no hay ninguna vía de escritura
     * en el servicio. Se siembra la fila DIRECTAMENTE en BD, saltándose el
     * servicio a propósito, para poder ejercer el filtro hoy — la defensa se pone
     * ANTES de que el dato exista (lección de Listing.phone).
     */
    async function seedInternalNote(ticketId: string, body: string) {
      return prisma.ticketMessage.create({
        data: { ticketId, authorId: staffId, side: 'STAFF', body, internal: true },
      });
    }

    it('getForUser NUNCA devuelve un mensaje internal=true', async () => {
      const ticket = await ticketInState('IN_PROGRESS');
      const SECRETO = 'NOTA-INTERNA-NO-DEBE-SALIR-9f3a';
      await seedInternalNote(ticket.id, SECRETO);
      await tickets.replyAsStaff(ticket.id, staff, 'Respuesta pública');

      const view = await tickets.getForUser(ticket.id, userId);

      expect(view.messages.every((m) => m.internal === false)).toBe(true);
      expect(view.messages.map((m) => m.body)).not.toContain(SECRETO);
      // Búsqueda de la cadena EN CRUDO sobre el payload serializado — molde
      // listing-phone.e2e-spec.ts: no basta con que no esté en el campo esperado.
      expect(JSON.stringify(view)).not.toContain(SECRETO);
    });

    it('getForStaff SÍ las devuelve (es la vista del otro lado)', async () => {
      const ticket = await ticketInState('IN_PROGRESS');
      const SECRETO = 'NOTA-INTERNA-VISIBLE-PARA-STAFF';
      await seedInternalNote(ticket.id, SECRETO);

      const view = await tickets.getForStaff(ticket.id, staff);

      expect(view.messages.map((m) => m.body)).toContain(SECRETO);
    });

    it('ningún método del servicio crea mensajes internos (R1 no tiene vía de escritura)', async () => {
      const ticket = await ticketInState('IN_PROGRESS');
      await tickets.replyAsStaff(ticket.id, staff, 'a');
      await tickets.replyAsUser(ticket.id, userId, 'b');

      const internos = await prisma.ticketMessage.count({ where: { ticketId: ticket.id, internal: true } });
      expect(internos).toBe(0);
    });

    it('getForUser rechaza con 403 el hilo ajeno y con 404 el inexistente', async () => {
      const ticket = await ticketInState('OPEN');
      await expect(tickets.getForUser(ticket.id, otherUserId)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(tickets.getForUser('no-existe', userId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // ===========================================================================
  // ContactReason.scope — el default preserva /contacto sin backfill
  // ===========================================================================

  describe('ContactReason.scope', () => {
    it('un motivo creado SIN indicar scope queda PUBLIC — exactamente como los 6 existentes', async () => {
      // Esta es la forma EXACTA en que ContactReasonsService crea motivos hoy
      // (nombre + orden, nada de scope). Que salga PUBLIC es la prueba de que la
      // columna nueva no cambia el comportamiento de /contacto ni exige backfill.
      const reason = await prisma.contactReason.create({ data: { nombre: 'Consulta general' } });
      expect(reason.scope).toBe('PUBLIC');
    });

    it('admite TICKET y BOTH, y un ticket puede enlazar un motivo de ámbito TICKET', async () => {
      const soloTickets = await prisma.contactReason.create({
        data: { nombre: 'Problema con mi factura', scope: 'TICKET' },
      });
      const ambos = await prisma.contactReason.create({
        data: { nombre: 'Otro asunto', scope: 'BOTH' },
      });
      expect([soloTickets.scope, ambos.scope]).toEqual(['TICKET', 'BOTH']);

      const ticket = await tickets.createByUser(userId, {
        subject: 'Duda de facturación',
        body: 'No me cuadra el IVA',
        topicId: soloTickets.id,
      });

      const view = await tickets.getForUser(ticket.id, userId);
      expect(view.topic?.id).toBe(soloTickets.id);
    });
  });

  // ===========================================================================
  // Enlaces polimórficos — el hilo sobrevive al borrado de la entidad
  // ===========================================================================

  describe('enlaces polimórficos', () => {
    it('borrar el anuncio enlazado deja el ticket vivo (SetNull) y el contexto legible', async () => {
      const category = await prisma.category.findFirstOrThrow();
      const listing = await prisma.listing.create({
        data: {
          title: 'Bici de montaña',
          slug: `bici-${randomUUID().slice(0, 8)}`,
          description: 'd',
          price: 100,
          type: 'PRODUCT',
          sellerId: userId,
          categoryId: category.id,
        },
      });

      const ticket = await tickets.createByUser(userId, {
        subject: 'Problema con mi anuncio',
        body: 'No se publica',
        listingId: listing.id,
        linkedLabel: listing.title,
      });

      await prisma.listing.delete({ where: { id: listing.id } });

      const after = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(after.listingId).toBeNull(); // SetNull, no Cascade
      expect(after.linkedLabel).toBe('Bici de montaña'); // el snapshot conserva el contexto
      expect(await messagesOf(ticket.id)).toHaveLength(1);
    });
  });
});
