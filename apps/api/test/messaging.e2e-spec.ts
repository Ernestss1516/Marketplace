import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AddressInfo } from 'net';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

// Waits for a socket.io-client socket to reach the "connected" state.
function waitForConnect(socket: Socket, timeoutMs = 5_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }
    const timer = setTimeout(
      () => reject(new Error(`Socket did not connect within ${timeoutMs} ms`)),
      timeoutMs,
    );
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err: Error) => {
      clearTimeout(timer);
      reject(new Error(`Socket connect error: ${err.message}`));
    });
  });
}

// Waits for a named socket.io event with a hard timeout to avoid hanging tests.
function waitForEvent<T>(socket: Socket, event: string, timeoutMs = 5_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Event "${event}" not received within ${timeoutMs} ms`)),
      timeoutMs,
    );
    socket.once(event, (data: T) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

describe('Messaging (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let port: number;

  let sellerToken: string;
  let buyerToken: string;
  let outsiderToken: string;

  // Listing used for the idempotency + read/send tests (tests 2-6).
  let listingAId: string;
  // Listing used by test 1 only (POST /conversations — first creation).
  let listingBId: string;

  // Fixture conversation between buyer and seller over listingA.
  // Created in beforeAll; tests 2-6 use it as read-only fixture (except test 5
  // which adds a message to verify persistence, and test 6 which sends another).
  let conversationId: string;

  let buyerSocket: Socket;
  let outsiderSocket: Socket;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();

    // listen(0) assigns a random free port — required for socket.io-client
    await app.listen(0);
    port = (app.getHttpServer().address() as AddressInfo).port;

    await cleanDb(prisma);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    const categoryId = category.id;

    // Create users via Prisma — bcrypt 4 rounds for speed
    await Promise.all([
      prisma.user.create({
        data: {
          email: 'msg-seller@example.com',
          name: 'Msg Seller',
          slug: 'msg-seller',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'msg-buyer@example.com',
          name: 'Msg Buyer',
          slug: 'msg-buyer',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      }),
      prisma.user.create({
        data: {
          email: 'msg-outsider@example.com',
          name: 'Msg Outsider',
          slug: 'msg-outsider',
          passwordHash: await bcrypt.hash('Test1234!', 4),
          emailVerified: true,
        },
      }),
    ]);

    // Login — run sequentially to keep supertest simple
    const sellerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'msg-seller@example.com', password: 'Test1234!' });
    sellerToken = sellerLogin.body.accessToken as string;

    const buyerLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'msg-buyer@example.com', password: 'Test1234!' });
    buyerToken = buyerLogin.body.accessToken as string;

    const outsiderLogin = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'msg-outsider@example.com', password: 'Test1234!' });
    outsiderToken = outsiderLogin.body.accessToken as string;

    // Create listing A (fixture — idempotency / read / send / ws tests)
    const draftA = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'iPhone 13 Listing A',
        description: 'Fixture listing for messaging tests',
        price: 500,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        categoryId,
        city: 'Madrid',
        province: 'Madrid',
        latitude: 40.4168,
        longitude: -3.7038,
      })
      .expect(201);
    listingAId = draftA.body.id as string;
    await request(app.getHttpServer())
      .post(`/api/listings/${listingAId}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    // Create listing B (used only in test 1 to assert 201 on first creation)
    const draftB = await request(app.getHttpServer())
      .post('/api/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        title: 'Samsung Galaxy Listing B',
        description: 'Second fixture listing for test 1',
        price: 300,
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        categoryId,
        city: 'Barcelona',
        province: 'Barcelona',
        latitude: 41.3851,
        longitude: 2.1734,
      })
      .expect(201);
    listingBId = draftB.body.id as string;
    await request(app.getHttpServer())
      .post(`/api/listings/${listingBId}/publish`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    // Fixture conversation: buyer opens contact with listing A
    const convRes = await request(app.getHttpServer())
      .post('/api/conversations')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listingAId, message: 'Hola, ¿sigue disponible?' })
      .expect(201);
    conversationId = convRes.body.id as string;

    // Seller replies so there are ≥ 2 messages (tests 4 ordering / read-marking)
    await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ body: '¡Sí! ¿Cuándo quedamos?' })
      .expect(201);

    // Connect WebSocket clients — use websocket transport only (avoids HTTP long-poll race)
    const wsBase = `http://localhost:${port}/ws`;

    buyerSocket = io(wsBase, {
      auth: { token: buyerToken },
      transports: ['websocket'],
      forceNew: true,
    });
    outsiderSocket = io(wsBase, {
      auth: { token: outsiderToken },
      transports: ['websocket'],
      forceNew: true,
    });

    await Promise.all([waitForConnect(buyerSocket), waitForConnect(outsiderSocket)]);
  }, 60_000);

  afterAll(async () => {
    buyerSocket?.disconnect();
    outsiderSocket?.disconnect();
    await app.close();
    await prisma.$disconnect();
  });

  // ── POST /conversations (create) ────────────────────────────────────────────

  it('POST /api/conversations (primer mensaje) → 201 y conversación creada', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/conversations')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listingBId, message: 'Me interesa el Samsung.' })
      .expect(201);

    expect(res.body).toMatchObject({
      id: expect.any(String),
      listingId: listingBId,
    });
  });

  // ── POST /conversations (idempotent) ────────────────────────────────────────

  it('POST /api/conversations (misma pareja, mismo anuncio) → devuelve conversación existente', async () => {
    const res1 = await request(app.getHttpServer())
      .post('/api/conversations')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: listingAId, message: 'Segundo intento de contacto' })
      .expect(201);

    // The service returns the existing conversation without duplicating the message
    expect(res1.body.id).toBe(conversationId);
  });

  // ── GET /conversations ──────────────────────────────────────────────────────

  it('GET /api/conversations → lista de conversaciones del comprador', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/conversations')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);

    expect(res.body).toHaveProperty('items');
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items.length).toBeGreaterThan(0);

    const ids: string[] = res.body.items.map((c: { id: string }) => c.id);
    expect(ids).toContain(conversationId);

    // Each item has the expected summary shape
    for (const conv of res.body.items) {
      expect(conv).toMatchObject({
        id: expect.any(String),
        lastMessageAt: expect.any(String),
        unreadCount: expect.any(Number),
        listing: expect.objectContaining({ id: expect.any(String) }),
        otherUser: expect.objectContaining({ id: expect.any(String) }),
      });
    }
  });

  // ── GET /conversations/:id ──────────────────────────────────────────────────

  it('GET /api/conversations/:id → mensajes en orden + mensajes entrantes marcados como leídos', async () => {
    // Seller opens the conversation — this marks the buyer's messages as read.
    const res = await request(app.getHttpServer())
      .get(`/api/conversations/${conversationId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);

    expect(res.body.id).toBe(conversationId);
    expect(Array.isArray(res.body.messages)).toBe(true);
    expect(res.body.messages.length).toBeGreaterThanOrEqual(2);

    // Messages are returned DESC (newest first per service implementation).
    // Verify chronological ordering: messages[0] is more recent than messages[1].
    const [newest, older] = res.body.messages as Array<{ createdAt: string }>;
    expect(new Date(newest.createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(older.createdAt).getTime(),
    );

    // nextCursor is present (either a string id or null)
    expect('nextCursor' in res.body).toBe(true);

    // Verify that buyer's initial message was marked as read in the DB
    const buyerMessages = await prisma.message.findMany({
      where: {
        conversationId,
        sender: { email: 'msg-buyer@example.com' },
      },
    });
    expect(buyerMessages.length).toBeGreaterThan(0);
    for (const msg of buyerMessages) {
      expect(msg.readAt).not.toBeNull();
    }
  });

  // ── POST /conversations/:id/messages ────────────────────────────────────────

  it('POST /api/conversations/:id/messages → mensaje persistido en DB', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ body: 'Mensaje de prueba de persistencia' })
      .expect(201);

    expect(res.body).toMatchObject({
      id: expect.any(String),
      conversationId,
      body: 'Mensaje de prueba de persistencia',
    });

    // Verify persistence in DB
    const inDb = await prisma.message.findUnique({ where: { id: res.body.id as string } });
    expect(inDb).not.toBeNull();
    expect(inDb!.body).toBe('Mensaje de prueba de persistencia');
  });

  // ── WebSocket: message:new ──────────────────────────────────────────────────
  //
  // The buyer socket connects in beforeAll and is automatically added to the
  // user:${buyerId} room by the gateway's handleConnection. When the seller
  // sends a message via REST, MessagingController calls gateway.emitNewMessage,
  // which emits to the conv room AND to user:${buyerId}. The buyer receives the
  // event via the personal room even without calling conversation:join.

  it('WebSocket: buyer recibe message:new en tiempo real tras POST REST del vendedor', async () => {
    // Register listener BEFORE the POST to avoid missing a very fast emit.
    const eventPromise = waitForEvent<{
      conversationId: string;
      message: { body: string };
    }>(buyerSocket, 'message:new');

    await request(app.getHttpServer())
      .post(`/api/conversations/${conversationId}/messages`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ body: 'Mensaje WebSocket del vendedor en tiempo real' })
      .expect(201);

    const event = await eventPromise;

    expect(event).toMatchObject({
      conversationId,
      message: { body: 'Mensaje WebSocket del vendedor en tiempo real' },
    });
  });

  // ── WebSocket: conversation:join rechazado ──────────────────────────────────
  //
  // The outsider is not a participant (buyerId / sellerId) of conversationId,
  // so the gateway emits an error event and does NOT add the socket to the room.

  it('WebSocket: conversation:join a conversación ajena → gateway rechaza con error Forbidden', async () => {
    const errorPromise = waitForEvent<{ message: string }>(outsiderSocket, 'error');

    outsiderSocket.emit('conversation:join', { conversationId });

    const err = await errorPromise;
    expect(err).toMatchObject({ message: 'Forbidden' });
  });
});
