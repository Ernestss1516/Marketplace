/**
 * #15 — «SOPORTE PRIORITARIO», DE PROMESA A MECANISMO.
 *
 * `/planes` lo anunciaba incondicionalmente y **el módulo de tickets no consultaba
 * `isProActive` en ningún punto**: no había marca, ni prioridad, ni orden, ni SLA. Era una
 * promesa que sólo podía cumplir una persona acordándose (auditoría §4.4).
 *
 * Lo que se fija aquí:
 *  · la bandeja del staff MARCA los tickets de clientes Pro, y lo hace con el estado de
 *    AHORA — quien dejó de pagar deja de destacar;
 *  · se puede aislar esa cola con un filtro;
 *  · marcar **no es reordenar**: el orden por defecto no cambia. El sistema señala; quien
 *    prioriza sigue siendo una persona;
 *  · y no hay N+1: la marca de una página entera cuesta UNA consulta.
 */
import { INestApplication } from '@nestjs/common';
import { EntitlementType, PrismaClient, ProductType } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { PrismaService } from 'src/infra/prisma/prisma.service';

describe('#15 — la marca de Pro en la bandeja de tickets (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let staffToken: string;
  let proUserId: string;
  let freeUserId: string;
  let exProUserId: string;
  let ticketPro: string;
  let ticketFree: string;
  let ticketExPro: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    const hash = await bcrypt.hash('Test1234!', 4);
    const crearUsuario = (sufijo: string, role: 'USER' | 'MODERATOR' = 'USER') =>
      prisma.user.create({
        data: {
          email: `p15-${sufijo}@example.com`,
          name: `P15 ${sufijo}`,
          slug: `p15-${sufijo}`,
          passwordHash: hash,
          emailVerified: true,
          role,
        },
      });

    const [staff, pro, free, exPro] = await Promise.all([
      crearUsuario('staff', 'MODERATOR'),
      crearUsuario('pro'),
      crearUsuario('free'),
      crearUsuario('expro'),
    ]);
    proUserId = pro.id;
    freeUserId = free.id;
    exProUserId = exPro.id;

    const login = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: staff.email, password: 'Test1234!' });
    staffToken = login.body.accessToken;

    await darPro(pro.id);
    // El ex-Pro tiene un entitlement CADUCADO: la marca tiene que ignorarlo.
    await darPro(exPro.id, new Date(Date.now() - 24 * 60 * 60 * 1000));

    ticketPro = await abrirTicket(pro.id, 'del Pro');
    ticketFree = await abrirTicket(free.id, 'del free');
    ticketExPro = await abrirTicket(exPro.id, 'del ex-Pro');
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function darPro(userId: string, expiresAt?: Date) {
    const price = await prisma.price.findFirstOrThrow({
      where: { product: { type: ProductType.RECURRING } },
    });
    await prisma.entitlement.create({
      data: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        priceId: price.id,
        expiresAt: expiresAt ?? new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      },
    });
  }

  let seq = 0;
  async function abrirTicket(userId: string, asunto: string): Promise<string> {
    seq += 1;
    const t = await prisma.ticket.create({
      data: {
        userId,
        openedById: userId,
        subject: `P15 ticket ${asunto} ${seq}`,
        origin: 'USER',
        status: 'OPEN',
        // ASCENDENTE con `seq`: el primero que se crea es el MÁS ANTIGUO. Lo necesita la
        // barrera del orden — el ticket del Pro se crea el primero, así que en un orden
        // `lastMessageAt desc` le toca ser el ÚLTIMO. Si la marca reordenara, subiría.
        lastMessageAt: new Date(Date.now() - (1000 - seq) * 1000),
      },
      select: { id: true },
    });
    return t.id;
  }

  const bandeja = (query = '') =>
    request(app.getHttpServer())
      .get(`/api/admin/tickets?perPage=100${query}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(200);

  const porId = (body: { items: { id: string; userIsPro: boolean }[] }) =>
    Object.fromEntries(body.items.map((t) => [t.id, t.userIsPro]));

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 1 — la marca
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 1 — la bandeja marca a los clientes Pro', () => {
    it('el ticket de un Pro llega marcado; el de un free, no', async () => {
      const res = await bandeja();
      const marcas = porId(res.body);

      expect(marcas[ticketPro]).toBe(true);
      expect(marcas[ticketFree]).toBe(false);
    });

    it('LA MUTACIÓN: es «Pro AHORA», no «era Pro al abrir el ticket»', async () => {
      // El ex-Pro abrió su ticket con un entitlement que hoy está caducado. Si la marca se
      // congelara al abrir —una columna en `Ticket`—, seguiría destacando para siempre y el
      // staff priorizaría a quien ya no paga.
      const res = await bandeja();

      expect(porId(res.body)[ticketExPro]).toBe(false);
    });

    it('y se mueve con el estado: revocar el Pro apaga la marca de sus tickets viejos', async () => {
      const antes = await bandeja();
      expect(porId(antes.body)[ticketPro]).toBe(true);

      await prisma.entitlement.updateMany({
        where: { userId: proUserId, type: EntitlementType.PRO_SUBSCRIPTION },
        data: { revokedAt: new Date() },
      });

      const despues = await bandeja();
      expect(porId(despues.body)[ticketPro]).toBe(false);

      // Se devuelve como estaba para los tests de abajo.
      await prisma.entitlement.updateMany({
        where: { userId: proUserId, type: EntitlementType.PRO_SUBSCRIPTION },
        data: { revokedAt: null },
      });
      const restaurado = await bandeja();
      expect(porId(restaurado.body)[ticketPro]).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 2 — el filtro
  // ═══════════════════════════════════════════════════════════════════════════

  describe('BARRERA 2 — la cola de Pro se puede aislar', () => {
    it('`soloPro=true` deja solo los de clientes Pro', async () => {
      const res = await bandeja('&soloPro=true');
      const ids = res.body.items.map((t: { id: string }) => t.id);

      expect(ids).toContain(ticketPro);
      expect(ids).not.toContain(ticketFree);
      expect(ids).not.toContain(ticketExPro);
      // Y lo que queda está marcado, por construcción.
      expect(res.body.items.every((t: { userIsPro: boolean }) => t.userIsPro)).toBe(true);
    });

    it('sin el filtro salen todos', async () => {
      const res = await bandeja();
      const ids = res.body.items.map((t: { id: string }) => t.id);

      expect(ids).toEqual(expect.arrayContaining([ticketPro, ticketFree, ticketExPro]));
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 3 — marcar NO es reordenar
  // ═══════════════════════════════════════════════════════════════════════════

  it('BARRERA 3 — el orden por defecto NO cambia: el sistema señala, la persona prioriza', async () => {
    // Es la línea que separa esto de un SLA. El ticket del Pro es el MÁS ANTIGUO de los
    // tres (se crea el primero, ver `abrirTicket`), así que en el orden de siempre
    // —`lastMessageAt desc`— le toca el último puesto. Si marcar reordenara, subiría.
    const res = await bandeja();
    const mios = res.body.items
      .filter((t: { id: string }) => [ticketPro, ticketFree, ticketExPro].includes(t.id))
      .map((t: { id: string }) => t.id);

    expect(mios).toEqual([ticketExPro, ticketFree, ticketPro]);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 3b — /planes promete lo que el sistema hace, y nada más
  // ═══════════════════════════════════════════════════════════════════════════

  it('BARRERA — el texto de /planes dice «destaca», no un plazo que nadie garantiza', async () => {
    const res = await request(app.getHttpServer()).get('/api/billing/catalog').expect(200);
    const beneficios = res.body.proBenefits as string[];

    const soporte = beneficios.find((b) => b.toLowerCase().includes('soporte'));
    expect(soporte).toBeDefined();
    // Lo que el mecanismo SÍ garantiza: la marca en la bandeja.
    expect(soporte!.toLowerCase()).toMatch(/destac/);
    // Y lo que NO: un SLA. Un plazo depende de cuánta gente haya y de cuántos tickets
    // entren — el código no puede prometerlo, así que la página no lo dice.
    expect(soporte).not.toMatch(/\d+\s*(h|hora|horas|min|minutos|día|dias|días)\b/i);
    expect(soporte!.toLowerCase()).not.toMatch(/respuesta en|garantiz|menos de/);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // BARRERA 4 — sin N+1
  // ═══════════════════════════════════════════════════════════════════════════

  it('BARRERA 4 — marcar una página entera cuesta UNA consulta, no una por ticket', async () => {
    // Se cuentan las lecturas REALES de `Entitlement` mientras se sirve la bandeja,
    // espiando el cliente de Prisma que usa la APLICACIÓN (no el del test). Con la versión
    // ingenua —`isProActive` dentro del `map`— este número crecería con el tamaño de la
    // página; con el lote es constante.
    //
    // Se llena hasta 30 tickets para que la diferencia sea inequívoca: 1 frente a 30.
    for (let i = 0; i < 27; i++) await abrirTicket(freeUserId, `relleno-${i}`);

    const appPrisma = app.get(PrismaService);
    const espiados = ['findMany', 'findFirst'] as const;
    const originales = new Map(
      espiados.map((m) => [m, appPrisma.entitlement[m].bind(appPrisma.entitlement)]),
    );
    let lecturas = 0;
    for (const metodo of espiados) {
      (appPrisma.entitlement as unknown as Record<string, unknown>)[metodo] = (
        ...args: unknown[]
      ) => {
        lecturas += 1;
        return (originales.get(metodo) as (...a: unknown[]) => unknown)(...args);
      };
    }

    try {
      const res = await bandeja();
      expect(res.body.items.length).toBeGreaterThanOrEqual(30);
      expect(lecturas).toBe(1); // UNA. Ni una por ticket.
    } finally {
      for (const metodo of espiados) {
        (appPrisma.entitlement as unknown as Record<string, unknown>)[metodo] =
          originales.get(metodo);
      }
    }
  });
});
