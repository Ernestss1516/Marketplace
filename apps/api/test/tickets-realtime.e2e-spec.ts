import { randomUUID } from 'crypto';
import { AddressInfo } from 'net';
import { INestApplication } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { TicketsService } from 'src/modules/tickets/tickets.service';
import { RedisService } from 'src/infra/redis/redis.service';
import { TICKET_MESSAGE_EVENT } from 'src/modules/messaging/messaging.gateway';

/**
 * Atención al usuario R9 PASO 2 — TIEMPO REAL de tickets.
 *
 * EL CASO CENTRAL DE ESTA SUITE es el último bloque: **la invariante §10.3 en el
 * canal de tiempo real**. Las cinco defensas anteriores de las notas internas
 * viven en las consultas, en los contadores, en el DTO y en los avisos de R4 —
 * y ninguna de ellas protege un canal que EMPUJA el mensaje al navegador. El
 * WebSocket es una superficie nueva por la que la nota podría filtrarse, y aquí
 * se comprueba que no lo hace.
 *
 * Se ejerce con sockets de verdad contra la app escuchando en un puerto real
 * (molde `messaging.e2e-spec.ts`), no con espías sobre el gateway: un espía
 * probaría que llamamos al método, no que el mensaje no llega al usuario.
 */
describe('Tickets — tiempo real (R9) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;
  let tickets: TicketsService;
  let wsBase: string;

  const PASSWORD = 'Test1234!';
  const sockets: Socket[] = [];

  let admin: { id: string; token: string };
  let moderator: { id: string; token: string };
  let alice: { id: string; token: string };
  let bob: { id: string; token: string };

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    // listen(0) y no init(): sin servidor escuchando no hay gateway.
    await app.listen(0);
    server = app.getHttpServer();
    tickets = app.get(TicketsService);
    const { port } = server.address() as AddressInfo;
    wsBase = `http://localhost:${port}/ws`;
  }, 60_000);

  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb(prisma);
    await flushRateLimits();
    admin = await createAndLogin('ADMIN');
    moderator = await createAndLogin('MODERATOR');
    alice = await createAndLogin('USER');
    bob = await createAndLogin('USER');
  });

  afterEach(() => {
    while (sockets.length) sockets.pop()?.disconnect();
  });

  // --- helpers -------------------------------------------------------------

  async function createUser(role: Role) {
    const id = randomUUID().slice(0, 8);
    return prisma.user.create({
      data: {
        email: `trt-${id}@test.local`,
        name: `Trt ${id}`,
        slug: `trt-${id}`,
        role,
        passwordHash: await bcrypt.hash(PASSWORD, 4),
        emailVerified: true,
      },
    });
  }

  async function createAndLogin(role: Role) {
    const user = await createUser(role);
    const path = role === 'ADMIN' ? '/api/auth/admin-login' : '/api/auth/login';
    const res = await request(server)
      .post(path)
      .send({ email: user.email, password: PASSWORD })
      .expect(200);
    const token = res.body.accessToken as string | undefined;
    if (!token) throw new Error(`Login de ${role} no devolvió accessToken`);
    return { id: user.id, token };
  }

  async function flushRateLimits() {
    const client = app.get(RedisService).client;
    const keys = [
      ...(await client.keys('tickets:create:user:*')),
      ...(await client.keys('auth:*')),
    ];
    if (keys.length) await client.del(...keys);
  }

  /** Conecta un socket autenticado y espera a que el gateway lo acepte. */
  async function connect(token: string): Promise<Socket> {
    const socket = io(wsBase, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
      setTimeout(() => reject(new Error('timeout de conexión')), 10_000);
    });
    return socket;
  }

  /** Emite `ticket:join` y espera el resultado: unido, o rechazado con error. */
  async function join(socket: Socket, ticketId: string): Promise<'ok' | 'forbidden'> {
    return new Promise((resolve) => {
      // El gateway no acusa recibo del join correcto (molde conversation:join), así
      // que "sin error en una ventana corta" ES la señal de que entró. La ventana
      // se cierra sola: si el rechazo llega, resuelve antes.
      const timer = setTimeout(() => resolve('ok'), 400);
      socket.once('error', () => {
        clearTimeout(timer);
        resolve('forbidden');
      });
      socket.emit('ticket:join', { ticketId });
    });
  }

  /** Recolector de eventos: se instala ANTES de disparar la acción. */
  function collect(socket: Socket): { events: unknown[] } {
    const box: { events: unknown[] } = { events: [] };
    socket.on(TICKET_MESSAGE_EVENT, (p: unknown) => box.events.push(p));
    return box;
  }

  /** Espera hasta que `check()` sea cierto, o se agote el plazo. */
  async function waitFor(check: () => boolean, ms = 3_000): Promise<boolean> {
    const limite = Date.now() + ms;
    while (Date.now() < limite) {
      if (check()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return check();
  }

  /** Margen para afirmar que algo NO llegó: se espera de verdad, no se asume. */
  const NO_LLEGA_MS = 800;
  const esperar = (ms = NO_LLEGA_MS) => new Promise((r) => setTimeout(r, ms));

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  function userTicket(userId: string, subject = 'Duda', extra: Record<string, unknown> = {}) {
    return tickets.createByUser(userId, { subject, body: 'Cuerpo', ...extra });
  }

  async function ticketConFactura(userId: string) {
    const invoice = await prisma.invoice.create({
      data: {
        origin: 'USER_REQUESTED',
        status: 'ISSUED',
        number: `F-R9-${randomUUID().slice(0, 6)}`,
        userId,
        subtotalNet: 10,
        totalTax: 2.1,
        totalGross: 12.1,
      },
    });
    return userTicket(userId, 'Mi factura no cuadra', { invoiceId: invoice.id });
  }

  // ===========================================================================
  // Lo que R9 añade: el hilo se mueve solo
  // ===========================================================================

  describe('el hilo se actualiza en vivo', () => {
    it('el usuario suscrito recibe la respuesta del staff sin recargar', async () => {
      const t = await userTicket(alice.id);
      const socket = await connect(alice.token);
      expect(await join(socket, t.id)).toBe('ok');
      const caja = collect(socket);

      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .send({ body: 'Lo estamos viendo' })
        .expect(201);

      expect(await waitFor(() => caja.events.length === 1)).toBe(true);
      const evento = caja.events[0] as { ticketId: string; message: { body: string; side: string } };
      expect(evento.ticketId).toBe(t.id);
      expect(evento.message.body).toBe('Lo estamos viendo');
      expect(evento.message.side).toBe('STAFF');
    });

    it('el staff con el hilo abierto recibe la respuesta del usuario', async () => {
      const t = await userTicket(alice.id);
      const socket = await connect(admin.token);
      expect(await join(socket, t.id)).toBe('ok');
      const caja = collect(socket);

      await request(server)
        .post(`/api/tickets/${t.id}/messages`)
        .set(auth(alice.token))
        .send({ body: 'Sigo esperando' })
        .expect(201);

      expect(await waitFor(() => caja.events.length >= 1)).toBe(true);
      expect((caja.events[0] as { message: { body: string } }).message.body).toBe('Sigo esperando');
    });

    it('la BANDEJA de staff se entera sin estar en el hilo (sala `staff`)', async () => {
      // Sin ningún `ticket:join`: la sala de rol se une al conectar.
      const socket = await connect(moderator.token);
      const caja = collect(socket);

      await userTicket(bob.id, 'Ticket recién abierto');

      expect(await waitFor(() => caja.events.length === 1)).toBe(true);
    });

    it('el USUARIO se entera en su sala personal aunque no tenga el hilo abierto', async () => {
      const t = await userTicket(alice.id);
      const socket = await connect(alice.token); // sin ticket:join
      const caja = collect(socket);

      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .send({ body: 'Respuesta' })
        .expect(201);

      expect(await waitFor(() => caja.events.length >= 1)).toBe(true);
    });

    it('un USUARIO CUALQUIERA no recibe nada de un hilo ajeno (ni por su sala personal)', async () => {
      const t = await userTicket(alice.id);
      const socket = await connect(bob.token);
      const caja = collect(socket);

      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .send({ body: 'Privado' })
        .expect(201);

      await esperar();
      expect(caja.events).toHaveLength(0);
    });
  });

  // ===========================================================================
  // ATAQUE: entrar en la sala de un ticket ajeno
  // ===========================================================================

  describe('ATAQUE: ticket:join sobre un hilo ajeno', () => {
    it('rechazado, y no recibe los mensajes de esa sala', async () => {
      const t = await userTicket(alice.id);
      const intruso = await connect(bob.token);

      expect(await join(intruso, t.id)).toBe('forbidden');

      // No basta el error: hay que comprobar que NO está en la sala.
      const caja = collect(intruso);
      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .send({ body: 'Solo para los de dentro' })
        .expect(201);

      await esperar();
      expect(caja.events).toHaveLength(0);
    });

    it('un ticket que no existe se rechaza igual que uno ajeno (sin oráculo de ids)', async () => {
      const intruso = await connect(bob.token);
      expect(await join(intruso, 'noexiste')).toBe('forbidden');
    });

    it('sin token no hay conexión, así que tampoco sala', async () => {
      const socket = io(wsBase, { transports: ['websocket'], forceNew: true });
      sockets.push(socket);
      const desconectado = await new Promise<boolean>((resolve) => {
        socket.once('disconnect', () => resolve(true));
        socket.once('connect_error', () => resolve(true));
        setTimeout(() => resolve(false), 5_000);
      });
      expect(desconectado).toBe(true);
    });

    it('el DUEÑO sí entra — el contraste completo, no solo el 403', async () => {
      const t = await userTicket(alice.id);
      const dueno = await connect(alice.token);
      expect(await join(dueno, t.id)).toBe('ok');
    });
  });

  // ===========================================================================
  // Puerta ADMIN-only de facturación, en la sala
  // ===========================================================================

  describe('ticket con factura: la puerta ADMIN-only también cierra la sala', () => {
    it('el MODERATOR no entra y el ADMIN sí', async () => {
      const t = await ticketConFactura(alice.id);

      const mod = await connect(moderator.token);
      expect(await join(mod, t.id)).toBe('forbidden');

      const adm = await connect(admin.token);
      expect(await join(adm, t.id)).toBe('ok');
    });

    it('el DUEÑO entra en la sala de su ticket con factura (la puerta es de staff)', async () => {
      const t = await ticketConFactura(alice.id);
      const dueno = await connect(alice.token);
      expect(await join(dueno, t.id)).toBe('ok');
    });
  });

  // ===========================================================================
  // Rol fresco, no el del token
  // ===========================================================================

  describe('el rol de la sala `staff` se lee de la BD, no del token', () => {
    it('un MODERATOR degradado a USER con su token todavía válido NO entra en `staff`', async () => {
      // El token se emitió con role: MODERATOR y sigue siendo criptográficamente
      // válido (duran 7 días). Si la sala se fiara de él, este usuario seguiría
      // recibiendo la actividad de TODOS los tickets después de perder el rol.
      const degradado = moderator;
      await prisma.user.update({ where: { id: degradado.id }, data: { role: 'USER' } });

      const socket = await connect(degradado.token);
      const caja = collect(socket);

      await userTicket(bob.id, 'Actividad que no debería ver');

      await esperar();
      expect(caja.events).toHaveLength(0);
    });

    it('y un MODERATOR de verdad sí entra (el contraste)', async () => {
      const socket = await connect(moderator.token);
      const caja = collect(socket);
      await userTicket(bob.id, 'Actividad normal');
      expect(await waitFor(() => caja.events.length === 1)).toBe(true);
    });
  });

  // ===========================================================================
  // Reconexión
  // ===========================================================================

  describe('reconexión', () => {
    it('re-unirse a la misma sala no duplica los eventos (socket.join es idempotente)', async () => {
      const t = await userTicket(alice.id);
      const socket = await connect(alice.token);
      await join(socket, t.id);
      await join(socket, t.id);
      await join(socket, t.id);
      const caja = collect(socket);

      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .send({ body: 'Una sola vez' })
        .expect(201);

      expect(await waitFor(() => caja.events.length >= 1)).toBe(true);
      await esperar();
      // UNA sola copia, aunque el socket esté en dos salas (`ticket:<id>` y
      // `user:<id>`) y se haya unido tres veces: el emit encadena los `to()` y
      // socket.io deduplica la unión.
      expect(caja.events).toHaveLength(1);
    });
  });

  // ===========================================================================
  // ★ LA INVARIANTE §10.3 EN EL CANAL DE TIEMPO REAL ★
  // ===========================================================================

  describe('NOTA INTERNA — la invariante §10.3 en el canal de tiempo real', () => {
    it('EL USUARIO SUSCRITO A SU HILO NO RECIBE LA NOTA INTERNA', async () => {
      const t = await userTicket(alice.id);
      const usuario = await connect(alice.token);
      expect(await join(usuario, t.id)).toBe('ok');
      const caja = collect(usuario);

      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .send({ body: 'Ojo: reincidente', internal: true })
        .expect(201);

      await esperar();
      expect(caja.events).toHaveLength(0);
      // Y no es que no se haya escrito: la nota existe.
      expect(
        await prisma.ticketMessage.count({ where: { ticketId: t.id, internal: true } }),
      ).toBe(1);
    });

    it('el STAFF sí la recibe (por la sala `staff`) — el contraste que da valor al anterior', async () => {
      const t = await userTicket(alice.id);
      const agente = await connect(admin.token);
      const caja = collect(agente);

      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .send({ body: 'Ojo: reincidente', internal: true })
        .expect(201);

      expect(await waitFor(() => caja.events.length >= 1)).toBe(true);
      const evento = caja.events[0] as { message: { body: string; internal: boolean } };
      expect(evento.message.internal).toBe(true);
      expect(evento.message.body).toBe('Ojo: reincidente');
    });

    it('el texto de la nota NO viaja por la sala del hilo ni por la personal del usuario', async () => {
      // Dos suscripciones del usuario a la vez (hilo + sala personal): ninguna
      // debe ver ni el evento ni el texto.
      const t = await userTicket(alice.id);
      const usuario = await connect(alice.token);
      await join(usuario, t.id);
      const recibido: string[] = [];
      usuario.onAny((_evento, payload) => recibido.push(JSON.stringify(payload)));

      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .send({ body: 'SECRETO-INTERNO-XYZ', internal: true })
        .expect(201);

      await esperar();
      expect(recibido.join('|')).not.toContain('SECRETO-INTERNO-XYZ');
    });

    it('una respuesta NORMAL después de una nota interna sí llega (la nota no rompe el canal)', async () => {
      const t = await userTicket(alice.id);
      const usuario = await connect(alice.token);
      await join(usuario, t.id);
      const caja = collect(usuario);

      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .send({ body: 'nota', internal: true })
        .expect(201);
      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .send({ body: 'respuesta de verdad' })
        .expect(201);

      expect(await waitFor(() => caja.events.length >= 1)).toBe(true);
      await esperar();
      const cuerpos = caja.events.map((e) => (e as { message: { body: string } }).message.body);
      expect(cuerpos).not.toContain('nota');
      expect(cuerpos).toContain('respuesta de verdad');
    });
  });

  // ===========================================================================
  // El tiempo real es ADICIONAL: R4 sigue en pie
  // ===========================================================================

  describe('el WebSocket NO sustituye a la Notification de R4', () => {
    it('una respuesta del staff crea la Notification Y emite por socket', async () => {
      const t = await userTicket(alice.id);
      const usuario = await connect(alice.token);
      await join(usuario, t.id);
      const caja = collect(usuario);

      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .send({ body: 'Las dos cosas' })
        .expect(201);

      expect(await waitFor(() => caja.events.length >= 1)).toBe(true);
      const avisos = await prisma.notification.findMany({
        where: { userId: alice.id, type: 'TICKET_MESSAGE' },
      });
      expect(avisos).toHaveLength(1);
    });

    it('y una nota interna no crea ninguna de las dos para el usuario', async () => {
      const t = await userTicket(alice.id);

      await request(server)
        .post(`/api/admin/tickets/${t.id}/messages`)
        .set(auth(admin.token))
        .send({ body: 'nota', internal: true })
        .expect(201);

      expect(await prisma.notification.count({ where: { userId: alice.id } })).toBe(0);
    });
  });

  // ===========================================================================
  // LA CARRERA DE handleConnection
  //
  // `handleConnection` es async: fija `socket.data.userId` en el acto pero
  // `socket.data.role` solo DESPUÉS de consultar la base. Socket.IO le da el
  // `connect` al cliente sin esperar a que termine, así que quien emite
  // `ticket:join` nada más conectar leía un rol a medio poner: un ADMIN legítimo
  // rechazado como si no fuera staff.
  //
  // No es un problema de test: el cliente real RE-EMITE sus joins en cada
  // reconexión (wifi, suspensión, cambio de red), que es justo el patrón que
  // dispara la carrera. Se veía como un rojo intermitente de esta suite —solo con
  // el pool frío, porque la ventana se ensancha— y por eso se confundió con flake.
  //
  // Estos tests emiten EN EL MISMO TICK que el `connect`, sin esperas
  // artificiales, y repiten para que no pase por suerte.
  // ===========================================================================

  describe('carrera: join emitido en el mismo tick que el connect', () => {
    /** Cuántas veces se repite cada escenario. La carrera es probabilística: un
     *  solo intento podría pasar por casualidad justo por el lado bueno. */
    const REPETICIONES = 8;

    /**
     * Conecta y emite `ticket:join` SIN esperar al `connect` — el emit se engancha
     * al evento, que es literalmente lo que hace el cliente real al reconectar.
     * Devuelve si el gateway respondió con `error` (rechazo).
     *
     * A diferencia del helper `join` de arriba, aquí no se espera a que el socket
     * esté listo: esperar sería justamente esquivar la carrera que se quiere
     * ejercer.
     */
    async function conectarYUnirseEnElMismoTick(
      token: string,
      ticketId: string,
    ): Promise<{ rechazado: boolean }> {
      const socket = io(wsBase, { auth: { token }, transports: ['websocket'], forceNew: true });
      sockets.push(socket);

      let rechazado = false;
      socket.on('error', () => { rechazado = true; });
      // El emit va DENTRO del handler de connect: mismo tick, sin margen.
      socket.on('connect', () => { socket.emit('ticket:join', { ticketId }); });

      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
        setTimeout(() => reject(new Error('timeout de conexión')), 10_000);
      });

      // Ventana para que un rechazo llegue si va a llegar. El gateway responde en
      // el mismo viaje que el join, así que con esto basta y sobra.
      await esperar(500);
      return { rechazado };
    }

    it('EL ADMIN SIEMPRE ENTRA aunque emita el join en el mismo tick que el connect', async () => {
      const t = await userTicket(alice.id);

      const rechazos: number[] = [];
      for (let i = 0; i < REPETICIONES; i++) {
        const { rechazado } = await conectarYUnirseEnElMismoTick(admin.token, t.id);
        if (rechazado) rechazos.push(i);
      }

      // Si falla, el array dice EN QUÉ intentos: el rol no estaba resuelto cuando
      // llegó el join (la carrera de handleConnection).
      expect(rechazos).toEqual([]);
    });

    it('y el MODERATOR también, en un ticket normal', async () => {
      const t = await userTicket(alice.id);

      const rechazos: number[] = [];
      for (let i = 0; i < REPETICIONES; i++) {
        const { rechazado } = await conectarYUnirseEnElMismoTick(moderator.token, t.id);
        if (rechazado) rechazos.push(i);
      }

      expect(rechazos).toEqual([]);
    });

    // CONTRASTE — sin esto, los dos tests de arriba pasarían igual si el `error`
    // simplemente no se observara nunca. Este demuestra que sí se ve.
    it('un tercero SIGUE siendo rechazado en el mismo escenario (la observación no es vacía)', async () => {
      const t = await userTicket(alice.id);

      const rechazos: number[] = [];
      for (let i = 0; i < REPETICIONES; i++) {
        const { rechazado } = await conectarYUnirseEnElMismoTick(bob.token, t.id);
        if (rechazado) rechazos.push(i);
      }

      // Un usuario ajeno debe ser rechazado SIEMPRE.
      expect(rechazos.length).toBe(REPETICIONES);
    });

    // LA PUERTA DE R9 NO SE ABRE — el arreglo solo cierra la ventana de tiempo;
    // no relaja ninguna verificación.
    it('la puerta de factura sigue cerrada: MODERATOR NO entra en un ticket con invoiceId', async () => {
      const t = await ticketConFactura(alice.id);

      const rechazos: number[] = [];
      for (let i = 0; i < REPETICIONES; i++) {
        const { rechazado } = await conectarYUnirseEnElMismoTick(moderator.token, t.id);
        if (rechazado) rechazos.push(i);
      }

      // El MODERATOR debe ser rechazado SIEMPRE aquí: puerta ADMIN-only de R9.
      expect(rechazos.length).toBe(REPETICIONES);
    });

    it('y el ADMIN sí entra en ese mismo ticket con factura, también en el mismo tick', async () => {
      const t = await ticketConFactura(alice.id);

      const rechazos: number[] = [];
      for (let i = 0; i < REPETICIONES; i++) {
        const { rechazado } = await conectarYUnirseEnElMismoTick(admin.token, t.id);
        if (rechazado) rechazos.push(i);
      }

      expect(rechazos).toEqual([]);
    });

    it('el DUEÑO entra en el mismo tick (esta vía nunca dependió del rol, se fija por si acaso)', async () => {
      const t = await userTicket(alice.id);

      const { rechazado } = await conectarYUnirseEnElMismoTick(alice.token, t.id);

      expect(rechazado).toBe(false);
    });
  });
});
