import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import type { Queue } from 'bullmq';
import * as JSZip from 'jszip';
import * as request from 'supertest';
import { QUEUE_DATA_EXPORT } from 'src/infra/queue/queue.constants';
import { R2Service } from 'src/infra/r2/r2.service';
import { DataExportService } from 'src/modules/data-export/data-export.service';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { getExistingJobs, ESTADOS_EN_VUELO } from './helpers/queue';

/**
 * BORRADO DE CUENTAS — C6: QUÉ VA DENTRO DEL ZIP, Y QUÉ NO (§7.2).
 *
 * **LA BARRERA ESTRELLA DE ESTA RÁFAGA.** Se construye un usuario con TODO lo que
 * una persona puede generar, se exporta de verdad —con su ZIP subido a R2 y vuelto
 * a bajar— y se abre para afirmar, sección por sección, qué está y qué no.
 *
 * Las dos mitades pesan lo mismo y por motivos opuestos:
 *
 * · **Lo que falta es un derecho incumplido.** Si el monedero no entra, esa persona
 *   se va sin su historial de saldo y nadie se entera: la exportación «funciona».
 *
 * · **Lo que sobra es una fuga.** El nombre de quien le denunció, una nota interna
 *   del staff o el `passwordHash` no se pueden desexportar una vez el ZIP está en
 *   el disco de alguien.
 *
 * Por eso el test es de inclusión Y de exclusión, y por eso mira el ZIP REAL y no
 * el objeto que devuelve el colector: lo que le llega al usuario es el fichero.
 */
