/**
 * RÁFAGA 3 — Paquete de seguridad de auth (e2e)
 *
 * Cubre lo que la auditoría (RC.2) encontró desprotegido: rate limiting en
 * login/register/forgot-password (por IP y por email), lockout tras N fallos
 * (sin romper la no-enumerabilidad de login), invalidación de sesiones al
 * resetear/cambiar/fijar contraseña (tokenVersion), lectura fresca del rol en
 * cada request (cierra la deuda de "rol stale"), change-password, set-password
 * (cierra "solo-Google sin contraseña"), y el bloqueo de ADMIN vía Google
 * (ese último caso vive en social-auth.e2e-spec.ts, que ya monta el mock de
 * google-auth-library).
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { RedisService } from 'src/infra/redis/redis.service';
import { AuthService } from 'src/modules/auth/auth.service';
import {
  LOGIN_RATE_LIMIT_IP_PER_WINDOW,
  REGISTER_RATE_LIMIT_IP_PER_HOUR,
  FORGOT_PASSWORD_RATE_LIMIT_IP_PER_HOUR,
  FORGOT_PASSWORD_RATE_LIMIT_EMAIL_PER_HOUR,
  CHANGE_PASSWORD_RATE_LIMIT_PER_HOUR,
  LOCKOUT_THRESHOLD,
} from 'src/modules/auth/auth.constants';

let ipCounter = 0;
/** IP única por llamada — evita que los rate limits de auth (por IP) contaminen
 * otros tests del mismo archivo (mismo patrón que rc1-contact.e2e-spec.ts). */
