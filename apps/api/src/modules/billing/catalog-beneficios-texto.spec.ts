/**
 * EL TEXTO DE /planes, CLAVADO — la barrera que faltaba cuando el baseline de capturas
 * se quedó viejo cinco merges seguidos.
 *
 * ─── QUÉ PASÓ, Y POR QUÉ NADIE LO VIO ────────────────────────────────────────────────
 *
 * La ráfaga de la previa de vídeo en móvil cambió, con toda la razón, una línea de
 * `buildProBenefits`:
 *
 *     «…(al pasar el ratón, en ordenador)»  →  «…(al pasar el ratón, o al tocarla en el móvil)»
 *
 * El texto nuevo es el correcto: la previa dejó de ser sólo de ratón y decir «en ordenador»
 * habría sido prometer de menos. Pero ese texto se PINTA en `/planes`, la línea creció, la
 * tarjeta ganó 20 px de alto y las dos capturas de esa pantalla dejaron de coincidir con su
 * baseline. Nadie regeneró el baseline, y el job de capturas se quedó en rojo desde
 * entonces — con los otros 80 en verde, que es la peor forma de rojo: la que se aprende a
 * ignorar.
 *
 * ─── POR QUÉ ESTE TEST Y NO «acordarse» ──────────────────────────────────────────────
 *
 * Porque el que cambia el texto está en `apps/api` y el que se rompe es un PNG de
 * `apps/web`, y entre los dos no había ningún hilo. Nada relacionaba «he editado esta
 * cadena» con «hay que regenerar dos capturas»; el único aviso llegaba 2 minutos después,
 * en un job aparte, en forma de diferencia de píxeles que hay que descargar para entender.
 *
 * Este caso convierte eso en un rojo LOCAL, de un segundo, con el motivo escrito: cambias
 * la cadena, falla aquí, y el mensaje te dice exactamente qué hacer. No impide cambiar el
 * texto —no es su trabajo—: impide cambiarlo **en silencio**.
 *
 * ─── POR QUÉ SE FIJAN LAS CADENAS ENTERAS ────────────────────────────────────────────
 *
 * Un `toContain('destacados gratis')` no habría saltado con este cambio, que fue en la
 * cola de una frase. Lo que hay que vigilar es el texto EXACTO, porque es el texto exacto
 * lo que el baseline fotografía: una coma de más mueve el salto de línea, y un salto de
 * línea mueve la captura.
 *
 * Se fija la configuración de la SEMILLA DE CAPTURAS (`seed-playwright.ts`, que es la que
 * corre en ese job) y no una cualquiera: así lo que este caso afirma es exactamente lo que
 * esas dos capturas contienen. Ver `docs/estado-tecnico.md`, «El rojo crónico de capturas».
 */
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getQueueToken } from '@nestjs/bullmq';
import { BillingService } from './billing.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { RedisService } from '../../infra/redis/redis.service';
import { ListingGateService } from '../listing-gate/listing-gate.service';
import { EntitlementService } from './entitlement.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { QUEUE_INDEXING } from '../../infra/queue/queue.constants';

jest.mock('stripe', () => jest.fn().mockImplementation(() => ({})));

/**
 * LOS AJUSTES CON LOS QUE SE TOMAN LAS CAPTURAS.
 *
 * Salen de `settings-test.ts` más lo que `seed-playwright.ts` pisa después (el orden lo
 * fija `apps/web/e2e/global-setup.ts`: primero el uno, luego el otro). El caso raro
 * —`freeActiveListingLimit` en 100, por encima del tope de Pro— **no es un descuido**: las
 * specs de Playwright publican decenas de anuncios y con 5 se quedarían sin cupo. Su efecto
 * en `/planes` está comprobado abajo y es el correcto.
 */
const AJUSTES_DE_LA_SEMILLA_DE_CAPTURAS = [
  { key: 'freeActiveListingLimit', value: 100 },
  { key: 'proActiveListingLimit', value: 20 },
  { key: 'proMonthlyFeaturedQuota', value: 4 },
  { key: 'proQuotaFeaturedDurationDays', value: 7 },
  { key: 'proMonthlyBumpQuota', value: 4 },
  { key: 'proExtraCreditsPercent', value: 20 },
  { key: 'proExtraBumpsPercent', value: 20 },
  { key: 'videoEnabled', value: true },
];

/**
 * LAS OCHO LÍNEAS DE LA TARJETA PRO, EN ORDEN, tal y como salen en
 * `e2e-snapshots/__capturas__/*​/publico-planes-*.png`.
 *
 * ⚠ SI CAMBIAS UNA DE ESTAS CADENAS: el cambio puede ser perfectamente correcto —éste lo
 * fue—, pero hay que **regenerar las dos capturas de /planes**, o el job «Snapshots
 * visuales» se queda en rojo. Cómo: Actions → CI → «Run workflow» con
 * `actualizar_capturas` marcado, descargar el artefacto `snapshots-report`, mirar las dos
 * imágenes y commitear `apps/web/e2e-snapshots/__capturas__/**`.
 */
