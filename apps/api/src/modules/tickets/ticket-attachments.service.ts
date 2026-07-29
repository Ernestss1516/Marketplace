import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { R2Service } from '../../infra/r2/r2.service';
import { StaffActor } from './tickets.types';
import { assertCanHandleTicket } from './tickets.guards';
import {
  TICKET_ATTACHMENT_FILENAME_MAX_CHARS,
  TICKET_ATTACHMENT_MAX_BYTES,
  TICKET_ATTACHMENT_MAX_PER_MESSAGE,
  TICKET_ATTACHMENT_MIME_TO_EXT,
} from './tickets.constants';

/** Fila lista para persistir. La `key` NUNCA sale de aquí hacia ningún payload. */
export interface PreparedAttachment {
  key: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

export interface AttachmentDownload {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

/**
 * Cabecera `Content-Disposition` de una descarga, con el nombre original.
 *
 * SEGUNDA CAPA sobre `sanitizeFilename`. El nombre lo eligió quien subió el
 * fichero, y aquí va a parar a una CABECERA HTTP: una comilla o un salto de línea
 * mal puestos son inyección de cabeceras. Por eso:
 *
 * - se emite `filename="…"` con un fallback SOLO ASCII imprimible, que es lo que
 *   entienden todos los clientes;
 * - y `filename*=UTF-8''…` (RFC 5987) percent-encodeado para conservar tildes y
 *   eñes, que es lo que un usuario español va a poner en el 90 % de los nombres.
 *
 * `percent-encoding` no deja pasar ningún carácter especial de cabecera, así que
 * el segundo parámetro es seguro por construcción; el primero se limpia a mano.
 *
 * Siempre `attachment`, nunca `inline`: un fichero subido por un tercero no se
 * renderiza en el navegador de nadie.
 */
export function attachmentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Atención al usuario R5 — ADJUNTOS DE TICKET.
 *
 * **MOLDE FACTURA, NO MOLDE MEDIA. Es la decisión que define esta ráfaga** (§3.5).
 *
 * `MediaService` sube a R2 y devuelve `getPublicUrl(key)`: una URL PÚBLICA,
 * compartible y no revocable, más una fila `ListingImage` y un job de procesado
 * de imagen. Nada de eso vale aquí. Un adjunto de ticket es un pantallazo que
 * puede llevar un DNI, un importe o una conversación privada; publicarlo en una
 * URL adivinable-o-compartible sería exactamente el fallo que este sistema
 * existe para no cometer. Y `ListingImage` sería un efecto lateral sin sentido:
 * un adjunto de ticket no es la foto de un anuncio.
 *
 * Por eso este servicio **usa `R2Service` directamente y NUNCA `MediaService`**:
 * guarda solo la CLAVE (`TicketAttachment.key`), igual que
 * `Invoice.pdfKey`, y el fichero solo se sirve por un endpoint AUTENTICADO que
 * revalida el acceso en cada descarga (`InvoicingService.getInvoicePdf` es el
 * molde exacto). **En todo R5 no se llama a `getPublicUrl` ni una vez**, y la
 * `key` ni siquiera viaja en los payloads del hilo.
 *
 * Lo único que se comparte con media son DOS CONSTANTES (la whitelist MIME y el
 * tamaño máximo), importadas en `tickets.constants.ts` para que no existan dos
 * listas de tipos permitidos que mantener en sincronía.
 */
@Injectable()
export class TicketAttachmentsService {
  private readonly logger = new Logger(TicketAttachmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
  ) {}

  // ---------------------------------------------------------------------------
  // Subida
  // ---------------------------------------------------------------------------

