import { UserStatus } from '@prisma/client';

/**
 * BORRADO DE CUENTAS C1 — LA MÁQUINA DE ESTADOS de una cuenta: qué saltos de
 * `UserStatus` son legales.
 *
 * MOLDE LITERAL de `listing-status.transitions.ts`, incluida su frontera: esto es
 * TOPOLOGÍA PURA —«¿es legal ir de X a Y?»— y no mira nada más. No mira si la cuenta
 * tiene facturas, ni cuántos anuncios arrastra, ni **quién actúa**. El reparto de
 * roles se documenta abajo pero NO se codifica aquí: lo hacen cumplir los
 * `@MinRole` de los endpoints de C2/C5, que es donde ya vive el resto del reparto
 * del backoffice. Una tabla de roles que ningún decorador consulta sería una segunda
 * verdad que mantener — y un ajuste decorativo, que es deuda ya inventariada en este
 * repo.
 *
 * FICHERO PURO, SIN DI, igual que el de anuncios y por lo mismo: lo importarán
 * `UsersService` (auto-archivado) y `AdminService` (archivar, desarchivar, eliminar),
 * y AdminModule no importa UsersModule.
 *
 * C1 SÓLO LO CREA. Ninguna operación lo llama todavía: C1 hace representables los
 * estados y arma las puertas, no las usa. Ver docs/diseno-borrado-cuentas.md §4.1.
 */

/**
 * El grafo legal. Cada entrada = estados alcanzables DESDE esa clave.
 *
 * DOS FAMILIAS EN UN SOLO EJE, y es la decisión de fondo del cuerpo (diseño §1):
 * `ACTIVE`/`SUSPENDED`/`BANNED` responden «¿está sancionada?» y
 * `ARCHIVED`/`DELETED` responden «¿existe?». Van en la misma columna porque las
 * puertas —los tres gates de entrada y las superficies públicas— necesitan UNA
 * respuesta, no dos; y porque un solo valor hace **irrepresentables** las
 * combinaciones inválidas. Lo que ese eje único costaría —que `ARCHIVED` pise a la
 * sanción— lo paga `User.statusBeforeArchive`.
 *
 * QUIÉN PUEDE CADA SALTO (documentado aquí, hecho cumplir en los controladores):
 *   · → SUSPENDED / → ACTIVE desde SUSPENDED ....... MODERATOR   (reversible)
 *   · → BANNED    / → ACTIVE desde BANNED .......... ADMIN       (sanción grave)
 *   · → ARCHIVED .................................... el propio usuario, o MODERATOR
 *   · ARCHIVED → (su estado previo) ................. MODERATOR   (reversible)
 *   · ARCHIVED → DELETED ............................ ADMIN       (IRREVERSIBLE)
 * El criterio es el que ya usa el borrado de anuncios: MODERATOR hace lo reversible,
 * ADMIN lo irreversible.
 *
 * LO QUE QUEDA PROHIBIDO, y por qué (esto es el diseño, no una consecuencia):
 *
 *  · `DELETED` → cualquier cosa. TERMINAL. La fila está vaciada de persona: no hay
 *    nadie a quien devolverle la cuenta. Es el equivalente de `ListingStatus.ARCHIVED`
 *    en el ciclo del anuncio, sólo que un paso más allá.
 *
 *  · `ACTIVE`/`SUSPENDED`/`BANNED` → `DELETED` directo. **LOS DOS PASOS SON LA
 *    SALVAGUARDA**, calcada de `deleteListing`: para vaciar una cuenta hay que
 *    archivarla primero. Ese segundo gesto separa «cerrarla» de «vaciarla», y obliga
 *    a que las dos cosas se decidan por separado.
 *
 *  · `ARCHIVED` → `ARCHIVED` (más allá del no-op) y `DELETED` → `ARCHIVED`: no hay
 *    forma de re-archivar lo ya archivado ni de resucitar lo vaciado.
 */
export const USER_STATUS_TRANSITIONS: Readonly<
  Record<UserStatus, readonly UserStatus[]>
