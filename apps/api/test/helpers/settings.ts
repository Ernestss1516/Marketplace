import { Prisma, PrismaClient } from '@prisma/client';

/**
 * AISLAMIENTO DE `Setting` ENTRE SUITES — un molde donde acertar una sola vez.
 *
 * ── POR QUÉ EL ESTADO SE FILTRA ──────────────────────────────────────────────
 *
 * `Setting` es dato de sistema COMPARTIDO por toda la corrida:
 *
 *   · `seed-test.ts` lo siembra UNA vez, en `globalSetup` (`setup-e2e.js`). No hay
 *     re-siembra entre suites.
 *   · `cleanDb` **excluye `Setting` a propósito** — está dicho en `setup-e2e.js` y
 *     repetido en media docena de specs.
 *   · La batería corre `--runInBand`, en el orden de ficheros que decida Jest, que
 *     **no es estable** entre máquinas ni entre corridas con y sin caché.
 *
 * De ahí la forma del fallo: la suite que rompe y la suite que se pone roja no son
 * la misma, y el rojo se mueve al añadir cualquier suite nueva. Es el rojo más caro
 * de investigar que produce esta batería. Mordió en H9 y está contado a pie de obra
 * en `listing-gate-email-verified.e2e-spec.ts:259-268`.
 *
 * ── EL DEFECTO NO ERAN DOS SUITES DESPISTADAS: ERA LA DISPERSIÓN ─────────────
 *
 * Veintiuna suites escriben `Setting`, y lo hacían con SEIS dialectos distintos
 * (`upsert`+`deleteMany`, `upsert`+`update`, `create`+`delete`, snapshot en un array
 * `TOCADOS`, `try/finally` por caso, y reponer un literal a mano). No es que dos se
 * equivocaran: es que **no había un sitio donde acertar**. Mismo argumento, y mismo
 * remedio, que `getExistingJobs` en `helpers/queue.ts`.
 *
 * ── LA REGLA: RESTAURAR LA FILA EXACTA, Y LA AUSENCIA ES UNA FILA ────────────
 *
 * Volver a dejar la clave «como estaba» significa las dos cosas:
 *
 *   · si HABÍA fila con valor X, la fila vuelve a valer X;
 *   · si NO HABÍA fila, la fila se BORRA.
 *
 * Lo segundo importa tanto como lo primero, porque para muchas claves «sin fila» y
 * «con fila» no valen lo mismo: `videoEnabled` sin fila está APAGADO y el seed de
 * test lo enciende, así que borrarlo en vez de restaurarlo le da la vuelta al valor
 * efectivo. En `freeActiveListingLimit` el defecto era invisible sólo porque el
 * valor por defecto del código (5) coincide con el del seed (5) — una casualidad,
 * no una garantía.
 *
 * ── EL SENTINELA: `undefined` ES «NO HABÍA FILA», NO `null` ──────────────────
 *
 * Las suites que ya restauraban bien usaban `(await findUnique(...))?.value ?? null`
 * y trataban `null` como «no había fila». `Setting.value` es `Json`, así que una
 * fila puede valer `null` legítimamente y ese `??` las confunde. Aquí el snapshot
 * distingue las dos cosas con un campo aparte.
 */

/** Lo que había en la fila antes de tocarla. `existia: false` ⇒ no había fila. */
export type FilaPrevia = { existia: boolean; valor: Prisma.JsonValue | null };

/** Lector: el estado exacto de la clave, ausencia incluida. */
export async function leerFila(prisma: PrismaClient, key: string): Promise<FilaPrevia> {
  const fila = await prisma.setting.findUnique({ where: { key } });
  return fila ? { existia: true, valor: fila.value } : { existia: false, valor: null };
}

/** Lo que `Setting.value` admite al escribir. Ver la nota de `Prisma.JsonNull` abajo. */
type ValorEscribible = Prisma.InputJsonValue | typeof Prisma.JsonNull;

