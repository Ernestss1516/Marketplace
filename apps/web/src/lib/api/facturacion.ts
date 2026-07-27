import { apiFetch } from './client';

export interface Facturable {
  transactionId: string;
  concept: string;
  amountNet: string;
  taxAmount: string;
  taxRate: string;
  amountGross: string;
  currency: string;
  operationDate: string;
}

export type EligibilityReason = 'MISSING_FISCAL_DATA' | 'NO_INVOICEABLE_MOVEMENTS' | null;

export interface InvoiceEligibility {
  canRequest: boolean;
  reason: EligibilityReason;
  hasFiscalData: boolean;
  facturableCount: number;
}

export interface InvoiceDto {
  id: string;
  number: string | null;
  series: string | null;
  status: string;
  type: string;
  origin: string;
  periodKey: string | null;
  issuedAt: string | null;
  currency: string;
  subtotalNet: string;
  totalTax: string;
  totalGross: string;
  receiver: { taxId: string | null; name: string | null };
  lineCount: number;
  hasPdf: boolean;
}

export function getFacturables(token: string): Promise<Facturable[]> {
  return apiFetch<Facturable[]>('/billing/facturables', { token, cache: 'no-store' });
}

export function getInvoiceEligibility(token: string): Promise<InvoiceEligibility> {
  return apiFetch<InvoiceEligibility>('/billing/eligibility', { token, cache: 'no-store' });
}

export function requestInvoice(token: string): Promise<InvoiceDto> {
  return apiFetch<InvoiceDto>('/billing/facturas', { method: 'POST', token });
}

export function getMyInvoices(token: string): Promise<InvoiceDto[]> {
  return apiFetch<InvoiceDto[]>('/billing/my-invoices', { token, cache: 'no-store' });
}
