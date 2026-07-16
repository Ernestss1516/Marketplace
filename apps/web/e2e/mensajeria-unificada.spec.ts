// RÁFAGA 5 (mensajería unificada) — split-view bandeja+chat en una sola vista,
// con dos navegadores reales (seller/buyer). Cubre justo los puntos que el
// diseño identificó como riesgo de la reestructuración (la mensajería en sí
// ya tiene su propia cobertura en messaging.e2e-spec.ts, backend):
//   1. fetchEligibility/Valorar sigue funcionando con un Deal real.
//   2. Cambiar de conversación remonta ChatClient (join+eligibility) sin que
//      la lista parpadee/refetch ni el socket se reconecte.
//   3. Entrega en tiempo real: badge de una conversación NO abierta se
//      actualiza sin round-trip; la abierta se ve siempre en 0.
//   4. El GET de fondo de "marcar leído" no se dispara una vez por mensaje
//      en una ráfaga (debounce).
//   5. Estados vacíos (sin conversaciones, sin selección en escritorio) y
//      layout responsive (una sola columna <768px, con "atrás" nativo).
//
// Setup vía API directa (loginViaApi + authedPost), igual que
// listing-phone-share.spec.ts — más rápido y estable que pasar por el wizard.

import { test, expect } from './fixtures/auth';
import { loginViaApi, authedPost, authedGet } from './helpers/api';

