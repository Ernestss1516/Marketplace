import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InvoiceOrigin, Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { R2Service } from '../../infra/r2/r2.service';
import { isP2002 } from '../../common/prisma/is-p2002';
import {
  FrozenFiscalParty,
  hasCompleteFiscalData,
  INVOICING_PROVIDER,
  InvoicingProvider,
} from './invoicing.types';
import { periodKeyContaining, periodRange } from './period';

/**
 * Clave `Setting` con la ventana de autoservicio de facturación, en MESES (RF.13).
 * Valor por defecto PROVISIONAL: el plazo fiscalmente correcto (ventana exacta,
 * semestre natural vs. rodante) lo confirma el asesor de Ernest. La ventana se
 * expresa sobre la fecha de OPERACIÓN (Transaction.createdAt).
 */
const FISCAL_WINDOW_SETTING_KEY = 'fiscalSelfServiceWindow';
const DEFAULT_WINDOW_MONTHS = 6;

/** Clave `Setting` con los datos fiscales del EMISOR (la plataforma). */
const FISCAL_ISSUER_SETTING_KEY = 'fiscalIssuer';

/** Datos fiscales del usuario necesarios para facturar (receptor). */
const FISCAL_SELECT = {
  fiscalTaxId: true,
  fiscalName: true,
  fiscalEntityType: true,
  fiscalAddress: true,
  fiscalCity: true,
  fiscalPostalCode: true,
  fiscalProvince: true,
  fiscalCountry: true,
} as const;

type FiscalUser = Prisma.UserGetPayload<{ select: typeof FISCAL_SELECT }>;

const FACTURABLE_INCLUDE = {
  price: { include: { product: true } },
} as const;

type FacturableTx = Prisma.TransactionGetPayload<{ include: typeof FACTURABLE_INCLUDE }>;

type InvoiceWithLines = Prisma.InvoiceGetPayload<{ include: { lines: true } }>;

interface EmitOpts {
  origin: InvoiceOrigin;
  periodKey: string;
  /** null en emisión manual (el guard es transactionId @unique); "userId:periodKey" en el cron. */
  idempotencyKey: string | null;
}

