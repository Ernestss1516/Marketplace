import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ParseError, createRedsysAPI, SANDBOX_URLS, PRODUCTION_URLS, type RedsysAPI } from 'redsys-easy';
import { TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { QUEUE_REDSYS } from '../../../infra/queue/queue.constants';
import { REDSYS_JOB, type RedsysJobData } from '../redsys.types';

/** Shape of the parsed notification attached to the request by this guard. */
export interface RedsysWebhookRequest {
  redsysNotification?: { dsOrder: string; dsAmount: string; dsResponse: string };
  isDuplicate?: boolean;
}

@Injectable()
export class RedsysWebhookGuard implements CanActivate {
  private readonly logger = new Logger(RedsysWebhookGuard.name);
  private _redsys: RedsysAPI | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_REDSYS) private readonly redsysQueue: Queue,
  ) {}

  // Lazy init — module starts without credentials in test environments.
  private get redsys(): RedsysAPI {
    if (!this._redsys) {
      const secretKey = this.config.get<string>('redsys.secretKey', '');
      if (!secretKey) throw new Error('Redsys not configured (REDSYS_SECRET_KEY missing)');
      const env = this.config.get<string>('redsys.environment', 'test');
      this._redsys = createRedsysAPI({
        secretKey,
        urls: env === 'production' ? PRODUCTION_URLS : SANDBOX_URLS,
      });
    }
    return this._redsys;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<
      RedsysWebhookRequest & { body?: Record<string, string> }
    >();

    const body = req.body ?? {};
    const { Ds_MerchantParameters, Ds_Signature, Ds_SignatureVersion } = body;

    if (!Ds_MerchantParameters || !Ds_Signature || !Ds_SignatureVersion) {
      throw new BadRequestException('Missing required Redsys notification fields');
    }

    // ── 1. Verify HMAC signature ─────────────────────────────────────────────
    let notification: { Ds_Order: string; Ds_Amount: string; Ds_Response: string };
    try {
      notification = this.redsys.processRedirectNotification({
        Ds_MerchantParameters,
        Ds_Signature,
        Ds_SignatureVersion,
      }) as { Ds_Order: string; Ds_Amount: string; Ds_Response: string };
    } catch (err) {
      if (err instanceof ParseError) {
        this.logger.warn(`Redsys webhook: signature verification failed — ${(err as Error).message}`);
        throw new BadRequestException('Invalid Redsys signature');
      }
      throw err;
    }

    const { Ds_Order: dsOrder, Ds_Amount: dsAmount, Ds_Response: dsResponse } = notification;

    // ── 2. Idempotency — insert GatewayEvent (layer 1) ───────────────────────
    try {
      await this.prisma.gatewayEvent.create({
        data: {
          gatewayEventId: dsOrder,
          eventType: 'redsys.notification',
          gateway: 'REDSYS',
        },
      });
    } catch (err: unknown) {
      if (
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        this.logger.debug(`Duplicate Redsys notification skipped: Ds_Order=${dsOrder}`);
        req.isDuplicate = true;
        req.redsysNotification = { dsOrder, dsAmount, dsResponse };
        return true;
      }
      throw err;
    }

    // ── 3. Resolve the pre-created Transaction ───────────────────────────────
    const transaction = await this.prisma.transaction.findUnique({
      where: { gatewayPaymentIntentId: dsOrder },
      select: { id: true },
    });

    if (!transaction) {
      this.logger.warn(`Redsys notification for unknown Ds_Order=${dsOrder} — rejecting`);
      throw new BadRequestException(`Unknown Ds_Order: ${dsOrder}`);
    }

    // ── 4. Route on payment outcome ──────────────────────────────────────────
    if (dsResponse === '0000') {
      const jobData: RedsysJobData = {
        transactionId: transaction.id,
        dsAmount,
        dsOrder,
      };
      await this.redsysQueue.add(REDSYS_JOB.PROCESS_SUCCESS, jobData);
      this.logger.log(`Redsys payment success enqueued: Ds_Order=${dsOrder}`);
    } else {
      await this.prisma.transaction.update({
        where: { id: transaction.id },
        data: { status: TransactionStatus.FAILED },
      });
      this.logger.warn(`Redsys payment failed: Ds_Order=${dsOrder}, Ds_Response=${dsResponse}`);
    }

    req.isDuplicate = false;
    req.redsysNotification = { dsOrder, dsAmount, dsResponse };
    return true;
  }
}
