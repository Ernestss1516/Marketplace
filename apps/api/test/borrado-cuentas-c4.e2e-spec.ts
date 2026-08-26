import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { SuspensionExpirationService } from 'src/modules/expiration/suspension-expiration.service';
import { DEFAULT_SUSPENSION_DAYS_SETTING } from 'src/modules/users/suspension.constants';

/**
 * BORRADO DE CUENTAS — C4: LA CADUCIDAD DE `SUSPENDED`.
 *
 * Hasta aquí, «suspender» mentía: era un ban con otro mensaje y otra autoridad.
 * C4 le da el plazo que su nombre promete, con DOS mecanismos:
 *
 *   · **el perezoso**, en el gate compartido — en cuanto pasa la fecha, la cuenta
 *     entra **sin que el cron haya corrido**. Es el que manda.
 *   · **el cron de las 07:00**, que sólo pone la fila al día para que la ficha no
 *     diga «Suspendido» de alguien que ya entra.
 */
describe('Borrado de cuentas C4 — la suspensión caduca (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let cron: SuspensionExpirationService;
  let hash: string;

  const PASSWORD = 'Test1234!';
  const AYER = () => new Date(Date.now() - 24 * 60 * 60 * 1000);
  const MANANA = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    cron = app.get(SuspensionExpirationService);
    hash = await bcrypt.hash(PASSWORD, 4);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  let n = 0;
  async function crearUsuario(
    marca: string,
    status: UserStatus = 'ACTIVE',
    suspendedUntil: Date | null = null,
  ) {
    n += 1;
    return prisma.user.create({
      data: {
        email: `c4-${marca}-${n}@example.com`,
        name: `C4 ${marca}`,
        slug: `c4-${marca}-${n}`,
        passwordHash: hash,
        emailVerified: true,
        status,
        suspendedUntil,
      },
    });
  }

  const login = (email: string) =>
    request(app.getHttpServer()).post('/api/auth/login').send({ email, password: PASSWORD });

  // ═══════════════════════════════════════════════════════════════════════════
  //  BARRERA 1 — el gate perezoso, SIN cron
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Barrera 1 — el gate deja entrar en cuanto pasa la fecha, sin cron', () => {
    /**
     * LA BARRERA DEL CUERPO. El cron NO ha corrido en ninguno de estos tests: la
     * fila sigue diciendo `SUSPENDED` en la base. Lo que decide es el predicado,
     * evaluado en el momento de la petición — molde `lockedUntil`.
     */
    it('un SUSPENDED con la fecha PASADA entra, y la fila sigue diciendo SUSPENDED', async () => {
      const user = await crearUsuario('cumplida', 'SUSPENDED', AYER());

      await login(user.email).expect(200);

      // Nadie ha tocado la fila: el gate no escribe, sólo evalúa.
      const enBase = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(enBase.status).toBe(UserStatus.SUSPENDED);
      expect(enBase.suspendedUntil).not.toBeNull();
    });

    it('un SUSPENDED con la fecha FUTURA sigue fuera (403)', async () => {
      const user = await crearUsuario('vigente', 'SUSPENDED', MANANA());
      await login(user.email).expect(403);
    });

    it('un SUSPENDED SIN fecha sigue fuera: null = indefinida', async () => {
      const user = await crearUsuario('indefinida', 'SUSPENDED', null);
      await login(user.email).expect(403);
    });

    it('el gate perezoso vale también para el guard de cada petición, no sólo para el login', async () => {
      const user = await crearUsuario('guard', 'SUSPENDED', AYER());

      const res = await login(user.email).expect(200);
      await request(app.getHttpServer())
        .get('/api/users/me')
        .set('Authorization', `Bearer ${res.body.accessToken as string}`)
        .expect(200);
    });

    /**
     * El otro lado del mismo predicado: `forgotPassword` no le escribe a una
     * cuenta bloqueada (D-18, C1), pero SÍ a una cuya suspensión ya se cumplió.
     */
    it('forgotPassword vuelve a enviar en cuanto la suspensión se cumple', async () => {
      const vigente = await crearUsuario('forgot-vigente', 'SUSPENDED', MANANA());
      const cumplida = await crearUsuario('forgot-cumplida', 'SUSPENDED', AYER());

      for (const [u, ip] of [
        [vigente, '10.40.0.1'],
        [cumplida, '10.40.0.2'],
      ] as const) {
        await request(app.getHttpServer())
          .post('/api/auth/forgot-password')
          .set('X-Forwarded-For', ip)
          .send({ email: u.email })
          .expect(200);
      }

      expect(await prisma.passwordResetToken.count({ where: { userId: vigente.id } })).toBe(0);
      expect(await prisma.passwordResetToken.count({ where: { userId: cumplida.id } })).toBe(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  BARRERA 2 — el cron materializa
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Barrera 2 — el cron pone la fila al día, lo audita, y es idempotente', () => {
    it('pasa a ACTIVE las cumplidas, limpia la fecha y deja constancia', async () => {
      const user = await crearUsuario('cron', 'SUSPENDED', AYER());

      expect(await cron.runExpirationSweep()).toBeGreaterThanOrEqual(1);

      const tras = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(tras.status).toBe(UserStatus.ACTIVE);
      expect(tras.suspendedUntil).toBeNull();

      const log = await prisma.auditLog.findFirst({
        where: { resourceType: 'User', resourceId: user.id, action: 'USER_SUSPENSION_EXPIRED' },
      });
      expect(log).not.toBeNull();
      // El nombre de la acción es lo que impide que el historial atribuya a una
      // persona algo que hizo el reloj.
      expect(log?.after).toMatchObject({ status: 'ACTIVE', automatico: true });
    });

    it('una segunda pasada no encuentra nada: idempotente', async () => {
      await crearUsuario('idem', 'SUSPENDED', AYER());

      const primera = await cron.runExpirationSweep();
      expect(primera).toBeGreaterThanOrEqual(1);
      expect(await cron.runExpirationSweep()).toBe(0);
    });

    it('NO toca las vigentes ni las indefinidas', async () => {
      const vigente = await crearUsuario('cron-vigente', 'SUSPENDED', MANANA());
      const indefinida = await crearUsuario('cron-indefinida', 'SUSPENDED', null);

      await cron.runExpirationSweep();

      expect((await prisma.user.findUniqueOrThrow({ where: { id: vigente.id } })).status).toBe(
        UserStatus.SUSPENDED,
      );
      // LA COMPATIBILIDAD: una suspensión sin fecha es de antes de C4 y sigue
      // siendo indefinida. Si el cron la tocara, convertiría en activas todas las
      // suspensiones que existían.
      expect((await prisma.user.findUniqueOrThrow({ where: { id: indefinida.id } })).status).toBe(
        UserStatus.SUSPENDED,
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  BARRERA 3 — no toca el archivado
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * C2 conserva `suspendedUntil` al archivar A PROPÓSITO: si lo limpiara,
   * desarchivar a un suspendido le devolvería una suspensión INDEFINIDA en vez de
   * la que tenía. Eso deja filas ARCHIVED con una fecha guardada, y ni el gate ni
   * el cron pueden confundirlas con suspensiones vivas.
   */
  describe('Barrera 3 — un ARCHIVED con fecha guardada no se ve afectado', () => {
    it('ni entra por el gate ni lo despierta el cron', async () => {
      const user = await crearUsuario('archivado-con-fecha', 'ARCHIVED', AYER());
      // Como lo dejaría C2 al archivar a alguien que estaba suspendido.
      await prisma.user.update({
        where: { id: user.id },
        data: { statusBeforeArchive: UserStatus.SUSPENDED, archivedAt: new Date() },
      });

      // El gate: sigue siendo ARCHIVED, la fecha no le aplica.
      await login(user.email).expect(403);

      // El cron: no lo mira, porque filtra por `status: SUSPENDED`.
      await cron.runExpirationSweep();
      const tras = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(tras.status).toBe(UserStatus.ARCHIVED);
      expect(tras.suspendedUntil).not.toBeNull();
      expect(tras.statusBeforeArchive).toBe(UserStatus.SUSPENDED);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  El DTO y el ajuste
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Suspender con plazo: el DTO y el ajuste por defecto', () => {
    async function crearModerador() {
      n += 1;
      const email = `c4-mod-${n}@example.com`;
      await prisma.user.create({
        data: {
          email,
          name: 'C4 Mod',
          slug: `c4-mod-${n}`,
          passwordHash: hash,
          emailVerified: true,
          role: 'MODERATOR',
        },
      });
      const res = await login(email).expect(200);
      return res.body.accessToken as string;
    }

    it('con `days`, la suspensión termina en esa fecha', async () => {
      const modToken = await crearModerador();
      const user = await crearUsuario('con-dias');

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${user.id}/suspend`)
        .set('Authorization', `Bearer ${modToken}`)
        .send({ days: 7 })
        .expect(200);

      const tras = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(tras.status).toBe(UserStatus.SUSPENDED);
      expect(tras.suspendedUntil).not.toBeNull();
      const dias = (tras.suspendedUntil!.getTime() - Date.now()) / (24 * 3_600_000);
      expect(dias).toBeGreaterThan(6.9);
      expect(dias).toBeLessThan(7.1);
    });

    /**
     * LA COMPATIBILIDAD, en su forma más concreta: el frontend actual llama sin
     * cuerpo, y el ajuste nace sin sembrar. C4 no cambia lo que hace hoy el botón
     * «Suspender».
     */
    it('sin `days` y sin ajuste configurado, la suspensión es INDEFINIDA (como antes de C4)', async () => {
      const modToken = await crearModerador();
      const user = await crearUsuario('sin-dias');

      expect(
        await prisma.setting.findUnique({ where: { key: DEFAULT_SUSPENSION_DAYS_SETTING } }),
      ).toBeNull();

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${user.id}/suspend`)
        .set('Authorization', `Bearer ${modToken}`)
        .send({})
        .expect(200);

      const tras = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(tras.status).toBe(UserStatus.SUSPENDED);
      expect(tras.suspendedUntil).toBeNull();
    });

    it('con el ajuste configurado, una suspensión sin `days` lo usa', async () => {
      const modToken = await crearModerador();
      const user = await crearUsuario('con-ajuste');

      await prisma.setting.create({
        data: { key: DEFAULT_SUSPENSION_DAYS_SETTING, value: 3 },
      });
      try {
        await request(app.getHttpServer())
          .patch(`/api/admin/users/${user.id}/suspend`)
          .set('Authorization', `Bearer ${modToken}`)
          .send({})
          .expect(200);

        const tras = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
        const dias = (tras.suspendedUntil!.getTime() - Date.now()) / (24 * 3_600_000);
        expect(dias).toBeGreaterThan(2.9);
        expect(dias).toBeLessThan(3.1);
      } finally {
        await prisma.setting.delete({ where: { key: DEFAULT_SUSPENSION_DAYS_SETTING } });
      }
    });

    it('salir de SUSPENDED limpia la fecha (§4.2)', async () => {
      const modToken = await crearModerador();
      const user = await crearUsuario('limpia');

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${user.id}/suspend`)
        .set('Authorization', `Bearer ${modToken}`)
        .send({ days: 30 })
        .expect(200);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).suspendedUntil,
      ).not.toBeNull();

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${user.id}/unsuspend`)
        .set('Authorization', `Bearer ${modToken}`)
        .expect(200);

      // Una cuenta ACTIVE con un vencimiento colgando no significa nada — y al
      // volver a suspenderla arrastraría el plazo viejo.
      const tras = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
      expect(tras.status).toBe(UserStatus.ACTIVE);
      expect(tras.suspendedUntil).toBeNull();
    });

    it('rechaza duraciones absurdas (0 días, o más de un año)', async () => {
      const modToken = await crearModerador();
      const user = await crearUsuario('absurdo');

      for (const days of [0, 400]) {
        await request(app.getHttpServer())
          .patch(`/api/admin/users/${user.id}/suspend`)
          .set('Authorization', `Bearer ${modToken}`)
          .send({ days })
          .expect(400);
      }
    });
  });
});
