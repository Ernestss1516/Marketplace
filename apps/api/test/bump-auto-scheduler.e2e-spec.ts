/**
 * Bump automático, ráfaga 3 — EL SCHEDULER (e2e).
 *
 * Se prueban las dos mitades por separado y en el orden en que ocurren:
 *   · el CRON reclama turnos (y no puede reclamar el mismo dos veces),
 *   · el PROCESSOR los ejecuta y traduce lo que devuelve `BillingService.bump` a las
 *     políticas confirmadas.
 *
 * LA PRUEBA CENTRAL es la de concurrencia: dos pasadas simultáneas sobre el mismo turno
 * producen UN solo `BumpRun` y UN solo cobro. Es la CAPA 2 (clave única) apoyada en la CAPA 1
 * (cobro atómico), y es lo que convierte «un turno = un cobro» en una propiedad del sistema.
 *
 * El reloj se INYECTA en las dos mitades: `runDueSchedules(now)` y `runTurn(data, now)`. Sin
 * eso no se podrían verificar ni la frontera del turno ni que el calendario no deriva —los
 * casos que importan son justo los que no se pueden provocar esperando.
 *
 * La cola se sustituye por un espía para que el worker real no curse los jobs por detrás: así
 * cada mitad se observa aislada, sin carreras con el propio sistema.
 */

import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { BumpScheduleStatus, ListingStatus, Prisma, PrismaClient } from '@prisma/client';
import { createTestApp } from './helpers/create-app';
import { cleanDb } from './helpers/db';
import { QUEUE_BUMP_AUTO } from 'src/infra/queue/queue.constants';
import {
  BumpScheduleService,
  BUMP_AUTO_ENABLED_SETTING,
} from 'src/modules/bump-schedule/bump-schedule.service';
import { BumpAutoProcessor } from 'src/modules/bump-schedule/bump-auto.processor';
import type { RunTurnJobData } from 'src/modules/bump-schedule/bump-auto.job';
import { BUMP_COOLDOWN_SECONDS } from 'src/modules/billing/bump-cooldown';
import { BillingService } from 'src/modules/billing/billing.service';

/** 09:00 peninsulares de un día de enero de 2026 (invierno → UTC+1). */
const enero9h = (dia: number) => new Date(Date.UTC(2026, 0, dia, 8, 0, 0));

