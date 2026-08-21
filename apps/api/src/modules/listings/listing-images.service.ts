import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { R2Service } from '../../infra/r2/r2.service';
import { listingMediaKeys } from '../../infra/r2/media-keys';
import { QUEUE_MEDIA_CLEANUP } from '../../infra/queue/queue.constants';
import { PhotoLimitsService } from '../listing-gate/photo-limits.service';

/** Lo que se llevó por delante una sincronización, para el `AuditLog`. */
export interface ImagenRetirada {
  id: string;
  url: string;
}

/**
 * 2b — EL ÚNICO SITIO POR EL QUE UNAS FOTOS ACABAN (O DEJAN DE ESTAR) EN UN ANUNCIO.
 *
 * ─── QUÉ DEFECTO CIERRA ───────────────────────────────────────────────────────
 *
 * Había DOS implementaciones de «pon estas fotos en este anuncio» y no hacían lo mismo.
 * El camino del dueño (`linkImages`) validaba tope, existencia y propiedad, y escribía el
 * `order`. El del staff (P3a) hacía un `updateMany` a pelo:
 *
 *   · **no escribía el `order`** — reordenar desde el backoffice respondía 200 y no movía
 *     nada. Un silencio, que es la peor forma de fallo;
 *   · **no aplicaba el tope, ni comprobaba existencia, ni propiedad**, contradiciendo la
 *     promesa escrita de P3a («valida igual que el dueño»);
 *   · y su `where: { id: { in: imageIds } }` **no acotaba a este anuncio**, así que un
 *     `imageIds` con el id de una foto AJENA se la llevaba de su anuncio. Nadie podía
 *     provocarlo porque la interfaz nunca mandaba `imageIds` — era una bomba armada
 *     esperando a que 2b encendiera el mecanismo.
 *
 * Y ninguno de los dos limpiaba R2: quitar una foto dejaba la fila y **sus dos objetos**
 * (original y miniatura) huérfanos para siempre. Ésa es la sexta fuente de huérfanas, y
 * la única que se dispara en la operación normal de un anuncio vivo — no estaba ni en el
 * inventario de `pendientes.md`.
 *
 * Se extrae en vez de arreglarse dos veces, que es el movimiento de P3a con las
 * validaciones y por el mismo motivo: dos copias divergen, y la que divergiría sin que
 * nadie lo notara es la del backoffice.
 *
 * ─── LA REGLA DE QUÉ ES ENLAZABLE, UNA SOLA Y SIN BANDERAS ────────────────────
 *
 * Una imagen se puede poner en este anuncio si **ya está en él**, o si **está suelta y la
 * subió su vendedor**. Con eso solo se cubren los dos caminos sin un `esStaff` que
 * encienda y apague comprobaciones — el parámetro-bandera que P3a evitó a propósito
 * porque hace que una guarda dependa de un booleano:
 *
 *   | Caso | ¿Pasa? |
 *   |---|---|
 *   | El dueño añade una subida suya recién hecha | Sí (suelta + suya) |
 *   | El dueño o el staff conservan las que ya están | Sí (ya está en él) |
 *   | El staff reordena | Sí (ya están en él) |
 *   | Cualquiera intenta llevarse la foto de OTRO anuncio | **No** |
 *   | Cualquiera intenta enganchar la subida suelta de un tercero | **No** |
 *
 * **UN MATIZ DELIBERADO respecto a `linkImages`**, y es la única diferencia de conducta
 * en el camino del dueño además de la limpieza: la propiedad se comprueba **sólo sobre
 * las que entran**, no sobre las que ya estaban. `ListingImage.uploadedById` es nullable
 * con `SetNull`, así que borrar la cuenta de quien subió una foto dejaba ese campo a
 * `null` y la comprobación vieja —que se aplicaba a todas— tumbaba una edición legítima
 * de un anuncio antiguo. Reafirmar el subidor de una foto que YA es de este anuncio no
 * autoriza nada nuevo; sólo podía fallar.
 */
