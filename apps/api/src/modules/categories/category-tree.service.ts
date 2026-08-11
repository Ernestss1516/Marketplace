import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AttributeField } from './category.types';
import type { ListingTypePolicy, ListingViewMode, PriceUnit } from '@prisma/client';

/**
 * PROFUNDIDAD N — RÁFAGA 1. El ÚNICO sitio del sistema que recorre la jerarquía
 * de categorías.
 *
 * POR QUÉ EXISTE. Antes de esta ráfaga había ~13 sitios que subían un nivel cada
 * uno por su cuenta (`parent: { select: … }` repetido en 8 consultas, más los
 * recorridos de admin y tags). Con 2 niveles eso funcionaba porque «el padre» y
 * «la cadena» eran lo mismo. Con N niveles dejan de serlo, y un sitio que se
 * quede subiendo un nivel NO DA ERROR: simplemente el bisnieto no hereda del
 * abuelo, en silencio. Ese es el riesgo R1 de la auditoría, y la única defensa
 * estructural contra él es que haya UN lector: si sube bien, suben todos; si
 * sube mal, fallan todos a la vez — y eso se ve.
 *
 * Mismo criterio que `bump-cooldown.ts` (la ventana se define donde se aplica y
 * se sirve ya resuelta) y que `category-url.ts` en el frontend (única fuente de
 * la URL de categoría, después de haber tenido 11 generadores divergentes).
 *
 * MÓDULO HOJA, a propósito. Vive en su propio `CategoryTreeModule`, que no
 * importa ningún módulo de dominio (`PrismaModule` es `@Global`). No podía ir en
 * `CategoriesModule`: ese YA importa `ListingsModule` y `TagsModule`, y los dos
 * necesitan este servicio — habría sido un ciclo. Molde:
 * `ListingActivationModule`, que por lo mismo es un módulo de 11 líneas
 * compartido por `ListingsModule` y `ModerationModule`.
 *
 * DOS POLÍTICAS DE FRESCURA, EXPLÍCITAS EN EL PUNTO DE USO. El algoritmo de la
 * cadena es UNO (`ancestorChainIn`, función pura); lo que cambia es sobre qué
 * foto del árbol se aplica, y cada llamante elige la que ya tenía:
 *
 *  · `getAncestorChain` y compañía leen FRESCO: una consulta por llamada, que
 *    es EXACTAMENTE la que ya hacían los sitios que sustituyen (el
 *    `findUnique` con `parent` de un nivel). Ningún llamante gana una consulta,
 *    y ninguno pierde la frescura que tenía: `GET /categories/:slug` sigue
 *    viendo al instante una categoría recién creada.
 *
 *  · `getSnapshot()` devuelve una foto MEMOIZADA, y es la que usa
 *    `FilterableAttributesResolver` — que ya funcionaba así antes de esta
 *    ráfaga y está en la ruta caliente de la búsqueda, donde una consulta por
 *    petición sí se notaría en un proyecto read-heavy.
 *
 * Se traen decenas de filas en vez de dos: es el mismo razonamiento por el que
 * `TagsService` cachea el vocabulario entero, y por el que el resolver ya
 * cargaba el árbol completo de una vez.
 *
 * LÍMITE HEREDADO de la foto memoizada (no lo introduce ni lo resuelve esta
 * ráfaga): es POR PROCESO. Un despliegue multi-instancia necesitaría pub/sub
 * para invalidar en todas. Ya estaba documentado en el resolver antes de este
 * cambio; lo único que cambia es que ahora vive en un sitio en vez de en dos.
 */

/**
 * La CADENA raíz→hoja dentro de una foto del árbol. Función PURA: es el único
 * algoritmo que sube la jerarquía, y las dos políticas de frescura lo comparten.
 *
 * El contador de vueltas NO es paranoia decorativa: `Category.parentId` es una
 * auto-relación sin restricción de ciclo en la base (no hay CHECK, y la FK
 * admite cualquier id). Hoy un ciclo es imposible porque el padre se fija al
 * crear y no se puede cambiar (ver `UpdateCategoryDto`), pero este bucle es
 * exactamente donde un ciclo colgaría el proceso entero, así que se corta.
 */
export function ancestorChainIn(
  byId: ReadonlyMap<string, CategoryNode>,
  categoryId: string,
): CategoryNode[] {
  const cadena: CategoryNode[] = [];
  let actual = byId.get(categoryId);
  let vueltas = 0;
  while (actual && vueltas < byId.size + 1) {
    cadena.push(actual);
    actual = actual.parentId ? byId.get(actual.parentId) : undefined;
    vueltas++;
  }
  return cadena.reverse();
}

