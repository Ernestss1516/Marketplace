import type { PersonStub, User, UserPublic } from '@/types';
import { apiFetch } from './client';

export function getMe(token: string): Promise<User> {
  return apiFetch<User>('/users/me', { token });
}

/**
 * Ciclo de vida RÁFAGA 1 — buscador para elegir comprador/cliente al cerrar un
 * Deal cuando no está entre los contactos del anuncio. Rate-limited en el
 * backend; q debe tener al menos 2 caracteres (validado también ahí).
 */
export function searchUsers(q: string, token: string): Promise<PersonStub[]> {
  const params = new URLSearchParams({ q });
  return apiFetch<PersonStub[]>(`/users/search?${params}`, { token });
}

export function getSellerProfile(slug: string): Promise<UserPublic> {
  return apiFetch<UserPublic>(`/users/${slug}`);
}

export function updateMe(
  data: Partial<
    Pick<
      User,
      | 'name'
      | 'phone'
      | 'avatarUrl'
      | 'bio'
      | 'city'
      | 'province'
      | 'postalCode'
      | 'fiscalTaxId'
      | 'fiscalName'
      | 'fiscalEntityType'
      | 'fiscalAddress'
      | 'fiscalCity'
      | 'fiscalPostalCode'
      | 'fiscalProvince'
      | 'fiscalCountry'
    >
  >,
  token: string,
): Promise<User> {
  return apiFetch<User>('/users/me', {
    method: 'PATCH',
    body: JSON.stringify(data),
    token,
  });
}
