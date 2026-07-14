import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createRedsysAPI,
  PRODUCTION_URLS,
  SANDBOX_URLS,
  type RedsysAPI,
} from 'redsys-easy';
import { ListingStatus, TransactionStatus } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { EntitlementService } from '../billing/entitlement.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { CheckoutCreditsPackDto } from './dto/checkout-credits-pack.dto';
import { CheckoutFeaturedPayDto } from './dto/checkout-featured-pay.dto';
import { redsysTaxBreakdown, type RedsysFormData } from './redsys.types';

/** Returns true when the error is a Prisma unique constraint violation (P2002). */
function isP2002(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  );
}

@Injectable()
export class RedsysService {
  private readonly logger = new Logger(RedsysService.name);
  private _redsys: RedsysAPI | undefined;
  private readonly appUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
    private readonly campaigns: CampaignsService,
    private readonly config: ConfigService,
  ) {
    this.appUrl = config.get<string>('appUrl', 'http://localhost:3000');
  }

  // ---------------------------------------------------------------------------
  // Lazy Redsys client — only initialized when a request actually uses it.
  // The module starts without credentials in test environments.
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Ds_Order generation
  // ---------------------------------------------------------------------------

  /**
   * Generates a Redsys Ds_Order: YYYYMMDD (8 digits) + 4 uppercase alphanumeric
   * characters = 12 chars total.
   *
   * Starts with 8 digits → satisfies the Redsys constraint of ≥4 leading digits.
   * ~1.7M unique values per day; collision probability is negligible.
   * The caller retries up to 3 times if a P2002 on gatewayPaymentIntentId is raised.
   */
  generateDsOrder(): string {
    const now = new Date();
    const y = now.getFullYear().toString();
    const m = (now.getMonth() + 1).toString().padStart(2, '0');
    const d = now.getDate().toString().padStart(2, '0');
    const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let suffix = '';
    for (let i = 0; i < 4; i++) {
      suffix += CHARS[Math.floor(Math.random() * CHARS.length)];
    }
    return `${y}${m}${d}${suffix}`;
  }

  // ---------------------------------------------------------------------------
  // Checkout: pack de créditos
  // ---------------------------------------------------------------------------

  async createCreditPackCheckout(
    userId: string,
    dto: CheckoutCreditsPackDto,
  ): Promise<{ redsysFormData: RedsysFormData }> {
    const pack = await this.prisma.creditPack.findUnique({
      where: { id: dto.packId },
      include: { price: true },
    });
    if (!pack || !pack.active) throw new NotFoundException('Credit pack not found or inactive');
    if (!pack.price || !pack.price.active) {
      throw new NotFoundException('Price for this credit pack is not active');
    }

    const price = pack.price;
    const tax = redsysTaxBreakdown(price.amount);
    // Redsys expects amount in cents (integer string, no decimals).
    const amountCents = price.amount.mul(100).toFixed(0);

    // Freeze Pro bonus at checkout time (design §2.5).
    // The processor will read this value as-is; it never re-checks Pro status.
    const isPro = await this.entitlements.isProActive(userId);
    let bonusCreditAmount: number | null = null;
    if (isPro) {
      const pctSetting = await this.prisma.setting.findUnique({
        where: { key: 'proExtraCreditsPercent' },
      });
      const pct = pctSetting ? Number(pctSetting.value) : 20;
      bonusCreditAmount = Math.ceil(pack.creditAmount * pct / 100);
    }

    // Freeze campaign bonus at checkout time (H8 Bloque D). SUMS with the Pro
    // bonus above (both are "gifted credits in the wallet, no VAT" — a Pro user
    // buying during a campaign gets both). The processor reads this as-is; the
    // bonus that applies is the one active at THIS instant, not at confirmation.
    const activeCampaign = await this.campaigns.getActiveCreditBonusCampaign();
    let campaignBonusAmount: number | null = null;
    let campaignId: string | null = null;
    if (activeCampaign) {
      const { kind, value } = activeCampaign.params as { kind: 'PERCENT' | 'FIXED'; value: number };
      campaignBonusAmount = kind === 'PERCENT' ? Math.ceil(pack.creditAmount * value / 100) : value;
      campaignId = activeCampaign.id;
    }

    // Create Transaction PENDING, retrying up to 3 times on Ds_Order collision.
    let transactionId: string;
    let dsOrder: string = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      dsOrder = this.generateDsOrder();
      try {
        const tx = await this.prisma.transaction.create({
          data: {
            userId,
            priceId: price.id,
            ...tax,
            status: TransactionStatus.PENDING,
            gateway: 'REDSYS',
            gatewayPaymentIntentId: dsOrder,
            // Frozen at checkout, same as bonusCreditAmount/campaignBonusAmount —
            // the processor must never re-read CreditPack.creditAmount live, or
            // an admin editing the pack mid-flight would change what this
            // specific purchase grants.
            baseCreditAmount: pack.creditAmount,
            bonusCreditAmount,
            campaignBonusAmount,
            campaignId,
          },
          select: { id: true },
        });
        transactionId = tx.id;
        break;
      } catch (err) {
        if (isP2002(err) && attempt < 3) {
          this.logger.warn(`Ds_Order collision on attempt ${attempt}, retrying...`);
          continue;
        }
        throw err;
      }
    }
    // transactionId is always set here (loop throws on failure)
    this.logger.log(
      `Created PENDING Transaction ${transactionId!} for pack ${dto.packId}, ` +
        `Ds_Order=${dsOrder}, proBonus=${bonusCreditAmount ?? 'none'}, ` +
        `campaignBonus=${campaignBonusAmount ?? 'none'}`,
    );

    return { redsysFormData: this.buildForm(dsOrder, amountCents) };
  }

  // ---------------------------------------------------------------------------
  // Checkout: destacado directo por Redsys
  // ---------------------------------------------------------------------------

  async createFeaturedPayCheckout(
    userId: string,
    dto: CheckoutFeaturedPayDto,
  ): Promise<{ redsysFormData: RedsysFormData }> {
    const price = await this.prisma.price.findUnique({
      where: { id: dto.priceId },
      include: { product: true },
    });
    if (!price || !price.active) throw new NotFoundException('Price not found or inactive');
    if (!price.durationDays) throw new BadRequestException('Price is not a featured listing variant');

    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
      select: { id: true, status: true, sellerId: true },
    });
    if (!listing || listing.status !== ListingStatus.ACTIVE) {
      throw new BadRequestException('Only ACTIVE listings can be featured');
    }
    if (listing.sellerId !== userId) {
      throw new ForbiddenException('Listing does not belong to you');
    }

    const alreadyFeatured = await this.entitlements.isFeaturedActive(dto.listingId);
    if (alreadyFeatured) {
      throw new BadRequestException({
        message: 'Listing already has an active featured period',
        code: 'ALREADY_FEATURED',
      });
    }

    const tax = redsysTaxBreakdown(price.amount);
    const amountCents = price.amount.mul(100).toFixed(0);

    let transactionId: string;
    let dsOrder: string = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      dsOrder = this.generateDsOrder();
      try {
        const tx = await this.prisma.transaction.create({
          data: {
            userId,
            priceId: price.id,
            ...tax,
            status: TransactionStatus.PENDING,
            gateway: 'REDSYS',
            gatewayPaymentIntentId: dsOrder,
            listingId: dto.listingId,
          },
          select: { id: true },
        });
        transactionId = tx.id;
        break;
      } catch (err) {
        if (isP2002(err) && attempt < 3) {
          this.logger.warn(`Ds_Order collision on attempt ${attempt}, retrying...`);
          continue;
        }
        throw err;
      }
    }
    this.logger.log(
      `Created PENDING Transaction ${transactionId!} for featured listing ${dto.listingId}, Ds_Order=${dsOrder}`,
    );

    return {
      redsysFormData: this.buildForm(
        dsOrder,
        amountCents,
        `${this.appUrl}/mis-anuncios/destacado-exito`,
        `${this.appUrl}/mis-anuncios/destacado-error`,
      ),
    };
  }

  // ---------------------------------------------------------------------------
  // Shared form builder
  // ---------------------------------------------------------------------------

  private buildForm(
    dsOrder: string,
    amountCents: string,
    urlOk?: string,
    urlKo?: string,
  ): RedsysFormData {
    const merchantCode = this.config.get<string>('redsys.merchantCode', '');
    const terminal = this.config.get<string>('redsys.terminal', '001');
    const notificationUrl = this.config.get<string>('redsys.notificationUrl', '');

    const form = this.redsys.createRedirectForm({
      DS_MERCHANT_MERCHANTCODE: merchantCode,
      DS_MERCHANT_TERMINAL: terminal,
      DS_MERCHANT_TRANSACTIONTYPE: '0',
      DS_MERCHANT_AMOUNT: amountCents,
      DS_MERCHANT_CURRENCY: '978',
      DS_MERCHANT_ORDER: dsOrder,
      DS_MERCHANT_URLOK: urlOk ?? `${this.appUrl}/mis-creditos/exito`,
      DS_MERCHANT_URLKO: urlKo ?? `${this.appUrl}/mis-creditos/error`,
      DS_MERCHANT_MERCHANTURL: notificationUrl,
    });

    return {
      Ds_MerchantParameters: form.body.Ds_MerchantParameters,
      Ds_SignatureVersion: form.body.Ds_SignatureVersion,
      Ds_Signature: form.body.Ds_Signature,
      tpvUrl: form.url,
    };
  }
}
