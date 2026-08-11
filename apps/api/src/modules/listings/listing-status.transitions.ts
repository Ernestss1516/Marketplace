import { ListingStatus } from '@prisma/client';

/**
 * RÁFAGA (A1) — LA MÁQUINA DE ESTADOS del anuncio: qué saltos de `ListingStatus`
 * son legales.
 *
 * QUÉ PREGUNTA RESPONDE, Y CUÁL NO. Esto es TOPOLOGÍA pura: «¿es legal ir de X a
 * Y?». No mira la categoría, ni los atributos, ni la cuota, ni quién actúa. La
 * otra pregunta —«¿MERECE este anuncio estar activo?», que sí necesita categoría,
 * schema efectivo y ajustes— es la futura puerta de validación, un componente
 * distinto y un proyecto posterior (ver docs/auditoria-puerta-validacion.md,
 * Bloque 3). Mezclarlas las acopla sin ganancia: la topología no necesita saber
 * nada del contenido del anuncio, y la validez no necesita saber de dónde viene.
 *
 * FICHERO PURO, SIN DI, a propósito — mismo molde que `category.types.ts`: lo
 * importa `AdminService` (AdminModule), y AdminModule NO importa ListingsModule.
 * Un servicio inyectable habría obligado a cablear un módulo nuevo para una tabla
 * de constantes.
 *
 * EL DEFECTO QUE CIERRA. `AdminService.changeListingStatus` escribía `dto.status`
 * directamente, y su DTO solo declara `@IsEnum(ListingStatus)` — es decir,
 * cualquier estado valía desde cualquier estado. Entre otras cosas se podía
 * resucitar un `ARCHIVED`, que el propio schema.prisma declara «permanente,
 * IRREVERSIBLE»: la irreversibilidad no lo era. Es el único escritor de estado
 * sin guarda; los demás (publish, renew, reserve, pause, reactivate, archive,
 * closeDeal, undoDeal, approve, reject, deactivate, restore) ya comprueban su
 * estado de origen con un `if` propio, y esta ráfaga NO los toca.
 */

/**
 * El grafo legal. Cada entrada = estados alcanzables DESDE esa clave.
 *
 * DE DÓNDE SALE CADA ARISTA. Dos orígenes, anotados uno por uno abajo:
 *
 *  1. **Derivadas del código**: las que algún camino del sistema ejecuta hoy
 *     (métodos de servicio o crones). Son hechos verificados, no criterio.
 *
 *  2. **Correctivas de staff**: movimientos hacia el área editorial (DRAFT,
 *     PENDING_REVIEW, REJECTED, ACTIVE) que ningún camino automático produce
 *     pero que el backoffice YA ofrece hoy — `TARGET_STATUSES` en
 *     /admin/anuncios es exactamente `['ACTIVE','PENDING_REVIEW','REJECTED','DRAFT']`,
 *     ofrecidos sobre cualquier fila. Se admiten a propósito: son reversibles, no
 *     destruyen nada, y prohibirlas sería romper la herramienta del moderador
 *     para arreglar un bug que va de otra cosa.
 *
 * LO QUE QUEDA PROHIBIDO, y por qué (esto es el arreglo, no una consecuencia):
 *
 *  · `ARCHIVED` → cualquier cosa. TERMINAL. Lo declara schema.prisma:
 *    «permanente, IRREVERSIBLE, ninguna transición sale de este estado;
 *    remove() (borrado físico) sigue siendo la única vía posterior».
 *
 *  · → `SOLD` a mano desde donde no hay venta. SOLD lo produce `closeDeal` y
 *    lleva un `Deal` detrás. Estamparlo sin Deal deja el anuncio en un CALLEJÓN
 *    SIN SALIDA: la única vuelta atrás es `undoDeal`, que exige un `Deal`
 *    existente y dentro de 72 h — sin Deal no hay forma de volver.
 *
 *  · → `RESERVED`, `PAUSED`, `EXPIRED` desde donde no sea `ACTIVE`. Los tres
 *    describen algo que le pasa a un anuncio PUBLICADO (una reserva en curso,
 *    una pausa del vendedor, una caducidad). Sobre un DRAFT no significan nada, y
 *    `reserve()`/`pause()` ya exigen ACTIVE por su cuenta.
 *
 *  · `DRAFT`/`PENDING_REVIEW` → `ARCHIVED`. Mismo criterio que ya aplica
 *    `archive()` al excluirlos: «nada publicado aún».
 *
 *  · `DRAFT` → `REJECTED`. No hay nada publicado que rechazar; el rechazo sale
 *    de PENDING_REVIEW (`rejectListing`) o de ACTIVE (`deactivateListing`).
 */
