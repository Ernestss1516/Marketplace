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
 * El motivo por el que esta cuenta no puede usar la plataforma, de cara al usuario.
 * `null` cuando sí puede.
 *
 * Los mensajes de `SUSPENDED` y `BANNED` se mueven aquí **palabra por palabra** desde
 * los tres gates: esta parte no cambia de conducta.
 */
export function motivoDeBloqueoDeCuenta(status: UserStatus): string | null {
  switch (status) {
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
      const noContemplado: never = status;
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
export function cuentaPuedeAcceder(status: UserStatus): boolean {
  return motivoDeBloqueoDeCuenta(status) === null;
}
