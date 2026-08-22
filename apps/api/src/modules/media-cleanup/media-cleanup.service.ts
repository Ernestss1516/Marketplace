import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { R2Service } from '../../infra/r2/r2.service';
import { QUEUE_MEDIA_CLEANUP } from '../../infra/queue/queue.constants';
import { keyFromPublicUrl, releasedUrls } from '../../infra/r2/media-keys';

/**
 * HUÉRFANAS SIN FILA — RÁFAGA H1: «lo que se suelta».
 *
 * EL PATRÓN, UNA SOLA VEZ. Cuatro operaciones sueltan ficheros de R2 que **no tienen
 * fila propia** que los referencie: sustituir el avatar (`User.avatarUrl`), editar o
 * borrar un post (imágenes dentro de `Post.blocks`), guardar la portada
 * (`HomepageConfig.blocks`) y cambiar la imagen de un patrocinado
 * (`SponsoredAd.imageUrl`). Las cuatro hacen lo mismo —comparar lo que había con lo
 * que queda y limpiar la diferencia—, así que la regla vive **aquí** y no copiada
 * cuatro veces. Mismo criterio que `media-keys.ts` con la clave de la miniatura y
 * que `cache-keys.ts` con la de la ficha: una copia, o divergen.
 *
 * SE LLAMA DESPUÉS DE ESCRIBIR, Y NO ES UN DETALLE. Dos motivos:
 *
 *  1. **Molde literal de B3** (`media-cleanup.processor.ts`): R2 es I/O externa y no
 *     entra en la transacción de Postgres. Puestos a elegir dónde cae el fallo se
 *     elige el lado barato — un objeto que no se llega a borrar es basura que nadie
 *     ve y que la cola reintenta; una edición que no se guarda porque el bucket no
 *     respondía sería perder el trabajo de una persona. Por eso **se encola, no se
 *     borra en línea**, y por eso un fallo aquí no puede tumbar la operación.
 *  2. **La comprobación de dueño necesita el estado NUEVO ya escrito.** Si se
 *     ejecutara antes, la propia fila que se está actualizando seguiría conteniendo
 *     la URL vieja y se contaría a sí misma como «otro dueño»: no se borraría nunca
 *     nada. Al ir después, quien todavía referencie esa URL es de verdad otro.
 *
 * LA REGLA DE ORO SE HEREDA ENTERA (`diseno-borrado.md` §7.7): *ante la duda, un
 * huérfano de más es mejor que un fichero vivo de menos*. Todo lo de aquí se inclina
 * a no borrar: si la comprobación falla, no se borra; si la URL es ajena, no se
 * borra; si alguien más la referencia, no se borra.
 */
@Injectable()
export class MediaCleanupService {
  private readonly logger = new Logger(MediaCleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly r2: R2Service,
    @InjectQueue(QUEUE_MEDIA_CLEANUP) private readonly mediaCleanupQueue: Queue,
  ) {}

  /**
   * Encola el borrado de los ficheros propios que estaban en `before` y ya no están
   * en `after`.
   *
   * `before` y `after` son **valores enteros** (el `Json` de bloques, la fila, el
   * objeto con la columna que interese), no listas de campos: quien llama no tiene
   * que saber en qué campo de qué tipo de bloque vive una imagen. Ver `ownUrlsDeep`.
   *
   * Devuelve las claves encoladas — para los tests y para el log, no para el flujo.
   * NUNCA lanza: no dejar limpiar no debe romper nada (mismas palabras que
   * `VideoService.deleteObjectByUrl`).
   */
  async purgeReleased(params: {
    before: unknown;
    after: unknown;
    origen: string;
  }): Promise<string[]> {
    try {
      const prefijo = this.r2.getPublicUrl('');
      const sueltas = releasedUrls(params.before, params.after, prefijo);
      if (sueltas.length === 0) return [];

      const keys: string[] = [];
      for (const url of sueltas) {
        const key = keyFromPublicUrl(url, prefijo);
        // No debería poder pasar (`releasedUrls` ya filtró por propia), pero si
        // pasara sería una clave inventada: se salta.
        if (!key) continue;
        if (await this.laReferenciaAlguienMas(url, key)) {
          this.logger.log(`No se limpia ${key}: sigue referenciada en otro sitio`);
          continue;
        }
        keys.push(key);
      }

      if (keys.length > 0) {
        await this.mediaCleanupQueue.add('purge', { keys, origen: params.origen });
      }
      return keys;
    } catch (err) {
      this.logger.warn(
        `No se pudo encolar la limpieza de ${params.origen}: ${String(err)}`,
      );
      return [];
    }
  }