  /**
   * Valida y sube. Devuelve las filas listas para crear DENTRO de la transacción
   * del mensaje — este método no escribe en la base de datos.
   *
   * ORDEN DELIBERADO, y no es un detalle de estilo:
   *
   * 1. **Quien llama ya ha autorizado.** `prepare` se invoca desde `replyAsUser`
   *    / `replyAsStaff` DESPUÉS de sus guards de propiedad y de estado. Subir
   *    antes de comprobar de quién es el ticket convertiría el endpoint en
   *    almacenamiento gratuito escribible por cualquiera con un id inventado.
   * 2. **Se valida TODO antes de subir NADA.** Un lote con un fichero inválido no
   *    deja a medias los válidos en R2.
   * 3. **R2 no es transaccional.** Si la escritura en base de datos falla después,
   *    el llamador invoca `discard()` con estas claves. Un objeto huérfano en R2
   *    es basura; una fila que apunta a un objeto que no existe es un error que
   *    el usuario ve.
   */
  async prepare(
    ticketId: string,
    files: Express.Multer.File[] = [],
  ): Promise<PreparedAttachment[]> {
    if (files.length === 0) return [];

    if (files.length > TICKET_ATTACHMENT_MAX_PER_MESSAGE) {
      throw new UnprocessableEntityException({
        code: 'TOO_MANY_ATTACHMENTS',
        message: `Puedes adjuntar como máximo ${TICKET_ATTACHMENT_MAX_PER_MESSAGE} ficheros por mensaje.`,
      });
    }

    for (const file of files) {
      if (!TICKET_ATTACHMENT_MIME_TO_EXT[file.mimetype]) {
        throw new UnprocessableEntityException({
          code: 'ATTACHMENT_TYPE_NOT_ALLOWED',
          message: 'Solo se admiten imágenes JPEG, PNG o WebP y ficheros PDF.',
        });
      }
      if (file.size > TICKET_ATTACHMENT_MAX_BYTES) {
        throw new UnprocessableEntityException({
          code: 'ATTACHMENT_TOO_LARGE',
          message: `Cada fichero puede ocupar como máximo ${TICKET_ATTACHMENT_MAX_BYTES / (1024 * 1024)} MB.`,
        });
      }
    }

    const prepared: PreparedAttachment[] = [];
    try {
      for (const file of files) {
        const ext = TICKET_ATTACHMENT_MIME_TO_EXT[file.mimetype];
        // LA CLAVE NO LLEVA NADA DEL CLIENTE. Molde MediaService: 16 bytes
        // aleatorios + la extensión que dicta el MIME ya validado. Si la clave
        // se construyera con el nombre subido, un `../` o un nombre repetido
        // decidiría dónde se escribe y qué se sobrescribe. El nombre original
        // se guarda aparte, en una columna, que es donde un dato del cliente
        // puede vivir sin ser una ruta.
        const key = `tickets/${ticketId}/${randomBytes(16).toString('hex')}${ext}`;
        await this.r2.upload(key, file.buffer, file.mimetype);
        prepared.push({
          key,
          filename: this.sanitizeFilename(file.originalname),
          mimeType: file.mimetype,
          sizeBytes: file.size,
        });
      }
    } catch (err) {
      // Un fallo a mitad de lote no deja los anteriores colgando en R2.
      await this.discard(prepared.map((a) => a.key));
      throw err;
    }

    return prepared;
  }

  /**
   * Borra de R2 unos objetos recién subidos cuyo mensaje no llegó a persistir.
   * Best-effort y con `catch`: si la limpieza falla, lo que queda es un objeto
   * inalcanzable (ninguna fila lo referencia), no un problema de corrección. Molde
   * `InvoicingService`, que borra el PDF de un borrador igual, con `.catch()`.
   */
  async discard(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.r2.delete(key).catch((err: unknown) => {
        this.logger.warn(`No se pudo limpiar el adjunto huérfano ${key}: ${String(err)}`);
      });
    }
  }

