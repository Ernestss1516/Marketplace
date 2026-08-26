import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import Stripe = require('stripe');
import {
  BumpLedgerType,
  CreditLedgerType,
  EntitlementType,
  FeaturedOrigin,
  ListingStatus,
  Prisma,
  ProductType,
  SubscriptionStatus,
  TransactionStatus,
} from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { listingCacheKey } from '../../infra/redis/cache-keys';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';
import { CampaignsService } from '../campaigns/campaigns.service';
import { EntitlementService } from './entitlement.service';
import { ListingGateService } from '../listing-gate/listing-gate.service';
import { BUMP_COOLDOWN_SECONDS } from './bump-cooldown';
import { suscripcionVigenteFilter } from './subscription-vigente';
// E-4/E-5 — la fórmula del bonus Pro, compartida con el checkout que lo congela.
import {
  DEFAULT_PRO_EXTRA_PERCENT,
  PRO_EXTRA_BUMPS_SETTING,
  PRO_EXTRA_CREDITS_SETTING,
  proBonusAmount,
} from './pro-bonus';
import { CheckoutDto } from './dto/checkout.dto';
import { FeaturedByCreditsDto } from './dto/featured-by-credits.dto';
import { TransactionsQueryDto } from './dto/transactions-query.dto';
import { WalletQueryDto } from './dto/wallet-query.dto';
// El interruptor del vídeo y su límite de duración: /planes anuncia la ventaja SÓLO si está
// encendida, y con el mismo número que el servidor valida al subir. Fichero de constantes
// sin dependencias, así que no acopla BillingModule con VideoModule.
import { MAX_VIDEO_DURATION_SECONDS, VIDEO_ENABLED_SETTING } from '../video/video-limits';

// ---------------------------------------------------------------------------
// Shared interface for granting a featured listing entitlement.
// The single source of truth — both credit and Redsys paths use it.
// ---------------------------------------------------------------------------

