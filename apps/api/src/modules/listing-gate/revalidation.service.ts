import { Injectable, Logger } from '@nestjs/common';
import { ListingStatus, type Listing } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CategoryTreeService } from '../categories/category-tree.service';
import { AttributeCheckService } from './attribute-check.service';

/**
 * Estados que NO se marcan: un anuncio archivado o vendido no va a volver al
 * mercado, así que avisar a su dueño de que «ya no cumple» es ruido puro. Es el
 * mismo corte que el diseño fijó para la futura regla del límite total («todo
 * menos ARCHIVED y SOLD»), y usarlo aquí evita inventar un segundo criterio.
 */
const ESTADOS_QUE_NO_SE_MARCAN: ListingStatus[] = [ListingStatus.ARCHIVED, ListingStatus.SOLD];

/** Cuántos anuncios se revisan por vuelta al marcar. Ver la nota de `markStaleInSubtree`. */
const LOTE = 500;

/**
 * PUERTA — RÁFAGA 2. LA MAQUINARIA DEL FLAG `needsRevalidation`.
 *
 * LA POLÍTICA, EN UNA FRASE: el anuncio que deja de cumplir se MARCA, no
 * desaparece. Sigue ACTIVE, sigue en el índice, sigue visible y sigue editable;
 * lo que pasa es que su dueño ve un aviso con lo que hay que corregir y, cuando
 * la regla esté encendida, no puede hacer nada nuevo con él hasta arreglarlo.
 * Sacarlo del mercado de golpe por un cambio que hizo un administrador sería
 * castigar al vendedor por algo que no ha hecho.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * COHERENCIA CON `enabled` — LA PREGUNTA QUE ESTE DISEÑO TENÍA QUE RESOLVER:
 * si la regla de atributos nace APAGADA, ¿se marca igual?
 *
 * SÍ, y el reparto es este:
 *
 *  | pieza                       | ¿mira `enabled`? | por qué                    |
 *  |-----------------------------|------------------|----------------------------|
 *  | MARCAR (este servicio)      | NO               | El flag describe un HECHO («esta categoría cambió y este anuncio ya no encaja»), no una política. Marcar no le quita nada a nadie. Si esperara a `enabled`, el día que se encienda la regla no habría ni un anuncio marcado ni forma de saber cuáles, y el aviso —lo único que le da salida al vendedor— llegaría DESPUÉS del frenazo en vez de antes. |
 *  | AVISAR en «Mis anuncios»    | NO               | Es información, no restricción (mitigación M6). |
 *  | FRENAR (la regla)           | **SÍ**           | Es lo único que le quita capacidad al vendedor, y es lo que M2 tiene que dimensionar antes. Apagada no frena a nadie: ni marcado ni sin marcar. |
 *  | LIMPIAR (este servicio)     | NO               | Si dependiera de `enabled`, el aviso se quedaría pegado en anuncios YA corregidos, y al encender la regla se frenaría a gente que cumple. Limpiar sólo retira un aviso: es seguro incluso apagada. |
 *
 * Dicho de otro modo: apagada, el mecanismo OBSERVA y AVISA con total fidelidad,
 * pero no bloquea. Encenderlo es una línea en `Setting`, y para entonces ya hay
 * anuncios marcados, vendedores avisados y un número real que medir.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * NO TOCA LA BÚSQUEDA, y son tres hechos, no una esperanza: (1) en este repo un
 * `listing.update` NUNCA reindexa —el reindexado es siempre un
 * `indexingQueue.add('index', …)` explícito—, (2) el flag no entra en
 * `ListingDocument`, así que no habría nada que reindexar, y (3) el anuncio sigue
 * ACTIVE, luego sigue en el índice. Marcar es coste de escritura, y de una
 * escritura que no propaga.
 */
@Injectable()
export class RevalidationService {
  private readonly logger = new Logger(RevalidationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly categoryTree: CategoryTreeService,
    private readonly attributes: AttributeCheckService,
  ) {}

  /**
   * Marca los anuncios de una categoría Y DE TODA SU DESCENDENCIA que ya no
   * cumplen el schema vigente. Devuelve cuántos quedaron marcados.
   *
   * LA DESCENDENCIA NO ES OPCIONAL: el schema se HEREDA, así que tocar el de una
   * raíz cambia el schema efectivo de sus nietos y bisnietos. Mirar sólo la
   * categoría editada dejaría fuera justo a los anuncios de las hojas, que son
   * la mayoría.
   *
   * SE RECORRE EN LOTES por id: la lista de anuncios de una raíz puede ser
   * enorme, y este trabajo corre en una cola precisamente para que su tamaño no
   * dependa de lo que aguante una petición HTTP.
   *
   * SÓLO ESCRIBE EN UNA DIRECCIÓN: marca a los que fallan y NO desmarca a los
   * que pasan. Desmarcar aquí sería tentador, pero un anuncio puede estar
   * marcado por un cambio ANTERIOR en otra categoría de su cadena; limpiar el
   * flag lo hace quien revalida ese anuncio completo (`clearIfCompliant`).
   */
  async markStaleInSubtree(categoryId: string): Promise<number> {
    const ids = [categoryId, ...(await this.categoryTree.getDescendantIds(categoryId))];

    let marcados = 0;
    let cursor: string | undefined;
    for (;;) {
      const lote = await this.prisma.listing.findMany({
        where: {
          categoryId: { in: ids },
          status: { notIn: ESTADOS_QUE_NO_SE_MARCAN },
          needsRevalidation: false,
        },
        select: { id: true, categoryId: true, type: true, attributes: true },
        orderBy: { id: 'asc' },
        take: LOTE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (lote.length === 0) break;

      const issues = await this.attributes.issuesForMany(lote);
      const fallan = lote.filter((l) => (issues.get(l.id)?.length ?? 0) > 0).map((l) => l.id);
      if (fallan.length > 0) {
        // `updateMany`, NO un update por anuncio: es una escritura de un solo
        // campo y no dispara ningún efecto (ver la cabecera: no reindexa).
        const { count } = await this.prisma.listing.updateMany({
          where: { id: { in: fallan } },
          data: { needsRevalidation: true },
        });
        marcados += count;
      }

      if (lote.length < LOTE) break;
      cursor = lote[lote.length - 1].id;
    }

    if (marcados > 0) {
      this.logger.log(
        `needsRevalidation: ${marcados} anuncio(s) marcado(s) tras cambiar el schema de ${categoryId}`,
      );
    }
    return marcados;
  }

  /**
   * Si el anuncio está marcado y YA CUMPLE, le quita el flag. Devuelve si lo
   * quitó.
   *
   * LA CORRECCIÓN SE PREMIA SOLA: el vendedor arregla el atributo y el aviso
   * desaparece sin que tenga que pedir nada ni entender qué es «revalidación».
   *
   * NO MIRA `enabled` — ver la tabla de la cabecera. Y no marca nunca: si el
   * anuncio sigue incumpliendo, se deja como está (el flag ya está puesto).
   */
  async clearIfCompliant(listing: Pick<Listing, 'id' | 'categoryId' | 'type' | 'attributes' | 'needsRevalidation'>): Promise<boolean> {
    if (!listing.needsRevalidation) return false;

    const issues = await this.attributes.issuesFor(listing);
    if (issues.length > 0) return false;

    await this.prisma.listing.update({
      where: { id: listing.id },
      data: { needsRevalidation: false },
    });
    return true;
  }
}