describe('Borrado de cuentas C6 — el contenido del ZIP (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let dataExport: DataExportService;
  let r2: R2Service;
  let queue: Queue;
  let categoryId: string;
  let priceId: string;

  const PASSWORD = 'Test1234!';

  let sujeto: { id: string; email: string; slug: string; name: string };
  let token: string;
  let denunciante: { id: string; name: string };
  const ids: Record<string, string> = {};

  /** El ZIP ya abierto, y su `datos.json` ya parseado. */
  let zip: JSZip;
  let datos: Record<string, any>;
  let leeme: string;

  const TINY_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  );
  const TINY_PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'utf8');

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    dataExport = app.get(DataExportService);
    r2 = app.get(R2Service);
    queue = app.get<Queue>(getQueueToken(QUEUE_DATA_EXPORT));

    /**
     * LA COLA, EN PAUSA.
     *
     * Se quiere comprobar las DOS cosas por separado: que el endpoint **encola**
     * (y no trabaja en la petición) y que el trabajo **produce el ZIP correcto**.
     * Con el worker vivo, entre el POST y la aserción el job puede completarse y
     * desaparecer (`removeOnComplete: true`), y el test contaría cero sin que nada
     * esté roto. Lección de C2, aplicada de entrada.
     */
    await queue.pause();

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
          email: `c6-${marca}@example.com`,
          name: `C6 ${marca}`,
          slug: `c6-${marca}`,
          passwordHash: hash,
          emailVerified: true,
          ...extra,
        } as Prisma.UserCreateInput,
      });

    const s = await crear('sujeto');
    sujeto = { id: s.id, email: s.email, slug: s.slug, name: s.name };
    const otro = await crear('otro');
    const staff = await crear('staff', { role: 'MODERATOR' });
    denunciante = { id: otro.id, name: otro.name };

    token = (
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: s.email, password: PASSWORD })
        .expect(200)
    ).body.accessToken as string;

    // ── Perfil, ubicación, datos fiscales y último acceso ────────────────────
    await prisma.user.update({
      where: { id: s.id },
      data: {
        phone: '600111222',
        bio: 'Mi biografía',
        city: 'Madrid',
        province: 'Madrid',
        postalCode: '28001',
        lastLoginAt: new Date(),
        lastLoginIp: '10.1.2.3',
        fiscalTaxId: '12345678Z',
        fiscalName: 'Nombre Fiscal Real',
        fiscalEntityType: 'INDIVIDUAL',
        fiscalAddress: 'Calle Falsa 123',
        fiscalCity: 'Madrid',
        fiscalPostalCode: '28001',
        fiscalProvince: 'Madrid',
      },
    });

    // ── El avatar, un objeto REAL en el bucket ───────────────────────────────
    const avatarKey = 'media/c6-avatar.png';
    await r2.upload(avatarKey, TINY_PNG, 'image/png');
    await prisma.user.update({
      where: { id: s.id },
      data: { avatarUrl: r2.getPublicUrl(avatarKey) },
    });

    // ── Un anuncio suyo, con foto REAL, atributos y estadísticas ─────────────
    const anuncio = await prisma.listing.create({
      data: {
        title: 'C6 anuncio suyo',
        slug: 'c6-anuncio-suyo',
        description: 'descripción de prueba con longitud suficiente',
        price: new Prisma.Decimal('42.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: 'ACTIVE',
        sellerId: s.id,
        categoryId,
        publishedAt: new Date(),
        attributes: { marca: 'Acme', modelo: 'X1' },
      },
    });
    ids.anuncio = anuncio.id;
    const fotoKey = 'media/c6-foto.png';
    await r2.upload(fotoKey, TINY_PNG, 'image/png');
    await prisma.listingImage.create({
      data: { url: r2.getPublicUrl(fotoKey), listingId: anuncio.id, uploadedById: s.id, order: 0 },
    });
    await prisma.listingViewDaily.create({
      data: { listingId: anuncio.id, date: new Date('2026-08-01'), count: 7 },
    });
    await prisma.listingImpressionDaily.create({
      data: { listingId: anuncio.id, date: new Date('2026-08-01'), count: 99 },
    });

    // ── Un anuncio AJENO, para el hilo y el favorito ─────────────────────────
    const ajeno = await prisma.listing.create({
      data: {
        title: 'C6 anuncio ajeno',
        slug: 'c6-anuncio-ajeno',
        description: 'descripción de prueba con longitud suficiente',
        price: new Prisma.Decimal('10.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: 'ACTIVE',
        sellerId: otro.id,
        categoryId,
        publishedAt: new Date(),
      },
    });

    // ── El hilo, con mensajes de LOS DOS ─────────────────────────────────────
    const conv = await prisma.conversation.create({
      data: { listingId: ajeno.id, listingTitle: ajeno.title, buyerId: s.id, sellerId: otro.id },
    });
    await prisma.message.create({
      data: { conversationId: conv.id, senderId: s.id, body: 'MENSAJE-MIO: me interesa' },
    });
    await prisma.message.create({
      data: { conversationId: conv.id, senderId: otro.id, body: 'MENSAJE-DEL-OTRO: sigue disponible' },
    });

    // ── Valoraciones en las DOS direcciones · un trato ───────────────────────
    await prisma.review.create({
      data: { rating: 5, comment: 'VALORACION-QUE-ESCRIBI', authorId: s.id, targetId: otro.id, listingId: ajeno.id, listingTitle: ajeno.title },
    });
    await prisma.review.create({
      data: { rating: 4, comment: 'VALORACION-QUE-RECIBI', authorId: otro.id, targetId: s.id, listingId: anuncio.id, listingTitle: anuncio.title },
    });
    await prisma.deal.create({
      data: { listingTitle: ajeno.title, listingId: ajeno.id, sellerId: otro.id, buyerId: s.id, conversationId: conv.id },
    });

    // ── Denuncias en las dos direcciones ─────────────────────────────────────
    await prisma.report.create({
      data: { reason: 'SPAM', reporterId: s.id, reportedUserId: otro.id, reportedUserName: otro.name, description: 'DENUNCIA-QUE-PUSE' },
    });
    await prisma.report.create({
      data: {
        reason: 'FRAUD',
        reporterId: otro.id,
        reportedUserId: s.id,
        reportedUserName: s.name,
        // El texto libre de OTRA persona, que puede identificarla sola.
        description: 'TEXTO-DEL-DENUNCIANTE: soy tu vecino del tercero',
        resolvedById: staff.id,
      },
    });

    // ── Un ticket: mensaje público + NOTA INTERNA con adjunto ────────────────
    const ticket = await prisma.ticket.create({
      data: { subject: 'Consulta del sujeto', origin: 'USER', userId: s.id, openedById: s.id, assignedToId: staff.id },
    });
    ids.ticket = ticket.id;
    const mensajePublico = await prisma.ticketMessage.create({
      data: { ticketId: ticket.id, authorId: s.id, side: 'USER', body: 'MENSAJE-PUBLICO-DEL-TICKET' },
    });
    const adjuntoKey = 'tickets/c6/adjunto.png';
    await r2.upload(adjuntoKey, TINY_PNG, 'image/png');
    await prisma.ticketAttachment.create({
      data: { ticketMessageId: mensajePublico.id, key: adjuntoKey, filename: 'captura.png', mimeType: 'image/png', sizeBytes: TINY_PNG.byteLength },
    });
    const notaInterna = await prisma.ticketMessage.create({
      data: { ticketId: ticket.id, authorId: staff.id, side: 'STAFF', internal: true, body: 'NOTA-INTERNA-DEL-STAFF' },
    });
    const adjuntoInternoKey = 'tickets/c6/nota-interna.png';
    await r2.upload(adjuntoInternoKey, TINY_PNG, 'image/png');
    await prisma.ticketAttachment.create({
      data: { ticketMessageId: notaInterna.id, key: adjuntoInternoKey, filename: 'INTERNO.png', mimeType: 'image/png', sizeBytes: TINY_PNG.byteLength },
    });

    // ── Una factura con su PDF REAL en el bucket ─────────────────────────────
    const facturaKey = 'facturas/c6-factura.pdf';
    await r2.upload(facturaKey, TINY_PDF, 'application/pdf');
    const factura = await prisma.invoice.create({
      data: {
        userId: s.id, origin: 'ADMIN', status: 'ISSUED', number: 'C6-2026-000001',
        receiverTaxId: '12345678Z', receiverName: 'Nombre Fiscal Real',
        subtotalNet: new Prisma.Decimal('8.26'), totalTax: new Prisma.Decimal('1.73'), totalGross: new Prisma.Decimal('9.99'),
        issuedAt: new Date(), pdfKey: facturaKey,
      },
    });
    ids.factura = factura.id;

    // ── Facturación: suscripción, transacción, entitlement ───────────────────
    const sub = await prisma.subscription.create({
      data: { userId: s.id, priceId, status: 'ACTIVE', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 24 * 3_600_000), gatewaySubscriptionId: `sub_c6_${s.id}` },
    });
    await prisma.transaction.create({
      data: { userId: s.id, priceId, amountGross: new Prisma.Decimal('9.99'), amountNet: new Prisma.Decimal('8.26'), taxAmount: new Prisma.Decimal('1.73'), taxRate: new Prisma.Decimal('0.2100'), status: 'SUCCEEDED', subscriptionId: sub.id },
    });
    await prisma.entitlement.create({
      data: { userId: s.id, type: 'PRO_SUBSCRIPTION', subscriptionId: sub.id },
    });

    // ── Monedero con LOS DOS libros mayores ──────────────────────────────────
    const wallet = await prisma.wallet.create({ data: { userId: s.id, balance: 120, bumpBalance: 5 } });
    const asiento = await prisma.creditLedger.create({
      data: { walletId: wallet.id, type: 'PACK_PURCHASE', amount: 120, note: 'ASIENTO-DE-CREDITOS' },
    });
    await prisma.bumpLedger.create({
      data: { walletId: wallet.id, type: 'PACK_PURCHASE', amount: 5, note: 'ASIENTO-DE-BUMPS' },
    });

    // ── Cupón, favorito, alerta, notificación, proveedor ─────────────────────
    const coupon = await prisma.coupon.create({
      data: { code: 'C6-EXPORTACION', rewardType: 'CREDITS', creditAmount: 10, startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 86_400_000) },
    });
    await prisma.couponRedemption.create({
      data: { couponId: coupon.id, userId: s.id, referenceType: 'CreditLedger', referenceId: asiento.id },
    });
    await prisma.favorite.create({ data: { userId: s.id, listingId: ajeno.id } });
    await prisma.alert.create({ data: { userId: s.id, name: 'ALERTA-GUARDADA', q: 'bici' } });
    await prisma.notification.create({ data: { userId: s.id, type: 'ALERT_MATCH', data: { alertName: 'ALERTA-GUARDADA' } } });
    await prisma.account.create({
      data: { userId: s.id, provider: 'google', providerAccountId: `c6-${s.id}` },
    });

    // Un rastro de auditoría SUYO, con IP dentro: existe antes de exportar, para
    // que la barrera 2 pueda afirmar que aun existiendo no sale.
    await prisma.auditLog.create({
      data: { action: 'RASTRO-INTERNO-C6', actorId: s.id, resourceType: 'User', resourceId: s.id, ip: '9.9.9.9' },
    });

    // ── LA EXPORTACIÓN, DE VERDAD ────────────────────────────────────────────
    // Se pide por la puerta real (el endpoint del usuario) y se ejecuta el
    // trabajo a mano, porque la cola está en pausa. Lo que se abre después es el
    // ZIP que se subió al bucket, no un objeto en memoria.
    const res = await request(app.getHttpServer())
      .post('/api/users/me/export')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    ids.exportacion = res.body.id as string;

    await dataExport.buildExport(ids.exportacion);

    const fila = await prisma.dataExport.findUniqueOrThrow({ where: { id: ids.exportacion } });
    const buffer = await r2.download(fila.key as string);
    zip = await JSZip.loadAsync(buffer);
    datos = JSON.parse(await zip.file('datos.json')!.async('string')) as Record<string, any>;
    leeme = await zip.file('LEEME.txt')!.async('string');
  }, 180_000);

  afterAll(async () => {
    await queue.resume();
    await app.close();
    await prisma.$disconnect();
  });

  // ── EL FLUJO ──────────────────────────────────────────────────────────────

  it('la solicitud ENCOLA y no trabaja: la fila nace PENDING y hay un job esperando', async () => {
    // Este test mira el estado que dejó el `beforeAll` ANTES de que se llamara a
    // `buildExport` a mano — el job sigue en la cola pausada, sin consumir.
    const jobs = await getExistingJobs(queue, ESTADOS_EN_VUELO);
    const suyo = jobs.filter((j) => j.data?.exportId === ids.exportacion);
    expect(suyo.length).toBeGreaterThanOrEqual(1);
  });

  it('el ZIP tiene las tres piezas del §7.1: datos.json, LEEME.txt y ficheros/', async () => {
    expect(zip.file('datos.json')).not.toBeNull();
    expect(zip.file('LEEME.txt')).not.toBeNull();
    expect(Object.keys(zip.files).some((r) => r.startsWith('ficheros/'))).toBe(true);
  });

  // ── BARRERA 1 · EL ALCANCE COMPLETO (§7.2) ────────────────────────────────

  it('BARRERA 1 · están TODAS las secciones del §7.2, ninguna vacía por olvido', () => {
    // Enumeradas a mano y no derivadas de `Object.keys(datos)`: derivarlas haría
    // que borrar una sección del colector borrara también su comprobación.
    for (const seccion of [
      'perfil', 'datosFiscales', 'anuncios', 'conversaciones',
      'valoracionesEmitidas', 'valoracionesRecibidas', 'tratos', 'tickets',
      'facturas', 'transacciones', 'suscripciones', 'entitlements', 'monedero',
      'canjesDeCupon', 'favoritos', 'alertas', 'notificaciones',
      'proveedoresVinculados', 'denunciasEmitidas', 'denunciasRecibidas',
    ]) {
      expect(datos[seccion]).toBeDefined();
    }

    expect(datos.perfil.email).toBe(sujeto.email);
    expect(datos.perfil.bio).toBe('Mi biografía');
    expect(datos.perfil.lastLoginIp).toBe('10.1.2.3');
    expect(datos.datosFiscales.fiscalTaxId).toBe('12345678Z');
    expect(datos.anuncios).toHaveLength(1);
    expect(datos.anuncios[0].attributes).toEqual({ marca: 'Acme', modelo: 'X1' });
    expect(datos.anuncios[0].viewsDaily[0].count).toBe(7);
    expect(datos.anuncios[0].impressionsDaily[0].count).toBe(99);
    expect(datos.valoracionesEmitidas[0].comment).toBe('VALORACION-QUE-ESCRIBI');
    expect(datos.valoracionesRecibidas[0].comment).toBe('VALORACION-QUE-RECIBI');
    expect(datos.tratos.comoComprador).toHaveLength(1);
    expect(datos.facturas[0].number).toBe('C6-2026-000001');
    expect(datos.transacciones).toHaveLength(1);
    expect(datos.suscripciones).toHaveLength(1);
    expect(datos.entitlements).toHaveLength(1);
    expect(datos.canjesDeCupon[0].coupon.code).toBe('C6-EXPORTACION');
    expect(datos.favoritos).toHaveLength(1);
    expect(datos.alertas[0].name).toBe('ALERTA-GUARDADA');
    expect(datos.notificaciones).toHaveLength(1);
    expect(datos.proveedoresVinculados[0].provider).toBe('google');
  });

  it('BARRERA 1 · el monedero va con LOS DOS libros mayores, no sólo el saldo', () => {
    expect(datos.monedero.saldoCreditos).toBe(120);
    expect(datos.monedero.saldoBumps).toBe(5);
    expect(datos.monedero.movimientosDeCreditos[0].note).toBe('ASIENTO-DE-CREDITOS');
    expect(datos.monedero.movimientosDeBumps[0].note).toBe('ASIENTO-DE-BUMPS');
  });

  it('BARRERA 1 · los FICHEROS están de verdad: avatar, foto del anuncio, PDF de la factura y adjunto', async () => {
    const rutas = Object.keys(zip.files);

    const avatar = rutas.find((r) => r.startsWith('ficheros/avatar'));
    expect(avatar).toBeDefined();

    const foto = rutas.find((r) => r.startsWith(`ficheros/anuncios/${ids.anuncio}/`));
    expect(foto).toBeDefined();

    // El PDF es la razón entera de que esto sea un ZIP y no un JSON (§7.1): se
    // comprueba que el contenido es el del bucket, no un enlace ni un hueco.
    const pdf = zip.file('ficheros/facturas/C6-2026-000001.pdf');
    expect(pdf).not.toBeNull();
    expect(Buffer.from(await pdf!.async('nodebuffer')).toString('utf8')).toContain('%PDF-1.4');

    expect(zip.file(`ficheros/tickets/${ids.ticket}/captura.png`)).not.toBeNull();
  });

  // ── BARRERA 2 · LAS EXCLUSIONES (§7.2) ────────────────────────────────────

  it('BARRERA 2 · los SECRETOS no salen: ni passwordHash ni tokenVersion, en ninguna parte del ZIP', async () => {
    expect(datos.perfil.passwordHash).toBeUndefined();
    expect(datos.perfil.tokenVersion).toBeUndefined();

    // Y no sólo en `perfil`: se barre el JSON entero, porque una relación anidada
    // podría arrastrar el usuario completo sin que nadie lo mirara.
    const crudo = await zip.file('datos.json')!.async('string');
    expect(crudo).not.toContain('passwordHash');
    expect(crudo).not.toContain('tokenVersion');
    expect(crudo).not.toContain('$2b$'); // el prefijo de un hash bcrypt
  });

  it('BARRERA 2 · las NOTAS INTERNAS del staff no existen para el usuario — ni el texto ni su adjunto', async () => {
    const crudo = await zip.file('datos.json')!.async('string');
    expect(crudo).not.toContain('NOTA-INTERNA-DEL-STAFF');

    // El mensaje público sí, para que quede claro que el filtro es del `internal`
    // y no de que el hilo entero se haya caído.
    expect(crudo).toContain('MENSAJE-PUBLICO-DEL-TICKET');

    // El adjunto de la nota interna tampoco puede colarse: cuelga de un mensaje
    // que el `where` ya descartó, así que no hay de dónde sacarlo.
    expect(Object.keys(zip.files).some((r) => r.includes('INTERNO.png'))).toBe(false);
  });

  it('BARRERA 2 · el AuditLog no entra AUNQUE EXISTA: es rastro de seguridad interno', async () => {
    // La fila existe y es suya (se creó en el fixture, antes de exportar), así que
    // esto no pasa por vacío: pasa porque el colector no la mira.
    const rastro = await prisma.auditLog.count({ where: { action: 'RASTRO-INTERNO-C6' } });
    expect(rastro).toBe(1);

    const crudo = await zip.file('datos.json')!.async('string');
    expect(crudo).not.toContain('RASTRO-INTERNO-C6');
    expect(crudo).not.toContain('9.9.9.9');
  });

  // ── BARRERA 3 · EL HILO ENTERO, PERO SIN EL DENUNCIANTE ───────────────────

  /**
   * LA DISTINCIÓN ENTERA DE C6, EN UN SOLO TEST.
   *
   * Los mensajes del OTRO van dentro: el solicitante ya los lee en su bandeja, así
   * que exportarlos no le enseña nada que no pudiera copiar a mano. La identidad de
   * quien le denunció, no: ésa no la ve en ninguna parte, y conocerla habilita
   * represalias. Mismo ZIP, dos criterios opuestos, y el motivo es el mismo en los
   * dos casos — **qué puede ver ya esa persona**.
   */
  it('BARRERA 3 · el hilo va ENTERO, incluida la parte del otro (ya la lee en su bandeja)', () => {
    const hilo = datos.conversaciones[0];
    const cuerpos = hilo.messages.map((m: { body: string }) => m.body);
    expect(cuerpos).toContain('MENSAJE-MIO: me interesa');
    expect(cuerpos).toContain('MENSAJE-DEL-OTRO: sigue disponible');
    // Y con el nombre de quien lo escribió: un hilo sin autores es ilegible.
    expect(hilo.messages.some((m: { sender: { name: string } }) => m.sender.name === denunciante.name)).toBe(true);
  });

  it('BARRERA 3 · de la denuncia RECIBIDA va el hecho, NUNCA el nombre de quien la puso', async () => {
    const recibida = datos.denunciasRecibidas[0];

    // El hecho: tiene derecho a saber de qué se le acusó.
    expect(recibida.reason).toBe('FRAUD');
    expect(recibida.status).toBeDefined();
    expect(recibida.createdAt).toBeDefined();

    // El nombre, no. Ni el id, ni el objeto, ni el texto libre que escribió —
    // porque ese texto puede identificarle solo.
    expect(recibida.reporter).toBeUndefined();
    expect(recibida.reporterId).toBeUndefined();
    expect(recibida.description).toBeUndefined();

    const crudo = await zip.file('datos.json')!.async('string');
    expect(crudo).not.toContain('TEXTO-DEL-DENUNCIANTE');

    // Y la comprobación que de verdad muerde: el nombre del denunciante aparece
    // en el ZIP SÓLO por el hilo de mensajes (donde es legítimo), nunca colgando
    // de la denuncia.
    const denunciaSerializada = JSON.stringify(datos.denunciasRecibidas);
    expect(denunciaSerializada).not.toContain(denunciante.name);
    expect(denunciaSerializada).not.toContain(denunciante.id);
  });

  it('BARRERA 3 · la denuncia que PUSO ÉL sí va entera: es lo que escribió', () => {
    const emitida = datos.denunciasEmitidas[0];
    expect(emitida.reason).toBe('SPAM');
    expect(emitida.description).toBe('DENUNCIA-QUE-PUSE');
    // A quién denunció sí lo sabe: lo eligió él.
    expect(emitida.reportedUserName).toBe(denunciante.name);
  });

  // ── EL LÉEME ──────────────────────────────────────────────────────────────

  it('el LEEME explica en español qué hay y, sobre todo, qué NO hay y por qué', () => {
    expect(leeme).toContain('EXPORTACIÓN DE TUS DATOS');
    expect(leeme).toContain('datos.json');
    expect(leeme).toContain('Quién te denunció');
    expect(leeme).toContain('notas internas del equipo');
  });
});
