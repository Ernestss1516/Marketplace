import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient, Role, UserStatus } from '@prisma/client';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { AdminService } from 'src/modules/admin/admin.service';
import { AccountModerationNotificationsService } from 'src/modules/account-moderation-notifications/account-moderation-notifications.service';
import { SuspensionExpirationService } from 'src/modules/expiration/suspension-expiration.service';
import { NOTIFICATION_JOB } from 'src/infra/queue/notification.types';
import { motivoDeBloqueoDeCuenta } from 'src/modules/auth/account-access';

/**
 * NOTIFICACIONES N2 — LAS DECISIONES SOBRE LA CUENTA, CON SU MOTIVO.
 *
 * ── EL HUECO QUE CIERRA ─────────────────────────────────────────────────────
 *
 * Suspender, levantar, banear, reinstaurar, cambiar el rol, archivar por staff y
 * eliminar **no avisaban a nadie**, y el motivo **ni siquiera se capturaba**:
 * `SuspendUserDto` tenía un solo campo (`days`) y `banUser` no recibía cuerpo.
 * Era el hueco más grave del inventario (§A3.2, §A3.3).
 *
 * ── LO QUE ESTA SUITE FIJA ──────────────────────────────────────────────────
 *
 * Sobre todo LA FRONTERA: el motivo VISIBLE sale hacia el usuario, la NOTA INTERNA
 * se queda en el `AuditLog`. Confundirlos es filtrarle al sancionado la
 * conversación del equipo, y es el defecto que la separación existe para hacer
 * imposible.
 *
 * Y el canal: un sancionado **no puede entrar** —lo rechaza el gate de
 * `account-access.ts`—, así que el correo no es el auxiliar, es lo único que le
 * llega. Si no sale, se entera chocando contra el login.
 */
