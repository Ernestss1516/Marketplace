import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { NotificationProcessor } from 'src/infra/queue/processors/notification.processor';
import { EmailPreferencesService } from 'src/modules/users/email-preferences.service';
import { NOTIFICATION_JOB } from 'src/infra/queue/notification.types';
import { categoriaDe } from 'src/infra/queue/email-categories';

/**
 * NOTIFICACIONES N5 — LA VÁLVULA DEL CORREO, Y SU FRONTERA.
 *
 * ── LA BARRERA QUE IMPORTA ES LA PRIMERA ───────────────────────────────────
 *
 * Las CRÍTICAS no se pueden silenciar **y ni siquiera preguntan**. No es que se
 * consulte la preferencia y se ignore el resultado: es que su camino de envío no
 * llega a consultarla. Un fallo en la consulta —una columna mal leída, un usuario
 * que no aparece— sólo puede afectar a lo que pasa por ahí; una sanción no pasa.
 *
 * Se ejercita el PROCESSOR directamente, que es donde vive la decisión: es el
 * embudo por el que pasa todo correo del sistema.
 */
describe('Preferencias de correo — la válvula y su frontera (N5) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let processor: NotificationProcessor;
  let prefs: EmailPreferencesService;
  /** Lo que de verdad se habría mandado. */
  let enviados: { to: string; subject: string; text: string }[];

  let usuario: { id: string; email: string; name: string };

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    processor = app.get(NotificationProcessor);
    prefs = app.get(EmailPreferencesService);

    // Se intercepta Resend, no la cola: lo que se quiere observar es si el correo
    // SALE, que es la pregunta que la válvula responde.
    enviados = [];
    const resend = (processor as unknown as { resend: { emails: { send: unknown } } }).resend;
    jest
      .spyOn(resend.emails as { send: (...a: unknown[]) => unknown }, 'send')
      .mockImplementation((async (m: { to: string; subject: string; text: string }) => {
        enviados.push(m);
        return {};
      }) as never);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb(prisma);
    enviados = [];
    const id = randomUUID().slice(0, 8);
    const u = await prisma.user.create({
      data: {
        email: `pref-${id}@test.local`,
        name: `Pref ${id}`,
        slug: `pref-${id}`,
      },
    });
    usuario = { id: u.id, email: u.email, name: u.name };
  });

  /** Dispara un correo como lo haría BullMQ. */
  const disparar = (name: string, data: Record<string, unknown>) =>
    processor.process({ name, data } as never);

  const base = () => ({ email: usuario.email, name: usuario.name });

  // ===========================================================================
  // BARRERA 3 — opt-out: por defecto se recibe todo
  // ===========================================================================

  it('BARRERA 3 — un usuario nuevo tiene TODAS las categorías activadas', async () => {
    expect(await prefs.get(usuario.id)).toEqual({
      MESSAGES: true,
      LISTINGS: true,
      REVIEWS: true,
      ALERTS: true,
    });
  });

  /**
   * EL OPT-OUT, COMPROBADO EN LA BASE Y NO SÓLO EN PRISMA.
   *
   * El test de arriba crea el usuario con Prisma, que **lleva el valor por defecto
   * en el propio INSERT**: comprobaría igual de bien aunque la columna no tuviera
   * `DEFAULT true` en Postgres. Se descubrió al mutar el defecto de la base y ver
   * que el test seguía verde.
   *
   * Esta inserción en SQL crudo OMITE las cuatro columnas, así que lo único que
   * puede rellenarlas es el defecto de la tabla. Con las dos capas comprobadas, el
   * opt-out no depende de cuál de ellas escriba la fila.
   */
  it('BARRERA 3b — y el defecto vive también en la BASE, no sólo en Prisma', async () => {
    const id = randomUUID();
    await prisma.$executeRawUnsafe(
      `INSERT INTO "User" (id, email, name, slug, "updatedAt")
       VALUES ($1, $2, $3, $4, NOW())`,
      id,
      `raw-${id.slice(0, 8)}@test.local`,
      'Raw',
      `raw-${id.slice(0, 8)}`,
    );

    const fila = await prisma.user.findUniqueOrThrow({
      where: { id },
      select: { emailMessages: true, emailListings: true, emailReviews: true, emailAlerts: true },
    });
    expect(fila).toEqual({
      emailMessages: true,
      emailListings: true,
      emailReviews: true,
      emailAlerts: true,
    });
  });

  // ===========================================================================
  // BARRERA 1 — LAS CRÍTICAS NUNCA SE SILENCIAN, NI PREGUNTAN
  // ===========================================================================

  describe('BARRERA 1 — las críticas, con TODO apagado', () => {
    beforeEach(async () => {
      // Se apaga absolutamente todo lo que se puede apagar.
      await prefs.update(usuario.id, {
        MESSAGES: false,
        LISTINGS: false,
        REVIEWS: false,
        ALERTS: false,
      });
      enviados = [];
    });

    it('un BANEO sigue saliendo', async () => {
      await disparar(NOTIFICATION_JOB.SEND_ACCOUNT_MODERATED, {
        ...base(),
        action: 'BANNED',
        reason: 'Fraude',
        suspendedUntil: null,
        newRole: null,
      });
      expect(enviados).toHaveLength(1);
    });

    it('un DÉBITO DE SALDO sigue saliendo, con su motivo', async () => {
      await disparar(NOTIFICATION_JOB.SEND_BALANCE_DEBITED, {
        ...base(),
        credits: 50,
        bumps: 0,
        reason: 'Ajuste por reembolso',
      });
      expect(enviados).toHaveLength(1);
      expect(enviados[0].text).toContain('Ajuste por reembolso');
    });

    it('la COPIA DE DATOS (que caduca) sigue saliendo', async () => {
      await disparar(NOTIFICATION_JOB.SEND_DATA_EXPORT_READY, {
        ...base(),
        expiresAt: new Date(Date.now() + 7 * 864e5).toISOString(),
        sizeBytes: 1024 * 1024,
      });
      expect(enviados).toHaveLength(1);
    });

    it('un ANUNCIO ELIMINADO POR EL STAFF sigue saliendo', async () => {
      await disparar(NOTIFICATION_JOB.SEND_LISTING_LIFECYCLE, {
        ...base(),
        listingTitle: 'Bici',
        action: 'DELETED_BY_STAFF',
        reason: null,
        daysLeft: null,
      });
      expect(enviados).toHaveLength(1);
    });

    /**
     * La frontera, comprobada en el mapa y no sólo en la conducta: `null` significa
     * «no preguntes». Si alguna de éstas devolviera una categoría, se volvería
     * silenciable — y eso es lo que esta aserción impide que pase inadvertido.
     */
    it('el mapa las declara CRÍTICAS (null = no se consulta nada)', () => {
      const criticas = [
        NOTIFICATION_JOB.SEND_ACCOUNT_MODERATED,
        NOTIFICATION_JOB.SEND_LISTING_MODERATED,
        NOTIFICATION_JOB.SEND_BALANCE_DEBITED,
        NOTIFICATION_JOB.SEND_DATA_EXPORT_READY,
        NOTIFICATION_JOB.SEND_INVOICING_PENDING,
        NOTIFICATION_JOB.SEND_BUMP_AUTO_PAUSED,
        NOTIFICATION_JOB.SEND_VERIFICATION_EMAIL,
        NOTIFICATION_JOB.SEND_RESET_EMAIL,
        NOTIFICATION_JOB.SEND_TICKET_MESSAGE,
      ];
      for (const job of criticas) {
        expect(categoriaDe(job, {})).toBeNull();
      }
      // Y el ciclo de vida, sólo en sus dos acciones de staff.
      expect(categoriaDe(NOTIFICATION_JOB.SEND_LISTING_LIFECYCLE, { action: 'DELETED_BY_STAFF' })).toBeNull();
      expect(categoriaDe(NOTIFICATION_JOB.SEND_LISTING_LIFECYCLE, { action: 'EDITED_BY_STAFF' })).toBeNull();
    });

    /** Un job que no esté en el mapa se trata como crítico: el fallo no silencia. */
    it('un job desconocido se trata como CRÍTICO', () => {
      expect(categoriaDe('send-lo-que-sea', {})).toBeNull();
    });
  });

  // ===========================================================================
  // BARRERA 2 y 5 — las informativas SÍ se silencian, y la baja funciona
  // ===========================================================================

  describe('BARRERA 2 — las informativas', () => {
    const mensaje = () => ({
      ...base(),
      conversationId: 'c1',
      otherUserName: 'Juan',
      unreadCount: 2,
      extracto: 'Hola',
    });

    it('con la categoría ENCENDIDA (por defecto), el correo sale', async () => {
      await disparar(NOTIFICATION_JOB.SEND_MESSAGE_UNREAD, mensaje());
      expect(enviados).toHaveLength(1);
    });

    it('con la categoría APAGADA, el correo NO sale', async () => {
      await prefs.update(usuario.id, { MESSAGES: false });
      await disparar(NOTIFICATION_JOB.SEND_MESSAGE_UNREAD, mensaje());
      expect(enviados).toHaveLength(0);
    });

    it('y al volver a encenderla, vuelve', async () => {
      await prefs.update(usuario.id, { MESSAGES: false });
      await prefs.update(usuario.id, { MESSAGES: true });
      await disparar(NOTIFICATION_JOB.SEND_MESSAGE_UNREAD, mensaje());
      expect(enviados).toHaveLength(1);
    });

    it('apagar una categoría NO apaga las demás', async () => {
      await prefs.update(usuario.id, { MESSAGES: false });

      await disparar(NOTIFICATION_JOB.SEND_REVIEW_RECEIVED, {
        ...base(),
        rating: 5,
        authorName: 'Ana',
        targetSlug: 'quien-sea',
        listingTitle: null,
      });
      expect(enviados).toHaveLength(1);
    });

    /** El caducar es informativo; el borrado por staff, no. Mismo job. */
    it('del ciclo de vida se silencia lo que caduca, no lo que decide el staff', async () => {
      await prefs.update(usuario.id, { LISTINGS: false });

      await disparar(NOTIFICATION_JOB.SEND_LISTING_LIFECYCLE, {
        ...base(), listingTitle: 'Bici', action: 'EXPIRED', reason: null, daysLeft: null,
      });
      expect(enviados).toHaveLength(0);

      await disparar(NOTIFICATION_JOB.SEND_LISTING_LIFECYCLE, {
        ...base(), listingTitle: 'Bici', action: 'DELETED_BY_STAFF', reason: null, daysLeft: null,
      });
      expect(enviados).toHaveLength(1);
    });

    it('las informativas llevan pie de baja; las críticas NO', async () => {
      await disparar(NOTIFICATION_JOB.SEND_MESSAGE_UNREAD, mensaje());
      expect(enviados[0].text).toContain('/baja?u=');

      enviados = [];
      await disparar(NOTIFICATION_JOB.SEND_ACCOUNT_MODERATED, {
        ...base(), action: 'BANNED', reason: null, suspendedUntil: null, newRole: null,
      });
      // Ofrecer «date de baja» al pie de un baneo sería ofrecer algo imposible.
      expect(enviados[0].text).not.toContain('/baja?u=');
    });
  });

  describe('BARRERA 5 — la baja de un clic, sin sesión', () => {
    it('con la firma correcta, apaga esa categoría', async () => {
      const firma = prefs.firmar(usuario.id, 'ALERTS');

      await prefs.bajaConFirma(usuario.id, 'ALERTS', firma);

      const despues = await prefs.get(usuario.id);
      expect(despues.ALERTS).toBe(false);
      // Y sólo esa: darse de baja de una cosa no da de baja de todo.
      expect(despues.MESSAGES).toBe(true);
    });

    it('con una firma inventada, NO apaga nada', async () => {
      await expect(
        prefs.bajaConFirma(usuario.id, 'ALERTS', 'firma-falsa'),
      ).rejects.toThrow();

      expect((await prefs.get(usuario.id)).ALERTS).toBe(true);
    });

    /** La firma es por (usuario, categoría): no vale la de otra categoría. */
    it('la firma de otra categoría no sirve', async () => {
      const firmaDeOtra = prefs.firmar(usuario.id, 'MESSAGES');

      await expect(
        prefs.bajaConFirma(usuario.id, 'ALERTS', firmaDeOtra),
      ).rejects.toThrow();
    });
  });
});
