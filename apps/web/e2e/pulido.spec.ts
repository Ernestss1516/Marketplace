// UXV.6 — PULIDO: los ocho remates que cierran la zona de vendedor.
//
// Son independientes entre sí (por eso la tanda agrupa por superficie, no por raíz), así
// que cada bloque prueba uno y no depende de los demás.

import { test, expect } from './fixtures/auth';

test.describe('UXV.6 (M4) — nadie paga dos veces por el mismo plan', () => {
  test('un Pro NO ve «Hazte Pro»: ve que ya lo es, y cómo gestionarlo', async ({ proContext }) => {
    const page = await proContext.newPage();
    await page.goto('/planes');

    // ANTES: el mismo botón para todos. Un suscriptor que volvía a /planes —y volvía,
    // porque es el enlace del menú— podía abrir un SEGUNDO checkout de Stripe.
    await expect(page.getByTestId('ya-eres-pro').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: /^hazte pro/i })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /gestionar mi suscripción/i }).first()).toBeVisible();
  });

  test('un usuario NO Pro sigue pudiendo suscribirse — el guard no estorba a quien debe pasar', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.goto('/planes');

    await expect(page.getByRole('button', { name: /^hazte pro/i }).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('ya-eres-pro')).toHaveCount(0);
  });

  test('la lista de beneficios sale del catálogo y nombra los que la app SÍ concede', async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('/planes');

    await expect(page.getByRole('heading', { name: /elige tu plan/i })).toBeVisible({
      timeout: 15_000,
    });

    // Los dos beneficios que la lista hardcodeada CALLABA, y que el usuario sí ve
    // funcionar en /mis-anuncios.
    await expect(page.getByText(/destacados gratis al mes/i).first()).toBeVisible();
    await expect(page.getByText(/bumps gratis al mes/i).first()).toBeVisible();

    await ctx.close();
  });
});

test.describe('UXV.6 (M12) — las dos cuotas se ven, y también agotadas', () => {
  // El caso «cuota agotada» se prueba en `quota-reminder.test.tsx`, por el mismo motivo:
  // /mis-anuncios resuelve proStatus en el servidor y no se puede vaciar la cuota desde el
  // navegador sin consumirla de verdad.

  test('/perfil/suscripcion muestra la cuota de bumps, no solo la de destacados', async ({
    proContext,
  }) => {
    const page = await proContext.newPage();
    await page.goto('/perfil/suscripcion');

    await expect(page.getByText(/destacados gratis:/i)).toBeVisible({ timeout: 15_000 });
    // Esta era la que faltaba: solo se veía incrustada en el texto de un botón.
    await expect(page.getByText(/bumps gratis:/i)).toBeVisible();
  });
});

test.describe('UXV.6 (M9, B5) — el historial se pasea y los vacíos ofrecen salida', () => {
  // La PAGINACIÓN en sí se prueba en `HistorialPaginado.test.tsx`: /mis-creditos es un
  // Server Component y su primera página la sirve el servidor, así que desde el navegador
  // no se puede fabricar un historial de tres páginas para el render inicial. Aquí queda
  // el estado vacío, que sí depende de datos reales del backend.

  test('sin movimientos, el vacío dice qué son y lleva a comprarlos', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();

    await page.route('**/billing/wallet**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          balance: 0,
          bumpBalance: 0,
          items: [],
          total: 0,
          page: 1,
          perPage: 20,
          totalPages: 0,
        }),
      }),
    );
    await page.route('**/billing/bump-ledger**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ bumpBalance: 0, items: [], total: 0, page: 1, perPage: 20, totalPages: 0 }),
      }),
    );

    await page.goto('/mis-creditos');

    // B5 — antes: «No hay movimientos todavía. Compra un pack para empezar.», sin botón.
    await expect(page.getByText(/todavía no tienes movimientos de créditos/i)).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('link', { name: /comprar créditos/i }).first()).toBeVisible();

    // Y el historial de BUMPS ahora existe aunque esté vacío: antes la sección entera
    // desaparecía y quien nunca había tenido bumps no se enteraba de que existían.
    await expect(page.getByRole('heading', { name: /historial de bumps/i })).toBeVisible();
    await expect(page.getByText(/todavía no tienes movimientos de bumps/i)).toBeVisible();
  });
});

test.describe('UXV.6 (M8) — se puede canjear un segundo cupón sin recargar', () => {
  test('el formulario sigue ahí tras un canje correcto', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();

    await page.route('**/coupons/redeem', (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          rewardType: 'CREDITS',
          creditAmount: 10,
          featuredDurationDays: null,
          bumpAmount: null,
        }),
      }),
    );

    await page.goto('/mis-creditos');
    await page.getByTestId('coupon-code-input').fill('CODIGO1');
    await page.getByTestId('coupon-redeem-button').click();

    await expect(page.getByTestId('coupon-success')).toBeVisible({ timeout: 15_000 });

    // ANTES: el formulario desaparecía para siempre y había que recargar la página.
    await expect(page.getByTestId('coupon-code-input')).toBeVisible();
    await expect(page.getByTestId('coupon-redeem-button')).toBeVisible();

    await page.getByTestId('coupon-code-input').fill('CODIGO2');
    await expect(page.getByTestId('coupon-redeem-button')).toBeEnabled();
  });
});

test.describe('UXV.6 (M11, B6) — remates de la zona', () => {
  test('«contacta con soporte» es un enlace a soporte', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios/destacado-exito');

    const enlace = page.getByRole('link', { name: /abre un ticket de soporte/i });
    await expect(enlace).toBeVisible({ timeout: 15_000 });
    await expect(enlace).toHaveAttribute('href', '/mis-tickets/nuevo');
  });

  test('el banner promocional ya no va por delante del título de la página', async ({
    sellerContext,
  }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-anuncios');

    const titulo = page.getByRole('heading', { name: 'Mis anuncios' });
    await expect(titulo).toBeVisible({ timeout: 15_000 });

    // Lo primero que se ve en la pantalla de gestión es de qué va la pantalla, no
    // publicidad. (Sin banners activos el bloque no existe y la afirmación se cumple sola;
    // con ellos, tiene que quedar por debajo.)
    const banner = page.locator('[data-testid="banner-list"]').first();
    if ((await banner.count()) > 0) {
      const cajaTitulo = await titulo.boundingBox();
      const cajaBanner = await banner.boundingBox();
      expect(cajaBanner!.y).toBeGreaterThan(cajaTitulo!.y);
    }
  });
});

test.describe('UXV.6 (B1) — el monedero tiene UN nombre visible', () => {
  test('menú, título de página y encabezado dicen lo mismo', async ({ sellerContext }) => {
    const page = await sellerContext.newPage();
    await page.goto('/mis-creditos');

    await expect(page.getByRole('heading', { name: 'Mi saldo' })).toBeVisible({ timeout: 15_000 });
    await expect(
      page
        .getByRole('navigation', { name: /secciones de mi cuenta/i })
        .getByRole('link', { name: 'Mi saldo', exact: true }),
    ).toBeVisible();
    await expect(page).toHaveTitle(/Mi saldo/);
    // La URL se queda como está — decisión documentada, no olvido.
    expect(page.url()).toContain('/mis-creditos');
  });
});
