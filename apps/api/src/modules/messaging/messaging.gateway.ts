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
import { Role } from '@prisma/client';
import { Server, Socket } from 'socket.io';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { appOrigin } from '../../config/app-origin';
import { assertCanHandleTicket } from '../tickets/tickets.guards';
import type { JwtPayload } from '../auth/auth.types';

/** Sala de rol del equipo de atención (R9). Un solo nombre, usado al unir y al emitir. */
export const STAFF_ROOM = 'staff';

/** Evento de mensaje de ticket. Gemelo de `message:new` de la mensajería. */
export const TICKET_MESSAGE_EVENT = 'ticket:message';

/**
 * R9 PASO 1 — CORS restringido al origen del frontend. Cierra el `TODO(prod)`
 * que arrastraba `cors: { origin: '*' }` desde que se creó el gateway.
 *
 * `appOrigin()` y no `configService`: un decorador se evalúa al cargar la clase,
 * cuando todavía no existe el contenedor de inyección. Es la MISMA función que
 * alimenta `config.appUrl`, así que no hay dos valores que puedan divergir
 * (ver `config/app-origin.ts`). En local resuelve a `http://localhost:3000`, que
 * es el origen del `next dev`, de modo que desarrollo y producción usan el mismo
 * mecanismo y no dos ramas distintas.
 *
 * `[appOrigin()]` — UN ARRAY DE UNO, y no la cadena suelta. No es cosmético: con
 * una cadena, el paquete `cors` emite `Access-Control-Allow-Origin: <ese valor>`
 * SIN COMPARAR con el `Origin` de la petición (protege igual, porque el navegador
 * hace la comparación, pero la respuesta es idéntica para todo el mundo). Con un
 * array, compara en el servidor y OMITE la cabecera cuando no casa — que es lo
 * que se puede observar y por tanto probar. Se descubrió ejerciéndolo: el test
 * del origen ajeno seguía recibiendo la cabecera con la forma de cadena.
 *
 * QUÉ PROTEGE Y QUÉ NO, dicho sin adornos: el CORS de socket.io es
 * DEFENSA EN PROFUNDIDAD, no la puerta. La puerta es el token del handshake
 * (`handshake.auth.token`), y es un token EXPLÍCITO, no una cookie — por eso
 * este gateway nunca fue vulnerable a *cross-site WebSocket hijacking*: una
 * página de tercero no puede hacer que el navegador adjunte un token que no
 * tiene. Además, el protocolo WebSocket no está sujeto a CORS (solo el
 * transporte de polling y el handshake), así que un cliente que fuerce
 * `transports: ['websocket']` no lo ve. Cerrarlo igual es correcto: elimina el
 * `*` del inventario de seguridad y bloquea el camino más fácil (polling desde
 * un origen ajeno), sin fingir que era el único control.
 */
