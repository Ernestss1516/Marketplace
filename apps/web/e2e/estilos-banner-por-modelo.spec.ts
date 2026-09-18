// LOS TRES ESTILOS DE BANNER, REVESTIDOS POR CADA MODELO — los colores resueltos.
//
// Diagnóstico en docs/diagnostico-estilos-banner-por-modelo.md. Las barreras de CLASE
// (que ninguno lleve un color escrito a mano, que los tres compartan forma) están en
// src/components/banners/estilos-banner-por-modelo.test.tsx; aquí se mide lo que sólo
// un navegador puede decir: **de qué color salen de verdad, modelo a modelo.**
//
// ── LA AFIRMACIÓN QUE SE COMPRUEBA, Y QUE NO ES LA QUE PARECE ──────────────────────
//
// «Los tres banners se adaptan a los cinco modelos» suena a que los tres tienen que
// cambiar de color con el modelo. **No es lo que el sistema hace, ni lo que debe hacer.**
// El registro fija los semánticos a propósito (decisión #2 en `estilo.constants.ts`):
// que un error sea rojo y un aviso amarillo es una convención que el usuario trae puesta
// de fuera de esta plataforma, no una decisión de marca. Teñirlas por modelo las haría
// más bonitas y menos legibles.
//
// Así que lo que se exige aquí es, con precisión:
//
//   · INFO y AVISO son ESTABLES entre los cinco modelos claros — y que lo sean está
//     comprobado, no supuesto: si alguien tiñe el amarillo de aviso «para que pegue con
//     el modelo», esto cae.
//   · PROMO CAMBIA con el modelo. Es el único de los tres que no es una convención —una
//     oferta es la casa hablando—, y por eso es el que lleva el sabor.
//   · LOS TRES se dan la vuelta en `premium@oscuro` (E14), incluido el promo nuevo.
//   · LOS TRES se distinguen ENTRE SÍ en cada modelo y en cada versión.

import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken } from './helpers/api';

const API = 'http://localhost:3001';

/** Los colores de fábrica de cada modelo — ver `estilo.constants.ts`. */
const FABRICA: Record<string, Record<string, string>> = {
  'modelo-0': {
    primary: '221.2 83.2% 53.3%',
    secondary: '210 40% 96.1%',
    accent: '210 40% 96.1%',
    neutral: '210 40% 96.1%',
  },
  'calido-editorial': {
    primary: '18 68% 42%',
    secondary: '88 22% 34%',
    accent: '8 66% 58%',
    neutral: '30 12% 92%',
  },
  'fresco-confianza': {
    primary: '222 76% 50%',
    secondary: '188 62% 46%',
    accent: '262 65% 55%',
    neutral: '214 14% 93%',
  },
  premium: {
    primary: '220 45% 30%',
    secondary: '220 30% 45%',
    accent: '42 58% 48%',
    neutral: '220 6% 92%',
  },
  vibrante: {
    primary: '330 78% 45%',
    secondary: '186 82% 42%',
    accent: '92 72% 44%',
    neutral: '30 24% 92%',
  },
};

/** Los cinco del catálogo, en su versión por defecto. */
const CLAROS: [string, string][] = [
  ['modelo-0', '1'],
  ['calido-editorial', 'dia'],
  ['fresco-confianza', 'claro'],
  ['premium', 'claro'],
  ['vibrante', 'pop'],
];

async function ponerModelo(
  request: APIRequestContext,
  modelo: string,
  version: string,
): Promise<void> {
  const res = await request.put(`${API}/api/admin/estilo`, {
    headers: { Authorization: `Bearer ${adminApiToken()}` },
    data: { modelo, version, colores: FABRICA[modelo] },
  });
  if (!res.ok()) {
    throw new Error(
      `[banners] no se pudo activar ${modelo}@${version}: ${res.status()} ${await res.text()}`,
    );
  }
}

type Pintura = { fondo: string; letra: string; trazo: string };

