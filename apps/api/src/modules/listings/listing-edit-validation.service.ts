import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ListingType, ListingTypePolicy, PriceUnit } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { CategoryTreeService } from '../categories/category-tree.service';
import type { CategoryNode } from '../categories/category-tree.service';
import { TagsService } from '../tags/tags.service';
import {
  applicableSchemaFor,
  invalidValueIssues,
  linkedSelectIssues,
  missingRequiredNames,
  unknownAttributeKeys,
} from '../categories/attribute-validation';
import {
  AttributeField,
  isListingTypeAllowed,
  isPriceUnitAllowed,
  resolveEffectivePolicy,
  resolveEffectivePriceUnits,
} from '../categories/category.types';

/**
 * P3a — LAS REGLAS DE LOS CAMPOS DE UN ANUNCIO, EN UN SITIO QUE COMPARTEN LOS DOS
 * CAMINOS QUE EDITAN: el del DUEÑO (`ListingsService.update`) y el del STAFF
 * (`AdminService.updateListing`).
 *
 * POR QUÉ SE EXTRAE Y NO SE COPIA. Son ocho reglas con grandfathering fino
 * —atributos requeridos sobre el bag completo pero el resto sólo sobre el delta,
 * tags que se validan si los eliges y se podan si sólo mueves de categoría—. Dos
 * copias divergirían, y la que divergiría sin que nadie lo note es la del
 * backoffice, que es la que menos se usa. Es el mismo criterio que ya obligó a
 * sacar `applicableSchemaFor` de aquí: *«dos implementaciones de eso divergirían
 * en silencio»*.
 *
 * POR QUÉ EN SU PROPIO MÓDULO. `AdminModule` **no importa** `ListingsModule` —lo
 * dice el comentario de `listing-status.transitions.ts`— y hacerle importarlo
 * arrastraría billing, mensajería, moderación y notificaciones para usar seis
 * validaciones. Molde exacto: `CategoryTreeModule`, que existe por esta misma
 * razón y lo comparten los módulos que no pueden verse entre sí.
 *
 * LO QUE ESTE SERVICIO NO SABE: nada de quién edita. No hay `assertOwnership` ni
 * roles aquí — la propiedad la comprueba el camino del dueño y el rol lo
 * comprueba el del staff. Este servicio sólo responde «¿son válidos estos campos
 * para este anuncio?», que es la misma pregunta para los dos.
 *
 * Y NO TOCA EL TRIAJE. La anotación `REVIEWED → EDITED` es del camino del dueño y
 * se queda allí: si viviera aquí, el staff la dispararía por el simple hecho de
 * validar. Ver docs/diseno-editar-anuncio.md §0.
 */
