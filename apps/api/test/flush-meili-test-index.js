// BARRERA ESTRUCTURAL 1 (parte Meilisearch): el índice de test arranca vacío en
// cada corrida.
//
// EL PROBLEMA. Ningún globalSetup tocaba Meilisearch. `resetMeili` existe en
// test/helpers/db.ts pero solo lo llaman los specs que se acordaron. Como los
// documentos se borran del índice cuando el anuncio deja de estar ACTIVE —y no
// cuando la fila desaparece de Postgres por un TRUNCATE—, cada corrida dejaba
// documentos HUÉRFANOS: apuntando a anuncios que ya no existen. Medido en A2: 21
// documentos de "coches" indexados frente a 12 anuncios ACTIVE reales. Eso hacía
// fallar tests por motivos falsos (un hit rancio cuya ficha da 404) y obligaba a
// escribir tests defensivos alrededor del ruido.
//
// Con el TRUNCATE de reset-test-db.js el problema se agrava, no se arregla: al
// vaciar Postgres, TODO documento del índice queda huérfano. Las dos limpiezas
// tienen que ir juntas.
//
// Guard por nombre de índice: el de dev ("listings") nunca debe tocarse.
//
// CommonJS por el mismo motivo que flush-redis-test-db.js y reset-test-db.js:
// lo comparten el globalSetup de Jest y el de Playwright.

const { MeiliSearch } = require('meilisearch');

/** El índice de dev. Vaciarlo desde una corrida de test sería destruir el trabajo
 *  del desarrollador sin avisar. */
const DEV_INDEX = 'listings';

module.exports = async function flushMeiliTestIndex() {
  const indexName = process.env.MEILI_INDEX_NAME;

  if (!indexName) {
    throw new Error(
      '[flush-meili-test-index] MEILI_INDEX_NAME vacío. Refuso vaciar nada: sin él ' +
        `apuntaría al índice por defecto ("${DEV_INDEX}", el de desarrollo).`,
    );
  }
  if (indexName === DEV_INDEX) {
    throw new Error(
      `[flush-meili-test-index] MEILI_INDEX_NAME es "${DEV_INDEX}", el índice de DESARROLLO.\n` +
        'Refuso vaciarlo: .env.test debe usar uno propio (p. ej. listings_test).',
    );
  }

  const client = new MeiliSearch({
    host: process.env.MEILI_HOST ?? 'http://localhost:7700',
    apiKey: process.env.MEILI_MASTER_KEY,
  });

  try {
    // `deleteAllDocuments` sobre un índice inexistente lanza; crearlo antes hace
    // la operación idempotente en una instalación limpia.
    await client.createIndex(indexName, { primaryKey: 'id' }).catch(() => undefined);
    const task = await client.index(indexName).deleteAllDocuments();
    // Esperar la tarea importa: Meilisearch indexa en diferido, y sin esto la
    // primera suite podría consultar el índice a medio vaciar.
    await client.waitForTask(task.taskUid);
    console.log(`[flush-meili-test-index] índice "${indexName}" vaciado.`);
  } catch (err) {
    // Meilisearch caído no debe impedir correr la batería: hay suites que no lo
    // usan, y las que sí fallarán con su propio mensaje, más claro que este.
    console.warn(`[flush-meili-test-index] no se pudo vaciar "${indexName}": ${err.message ?? err}`);
  }
};

if (require.main === module) {
  module.exports()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message ?? err);
      process.exit(1);
    });
}