describe('Bump automático — el scheduler (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let scheduler: BumpScheduleService;
  let processor: BumpAutoProcessor;
  let addSpy: jest.SpyInstance;

  let userId: string;
  let categoryId: string;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    await cleanDb(prisma);

    scheduler = app.get(BumpScheduleService);
    processor = app.get(BumpAutoProcessor);

    // El worker real consumiría los jobs mientras se comprueban las aserciones. Aquí interesa
    // observar QUÉ se encola, y ejecutar el turno a mano cuando toca.
    const queue = app.get<Queue>(getQueueToken(QUEUE_BUMP_AUTO));
    addSpy = jest.spyOn(queue, 'add').mockResolvedValue({ id: 'fake' } as never);

    const category = await prisma.category.findUniqueOrThrow({ where: { slug: 'moviles' } });
    categoryId = category.id;

    const user = await prisma.user.create({
      data: {
        email: 'bumpauto-cron@example.com',
        name: 'Cron Seller',
        slug: 'bumpauto-cron',
        passwordHash: 'x',
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    addSpy.mockRestore();
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(() => addSpy.mockClear());

  // ── utilidades ─────────────────────────────────────────────────────────────

  async function crearAnuncio(suffix: string, status: ListingStatus = ListingStatus.ACTIVE) {
    return prisma.listing.create({
      data: {
        title: `Bump auto ${suffix}`,
        slug: `bumpauto-${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        description: 'Anuncio para las pruebas del scheduler de bump automático',
        price: new Prisma.Decimal('100.00'),
        type: 'PRODUCT',
        priceType: 'FIXED',
        condition: 'GOOD',
        status,
        sellerId: userId,
        categoryId,
        publishedAt: new Date(),
      },
      select: { id: true },
    });
  }

  async function crearProgramacion(
    listingId: string,
    opts: { nextRunAt: Date; intervalDays?: number; hourOfDay?: number; status?: BumpScheduleStatus } ,
  ) {
    return prisma.bumpSchedule.create({
      data: {
        listingId,
        userId,
        intervalDays: opts.intervalDays ?? 3,
        hourOfDay: opts.hourOfDay ?? 9,
        nextRunAt: opts.nextRunAt,
        status: opts.status ?? BumpScheduleStatus.ACTIVE,
      },
      select: { id: true, nextRunAt: true },
    });
  }

  async function setWallet(balance: number, bumpBalance = 0) {
    await prisma.wallet.upsert({
      where: { userId },
      create: { userId, balance, bumpBalance },
      update: { balance, bumpBalance },
    });
  }

  /** Los datos del job tal y como el cron los encoló para esa programación. */
  function jobEncolado(scheduleId: string): RunTurnJobData {
    const llamada = addSpy.mock.calls.find(
      (c) => (c[1] as RunTurnJobData).scheduleId === scheduleId,
    );
    expect(llamada).toBeDefined();
    return llamada![1] as RunTurnJobData;
  }

  const movimientosDeCredito = (listingId: string) =>
    prisma.creditLedger.count({
      where: { type: 'BUMP_DEBIT', referenceType: 'Listing', referenceId: listingId },
    });

  /**
   * Los avisos de bump-auto DE ESE ANUNCIO. Acotado por `listingId` y no por usuario: todas
   * las pruebas comparten vendedor, así que sin acotar cada una vería los avisos de las
   * anteriores y «no se avisó» sería imposible de comprobar.
   */
  const avisos = (listingId: string) =>
    prisma.notification.findMany({
      where: {
        userId,
        type: 'BUMP_AUTO_PAUSED',
        data: { path: ['listingId'], equals: listingId },
      },
    });

  // ── 1. La selección ────────────────────────────────────────────────────────

  describe('qué turnos entran en una pasada', () => {
    it('solo los vencidos y ACTIVE: ni los futuros ni los pausados', async () => {
      const ahora = enero9h(10);
      const [a, b, c] = await Promise.all([
        crearAnuncio('sel-vencido'),
        crearAnuncio('sel-futuro'),
        crearAnuncio('sel-pausado'),
      ]);
      const vencida = await crearProgramacion(a.id, { nextRunAt: enero9h(9) });
      const futura = await crearProgramacion(b.id, { nextRunAt: enero9h(11) });
      const pausada = await crearProgramacion(c.id, {
        nextRunAt: enero9h(9),
        status: BumpScheduleStatus.PAUSED_NO_FUNDS,
      });

      const r = await scheduler.runDueSchedules(ahora);

      expect(r.claimed).toBe(1);
      expect(await prisma.bumpRun.count({ where: { scheduleId: vencida.id } })).toBe(1);
      expect(await prisma.bumpRun.count({ where: { scheduleId: futura.id } })).toBe(0);
      expect(await prisma.bumpRun.count({ where: { scheduleId: pausada.id } })).toBe(0);
    });

    it('el turno JUSTO en la frontera (nextRunAt == now) entra', async () => {
      const ahora = enero9h(10);
      const listing = await crearAnuncio('frontera');
      const s = await crearProgramacion(listing.id, { nextRunAt: ahora });

      await scheduler.runDueSchedules(ahora);

      // Comparación inclusiva: si fuera estricta, un turno programado en el minuto exacto de
      // la pasada se quedaría esperando una hora entera.
      expect(await prisma.bumpRun.count({ where: { scheduleId: s.id } })).toBe(1);
    });

    it('D7 — con el ajuste apagado no se reclama nada', async () => {
      const listing = await crearAnuncio('flag-off');
      const s = await crearProgramacion(listing.id, { nextRunAt: enero9h(9) });

      await prisma.setting.upsert({
        where: { key: BUMP_AUTO_ENABLED_SETTING },
        create: { key: BUMP_AUTO_ENABLED_SETTING, value: false },
        update: { value: false },
      });
      try {
        const r = await scheduler.runDueSchedules(enero9h(10));

        expect(r.enabled).toBe(false);
        expect(await prisma.bumpRun.count({ where: { scheduleId: s.id } })).toBe(0);
        // El interruptor detiene el cron pero NO toca las programaciones.
        const tras = await prisma.bumpSchedule.findUniqueOrThrow({ where: { id: s.id } });
        expect(tras.status).toBe(BumpScheduleStatus.ACTIVE);
        expect(tras.nextRunAt).toEqual(enero9h(9));
      } finally {
        await prisma.setting.update({
          where: { key: BUMP_AUTO_ENABLED_SETTING },
          data: { value: true },
        });
      }
    });
  });

  // ── 2. El reclamo y la idempotencia ────────────────────────────────────────

  describe('el reclamo del turno', () => {
    it('la slot es el nextRunAt VIGENTE, copiado tal cual', async () => {
      const listing = await crearAnuncio('slot-copia');
      const s = await crearProgramacion(listing.id, { nextRunAt: enero9h(9) });

      await scheduler.runDueSchedules(enero9h(10));

      const run = await prisma.bumpRun.findFirstOrThrow({ where: { scheduleId: s.id } });
      // Ni truncada, ni recalculada, ni derivada de `now`: por eso dos instancias coinciden.
      expect(run.slot).toEqual(enero9h(9));
      // Y nace sin desenlace: reclamado, todavía sin ejecutar.
      expect(run.outcome).toBeNull();
      expect(jobEncolado(s.id).slot).toBe(enero9h(9).toISOString());
    });

    it('DOS PASADAS SIMULTÁNEAS sobre el mismo turno: un solo BumpRun y un solo job', async () => {
      const listing = await crearAnuncio('carrera-reclamo');
      const s = await crearProgramacion(listing.id, { nextRunAt: enero9h(9) });

      // Dos "instancias" del cron despertando a la vez, que es el caso normal con N réplicas.
      await Promise.all([
        scheduler.runDueSchedules(enero9h(10)),
        scheduler.runDueSchedules(enero9h(10)),
      ]);

      // Se mide POR PROGRAMACIÓN y no con los contadores de la pasada: la base es compartida
      // y cada pasada barre también las programaciones de las demás pruebas, así que un total
      // global no diría nada sobre ESTE turno. La garantía es exactamente esto: una fila y un
      // job para el turno, aunque dos procesos lo intenten a la vez.
      expect(await prisma.bumpRun.count({ where: { scheduleId: s.id } })).toBe(1);
      expect(
        addSpy.mock.calls.filter((c) => (c[1] as RunTurnJobData).scheduleId === s.id),
      ).toHaveLength(1);
    });

    it('una segunda pasada del MISMO turno tampoco reclama (el turno sigue tomado)', async () => {
      const listing = await crearAnuncio('reclamo-repetido');
      const s = await crearProgramacion(listing.id, { nextRunAt: enero9h(9) });

      await scheduler.runDueSchedules(enero9h(10));
      addSpy.mockClear();
      await scheduler.runDueSchedules(enero9h(10));

      // La segunda pasada no vuelve a reclamar ESTE turno ni lo encola otra vez.
      expect(await prisma.bumpRun.count({ where: { scheduleId: s.id } })).toBe(1);
      expect(
        addSpy.mock.calls.filter((c) => (c[1] as RunTurnJobData).scheduleId === s.id),
      ).toHaveLength(0);
    });

    it('el jobId es estable para el mismo turno', async () => {
      const listing = await crearAnuncio('jobid');
      const s = await crearProgramacion(listing.id, { nextRunAt: enero9h(9) });

      await scheduler.runDueSchedules(enero9h(10));

      const opts = addSpy.mock.calls.find(
        (c) => (c[1] as RunTurnJobData).scheduleId === s.id,
      )![2] as { jobId: string };
      expect(opts.jobId).toBe(`bump-auto-${s.id}-${enero9h(9).toISOString()}`);
    });
  });

  // ── 3. Las políticas confirmadas ───────────────────────────────────────────

  describe('un turno que se aplica', () => {
    it('cobra, registra el desenlace y avanza el calendario anclado al turno', async () => {
      await setWallet(500);
      const listing = await crearAnuncio('aplicado');
      const s = await crearProgramacion(listing.id, { nextRunAt: enero9h(9), intervalDays: 3 });

      await scheduler.runDueSchedules(enero9h(10));
      const outcome = await processor.runTurn(jobEncolado(s.id), enero9h(10));

      expect(outcome).toBe('APPLIED');

      const run = await prisma.bumpRun.findFirstOrThrow({ where: { scheduleId: s.id } });
      expect(run.outcome).toBe('APPLIED');
      expect(run.paidWith).toBe('CREDITS'); // D11 — mismo orden que el manual
      expect(run.cost).toBeGreaterThan(0); // D10 — lo REALMENTE cobrado, precio en vivo
      expect(await movimientosDeCredito(listing.id)).toBe(1);

      const tras = await prisma.bumpSchedule.findUniqueOrThrow({ where: { id: s.id } });
      // Anclado a la SLOT (día 9), no a `now` (día 10): el calendario no deriva.
      expect(tras.nextRunAt).toEqual(enero9h(12));
      expect(tras.status).toBe(BumpScheduleStatus.ACTIVE);
      expect(tras.lastRunAt).toEqual(enero9h(10));
    });

    it('D6 — un bump aplicado NO notifica: no se avisa de lo que el usuario contrató', async () => {
      await setWallet(500);
      const listing = await crearAnuncio('sin-aviso');
      const s = await crearProgramacion(listing.id, { nextRunAt: enero9h(9) });

      await scheduler.runDueSchedules(enero9h(10));
      await processor.runTurn(jobEncolado(s.id), enero9h(10));

      expect(await avisos(listing.id)).toHaveLength(0);
    });
  });

  describe('D2 — sin saldo', () => {
    it('pausa diciendo por qué, avisa, y NO avanza el calendario', async () => {
      await setWallet(0, 0); // las tres bolsas vacías (el vendedor no es Pro)
      const listing = await crearAnuncio('sin-saldo');
      const s = await crearProgramacion(listing.id, { nextRunAt: enero9h(9) });

      await scheduler.runDueSchedules(enero9h(10));
      const outcome = await processor.runTurn(jobEncolado(s.id), enero9h(10));

      expect(outcome).toBe('FAILED_NO_FUNDS');

      const tras = await prisma.bumpSchedule.findUniqueOrThrow({ where: { id: s.id } });
      expect(tras.status).toBe(BumpScheduleStatus.PAUSED_NO_FUNDS);
      // Se queda donde estaba: la reanudación es MANUAL, no un efecto de recargar.
      expect(tras.nextRunAt).toEqual(enero9h(9));

      expect(await movimientosDeCredito(listing.id)).toBe(0);

      const [aviso] = await avisos(listing.id);
      expect(aviso).toBeDefined();
      // Snapshot autocontenido: el título va congelado, no un id que resolver al pintar.
      expect(aviso.data).toMatchObject({ reason: 'NO_FUNDS', listingId: listing.id });
      expect((aviso.data as { listingTitle: string }).listingTitle).toContain('sin-saldo');
    });

    it('y pausada ya no la recoge la siguiente pasada', async () => {
      await setWallet(0, 0);
      const listing = await crearAnuncio('pausada-fuera');
      const s = await crearProgramacion(listing.id, { nextRunAt: enero9h(9) });

      await scheduler.runDueSchedules(enero9h(10));
      await processor.runTurn(jobEncolado(s.id), enero9h(10));

      addSpy.mockClear();
      await scheduler.runDueSchedules(enero9h(11));

      // Un día después sigue sin tocarla: pausada no entra en la selección.
      expect(await prisma.bumpRun.count({ where: { scheduleId: s.id } })).toBe(1);
      expect(
        addSpy.mock.calls.filter((c) => (c[1] as RunTurnJobData).scheduleId === s.id),
      ).toHaveLength(0);
    });
  });

  describe('D5 — colisión con el bump manual', () => {
    it('salta el turno sin cobrar, y el calendario sigue siendo el mismo', async () => {
      await setWallet(500);
      const listing = await crearAnuncio('colision');
      // El usuario acaba de subirlo a mano: la ventana de cooldown está abierta.
      await prisma.listing.update({ where: { id: listing.id }, data: { bumpedAt: new Date() } });
      const s = await crearProgramacion(listing.id, { nextRunAt: enero9h(9), intervalDays: 3 });

      await scheduler.runDueSchedules(enero9h(10));
      const outcome = await processor.runTurn(jobEncolado(s.id), enero9h(10));

      expect(outcome).toBe('SKIPPED_COOLDOWN');
      expect(await movimientosDeCredito(listing.id)).toBe(0);

      const tras = await prisma.bumpSchedule.findUniqueOrThrow({ where: { id: s.id } });
      // Sigue ACTIVE y el calendario avanza a su siguiente turno: no se recalcula desde el
      // bump manual, porque «cada 3 días a las 9:00» es un calendario, no un contador.
      expect(tras.status).toBe(BumpScheduleStatus.ACTIVE);
      expect(tras.nextRunAt).toEqual(enero9h(12));

      // Y no se avisa: contarle que no se bumpeó porque ya bumpeó él sería ruido.
      expect(await avisos(listing.id)).toHaveLength(0);
    });
  });

  describe('D9 — el anuncio deja de estar activo', () => {
    it('pausa con su propia razón y avisa, sin borrar la programación', async () => {
      await setWallet(500);
      const listing = await crearAnuncio('vendido');
      const s = await crearProgramacion(listing.id, { nextRunAt: enero9h(9) });

      // Entre la selección y el cobro, el anuncio se vende.
      await prisma.listing.update({
        where: { id: listing.id },
        data: { status: ListingStatus.SOLD },
      });

      await scheduler.runDueSchedules(enero9h(10));
      const outcome = await processor.runTurn(jobEncolado(s.id), enero9h(10));

      expect(outcome).toBe('SKIPPED_LISTING_INACTIVE');
      expect(await movimientosDeCredito(listing.id)).toBe(0);

      const tras = await prisma.bumpSchedule.findUniqueOrThrow({ where: { id: s.id } });
      // Se pausa, NO se borra: castigar al usuario por vender sería absurdo.
      expect(tras.status).toBe(BumpScheduleStatus.PAUSED_LISTING_INACTIVE);

      const [aviso] = await avisos(listing.id);
      expect(aviso.data).toMatchObject({ reason: 'LISTING_INACTIVE' });
    });
  });

  // ── 4. La garantía: un turno = un cobro ────────────────────────────────────

  describe('un turno = un cobro, pase lo que pase', () => {
    it('ejecutar el MISMO turno dos veces no cobra dos veces', async () => {
      await setWallet(500);
      const listing = await crearAnuncio('doble-ejecucion');
      const s = await crearProgramacion(listing.id, { nextRunAt: enero9h(9) });

      await scheduler.runDueSchedules(enero9h(10));
      const job = jobEncolado(s.id);

      const primero = await processor.runTurn(job, enero9h(10));
      // Un reintento tardío del mismo job: el turno ya está resuelto y no se vuelve a tocar.
      const segundo = await processor.runTurn(job, enero9h(10));

      expect(primero).toBe('APPLIED');
      expect(segundo).toBeNull();
      expect(await movimientosDeCredito(listing.id)).toBe(1);
    });

    it('dos ejecuciones SIMULTÁNEAS del mismo turno tampoco', async () => {
      await setWallet(500);
      const listing = await crearAnuncio('doble-simultanea');
      const s = await crearProgramacion(listing.id, { nextRunAt: enero9h(9) });

      await scheduler.runDueSchedules(enero9h(10));
      const job = jobEncolado(s.id);

      await Promise.all([
        processor.runTurn(job, enero9h(10)).catch(() => null),
        processor.runTurn(job, enero9h(10)).catch(() => null),
      ]);

      // Aunque las dos pasaran el filtro de «ya resuelto», la CAPA 1 impide el segundo cobro:
      // el reclamo atómico del cooldown ya está escrito cuando la otra llega.
      expect(await movimientosDeCredito(listing.id)).toBe(1);
    });

    it('el invariante contable aguanta con saldo de bumps', async () => {
      await setWallet(0, 5);
      const listing = await crearAnuncio('invariante-bumps');
      const s = await crearProgramacion(listing.id, { nextRunAt: enero9h(9) });

      await scheduler.runDueSchedules(enero9h(10));
      await processor.runTurn(jobEncolado(s.id), enero9h(10));

      const wallet = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
      const agregado = await prisma.bumpLedger.aggregate({
        where: { walletId: wallet.id },
        _sum: { amount: true },
      });
      // El turno gastó exactamente uno, y el libro mayor lo refleja.
      expect(wallet.bumpBalance).toBe(4);
      expect(wallet.bumpBalance).toBe(5 + (agregado._sum.amount ?? 0));

      const run = await prisma.bumpRun.findFirstOrThrow({ where: { scheduleId: s.id } });
      expect(run.paidWith).toBe('BUMP_BALANCE');
      expect(run.cost).toBe(0);
    });
  });

  // ── 5. El bump manual no se entera de nada ─────────────────────────────────

  it('REQUISITO DE ORO — el bump manual sigue funcionando igual', async () => {
    await setWallet(500);
    const listing = await crearAnuncio('manual-intacto');

    // Un anuncio SIN programación, por el camino de siempre: el scheduler no ha tocado nada
    // de `BillingService.bump`, solo lo llama.
    const billing = app.get(BillingService);

    const r = await billing.bump(listing.id, userId);
    expect(r.paidWith).toBe('CREDITS');

    // Y sigue respetando su cooldown, que es de una hora y sigue viniendo del mismo sitio.
    await expect(billing.bump(listing.id, userId)).rejects.toMatchObject({ status: 429 });
    expect(await movimientosDeCredito(listing.id)).toBe(1);
    expect(BUMP_COOLDOWN_SECONDS).toBe(3600);
  });
});
