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
    /** 7b — `null` = sigue publicada. Con fecha, ya la retiró alguien: no se ofrece retirar otra vez. */
    retiredAt: string | null;
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

/**
 * 7b — RETIRAR sustituye a `deleteReview`, que hacía `DELETE` y borraba la fila.
 *
 * No es un renombrado: el endpoint viejo ya no existe en el backend. Su borrado físico
 * se llevaba por `Cascade` la denuncia que había motivado la retirada, y el propio flujo
 * de esta pantalla acababa en 404 al intentar resolver un reporte que él mismo había
 * destruido dos líneas antes.
 */
export function retireReview(
  reviewId: string,
  token: string,
  reason: string,
): Promise<unknown> {
  return apiFetch(`/moderation/reviews/${reviewId}/retire`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
    token,
  });
}

export function restoreReview(reviewId: string, token: string): Promise<unknown> {
  return apiFetch(`/moderation/reviews/${reviewId}/restore`, {
    method: 'POST',
    token,
  });
}

export function moderateReview(
  reviewId: string,
  token: string,
  dto: { rating?: number; comment?: string; reason: string },
): Promise<unknown> {
  return apiFetch(`/moderation/reviews/${reviewId}`, {
    method: 'PATCH',
    body: JSON.stringify(dto),
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

/**
 * MODERACIÓN M2 — aprobar y rechazar, por los endpoints CORRECTOS.
 *
 * Hasta M2 el backoffice hacía las dos cosas con el cambio de estado GENÉRICO de
 * `/admin/listings/:id/status`, que esquivaba justo lo que estos dos endpoints
 * añaden: `approve` registra `LISTING_APPROVE` y avisa al vendedor de que su
 * anuncio ya está publicado; `reject` registra `LISTING_REJECT` con el motivo y
 * avisa de que no ha pasado. Por la vía genérica ninguna de las dos cosas
 * ocurría, y nadie lo notaba porque el anuncio SÍ cambiaba de estado.
 */
export function approveListing(listingId: string, token: string): Promise<unknown> {
  return apiFetch(`/moderation/listings/${listingId}/approve`, { method: 'POST', token });
}

export function rejectListing(
  listingId: string,
  token: string,
  reason?: string,
): Promise<unknown> {
  return apiFetch(`/moderation/listings/${listingId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
    token,
  });
}
