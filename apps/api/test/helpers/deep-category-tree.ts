import { PrismaClient, Prisma } from '@prisma/client';

/**
 * PROFUNDIDAD N — RÁFAGA 1. FIXTURE DE BD: una cadena REAL de 4 niveles.
 *
 * POR QUÉ ES UN HELPER Y NO VA EN `seed-test.ts` (restricción verificada).
 * Las categorías son datos ESTÁTICOS COMPARTIDOS: `cleanDb` las excluye a
 * propósito porque los workers de Jest corren suites en paralelo contra la misma
 * base, y varias suites dependen del recuento y del ORDEN de las raíces
 * sembradas — `seed-test.ts` llega a resetear `order` explícitamente para que un
 * `.first()` sea determinista. Añadir una raíz al seed puede desestabilizar
 * suites ajenas que no tienen nada que ver con esto.
 *
 * Creándolas por suite se encaja en la BARRERA 2 que ya existe
 * (`reset-categories-between-suites.ts`): fotografía los ids de categoría al
 * empezar la suite y borra el delta al terminar. Este fixture se limpia solo,
 * sin tocar ni una línea de esa barrera y sin `afterAll` propio.
 *
 * Los slugs llevan sufijo único por el mismo motivo: dos suites en paralelo no
 * pueden chocar en el índice único de `slug`.
 *
 * LA CONFIGURACIÓN ESTÁ REPARTIDA EN LOS 4 NIVELES A PROPÓSITO — es lo que hace
 * discriminante al fixture. Con datos de 2 niveles, una resolución que sube 1
 * nivel y una que sube N dan el MISMO resultado, así que ninguna aserción podría
 * distinguirlas (ver R1 en docs/auditoria-profundidad-categorias.md).
 */

export interface DeepCategoryTree {
  /** Nivel 1. Define `deRaiz` y `redefinido`, y restringe la política. */
  raiz: { id: string; slug: string };
  /** Nivel 2. Define `deNivel2`; configura vistas y formatos de precio. */
  nivel2: { id: string; slug: string };
  /** Nivel 3. Define `deNivel3` y REDEFINE `redefinido`. */
  nivel3: { id: string; slug: string };
  /** Nivel 4 (la hoja). Define `deBisnieto`. */
  bisnieto: { id: string; slug: string };
  /** Sufijo único de esta instancia — útil para construir slugs derivados. */
  sufijo: string;
}

const attr = (name: string, label: string, extra: Record<string, unknown> = {}) => ({
  name,
  label,
  type: 'text',
  filterable: true,
  required: false,
  ...extra,
});

/**
 * Crea raíz → nivel2 → nivel3 → bisnieto. La devuelve para que la suite pueda
 * colgar anuncios de la hoja o pedir cualquiera de los cuatro por la API.
 */
export async function createDeepCategoryTree(
  prisma: PrismaClient,
  etiqueta = 'prof',
): Promise<DeepCategoryTree> {
  const sufijo = `${etiqueta}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  const raiz = await prisma.category.create({
    data: {
      name: `Raíz ${sufijo}`,
      slug: `raiz-${sufijo}`,
      order: 900,
      attributeSchema: [
        attr('deRaiz', 'Sólo de la raíz'),
        attr('redefinido', 'Etiqueta de la RAÍZ'),
      ] as unknown as Prisma.InputJsonValue,
      // Restringe desde arriba: los tres descendientes son BOTH (neutro), así
      // que sólo llega al bisnieto si la política se pliega por toda la cadena.
      allowedListingType: 'PRODUCT_ONLY',
    },
    select: { id: true, slug: true },
  });

  const nivel2 = await prisma.category.create({
    data: {
      name: `Nivel2 ${sufijo}`,
      slug: `nivel2-${sufijo}`,
      order: 1,
      parentId: raiz.id,
      attributeSchema: [attr('deNivel2', 'Sólo del nivel 2')] as unknown as Prisma.InputJsonValue,
      // Vistas y formatos se configuran AQUÍ y no más abajo: los niveles 3 y 4
      // no configuran nada, así que el bisnieto sólo los ve si hereda desde dos
      // niveles más arriba.
      allowedViews: ['LISTA', 'MAPA'],
      defaultView: 'MAPA',
      allowedPriceUnits: ['PER_MONTH'],
    },
    select: { id: true, slug: true },
  });

  const nivel3 = await prisma.category.create({
    data: {
      name: `Nivel3 ${sufijo}`,
      slug: `nivel3-${sufijo}`,
      order: 1,
      parentId: nivel2.id,
      attributeSchema: [
        attr('deNivel3', 'Sólo del nivel 3'),
        // Redefine el de la raíz: comprueba que el MÁS PROFUNDO gana.
        attr('redefinido', 'Etiqueta del NIVEL 3'),
      ] as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, slug: true },
  });

  const bisnieto = await prisma.category.create({
    data: {
      name: `Bisnieto ${sufijo}`,
      slug: `bisnieto-${sufijo}`,
      order: 1,
      parentId: nivel3.id,
      attributeSchema: [attr('deBisnieto', 'Sólo del bisnieto')] as unknown as Prisma.InputJsonValue,
    },
    select: { id: true, slug: true },
  });

  return { raiz, nivel2, nivel3, bisnieto, sufijo };
}
