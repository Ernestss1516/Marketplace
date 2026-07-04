import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

// google-auth-library must never make a real network call in tests — mock the
// id_token verification so we can simulate valid/invalid/unverified Google profiles.
const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

function googlePayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    sub: 'google-sub-123',
    email: 'social@example.com',
    email_verified: true,
    name: 'Social User',
    picture: 'https://example.com/avatar.png',
    ...overrides,
  };
}

describe('Social Auth - Google (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb(prisma);
    mockVerifyIdToken.mockReset();
  });

  it('id_token inválido (falla la verificación) → 401, no crea usuario', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('invalid signature'));

    await request(app.getHttpServer())
      .post('/api/auth/social/google')
      .send({ idToken: 'garbage' })
      .expect(401);

    expect(await prisma.user.count()).toBe(0);
  });

  it('usuario nuevo con Google → crea User (passwordHash null, emailVerified true, avatarUrl) + Account, emite JWT', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => googlePayload() });

    const res = await request(app.getHttpServer())
      .post('/api/auth/social/google')
      .send({ idToken: 'valid-token' })
      .expect(200);

    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({ email: 'social@example.com', emailVerified: true });

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'social@example.com' } });
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerified).toBe(true);
    expect(user.avatarUrl).toBe('https://example.com/avatar.png');

    const account = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider: 'google', providerAccountId: 'google-sub-123' } },
    });
    expect(account?.userId).toBe(user.id);
  });

  it('usuario existente con contraseña + Google mismo email verificado → VINCULA, no duplica User', async () => {
    const existing = await prisma.user.create({
      data: {
        email: 'link-me@example.com',
        name: 'Link Me',
        slug: 'link-me',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: false,
      },
    });

    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => googlePayload({ email: 'link-me@example.com', sub: 'google-sub-link' }),
    });

    const res = await request(app.getHttpServer())
      .post('/api/auth/social/google')
      .send({ idToken: 'valid-token' })
      .expect(200);

    expect(res.body.user.id).toBe(existing.id);
    expect(await prisma.user.count({ where: { email: 'link-me@example.com' } })).toBe(1);

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: existing.id } });
    expect(updated.emailVerified).toBe(true); // Google certifica el email
    expect(updated.passwordHash).not.toBeNull(); // sigue pudiendo entrar con contraseña

    const account = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider: 'google', providerAccountId: 'google-sub-link' } },
    });
    expect(account?.userId).toBe(existing.id);
  });

  it('email_verified=false de Google sobre email de usuario existente → 403, no vincula', async () => {
    await prisma.user.create({
      data: {
        email: 'unverified-link@example.com',
        name: 'Unverified Link',
        slug: 'unverified-link',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });

    mockVerifyIdToken.mockResolvedValue({
      getPayload: () =>
        googlePayload({
          email: 'unverified-link@example.com',
          email_verified: false,
          sub: 'google-sub-unverified',
        }),
    });

    await request(app.getHttpServer())
      .post('/api/auth/social/google')
      .send({ idToken: 'valid-token' })
      .expect(403);

    const account = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider: 'google', providerAccountId: 'google-sub-unverified' } },
    });
    expect(account).toBeNull();
  });

  it('segundo login con Google (Account ya existe) → re-login, mismo User, no duplica', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => googlePayload({ sub: 'google-sub-relogin', email: 're-login@example.com' }),
    });

    const first = await request(app.getHttpServer())
      .post('/api/auth/social/google')
      .send({ idToken: 'valid-token' })
      .expect(200);

    const second = await request(app.getHttpServer())
      .post('/api/auth/social/google')
      .send({ idToken: 'valid-token' })
      .expect(200);

    expect(second.body.user.id).toBe(first.body.user.id);
    expect(await prisma.user.count({ where: { email: 're-login@example.com' } })).toBe(1);
  });

  it('login() con contraseña sobre usuario solo-Google (passwordHash null) → 401, no peta', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => googlePayload({ sub: 'google-sub-onlysocial', email: 'only-google@example.com' }),
    });

    await request(app.getHttpServer())
      .post('/api/auth/social/google')
      .send({ idToken: 'valid-token' })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'only-google@example.com', password: 'WhateverPassword1!' })
      .expect(401);
  });

  it('forgotPassword sobre usuario solo-Google → 200 { ok: true }, no revela ni envía email', async () => {
    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => googlePayload({ sub: 'google-sub-forgot', email: 'forgot-google@example.com' }),
    });

    await request(app.getHttpServer())
      .post('/api/auth/social/google')
      .send({ idToken: 'valid-token' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({ email: 'forgot-google@example.com' })
      .expect(200);

    expect(res.body).toEqual({ ok: true });
  });

  it('usuario BANNED con Google → 403, no recibe JWT', async () => {
    await prisma.user.create({
      data: {
        email: 'banned-social@example.com',
        name: 'Banned Social',
        slug: 'banned-social',
        passwordHash: null,
        emailVerified: true,
        status: 'BANNED',
      },
    });

    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => googlePayload({ sub: 'google-sub-banned', email: 'banned-social@example.com' }),
    });

    await request(app.getHttpServer())
      .post('/api/auth/social/google')
      .send({ idToken: 'valid-token' })
      .expect(403);
  });

  it('nunca se crean dos User con el mismo email (constraint + lógica de vinculación)', async () => {
    await prisma.user.create({
      data: {
        email: 'same-email@example.com',
        name: 'Original',
        slug: 'original',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });

    mockVerifyIdToken.mockResolvedValue({
      getPayload: () => googlePayload({ email: 'same-email@example.com', sub: 'google-sub-same-email' }),
    });

    await request(app.getHttpServer())
      .post('/api/auth/social/google')
      .send({ idToken: 'valid-token' })
      .expect(200);

    expect(await prisma.user.count({ where: { email: 'same-email@example.com' } })).toBe(1);
  });
});
