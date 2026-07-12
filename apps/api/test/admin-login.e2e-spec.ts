/**
 * AUTH — /admin/login separada (e2e)
 *
 * Decisiones: (1) los ADMIN SOLO pueden entrar por POST /auth/admin-login —
 * el público POST /auth/login los rechaza; (2) el rechazo en AMBOS sentidos
 * ocurre SIEMPRE después de validar la contraseña, nunca antes — de lo
 * contrario cualquiera de los dos endpoints sería un oráculo de enumeración
 * (probar emails sin acertar la contraseña y ver cuál responde "eres/no eres
 * admin"). La no-enumerabilidad existente de /auth/login (mismo 401 para
 * email inexistente, cuenta solo-Google y contraseña mala) debe seguir
 * intacta — este archivo la re-verifica explícitamente, no solo asume que
 * seguirá cierta tras el refactor.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { RedisService } from 'src/infra/redis/redis.service';
import { ADMIN_LOGIN_RATE_LIMIT_IP_PER_WINDOW } from 'src/modules/auth/auth.constants';

let ipCounter = 0;
/** Rango de IP propio (distinto del resto de specs de auth) para no compartir
 * contadores de rate-limit con auth-security.e2e-spec.ts. */
function freshIp(): string {
  ipCounter += 1;
  return `172.17.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

describe('AUTH — /admin/login separada (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let redis: RedisService;

  const hash = (pw: string) => bcrypt.hash(pw, 4);

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    redis = app.get(RedisService);
    await cleanDb(prisma);

    const staleKeys = await redis.client.keys('auth:*');
    if (staleKeys.length > 0) await redis.client.del(...staleKeys);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // ── /auth/login rechaza a ADMIN (después de validar la contraseña) ───────

  describe('POST /api/auth/login — rechaza ADMIN', () => {
    it('ADMIN con contraseña CORRECTA → 403 ADMIN_MUST_USE_ADMIN_LOGIN, no emite token', async () => {
      await prisma.user.create({
        data: {
          email: 'admin-public-login@example.com',
          name: 'Admin Public',
          slug: 'admin-public-login',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'ADMIN',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ email: 'admin-public-login@example.com', password: 'Test1234!' });

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/\/admin\/login/);
      expect(res.body.code).toBe('ADMIN_MUST_USE_ADMIN_LOGIN');
      expect(res.body.accessToken).toBeUndefined();
    });

    it('ADMIN con contraseña INCORRECTA → mismo 401 genérico que cualquier otro fallo — NO revela que es admin', async () => {
      const wrongPwRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ email: 'admin-public-login@example.com', password: 'WrongPassword!' });

      const nonexistentRes = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ email: 'never-existed-admin-check@example.com', password: 'WrongPassword!' });

      expect(wrongPwRes.status).toBe(401);
      expect(nonexistentRes.status).toBe(401);
      // Misma forma de respuesta exacta — un atacante no puede distinguir
      // "email de admin, contraseña mala" de "email que no existe".
      expect(wrongPwRes.body.message).toBe(nonexistentRes.body.message);
      expect(Object.keys(wrongPwRes.body).sort()).toEqual(Object.keys(nonexistentRes.body).sort());
    });

    it('USER normal con contraseña correcta → 200, sin cambios (no afectado por el rechazo de ADMIN)', async () => {
      await prisma.user.create({
        data: {
          email: 'plain-user-login@example.com',
          name: 'Plain User',
          slug: 'plain-user-login',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .set('X-Forwarded-For', freshIp())
        .send({ email: 'plain-user-login@example.com', password: 'Test1234!' });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user.role).toBe('USER');
    });
  });

  // ── /auth/admin-login: solo ADMIN, mismo cuidado de no filtrar ───────────

  describe('POST /api/auth/admin-login', () => {
    it('ADMIN con contraseña correcta → 200, accessToken funcional contra un endpoint ADMIN-only', async () => {
      const admin = await prisma.user.create({
        data: {
          email: 'admin-real-login@example.com',
          name: 'Admin Real',
          slug: 'admin-real-login',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'ADMIN',
        },
      });

      const res = await request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .set('X-Forwarded-For', freshIp())
        .send({ email: admin.email, password: 'Test1234!' });

      expect(res.status).toBe(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.user).toMatchObject({ email: admin.email, role: 'ADMIN' });

      // El token no es de "alcance reducido" — funciona igual que el de /auth/login
      // contra un endpoint real ADMIN-only.
      await request(app.getHttpServer())
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
    });

    it('usuario NO-admin con contraseña correcta → 403 ADMIN_LOGIN_NOT_ADMIN, tras validar la contraseña (no antes)', async () => {
      await prisma.user.create({
        data: {
          email: 'not-admin-tries@example.com',
          name: 'Not Admin',
          slug: 'not-admin-tries',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'USER',
        },
      });

      // Contraseña mala primero → debe dar el 401 genérico, NUNCA el 403 de
      // "no eres admin" (eso filtraría antes de probar la contraseña).
      const wrongPw = await request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .set('X-Forwarded-For', freshIp())
        .send({ email: 'not-admin-tries@example.com', password: 'WrongPassword!' });
      expect(wrongPw.status).toBe(401);

      const correctPw = await request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .set('X-Forwarded-For', freshIp())
        .send({ email: 'not-admin-tries@example.com', password: 'Test1234!' });
      expect(correctPw.status).toBe(403);
      expect(correctPw.body.code).toBe('ADMIN_LOGIN_NOT_ADMIN');
      expect(correctPw.body.accessToken).toBeUndefined();
    });

    it('rate limit por IP más estricto que el público: bloquea antes de llegar a 150', async () => {
      const ip = freshIp();
      for (let i = 0; i < ADMIN_LOGIN_RATE_LIMIT_IP_PER_WINDOW; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/auth/admin-login')
          .set('X-Forwarded-For', ip)
          .send({ email: `adminlimit-${i}@example.com`, password: 'whatever' });
        expect(res.status).toBe(401);
      }
      const res = await request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .set('X-Forwarded-For', ip)
        .send({ email: 'adminlimit-overflow@example.com', password: 'whatever' });
      expect(res.status).toBe(429);
    });

    it('el lockout por cuenta se aplica igual vía admin-login: 5 fallos bloquean, y ni siquiera la contraseña correcta pasa mientras está bloqueada', async () => {
      const admin = await prisma.user.create({
        data: {
          email: 'admin-lockout@example.com',
          name: 'Admin Lockout',
          slug: 'admin-lockout',
          passwordHash: await hash('Test1234!'),
          emailVerified: true,
          role: 'ADMIN',
        },
      });

      for (let i = 0; i < 5; i++) {
        const res = await request(app.getHttpServer())
          .post('/api/auth/admin-login')
          .set('X-Forwarded-For', freshIp())
          .send({ email: admin.email, password: 'WrongPassword!' });
        expect(res.status).toBe(401);
      }

      const lockedButCorrect = await request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .set('X-Forwarded-For', freshIp())
        .send({ email: admin.email, password: 'Test1234!' });
      expect(lockedButCorrect.status).toBe(401);

      const updated = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
      expect(updated.lockedUntil).not.toBeNull();
    });
  });
});
