import { apiFetch } from './client';

export interface AdminStats {
  listings: {
    active: number;
    pendingReview: number;
    publishedToday: number;
  };
  users: {
    total: number;
    newToday: number;
  };
  moderation: {
    reportsPending: number;
  };
  conversations: {
    total: number;
  };
  search: {
    totalDocuments: number;
    isIndexing: boolean;
  } | null;
}

export function getAdminStats(token: string): Promise<AdminStats> {
  return apiFetch<AdminStats>('/admin/stats', { token });
}