@WebSocketGateway({ namespace: '/ws', cors: { origin: [appOrigin()] } })
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

      // R9 PASO 2 — SALA DE ROL `staff`, para la bandeja de tickets en vivo.
      //
      // El rol se lee de la BASE DE DATOS, no del `payload.role` del token, y no
      // es una precaución vacía: los JWT de este proyecto duran 7 días, así que
      // un usuario degradado de MODERATOR a USER seguiría llevando `role:
      // 'MODERATOR'` en un token perfectamente válido. `JwtStrategy` ya hace
      // exactamente esto en cada request HTTP por el mismo motivo; el canal de
      // tiempo real no puede ser la puerta laxa por la que se cuela un rol
      // caducado, y esta sala recibe los avisos de TODOS los tickets.
      const role = await this.freshRole(payload.sub);
      socket.data.role = role;
      if (role === 'ADMIN' || role === 'MODERATOR') {
        await socket.join(STAFF_ROOM);
      }
    } catch {
      socket.disconnect(true);
    }
  }

  /** Rol vigente en BD. Ver el porqué en `handleConnection`. */
  private async freshRole(userId: string): Promise<Role | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    return user?.role ?? null;
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

  // ---------------------------------------------------------------------------
  // R9 PASO 2 — TICKETS (atención al usuario §12)
  //
  // Van en ESTE gateway y no en uno nuevo por una razón del propio diseño:
  // `emitTicketMessage` tiene que emitir en `user:<id>` —la sala personal que ya
  // crea `handleConnection`— para que la lista "mis tickets" se entere sin estar
  // mirando el hilo. Dos gateways son dos espacios de salas distintos, así que
  // esa sala no se puede compartir. Consecuencia: una sola conexión por sesión y
  // una sola verificación de identidad, que además es lo que ya hacía messaging.
  // ---------------------------------------------------------------------------

  /**
   * `ticket:join` — molde exacto de `conversation:join`: se comprueba el ACCESO
   * CONTRA LA BASE DE DATOS antes de unir a la sala, nunca se confía en el id que
   * manda el cliente.
   *
   * Quién puede entrar en `ticket:<id>`:
   *  · el DUEÑO del hilo — siempre, incluso si lleva factura enlazada (es su
   *    ticket; mismo criterio que la descarga de adjuntos en R5);
   *  · el STAFF, con la PUERTA ADMIN-ONLY de facturación aplicada: un MODERATOR
   *    no entra en la sala de un ticket con `invoiceId`, igual que no puede
   *    abrirlo por HTTP. Se reutiliza `assertCanHandleTicket` —la misma función
   *    que usan el servicio y los adjuntos— en vez de recopiar la condición: una
   *    autorización duplicada es una autorización que divergirá.
   *
   * Un tercero recibe el mismo `error: Forbidden` que en `conversation:join` y NO
   * se une a nada.
   */
  @SubscribeMessage('ticket:join')
  async handleTicketJoin(
    @ConnectedSocket() socket: Socket,
    @MessageBody() payload: { ticketId: string },
  ) {
    const userId = socket.data.userId as string | undefined;
    if (!userId) {
      socket.disconnect(true);
      return;
    }

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: payload.ticketId },
      select: { userId: true, invoiceId: true },
    });

    // "No existe" y "no es para ti" comparten respuesta, igual que en
    // `conversation:join` y que el guard de enlace de R2: distinguirlos
    // convertiría esta sala en un oráculo de existencia de ids de ticket.
    if (!ticket) {
      socket.emit('error', { message: 'Forbidden' });
      return;
    }

    if (ticket.userId !== userId) {
      // No es suyo: solo cabe por la vía de staff, con el rol FRESCO que se
      // resolvió al conectar.
      const role = socket.data.role as Role | undefined;
      if (role !== 'ADMIN' && role !== 'MODERATOR') {
        socket.emit('error', { message: 'Forbidden' });
        return;
      }
      try {
        assertCanHandleTicket(ticket, { userId, role });
      } catch {
        socket.emit('error', { message: 'Forbidden' });
        return;
      }
    }

    // Idempotente, como el de conversaciones: 'connect' se vuelve a disparar en
    // cada reconexión y el cliente re-emite sus joins.
    await socket.join(`ticket:${payload.ticketId}`);
  }

  /**
   * Gemelo de `emitNewMessage`, con UNA diferencia que es la razón de ser de este
   * método: **una NOTA INTERNA no sale de la sala de staff**.
   *
   * El WebSocket es una SUPERFICIE NUEVA de la invariante §10.3. Las cinco
   * defensas anteriores viven en las consultas (`getForUser` filtra
   * `internal: false`), en los contadores, en el DTO y en los avisos de R4; nada
   * de eso protege un canal que empuja el mensaje al navegador. Aquí la defensa
   * es doble y estructural:
   *
   *  1. la nota se emite SOLO a `staff`, sala en la que únicamente se entra con
   *     rol verificado contra la BD al conectar;
   *  2. el `return` corta ANTES de `ticket:<id>` y de `user:<id>` — y es
   *     importante que sea así y no una emisión condicional más abajo, porque
   *     `ticket:<id>` contiene al usuario y al agente a la vez: mandar ahí una
   *     nota interna se la entrega al usuario en la cara.
   *
   * Un agente que esté mirando el hilo recibe igualmente la nota, por la sala
   * `staff`. Es decir: el diseño de salas es lo que hace cumplir la invariante,
   * no un `if` que haya que acordarse de escribir en cada emisión futura.
   */
  emitTicketMessage(
    ticket: { id: string; userId: string },
    message: { id: string; internal: boolean } & Record<string, unknown>,
  ) {
    const payload = { ticketId: ticket.id, message };

    // Una NOTA INTERNA sale SOLO a `staff`, y el `return` corta aquí — antes de
    // que exista la menor posibilidad de nombrar otra sala.
    if (message.internal) {
      this.server.to(STAFF_ROOM).emit(TICKET_MESSAGE_EVENT, payload);
      return;
    }

    // Un SOLO emit con los `to()` ENCADENADOS, no tres emits seguidos: socket.io
    // deduplica la unión de salas, así que cada socket recibe el evento UNA vez
    // aunque esté en varias (el usuario está en `ticket:<id>` y en `user:<id>`; un
    // agente que mire el hilo, en `staff` y en `ticket:<id>`). Con emits separados
    // —como hace `emitNewMessage`, que por eso obliga al cliente a deduplicar por
    // id— llegaban dos copias del mismo mensaje. Se vio al probarlo.
    //
    // Las tres salas: el equipo (bandeja), el hilo abierto, y la sala personal del
    // dueño para que su lista se mueva sin tener el hilo delante.
    this.server
      .to(STAFF_ROOM)
      .to(`ticket:${ticket.id}`)
      .to(`user:${ticket.userId}`)
      .emit(TICKET_MESSAGE_EVENT, payload);
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