export interface GrantFeaturedParams {
  userId: string;
  listingId: string;
  durationDays: number;
  /** Null for grants with no real Price behind them (coupons) — column is nullable, same as PRO_QUOTA. */
  priceId?: string;
  /** Only set when a real payment was made (Redsys path). */
  transactionId?: string;
  /** Which bag this grant comes from (H8.1/H8.2/H8 Bloque D fase 3) — CREDITS, REDSYS, PRO_QUOTA or COUPON. */
  origin: FeaturedOrigin;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private _stripe: Stripe | undefined;
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
    private readonly campaigns: CampaignsService,
    private readonly config: ConfigService,
    // UXV.1 (A2) — solo para invalidar la ficha cacheada tras un bump; ver el
    // comentario al final de bump(). RedisModule es @Global, así que no hace
    // falta importarlo en BillingModule.
    private readonly redis: RedisService,
    // PUERTA — RÁFAGA 2: el freno de `needsRevalidation` en bump y destacado.
    // `ListingGateModule` es hoja, así que esta dirección (Billing → puerta) no
    // crea ningún ciclo — es la misma por la que ya llega `ProStatusService`.
    private readonly gate: ListingGateService,
    @InjectQueue(QUEUE_INDEXING) private readonly indexingQueue: Queue,
  ) {
    this.appUrl = config.get<string>('appUrl', 'http://localhost:3000');
  }

  private get stripe(): Stripe {
    if (!this._stripe) {
      const key = this.config.get<string>('stripe.secretKey', '');
      if (!key) throw new Error('Stripe is not configured (STRIPE_SECRET_KEY missing)');
      this._stripe = new Stripe(key);
    }
    return this._stripe;
  }

  // ---------------------------------------------------------------------------
  // Stripe Pro checkout — RECURRING (Plan Pro) only.
  //
  // Featured listings (ONE_TIME) used to be purchasable here too, but that
  // path (BillingProcessor.handleOneTimePayment) never re-validated
  // ownership/ACTIVE/duplicate at grant time, never set `origin`, never
  // enqueued reindexing, and wasn't wrapped in the same $transaction as the
  // Transaction upsert — a retried webhook/job could grant a second
  // entitlement with nothing to stop it. Redsys is now the only card channel
  // for destacado (POST /billing/checkout/featured-pay, via
  // grantFeaturedListingTx). Closed explicitly below rather than left to
  // silently ignore a stray listingId.
  // ---------------------------------------------------------------------------

  async createCheckoutSession(userId: string, dto: CheckoutDto): Promise<{ checkoutUrl: string }> {
    const price = await this.prisma.price.findUnique({
      where: { id: dto.priceId },
      include: { product: true },
    });
    if (!price || !price.active) throw new NotFoundException('Price not found or inactive');

    if (price.product.type === ProductType.ONE_TIME) {
      throw new BadRequestException(
        'Los destacados no se compran por Stripe. Usa POST /billing/checkout/featured-pay (Redsys).',
      );
    }

    /**
     * UXV.6 (M4) — NO se abre un segundo checkout a quien ya es Pro.
     *
     * Antes no había nada que lo impidiera, ni aquí ni en la interfaz: `/planes` enseñaba
     * «Hazte Pro» también a un suscriptor, y pulsarlo creaba una segunda suscripción de
     * Stripe sobre la misma cuenta. Dos cobros recurrentes por el mismo plan.
     *
     * El guard va EN EL SERVIDOR y no solo en el botón a propósito: esconder el botón deja
     * el agujero abierto a cualquier POST directo, y lo que está en juego es cobrar dos
     * veces.
     *
     * `PAST_DUE` NO bloquea: ahí el cobro falló y la suscripción está en el aire, así que
     * impedir rehacerla dejaría al usuario sin salida. `CANCELING` sí bloquea — sigue
     * siendo Pro hasta el fin del periodo, y suscribirse otra vez solaparía dos cobros.
     */
    const suscripcionVigente = await this.prisma.subscription.findFirst({
      // El predicado se comparte con `GET /billing/pro-status`, que es de donde la interfaz
      // saca si enseña «Ya eres Pro» o «Hazte Pro». Con una copia en cada sitio, el botón
      // podía ofrecer un checkout que este guard rechaza — o esconder uno que aceptaría, que
      // es lo que le pasaba a un Pro concedido a mano. Ver subscription-vigente.ts.
      where: suscripcionVigenteFilter(userId),
      select: { id: true, status: true },
    });
    if (suscripcionVigente) {
      throw new BadRequestException({
        code: 'ALREADY_SUBSCRIBED',
        message:
          suscripcionVigente.status === SubscriptionStatus.CANCELING
            ? 'Tu plan Pro sigue activo hasta el final del periodo. No hace falta volver a suscribirse.'
            : 'Ya tienes un plan Pro activo.',
      });
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, name: true, stripeCustomerId: true },
    });

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({ email: user.email, name: user.name });
      customerId = customer.id;
      await this.prisma.user.update({ where: { id: userId }, data: { stripeCustomerId: customerId } });
    }

    const successUrl = `${this.appUrl}/planes/exito?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${this.appUrl}/planes/cancelado`;

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: price.gatewayPriceId ?? undefined, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { userId, priceId: dto.priceId },
      subscription_data: {
        metadata: { userId, priceId: dto.priceId },
      },
    });

    if (!session.url) throw new BadRequestException('Stripe did not return a checkout URL');
    return { checkoutUrl: session.url };
  }

  async cancelSubscription(userId: string, subscriptionId: string): Promise<void> {
    const subscription = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
    });

    if (!subscription) throw new NotFoundException('Subscription not found');
    if (subscription.userId !== userId) throw new ForbiddenException('Not your subscription');
    if (subscription.status === SubscriptionStatus.CANCELED) {
      throw new BadRequestException('Subscription is already canceled');
    }

    await this.stripe.subscriptions.update(subscription.gatewaySubscriptionId, {
      cancel_at_period_end: true,
    });

    await this.prisma.subscription.update({
      where: { id: subscriptionId },
      data: { cancelAtPeriodEnd: true, status: SubscriptionStatus.CANCELING },
    });

    this.logger.log(`Subscription ${subscriptionId} set to cancel at period end (user ${userId})`);
  }

  /**
   * BORRADO DE CUENTAS C2 (§6.5) — cancela TODAS las suscripciones vivas de un
   * usuario cuya cuenta se acaba de archivar.
   *
   * NO ES `cancelSubscription` CON OTRO NOMBRE, y las diferencias importan:
   *
   *  · **No comprueba propiedad.** Aquí no hay un usuario pidiendo cancelar la
   *    suya: hay una cuenta que ha dejado de existir. La autorización ya la hizo
   *    quien archivó (el propio usuario, o un MODERATOR).
   *  · **Es idempotente y recorre todas.** Lo llama un job con reintentos, así que
   *    tiene que poder ejecutarse dos veces sin romperse: las que ya están
   *    `CANCELING`/`CANCELED` se saltan en vez de dar 400.
   *
   * `cancel_at_period_end` y no cancelación inmediata: el periodo ya está pagado y
   * archivar es REVERSIBLE — si el usuario desarchiva antes del corte, no se le ha
   * quitado nada que hubiera comprado. La cancelación inmediata es de C5, donde ya
   * no hay vuelta.
   */
  async cancelActiveSubscriptionsFor(userId: string): Promise<number> {
    const vivas = await this.prisma.subscription.findMany({
      where: {
        userId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE] },
      },
      select: { id: true, gatewaySubscriptionId: true },
    });

    for (const sub of vivas) {
      // Si Stripe falla, se propaga: el job lo reintenta. Tragarlo aquí sería
      // exactamente el fallo silencioso que este camino existe para evitar.
      await this.stripe.subscriptions.update(sub.gatewaySubscriptionId, {
        cancel_at_period_end: true,
      });
      await this.prisma.subscription.update({
        where: { id: sub.id },
        data: { cancelAtPeriodEnd: true, status: SubscriptionStatus.CANCELING },
      });
      this.logger.log(`Subscription ${sub.id} cancelada por archivado de la cuenta ${userId}`);
    }

    return vivas.length;
  }

  async getMySubscriptions(userId: string) {
    return this.prisma.subscription.findMany({
      where: {
        userId,
        status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.CANCELING, SubscriptionStatus.PAST_DUE] },
      },
      include: { price: { include: { product: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMyEntitlements(userId: string) {
    return this.entitlements.findActiveForUser(userId);
  }

  async getMyTransactions(userId: string, query: TransactionsQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where: { userId },
        include: { price: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.transaction.count({ where: { userId } }),
    ]);
    return { items, total, page, perPage, totalPages: Math.ceil(total / perPage) };
  }

  // ---------------------------------------------------------------------------
  // Featured listing — unified grant operation (§3.2)
  // ---------------------------------------------------------------------------

  /**
   * Thin standalone wrapper around grantFeaturedListingTx for callers that don't
   * already have an open transaction: opens its own $transaction, then enqueues
   * reindexing and logs after commit.
   *
   * Used by featuredByCredits and CouponsService.redeem. NOT used by the Redsys
   * path — see grantFeaturedListingAndSucceed, which needs the Transaction
   * status update inside the SAME atomic block (see its own doc for why).
   */
  async grantFeaturedListing(params: GrantFeaturedParams): Promise<void> {
    await this.prisma.$transaction((tx) => this.grantFeaturedListingTx(tx, params));

    await this.indexingQueue.add('index', { listingId: params.listingId });

    this.logger.log(
      `Featured listing granted: listingId=${params.listingId}, userId=${params.userId}, ` +
        `durationDays=${params.durationDays}, origin=${params.origin}, ` +
        `transactionId=${params.transactionId ?? 'none'}`,
    );
  }

  /**
   * Redsys-only variant of grantFeaturedListing: grants the entitlement AND marks
   * the Transaction SUCCEEDED in the SAME Postgres transaction.
   *
   * Fixes a money-accounting bug found by e2e (redsys-featured-payment-e2e):
   * the previous design granted the entitlement in its own tx, then updated
   * Transaction.status in a separate step "so BullMQ can retry" if that second
   * step failed. But grantFeaturedListingTx's own guard ("listing already has
   * an active featured period") then rejects every retry, since the entitlement
   * from the first attempt is already there — so the Transaction is stuck
   * PENDING forever after any transient failure on the status update, with no
   * way for BullMQ's retry to ever complete it. Wrapping both steps atomically
   * means a mid-way failure rolls back the entitlement too, so a retry starts
   * from a clean PENDING state exactly like every other job retry in this app.
   */
  async grantFeaturedListingAndSucceed(
    params: GrantFeaturedParams & { transactionId: string },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await this.grantFeaturedListingTx(tx, params);
      await tx.transaction.update({
        where: { id: params.transactionId },
        data: { status: TransactionStatus.SUCCEEDED },
      });
    });

    await this.indexingQueue.add('index', { listingId: params.listingId });

    this.logger.log(
      `Featured listing granted (Redsys): listingId=${params.listingId}, userId=${params.userId}, ` +
        `durationDays=${params.durationDays}, transactionId=${params.transactionId}`,
    );
  }

  /**
   * The ONLY place that creates a FEATURED_LISTING entitlement (H8 Bloque D
   * fase 4 — unification). Validates listing ownership + ACTIVE + no existing
   * active entitlement, then Entitlement.create. No indexing enqueue, no
   * logging here — the caller's own transaction may still roll back after
   * this returns. Runs against the CALLER's `tx`, so it composes inside a
   * larger atomic operation. Returns the created entitlement's id for the
   * caller's own traceability (e.g. CouponRedemption.referenceId) without an
   * extra query.
   *
   * Called from (always inside a $transaction):
   *   - grantFeaturedListing (its own tx) — RedsysProcessor.handleFeaturedPay
   *   - BillingService.featuredByCredits — both the quota branch and the
   *     credits branch call this instead of creating the entitlement inline;
   *     each still runs its own assertFeaturable() pre-check first purely for
   *     a fast, structured `code: 'ALREADY_FEATURED'` HTTP response (same
   *     pattern as RedsysService's checkout-creation pre-check) — the
   *     re-validation in here is the real backstop, same tx/snapshot.
   *   - CouponsService.redeem — composed inside its own $transaction
   *
   * Duration is caller-supplied (`durationDays`) and legitimately differs by
   * channel: fixed Setting for Pro quota, Price.durationDays for Redsys/credits,
   * the coupon's own value for cupón. That's the one thing that's allowed to
   * diverge — the grant itself does not.
   */
  async grantFeaturedListingTx(
    tx: Prisma.TransactionClient,
    params: GrantFeaturedParams,
  ): Promise<{ entitlementId: string }> {
    const { userId, listingId, durationDays, priceId, transactionId, origin } = params;

    // Validate listing exists, is ACTIVE, and belongs to userId
    const listing = await tx.listing.findUnique({
      where: { id: listingId },
      select: { id: true, status: true, sellerId: true },
    });
    if (!listing || listing.sellerId !== userId) {
      throw new ForbiddenException('Listing does not exist or does not belong to you');
    }
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Only ACTIVE listings can be featured');
    }

    // Check no active FEATURED_LISTING for this listing
    const existing = await tx.entitlement.findFirst({
      where: {
        listingId,
        type: EntitlementType.FEATURED_LISTING,
        expiresAt: { gt: new Date() },
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('Listing already has an active featured period');
    }

    // Create the entitlement
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    const entitlement = await tx.entitlement.create({
      data: {
        userId,
        type: EntitlementType.FEATURED_LISTING,
        listingId,
        expiresAt,
        priceId,
        origin,
        ...(transactionId && { transactionId }),
      },
      select: { id: true },
    });

    return { entitlementId: entitlement.id };
  }

  // ---------------------------------------------------------------------------
  // Featured listing — via credits (§3.3)
  // ---------------------------------------------------------------------------

  /**
   * Shared validation for both featuring paths, run inside the caller's TX:
   * listing exists, belongs to userId, is ACTIVE, and has no active featured period.
   */
  private async assertFeaturable(
    tx: Prisma.TransactionClient,
    userId: string,
    listingId: string,
    now: Date,
  ): Promise<void> {
    const listing = await tx.listing.findUnique({
      where: { id: listingId },
      select: { id: true, status: true, sellerId: true },
    });
    if (!listing || listing.sellerId !== userId) {
      throw new ForbiddenException('Listing does not exist or does not belong to you');
    }
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Only ACTIVE listings can be featured');
    }

    const existing = await tx.entitlement.findFirst({
      where: {
        listingId,
        type: EntitlementType.FEATURED_LISTING,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException({
        message: 'Listing already has an active featured period',
        code: 'ALREADY_FEATURED',
      });
    }
  }

  private async getQuotaFeaturedDurationDays(): Promise<number> {
    const setting = await this.prisma.setting.findUnique({
      where: { key: 'proQuotaFeaturedDurationDays' },
    });
    return setting ? Number(setting.value) : 7;
  }

  /**
   * POST /billing/featured-by-credits
   *
   * H8.5a: the user CHOOSES the path via `dto.useQuota` — the backend no longer
   * picks quota automatically (that was H8.3; superseded by this ráfaga):
   *   - useQuota=true:  free grant from Pro's monthly quota, FIXED duration
   *     (proQuotaFeaturedDurationDays). Fails explicitly if no quota is left —
   *     never silently falls back to credits, since the user asked for quota.
   *   - useQuota=false (default): pays with credits, duration chosen via
   *     priceId (7/14/30d). Quota is left untouched even if available — the
   *     user can deliberately save it for later.
   *
   * Atomic: everything (quota check + grant, OR wallet debit + CreditLedger +
   * grant) happens in a single Postgres TX. Rollback restores credits if the
   * grant fails (e.g. already featured).
   */
  async featuredByCredits(
    userId: string,
    dto: FeaturedByCreditsDto,
  ): Promise<{ featuredUntil: Date; viaQuota: boolean }> {
    const { listingId } = dto;
    const now = new Date();

    // PUERTA — RÁFAGA 2. El camino 10, con el mismo criterio que `bump`: sólo el
    // freno de `needsRevalidation`, y ANTES de abrir la transacción (las dos
    // ramas de abajo abren la suya; llamar a la puerta dentro mezclaría dos
    // clientes de Prisma sobre la misma fila, que es como se fabrica un
    // interbloqueo).
    //
    // NO SE FRENA `grantFeaturedListingTx`, y es deliberado: ése corre también
    // desde el webhook de pago, cuando el dinero YA está cobrado. Bloquear allí
    // sería quedarse el pago sin entregar el destacado — lo peor de los dos
    // mundos. El sitio de frenar es aquí, antes de cobrar.
    await this.gate.assertCanBePromotedById(listingId, {
      actor: 'seller', transition: 'featured', actorId: userId,
    });

    if (dto.useQuota) {
      const durationDays = await this.getQuotaFeaturedDurationDays();
      const expiresAt = new Date(now);
      expiresAt.setDate(expiresAt.getDate() + durationDays);

      await this.prisma.$transaction(async (tx) => {
        await this.assertFeaturable(tx, userId, listingId, now);

        // Locks the user's Subscription row (FOR UPDATE) for the rest of this TX,
        // so two concurrent quota requests can never both see the last free slot
        // available (see EntitlementService.hasAvailableFeaturedQuota's doc).
        const hasQuota = await this.entitlements.hasAvailableFeaturedQuota(tx, userId);
        if (!hasQuota) {
          throw new BadRequestException({
            message: 'No tienes cuota de destacados disponible este periodo',
            code: 'QUOTA_UNAVAILABLE',
          });
        }

        // Free grant — no wallet debit, no CreditLedger entry, no priceId (no
        // variant was chosen: the quota always uses the fixed duration above).
        await this.grantFeaturedListingTx(tx, {
          userId,
          listingId,
          durationDays,
          origin: FeaturedOrigin.PRO_QUOTA,
        });
      });

      await this.indexingQueue.add('index', { listingId });
      this.logger.log(
        `Featured via quota: listingId=${listingId}, userId=${userId}, durationDays=${durationDays}`,
      );
      return { featuredUntil: expiresAt, viaQuota: true };
    }

    // Credits path — unchanged behavior, quota is never touched here.
    if (!dto.priceId) {
      throw new BadRequestException('priceId is required when not using the quota');
    }
    const price = await this.prisma.price.findUnique({
      where: { id: dto.priceId },
      select: { id: true, active: true, durationDays: true, creditPackId: true },
    });
    if (!price || !price.active) throw new NotFoundException('Price not found or inactive');
    if (!price.durationDays) throw new BadRequestException('Not a featured listing price');
    if (price.creditPackId) throw new BadRequestException('Not a featured listing price');

    const baseCost = await this.getCreditCostForFeatured(price.durationDays);
    // H8 Bloque D fase 2 — descuento de campaña, calculado EN VIVO (no hay
    // checkout que congelar: destacar con créditos es un débito atómico
    // instantáneo, igual que bump). Solo esta rama (créditos); la rama de
    // cuota Pro de arriba ya ha devuelto antes de llegar aquí — el descuento
    // nunca la toca. floor (no ceil): redondeo a favor del usuario en promoción.
    const discount = await this.campaigns.getActiveActionDiscount('FEATURED');
    const cost = discount
      ? Math.floor(baseCost * (100 - (discount.params as { percent: number }).percent) / 100)
      : baseCost;
    const priceId = dto.priceId;
    const durationDays = price.durationDays;
    const expiresAt = new Date(now);
    expiresAt.setDate(expiresAt.getDate() + durationDays);

    await this.prisma.$transaction(async (tx) => {
      await this.assertFeaturable(tx, userId, listingId, now);

      // Atomic debit: UPDATE ... WHERE balance >= cost
      const affected = await tx.$executeRaw`
        UPDATE "Wallet" SET balance = balance - ${cost}
        WHERE "userId" = ${userId} AND balance >= ${cost}
      `;
      if (affected === 0) {
        throw new HttpException('Insufficient credits', HttpStatus.PAYMENT_REQUIRED);
      }

      // Ledger entry — amount is the cost ALREADY discounted (the real debit).
      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { userId },
        select: { id: true },
      });
      await tx.creditLedger.create({
        data: {
          walletId: wallet.id,
          type: CreditLedgerType.FEATURED_DEBIT,
          amount: -cost,
          referenceType: 'Listing',
          referenceId: listingId,
          ...(discount && { note: `Campaña "${discount.name}" (-${(discount.params as { percent: number }).percent}%)` }),
        },
      });

      await this.grantFeaturedListingTx(tx, {
        userId,
        listingId,
        durationDays,
        priceId,
        origin: FeaturedOrigin.CREDITS,
      });
    });

    // After TX commits: enqueue reindexing
    await this.indexingQueue.add('index', { listingId });

    this.logger.log(
      `Featured by credits: listingId=${listingId}, userId=${userId}, ` +
        `durationDays=${durationDays}, cost=${cost}`,
    );

    return { featuredUntil: expiresAt, viaQuota: false };
  }

  // ---------------------------------------------------------------------------
  // Bump (§4)
  // ---------------------------------------------------------------------------

  /**
   * POST /listings/:id/bump
   * Atomic: wallet debit + ledger entry + Listing.bumpedAt in a single Postgres TX.
   * Failed attempts (insufficient credits, cooldown, not ACTIVE) do NOT update bumpedAt.
   *
   * CAPA 1 (bump automático, ráfaga 1) — EL ORDEN DENTRO DE LA TRANSACCIÓN IMPORTA:
   * primero se RECLAMA el turno (UPDATE condicional sobre `bumpedAt`, paso 0) y solo
   * después se cobra. Antes era al revés —cobrar y marcar al final— y eso dejaba una
   * ventana en la que dos ejecuciones concurrentes cobraban las dos. El contrato de cara
   * afuera no cambió con ese arreglo: mismo 429 con `retryAfter`, mismo `nextBumpAt`.
   *
   * Monetización ráfaga 3 — PRIORIDAD DE CONSUMO EN 3 NIVELES, todos dentro de
   * la MISMA $transaction, encadenados:
   *   1) Cuota mensual Pro (gratis, se pierde si no se usa este periodo —
   *      EntitlementService.hasAvailableBumpQuota, mismo lock SELECT ... FOR
   *      UPDATE sobre Subscription que ya usa la cuota de destacados).
   *   2) Saldo de bumps por cupón (bumpBalance — gratis, permanente, no
   *      caduca). UPDATE ... WHERE condicional, ráfaga 2.
   *   3) Créditos (de pago, con descuento de campaña si lo hay). Comportamiento
   *      previo intacto.
   * Orden deliberado: se gasta primero lo que se PIERDE al resetear (cuota),
   * luego lo gratis-permanente (cupón), luego lo pagado (créditos) — el
   * usuario nunca sale perdiendo por el orden automático. Ninguno de los tres
   * niveles se abarata por descuento de campaña salvo el 3 — los dos gratis ya
   * lo son, un descuento no tiene sentido ahí (mismo criterio que la cuota de
   * destacados).
   *
   * HISTÓRICO SIN AMBIGÜEDAD: la fila creada (BumpLedger PRO_QUOTA/BUMP_DEBIT
   * o CreditLedger, nunca dos para el mismo bump) usa siempre
   * referenceType='Listing' + referenceId=listingId — consultable por
   * referencia, no por cercanía a bumpedAt (ver comentario en schema.prisma).
   */
  async bump(
    listingId: string,
    userId: string,
  ): Promise<{ bumpedAt: Date; paidWith: 'PRO_QUOTA' | 'BUMP_BALANCE' | 'CREDITS'; cost: number }> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      // UXV.1 (A2) — `slug` es NUEVO: hace falta para invalidar la ficha cacheada
      // al terminar (ver el final de este método).
      //
      // CAPA 1 — `bumpedAt` YA NO SE SELECCIONA AQUÍ, y su ausencia es la señal: el
      // cooldown dejó de comprobarse leyendo la fila antes de la transacción. Ahora se
      // comprueba RECLAMÁNDOLA dentro (ver el paso 0). Si alguien vuelve a leerlo aquí
      // para "adelantar" el rechazo, habrá dos verdades sobre la ventana otra vez.
      select: { id: true, slug: true, status: true, sellerId: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.sellerId !== userId) throw new ForbiddenException('Not your listing');
    if (listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Only ACTIVE listings can be bumped');
    }

    // PUERTA — RÁFAGA 2. El camino 9 del diseño, y sólo el freno de
    // `needsRevalidation`: la regla de atributos, en `bump`, no revalida el
    // universo entero — únicamente a los anuncios ya marcados. Aquí, ANTES de la
    // transacción del cobro: rechazar después sería cobrar y devolver.
    await this.gate.assertCanBePromotedById(listingId, {
      actor: 'seller', transition: 'bump', actorId: userId,
    });

    const bumpCostSetting = await this.prisma.setting.findUnique({
      where: { key: 'bumpCreditCost' },
    });
    const baseCost = bumpCostSetting ? Number(bumpCostSetting.value) : 5;

    // H8 Bloque D fase 2 — mismo criterio que featuredByCredits: calculado en
    // vivo, floor a favor del usuario. Solo aplica a la rama de créditos.
    const discount = await this.campaigns.getActiveActionDiscount('BUMP');
    const creditCost = discount
      ? Math.floor(baseCost * (100 - (discount.params as { percent: number }).percent) / 100)
      : baseCost;

    const bumpedAt = new Date();
    const cooldownCutoff = new Date(bumpedAt.getTime() - BUMP_COOLDOWN_SECONDS * 1000);

    const { paidWith, cost } = await this.prisma.$transaction(async (tx) => {
      // 0) RECLAMAR EL TURNO — antes de cobrar, y de forma atómica.
      //
      // EL DEFECTO QUE CIERRA (deuda preexistente del bump MANUAL, no del bump
      // automático): hasta aquí el cooldown se comprobaba LEYENDO `bumpedAt` fuera de
      // la transacción, y el UPDATE que lo marcaba era la ÚLTIMA sentencia de las tres
      // ramas de abajo. Es decir: se cobraba primero y se marcaba después. Dos
      // ejecuciones concurrentes sobre el mismo anuncio podían leer ambas «no está en
      // cooldown» antes de que ninguna confirmara su UPDATE, y COBRAR LAS DOS.
      //
      // Con clics humanos hace falta una simultaneidad casi imposible. Con el scheduler
      // del bump automático (proyecto 2) corriendo en N instancias es el caso NORMAL, no
      // el raro — por eso este arreglo va antes y por separado.
      //
      // EL ARREGLO: se invierte el orden. Este UPDATE condicional escribe `bumpedAt`
      // SOLO si la ventana ya venció, y devuelve cuántas filas tocó. Una fila = el turno
      // es nuestro y se puede cobrar. Cero filas = otro lo reclamó (o nunca venció) y no
      // se cobra nada.
      //
      // POR QUÉ ES CORRECTO, y no un truco: bajo READ COMMITTED —el nivel por defecto de
      // PostgreSQL; este repo no fija `isolationLevel` en ninguna $transaction— un UPDATE
      // sobre una fila que otra transacción está modificando ESPERA a que esa confirme y
      // entonces REEVALÚA su WHERE contra la versión nueva. El segundo ve el `bumpedAt`
      // recién escrito, la condición falla, y toca 0 filas. No queda ventana entre la
      // comprobación y la escritura porque son la MISMA sentencia.
      //
      // NO ES UN PATRÓN NUEVO AQUÍ: es exactamente el idioma con el que este servicio ya
      // mueve dinero — `UPDATE "Wallet" SET balance = balance - N WHERE balance >= N` y
      // «si afectó 0 filas, error», en los tres sitios donde se cobra. Lo que cambia es
      // que el cooldown pasa a protegerse igual que el saldo.
      //
      // Y va DENTRO de la misma transacción que el cobro a propósito: si el cobro falla
      // (402), esto revierte con él. Nunca queda un `bumpedAt` marcado sin cobro, ni un
      // cobro sin `bumpedAt`.
      const claimed = await tx.$executeRaw`
        UPDATE "Listing" SET "bumpedAt" = ${bumpedAt}
        WHERE id = ${listingId}
          AND ("bumpedAt" IS NULL OR "bumpedAt" <= ${cooldownCutoff})
      `;

      if (claimed === 0) {
        // Mismo rechazo que siempre: 429 con `retryAfter`. El contrato no cambia — lo
        // único distinto es que ahora el dato se relee aquí (camino de error, barato)
        // en vez de venir del `select` de arriba.
        const rows = await tx.$queryRaw<{ bumpedAt: Date | null }[]>`
          SELECT "bumpedAt" FROM "Listing" WHERE id = ${listingId}
        `;
        // El anuncio existía al entrar; si ya no está, la causa no es el cooldown.
        if (rows.length === 0) throw new NotFoundException('Listing not found');

        const last = rows[0].bumpedAt;
        const elapsedSeconds = last ? (bumpedAt.getTime() - last.getTime()) / 1000 : 0;
        const retryAfter = Math.ceil(BUMP_COOLDOWN_SECONDS - elapsedSeconds);
        throw new HttpException(
          { message: 'Cooldown active — wait before bumping again', retryAfter },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // 1) Cuota mensual Pro — se pierde si no se usa este periodo, así que
      // se gasta primero. hasAvailableBumpQuota bloquea (FOR UPDATE) la fila
      // Subscription del usuario hasta que esta tx confirme o revierta.
      const hasBumpQuota = await this.entitlements.hasAvailableBumpQuota(tx, userId);
      if (hasBumpQuota) {
        // upsert, no findUniqueOrThrow: un Pro con cuota disponible puede no
        // haber tenido NUNCA una fila Wallet (nunca compró créditos ni
        // recibió un cupón de bump) — a diferencia del nivel 2, donde
        // bumpBalance >= 1 ya implica que la fila existe.
        const wallet = await tx.wallet.upsert({
          where: { userId },
          create: { userId },
          update: {},
          select: { id: true },
        });
        // amount: 0 — SIEMPRE. Esta fila es un marcador contable para el
        // COUNT de la cuota (mismo rol que Entitlement.origin=PRO_QUOTA para
        // destacados), NO un movimiento de bumpBalance. amount:-1 rompería
        // el invariante wallet.bumpBalance == SUM(BumpLedger.amount).
        await tx.bumpLedger.create({
          data: {
            walletId: wallet.id,
            type: BumpLedgerType.PRO_QUOTA,
            amount: 0,
            referenceType: 'Listing',
            referenceId: listingId,
          },
        });
        // `bumpedAt` ya quedó escrito en el paso 0 (el reclamo). Marcarlo aquí otra vez
        // sería volver a "cobrar primero, marcar después", que es justo lo que se cierra.
        return { paidWith: 'PRO_QUOTA' as const, cost: 0 };
      }

      // 2) Intentar saldo de bumps por cupón — 1 unidad, siempre, sin descuento.
      const viaBumpBalance = await tx.$executeRaw`
        UPDATE "Wallet" SET "bumpBalance" = "bumpBalance" - 1
        WHERE "userId" = ${userId} AND "bumpBalance" >= 1
      `;

      if (viaBumpBalance > 0) {
        const wallet = await tx.wallet.findUniqueOrThrow({
          where: { userId },
          select: { id: true },
        });
        await tx.bumpLedger.create({
          data: {
            walletId: wallet.id,
            type: BumpLedgerType.BUMP_DEBIT,
            amount: -1,
            referenceType: 'Listing',
            referenceId: listingId,
          },
        });
        return { paidWith: 'BUMP_BALANCE' as const, cost: 0 };
      }

      // 3) Sin cuota ni saldo de bumps — débito de créditos, exactamente como antes.
      const affected = await tx.$executeRaw`
        UPDATE "Wallet" SET balance = balance - ${creditCost}
        WHERE "userId" = ${userId} AND balance >= ${creditCost}
      `;
      if (affected === 0) {
        throw new HttpException('Insufficient credits', HttpStatus.PAYMENT_REQUIRED);
      }

      const wallet = await tx.wallet.findUniqueOrThrow({
        where: { userId },
        select: { id: true },
      });
      await tx.creditLedger.create({
        data: {
          walletId: wallet.id,
          type: CreditLedgerType.BUMP_DEBIT,
          amount: -creditCost,
          referenceType: 'Listing',
          referenceId: listingId,
          ...(discount && { note: `Campaña "${discount.name}" (-${(discount.params as { percent: number }).percent}%)` }),
        },
      });

      return { paidWith: 'CREDITS' as const, cost: creditCost };
    });

    // After TX commits: enqueue reindexing so Meilisearch picks up new sortDate
    await this.indexingQueue.add('index', { listingId });

    // UXV.1 (A2) — invalidar la ficha cacheada. `findBySlug` guarda el anuncio
    // entero en Redis 5 min, `bumpedAt` incluido, y de `bumpedAt` se deriva ahora
    // el `nextBumpAt` que la ficha usa para deshabilitar el botón. Sin esto, tras
    // bumpear desde la ficha el `router.refresh()` seguiría leyendo el blob viejo
    // y la ficha diría "puedes bumpear" mientras la tarjeta dice lo contrario —
    // exactamente la discrepancia entre superficies que A2 cierra. Mismo criterio
    // que ya aplican update/delete en ListingsService.
    await this.redis.client.del(listingCacheKey(listing.slug));

    this.logger.log(`Bump: listingId=${listingId}, userId=${userId}, paidWith=${paidWith}, cost=${cost}`);
    return { bumpedAt, paidWith, cost };
  }

  // ---------------------------------------------------------------------------
  // Wallet (§10 GET /billing/wallet)
  // ---------------------------------------------------------------------------

  async getWallet(userId: string, query: WalletQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      return { balance: 0, bumpBalance: 0, items: [], total: 0, page, perPage, totalPages: 0 };
    }

    const [items, total] = await Promise.all([
      this.prisma.creditLedger.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.creditLedger.count({ where: { walletId: wallet.id } }),
    ]);

    return {
      // Saldo de bumps SIEMPRE presente en la respuesta, aunque sea 0 — igual
      // que balance: ocultarlo cuando es 0 escondería que la función existe a
      // un usuario que aún no ha canjeado ningún cupón de bump.
      balance: wallet.balance,
      bumpBalance: wallet.bumpBalance,
      items,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    };
  }

  /**
   * Monetización ráfaga 2 — historial del saldo de bumps, en una lista
   * separada del historial de créditos (decisión de diseño explícita: fusionar
   * dos ledgers paginados de modelos distintos en una sola vista cronológica
   * exigiría una UNION SQL a mano; con los volúmenes reales de esta moneda
   * (unidades, no miles), dos listas independientes es la opción simple que
   * no sacrifica corrección — se puede revisar si algún día hace falta.
   */
  async getBumpLedger(userId: string, query: WalletQueryDto) {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;

    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      return { bumpBalance: 0, items: [], total: 0, page, perPage, totalPages: 0 };
    }

    const [items, total] = await Promise.all([
      this.prisma.bumpLedger.findMany({
        where: { walletId: wallet.id },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.bumpLedger.count({ where: { walletId: wallet.id } }),
    ]);

    return {
      bumpBalance: wallet.bumpBalance,
      items,
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    };
  }

  // ---------------------------------------------------------------------------
  // Catalog (public — no auth required)
  // ---------------------------------------------------------------------------

  async getCatalog() {
    const [products, settings] = await Promise.all([
      this.prisma.product.findMany({
        where: { active: true },
        include: {
          prices: {
            where: { active: true },
            include: { creditPack: true, bumpPack: true },
            // Monetización ráfaga 5 — orden ascendente por cantidad (no por
            // precio en €): duración para destacado, creditAmount para packs
            // de créditos, bumpAmount para packs de bumps. Cada Price solo
            // tiene una de las tres claves con valor real; las otras quedan
            // NULL y no afectan porque ya está agrupado por Product (los
            // packs de créditos y de bumps son productos distintos).
            orderBy: [
              { durationDays: 'asc' },
              { creditPack: { creditAmount: 'asc' } },
              { bumpPack: { bumpAmount: 'asc' } },
            ],
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.setting.findMany({
        where: {
          key: {
            in: [
              'featuredCreditCost7d',
              'featuredCreditCost14d',
              'featuredCreditCost30d',
              'bumpCreditCost',
              'proExtraBumpsPercent',
              // UXV.6 (M4) — los que componen la lista de beneficios Pro de /planes.
              'freeActiveListingLimit',
              'proActiveListingLimit',
              'proMonthlyFeaturedQuota',
              'proQuotaFeaturedDurationDays',
              'proMonthlyBumpQuota',
              'proExtraCreditsPercent',
              // El interruptor del vídeo Pro: decide si /planes lo anuncia (ver
              // buildProBenefits). Booleano, así que NO se lee por `settingMap`.
              VIDEO_ENABLED_SETTING,
            ],
          },
        },
      }),
    ]);

    const settingMap = Object.fromEntries(settings.map((s) => [s.key, Number(s.value)]));
    // `=== true` y no la coerción numérica de `settingMap`: es exactamente como lo lee
    // `VideoService.isEnabled`, y sin fila (o con cualquier otro valor) queda apagado.
    const videoActivo =
      settings.find((s) => s.key === VIDEO_ENABLED_SETTING)?.value === true;
    const featuredCreditCostByDays: Record<number, number> = {
      7: settingMap['featuredCreditCost7d'] ?? 30,
      14: settingMap['featuredCreditCost14d'] ?? 50,
      30: settingMap['featuredCreditCost30d'] ?? 100,
    };
    const baseBumpCreditCost = settingMap['bumpCreditCost'] ?? 5;
    // Monetización ráfaga 4 — expuesto para que la UI pueda PREVISUALIZAR el
    // bonus Pro de un pack de bumps antes de comprar ("+N de regalo"). Es solo
    // una vista previa: lo que de verdad se acredita se congela en el
    // checkout (RedsysService.computeProBonus), esto nunca se usa para cobrar.
    const proExtraBumpsPercent =
      settingMap[PRO_EXTRA_BUMPS_SETTING] ?? DEFAULT_PRO_EXTRA_PERCENT;
    // E-5 — hermano del de arriba. Los dos alimentan `proBonusAmount` por pack y viajan
    // en el catálogo para que la lista pueda enseñar el regalo antes de comprar.
    const proExtraCreditsPercent =
      settingMap[PRO_EXTRA_CREDITS_SETTING] ?? DEFAULT_PRO_EXTRA_PERCENT;

    // H8 Bloque D fase 2 — descuentos de campaña activos ahora mismo (a lo sumo
    // uno por acción). El catálogo es público y sin caché por request, así que
    // "en vivo" aquí es simplemente "leído en este momento", igual que el resto
    // del catálogo (Settings también se leen en vivo, sin congelar nada).
    const [featuredDiscount, bumpDiscount] = await Promise.all([
      this.campaigns.getActiveActionDiscount('FEATURED'),
      this.campaigns.getActiveActionDiscount('BUMP'),
    ]);
    const featuredDiscountPercent = featuredDiscount
      ? (featuredDiscount.params as { percent: number }).percent
      : null;
    const bumpDiscountPercent = bumpDiscount
      ? (bumpDiscount.params as { percent: number }).percent
      : null;
    const bumpCreditCost = bumpDiscountPercent != null
      ? Math.floor(baseBumpCreditCost * (100 - bumpDiscountPercent) / 100)
      : baseBumpCreditCost;

    return {
      products: products.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        type: p.type as string,
        prices: p.prices.map((price) => {
          const baseFeaturedCost = price.durationDays != null
            ? featuredCreditCostByDays[price.durationDays] ?? 0
            : null;
          const featuredCost = baseFeaturedCost != null && featuredDiscountPercent != null
            ? Math.floor(baseFeaturedCost * (100 - featuredDiscountPercent) / 100)
            : baseFeaturedCost;
          return {
            priceId: price.id,
            amount: Number(price.amount),
            currency: price.currency,
            ...(price.interval != null
              ? { interval: price.interval as string, intervalCount: price.intervalCount ?? 1 }
              : {}),
            ...(price.durationDays != null
              ? {
                  durationDays: price.durationDays,
                  creditCost: featuredCost,
                  ...(featuredDiscountPercent != null && {
                    originalCreditCost: baseFeaturedCost,
                    discountPercent: featuredDiscountPercent,
                  }),
                }
              : {}),
            ...(price.creditPack != null
              ? {
                  creditAmount: price.creditPack.creditAmount,
                  creditPackId: price.creditPack.id,
                  packName: price.creditPack.name,
                  // E-5 — LO QUE UN PRO SE LLEVA DE REGALO CON ESTE PACK, ya calculado.
                  //
                  // Se sirve para que la lista pueda ENSEÑARLO antes de comprar: a un Pro
                  // como su regalo, a un no-Pro como lo que se está perdiendo. El número no
                  // depende de quién pregunta —sólo del pack y del ajuste—, así que el
                  // catálogo puede seguir siendo público y decir la verdad a los dos.
                  //
                  // Sale de la MISMA función que congela el checkout (`proBonusAmount`), y
                  // ése es el punto: es lo que impide prometer un número y acreditar otro.
                  proBonusAmount: proBonusAmount(
                    price.creditPack.creditAmount,
                    proExtraCreditsPercent,
                  ),
                }
              : {}),
            // Monetización ráfaga 4 — packs de bumps DIRECTOS (acreditan
            // bumpBalance, no créditos). Sustituye al mecanismo highlightBumps/
            // bumpEquivalent de la ráfaga 2 (retirado — ver diseno-facturacion.md §19).
            ...(price.bumpPack != null
              ? {
                  bumpAmount: price.bumpPack.bumpAmount,
                  bumpPackId: price.bumpPack.id,
                  packName: price.bumpPack.name,
                  // E-4 — igual que en los packs de créditos, y con su propio ajuste. La
                  // lista lo calculaba por su cuenta repitiendo la fórmula: una segunda
                  // copia que podía separarse de la que cobra.
                  proBonusAmount: proBonusAmount(price.bumpPack.bumpAmount, proExtraBumpsPercent),
                }
              : {}),
          };
        }),
      })),
      bumpCreditCost,
      ...(bumpDiscountPercent != null && {
        bumpOriginalCreditCost: baseBumpCreditCost,
        bumpDiscountPercent,
      }),
      proExtraBumpsPercent,
      // E-5 — el porcentaje de CRÉDITOS no se publicaba, así que la lista de packs no
      // tenía con qué contarle a un no-Pro lo que se pierde. Su hermano de bumps ya salía
      // desde la ráfaga 4; la asimetría era del catálogo, no de la interfaz.
      proExtraCreditsPercent,
      /**
       * E-6 — LAS CUOTAS MENSUALES, EN NÚMEROS Y NO SÓLO DENTRO DE UNA FRASE.
       *
       * `buildProBenefits` ya las usaba para redactar sus líneas de /planes, pero eran
       * texto: ninguna otra pantalla podía decir «N destacados gratis» sin volver a
       * inventarse el número. Se publican para que el aviso al no-Pro —en /mis-anuncios y
       * en el diálogo de promocionar— diga la cifra REAL y configurada, no una escrita a
       * mano que un ajuste pueda desmentir.
       */
      proMonthlyFeaturedQuota: settingMap['proMonthlyFeaturedQuota'] ?? 4,
      proMonthlyBumpQuota: settingMap['proMonthlyBumpQuota'] ?? 4,
      freeBenefits: this.buildFreeBenefits(settingMap),
      proBenefits: this.buildProBenefits(settingMap, videoActivo),
    };
  }

  /**
   * UXV.6 (M4) — la tarjeta «Gratis» tenía el MISMO defecto que la de Pro: decía «Hasta 5
   * anuncios activos» escrito a mano mientras `freeActiveListingLimit` valía otra cosa.
   * Se descubrió al derivar la de Pro, porque la comparación entre las dos dejó el
   * desajuste a la vista.
   */
  private buildFreeBenefits(settingMap: Record<string, number>): string[] {
    const libres = settingMap['freeActiveListingLimit'] ?? 5;
    return [
      `Hasta ${libres} anuncios activos`,
      'Fotos incluidas',
      'Mensajería con compradores',
      'Perfil público',
    ];
  }

  /**
   * UXV.6 (M4) — los beneficios de Pro, DERIVADOS de los `Setting` que de verdad los
   * conceden.
   *
   * EL DEFECTO: `/planes` llevaba la lista escrita a mano en el propio componente, y estaba
   * desincronizada de lo que la aplicación hace. Prometía «estadísticas» y «soporte
   * prioritario» y **callaba los dos beneficios que más se notan** —los destacados gratis
   * al mes y la cuota de bumps—, que el usuario sí ve funcionar en `/mis-anuncios`. Un
   * admin podía subir `proMonthlyBumpQuota` de 5 a 20 y la página de precios seguía sin
   * mencionarlo.
   *
   * Ahora sale de aquí, del mismo sitio del que salen las cuotas reales. Cambiar un ajuste
   * cambia la promesa, sin tocar código.
   *
   * EL VÍDEO PRO, YA CONECTADO — y el enganche que este comentario dejó escrito llevaba el
   * NOMBRE EQUIVOCADO. Decía `settingMap['proVideoEnabled']`, y el flag real es
   * `videoEnabled`: de haberlo copiado tal cual, la línea no habría salido nunca y el fallo
   * habría sido invisible (una clave inexistente es `undefined`, o sea «apagado»).
   *
   * Y NO ENTRA POR `settingMap`, que es un `Record<string, number>` construido con
   * `Number(s.value)`. Un booleano ahí dentro sobrevive de milagro —`Number(true)` es 1—
   * pero la pregunta «¿está encendido el vídeo?» se responde en todo el proyecto con
   * `value === true` (`VideoService.isEnabled`). Se lee igual aquí, y por eso llega como
   * parámetro aparte: si la página de precios y el guard de subida usaran criterios
   * distintos, podrían discrepar sobre la misma fila.
   */
  private buildProBenefits(settingMap: Record<string, number>, videoActivo: boolean): string[] {
    const libres = settingMap['freeActiveListingLimit'] ?? 5;
    const pro = settingMap['proActiveListingLimit'] ?? 20;
    const destacados = settingMap['proMonthlyFeaturedQuota'] ?? 4;
    const duracion = settingMap['proQuotaFeaturedDurationDays'] ?? 7;
    const bumps = settingMap['proMonthlyBumpQuota'] ?? 5;
    const extraCreditos = settingMap['proExtraCreditsPercent'] ?? 20;
    const extraBumps = settingMap['proExtraBumpsPercent'] ?? 20;

    const beneficios: string[] = [];

    /**
     * El límite de anuncios se anuncia SOLO si el plan Pro da más que el gratuito.
     *
     * UXV.6 derivó el NÚMERO pero seguía listando la línea SIEMPRE, y eso es afirmar un
     * beneficio sin comprobar que lo sea. Con la configuración sembrada (gratuito 5, Pro 20)
     * la frase es cierta; pero los dos límites son ajustes de admin editables desde
     * /admin/ajustes y pueden cruzarse en cualquier momento. En cuanto alguien suba el
     * límite gratuito por encima del Pro —una operación perfectamente legítima— la página
     * de precios pasaría a vender «Hasta 20 anuncios activos» como ventaja de pagar
     * mientras el plan gratuito da más. El defecto no es que hoy mienta: es que nada
     * impedía que empezara a mentir sin que nadie tocase este archivo.
     *
     * Compararlos aquí es la única forma de que la lista no pueda mentir NUNCA. Mismo
     * criterio que las cuotas de abajo: lo que el ajuste no concede, no se promete.
     *
     * Los VALORES no se tocan — son decisión de negocio. Lo que cambia es que la lista
     * diga la verdad sobre ellos.
     */
    if (pro > libres) {
      beneficios.push(`Hasta ${pro} anuncios activos (en el plan gratuito, ${libres})`);
    }

    // EL VÍDEO, SÓLO SI ESTÁ ENCENDIDO — mismo criterio que las cuotas de abajo: lo que no
    // se concede, no se promete. Con la feature apagada la sección de vídeo no existe para
    // nadie (ni siquiera para un Pro), así que anunciarla sería vender lo que el editor no
    // ofrece. En cuanto un administrador la enciende en /admin/ajustes, la línea aparece
    // aquí sola, sin desplegar nada.
    //
    // Los 60 segundos salen de `MAX_VIDEO_DURATION_SECONDS`, no escritos a mano: es el mismo
    // número que el servidor aplica al validar la subida, y prometer otro sería la clase de
    // desajuste que esta función entera vino a cerrar.
    if (videoActivo) {
      beneficios.push(
        `Vídeo en tus anuncios: hasta ${MAX_VIDEO_DURATION_SECONDS} segundos enseñando el artículo`,
      );
    }

    // Cada uno solo se promete si el ajuste lo concede de verdad: una cuota a 0 no es un
    // beneficio, y anunciarla sería volver a la lista que mentía.
    if (destacados > 0) {
      beneficios.push(
        `${destacados} destacados gratis al mes, de ${duracion} días cada uno`,
      );
    }
    if (bumps > 0) beneficios.push(`${bumps} bumps gratis al mes para subir tus anuncios`);
    if (extraCreditos > 0) beneficios.push(`${extraCreditos}% de créditos extra en cada pack`);
    if (extraBumps > 0) beneficios.push(`${extraBumps}% de bumps extra en cada pack`);

    // Estas dos no salen de un Setting: son comportamiento del código. La primera la gatea
    // `EstadisticasClient` por `isPro`; la segunda la cumple la MARCA de la bandeja de
    // tickets (#15) — ver abajo.
    beneficios.push('Estadísticas avanzadas: vistas por día, ratio de me gusta y agregados');
    // #15 — EL TEXTO DICE LO QUE EL SISTEMA HACE, y ni una palabra más.
    //
    // Decía «Soporte prioritario» a secas, y la auditoría (§4.4) lo cazó: el módulo de
    // tickets no consultaba `isProActive` en ningún punto, así que **no había marca, ni
    // prioridad, ni orden, ni SLA**. Era una promesa que sólo podía cumplir una persona
    // acordándose.
    //
    // Ahora hay mecanismo: los tickets de un Pro llegan MARCADOS a la bandeja del staff, y
    // el staff puede aislar esa cola con un filtro. Eso es exactamente lo que dice esta
    // línea — «destaca», no «te respondemos en X horas».
    //
    // NO SE PROMETE UN PLAZO A PROPÓSITO. Un SLA es operativa —depende de cuánta gente
    // haya y de cuántos tickets entren—, y el código no puede garantizarlo: escribirlo
    // aquí sería volver al punto de partida con más letra. Marcar sí se puede garantizar,
    // y es lo que se anuncia.
    beneficios.push('Soporte prioritario: tus consultas destacan en la bandeja de nuestro equipo');

    return beneficios;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Reads the credit cost for a featured listing duration from Setting.
   * Keys: featuredCreditCost7d | featuredCreditCost14d | featuredCreditCost30d.
   * Throws if the duration is not a supported variant.
   */
  private async getCreditCostForFeatured(durationDays: number): Promise<number> {
    const keyMap: Record<number, string> = {
      7: 'featuredCreditCost7d',
      14: 'featuredCreditCost14d',
      30: 'featuredCreditCost30d',
    };
    const key = keyMap[durationDays];
    if (!key) {
      throw new BadRequestException(`Unsupported featured duration: ${durationDays} days`);
    }
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    return setting ? Number(setting.value) : 30;
  }
}
