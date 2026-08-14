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
  /**
   * REGLA #1 (límite total) — la única transición sobre algo que TODAVÍA NO
   * EXISTE. No lleva a ACTIVE ni cambia ningún estado: crea el anuncio en
   * `DRAFT`. Entró con el límite total, que es el primer límite que cuenta
   * EXISTENCIAS en vez de estados.
   */
  | 'create'
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

/**
 * LO QUE LA PUERTA LEE DE UN ANUNCIO, y nada más.
 *
 * No es `Listing` entero a propósito: así queda escrito qué campos necesita
 * cualquier camino que quiera pasar por aquí, y `BillingService.bump` —que lee
 * la fila con un `select` corto y deliberado— puede llamar a la puerta añadiendo
 * exactamente estas columnas en vez de traerse el anuncio completo. Un `Listing`
 * de Prisma encaja aquí por estructura, así que los siete caminos de la ráfaga 1
 * siguen pasándolo tal cual.
 */
export type GateListing = Pick<
  Listing,
  'id' | 'sellerId' | 'categoryId' | 'type' | 'status' | 'attributes' | 'needsRevalidation'
>;

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
 *
 * DOS PREGUNTAS, DOS GANCHOS, Y UNA REGLA IMPLEMENTA EL QUE LE TOQUE:
 *
 *  · `check(listing, …)` — sobre un anuncio QUE YA EXISTE. Es el gancho de los
 *    diez caminos del diseño.
 *  · `checkBeforeCreate(sellerId, …)` — ANTES de que exista: no hay anuncio que
 *    pasar, sólo el vendedor que lo va a crear.
 *
 * El segundo lo trajo el LÍMITE TOTAL, que es el primer límite sobre EXISTENCIAS
 * y no sobre estados: su pregunta («¿puedes tener uno más?») no se puede hacer
 * sobre un anuncio, porque el anuncio en cuestión es justo el que todavía no hay.
 * La alternativa —inventar un anuncio de mentira con `id: ''` para poder usar
 * `check`— habría hecho que TODAS las reglas existentes empezaran a correr al
 * crear, con lo que la cuota de activos bloquearía guardar un borrador. Los dos
 * ganchos son opcionales y una regla que no implementa uno simplemente no se
 * evalúa en ese momento; así, ninguna regla anterior cambia de comportamiento.
 */
export interface ListingGateRule {
  /** Identifica la regla en logs y en pruebas. No es el `code` del motivo. */
  readonly name: string;
  readonly group: GateRuleGroup;
  /** ¿Corre esta regla en esta transición y para este actor? */
  appliesTo(context: GateContext): boolean;
  /**
   * EL INTERRUPTOR POR REGLA. Ausente = encendida siempre, que es lo que quiere
   * la cuota: lleva años aplicándose y apagarla sería un incidente, no una
   * opción.
   *
   * Existe porque una regla NUEVA no puede nacer encendida sobre anuncios ya
   * publicados sin saber a cuántos frena — la de atributos nace apagada y se
   * enciende con el número de `pnpm gate-impact-report` delante. Es asíncrono a
   * propósito: el molde verificado del repo (`videoEnabled`, `bumpAutoEnabled`)
   * es una fila de `Setting`, editable desde el backoffice sin desplegar.
   *
   * ⚠ Con su LECTOR o no nace: aquí ya hay dos ajustes muertos
   * (`listingExpiryDays`, `contactRequiresVerification`), y un interruptor que
   * nadie lee es peor que no tenerlo.
   */
  isEnabled?(): Promise<boolean>;
  /**
   * Los motivos si no se cumple; `null` (o lista vacía) si todo bien.
   *
   * VARIOS, no uno: una regla puede encontrar tres atributos mal en el mismo
   * anuncio, y el vendedor necesita verlos todos de una vez (decisión D-motivos).
   * Devolver un único `GateReason` sigue valiendo — es lo que hace la cuota, que
   * o falla por una cosa o no falla.
   */
  check?(listing: GateListing, context: GateContext): Promise<GateReason | GateReason[] | null>;
  /**
   * La misma pregunta, ANTES de que el anuncio exista. Sólo la implementan las
   * reglas que limitan la ENTRADA (hoy: el límite total).
   *
   * Recibe el vendedor y no un anuncio porque no hay ninguno todavía. Quien
   * necesite mirar el contenido de lo que se va a crear no debería vivir aquí:
   * eso ya lo valida `create()` contra el schema de la categoría.
   */
  checkBeforeCreate?(
    sellerId: string,
    context: GateContext,
  ): Promise<GateReason | GateReason[] | null>;
}

/** Token de DI de la lista de reglas. Ver `ListingGateModule`. */
export const LISTING_GATE_RULES = Symbol('LISTING_GATE_RULES');
