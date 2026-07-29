// BARRERA ESTRUCTURAL: la batería e2e de backend y la de Playwright NO PUEDEN
// CORRER A LA VEZ.
//
// Comparten la base `marketplace_test` y la db 1 de Redis, así que una corrida
// simultánea produce fallos que no son fallos: el `cleanDb` de una trunca
// `User CASCADE` mientras la otra está a mitad de setup, y aparecen 403 donde
// debería haber 200 y `globalSetup` que revienta sin motivo aparente. Ha pasado
// tres veces, y las tres se diagnosticó como "regresión" antes de darse cuenta.
//
// Estaba anotado como deuda de tooling ("acordarse" de no hacerlo). Acordarse no
// es un mecanismo: esto sí. La segunda corrida FALLA INMEDIATAMENTE con un
// mensaje que dice qué está pasando, en vez de producir rojos falsos veinte
// minutos después.
//
// Es un `.js` sin TypeScript a propósito: lo carga el `globalSetup` de Jest, que
// no pasa por ts-jest, y el de Playwright vía `require`. Mismo criterio que
// `flush-redis-test-db.js`, que ya se comparte entre las dos baterías.
//
// El candado es un DIRECTORIO (`mkdir` es atómico en todos los sistemas de
// ficheros, a diferencia de "comprobar si existe y luego crear", que tiene una
// ventana de carrera). Dentro se deja el PID y quién lo cogió.

const fs = require('fs');
const os = require('os');
const path = require('path');

const LOCK_DIR = path.join(os.tmpdir(), 'marketplace-e2e.lock');
const META = path.join(LOCK_DIR, 'owner.json');

/** ¿Sigue vivo el proceso que dejó el candado? `signal 0` no le manda nada: solo pregunta. */
function pidVivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = existe pero es de otro usuario → cuenta como vivo.
    return err.code === 'EPERM';
  }
}

function leerMeta() {
  try {
    return JSON.parse(fs.readFileSync(META, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Coge el candado o revienta con un mensaje útil.
 * @param {string} owner  'jest-e2e' o 'playwright'
 */
function acquire(owner) {
  try {
    fs.mkdirSync(LOCK_DIR);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;

    const meta = leerMeta();
    // Candado HUÉRFANO: una corrida anterior murió sin liberarlo (Ctrl-C, crash).
    // Se rompe solo, porque si no la siguiente corrida legítima quedaría
    // bloqueada para siempre y el remedio sería peor que la enfermedad.
    if (!meta || !pidVivo(meta.pid)) {
      fs.rmSync(LOCK_DIR, { recursive: true, force: true });
      fs.mkdirSync(LOCK_DIR);
      fs.writeFileSync(META, JSON.stringify({ owner, pid: process.pid, at: new Date().toISOString() }));
      return;
    }

    throw new Error(
      [
        '',
        '═══════════════════════════════════════════════════════════════════',
        ' YA HAY UNA BATERÍA e2e EN MARCHA — esta se aborta a propósito.',
        '',
        `   en marcha : ${meta.owner} (pid ${meta.pid}, desde ${meta.at})`,
        `   intentando: ${owner} (pid ${process.pid})`,
        '',
        ' Las dos comparten marketplace_test y Redis db 1: correrlas juntas',
        ' produce rojos que NO son regresiones. Espera a que termine la otra.',
        '',
        ` Si estás seguro de que no hay ninguna, borra: ${LOCK_DIR}`,
        '═══════════════════════════════════════════════════════════════════',
        '',
      ].join('\n'),
    );
  }

  fs.writeFileSync(META, JSON.stringify({ owner, pid: process.pid, at: new Date().toISOString() }));
}

/** Suelta el candado, pero SOLO si es nuestro (no le quitamos el turno a nadie). */
function release(owner) {
  const meta = leerMeta();
  if (meta && meta.owner !== owner && pidVivo(meta.pid)) return;
  fs.rmSync(LOCK_DIR, { recursive: true, force: true });
}

module.exports = { acquire, release, LOCK_DIR };
