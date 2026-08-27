import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { getExistingJobs } from './helpers/queue';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_ACCOUNT_CLEANUP } from 'src/infra/queue/queue.constants';
import { ACCOUNT_CLEANUP_JOB } from 'src/modules/admin/account-cleanup.types';
import { EQUIPO_SLUG } from 'src/modules/users/system-account';

/**
 * BORRADO DE CUENTAS — C5: EL TEST DE INVENTARIO.
 *
 * **LA BARRERA REAL DEL CUERPO ENTERO.** Se crea un usuario con las 34 relaciones
 * que apuntan a `User` pobladas, se elimina, y se afirma **una por una** qué se
 * anonimizó, qué se conservó y qué se liberó.
 *
 * Sin este test, cualquiera de las 34 podría quedarse sin tratamiento y nadie se
 * enteraría: el vaciado seguiría «funcionando» y dejaría un dato personal, o
 * destruiría algo de un tercero. Es el equivalente para cuentas de lo que
 * `borrado-inventario.e2e-spec.ts` es para anuncios.
 *
 * Las 34 salen del inventario verificado de `docs/auditoria-borrado-cuentas.md`
 * §2.2, y se agrupan aquí por el tratamiento que el diseño les asignó (§3).
 */
describe('Borrado de cuentas C5 — el inventario de las 34 relaciones (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let categoryId: string;
  let priceId: string;
  let accountCleanupQueue: Queue;

  const PASSWORD = 'Test1234!';

  // Todo lo que el sujeto deja detrás, capturado antes de vaciarlo.
  let sujeto: { id: string; email: string; slug: string; name: string };
  let adminToken: string;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    accountCleanupQueue = app.get<Queue>(getQueueToken(QUEUE_ACCOUNT_CLEANUP));

    const hash = await bcrypt.hash(PASSWORD, 4);
    categoryId = (await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } })).id;
    priceId = (
      await prisma.price.findFirstOrThrow({
        where: { product: { type: 'RECURRING' } },
        select: { id: true },
      })
    ).id;

    const crear = async (marca: string, extra: Partial<Prisma.UserCreateInput> = {}) =>
      prisma.user.create({
        data: {
          email: `c5-${marca}@example.com`,
          name: `C5 ${marca}`,
          slug: `c5-${marca}`,
          passwordHash: hash,
          emailVerified: true,
          ...extra,
        } as Prisma.UserCreateInput,
      });

    // ── EL SUJETO y los TERCEROS con los que se relaciona ────────────────────
    const s = await crear('sujeto');
    sujeto = { id: s.id, email: s.email, slug: s.slug, name: s.name };
    const otro = await crear('otro');
    const staff = await crear('staff', { role: 'MODERATOR' });
    const admin = await crear('admin', { role: 'ADMIN' });
    ids.otro = otro.id;
    ids.staff = staff.id;

    // Las cuentas de administración entran por su propia puerta: `/auth/login`
    // las rechaza con 403 a propósito (ver `AuthService.adminLogin`).
    adminToken = (
      await request(app.getHttpServer())
        .post('/api/auth/admin-login')
        .send({ email: admin.email, password: PASSWORD })
        .expect(200)
    ).body.accessToken as string;

    const anuncio = async (sellerId: string, marca: string, status: Prisma.ListingCreateInput['status'] = 'ACTIVE') =>
      prisma.listing.create({
        data: {
          title: `C5 ${marca}`,
          slug: `c5-l-${marca}`,
          description: 'descripción de prueba con longitud suficiente',
          price: new Prisma.Decimal('42.00'),
          type: 'PRODUCT',
          priceType: 'FIXED',
          condition: 'GOOD',
          status,
          sellerId,
          categoryId,
          publishedAt: new Date(),
          // El teléfono PUBLICADO — el hueco que no cuelga de `User`.
          phone: '654 123 456',
          phoneNormalized: '654123456',
          lastOwnerIp: '10.9.9.9',
        },
      });

    // 2 · Listing.sellerId
    const suAnuncio = await anuncio(s.id, 'suyo');
    const anuncioAjeno = await anuncio(otro.id, 'ajeno');
    ids.suAnuncio = suAnuncio.id;
    ids.anuncioAjeno = anuncioAjeno.id;

    // 3 · ListingImage.uploadedById
    ids.imagen = (
      await prisma.listingImage.create({
        data: { url: 'https://cdn.test/media/c5.jpg', listingId: suAnuncio.id, uploadedById: s.id },
      })
    ).id;

    // 1 · Account.userId
    ids.account = (
      await prisma.account.create({
        data: { userId: s.id, provider: 'google', providerAccountId: `c5-${s.id}` },
      })
    ).id;

    // 4 · Favorite · 5 · Notification · 6 · Alert
    ids.favorito = (
      await prisma.favorite.create({ data: { userId: s.id, listingId: anuncioAjeno.id } })
    ).id;
    ids.notificacion = (
      await prisma.notification.create({ data: { userId: s.id, type: 'ALERT_MATCH', data: {} } })
    ).id;
    ids.alerta = (await prisma.alert.create({ data: { userId: s.id, name: 'Mi alerta' } })).id;

    // 7-8 · Conversation.buyerId/.sellerId · 9 · Message.senderId
    const conv = await prisma.conversation.create({
      data: { listingId: anuncioAjeno.id, listingTitle: anuncioAjeno.title, buyerId: s.id, sellerId: otro.id },
    });
    ids.conversacion = conv.id;
    ids.mensajeSuyo = (
      await prisma.message.create({ data: { conversationId: conv.id, senderId: s.id, body: 'Hola, me interesa' } })
    ).id;
    ids.mensajeAjeno = (
      await prisma.message.create({ data: { conversationId: conv.id, senderId: otro.id, body: 'Sigue disponible' } })
    ).id;

    // 10-11 · Deal.sellerId/.buyerId
    ids.trato = (
      await prisma.deal.create({
        data: { listingTitle: anuncioAjeno.title, listingId: anuncioAjeno.id, sellerId: otro.id, buyerId: s.id, conversationId: conv.id },
      })
    ).id;

    // 12 · Review.authorId (la que ESCRIBIÓ — reputación de un tercero)
    ids.valoracionEscrita = (
      await prisma.review.create({
        data: { rating: 5, comment: 'Trato perfecto', authorId: s.id, targetId: otro.id, listingId: anuncioAjeno.id, listingTitle: anuncioAjeno.title },
      })
    ).id;
    // 13 · Review.targetId (la que RECIBIÓ)
    ids.valoracionRecibida = (
      await prisma.review.create({
        data: { rating: 4, comment: 'Todo bien', authorId: otro.id, targetId: s.id, listingId: suAnuncio.id, listingTitle: suAnuncio.title },
      })
    ).id;
    // 14 · Review.retiredById (staff)
    await prisma.review.update({
      where: { id: ids.valoracionRecibida },
      data: { retiredAt: null, retiredById: null },
    });

    // 15 · Report.reporterId · 16 · Report.reportedUserId · 17 · Report.resolvedById
    ids.denunciaSuya = (
      await prisma.report.create({
        data: { reason: 'SPAM', reporterId: s.id, reportedUserId: otro.id, reportedUserName: otro.name },
      })
    ).id;
    ids.denunciaContraEl = (
      await prisma.report.create({
        data: { reason: 'FRAUD', reporterId: otro.id, reportedUserId: s.id, reportedUserName: s.name, resolvedById: staff.id },
      })
    ).id;
    // El snapshot congelado del nombre en una denuncia de VALORACIÓN suya.
    ids.denunciaDeSuValoracion = (
      await prisma.report.create({
        data: { reason: 'FAKE_REVIEW', reporterId: otro.id, reviewId: ids.valoracionEscrita, reviewComment: 'Trato perfecto', reviewAuthorName: s.name },
      })
    ).id;

    // 18 · AuditLog.actorId (una acción SUYA, como actor)
    ids.auditoria = (
      await prisma.auditLog.create({
        data: { action: 'USER_ARCHIVE', actorId: s.id, resourceType: 'User', resourceId: s.id },
      })
    ).id;

    // 19-20 · VerificationToken · PasswordResetToken
    ids.tokenVerif = (
      await prisma.verificationToken.create({
        data: { userId: s.id, token: `c5-v-${s.id}`, expiresAt: new Date(Date.now() + 3_600_000) },
      })
    ).id;
    ids.tokenReset = (
      await prisma.passwordResetToken.create({
        data: { userId: s.id, token: `c5-r-${s.id}`, expiresAt: new Date(Date.now() + 3_600_000) },
      })
    ).id;

    // 22 · Subscription · 23 · Transaction · 21 · Entitlement
    const sub = await prisma.subscription.create({
      data: { userId: s.id, priceId, status: 'ACTIVE', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3_600_000), gatewaySubscriptionId: `sub_c5_${s.id}` },
    });
    ids.suscripcion = sub.id;
    const tx = await prisma.transaction.create({
      data: { userId: s.id, priceId, amountGross: new Prisma.Decimal('9.99'), amountNet: new Prisma.Decimal('8.26'), taxAmount: new Prisma.Decimal('1.73'), taxRate: new Prisma.Decimal('0.2100'), status: 'SUCCEEDED', subscriptionId: sub.id },
    });
    ids.transaccion = tx.id;
    ids.entitlement = (
      await prisma.entitlement.create({ data: { userId: s.id, type: 'PRO_SUBSCRIPTION', subscriptionId: sub.id } })
    ).id;

    // 24 · Wallet (+ los dos libros mayores)
    const wallet = await prisma.wallet.create({ data: { userId: s.id, balance: 120, bumpBalance: 5 } });
    ids.wallet = wallet.id;
    ids.asientoPrevio = (
      await prisma.creditLedger.create({ data: { walletId: wallet.id, type: 'PACK_PURCHASE', amount: 120 } })
    ).id;
    await prisma.bumpLedger.create({ data: { walletId: wallet.id, type: 'PACK_PURCHASE', amount: 5 } });

    // 25 · BumpSchedule
    ids.bumpSchedule = (
      await prisma.bumpSchedule.create({
        data: { listingId: suAnuncio.id, userId: s.id, intervalDays: 7, hourOfDay: 9, nextRunAt: new Date(Date.now() + 3_600_000) },
      })
    ).id;

    // 26 · CouponRedemption
    const coupon = await prisma.coupon.create({
      data: { code: 'C5-INVENTARIO', rewardType: 'CREDITS', creditAmount: 10, startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 86_400_000) },
    });
    ids.canje = (
      await prisma.couponRedemption.create({
        data: { couponId: coupon.id, userId: s.id, referenceType: 'CreditLedger', referenceId: ids.asientoPrevio },
      })
    ).id;

    // 27 · Post.authorId — el que se reasigna a «Equipo»
    ids.post = (
      await prisma.post.create({
        data: { title: 'Artículo del sujeto', slug: 'c5-articulo-sujeto', authorId: s.id, status: 'PUBLISHED', publishedAt: new Date() },
      })
    ).id;

    // 28 · ContactReply.adminUserId
    const motivo = await prisma.contactReason.create({ data: { nombre: 'C5 motivo' } });
    const mensaje = await prisma.contactMessage.create({
      data: { motivoId: motivo.id, email: 'anon@example.com', mensaje: 'Hola' },
    });
    ids.respuestaContacto = (
      await prisma.contactReply.create({
        data: { contactMessageId: mensaje.id, adminUserId: s.id, asunto: 'Re', cuerpo: 'Respuesta' },
      })
    ).id;

    // 29 · Invoice.userId — lo fiscal
    ids.factura = (
      await prisma.invoice.create({
        data: {
          userId: s.id, origin: 'ADMIN', status: 'ISSUED', number: 'C5-2026-000001',
          receiverTaxId: '12345678Z', receiverName: 'Nombre Fiscal Real',
          subtotalNet: new Prisma.Decimal('8.26'), totalTax: new Prisma.Decimal('1.73'), totalGross: new Prisma.Decimal('9.99'),
          issuedAt: new Date(), pdfKey: 'facturas/c5-inventario.pdf',
        },
      })
    ).id;

    // 30-34 · Ticket.userId/.openedById/.assignedToId/.closedById · TicketMessage.authorId
    const ticket = await prisma.ticket.create({
      data: { subject: 'Consulta del sujeto', origin: 'USER', userId: s.id, openedById: s.id, assignedToId: staff.id },
    });
    ids.ticket = ticket.id;
    ids.mensajeTicket = (
      await prisma.ticketMessage.create({ data: { ticketId: ticket.id, authorId: s.id, side: 'USER', body: 'Tengo una duda' } })
    ).id;
    ids.adjunto = (
      await prisma.ticketAttachment.create({
        data: { ticketMessageId: ids.mensajeTicket, key: 'tickets/c5/adjunto.png', filename: 'a.png', mimeType: 'image/png', sizeBytes: 10 },
      })
    ).id;

    // Los datos fiscales del perfil, para comprobar que se vacían.
    await prisma.user.update({
      where: { id: s.id },
      data: {
        phone: '600111222', avatarUrl: 'https://cdn.test/avatars/c5.png', bio: 'Mi bio',
        city: 'Madrid', province: 'Madrid', postalCode: '28001',
        lastLoginAt: new Date(), lastLoginIp: '10.1.2.3',
        fiscalTaxId: '12345678Z', fiscalName: 'Nombre Fiscal Real', fiscalEntityType: 'INDIVIDUAL',
        fiscalAddress: 'Calle 1', fiscalCity: 'Madrid', fiscalPostalCode: '28001',
        fiscalProvince: 'Madrid', fiscalCountry: 'ES',
        stripeCustomerId: `cus_c5_${s.id}`,
        // El paso previo obligatorio: sólo se elimina lo archivado.
        status: UserStatus.ARCHIVED, archivedAt: new Date(), archiveReason: 'SELF_REQUEST',
        statusBeforeArchive: UserStatus.ACTIVE,
      },
    });

    // ── LA OPERACIÓN ────────────────────────────────────────────────────────
    //
    // LA COLA SE PAUSA ANTES, y no es un detalle del montaje: el borrado de los
    // anuncios va por cola, y su worker está vivo en e2e. Sin pausarla, para
    // cuando este fichero comprueba que el TELÉFONO PUBLICADO quedó vacío, el
    // anuncio ya no existe — y la aserción se saltaría en silencio.
    //
    // Se descubrió justo así: la mutación que quita el fregado del teléfono
    // **no tumbaba el test**. Una barrera que no cae ante su propia mutación no
    // es una barrera. Con la cola parada, las filas siguen ahí para poder
    // afirmarlo. Que los anuncios acaban borrándose lo fija
    // `borrado-inventario.e2e-spec.ts`, que es de quien se reutiliza el camino.
    await accountCleanupQueue.pause();
    await request(app.getHttpServer())
      .delete(`/api/admin/users/${s.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  }, 120_000);

  afterAll(async () => {
    await accountCleanupQueue.resume();
    await app.close();
    await prisma.$disconnect();
  });

  const usuario = () => prisma.user.findUniqueOrThrow({ where: { id: sujeto.id } });

  // ═══════════════════════════════════════════════════════════════════════════
  //  LA FILA SOBREVIVE, VACIADA
  // ═══════════════════════════════════════════════════════════════════════════

  describe('La fila de User: vaciada de persona, no borrada', () => {
    it('sigue existiendo — los RESTRICT y el trigger fiscal lo exigen, y está bien', async () => {
      expect(await usuario()).toBeTruthy();
      expect((await usuario()).status).toBe(UserStatus.DELETED);
      expect((await usuario()).deletedAt).not.toBeNull();
    });

    it('la identidad queda anonimizada y los identificadores únicos LIBERADOS', async () => {
      const u = await usuario();
      expect(u.name).toBe('Usuario eliminado');
      expect(u.email).toBe(`deleted-${sujeto.id}@deleted.invalid`);
      expect(u.slug).toBe(`usuario-eliminado-${sujeto.id}`);
      // `.invalid` es el TLD reservado por RFC 2606: no puede existir, así que
      // ningún correo saldrá hacia ahí ni por accidente.
      expect(u.email.endsWith('.invalid')).toBe(true);
    });

    it('los datos personales del perfil, a null; el secreto, destruido', async () => {
      const u = await usuario();
      for (const campo of ['phone', 'avatarUrl', 'bio', 'city', 'province', 'postalCode', 'passwordHash', 'lastLoginAt', 'lastLoginIp'] as const) {
        expect(u[campo]).toBeNull();
      }
    });

    it('los OCHO campos fiscales, a null — la factura los lleva congelados dentro', async () => {
      const u = await usuario();
      for (const campo of ['fiscalTaxId', 'fiscalName', 'fiscalEntityType', 'fiscalAddress', 'fiscalCity', 'fiscalPostalCode', 'fiscalProvince', 'fiscalCountry'] as const) {
        expect(u[campo]).toBeNull();
      }
      const f = await prisma.invoice.findUniqueOrThrow({ where: { id: ids.factura } });
      expect(f.receiverTaxId).toBe('12345678Z');
      expect(f.receiverName).toBe('Nombre Fiscal Real');
    });

    it('`stripeCustomerId` SE CONSERVA: ata los cobros conservados a la pasarela', async () => {
      expect((await usuario()).stripeCustomerId).toBe(`cus_c5_${sujeto.id}`);
    });

    it('el correo real se puede volver a registrar', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/register')
        .send({ email: sujeto.email, password: 'OtraPassword1234!', name: 'Alguien nuevo' })
        .expect(201);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  ANONIMIZAR — lo de DOS DUEÑOS sobrevive, firmado «Usuario eliminado»
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Lo de dos dueños SOBREVIVE (anonimizado por propagación)', () => {
    it('7-9 · la conversación y LOS DOS mensajes siguen ahí', async () => {
      expect(await prisma.conversation.findUnique({ where: { id: ids.conversacion } })).not.toBeNull();
      expect(await prisma.message.findUnique({ where: { id: ids.mensajeSuyo } })).not.toBeNull();
      expect(await prisma.message.findUnique({ where: { id: ids.mensajeAjeno } })).not.toBeNull();
    });

    it('12 · la valoración que ESCRIBIÓ sigue contando para la media del tercero, firmada «Usuario eliminado»', async () => {
      const otro = await prisma.user.findUniqueOrThrow({ where: { id: ids.otro } });
      const res = await request(app.getHttpServer()).get(`/api/users/${otro.slug}/reviews`).expect(200);
      expect((res.body.items as { comment: string }[]).map((r) => r.comment)).toContain('Trato perfecto');
      expect(res.body.count).toBe(1);
      expect((res.body.items as { author: { name: string } }[])[0].author.name).toBe('Usuario eliminado');
    });

    it('13 · la valoración que RECIBIÓ se conserva: es el testimonio de quien la escribió', async () => {
      expect(await prisma.review.findUnique({ where: { id: ids.valoracionRecibida } })).not.toBeNull();
    });

    it('10 · el trato sobrevive — es la evidencia de `Review.verified`', async () => {
      expect(await prisma.deal.findUnique({ where: { id: ids.trato } })).not.toBeNull();
    });

    it('15-17 · las denuncias sobreviven, y la que va CONTRA ÉL sigue diciendo contra quién', async () => {
      expect(await prisma.report.findUnique({ where: { id: ids.denunciaSuya } })).not.toBeNull();
      const contra = await prisma.report.findUniqueOrThrow({ where: { id: ids.denunciaContraEl } });
      // El snapshot de C1: la relación ya dice «Usuario eliminado», el snapshot no.
      expect(contra.reportedUserName).toBe(sujeto.name);
    });

    it('el snapshot CONGELADO del nombre sí se friega — es una copia, no una relación', async () => {
      const d = await prisma.report.findUniqueOrThrow({ where: { id: ids.denunciaDeSuValoracion } });
      expect(d.reviewAuthorName).toBe('Usuario eliminado');
      expect(d.reviewAuthorName).not.toBe(sujeto.name);
    });

    it('30-34 · el hilo de soporte y sus mensajes se conservan', async () => {
      expect(await prisma.ticket.findUnique({ where: { id: ids.ticket } })).not.toBeNull();
      expect(await prisma.ticketMessage.findUnique({ where: { id: ids.mensajeTicket } })).not.toBeNull();
      // La fila del adjunto se conserva; su objeto de R2 se purga (efecto externo).
      expect(await prisma.ticketAttachment.findUnique({ where: { id: ids.adjunto } })).not.toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  CONSERVAR — lo fiscal, contable y de auditoría
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Lo fiscal, lo contable y la auditoría: intactos', () => {
    it('29 · la factura sigue entera, con su número y su PDF', async () => {
      const f = await prisma.invoice.findUniqueOrThrow({ where: { id: ids.factura } });
      expect(f.number).toBe('C5-2026-000001');
      expect(f.status).toBe('ISSUED');
      // `facturas/` NO se toca en R2: son documentos de conservación obligatoria.
      expect(f.pdfKey).toBe('facturas/c5-inventario.pdf');
    });

    it('23 · la transacción se conserva · 22 · la suscripción también (cambia el estado, no la historia)', async () => {
      expect(await prisma.transaction.findUnique({ where: { id: ids.transaccion } })).not.toBeNull();
      expect(await prisma.subscription.findUnique({ where: { id: ids.suscripcion } })).not.toBeNull();
    });

    it('24 · el libro mayor se conserva Y el saldo queda a cero con un asiento (P-1)', async () => {
      const w = await prisma.wallet.findUniqueOrThrow({ where: { id: ids.wallet } });
      expect(w.balance).toBe(0);
      expect(w.bumpBalance).toBe(0);
      // El asiento previo sigue: el libro es inmutable.
      expect(await prisma.creditLedger.findUnique({ where: { id: ids.asientoPrevio } })).not.toBeNull();
      // Y el invariante `balance == SUM(amount)` se mantiene.
      const suma = await prisma.creditLedger.aggregate({ where: { walletId: w.id }, _sum: { amount: true } });
      expect(suma._sum.amount).toBe(0);
      const sumaBumps = await prisma.bumpLedger.aggregate({ where: { walletId: w.id }, _sum: { amount: true } });
      expect(sumaBumps._sum.amount).toBe(0);
    });

    it('21 · el entitlement se REVOCA, no se borra', async () => {
      const e = await prisma.entitlement.findUniqueOrThrow({ where: { id: ids.entitlement } });
      expect(e.revokedAt).not.toBeNull();
    });

    it('26 · el canje de cupón se conserva (borrarlo permitiría recanjearlo)', async () => {
      expect(await prisma.couponRedemption.findUnique({ where: { id: ids.canje } })).not.toBeNull();
    });

    it('18 · su entrada de auditoría como ACTOR se conserva · 28 · y la respuesta de contacto', async () => {
      expect(await prisma.auditLog.findUnique({ where: { id: ids.auditoria } })).not.toBeNull();
      expect(await prisma.contactReply.findUnique({ where: { id: ids.respuestaContacto } })).not.toBeNull();
    });

    it('el USER_DELETE guarda la identidad real — es lo único que sobrevive', async () => {
      const log = await prisma.auditLog.findFirstOrThrow({
        where: { action: 'USER_DELETE', resourceId: sujeto.id },
      });
      expect(log.before).toMatchObject({ name: sujeto.name, email: sujeto.email, slug: sujeto.slug });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  ARCHIVAR/BORRAR — lo estrictamente suyo
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Lo estrictamente suyo desaparece', () => {
    it('1 · Account · 4 · Favorite · 5 · Notification · 6 · Alert · 19-20 · tokens · 25 · BumpSchedule', async () => {
      expect(await prisma.account.findUnique({ where: { id: ids.account } })).toBeNull();
      expect(await prisma.favorite.findUnique({ where: { id: ids.favorito } })).toBeNull();
      expect(await prisma.notification.findUnique({ where: { id: ids.notificacion } })).toBeNull();
      expect(await prisma.alert.findUnique({ where: { id: ids.alerta } })).toBeNull();
      expect(await prisma.verificationToken.findUnique({ where: { id: ids.tokenVerif } })).toBeNull();
      expect(await prisma.passwordResetToken.findUnique({ where: { id: ids.tokenReset } })).toBeNull();
      expect(await prisma.bumpSchedule.findUnique({ where: { id: ids.bumpSchedule } })).toBeNull();
    });

    it('2 · sus anuncios se ENCOLAN para borrado — y los AJENOS no se tocan', async () => {
      // `getExistingJobs` y no `getJobs` a pelo: es el helper que existe para que el
      // filtro de huecos no se escriba once veces (ver `helpers/queue.ts`). Aquí la
      // cola está parada desde el `beforeAll`, así que huecos no hay — pero la copia
      // suelta del filtro sí era la undécima.
      const jobs = await getExistingJobs(accountCleanupQueue, ['waiting', 'active', 'delayed']);
      const suyos = jobs.filter(
        (j) =>
          j.name === ACCOUNT_CLEANUP_JOB.DELETE_LISTING &&
          (j.data as { listingId?: string })?.listingId === ids.suAnuncio,
      );
      expect(suyos).toHaveLength(1);

      // El anuncio de OTRA persona no entra en la limpieza ni por asomo.
      expect(
        jobs.some((j) => (j.data as { listingId?: string })?.listingId === ids.anuncioAjeno),
      ).toBe(false);
      expect(await prisma.listing.findUnique({ where: { id: ids.anuncioAjeno } })).not.toBeNull();
    });

    it('EL HUECO FÁCIL DE OLVIDAR: el teléfono PUBLICADO del anuncio queda vacío', async () => {
      // No cuelga de `User`, así que la propagación NO lo alcanza: hay que
      // fregarlo a mano. La cola está pausada, así que la fila sigue aquí para
      // poder afirmarlo — sin la pausa esta aserción se saltaría en silencio y la
      // barrera no caería ante su propia mutación (así se descubrió).
      const l = await prisma.listing.findUniqueOrThrow({ where: { id: ids.suAnuncio } });
      expect(l.phone).toBeNull();
      expect(l.phoneNormalized).toBeNull();
      expect(l.lastOwnerIp).toBeNull();

      // Y el del tercero se queda como estaba: sólo se friega lo del sujeto.
      const ajeno = await prisma.listing.findUniqueOrThrow({ where: { id: ids.anuncioAjeno } });
      expect(ajeno.phone).not.toBeNull();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  27 · Post → «Equipo» (P-2)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('27 · los artículos del blog van a «Equipo»', () => {
    it('el artículo sobrevive, firmado por la cuenta de sistema', async () => {
      const post = await prisma.post.findUniqueOrThrow({
        where: { id: ids.post },
        include: { author: { select: { slug: true, isSystem: true, name: true } } },
      });
      expect(post.author.isSystem).toBe(true);
      expect(post.author.slug).toBe(EQUIPO_SLUG);
      expect(post.author.name).toBe('Equipo');
      expect(post.status).toBe('PUBLISHED');
    });

    it('la cuenta «Equipo» no se puede eliminar ni archivar', async () => {
      const equipo = await prisma.user.findFirstOrThrow({ where: { isSystem: true } });

      await request(app.getHttpServer())
        .delete(`/api/admin/users/${equipo.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      await request(app.getHttpServer())
        .patch(`/api/admin/users/${equipo.id}/archive`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(400);
    });
  });
});
