/**
 * /planes ANUNCIA EL VÍDEO — pero sólo si está encendido.
 *
 * EL DEFECTO: el vídeo Pro llevaba construido desde su ráfaga y era **la única ventaja que
 * la página de precios no mencionaba**. El enganche estaba escrito en `buildProBenefits`…
 * en un comentario, y con el nombre del flag EQUIVOCADO (`proVideoEnabled`; el real es
 * `videoEnabled`). Copiarlo tal cual habría dejado un fallo invisible: una clave que no
 * existe vale `undefined`, o sea «apagado», así que la línea no habría salido nunca y nada
 * lo habría delatado.
 *
 * Estas pruebas mueven el interruptor y miran el catálogo — la mutación que demuestra que
 * la línea se DERIVA del ajuste y no es un texto que casualmente esté ahí. Restauran lo que
 * tocan: `Setting` es dato de sistema compartido entre suites y `cleanDb` no lo limpia.
 *
 * Ver docs/auditoria-pro-video.md §4.1 (hueco #2).
 */
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as request from 'supertest';
import { createTestApp } from './helpers/create-app';
import {
  MAX_VIDEO_DURATION_SECONDS,
  VIDEO_ENABLED_SETTING,
} from 'src/modules/video/video-limits';

describe('/planes — el vídeo se anuncia sólo si la feature está encendida (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let original: unknown;

  beforeAll(async () => {
    prisma = new PrismaClient();
    app = await createTestApp();
    await app.init();
    original = (
      await prisma.setting.findUnique({ where: { key: VIDEO_ENABLED_SETTING } })
    )?.value;
  });

  afterAll(async () => {
    if (original !== undefined) {
      await prisma.setting.upsert({
        where: { key: VIDEO_ENABLED_SETTING },
        update: { value: original as never },
        create: { key: VIDEO_ENABLED_SETTING, value: original as never },
      });
    } else {
      await prisma.setting.deleteMany({ where: { key: VIDEO_ENABLED_SETTING } });
    }
    await app.close();
    await prisma.$disconnect();
  });

  function ponerVideo(valor: boolean) {
    return prisma.setting.upsert({
      where: { key: VIDEO_ENABLED_SETTING },
      update: { value: valor },
      create: { key: VIDEO_ENABLED_SETTING, value: valor },
    });
  }

  /** Los beneficios Pro que el catálogo publica ahora mismo. */
  async function beneficiosPro(): Promise<string[]> {
    const res = await request(app.getHttpServer()).get('/api/billing/catalog').expect(200);
    return res.body.proBenefits as string[];
  }

  const lineaDeVideo = (bs: string[]) => bs.find((b) => /vídeo/i.test(b));

  it('ENCENDIDO: la lista incluye el vídeo, con la duración que el servidor aplica de verdad', async () => {
    await ponerVideo(true);

    const linea = lineaDeVideo(await beneficiosPro());
    expect(linea).toBeDefined();
    // El número NO está escrito a mano en el texto: sale de la misma constante que valida
    // la subida. Prometer 90 segundos y rechazar a los 60 sería el desajuste que
    // `buildProBenefits` existe para impedir.
    expect(linea).toContain(String(MAX_VIDEO_DURATION_SECONDS));
  });

  it('APAGADO: NO se anuncia — no se promete lo que el editor no ofrece', async () => {
    // Con la feature apagada la sección de vídeo no existe para nadie, ni siquiera para un
    // Pro. Anunciarla sería vender algo que quien pague no va a encontrar.
    await ponerVideo(false);

    expect(lineaDeVideo(await beneficiosPro())).toBeUndefined();
  });

  it('SIN FILA tampoco: ausente es apagado, igual que para el guard de subida', async () => {
    // `VideoService.isEnabled` lee `value === true`, así que sin fila la feature está
    // apagada. La página de precios tiene que leerlo igual o las dos discreparían sobre la
    // misma ausencia.
    await prisma.setting.deleteMany({ where: { key: VIDEO_ENABLED_SETTING } });

    expect(lineaDeVideo(await beneficiosPro())).toBeUndefined();
  });

  it('REQUISITO DE ORO — encenderlo AÑADE la línea y no toca ninguna otra', async () => {
    // Que la entrada sea ADITIVA importa: `buildProBenefits` sirve la promesa entera de la
    // página, y una línea nueva que se comiera otra sería una ventaja que deja de venderse.
    await ponerVideo(false);
    const sinVideo = await beneficiosPro();

    await ponerVideo(true);
    const conVideo = await beneficiosPro();

    expect(conVideo.length).toBe(sinVideo.length + 1);
    for (const linea of sinVideo) {
      expect(conVideo).toContain(linea);
    }
  });
});
