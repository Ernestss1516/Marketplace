import { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Job constants
// ---------------------------------------------------------------------------

export const REDSYS_JOB = {
  PROCESS_SUCCESS: 'redsys.process-success',
} as const;

// ---------------------------------------------------------------------------
// BullMQ job payload
// ---------------------------------------------------------------------------

/** Payload enqueued by RedsysWebhookGuard when Ds_Response === '0000'. */
export interface RedsysJobData {
  transactionId: string;
  /** Amount in cents as string from Ds_Amount — used for amount validation. */
  dsAmount: string;
  /** Ds_Order for logging and tracing. */
  dsOrder: string;
}

// ---------------------------------------------------------------------------
// Response shape for checkout endpoints
// ---------------------------------------------------------------------------

/** Returned to the frontend so it can auto-submit a form to the Redsys TPV. */
export interface RedsysFormData {
  Ds_MerchantParameters: string;
  Ds_SignatureVersion: string;
  Ds_Signature: string;
  /** URL of the Redsys TPV (sandbox or production). */
  tpvUrl: string;
}

// ---------------------------------------------------------------------------
// IVA helper
// ---------------------------------------------------------------------------

const VAT_DIVISOR = new Prisma.Decimal('1.21');
const VAT_RATE = new Prisma.Decimal('0.2100');

/**
 * Computes Spanish 21% IVA breakdown for a Redsys payment.
 *
 * taxAmount = amountGross − amountNet, so net + tax = gross by construction
 * (no independent rounding that could cause a 1-cent discrepancy).
 */
export function redsysTaxBreakdown(grossEuros: Prisma.Decimal | number | string): {
  amountGross: Prisma.Decimal;
  amountNet: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  taxRate: Prisma.Decimal;
} {
  const amountGross = new Prisma.Decimal(grossEuros.toString()).toDecimalPlaces(2);
  const amountNet = amountGross.div(VAT_DIVISOR).toDecimalPlaces(2);
  const taxAmount = amountGross.sub(amountNet);
  return { amountGross, amountNet, taxAmount, taxRate: VAT_RATE };
}
