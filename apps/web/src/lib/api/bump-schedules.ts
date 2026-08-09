import { apiFetch } from './client';

/**
 * Bump automático — cliente de la API de programaciones.
 *
 * TODO lo que aquí se lee viene YA RESUELTO del backend: el próximo turno, el estado y su
 * razón, y lo que costó cada turno. La interfaz muestra, no calcula. Es la misma regla que
 * UXV.1 dejó para el cooldown y por el mismo motivo: en cuanto el cliente deriva su propia
 * versión de un dato de negocio, hay dos verdades.
 */

/** Por qué una programación no está corriendo. Espejo del enum de Prisma. */
export type BumpScheduleStatus =
  | 'ACTIVE'
  | 'PAUSED_BY_USER'
  | 'PAUSED_NO_FUNDS'
  | 'PAUSED_LISTING_INACTIVE';

/** Cómo acabó un turno. `SKIPPED_*` no llegó a cobrar; `FAILED_*` lo intentó y no pudo. */
export type BumpRunOutcome =
  | 'APPLIED'
  | 'SKIPPED_COOLDOWN'
  | 'SKIPPED_LISTING_INACTIVE'
  | 'FAILED_NO_FUNDS'
  | 'FAILED_ERROR';

/** La programación tal y como viaja en la tarjeta del propietario. */
export interface BumpScheduleSummary {
  id: string;
  status: BumpScheduleStatus;
  nextRunAt: string;
  intervalDays: number;
  hourOfDay: number;
}

export interface BumpScheduleItem extends BumpScheduleSummary {
  lastRunAt: string | null;
  createdAt: string;
  listing: { id: string; title: string; slug: string; status: string };
}

export interface BumpRunItem {
  id: string;
  slot: string;
  /** null = turno reclamado que aún no se ha resuelto (o que murió a medias). */
  outcome: BumpRunOutcome | null;
  paidWith: 'PRO_QUOTA' | 'BUMP_BALANCE' | 'CREDITS' | null;
  cost: number | null;
  detail: string | null;
  createdAt: string;
}

export interface BumpRunsResponse {
  items: BumpRunItem[];
  total: number;
  page: number;
  perPage: number;
  pages: number;
}

export function getBumpSchedules(token: string) {
  return apiFetch<{ items: BumpScheduleItem[]; total: number }>('/bump-schedules', {
    token,
    cache: 'no-store',
  });
}

export function createBumpSchedule(
  token: string,
  body: { listingId: string; intervalDays: number; hourOfDay: number },
) {
  return apiFetch<BumpScheduleItem>('/bump-schedules', {
    method: 'POST',
    token,
    body: JSON.stringify(body),
  });
}

export function updateBumpSchedule(
  token: string,
  id: string,
  body: { intervalDays?: number; hourOfDay?: number },
) {
  return apiFetch<BumpScheduleItem>(`/bump-schedules/${id}`, {
    method: 'PATCH',
    token,
    body: JSON.stringify(body),
  });
}

export function pauseBumpSchedule(token: string, id: string) {
  return apiFetch<BumpScheduleItem>(`/bump-schedules/${id}/pausar`, { method: 'POST', token });
}

/** D2 — reanudar es un ACTO del usuario, nunca un efecto de haber recargado saldo. */
export function resumeBumpSchedule(token: string, id: string) {
  return apiFetch<BumpScheduleItem>(`/bump-schedules/${id}/reanudar`, { method: 'POST', token });
}

export function deleteBumpSchedule(token: string, id: string) {
  return apiFetch<void>(`/bump-schedules/${id}`, { method: 'DELETE', token });
}

export function getBumpRuns(token: string, id: string, page = 1) {
  return apiFetch<BumpRunsResponse>(`/bump-schedules/${id}/turnos?page=${page}`, {
    token,
    cache: 'no-store',
  });
}

// ---------------------------------------------------------------------------
// Cómo se cuenta al usuario
// ---------------------------------------------------------------------------

const FORMATO_FECHA_HORA = new Intl.DateTimeFormat('es-ES', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Europe/Madrid',
});

/**
 * Un instante, en HORA PENINSULAR y dicho explícitamente.
 *
 * La zona se fija aquí y no se deja al navegador (D4): el backend programa en
 * `Europe/Madrid`, así que a alguien que abra la web desde fuera de España el navegador le
 * pintaría una hora distinta de la que el sistema va a usar. Antes que mentir con precisión,
 * se dice en qué hora se está hablando.
 */
export function fechaHoraPeninsular(iso: string): string {
  return `${FORMATO_FECHA_HORA.format(new Date(iso))} (hora peninsular)`;
}

/** «cada 3 días sobre las 9:00». */
export function cadenciaLabel(intervalDays: number, hourOfDay: number): string {
  const cada = intervalDays === 1 ? 'todos los días' : `cada ${intervalDays} días`;
  // «Sobre las» y no «a las»: el cron pasa una vez por hora, así que prometer el minuto
  // exacto sería prometer una precisión que la arquitectura no da.
  return `${cada} sobre las ${String(hourOfDay).padStart(2, '0')}:00`;
}

export interface EstadoProgramacion {
  activa: boolean;
  /** Frase corta para la tarjeta y la lista. */
  texto: string;
  /** Qué puede hacer el usuario al respecto, si hay algo que hacer. */
  accion: { label: string; href: string } | null;
}

/**
 * El estado de una programación, contado con su RAZÓN y su salida.
 *
 * Un «pausado» a secas es un callejón: el usuario ve que no funciona y no sabe qué hacer.
 * Cada pausa del sistema tiene una causa distinta y una salida distinta —recargar saldo no
 * es lo mismo que reactivar el anuncio— y por eso el estado se guardó como enum y no como
 * un booleano. Aquí es donde esa decisión se cobra el beneficio.
 */
export function estadoProgramacion(
  s: Pick<BumpScheduleSummary, 'status' | 'nextRunAt'>,
): EstadoProgramacion {
  switch (s.status) {
    case 'ACTIVE':
      return {
        activa: true,
        texto: `Próximo bump: ${fechaHoraPeninsular(s.nextRunAt)}`,
        accion: null,
      };
    case 'PAUSED_NO_FUNDS':
      return {
        activa: false,
        texto: 'Bumps programados en pausa: te quedaste sin saldo.',
        accion: { label: 'Recargar', href: '/mis-creditos' },
      };
    case 'PAUSED_LISTING_INACTIVE':
      return {
        activa: false,
        texto: 'Bumps programados en pausa: el anuncio no está activo.',
        accion: null,
      };
    case 'PAUSED_BY_USER':
      return { activa: false, texto: 'Bumps programados en pausa.', accion: null };
  }
}

/** Qué pasó en un turno, en una línea. */
export function turnoLabel(run: BumpRunItem): string {
  switch (run.outcome) {
    case 'APPLIED':
      return run.paidWith === 'CREDITS'
        ? `Subido · ${run.cost} créditos`
        : run.paidWith === 'PRO_QUOTA'
          ? 'Subido · gratis, con tu cuota Pro'
          : 'Subido · gratis, de tu saldo de bumps';
    case 'SKIPPED_COOLDOWN':
      return 'No hacía falta: ya lo habías subido hace poco. No se cobró nada.';
    case 'SKIPPED_LISTING_INACTIVE':
      return 'No se subió: el anuncio no estaba activo. No se cobró nada.';
    case 'FAILED_NO_FUNDS':
      return 'No se pudo subir: sin saldo. No se cobró nada.';
    case 'FAILED_ERROR':
      return 'No se pudo subir por un error. No se cobró nada.';
    default:
      return 'En curso…';
  }
}
