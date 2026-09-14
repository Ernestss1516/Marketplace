/* eslint-disable */
/**
 * ══ AVISA SI LA BASE DE DESARROLLO SE HA QUEDADO ATRÁS ═══════════════════════════════
 *
 * ── LA CICATRIZ QUE LO TRAE ─────────────────────────────────────────────────────────
 *
 * La ráfaga D del escaparate añadió dos columnas a `HomepageConfig`. Quien traía el
 * código y arrancaba el backend sin aplicar la migración se encontraba con
 * `/admin/portada` dando **500**, y el motivo sólo estaba en el log del servidor:
 *
 *     Invalid `this.prisma.homepageConfig.findUnique()` invocation
 *     The column `HomepageConfig.heroEyebrow` does not exist in the current database.
 *
 * Desde la pantalla se veía «Internal server error» y nada más. El código estaba bien,
 * la migración estaba escrita y CI estaba verde —CI siempre construye la base desde
 * cero, así que este desfase le es invisible por definición—. Lo único que faltaba era
 * un `prisma migrate deploy` en una máquina.
 *
 * Esto convierte ese 500 en una línea al arrancar.
 *
 * ── AVISA, NO BLOQUEA, Y NO TOCA LA BASE ────────────────────────────────────────────
 *
 * Tres decisiones, las tres por el mismo motivo: un arranque de desarrollo no debe
 * tener efectos que nadie ha pedido.
 *
 *  · **No aplica nada.** Aplicar migraciones solo porque alguien arrancó el servidor es
 *    mutar su base sin preguntar, y al cambiar de rama eso deja de ser lo que quiere.
 *  · **No aborta.** Hay motivos legítimos para arrancar con migraciones pendientes —
 *    mirar algo, reproducir un estado— y un guardarraíl que impide trabajar se acaba
 *    quitando.
 *  · **Nunca falla.** Si `prisma` no responde, si no hay base, si el comando cambia de
 *    formato: se calla y sigue. Un aviso que tumba el arranque sería peor que el 500
 *    que viene a evitar.
 *
 * ── ⚠ SE CALLA CON LA BASE DE TEST, Y ESO NO ES UN DESCUIDO ─────────────────────────
 *
 * Playwright arranca este mismo servidor con `.env.test`, y lo hace ANTES de que su
 * `globalSetup` migre la base de test (ver la cabecera de `e2e/global-setup.ts`: «runs
 * once before all tests, after webServers are ready»). O sea que en ese momento SIEMPRE
 * hay migraciones pendientes ahí, y avisar sería gritar en cada corrida por algo que se
 * arregla solo tres segundos después. Un aviso que salta cuando no pasa nada enseña a
 * ignorarlo — que es exactamente cómo mueren las barreras de este repositorio.
 */
const { execFileSync } = require('node:child_process');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..');

function urlDeLaBase() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  try {
    return (
      require(path.join(RAIZ, 'node_modules', 'dotenv')).config({
        path: path.join(RAIZ, '.env'),
        processEnv: {},
      }).parsed?.DATABASE_URL ?? ''
    );
  } catch {
    return '';
  }
}

/**
 * La salida de `prisma migrate status`, venga como venga.
 *
 * ⚠ EL COMANDO SALE CON CÓDIGO 1 CUANDO HAY MIGRACIONES PENDIENTES, que es justo el
 * caso que este script existe para detectar. `execFileSync` lanza en ese caso, así que
 * un `try/catch` que se limite a callar se traga LA ÚNICA señal que busca — y eso es
 * exactamente lo que hacía la primera versión de este fichero: no avisaba nunca, y lo
 * parecía porque con la base al día también se callaba. Se probó con una migración
 * pendiente simulada y no dijo nada.
 *
 * Por eso la salida se recoge de las dos vías: del retorno cuando va bien y de
 * `err.stdout` cuando sale con código 1.
 */
function estadoDeLasMigraciones() {
  const opciones = {
    cwd: RAIZ,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  };
  try {
    return execFileSync('npx', ['prisma', 'migrate', 'status'], opciones);
  } catch (err) {
    return String(err?.stdout ?? '');
  }
}

try {
  // La de test la gobierna `globalSetup`, no quien arranca. Ver arriba.
  if (/marketplace_test/.test(urlDeLaBase())) process.exit(0);

  const salida = estadoDeLasMigraciones();

  // `migrate status` no tiene salida legible por máquina, así que se busca su frase.
  // Si algún día cambia, esto deja de avisar — no deja de arrancar.
  if (/have not yet been applied|not yet been applied/i.test(salida)) {
    const nombres = salida
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^\d{14}_/.test(l));

    console.warn('');
    console.warn('  ⚠  LA BASE DE DESARROLLO ESTÁ POR DETRÁS DEL CÓDIGO');
    console.warn('');
    if (nombres.length) {
      console.warn('     Sin aplicar: ' + nombres.join(', '));
    }
    console.warn('     El servidor arranca igual, pero lo que lea columnas nuevas dará 500');
    console.warn('     (Prisma P2022, «the column does not exist»), y el motivo sólo se ve');
    console.warn('     en este log — la pantalla enseña «Internal server error».');
    console.warn('');
    console.warn('     Para ponerla al día:  pnpm --filter @marketplace/api prisma:migrate');
    console.warn('');
  }
} catch {
  // Silencio deliberado: este aviso nunca puede impedir arrancar. Ver la cabecera.
}
