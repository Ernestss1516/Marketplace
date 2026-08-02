/**
 * BARRERA ESTRUCTURAL 2: ninguna suite deja categorías detrás, así que ninguna
 * envenena a la siguiente DENTRO de la misma corrida.
 *
 * Complementa a la Barrera 1 (reset-test-db.js), que limpia ENTRE corridas. Las
 * dos hacen falta: sin B1 la base crece para siempre; sin B2, dentro de una misma
 * corrida un spec que crea 24 categorías se las deja a los 80 siguientes.
 *
 * POR QUÉ AQUÍ Y NO UN afterAll EN CADA SPEC. La auditoría encontró 22 specs de
 * backend que crean categorías y solo 6 que borran algo. Añadir el teardown a
 * mano en los 16 restantes deja el problema resuelto HOY y abierto MAÑANA: el
 * spec número 91 volverá a olvidarlo, porque acordarse no es un mecanismo (mismo
 * criterio que e2e-lock.js y reset-redis-between-suites.ts). Como
 * `setupFilesAfterEnv` corre una vez por ARCHIVO de test, un `beforeAll`/`afterAll`
 * de nivel raíz aquí cubre las 90 suites que hay y las que se escriban después,
 * sin tocar ni una línea de ningún spec.
 *
 * CÓMO. Se fotografían los ids de categoría al empezar la suite y se borran los
 * que aparezcan al terminar. No borra las del seed (ya estaban en la foto), así
 * que las suites que dependen de `coches`/`moviles` siguen funcionando — que es
 * justo la razón por la que `cleanDb` excluye `Category` y por la que esto no
 * puede ser un simple TRUNCATE por suite.
 *
 * Orden de los hooks: un `beforeAll` de nivel raíz corre ANTES que los de
 * cualquier `describe`, y su `afterAll` DESPUÉS — así que la foto se toma antes
 * de que la suite cree nada y la limpieza pasa cuando ya ha terminado, incluso si
 * la suite tiene su propio teardown.
 *
 * LÍMITE CONOCIDO: una suite que creara categorías en el cuerpo del módulo (fuera
 * de todo hook) las tendría ya en la foto y no se limpiarían. Hoy no lo hace
 * ninguna: las que necesitan crearlas antes de `app.init()` lo hacen dentro de su
 * `beforeAll`, que sigue corriendo después de este.
 */

import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | null = null;
let idsAlEmpezar: Set<string> | null = null;

beforeAll(async () => {
  prisma = new PrismaClient();
  const filas = await prisma.category.findMany({ select: { id: true } });
  idsAlEmpezar = new Set(filas.map((f) => f.id));
});

afterAll(async () => {
  if (!prisma || !idsAlEmpezar) return;

  try {
    const filas = await prisma.category.findMany({ select: { id: true, parentId: true } });
    const nuevas = filas.filter((f) => !idsAlEmpezar!.has(f.id));
    if (nuevas.length === 0) return;

    const ids = nuevas.map((f) => f.id);

    // Lo que apunta a una categoría hay que quitarlo antes: la relación
    // Listing.category / SponsoredAd.category es obligatoria, así que Prisma la
    // protege con RESTRICT y el borrado fallaría.
    await prisma.sponsoredAd.deleteMany({ where: { categoryId: { in: ids } } });
    await prisma.listing.deleteMany({ where: { categoryId: { in: ids } } });

    // Hijas antes que padres (Category.parent apunta a Category): borrar un padre
    // con hijas vivas también sería RESTRICT. El árbol es de 2 niveles, así que
    // dos pasadas bastan.
    await prisma.category.deleteMany({
      where: { id: { in: ids }, parentId: { not: null } },
    });
    await prisma.category.deleteMany({ where: { id: { in: ids } } });
  } catch (err) {
    // Un fallo limpiando NO debe teñir de rojo una suite cuyas aserciones pasaron:
    // sería convertir un problema de fontanería en un fallo de producto. Se avisa
    // fuerte y con el nombre del fichero, que es lo accionable; y la garantía dura
    // (contar categorías al final de la corrida) sigue estando en la Barrera 1.
    console.warn(
      `[reset-categories-between-suites] no se pudieron limpiar las categorías de ` +
        `${expect.getState().testPath ?? 'esta suite'}: ${(err as Error).message}`,
    );
  } finally {
    await prisma.$disconnect();
    prisma = null;
    idsAlEmpezar = null;
  }
});
