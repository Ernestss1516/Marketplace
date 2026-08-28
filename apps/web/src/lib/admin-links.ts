/**
 * LOS ENLACES DEL BACKOFFICE A SUS PROPIAS ENTIDADES, en un solo sitio.
 *
 * ─── LA REGLA, QUE ES LO QUE ESTE FICHERO EXISTE PARA GUARDAR ────────────────
 *
 * **Desde una pantalla de staff se enlaza a `/admin/*`, NUNCA a la ruta pública.**
 *
 * No es una preferencia de estilo. `/anuncio/{slug}` lanza 404 para todo lo que
 * no esté `ACTIVE`, y un anuncio denunciado, rechazado o en revisión —que es
 * justo el que un moderador abre— no lo está casi nunca. `/vendedor/{slug}` hace
 * lo propio con una cuenta suspendida o eliminada, y aunque cargue no enseña nada
 * de lo que el staff necesita: ni el historial, ni las denuncias, ni los tickets.
 *
 * ESTE DEFECTO YA SE DIAGNOSTICÓ Y SE ARREGLÓ UNA VEZ. La ficha F1 lo dejó
 * escrito para la cola de moderación: el enlace al anuncio apuntaba a la página
 * pública y «estaba roto el 100 % de las veces». Se corrigió ahí… y sobrevivió en
 * otros tres sitios, porque cada superficie escribía su URL a mano y no había
 * dónde apuntar la lección. Diecisiete plantillas sueltas, ninguna función.
 *
 * Es el mismo movimiento que `photo-limits.ts` con los topes de fotos y que
 * `lib/api/banners.ts` con las ubicaciones: cuando el mismo dato se escribe en N
 * sitios, la pregunta deja de ser «¿está bien?» y pasa a ser «¿están TODOS bien?»,
 * que nadie puede responder de memoria. Con una función, la pregunta vuelve a ser
 * de un vistazo.
 *
 * ─── CUÁNDO SÍ VALE LA RUTA PÚBLICA ─────────────────────────────────────────
 *
 * Cuando el staff quiere ver **lo que ve un visitante** — una comprobación
 * legítima y distinta. Para eso está `publicListingHref` / `publicSellerHref`,
 * que existen para que ese uso sea EXPLÍCITO y no un descuido: quien las llama
 * está diciendo «quiero la pública», y debe etiquetar el enlace como tal («Ver
 * como lo ve un visitante») y contar con que puede dar 404.
 *
 * ─── POR QUÉ POR `id` Y NO POR `slug` ───────────────────────────────────────
 *
 * Las rutas del backoffice son por `id` (`/admin/anuncios/[id]`,
 * `/admin/usuarios/[id]`): el `slug` es de la web pública y puede cambiar al
 * editar el título. Pedir `id` en la firma hace imposible el enlace de staff
 * construido con el identificador equivocado.
 */

/** Ficha de anuncio del backoffice. Muestra CUALQUIER estado, a diferencia de la pública. */
export function adminListingHref(id: string): string {
  return `/admin/anuncios/${id}`;
}

/** Ficha de usuario del backoffice: historial, denuncias, valoraciones y tickets. */
export function adminUserHref(id: string): string {
  return `/admin/usuarios/${id}`;
}

/** Hilo de soporte. */
export function adminTicketHref(id: string): string {
  return `/admin/tickets/${id}`;
}

/**
 * Ficha de una denuncia.
 *
 * Es la última de las cuatro en existir: hasta esta ráfaga no había pantalla a la
 * que apuntar, así que quien quería enlazar una denuncia concreta mandaba a la
 * lista entera y que el moderador la buscara.
 */
export function adminReportHref(id: string): string {
  return `/admin/reportes/${id}`;
}

/**
 * El hilo de una conversación, visto por el staff.
 *
 * CUELGA DE `/admin/anuncios/` A PROPÓSITO, no es un descuido de nomenclatura:
 * `canAccessAdminPath` es fail-closed ante una ruta sin sección, y una sección
 * propia obligaría a poner «Conversaciones» en el nav —el mapa prohíbe secciones
 * accesibles fuera de la barra—, lo que significaría un explorador global de
 * mensajería que el diseño descartó. Ver la cabecera de la propia página.
 */
export function adminConversationHref(id: string): string {
  return `/admin/anuncios/conversaciones/${id}`;
}

/** Anuncios del backoffice ya filtrados por vendedor. */
export function adminListingsBySellerHref(sellerId: string): string {
  return `/admin/anuncios?sellerId=${sellerId}`;
}

/**
 * La ficha PÚBLICA de un anuncio — 404 si no está `ACTIVE`.
 * Sólo para «ver como lo ve un visitante», y etiquetándolo así.
 */
export function publicListingHref(slug: string): string {
  return `/anuncio/${slug}`;
}

/**
 * El perfil PÚBLICO de un vendedor — 404 si la cuenta no está activa.
 * Sólo para «ver como lo ve un visitante», y etiquetándolo así.
 */
export function publicSellerHref(slug: string): string {
  return `/vendedor/${slug}`;
}
