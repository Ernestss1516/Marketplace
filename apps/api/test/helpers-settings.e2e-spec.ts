/**
 * EL HELPER DE AISLAMIENTO DE `Setting`, probado contra la base de verdad.
 *
 * `helpers/settings.ts` es la pieza de la que dependen ahora seis suites para no
 * contaminarse entre ellas. Un helper de aislamiento que no se prueba es la peor
 * clase de barrera: la que todo el mundo da por buena porque «para eso está».
 *
 * Lo que se fija aquí es LA REGLA, no la implementación: al terminar, la clave queda
 * como estaba. Y «como estaba» son dos estados, no uno — con fila y sin fila.
 *
 * Va contra Postgres y no con un mock porque lo que puede fallar es justo la parte
 * que un mock daría por supuesta: el `upsert`, el borrado, y que `Json` distinga un
 * `null` guardado de una fila ausente.
 */

import { Prisma, PrismaClient } from '@prisma/client';
import {
  ajustesDeSuite,
  leerFila,
  preservarAjustes,
  sinAjustes,
  withSetting,
  withSettings,
} from './helpers/settings';

const CON_FILA = 'a2Prueba_conFila';
const SIN_FILA = 'a2Prueba_sinFila';
const OTRA = 'a2Prueba_otra';
// Aparte de las tres de arriba a propósito: el `beforeEach` las borra antes de CADA
// caso, y eso incluye los del `describe` anidado — se llevaría por delante el valor
// que `ajustesDeSuite` deja puesto en su `beforeAll`.
const DE_SUITE = 'a2Prueba_deSuite';