/** Escritor: deja la clave valiendo `value`, hubiera fila o no. */
export async function fijarAjuste(
  prisma: PrismaClient,
  key: string,
  value: ValorEscribible,
): Promise<void> {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

/**
 * Devuelve la clave al estado exacto que describe `previa` — borrarla incluido.
 *
 * OJO CON EL `null`: `Setting.value` es `Json` NO NULABLE, así que Prisma no acepta
 * un `null` de JavaScript al escribir — hay que pedirle `Prisma.JsonNull`, que es lo
 * que guarda un `null` JSON de verdad. Al LEER, en cambio, ese mismo valor vuelve
 * como `null` a secas. Sin esta traducción, restaurar una fila que valía `null`
 * revienta con un error de Prisma en el `finally`... es decir, justo donde más caro
 * es que reviente: durante la limpieza de un test que ya estaba fallando.
 */
export async function restaurarFila(
  prisma: PrismaClient,
  key: string,
  previa: FilaPrevia,
): Promise<void> {
  if (!previa.existia) {
    await prisma.setting.deleteMany({ where: { key } });
    return;
  }
  await fijarAjuste(
    prisma,
    key,
    previa.valor === null ? Prisma.JsonNull : (previa.valor as Prisma.InputJsonValue),
  );
}

/**
 * Ejecuta `fn` con `key` valiendo `value`, y devuelve la fila a como estaba.
 *
 * El `finally` es el helper entero: sin él esto es un `upsert` suelto con buenas
 * intenciones. Lo que se restaura es la FILA EXACTA (valor previo, o borrado si no
 * había fila), nunca un literal escrito a mano — reponer un `5` porque «es lo que
 * siembra el seed» funciona hasta el día en que el seed cambia, y entonces falla
 * en otra suite.
 */
export async function withSetting<T>(
  prisma: PrismaClient,
  key: string,
  value: Prisma.InputJsonValue,
  fn: () => Promise<T>,
): Promise<T> {
  return withSettings(prisma, { [key]: value }, fn);
}

/** Igual que `withSetting`, con varias claves de golpe y la misma garantía. */
export async function withSettings<T>(
  prisma: PrismaClient,
  valores: Record<string, Prisma.InputJsonValue>,
  fn: () => Promise<T>,
): Promise<T> {
  return conAjustes(prisma, Object.keys(valores), async () => {
    for (const key of Object.keys(valores)) await fijarAjuste(prisma, key, valores[key]);
  }, fn);
}

/**
 * Ejecuta `fn` con esas claves SIN FILA, y las devuelve a como estaban.
 *
 * La ausencia es un caso de prueba de pleno derecho —«sin fila, ¿qué se aplica?»—
 * y hasta ahora se escribía con un `deleteMany` suelto dentro del cuerpo del test,
 * que es justo el dialecto que deja la clave borrada para todo lo que venga detrás.
 */
export async function sinAjustes<T>(
  prisma: PrismaClient,
  claves: string[],
  fn: () => Promise<T>,
): Promise<T> {
  return conAjustes(prisma, claves, async () => {
    await prisma.setting.deleteMany({ where: { key: { in: claves } } });
  }, fn);
}

/** El motor de los dos: fotografía, aplica, ejecuta y restaura en `finally`. */
async function conAjustes<T>(
  prisma: PrismaClient,
  claves: string[],
  aplicar: () => Promise<void>,
  fn: () => Promise<T>,
): Promise<T> {
  const previas = new Map<string, FilaPrevia>();
  for (const key of claves) previas.set(key, await leerFila(prisma, key));

  try {
    await aplicar();
    return await fn();
  } finally {
    // Todas, aunque una falle: dejar media restauración es peor que no haber
    // empezado, porque el rojo saldría en otra suite y con otra cara.
    const fallos: unknown[] = [];
    for (const key of claves) {
      try {
        await restaurarFila(prisma, key, previas.get(key)!);
      } catch (err) {
        fallos.push(err);
      }
    }
    if (fallos.length) throw fallos[0];
  }
}

/**
 * La versión de SUITE: fija los ajustes antes de todo y los restaura al final.
 *
 * ── POR QUÉ EXISTE, SI YA ESTÁ `withSetting` ────────────────────────────────
 *
 * Porque hay suites cuyo FIXTURE necesita el ajuste durante toda la corrida: el
 * mismo vendedor FREE publica en casi todos sus casos y topa con la cuota de
 * activos, así que el tope tiene que estar subido en los veinte `it`. Envolver
 * veinte cuerpos de test uno a uno no compra nada frente a esto —los dos dependen
 * de que Jest ejecute su hook— y a cambio esconde el ajuste en veinte sitios en vez
 * de declararlo en uno.
 *
 * Y la premisa de que «un `afterAll` puede no correr» es más estrecha de lo que
 * parece: **Jest ejecuta `afterAll` aunque un test falle y aunque `beforeAll`
 * lance** (comprobado, no supuesto). Lo único que se lo salta es que el proceso
 * muera de golpe — y ahí un `finally` por caso tampoco correría. Donde `withSetting`
 * sí gana de verdad es cuando el ajuste hace falta en UN caso: entonces el resto de
 * la suite no tiene por qué correr con el terreno cambiado.
 *
 * ── SU PROPIO CLIENTE, A PROPÓSITO ──────────────────────────────────────────
 *
 * Abre y cierra su `PrismaClient`. Así no depende de que el `afterAll` de la suite
 * —el que hace `app.close()` y `$disconnect()`— corra antes o después que el suyo:
 * ese orden es un detalle de Jest, y hacer depender la restauración de él es
 * reintroducir por la puerta de atrás la fragilidad que este helper viene a quitar.
 *
 * Llamarlo ANTES del `beforeAll` de la suite, para que el ajuste ya esté puesto
 * cuando el fixture publique.
 */
export function ajustesDeSuite(valores: Record<string, Prisma.InputJsonValue>): void {
  registrarDeSuite(Object.keys(valores), async (prisma, key) =>
    fijarAjuste(prisma, key, valores[key]),
  );
}

/**
 * Fotografía estas claves al empezar la suite y las devuelve a su sitio al acabar,
 * **sin tocarlas por su cuenta**.
 *
 * Para las suites cuyo objeto de estudio ES el ajuste: lo encienden, lo apagan y lo
 * borran DENTRO de sus casos, por la vía real (los endpoints de admin), así que no
 * hay un valor único que fijar de antemano — lo que hace falta es la red debajo,
 * que garantice que al terminar la clave vuelve a su sitio pase lo que pase por
 * medio. Es el caso de `ajustes-interruptores`, que dejaba `videoEnabled` en
 * `false` cuando el seed lo pone en `true`.
 */
export function preservarAjustes(claves: string[]): void {
  registrarDeSuite(claves, async () => undefined);
}

function registrarDeSuite(
  claves: string[],
  aplicar: (prisma: PrismaClient, key: string) => Promise<void>,
): void {
  let prisma: PrismaClient;
  const previas = new Map<string, FilaPrevia>();

  beforeAll(async () => {
    prisma = new PrismaClient();
    for (const key of claves) {
      previas.set(key, await leerFila(prisma, key));
      await aplicar(prisma, key);
    }
  });

  afterAll(async () => {
    try {
      for (const [key, previa] of previas) await restaurarFila(prisma, key, previa);
    } finally {
      await prisma.$disconnect();
    }
  });
}