describe('Sanciones de cuenta — motivo, aviso y la frontera (N2) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let admin: AdminService;
  let expiracion: SuspensionExpirationService;
  let addSpy: jest.SpyInstance;

  let objetivo: string;
  let moderador: string;

  /** Cadena inconfundible: si aparece donde no debe, es que se ha filtrado. */
  const NOTA_INTERNA = 'NOTA-INTERNA-QUE-EL-USUARIO-NO-DEBE-VER-jkl012';
  const MOTIVO_VISIBLE = 'Publicaste anuncios duplicados';

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    admin = app.get(AdminService);
    expiracion = app.get(SuspensionExpirationService);

    // La cola QUE EL SERVICIO TIENE INYECTADA, no la del `app.get` global: varios
    // módulos registran la misma cola por nombre y cada registro crea su propia
    // instancia. Molde de `moderation-notifications.e2e-spec.ts`.
    const queue = (
      app.get(AccountModerationNotificationsService) as unknown as {
        queue: { add: (...a: unknown[]) => unknown };
      }
    ).queue;
    addSpy = jest.spyOn(queue, 'add').mockResolvedValue(undefined as never);
  });

  afterAll(async () => {
    addSpy.mockRestore();
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb(prisma);
    addSpy.mockClear();
    objetivo = (await crearUsuario('USER')).id;
    moderador = (await crearUsuario('ADMIN')).id;
  });

  async function crearUsuario(role: Role) {
    const id = randomUUID().slice(0, 8);
    return prisma.user.create({
      data: { email: `sn-${id}@test.local`, name: `Sn ${id}`, slug: `sn-${id}`, role },
    });
  }

  const avisos = (userId: string) =>
    prisma.notification.findMany({ where: { userId, type: 'ACCOUNT_MODERATED' } });

  const correos = () =>
    addSpy.mock.calls
      .filter((c) => c[0] === NOTIFICATION_JOB.SEND_ACCOUNT_MODERATED)
      .map((c) => c[1] as Record<string, unknown>);

  // ===========================================================================
  // BARRERA 1 — suspender y banear avisan, con el motivo
  // ===========================================================================

  describe('las sanciones dejan de ser mudas', () => {
    it('suspender → aviso in-app + correo, los dos con el motivo VISIBLE', async () => {
      await admin.suspendUser(objetivo, moderador, {
        days: 7,
        reason: MOTIVO_VISIBLE,
        internalNote: NOTA_INTERNA,
      });

      const [aviso] = await avisos(objetivo);
      expect(aviso).toBeDefined();
      const data = aviso.data as Record<string, unknown>;
      expect(data.action).toBe('SUSPENDED');
      expect(data.reason).toBe(MOTIVO_VISIBLE);
      expect(data.suspendedUntil).not.toBeNull();

      const [correo] = correos();
      expect(correo).toBeDefined();
      expect(correo.action).toBe('SUSPENDED');
      expect(correo.reason).toBe(MOTIVO_VISIBLE);
    });

    /**
     * BARRERA 3 — EL CORREO DEL BANEADO SALE.
     *
     * Un `BANNED` no puede abrir la campana: el gate lo rechaza en las tres
     * puertas. Sin este correo, la sanción permanente le llega en forma de una
     * pantalla de login que no se abre.
     */
    it('banear → el CORREO sale (es el único canal que le alcanza)', async () => {
      await admin.banUser(objetivo, moderador, {
        reason: MOTIVO_VISIBLE,
        internalNote: NOTA_INTERNA,
      });

      const [correo] = correos();
      expect(correo).toBeDefined();
      expect(correo.action).toBe('BANNED');
      expect(correo.reason).toBe(MOTIVO_VISIBLE);

      // Y la campana queda como constancia para si algún día se reinstaura.
      const [aviso] = await avisos(objetivo);
      expect((aviso.data as Record<string, unknown>).action).toBe('BANNED');
    });

    it('el motivo se PERSISTE en la cuenta, que es donde lo lee el gate', async () => {
      await admin.banUser(objetivo, moderador, { reason: MOTIVO_VISIBLE });

      const fila = await prisma.user.findUniqueOrThrow({ where: { id: objetivo } });
      expect(fila.sanctionReason).toBe(MOTIVO_VISIBLE);
    });

    it('sin motivo sigue funcionando: el cuerpo es opcional (ráfaga aditiva)', async () => {
      await admin.banUser(objetivo, moderador);

      const fila = await prisma.user.findUniqueOrThrow({ where: { id: objetivo } });
      expect(fila.status).toBe(UserStatus.BANNED);
      expect(fila.sanctionReason).toBeNull();
      expect(correos()[0].reason).toBeNull();
    });
  });

  // ===========================================================================
  // BARRERA 2 — LA FRONTERA: la nota interna NO se filtra
  // ===========================================================================

  describe('LA FRONTERA — el motivo visible sale; la nota interna, jamás', () => {
    it('la nota interna va al AuditLog y NO a la notificación ni al correo', async () => {
      await admin.suspendUser(objetivo, moderador, {
        days: 3,
        reason: MOTIVO_VISIBLE,
        internalNote: NOTA_INTERNA,
      });

      // Donde SÍ tiene que estar: el registro del equipo.
      const registro = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'USER_SUSPEND', resourceId: objetivo },
      });
      expect(JSON.stringify(registro.after)).toContain(NOTA_INTERNA);

      // Donde NO puede estar: nada de lo que llega al usuario.
      const todos = await prisma.notification.findMany({ where: { userId: objetivo } });
      expect(JSON.stringify(todos)).not.toContain(NOTA_INTERNA);
      expect(JSON.stringify(correos())).not.toContain(NOTA_INTERNA);
    });

    it('tampoco se filtra en un baneo', async () => {
      await admin.banUser(objetivo, moderador, {
        reason: MOTIVO_VISIBLE,
        internalNote: NOTA_INTERNA,
      });

      const todos = await prisma.notification.findMany({ where: { userId: objetivo } });
      expect(JSON.stringify(todos)).not.toContain(NOTA_INTERNA);
      expect(JSON.stringify(correos())).not.toContain(NOTA_INTERNA);
    });

    /**
     * La nota se guarda en la fila para el backoffice, pero **el gate no la mira**:
     * el mensaje que ve el sancionado sale de `sanctionReason` y de nada más.
     */
    it('el mensaje del login lleva el motivo visible y NUNCA la nota', async () => {
      await admin.suspendUser(objetivo, moderador, {
        days: 3,
        reason: MOTIVO_VISIBLE,
        internalNote: NOTA_INTERNA,
      });

      const fila = await prisma.user.findUniqueOrThrow({ where: { id: objetivo } });
      const mensaje = motivoDeBloqueoDeCuenta(fila);

      expect(mensaje).toContain(MOTIVO_VISIBLE);
      expect(mensaje).not.toContain(NOTA_INTERNA);
    });
  });

  // ===========================================================================
  // BARRERA 4 — reinstaurar avisa de los anuncios
  // ===========================================================================

  describe('levantar una sanción también se avisa', () => {
    it('reinstaurar → aviso REINSTATED (el copy dice que los anuncios no vuelven solos)', async () => {
      await admin.banUser(objetivo, moderador, { reason: MOTIVO_VISIBLE });
      addSpy.mockClear();

      await admin.reinstateUser(objetivo, moderador);

      const [correo] = correos();
      expect(correo.action).toBe('REINSTATED');

      const ultimos = await avisos(objetivo);
      expect(ultimos.map((n) => (n.data as Record<string, unknown>).action)).toContain('REINSTATED');
    });

    it('levantar la suspensión limpia el motivo: no se arrastra a la cuenta activa', async () => {
      await admin.suspendUser(objetivo, moderador, { days: 5, reason: MOTIVO_VISIBLE });
      await admin.unsuspendUser(objetivo, moderador);

      const fila = await prisma.user.findUniqueOrThrow({ where: { id: objetivo } });
      expect(fila.status).toBe(UserStatus.ACTIVE);
      expect(fila.sanctionReason).toBeNull();
      expect(fila.sanctionNote).toBeNull();
      // Y con la cuenta limpia, el gate ya no dice nada.
      expect(motivoDeBloqueoDeCuenta(fila)).toBeNull();
    });

    /**
     * El camino MAYORITARIO de recuperar una cuenta suspendida es que se cumpla el
     * plazo, no que un moderador pulse nada. Avisar sólo del manual habría dejado
     * mudo justamente el normal.
     */
    it('la suspensión que se cumple sola TAMBIÉN avisa', async () => {
      await prisma.user.update({
        where: { id: objetivo },
        data: {
          status: UserStatus.SUSPENDED,
          suspendedUntil: new Date(Date.now() - 60_000),
          sanctionReason: MOTIVO_VISIBLE,
          sanctionNote: NOTA_INTERNA,
        },
      });
      addSpy.mockClear();

      const levantadas = await expiracion.runExpirationSweep();
      expect(levantadas).toBe(1);

      expect(correos()[0].action).toBe('UNSUSPENDED');

      const fila = await prisma.user.findUniqueOrThrow({ where: { id: objetivo } });
      expect(fila.sanctionReason).toBeNull();
      expect(fila.sanctionNote).toBeNull();
    });
  });

  // ===========================================================================
  // Cambio de rol — invalida las sesiones, así que se avisa
  // ===========================================================================

  it('cambiar el rol avisa: si no, la persona se entera con un 401', async () => {
    await admin.changeUserRole(objetivo, moderador, { role: Role.MODERATOR });

    const [correo] = correos();
    expect(correo.action).toBe('ROLE_CHANGED');
    expect(correo.newRole).toBe(Role.MODERATOR);

    const [aviso] = await avisos(objetivo);
    expect((aviso.data as Record<string, unknown>).newRole).toBe(Role.MODERATOR);
  });
});
