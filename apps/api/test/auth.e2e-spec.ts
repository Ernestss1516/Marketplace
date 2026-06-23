import { INestApplication } from '@nestjs/common';
import { PasswordResetToken, PrismaClient, VerificationToken } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let verificationToken: VerificationToken;
  let freshResetToken: PasswordResetToken;
  let usedResetToken: PasswordResetToken;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    // Verified user: used for login, forgot-password and GET /users/me tests.
    // Password stays 'Test1234!' throughout — reset-password tests use a separate user.
    await prisma.user.create({
      data: {
        email: 'verified@example.com',
        name: 'Verified User',
        slug: 'verified-user',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });

    // Unverified user: verify-email test consumes its token (and flips emailVerified),
    // so the login-unverified test creates its own separate account inline.
    const unverifiedUser = await prisma.user.create({
      data: {
        email: 'unverified@example.com',
        name: 'Unverified User',
        slug: 'unverified-user',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: false,
      },
    });

    // Dedicated user for reset-password tests; its password will be changed by the
    // valid-token test — that's fine because no other test logs in as this user.
    const resetPwUser = await prisma.user.create({
      data: {
        email: 'reset-pw@example.com',
        name: 'Reset PW User',
        slug: 'reset-pw-user',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });

    // Pre-existing account for the duplicate-registration test.
    // Seeded here so the test is independent of the register test running first.
    await prisma.user.create({
      data: {
        email: 'duplicate@example.com',
        name: 'Duplicate User',
        slug: 'duplicate-user',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: false,
      },
    });

    verificationToken = await prisma.verificationToken.create({
      data: {
        userId: unverifiedUser.id,
        token: 'valid-verify-token-abc123xyz',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      },
    });

    freshResetToken = await prisma.passwordResetToken.create({
      data: {
        userId: resetPwUser.id,
        token: 'fresh-reset-token-abc123xyz',
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    // Already-consumed token to verify the "already used" guard.
    usedResetToken = await prisma.passwordResetToken.create({
      data: {
        userId: resetPwUser.id,
        token: 'used-reset-token-abc123xyz',
        expiresAt: new Date(Date.now() + 3_600_000),
        usedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── register ───────────────────────────────────────────────────────────────

  it('POST /api/auth/register → 201 y usuario persistido en DB', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'New User', email: 'newuser@example.com', password: 'Test1234!' })
      .expect(201);

    expect(res.body).toMatchObject({ email: 'newuser@example.com', emailVerified: false });

    const inDb = await prisma.user.findUnique({ where: { email: 'newuser@example.com' } });
    expect(inDb).not.toBeNull();
  });

  it('POST /api/auth/register (email duplicado) → 409', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ name: 'Duplicate', email: 'duplicate@example.com', password: 'Test1234!' })
      .expect(409);
  });

  // ── verify-email ───────────────────────────────────────────────────────────

  it('POST /api/auth/verify-email (token válido) → verified:true y emailVerified:true en JWT', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ token: verificationToken.token })
      .expect(200);

    expect(res.body).toMatchObject({ verified: true });
    expect(res.body.accessToken).toBeDefined();

    // Decode the JWT payload (base64url, middle segment) without an extra import.
    const [, payloadB64] = (res.body.accessToken as string).split('.');
    const decoded = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString(),
    ) as { emailVerified: boolean };
    expect(decoded.emailVerified).toBe(true);
  });

  it('POST /api/auth/verify-email (token inválido) → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/verify-email')
      .send({ token: 'completely-invalid-token-does-not-exist' })
      .expect(400);
  });

  // ── login ──────────────────────────────────────────────────────────────────

  it('POST /api/auth/login (verificado) → 200 y emailVerified:true', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'verified@example.com', password: 'Test1234!' })
      .expect(200);

    expect(res.body).toMatchObject({
      accessToken: expect.any(String),
      user: { email: 'verified@example.com', emailVerified: true },
    });
  });

  it('POST /api/auth/login (no verificado) → 200 y emailVerified:false', async () => {
    // unverified@example.com was verified by the verify-email test above;
    // create a fresh unverified account so this test is independent.
    await prisma.user.create({
      data: {
        email: 'still-unverified@example.com',
        name: 'Still Unverified',
        slug: 'still-unverified',
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: false,
      },
    });

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'still-unverified@example.com', password: 'Test1234!' })
      .expect(200);

    expect(res.body.user.emailVerified).toBe(false);
  });

  it('POST /api/auth/login (contraseña errónea) → 401', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'verified@example.com', password: 'WrongPassword!' })
      .expect(401);
  });

  // ── forgot-password ────────────────────────────────────────────────────────

  it('POST /api/auth/forgot-password → siempre 200, incluso con email inexistente', async () => {
    const r1 = await request(app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({ email: 'verified@example.com' })
      .expect(200);
    expect(r1.body).toEqual({ ok: true });

    const r2 = await request(app.getHttpServer())
      .post('/api/auth/forgot-password')
      .send({ email: 'no-existe-nunca@example.com' })
      .expect(200);
    expect(r2.body).toEqual({ ok: true });
  });

  // ── reset-password ─────────────────────────────────────────────────────────

  it('POST /api/auth/reset-password (token válido) → 200 y token marcado usedAt', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ token: freshResetToken.token, newPassword: 'NewPassword1234!' })
      .expect(200);

    expect(res.body).toEqual({ ok: true });

    const record = await prisma.passwordResetToken.findUnique({
      where: { id: freshResetToken.id },
    });
    expect(record?.usedAt).not.toBeNull();
  });

  it('POST /api/auth/reset-password (token ya usado) → 400', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/reset-password')
      .send({ token: usedResetToken.token, newPassword: 'AnotherPassword1234!' })
      .expect(400);
  });

  // ── users/me ───────────────────────────────────────────────────────────────

  it('GET /api/users/me sin token → 401', async () => {
    await request(app.getHttpServer()).get('/api/users/me').expect(401);
  });

  it('GET /api/users/me con token válido → 200 y perfil del usuario autenticado', async () => {
    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'verified@example.com', password: 'Test1234!' });

    const res = await request(app.getHttpServer())
      .get('/api/users/me')
      .set('Authorization', `Bearer ${loginRes.body.accessToken as string}`)
      .expect(200);

    expect(res.body).toMatchObject({ email: 'verified@example.com' });
  });
});