export const LISTING_STATUS_TRANSITIONS: Readonly<
  Record<ListingStatus, readonly ListingStatus[]>
> = {
  // publish() → ACTIVE (limpio) o PENDING_REVIEW (filtro de palabras).
  DRAFT: ['ACTIVE', 'PENDING_REVIEW'],

  // approveListing() → ACTIVE · rejectListing() → REJECTED.
  // + correctiva: devolver al vendedor sin rechazar.
  PENDING_REVIEW: ['ACTIVE', 'REJECTED', 'DRAFT'],

  // pause() · reserve() · closeDeal(PRODUCT) · cron de expiración ·
  // deactivateListing() · archive() · downgrade de Pro (cron → DRAFT).
  // + correctiva: mandar a revisión un anuncio ya publicado.
  ACTIVE: [
    'PAUSED',
    'RESERVED',
    'SOLD',
    'EXPIRED',
    'REJECTED',
    'ARCHIVED',
    'DRAFT',
    'PENDING_REVIEW',
  ],

  // closeDeal(SERVICE) → ACTIVE · closeDeal(PRODUCT) → SOLD.
  // + correctivas: retirar o devolver al vendedor una reserva encallada.
  // NO va a ARCHIVED: archive() excluye RESERVED a propósito («archivar dejaría
  // un trato colgado sin resolver»).
  RESERVED: ['ACTIVE', 'SOLD', 'REJECTED', 'DRAFT'],

  // reactivate() → ACTIVE · archive() → ARCHIVED.
  PAUSED: ['ACTIVE', 'ARCHIVED', 'REJECTED', 'DRAFT'],

  // undoDeal() → ACTIVE (dentro de 72 h) · archive() → ARCHIVED.
  SOLD: ['ACTIVE', 'ARCHIVED', 'DRAFT'],

  // renew() → ACTIVE · archive() → ARCHIVED.
  EXPIRED: ['ACTIVE', 'ARCHIVED', 'DRAFT'],

  // restoreListing() → ACTIVE · archive() → ARCHIVED.
  // + correctiva: devolver a revisión o al vendedor.
  REJECTED: ['ACTIVE', 'ARCHIVED', 'DRAFT', 'PENDING_REVIEW'],

  // TERMINAL. Ver arriba.
  ARCHIVED: [],
};

/** Etiquetas en español para el mensaje de error (contenido de cara al usuario). */
export const LISTING_STATUS_LABELS: Readonly<Record<ListingStatus, string>> = {
  DRAFT: 'Borrador',
  PENDING_REVIEW: 'En revisión',
  ACTIVE: 'Activo',
  RESERVED: 'Reservado',
  SOLD: 'Vendido',
  EXPIRED: 'Caducado',
  REJECTED: 'Rechazado',
  PAUSED: 'Pausado',
  ARCHIVED: 'Archivado',
};

/**
 * ¿Es legal el salto?
 *
 * `from === to` SIEMPRE es legal, incluso desde ARCHIVED: topológicamente no es
 * un salto, es un no-op. Se admite para no romper una re-escritura idempotente
 * (el mismo estado guardado dos veces, un doble clic en el backoffice) con un
 * error que no describiría ningún problema real.
 */
export function isLegalTransition(from: ListingStatus, to: ListingStatus): boolean {
  if (from === to) return true;
  return LISTING_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * El motivo, en español y accionable: dice de dónde a dónde, y qué SÍ se puede
 * hacer desde el estado actual — un 400 que solo diga «no» obliga al moderador a
 * adivinar la tabla. El caso terminal se nombra aparte porque «los estados
 * posibles son: (ninguno)» no se lee como una explicación.
 */
export function describeIllegalTransition(from: ListingStatus, to: ListingStatus): string {
  const desde = LISTING_STATUS_LABELS[from];
  const hasta = LISTING_STATUS_LABELS[to];
  const alcanzables = LISTING_STATUS_TRANSITIONS[from];

  if (alcanzables.length === 0) {
    return `No se puede pasar de ${desde} a ${hasta}: ${desde} es un estado final y no admite ninguna transición.`;
  }

  const posibles = alcanzables.map((s) => LISTING_STATUS_LABELS[s]).join(', ');
  return `No se puede pasar de ${desde} a ${hasta}. Desde ${desde} solo se puede pasar a: ${posibles}.`;
}
