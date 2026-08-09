/**
 * La línea de «anuncios activos» de /planes DERIVA de los dos límites configurables.
 *
 * EL DEFECTO: `/planes` anunciaba más anuncios activos como ventaja de pagar sin comprobar
 * que lo fuera. Con la configuración sembrada (gratuito 5, Pro 20) la frase es cierta, así
 * que el fallo no se veía; pero `freeActiveListingLimit` y `proActiveListingLimit` se editan
 * desde /admin/ajustes y pueden cruzarse. El día que el límite gratuito supere al Pro, la
 * página de precios vendería como ventaja algo que el plan gratuito da mejor — sin que nadie
 * hubiera tocado el código.
 *
 * Estas pruebas cambian los ajustes y comprueban el catálogo: es la mutación que demuestra
 * que la línea se deriva de verdad y no es un texto que casualmente encaje. Cada una
 * restaura lo que tocó, porque `Setting` es dato de sistema compartido entre suites y
 * `cleanDb` no lo limpia.
 */

import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';

const LIMITE_LIBRE = 'freeActiveListingLimit';
const LIMITE_PRO = 'proActiveListingLimit';
/** Las cuotas que la última prueba comprueba; se fijan para no depender de lo que dejó otra suite. */
const CUOTA_DESTACADOS = 'proMonthlyFeaturedQuota';
const CUOTA_BUMPS = 'proMonthlyBumpQuota';
const TOCADOS = [LIMITE_LIBRE, LIMITE_PRO, CUOTA_DESTACADOS, CUOTA_BUMPS];

describe('/planes — el límite de anuncios solo se anuncia si es un beneficio (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  /** Lo que había antes de tocar nada, para dejarlo como estaba. */
  let originales: Record<string, unknown> = {};

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();

    const previos = await prisma.setting.findMany({ where: { key: { in: TOCADOS } } });
    originales = Object.fromEntries(previos.map((s) => [s.key, s.value]));
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(originales)) {
      await prisma.setting.upsert({
        where: { key },
        update: { value: value as never },
        create: { key, value: value as never },
      });
    }
    await app.close();
    await prisma.$disconnect();
  });

  async function fijarAjustes(pares: Array<readonly [string, number]>) {
    for (const [key, value] of pares) {
      await prisma.setting.upsert({
        where: { key },
        update: { value: value as never },
        create: { key, value: value as never },
      });
    }
  }

  const fijarLimites = (libre: number, pro: number) =>
    fijarAjustes([
      [LIMITE_LIBRE, libre],
      [LIMITE_PRO, pro],
    ]);

  /** Los beneficios Pro que el catálogo publica ahora mismo. */
  async function beneficiosPro(): Promise<string[]> {
    const res = await request(app.getHttpServer()).get('/api/billing/catalog').expect(200);
    return res.body.proBenefits as string[];
  }

  const lineaDeAnuncios = (bs: string[]) => bs.find((b) => /anuncios activos/i.test(b));

  it('con Pro POR ENCIMA del gratuito, la anuncia con los dos números reales', async () => {
    await fijarLimites(5, 200);

    const linea = lineaDeAnuncios(await beneficiosPro());
    expect(linea).toBeDefined();
    // El número sale del ajuste, no de un texto fijo.
    expect(linea).toContain('200');
    expect(linea).toContain('5');
  });

  it('con Pro POR DEBAJO del gratuito NO la anuncia', async () => {
    // El cruce que un admin puede provocar desde /admin/ajustes sin tocar código.
    await fijarLimites(100, 20);

    expect(lineaDeAnuncios(await beneficiosPro())).toBeUndefined();
  });

  it('con los dos IGUALES tampoco: pagar no mejora nada ahí', async () => {
    await fijarLimites(50, 50);

    expect(lineaDeAnuncios(await beneficiosPro())).toBeUndefined();
  });

  it('el número SIGUE al ajuste — no es una coincidencia del texto', async () => {
    await fijarLimites(10, 30);
    expect(lineaDeAnuncios(await beneficiosPro())).toContain('30');

    await fijarLimites(10, 31);
    expect(lineaDeAnuncios(await beneficiosPro())).toContain('31');
  });

  it('el resto de la lista no depende de esto y sigue entera', async () => {
    await fijarAjustes([
      [LIMITE_LIBRE, 100],
      [LIMITE_PRO, 20],
      // Fijadas aquí y no dadas por supuestas: `Setting` es dato de sistema compartido y
      // otra suite puede haber dejado estas cuotas a cero, que es un caso legítimo de
      // omisión — pero entonces esta prueba estaría midiendo el estado ajeno, no el mío.
      [CUOTA_DESTACADOS, 4],
      [CUOTA_BUMPS, 5],
    ]);

    const beneficios = await beneficiosPro();
    // Las cuotas que UXV.6 derivó siguen ahí aunque la de anuncios desaparezca.
    expect(beneficios.some((b) => /4 destacados gratis al mes/i.test(b))).toBe(true);
    expect(beneficios.some((b) => /5 bumps gratis al mes/i.test(b))).toBe(true);
    expect(beneficios.some((b) => /estadísticas avanzadas/i.test(b))).toBe(true);
    expect(beneficios.length).toBeGreaterThanOrEqual(4);
  });

  it('la tarjeta del plan gratuito sí dice SIEMPRE su límite: ahí no es una promesa, es el hecho', async () => {
    await fijarLimites(100, 20);

    const res = await request(app.getHttpServer()).get('/api/billing/catalog').expect(200);
    const libres = res.body.freeBenefits as string[];
    expect(libres.some((b) => /hasta 100 anuncios activos/i.test(b))).toBe(true);
  });
});