const BENEFICIOS_PRO_EN_LA_CAPTURA = [
  'Vídeo en tus anuncios: hasta 60 segundos enseñando el artículo',
  'Previsualización animada de tu vídeo en los resultados (al pasar el ratón, o al tocarla en el móvil)',
  '4 destacados gratis al mes, de 7 días cada uno',
  '4 bumps gratis al mes para subir tus anuncios',
  '20% de créditos extra en cada pack',
  '20% de bumps extra en cada pack',
  'Estadísticas avanzadas: vistas por día, ratio de me gusta y agregados',
  'Soporte prioritario: tus consultas destacan en la bandeja de nuestro equipo',
];

/** Las cuatro de la tarjeta Gratis, igual. */
const BENEFICIOS_GRATIS_EN_LA_CAPTURA = [
  'Hasta 100 anuncios activos',
  'Fotos incluidas',
  'Mensajería con compradores',
  'Perfil público',
];

describe('/planes — el texto que fotografía el baseline de capturas', () => {
  let service: BillingService;

  async function construir(ajustes: { key: string; value: unknown }[]) {
    const prisma = {
      product: { findMany: jest.fn().mockResolvedValue([]) },
      setting: { findMany: jest.fn().mockResolvedValue(ajustes) },
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        BillingService,
        { provide: PrismaService, useValue: prisma },
        { provide: EntitlementService, useValue: {} },
        {
          provide: CampaignsService,
          useValue: {
            getActiveActionDiscount: jest.fn().mockResolvedValue(null),
            getActiveCreditBonusCampaign: jest.fn().mockResolvedValue(null),
            getActiveBumpBonusCampaign: jest.fn().mockResolvedValue(null),
          },
        },
        { provide: RedisService, useValue: { client: { del: jest.fn() } } },
        { provide: ListingGateService, useValue: { assertCanBePromotedById: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn((_k: string, d?: unknown) => d) } },
        { provide: getQueueToken(QUEUE_INDEXING), useValue: { add: jest.fn() } },
      ],
    }).compile();
    service = moduleRef.get(BillingService);
  }

  beforeEach(() => construir(AJUSTES_DE_LA_SEMILLA_DE_CAPTURAS));

  it('LA BARRERA — las ocho líneas de la tarjeta Pro son EXACTAMENTE las del baseline', async () => {
    const catalogo = await service.getCatalog();

    // `toEqual` sobre el array entero, no `toContain` uno a uno: vigila el ORDEN y vigila
    // que no aparezca ni desaparezca ninguna línea. Las tres cosas mueven la captura.
    expect(catalogo.proBenefits).toEqual(BENEFICIOS_PRO_EN_LA_CAPTURA);
  });

  it('y las cuatro de la tarjeta Gratis también', async () => {
    const catalogo = await service.getCatalog();

    expect(catalogo.freeBenefits).toEqual(BENEFICIOS_GRATIS_EN_LA_CAPTURA);
  });

  /**
   * EL CASO QUE EXPLICA LA AUSENCIA MÁS LLAMATIVA DE LA CAPTURA.
   *
   * En `publico-planes-*.png` la tarjeta Pro NO lleva ninguna línea de «Hasta N anuncios
   * activos», y la de Gratis dice 100. Visto en frío parece un fallo; es la regla de
   * `buildProBenefits` funcionando: con el tope libre (100) por encima del de Pro (20),
   * anunciar «Hasta 20 anuncios activos» como ventaja de pagar sería vender como mejora
   * algo que el plan gratuito ya da mejor. Lo que el ajuste no concede, no se promete.
   *
   * Se deja escrito aquí porque es lo primero que alguien va a querer «arreglar» al mirar
   * el baseline.
   */
  it('con el tope libre por encima del de Pro, la línea de anuncios activos NO se promete', async () => {
    const catalogo = await service.getCatalog();

    expect(catalogo.proBenefits.some((b) => b.includes('anuncios activos'))).toBe(false);
  });

  it('y con los topes en su orden natural, vuelve — comparada, no afirmada a secas', async () => {
    await construir([
      ...AJUSTES_DE_LA_SEMILLA_DE_CAPTURAS.filter((a) => a.key !== 'freeActiveListingLimit'),
      { key: 'freeActiveListingLimit', value: 5 },
    ]);

    const catalogo = await service.getCatalog();

    expect(catalogo.proBenefits[0]).toBe('Hasta 20 anuncios activos (en el plan gratuito, 5)');
  });

  /**
   * LAS DOS LÍNEAS DE VÍDEO SE CONCEDEN Y SE RETIRAN JUNTAS, con el mismo interruptor.
   *
   * Importa para el baseline: si alguien apagara `videoEnabled` en la semilla de capturas,
   * la tarjeta Pro perdería DOS líneas de golpe y las dos capturas cambiarían de alto. Este
   * caso deja dicho que ese acoplamiento existe y es deliberado.
   */
  it('con el vídeo apagado, la tarjeta Pro pierde sus DOS líneas de vídeo', async () => {
    await construir(
      AJUSTES_DE_LA_SEMILLA_DE_CAPTURAS.filter((a) => a.key !== 'videoEnabled'),
    );

    const catalogo = await service.getCatalog();

    expect(catalogo.proBenefits.some((b) => b.includes('Vídeo en tus anuncios'))).toBe(false);
    expect(catalogo.proBenefits.some((b) => b.includes('Previsualización animada'))).toBe(false);
    expect(catalogo.proBenefits).toHaveLength(BENEFICIOS_PRO_EN_LA_CAPTURA.length - 2);
  });
});