function freshIp(): string {
  ipCounter += 1;
  return `172.16.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

async function loginRaw(app: INestApplication, email: string, password: string, ip = freshIp()) {
  return request(app.getHttpServer())
    .post('/api/auth/login')
    .set('X-Forwarded-For', ip)
    .send({ email, password });
}

describe('RÁFAGA 3 — Auth security (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: RedisService;
  let authService: AuthService;

  const hash = (pw: string) => bcrypt.hash(pw, 4);

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    redis = app.get(RedisService);
    authService = app.get(AuthService);
    await cleanDb(prisma);

    // Mismo principio que rc1-contact: no heredar contadores de una pasada
    // local anterior dentro de la misma ventana horaria.
    const staleKeys = await redis.client.keys('auth:*');
    if (staleKeys.length > 0) await redis.client.del(...staleKeys);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── Rate limit: login ─────────────────────────────────────────────────────

  describe('Rate limit — login', () => {
    it(`${LOGIN_RATE_LIMIT_IP_PER_WINDOW} intentos por IP permitidos (con emails distintos), el siguiente devuelve 429`, async () => {
      const ip = freshIp();
      for (let i = 0; i < LOGIN_RATE_LIMIT_IP_PER_WINDOW; i++) {
        const res = await loginRaw(app, `iplimit-${i}@example.com`, 'whatever', ip);
        expect(res.status).toBe(401);
      }
      const res = await loginRaw(app, 'iplimit-overflow@example.com', 'whatever', ip);
      expect(res.status).toBe(429);
      expect(typeof res.body.retryAfter).toBe('number');
    });

    // No hay un límite de rate-limit aparte "por email" — la defensa contra
    // fuerza bruta sobre UNA cuenta es el lockout (ver más abajo), que solo
    // cuenta FALLOS (nunca éxitos). Un límite separado que contara todos los
    // intentos bloqueaba logins legítimos repetidos de una misma cuenta
    // (varios dispositivos, o — como se descubrió corriendo la batería e2e de
    // Playwright completa — varios specs reutilizando las mismas cuentas
    // sembradas). Ver el comentario en auth.constants.ts.
  });

  // ── Rate limit: register ──────────────────────────────────────────────────

  describe('Rate limit — register', () => {
    it(`${REGISTER_RATE_LIMIT_IP_PER_HOUR} registros por IP permitidos, el siguiente devuelve 429`, async () => {
      const ip = freshIp();
      for (let i = 0; i < REGISTER_RATE_LIMIT_IP_PER_HOUR; i++) {
        await request(app.getHttpServer())
          .post('/api/auth/register')
          .set('X-Forwarded-For', ip)
          .send({ name: 'Spam', email: `regspam-${i}@example.com`, password: 'Test1234!' })
          .expect(201);
      }
      const res = await request(app.getHttpServer())
        .post('/api/auth/register')
        .set('X-Forwarded-For', ip)
        .send({ name: 'Spam', email: 'regspam-overflow@example.com', password: 'Test1234!' });
      expect(res.status).toBe(429);
    });
  });

  // ── Rate limit: forgot-password ───────────────────────────────────────────

  describe('Rate limit — forgot-password', () => {
    it(`${FORGOT_PASSWORD_RATE_LIMIT_IP_PER_HOUR} envíos por IP permitidos, el siguiente devuelve 429`, async () => {
      const ip = freshIp();
      for (let i = 0; i < FORGOT_PASSWORD_RATE_LIMIT_IP_PER_HOUR; i++) {
        await request(app.getHttpServer())
          .post('/api/auth/forgot-password')
          .set('X-Forwarded-For', ip)
          .send({ email: `forgotip-${i}@example.com` })
          .expect(200);
      }
      const res = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .set('X-Forwarded-For', ip)
        .send({ email: 'forgotip-overflow@example.com' });
      expect(res.status).toBe(429);
    });

    it(`${FORGOT_PASSWORD_RATE_LIMIT_EMAIL_PER_HOUR} envíos por EMAIL permitidos (IPs distintas), el siguiente devuelve 429`, async () => {
      const email = 'forgotemail-target@example.com';
      for (let i = 0; i < FORGOT_PASSWORD_RATE_LIMIT_EMAIL_PER_HOUR; i++) {
        await request(app.getHttpServer())
          .post('/api/auth/forgot-password')
          .set('X-Forwarded-For', freshIp())
          .send({ email })
          .expect(200);
      }
      const res = await request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        .set('X-Forwarded-For', freshIp())
        .send({ email });
      expect(res.status).toBe(429);
    });
  });

  // ── Lockout ────────────────────────────────────────────────────────────────

  describe('Lockout', () => {
    it(`${LOCKOUT_THRESHOLD} fallos consecutivos (IP distinta cada vez) → la cuenta queda bloqueada en BD`, async () => {
      const user = await prisma.user.create({
        data: {
          email: 'lockout-target@example.com',
          name: 'Lockout Target',
          slug: 'lockout-target',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
        },
      });

      for (let i = 0; i < LOCKOUT_THRESHOLD; i++) {
        const res = await loginRaw(app, user.email, 'WrongPassword!', freshIp());
        expect(res.status).toBe(401);
      }

      const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(updated.failedLoginAttempts).toBe(LOCKOUT_THRESHOLD);
      expect(updated.lockedUntil).not.toBeNull();
      expect(updated.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
    });

    it('cuenta bloqueada → login con la contraseña CORRECTA sigue devolviendo 401 (no revela que existe ni que está bloqueada)', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'locked-correct-pw@example.com',
          name: 'Locked Correct Pw',
          slug: 'locked-correct-pw',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          lockedUntil: new Date(Date.now() + 15 * 60_000),
          failedLoginAttempts: 5,
        },
      });

      const locked = await loginRaw(app, user.email, 'Test1234!', freshIp());
      expect(locked.status).toBe(401);

      const nonexistent = await loginRaw(app, 'never-existed-xyz@example.com', 'Test1234!', freshIp());
      expect(nonexistent.status).toBe(401);

      // Misma forma de respuesta para cuenta bloqueada y cuenta inexistente —
      // no-enumerable, igual que el resto de login().
      expect(locked.body.message).toBe(nonexistent.body.message);
    });

    it('login correcto resetea el contador de fallos', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'reset-counter@example.com',
          name: 'Reset Counter',
          slug: 'reset-counter',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
        },
      });

      await loginRaw(app, user.email, 'Wrong1!', freshIp());
      await loginRaw(app, user.email, 'Wrong2!', freshIp());

      const midway = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(midway.failedLoginAttempts).toBe(2);

      const ok = await loginRaw(app, user.email, 'Test1234!', freshIp());
      expect(ok.status).toBe(200);

      const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.failedLoginAttempts).toBe(0);
      expect(after.lockedUntil).toBeNull();
    });
  });

  // ── Invalidación de sesiones al resetear contraseña ──────────────────────

  describe('Invalidación de sesiones — reset-password', () => {
    it('un token válido antes del reset queda inválido (401) inmediatamente después — verificado con un token real', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'invalidate-me@example.com',
          name: 'Invalidate Me',
          slug: 'invalidate-me',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
        },
      });

      const loginRes = await loginRaw(app, user.email, 'Test1234!', freshIp());
      const tokenBeforeReset = loginRes.body.accessToken as string;

      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${tokenBeforeReset}`)
        .expect(200);

      const resetToken = await prisma.passwordResetToken.create({
        data: {
          userId: user.id,
          token: 'invalidate-me-reset-token',
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      });

      await request(app.getHttpServer())
        .post('/api/auth/reset-password')
        .send({ token: resetToken.token, newPassword: 'BrandNewPassword1!' })
        .expect(200);

      // El MISMO token, sin haber caducado, ahora debe ser rechazado —
      // tokenVersion en BD ya no coincide con el del token.
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${tokenBeforeReset}`)
        .expect(401);

      // La nueva contraseña sí funciona.
      const relogin = await loginRaw(app, user.email, 'BrandNewPassword1!', freshIp());
      expect(relogin.status).toBe(200);
    });
  });

  // ── Rol fresco (cierra la deuda de "rol stale hasta 7 días") ─────────────

  describe('Rol fresco', () => {
    it('cambiar el rol en BD tiene efecto en la SIGUIENTE request, sin esperar a que el token caduque ni re-loguear', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'fresh-role@example.com',
          name: 'Fresh Role',
          slug: 'fresh-role',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'USER',
        },
      });

      const loginRes = await loginRaw(app, user.email, 'Test1234!', freshIp());
      const token = loginRes.body.accessToken as string;

      await request(app.getHttpServer())
        .get('/api/moderation/reports')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      await prisma.user.update({ where: { id: user.id }, data: { role: 'MODERATOR' } });

      // Mismo token, sin re-login — el guard ahora ve MODERATOR.
      await request(app.getHttpServer())
        .get('/api/moderation/reports')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });
  });

  // ── Change password ───────────────────────────────────────────────────────

  describe('POST /api/auth/change-password', () => {
    it('requiere la contraseña actual: incorrecta → 401; correcta → 200, cierra otras sesiones y devuelve un token nuevo utilizable', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'change-pw@example.com',
          name: 'Change Pw',
          slug: 'change-pw',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
        },
      });

      const loginRes = await loginRaw(app, user.email, 'Test1234!', freshIp());
      const oldToken = loginRes.body.accessToken as string;

      await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${oldToken}`)
        .send({ currentPassword: 'WrongCurrent!', newPassword: 'NewPassword1!' })
        .expect(401);

      const changeRes = await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${oldToken}`)
        .send({ currentPassword: 'Test1234!', newPassword: 'NewPassword1!' })
        .expect(200);

      expect(changeRes.body.accessToken).toEqual(expect.any(String));
      const newToken = changeRes.body.accessToken as string;

      // El token viejo (usado en la propia llamada) queda invalidado.
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${oldToken}`)
        .expect(401);

      // El token nuevo, emitido por change-password, sí funciona.
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${newToken}`)
        .expect(200);

      // La contraseña realmente cambió en BD.
      const relogin = await loginRaw(app, user.email, 'NewPassword1!', freshIp());
      expect(relogin.status).toBe(200);
    });

    it('sobre una cuenta solo-Google (sin contraseña) → 400, sugiere /auth/set-password', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'only-google-change@example.com',
          name: 'Only Google',
          slug: 'only-google-change',
          passwordHash: null,
          emailVerified: true,
        },
      });
      const token = authService.signToken({
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        tokenVersion: user.tokenVersion,
      });

      const res = await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'whatever', newPassword: 'NewPassword1!' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/set-password/);
    });

    it(`rate limit: ${CHANGE_PASSWORD_RATE_LIMIT_PER_HOUR} intentos por hora permitidos, el siguiente devuelve 429`, async () => {
      const user = await prisma.user.create({
        data: {
          email: 'change-pw-ratelimit@example.com',
          name: 'Change Pw RL',
          slug: 'change-pw-ratelimit',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
        },
      });
      const loginRes = await loginRaw(app, user.email, 'Test1234!', freshIp());
      const token = loginRes.body.accessToken as string;

      for (let i = 0; i < CHANGE_PASSWORD_RATE_LIMIT_PER_HOUR; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/auth/change-password')
          .set('Authorization', `Bearer ${token}`)
          .send({ currentPassword: 'WrongOnPurpose!', newPassword: 'NewPassword1!' });
        expect(res.status).toBe(401);
      }
      const res = await request(app.getHttpServer())
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ currentPassword: 'WrongOnPurpose!', newPassword: 'NewPassword1!' });
      expect(res.status).toBe(429);
    });
  });

  // ── Set password (cierra "solo-Google sin contraseña") ───────────────────

  describe('POST /api/auth/set-password', () => {
    it('usuario solo-Google fija una contraseña SIN exigir la actual (no tiene) — cierra otras sesiones y permite login con contraseña después', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'set-pw@example.com',
          name: 'Set Pw',
          slug: 'set-pw',
          passwordHash: null,
          emailVerified: true,
        },
      });
      const oldToken = authService.signToken({
        id: user.id,
        email: user.email,
        role: user.role,
        emailVerified: user.emailVerified,
        tokenVersion: user.tokenVersion,
      });

      const setRes = await request(app.getHttpServer())
        .post('/api/auth/set-password')
        .set('Authorization', `Bearer ${oldToken}`)
        .send({ newPassword: 'BrandNewPassword1!' })
        .expect(200);

      const newToken = setRes.body.accessToken as string;

      // Token previo (Google) invalidado por el mismo mecanismo que change-password.
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${oldToken}`)
        .expect(401);

      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${newToken}`)
        .expect(200);

      // Ahora SÍ puede entrar con email+contraseña — cierra la deuda documentada.
      const loginRes = await loginRaw(app, user.email, 'BrandNewPassword1!', freshIp());
      expect(loginRes.status).toBe(200);
    });

    it('sobre una cuenta que YA tiene contraseña → 409', async () => {
      const user = await prisma.user.create({
        data: {
          email: 'already-has-pw@example.com',
          name: 'Already Has Pw',
          slug: 'already-has-pw',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
        },
      });
      const loginRes = await loginRaw(app, user.email, 'Test1234!', freshIp());
      const token = loginRes.body.accessToken as string;

      const res = await request(app.getHttpServer())
        .post('/api/auth/set-password')
        .set('Authorization', `Bearer ${token}`)
        .send({ newPassword: 'AnotherPassword1!' });

      expect(res.status).toBe(409);
    });
  });
});
