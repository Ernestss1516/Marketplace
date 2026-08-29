import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { MessagingService } from 'src/modules/messaging/messaging.service';
import { MessagingGateway } from 'src/modules/messaging/messaging.gateway';
import {
  MessageNotificationsService,
  MESSAGE_DIGEST_JOB,
} from 'src/modules/messaging/message-notifications.service';
import { MessageDigestProcessor } from 'src/modules/messaging/message-digest.processor';
import { NOTIFICATION_JOB } from 'src/infra/queue/notification.types';

/**
 * NOTIFICACIONES N4b — LOS AVISOS DE LA MENSAJERÍA.
 *
 * Las tres decisiones del diseño, y las ocho barreras que las fijan:
 *
 *  1. Por CONVERSACIÓN con contador, nunca una por mensaje.
 *  2. Sólo si NO está viendo ESE hilo.
 *  3. Correo con ventana de gracia AUTOCANCELANTE.
 *
 * ── LA CUARTA BARRERA ES LA QUE IMPORTA ────────────────────────────────────
 *
 * La implementación «obvia» de la decisión 2 —preguntar si el socket está en la
 * sala `conv:<id>`— pasa TODAS las demás barreras y falla ésta EN SILENCIO: el
 * cliente acumula salas en un `Set` que sólo crece, así que quien tiene tres hilos
 * abiertos y mira uno se comería los avisos de los otros dos.
 */