@Injectable()
export class InvoicingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    @Inject(INVOICING_PROVIDER) private readonly provider: InvoicingProvider,
  ) {}

  // ── Elegibilidad y facturables (ventana de autoservicio) ────────────────────

  async getFacturables(userId: string) {
    const windowStart = await this.getWindowStart();
    const txs = await this.findFacturableTx(userId, { gte: windowStart });
    return txs.map((tx) => ({
      transactionId: tx.id,
      concept: this.deriveConcept(tx),
      amountNet: tx.amountNet.toString(),
      taxAmount: tx.taxAmount.toString(),
      taxRate: tx.taxRate.toString(),
      amountGross: tx.amountGross.toString(),
      currency: tx.currency,
      operationDate: tx.createdAt,
    }));
  }

  async getEligibility(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: FISCAL_SELECT });
    const windowStart = await this.getWindowStart();
    const facturableCount = (await this.findFacturableTx(userId, { gte: windowStart })).length;
    const hasFiscalData = !!user && hasCompleteFiscalData(user);

    if (!hasFiscalData) {
      return { canRequest: false, reason: 'MISSING_FISCAL_DATA' as const, hasFiscalData, facturableCount };
    }
    if (facturableCount === 0) {
      return { canRequest: false, reason: 'NO_INVOICEABLE_MOVEMENTS' as const, hasFiscalData, facturableCount };
    }
    return { canRequest: true, reason: null, hasFiscalData, facturableCount };
  }

  // ── Emisión manual (R3): todos los facturables de la ventana en una factura ──

  async requestInvoice(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: FISCAL_SELECT });
    if (!user || !hasCompleteFiscalData(user)) {
      throw new BadRequestException({
        code: 'MISSING_FISCAL_DATA',
        message: 'Completa tus datos fiscales antes de solicitar factura.',
      });
    }

    const windowStart = await this.getWindowStart();
    const txs = await this.findFacturableTx(userId, { gte: windowStart });
    if (txs.length === 0) {
      throw new ConflictException({
        code: 'NO_INVOICEABLE_MOVEMENTS',
        message: 'No tienes movimientos facturables en la ventana vigente.',
      });
    }

    return this.emitInvoiceCore(user, userId, txs, {
      origin: 'USER_REQUESTED',
      periodKey: periodKeyContaining(new Date(), 'QUARTERLY'),
      idempotencyKey: null,
    });
  }

  // ── Emisión automática de un periodo (R4): la usa el InvoiceProcessor ────────

  /**
   * Emite la factura automática (origin AUTO_PERIODIC) de un usuario para un periodo cerrado.
   * Idempotente por `idempotencyKey = userId:periodKey` (@unique): si ya está
   * ISSUED, la devuelve sin re-emitir. Devuelve null si el usuario no tiene datos
   * fiscales o no tiene facturables en el periodo (el cron ya avisó a los primeros).
   */
  async emitForPeriod(userId: string, periodKey: string) {
    const idempotencyKey = `${userId}:${periodKey}`;

    const existing = await this.prisma.invoice.findUnique({
      where: { idempotencyKey },
      include: { lines: true },
    });
    if (existing?.status === 'ISSUED') return this.toInvoiceDto(existing); // ya emitida (idempotente)
    if (existing) {
      // DRAFT huérfano de un intento previo que murió antes del rollback →
      // limpiar (no-ISSUED, el trigger permite DELETE) y reintentar limpio.
      await this.prisma.invoice.delete({ where: { id: existing.id } }).catch(() => undefined);
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: FISCAL_SELECT });
    if (!user || !hasCompleteFiscalData(user)) return null;

    const { start, end } = periodRange(periodKey);
    const txs = await this.findFacturableTx(userId, { gte: start, lt: end });
    if (txs.length === 0) return null;

    return this.emitInvoiceCore(user, userId, txs, { origin: 'AUTO_PERIODIC', periodKey, idempotencyKey });
  }

  // ── Núcleo de emisión compartido (congela, crea DRAFT, emite, latch) ────────

  private async emitInvoiceCore(
    user: FiscalUser,
    userId: string,
    txs: FacturableTx[],
    opts: EmitOpts,
  ) {
    const issuer = await this.getFrozenIssuer();
    const receiver = this.frozenReceiver(user);
    const currency = txs[0].currency;

    let subtotalNet = new Prisma.Decimal(0);
    let totalTax = new Prisma.Decimal(0);
    let totalGross = new Prisma.Decimal(0);
    for (const tx of txs) {
      subtotalNet = subtotalNet.plus(tx.amountNet);
      totalTax = totalTax.plus(tx.taxAmount);
      totalGross = totalGross.plus(tx.amountGross);
    }

    // 1) DRAFT + líneas (escritura anidada atómica). El transactionId @unique de
    //    cada línea y el idempotencyKey @unique son los guards de BD contra la
    //    doble facturación. P2002 → devolver la factura existente (idempotente).
    let draft: InvoiceWithLines;
    try {
      draft = await this.prisma.invoice.create({
        data: {
          origin: opts.origin,
          status: 'DRAFT',
          userId,
          periodKey: opts.periodKey,
          idempotencyKey: opts.idempotencyKey,
          currency,
          subtotalNet,
          totalTax,
          totalGross,
          receiverTaxId: receiver.taxId,
          receiverName: receiver.name,
          receiverEntityType: user.fiscalEntityType,
          receiverAddress: receiver.address,
          receiverCity: receiver.city,
          receiverPostalCode: receiver.postalCode,
          receiverProvince: receiver.province,
          receiverCountry: receiver.country,
          issuerTaxId: issuer.taxId,
          issuerName: issuer.name,
          issuerAddress: issuer.address,
          issuerCity: issuer.city,
          issuerPostalCode: issuer.postalCode,
          issuerProvince: issuer.province,
          issuerCountry: issuer.country,
          lines: {
            create: txs.map((tx) => ({
              transactionId: tx.id,
              concept: this.deriveConcept(tx),
              amountNet: tx.amountNet,
              taxAmount: tx.taxAmount,
              taxRate: tx.taxRate,
              amountGross: tx.amountGross,
              operationDate: tx.createdAt,
            })),
          },
        },
        include: { lines: true },
      });
    } catch (e) {
      if (isP2002(e)) {
        const existing = opts.idempotencyKey
          ? await this.prisma.invoice.findUnique({
              where: { idempotencyKey: opts.idempotencyKey },
              include: { lines: true },
            })
          : await this.findInvoiceOwningTransaction(userId, txs[0].id);
        if (existing) return this.toInvoiceDto(existing);
        throw new ConflictException({ code: 'ALREADY_INVOICED', message: 'Esos movimientos ya están facturados.' });
      }
      throw e;
    }

    // 2) Emitir vía proveedor → PDF a R2 privado → latch DRAFT→ISSUED. Si algo
    //    falla, borrar el DRAFT (no-ISSUED → el trigger permite DELETE) para
    //    liberar las Transactions; el job de la cola reintenta (retryQueue).
    //    NOTA (proveedor real): con un proveedor homologado, revisar esto para
    //    REANUDAR el DRAFT (idempotencyKey=invoice.id del proveedor) en vez de
    //    borrarlo, y no dejar un número fiscal huérfano. Con el stub es indiferente.
    try {
      const result = await this.provider.emitInvoice({
        idempotencyKey: draft.id,
        type: draft.type,
        issuer,
        receiver,
        currency,
        issueDate: new Date(),
        lines: draft.lines.map((l) => ({
          concept: l.concept,
          amountNet: l.amountNet.toString(),
          taxRate: l.taxRate.toString(),
          taxAmount: l.taxAmount.toString(),
          amountGross: l.amountGross.toString(),
          operationDate: l.operationDate,
        })),
      });

      const pdfKey = `facturas/${draft.id}.pdf`;
      await this.r2.upload(pdfKey, result.pdf, 'application/pdf');

      const issued = await this.prisma.invoice.update({
        where: { id: draft.id },
        data: {
          status: 'ISSUED',
          number: result.number,
          series: result.series ?? null,
          pdfKey,
          verifactuHash: result.verifactu.hash,
          verifactuQr: result.verifactu.qr,
          providerRef: result.providerRef,
          issuedAt: new Date(),
        },
        include: { lines: true },
      });
      return this.toInvoiceDto(issued);
    } catch (e) {
      await this.prisma.invoice.delete({ where: { id: draft.id } }).catch(() => undefined);
      await this.r2.delete(`facturas/${draft.id}.pdf`).catch(() => undefined);
      throw e;
    }
  }

  // ── Consulta y descarga ─────────────────────────────────────────────────────

  async getMyInvoices(userId: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { lines: true } } },
    });
    return invoices.map((inv) => this.toInvoiceDto(inv, inv._count.lines));
  }

  /** Descarga autenticada del PDF. Solo el DUEÑO (403 si no lo es). */
  async getInvoicePdf(userId: string, invoiceId: string): Promise<{ buffer: Buffer; filename: string }> {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId } });
    if (!inv) throw new NotFoundException('Factura no encontrada');
    if (inv.userId !== userId) throw new ForbiddenException('Esta factura no es tuya');
    if (!inv.pdfKey) throw new NotFoundException('La factura aún no tiene PDF');

    const buffer = await this.r2.download(inv.pdfKey);
    return { buffer, filename: `factura-${inv.number ?? inv.id}.pdf` };
  }

  // ── Helpers internos ────────────────────────────────────────────────────────

  private async findFacturableTx(
    userId: string,
    range: { gte: Date; lt?: Date },
  ): Promise<FacturableTx[]> {
    return this.prisma.transaction.findMany({
      where: {
        userId,
        status: 'SUCCEEDED',
        gateway: { in: ['STRIPE', 'REDSYS'] },
        invoiceLine: { is: null },
        createdAt: range.lt ? { gte: range.gte, lt: range.lt } : { gte: range.gte },
      },
      include: FACTURABLE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  private async getWindowStart(): Promise<Date> {
    const setting = await this.prisma.setting.findUnique({ where: { key: FISCAL_WINDOW_SETTING_KEY } });
    const months = setting ? Number(setting.value) : DEFAULT_WINDOW_MONTHS;
    const safeMonths = Number.isFinite(months) && months > 0 ? months : DEFAULT_WINDOW_MONTHS;
    const start = new Date();
    start.setMonth(start.getMonth() - safeMonths);
    return start;
  }

  private frozenReceiver(user: FiscalUser): FrozenFiscalParty {
    return {
      taxId: user.fiscalTaxId ?? '',
      name: user.fiscalName ?? '',
      address: user.fiscalAddress ?? undefined,
      city: user.fiscalCity ?? undefined,
      postalCode: user.fiscalPostalCode ?? undefined,
      province: user.fiscalProvince ?? undefined,
      country: user.fiscalCountry ?? 'ES',
    };
  }

  private async getFrozenIssuer(): Promise<FrozenFiscalParty> {
    const setting = await this.prisma.setting.findUnique({ where: { key: FISCAL_ISSUER_SETTING_KEY } });
    const v = setting?.value as Record<string, unknown> | undefined;
    if (!v || typeof v !== 'object' || !v.taxId || !v.fiscalName) {
      throw new BadRequestException({
        code: 'ISSUER_NOT_CONFIGURED',
        message: 'El emisor fiscal (Setting fiscalIssuer) no está configurado. Configúralo en el backoffice.',
      });
    }
    const s = (k: string): string | undefined => (v[k] == null ? undefined : String(v[k]));
    return {
      taxId: String(v.taxId),
      name: String(v.fiscalName),
      address: s('address'),
      city: s('city'),
      postalCode: s('postalCode'),
      province: s('province'),
      country: s('country') ?? 'ES',
    };
  }

  private deriveConcept(tx: FacturableTx): string {
    if (tx.subscriptionId) return 'Suscripción Pro';
    if (tx.baseCreditAmount != null) return `Pack de ${tx.baseCreditAmount} créditos`;
    if (tx.baseBumpAmount != null) return `Pack de ${tx.baseBumpAmount} bumps`;
    if (tx.listingId) {
      const days = tx.price?.durationDays;
      return days ? `Destacado ${days} días` : 'Destacado';
    }
    return tx.price?.product?.name ?? 'Cargo de la plataforma';
  }

  private async findInvoiceOwningTransaction(userId: string, transactionId: string) {
    const line = await this.prisma.invoiceLine.findUnique({
      where: { transactionId },
      include: { invoice: { include: { lines: true } } },
    });
    if (line && line.invoice.userId === userId) return line.invoice;
    return null;
  }

  private toInvoiceDto(
    inv: {
      id: string;
      number: string | null;
      series: string | null;
      status: string;
      type: string;
      origin: string;
      periodKey: string | null;
      issuedAt: Date | null;
      currency: string;
      subtotalNet: Prisma.Decimal;
      totalTax: Prisma.Decimal;
      totalGross: Prisma.Decimal;
      pdfKey: string | null;
      receiverTaxId: string | null;
      receiverName: string | null;
      lines?: unknown[];
    },
    lineCount?: number,
  ) {
    return {
      id: inv.id,
      number: inv.number,
      series: inv.series,
      status: inv.status,
      type: inv.type,
      origin: inv.origin,
      periodKey: inv.periodKey,
      issuedAt: inv.issuedAt,
      currency: inv.currency,
      subtotalNet: inv.subtotalNet.toString(),
      totalTax: inv.totalTax.toString(),
      totalGross: inv.totalGross.toString(),
      receiver: { taxId: inv.receiverTaxId, name: inv.receiverName },
      lineCount: lineCount ?? inv.lines?.length ?? 0,
      hasPdf: Boolean(inv.pdfKey),
    };
  }
}
