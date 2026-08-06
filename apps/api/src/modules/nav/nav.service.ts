import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { NavItemType, NavPageType, PostType } from '@prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { isAbsoluteHttpUrl } from '../../common/validators/safe-url';
import { NAV_MAX_DEPTH, pruneNavTree, type NavItemNode, type NavNode } from './nav.types';

// Lo que la poda necesita de la página enlazada: el slug para construir el href
// y el status para saber si ese href cuenta (ver resolveHref en nav.types.ts).
const PAGE_FOR_PRUNE = { select: { slug: true, status: true } } as const;

// Como el footer, el admin ve además el título y el id (para el selector) — y a
// diferencia del público, ve TODO sin filtrar, incluido el status en borrador,
// que la UI pinta como badge "en borrador — no se muestra".
const PAGE_FOR_ADMIN = { select: { id: true, title: true, slug: true, status: true } } as const;

/**
 * Navegación principal (RN.1) — barra bajo el header del sitio público.
 *
 * En esta ráfaga el servicio solo LEE y VALIDA: los endpoints, la auditoría y la
 * revalidación de caché llegan en RN.2, que es quien cablea los `assert*` en las
 * mutaciones. Por eso el constructor solo pide Prisma: inyectar aquí un
 * AuditLogService que todavía no registra nada sería ruido.
 *
 * Ver docs/diseno-nav-dinamico.md.
 */
