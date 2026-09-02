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

  /**
   * El árbol público de categorías, RECURSIVO (PROFUNDIDAD N — RÁFAGA 3).
   *
   * Antes devolvía raíces + un nivel de `children` con un `select` anidado a
   * mano: una categoría de nivel 3 no llegaba al frontend, así que no tenía URL,
   * ni entraba en el sitemap, ni aparecía en ningún selector. Ahora se traen
   * todas las filas de una vez (decenas) y el árbol se monta en memoria.
   *
   * LA FORMA DE LA RESPUESTA NO CAMBIA para lo que ya existía: mismos campos,
   * mismo `children` anidado, mismo orden. Lo nuevo es que los hijos también
   * pueden tener hijos, y que cada nodo lleva `ancestorSlugs`.
   */
  async findTree() {
    const filas = await this.prisma.category.findMany({
      orderBy: { order: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        iconUrl: true,
        parentId: true,
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
      },
    });

    const hijosDe = new Map<string | null, typeof filas>();
    for (const fila of filas) {
      const lista = hijosDe.get(fila.parentId);
      if (lista) lista.push(fila);
      else hijosDe.set(fila.parentId, [fila]);
    }

    // PROFUNDIDAD N — RÁFAGA 3. Los efectivos se PLIEGAN EN LA RECURSIÓN, no se
    // piden por nodo.
    //
    // Es la misma operación que `efectivoSchema`/`efectivaPolitica`, pero
    // aprovechando que aquí se baja por el árbol: el efectivo del padre ya está
    // calculado cuando toca el hijo, así que cada nivel sólo aplica su propio
    // reductor sobre él. Pedírselo al lector por nodo costaría UNA CONSULTA POR
    // CATEGORÍA en el endpoint más caliente del frontend (lo consumen la portada,
    // la búsqueda y toda página de categoría) — y `findTree` ahora devuelve el
    // árbol entero, no dos niveles, así que ese coste crecía con el catálogo.
    // Aquí el total es UNA consulta, la de arriba.
    const montar = async (
      nodo: (typeof filas)[number],
      ancestorSlugs: string[],
      tagsHeredados: { id: string; slug: string; name: string }[],
      schemaHeredado: AttributeField[],
      politicaHeredada: ListingTypePolicy,
    ): Promise<Record<string, unknown>> => {
      const propio = (nodo.attributeSchema as unknown as AttributeField[]) ?? [];
      const effective = resolveEffectiveSchema(propio, schemaHeredado);
      const politica = resolveEffectivePolicy(nodo.allowedListingType, politicaHeredada);
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
      // B3 — tags EFECTIVOS: los propios MÁS los que vienen de arriba, con la
      // misma resolución (y el mismo orden: propios primero) que
      // `TagsService.effectiveTagsForCategory`. Se resuelve aquí y no en el
      // cliente para que la herencia tenga un solo sitio donde vivir.
      //
      // PROFUNDIDAD N — RÁFAGA 3: `tagsHeredados` baja YA PLEGADO por la
      // recursión, así que un bisnieto acumula los de sus tres ancestros. Antes
      // era una fusión de un salto — correcta entonces porque este endpoint sólo
      // devolvía dos niveles, y por eso se anotó como pendiente de esta ráfaga.
      const tagsPropios = nodo.tags.map((t) => t.tag);
      const tagsEfectivos = resolveEffectiveTags(tagsPropios, tagsHeredados);

      return {
        id: nodo.id,
        name: nodo.name,
        slug: nodo.slug,
        iconUrl: nodo.iconUrl,
        // A1 (URLs anidadas) — el slug del padre viaja en el propio nodo para que
        // ningún consumidor tenga que recorrer el árbol al revés buscando quién lo
        // tiene como hijo. Las raíces NO lo llevan (ausente = raíz).
        //
        // PROFUNDIDAD N — RÁFAGA 3: se conserva JUNTO a `ancestorSlugs`, no se
        // sustituye. `categoryPath()` acepta las dos formas a propósito, para que
        // los consumidores migren de uno en uno y para que un payload cacheado
        // sin el campo nuevo siga produciendo una URL válida.
        ...(ancestorSlugs.length > 0 ? { parentSlug: ancestorSlugs[ancestorSlugs.length - 1] } : {}),
        // La CADENA completa, de la raíz al padre inmediato. `[]` = raíz.
        ancestorSlugs,
        allowedListingType: politica,
        cardAttributes: effective.filter((f) => f.cardAttribute).map(toAttrDef),
        // RÁFAGA 2 (vista ampliada): hasta 6 atributos relevantes para la card ancha,
        // independiente de cardAttributes (que sigue limitado a 2 para la card compacta).
        wideCardAttributes: effective.filter((f) => f.wideCardAttribute).map(toAttrDef),
        allAttributes: effective.map(toAttrDef),
        tags: tagsEfectivos,
        children: await Promise.all(
          (hijosDe.get(nodo.id) ?? []).map((hijo) =>
            montar(hijo, [...ancestorSlugs, nodo.slug], tagsEfectivos, effective, politica),
          ),
        ),
      };
    };

    return Promise.all(
      (hijosDe.get(null) ?? []).map((raiz) => montar(raiz, [], [], [], 'BOTH')),
    );
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
    if (!category) throw new NotFoundException('Categoría no encontrada');

    // PROFUNDIDAD N — RÁFAGA 1. Los cuatro efectivos salen del PLIEGUE de la
    // cadena completa. Antes eran: schema fusionado con el del padre, y
    // vistas/formatos resueltos «en dos pasos» a mano (el padre contra `null`,
    // el hijo contra el efectivo del padre). Ese two-step era el 2-niveles
    // escrito a mano y desaparece aquí.
    const cadena = await this.tree.getAncestorChain(category.id);
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
      // A1 (URLs anidadas): la categoría padre, o null si esta es raíz.
      //
      // PROFUNDIDAD N — RÁFAGA 3: se CONSERVA junto a `ancestors`, no se
      // sustituye. La ficha de anuncio se cachea 5 min en Redis, así que tras
      // desplegar hay respuestas servidas sin el campo nuevo; y hay consumidores
      // que sólo necesitan el padre inmediato. Quitarlo habría roto los dos.
      parent: category.parent
        ? { slug: category.parent.slug, name: category.parent.name }
        : null,
      // PROFUNDIDAD N — RÁFAGA 3. La CADENA de ancestros, de la raíz al padre
      // inmediato (sin incluir esta categoría). `[]` = es raíz.
      //
      // Alimenta las tres cosas que con 2 niveles se derivaban del `parent`: la
      // URL canónica (/vehiculos/coches/deportivos), la miga completa y el path
      // aplanado del selector. Viaja resuelto desde aquí por el mismo motivo por
      // el que `parentSlug` viaja en cada hija del árbol: para que ningún
      // consumidor tenga que recorrer la jerarquía al revés.
      ancestors: cadena.slice(0, -1).map((n) => ({ slug: n.slug, name: n.name })),
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
