import { Role, TicketOrigin, TicketStatus } from '@prisma/client';

/**
 * Quién actúa desde el lado de la administración (R3).
 *
 * Lleva el ROL, no solo el id, porque tres puertas del sistema NO las puede
 * decidir el `RolesGuard`: dependen del CONTENIDO de la fila, no de la ruta
 * (un ticket con factura enlazada es ADMIN-only; reasignar el ticket de otro
 * agente es ADMIN-only). El guard vive en el servicio y necesita el rol ahí.
 *
 * Es un parámetro OBLIGATORIO en todos los métodos de staff, no opcional con
 * default permisivo: un guard que se desactiva solo con olvidarse de pasar un
 * argumento es el mismo modo de fallo silencioso que se evitó separando
 * getForUser/getForStaff en vez de usar un booleano.
 */
export interface StaffActor {
  userId: string;
  role: Role;
}

/** Filtros de la bandeja de staff (R3). */
export interface StaffTicketFilters {
  status?: TicketStatus;
  origin?: TicketOrigin;
  topicId?: string;
  /**
   * Id de agente, o uno de los dos centinelas: `'me'` (los míos) y `'none'`
   * (sin asignar). Son seguros como centinelas porque los ids son cuid y nunca
   * pueden valer literalmente "me" ni "none".
   */
  assignedTo?: string;
  page?: number;
  perPage?: number;
}

export const ASSIGNED_TO_ME = 'me';
export const ASSIGNED_TO_NONE = 'none';

/**
 * Entradas de TicketsService (R1). Interfaces planas, NO DTOs de class-validator:
 * en R1 no hay controladores todavía, así que no hay superficie HTTP que validar.
 * Los DTOs con decoradores llegan con sus rutas — usuario en R2, staff en R3 — y
 * son los que harán cumplir longitudes, formatos y el `whitelist: true` global.
 */

/** Enlaces polimórficos a entidades del marketplace (molde Report: FKs nullables). */
export interface TicketLinkInput {
  listingId?: string | null;
  reviewId?: string | null;
  invoiceId?: string | null;
  /**
   * Etiqueta legible de la entidad enlazada, congelada al crear (molde
   * Deal.listingTitle). Los enlaces son onDelete: SetNull, así que sin esto el
   * hilo se quedaría sin contexto al borrarse el anuncio/valoración/factura.
   */
  linkedLabel?: string | null;
}

/** Flujo (a) — el usuario abre su propio ticket. */
export interface CreateUserTicketInput extends TicketLinkInput {
  subject: string;
  body: string;
  topicId?: string | null;
}

/**
 * Flujos (b) y (c) — la administración inicia el hilo con un usuario concreto.
 * `origin` distingue el hilo espontáneo (ADMIN) del derivado de una denuncia
 * (REPORT); `createByStaff` rechaza `TicketOrigin.USER`.
 */
export interface CreateStaffTicketInput extends TicketLinkInput {
  /** El usuario DUEÑO del hilo — el destinatario, no quien lo abre. */
  userId: string;
  subject: string;
  body: string;
  origin: Extract<TicketOrigin, 'ADMIN' | 'REPORT'>;
  topicId?: string | null;
  /** Flujo (c): la denuncia que originó el hilo. Report no se toca — se referencia. */
  reportId?: string | null;
}
