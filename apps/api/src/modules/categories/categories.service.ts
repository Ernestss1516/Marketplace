import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  AttributeField,
  resolveEffectiveSchema,
  resolveEffectivePolicy,
  resolveEffectiveViews,
  resolveEffectivePriceUnits,
  resolveShowLabel,
  resolveShowUnit,
} from './category.types';

@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async findTree() {
    const roots = await this.prisma.category.findMany({
      where: { parentId: null },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        iconUrl: true,
        attributeSchema: true,
        // A2 — necesario para resolver la política efectiva de cada nodo (abajo).
        allowedListingType: true,
        children: {
          orderBy: { order: 'asc' },
          select: {
            id: true, name: true, slug: true, iconUrl: true, attributeSchema: true,
            allowedListingType: true,
          },
        },
      },
    });

    return roots.map((root) => {
      const rootSchema = (root.attributeSchema as unknown as AttributeField[]) ?? [];
      const toAttrDef = (f: AttributeField) => ({
        key: f.name,
        label: f.label,
        ...(f.unit !== undefined ? { unit: f.unit } : {}),
        // A2 (unificación de búsqueda) — si este atributo vale como filtro. Lo necesita
        // el frontend para decidir qué query params sobreviven al cambiar de categoría:
        // desde RÁFAGA 1 el backend RECHAZA con 400 cualquier param que no sea filtrable
        // en la categoría pedida (la defensa anti-leak cross-categoría), así que arrastrar
        // un atributo ajeno al destino rompería la página. `allAttributes` incluye también
        // los filterable:false, y mandar uno de esos da 400 igual — de ahí que haga falta
        // el flag y no baste la lista. Ver lib/filter-carry.ts en el frontend.
        filterable: f.filterable,
        // A3 (panel de filtros schema-driven) — CÓMO se pinta el filtro, no solo que
        // exista. Sin `type` el panel no sabe si un atributo es un select, un booleano
        // o un número, y los pintaba todos igual: chips con el valor crudo. Con
        // `options` la sección puede mostrar TODAS las opciones configuradas (aunque
        // ninguna tenga anuncios), y con `dependsOn`/`optionsByParent` puede acotar un
        // select vinculado por el valor de su padre.
        //
        // `GET /categories/:slug` ya devolvía el `attributeSchema` completo, así que la
        // ruta de categoría no lo necesitaba; el árbol sí, porque es la única fuente de
        // /busqueda sin categoría y de la unión de una raíz con sus hijas.
        type: f.type,
        ...(f.options !== undefined ? { options: f.options } : {}),
        ...(f.dependsOn !== undefined ? { dependsOn: f.dependsOn } : {}),
        ...(f.optionsByParent !== undefined ? { optionsByParent: f.optionsByParent } : {}),
        // RÁFAGA 3 — resueltos aquí (no en el frontend) para que "cómo se muestra" sea
        // el mismo dato para card estándar, ampliada y cualquier futuro consumidor.
        showLabel: resolveShowLabel(f),
        showUnit: resolveShowUnit(f),
        // ATRIBUTOS EN CARD — respetar producto/servicio: se propaga tal cual (ausente =
        // aplica a ambos) para que el frontend pueda filtrar cada card por el `type` del
        // anuncio concreto que renderiza — antes se perdía aquí y ninguna card lo filtraba.
        ...(f.appliesTo !== undefined ? { appliesTo: f.appliesTo } : {}),
      });
      // A2 — política EFECTIVA, misma resolución en dos pasos que findBySlug: la raíz
      // resuelve contra 'BOTH' (no tiene padre) y la hija contra el efectivo de la raíz.
      // El frontend la usa para decidir si `condition` sobrevive al cambiar de categoría
      // (un servicio no tiene estado de conservación) — ver lib/filter-carry.ts.
      const rootPolicy = resolveEffectivePolicy(root.allowedListingType, 'BOTH');
      return {
        id: root.id,
        name: root.name,
        slug: root.slug,
        iconUrl: root.iconUrl,
        allowedListingType: rootPolicy,
        cardAttributes: rootSchema.filter((f) => f.cardAttribute).map(toAttrDef),
        // RÁFAGA 2 (vista ampliada): hasta 6 atributos relevantes para la card ancha,
        // independiente de cardAttributes (que sigue limitado a 2 para la card compacta).
        wideCardAttributes: rootSchema.filter((f) => f.wideCardAttribute).map(toAttrDef),
        allAttributes: rootSchema.map(toAttrDef),
        children: root.children.map((child) => {
          const childSchema = (child.attributeSchema as unknown as AttributeField[]) ?? [];
          const effective = resolveEffectiveSchema(childSchema, rootSchema);
          return {
            id: child.id,
            name: child.name,
            slug: child.slug,
            // A1 (URLs anidadas) — el slug del padre viaja en la propia hija para que
            // ningún consumidor tenga que recorrer el árbol al revés buscando quién la
            // tiene como hija. `categoryPath()` del frontend lo lee directamente; sin
            // esto, cada generador de URL (11 de ellos) resolvería el padre por su
            // cuenta y podrían divergir. Las raíces NO lo llevan (ausente = raíz).
            parentSlug: root.slug,
            iconUrl: child.iconUrl,
            allowedListingType: resolveEffectivePolicy(child.allowedListingType, rootPolicy),
            cardAttributes: effective.filter((f) => f.cardAttribute).map(toAttrDef),
            wideCardAttributes: effective.filter((f) => f.wideCardAttribute).map(toAttrDef),
            allAttributes: effective.map(toAttrDef),
          };
        }),
      };
    });
  }

  async findBySlug(slug: string) {
    const category = await this.prisma.category.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        attributeSchema: true,
        allowedListingType: true,
        allowedViews: true,
        defaultView: true,
        allowedPriceUnits: true,
        parent: {
          select: {
            // A1 (URLs anidadas) — `slug` y `name` son NUEVOS aquí. La relación ya se
            // cargaba, pero solo para resolver herencia; nada de ella salía en la
            // respuesta, y por eso el breadcrumb de /[...ruta] no podía enseñar el padre
            // (el dato no llegaba, no era un olvido de la vista).
            slug: true,
            name: true,
            attributeSchema: true,
            allowedListingType: true,
            allowedViews: true,
            defaultView: true,
            allowedPriceUnits: true,
          },
        },
      },
    });
    if (!category) throw new NotFoundException('Category not found');

    const own = (category.attributeSchema as unknown as AttributeField[]) ?? [];
    const parentSchema = (category.parent?.attributeSchema as unknown as AttributeField[]) ?? [];
    const effectiveSchema = resolveEffectiveSchema(own, parentSchema);

    const toAttrDef = (f: AttributeField) => ({
      key: f.name,
      label: f.label,
      ...(f.unit !== undefined ? { unit: f.unit } : {}),
      showLabel: resolveShowLabel(f),
      showUnit: resolveShowUnit(f),
      ...(f.appliesTo !== undefined ? { appliesTo: f.appliesTo } : {}),
    });

    // RÁFAGA 2 — vistas: el padre resuelve primero contra `null` (2 niveles, sin abuelo),
    // luego el hijo resuelve contra el efectivo del padre. Mismo patrón que allowedListingType.
    const parentEffectiveViews = category.parent
      ? resolveEffectiveViews(
          { allowedViews: category.parent.allowedViews, defaultView: category.parent.defaultView },
          null,
        )
      : null;
    const effectiveViews = resolveEffectiveViews(
      { allowedViews: category.allowedViews, defaultView: category.defaultView },
      parentEffectiveViews,
    );

    // RP.1 — formatos de precio: misma resolución en dos pasos que las vistas.
    // El padre resuelve primero contra `null` (2 niveles, sin abuelo) para que un
    // padre sin config propia caiga al default global en vez de tapar al hijo.
    const parentEffectivePriceUnits = category.parent
      ? resolveEffectivePriceUnits(category.parent.allowedPriceUnits, null)
      : null;
    const effectivePriceUnits = resolveEffectivePriceUnits(
      category.allowedPriceUnits,
      parentEffectivePriceUnits,
    );

    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      // A1 (URLs anidadas): la categoría padre, o null si esta es raíz. Alimenta el
      // breadcrumb (Inicio > Vehículos > Coches), la URL canónica y `categoryPath()`.
      // Aditivo: ningún consumidor anterior lo lee.
      parent: category.parent
        ? { slug: category.parent.slug, name: category.parent.name }
        : null,
      // backward-compat: same field name; now returns the merged effective schema
      attributeSchema: effectiveSchema,
      // RÁFAGA 2 (vista ampliada en /[categoria])
      wideCardAttributes: effectiveSchema.filter((f) => f.wideCardAttribute).map(toAttrDef),
      // RÁFAGA 3 (wizard): política efectiva para que el wizard sepa si debe
      // preguntar el tipo (BOTH) o fijarlo sin preguntar (PRODUCT_ONLY/SERVICE_ONLY).
      allowedListingType: resolveEffectivePolicy(
        category.allowedListingType,
        category.parent?.allowedListingType ?? 'BOTH',
      ),
      // RÁFAGA 2: vistas efectivamente ofrecidas por esta categoría + su default.
      allowedViews: effectiveViews.allowedViews,
      defaultView: effectiveViews.defaultView,
      // RP.1 (formatos de precio): lista efectiva para que el wizard sepa qué
      // formatos ofrecer — y si es de un solo elemento, no preguntar nada.
      allowedPriceUnits: effectivePriceUnits,
    };
  }
}
