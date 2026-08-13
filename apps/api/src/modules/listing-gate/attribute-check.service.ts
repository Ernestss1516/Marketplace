import { Injectable } from '@nestjs/common';
import type { Listing, ListingType } from '@prisma/client';
import {
  attributeIssuesFor,
  type AttributeIssue,
} from '../categories/attribute-validation';
import {
  ancestorChainIn,
  CategoryTreeService,
  type CategoryNode,
} from '../categories/category-tree.service';

/** Lo mínimo que hay que saber de un anuncio para revalidarlo. */
export interface RevalidableListing {
  categoryId: string;
  type: ListingType;
  attributes: Listing['attributes'];
}

/**
 * PUERTA — RÁFAGA 2. «¿Cumple este anuncio la configuración VIGENTE de su
 * categoría?», y nada más.
 *
 * ES EL ÚNICO SITIO QUE HACE ESA PREGUNTA, y lo consumen tres cosas que deben
 * responder lo mismo o el mecanismo entero pierde sentido:
 *
 *  1. La REGLA de la puerta, que frena la próxima transición.
 *  2. La LIMPIEZA del flag `needsRevalidation`, que decide si el vendedor ya
 *     corrigió. Si preguntara distinto que la regla, habría anuncios que se
 *     desmarcan y siguen frenados, o al revés.
 *  3. El AVISO en «Mis anuncios», que le dice al vendedor QUÉ corregir. Si
 *     enseñara otros motivos que los que frenan, sería peor que no avisar.
 *
 * DOS FORMAS DE PREGUNTAR, porque hay dos patrones de acceso y confundirlos sale
 * caro:
 *
 *  · `issuesFor` — UN anuncio, una consulta a la jerarquía. Es lo que paga una
 *    transición, exactamente igual que ya pagaban `create()` y `update()`.
 *  · `issuesForMany` — UN LOTE con UNA sola consulta: carga la foto del árbol
 *    una vez y pliega en memoria. Es lo que usan el listado del vendedor y el
 *    trabajo de marcado, donde `issuesFor` en bucle sería un N+1 de manual.
 */
@Injectable()
export class AttributeCheckService {
  constructor(private readonly categoryTree: CategoryTreeService) {}

  /** Los incumplimientos de UN anuncio. Lista vacía = cumple. */
  async issuesFor(listing: RevalidableListing): Promise<AttributeIssue[]> {
    const cadena = await this.categoryTree.getAncestorChain(listing.categoryId);
    return issuesInTree(cadena, listing);
  }

  /**
   * Los incumplimientos de un LOTE, indexados por id de anuncio. Una consulta
   * para todos.
   *
   * Foto FRESCA y no la memoizada: quien pregunta esto acaba de cambiar una
   * categoría (el marcado) o le está enseñando al vendedor por qué su anuncio
   * está marcado. Con la foto vieja, el marcado usaría el schema ANTERIOR al
   * cambio que lo dispara — es decir, mediría justo lo que no es.
   */
  async issuesForMany<T extends RevalidableListing & { id: string }>(
    listings: T[],
  ): Promise<Map<string, AttributeIssue[]>> {
    const salida = new Map<string, AttributeIssue[]>();
    if (listings.length === 0) return salida;

    const arbol = await this.categoryTree.getFreshSnapshot();
    for (const l of listings) {
      salida.set(l.id, issuesInTree(ancestorChainIn(arbol, l.categoryId), l));
    }
    return salida;
  }
}

/**
 * El pliegue y la validación sobre una cadena ya resuelta.
 *
 * CATEGORÍA IRRESOLUBLE (cadena vacía) ⇒ NINGÚN motivo, deliberadamente. Es un
 * problema de datos —la regla 5 que M2 mide aparte—, no un incumplimiento del
 * vendedor, y tratarlo como tal frenaría a alguien por algo que no puede
 * arreglar. La `FK categoryId` hace que hoy no pueda pasar; el `[]` está por si
 * alguna vez pasa.
 */
function issuesInTree(
  cadena: readonly CategoryNode[],
  listing: RevalidableListing,
): AttributeIssue[] {
  if (cadena.length === 0) return [];
  return attributeIssuesFor(
    cadena,
    listing.type,
    (listing.attributes as Record<string, unknown>) ?? {},
  );
}
