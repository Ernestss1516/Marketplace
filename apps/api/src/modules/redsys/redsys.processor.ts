import * as Sentry from '@sentry/nestjs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CreditLedgerType, FeaturedOrigin, TransactionStatus } from '@prisma/client';
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

    // ── Load Transaction with Price → CreditPack ─────────────────────────────
    const transaction = await this.prisma.transaction.findUnique({
      where: { id: transactionId },
      include: {
        price: {
          include: { creditPack: true },
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

    if (creditPack) {
      await this.handlePackPurchase(
        transaction.userId,
        transactionId,
        creditPack.creditAmount,
        transaction.bonusCreditAmount,
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
  ): Promise<void> {
    const totalCredit = creditAmount + (bonusCreditAmount ?? 0);

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

      // Mark the Transaction as SUCCEEDED.
      await tx.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.SUCCEEDED },
      });
    });

    this.logger.log(
      `Pack purchase processed: user=${userId}, transactionId=${transactionId}, ` +
        `creditAmount=+${creditAmount}` +
        (bonusCreditAmount != null ? `, proBonus=+${bonusCreditAmount}` : ''),
    );
  }

  // ---------------------------------------------------------------------------
  // Featured pay via Redsys: grant entitlement (RF.6, §3.4)
  // ---------------------------------------------------------------------------

  /**
   * Grants a FEATURED_LISTING entitlement for a confirmed Redsys featured-pay.
   *
   * Design (§3.4): call grantFeaturedListing FIRST (in its own Postgres TX);
   * only mark Transaction SUCCEEDED after the entitlement is persisted.
   * This keeps Transaction PENDING on failure so BullMQ can retry.
   */
  private async handleFeaturedPay(
    userId: string,
    transactionId: string,
    listingId: string,
    priceId: string,
    durationDays: number,
  ): Promise<void> {
    // Grant entitlement (validates listing ACTIVE + ownership + no duplicate) + enqueues indexing.
    // If this throws, Transaction stays PENDING and BullMQ retries.
    await this.billingService.grantFeaturedListing({
      userId,
      listingId,
      durationDays,
      priceId,
      transactionId,
      origin: FeaturedOrigin.REDSYS,
    });

    // Mark Transaction SUCCEEDED only after entitlement is confirmed created.
    await this.prisma.transaction.update({
      where: { id: transactionId },
      data: { status: TransactionStatus.SUCCEEDED },
    });

    this.logger.log(
      `Featured pay processed: user=${userId}, listing=${listingId}, tx=${transactionId}`,
    );
  }
}
