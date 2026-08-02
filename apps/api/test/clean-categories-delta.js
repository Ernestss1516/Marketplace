// BARRERA 2, lado Playwright: la batería de Playwright tampoco deja categorías
// detrás.
//
// En la batería de Jest esto lo resuelve `reset-categories-between-suites.ts`,
// enganchado a `setupFilesAfterEnv` (corre por cada archivo de test). Playwright
// no tiene ese punto de enganche —sus specs corren en un proceso aparte del
// runner y hablan con la app por HTTP, no por Prisma—, así que aquí la limpieza
// va en el globalTeardown: se fotografían los ids de categoría al arrancar
// (global-setup) y se borra la diferencia al terminar (global-teardown).
//
// Es menos fino que el de Jest (limpia al final de la corrida, no al final de
// cada spec), y a propósito: dentro de una corrida de Playwright los specs que
// crean categorías usan slugs con timestamp, así que no se pisan entre ellos. Lo
// que hacía daño era el arrastre ENTRE corridas, y eso sí lo cierra.
//
// Medido antes de esto: una corrida completa de Playwright dejaba ~20 categorías
// (y 229 acumuladas de `producto-servicio-flujo` a lo largo de la sesión).
//
// CommonJS y en apps/api por lo mismo que reset-test-db.js: lo consume el
// globalSetup/globalTeardown de Playwright vía `node`, y así vive junto al resto
// de la infraestructura de test compartida.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SNAPSHOT = path.join(os.tmpdir(), 'marketplace-categorias-al-empezar.json');

/** Guarda los ids de categoría existentes ahora. Lo llama el globalSetup. */
async function snapshot() {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const filas = await prisma.category.findMany({ select: { id: true } });
    fs.writeFileSync(SNAPSHOT, JSON.stringify(filas.map((f) => f.id)));
    console.log(`[clean-categories-delta] foto tomada: ${filas.length} categorías al empezar.`);
  } finally {
    await prisma.$disconnect();
  }
}

/** Borra las categorías que no estaban en la foto. Lo llama el globalTeardown. */
async function cleanDelta() {
  if (!fs.existsSync(SNAPSHOT)) return;

  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const antes = new Set(JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8')));
    const filas = await prisma.category.findMany({ select: { id: true } });
    const ids = filas.map((f) => f.id).filter((id) => !antes.has(id));
    if (ids.length === 0) return;

    // Igual que en el lado de Jest: lo que apunta a una categoría va primero
    // (la relación es obligatoria, Prisma la protege con RESTRICT), y las hijas
    // antes que los padres.
    await prisma.sponsoredAd.deleteMany({ where: { categoryId: { in: ids } } });
    await prisma.listing.deleteMany({ where: { categoryId: { in: ids } } });
    await prisma.category.deleteMany({ where: { id: { in: ids }, parentId: { not: null } } });
    await prisma.category.deleteMany({ where: { id: { in: ids } } });
    console.log(`[clean-categories-delta] ${ids.length} categorías creadas por la corrida, borradas.`);
  } catch (err) {
    // Nunca tumbar la corrida por la limpieza: el globalSetup de la siguiente
    // trunca igualmente (Barrera 1). Se avisa y se sigue.
    console.warn(`[clean-categories-delta] no se pudo limpiar: ${err.message ?? err}`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(SNAPSHOT, { force: true });
  }
}

module.exports = { snapshot, cleanDelta };

if (require.main === module) {
  const modo = process.argv[2];
  const fn = modo === 'snapshot' ? snapshot : cleanDelta;
  fn()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exit(1);
    });
}
