import * as Sentry from '@sentry/nestjs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { CreditLedgerType, TransactionStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { QUEUE_REDSYS } from '../../infra/queue/queue.constants';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { REDSYS_JOB, type RedsysJobData } from './redsys.types';

@Processor(QUEUE_REDSYS)
export class RedsysProcessor extends WorkerHost {
  private readonly logger = new Logger(RedsysProcessor.name);

  constructor(private readonly prisma: PrismaService) {
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
    // Verify that Redsys actually charged the amount we requested.
    // Redsys sends Ds_Amount in cents (integer string); Transaction.amountGross is in EUR.
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
      await this.handlePackPurchase(transaction.userId, transactionId, creditPack.creditAmount);
    } else {
      // Featured pay via Redsys — completed in RF.6 (grantFeaturedListing).
      // TODO RF.6: call grantFeaturedListing({ userId, listingId, durationDays, priceId, transactionId })
      this.logger.warn(
        `RedsysProcessor: featured-pay Transaction ${transactionId} reached processor — ` +
          `grantFeaturedListing is pending RF.6. Marking SUCCEEDED without granting entitlement.`,
      );
      await this.prisma.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.SUCCEEDED },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Pack purchase: wallet accreditation
  // ---------------------------------------------------------------------------

  private async handlePackPurchase(
    userId: string,
    transactionId: string,
    creditAmount: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Upsert Wallet — creates with creditAmount if it doesn't exist yet,
      // or increments the existing balance. Both paths return the wallet id.
      const wallet = await tx.wallet.upsert({
        where: { userId },
        create: { userId, balance: creditAmount },
        update: { balance: { increment: creditAmount } },
        select: { id: true },
      });

      // Immutable ledger entry for this purchase.
      await tx.creditLedger.create({
        data: {
          walletId: wallet.id,
          type: CreditLedgerType.PACK_PURCHASE,
          amount: creditAmount,
          referenceType: 'Transaction',
          referenceId: transactionId,
        },
      });

      // Mark the Transaction as SUCCEEDED.
      await tx.transaction.update({
        where: { id: transactionId },
        data: { status: TransactionStatus.SUCCEEDED },
      });
    });

    this.logger.log(
      `Pack purchase processed: user=${userId}, transactionId=${transactionId}, ` +
        `creditAmount=+${creditAmount}`,
    );
  }
}