@Injectable()
export class ListingImagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly photoLimits: PhotoLimitsService,
    private readonly r2: R2Service,
    @InjectQueue(QUEUE_MEDIA_CLEANUP) private readonly mediaCleanupQueue: Queue,
  ) {}

  /**
   * Deja el anuncio con EXACTAMENTE estas fotos, en ESTE orden.
   *
   * `imageIds` es la lista final, no un delta: lo que no está, sale — y salir significa
   * **borrarse**, no desvincularse (ver abajo). Devuelve lo retirado para que quien
   * llame lo pueda registrar.
   *
   * @param sellerId el DUEÑO DEL ANUNCIO, nunca quien ejecuta la acción. Un moderador
   *   edita el anuncio de otra persona; las fotos que se enganchen tienen que ser del
   *   vendedor igual que si las hubiera puesto él.
   */
  async sync(params: {
    listingId: string;
    sellerId: string;
    imageIds: string[];
  }): Promise<{ retiradas: ImagenRetirada[] }> {
    const { listingId, sellerId, imageIds } = params;

    // PUERTA regla #3 — EL TOPE, aquí y no en el DTO. Éste es el único sitio por el que
    // unas fotos acaban colgando de un anuncio, lo llamen `create()`, `update()` o el
    // camino de staff, así que es donde el tope no se puede olvidar. `imageIds.length`
    // es el número FINAL en los tres caminos, porque la lista sustituye a la anterior.
    const max = await this.photoLimits.getMax();
    if (imageIds.length > max) {
      throw new UnprocessableEntityException(
        `Un anuncio admite como máximo ${max} fotos (has enviado ${imageIds.length}).`,
      );
    }

    const candidatas = await this.prisma.listingImage.findMany({
      where: { id: { in: imageIds } },
      select: { id: true, uploadedById: true, listingId: true },
    });

    const notFound = imageIds.filter((imgId) => !candidatas.some((img) => img.id === imgId));
    if (notFound.length) {
      throw new UnprocessableEntityException(`Imágenes no encontradas: ${notFound.join(', ')}`);
    }

    for (const img of candidatas) {
      if (img.listingId !== null && img.listingId !== listingId) {
        throw new UnprocessableEntityException(
          `La imagen ${img.id} ya está vinculada a otro anuncio`,
        );
      }
      // Sólo las que ENTRAN — ver el matiz de la cabecera.
      if (img.listingId === null && img.uploadedById !== sellerId) {
        throw new UnprocessableEntityException(`La imagen ${img.id} no pertenece al usuario`);
      }
    }

    // LAS CLAVES SE CALCULAN ANTES DE BORRAR LA FILA, y ése es el motivo de que la
    // limpieza reciba claves y no ids (`media-keys.ts`): cuando el trabajo de la cola se
    // ejecute, la fila ya no existirá y no habría forma de saber qué fichero era suyo.
    // Son DOS por imagen —original y miniatura—, que es la mitad que se queda fuera
    // cuando se mira sólo lo que hay en la base de datos.
    const actuales = await this.prisma.listingImage.findMany({
      where: { listingId },
      select: { id: true, url: true },
    });
    const retiradas = actuales.filter((img) => !imageIds.includes(img.id));
    const keys = listingMediaKeys(
      { imageUrls: retiradas.map((img) => img.url) },
      this.r2.getPublicUrl(''),
    );

    await this.prisma.$transaction(async (tx) => {
      // SE BORRA LA FILA, NO SE DESVINCULA (decisión §5.4a). Purgar el objeto de R2
      // dejando la fila produciría algo peor que antes: una fila apuntando a un fichero
      // que ya no existe. El coste, asumido y escrito: quitar una foto es irreversible
      // desde el momento en que se guarda, y por eso quien llama registra cuáles fueron.
      if (retiradas.length > 0) {
        await tx.listingImage.deleteMany({
          // Acotado a ESTE anuncio: la lista de ids salió de aquí, pero el `where` lo
          // vuelve a decir para que un borrado no pueda salirse del anuncio ni aunque
          // alguien cambie el cálculo de arriba.
          where: { listingId, id: { in: retiradas.map((img) => img.id) } },
        });
      }

      for (const [order, imgId] of imageIds.entries()) {
        // EL `order`, POR POSICIÓN EN EL ARRAY: es lo que el camino de staff no escribía.
        //
        // Y el `where` REPITE la condición de enlazabilidad que ya se validó arriba. No
        // es redundancia decorativa: es lo que hace que este `updateMany` no pueda
        // llevarse la foto de otro anuncio ni aunque la validación se rompa. La versión
        // que había —`where: { id: { in: imageIds } }` a secas— sí podía.
        await tx.listingImage.updateMany({
          where: { id: imgId, OR: [{ listingId: null }, { listingId }] },
          data: { listingId, order },
        });
      }
    });

    // TRAS EL COMMIT Y SIN PODER TUMBARLO, molde literal de B3: R2 es I/O externa y no
    // entra en la transacción de Postgres. Puestos a elegir dónde cae el fallo, se elige
    // el lado barato — un objeto que no se llega a borrar es basura que nadie ve y que la
    // cola reintenta; una edición que no se guarda porque el bucket no respondía sería
    // perder el trabajo de una persona.
    if (keys.length > 0) {
      await this.mediaCleanupQueue.add('purge', {
        keys,
        origen: `listing-images:${listingId}`,
      });
    }

    return { retiradas };
  }
}