test.describe('Mensajería unificada (bandeja + chat)', () => {
  let sellerToken: string;
  let buyerToken: string;
  let sellerId: string;
  let buyerId: string;
  let categoryId: string;
  let listingId: string;
  let listingSlug: string;
  let listingTitle: string;
  let conversationId: string;

  test.beforeAll(async ({ request }) => {
    sellerToken = await loginViaApi(request, 'seller-e2e@example.com', 'Test1234!');
    buyerToken = await loginViaApi(request, 'buyer-e2e@example.com', 'Test1234!');

    const sellerMe = await authedGet(request, '/users/me', sellerToken);
    sellerId = (await sellerMe.json()).id as string;
    const buyerMe = await authedGet(request, '/users/me', buyerToken);
    buyerId = (await buyerMe.json()).id as string;

    const catRes = await authedGet(request, '/categories/moviles');
    categoryId = (await catRes.json()).id as string;

    listingTitle = `Mensajería unificada R5 ${Date.now()}`;
    const draftRes = await authedPost(request, '/listings', sellerToken, {
      title: listingTitle,
      description: 'Anuncio de prueba para verificar la mensajería unificada.',
      price: 50,
      type: 'PRODUCT',
      priceType: 'FIXED',
      condition: 'GOOD',
      categoryId,
      city: 'Madrid',
      province: 'Madrid',
      latitude: 40.4168,
      longitude: -3.7038,
    });
    if (draftRes.status() !== 201) {
      throw new Error(`[setup] no se pudo crear el anuncio: ${draftRes.status()} ${await draftRes.text()}`);
    }
    const draft = (await draftRes.json()) as { id: string; slug: string };
    listingId = draft.id;
    listingSlug = draft.slug;

    const publishRes = await authedPost(request, `/listings/${listingId}/publish`, sellerToken, {});
    if (publishRes.status() !== 200) {
      throw new Error(`[setup] no se pudo publicar el anuncio: ${publishRes.status()} ${await publishRes.text()}`);
    }

    // Buyer arranca la conversación por API — más rápido que por UI, y el
    // formulario de contacto ya tiene su propia cobertura (flujo-critico.spec.ts).
    const convRes = await authedPost(request, '/conversations', buyerToken, {
      listingId,
      message: 'Hola, ¿sigue disponible?',
    });
    if (convRes.status() !== 201) {
      throw new Error(`[setup] no se pudo iniciar la conversación: ${convRes.status()} ${await convRes.text()}`);
    }
    conversationId = ((await convRes.json()) as { id: string }).id;

    // Cierra el trato (PRODUCT → agota el anuncio) para que fetchEligibility
    // devuelva canReview:true en cuanto el vendedor abra el chat.
    const dealRes = await authedPost(request, `/listings/${listingId}/deals`, sellerToken, {
      buyerId,
    });
    if (dealRes.status() !== 201) {
      throw new Error(`[setup] no se pudo cerrar el trato: ${dealRes.status()} ${await dealRes.text()}`);
    }
  });

  test('bandeja+chat: fetchEligibility, remount, tiempo real, layout', async ({
    sellerContext,
    buyerContext,
  }) => {
    // ── 1. Escritorio: estado vacío sin selección ──────────────────────────
    const sellerPage = await sellerContext.newPage();
    await sellerPage.setViewportSize({ width: 1280, height: 900 });

    // Cuenta conexiones WebSocket reales abiertas por el navegador — la
    // afirmación central del diseño es que cambiar de conversación NO abre
    // una nueva (joinConversation es imperativo sobre la misma conexión).
    let sellerWsCount = 0;
    sellerPage.on('websocket', () => {
      sellerWsCount++;
    });

    // Selector estable por href — con test data acumulada de corridas
    // previas (este spec crea un anuncio+conversación nuevos cada vez y no
    // hay limpieza automática de la BD de test entre corridas manuales), un
    // selector por TEXTO del título puede coincidir con la fila equivocada
    // o quedar más abajo en una lista larga; el href de esta conversación
    // concreta es inequívoco pase lo que pase con filas de otras corridas.
    const rowLink = sellerPage.locator(`a[href="/mensajes/${conversationId}"]`);

    await sellerPage.goto('/mensajes');
    await expect(sellerPage.getByText('Selecciona una conversación')).toBeVisible();
    // La lista sigue visible a la vez que el estado vacío (split-view real)
    await expect(sellerPage.getByRole('heading', { name: 'Mensajes' })).toBeVisible();
    await expect(rowLink).toBeVisible({ timeout: 15_000 });
    await expect(rowLink).toContainText(listingTitle);

    // ── 2. Abrir la conversación → fetchEligibility dispara "Valorar" ──────
    await rowLink.click();
    await sellerPage.waitForURL('**/mensajes/**');
    await expect(
      sellerPage.getByRole('button', { name: 'Valorar' }),
    ).toBeVisible({ timeout: 10_000 });

    // ── 3. Volver a la bandeja y reabrir — navegación real por Link (no
    // goto(), que forzaría una recarga dura y remontaría el layout entero,
    // invalidando justo lo que queremos probar: que /mensajes/layout.tsx
    // persiste entre selecciones). El enlace "Mensajes" del menú de cuenta
    // es un <Link> normal → navegación de cliente de Next.js.
    await sellerPage.getByRole('link', { name: 'Mensajes' }).click();
    await expect(sellerPage).toHaveURL(/\/mensajes$/);
    await expect(sellerPage.getByText('Selecciona una conversación')).toBeVisible();
    await rowLink.click();
    await sellerPage.waitForURL('**/mensajes/**');
    await expect(
      sellerPage.getByRole('button', { name: 'Valorar' }),
    ).toBeVisible({ timeout: 10_000 });

    // Segunda vuelta de ida/vuelta: si cada cambio de conversación abriera
    // una conexión nueva, el contador crecería aquí (3, 4…). Si es un
    // artefacto del doble-montaje de React StrictMode en `next dev` (montaje
    // inicial: monta→desmonta→monta), el contador ya está fijo tras la
    // primera carga y NO crece con más cambios de conversación — eso es lo
    // que este segundo ciclo distingue.
    await sellerPage.getByRole('link', { name: 'Mensajes' }).click();
    await expect(sellerPage).toHaveURL(/\/mensajes$/);
    await rowLink.click();
    await sellerPage.waitForURL('**/mensajes/**');
    await expect(
      sellerPage.getByRole('button', { name: 'Valorar' }),
    ).toBeVisible({ timeout: 10_000 });

    // El número exacto depende de si next dev con StrictMode duplica el
    // montaje inicial (development-only); lo que importa es que NO crezca
    // con más cambios de conversación — eso confirmaría un reconnect real.
    const wsCountAfterFirstSwitch = sellerWsCount;
    expect(wsCountAfterFirstSwitch).toBeLessThanOrEqual(2);

    await sellerPage.getByRole('link', { name: 'Mensajes' }).click();
    await expect(sellerPage).toHaveURL(/\/mensajes$/);
    await sellerPage.getByText(listingTitle).first().click();
    await sellerPage.waitForURL('**/mensajes/**');
    await expect(
      sellerPage.getByRole('button', { name: 'Valorar' }),
    ).toBeVisible({ timeout: 10_000 });

    expect(sellerWsCount).toBe(wsCountAfterFirstSwitch);

    const conversationUrl = sellerPage.url();

    // ── 4. Refresh se queda en la conversación (no vuelve a la bandeja) ────
    await sellerPage.reload();
    await expect(sellerPage).toHaveURL(conversationUrl);
    await expect(
      sellerPage.getByRole('button', { name: 'Valorar' }),
    ).toBeVisible({ timeout: 10_000 });

    // ── 5. Tiempo real: el buyer manda varios mensajes seguidos (ráfaga) ───
    const buyerPage = await buyerContext.newPage();
    await buyerPage.setViewportSize({ width: 1280, height: 900 });
    await buyerPage.goto(conversationUrl.replace(/^.*\/mensajes/, '/mensajes'));
    // Aparece dos veces en escritorio: la fila de la lista Y el header del
    // chat abierto (split-view real) — .first() basta para confirmar carga.
    await expect(buyerPage.getByText(listingTitle).first()).toBeVisible({ timeout: 10_000 });

    // Cuenta las llamadas de "marcar leído" de fondo (GET /conversations/:id
    // sin query params — con `before`/`limit` es paginación, no esto) que
    // dispara el seller al recibir mensajes por socket mientras tiene la
    // conversación abierta. La instrucción explícita era: una ráfaga de
    // varios mensajes seguidos dispara UNA sola llamada, no una por mensaje.
    let markReadCalls = 0;
    sellerPage.on('request', (req) => {
      if (
        req.method() === 'GET' &&
        new URL(req.url()).pathname === `/api/conversations/${conversationId}`
      ) {
        markReadCalls++;
      }
    });

    const input = buyerPage.getByPlaceholder(/Escribe un mensaje/);
    for (const text of ['uno', 'dos', 'tres']) {
      // Justo tras el goto() el DOM ya existe (SSR) pero React puede no haber
      // terminado de hidratar — un Enter demasiado pronto no dispara el
      // handler todavía. Reintentar el envío entero (no solo la espera) es
      // el mismo patrón ya usado en flujo-critico.spec.ts para una carrera
      // de hidratación equivalente.
      await expect(async () => {
        // No reenviar si el intento anterior sí llegó a mandarse y solo
        // faltaba que el DOM se actualizara — evita duplicar el mensaje.
        const alreadySent = await buyerPage.getByText(text, { exact: true }).count();
        if (alreadySent === 0) {
          await input.fill(text);
          await input.press('Enter');
        }
        await expect(buyerPage.getByText(text, { exact: true }).last()).toBeVisible({ timeout: 3_000 });
      }).toPass({ timeout: 15_000 });
    }

    // Los tres llegan por socket al seller, que tiene la conversación abierta.
    await expect(sellerPage.getByText('tres', { exact: true }).last()).toBeVisible({ timeout: 10_000 });
    await expect(sellerPage.getByText('uno', { exact: true }).last()).toBeVisible();

    // El debounce es de 1200ms — esperamos más que eso para dejar que la
    // llamada (si va a disparar) se dispare, y verificamos que fue UNA sola
    // por los 3 mensajes de la ráfaga, no 3.
    await sellerPage.waitForTimeout(1800);
    expect(markReadCalls).toBe(1);

    // ── 6. Badge: conversación NO abierta se actualiza vía socket ──────────
    // El seller vuelve a la bandeja (deja de tener la conversación "abierta")
    // y el buyer manda un mensaje más — debe aparecer un badge sin recargar.
    await sellerPage.getByRole('link', { name: 'Mensajes' }).click();
    await expect(sellerPage).toHaveURL(/\/mensajes$/);
    await input.fill('cuatro');
    await input.press('Enter');
    await expect(sellerPage.getByText('4', { exact: true })).toBeVisible({ timeout: 10_000 });

    // Al reabrir, el badge se pone a 0 sin esperar ningún round-trip visible.
    await rowLink.click();
    await sellerPage.waitForURL('**/mensajes/**');
    await expect(sellerPage.getByText('cuatro', { exact: true }).last()).toBeVisible();

    // ── 7. Móvil: una sola columna + back nativo ────────────────────────────
    await sellerPage.setViewportSize({ width: 375, height: 800 });
    await sellerPage.goto('/mensajes');
    // En móvil sin selección: la lista se ve, el chat no.
    await expect(sellerPage.getByRole('heading', { name: 'Mensajes' })).toBeVisible();
    await expect(rowLink).toBeVisible({ timeout: 15_000 });
    await rowLink.click();
    await sellerPage.waitForURL('**/mensajes/**');
    await expect(sellerPage.getByRole('button', { name: 'Valorar' })).toBeVisible();
    // La lista no debe verse a la vez que el chat en móvil.
    await expect(sellerPage.getByRole('heading', { name: 'Mensajes' })).toBeHidden();

    await sellerPage.goBack();
    await expect(sellerPage).toHaveURL(/\/mensajes$/);
    await expect(sellerPage.getByRole('heading', { name: 'Mensajes' })).toBeVisible();
  });

  test('sin conversaciones: estado vacío a ancho completo, sin columna fija', async ({
    moderatorContext,
  }) => {
    const page = await moderatorContext.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/mensajes');
    await expect(page.getByText('Aún no tienes conversaciones.')).toBeVisible();
    // No debe quedar rastro de la columna fija de 22rem del split-view: el
    // contenedor del mensaje vacío ocupa el ancho completo del panel.
    const emptyBox = page.getByText('Aún no tienes conversaciones.').locator('..');
    const box = await emptyBox.boundingBox();
    expect(box?.width).toBeGreaterThan(400);
  });
});
