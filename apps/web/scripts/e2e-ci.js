// Verificar en LOCAL exactamente lo que el CI aprueba.
//
// ── POR QUÉ EXISTE ESTE SCRIPT ──────────────────────────────────────────────
//
// `pnpm test:e2e` a secas arranca el frontal con `next dev`, y `next dev` SE MATA
// SOLO a media petición:
//
//   next/dist/server/lib/start-server.js:233-244, dentro del `finally` de CADA
//   petición:
//       if (isDev) {
//         if (used_heap_size > 0.8 * heap_size_limit) { … process.exit(RESTART_EXIT_CODE) }
//       }
//
// Tres cosas y las tres importan: está condicionado a `isDev` (con `next start` NO
// existe), se evalúa en cada petición (una batería de 50 min lo evalúa decenas de
// miles de veces), y cuando salta hace `process.exit` — no degrada, mata el
// servidor. Cualquier `page.goto` en vuelo muere ahí, con la firma
// «page.goto: Timeout» o «Target page has been closed».
//
// El CI ya lo evita (arranca con `next start`) y por eso lleva 24 de 24 corridas
// verdes. El arranque local se quedó en `next dev`, y con él se quedó el fallo:
// se estuvieron leyendo como «rojos ambientales» durante toda una sesión.
//
// `CI=1` bascula los cinco puntos de `playwright.config.ts` de una vez: `next
// start`, `nest start` sin watch, servidores frescos (`reuseExistingServer:
// false`), `retries: 1` y 150 s por test.
//
// Ver docs/auditoria-inestabilidad-playwright.md.
//
// ── ESTE SCRIPT NO CAMBIA CÓMO SE DESARROLLA ────────────────────────────────
//
// `pnpm dev` sigue siendo `next dev`, que es lo correcto para desarrollar. Esto es
// una vía OPCIONAL para VERIFICAR. No se toca el CI, que ya está bien.

const { spawnSync, execSync } = require('child_process');
const { rmSync, existsSync } = require('fs');
const { join } = require('path');
const net = require('net');

const WEB_DIR = join(__dirname, '..');
const PUERTOS = [3000, 3001];

function log(msg) {
  console.log(`\n\x1b[36m▸ ${msg}\x1b[0m`);
}

/**
 * ¿Hay algo escuchando? Se pregunta al PUERTO, no a una lista de procesos.
 *
 * SE COMPRUEBA CONECTANDO, NO INTENTANDO ESCUCHAR. La primera versión hacía
 * `server.listen(puerto, '127.0.0.1')` y daba por libre lo que no fallara con
 * `EADDRINUSE` — y en Windows **eso miente**: un `next dev` escucha en `0.0.0.0`, y
 * un `listen` sobre `127.0.0.1` convive con él sin error. El script decía «3000:
 * libre» con el zombi delante, Playwright chocaba con `EADDRINUSE` al arrancar su
 * `next start`, y la batería acababa corriendo **contra el servidor de desarrollo**
 * — justo lo que este script existe para impedir. Detectado al probarlo con un
 * zombi puesto a mano.
 *
 * Conectar responde la pregunta que de verdad importa —«¿hay alguien sirviendo
 * ahí?»— y no depende de en qué interfaz escuche.
 */
function puertoOcupado(puerto) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const cerrar = (ocupado) => {
      socket.destroy();
      resolve(ocupado);
    };
    socket.setTimeout(1000);
    socket.once('connect', () => cerrar(true));
    socket.once('timeout', () => cerrar(false));
    socket.once('error', () => cerrar(false));
    socket.connect(puerto, '127.0.0.1');
  });
}

function pidEnPuerto(puerto) {
  try {
    if (process.platform === 'win32') {
      const salida = execSync(`netstat -ano -p tcp`, { encoding: 'utf8' });
      const linea = salida
        .split('\n')
        .find((l) => l.includes('LISTENING') && new RegExp(`[:.]${puerto}\\s`).test(l));
      return linea ? linea.trim().split(/\s+/).pop() : null;
    }
    return execSync(`lsof -ti tcp:${puerto}`, { encoding: 'utf8' }).trim().split('\n')[0] || null;
  } catch {
    return null; // nada escuchando, o la herramienta no está: se trata igual
  }
}

