import { TicketOrigin } from '@prisma/client';

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