/** Todos los descendientes de una categoría dentro de una foto. Función pura. */
export function descendantIdsIn(
  byId: ReadonlyMap<string, CategoryNode>,
  categoryId: string,
): string[] {
  const hijos = new Map<string | null, string[]>();
  for (const nodo of byId.values()) {
    const lista = hijos.get(nodo.parentId);
    if (lista) lista.push(nodo.id);
    else hijos.set(nodo.parentId, [nodo.id]);
  }

  const salida: string[] = [];
  const pendientes = [categoryId];
  while (pendientes.length > 0) {
    const actual = pendientes.pop()!;
    for (const hijo of hijos.get(actual) ?? []) {
      salida.push(hijo);
      pendientes.push(hijo);
    }
  }
  return salida;
}

/** Un nodo del árbol, con todo lo que las 5 resoluciones necesitan. */
export interface CategoryNode {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  attributeSchema: AttributeField[];
  allowedListingType: ListingTypePolicy;
  allowedViews: ListingViewMode[];
  defaultView: ListingViewMode | null;
  allowedPriceUnits: PriceUnit[];
}

@Injectable()
export class CategoryTreeService {
  /** Promesa memoizada: una carga en vuelo se comparte, no se duplica. */
  private cache: Promise<Map<string, CategoryNode>> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * La CADENA de ancestros, de la RAÍZ a la propia categoría (incluida).
   *
   * El orden raíz→hoja es una decisión, no un detalle: es el orden en el que se
   * PLIEGAN las 5 resoluciones (`reduce`, cada nivel sobreescribiendo a sus
   * ancestros) y el orden natural de la miga. Quien necesite el inverso
   * (`categoryPath` del documento de Meilisearch, los tags) lo invierte en su
   * punto de uso, y así queda visible que lo está haciendo.
   *
   * Una categoría inexistente devuelve `[]` — quien llama ya tiene su propio
   * 404 y no le sirve una excepción distinta desde aquí.
   */
  async getAncestorChain(categoryId: string): Promise<CategoryNode[]> {
    return ancestorChainIn(await this.loadFresh(), categoryId);
  }

  /** Igual que `getAncestorChain`, por slug — varias rutas entran por slug. */
  async getAncestorChainBySlug(slug: string): Promise<CategoryNode[]> {
    const byId = await this.loadFresh();
    const node = [...byId.values()].find((n) => n.slug === slug);
    return node ? ancestorChainIn(byId, node.id) : [];
  }

  /**
   * Todos los descendientes, a cualquier profundidad (sin incluir la propia).
   *
   * Lo consumen los guards de admin y los filtros que hoy miran «hijas
   * directas»: con 2 niveles «hijas» y «descendientes» eran lo mismo, y con N
   * dejan de serlo. (Su uso en esos guards es RÁFAGA 2; aquí se define.)
   */
  async getDescendantIds(categoryId: string): Promise<string[]> {
    return descendantIdsIn(await this.loadFresh(), categoryId);
  }

  /** Profundidad de una categoría (raíz = 1). `0` si no existe. */
  async getDepth(categoryId: string): Promise<number> {
    return (await this.getAncestorChain(categoryId)).length;
  }

  /** Hijos DIRECTOS de una categoría. */
  async getChildren(categoryId: string): Promise<CategoryNode[]> {
    const byId = await this.loadFresh();
    return [...byId.values()].filter((n) => n.parentId === categoryId);
  }

  /**
   * Foto MEMOIZADA del árbol. La usa `FilterableAttributesResolver`, que está en
   * la ruta caliente de la búsqueda y ya funcionaba así antes de esta ráfaga.
   * Quien necesite frescura usa los métodos de arriba.
   */
  async getSnapshot(): Promise<ReadonlyMap<string, CategoryNode>> {
    if (!this.cache) this.cache = this.loadFresh();
    return this.cache;
  }

  /**
   * Fuerza que la próxima lectura de `getSnapshot()` recargue desde la BD. La
   * llama el mismo camino que ya invalidaba el mapa del resolver de búsqueda: el
   * job `refresh-filterable-attributes`, encolado al crear o editar una
   * categoría, más una invalidación síncrona en `AdminService` para que la
   * propia petición que escribe no siga viendo la foto vieja. No se añade un
   * tercer camino: habría varias verdades sobre cuándo el árbol está frío.
   */
  invalidate(): void {
    this.cache = null;
  }

  // ---------------------------------------------------------------------------
  // Interno
  // ---------------------------------------------------------------------------

  private loadFresh(): Promise<Map<string, CategoryNode>> {
    return this.prisma.category
      .findMany({
        select: {
          id: true,
          slug: true,
          name: true,
          parentId: true,
          attributeSchema: true,
          allowedListingType: true,
          allowedViews: true,
          defaultView: true,
          allowedPriceUnits: true,
        },
      })
      .then(
        (filas) =>
          new Map(
            filas.map((f) => [
              f.id,
              {
                ...f,
                attributeSchema: (f.attributeSchema as unknown as AttributeField[]) ?? [],
              } satisfies CategoryNode,
            ]),
          ),
      );
  }
}
