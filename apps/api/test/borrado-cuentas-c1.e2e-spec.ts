import { INestApplication } from '@nestjs/common';
import { PrismaClient, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';

// El gate de Google es uno de los TRES sitios donde se mira el estado, así que hay
// que ejercitarlo — y sin salir a la red. Mismo mock que `social-auth.e2e-spec.ts`.
const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({
    verifyIdToken: mockVerifyIdToken,
  })),
}));

/**
 * BORRADO DE CUENTAS — C1: EL MODELO Y LA PUERTA.
 *
 * C1 NO ARCHIVA NI ELIMINA NADA: no hay ninguna operación que escriba `ARCHIVED` ni
 * `DELETED`. Lo que hace es dejarlos REPRESENTABLES y armar las puertas, para que C2
 * y C5 se apoyen en algo ya probado. Por eso esta suite escribe los estados **a
 * mano** con Prisma: es exactamente lo que hará el servicio de C2, y probarlo ahora
 * es lo que permite que C2 no tenga que probar la puerta otra vez.
 *
 * Barreras (diseño §8.1 C1):
 *   1. ARCHIVED y DELETED → 403 en los TRES gates.
 *   3. `forgotPassword` no encola para ninguno de los cuatro no-ACTIVE, y sigue
 *      devolviendo `{ ok: true }`.
 *   4. Los ocho `Restrict` BLOQUEAN de verdad, y el dato del tercero sobrevive.
 *
 * (La barrera 2 —las transiciones— vive en `src/modules/users/user-status.transitions.spec.ts`:
 * el fichero es puro y no necesita levantar la aplicación.)
 */
