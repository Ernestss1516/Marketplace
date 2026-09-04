/**
 * BARRERA DE CORRIDA — NINGUNA SUITE DEJA UNA CONEXIÓN A REDIS ABIERTA.
 *
 * ── Por qué de CORRIDA y no de suite ────────────────────────────────────────────
 *
 * Igual que la barrera de aislamiento de `Setting` (`verificar-aislamiento-settings.ts`),
 * el defecto que vigila es INVISIBLE desde dentro: la suite que se deja una conexión
 * abierta termina en verde, y el daño aparece más tarde y en otro sitio. Los rojos que
 * abrieron esta ráfaga tenían esa forma — cero aserciones rotas, ruido de conexión.
 *
 * Se lanza desde el `globalTeardown`, cuando ya han corrido todas las suites y cada una
 * ha cerrado su app en su `afterAll`. Con `--runInBand` los tests corren en el proceso
 * principal de Jest, que sigue vivo en ese momento: si alguien dejó un socket abierto,
 * sigue abierto y el servidor lo ve.
 *
 * ── Por qué se pregunta al SERVIDOR y no al proceso ─────────────────────────────
 *
 * Mirar los handles del propio proceso (`process._getActiveHandles()`) diría «hay
 * sockets» sin decir de qué son ni a dónde van. `CLIENT LIST` los ve desde el otro lado,
 * con su `db`, su último comando y su edad — que es lo que hace falta para saber a quién
 * culpar sin reproducir. Y se ve desde un proceso APARTE, así que la barrera no puede
 * contaminar lo que mide.
 *
 * ── Quién cuenta como «de la batería»: la MARCA DE AGUA ─────────────────────────
 *
 * La Redis es compartida con el entorno de desarrollo (misma instancia, distinta db),
 * así que no todo cliente conectado es culpa de la batería. El discriminante NO es la
 * db —la primera versión filtraba por la db de test y era ciega justo donde hacía
 * falta, ver `marca-conexiones-redis.js`— sino CUÁNDO nació la conexión: el
 * `globalSetup` deja escrito el id que Redis le dio a su propia conexión, y aquí cuenta
 * todo cliente con un id mayor. Los ids son crecientes, así que eso es exactamente «se
 * abrió durante la batería».
 *
 * Punto ciego declarado: si el backend de desarrollo de la máquina RECONECTA mientras
 * corre la batería, su cliente nuevo tendrá un id mayor y saldrá señalado. Por eso el
 * informe imprime `db`, `name`, `cmd` y `age` de cada uno — para distinguirlo de un
 * vistazo. En CI no hay nadie más conectado.
 *
 * ── Y por qué esto NO es «matar el proceso y ya» ────────────────────────────────
 *
 * La batería corre SIN `--forceExit` a propósito. Un exit forzado hace que una corrida
 * con conexiones colgando sea indistinguible de una limpia — es la lección del reindex,
 * donde una `Queue` de BullMQ siguió viva y con 517 MB dos minutos después de acabar el
 * trabajo, y nadie lo vio hasta que se midió. Jest ya avisa («Jest did not exit one
 * second after the test run has completed»), pero lo dice sin nombrar al culpable y no
 * pone la corrida en rojo. Esta barrera es lo que convierte «la batería termina» en «la
 * batería termina PORQUE todo está cerrado».
 */
import Redis from 'ioredis';

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const { leerMarca, FICHERO } = require('./marca-conexiones-redis') as {
  leerMarca: () => { id: number; cuando: number } | null;
  FICHERO: string;
};

/** Margen para un socket que ya está cerrándose. Un `quit()` en vuelo no es una fuga. */
const MARGEN_MS = 5_000;
const INTERVALO_MS = 250;

interface ClienteRedis {
  id: number;
  addr: string;
  name: string;
  db: string;
  cmd: string;
  age: string;
}

function parsearClientList(salida: string): ClienteRedis[] {
  return salida
    .split('\n')
    .map((linea) => linea.trim())
    .filter(Boolean)
    .map((linea) => {
      const campos: Record<string, string> = {};
      for (const par of linea.split(' ')) {
        const i = par.indexOf('=');
        if (i > 0) campos[par.slice(0, i)] = par.slice(i + 1);
      }
      return {
        id: Number(campos.id ?? -1),
        addr: campos.addr ?? '?',
        name: campos.name ?? '',
        db: campos.db ?? '?',
        cmd: campos.cmd ?? '?',
        age: campos.age ?? '?',
      };
    });
}

export async function verificarConexionesRedis(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('[barrera-conexiones] REDIS_URL no está definida.');

  const marca = leerMarca();
  if (!marca) {
    throw new Error(
      `[barrera-conexiones] No hay marca de agua en ${FICHERO}. La deja el globalSetup ` +
        '(`marca-conexiones-redis.js`); sin ella no se puede distinguir una conexión de la ' +
        'batería de una del entorno de desarrollo, y una barrera que no puede medir no debe ' +
        'decir que todo está bien.',
    );
  }

  const redis = new Redis(redisUrl);
  try {
    // El id de la PROPIA conexión de la barrera: también es posterior a la marca, así
    // que hay que descontarlo o se denunciaría a sí misma.
    const idPropio = Number(await redis.client('ID'));

    let colgando: ClienteRedis[] = [];
    const limite = Date.now() + MARGEN_MS;
    for (;;) {
      const salida = (await redis.client('LIST')) as unknown as string;
      colgando = parsearClientList(salida).filter((c) => c.id > marca.id && c.id !== idPropio);
      if (colgando.length === 0 || Date.now() >= limite) break;
      await new Promise((r) => setTimeout(r, INTERVALO_MS));
    }

    if (colgando.length > 0) {
      const detalle = colgando
        .map((c) => `  · id=${c.id} ${c.addr} db=${c.db} name="${c.name}" cmd=${c.cmd} age=${c.age}s`)
        .join('\n');
      throw new Error(
        `[barrera-conexiones] ${colgando.length} conexión(es) a Redis abiertas por la batería ` +
          `siguen vivas ${MARGEN_MS} ms después de terminar:\n${detalle}\n\n` +
          'Alguna suite no cerró lo que abrió. Dónde suele estar:\n' +
          '  · una app de Nest sin `await app.close()` en su `afterAll`;\n' +
          '  · un `new Redis(...)` / `new Queue(...)` creado a mano en el test y nunca cerrado —\n' +
          '    cada `Queue` abre su PROPIA conexión, distinta de la de `RedisService`;\n' +
          '  · un `NestFactory.createApplicationContext(...)` sin `close()` en el `finally`.\n' +
          'La columna `cmd` dice qué hacía esa conexión y `age` cuánto lleva viva. Un `db=0`\n' +
          'delata además un contexto levantado sin `BullModule.forRoot`: BullMQ cae a su\n' +
          'conexión por defecto y se va a la Redis de desarrollo.',
      );
    }
  } finally {
    await redis.quit();
  }
}

if (require.main === module) {
  verificarConexionesRedis()
    .then(() => console.log('[barrera-conexiones] OK — la batería no dejó ninguna conexión abierta.'))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
