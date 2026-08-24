/**
 * LOS CUATRO INTERRUPTORES, EN PANTALLA.
 *
 * El defecto que este spec cierra no era del backend: `GET`/`PATCH /admin/settings` llevaban
 * desde siempre manejando estas cuatro claves. Lo que faltaba era la interfaz — la página de
 * ajustes recorre un array de claves escrito a mano y ninguna de las cuatro estaba en él, así
 * que el vídeo Pro, construido y probado, era inalcanzable: nadie podía encenderlo.
 *
 * REPARTO CON LA BATERÍA DE BACKEND, a propósito. Que encender el interruptor MUEVA la
 * feature (config `enabled`, `assertEnabled`, `VIDEO_DISABLED`) se comprueba a nivel HTTP en
 * `apps/api/test/ajustes-interruptores.e2e-spec.ts`, que es donde se puede hacer sin efectos
 * colaterales. Aquí se comprueba lo otro, que es lo que faltaba: que las tarjetas se PINTAN,
 * con el control correcto, con el valor que el backend dice, y que guardar funciona.
 *
 * POR QUÉ NO SE CONMUTA `videoEnabled` AQUÍ: `seed-test.ts` lo deja encendido y
 * `video-editor.spec.ts` cuenta con ello. Un round-trip que fallara a mitad dejaría apagada
 * la feature para las specs siguientes. El round-trip de guardado se hace sobre el ajuste
 * numérico, que no condiciona a nadie.
 *
 * Ver docs/auditoria-pro-video.md §2.0.
 */
import { test, expect } from './fixtures/auth';
import type { Page, Locator } from '@playwright/test';
import { adminApiToken } from './helpers/api';

const API_BASE = 'http://localhost:3001';

const TARJETA_VIDEO = 'Vídeo en los anuncios (ventaja Pro)';
const TARJETA_REVALIDACION = 'Marcar los anuncios que dejan de cumplir su categoría';
const TARJETA_BUMP_AUTO = 'Bump automático (programaciones)';
const TARJETA_MAX_PROGRAMACIONES = 'Máximo de programaciones de bump por usuario';

function cardFor(page: Page, title: string): Locator {
  return page
    .locator('div.rounded-md.border.bg-background.p-5')
    .filter({ has: page.getByRole('heading', { name: title }) });
}

test.describe('Ajustes — los cuatro interruptores que no se pintaban', () => {
  test('las cuatro tarjetas existen, con su control y con el valor del backend', async ({
    adminContext,
    request,
  }) => {
    // Los valores se LEEN DEL BACKEND, no se escriben aquí: el spec sigue a la
    // configuración en vez de romperse cuando alguien la cambie.
    const token = adminApiToken();
    const ajustes = (await (
      await request.get(`${API_BASE}/api/admin/settings`, {
        headers: { Authorization: `Bearer ${token}` },
      })
    ).json()) as { key: string; value: unknown }[];
    const porClave = Object.fromEntries(ajustes.map((s) => [s.key, s]));

    const page = await adminContext.newPage();
    await page.goto('/admin/ajustes');
    await page.waitForLoadState('networkidle');

    // ── 1. Se PINTAN. Esto es literalmente lo que faltaba ──────────────────────
    for (const titulo of [
      TARJETA_VIDEO,
      TARJETA_REVALIDACION,
      TARJETA_BUMP_AUTO,
      TARJETA_MAX_PROGRAMACIONES,
    ]) {
      await expect(cardFor(page, titulo), `falta la tarjeta «${titulo}»`).toBeVisible();
    }

    // ── 2. Con el CONTROL correcto: tres interruptores y un número ─────────────
    for (const titulo of [TARJETA_VIDEO, TARJETA_REVALIDACION, TARJETA_BUMP_AUTO]) {
      await expect(cardFor(page, titulo).locator('input[type="checkbox"]')).toHaveCount(1);
    }
    await expect(
      cardFor(page, TARJETA_MAX_PROGRAMACIONES).locator('input[type="number"]'),
    ).toHaveCount(1);

    // ── 3. Y con el VALOR que el backend sirve, no con uno inventado ───────────
    //
    // Aquí estaba el otro defecto: estas claves no tenían default declarado, así que sin
    // fila llegaban a `null`. Para `bumpAutoEnabled` —encendido sin fila— eso habría
    // pintado un interruptor apagado mientras el cron bumpeaba de verdad.
    const casilla = (titulo: string) => cardFor(page, titulo).locator('input[type="checkbox"]');
    await expect(casilla(TARJETA_VIDEO)).toBeChecked({
      checked: porClave['videoEnabled'].value === true,
    });
    await expect(casilla(TARJETA_REVALIDACION)).toBeChecked({
      checked: porClave['attributeRevalidationEnabled'].value === true,
    });
    await expect(casilla(TARJETA_BUMP_AUTO)).toBeChecked({
      checked: porClave['bumpAutoEnabled'].value === true,
    });
    await expect(
      cardFor(page, TARJETA_MAX_PROGRAMACIONES).locator('input[type="number"]'),
    ).toHaveValue(String(porClave['maxBumpSchedulesPerUser'].value));

    // ── 4. Y el aviso del vídeo dice lo que cuesta encenderlo ──────────────────
    // No es decoración: el interruptor nace apagado porque la feature gasta almacenamiento
    // y ancho de banda desde el primer vídeo, y quien lo pulsa debe leerlo antes.
    await expect(cardFor(page, TARJETA_VIDEO).getByText(/almacenamiento y ancho de banda/i))
      .toBeVisible();
  });

  test('guardar desde la tarjeta escribe de verdad (round-trip sobre el numérico)', async ({
    adminContext,
    request,
  }) => {
    const token = adminApiToken();
    const leer = async () => {
      const ajustes = (await (
        await request.get(`${API_BASE}/api/admin/settings`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json()) as { key: string; value: unknown }[];
      return ajustes.find((s) => s.key === 'maxBumpSchedulesPerUser')!.value;
    };

    const original = String(await leer());

    const page = await adminContext.newPage();
    await page.goto('/admin/ajustes');
    await page.waitForLoadState('networkidle');

    const card = cardFor(page, TARJETA_MAX_PROGRAMACIONES);
    await card.locator('input[type="number"]').fill('7');
    await card.getByRole('button', { name: 'Guardar' }).click();
    await expect(card.getByText('Guardado')).toBeVisible();

    // La fila existe de verdad, no es estado de cliente.
    expect(await leer()).toBe(7);

    // Y se restaura, para no cambiarle el mundo a las specs que corran después.
    const tras = cardFor(page, TARJETA_MAX_PROGRAMACIONES);
    await tras.locator('input[type="number"]').fill(original);
    await tras.getByRole('button', { name: 'Guardar' }).click();
    await expect(tras.getByText('Guardado')).toBeVisible();
    expect(String(await leer())).toBe(original);
  });
});
