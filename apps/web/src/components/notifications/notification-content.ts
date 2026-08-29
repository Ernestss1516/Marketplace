import type { NotificationItem } from '@/types';

/**
 * NOTIFICACIONES A1 — EL COLCHÓN QUE OCULTABA EL FALLO, CONVERTIDO EN BARRERA.
 *
 * ── QUÉ PASABA ──────────────────────────────────────────────────────────────
 *
 * El `switch` de abajo terminaba en un `default` que devolvía «Nueva
 * notificación» y un enlace a la propia lista. La cabecera de este fichero decía
 * «añade un `case` por cada tipo nuevo», y eso es todo lo que había: un recordatorio.
 *
 * Se olvidó DOS VECES, y las dos el colchón se tragó el fallo sin una queja —ni
 * en compilación, ni en tests, ni en runtime—. `INVOICING_PENDING_FISCAL_DATA`
 * estuvo así hasta que alguien lo vio a ojo; `DATA_EXPORT_READY`, hasta A1. En los
 * dos casos el usuario recibía un aviso sin texto y sin destino, sobre algo que sí
 * le importaba (una factura que no podía emitir, un ZIP que caduca).
 *
 * ── POR QUÉ UNA FUNCIÓN CON PARÁMETRO `never` Y NO UN `throw` ───────────────
 *
 * Porque hacen falta las dos cosas a la vez, y son distintas:
 *
 *   · **En compilación**: si un miembro de `NotificationItem` no tiene `case`, la
 *     llamada de abajo recibe ese miembro donde se espera `never` y **no compila**,
 *     nombrando el tipo que falta. «Acuérdate del case» pasa a ser «no compila si
 *     te olvidas», que es la diferencia entera.
 *
 *   · **En ejecución**: `Notification.type` es `String` en la base A PROPÓSITO
 *     (ver `schema.prisma`), justo para que añadir tipos no exija migración. La
 *     consecuencia es que en la tabla puede haber filas de un tipo ya retirado, que
 *     el compilador no conoce. Reventar la campana entera por una fila vieja sería
 *     cambiar un fallo silencioso por uno estridente. Aquí se degrada a un texto
 *     honesto — y sólo puede llegarse por ese camino, no por un `case` olvidado.
 */
function tipoNoContemplado(n: never): { text: string; href: string } {
  // `n` es `never` para el compilador, pero en ejecución es una fila real: sólo
  // llega aquí un `type` que ya no existe en el código. Se registra para que no
  // sea invisible, y se pinta algo que no miente.
  console.warn('Notificación de un tipo no contemplado:', (n as NotificationItem).type);
  return { text: 'Nueva notificación', href: '/notificaciones' };
}

/**
 * Renders a notification's text + link from its self-contained `data` snapshot
 * (no lookups).
 *
 * NO HACE FALTA ACORDARSE DE NADA: un tipo sin `case` no compila (ver
 * `tipoNoContemplado`), y los mapas por variante son `Record` completos, así que
 * un valor de `action` sin su texto tampoco.
 */
