import type { User, UserPublic } from '@/types';
import { apiFetch } from './client';

export function getMe(token: string): Promise<User> {
  return apiFetch<User>('/users/me', { token });
}

export function getSellerProfile(slug: string): Promise<UserPublic> {
  return apiFetch<UserPublic>(`/users/${slug}`);
}

export function updateMe(
  data: Partial<Pick<User, 'name' | 'phone' | 'bio' | 'city' | 'province' | 'postalCode'>>,
  token: string,
): Promise<User> {
  return apiFetch<User>('/users/me', {
    method: 'PATCH',
    body: JSON.stringify(data),
    token,
  });
}
