import { UserStatus } from '@prisma/client';

/**
 * BORRADO DE CUENTAS C1 — LA PUERTA DE ENTRADA, EN UN SOLO SITIO.
 *
 * EL DEFECTO QUE CIERRA, y no es el que parece. Hasta aquí, el estado de la cuenta
 * se comprobaba con **el mismo par de `if` copiado en tres sitios**
 * (`JwtStrategy.validate`, `AuthService.validateCredentials` y
 * `AuthService.loginWithGoogle`), más un cuarto sitio —`forgotPassword`— que **se
 * olvidó de comprobarlo**: un usuario suspendido o inhabilitado recibía el correo de
 * recuperación igual que cualquiera. Cuatro copias de una regla, una de ellas
 * ausente, es exactamente la forma que tiene este tipo de fallo.
 *
 * Es la lección que `VIGENTES` dejó escrita en `reviews.service.ts`: «escribir el
 * filtro cinco veces es cinco ocasiones de olvidarlo una, y el olvido no se ve». Aquí
 * el olvido se ve todavía menos, porque **falla hacia el lado peligroso**: quien no
 * debería entrar, entra.
 *
 * LA GARANTÍA REAL ESTÁ EN EL `switch` EXHAUSTIVO de abajo. Con `UserStatus` a punto
 * de crecer (ARCHIVED, DELETED, y lo que venga), lo que hace falta no es acordarse de
 * tocar tres ficheros: es que **no compile** hasta que alguien decida qué hace el
 * valor nuevo. El `never` del `default` lo garantiza en tiempo de compilación.
 *
 * Ver docs/diseno-borrado-cuentas.md §4.6 y §6.7.
 */

/**
 * Lo que las puertas necesitan saber de una cuenta.
 *
 * ── POR QUÉ ESTO PASÓ DE SER UN `UserStatus` SUELTO A UN OBJETO (C4) ────────
 *
 * Porque `SUSPENDED` dejó de ser una respuesta completa: una suspensión con
 * vencimiento pasado **ya no bloquea**, y para saberlo hace falta la fecha. Se
 * podría haber añadido un segundo parámetro opcional y dejar que los llamantes
 * viejos siguieran compilando — y habría sido un error: cada uno de ellos tiene
 * que **añadir `suspendedUntil` a su `select`**, y un parámetro opcional les
 * habría dejado seguir preguntando con media pregunta, devolviendo `undefined` y
 * bloqueando a alguien cuya suspensión ya caducó. Romper la firma obliga a
 * revisarlos todos, que es exactamente lo que se quiere.
 */
export interface EstadoDeCuenta {
  status: UserStatus;
  /**
   * Cuándo termina la suspensión. `null` = INDEFINIDA — que es lo que eran
   * todas antes de C4, y por eso el valor por defecto no cambia nada.
   *
   * Sólo significa algo con `status === SUSPENDED`. Una cuenta ARCHIVED puede
   * llevar una fecha guardada (C2 no la limpia al archivar, para no devolverle
   * una suspensión indefinida al desarchivarla) y **aquí no se mira**: el
   * archivado no caduca solo.
   */
  suspendedUntil?: Date | null;
}

/**
 * BORRADO DE CUENTAS C4 — ¿esta suspensión ya se ha cumplido?
 *
 * EL MECANISMO PEREZOSO, y el que de verdad manda: en cuanto pasa la fecha, la
 * cuenta entra **sin que nadie haya tocado nada**. El cron de las 07:00 no es la
 * fuente de verdad —sólo pone la fila al día para que la ficha no mienta—, así
 * que una suspensión de siete días termina a los siete días aunque el cron falle,
 * se retrase o no exista.
 *
 * Molde EXACTO, y en el mismo fichero de auth: `lockedUntil`, que se evalúa así
 * —comparando contra `now` en el momento de decidir, sin cron ni escritura— para
 * el bloqueo por intentos fallidos. Se reusa el patrón entero.
 *
 * `suspendedUntil == null` → NO caduca. Es la compatibilidad: las suspensiones
 * que existían antes de C4 no llevan fecha y siguen siendo indefinidas.
 */
export function suspensionYaCumplida(cuenta: EstadoDeCuenta): boolean {
  return (
    cuenta.status === UserStatus.SUSPENDED &&
    cuenta.suspendedUntil != null &&
    cuenta.suspendedUntil <= new Date()
  );
}

/**
 * El motivo por el que esta cuenta no puede usar la plataforma, de cara al usuario.
 * `null` cuando sí puede.
 *
 * Los mensajes de `SUSPENDED` y `BANNED` se mueven aquí **palabra por palabra** desde
 * los tres gates: esa parte no cambia de conducta.
 */
export function motivoDeBloqueoDeCuenta(cuenta: EstadoDeCuenta): string | null {
  // C4 — va ANTES del `switch` y no dentro del `case SUSPENDED`, para que el
  // switch siga siendo lo que es: una tabla exhaustiva de estados. La caducidad
  // no es un estado, es una condición sobre uno.
  if (suspensionYaCumplida(cuenta)) return null;

  switch (cuenta.status) {
    case UserStatus.ACTIVE:
      return null;

    case UserStatus.SUSPENDED:
      return 'Tu cuenta está suspendida. Contacta con soporte si crees que es un error.';

    case UserStatus.BANNED:
      return 'Tu cuenta ha sido inhabilitada permanentemente.';

    /**
     * ARCHIVADA — para su dueño, la cuenta ya no existe. El mensaje **no distingue
     * quién la archivó** (`archiveReason` lo sabe, pero es información de staff) y
     * apunta a soporte, que es el camino de vuelta real: desarchivar es una decisión
     * del equipo, no algo que se dispare escribiendo en un formulario.
     */
    case UserStatus.ARCHIVED:
      return 'Esta cuenta está archivada y no puede utilizarse. Si crees que es un error, contacta con soporte.';

    /**
     * ELIMINADA — la fila sigue ahí (la exigen doce `RESTRICT`, dos libros mayores y
     * el trigger fiscal), pero ya está vaciada de persona. No hay vuelta, y el
     * mensaje no ofrece una que no existe.
     */
    case UserStatus.DELETED:
      return 'Esta cuenta se ha eliminado definitivamente.';

    default: {
      // EL SEGURO. Si `UserStatus` gana un valor y nadie decide aquí qué hace,
      // esto deja de compilar. Es la única forma de que un estado nuevo no se
      // cuele por las cuatro puertas en silencio.
      const noContemplado: never = cuenta.status;
      return noContemplado;
    }
  }
}

/**
 * ¿Puede esta cuenta usar la plataforma?
 *
 * Mismo predicado que el de arriba, en la forma que necesitan los llamantes que no
 * enseñan el motivo — hoy `forgotPassword`, que no puede decir nada sin revelar el
 * estado de una cuenta ajena. **Derivado, no una segunda lista**: si divergieran,
 * uno de los dos dejaría entrar a quien el otro rechaza.
 */
export function cuentaPuedeAcceder(cuenta: EstadoDeCuenta): boolean {
  return motivoDeBloqueoDeCuenta(cuenta) === null;
}
