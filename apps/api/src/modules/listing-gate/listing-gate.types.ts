import type { Listing } from '@prisma/client';

/**
 * PUERTA DE VALIDACIÓN — RÁFAGA 1. El contrato: qué es una regla, qué contexto
 * recibe y qué devuelve cuando rechaza.
 *
 * Fichero PURO (sin DI, sin Nest): las reglas y sus tipos se leen desde la
 * puerta, desde los tests y —cuando llegue— desde el comando de medición, sin
 * arrastrar un módulo. Mismo molde que `category.types.ts` y
 * `listing-status.transitions.ts`.
 */

/**
 * QUIÉN actúa. No es cosmético: es lo que hace que «staff exento de cuota» sea
 * una línea declarativa (`appliesTo`) en vez de un olvido repartido por cuatro
 * servicios, que es como estaba antes de esta ráfaga.
 */
export type GateActor = 'seller' | 'staff';

/**
 * QUÉ transición se está intentando. Sirve para que una regla se aplique sólo
 * donde tiene sentido sin que la puerta sepa nada de reglas concretas.
 *
 * TRES VALORES NO LOS EMITE NADIE TODAVÍA, y conviene saber por qué antes de
 * buscarlos en vano:
 *
 *  · `bump` y `featured` no son transiciones a ACTIVE —operan sobre un anuncio
 *    que ya lo está—, pero la ráfaga 2 las frenará cuando el anuncio esté marcado
 *    con `needsRevalidation`.
 *  · `closeDeal` (un SERVICIO en RESERVED vuelve a ACTIVE) es un camino a ACTIVE
 *    real que se dejó FUERA de la puerta a propósito: bloquearlo perdería el
 *    registro de un hecho ya ocurrido. Decisión pendiente, con su porqué escrito
 *    en `ListingsService.closeDeal` y en docs/diseno-puerta-validacion.md.
 */
export type GateTransition =
  | 'publish'
  | 'renew'
  | 'reactivate'
  | 'undoDeal'
  | 'closeDeal'
  | 'approve'
  | 'restore'
  | 'adminStatus'
  | 'bump'
  | 'featured';

export interface GateContext {
  actor: GateActor;
  transition: GateTransition;
  /** Quién ejecuta la acción. Para `staff` es el moderador, no el vendedor. */
  actorId: string;
}

/**
 * Un motivo de rechazo, accionable. NUNCA un booleano: el usuario tiene que
 * saber QUÉ corregir, que es lo único que convierte un bloqueo en una tarea.
 */
export interface GateReason {
  /** Código estable, para que el frontend pueda ramificar. Molde: los ~15 códigos ya en uso. */
  code: string;
  /** Texto de cara al usuario, en español. */
  message: string;
  /** El atributo concreto al que apunta, cuando lo hay (lo usará la ráfaga 2). */
  field?: string;
}

/**
 * EL GRUPO decide el corto-circuito.
 *
 *  · `entrada` — barato: propiedad, estado, cuota. Una consulta corta o ninguna.
 *  · `contenido` — caro: schema efectivo de la categoría, atributos (ráfaga 2).
 *
 * Si falla alguna de `entrada`, las de `contenido` NI SE EVALÚAN. No tiene
 * sentido resolver la cadena de categorías de un anuncio que ni siquiera
 * pertenece a quien lo pide. Dentro de un mismo grupo los motivos SÍ se acumulan
 * — ver `ListingGateService`.
 */
export type GateRuleGroup = 'entrada' | 'contenido';

/**
 * Una regla. Añadir una regla nueva = añadir una entrada a la lista del módulo;
 * no se toca la puerta ni ninguno de los caminos que la llaman.
 */
export interface ListingGateRule {
  /** Identifica la regla en logs y en pruebas. No es el `code` del motivo. */
  readonly name: string;
  readonly group: GateRuleGroup;
  /** ¿Corre esta regla en esta transición y para este actor? */
  appliesTo(context: GateContext): boolean;
  /** El motivo si no se cumple; `null` si todo bien. */
  check(listing: Listing, context: GateContext): Promise<GateReason | null>;
}

/** Token de DI de la lista de reglas. Ver `ListingGateModule`. */
export const LISTING_GATE_RULES = Symbol('LISTING_GATE_RULES');
