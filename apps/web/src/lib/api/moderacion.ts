import { apiFetch } from './client';

export type ReportStatus = 'PENDING' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED';
export type ReportReason =
  | 'SPAM'
  | 'FRAUD'
  | 'INAPPROPRIATE'
  | 'PROHIBITED_ITEM'
  | 'WRONG_CATEGORY'
  | 'FAKE_REVIEW'
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
  review: {
    id: string;
    rating: number;
    comment: string | null;
    author: { name: string; slug: string };
    target: { name: string; slug: string };
  } | null;
  resolvedBy: { id: string; name: string } | null;
  /**
   * Atención al usuario R7 — hilos ya abiertos con el usuario reportado desde
   * esta denuncia (flujo c). Solo lectura: el ciclo de vida del Report no cambia.
   * Opcional porque el campo se añadió después; un backend anterior no lo trae.
   */
  tickets?: { id: string; status: string }[];
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
  reviewId?: string;
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

export function deleteReview(reviewId: string, token: string): Promise<void> {
  return apiFetch<void>(`/moderation/reviews/${reviewId}`, {
    method: 'DELETE',
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
