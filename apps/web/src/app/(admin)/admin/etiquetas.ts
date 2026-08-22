/**
 * TRADUCCIONES — LAS ETIQUETAS ES DE LOS ENUMS QUE CRUZAN PANTALLAS DEL BACKOFFICE.
 *
 * QUÉ DEFECTO CIERRA. Las dos fichas —la de anuncio (F1) y la de usuario (U3)—
 * pintaban catorce campos con el **valor crudo del enum**: «PRODUCT», «LIKE_NEW»,
 * «PROHIBITED_ITEM», «WAITING_USER», «USER_ROLE_CHANGE»… El backoffice está en
 * español desde el primer día y esos catorce eran el resto que quedaba en inglés.
 *
 * Y NO ES SÓLO TRADUCIR: es no abrir la tercera copia. Cuando esta ráfaga empezó,
 * `ReportReason` ya estaba escrito a mano DOS veces —`/admin/reportes` y
 * `/admin/usuarios`— y **ya habían divergido**: la copia de la lista de usuarios no
 * tiene `FAKE_REVIEW`, así que una denuncia de valoración se pintaba «FAKE_REVIEW»
 * en una pantalla y «Valoración falsa» en la otra. Añadir un tercer mapa dentro de
 * cada ficha habría sido repetir el defecto que `listing-status.ts` documenta haber
 * pagado ya una vez («`PAUSED` y `ARCHIVED` pintando el enum crudo hasta B2»).
 *
 * MOLDE: `anuncios/listing-status.ts` y `anuncios/listing-triage.ts` — módulo plano,
 * co-localizado, sin JSX y sin `'use client'`, con el mapa y su acceso tolerante.
 * Aquí sube un piso porque sus consumidores están en carpetas hermanas.
 *
 * ─── DE DÓNDE SALE CADA ETIQUETA ──────────────────────────────────────────────
 *
 * Ninguna se ha inventado. Cada mapa **copia literalmente** las etiquetas que el
 * repo ya usa en la pantalla donde ese enum se lee de cara al usuario, y el comentario
 * de cada uno dice cuál es. Es el requisito de coherencia: que el mismo valor no se
 * llame «Activo» en un sitio y «Publicado» en otro.
 *
 * ─── LO QUE ESTE MÓDULO **NO** HACE ───────────────────────────────────────────
 *
 * **No toca ningún valor.** El enum sigue siendo `NEW`/`ACTIVE`/`PROHIBITED_ITEM` en
 * Postgres, en la API y en los filtros de la URL. Esto es la capa de presentación y
 * sólo eso: cambia la ETIQUETA visible, nunca el dato. Los tests que afirman sobre el
 * valor —los filtros, los `aria-pressed`, los `PATCH`— no se enteran de este fichero.
 */

// La ÚNICA puerta de las etiquetas de `ListingStatus` en el backoffice sigue siendo
// `anuncios/listing-status.ts`: la lista y el panel de filtros ya la importan de allí
// y moverla habría sido churn sin beneficio. Se RE-EXPORTA (no se copia) para que
// «una etiqueta del backoffice se importa de `etiquetas.ts`» sea una regla sin
// excepciones. Sólo el par de etiquetas: `STATUS_VARIANTS`, `TARGET_STATUSES` y los
// `format*` son de la pantalla de anuncios y se quedan allí.
export { STATUS_LABELS, etiquetaDeEstado } from './anuncios/listing-status';

// `TicketStatus` ya tiene dueño único y con color: `TicketStatusBadge`, que la bandeja
// `/admin/tickets` y la zona de cuenta comparten. Se re-exporta su función por la misma
// razón que arriba — y por eso NO hay aquí ningún `ESTADO_TICKET_LABELS`.
export { ticketStatusLabel } from '@/components/tickets/TicketStatusBadge';

/**
 * EL ACCESO, con las dos caídas que las fichas ya escribían a mano en cada línea.
 *
 *   · valor ausente → `'—'`, que es lo que los dos `Dato` pintan para un campo vacío;
 *   · valor sin etiqueta → **el enum crudo**, no una cadena vacía. Es la regla de
 *     `listing-status.ts:52-54` («el enum crudo como último recurso visible»): un
 *     valor nuevo del enum tiene que verse FEO, no desaparecer. Un `?? ''` haría que
 *     añadir un `ReportReason` en el backend borrara el motivo de la pantalla sin que
 *     nada fallara.
 */
export function etiqueta(
  mapa: Record<string, string>,
  valor: string | null | undefined,
): string {
  if (!valor) return '—';
  return mapa[valor] ?? valor;
}

