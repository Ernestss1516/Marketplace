/**
 * MODERACIÓN M2 — QUÉ ENDPOINT USA EL BACKOFFICE PARA CADA CAMBIO DE ESTADO.
 *
 * EL DEFECTO QUE CIERRA. El backoffice cambiaba TODOS los estados con el mismo
 * endpoint genérico (`PATCH /admin/listings/:id/status`). Funcionaba —el anuncio
 * cambiaba de estado— y por eso nadie lo notaba, pero se saltaba en silencio lo
 * único que distingue a una acción de moderación de un cambio de estado
 * cualquiera:
 *
 *   · aprobar por la vía genérica NO registraba `LISTING_APPROVE` ni avisaba al
 *     vendedor de que su anuncio ya estaba publicado;
 *   · rechazar por la vía genérica NO avisaba de que no había pasado la revisión,
 *     y el motivo que el moderador escribía se quedaba en el registro genérico.
 *
 * Mientras a `PENDING_REVIEW` sólo se llegaba por una palabra prohibida esto era
 * un detalle. Con la moderación previa es el camino principal, así que el aviso
 * que no llega deja de ser una rareza y pasa a ser la experiencia normal de
 * cualquiera que publique en una rama moderada.
 *
 * LA REGLA, EN UNA FRASE: salir de `PENDING_REVIEW` hacia ACTIVE o REJECTED son
 * ACCIONES DE MODERACIÓN y tienen su endpoint; todo lo demás sigue siendo un
 * cambio de estado y sigue por el genérico.
 *
 * Se extrae a una función pura —y no se resuelve con dos `if` dentro del
 * componente— porque es una decisión con reglas, no un detalle de pintado: así
 * se puede probar sin montar la página entera.
 */
export type AccionDeEstado = 'approve' | 'reject' | 'generic';

export function elegirAccionDeEstado(origen: string, destino: string): AccionDeEstado {
  if (origen !== 'PENDING_REVIEW') return 'generic';
  if (destino === 'ACTIVE') return 'approve';
  if (destino === 'REJECTED') return 'reject';
  // `PENDING_REVIEW → DRAFT` (devolver al vendedor sin rechazar) es la tercera
  // salida que la máquina de estados admite, y NO tiene endpoint propio de
  // moderación: sigue por el genérico. Es también la salida que hace justo que
  // aprobar exija las reglas del anuncio — el moderador que se encuentra un
  // anuncio sin fotos no está atrapado.
  return 'generic';
}
