import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BumpLedgerType, CreditLedgerType, EntitlementType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditLogService } from '../audit-log/audit-log.service';
import { ListAdminTransactionsDto } from './dto/list-admin-transactions.dto';
import { ListAdminWalletsDto } from './dto/list-admin-wallets.dto';
import { CreditGrantDto } from './dto/credit-grant.dto';
// FICHA DE USUARIO — U2: las acciones de staff sobre un usuario.
import { GrantProDto } from './dto/grant-pro.dto';
import { RevokeProDto } from './dto/revoke-pro.dto';
import { BumpGrantDto } from './dto/bump-grant.dto';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NOTIFICATIONS } from '../../infra/queue/queue.constants';
import {
  NOTIFICATION_JOB,
  type SendBalanceDebitedData,
} from '../../infra/queue/notification.types';
import { BalanceDebitDto } from './dto/balance-debit.dto';
import { UpdatePriceDto } from './dto/update-price.dto';
import { UpdateCreditPackDto } from './dto/update-credit-pack.dto';
import { UpdateBumpPackDto } from './dto/update-bump-pack.dto';

@Injectable()
export class AdminBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLog: AuditLogService,
    // N5 — el correo de «hemos ajustado tu saldo», con su motivo.
    @InjectQueue(QUEUE_NOTIFICATIONS) private readonly notificationQueue: Queue,
  ) {}

  async listTransactions(dto: ListAdminTransactionsDto) {
    const { gateway, status, userId, dateFrom, dateTo, page = 1, perPage = 25 } = dto;

    const where: Prisma.TransactionWhereInput = {
      ...(gateway && { gateway }),
      ...(status && { status }),
      ...(userId && { userId }),
      ...((dateFrom ?? dateTo) && {
        createdAt: {
          ...(dateFrom && { gte: new Date(dateFrom) }),
          ...(dateTo && { lte: new Date(dateTo) }),
        },
      }),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.transaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          gateway: true,
          status: true,
          amountGross: true,
          currency: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    return { items, total, page, perPage };
  }

  async listWallets(dto: ListAdminWalletsDto) {
    const { q, page = 1, perPage = 25 } = dto;

    const where: Prisma.WalletWhereInput = q
      ? {
          user: {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          },
        }
      : {};

    const [items, total] = await this.prisma.$transaction([
      this.prisma.wallet.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
        select: {
          id: true,
          balance: true,
          updatedAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      this.prisma.wallet.count({ where }),
    ]);

    return { items, total, page, perPage };
  }

  async getUserBillingDetail(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const now = new Date();

    const [wallet, entitlements, transactions] = await this.prisma.$transaction([
      this.prisma.wallet.findUnique({
        where: { userId },
        select: {
          id: true,
          balance: true,
          // FICHA DE USUARIO U3 — la otra moneda. El monedero tiene DOS saldos
          // (créditos y bumps) y esta pantalla sólo enseñaba uno; con el débito
          // y la concesión de bumps de U2, no verlo sería actuar a ciegas.
          bumpBalance: true,
          updatedAt: true,
          bumpEntries: {
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
              id: true,
              type: true,
              amount: true,
              referenceType: true,
              referenceId: true,
              note: true,
              createdAt: true,
            },
          },
          entries: {
            orderBy: { createdAt: 'desc' },
            take: 20,
            select: {
              id: true,
              type: true,
              amount: true,
              referenceType: true,
              referenceId: true,
              note: true,
              createdAt: true,
            },
          },
        },
      }),
      this.prisma.entitlement.findMany({
        where: {
          userId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          listingId: true,
          startsAt: true,
          expiresAt: true,
          revokedAt: true,
          createdAt: true,
          // FICHA DE USUARIO U3 — LA PROCEDENCIA, que se DERIVA de aquí: con
          // suscripción es de pago, sin ella es una concesión del staff. No hay
          // columna `source` porque sería una segunda verdad (U2).
          subscriptionId: true,
        },
      }),
      this.prisma.transaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          gateway: true,
          status: true,
          amountGross: true,
          currency: true,
          createdAt: true,
        },
      }),
    ]);

    return { user, wallet, entitlements, transactions };
  }

  // ===========================================================================
  // FICHA DE USUARIO — U2: el Pro concedido a mano
  // ===========================================================================

  /**
   * CONCEDER PRO SIN QUE EL USUARIO PAGUE.
   *
   * ES LA MISMA FILA QUE UN PRO DE PAGO, con una diferencia: **`subscriptionId`
   * en null**. No hace falta ni un modelo nuevo ni una columna que diga «esto es
   * manual» — la procedencia SE DERIVA de ahí, porque el único creador del Pro de
   * pago (`ensureProEntitlement`) siempre enlaza una `Subscription`. Una columna
   * `source` sería una segunda verdad que puede desincronizarse de la primera;
   * mismo criterio que `hasVideo`, que tampoco es columna porque se deriva de
   * `videoUrl != null`.
   *
   * QUÉ CONCEDE Y QUÉ NO. Concede las CAPACIDADES de Pro —cuotas de anuncios,
   * vídeo, insignia—, no las gratuidades mensuales: la cuota de destacados y
   * bumps es un COUNT desde el inicio de un ciclo de facturación, y aquí no hay
   * ciclo porque nadie está pagando. U1 dejó eso resuelto: este entitlement da
   * `isPro: true` con `quotaSource: 'NONE'` (decisión D-1).
   *
   * Y NO TAPA LA CUOTA DE UN CLIENTE DE PAGO. Si el usuario ya tenía un Pro
   * pagado, los dos entitlements coexisten y la cuota sigue contándose sobre el
   * de pago — lo garantiza `proConPeriodoFilter` (U1), que pide el que LLEVA
   * periodo en vez del más reciente. Sin ese arreglo, esta función habría dejado
   * a cero la cuota de clientes que pagan.
   *
   * NO CREA `Subscription`, así que el flujo de pago real queda intacto: el
   * usuario puede suscribirse de verdad cuando quiera (la guarda
   * `ALREADY_SUBSCRIBED` mira `Subscription`, no entitlements).
   */
  async grantPro(
    userId: string,
    actorId: string,
    dto: GrantProDto,
    ip?: string,
  ): Promise<{ id: string; expiresAt: Date }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const expiresAt = new Date(dto.expiresAt);
    if (expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('La fecha de vencimiento tiene que ser futura.');
    }

    const entitlement = await this.prisma.$transaction(async (tx) => {
      const creado = await tx.entitlement.create({
        data: {
          userId,
          type: EntitlementType.PRO_SUBSCRIPTION,
          // La marca de que es manual. No hay columna `source`: esto ES la
          // procedencia.
          subscriptionId: null,
          expiresAt,
        },
        select: { id: true, expiresAt: true },
      });

      await this.auditLog.log(
        {
          action: 'PRO_GRANT',
          actorId,
          resourceType: 'User',
          resourceId: userId,
          // Sin `before`: no había nada que sustituir — el molde ya lo contempla
          // («Null si no aplica», schema.prisma).
          after: {
            entitlementId: creado.id,
            expiresAt: expiresAt.toISOString(),
            reason: dto.reason,
          } as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );

      return creado;
    });

    return { id: entitlement.id, expiresAt: entitlement.expiresAt! };
  }

  /**
   * RETIRAR EL PRO CONCEDIDO A MANO.
   *
   * SÓLO LOS MANUALES, y la guarda es el `subscriptionId: null` del `where`:
   * revocar el entitlement de alguien que está PAGANDO le quitaría lo que compró
   * sin tocar su suscripción —seguiría cobrándosele— y ésa es una operación de
   * facturación, no de soporte. Si hay que cancelar un plan de pago, se cancela
   * el plan.
   *
   * `revokedAt` en vez de borrar: que se concedió es parte de la historia, y
   * `activeFilter` ya excluye lo revocado, así que deja de ser Pro en el acto.
   */
  async revokePro(
    userId: string,
    actorId: string,
    dto: RevokeProDto,
    ip?: string,
  ): Promise<{ revoked: number }> {
    const manuales = await this.prisma.entitlement.findMany({
      where: {
        userId,
        type: EntitlementType.PRO_SUBSCRIPTION,
        subscriptionId: null,
        revokedAt: null,
      },
      select: { id: true, expiresAt: true },
    });
    if (manuales.length === 0) {
      throw new NotFoundException('Este usuario no tiene ningún Pro concedido a mano.');
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.entitlement.updateMany({
        where: { id: { in: manuales.map((m) => m.id) } },
        data: { revokedAt: now },
      });

      await this.auditLog.log(
        {
          action: 'PRO_REVOKE',
          actorId,
          resourceType: 'User',
          resourceId: userId,
          before: {
            entitlementIds: manuales.map((m) => m.id),
            expiresAt: manuales.map((m) => m.expiresAt?.toISOString() ?? null),
          } as Prisma.InputJsonValue,
          after: { revokedAt: now.toISOString(), reason: dto.reason } as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );
    });

    return { revoked: manuales.length };
  }

  async grantCredits(
    userId: string,
    actorId: string,
    dto: CreditGrantDto,
    ip?: string,
  ): Promise<{ balance: number; creditedAmount: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const { newBalance } = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.wallet.findUnique({
        where: { userId },
        select: { balance: true },
      });
      const oldBalance = existing?.balance ?? 0;

      const wallet = await tx.wallet.upsert({
        where: { userId },
        create: { userId, balance: dto.amount },
        update: { balance: { increment: dto.amount } },
        select: { id: true, balance: true },
      });

      await tx.creditLedger.create({
        data: {
          walletId: wallet.id,
          type: CreditLedgerType.ADMIN_CREDIT,
          amount: dto.amount,
          note: 'Créditos añadidos por el equipo',
          referenceType: 'User',
          referenceId: userId,
        },
      });

      // Audit log inside the transaction — all three writes are atomic.
      await this.auditLog.log(
        {
          action: 'ADMIN_CREDIT_GRANT',
          actorId,
          resourceType: 'Wallet',
          resourceId: userId,
          before: { balance: oldBalance } as Prisma.InputJsonValue,
          after: {
            balance: wallet.balance,
            amount: dto.amount,
            reason: dto.reason,
          } as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );

      return { newBalance: wallet.balance };
    });

    return { balance: newBalance, creditedAmount: dto.amount };
  }

  /**
   * FICHA DE USUARIO — U2: DAR BUMPS.
   *
   * El hueco que quedaba: dar créditos existía desde siempre y dar bumps no,
   * aunque `BumpLedgerType.ADMIN_CREDIT` llevaba en el enum sin que nadie lo
   * escribiera. Es el molde de `grantCredits` sobre la otra moneda —los bumps son
   * un saldo aparte, intransferible y sólo válido para bumps—, no un caso
   * especial suyo.
   *
   * EL MOTIVO VA AL `AuditLog`, NO AL `note`, igual que en `grantCredits`, y la
   * separación es deliberada: el `note` lo LEE EL USUARIO en su historial de
   * `/mis-creditos`; el motivo es una anotación interna del staff.
   */
  async grantBumps(
    userId: string,
    actorId: string,
    dto: BumpGrantDto,
    ip?: string,
  ): Promise<{ bumpBalance: number; creditedAmount: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');

    const { newBalance } = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.wallet.findUnique({
        where: { userId },
        select: { bumpBalance: true },
      });
      const oldBalance = existing?.bumpBalance ?? 0;

      const wallet = await tx.wallet.upsert({
        where: { userId },
        create: { userId, bumpBalance: dto.amount },
        update: { bumpBalance: { increment: dto.amount } },
        select: { id: true, bumpBalance: true },
      });

      await tx.bumpLedger.create({
        data: {
          walletId: wallet.id,
          type: BumpLedgerType.ADMIN_CREDIT,
          amount: dto.amount,
          note: 'Bumps añadidos por el equipo',
          referenceType: 'User',
          referenceId: userId,
        },
      });

      await this.auditLog.log(
        {
          action: 'ADMIN_BUMP_GRANT',
          actorId,
          resourceType: 'Wallet',
          resourceId: userId,
          before: { bumpBalance: oldBalance } as Prisma.InputJsonValue,
          after: {
            bumpBalance: wallet.bumpBalance,
            amount: dto.amount,
            reason: dto.reason,
          } as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );

      return { newBalance: wallet.bumpBalance };
    });

    return { bumpBalance: newBalance, creditedAmount: dto.amount };
  }

  /**
   * FICHA DE USUARIO — U2: QUITAR SALDO (D-2 aprobada).
   *
   * SUELO EN CERO, Y NO ES UN DETALLE. Se descuenta lo que hay, no lo que se
   * pide: quitar 100 de un saldo de 30 deja 0, no −70. Un saldo negativo rompería
   * el invariante `wallet.balance == SUM(CreditLedger.amount)` en cuanto el
   * usuario comprara, y dejaría a alguien debiendo créditos a la plataforma, que
   * es un concepto que este producto no tiene. Por eso el ledger registra **lo
   * realmente descontado**, no lo pedido.
   *
   * NO DISTINGUE COMPRADO DE REGALADO, y hay que decirlo aquí porque es donde se
   * usa: el monedero es un escalar sin lotes, así que el saldo restante no sabe
   * de dónde vino cada unidad. «Quitar sólo lo que se regaló» no es
   * implementable sin rediseñar el monedero. Ver docs/diseno-ficha-usuario.md §3.3.
   *
   * Quitar de un saldo que ya está a cero se rechaza en vez de registrar un
   * movimiento de cero: un apunte contable que no mueve nada es ruido.
   */
  async debitBalance(
    userId: string,
    actorId: string,
    dto: BalanceDebitDto,
    moneda: 'CREDITS' | 'BUMPS',
    ip?: string,
  ): Promise<{ balance: number; debitedAmount: number }> {
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
      select: { id: true, balance: true, bumpBalance: true },
    });
    if (!wallet) throw new NotFoundException('Este usuario no tiene monedero.');

    const esCreditos = moneda === 'CREDITS';
    const saldoActual = esCreditos ? wallet.balance : wallet.bumpBalance;
    if (saldoActual <= 0) {
      throw new BadRequestException('El saldo ya está a cero: no hay nada que quitar.');
    }

    // El suelo: se descuenta lo que hay, no lo que se pide.
    const descontado = Math.min(dto.amount, saldoActual);
    const nuevoSaldo = saldoActual - descontado;

    await this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { id: wallet.id },
        data: esCreditos ? { balance: nuevoSaldo } : { bumpBalance: nuevoSaldo },
      });

      const datosApunte = {
        walletId: wallet.id,
        // NEGATIVO, como el resto de salidas del ledger: el invariante es que el
        // saldo es la SUMA de los apuntes.
        amount: -descontado,
        note: 'Ajuste del equipo',
        referenceType: 'User',
        referenceId: userId,
      };
      if (esCreditos) {
        await tx.creditLedger.create({
          data: { ...datosApunte, type: CreditLedgerType.ADMIN_DEBIT },
        });
      } else {
        await tx.bumpLedger.create({
          data: { ...datosApunte, type: BumpLedgerType.ADMIN_DEBIT },
        });
      }

      await this.auditLog.log(
        {
          action: esCreditos ? 'ADMIN_CREDIT_DEBIT' : 'ADMIN_BUMP_DEBIT',
          actorId,
          resourceType: 'Wallet',
          resourceId: userId,
          before: { balance: saldoActual } as Prisma.InputJsonValue,
          after: {
            balance: nuevoSaldo,
            // Los DOS: lo que se pidió y lo que realmente se pudo quitar. Si el
            // suelo actuó, el registro lo enseña en vez de esconderlo.
            requested: dto.amount,
            debited: descontado,
            reason: dto.reason,
          } as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );
    });

    /**
     * NOTIFICACIONES N5 — Y AHORA SE LE DICE. Tras la transacción, nunca dentro.
     *
     * §A4 listaba este correo y resultó que **no existía ni el aviso**: se escribía
     * el apunte y el `AuditLog` y la persona afectada no se enteraba de nada — pese
     * a que `BalanceDebitDto` exige `reason` desde siempre. Le quitaban algo que
     * vale dinero, con un motivo escrito a mano que no le llegaba. Es exactamente
     * el defecto que N2 corrigió para las sanciones.
     *
     * Sólo si de verdad se descontó algo: con el suelo en cero, un débito sobre un
     * saldo vacío no mueve nada y avisar de ello sería ruido.
     *
     * CRÍTICO: no hay preferencia que lo apague (ver `email-categories.ts`).
     */
    if (descontado > 0) {
      const usuario = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true },
      });
      if (usuario) {
        await this.notificationQueue.add(NOTIFICATION_JOB.SEND_BALANCE_DEBITED, {
          email: usuario.email,
          name: usuario.name,
          credits: esCreditos ? descontado : 0,
          bumps: esCreditos ? 0 : descontado,
          reason: dto.reason,
        } satisfies SendBalanceDebitedData);
      }
    }

    return { balance: nuevoSaldo, debitedAmount: descontado };
  }

  // ===========================================================================
  // Monetización: precios en euros (Price) y créditos por pack (CreditPack)
  // ===========================================================================

  /**
   * Lista los Price editables desde el backoffice: destacado por tarjeta
   * (durationDays != null), packs de créditos (creditPackId != null) y packs
   * de bumps (bumpPackId != null, Monetización ráfaga 4). Excluye de raíz los
   * Price recurrentes de Stripe (Plan Pro), que se gestionan aparte.
   *
   * Monetización ráfaga 5 — `active: true`: los packs retirados (desactivados,
   * no borrados — ver §19.4/§20) quedan FUERA de la lista editable. No se
   * borran de la BD (protegen el histórico de Transaction que los
   * referencian), pero no tiene sentido que un admin los vea ni pueda
   * "editarlos" — ya no se ofrecen a nadie. Si algún día se añade un toggle
   * de activar/desactivar en el backoffice, este filtro habrá que revisarlo.
   *
   * Orden: por producto (agrupa destacado / packs de créditos / packs de
   * bumps, que son productos distintos — nunca se mezclan entre sí) y, DENTRO
   * de cada grupo, por cantidad ascendente (duración para destacado,
   * creditAmount para packs de créditos, bumpAmount para packs de bumps). Las
   * claves de relación que no aplican a un Price dado quedan NULL y Postgres
   * las ordena al final por defecto — inofensivo, porque esos Price ya están
   * en su propio grupo de producto.
   */
  async listPrices() {
    const prices = await this.prisma.price.findMany({
      where: {
        active: true,
        OR: [
          { durationDays: { not: null } },
          { creditPackId: { not: null } },
          { bumpPackId: { not: null } },
        ],
      },
      include: {
        product: { select: { name: true } },
        creditPack: {
          select: { id: true, name: true, creditAmount: true, active: true },
        },
        bumpPack: {
          select: { id: true, name: true, bumpAmount: true, active: true },
        },
      },
      orderBy: [
        { product: { name: 'asc' } },
        { durationDays: 'asc' },
        { creditPack: { creditAmount: 'asc' } },
        { bumpPack: { bumpAmount: 'asc' } },
      ],
    });

    return prices.map((price) => ({
      id: price.id,
      label: price.creditPack
        ? price.creditPack.name
        : price.bumpPack
          ? price.bumpPack.name
          : `${price.product.name} — ${price.durationDays} días`,
      amount: price.amount,
      currency: price.currency,
      durationDays: price.durationDays,
      active: price.active,
      creditPackId: price.creditPack?.id ?? null,
      creditAmount: price.creditPack?.creditAmount ?? null,
      bumpPackId: price.bumpPack?.id ?? null,
      bumpAmount: price.bumpPack?.bumpAmount ?? null,
    }));
  }

  private assertNotStripePrice(price: { interval: string | null; gatewayPriceId: string | null }) {
    if (price.interval != null || price.gatewayPriceId != null) {
      throw new BadRequestException('Los precios de Stripe se gestionan aparte, no desde aquí.');
    }
  }

  async updatePrice(id: string, actorId: string, dto: UpdatePriceDto, ip?: string) {
    const existing = await this.prisma.price.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Precio no encontrado');
    this.assertNotStripePrice(existing);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.price.update({
        where: { id },
        data: { amount: dto.amount },
      });

      await this.auditLog.log(
        {
          action: 'PRICE_UPDATE',
          actorId,
          resourceType: 'Price',
          resourceId: id,
          before: { amount: existing.amount.toString() } as Prisma.InputJsonValue,
          after: { amount: dto.amount } as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );

      return updated;
    });
  }

  async updateCreditPackAmount(
    creditPackId: string,
    actorId: string,
    dto: UpdateCreditPackDto,
    ip?: string,
  ) {
    const existing = await this.prisma.creditPack.findUnique({ where: { id: creditPackId } });
    if (!existing) throw new NotFoundException('Pack de créditos no encontrado');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.creditPack.update({
        where: { id: creditPackId },
        data: { creditAmount: dto.creditAmount },
      });

      await this.auditLog.log(
        {
          action: 'CREDIT_PACK_UPDATE',
          actorId,
          resourceType: 'CreditPack',
          resourceId: creditPackId,
          before: { creditAmount: existing.creditAmount } as Prisma.InputJsonValue,
          after: { creditAmount: dto.creditAmount } as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );

      return updated;
    });
  }

  /** Monetización ráfaga 4 — mismo molde que updateCreditPackAmount, moneda distinta. */
  async updateBumpPackAmount(
    bumpPackId: string,
    actorId: string,
    dto: UpdateBumpPackDto,
    ip?: string,
  ) {
    const existing = await this.prisma.bumpPack.findUnique({ where: { id: bumpPackId } });
    if (!existing) throw new NotFoundException('Pack de bumps no encontrado');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.bumpPack.update({
        where: { id: bumpPackId },
        data: { bumpAmount: dto.bumpAmount },
      });

      await this.auditLog.log(
        {
          action: 'BUMP_PACK_UPDATE',
          actorId,
          resourceType: 'BumpPack',
          resourceId: bumpPackId,
          before: { bumpAmount: existing.bumpAmount } as Prisma.InputJsonValue,
          after: { bumpAmount: dto.bumpAmount } as Prisma.InputJsonValue,
          ip,
        },
        tx,
      );

      return updated;
    });
  }
}
