import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { R2Service } from '../../infra/r2/r2.service';
import { isP2002 } from '../../common/prisma/is-p2002';
import {
  FrozenFiscalParty,
  INVOICING_PROVIDER,
  InvoicingProvider,
} from './invoicing.types';

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

@Injectable()
export class InvoicingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    @Inject(INVOICING_PROVIDER) private readonly provider: InvoicingProvider,
  ) {}

  // ── Elegibilidad y facturables ─────────────────────────────────────────────

  /** Movimientos facturables del usuario (DTO), con su concepto derivado. */
  async getFacturables(userId: string) {
    const txs = await this.findFacturableTx(userId);
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

  /**
   * ¿Puede el usuario solicitar factura? Requiere (a) datos fiscales completos y
   * (b) ≥1 movimiento facturable en la ventana. Devuelve el motivo si es false
   * para que la UI lo explique.
   */
  async getEligibility(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: FISCAL_SELECT });
    const facturableCount = (await this.findFacturableTx(userId)).length;
    const hasFiscalData = this.isFiscalDataComplete(user);

    if (!hasFiscalData) {
      return { canRequest: false, reason: 'MISSING_FISCAL_DATA' as const, hasFiscalData, facturableCount };
    }
    if (facturableCount === 0) {
      return { canRequest: false, reason: 'NO_INVOICEABLE_MOVEMENTS' as const, hasFiscalData, facturableCount };
    }
    return { canRequest: true, reason: null, hasFiscalData, facturableCount };
  }

  // ── Emisión manual (flujo completo, con el proveedor inyectado) ─────────────

  /**
   * El usuario solicita factura de TODOS sus movimientos facturables de la
   * ventana (recapitulativa; 1 movimiento = factura de 1 línea). Congela emisor,
   * receptor y desglose; llama al proveedor; guarda el PDF en R2 privado; hace el
   * latch DRAFT→ISSUED.
   *
   * Anti-doble-facturación: `InvoiceLine.transactionId @unique` (guard de BD). Un
   * doble-submit concurrente sobre los mismos movimientos rebota con P2002 y se
   * devuelve la factura ya creada (idempotente). Un segundo intento secuencial no
   * encuentra facturables (ya tienen línea) → 409.
   */
  async requestInvoice(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: FISCAL_SELECT });
    if (!user || !this.isFiscalDataComplete(user)) {
      throw new BadRequestException({
        code: 'MISSING_FISCAL_DATA',
        message: 'Completa tus datos fiscales antes de solicitar factura.',
      });
    }

    const txs = await this.findFacturableTx(userId);
    if (txs.length === 0) {
      throw new ConflictException({
        code: 'NO_INVOICEABLE_MOVEMENTS',
        message: 'No tienes movimientos facturables en la ventana vigente.',
      });
    }

    const issuer = await this.getFrozenIssuer();
    const receiver = this.frozenReceiver(user);
    const now = new Date();
    const periodKey = this.currentPeriodKey(now);
    const currency = txs[0].currency;

    let subtotalNet = new Prisma.Decimal(0);
    let totalTax = new Prisma.Decimal(0);
    let totalGross = new Prisma.Decimal(0);
    for (const tx of txs) {
      subtotalNet = subtotalNet.plus(tx.amountNet);
      totalTax = totalTax.plus(tx.taxAmount);
      totalGross = totalGross.plus(tx.amountGross);
    }

    // 1) Crear la Invoice DRAFT + líneas (escritura anidada atómica). El
    //    transactionId @unique de cada línea es el guard duro anti-doble-factura.
    //    Manual → idempotencyKey null (multiples null conviven; el guard es
    //    transactionId). El cron de R4 usará userId:periodKey.
    let draft;
    try {
      draft = await this.prisma.invoice.create({
        data: {
          origin: 'USER_REQUESTED',
          status: 'DRAFT',
          userId,
          periodKey,
          currency,
          subtotalNet,
          totalTax,
          totalGross,
          // Receptor CONGELADO (copia, no referencia)
          receiverTaxId: receiver.taxId,
          receiverName: receiver.name,
          receiverEntityType: user.fiscalEntityType,
          receiverAddress: receiver.address,
          receiverCity: receiver.city,
          receiverPostalCode: receiver.postalCode,
          receiverProvince: receiver.province,
          receiverCountry: receiver.country,
          // Emisor CONGELADO
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
        // Carrera/doble-submit: alguna Transaction ya se está facturando.
        const existing = await this.findInvoiceOwningTransaction(userId, txs[0].id);
        if (existing) return this.toInvoiceDto(existing);
        throw new ConflictException({ code: 'ALREADY_INVOICED', message: 'Esos movimientos ya están facturados.' });
      }
      throw e;
    }

    // 2) Emitir vía proveedor → PDF en R2 privado → latch DRAFT→ISSUED. Si algo
    //    falla, borrar el DRAFT (no-ISSUED → el trigger permite DELETE) para
    //    liberar las Transactions (vuelven a ser facturables).
    try {
      const result = await this.provider.emitInvoice({
        idempotencyKey: draft.id,
        type: 'ORDINARY',
        issuer,
        receiver,
        currency,
        issueDate: now,
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

  private async findFacturableTx(userId: string): Promise<FacturableTx[]> {
    const windowStart = await this.getWindowStart();
    return this.prisma.transaction.findMany({
      where: {
        userId,
        status: 'SUCCEEDED',
        gateway: { in: ['STRIPE', 'REDSYS'] },
        invoiceLine: { is: null },
        createdAt: { gte: windowStart },
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

  private isFiscalDataComplete(user: FiscalUser | null): boolean {
    if (!user) return false;
    // País tiene default 'ES'; entityType es opcional. El resto es obligatorio
    // para identificar al receptor de una factura.
    return Boolean(
      user.fiscalTaxId &&
        user.fiscalName &&
        user.fiscalAddress &&
        user.fiscalCity &&
        user.fiscalPostalCode &&
        user.fiscalProvince,
    );
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

  /**
   * Clave de periodo (semestre natural) de la fecha dada: "YYYY-H1" (ene-jun) o
   * "YYYY-H2" (jul-dic). Provisional: la granularidad fiscal exacta la confirma
   * el asesor. Informativa para agrupar/filtrar.
   */
  private currentPeriodKey(d: Date): string {
    const half = d.getMonth() < 6 ? 1 : 2;
    return `${d.getFullYear()}-H${half}`;
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