describe('Mensajería — avisos de mensajes sin leer (N4b) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let messaging: MessagingService;
  let gateway: MessagingGateway;
  let avisos: MessageNotificationsService;
  let digestSpy: jest.SpyInstance;
  /** La cola de CORREOS que el processor usa cuando decide que sí hay que mandar. */
  let correoSpy: jest.SpyInstance;
  /** Sockets simulados: lo que `fetchSockets()` devolvería. */
  let presencia: { data: Record<string, unknown> }[];

  let emisor: string;
  let receptor: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    messaging = app.get(MessagingService);
    gateway = app.get(MessagingGateway);
    avisos = app.get(MessageNotificationsService);

    /**
     * La presencia se simula sustituyendo `fetchSockets()`, que es lo único del
     * gateway que toca el mundo real. Lo que se ejercita es la LÓGICA de
     * `estaViendoConversacion`: qué campo mira y qué decide con él. Levantar
     * sockets de verdad probaría socket.io, no esta decisión.
     */
    presencia = [];
    jest
      .spyOn(gateway['server'] as never, 'in' as never)
      .mockImplementation(
        (() => ({ fetchSockets: async () => presencia })) as never,
      );

    const digestQueue = (
      avisos as unknown as { digestQueue: { add: (...a: unknown[]) => unknown } }
    ).digestQueue;
    digestSpy = jest.spyOn(digestQueue, 'add').mockResolvedValue(undefined as never);

    const correoQueue = (
      app.get(MessageDigestProcessor) as unknown as {
        notificationQueue: { add: (...a: unknown[]) => unknown };
      }
    ).notificationQueue;
    correoSpy = jest.spyOn(correoQueue, 'add').mockResolvedValue(undefined as never);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb(prisma);
    digestSpy.mockClear();
    correoSpy.mockClear();
    presencia = [];
    emisor = (await crearUsuario('emisor')).id;
    receptor = (await crearUsuario('receptor')).id;
    categoryId = (await prisma.category.findFirstOrThrow()).id;
  });

  async function crearUsuario(prefijo: string) {
    const id = randomUUID().slice(0, 8);
    return prisma.user.create({
      data: {
        email: `msg-${prefijo}-${id}@test.local`,
        name: `Msg ${prefijo} ${id}`,
        slug: `msg-${prefijo}-${id}`,
      },
    });
  }

  /** Una conversación entre emisor (comprador) y receptor (vendedor). */
  async function conversacion(titulo = 'Bici de carretera') {
    const listing = await prisma.listing.create({
      data: {
        title: titulo,
        slug: `msg-${randomUUID().slice(0, 8)}`,
        description: 'descripción',
        price: 100,
        type: 'PRODUCT',
        sellerId: receptor,
        categoryId,
        status: 'ACTIVE',
      },
    });
    return prisma.conversation.create({
      data: {
        listingId: listing.id,
        listingTitle: titulo,
        buyerId: emisor,
        sellerId: receptor,
      },
    });
  }

  /** Manda un mensaje y dispara los avisos, como hace el controlador. */
  async function enviar(conversationId: string, body: string) {
    const { buyerId, sellerId } = await messaging.sendMessage(conversationId, emisor, { body });
    await avisos.mensajeEnviado(conversationId, emisor, body, { buyerId, sellerId });
  }

  /** El receptor está mirando `conversationId` (o nada si es null). */
  function mirando(conversationId: string | null) {
    presencia = conversationId
      ? [{ data: { userId: receptor, activeConversationId: conversationId } }]
      : [];
  }

  const vivas = (userId: string) =>
    prisma.notification.findMany({ where: { userId, type: 'MESSAGE_UNREAD' } });

  const jobsDiferidos = () =>
    digestSpy.mock.calls.filter((c) => c[0] === MESSAGE_DIGEST_JOB);

  const correosEncolados = () =>
    correoSpy.mock.calls
      .filter((c) => c[0] === NOTIFICATION_JOB.SEND_MESSAGE_UNREAD)
      .map((c) => c[1] as Record<string, unknown>);

  // ===========================================================================
  // BARRERA 1 — por conversación, no por mensaje
  // ===========================================================================

  it('BARRERA 1 — tres mensajes del mismo hilo dejan UNA notificación con contador 3', async () => {
    const conv = await conversacion();
    mirando(null);

    await enviar(conv.id, 'Hola');
    await enviar(conv.id, '¿Sigue disponible?');
    await enviar(conv.id, '¿Me lo reservas?');

    const todas = await vivas(receptor);
    expect(todas).toHaveLength(1); // UNA, no tres
    const data = todas[0].data as Record<string, unknown>;
    expect(data.unreadCount).toBe(3);
    // El extracto es el del ÚLTIMO mensaje.
    expect(data.extracto).toBe('¿Me lo reservas?');
  });

  it('BARRERA 1b — el contador se RECALCULA: no se incrementa a ciegas', async () => {
    const conv = await conversacion();
    mirando(null);
    await enviar(conv.id, 'uno');
    await enviar(conv.id, 'dos');

    // Alguien marca leído por otro camino (lo hace `getConversation` al abrir).
    await prisma.message.updateMany({
      where: { conversationId: conv.id, senderId: { not: receptor } },
      data: { readAt: new Date() },
    });

    await enviar(conv.id, 'tres');

    const [viva] = await vivas(receptor);
    // Un `increment` habría dicho 3. El recálculo dice 1, que es la verdad.
    expect((viva.data as Record<string, unknown>).unreadCount).toBe(1);
  });

  // ===========================================================================
  // BARRERA 2 — sólo si no lo está viendo
  // ===========================================================================

  it('BARRERA 2 — si está viendo ESE hilo, NO se avisa por ningún canal', async () => {
    const conv = await conversacion();
    mirando(conv.id);

    await enviar(conv.id, 'Hola');

    expect(await vivas(receptor)).toHaveLength(0);
    expect(jobsDiferidos()).toHaveLength(0);
  });

  it('BARRERA 2b — si no lo está viendo, se avisa in-app y se arma la ventana', async () => {
    const conv = await conversacion();
    mirando(null);

    await enviar(conv.id, 'Hola');

    expect(await vivas(receptor)).toHaveLength(1);
    expect(jobsDiferidos()).toHaveLength(1);
  });

  // ===========================================================================
  // BARRERA 3 — la viva se resuelve al leer
  // ===========================================================================

  it('BARRERA 3 — abrir el hilo marca la notificación viva como leída', async () => {
    const conv = await conversacion();
    mirando(null);
    await enviar(conv.id, 'Hola');
    expect((await vivas(receptor))[0].read).toBe(false);

    // El camino real: `getConversation` marca los mensajes, el controlador resuelve.
    await messaging.getConversation(conv.id, receptor, {});
    await avisos.hiloLeido(conv.id, receptor);

    expect((await vivas(receptor))[0].read).toBe(true);
  });

  it('BARRERA 3b — un mensaje posterior REVIVE la notificación ya leída', async () => {
    const conv = await conversacion();
    mirando(null);
    await enviar(conv.id, 'Hola');
    await messaging.getConversation(conv.id, receptor, {});
    await avisos.hiloLeido(conv.id, receptor);

    await enviar(conv.id, 'Otra cosa');

    const todas = await vivas(receptor);
    expect(todas).toHaveLength(1); // sigue siendo UNA
    expect(todas[0].read).toBe(false); // pero vuelve a estar pendiente
  });

  // ===========================================================================
  // BARRERA 4 — LA CLAVE: el hilo que NO se está mirando SÍ notifica
  // ===========================================================================

  /**
   * El caso que la implementación «obvia» (preguntar por la sala `conv:<id>`)
   * silenciaría: el receptor tiene A y B abiertos —está en las dos salas, porque el
   * `Set` del cliente sólo crece— pero está mirando A. Un mensaje en B **tiene que
   * avisar**: no lo está viendo.
   */
  it('BARRERA 4 — con dos hilos abiertos y mirando A, un mensaje en B SÍ notifica', async () => {
    const convA = await conversacion('Hilo A');
    const convB = await conversacion('Hilo B');

    // Mirando A. (Con el test de la SALA, B también contaría como «viéndolo».)
    mirando(convA.id);

    await enviar(convB.id, 'Mensaje en el hilo que no mira');

    const todas = await vivas(receptor);
    expect(todas).toHaveLength(1);
    expect((todas[0].data as Record<string, unknown>).conversationId).toBe(convB.id);
    expect(jobsDiferidos()).toHaveLength(1);
  });

  it('BARRERA 4b — y el hilo que SÍ mira sigue en silencio', async () => {
    const convA = await conversacion('Hilo A');
    mirando(convA.id);

    await enviar(convA.id, 'Mensaje en el hilo que mira');

    expect(await vivas(receptor)).toHaveLength(0);
  });

  // ===========================================================================
  // BARRERA 5 y 6 — la ventana: un solo job, y agrupado
  // ===========================================================================

  it('BARRERA 5/6 — N mensajes en la ventana arman UN solo job, con el mismo jobId', async () => {
    const conv = await conversacion();
    mirando(null);

    await enviar(conv.id, 'uno');
    await enviar(conv.id, 'dos');
    await enviar(conv.id, 'tres');

    const jobs = jobsDiferidos();
    // Se llama tres veces, pero TODAS con el mismo jobId: BullMQ conserva una.
    // Es el jobId —y no un contador nuestro— lo que impide tres correos.
    const ids = new Set(jobs.map((c) => (c[2] as { jobId: string }).jobId));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toBe(`msg-mail:${receptor}:${conv.id}`);

    // Y va DIFERIDO: sin delay saldría al instante y no habría ventana.
    expect((jobs[0][2] as { delay: number }).delay).toBeGreaterThan(0);
  });

  // ===========================================================================
  // BARRERA 5 — la ventana es AUTOCANCELANTE: se comprueba al disparar
  // ===========================================================================

  /**
   * El corazón de la decisión 3. El trabajo diferido no se borra cuando el usuario
   * lee: se despierta y PREGUNTA. Aquí se le hace disparar a mano en los dos
   * estados posibles.
   */
  describe('BARRERA 5 — el trabajo diferido decide al dispararse', () => {
    /** Dispara el processor como lo haría BullMQ al vencer la ventana. */
    const disparar = (conversationId: string) =>
      app
        .get(MessageDigestProcessor)
        .process({ data: { conversationId, recipientId: receptor } } as never);

    it('si SIGUE sin leer, encola el correo AGRUPADO con el total', async () => {
      const conv = await conversacion();
      mirando(null);
      await enviar(conv.id, 'uno');
      await enviar(conv.id, 'dos');
      correoSpy.mockClear();

      await disparar(conv.id);

      const [correo] = correosEncolados();
      expect(correo).toBeDefined();
      // UN correo con los DOS mensajes, no dos correos.
      expect(correosEncolados()).toHaveLength(1);
      expect(correo.unreadCount).toBe(2);
      expect(correo.extracto).toBe('dos');
    });

    it('si YA leyó dentro de la ventana, NO manda nada — y es el caso bueno', async () => {
      const conv = await conversacion();
      mirando(null);
      await enviar(conv.id, 'uno');

      // Entra y lo lee ANTES de que venza la ventana.
      await messaging.getConversation(conv.id, receptor, {});
      correoSpy.mockClear();

      await disparar(conv.id);

      expect(correosEncolados()).toHaveLength(0);
    });
  });

  // ===========================================================================
  // BARRERA 7 — las notificaciones de evento siguen intactas
  // ===========================================================================

  /**
   * El `@@unique([userId, type, groupKey])` NO debe restringir a las de evento. En
   * PostgreSQL los NULL no colisionan entre sí, así que dos avisos del mismo tipo
   * conviven — que es como se ha comportado el buzón desde siempre.
   */
  it('BARRERA 7 — dos notificaciones de evento del mismo tipo (groupKey NULL) conviven', async () => {
    for (const alertName of ['Bicis', 'Coches']) {
      await prisma.notification.create({
        data: {
          userId: receptor,
          type: 'ALERT_MATCH',
          data: { alertId: 'a', alertName, listingId: 'l', listingSlug: 's', listingTitle: 'T' },
        },
      });
    }

    const todas = await prisma.notification.findMany({
      where: { userId: receptor, type: 'ALERT_MATCH' },
    });
    expect(todas).toHaveLength(2);
    expect(todas.every((n) => n.groupKey === null)).toBe(true);
  });

  it('BARRERA 7b — y la viva sí lleva su groupKey', async () => {
    const conv = await conversacion();
    mirando(null);
    await enviar(conv.id, 'Hola');

    expect((await vivas(receptor))[0].groupKey).toBe(conv.id);
  });
});
