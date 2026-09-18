import { test, expect } from './fixtures/auth';
import { loginViaApi } from './helpers/api';

/**
 * «LA CUOTA DE ESTE MES SE VA A PERDER» — en pantalla, con el ciclo a punto de renovar.
 *
 * ─── POR QUÉ HACE FALTA UN RELOJ FALSO ──────────────────────────────────────────
 *
 * El caso que hay que ver es «faltan dos días para que renueve la suscripción», y el seed la
 * crea con un ciclo de un mes por delante. Las tres formas de llegar ahí:
 *
 *   1. Esperar veintiocho días. No.
 *   2. Mover `currentPeriodEnd` en la base. Ninguna spec de `e2e/` toca Prisma —siembran por
 *      la API, a propósito— y además dejaría el seed alterado para las specs siguientes, que
 *      comparten instancia.
 *   3. **Mover el reloj del navegador**, que es lo que se hace aquí. La fecha real del ciclo
 *      no se toca: lo que cambia es desde cuándo se mira. Es el único de los tres que no
 *      inventa datos ni contamina a nadie.
 *
 * ─── LO QUE ESTA BATERÍA AÑADE AL UNITARIO ──────────────────────────────────────
 *
 * `cuota-caducidad.test.ts` fija la regla y `quota-reminder.test.tsx` el marcado, los dos con
 * un `proStatus` escrito a mano. Aquí el dato viene **del backend de verdad**: el `periodEnd`
 * que se usa para mover el reloj es el que sirve `GET /billing/pro-status` para la suscripción
 * que el seed creó. Si ese campo dejara de viajar —o viajara con otro nombre—, los unitarios
 * seguirían verdes y esto no.
 */

const API = 'http://localhost:3001';

/** El fin de ciclo REAL del vendedor Pro, tal y como lo sirve la API. */
async function finDeCicloPro(
  request: import('@playwright/test').APIRequestContext,
): Promise<Date> {
  const token = await loginViaApi(request, 'pro-e2e@example.com', 'Test1234!');
  const res = await request.get(`${API}/api/billing/pro-status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok()).toBeTruthy();

  const estado = (await res.json()) as {
    isPro: boolean;
    remaining: number;
    periodEnd?: string;
    quotaSource?: string;
    bumpQuota: { remaining: number };
  };

  // Las tres cosas que este spec da por ciertas del seed, comprobadas antes de mover nada:
  // sin ellas, el aviso no saldría y el rojo diría «la pantalla no lo pinta» cuando lo que
  // pasa es que no había nada que pintar.
  expect(estado.isPro).toBe(true);
  expect(estado.quotaSource).toBe('SUBSCRIPTION');
  expect(estado.remaining + estado.bumpQuota.remaining).toBeGreaterThan(0);
  expect(estado.periodEnd).toBeTruthy();

  return new Date(estado.periodEnd!);
}

/** Un instante `dias` antes del fin de ciclo. */
function diasAntesDe(fecha: Date, dias: number): Date {
  const d = new Date(fecha);
  d.setDate(d.getDate() - dias);
  return d;
}

test.describe('Aviso de caducidad de la cuota Pro', () => {
  test('a dos días de renovar, el aviso está y lleva a los anuncios activos', async ({
    proContext,
    request,
  }, testInfo) => {
    const finDeCiclo = await finDeCicloPro(request);

    const page = await proContext.newPage();
    // El reloj se instala ANTES de navegar: si se moviera después, la página ya habría
    // decidido con la hora real.
    await page.clock.setFixedTime(diasAntesDe(finDeCiclo, 2));
    await page.goto('/mis-anuncios');

    const aviso = page.getByTestId('quota-caducidad');
    await expect(aviso).toBeVisible({ timeout: 20_000 });
    await expect(aviso).toContainText(/no se acumulan/i);
    await expect(aviso).toContainText(/antes de perderlos/i);

    await testInfo.attach('aviso-caducidad.png', {
      path: await (async () => {
        const ruta = testInfo.outputPath('aviso-caducidad.png');
        await page.screenshot({ path: ruta });
        return ruta;
      })(),
      contentType: 'image/png',
    });

    /**
     * B-4 — ACCIONABLE DE VERDAD, no un enlace decorativo. Al pulsarlo, la lista queda
     * filtrada a los ACTIVOS, que son los únicos anuncios que se pueden promocionar: o sea,
     * exactamente donde se gasta la cuota que está a punto de perderse.
     */
    await page.getByTestId('quota-caducidad-accion').click();
    // La pestaña marca la selección con `aria-current`, y el nombre accesible lleva pegado su
    // contador ("Activos 3"), así que se busca por prefijo.
    await expect(page.getByRole('button', { name: /^Activos/ })).toHaveAttribute(
      'aria-current',
      'true',
    );

    await page.close();
  });

  test('con el ciclo lejos NO se pinta: el recordatorio sigue, la prisa no', async ({
    proContext,
    request,
  }, testInfo) => {
    const finDeCiclo = await finDeCicloPro(request);

    const page = await proContext.newPage();
    await page.clock.setFixedTime(diasAntesDe(finDeCiclo, 20));
    await page.goto('/mis-anuncios');

    // El recordatorio de saldo SÍ: esa información es útil todo el mes.
    await expect(page.getByTestId('quota-reminder')).toBeVisible({ timeout: 20_000 });

    // La urgencia NO. Es la mitad de la funcionalidad: un aviso permanente deja de leerse
    // justo el día que cambia una decisión.
    await expect(page.getByTestId('quota-caducidad')).toHaveCount(0);

    await testInfo.attach('sin-aviso-ciclo-lejos.png', {
      path: await (async () => {
        const ruta = testInfo.outputPath('sin-aviso-ciclo-lejos.png');
        await page.screenshot({ path: ruta });
        return ruta;
      })(),
      contentType: 'image/png',
    });

    await page.close();
  });

  test('a un vendedor SIN cuota no se le mete prisa por nada', async ({
    sellerContext,
    request,
  }) => {
    const finDeCiclo = await finDeCicloPro(request);

    const page = await sellerContext.newPage();
    await page.clock.setFixedTime(diasAntesDe(finDeCiclo, 1));
    await page.goto('/mis-anuncios');

    // `seller-e2e` no es Pro. Espera a que la pantalla esté montada antes de afirmar la
    // ausencia, o el test pasaría por haber mirado demasiado pronto.
    await expect(page.getByRole('button', { name: /^Activos/ })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('quota-caducidad')).toHaveCount(0);
    await expect(page.getByTestId('quota-reminder')).toHaveCount(0);

    await page.close();
  });
});
