import { createHmac } from 'crypto';
import * as Sentry from '@sentry/nestjs';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job } from 'bullmq';
import { Resend } from 'resend';
import { QUEUE_NOTIFICATIONS } from '../queue.constants';
import { PrismaService } from '../../prisma/prisma.service';
import { categoriaDe, COLUMNA_POR_CATEGORIA, type EmailCategory } from '../email-categories';
import {
  NOTIFICATION_JOB,
  SendAlertEmailData,
  SendContactNotificationData,
  SendContactReplyData,
  SendResetEmailData,
  SendReviewRequestEmailData,
  SendAccountModeratedData,
  SendBumpAutoPausedData,
  SendListingLifecycleData,
  SendListingModeratedData,
  SendBalanceDebitedData,
  SendDataExportReadyData,
  SendInvoicingPendingData,
  SendMessageUnreadData,
  SendReviewReceivedData,
  SendTicketMessageData,
  SendTicketResolvedData,
  SendTicketStaffNotificationData,
  SendVerificationEmailData,
} from '../notification.types';

@Processor(QUEUE_NOTIFICATIONS)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);
  private readonly resend: Resend;
  private readonly from: string;
  private readonly appUrl: string;

  constructor(
    private readonly config: ConfigService,
    // N5 — para leer la preferencia de las INFORMATIVAS. Las críticas no llegan a
    // usarlo (ver `process`).
    private readonly prisma: PrismaService,
  ) {
    super();
    this.resend = new Resend(config.getOrThrow<string>('resend.apiKey'));
    this.from = config.getOrThrow<string>('resend.from');
    this.appUrl = config.get<string>('appUrl', 'http://localhost:3000');
  }

  /**
   * NOTIFICACIONES N5 — LA VÁLVULA, EN EL ÚNICO EMBUDO QUE HAY.
   *
   * ── POR QUÉ AQUÍ Y NO EN CADA EMISOR ───────────────────────────────────────
   *
   * Hay DIECISIETE sitios que encolan correo, en doce ficheros. Comprobar la
   * preferencia en cada uno sería repartir la decisión por todo el dominio y
   * confiar en que nadie se salte el paso — el mismo error de clase que A1 tuvo
   * que cerrar con `notification.create`. **Todo correo del sistema pasa por este
   * `process()`**, así que aquí la comprobación no se puede rodear: no hay que
   * acordarse de nada ni hace falta un test que vigile a los emisores.
   *
   * ── Y POR QUÉ ESTO NO CONTRADICE «EL PROCESSOR NO TOCA LA BASE» ────────────
   *
   * En N4b se sacó a una cola aparte una comprobación que era **de negocio**
   * («¿ha leído ya?»), para que este procesador siguiera siendo sólo un
   * remitente. Ésta es de otra naturaleza: es **política de entrega** —«¿esta
   * persona quiere este correo?»—, que es precisamente lo que decide un
   * remitente. La consulta es una lectura de una bandera, no una regla del
   * dominio.
   *
   * ── LA FRONTERA ────────────────────────────────────────────────────────────
   *
   * `categoriaDe()` devuelve `null` para las CRÍTICAS, y el `return` de abajo corta
   * antes de tocar la base. Una sanción, un baneo o un débito de saldo **no llegan
   * a consultar ninguna preferencia**: no es que se consulte y se ignore.
   */
  async process(job: Job): Promise<void> {
    const categoria = categoriaDe(job.name, job.data as Record<string, unknown>);
    if (categoria !== null && !(await this.quiereRecibir(job.data, categoria))) {
      this.logger.debug(`Correo ${job.name} omitido: el destinatario apagó ${categoria}`);
      return;
    }

    /**
     * EL PIE DE BAJA, sólo en las informativas.
     *
     * Es lo que los proveedores de correo esperan y lo que separa un aviso
     * transaccional de algo que parece publicidad. Se calcula aquí, en el mismo
     * sitio que decide la categoría, para que no haya que acordarse de añadirlo en
     * cada copy — y para que las críticas NO lo lleven: ofrecer «date de baja» al
     * pie de un baneo sería ofrecer algo que no se puede hacer.
     */
    this.pieDeBaja = categoria ? await this.construirPieDeBaja(job.data, categoria) : '';

    try {
      switch (job.name) {
        case NOTIFICATION_JOB.SEND_VERIFICATION_EMAIL:
          return this.sendVerificationEmail(job.data as SendVerificationEmailData);
        case NOTIFICATION_JOB.SEND_RESET_EMAIL:
          return this.sendResetEmail(job.data as SendResetEmailData);
        case NOTIFICATION_JOB.SEND_ALERT_EMAIL:
          return this.sendAlertEmail(job.data as SendAlertEmailData);
        case NOTIFICATION_JOB.SEND_CONTACT_NOTIFICATION:
          return this.sendContactNotification(job.data as SendContactNotificationData);
        case NOTIFICATION_JOB.SEND_CONTACT_REPLY:
          return this.sendContactReply(job.data as SendContactReplyData);
        case NOTIFICATION_JOB.SEND_REVIEW_REQUEST_EMAIL:
          return this.sendReviewRequestEmail(job.data as SendReviewRequestEmailData);
        case NOTIFICATION_JOB.SEND_TICKET_MESSAGE:
          return this.sendTicketMessage(job.data as SendTicketMessageData);
        case NOTIFICATION_JOB.SEND_TICKET_STAFF_NOTIFICATION:
          return this.sendTicketStaffNotification(job.data as SendTicketStaffNotificationData);
        case NOTIFICATION_JOB.SEND_TICKET_RESOLVED:
          return this.sendTicketResolved(job.data as SendTicketResolvedData);
        case NOTIFICATION_JOB.SEND_LISTING_MODERATED:
          return this.sendListingModerated(job.data as SendListingModeratedData);
        case NOTIFICATION_JOB.SEND_BUMP_AUTO_PAUSED:
          return this.sendBumpAutoPaused(job.data as SendBumpAutoPausedData);
        case NOTIFICATION_JOB.SEND_ACCOUNT_MODERATED:
          return this.sendAccountModerated(job.data as SendAccountModeratedData);
        case NOTIFICATION_JOB.SEND_LISTING_LIFECYCLE:
          return this.sendListingLifecycle(job.data as SendListingLifecycleData);
        case NOTIFICATION_JOB.SEND_REVIEW_RECEIVED:
          return this.sendReviewReceived(job.data as SendReviewReceivedData);
        case NOTIFICATION_JOB.SEND_MESSAGE_UNREAD:
          return this.sendMessageUnread(job.data as SendMessageUnreadData);
        case NOTIFICATION_JOB.SEND_DATA_EXPORT_READY:
          return this.sendDataExportReady(job.data as SendDataExportReadyData);
        case NOTIFICATION_JOB.SEND_INVOICING_PENDING:
          return this.sendInvoicingPending(job.data as SendInvoicingPendingData);
        case NOTIFICATION_JOB.SEND_BALANCE_DEBITED:
          return this.sendBalanceDebited(job.data as SendBalanceDebitedData);
        default:
          this.logger.warn(`Unknown notification job: ${job.name}`);
      }
    } catch (err) {
      Sentry.captureException(err);
      throw err;
    }
  }

  /**
   * ¿Quiere esta persona los correos de esta categoría?
   *
   * SÓLO SE LLAMA PARA LAS INFORMATIVAS (ver `process`). Todas ellas llevan el
   * destinatario en `data.email`, que es único en `User`.
   *
   * FALLA HACIA EL LADO SEGURO: si no se encuentra al usuario —un correo a alguien
   * que no está registrado, una fila borrada entre el encolado y el envío—, se
   * MANDA. Un correo de más es molesto; uno de menos, por un `null` inesperado, es
   * un aviso perdido sin que nadie se entere.
   */
  /**
   * El pie que se añade a los correos informativos. Vacío en los críticos.
   *
   * Campo de instancia y no un parámetro que haya que enhebrar por los quince
   * métodos de envío: se fija en `process()` justo antes de despachar, y el worker
   * atiende un trabajo cada vez (BullMQ no reentra en el mismo `process`), así que
   * no hay dos correos compartiéndolo.
   */
  private pieDeBaja = '';

  /**
   * EL ÚNICO SITIO QUE MANDA UN CORREO — y por eso el pie de baja no se puede
   * olvidar en ninguno.
   *
   * Los dieciocho envíos del processor pasan por aquí. Añadir el pie en cada copy
   * habría sido dieciocho ocasiones de olvidarlo una, y el olvido no se ve: el
   * correo sale perfecto, sólo que sin la salida que la entregabilidad exige. Es
   * el mismo movimiento que `admin-links.ts` con las URL y que `createNotification`
   * con el buzón.
   *
   * `pieDeBaja` lo fija `process()` según la categoría: **vacío en las críticas**,
   * porque ofrecer «date de baja» al pie de un baneo sería ofrecer algo que no se
   * puede hacer.
   */
  private async enviar(mensaje: {
    from?: string;
    to: string;
    subject: string;
    text: string;
  }): Promise<void> {
    await this.resend.emails.send({
      from: this.from,
      to: mensaje.to,
      subject: mensaje.subject,
      text: `${mensaje.text}${this.pieDeBaja}`,
    });
  }

  private async construirPieDeBaja(
    data: unknown,
    categoria: EmailCategory,
  ): Promise<string> {
    const email = (data as { email?: string }).email;
    if (!email) return '';

    const usuario = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!usuario) return '';

    const firma = createHmac('sha256', this.config.getOrThrow<string>('jwt.secret'))
      .update(`${usuario.id}:${categoria}`)
      .digest('hex');

    return (
      `\n\n—\nSi no quieres recibir estos avisos, date de baja aquí:\n` +
      `${this.appUrl}/baja?u=${usuario.id}&c=${categoria}&t=${firma}`
    );
  }

  private async quiereRecibir(
    data: unknown,
    categoria: EmailCategory,
  ): Promise<boolean> {
    const email = (data as { email?: string }).email;
    if (!email) return true;

    const usuario = await this.prisma.user.findUnique({
      where: { email },
      select: { [COLUMNA_POR_CATEGORIA[categoria]]: true },
    });
    if (!usuario) return true;

    return (usuario as unknown as Record<string, boolean>)[
      COLUMNA_POR_CATEGORIA[categoria]
    ];
  }

  private async sendVerificationEmail(data: SendVerificationEmailData): Promise<void> {
    const link = `${this.appUrl}/verificar-email?token=${data.token}`;
    await this.enviar({
      from: this.from,
      to: data.email,
      subject: 'Confirma tu email',
      text: `Hola ${data.name},\n\nConfirma tu cuenta haciendo clic en este enlace (válido 24h):\n${link}\n\nSi no has creado una cuenta, ignora este email.`,
    });
    this.logger.log(`Verification email sent to ${data.email}`);
  }

  private async sendResetEmail(data: SendResetEmailData): Promise<void> {
    const link = `${this.appUrl}/restablecer?token=${data.token}`;
    await this.enviar({
      from: this.from,
      to: data.email,
      subject: 'Restablece tu contraseña',
      text: `Hola ${data.name},\n\nRestablece tu contraseña haciendo clic en este enlace (válido 1h):\n${link}\n\nSi no solicitaste esto, ignora este email.`,
    });
    this.logger.log(`Reset email sent to ${data.email}`);
  }

  private async sendAlertEmail(data: SendAlertEmailData): Promise<void> {
    const link = `${this.appUrl}/anuncio/${data.listingSlug}`;
    await this.enviar({
      from: this.from,
      to: data.email,
      subject: `Nuevo anuncio para tu alerta "${data.alertName}"`,
      text: `Hola ${data.name},\n\nHay un nuevo anuncio que coincide con tu alerta "${data.alertName}":\n${data.listingTitle}\n\nVerlo aquí:\n${link}`,
    });
    this.logger.log(`Alert email sent to ${data.email}`);
  }

  /** text: plano SIEMPRE (RC.1, defensa XSS) — el mensaje lo escribe un
   * desconocido y lo lee el admin; nunca se genera HTML a partir de su contenido. */
  private async sendContactNotification(data: SendContactNotificationData): Promise<void> {
    const link = `${this.appUrl}/admin/mensajes-contacto/${data.messageId}`;
    await this.enviar({
      from: this.from,
      to: data.adminEmail,
      subject: `Nuevo mensaje de contacto (${data.motivo})`,
      text: `Hola ${data.adminName},\n\nHa llegado un nuevo mensaje de contacto de ${data.remitenteEmail}:\n\n"${data.extracto}"\n\nVerlo y responder aquí:\n${link}`,
    });
    this.logger.log(`Contact notification email sent to ${data.adminEmail}`);
  }

  /** text: plano — asunto/cuerpo los escribe el admin (autor de confianza),
   * pero se mantiene el mismo patrón que el resto de la cola por consistencia. */
  private async sendContactReply(data: SendContactReplyData): Promise<void> {
    await this.enviar({
      from: this.from,
      to: data.to,
      subject: data.asunto,
      text: data.cuerpo,
    });
    this.logger.log(`Contact reply email sent to ${data.to}`);
  }

  // ─── Atención al usuario R4 ─────────────────────────────────────────────────
  // `text:` plano, nunca `html:` — la regla invariante de este processor. Aquí
  // importa especialmente: el asunto y el extracto de un ticket los escribe un
  // usuario cualquiera, y los lee un agente con sesión. Nunca se genera HTML a
  // partir de contenido no confiable, así que no hace falta sanitizado.

  /** Cierre común: el email avisa, no es el canal. Ver §11 del diseño. */
  private readonly noReply =
    'No respondas a este correo: responde desde tu ticket en el enlace de arriba.';

  /**
   * Al usuario — el staff respondió (o abrió el hilo). Lleva EXTRACTO + ENLACE,
   * jamás la conversación: quien quiera leerla entra. Molde exacto de
   * SEND_CONTACT_NOTIFICATION, que ya hacía esto.
   */
  private async sendTicketMessage(data: SendTicketMessageData): Promise<void> {
    const link = `${this.appUrl}/mis-tickets/${data.ticketId}`;
    const encabezado = data.opened
      ? 'La administración ha abierto un hilo contigo'
      : 'Tienes una respuesta nueva en tu ticket';
    await this.enviar({
      from: this.from,
      to: data.email,
      subject: `${encabezado}: ${data.subject}`,
      text:
        `Hola ${data.name},\n\n${encabezado} «${data.subject}»:\n\n"${data.extracto}"\n\n` +
        `Léelo y responde aquí:\n${link}\n\n${this.noReply}`,
    });
    this.logger.log(`Ticket message email sent to ${data.email}`);
  }

  /**
   * Al buzón de soporte — UNO SOLO, no un email por administrador (§14.4). El
   * aviso in-app sí es fan-out; el correo no, porque no escala con el volumen de
   * tickets que se espera.
   */
  private async sendTicketStaffNotification(data: SendTicketStaffNotificationData): Promise<void> {
    const link = `${this.appUrl}/admin/tickets/${data.ticketId}`;
    const encabezado = data.kind === 'new' ? 'Nuevo ticket' : 'Respuesta del usuario';
    await this.enviar({
      from: this.from,
      to: data.to,
      subject: `${encabezado}: ${data.subject}`,
      text:
        `${encabezado} de ${data.userName} — «${data.subject}»:\n\n"${data.extracto}"\n\n` +
        `Atenderlo aquí:\n${link}`,
    });
    this.logger.log(`Ticket staff notification email sent to ${data.to}`);
  }

  /** Al usuario — su ticket se ha resuelto. Explica la ventana de reapertura. */
  /**
   * Bump automático parado. Va por email además de in-app (D6) porque el usuario puede tardar
   * días en abrir la web y, mientras tanto, su anuncio no se está subiendo — que es
   * justamente lo que había contratado.
   */
  private async sendBumpAutoPaused(data: SendBumpAutoPausedData): Promise<void> {
    const link = `${this.appUrl}/mis-anuncios`;
    const [motivo, salida] =
      data.reason === 'NO_FUNDS'
        ? [
            'te has quedado sin saldo para seguir subiéndolo',
            `Recarga créditos o bumps y vuelve a activarla cuando quieras:\n${this.appUrl}/mis-creditos`,
          ]
        : [
            'el anuncio ya no está activo',
            `Si vuelves a activarlo, la programación se reanuda sola:\n${link}`,
          ];

    await this.enviar({
      from: this.from,
      to: data.email,
      subject: `Hemos pausado los bumps programados de «${data.listingTitle}»`,
      text:
        `Hola ${data.name},\n\nHemos pausado la subida automática de «${data.listingTitle}» porque ${motivo}.\n\n` +
        `No se te ha cobrado nada por este intento.\n\n${salida}\n\n${this.noReply}`,
    });
    this.logger.log(`Bump auto paused email sent to ${data.email} (${data.reason})`);
  }

  private async sendTicketResolved(data: SendTicketResolvedData): Promise<void> {
    const link = `${this.appUrl}/mis-tickets/${data.ticketId}`;
    await this.enviar({
      from: this.from,
      to: data.email,
      subject: `Tu ticket se ha resuelto: ${data.subject}`,
      text:
        `Hola ${data.name},\n\nHemos marcado como resuelto tu ticket «${data.subject}».\n\n` +
        `Si el problema sigue, tienes ${data.reopenWindowDays} días para reabrirlo respondiendo ` +
        `en el hilo:\n${link}\n\nPasado ese plazo tendrás que abrir uno nuevo.\n\n${this.noReply}`,
    });
    this.logger.log(`Ticket resolved email sent to ${data.email}`);
  }

  /**
   * Moderación (§14.5) — al vendedor. `text:` plano como todos: el `reason` lo
   * escribe un moderador, pero se mantiene la regla invariante del processor.
   *
   * Copy sin acusación: la moderación puede equivocarse (de hecho `restoreListing`
   * existe justo para deshacerla), así que el correo dice QUÉ ha pasado y CÓMO
   * seguir, no sentencia sobre la conducta del vendedor.
   */
  private async sendListingModerated(data: SendListingModeratedData): Promise<void> {
    const link = `${this.appUrl}/mis-anuncios`;
    const motivo = data.reason ? `\n\nMotivo indicado: ${data.reason}` : '';

    // A1 — `Record<…>` EXPLÍCITO, no un objeto suelto: si a `action` se le añade un
    // valor y aquí no se le da su copy, esto deja de compilar. Es la misma barrera
    // que se puso en el front, donde el mapa gemelo se quedó sin la rama `APPROVED`
    // y el aviso in-app salía vacío mientras este correo sí se mandaba bien.
    const copy: Record<
      SendListingModeratedData['action'],
      { subject: string; cuerpo: string }
    > = {
      // MODERACIÓN M2 — el aviso que faltaba. Hasta aquí, un anuncio aprobado se
      // publicaba sin que a su dueño le llegara nada: con la moderación previa
      // encendida, pasar por revisión deja de ser la excepción y el silencio se
      // convierte en «mi anuncio lleva días sin aparecer… ¿o ya está?».
      APPROVED: {
        subject: `Tu anuncio "${data.listingTitle}" ya está publicado`,
        cuerpo:
          `Hemos revisado tu anuncio «${data.listingTitle}» y ya está publicado en el ` +
          `marketplace.\n\nPuedes verlo aquí:\n${link}`,
      },
      REJECTED: {
        subject: `Tu anuncio "${data.listingTitle}" no ha pasado la revisión`,
        cuerpo:
          `Hemos revisado tu anuncio «${data.listingTitle}» y de momento no podemos publicarlo.${motivo}\n\n` +
          `Puedes editarlo y volver a enviarlo desde aquí:\n${link}`,
      },
      DEACTIVATED: {
        subject: `Hemos retirado tu anuncio "${data.listingTitle}"`,
        cuerpo:
          `Hemos retirado del marketplace tu anuncio «${data.listingTitle}».${motivo}\n\n` +
          `Puedes revisarlo desde aquí:\n${link}\n\nSi crees que es un error, escríbenos y lo miramos.`,
      },
      RESTORED: {
        subject: `Tu anuncio "${data.listingTitle}" vuelve a estar publicado`,
        cuerpo:
          `Buenas noticias: hemos revisado tu anuncio «${data.listingTitle}» y vuelve a estar ` +
          `publicado en el marketplace.\n\nPuedes verlo aquí:\n${link}`,
      },
    };
    const { subject, cuerpo } = copy[data.action];

    await this.enviar({
      from: this.from,
      to: data.email,
      subject,
      text: `Hola ${data.name},\n\n${cuerpo}`,
    });
    this.logger.log(`Listing moderated email (${data.action}) sent to ${data.email}`);
  }

  /**
   * NOTIFICACIONES N2 — LA DECISIÓN SOBRE LA CUENTA. **El único canal que le llega.**
   *
   * Un `SUSPENDED`, un `BANNED` y un `ARCHIVED` no pueden entrar, así que no hay
   * campana que puedan abrir: si este correo no sale, se enteran chocando contra el
   * login. De ahí que en N2 no sea opcional.
   *
   * ── EL REGISTRO DEL COPY ────────────────────────────────────────────────────
   *
   * El mismo que `sendListingModerated` dejó fijado y por la misma razón: **dice QUÉ
   * ha pasado y CÓMO seguir, no sentencia sobre la conducta**. La moderación puede
   * equivocarse —`unsuspend` y `reinstate` existen justo para deshacerla—, y un
   * correo que acusa convierte un error reversible en una afrenta. Todos ofrecen la
   * salida real: soporte.
   *
   * `motivo` es el VISIBLE. La nota interna no llega hasta aquí:
   * `SendAccountModeratedData` no tiene campo para ella.
   *
   * `text:` plano como todo el processor, y aquí importa especialmente: `reason` lo
   * escribe un moderador y lo lee el sancionado.
   */
  private async sendAccountModerated(data: SendAccountModeratedData): Promise<void> {
    const soporte = `Si crees que es un error, escríbenos desde ${this.appUrl}/contacto y lo revisamos.`;
    const motivo = data.reason ? `\n\nMotivo: ${data.reason}` : '';

    // Record EXHAUSTIVO (la red de A1): una acción sin copy no compila.
    const copy: Record<SendAccountModeratedData['action'], { subject: string; cuerpo: string }> = {
      SUSPENDED: {
        subject: 'Hemos suspendido temporalmente tu cuenta',
        cuerpo:
          `Hemos suspendido tu cuenta de forma temporal, así que de momento no podrás entrar.${motivo}\n\n` +
          (data.suspendedUntil
            ? `La suspensión termina el ${this.fecha(data.suspendedUntil)} y tu cuenta se reactiva sola: no tienes que hacer nada.`
            : 'La suspensión no tiene fecha de fin por ahora.') +
          `\n\n${soporte}`,
      },
      UNSUSPENDED: {
        subject: 'Tu cuenta vuelve a estar activa',
        cuerpo:
          'Hemos levantado la suspensión de tu cuenta: ya puedes entrar y usarla con normalidad.\n\n' +
          'Tus anuncios siguen como estaban.',
      },
      BANNED: {
        subject: 'Hemos inhabilitado tu cuenta',
        cuerpo:
          `Hemos inhabilitado tu cuenta de forma permanente y ya no podrás entrar.${motivo}\n\n` +
          `Tus anuncios se han retirado del marketplace.\n\n${soporte}`,
      },
      /**
       * LA ASIMETRÍA DE `reinstateUser`, DICHA EN VOZ ALTA. Es la razón de que este
       * texto sea distinto del de `UNSUSPENDED`: levantar un ban devuelve el ACCESO,
       * pero **NO reactiva los anuncios** —los pausó la sanción y los reactiva su
       * dueño, uno a uno, porque «una sanción no se deshace sola»—. Sin decirlo,
       * quien vuelve encuentra su escaparate vacío y da por hecho que la plataforma
       * está rota o que sigue sancionado.
       */
      REINSTATED: {
        subject: 'Tu cuenta vuelve a estar activa',
        cuerpo:
          'Hemos revisado tu caso y tu cuenta vuelve a estar activa: ya puedes entrar.\n\n' +
          'IMPORTANTE: tus anuncios NO se reactivan solos. Se quedaron en pausa y los tienes ' +
          `esperándote en ${this.appUrl}/mis-anuncios — desde ahí puedes volver a activarlos ` +
          'cuando quieras.',
      },
      ARCHIVED: {
        subject: 'Hemos archivado tu cuenta',
        cuerpo:
          'Hemos archivado tu cuenta, así que ya no podrás entrar y tus anuncios han salido ' +
          `del marketplace.${motivo}\n\n${soporte}`,
      },
      ROLE_CHANGED: {
        subject: 'Hemos cambiado los permisos de tu cuenta',
        cuerpo:
          `Hemos cambiado el rol de tu cuenta${data.newRole ? ` a ${data.newRole}` : ''}.${motivo}\n\n` +
          // Se avisa del efecto porque, si no, el siguiente clic es un 401 sin
          // explicación: el cambio de rol invalida todas las sesiones a propósito.
          'Por seguridad hemos cerrado tus sesiones abiertas: vuelve a iniciar sesión en ' +
          `${this.appUrl}/login.`,
      },
      // Terminal, y el ÚNICO canal posible: eliminar la cuenta borra sus
      // notificaciones, así que un aviso in-app se destruiría a sí mismo.
      DELETED: {
        subject: 'Tu cuenta se ha eliminado definitivamente',
        cuerpo:
          'Hemos eliminado tu cuenta y los datos personales asociados. Esta acción no tiene ' +
          `vuelta atrás y no hace falta que hagas nada más.${motivo}`,
      },
    };
    const { subject, cuerpo } = copy[data.action];

    await this.enviar({
      from: this.from,
      to: data.email,
      subject,
      text: `Hola ${data.name},\n\n${cuerpo}`,
    });
    this.logger.log(`Account moderated email (${data.action}) sent to ${data.email}`);
  }

  /**
   * NOTIFICACIONES N3 — el ciclo de vida del anuncio.
   *
   * Mismo registro que `sendListingModerated`, y aquí es todavía más importante:
   * la mitad de estos avisos **no los provoca nadie** (los manda un cron), así que
   * el correo tiene que explicar qué ha pasado y ofrecer la salida sin dar a
   * entender que el vendedor ha hecho algo mal. Ninguno acusa; los dos que sí son
   * decisiones del staff (`EDITED_BY_STAFF`, `DELETED_BY_STAFF`) dicen qué se hizo
   * y con qué motivo, y dejan abierta la puerta de soporte.
   */
  private async sendListingLifecycle(data: SendListingLifecycleData): Promise<void> {
    const link = `${this.appUrl}/mis-anuncios`;
    const motivo = data.reason ? `\n\nMotivo indicado: ${data.reason}` : '';
    const titulo = data.listingTitle;

    // Record EXHAUSTIVO (la red de A1): una acción sin copy no compila.
    const copy: Record<SendListingLifecycleData['action'], { subject: string; cuerpo: string }> = {
      EXPIRING_SOON: {
        subject: `Tu anuncio "${titulo}" caduca pronto`,
        cuerpo:
          `Tu anuncio «${titulo}» caduca ${data.daysLeft === 1 ? 'mañana' : `en ${data.daysLeft} días`} ` +
          `y dejará de verse en el marketplace.\n\n` +
          // El PARA QUÉ del preaviso, dicho: renovar antes de caducar conserva la
          // posición; renovar después es volver a empezar.
          `Si lo renuevas antes de que caduque, sigue donde está:\n${link}`,
      },
      EXPIRED: {
        subject: `Tu anuncio "${titulo}" ha caducado`,
        cuerpo:
          `Tu anuncio «${titulo}» ha caducado y ya no se ve en el marketplace. No lo ha ` +
          `retirado nadie: los anuncios caducan solos pasado un tiempo.\n\n` +
          `Puedes volver a publicarlo cuando quieras desde aquí:\n${link}`,
      },
      EDITED_BY_STAFF: {
        subject: `Hemos editado tu anuncio "${titulo}"`,
        cuerpo:
          `Hemos hecho cambios en tu anuncio «${titulo}». Sigue publicado.${motivo}\n\n` +
          `Puedes verlo y volver a editarlo aquí:\n${link}\n\n` +
          `Si crees que es un error, escríbenos y lo miramos.`,
      },
      DELETED_BY_STAFF: {
        subject: `Hemos eliminado tu anuncio "${titulo}"`,
        cuerpo:
          `Hemos eliminado tu anuncio «${titulo}» del marketplace. Esta acción no tiene ` +
          `vuelta atrás.${motivo}\n\n` +
          `Si crees que es un error, escríbenos y lo miramos.`,
      },
    };
    const { subject, cuerpo } = copy[data.action];

    await this.enviar({
      from: this.from,
      to: data.email,
      subject,
      text: `Hola ${data.name},\n\n${cuerpo}`,
    });
    this.logger.log(`Listing lifecycle email (${data.action}) sent to ${data.email}`);
  }

  /**
   * NOTIFICACIONES N4a — te han valorado.
   *
   * SIN PEDIR NADA A CAMBIO: no invita a responder (no se puede: el sistema no
   * tiene respuestas a valoraciones), ni a devolver la valoración, ni sugiere que
   * haya que hacer algo con una nota baja. Dice qué ha pasado y dónde verlo. Es el
   * mismo registro que el resto del processor, y aquí importa porque una
   * valoración es un juicio ajeno: un correo que empujara a reaccionar convertiría
   * un aviso en una provocación.
   */
  private async sendReviewReceived(data: SendReviewReceivedData): Promise<void> {
    const link = `${this.appUrl}/vendedor/${data.targetSlug}`;
    const sobre = data.listingTitle ? ` sobre «${data.listingTitle}»` : '';

    await this.enviar({
      from: this.from,
      to: data.email,
      subject: `${data.authorName} te ha valorado`,
      text:
        `Hola ${data.name},\n\n${data.authorName} te ha dejado una valoración de ` +
        `${data.rating} estrella${data.rating === 1 ? '' : 's'}${sobre}.\n\n` +
        `Puedes leerla en tu perfil:\n${link}`,
    });
    this.logger.log(`Review received email sent to ${data.email}`);
  }

  /**
   * NOTIFICACIONES N4b — «tienes N mensajes sin leer», tras la ventana de gracia.
   *
   * CUANDO LLEGA AQUÍ YA ESTÁ DECIDIDO: el trabajo diferido comprobó que el
   * destinatario sigue sin leer. Este método sólo redacta y manda — la regla de
   * este processor.
   *
   * `text:` plano, y aquí importa especialmente: el extracto lo escribe un
   * desconocido y lo lee la otra parte.
   */
  private async sendMessageUnread(data: SendMessageUnreadData): Promise<void> {
    const link = `${this.appUrl}/mensajes/${data.conversationId}`;
    const cuantos =
      data.unreadCount === 1
        ? 'un mensaje nuevo'
        : `${data.unreadCount} mensajes nuevos`;

    await this.enviar({
      from: this.from,
      to: data.email,
      subject: `Tienes ${cuantos} de ${data.otherUserName}`,
      text:
        `Hola ${data.name},\n\n${data.otherUserName} te ha dejado ${cuantos}:\n\n` +
        `"${data.extracto}"\n\nLéelos y responde aquí:\n${link}\n\n${this.noReply}`,
    });
    this.logger.log(`Message unread email sent to ${data.email} (${data.unreadCount})`);
  }

  /**
   * N5 — el ZIP está listo y CADUCA. Por eso lleva la fecha en el cuerpo: sin ella
   * el aviso no dice lo único que le da urgencia.
   */
  private async sendDataExportReady(data: SendDataExportReadyData): Promise<void> {
    const link = `${this.appUrl}/perfil`;
    const megas = (data.sizeBytes / (1024 * 1024)).toFixed(1);

    await this.enviar({
      from: this.from,
      to: data.email,
      subject: 'Tu copia de datos está lista',
      text:
        `Hola ${data.name},\n\nYa puedes descargar tu copia de datos (${megas} MB).\n\n` +
        `Estará disponible hasta el ${this.fecha(data.expiresAt)}; después se borra y ` +
        `habría que pedirla otra vez.\n\nDescárgala desde tu perfil:\n${link}`,
    });
    this.logger.log(`Data export ready email sent to ${data.email}`);
  }

  /**
   * N5 — faltan datos fiscales y hay movimientos facturables.
   *
   * Dice QUÉ falta y QUÉ se pierde si no se hace, sin alarmismo: la ventana existe
   * y el usuario puede no saber que existe.
   */
  private async sendInvoicingPending(data: SendInvoicingPendingData): Promise<void> {
    const link = `${this.appUrl}/perfil/facturacion`;
    const movs =
      data.facturableCount === 1 ? 'un movimiento facturable' : `${data.facturableCount} movimientos facturables`;

    await this.enviar({
      from: this.from,
      to: data.email,
      subject: 'Faltan tus datos fiscales para emitir tu factura',
      text:
        `Hola ${data.name},\n\nTienes ${movs} del periodo ${data.periodKey}, pero nos faltan ` +
        `tus datos fiscales para poder emitir la factura.\n\n` +
        `Complétalos aquí y podrás emitirla tú mismo:\n${link}`,
    });
    this.logger.log(`Invoicing pending email sent to ${data.email}`);
  }

  /**
   * N5 — el staff ha retirado saldo.
   *
   * LLEVA EL MOTIVO, que su DTO exige desde siempre y hasta ahora sólo llegaba al
   * `AuditLog`: quitarle a alguien algo que vale dinero y no decirle por qué es
   * justo lo que N2 corrigió para las sanciones.
   */
  private async sendBalanceDebited(data: SendBalanceDebitedData): Promise<void> {
    const link = `${this.appUrl}/mis-creditos`;
    const partes = [
      data.credits > 0 ? `${data.credits} crédito${data.credits === 1 ? '' : 's'}` : null,
      data.bumps > 0 ? `${data.bumps} bump${data.bumps === 1 ? '' : 's'}` : null,
    ].filter(Boolean);

    await this.enviar({
      from: this.from,
      to: data.email,
      subject: 'Hemos ajustado el saldo de tu cuenta',
      text:
        `Hola ${data.name},\n\nHemos retirado ${partes.join(' y ')} de tu saldo.\n\n` +
        `Motivo: ${data.reason}\n\nPuedes ver tu saldo y su historial aquí:\n${link}\n\n` +
        `Si crees que es un error, escríbenos y lo revisamos.`,
    });
    this.logger.log(`Balance debited email sent to ${data.email}`);
  }

  /** Fecha legible para el copy. Molde del front: `es-ES`, día y mes. */
  private fecha(iso: string): string {
    return new Date(iso).toLocaleDateString('es-ES', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  /**
   * Reputación RÁFAGA 3 — copy deliberadamente sin presión ni plazo: valorar es
   * opcional, sin ventana de tiempo. Un job por parte (ver closeDeal en
   * ListingsService), igual que SEND_CONTACT_NOTIFICATION es un job por admin.
   *
   * NOTIFICACIONES A1 — EL ENLACE YA NO VA AL ANUNCIO. Iba a `/anuncio/{slug}` y
   * daba 404 en todos los tratos de producto, porque `closeDeal` deja el anuncio
   * en `SOLD` y la ficha pública sólo sirve los `ACTIVE`. Ahora va al MISMO sitio
   * que la notificación in-app —el deep-link de valoración en el perfil del otro,
   * que no depende del estado del anuncio—, así que además los dos canales dicen
   * lo mismo. Ver `SendReviewRequestEmailData`.
   */
  private async sendReviewRequestEmail(data: SendReviewRequestEmailData): Promise<void> {
    const link =
      `${this.appUrl}/vendedor/${data.otherUserSlug}` +
      `?valorar=${encodeURIComponent(data.listingId ?? '')}` +
      `&target=${encodeURIComponent(data.otherUserId)}`;
    await this.enviar({
      from: this.from,
      to: data.email,
      subject: `${data.otherUserName} cerró un trato contigo`,
      text: `Hola ${data.name},\n\n${data.otherUserName} cerró un trato contigo sobre "${data.listingTitle}". Si quieres, puedes dejar tu valoración:\n${link}\n\nEs totalmente opcional.`,
    });
    this.logger.log(`Review request email sent to ${data.email}`);
  }
}
