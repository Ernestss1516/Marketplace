import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe = require('stripe');
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_BILLING } from '../../../infra/queue/queue.constants';
import { BILLING_JOB, BillingJobData, STRIPE_EVENTS } from '../billing.types';

const PROCESSED_EVENTS = new Set(Object.values(STRIPE_EVENTS));

@Injectable()
export class StripeWebhookGuard implements CanActivate {
  private readonly logger = new Logger(StripeWebhookGuard.name);
  private _stripe: Stripe | undefined;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_BILLING) private readonly billingQueue: Queue,
  ) {}

  private get stripe(): Stripe {
    if (!this._stripe) {
      const key = this.config.get<string>('stripe.secretKey', '');
      if (!key) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)');
      this._stripe = new Stripe(key);
    }
    return this._stripe;
  }

  private get webhookSecret(): string {
    return this.config.get<string>('stripe.webhookSecret', '');
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      rawBody?: Buffer;
      headers: Record<string, string>;
      stripeEvent?: Stripe.Event;
      isDuplicate?: boolean;
    }>();

    const sig = request.headers['stripe-signature'];
    const rawBody = request.rawBody;

    if (!sig || !rawBody) {
      throw new BadRequestException('Missing stripe-signature or body');
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, sig, this.webhookSecret);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid webhook signature';
      this.logger.warn(`Webhook signature verification failed: ${msg}`);
      throw new BadRequestException('Invalid webhook signature');
    }

    // Idempotency: insert the event ID; P2002 means already processed.
    try {
      await this.prisma.gatewayEvent.create({
        data: { gatewayEventId: event.id, eventType: event.type },
      });
    } catch (err: unknown) {
      // Prisma unique constraint violation — duplicate event.
      if (
        err !== null &&
        typeof err === 'object' &&
        'code' in err &&
        (err as { code: string }).code === 'P2002'
      ) {
        this.logger.debug(`Duplicate webhook event skipped: ${event.id}`);
        request.isDuplicate = true;
        request.stripeEvent = event;
        return true;
      }
      throw err;
    }

    // Only enqueue events we know how to handle; silently ack unknown types.
    if (PROCESSED_EVENTS.has(event.type as (typeof STRIPE_EVENTS)[keyof typeof STRIPE_EVENTS])) {
      const metadata: Record<string, string> =
        (event.data.object as { metadata?: Record<string, string> })?.metadata ?? {};

      const jobData: BillingJobData = {
        eventType: event.type,
        payload: event.data.object,
        metadata,
      };
      await this.billingQueue.add(BILLING_JOB.PROCESS_STRIPE_EVENT, jobData);
    } else {
      this.logger.debug(`Unhandled Stripe event type ignored: ${event.type}`);
    }

    request.stripeEvent = event;
    request.isDuplicate = false;
    return true;
  }
}