/**
 * Lo que el navegador PINTA en cada uno de los tres banners de la previa de
 * `/admin/estilo`.
 *
 * ── POR QUÉ LA PREVIA Y NO UN BANNER PUBLICADO ────────────────────────────────────
 *
 * Porque pinta los tres estilos a la vez con las MISMAS clases que `BannerList`, y sin
 * necesidad de crear tres filas en la base por cada uno de los seis temas que recorre
 * esta prueba. Y porque es, además, la superficie donde estaba el defecto que la ráfaga
 * encontró: ese panel llevaba un banner de aviso con ámbar de Tailwind escrito a mano,
 * dentro de la pantalla cuyo trabajo es enseñar cómo queda el modelo.
 *
 * Que el token llega hasta un banner DE VERDAD lo comprueba la última prueba del fichero,
 * ésa sí con un banner publicado.
 */
async function pinturaDeLosTres(page: Page): Promise<Record<string, Pintura>> {
  await page.goto('/admin/estilo');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('previa-banners')).toBeVisible();

  return page.evaluate(() => {
    const leer = (testid: string) => {
      const el = document.querySelector(`[data-testid="${testid}"]`)!;
      const c = getComputedStyle(el);
      return {
        fondo: c.backgroundColor,
        letra: c.color,
        trazo: c.borderTopColor,
      };
    };
    return {
      info: leer('previa-banner-info'),
      promo: leer('previa-banner-promo'),
      aviso: leer('previa-banner-aviso'),
    };
  });
}

