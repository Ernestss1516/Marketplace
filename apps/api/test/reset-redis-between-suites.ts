/**
 * setupFilesAfterEnv — corre una vez por ARCHIVO de test (suite), tras instalar
 * el framework de Jest (por eso `beforeAll` está disponible aquí). Resetea la
 * Redis de test (db 1) ANTES de cada suite.
 *
 * Motivo (deuda "batería e2e intermitente", causa CONFIRMADA): el login
 * (auth.service.ts) usa un rate limit INCR+EXPIRE en Redis con ventana larga
 * (~15min/1h) por IP/email (claves `auth:login:ip:*`, etc.). La corrida serial
 * (`--runInBand`) dura ~140s y hace CIENTOS de logins desde la misma IP
 * (localhost); el contador se acumula DENTRO de la corrida y la ventana no
 * expira, así que en algún punto cruza el límite y las suites POSTERIORES reciben
 * 401 en operaciones autenticadas no relacionadas — flake dependiente del orden
 * de suites (a veces 0 rojos, a veces 14/28/68). `flushRedisTestDb()` en
 * globalSetup solo corre UNA vez, al arrancar la batería; no basta.
 *
 * El reset es ENTRE suites (`beforeAll` de nivel raíz = una vez por archivo),
 * NUNCA entre tests: dentro de una suite el contador SÍ se acumula, para que
 * `auth-security.e2e-spec` pueda ejercer el límite (el rate limit sigue ACTIVO y
 * probado). Este `beforeAll` raíz corre antes del `beforeAll` de cada describe,
 * así que cada suite arranca con el contador limpio y luego acumula lo suyo.
 *
 * Es seguro flushear toda la db entre suites: en el hueco entre suites la app de
 * la suite anterior ya está cerrada (su `afterAll` hizo `app.close()`, parando
 * sus workers BullMQ), la siguiente aún no ha arrancado, y ninguna suite depende
 * de estado Redis sembrado de forma persistente (globalSetup solo siembra
 * Postgres; en Redis todo es efímero por suite). Reutiliza flush-redis-test-db.js
 * (mismo guard anti-db-0).
 */

// require() (no import) para no depender de una declaración de tipos del .js;
// devuelve `any`, sin error de "declaration file". Mismo módulo que usa el
// globalSetup.
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const flushRedisTestDb: () => Promise<void> = require('./flush-redis-test-db');

beforeAll(async () => {
  await flushRedisTestDb();
});