describe('Borrado de cuentas C1 — el modelo y la puerta (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const PASSWORD = 'Test1234!';
  let hash: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);
    hash = await bcrypt.hash(PASSWORD, 4);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => {
    mockVerifyIdToken.mockReset();
  });

  /** Crea un usuario con contraseña, verificado, en el estado que se le pida. */
  async function crearUsuario(marca: string, status: UserStatus = 'ACTIVE') {
    return prisma.user.create({
      data: {
        email: `c1-${marca}@example.com`,
        name: `C1 ${marca}`,
        slug: `c1-${marca}`,
        passwordHash: hash,
        emailVerified: true,
        status,
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  //  BARRERA 1 — los tres gates
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Barrera 1 — ARCHIVED y DELETED no entran por ninguna de las tres puertas', () => {
    // ── Puerta 2: login con correo ───────────────────────────────────────────
    it.each([
      ['ARCHIVED', 'archivada'],
      ['DELETED', 'eliminado'],
    ] as [UserStatus, string][])(
      'POST /api/auth/login con cuenta %s → 403 (la contraseña es CORRECTA; lo que falla es la cuenta)',
      async (status, fragmento) => {
        const user = await crearUsuario(`login-${status.toLowerCase()}`, status);

        const res = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: user.email, password: PASSWORD })
          .expect(403);

        // 403 y no 401 — mismo criterio que SUSPENDED/BANNED — y con un motivo
        // propio, no el de una suspensión.
        expect(String(res.body.message).toLowerCase()).toContain(fragmento);
      },
    );

    it('los cuatro estados no-ACTIVE dan 403 en el login; el ACTIVE entra', async () => {
      const activo = await crearUsuario('login-control');
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: activo.email, password: PASSWORD })
        .expect(200);

      for (const status of ['SUSPENDED', 'BANNED', 'ARCHIVED', 'DELETED'] as UserStatus[]) {
        const u = await crearUsuario(`login-todos-${status.toLowerCase()}`, status);
        await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: u.email, password: PASSWORD })
          .expect(403);
      }
    });

    // ── Puerta 1: el guard, en CADA petición autenticada ─────────────────────
    it.each(['ARCHIVED', 'DELETED'] as UserStatus[])(
      'un token emitido ANTES de pasar a %s deja de valer en la siguiente petición',
      async (status) => {
        const user = await crearUsuario(`guard-${status.toLowerCase()}`);

        const login = await request(app.getHttpServer())
          .post('/api/auth/login')
          .send({ email: user.email, password: PASSWORD })
          .expect(200);
        const token = login.body.accessToken as string;

        // El token funciona mientras la cuenta está viva.
        await request(app.getHttpServer())
          .get('/api/users/me')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        // C2 hará esto por su cuenta; aquí se escribe a mano, que es lo que C1 prueba.
        await prisma.user.update({ where: { id: user.id }, data: { status } });

        // Sin tocar el token: el guard lee el estado FRESCO de la base en cada
        // petición, así que no hace falta invalidar nada para cerrar el acceso.
        await request(app.getHttpServer())
          .get('/api/users/me')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);
      },
    );

    // ── Puerta 3: login con Google ───────────────────────────────────────────
    it.each(['ARCHIVED', 'DELETED'] as UserStatus[])(
      'POST /api/auth/social/google con cuenta %s → 403 (la puerta social no es un atajo)',
      async (status) => {
        const user = await crearUsuario(`google-${status.toLowerCase()}`, status);

        mockVerifyIdToken.mockResolvedValue({
          getPayload: () => ({
            sub: `google-sub-${status}`,
            email: user.email,
            email_verified: true,
            name: user.name,
          }),
        });

        await request(app.getHttpServer())
          .post('/api/auth/social/google')
          .send({ idToken: 'valid-token' })
          .expect(403);
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  BARRERA 3 — forgotPassword (D-18)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Barrera 3 — a una cuenta cerrada no se le escribe, y no se nota', () => {
    /**
     * `createResetToken` escribe la fila ANTES de encolar el correo, así que «no hay
     * fila» es exactamente «no se encoló». Se comprueba en la base y no espiando la
     * cola: es la misma evidencia y no depende de cómo esté cableado BullMQ.
     */
    async function pedirReset(email: string, ip: string) {
      return request(app.getHttpServer())
        .post('/api/auth/forgot-password')
        // Una IP distinta por caso: el rate limit por IP es de 5/hora y aquí hay
        // cinco llamadas. Lo que se prueba es el gate, no el limitador.
        .set('X-Forwarded-For', ip)
        .send({ email })
        .expect(200);
    }

    it('el control: una cuenta ACTIVE SÍ recibe su token (el mecanismo funciona)', async () => {
      const user = await crearUsuario('forgot-activa');
      const res = await pedirReset(user.email, '10.10.0.1');

      expect(res.body).toEqual({ ok: true });
      expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(1);
    });

    it.each(['SUSPENDED', 'BANNED', 'ARCHIVED', 'DELETED'] as UserStatus[])(
      'una cuenta %s NO recibe correo — y la respuesta es idéntica a la de una cuenta viva',
      async (status) => {
        const ips: Record<string, string> = {
          SUSPENDED: '10.10.0.2',
          BANNED: '10.10.0.3',
          ARCHIVED: '10.10.0.4',
          DELETED: '10.10.0.5',
        };
        const user = await crearUsuario(`forgot-${status.toLowerCase()}`, status);

        const res = await pedirReset(user.email, ips[status]);

        // LA MITAD QUE IMPORTA TANTO COMO LA OTRA: sigue siendo `{ ok: true }`, así
        // que quien pruebe un correo no puede distinguir «no existe» de «existe pero
        // está cerrada» de «existe y ya tiene su correo en camino».
        expect(res.body).toEqual({ ok: true });
        expect(await prisma.passwordResetToken.count({ where: { userId: user.id } })).toBe(0);
      },
    );
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  BARRERA 4 — los ocho Restrict
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * LA SALVAGUARDA, PROBADA POR LO QUE IMPIDE. Antes de C1 estas ocho relaciones eran
   * `Cascade`: borrar una cuenta se llevaba por delante las valoraciones que esa
   * persona había ESCRITO —la reputación de terceros—, los tratos de la otra parte y
   * los hilos de soporte con sus mensajes de staff.
   *
   * Cada caso hace lo mismo: crea el dato, intenta borrar al usuario, y afirma las
   * DOS cosas — que el borrado se rechaza y que **el dato del tercero sigue ahí**.
   * La segunda es la que de verdad describe el defecto: sin el `Restrict`, el borrado
   * habría funcionado y el dato habría desaparecido.
   */
  describe('Barrera 4 — los ocho Restrict bloquean, y lo del tercero sobrevive', () => {
    it('Review.authorId — borrar al AUTOR no puede destruir la reputación de otro', async () => {
      const autor = await crearUsuario('rev-autor');
      const objetivo = await crearUsuario('rev-objetivo');
      const review = await prisma.review.create({
        data: { rating: 5, comment: 'Todo perfecto', authorId: autor.id, targetId: objetivo.id },
      });

      await expect(prisma.user.delete({ where: { id: autor.id } })).rejects.toThrow();
      expect(await prisma.review.findUnique({ where: { id: review.id } })).not.toBeNull();
    });

    it('Review.targetId — borrar al VALORADO no puede destruir el testimonio de quien la escribió', async () => {
      const autor = await crearUsuario('rev2-autor');
      const objetivo = await crearUsuario('rev2-objetivo');
      const review = await prisma.review.create({
        data: { rating: 2, authorId: autor.id, targetId: objetivo.id },
      });

      await expect(prisma.user.delete({ where: { id: objetivo.id } })).rejects.toThrow();
      expect(await prisma.review.findUnique({ where: { id: review.id } })).not.toBeNull();
    });

    it.each([
      ['sellerId', 'vendedor'],
      ['buyerId', 'comprador'],
    ])('Deal.%s — el trato es de dos, y es la evidencia de Review.verified', async (campo) => {
      const vendedor = await crearUsuario(`deal-${campo}-v`);
      const comprador = await crearUsuario(`deal-${campo}-c`);
      const deal = await prisma.deal.create({
        data: { listingTitle: 'Bici de montaña', sellerId: vendedor.id, buyerId: comprador.id },
      });

      const victima = campo === 'sellerId' ? vendedor : comprador;
      await expect(prisma.user.delete({ where: { id: victima.id } })).rejects.toThrow();
      expect(await prisma.deal.findUnique({ where: { id: deal.id } })).not.toBeNull();
    });

    it('Ticket.userId — el hilo tiene dos lados; llevárselo se llevaba los mensajes del staff', async () => {
      const usuario = await crearUsuario('ticket-usuario');
      const agente = await crearUsuario('ticket-agente');
      const ticket = await prisma.ticket.create({
        data: {
          subject: 'No puedo publicar',
          origin: 'USER',
          userId: usuario.id,
          openedById: usuario.id,
          assignedToId: agente.id,
        },
      });
      const mensajeDelStaff = await prisma.ticketMessage.create({
        data: { ticketId: ticket.id, authorId: agente.id, side: 'STAFF', body: 'Lo miramos' },
      });

      await expect(prisma.user.delete({ where: { id: usuario.id } })).rejects.toThrow();
      expect(await prisma.ticket.findUnique({ where: { id: ticket.id } })).not.toBeNull();
      expect(
        await prisma.ticketMessage.findUnique({ where: { id: mensajeDelStaff.id } }),
      ).not.toBeNull();
    });

    it('Entitlement.userId — «nunca se borra una fila de esta tabla», ahora también en la constraint', async () => {
      const user = await crearUsuario('ent-user');
      const ent = await prisma.entitlement.create({
        data: { userId: user.id, type: 'PRO_SUBSCRIPTION' },
      });

      await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow();
      expect(await prisma.entitlement.findUnique({ where: { id: ent.id } })).not.toBeNull();
    });

    it('CouponRedemption.userId — borrarlo liberaría el @@unique y el cupón se podría recanjear', async () => {
      const user = await crearUsuario('cupon-user');
      const coupon = await prisma.coupon.create({
        data: {
          code: 'C1-BARRERA',
          rewardType: 'CREDITS',
          creditAmount: 10,
          startsAt: new Date(Date.now() - 1000),
          endsAt: new Date(Date.now() + 86_400_000),
        },
      });
      const canje = await prisma.couponRedemption.create({
        data: {
          couponId: coupon.id,
          userId: user.id,
          referenceType: 'CreditLedger',
          referenceId: 'ledger-falso',
        },
      });

      await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow();
      expect(await prisma.couponRedemption.findUnique({ where: { id: canje.id } })).not.toBeNull();
    });

    it('Wallet.userId — el bloqueo deja de depender del accidente de los ledgers', async () => {
      const user = await crearUsuario('wallet-user');
      const wallet = await prisma.wallet.create({ data: { userId: user.id, balance: 25 } });

      // Sin NI UNA entrada de libro mayor: antes de C1 el borrado sólo fallaba si
      // había ledger (Wallet era Cascade y el freno lo ponía CreditLedger). Ahora lo
      // declara la propia relación, que es donde se lee.
      expect(await prisma.creditLedger.count({ where: { walletId: wallet.id } })).toBe(0);

      await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow();
      expect(await prisma.wallet.findUnique({ where: { id: wallet.id } })).not.toBeNull();
    });

    it('un usuario SIN ninguna de las ocho relaciones sí se puede borrar: el Restrict no es un candado general', async () => {
      const suelto = await crearUsuario('sin-relaciones');
      await expect(prisma.user.delete({ where: { id: suelto.id } })).resolves.toBeTruthy();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  El snapshot del denunciado — escrito AL CREAR (molde B1)
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Report.reportedUserName — el sujeto de la denuncia, congelado al crearla', () => {
    it('denunciar a un usuario guarda su nombre, y la denuncia sigue diciendo CONTRA QUIÉN cuando la cuenta se vacía', async () => {
      const denunciante = await crearUsuario('denunciante');
      const denunciado = await crearUsuario('denunciado');

      const login = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: denunciante.email, password: PASSWORD })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/api/moderation/reports')
        .set('Authorization', `Bearer ${login.body.accessToken as string}`)
        .send({ reason: 'SPAM', reportedUserId: denunciado.id, description: 'Publica lo mismo 20 veces' })
        .expect(201);

      const report = await prisma.report.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(report.reportedUserName).toBe(denunciado.name);

      // Y ÉSTE ES EL PUNTO: lo que C5 hará al vaciar la cuenta. Sin el snapshot, la
      // cola de moderación se quedaría diciendo «denuncia contra Usuario eliminado».
      await prisma.user.update({
        where: { id: denunciado.id },
        data: { name: 'Usuario eliminado', status: 'DELETED' },
      });

      const tras = await prisma.report.findUniqueOrThrow({
        where: { id: report.id },
        include: { reportedUser: { select: { name: true } } },
      });
      expect(tras.reportedUser?.name).toBe('Usuario eliminado'); // la relación, anonimizada
      expect(tras.reportedUserName).toBe(denunciado.name); // el snapshot, intacto
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  //  El modelo: las columnas existen y nacen vacías
  // ═══════════════════════════════════════════════════════════════════════════

  describe('El modelo — las columnas nuevas existen, nacen vacías y nadie las escribe todavía', () => {
    it('una cuenta recién creada tiene los siete campos a null y la marca de anuncio a false', async () => {
      const user = await crearUsuario('modelo-limpio');

      expect(user.suspendedUntil).toBeNull();
      expect(user.archivedAt).toBeNull();
      expect(user.archiveReason).toBeNull();
      expect(user.archiveNote).toBeNull();
      expect(user.archivedById).toBeNull();
      expect(user.statusBeforeArchive).toBeNull();
      expect(user.deletedAt).toBeNull();
      expect(user.status).toBe('ACTIVE');
    });

    it('`statusBeforeArchive` guarda un estado de sanción — es el destino de restauración, no un eje', async () => {
      // Lo que C2 escribirá al archivar a un usuario BANNED. Se prueba aquí porque
      // es la columna que impide que desarchivar le lave el ban.
      const user = await crearUsuario('modelo-ban-archivado', 'BANNED');
      const archivado = await prisma.user.update({
        where: { id: user.id },
        data: {
          status: 'ARCHIVED',
          statusBeforeArchive: 'BANNED',
          archivedAt: new Date(),
          archiveReason: 'SELF_REQUEST',
          archiveNote: 'Pidió irse por soporte estando inhabilitado',
        },
      });

      expect(archivado.status).toBe('ARCHIVED');
      expect(archivado.statusBeforeArchive).toBe('BANNED');
      expect(archivado.archiveReason).toBe('SELF_REQUEST');
      // `archivedById` null = lo pidió el usuario. Que sea una columna DISTINTA de
      // `archiveReason` es lo que permite representar «lo pidió él, lo ejecutó el
      // staff» — el caso real de un baneado que ejerce su derecho.
      expect(archivado.archivedById).toBeNull();
    });

    it('C1 NO archiva ni elimina nada: no queda ninguna cuenta en los estados nuevos que no haya puesto un test', async () => {
      // La cuenta del test anterior es la única ARCHIVED, y la puso el test a mano.
      // Ninguna ruta de la aplicación escribe ARCHIVED ni DELETED todavía.
      const archivadas = await prisma.user.findMany({
        where: { status: { in: ['ARCHIVED', 'DELETED'] } },
        select: { email: true },
      });
      for (const { email } of archivadas) {
        expect(email).toMatch(/^c1-/);
      }
    });
  });
});