describe('helpers/settings — el aislamiento de `Setting` (e2e)', () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    prisma = new PrismaClient();
  });

  beforeEach(async () => {
    // Estado de partida deliberado: una clave CON fila y dos SIN ella. Las claves
    // llevan prefijo propio y no están en el whitelist del backoffice: son de este
    // spec y no las lee ningún servicio.
    await prisma.setting.deleteMany({ where: { key: { in: [CON_FILA, SIN_FILA, OTRA] } } });
    await prisma.setting.create({ data: { key: CON_FILA, value: { tope: 7 } } });
  });

  afterAll(async () => {
    await prisma.setting.deleteMany({
      where: { key: { in: [CON_FILA, SIN_FILA, OTRA, DE_SUITE] } },
    });
    await prisma.$disconnect();
  });

  // ── BARRERA 1 — restaura la FILA EXACTA ─────────────────────────────────────

  it('BARRERA 1 · la clave que TENÍA fila vuelve a su valor, no a un default', async () => {
    await withSetting(prisma, CON_FILA, { tope: 999 }, async () => {
      expect((await leerFila(prisma, CON_FILA)).valor).toEqual({ tope: 999 });
    });

    const despues = await leerFila(prisma, CON_FILA);
    expect(despues.existia).toBe(true);
    expect(despues.valor).toEqual({ tope: 7 });
  });

  // ── BARRERA 4 — la AUSENCIA también es un estado ────────────────────────────

  it('BARRERA 4 · la clave que NO tenía fila se queda SIN fila, no con un valor espurio', async () => {
    // Éste es el defecto que tenían `tags-b3`/`tags-b4` al revés: allí se borraba una
    // clave que sí existía. Aquí se comprueba la otra mitad de la regla — que crear
    // una fila que no había y dejarla puesta también contamina, porque para muchas
    // claves «sin fila» y «con fila» no valen lo mismo (`videoEnabled` es el caso).
    await withSetting(prisma, SIN_FILA, { encendido: true }, async () => {
      expect((await leerFila(prisma, SIN_FILA)).existia).toBe(true);
    });

    expect((await leerFila(prisma, SIN_FILA)).existia).toBe(false);
  });

  // ── El `finally`: restaura aunque el cuerpo reviente ────────────────────────

  it('restaura aunque `fn` lance, y deja pasar la excepción', async () => {
    // Sin esto el helper sería un `upsert` con buenas intenciones: el caso en que de
    // verdad hace falta restaurar es precisamente aquel en que el test falló.
    await expect(
      withSetting(prisma, CON_FILA, { tope: 999 }, async () => {
        throw new Error('fallo de aserción simulado');
      }),
    ).rejects.toThrow('fallo de aserción simulado');

    expect((await leerFila(prisma, CON_FILA)).valor).toEqual({ tope: 7 });
  });

  // ── Varias claves de golpe, y la ausencia mezclada con la presencia ─────────

  it('`withSettings` devuelve CADA clave a su propio estado, mezclando las dos formas', async () => {
    await withSettings(prisma, { [CON_FILA]: { tope: 1 }, [SIN_FILA]: 42 }, async () => {
      expect((await leerFila(prisma, CON_FILA)).valor).toEqual({ tope: 1 });
      expect((await leerFila(prisma, SIN_FILA)).valor).toBe(42);
    });

    expect((await leerFila(prisma, CON_FILA)).valor).toEqual({ tope: 7 });
    expect((await leerFila(prisma, SIN_FILA)).existia).toBe(false);
  });

  it('`withSettings` restaura TODAS aunque el cuerpo lance a mitad', async () => {
    await expect(
      withSettings(prisma, { [CON_FILA]: 0, [SIN_FILA]: 0, [OTRA]: 0 }, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect((await leerFila(prisma, CON_FILA)).valor).toEqual({ tope: 7 });
    expect((await leerFila(prisma, SIN_FILA)).existia).toBe(false);
    expect((await leerFila(prisma, OTRA)).existia).toBe(false);
  });

  // ── `sinAjustes`: probar la ausencia sin dejarla puesta ────────────────────

  it('`sinAjustes` quita la fila para el caso y la DEVUELVE al salir', async () => {
    await sinAjustes(prisma, [CON_FILA], async () => {
      expect((await leerFila(prisma, CON_FILA)).existia).toBe(false);
    });

    const despues = await leerFila(prisma, CON_FILA);
    expect(despues.existia).toBe(true);
    expect(despues.valor).toEqual({ tope: 7 });
  });

  // ── El sentinela: `null` guardado ≠ fila ausente ───────────────────────────

  it('distingue una fila que VALE `null` de una fila que NO EXISTE', async () => {
    // El dialecto que había suelto por la batería era
    // `(await findUnique(...))?.value ?? null`, que confunde las dos: `Setting.value`
    // es `Json` y `null` es un valor legítimo. Restaurar mal por esta confusión deja
    // la clave borrada creyendo que se la ha devuelto a su sitio.
    await prisma.setting.update({ where: { key: CON_FILA }, data: { value: Prisma.JsonNull } });

    const previa = await leerFila(prisma, CON_FILA);
    expect(previa.existia).toBe(true);
    expect(previa.valor).toBeNull();

    await withSetting(prisma, CON_FILA, { algo: 1 }, async () => undefined);

    const despues = await leerFila(prisma, CON_FILA);
    expect(despues.existia).toBe(true);
    expect(despues.valor).toBeNull();
  });

  // ── Las formas de SUITE ────────────────────────────────────────────────────

  describe('`ajustesDeSuite` fija para toda la suite anidada', () => {
    ajustesDeSuite({ [DE_SUITE]: { deSuite: true } });

    it('el ajuste está puesto en los casos de dentro', async () => {
      expect((await leerFila(prisma, DE_SUITE)).valor).toEqual({ deSuite: true });
    });
  });

  describe('`preservarAjustes` no toca nada, sólo pone la red', () => {
    preservarAjustes([CON_FILA]);

    it('el valor de partida sigue intacto: preservar no es fijar', async () => {
      expect((await leerFila(prisma, CON_FILA)).valor).toEqual({ tope: 7 });
    });
  });
});
