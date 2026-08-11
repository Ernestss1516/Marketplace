import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { TagsService } from '../tags/tags.service';
import { resolveEffectiveTags } from '../tags/tag.types';
import { CategoryTreeService } from './category-tree.service';
import {
  AttributeField,
  resolveEffectiveSchema,
  resolveEffectivePolicy,
  resolveEffectiveViews,
  resolveEffectivePriceUnits,
  resolveShowLabel,
  resolveShowUnit,
  type EffectiveViews,
} from './category.types';
import type { ListingTypePolicy, PriceUnit } from '@prisma/client';

@Injectable()
export class CategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tagsService: TagsService,
    private readonly tree: CategoryTreeService,
  ) {}

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
        // B3 — etiquetas PROPIAS de cada nodo, solo activas. El frontend necesita saber
        // qué tags valen en la categoría destino para decidir si `?tags=` sobrevive al
        // cambio de categoría — exactamente el mismo motivo por el que `allAttributes`
        // vive aquí desde A2. La herencia se resuelve abajo, no en el cliente.
        tags: {
          where: { tag: { activo: true } },
          orderBy: { orden: 'asc' },
          select: { tag: { select: { id: true, slug: true, name: true } } },
        },
        children: {
          orderBy: { order: 'asc' },
          select: {
            id: true, name: true, slug: true, iconUrl: true, attributeSchema: true,
            allowedListingType: true,
            tags: {
              where: { tag: { activo: true } },
              orderBy: { orden: 'asc' },
              select: { tag: { select: { id: true, slug: true, name: true } } },
            },
          },
        },
      },
    });

    // PROFUNDIDAD N — RÁFAGA 1. La FORMA de esta respuesta sigue siendo de 2
    // niveles (raíces + `children`) y eso se generaliza en la RÁFAGA 3, que es
    // la que enseña el árbol completo al frontend. Lo que sí se generaliza aquí
    // es la HERENCIA: cada nodo resuelve plegando su cadena completa, no
    // fusionando con su padre. Para un árbol de 2 niveles las dos cosas dan el
    // mismo resultado — por eso esta ráfaga no cambia nada observable.
    return Promise.all(roots.map(async (root) => {
      const rootSchema = await this.efectivoSchema(root.id);
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
      // A2 — política EFECTIVA. El frontend la usa para decidir si `condition`
      // sobrevive al cambiar de categoría (un servicio no tiene estado de
      // conservación) — ver lib/filter-carry.ts.
      const rootPolicy = await this.efectivaPolitica(root.id);
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
        // B3 — una raíz no hereda de nadie: sus efectivos son los suyos.
        tags: root.tags.map((t) => t.tag),
        children: await Promise.all(root.children.map(async (child) => {
          const effective = await this.efectivoSchema(child.id);
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
            allowedListingType: await this.efectivaPolitica(child.id),
            cardAttributes: effective.filter((f) => f.cardAttribute).map(toAttrDef),
            wideCardAttributes: effective.filter((f) => f.wideCardAttribute).map(toAttrDef),
            allAttributes: effective.map(toAttrDef),
            // B3 — efectivos de la hija: los suyos MÁS los del padre, con la misma
            // resolución (y el mismo orden: propios primero) que
            // `TagsService.effectiveTagsForCategory`. Se resuelve aquí y no en el
            // cliente para que la herencia tenga un solo sitio donde vivir.
            //
            // PROFUNDIDAD N — RÁFAGA 1: esta es la ÚNICA resolución que aquí
            // sigue siendo de un salto, y NO es un olvido. La FORMA de esta
            // respuesta es de 2 niveles (raíces + `children`), así que los
            // únicos nodos que devuelve son de nivel 1 y 2 — y para ellos «los
            // del padre» ES la cadena entera. Cuando la RÁFAGA 3 haga el árbol
            // recursivo, esto pasa a plegarse como los demás; hasta entonces un
            // nivel 3 no se devuelve en absoluto, así que no puede devolverse
            // mal. Los tags no viajan en `CategoryNode` (viven en tablas
            // aparte), por eso no sale del mismo pliegue que el schema.
            tags: resolveEffectiveTags(
              child.tags.map((t) => t.tag),
              root.tags.map((t) => t.tag),
            ),
          };
        })),
      };
    }));
  }

  // ---------------------------------------------------------------------------
  // PROFUNDIDAD N — RÁFAGA 1: los pliegues
  //
  // Las 5 funciones de resolución son REDUCTORES `(propio, efectivoDelPadre) →
  // efectivo`. Sus cuerpos NO cambian con N niveles: lo que cambia es que en vez
  // de invocarlas UNA vez (padre → hijo) se PLIEGAN sobre la cadena raíz→hoja
  // que da `CategoryTreeService`.
  //
  // Con un árbol de 2 niveles el pliegue da EXACTAMENTE el mismo resultado que
  // la resolución en dos pasos que había antes (la cadena de una raíz es
  // `[raíz]`, la de una hija `[raíz, hija]`) — por eso esta ráfaga no cambia
  // nada observable. Con 4 niveles, el bisnieto hereda del abuelo.
  //
  // El patrón anterior —resolver el padre contra `null` y luego el hijo contra
  // el efectivo del padre, escrito a mano en cada llamante— DESAPARECE. Si
  // sobreviviera en algún sitio, ese sitio heredaría de un solo nivel sin dar
  // ningún error: es exactamente el riesgo R1, y por eso los pliegues viven
  // aquí y no repartidos.
  // ---------------------------------------------------------------------------

  private async efectivoSchema(categoryId: string): Promise<AttributeField[]> {
    const cadena = await this.tree.getAncestorChain(categoryId);
    return cadena.reduce<AttributeField[]>(
      (acc, nodo) => resolveEffectiveSchema(nodo.attributeSchema, acc),
      [],
    );
  }

  private async efectivaPolitica(categoryId: string): Promise<ListingTypePolicy> {
    const cadena = await this.tree.getAncestorChain(categoryId);
    return cadena.reduce<ListingTypePolicy>(
      (acc, nodo) => resolveEffectivePolicy(nodo.allowedListingType, acc),
      'BOTH',
    );
  }

  private async efectivasVistas(categoryId: string): Promise<EffectiveViews> {
    const cadena = await this.tree.getAncestorChain(categoryId);
    return cadena.reduce<EffectiveViews | null>(
      (acc, nodo) =>
        resolveEffectiveViews({ allowedViews: nodo.allowedViews, defaultView: nodo.defaultView }, acc),
      null,
    ) as EffectiveViews;
  }

  private async efectivosFormatosPrecio(categoryId: string): Promise<PriceUnit[]> {
    const cadena = await this.tree.getAncestorChain(categoryId);
    return cadena.reduce<PriceUnit[] | null>(
      (acc, nodo) => resolveEffectivePriceUnits(nodo.allowedPriceUnits, acc),
      null,
    ) as PriceUnit[];
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

    // PROFUNDIDAD N — RÁFAGA 1. Los cuatro efectivos salen del PLIEGUE de la
    // cadena completa. Antes eran: schema fusionado con el del padre, y
    // vistas/formatos resueltos «en dos pasos» a mano (el padre contra `null`,
    // el hijo contra el efectivo del padre). Ese two-step era el 2-niveles
    // escrito a mano y desaparece aquí.
    const effectiveSchema = await this.efectivoSchema(category.id);
    const effectiveViews = await this.efectivasVistas(category.id);
    const effectivePriceUnits = await this.efectivosFormatosPrecio(category.id);
    const effectivePolicy = await this.efectivaPolitica(category.id);

    const toAttrDef = (f: AttributeField) => ({
      key: f.name,
      label: f.label,
      ...(f.unit !== undefined ? { unit: f.unit } : {}),
      showLabel: resolveShowLabel(f),
      showUnit: resolveShowUnit(f),
      ...(f.appliesTo !== undefined ? { appliesTo: f.appliesTo } : {}),
    });

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
      allowedListingType: effectivePolicy,
      // RÁFAGA 2: vistas efectivamente ofrecidas por esta categoría + su default.
      allowedViews: effectiveViews.allowedViews,
      defaultView: effectiveViews.defaultView,
      // RP.1 (formatos de precio): lista efectiva para que el wizard sepa qué
      // formatos ofrecer — y si es de un solo elemento, no preguntar nada.
      allowedPriceUnits: effectivePriceUnits,
      // B1 — tags EFECTIVOS (propios + heredados, activos). Mismo criterio que
      // allowedViews/allowedPriceUnits: el wizard llama a este endpoint al elegir
      // categoría y no debe necesitar un segundo viaje para saber qué ofrecer.
      tags: await this.tagsService.effectiveTagsForCategory(slug),
      // B2 — el tope vigente, en la MISMA respuesta que los tags. Es un valor global,
      // no de la categoría, y aun así viaja aquí por lo mismo que `allowedPriceUnits`:
      // esta llamada es "todo lo que el wizard necesita para configurarse". La
      // alternativa era que el front escribiera un 5, que es exactamente la
      // divergencia con DEFAULT_MAX_TAGS_PER_LISTING que ya costó una ráfaga evitar.
      maxTags: await this.tagsService.getMaxTagsPerListing(),
    };
  }
}
