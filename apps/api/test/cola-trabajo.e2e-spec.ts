import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import * as bcrypt from 'bcrypt';

/**
 * NOTIFICACIONES N6 — LA COLA DE TRABAJO DEL BACKOFFICE (Parte B).
 *
 * Otro modelo que el resto del encargo: no un buzón dirigido, sino ESTADO AGREGADO
 * —«¿qué queda por hacer?»— derivado de las tablas en cada carga.
 *
 * ── LA BARRERA QUE IMPORTA ES EL INVARIANTE ────────────────────────────────
 *
 * Se sirve a TODO el staff sin filtrar por sección, y **lo que hace segura esa
 * decisión es que aquí sólo salen números**. El día que alguien añada «último
 * ticket: <asunto>», la decisión de no filtrar por rol deja de ser inocua. Por eso
 * hay un test que recorre la respuesta entera y falla si aparece algo que no sea
 * un número o un booleano.
 */
describe('Cola de trabajo del backoffice (N6) e2e', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let server: ReturnType<INestApplication['getHttpServer']>;

  let categoryId: string;
  let vendedor: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanDb(prisma);
    categoryId = (await prisma.category.findFirstOrThrow()).id;
    vendedor = (await crearUsuario(Role.USER)).id;
  });

  /** Con contraseña: el token se saca por el login real, como el resto de specs. */
  async function crearUsuario(role: Role) {
    const id = randomUUID().slice(0, 8);
    const email = `cola-${id}@test.local`;
    const user = await prisma.user.create({
      data: {
        email,
        name: `Cola ${id}`,
        slug: `cola-${id}`,
        role,
        passwordHash: await bcrypt.hash('Test1234!', 4),
        emailVerified: true,
      },
    });
    return { ...user, password: 'Test1234!' };
  }

  /** El staff entra por `admin-login`; un usuario normal, por el login corriente. */
  async function tokenDe(user: { email: string; role: Role }) {
    const ruta = user.role === Role.USER ? '/api/auth/login' : '/api/auth/admin-login';
    const res = await request(server).post(ruta).send({ email: user.email, password: 'Test1234!' });
    return res.body.accessToken as string;
  }

  async function anuncio(extra: Record<string, unknown> = {}) {
    return prisma.listing.create({
      data: {
        title: 'Bici de carretera',
        slug: `cola-${randomUUID().slice(0, 8)}`,
        description: 'descripción',
        price: 100,
        type: 'PRODUCT',
        sellerId: vendedor,
        categoryId,
        status: 'ACTIVE',
        ...extra,
      },
    });
  }

  function pedirCola(token: string) {
    return request(server)
      .get('/api/admin/work-queue')
      .set('Authorization', `Bearer ${token}`);
  }

  async function colaComoAdmin() {
    const admin = await crearUsuario(Role.ADMIN);
    const res = await pedirCola(await tokenDe(admin)).expect(200);
    return res.body;
  }

  // ===========================================================================
  // BARRERA 1 — los contadores cuentan bien
  // ===========================================================================

  describe('BARRERA 1 — cada contador cuenta lo suyo', () => {
    it('el triaje: NEW y EDITED por separado (el «revisado interno» YA existía)', async () => {
      await anuncio({ triage: 'NEW' });
      await anuncio({ triage: 'NEW' });
      await anuncio({ triage: 'EDITED' });
      await anuncio({ triage: 'REVIEWED' });

      const cola = await colaComoAdmin();
      expect(cola.moderacion.sinTriar).toBe(2);
      expect(cola.moderacion.editadosTrasRevisar).toBe(1);
    });

    it('los vigilados, y los pendientes de revisión', async () => {
      await anuncio({ watched: true });
      await anuncio({ status: 'PENDING_REVIEW' });

      const cola = await colaComoAdmin();
      expect(cola.moderacion.enObservacion).toBe(1);
      expect(cola.moderacion.pendientesRevision).toBe(1);
    });

    /**
     * «Detección sin atender» se compone de dos ejes que sí existen, porque
     * `ListingDetection` no tiene campo de atendido: el motor encontró algo Y nadie
     * lo ha mirado. Un anuncio ya REVIEWED con detección NO cuenta — un humano lo
     * dio por bueno sabiendo lo que había.
     */
    it('las detecciones sólo cuentan si NADIE las ha mirado', async () => {
      const sinMirar = await anuncio({ triage: 'NEW' });
      const yaMirado = await anuncio({ triage: 'REVIEWED' });
      for (const listingId of [sinMirar.id, yaMirado.id]) {
        await prisma.listingDetection.create({
          data: { listingId, detector: 'WORD', field: 'TITLE', match: 'x' },
        });
      }

      expect((await colaComoAdmin()).moderacion.conDeteccionSinMirar).toBe(1);
    });

    it('los tickets: sin asignar, esperando al equipo y estancados', async () => {
      const dueno = await crearUsuario(Role.USER);
      const viejo = new Date(Date.now() - 48 * 3600_000);

      await prisma.ticket.create({
        data: { origin: 'USER', openedById: dueno.id, userId: dueno.id, subject: 'Sin asignar', status: 'OPEN' },
      });
      await prisma.ticket.create({
        data: { origin: 'USER', openedById: dueno.id, userId: dueno.id, subject: 'Estancado', status: 'OPEN', lastMessageAt: viejo },
      });
      // WAITING_USER NO cuenta: ahí se espera al usuario, no al equipo.
      await prisma.ticket.create({
        data: { origin: 'USER', openedById: dueno.id, userId: dueno.id, subject: 'Pelota fuera', status: 'WAITING_USER' },
      });

      const cola = await colaComoAdmin();
      expect(cola.atencion.ticketsSinAsignar).toBe(2);
      expect(cola.atencion.ticketsEsperandoStaff).toBe(2);
      expect(cola.atencion.ticketsEstancados).toBe(1);
    });

    it('los mensajes de contacto sin atender', async () => {
      const motivo = await prisma.contactReason.create({
        data: { nombre: 'Dudas', orden: 1 },
      });
      await prisma.contactMessage.create({
        data: { motivoId: motivo.id, email: 'a@b.c', mensaje: 'Hola', estado: 'NUEVO' },
      });
      await prisma.contactMessage.create({
        data: { motivoId: motivo.id, email: 'd@e.f', mensaje: 'Ya visto', estado: 'LEIDO' },
      });

      expect((await colaComoAdmin()).atencion.contactoSinAtender).toBe(1);
    });

    /**
     * EL HALLAZGO DE LA AUDITORÍA: sin `supportEmail` configurado,
     * `TicketNotificationsService` emite un `logger.warn` y NO manda el correo al
     * buzón de soporte. Nadie lee ese log, así que el equipo cree tener un canal
     * que no tiene. El contador es lo que lo hace visible.
     */
    it('el buzón de soporte sin configurar SE VE', async () => {
      await prisma.setting.deleteMany({ where: { key: 'supportEmail' } });
      expect((await colaComoAdmin()).plataforma.buzonSoporteSinConfigurar).toBe(true);

      await prisma.setting.create({ data: { key: 'supportEmail', value: 'soporte@test.local' } });
      expect((await colaComoAdmin()).plataforma.buzonSoporteSinConfigurar).toBe(false);
    });
  });

  // ===========================================================================
  // BARRERA 2 — sin filtro por rol
  // ===========================================================================

  it('BARRERA 2 — un EDITOR (el piso más bajo del staff) ve TODOS los contadores', async () => {
    await anuncio({ triage: 'NEW' });
    const editor = await crearUsuario(Role.EDITOR);

    const res = await pedirCola(await tokenDe(editor)).expect(200);

    // Ve las tres áreas, incluidas las que no puede administrar.
    expect(res.body.moderacion.sinTriar).toBe(1);
    expect(res.body.atencion).toBeDefined();
    expect(res.body.plataforma).toBeDefined();
  });

  it('BARRERA 2b — pero un usuario normal NO entra', async () => {
    const cualquiera = await crearUsuario(Role.USER);
    await pedirCola(await tokenDe(cualquiera)).expect(403);
  });

  // ===========================================================================
  // BARRERA 3 — EL INVARIANTE: sólo números, nunca contenido
  // ===========================================================================

  /**
   * LO QUE HACE SEGURA LA DECISIÓN DE NO FILTRAR POR ROL.
   *
   * «7 tickets sin asignar» no filtra nada de nadie. «El ticket de Juan sobre su
   * factura», sí — y a un EDITOR que no tiene acceso a facturación. Este test
   * recorre la respuesta ENTERA y falla si aparece cualquier cosa que no sea un
   * número o un booleano: no hay que acordarse del invariante, se rompe solo.
   */
  it('BARRERA 3 — la respuesta entera son NÚMEROS, jamás contenido', async () => {
    // Datos con contenido reconocible en todas las áreas: si algo se colara, se vería.
    const dueno = await crearUsuario(Role.USER);
    await anuncio({ title: 'TITULO-QUE-NO-DEBE-SALIR', triage: 'NEW', watched: true });
    await prisma.ticket.create({
      data: { origin: 'USER', openedById: dueno.id, userId: dueno.id, subject: 'ASUNTO-QUE-NO-DEBE-SALIR', status: 'OPEN' },
    });
    const motivo = await prisma.contactReason.create({ data: { nombre: 'Dudas', orden: 1 } });
    await prisma.contactMessage.create({
      data: {
        motivoId: motivo.id,
        email: 'CORREO-QUE-NO-DEBE-SALIR@test.local',
        mensaje: 'MENSAJE-QUE-NO-DEBE-SALIR',
        estado: 'NUEVO',
      },
    });

    const cola = await colaComoAdmin();

    // 1. Ni un solo valor que no sea número o booleano, a cualquier profundidad.
    const hojas: unknown[] = [];
    const recorrer = (v: unknown) => {
      if (v !== null && typeof v === 'object') Object.values(v).forEach(recorrer);
      else hojas.push(v);
    };
    recorrer(cola);
    expect(hojas.length).toBeGreaterThan(0);
    for (const hoja of hojas) {
      expect(['number', 'boolean']).toContain(typeof hoja);
    }

    // 2. Y ninguno de los contenidos sembrados aparece en la respuesta serializada.
    const serializada = JSON.stringify(cola);
    for (const secreto of [
      'TITULO-QUE-NO-DEBE-SALIR',
      'ASUNTO-QUE-NO-DEBE-SALIR',
      'CORREO-QUE-NO-DEBE-SALIR',
      'MENSAJE-QUE-NO-DEBE-SALIR',
    ]) {
      expect(serializada).not.toContain(secreto);
    }
  });

  // ===========================================================================
  // BARRERA 5 — on-demand, no almacenado
  // ===========================================================================

  /**
   * No hay contador que mantener: el número sale de un `COUNT` en cada carga. Se
   * comprueba cambiando el estado POR DETRÁS (sin pasar por ningún servicio que
   * pudiera actualizar un contador) y viendo que la cola ya lo refleja.
   */
  it('BARRERA 5 — el contador es derivado: cambiar la tabla por detrás se ve al instante', async () => {
    const l = await anuncio({ triage: 'NEW' });
    expect((await colaComoAdmin()).moderacion.sinTriar).toBe(1);

    await prisma.listing.update({ where: { id: l.id }, data: { triage: 'REVIEWED' } });

    expect((await colaComoAdmin()).moderacion.sinTriar).toBe(0);
  });
});