/** `ListingType`. Copiadas de `publicar/steps/StepDatos.tsx` (`TYPE_LABELS`), que es
 *  donde el vendedor las elige. En SINGULAR: el plural («Productos») es de las facetas
 *  de búsqueda y aquí se describe UN anuncio. */
export const TIPO_ANUNCIO_LABELS: Record<string, string> = {
  PRODUCT: 'Producto',
  SERVICE: 'Servicio',
};

/** `Condition`. Copiadas de `(public)/anuncio/[slug]/page.tsx`, y son las mismas que
 *  usan el panel de filtros y el wizard de publicar — comprador, vendedor y moderador
 *  leen ya lo mismo. */
export const CONDICION_LABELS: Record<string, string> = {
  NEW: 'Nuevo',
  LIKE_NEW: 'Como nuevo',
  GOOD: 'Buen estado',
  FAIR: 'Aceptable',
  FOR_PARTS: 'Para piezas',
};

/** `PriceType`. Las dos que ya tienen texto lo toman de `formatPrice`
 *  (`listing-status.ts`), que pinta «Gratis» y «A convenir» en la cabecera de esta
 *  misma ficha. `FIXED` no tenía etiqueta porque ahí se sustituye por el importe. */
export const TIPO_PRECIO_LABELS: Record<string, string> = {
  FIXED: 'Precio fijo',
  FREE: 'Gratis',
  NEGOTIABLE: 'A convenir',
};

/** `PriceUnit`. Copiadas de `PRICE_UNIT_LABELS` (`publicar/steps/StepDatos.tsx`), que
 *  a su vez ya declara ser las mismas del panel de categorías (RP.2). */
export const UNIDAD_PRECIO_LABELS: Record<string, string> = {
  ONE_TIME: 'Pago único',
  PER_MONTH: 'Al mes',
  PER_WEEK: 'A la semana',
  PER_DAY: 'Al día',
  PER_HOUR: 'Por hora',
  PER_UNIT: 'Por unidad',
  PER_SESSION: 'Por sesión',
};

/** `ReportReason`. Copiadas de `/admin/reportes` — la copia COMPLETA, la que sí tiene
 *  `FAKE_REVIEW`. Es la divergencia descrita en la cabecera. */
export const MOTIVO_REPORTE_LABELS: Record<string, string> = {
  SPAM: 'Spam',
  FRAUD: 'Fraude',
  INAPPROPRIATE: 'Inapropiado',
  PROHIBITED_ITEM: 'Artículo prohibido',
  WRONG_CATEGORY: 'Categoría incorrecta',
  FAKE_REVIEW: 'Valoración falsa',
  OTHER: 'Otro',
};

/** `ReportStatus`. Copiadas de `/admin/reportes`, donde además son las mismas que las
 *  de sus filtros («Pendientes», «Resueltos»…). */
export const ESTADO_REPORTE_LABELS: Record<string, string> = {
  PENDING: 'Pendiente',
  REVIEWING: 'En revisión',
  RESOLVED: 'Resuelto',
  DISMISSED: 'Desestimado',
};

/** `UserStatus`. Movidas TAL CUAL desde la ficha de usuario, que ya las tenía inline.
 *  Lo que cambia no es su texto: es que ahora la ficha de anuncio las alcanza. */
export const ESTADO_USUARIO_LABELS: Record<string, string> = {
  ACTIVE: 'Activo',
  SUSPENDED: 'Suspendido',
  BANNED: 'Baneado',
};

/** `Role`. Movidas TAL CUAL desde la ficha de usuario, por lo mismo.
 *
 *  NOTA — hay una divergencia PREEXISTENTE que esta ráfaga no toca: la LISTA
 *  `/admin/usuarios` dice `ADMIN: 'Admin'` y la ficha dice `'Administrador'`. Se
 *  conserva el texto de la ficha para que este cuerpo no cambie ni una etiqueta ya
 *  visible; unificar la lista es un cambio de su pantalla, no de ésta. */
export const ROL_LABELS: Record<string, string> = {
  USER: 'Usuario',
  MODERATOR: 'Moderador',
  EDITOR: 'Editor',
  ADMIN: 'Administrador',
};

/** `BumpScheduleStatus`. Nuevas — este enum no se pintaba en español en ninguna parte.
 *  El texto sigue el criterio de `estadoProgramacion` (`lib/api/bump-schedules.ts`),
 *  que ya explica cada pausa por su causa; aquí van en la forma corta que cabe en una
 *  línea de `Dato`. */