function matar(pid) {
  try {
    if (process.platform === 'win32') execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    else execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * TRAMPA 1 — EL SERVIDOR ZOMBI.
 *
 * Cerrar la terminal donde corría `pnpm dev` mata el ENVOLTORIO, no el proceso de
 * Node: el `next dev` sigue escuchando en el 3000. Con `CI=1` Playwright no lo
 * adopta (arranca los suyos), pero su servidor choca con `EADDRINUSE` y la batería
 * muere dos minutos después con «Timed out waiting 120000ms from
 * config.webServer» — un mensaje que no menciona el puerto y manda a buscar por el
 * sitio equivocado. Pasó durante la auditoría.
 *
 * Por eso se comprueba el PUERTO y no si «yo he arrancado un dev»: es la única
 * pregunta cuya respuesta es fiable.
 */
async function liberarPuertos() {
  log('Comprobando que los puertos están libres (trampa del servidor zombi)');
  for (const puerto of PUERTOS) {
    if (!(await puertoOcupado(puerto))) {
      console.log(`  · ${puerto}: libre`);
      continue;
    }
    const pid = pidEnPuerto(puerto);
    if (!pid) {
      console.error(
        `  ✗ ${puerto}: OCUPADO y no se ha podido identificar el proceso. Ciérralo a mano.`,
      );
      process.exit(1);
    }
    console.log(`  · ${puerto}: ocupado por el PID ${pid} → se cierra`);
    if (!matar(pid)) {
      console.error(`  ✗ No se pudo cerrar el PID ${pid}. Ciérralo a mano y repite.`);
      process.exit(1);
    }

    // MATAR NO ES INMEDIATO. `taskkill` vuelve en cuanto ha pedido el cierre, no
    // cuando el proceso ha muerto: seguir sin esperar deja al script trabajando
    // contra un servidor que todavía respira (y con sus ficheros aún abiertos, que
    // es lo que rompía el borrado de `.next` justo después).
    for (let i = 0; i < 25 && (await puertoOcupado(puerto)); i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

/**
 * TRAMPA 2 — EL BUILD CORRUPTO.
 *
 * `next dev` y `next build` escriben en el MISMO `.next`. Construir con el dev vivo
 * deja un build a medias, y el `next start` resultante revienta con
 * `Cannot find module './vendor-chunks/…'` — un fallo que no tiene nada que ver con
 * los tests y que cuesta un rato atribuir. También pasó durante la auditoría.
 *
 * Se borra `.next` ANTES de construir, y se construye DESPUÉS de liberar los
 * puertos: ese orden es el arreglo.
 */
function construirLimpio() {
  log('Borrando .next y construyendo en producción (trampa del build corrupto)');
  const next = join(WEB_DIR, '.next');
  // `maxRetries` NO ES ADORNO EN WINDOWS. Al cerrar el servidor de desarrollo, el
  // sistema tarda en soltar los descriptores que tenía abiertos sobre `.next`, y un
  // borrado inmediato revienta con `ENOTEMPTY` — reproducido al probar el script
  // con un zombi delante. Node reintenta el borrado por esto exactamente.
  if (existsSync(next)) {
    rmSync(next, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }

  const r = spawnSync('pnpm', ['exec', 'next', 'build'], {
    cwd: WEB_DIR,
    stdio: 'inherit',
    shell: true,
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

/**
 * LA BATERÍA, con `--grep-invert "@2b"`: es EXACTAMENTE el paso que decide el
 * pipeline («Frontend e2e — Playwright (señal, sin @2b)» en ci.yml). Los `@2b` son
 * la carrera de navegación del App Router de Next 15, un known-issue sin arreglo
 * upstream que el CI informa pero no bloquea; correrlos aquí sería medir contra un
 * listón que el propio CI no aplica.
 *
 * Para verlos: `pnpm exec playwright test --grep "@2b"`.
 */
function correrBateria() {
  const extra = process.argv.slice(2);
  log(`Playwright en condiciones de CI${extra.length ? ` (${extra.join(' ')})` : ''}`);

  const r = spawnSync(
    'pnpm',
    ['exec', 'playwright', 'test', '--grep-invert', '@2b', ...extra],
    {
      cwd: WEB_DIR,
      stdio: 'inherit',
      shell: true,
      // La única variable que hace falta: bascula los cinco puntos de la config.
      env: { ...process.env, CI: '1' },
    },
  );
  process.exit(r.status ?? 1);
}

(async () => {
  await liberarPuertos();
  construirLimpio();
  correrBateria();
})();