export function getNotificationContent(n: NotificationItem): { text: string; href: string } {
  switch (n.type) {
    case 'ALERT_MATCH':
      return {
        text: `Nuevo anuncio que coincide con tu alerta «${n.data.alertName}»: ${n.data.listingTitle}`,
        href: `/anuncio/${n.data.listingSlug}`,
      };
    case 'CONTACT_MESSAGE':
      return {
        text: `Nuevo mensaje de contacto de ${n.data.email}: «${n.data.extracto}»`,
        href: `/admin/mensajes-contacto/${n.data.messageId}`,
      };
    case 'REVIEW_REQUEST':
      return {
        text: `${n.data.otherUserName} cerró un trato contigo sobre «${n.data.listingTitle}». Puedes valorar si quieres.`,
        // target=otherUserId va en la URL porque el perfil público (GET /users/:slug)
        // no expone el id internamente — evita ensanchar esa respuesta pública
        // solo para este flujo; el id ya lo trae la propia notificación.
        href: `/vendedor/${n.data.otherUserSlug}?valorar=${encodeURIComponent(n.data.listingId ?? '')}&target=${encodeURIComponent(n.data.otherUserId)}`,
      };
    // RF.13 R4 — este tipo existía en el backend desde entonces pero NUNCA tuvo
    // su `case`: caía al default genérico "Nueva notificación", que ni decía de
    // qué iba ni llevaba a ninguna parte útil. Cerrado aquí (auditoría §1.3).
    case 'INVOICING_PENDING_FISCAL_DATA':
      return {
        text: `Tienes ${n.data.facturableCount} movimiento(s) facturable(s) del periodo ${n.data.periodKey}, pero faltan tus datos fiscales para emitir la factura.`,
        href: '/perfil/facturacion',
      };
    // Atención al usuario R4 — los tres se pintan desde el snapshot, sin ninguna
    // consulta: `extracto` ya viene acotado a 140 caracteres desde el servidor.
    case 'TICKET_MESSAGE':
      return {
        text: `Respuesta nueva en tu ticket «${n.data.subject}»: ${n.data.extracto}`,
        href: `/mis-tickets/${n.data.ticketId}`,
      };
    case 'TICKET_OPENED':
      return {
        text: `La administración ha abierto un hilo contigo: «${n.data.subject}» — ${n.data.extracto}`,
        href: `/mis-tickets/${n.data.ticketId}`,
      };
    case 'TICKET_STAFF_NEW':
      return {
        text: `${n.data.userName}${n.data.topic ? ` (${n.data.topic})` : ''}: «${n.data.subject}» — ${n.data.extracto}`,
        href: `/admin/tickets/${n.data.ticketId}`,
      };
    // ── Moderación (§14.5) ───────────────────────────────────────────────────
    case 'REPORT_RESOLVED':
      return {
        text:
          n.data.outcome === 'RESOLVED'
            ? `Hemos revisado tu denuncia sobre ${n.data.targetLabel} y hemos tomado medidas.`
            : `Hemos revisado tu denuncia sobre ${n.data.targetLabel} y no hemos encontrado motivo para actuar.`,
        // Solo hay a dónde ir si lo denunciado era un anuncio que sigue vivo.
        href: n.data.listingSlug ? `/anuncio/${n.data.listingSlug}` : '/notificaciones',
      };
    // A1 — `Record<…>` COMPLETO Y OBLIGATORIO, no un objeto literal suelto.
    //
    // Aquí faltaba `APPROVED`: cuatro acciones y tres claves. `{…}[n.data.action]`
    // devolvía `undefined` y el aviso de «tu anuncio ya está publicado» —el que M2
    // añadió justamente para romper el silencio tras la revisión— se pintaba vacío,
    // mientras el correo del mismo hecho salía correcto. Con el `Record` explícito,
    // una acción sin su texto no compila.
    case 'LISTING_MODERATED': {
      const texto: Record<typeof n.data.action, string> = {
        // Alineado con el asunto del correo («ya está publicado»), que es lo que
        // esta misma persona va a tener en la bandeja de entrada.
        APPROVED: `Tu anuncio «${n.data.listingTitle}» ya está publicado.`,
        REJECTED: `Tu anuncio «${n.data.listingTitle}» no ha pasado la revisión${n.data.reason ? `: ${n.data.reason}` : '.'}`,
        DEACTIVATED: `Hemos retirado tu anuncio «${n.data.listingTitle}»${n.data.reason ? `: ${n.data.reason}` : '.'}`,
        RESTORED: `Tu anuncio «${n.data.listingTitle}» vuelve a estar publicado.`,
      };
      return { text: texto[n.data.action], href: '/mis-anuncios' };
    }
    // A1 — EL AVISO QUE MENTÍA. Este `case` daba por hecho que toda moderación de
    // una valoración era una RETIRADA, y `editReview` —que la deja publicada— usaba
    // el mismo aviso: al autor se le decía que se la habían retirado «por incumplir
    // las normas» cuando seguía ahí. Cada acción dice ahora lo que de verdad pasó.
    case 'REVIEW_MODERATED': {
      const sobre = `${n.data.rating}★ sobre ${n.data.targetName}${n.data.listingTitle ? ` (${n.data.listingTitle})` : ''}`;
      // N2 — CON SU MOTIVO. El moderador lo escribe obligatoriamente desde 7b y
      // hasta ahora se tiraba: se retiraba lo que alguien había escrito y se le
      // comunicaba sin el porqué. Degradación limpia (molde `LISTING_MODERATED`) y
      // «Motivo:» como sufijo, igual que el correo, para que la frase se lea bien
      // con motivo y sin él sin tener que reescribirla dos veces.
      const motivo = n.data.reason ? ` Motivo: ${n.data.reason}` : '';
      const texto: Record<typeof n.data.action, string> = {
        RETIRED: `Hemos retirado tu valoración de ${sobre} por incumplir las normas.${motivo}`,
        EDITED: `Hemos editado tu valoración de ${sobre} por incumplir las normas. Sigue publicada.${motivo}`,
        // N4a — la otra mitad de la conversación. Sin motivo y sin disculpa: dice
        // que ha vuelto, que es el hecho que a su autor le faltaba.
        RESTORED: `Hemos revisado tu valoración de ${sobre} y vuelve a estar publicada.`,
      };
      return { text: texto[n.data.action], href: '/notificaciones' };
    }
    // Bump automático — la programación se ha parado y hace falta algo del usuario. La
    // salida depende de la razón: recargar saldo no es lo mismo que reactivar el anuncio,
    // así que cada una lleva a un sitio distinto. Sin este `case` el aviso se pintaría como
    // «Nueva notificación» y sería un callejón.
    case 'BUMP_AUTO_PAUSED':
      return n.data.reason === 'NO_FUNDS'
        ? {
            text: `Hemos pausado los bumps programados de «${n.data.listingTitle}»: te has quedado sin saldo. No se te ha cobrado nada.`,
            href: '/mis-creditos',
          }
        : {
            text: `Hemos pausado los bumps programados de «${n.data.listingTitle}» porque el anuncio ya no está activo. Se reanudarán si vuelves a activarlo.`,
            href: '/mis-anuncios',
          };
    // A1 — EL AVISO INVISIBLE. Existía desde C6 y nunca tuvo `case`, porque se
    // creaba con `prisma.notification.create()` directo y no llegó ni al registro
    // de tipos: salía como «Nueva notificación», sin decir qué era ni llevar a la
    // descarga. Y es de lo más importante que haya, porque **caduca**: por eso el
    // texto lleva la fecha y el enlace va a `/perfil`, donde está el botón que
    // descarga el ZIP (`ExportarDatosPanel`; no hay ruta propia, la descarga va con
    // el token y no con un href).
    case 'DATA_EXPORT_READY': {
      const caduca = new Date(n.data.expiresAt).toLocaleDateString('es-ES', {
        day: 'numeric',
        month: 'long',
      });
      const megas = (n.data.sizeBytes / (1024 * 1024)).toFixed(1);
      return {
        text: `Tu copia de datos ya está lista para descargar (${megas} MB). Estará disponible hasta el ${caduca}.`,
        href: '/perfil',
      };
    }
    /**
     * N2 — LAS DECISIONES SOBRE LA CUENTA, que hasta esta ráfaga no avisaban a
     * nadie: se cerraba la puerta de la cuenta de alguien sin una palabra.
     *
     * OJO CON LO QUE ESTE `case` ES Y NO ES. Para `SUSPENDED`, `BANNED` y
     * `ARCHIVED` la persona **no puede abrir la campana** —el gate la rechaza—, así
     * que esto no es el aviso: es la CONSTANCIA que se encuentra cuando vuelve. El
     * canal que le llega en el momento es el correo. Se pinta igual de bien porque
     * quien vuelve después de una sanción quiere encontrar el porqué.
     *
     * `reason` es siempre el motivo VISIBLE; la nota interna del staff no existe en
     * este tipo. Degradación limpia, molde `LISTING_MODERATED.reason`.
     */
    case 'ACCOUNT_MODERATED': {
      const motivo = n.data.reason ? ` Motivo: ${n.data.reason}` : '';
      const texto: Record<typeof n.data.action, string> = {
        SUSPENDED: `Hemos suspendido temporalmente tu cuenta.${motivo}`,
        UNSUSPENDED: 'Hemos levantado la suspensión de tu cuenta: ya puedes usarla con normalidad.',
        BANNED: `Hemos inhabilitado tu cuenta de forma permanente.${motivo}`,
        // La asimetría de `reinstateUser`, dicha también aquí: recuperar el acceso
        // no reactiva los anuncios, y quien no lo sepa creerá que está roto.
        REINSTATED:
          'Tu cuenta vuelve a estar activa. Tus anuncios NO se reactivan solos: los tienes ' +
          'en pausa esperándote en «Mis anuncios».',
        ARCHIVED: `Hemos archivado tu cuenta.${motivo}`,
        ROLE_CHANGED: `Hemos cambiado el rol de tu cuenta${n.data.newRole ? ` a ${n.data.newRole}` : ''}.${motivo}`,
      };
      // REINSTATED lleva a los anuncios porque ahí es donde tiene algo que hacer;
      // el resto, a la propia lista (no hay una página «tu cuenta» que explique una
      // sanción, y mandarle al perfil sería un callejón).
      return {
        text: texto[n.data.action],
        href: n.data.action === 'REINSTATED' ? '/mis-anuncios' : '/notificaciones',
      };
    }
    /**
     * N3 — EL CICLO DE VIDA DEL ANUNCIO, que era mudo.
     *
     * TODOS ENLAZAN A `/mis-anuncios` y ninguno a la ficha pública, a propósito:
     * `/anuncio/{slug}` sirve sólo los `ACTIVE`, y aquí casi ninguno lo está (un
     * caducado no, uno en cola tampoco, uno borrado ya no existe). Es la lección
     * de A1.2, donde el correo de valoraciones enlazaba un anuncio `SOLD` y daba
     * 404 siempre. Además `/mis-anuncios` es donde está la acción —renovar,
     * republicar—, así que es el destino útil y no sólo el seguro.
     */
    case 'LISTING_LIFECYCLE': {
      const titulo = `«${n.data.listingTitle}»`;
      const motivo = n.data.reason ? ` Motivo: ${n.data.reason}` : '';
      const texto: Record<typeof n.data.action, string> = {
        RECEIVED: `Hemos recibido tu anuncio ${titulo} y está en cola de revisión. Te avisamos en cuanto lo revisemos.`,
        // El PARA QUÉ del preaviso va en el texto: renovar ANTES conserva la
        // posición. Sin eso es una cuenta atrás sin salida.
        EXPIRING_SOON: `Tu anuncio ${titulo} caduca ${n.data.daysLeft === 1 ? 'mañana' : `en ${n.data.daysLeft} días`}. Renuévalo antes y seguirá donde está.`,
        // «No lo ha retirado nadie» es la frase que cierra el caso «desapareció y
        // no sé por qué»: lo primero que se piensa es que te lo han quitado.
        EXPIRED: `Tu anuncio ${titulo} ha caducado y ya no se ve. No lo ha retirado nadie: los anuncios caducan solos. Puedes volver a publicarlo.`,
        EDITED_BY_STAFF: `Hemos hecho cambios en tu anuncio ${titulo}. Sigue publicado.${motivo}`,
        DELETED_BY_STAFF: `Hemos eliminado tu anuncio ${titulo}.${motivo}`,
        FEATURED_EXPIRED: `Se ha acabado el destacado de tu anuncio ${titulo}. Sigue publicado, pero ya no aparece resaltado.`,
      };
      return { text: texto[n.data.action], href: '/mis-anuncios' };
    }
    /**
     * N4a — TE HAN VALORADO. El evento más notificable que quedaba sin cubrir:
     * alguien escribe públicamente sobre ti, queda en tu perfil y cuenta para tu
     * media, y no te enterabas.
     *
     * No lleva el comentario, sólo las estrellas: el texto se lee en el perfil, y
     * meterlo aquí convertiría el aviso en el contenido.
     */
    case 'REVIEW_RECEIVED': {
      const estrellas = `${n.data.rating} estrella${n.data.rating === 1 ? '' : 's'}`;
      const sobre = n.data.listingTitle ? ` sobre «${n.data.listingTitle}»` : '';
      return {
        text: `${n.data.authorName} te ha valorado con ${estrellas}${sobre}.`,
        // Al perfil del AUTOR cuando se puede (desde ahí se llega al trato y al
        // contexto); si su cuenta se vació, `authorSlug` es null y no se inventa un
        // enlace roto — es la lección de A1.2, aplicada por adelantado.
        href: n.data.authorSlug ? `/vendedor/${n.data.authorSlug}` : '/notificaciones',
      };
    }
    /**
     * N4b — MENSAJES SIN LEER. El primer aviso que es ESTADO y no historia: hay UNO
     * por conversación y su contador sube, en vez de uno por mensaje (que habría
     * convertido la campana en un chat roto).
     *
     * Por eso el texto lleva el NÚMERO: no dice «tienes un mensaje» tres veces,
     * dice «3 mensajes».
     */
    case 'MESSAGE_UNREAD': {
      const cuantos =
        n.data.unreadCount === 1
          ? '1 mensaje nuevo'
          : `${n.data.unreadCount} mensajes nuevos`;
      const sobre = n.data.listingTitle ? ` sobre «${n.data.listingTitle}»` : '';
      return {
        text: `${cuantos} de ${n.data.otherUserName}${sobre}: ${n.data.extracto}`,
        href: `/mensajes/${n.data.conversationId}`,
      };
    }
    default:
      // NO ES UN COLCHÓN: `tipoNoContemplado` recibe `never`, así que un tipo de
      // `NotificationItem` sin `case` rompe la compilación aquí mismo. Sólo se
      // alcanza en ejecución con una fila de un tipo ya retirado del código.
      return tipoNoContemplado(n);
  }
}
