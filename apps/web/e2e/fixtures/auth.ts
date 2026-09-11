// Auth fixtures for Playwright e2e tests.
// All contexts are pre-authenticated via storageState saved by global-setup.ts.
// They are passed as fixtures so individual tests don't repeat the login UI flow.

import { test as base, type BrowserContext, type Page } from '@playwright/test';
import * as path from 'path';

const FIXTURES_DIR = path.join(__dirname);

/**
 * COOKIES RÁFAGA 2 — LA DECISIÓN YA TOMADA, PARA LAS 300 SPECS QUE NO VAN DE COOKIES.
 *
 * ─── QUÉ PROBLEMA RESUELVE, Y POR QUÉ NO ES «ARREGLAR EL TEST» ──────────────────
 *
 * El banner es `fixed` al pie, así que **intercepta los clics de lo que quede debajo**.
 * Lo cazó `bump-programado` en móvil: Playwright veía el botón, hacía scroll hasta él y
 * el clic se lo comía el banner.
 *
 * La reacción fácil —y equivocada— habría sido tocar ese test. Lo que ocurre es otra
 * cosa: **el estado por defecto de la batería no era realista**. Un visitante real ve el
 * banner UNA vez, decide, y no vuelve a verlo; las demás specs ejercitan la aplicación
 * tal como la usa alguien que ya decidió hace tiempo. Sembrar esa decisión es reproducir
 * ese estado, no esquivar nada.
 *
 * ─── SE SIEMBRA UN RECHAZO, NO UNA ACEPTACIÓN ───────────────────────────────────
 *
 * Y es deliberado: con el rechazo, el gate de la ráfaga 1 **sigue reteniendo** los
 * terceros, que es el estado conservador. Sembrar una aceptación haría que cientos de
 * tests cargaran Vimeo y MapTiler de verdad — red real, lentitud, y una batería que
 * dejaría de notar si el gate se rompiera.
 *
 * ─── LO QUE ESTO NO TAPA ────────────────────────────────────────────────────────
 *
 * El banner tiene su propia batería (`cookies-banner.spec.ts`), que parte SIN cookie y
 * comprueba lo suyo. Y `consentimiento-gate.spec.ts` la limpia antes de cada caso porque
 * lo que prueba es justamente el estado «todavía no ha decidido».
 */
const COOKIE_CONSENTIMIENTO = {
  name: 'mp_consent',
  // `v` tiene que coincidir con `cookiePolicyVersion` del seed, o el banner consideraría
  // la cookie caducada (D5) y volvería a salir. Ver `seed-settings.ts`.
  value: encodeURIComponent(JSON.stringify({ v: '1', c: [], t: 1_757_548_800, id: null })),
  domain: 'localhost',
  path: '/',
};

async function conConsentimiento(ctx: BrowserContext): Promise<BrowserContext> {
  await ctx.addCookies([COOKIE_CONSENTIMIENTO]);
  return ctx;
}

export const test = base.extend<{
  sellerContext: BrowserContext;
  buyerContext: BrowserContext;
  proContext: BrowserContext;
  adminContext: BrowserContext;
  moderatorContext: BrowserContext;
  editorContext: BrowserContext;
}>({
  /**
   * La `page` anónima también parte de una decisión tomada, por el mismo motivo que los
   * contextos con sesión: la mayoría de las specs anónimas tampoco van de cookies.
   */
  page: async ({ page }: { page: Page }, use) => {
    await conConsentimiento(page.context());
    await use(page);
  },

  sellerContext: async ({ browser }, use) => {
    const ctx = await conConsentimiento(
      await browser.newContext({
        storageState: path.join(FIXTURES_DIR, 'seller.storageState.json'),
      }),
    );
    await use(ctx);
    await ctx.close();
  },

  buyerContext: async ({ browser }, use) => {
    const ctx = await conConsentimiento(
      await browser.newContext({
        storageState: path.join(FIXTURES_DIR, 'buyer.storageState.json'),
      }),
    );
    await use(ctx);
    await ctx.close();
  },

  proContext: async ({ browser }, use) => {
    const ctx = await conConsentimiento(
      await browser.newContext({
        storageState: path.join(FIXTURES_DIR, 'pro.storageState.json'),
      }),
    );
    await use(ctx);
    await ctx.close();
  },

  adminContext: async ({ browser }, use) => {
    const ctx = await conConsentimiento(
      await browser.newContext({
        storageState: path.join(FIXTURES_DIR, 'admin.storageState.json'),
      }),
    );
    await use(ctx);
    await ctx.close();
  },

  moderatorContext: async ({ browser }, use) => {
    const ctx = await conConsentimiento(
      await browser.newContext({
        storageState: path.join(FIXTURES_DIR, 'moderator.storageState.json'),
      }),
    );
    await use(ctx);
    await ctx.close();
  },

  editorContext: async ({ browser }, use) => {
    const ctx = await conConsentimiento(
      await browser.newContext({
        storageState: path.join(FIXTURES_DIR, 'editor.storageState.json'),
      }),
    );
    await use(ctx);
    await ctx.close();
  },
});

export { expect } from '@playwright/test';
