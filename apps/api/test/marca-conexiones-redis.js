// LA MARCA DE AGUA DE LA BARRERA DE CONEXIONES.
//
// El `globalSetup` deja aquí el id que Redis le asignó a SU conexión, y el
// `globalTeardown` lo lee para saber qué clientes nacieron durante la batería:
// los ids de Redis son crecientes, así que `id > marca` es exactamente «se abrió
// después de que la batería empezara».
//
// POR QUÉ UNA MARCA Y NO UN FILTRO POR `db`. La primera versión de la barrera
// filtraba por la db de test (la 1) y era CIEGA justo donde hacía falta: un
// contexto de Nest levantado sin `BullModule.forRoot` —que es lo que hace
// `comandos-standalone` con `ReviewsModule`— cae al default de BullMQ y se
// conecta a la **db 0**. Medido: el `CLIENT LIST` mostraba la conexión colgada en
// db 0 y la barrera decía «OK». Con la marca no hay que adivinar la db: cuenta
// cuándo nació la conexión, no dónde.
//
// Y no vale guardarla en la propia Redis: `reset-redis-between-suites.ts` hace
// FLUSHDB de la db 1 antes de CADA suite, así que la marca no sobreviviría a la
// primera. Va a un fichero, como el candado de `e2e-lock.js`.
//
// CommonJS liso (sin ts-node) para poder requerirse igual desde el `globalSetup`
// (JS) y desde la barrera (TypeScript).
const fs = require('fs');
const os = require('os');
const path = require('path');
const Redis = require('ioredis');

const FICHERO = path.join(os.tmpdir(), 'marketplace-e2e-marca-redis.json');

async function marcar() {
  const redis = new Redis(process.env.REDIS_URL);
  try {
    // CLIENT ID devuelve el id de ESTA conexión. Como Redis los reparte de forma
    // creciente, sirve de marca de agua: nadie anterior puede tener un id mayor.
    const id = await redis.client('ID');
    fs.writeFileSync(FICHERO, JSON.stringify({ id: Number(id), cuando: Date.now() }), 'utf8');
  } finally {
    await redis.quit();
  }
}

function leerMarca() {
  if (!fs.existsSync(FICHERO)) return null;
  try {
    return JSON.parse(fs.readFileSync(FICHERO, 'utf8'));
  } catch {
    return null;
  }
}

module.exports = { marcar, leerMarca, FICHERO };
