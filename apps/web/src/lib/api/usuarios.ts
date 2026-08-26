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

/**
 * BORRADO DE CUENTAS C2 — el usuario archiva SU PROPIA cuenta desde `/perfil`.
 *
 * No recibe id: el backend usa el del token, así que no hay forma de archivar la
 * de otro por esta puerta.
 *
 * DESPUÉS DE ESTO EL TOKEN YA NO SIRVE — el backend incrementa `tokenVersion`—,
 * así que quien la llame tiene que cerrar sesión a continuación. No es un efecto
 * lateral que se pueda ignorar: sin el `signOut`, la sesión de NextAuth seguiría
 * viva en la cookie y el usuario vería la aplicación fallar a cada clic.
 */
export function archiveMyAccount(token: string, note?: string): Promise<unknown> {
  return apiFetch('/users/me/archive', {
    method: 'POST',
    body: JSON.stringify(note ? { note } : {}),
    token,
  });
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