@Injectable()
export class ListingEditValidationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly categoryTree: CategoryTreeService,
    private readonly tags: TagsService,
  ) {}

  /**
   * El bloque de validación de una EDICIÓN, movido aquí tal cual estaba en
   * `update()`. Devuelve los `tagIds` resueltos (o `undefined` = no tocar los
   * tags), que es lo único que el bloque producía además de lanzar.
   */
  async validarEdicion(params: {
    listingId: string;
    existing: {
      categoryId: string;
      type: ListingType;
      priceUnit: PriceUnit;
      attributes: unknown;
    };
    dto: {
      categoryId?: string;
      attributes?: Record<string, unknown>;
      priceUnit?: PriceUnit;
      tags?: string[];
    };
  }): Promise<string[] | undefined> {
    const { listingId, existing, dto } = params;

    // La categoría (propia + ancestros) la necesitan DOS validaciones con
    // disparadores distintos: la de atributos/tipo (categoryId o attributes) y la
    // de formato de precio (priceUnit o categoryId, RP.1). Se resuelve una sola
    // vez — y, sobre todo, cada bloque conserva su propio disparador: un PATCH de
    // solo `priceUnit` NO debe reejecutar validateRequired sobre los atributos
    // (rompería anuncios antiguos con el bag incompleto, justo el grandfathering
    // que esta validación protege).
    const needsCategory =
      dto.categoryId !== undefined ||
      dto.attributes !== undefined ||
      dto.priceUnit !== undefined ||
      // B2 — los tags son la CUARTA validación con disparador propio.
      dto.tags !== undefined;

    if (!needsCategory) return undefined;

    let tagIds: string[] | undefined;

    const catId = dto.categoryId ?? existing.categoryId;
    // PROFUNDIDAD N — la cadena entera, no sólo el padre.
    const cadena = await this.categoryTree.getAncestorChain(catId);
    if (cadena.length === 0) throw new NotFoundException('Category not found');
    const category = cadena[cadena.length - 1];

    if (dto.categoryId !== undefined || dto.attributes !== undefined) {
      const mergedAttrs = {
        ...((existing.attributes as Record<string, unknown>) ?? {}),
        ...(dto.attributes ?? {}),
      };
      // type es inmutable — se filtra por el tipo YA fijado del anuncio.
      const applicableSchema = applicableSchemaFor(cadena, existing.type);
      // required se exige siempre sobre el bag COMPLETO (invariante de
      // completitud del anuncio, no depende de qué campo tocó esta edición).
      this.validateRequired(mergedAttrs, applicableSchema);
      // El resto se acota al DELTA: valores ya guardados que nadie toca se
      // toleran (grandfathering por construcción).
      const delta = this.computeAttributesDelta(
        (existing.attributes as Record<string, unknown>) ?? {},
        dto.attributes ?? {},
      );
      const deltaAttrs: Record<string, unknown> = {};
      for (const key of delta) deltaAttrs[key] = mergedAttrs[key];
      this.validateAttributeValues(deltaAttrs, applicableSchema);
      this.validateLinkedSelects(mergedAttrs, applicableSchema, delta);

      // El tipo es inmutable, pero `categoryId` puede cambiar: el tipo ya fijado
      // debe seguir siendo válido en la categoría destino.
      if (dto.categoryId !== undefined) {
        this.validateListingTypeAllowed(existing.type, cadena);
      }
    }

    // Formato de precio (RP.1) — mismo grandfathering: sólo se revalida si se
    // TOCA el formato, o si el anuncio se mueve a otra categoría.
    if (dto.priceUnit !== undefined || dto.categoryId !== undefined) {
      this.validatePriceUnitAllowed(dto.priceUnit ?? existing.priceUnit, cadena);
    }

    // B2 — TAGS, con una asimetría deliberada entre los dos disparadores:
    //
    //  · `dto.tags` presente → se ELIGIERON: se validan estrictos contra la nueva
    //    categoría y el tope vigente. Un tag ajeno o pasarse del tope es un 422.
    //  · sólo cambia `categoryId` → nadie eligió romper nada, se movió el
    //    anuncio. Los tags que la categoría destino no ofrece se PODAN en
    //    silencio, para no obligar a limpiar tags a mano antes de poder mover.
    if (dto.tags !== undefined) {
      tagIds = await this.tags.resolveTagsForListing(dto.tags, category.slug);
    } else if (dto.categoryId !== undefined) {
      const actuales = await this.prisma.listingTag.findMany({
        where: { listingId },
        select: { tagId: true },
      });
      tagIds = await this.tags.pruneTagsForCategory(
        actuales.map((t) => t.tagId),
        category.slug,
      );
    }

    return tagIds;
  }

  // ─── Los validadores, movidos verbatim desde `ListingsService` ─────────────
  //
  // Son envoltorios finos sobre las funciones puras de `attribute-validation.ts`
  // y `category.types.ts`: lo que se mueve es dónde viven, no lo que hacen.
  // `create()` los sigue usando desde aquí, así que tampoco hay dos copias por
  // ese lado.

  validateRequired(attributes: Record<string, unknown>, schema: AttributeField[]): void {
    const missing = missingRequiredNames(attributes, schema);
    if (missing.length) {
      throw new UnprocessableEntityException(
        `Atributos requeridos faltantes: ${missing.join(', ')}`,
      );
    }
  }

  /**
   * Claves desconocidas, opciones de select PLANO y tipo de dato. Los selects
   * vinculados (`dependsOn`) se saltan aquí — los valida `validateLinkedSelects`.
   * Presencia/required-ness es trabajo de `validateRequired`.
   */
  validateAttributeValues(attributes: Record<string, unknown>, schema: AttributeField[]): void {
    const unknown = unknownAttributeKeys(attributes, schema);
    if (unknown.length) {
      throw new UnprocessableEntityException(`Atributos no reconocidos: ${unknown.join(', ')}`);
    }
    // El primero, no todos: quien edita corrige de uno en uno.
    const [primero] = invalidValueIssues(attributes, schema);
    if (primero) throw new UnprocessableEntityException(primero.message);
  }

  /**
   * Una clave cuenta como «delta» si su valor entrante difiere del guardado, o es
   * nueva. Una clave reenviada con el MISMO valor no es delta — así se puede
   * recibir el bag completo sin re-validar datos preexistentes que nadie toca.
   */
  computeAttributesDelta(
    existingAttrs: Record<string, unknown>,
    incomingAttrs: Record<string, unknown>,
  ): Set<string> {
    const changed = new Set<string>();
    for (const [key, value] of Object.entries(incomingAttrs)) {
      if (
        !Object.prototype.hasOwnProperty.call(existingAttrs, key) ||
        JSON.stringify(existingAttrs[key]) !== JSON.stringify(value)
      ) {
        changed.add(key);
      }
    }
    return changed;
  }

  validateLinkedSelects(
    attributes: Record<string, unknown>,
    schema: AttributeField[],
    deltaKeys?: Set<string>,
  ): void {
    const [primero] = linkedSelectIssues(attributes, schema, deltaKeys);
    if (primero) throw new UnprocessableEntityException(primero.message);
  }

  /** El tipo del anuncio contra la política EFECTIVA de su cadena de categorías. */
  validateListingTypeAllowed(type: ListingType, cadena: CategoryNode[]): void {
    const effective = cadena.reduce<ListingTypePolicy>(
      (acc, nodo) => resolveEffectivePolicy(nodo.allowedListingType, acc),
      'BOTH',
    );
    if (!isListingTypeAllowed(effective, type)) {
      throw new UnprocessableEntityException(
        `Esta categoría no admite anuncios de tipo ${type}.`,
      );
    }
  }

  /**
   * El formato de precio contra la lista EFECTIVA de la cadena. La semilla es
   * `null` y no la lista propia: `resolveEffectivePriceUnits` es un override, así
   * que meter la del hijo como fallback del padre haría que un ancestro sin
   * configurar tapara el default global.
   *
   * El `as PriceUnit[]` sobre un posible `null` se conserva TAL CUAL estaba: el
   * default lo resuelve `isPriceUnitAllowed`, y «byte-idéntico para el dueño»
   * significa no mejorar de paso lo que no se vino a tocar.
   */
  validatePriceUnitAllowed(unit: PriceUnit, cadena: CategoryNode[]): void {
    const effective = cadena.reduce<PriceUnit[] | null>(
      (acc, nodo) => resolveEffectivePriceUnits(nodo.allowedPriceUnits, acc),
      null,
    ) as PriceUnit[];
    if (!isPriceUnitAllowed(effective, unit)) {
      throw new UnprocessableEntityException(
        `Esta categoría no admite el formato de precio ${unit}.`,
      );
    }
  }
}
