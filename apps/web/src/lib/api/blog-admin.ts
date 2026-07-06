import { apiFetch } from './client';

export type PostType = 'POST' | 'PAGE';

export interface AdminPostSummary {
  id: string;
  type: PostType;
  title: string;
  slug: string;
  status: 'DRAFT' | 'PUBLISHED';
  publishedAt: string | null;
  updatedAt: string;
  tags: string[];
  author: { name: string; email: string };
}

export interface AdminPost extends AdminPostSummary {
  excerpt: string | null;
  body: string;
  coverUrl: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  createdAt: string;
  author: { id: string; name: string; email: string };
}

export interface PaginatedAdminPosts {
  items: AdminPostSummary[];
  total: number;
  page: number;
  perPage: number;
}

export interface CreatePostPayload {
  // Omitido para crear un POST normal (default en el backend). /admin/paginas
  // envía 'PAGE' explícitamente. Inmutable tras crear — no existe en UpdatePostPayload.
  type?: PostType;
  title: string;
  slug?: string;
  excerpt?: string;
  body?: string;
  coverUrl?: string;
  tags?: string[];
  metaTitle?: string;
  metaDescription?: string;
}

export type UpdatePostPayload = Partial<Omit<CreatePostPayload, 'type'>>;

export function getAdminPosts(
  token: string,
  params?: { status?: string; type?: PostType; page?: number; perPage?: number },
): Promise<PaginatedAdminPosts> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.type) qs.set('type', params.type);
  if (params?.page && params.page > 1) qs.set('page', String(params.page));
  if (params?.perPage) qs.set('perPage', String(params.perPage));
  const q = qs.toString();
  return apiFetch<PaginatedAdminPosts>(`/admin/blog${q ? `?${q}` : ''}`, { token });
}

export function getAdminPost(token: string, id: string): Promise<AdminPost> {
  return apiFetch<AdminPost>(`/admin/blog/${id}`, { token });
}

export function createAdminPost(token: string, data: CreatePostPayload): Promise<AdminPost> {
  return apiFetch<AdminPost>('/admin/blog', {
    method: 'POST',
    body: JSON.stringify(data),
    token,
  });
}

export function updateAdminPost(
  token: string,
  id: string,
  data: UpdatePostPayload,
): Promise<AdminPost> {
  return apiFetch<AdminPost>(`/admin/blog/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
    token,
  });
}

export function publishAdminPost(token: string, id: string): Promise<AdminPost> {
  return apiFetch<AdminPost>(`/admin/blog/${id}/publish`, { method: 'POST', token });
}

export function unpublishAdminPost(token: string, id: string): Promise<AdminPost> {
  return apiFetch<AdminPost>(`/admin/blog/${id}/unpublish`, { method: 'POST', token });
}

export function deleteAdminPost(token: string, id: string): Promise<void> {
  return apiFetch<void>(`/admin/blog/${id}`, { method: 'DELETE', token });
}
