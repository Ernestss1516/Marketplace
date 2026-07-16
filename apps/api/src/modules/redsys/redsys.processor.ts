import * as Sentry from '@sentry/nestjs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BumpLedgerType, CreditLedgerType, FeaturedOrigin, TransactionStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { QUEUE_REDSYS } from '../../infra/queue/queue.constants';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { REDSYS_JOB, type RedsysJobData } from './redsys.types';

@Processor(QUEUE_REDSYS)
export class RedsysProcessor extends WorkerHost {
  private readonly logger = new Logger(RedsysProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly billingService: BillingService,
  ) {
    super();
  }

  async process(job: Job<RedsysJobData>): Promise<void> {
    try {
      if (job.name === REDSYS_JOB.PROCESS_SUCCESS) {
        return await this.processSuccess(job.data);
      }
      this.logger.warn(`Unknown Redsys job: ${job.name}`);
    } catch (err) {
      Sentry.captureException(err);
      throw err;
    }
  }

  /**
   * Processes a confirmed Redsys payment.
   * Public to allow direct invocation in e2e tests (which cannot go through
   * HMAC verification against the real Redsys environment).
   */
  async processSuccess(data: RedsysJobData): Promise<void> {
    const { transactionId, dsAmount, dsOrder } = data;

    // ── Load Transaction with Price → CreditPack / BumpPack ──────────────────
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        price: {
          include: { creditPack: true, bumpPack: true },
        },
      },
    });

    if (!transaction) {
      this.logger.error(`RedsysProcessor: Transaction ${transactionId} not found`);
      return;
    }

    // ── Idempotency layer 2: skip if already processed ───────────────────────
    if (transaction.status !== TransactionStatus.PENDING) {
      this.logger.debug(
        `RedsysProcessor: Transaction ${transactionId} already in status ${transaction.status} — skipping`,
      );
      return;
    }

    // ── Amount validation ─────────────────────────────────────────────────────
    const expectedCents = Math.round(transaction.amountGross.mul(100).toNumber());
    const actualCents = parseInt(dsAmount, 10);

    if (expectedCents !== actualCents) {
      this.logger.error(
        `Amount mismatch for Transaction ${transactionId} (Ds_Order=${dsOrder}): ` +
          `expected ${expectedCents} cents, Redsys sent ${actualCents}. Marking FAILED.`,
      );
      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.FAILED },
      });
      return;
    }

    // ── Route by type ─────────────────────────────────────────────────────────
    const creditPack = transaction.price?.creditPack;
    const bumpPack = transaction.price?.bumpPack;

    if (creditPack) {
      // baseCreditAmount is frozen at checkout; only fall back to a live read
      // for PENDING transactions created before this field existed.
      const baseCreditAmount = transaction.baseCreditAmount ?? creditPack.creditAmount;
      await this.handlePackPurchase(
        transaction.userId,
        transactionId,
        baseCreditAmount,
        transaction.bonusCreditAmount,
        transaction.campaignBonusAmount,
      );
    } else if (bumpPack) {
      // Monetización ráfaga 4 — mismo idempotency layer de arriba (status !==
      // PENDING ya cortó antes de llegar aquí); acredita BumpLedger/
      // Wallet.bumpBalance, nunca CreditLedger/balance.
      const baseBumpAmount = transaction.baseBumpAmount ?? bumpPack.bumpAmount;
      await this.handleBumpPackPurchase(
        transaction.userId,
        transactionId,
        baseBumpAmount,
        transaction.bonusBumpAmount,
      );
    } else {
      // Featured pay via Redsys (RF.6)
      if (!transaction.listingId || !transaction.price?.durationDays) {
        this.logger.error(
          `RedsysProcessor: Transaction ${transactionId} has no listingId or durationDays — marking FAILED`,
        );
        await this.prisma.transaction.update({
          where: { id: transactionId },
          data: { status: TransactionStatus.FAILED },
        });
        return;
      }
      await this.handleFeaturedPay(
        transaction.userId,
        transactionId,
        transaction.listingId,
        transaction.priceId,
        transaction.price.durationDays,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Pack purchase: wallet accreditation
  // ---------------------------------------------------------------------------

  private async handlePackPurchase(
    userId: string,
    transactionId: string,
    creditAmount: number,
    bonusCreditAmount: number | null,
    campaignBonusAmount: number | null,
  ): Promise<void> {
    const totalCredit = creditAmount + (bonusCreditAmount ?? 0) + (campaignBonusAmount ?? 0);

    await this.prisma.$transaction(async (tx) => {
      // Upsert Wallet with total credits (base + bonus) atomically.
      const wallet = await tx.wallet.upsert({
        where: { userId },
        create: { userId, balance: totalCredit },
        update: { balance: { increment: totalCredit } },
        select: { id: true },
      });

      // Base ledger entry (always present).
      await tx.creditLedger.create({
        data: {
          walletId: wallet.id,
          type: CreditLedgerType.PACK_PURCHASE,
          amount: creditAmount,
          referenceType: 'Transaction',
          referenceId: transactionId,
        },
      });

      // Pro bonus ledger entry (only when bonus was frozen at checkout).
      if (bonusCreditAmount != null) {
        await tx.creditLedger.create({
          data: {
            walletId: wallet.id,
            type: CreditLedgerType.PRO_BONUS,
            amount: bonusCreditAmount,
            referenceType: 'Transaction',
            referenceId: transactionId,
          },
        });
      }

      // Campaign bonus ledger entry (only when a campaign was active at checkout).
      if (campaignBonusAmount != null) {
        await tx.creditLedger.create({
          data: {
            walletId: wallet.id,
            type: CreditLedgerType.CAMPAIGN_BONUS,
            amount: campaignBonusAmount,
            referenceType: 'Transaction',
            referenceId: transactionId,
          },
        });
      }

      // Mark the Transaction as SUCCEEDED.
      await tx.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.SUCCEEDED },
      });
    });

    this.logger.log(
      `Pack purchase processed: user=${userId}, transactionId=${transactionId}, ` +
        `creditAmount=+${creditAmount}` +
        (bonusCreditAmount != null ? `, proBonus=+${bonusCreditAmount}` : '') +
        (campaignBonusAmount != null ? `, campaignBonus=+${campaignBonusAmount}` : ''),
    );
  }

  // ---------------------------------------------------------------------------
  // Bump pack purchase: bumpBalance accreditation (Monetización ráfaga 4)
  // ---------------------------------------------------------------------------

  /**
   * Espejo literal de handlePackPurchase, moneda distinta: acredita
   * Wallet.bumpBalance/BumpLedger, nunca balance/CreditLedger. Dos filas
   * SEPARADAS (PACK_PURCHASE + PRO_BONUS), no una combinada — mismo criterio
   * que créditos: permite reportar "cuánto regala el bonus Pro" como métrica
   * de negocio, sin depender de una migración de datos si algún día hiciera
   * falta desglosarlo (decisión explícita, no el combinado propuesto
   * originalmente). Sin bonus de campaña — los packs de bumps no lo tienen
   * (ver createBumpPackCheckout).
   *
   * Misma idempotencia que créditos: el caller (processSuccess) ya comprobó
   * `status !== PENDING` antes de llegar aquí — un reintento de BullMQ sobre
   * una Transaction ya SUCCEEDED nunca ejecuta este método dos veces.
   */
  private async handleBumpPackPurchase(
    userId: string,
    transactionId: string,
    bumpAmount: number,
    bonusBumpAmount: number | null,
  ): Promise<void> {
    const totalBumps = bumpAmount + (bonusBumpAmount ?? 0);

    await this.prisma.$transaction(async (tx) => {
      // Upsert Wallet with total bumps (base + bonus) atomically.
      const wallet = await tx.wallet.upsert({
        where: { userId },
        create: { userId, bumpBalance: totalBumps },
        update: { bumpBalance: { increment: totalBumps } },
        select: { id: true },
      });

      // Base ledger entry (always present).
      await tx.bumpLedger.create({
        data: {
          walletId: wallet.id,
          type: BumpLedgerType.PACK_PURCHASE,
          amount: bumpAmount,
          referenceType: 'Transaction',
          referenceId: transactionId,
        },
      });

      // Pro bonus ledger entry (only when bonus was frozen at checkout) —
      // fila SEPARADA de PACK_PURCHASE, mismo criterio que créditos.
      if (bonusBumpAmount != null) {
        await tx.bumpLedger.create({
          data: {
            walletId: wallet.id,
            type: BumpLedgerType.PRO_BONUS,
            amount: bonusBumpAmount,
            referenceType: 'Transaction',
            referenceId: transactionId,
          },
        });
      }

      // Mark the Transaction as SUCCEEDED.
      await tx.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.SUCCEEDED },
      });
    });

    this.logger.log(
      `Bump pack purchase processed: user=${userId}, transactionId=${transactionId}, ` +
        `bumpAmount=+${bumpAmount}` +
        (bonusBumpAmount != null ? `, proBonus=+${bonusBumpAmount}` : ''),
    );
  }

  // ---------------------------------------------------------------------------
  // Featured pay via Redsys: grant entitlement (RF.6, §3.4)
  // ---------------------------------------------------------------------------

  /**
   * Grants a FEATURED_LISTING entitlement for a confirmed Redsys featured-pay.
   *
   * grantFeaturedListingAndSucceed grants the entitlement AND marks the
   * Transaction SUCCEEDED atomically (same Postgres transaction), so a failure
   * at any point rolls back both and BullMQ's retry starts from a clean PENDING
   * state. See that method's doc for the bug this replaced (a two-step version
   * where a failure between the two steps left the Transaction PENDING forever).
   */
  private async handleFeaturedPay(
    userId: string,
    transactionId: string,
    listingId: string,
    priceId: string,
    durationDays: number,
  ): Promise<void> {
    await this.billingService.grantFeaturedListingAndSucceed({
      userId,
      listingId,
      durationDays,
      priceId,
      transactionId,
      origin: FeaturedOrigin.REDSYS,
    });
  }
}