test.describe('Los tres estilos de banner, modelo a modelo', () => {
  test.afterAll(async ({ request }) => {
    await ponerModelo(request, 'modelo-0', '1');
  });

  test('BARRERA 2 y 3 — promo lleva el sabor del modelo; info y aviso son convención; los tres se distinguen', async ({
    adminContext,
    request,
  }) => {
    test.setTimeout(120_000);
    const page = await adminContext.newPage();
    const porModelo: Record<string, Record<string, Pintura>> = {};

    for (const [modelo, version] of CLAROS) {
      await ponerModelo(request, modelo, version);
      porModelo[modelo] = await pinturaDeLosTres(page);

      // BARRERA 3, en cada modelo: los tres fondos distintos y las tres letras distintas.
      // Si un modelo dejara dos estilos iguales, el usuario perdería el tipo del aviso
      // justo en ese tema, y una comprobación hecha sólo con el Modelo 0 no lo vería.
      const p = porModelo[modelo];
      const fondos = [p.info.fondo, p.promo.fondo, p.aviso.fondo];
      const letras = [p.info.letra, p.promo.letra, p.aviso.letra];
      expect({ modelo, distintos: new Set(fondos).size }).toEqual({ modelo, distintos: 3 });
      expect({ modelo, distintas: new Set(letras).size }).toEqual({ modelo, distintas: 3 });
    }

    // BARRERA 2 — PROMO cambia con el modelo. Cinco modelos, cinco magentas: es lo que
    // convierte «cada modelo lo reviste» en un hecho y no en una intención.
    const promos = CLAROS.map(([m]) => porModelo[m].promo.fondo);
    expect(new Set(promos).size, `los cinco promo deberían diferir: ${promos.join(' · ')}`).toBe(5);

    // Y su LETRA también, que es la otra mitad del sabor.
    const letrasPromo = CLAROS.map(([m]) => porModelo[m].promo.letra);
    expect(new Set(letrasPromo).size).toBe(5);

    // INFO y AVISO, en cambio, son ESTABLES entre modelos claros — decisión #2. Esta
    // afirmación es tan barrera como la anterior, y en el sentido contrario: impide que
    // alguien «mejore» el sistema tiñendo las convenciones por modelo.
    const infos = CLAROS.map(([m]) => porModelo[m].info.fondo);
    const avisos = CLAROS.map(([m]) => porModelo[m].aviso.fondo);
    expect(new Set(infos).size, `info no debe cambiar con el modelo: ${infos.join(' · ')}`).toBe(1);
    expect(new Set(avisos).size, `aviso no debe cambiar con el modelo: ${avisos.join(' · ')}`).toBe(
      1,
    );
  });

  test('BARRERA 2 (oscuro) — en premium@oscuro los tres se dan la vuelta, promo incluido', async ({
    adminContext,
    request,
  }) => {
    const page = await adminContext.newPage();

    await ponerModelo(request, 'premium', 'claro');
    const claro = await pinturaDeLosTres(page);

    await ponerModelo(request, 'premium', 'oscuro');
    const oscuro = await pinturaDeLosTres(page);

    /** Luminancia relativa de un `rgb(...)` computado. */
    const luz = (rgb: string) => {
      const [r, g, b] = rgb.match(/\d+(\.\d+)?/g)!.slice(0, 3).map(Number);
      const f = (c: number) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };

    for (const estilo of ['info', 'promo', 'aviso'] as const) {
      // La superficie pasa de clara a oscura y la letra, de oscura a clara. No se
      // comprueba un color concreto —eso ya lo fija el registro y lo mide el contraste
      // del backend— sino que la pareja se HAYA DADO LA VUELTA, que es lo que E14 hace.
      expect({ estilo, giro: luz(oscuro[estilo].fondo) < luz(claro[estilo].fondo) }).toEqual({
        estilo,
        giro: true,
      });
      expect({ estilo, giro: luz(oscuro[estilo].letra) > luz(claro[estilo].letra) }).toEqual({
        estilo,
        giro: true,
      });
    }

    // Y siguen distinguiéndose entre sí con el lienzo oscuro, que es donde más fácil sería
    // que tres superficies apagadas se confundieran.
    const fondos = [oscuro.info.fondo, oscuro.promo.fondo, oscuro.aviso.fondo];
    expect(new Set(fondos).size).toBe(3);
  });

  test('BARRERA 1 — el token llega hasta un banner PUBLICADO, no sólo hasta la previa', async ({
    adminContext,
    buyerContext,
    request,
  }) => {
    await ponerModelo(request, 'vibrante', 'pop');

    const now = Date.now();
    const title = `E2E Estilo promo ${now}`;
    const creado = await request.post(`${API}/api/admin/banners`, {
      headers: { Authorization: `Bearer ${adminApiToken()}` },
      data: {
        title,
        text: 'Una oferta de verdad.',
        placements: ['HOME'],
        variant: 'PROMO',
        startsAt: new Date(now - 60_000).toISOString(),
        endsAt: new Date(now + 60 * 60 * 1000).toISOString(),
      },
    });
    expect(creado.ok(), `crear banner: ${creado.status()}`).toBe(true);
    const { id } = (await creado.json()) as { id: string };

    try {
      const page = await buyerContext.newPage();
      await page.goto('/');
      const banner = page.locator('[data-testid="banner"]').filter({ hasText: title });
      await expect(banner).toBeVisible({ timeout: 10_000 });

      const pintado = await banner.evaluate((el) => getComputedStyle(el).backgroundColor);
      const token = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--promo').trim(),
      );

      // El banner publicado se pinta con `--promo`, y `--promo` vale lo que Vibrante dice
      // que vale (`#fff0fc`, su magenta encendido) — no el `#fdf4ff` del Modelo 0 que
      // declara `globals.css`, que es sólo el respaldo para cuando el backend no responde.
      // Ésa es la diferencia entre «el token existe» y «el token lo trae el modelo».
      expect(token.toLowerCase()).toBe('#fff0fc');
      expect(pintado).toBe('rgb(255, 240, 252)');

      // Y NO es el de éxito, que es de donde venía prestado.
      const exito = await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--success').trim(),
      );
      expect(token).not.toBe(exito);
    } finally {
      const adminPage = await adminContext.newPage();
      await adminPage.close();
      await request.patch(`${API}/api/admin/banners/${id}`, {
        headers: { Authorization: `Bearer ${adminApiToken()}` },
        data: { active: false },
      });
    }
  });
});
