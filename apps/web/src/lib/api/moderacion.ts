import { apiFetch } from './client';

export type ReportStatus = 'PENDING' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED';
export type ReportReason =
  | 'SPAM'
  | 'FRAUD'
  | 'INAPPROPRIATE'
  | 'PROHIBITED_ITEM'
  | 'WRONG_CATEGORY'
  | 'OTHER';

export interface Report {
  id: string;
  reason: ReportReason;
  description: string | null;
  status: ReportStatus;
  createdAt: string;
  reporter: { id: string; name: string; slug: string } | null;
  reportedUser: { id: string; name: string; slug: string } | null;
  listing: {
    id: string;
    title: string;
    slug: string;
    status: string;
  } | null;
  resolvedBy: { id: string; name: string } | null;
}

export interface PaginatedReports {
  items: Report[];
  total: number;
  page: number;
  perPage: number;
}

export interface CreateReportDto {
  reason: ReportReason;
  description?: string;
  listingId?: string;
  reportedUserId?: string;
}

export function getReports(
  token: string,
  params?: { status?: ReportStatus; page?: number },
): Promise<PaginatedReports> {
  const qs = new URLSearchParams({ page: String(params?.page ?? 1) });
  if (params?.status) qs.set('status', params.status);
  return apiFetch<PaginatedReports>(`/moderation/reports?${qs}`, { token });
}

export function resolveReport(id: string, token: string): Promise<Report> {
  return apiFetch<Report>(`/moderation/reports/${id}/resolve`, {
    method: 'PATCH',
    token,
  });
}

export function dismissReport(id: string, token: string): Promise<Report> {
  return apiFetch<Report>(`/moderation/reports/${id}/dismiss`, {
    method: 'PATCH',
    token,
  });
}

export function deactivateListing(
  listingId: string,
  token: string,
  reason?: string,
): Promise<unknown> {
  return apiFetch(`/moderation/listings/${listingId}/deactivate`, {
    method: 'POST',
    body: JSON.stringify({ reason: reason ?? 'Retirado por moderación' }),
    token,
  });
}

export function createReport(token: string, dto: CreateReportDto): Promise<Report> {
  return apiFetch<Report>('/moderation/reports', {
    method: 'POST',
    body: JSON.stringify(dto),
    token,
  });
}