> = {
  // suspend() · ban() · archive() — del propio usuario o del staff.
  ACTIVE: ['SUSPENDED', 'BANNED', 'ARCHIVED'],

  // unsuspend() → ACTIVE · la caducidad de C4 → ACTIVE · escalar a ban · archivar.
  SUSPENDED: ['ACTIVE', 'BANNED', 'ARCHIVED'],

  // reinstate() → ACTIVE · archivar.
  //
  // NO va a SUSPENDED: rebajar un ban a suspensión es levantar el ban y suspender,
  // dos decisiones con dos roles distintos (ADMIN y MODERATOR). Colapsarlas en una
  // arista dejaría a un MODERATOR a un paso de tocar una sanción que no es suya.
  BANNED: ['ACTIVE', 'ARCHIVED'],

  /**
   * Los tres destinos de sanción son alcanzables porque `unarchive()` devuelve la
   * cuenta a `User.statusBeforeArchive` — el valor que `status` TENÍA al archivar,
   * copiado tal cual (molde `BumpRun.slot`).
   *
   * QUE ESTÉN AQUÍ NO SIGNIFICA QUE SE PUEDAN PEDIR: `unarchive()` **no acepta
   * destino**, lo lee. Es la diferencia entre «alcanzable» y «elegible», y es lo que
   * cierra el agujero que da sentido a toda esta columna: sin ella, desarchivar
   * devolvería a `ACTIVE` por defecto y **archivar a un baneado sería la forma de
   * lavarle el ban**. Con ella, un baneado archivado vuelve a BANNED.
   *
   * `DELETED` es el otro destino: la revisión del staff acaba en «mantener
   * archivado» o en «vaciar».
   */
  ARCHIVED: ['ACTIVE', 'SUSPENDED', 'BANNED', 'DELETED'],

  // TERMINAL. Ver arriba.
  DELETED: [],
};

/** Etiquetas en español para el mensaje de error (contenido de cara al usuario). */
export const USER_STATUS_LABELS: Readonly<Record<UserStatus, string>> = {
  ACTIVE: 'Activa',
  SUSPENDED: 'Suspendida',
  BANNED: 'Inhabilitada',
  ARCHIVED: 'Archivada',
  DELETED: 'Eliminada',
};

/**
 * ¿Es legal el salto?
 *
 * `from === to` SIEMPRE es legal, incluso desde `DELETED`: topológicamente no es un
 * salto, es un no-op. Se admite para no romper una re-escritura idempotente (un
 * doble clic en el backoffice) con un error que no describiría ningún problema real.
 * Mismo criterio, y misma redacción, que `isLegalTransition` en anuncios.
 *
 * NOMBRE LARGO A PROPÓSITO: `AdminService` ya importa `isLegalTransition` del fichero
 * de anuncios, y va a importar también éste. Dos funciones con el mismo nombre en el
 * mismo servicio es una colisión esperando a ocurrir.
 */
export function isLegalUserStatusTransition(from: UserStatus, to: UserStatus): boolean {
  if (from === to) return true;
  return USER_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * El motivo, en español y accionable: dice de dónde a dónde, y **qué SÍ se puede
 * hacer** desde el estado actual — un 400 que sólo diga «no» obliga a quien lo lee a
 * adivinar la tabla. El caso terminal se nombra aparte porque «los estados posibles
 * son: (ninguno)» no se lee como una explicación.
 */
export function describeIllegalUserStatusTransition(
  from: UserStatus,
  to: UserStatus,
): string {
  const desde = USER_STATUS_LABELS[from];
  const hasta = USER_STATUS_LABELS[to];
  const alcanzables = USER_STATUS_TRANSITIONS[from];

  if (alcanzables.length === 0) {
    return `No se puede pasar de ${desde} a ${hasta}: ${desde} es un estado final y no admite ninguna transición.`;
  }

  const posibles = alcanzables.map((s) => USER_STATUS_LABELS[s]).join(', ');
  return `No se puede pasar de ${desde} a ${hasta}. Desde ${desde} solo se puede pasar a: ${posibles}.`;
}
