// BARRERA ESTRUCTURAL 1: cada corrida de la batería arranca con la base de test
// VACÍA, no con lo que dejó la corrida anterior.
//
// EL PROBLEMA QUE MATA. Ni el globalSetup de Jest ni el de Playwright borraban
// nada: hacían `migrate deploy` + un seed de upserts sobre lo que hubiera. Y
// `cleanDb` (la limpieza por suite) excluye `Category` y `Setting` a propósito —
// truncarlas destruiría el seed que las demás suites necesitan. Resultado: TODA
// categoría creada por un spec sobrevivía para siempre. Medido en la sesión de
// A1/A2: la base pasó de ~1.800 a 2.775 categorías donde el seed pone ~20, con
// 638 de `admin-price-units-policy`, 629 de `admin-category-views`, 592 de
// `admin-category-type-policy`… y specs que empezaban a fallar por la
// acumulación (el selector de categorías del wizard degradándose). La batería
// dejó de ser repetible: el conjunto de rojos cambiaba entre corridas, así que
// "verde" ya no significaba verde sin comparar con un baseline.
//
// La limpieza va DESPUÉS de `migrate deploy` (las tablas tienen que existir) y
// ANTES del seed (que vuelve a poner los datos deterministas).
//
// Se trunca TODA tabla del esquema salvo la de migraciones de Prisma, en vez de
// una lista escrita a mano: una lista hay que acordarse de actualizarla cuando se
// añade un modelo, y "acordarse" no es un mecanismo. Así, un modelo nuevo queda
// cubierto el día que se crea.
//
// CommonJS sin ts-node, igual que flush-redis-test-db.js: lo cargan el
// globalSetup de Jest (JS plano) y el de Playwright (vía execSync) — una sola
// fuente para las dos baterías en vez de dos copias que se desincronizan.

const { PrismaClient } = require('@prisma/client');

/** Nombre de base obligatorio. Un TRUNCATE contra la base equivocada sería
 *  catastrófico e irreversible, así que se comprueba explícitamente en vez de
 *  confiar en que el entorno esté bien puesto. */
const REQUIRED_DB_NAME = 'marketplace_test';

function assertTestDatabase(databaseUrl) {
  if (!databaseUrl) {
    throw new Error('[reset-test-db] DATABASE_URL vacía. Refuso truncar nada.');
  }
  // El nombre de la base es el último segmento del path, sin query string.
  let dbName;
  try {
    dbName = new URL(databaseUrl).pathname.replace(/^\//, '').split('?')[0];
  } catch {
    throw new Error(`[reset-test-db] DATABASE_URL no parseable: ${databaseUrl}`);
  }
  if (dbName !== REQUIRED_DB_NAME) {
    throw new Error(
      `[reset-test-db] DATABASE_URL apunta a la base "${dbName}", no a "${REQUIRED_DB_NAME}".\n` +
        `  ${databaseUrl}\n` +
        'Refuso truncar: esto solo puede correr contra la base de test.',
    );
  }
}

/**
 * Vacía todas las tablas de dominio de la base de TEST.
 * Idempotente: sobre una base ya vacía no hace nada observable.
 */
module.exports = async function resetTestDb() {
  assertTestDatabase(process.env.DATABASE_URL);

  const prisma = new PrismaClient();
  try {
    const tablas = await prisma.$queryRaw`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    if (tablas.length === 0) return;

    // Una sola sentencia con CASCADE: el orden de dependencias deja de importar
    // (truncarlas por separado exigiría un orden topológico que habría que
    // mantener a mano). RESTART IDENTITY deja las secuencias como recién creadas,
    // para que los ids autogenerados no dependan de cuántas corridas hubo antes.
    const lista = tablas.map((t) => `"${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE ${lista} RESTART IDENTITY CASCADE`);
    console.log(`[reset-test-db] ${tablas.length} tablas vaciadas en ${REQUIRED_DB_NAME}.`);
  } finally {
    await prisma.$disconnect();
  }
};

if (require.main === module) {
  // Permite `node test/reset-test-db.js` suelto (lo usa el globalSetup de
  // Playwright, que no puede `require` este módulo por vivir en otro paquete).
  module.exports()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exit(1);
    });
}
