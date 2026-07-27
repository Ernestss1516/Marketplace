import { apiFetch } from './client';

export interface AdminInvoiceRow {
  id: string;
  number: string | null;
  status: string;
  origin: string;
  periodKey: string | null;
  issuedAt: string | null;
  currency: string;
  totalGross: string;
  receiverName: string | null;
  receiverTaxId: string | null;
  lineCount: number;
  hasPdf: boolean;
  user: { id: string; name: string; email: string };
}

export interface PaginatedAdminInvoices {
  items: AdminInvoiceRow[];
  total: number;
  page: number;
  perPage: number;
}

export interface AdminInvoicesParams {
  status?: string;
  origin?: string;
  periodKey?: string;
  userId?: string;
  userQuery?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  perPage?: number;
}

export function getAdminInvoices(
  token: string,
  params: AdminInvoicesParams = {},
): Promise<PaginatedAdminInvoices> {
  const qs = new URLSearchParams({ page: String(params.page ?? 1) });
  if (params.status) qs.set('status', params.status);
  if (params.origin) qs.set('origin', params.origin);
  if (params.periodKey) qs.set('periodKey', params.periodKey);
  if (params.userId) qs.set('userId', params.userId);
  if (params.userQuery) qs.set('userQuery', params.userQuery);
  if (params.dateFrom) qs.set('dateFrom', params.dateFrom);
  if (params.dateTo) qs.set('dateTo', params.dateTo);
  if (params.perPage) qs.set('perPage', String(params.perPage));

  return apiFetch<PaginatedAdminInvoices>(`/admin/invoices?${qs}`, { token, cache: 'no-store' });
}

export interface FiscalIssuer {
  taxId: string;
  fiscalName: string;
  address: string;
  city: string;
  postalCode: string;
  province: string;
  country: string;
}

export interface FiscalIssuerResponse {
  configured: boolean;
  issuer: FiscalIssuer | null;
}

export function getFiscalIssuer(token: string): Promise<FiscalIssuerResponse> {
  return apiFetch<FiscalIssuerResponse>('/admin/fiscal-issuer', { token, cache: 'no-store' });
}

export function updateFiscalIssuer(token: string, dto: FiscalIssuer): Promise<{ issuer: FiscalIssuer }> {
  return apiFetch<{ issuer: FiscalIssuer }>('/admin/fiscal-issuer', {
    method: 'PUT',
    body: JSON.stringify(dto),
    token,
  });
}
