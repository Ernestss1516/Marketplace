// COOKIES RÁFAGA 1 — EL REGISTRO DEL CONSENTIMIENTO (la prueba del art. 7.1 RGPD).
//
// Ver docs/diseno-consentimiento-cookies.md §2.
//
// Lo que se cubre, y por qué cada cosa:
//   · el endpoint es PÚBLICO (el consentimiento se da antes de iniciar sesión: es el
//     caso normal, no la excepción) pero ANOTA al usuario si lo hay;
//   · la fila guarda lo que tiene que guardar — y NO guarda la IP en claro ni el
//     user-agent (D-nueva-5);
//   · D7: borrar la cuenta ANONIMIZA la prueba en vez de destruirla. Es la barrera de
//     verdad de esta ráfaga en el backend, y se comprueba borrando un usuario de verdad;
//   · el DTO rechaza categorías inventadas: la tabla de la prueba no puede contener una
//     categoría que el producto no ofrece.

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

describe('Consentimiento de cookies (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let userToken: string;
  let userId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const passwordHash = await bcrypt.hash('Test1234!', 4);
    const user = await prisma.user.create({
      data: {
        email: 'consent-user@example.com',
        name: 'Consent User',
        slug: 'consent-user',
        passwordHash,
        emailVerified: true,
      },
    });
    userId = user.id;

    const res = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'consent-user@example.com', password: 'Test1234!' });
    userToken = res.body.accessToken as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('POST /consent — anónimo', () => {
    it('registra la decisión sin sesión y devuelve el id con el que probarla', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/consent')
        .send({ action: 'GRANTED', categories: ['terceros'], policyVersion: '1' })
        .expect(201);

      expect(res.body.id).toEqual(expect.any(String));

      const fila = await prisma.consentRecord.findUniqueOrThrow({
        where: { id: res.body.id as string },
      });
      expect(fila.action).toBe('GRANTED');
      expect(fila.categories).toEqual(['terceros']);
      expect(fila.policyVersion).toBe('1');
      // Anónimo: es el caso NORMAL. El consentimiento se da en la primera visita.
      expect(fila.userId).toBeNull();
    });

    it('un RECHAZO también se registra — es una decisión, no una ausencia', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/consent')
        .send({ action: 'REJECTED', categories: [], policyVersion: '1' })
        .expect(201);

      const fila = await prisma.consentRecord.findUniqueOrThrow({
        where: { id: res.body.id as string },
      });
      expect(fila.action).toBe('REJECTED');
      expect(fila.categories).toEqual([]);
      // Sin esta fila no habría forma de demostrar que se respetó un «no».
    });

    it('NO guarda la IP en claro: sólo su hash (64 hex), y no hay campo de user-agent', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/consent')
        .set('User-Agent', 'Mozilla/5.0 (huella que no debe guardarse)')
        .send({ action: 'GRANTED', categories: ['terceros'], policyVersion: '1' })
        .expect(201);

      const fila = await prisma.consentRecord.findUniqueOrThrow({
        where: { id: res.body.id as string },
      });

      expect(fila.ipHash).toMatch(/^[0-9a-f]{64}$/);
      // La IP de origen, entera, no puede aparecer en ningún sitio de la fila.
      expect(JSON.stringify(fila)).not.toContain('127.0.0.1');
      expect(JSON.stringify(fila)).not.toContain('::ffff:');
      // D-nueva-5: el user-agent no se guarda. Aporta poco a la prueba y es material de
      // huella; si la asesoría lo pidiera, se añade entonces — no «por si acaso».
      expect(JSON.stringify(fila)).not.toContain('Mozilla');
      expect(fila).not.toHaveProperty('userAgent');
    });
  });

  describe('POST /consent — con sesión', () => {
    it('ata la decisión al usuario', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/consent')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ action: 'GRANTED', categories: ['terceros'], policyVersion: '1' })
        .expect(201);

      const fila = await prisma.consentRecord.findUniqueOrThrow({
        where: { id: res.body.id as string },
      });
      expect(fila.userId).toBe(userId);
    });

    it('cada decisión es una fila NUEVA — el historial es la prueba', async () => {
      const antes = await prisma.consentRecord.count({ where: { userId } });

      await request(app.getHttpServer())
        .post('/api/consent')
        .set('Authorization', `Bearer ${userToken}`)
        .send({ action: 'WITHDRAWN', categories: [], policyVersion: '1' })
        .expect(201);

      // Un `upsert` que machacara la fila anterior destruiría justo lo que hay que
      // demostrar: que en tal fecha, con tal texto delante, esta persona dijo que sí —
      // y que más tarde se retractó.
      expect(await prisma.consentRecord.count({ where: { userId } })).toBe(antes + 1);
    });
  });

  describe('validación — la tabla de la prueba no admite basura', () => {
    it('rechaza una categoría que no existe en este producto', async () => {
      // «marketing» no existe: no hay un solo tercero publicitario. Aceptarla dejaría en
      // la prueba una categoría que el banner nunca ofreció.
      await request(app.getHttpServer())
        .post('/api/consent')
        .send({ action: 'GRANTED', categories: ['marketing'], policyVersion: '1' })
        .expect(400);
    });

    it('rechaza una acción desconocida', async () => {
      await request(app.getHttpServer())
        .post('/api/consent')
        .send({ action: 'MAYBE', categories: [], policyVersion: '1' })
        .expect(400);
    });

    it('rechaza una decisión sin versión de texto', async () => {
      // Un consentimiento que no dice a QUÉ versión se dio no sirve como prueba.
      await request(app.getHttpServer())
        .post('/api/consent')
        .send({ action: 'GRANTED', categories: ['terceros'] })
        .expect(400);
    });
  });

  describe('D7 — borrar la cuenta ANONIMIZA la prueba, no la destruye', () => {
    it('la fila sobrevive con userId a null cuando el usuario desaparece', async () => {
      const efimero = await prisma.user.create({
        data: {
          email: 'consent-efimero@example.com',
          name: 'Efímero',
          slug: 'consent-efimero',
          emailVerified: true,
        },
      });

      const fila = await prisma.consentRecord.create({
        data: {
          action: 'GRANTED',
          categories: ['terceros'],
          policyVersion: '1',
          userId: efimero.id,
        },
      });

      await prisma.user.delete({ where: { id: efimero.id } });

      // LA BARRERA DE D7: `onDelete: SetNull` hace que esto funcione SOLO, sin que
      // ningún código de borrado tenga que acordarse de esta tabla — algo que importa
      // porque hoy no existe ninguna vía que borre un User
      // (docs/auditoria-borrado-cuentas.md §0.1). Con `Cascade` la prueba se habría
      // destruido justo cuando más falta puede hacer: al irse la persona que podría
      // reclamar.
      const superviviente = await prisma.consentRecord.findUnique({ where: { id: fila.id } });
      expect(superviviente).not.toBeNull();
      expect(superviviente!.userId).toBeNull();
      expect(superviviente!.action).toBe('GRANTED');
      expect(superviviente!.categories).toEqual(['terceros']);
      expect(superviviente!.policyVersion).toBe('1');
    });
  });
});