@Injectable()
export class NavService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Público ──────────────────────────────────────────────────────────────

  /**
   * Árbol visible para un tipo de página, YA podado, ordenado y con el href
   * resuelto server-side — el frontend solo mapea, no reimplementa la semántica
   * de los tipos de destino (mismo contrato que FooterService.listPublicNav).
   *
   * Un array vacío significa que la barra no debe renderizarse en absoluto.
   *
   * Una sola query trae el árbol entero (son decenas de filas, no miles) y la
   * poda corre en memoria: el gate es recursivo y necesita ver a los hijos antes
   * de decidir sobre el padre, así que no se puede expresar como un WHERE.
   */
  async listPublicNav(pageType: NavPageType): Promise<NavNode[]> {
    const roots = await this.findTree();
    return pruneNavTree(roots, pageType);
  }

  // ── Admin: lectura ───────────────────────────────────────────────────────

  /**
   * Estructura completa sin filtrar — a diferencia de listPublicNav incluye
   * nodos inactivos, nodos cuya página está en borrador y nodos temporalmente
   * inválidos (sin destino y sin hijos), porque el admin necesita verlos para
   * arreglarlos. Mismo criterio que FooterService.adminListStructure.
   */
  adminListStructure() {
    return this.prisma.navItem.findMany({
      where: { parentId: null },
      orderBy: { order: 'asc' },
      include: {
        page: PAGE_FOR_ADMIN,
        children: {
          orderBy: { order: 'asc' },
          include: { page: PAGE_FOR_ADMIN },
        },
      },
    });
  }

  // ── Validación de escritura (la cablea RN.2) ─────────────────────────────

  /**
   * Coherencia del destino. Vive en el SERVICIO y no en el DTO — mismo estilo
   * que FooterService.assertItemDestination y que Post.assertFooterFieldsAllowed:
   * el DTO valida la forma de cada campo por separado, esto valida la
   * combinación, que Prisma no comprueba y para la que no hay CHECK de schema.
   *
   * Dos casos, y el segundo es lo que separa este sistema del footer:
   *
   *  - CON destino (type != null): exactamente las mismas reglas que el footer.
   *  - SIN destino (type == null): se ACEPTA. Un nodo solo-desplegable es
   *    legítimo. Que además deba tener hijos para servir de algo NO se
   *    comprueba aquí a propósito: el padre nace siempre antes que su primer
   *    hijo, así que rechazarlo haría imposible construir un desplegable. El
   *    invariante ("nunca se pinta un nodo que no lleva ni abre nada") lo
   *    garantiza el gate en cada lectura, no un 400 en la escritura.
   *    Ver diseño §2.3.
   */
  assertItemDestination(type: NavItemType | null | undefined, pageId?: string, url?: string): void {
    if (type === null || type === undefined) {
      // Nodo sin destino: ni pageId ni url tienen dónde aplicarse. Aceptar
      // basura ahí dejaría un destino fantasma que reaparecería al asignarle un
      // type más tarde.
      if (pageId) throw new BadRequestException('pageId debe ir vacío en un nodo sin destino');
      if (url) throw new BadRequestException('url debe ir vacío en un nodo sin destino');
      return;
    }

    if (type === NavItemType.PAGE) {
      if (!pageId) throw new BadRequestException('pageId es obligatorio cuando type=PAGE');
      if (url) throw new BadRequestException('url debe ir vacío cuando type=PAGE');
      return;
    }

    if (type === NavItemType.INTERNAL) {
      if (!url) throw new BadRequestException('url es obligatorio cuando type=INTERNAL');
      if (!url.startsWith('/')) throw new BadRequestException('Una ruta interna debe empezar por "/"');
      if (pageId) throw new BadRequestException('pageId debe ir vacío cuando type=INTERNAL');
      return;
    }

    // EXTERNAL
    if (!url) throw new BadRequestException('url es obligatorio cuando type=EXTERNAL');
    if (!isAbsoluteHttpUrl(url)) {
      throw new BadRequestException('url debe ser una URL absoluta (http/https) cuando type=EXTERNAL');
    }
    if (pageId) throw new BadRequestException('pageId debe ir vacío cuando type=EXTERNAL');
  }

  /**
   * El destino PAGE debe apuntar a un Post real de type=PAGE — nunca a un POST
   * de blog (namespace de URL distinto: /paginas/ vs /blog/) ni a un id
   * inexistente (sin esto, el INSERT chocaría con NavItem.page, onDelete:
   * Restrict, como un 500 sin controlar). Calcado de
   * FooterService.assertPageDestination.
   *
   * NO se exige que la página esté PUBLISHED: enlazar una página en borrador es
   * un flujo legítimo (se prepara el menú antes de publicar). Es el GATE quien
   * decide en lectura si ese destino cuenta — y gracias a eso un nodo cuya
   * página está en borrador puede seguir vivo como solo-desplegable si tiene
   * hijos visibles.
   */
  async assertPageDestination(pageId: string): Promise<void> {
    const page = await this.prisma.post.findUnique({ where: { id: pageId }, select: { type: true } });
    if (!page) throw new NotFoundException('Página no encontrada');
    if (page.type !== PostType.PAGE) {
      throw new BadRequestException('pageId debe apuntar a una página informativa (type=PAGE), no a un post de blog');
    }
  }

  /**
   * Tope de profundidad (NAV_MAX_DEPTH = 2: raíz → hijo). Molde:
   * AdminService.assertParentIsRoot, con una comprobación de más que allí no
   * hace falta.
   *
   * Son DOS reglas, no una, porque aquí sí se puede mover un nodo de padre (en
   * categorías el padre es inmutable tras crear):
   *   a) el padre destino no puede ser ya un hijo — si no, el nuevo nodo caería
   *      a profundidad 3;
   *   b) el nodo que se mueve no puede arrastrar hijos — sus hijos caerían a
   *      profundidad 3 aunque él quepa en 2.
   *
   * `movingItemId` se omite al crear (un nodo nuevo no tiene hijos todavía).
   */
  async assertMaxDepth(parentId: string | null | undefined, movingItemId?: string): Promise<void> {
    if (!parentId) return; // Pasa a raíz: siempre cabe.

    const parent = await this.prisma.navItem.findUnique({
      where: { id: parentId },
      select: { parentId: true, label: true },
    });
    if (!parent) throw new NotFoundException('Menú padre no encontrado');

    if (parent.parentId) {
      throw new BadRequestException(
        `No se puede colgar de "${parent.label}": ya es un submenú — el nav admite solo ${NAV_MAX_DEPTH} niveles (menú → submenú).`,
      );
    }

    if (movingItemId) {
      const childCount = await this.prisma.navItem.count({ where: { parentId: movingItemId } });
      if (childCount > 0) {
        throw new BadRequestException(
          `No se puede convertir en submenú: tiene ${childCount} submenú(s) que quedarían a un tercer nivel. Muévelos o bórralos primero.`,
        );
      }
    }
  }

  /**
   * Impide que un nodo cuelgue de sí mismo o de uno de sus descendientes, que
   * dejaría un ciclo huérfano: invisible para la lectura (no cuelga de ninguna
   * raíz) e imposible de arreglar desde la UI.
   *
   * Con NAV_MAX_DEPTH = 2 un ciclo es de hecho inalcanzable —assertMaxDepth ya
   * rechaza antes casi todas las formas de provocarlo—, pero el recorrido se
   * escribe genérico a propósito: si algún día sube el tope, esta guarda sigue
   * siendo correcta sin tocarla. El bucle está acotado por un contador, para que
   * un ciclo YA presente en los datos no lo cuelgue.
   */
  async assertNoCycle(itemId: string, parentId: string | null | undefined): Promise<void> {
    if (!parentId) return;
    if (parentId === itemId) {
      throw new BadRequestException('Un menú no puede colgar de sí mismo');
    }

    let cursor: string | null = parentId;
    for (let hops = 0; cursor && hops <= NAV_MAX_DEPTH + 1; hops++) {
      const node: { parentId: string | null } | null = await this.prisma.navItem.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      if (!node) return; // Padre inexistente: lo reporta assertMaxDepth, no esto.
      if (node.parentId === itemId) {
        throw new BadRequestException('Un menú no puede colgar de uno de sus propios submenús');
      }
      cursor = node.parentId;
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Carga el árbol entero en una sola query. El `include` anidado está acoplado
   * a NAV_MAX_DEPTH (un nivel de `children`) — exactamente igual que
   * CategoriesService.findTree, que tampoco anida un segundo `children`. Si el
   * tope subiera, este include es lo primero que hay que ampliar.
   */
  private async findTree(): Promise<NavItemNode[]> {
    const roots = await this.prisma.navItem.findMany({
      where: { parentId: null },
      orderBy: { order: 'asc' },
      select: {
        label: true,
        order: true,
        active: true,
        type: true,
        url: true,
        visibleOn: true,
        page: PAGE_FOR_PRUNE,
        children: {
          orderBy: { order: 'asc' },
          select: {
            label: true,
            order: true,
            active: true,
            type: true,
            url: true,
            visibleOn: true,
            page: PAGE_FOR_PRUNE,
          },
        },
      },
    });

    // El último nivel se cierra con `children: []` en vez de pedirlo a Prisma:
    // el tope son NAV_MAX_DEPTH niveles, así que un hijo no puede tener hijos.
    // Explícito y no implícito para que la poda reciba siempre la misma forma.
    return roots.map((root) => ({
      ...root,
      children: root.children.map((child) => ({ ...child, children: [] })),
    }));
  }
}
