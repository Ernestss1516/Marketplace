import { apiFetch } from './client';
import type { IlustracionSlotId, IlustracionesResueltas } from '../ilustraciones';

/**
 * E7 — el cliente de admin de las ilustraciones. Molde `branding-admin.ts`.
 *
 * Las dos operaciones de escritura devuelven las DIEZ resueltas, no sólo el slot tocado:
 * es el mismo cuerpo que `GET /ilustraciones`, así que la pantalla se repinta entera con
 * la respuesta y no hace falta una segunda petición para ver el estado real.
 *
 * SEPARADO de `ilustraciones.ts` (el de lectura pública) por el motivo de siempre: aquél
 * importa `unstable_cache`, que es sólo de servidor, y esta pantalla es cliente. Y aunque
 * se pudiera reusar no se querría: quien acaba de sustituir una ilustración tiene que ver
 * **lo que hay ahora**, no lo que la caché del sitio público sirva durante los segundos
 * siguientes.
 */

/** Lo que el backend declara de cada slot. Espejo de `SlotIlustracion`. */
export interface SlotIlustracion {
  id: IlustracionSlotId;
  descripcion: string;
  proporcion: { ancho: number; alto: number };
  alt: string;
  defecto: string;
}

export interface EstadoIlustraciones {
  catalogo: SlotIlustracion[];
  resueltas: IlustracionesResueltas;
}

/** El catálogo + lo que sirve hoy cada slot, en una sola petición. */
export function getIlustracionesAdmin(token: string): Promise<EstadoIlustraciones> {
  return apiFetch<EstadoIlustraciones>('/admin/ilustraciones', { token });
}

/**
 * Sustituye la ilustración de un slot. Endpoint PROPIO y no el del blog ni el de portada:
 * es de ADMIN, admite SVG y tiene su propio límite de peso (2 MB, ver
 * `ilustraciones.constants.ts` — el doble que un logo porque se sirve en una pantalla y
 * no en todas).
 */
export function uploadIlustracion(
  slot: IlustracionSlotId,
  file: File,
  token: string,
): Promise<IlustracionesResueltas> {
  const formData = new FormData();
  formData.append('file', file);
  return apiFetch<IlustracionesResueltas>(`/admin/ilustraciones/${slot}`, {
    method: 'POST',
    token,
    body: formData,
  });
}

/** Quita la sustitución: el slot vuelve al default del modelo. Idempotente. */
export function clearIlustracion(
  slot: IlustracionSlotId,
  token: string,
): Promise<IlustracionesResueltas> {
  return apiFetch<IlustracionesResueltas>(`/admin/ilustraciones/${slot}`, {
    method: 'DELETE',
    token,
  });
}