  /**
   * El nombre original es un dato del cliente y solo sirve para MOSTRAR y para la
   * cabecera `Content-Disposition`. Se limpia al ENTRAR (no solo al salir):
   *
   * - fuera separadores de ruta — no es una ruta y nunca lo será;
   * - fuera caracteres de control, comillas y salto de línea — un `"` o un `\r\n`
   *   en un nombre es INYECCIÓN DE CABECERAS en la respuesta de descarga.
   *   `getInvoicePdf` no tuvo nunca este problema porque su nombre lo compone el
   *   servidor; aquí lo elige quien sube, así que hay que tratarlo como entrada
   *   hostil. La codificación de salida (RFC 5987) lo vuelve a cubrir en el
   *   controlador: dos capas, porque el dato viaja a una cabecera HTTP.
   */
  private sanitizeFilename(original: string | undefined): string {
    const base = (original ?? '')
      .replace(/[\\/]/g, '_')
      // eslint-disable-next-line no-control-regex
      .replace(/[\x00-\x1f\x7f"]/g, '')
      .trim()
      .slice(0, TICKET_ATTACHMENT_FILENAME_MAX_CHARS);
    return base.length > 0 ? base : 'adjunto';
  }

  // ---------------------------------------------------------------------------
  // Descarga — SIEMPRE autenticada, NUNCA una URL
  // ---------------------------------------------------------------------------

  /**
   * Descarga del USUARIO. Molde `InvoicingService.getInvoicePdf`: se carga la
   * fila, se revalida la propiedad y solo entonces se baja el objeto de R2.
   *
   * DOS RESPUESTAS DISTINTAS, y la diferencia es la parte importante:
   *
   * - Ticket de OTRO → **403** «Este ticket no es tuyo». Es la respuesta que ya
   *   dan `getForUser` y `getInvoicePdf` para un recurso ajeno.
   * - Adjunto de una NOTA INTERNA → **404**, como si no existiera. Un 403 aquí
   *   confirmaría que ahí hay algo, y la existencia de una nota interna es
   *   precisamente lo que el usuario no puede llegar a saber (§10.3). Es la misma
   *   razón por la que una nota no toca `lastMessageAt` ni el contador de no
   *   leídos: no basta con ocultar el contenido, hay que no dejar rastro.
   */
  async downloadForUser(
    ticketId: string,
    attachmentId: string,
    userId: string,
  ): Promise<AttachmentDownload> {
    const attachment = await this.load(ticketId, attachmentId);

    if (attachment.message.ticket.userId !== userId) {
      throw new ForbiddenException('Este ticket no es tuyo');
    }
    // DEFENSA 6 de la invariante de notas internas, extendida a los ficheros: el
    // adjunto HEREDA la privacidad del mensaje que lo lleva. Sin esto, un adjunto
    // sería la puerta de atrás a una nota que el hilo no muestra.
    if (attachment.message.internal) {
      throw new NotFoundException('Adjunto no encontrado');
    }

    return this.fetch(attachment);
  }

  /**
   * Descarga del STAFF. Misma puerta ADMIN-only por contenido de fila que el
   * resto de operaciones sobre un ticket con factura: un MODERATOR no puede
   * bajarse el adjunto de un hilo que no puede ni abrir. Aquí las notas internas
   * SÍ se sirven — el staff es su destinatario.
   */
  async downloadForStaff(
    ticketId: string,
    attachmentId: string,
    actor: StaffActor,
  ): Promise<AttachmentDownload> {
    const attachment = await this.load(ticketId, attachmentId);
    assertCanHandleTicket(attachment.message.ticket, actor);
    return this.fetch(attachment);
  }

  /**
   * Carga el adjunto con el contexto mínimo para autorizar.
   *
   * `attachment.message.ticketId !== ticketId` → 404. El id del ticket de la ruta
   * tiene que ser el del adjunto: si no se comprobara, `/tickets/<mío>/attachments/<ajeno>`
   * pasaría el control de propiedad mirando MI ticket y devolvería el fichero de
   * otro. Es el mismo cuidado que el pivote del cursor del hilo, que también
   * exige pertenecer a ESTE ticket.
   */
  private async load(ticketId: string, attachmentId: string) {
    const attachment = await this.prisma.ticketAttachment.findUnique({
      where: { id: attachmentId },
      select: {
        key: true,
        filename: true,
        mimeType: true,
        message: {
          select: {
            internal: true,
            ticketId: true,
            ticket: { select: { userId: true, invoiceId: true } },
          },
        },
      },
    });
    if (!attachment || attachment.message.ticketId !== ticketId) {
      throw new NotFoundException('Adjunto no encontrado');
    }
    return attachment;
  }

  private async fetch(attachment: {
    key: string;
    filename: string;
    mimeType: string;
  }): Promise<AttachmentDownload> {
    const buffer = await this.r2.download(attachment.key);
    return { buffer, filename: attachment.filename, mimeType: attachment.mimeType };
  }
}