export const ESTADO_BUMP_LABELS: Record<string, string> = {
  ACTIVE: 'Activa',
  PAUSED_BY_USER: 'En pausa (por el usuario)',
  PAUSED_NO_FUNDS: 'En pausa (sin saldo)',
  PAUSED_LISTING_INACTIVE: 'En pausa (anuncio no activo)',
};

/**
 * `AuditLog.action` — el vocabulario de la auditoría, en español.
 *
 * VIVÍA EN LA FICHA DE ANUNCIO con sólo las siete `LISTING_*`, y la ficha de usuario
 * —que enseña las `USER_*` y las de Pro— pintaba el `action` crudo por no tenerlo a
 * mano. Sube aquí entero: las de anuncio, las de usuario y las de dinero.
 *
 * `resourceType` decide cuáles puede ver cada ficha (`Listing` en una, `User` en la
 * otra), así que ninguna pantalla usa el mapa completo — y está bien: el vocabulario
 * es uno solo aunque cada pantalla lea su parte.
 */
export const ACCION_LABELS: Record<string, string> = {
  // ── Sobre un anuncio (las que ya estaban en la ficha F1) ────────────────────
  LISTING_STATUS_CHANGE: 'Cambio de estado',
  LISTING_APPROVE: 'Aprobado',
  LISTING_REJECT: 'Rechazado',
  LISTING_DEACTIVATE: 'Desactivado',
  LISTING_RESTORE: 'Restaurado',
  LISTING_DELETE: 'Eliminado',
  // ETIQUETA INTERNA (P1) — sólo los cambios MANUALES llegan aquí. La transición
  // automática (REVIEWED→EDITED al editar el dueño) no deja registro, y su
  // «cuándo» se pinta en la insignia con `updatedAt`.
  LISTING_TRIAGE_CHANGE: 'Etiqueta interna',
  // P3a — el staff corrigió campos del anuncio. Se nombra distinto de un cambio
  // del dueño a propósito: el vendedor tiene que poder ver quién le tocó qué.
  LISTING_EDIT: 'Edición del equipo',

  // ── Sobre un usuario (M4 + U2) ──────────────────────────────────────────────
  USER_SUSPEND: 'Suspendido',
  USER_BAN: 'Baneado',
  USER_REINSTATE: 'Reactivado',
  USER_ROLE_CHANGE: 'Cambio de rol',
  USER_TRUST: 'Marcado de confianza',
  USER_UNTRUST: 'Retirada la confianza',
  USER_REQUIRE_REVIEW: 'Marcado para revisión previa',
  USER_UNREQUIRE_REVIEW: 'Retirada la revisión previa',
  // U2 — el Pro concedido a mano. Se dice «por el equipo» por lo mismo que
  // `LISTING_EDIT`: distinguirlo de un Pro de pago es la mitad del dato.
  PRO_GRANT: 'Pro concedido por el equipo',
  PRO_REVOKE: 'Pro revocado',

  // ── Sobre el monedero (U2) ──────────────────────────────────────────────────
  // Van sobre `resourceType: 'Wallet'`, así que hoy no los lee ninguna de las dos
  // fichas. Constan porque el vocabulario es uno y son de la misma ráfaga.
  ADMIN_CREDIT_GRANT: 'Créditos concedidos',
  ADMIN_CREDIT_DEBIT: 'Créditos retirados',
  ADMIN_BUMP_GRANT: 'Bumps concedidos',
  ADMIN_BUMP_DEBIT: 'Bumps retirados',
};

// ── Detección de contenido (punto 6) ──────────────────────────────────────────
//
// Los nombres dicen QUÉ SE BUSCA, no cómo. «Palabra de la lista» y no «WORD»; y
// sobre todo «Teléfono en el texto» y no «Teléfono» a secas: el anuncio TIENE un
// campo de teléfono legítimo (`Listing.phone`, servido tras login), así que lo que
// el aviso señala no es que haya un teléfono sino que está FUERA de su sitio.
// Llamarlo «Teléfono» leería como si publicarlo estuviera prohibido, y no lo está.
export const DETECTOR_LABELS: Record<string, string> = {
  WORD: 'Palabra de la lista',
  PHONE: 'Teléfono en el texto',
  // A1 — «IP: Dirección IP» estaba aquí. El detector de IPs sobre TEXTO se retiró: una IP en
  // una descripción suele ser producto (el router que documenta la suya), no señal. Lo que
  // sustituye a aquello no es un detector sino la lista de IPs marcadas, que mira la ÚLTIMA
  // IP y tiene su propio distintivo — no pasa por este vocabulario.
};

export const DETECTION_FIELD_LABELS: Record<string, string> = {
  TITLE: 'título',
  DESCRIPTION: 'descripción',
};