  /**
   * ¿Queda algún dueño de esta URL?
   *
   * POR QUÉ HACE FALTA, y no es celo. Los validadores de bloque exigen «URL de
   * nuestro almacenamiento» (`IsOwnStorageUrl`), **no un prefijo concreto**, así que
   * nada impide hoy que la misma imagen acabe referenciada desde dos documentos —
   * duplicar un artículo copiando su `Json`, pegar a mano la URL de otra parte. Y los
   * avatares se pueden compartir directamente: `UpdateMeDto.avatarUrl` es un
   * `@IsString()` pelado, sin `@IsOwnStorageUrl` (que además no valdría: rompería los
   * avatares de Google, que son URLs externas legítimas).
   *
   * SE MIRA TAMBIÉN LA CLAVE DESNUDA, no sólo la URL: `Invoice.pdfKey` y
   * `TicketAttachment.key` guardan la clave cruda, sin el prefijo público. Es el
   * vector 3 de `diseno-borrado.md` §7.6 — un cruce que sólo case URLs no los ve y
   * borraría un PDF fiscal.
   *
   * Y SE MIRA `ListingImage`, que es lo que mantiene la frontera con la basura CON
   * FILA: una imagen subida por `POST /media/upload` —toda la imaginería del blog,
   * incluida la portada— **tiene fila**. Aunque salga de un bloque, aquí no se toca:
   * borrar el objeto dejando la fila produciría algo peor que una huérfana, una fila
   * apuntando a un fichero que no existe. Esa clase es otra deuda, y sigue fuera.
   *
   * Ante un error de consulta devuelve `true` — no borrar. Regla de oro.
   */
  private async laReferenciaAlguienMas(url: string, key: string): Promise<boolean> {
    try {
      const [conFila, avatar, patrocinado, factura, adjunto, enJson] = await Promise.all([
        this.prisma.listingImage.count({ where: { url } }),
        this.prisma.user.count({ where: { avatarUrl: url } }),
        this.prisma.sponsoredAd.count({ where: { imageUrl: url } }),
        this.prisma.invoice.count({ where: { pdfKey: key } }),
        this.prisma.ticketAttachment.count({ where: { key } }),
        // Los dos `Json` y la portada de post, de una vez. `strpos` sobre el texto
        // del Json en vez de `LIKE`: no hay comodines que escapar y la URL se pasa
        // como parámetro, no interpolada.
        this.prisma.$queryRaw<{ existe: number }[]>`
          SELECT 1 AS existe FROM "Post"
           WHERE "coverUrl" = ${url} OR strpos("blocks"::text, ${url}) > 0
           LIMIT 1
        `,
      ]);

      if (conFila > 0 || avatar > 0 || patrocinado > 0 || factura > 0 || adjunto > 0) {
        return true;
      }
      if (enJson.length > 0) return true;

      const enPortada = await this.prisma.$queryRaw<{ existe: number }[]>`
        SELECT 1 AS existe FROM "HomepageConfig"
         WHERE strpos("blocks"::text, ${url}) > 0
         LIMIT 1
      `;
      if (enPortada.length > 0) return true;

      // El vídeo de un anuncio: no llega por ningún bloque, pero nada impide pegar
      // su URL en uno (los validadores sólo exigen que sea nuestra).
      const enVideo = await this.prisma.listing.count({
        where: { OR: [{ videoUrl: url }, { videoPosterUrl: url }] },
      });
      return enVideo > 0;
    } catch (err) {
      this.logger.warn(`No se pudo comprobar quién referencia ${key}: ${String(err)}`);
      return true;
    }
  }
}
