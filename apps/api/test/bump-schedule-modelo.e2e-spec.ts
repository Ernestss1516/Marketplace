/**
 * Bump automático, ráfaga 2 — el MODELO (e2e de esquema).
 *
 * Aquí no hay negocio: nada lee ni escribe todavía estas tablas. Lo que se comprueba es que
 * las GARANTÍAS QUE EL ESQUEMA PROMETE existen de verdad en la base, porque el diseño se
 * apoya en ellas y una restricción que se da por supuesta es una restricción que no está.
 *
 * La principal es la CAPA 2: `@@unique([scheduleId, slot])`. Es lo que impide que «el turno
 * de las 9:00 de esta programación» se registre dos veces aunque N instancias del cron lo
 * intenten a la vez. El guard que de verdad no se puede esquivar vive en la BASE —molde de
 * `Invoice.idempotencyKey`—, y esta suite lo verifica intentando saltárselo.
 */

import { PrismaClient, Prisma, ListingStatus } from '@prisma/client';
import { cleanDb } from './helpers/db';

describe('Bump automático — modelo: las garantías del esquema (e2e)', () => {
  let prisma: PrismaClient;

  let userId: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    await cleanDb(prisma);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    const user = await prisma.user.create({
      data: {
        email: 'bumpsched-modelo@example.com',
        name: 'Modelo Seller',
        slug: 'bumpsched-modelo',
        passwordHash: 'x',
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function crearAnuncio(suffix: string) {
    return prisma.listing.create({
      data: {
        title: `Modelo listing ${suffix}`,
        slug: `bumpsched-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        description: 'Anuncio para las pruebas del modelo de bump automático',
        price: new Prisma.Decimal('100.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status: ListingStatus.ACTIVE,
        sellerId: userId,
        categoryId,
        publishedAt: new Date(),
      },
      select: { id: true },
    });
  }

  async function crearProgramacion(listingId: string, nextRunAt = new Date('2026-09-01T09:00:00.000Z')) {
    return prisma.bumpSchedule.create({
      data: { listingId, userId, intervalDays: 3, hourOfDay: 9, nextRunAt },
      select: { id: true, status: true, nextRunAt: true },
    });
  }

  // ---------------------------------------------------------------------------
  // 1. CAPA 2 — un turno, una fila. Aunque se intente dos veces.
  // ---------------------------------------------------------------------------

  it('el MISMO turno de la MISMA programación no se puede registrar dos veces', async () => {
    const listing = await crearAnuncio('turno-unico');
    const schedule = await crearProgramacion(listing.id);
    const slot = schedule.nextRunAt;

    await prisma.bumpRun.create({
      data: { scheduleId: schedule.id, slot, outcome: 'APPLIED', paidWith: 'CREDITS', cost: 5 },
    });

    // La segunda instancia del cron, con la misma `slot` derivada del mismo `nextRunAt`.
    await expect(
      prisma.bumpRun.create({
        data: { scheduleId: schedule.id, slot, outcome: 'APPLIED', paidWith: 'CREDITS', cost: 5 },
      }),
    ).rejects.toMatchObject({ code: 'P2002' }); // violación de restricción única

    expect(await prisma.bumpRun.count({ where: { scheduleId: schedule.id } })).toBe(1);
  });

  it('pero DOS turnos distintos de la misma programación conviven', async () => {
    const listing = await crearAnuncio('dos-turnos');
    const schedule = await crearProgramacion(listing.id);

    await prisma.bumpRun.create({
      data: { scheduleId: schedule.id, slot: new Date('2026-09-01T09:00:00.000Z'), outcome: 'APPLIED' },
    });
    await prisma.bumpRun.create({
      data: { scheduleId: schedule.id, slot: new Date('2026-09-04T09:00:00.000Z'), outcome: 'APPLIED' },
    });

    expect(await prisma.bumpRun.count({ where: { scheduleId: schedule.id } })).toBe(2);
  });

  it('y el mismo instante en OTRA programación también: la clave es por programación, no global', async () => {
    const [a, b] = await Promise.all([crearAnuncio('slot-comp-a'), crearAnuncio('slot-comp-b')]);
    const [sa, sb] = await Promise.all([crearProgramacion(a.id), crearProgramacion(b.id)]);
    const mismoInstante = new Date('2026-09-01T09:00:00.000Z');

    await prisma.bumpRun.create({ data: { scheduleId: sa.id, slot: mismoInstante, outcome: 'APPLIED' } });
    await prisma.bumpRun.create({ data: { scheduleId: sb.id, slot: mismoInstante, outcome: 'APPLIED' } });

    // Dos anuncios programados a la misma hora no se estorban. Si la clave fuera solo
    // `slot`, el segundo anuncio no llegaría a bumpearse nunca.
    expect(await prisma.bumpRun.count({ where: { scheduleId: { in: [sa.id, sb.id] } } })).toBe(2);
  });

  it('un turno que NO cobró también ocupa su hueco: el guard no depende de que se pagara', async () => {
    const listing = await crearAnuncio('turno-sin-cobro');
    const schedule = await crearProgramacion(listing.id);
    const slot = schedule.nextRunAt;

    await prisma.bumpRun.create({
      data: {
        scheduleId: schedule.id,
        slot,
        outcome: 'SKIPPED_COOLDOWN',
        detail: 'Bump manual reciente',
      },
    });

    // Un reintento del mismo turno choca igual. Si solo se registraran los turnos
    // cobrados, un reintento tras un salto volvería a intentarlo — y podría cobrar.
    await expect(
      prisma.bumpRun.create({ data: { scheduleId: schedule.id, slot, outcome: 'APPLIED' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  // ---------------------------------------------------------------------------
  // 2. D3 — una programación por anuncio
  // ---------------------------------------------------------------------------

  it('un anuncio no admite dos programaciones', async () => {
    const listing = await crearAnuncio('una-por-anuncio');
    await crearProgramacion(listing.id);

    // Dos programaciones sobre el mismo anuncio competirían por el mismo cooldown y una
    // de las dos no haría nada nunca.
    await expect(crearProgramacion(listing.id)).rejects.toMatchObject({ code: 'P2002' });
  });

  it('el estado por defecto es ACTIVE, y los cuatro estados del diseño existen', async () => {
    const listing = await crearAnuncio('estados');
    const schedule = await crearProgramacion(listing.id);
    expect(schedule.status).toBe('ACTIVE');

    // Cada pausa dice POR QUÉ: de eso depende que D9 pueda reanudar sola y D2 no.
    for (const status of ['PAUSED_BY_USER', 'PAUSED_NO_FUNDS', 'PAUSED_LISTING_INACTIVE'] as const) {
      const actualizada = await prisma.bumpSchedule.update({
        where: { id: schedule.id },
        data: { status },
        select: { status: true },
      });
      expect(actualizada.status).toBe(status);
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Ciclo de vida: la programación no sobrevive a su anuncio
  // ---------------------------------------------------------------------------

  it('al borrar el anuncio desaparecen su programación y sus turnos', async () => {
    const listing = await crearAnuncio('cascada');
    const schedule = await crearProgramacion(listing.id);
    await prisma.bumpRun.create({
      data: { scheduleId: schedule.id, slot: schedule.nextRunAt, outcome: 'APPLIED' },
    });

    await prisma.listing.delete({ where: { id: listing.id } });

    expect(await prisma.bumpSchedule.findUnique({ where: { id: schedule.id } })).toBeNull();
    expect(await prisma.bumpRun.count({ where: { scheduleId: schedule.id } })).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // 4. REQUISITO DE ORO — BumpRun NO es el libro mayor
  // ---------------------------------------------------------------------------

  it('registrar turnos no mueve el monedero: el invariante contable no se entera', async () => {
    const wallet = await prisma.wallet.create({
      data: { userId, balance: 100, bumpBalance: 7 },
      select: { id: true },
    });

    const listing = await crearAnuncio('invariante');
    const schedule = await crearProgramacion(listing.id);

    // Tres turnos, uno de ellos "cobrado" según su propio registro.
    await prisma.bumpRun.createMany({
      data: [
        { scheduleId: schedule.id, slot: new Date('2026-09-01T09:00:00.000Z'), outcome: 'APPLIED', paidWith: 'CREDITS', cost: 5 },
        { scheduleId: schedule.id, slot: new Date('2026-09-04T09:00:00.000Z'), outcome: 'SKIPPED_COOLDOWN' },
        { scheduleId: schedule.id, slot: new Date('2026-09-07T09:00:00.000Z'), outcome: 'FAILED_NO_FUNDS' },
      ],
    });

    // BumpRun es un registro de EJECUCIÓN, no un apunte. Escribir en él no crea
    // movimientos ni toca saldos — por eso el hueco B.4 se cierra sin tocar el ledger.
    const despues = await prisma.wallet.findUniqueOrThrow({ where: { id: wallet.id } });
    expect(despues.balance).toBe(100);
    expect(despues.bumpBalance).toBe(7);

    const apuntes = await prisma.bumpLedger.aggregate({
      where: { walletId: wallet.id },
      _sum: { amount: true },
      _count: true,
    });
    expect(apuntes._count).toBe(0);
    // wallet.bumpBalance == 7 + SUM(amount) == 7 + 0. Intacto.
    expect(despues.bumpBalance).toBe(7 + (apuntes._sum.amount ?? 0));
  });

  // ---------------------------------------------------------------------------
  // 5. Higiene entre suites
  // ---------------------------------------------------------------------------

  it('cleanDb se lleva las tablas nuevas por cascada — no hace falta tocar el helper', async () => {
    const listing = await crearAnuncio('higiene');
    const schedule = await crearProgramacion(listing.id);
    await prisma.bumpRun.create({
      data: { scheduleId: schedule.id, slot: schedule.nextRunAt, outcome: 'APPLIED' },
    });

    await cleanDb(prisma);

    // Si TRUNCATE "User" CASCADE no las alcanzara, quedarían programaciones huérfanas
    // filtrándose de una suite a la siguiente.
    expect(await prisma.bumpSchedule.count()).toBe(0);
    expect(await prisma.bumpRun.count()).toBe(0);
  });
});
