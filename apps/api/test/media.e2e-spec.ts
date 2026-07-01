import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Media (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let userToken: string;

  // Minimal 1×1 JPEG in memory — no filesystem dependency.
  const TINY_JPEG = Buffer.from(
    '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkS' +
    'Ew8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJ' +
    'CQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy' +
    'MjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/' +
    'EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAA' +
    'AAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJQA/9k=',
    'base64',
  );

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    await prisma.user.create({
      data: {
        email: 'media-test@example.com',
        name: 'Media Test User',
        slug: 'media-test-user',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'media-test@example.com', password: 'Test1234!' });
    userToken = loginRes.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── POST /media/upload-avatar ───────────────────────────────────────────────

  it('POST /api/media/upload-avatar sin auth → 401', async () => {
    await request(app.getHttpServer())
      .post('/api/media/upload-avatar')
      .attach('file', TINY_JPEG, { filename: 'avatar.jpg', contentType: 'image/jpeg' })
      .expect(401);
  });

  it('POST /api/media/upload-avatar archivo no-imagen → 422', async () => {
    await request(app.getHttpServer())
      .post('/api/media/upload-avatar')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', Buffer.from('not an image'), { filename: 'file.txt', contentType: 'text/plain' })
      .expect(422);
  });

  it('POST /api/media/upload-avatar sin archivo → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/media/upload-avatar')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(400);
  });

  it('POST /api/media/upload-avatar autenticado → 200 { url } y NO crea ListingImage', async () => {
    const countBefore = await prisma.listingImage.count();

    const res = await request(app.getHttpServer())
      .post('/api/media/upload-avatar')
      .set('Authorization', `Bearer ${userToken}`)
      .attach('file', TINY_JPEG, { filename: 'avatar.jpg', contentType: 'image/jpeg' })
      .expect(201);

    expect(res.body).toHaveProperty('url');
    expect(typeof res.body.url).toBe('string');
    expect(res.body.url).toMatch(/avatars\//);

    // Avatar upload must NOT create a ListingImage row.
    const countAfter = await prisma.listingImage.count();
    expect(countAfter).toBe(countBefore);
  });
});
