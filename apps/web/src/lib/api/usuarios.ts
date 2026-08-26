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

// ── BORRADO DE CUENTAS C6 — la exportación de datos (§7) ─────────────────────

export type DataExportStatus = 'PENDING' | 'READY' | 'FAILED' | 'EXPIRED';

/**
 * Una solicitud de exportación. **Sin `key`**: el backend nunca la sirve, porque
 * es una clave privada de R2 y el ZIP sólo se baja por su endpoint autenticado.
 */
export interface DataExportDto {
  id: string;
  subjectUserId: string;
  requestedById: string | null;
  status: DataExportStatus;
  sizeBytes: number | null;
  expiresAt: string | null;
  /**
   * El detalle del fallo. **Sólo llega por la puerta del staff**
   * (`GET /admin/users/:id/exports`): al usuario se le dice que falló y que puede
   * volver a pedirla —eso es `status`—, no el mensaje crudo de la excepción.
   */
  error?: string | null;
  createdAt: string;
  completedAt: string | null;
}

/**
 * Pide la exportación propia. Devuelve la fila en `PENDING`: el ZIP se arma en
 * una cola y no puede existir dentro de esta petición.
 *
 * 409 si ya hay una viva — una por persona (§7.3).
 */
export function requestMyExport(token: string): Promise<DataExportDto> {
  return apiFetch<DataExportDto>('/users/me/export', { method: 'POST', token });
}

export function getMyExports(token: string): Promise<DataExportDto[]> {
  return apiFetch<DataExportDto[]>('/users/me/exports', { token });
}
