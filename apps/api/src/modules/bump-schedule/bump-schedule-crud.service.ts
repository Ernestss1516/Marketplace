import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { BumpScheduleStatus, ListingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { listingCacheKey } from '../../infra/redis/cache-keys';
import { BUMP_AUTO_ENABLED_SETTING } from './bump-schedule.service';
import { computeFirstRunAt } from './next-run';
import { CreateBumpScheduleDto } from './dto/create-bump-schedule.dto';
import { UpdateBumpScheduleDto } from './dto/update-bump-schedule.dto';

/** Setting (D3) — tope de programaciones activas por usuario. Sin fila, este default. */
export const MAX_SCHEDULES_SETTING = 'maxBumpSchedulesPerUser';
export const DEFAULT_MAX_SCHEDULES_PER_USER = 10;

/**
 * La cara de USUARIO del bump automático: crear, editar, pausar, reanudar y cancelar sus
 * programaciones, y consultar el historial de turnos.
 *
 * FICHERO APARTE del cron a propósito. `BumpScheduleService` es el motor —reclama turnos y
 * de él depende que nadie cobre dos veces— y no conviene que crezca con superficie de
 * usuario: son dos cosas que se leen y se cambian por motivos distintos. Aquí NO hay lógica
 * de negocio nueva: se escriben filas y se aplican los límites que las decisiones ya fijaron.
 */
@Injectable()
export class BumpScheduleCrudService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lectura
  // ---------------------------------------------------------------------------

  /** Las programaciones del usuario, con lo que la pantalla de gestión necesita pintar. */
  async findByUser(userId: string) {
    const items = await this.prisma.bumpSchedule.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        intervalDays: true,
        hourOfDay: true,
        status: true,
        nextRunAt: true,
        lastRunAt: true,
        createdAt: true,
        listing: { select: { id: true, title: true, slug: true, status: true } },
      },
    });
    return { items, total: items.length };
  }

  /**
   * El historial de turnos de una programación.
   *
   * Es la respuesta a «¿por qué se me van los créditos?»: D6 decidió no notificar cada bump
   * aplicado para no inundar la campana, y la contrapartida es que la trazabilidad tiene que
   * estar AQUÍ, completa. Se sirven también los turnos que no cobraron (saltados por
   * cooldown, fallidos): un historial que solo enseñe los cobros no explica los huecos.
   */
  async findRuns(userId: string, scheduleId: string, page = 1, perPage = 20) {
    await this.ownedOrThrow(userId, scheduleId);

    const [items, total] = await Promise.all([
      this.prisma.bumpRun.findMany({
        where: { scheduleId },
        orderBy: { slot: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        select: { id: true, slot: true, outcome: true, paidWith: true, cost: true, detail: true, createdAt: true },
      }),
      this.prisma.bumpRun.count({ where: { scheduleId } }),
    ]);
    return { items, total, page, perPage, pages: Math.ceil(total / perPage) };
  }

  // ---------------------------------------------------------------------------
  // Escritura
  // ---------------------------------------------------------------------------

  async create(userId: string, dto: CreateBumpScheduleDto, now = new Date()) {
    await this.assertEnabled();

    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
      select: { id: true, slug: true, sellerId: true, status: true },
    });
    if (!listing) throw new NotFoundException('Anuncio no encontrado');
    if (listing.sellerId !== userId) throw new ForbiddenException('Ese anuncio no es tuyo');
    // Mismo criterio que el bump manual y que `canPromote` en la interfaz: un borrador o un
    // anuncio vendido no está en el catálogo, así que no hay nada que subir.
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Solo se pueden programar bumps de anuncios activos');
    }

    await this.assertUnderUserLimit(userId);

    try {
      const creada = await this.prisma.bumpSchedule.create({
        data: {
          listingId: dto.listingId,
          userId,
          intervalDays: dto.intervalDays,
          hourOfDay: dto.hourOfDay,
          // El primer turno se calcula con las MISMAS reglas de zona horaria que los
          // siguientes (`next-run.ts`). Calcularlo aparte es como se cuelan los desfases.
          nextRunAt: computeFirstRunAt(now, dto.hourOfDay),
        },
      });
      await this.invalidateCard(listing.slug);
      return creada;
    } catch (err) {
      // D3 — una por anuncio, impuesto por @@unique([listingId]). Se traduce a 409 en vez de
      // dejar salir un error de Prisma: el usuario no ha hecho nada raro, ya la tenía.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Este anuncio ya tiene una programación de bumps');
      }
      throw err;
    }
  }

  /**
   * Cambia la cadencia. El próximo turno se RECALCULA desde ahora: si alguien pasa de «cada
   * 7 días a las 9:00» a «cada 2 a las 20:00», esperar al turno viejo sería aplicar una
   * cadencia que ya no existe.
   */
  async update(userId: string, id: string, dto: UpdateBumpScheduleDto, now = new Date()) {
    await this.assertEnabled();
    const actual = await this.ownedOrThrow(userId, id);

    const hourOfDay = dto.hourOfDay ?? actual.hourOfDay;
    return this.prisma.bumpSchedule.update({
      where: { id },
      data: {
        intervalDays: dto.intervalDays ?? actual.intervalDays,
        hourOfDay,
        nextRunAt: computeFirstRunAt(now, hourOfDay),
      },
    });
  }

  /** Pausa a petición del usuario. Se distingue de las pausas del sistema (D2, D9). */
  async pause(userId: string, id: string) {
    await this.ownedOrThrow(userId, id);
    return this.prisma.bumpSchedule.update({
      where: { id },
      data: { status: BumpScheduleStatus.PAUSED_BY_USER },
    });
  }

  /**
   * Reanuda, sea cual sea el motivo por el que estaba parada.
   *
   * ES MANUAL A PROPÓSITO (D2): los créditos son una bolsa común, y recargarlos para otra
   * cosa no debe reactivar por su cuenta un gasto que el usuario no ha vuelto a pedir.
   * Reanudar tiene que ser un acto.
   *
   * Se comprueba que el anuncio siga ACTIVE: reanudar una programación de un anuncio vendido
   * la dejaría fallando en el primer turno y pausándose otra vez.
   */
  async resume(userId: string, id: string, now = new Date()) {
    await this.assertEnabled();
    const actual = await this.ownedOrThrow(userId, id);

    if (actual.listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException(
        'El anuncio no está activo. Vuelve a publicarlo para reanudar los bumps programados.',
      );
    }
    if (actual.status === BumpScheduleStatus.ACTIVE) return actual;

    await this.assertUnderUserLimit(userId);

    return this.prisma.bumpSchedule.update({
      where: { id },
      data: {
        status: BumpScheduleStatus.ACTIVE,
        // Desde AHORA, no desde el turno que se quedó pendiente: si estuvo pausada un mes,
        // reanudar no debe disparar un bump inmediato por un turno vencido hace semanas.
        nextRunAt: computeFirstRunAt(now, actual.hourOfDay),
      },
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const actual = await this.ownedOrThrow(userId, id);
    await this.prisma.bumpSchedule.delete({ where: { id } });
    await this.invalidateCard(actual.listing.slug);
  }

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  private async ownedOrThrow(userId: string, id: string) {
    const schedule = await this.prisma.bumpSchedule.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        status: true,
        intervalDays: true,
        hourOfDay: true,
        listing: { select: { slug: true, status: true } },
      },
    });
    if (!schedule) throw new NotFoundException('Programación no encontrada');
    if (schedule.userId !== userId) throw new ForbiddenException('Esa programación no es tuya');
    return schedule;
  }

  /**
   * D7 — con la feature apagada no se crea ni se reanuda nada.
   *
   * Coherente con el cron, que tampoco reclama turnos: si el interruptor no cortara también
   * aquí, un usuario podría configurar programaciones que nunca se ejecutarían, que es peor
   * que no dejarle configurarlas.
   */
  private async assertEnabled(): Promise<void> {
    const ajuste = await this.prisma.setting.findUnique({
      where: { key: BUMP_AUTO_ENABLED_SETTING },
      select: { value: true },
    });
    if (ajuste && ajuste.value === false) {
      throw new BadRequestException({
        code: 'BUMP_AUTO_DISABLED',
        message: 'Los bumps programados no están disponibles ahora mismo.',
      });
    }
  }

  /** D3 — tope de programaciones ACTIVAS por usuario, configurable. */
  private async assertUnderUserLimit(userId: string): Promise<void> {
    const ajuste = await this.prisma.setting.findUnique({
      where: { key: MAX_SCHEDULES_SETTING },
      select: { value: true },
    });
    const limite = ajuste ? Number(ajuste.value) : DEFAULT_MAX_SCHEDULES_PER_USER;

    const activas = await this.prisma.bumpSchedule.count({
      where: { userId, status: BumpScheduleStatus.ACTIVE },
    });
    if (activas >= limite) {
      throw new BadRequestException(
        `Has alcanzado el límite de ${limite} programaciones activas. Pausa o cancela alguna para crear otra.`,
      );
    }
  }

  /**
   * La tarjeta de /mis-anuncios se sirve del payload de propietario, que no está cacheado;
   * la FICHA sí lo está (`listing:{slug}`, 5 min). La programación no viaja en el payload
   * público de la ficha —es información privada del vendedor— pero sí se invalida la entrada
   * al crear o borrar, por el mismo criterio con el que lo hace el bump: dejar la ficha
   * sirviendo un blob viejo tras tocar el anuncio es como nacen las discrepancias entre
   * superficies que UXV.1 cerró.
   */
  private invalidateCard(slug: string) {
    return this.redis.client.del(listingCacheKey(slug));
  }
}
