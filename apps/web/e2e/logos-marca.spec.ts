// TRES LOGOS L2 — EL RENDER POR ZONA Y LA PANTALLA DE MARCA, en el navegador.
//
// QUÉ SE AFIRMA AQUÍ, y qué NO. Aquí van las cosas que sólo son ciertas de verdad
// cargando la página: que las tres cabeceras montan la marca, que un logo subido llega
// al navegador de cada zona, que `/blog` intercambia el suyo, y que la pantalla de
// `/admin/marca` sube y quita — con su puerta de rol.
//
// LA CADENA DE RESPALDO NO SE EJERCE AQUÍ: son ocho combinaciones por zona y vive
// entera en `src/lib/brand.test.ts`, que las recorre en milisegundos y sin tocar el
// estado global. Lo que sí se comprueba en el navegador es el extremo que importa —que
// sin ningún logo NINGUNA cabecera se queda vacía— y el eslabón intermedio de una zona.
//
// ESTADO GLOBAL, Y POR ESO SE LIMPIA SIEMPRE. Un logo se ve en TODAS las páginas de
// todas las zonas, así que dejarse uno puesto contamina el resto de la batería. Cada
// bloque devuelve la marca a «sin logos» en su `afterAll`, pase lo que pase.
//
// LA REVALIDACIÓN ES FIRE-AND-FORGET: el backend responde 200 a la subida y DESPUÉS
// dispara el POST a `/api/revalidate`. Entre «el admin subió» y «la cabecera pública lo
// muestra» hay una ventana corta pero real, así que se espera al ESTADO con recargas —
// molde literal de `esperarFooterPublico` en `footer-admin.spec.ts`.

import * as fs from 'fs';
import * as path from 'path';
import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken, authedDelete } from './helpers/api';

const API_BASE = 'http://localhost:3001';
const ZONAS = ['public', 'backoffice', 'blog'] as const;
type Zona = (typeof ZONAS)[number];

/** Un PNG de verdad, ya en el repo (el mismo que usan los specs de subida). */
const IMAGEN = path.join(__dirname, 'fixtures', 'test-image.png');

/**
 * Un SVG mínimo. Se manda como bytes en memoria: es el formato que L1 abrió SÓLO para
 * la marca, y no había ninguno en `fixtures/` porque ninguna otra superficie lo acepta.
 */
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 8"><rect width="24" height="8" fill="#2563eb"/></svg>',
  'utf8',
);

async function subirLogo(request: APIRequestContext, zona: Zona, svg = false) {
  const res = await request.post(`${API_BASE}/api/admin/branding/logos/${zona}`, {
    headers: { Authorization: `Bearer ${adminApiToken()}` },
    multipart: {
      file: svg
        ? { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: SVG }
        : { name: 'logo.png', mimeType: 'image/png', buffer: fs.readFileSync(IMAGEN) },
    },
  });
  expect(res.ok(), `subir el logo de ${zona}: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as Record<Zona, string | null>;
}

async function limpiarMarca(request: APIRequestContext) {
  for (const zona of ZONAS) {
    await authedDelete(request, `/admin/branding/logos/${zona}`, adminApiToken());
  }
}

/** La marca de una cabecera: la imagen si la hay, o el texto de respaldo. */
function marca(page: Page) {
  return page.getByTestId('brand-logo').or(page.getByTestId('brand-text')).first();
}

/**
 * Espera a que una página refleje el cambio de marca, recargando en cada intento.
 * Sin recarga no hay contenido nuevo que ver: la cabecera se sirve del servidor con
 * caché por tag.
 */
async function esperarMarca(page: Page, ruta: string, cumple: (src: string | null) => boolean) {
  await expect(async () => {
    await page.goto(ruta);
    const el = marca(page);
    await expect(el).toBeVisible();
    const src = await el.getAttribute('src');
    if (!cumple(src)) throw new Error(`la marca de ${ruta} es ahora: ${src ?? '(texto)'}`);
  }).toPass({ timeout: 25_000 });
}

// ─────────────────────────────────────────────────────────────────────────────
// BARRERA — NINGUNA zona se queda sin marca
// ─────────────────────────────────────────────────────────────────────────────

test.describe('sin ningún logo, ninguna cabecera queda vacía', () => {
  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await limpiarMarca(request);
    await request.dispose();
  });

  test('el público y el blog muestran el nombre del sitio', async ({ page }) => {
    await esperarMarca(page, '/', (src) => src === null);
    await expect(marca(page)).toHaveText('Marketplace');

    await page.goto('/blog');
    await expect(marca(page)).toHaveText('Marketplace');
  });

  test('el backoffice NOMBRA la instancia — no dice «Backoffice» a secas', async ({
    adminContext,
  }) => {
    // §8: si el mismo código corre en dos dominios, la cabecera del panel tiene que
    // decir en cuál estás ANTES de que nadie suba ningún logo.
    const page = await adminContext.newPage();
    await page.goto('/admin');
    await expect(page.getByTestId('brand-text').first()).toHaveText('Marketplace · Backoffice');
    await page.close();
  });

  test('en móvil, el drawer del backoffice también la lleva', async ({ adminContext }) => {
    // Son DOS sitios: la cabecera de escritorio está oculta por debajo de `md`, así que
    // cambiar uno solo dejaba el móvil con el texto viejo.
    const page = await adminContext.newPage();
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/admin');
    await page.getByRole('button', { name: 'Abrir el menú del backoffice' }).click();
    // Por ROL y no por `getByLabel`: el `aria-label` va sobre el contenedor del diálogo
    // (un `div`), y `getByLabel` busca controles etiquetados, no cualquier elemento con
    // ese atributo — no lo encontraba.
    const panel = page.getByRole('dialog');
    await expect(panel.getByTestId('brand-text')).toHaveText('Marketplace · Backoffice');
    await page.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BARRERA — las tres zonas, con logo
// ─────────────────────────────────────────────────────────────────────────────

test.describe('con logos subidos', () => {
  test.describe.configure({ mode: 'serial' });

  test.afterAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await limpiarMarca(request);
    await request.dispose();
  });

  test('SÓLO el logo público: el blog y el backoffice caen a él (no al texto)', async ({
    request,
    adminContext,
  }) => {
    await limpiarMarca(request);
    const { public: publico } = await subirLogo(request, 'public', true);
    // SVG: el formato natural de un logo, y el único sitio de la plataforma que lo
    // admite. Llega tal cual al `<img>`, sin pasar por el optimizador de Next.
    expect(publico).toMatch(/\.svg$/);

    // Se navega con el contexto de admin porque este mismo caso mira también `/admin`,
    // que exige sesión; las dos rutas públicas se ven igual con sesión o sin ella.
    const admin = await adminContext.newPage();
    await esperarMarca(admin, '/', (src) => src === publico);

    // El eslabón intermedio de la cadena, en el navegador: sin logo propio, estas dos
    // zonas muestran el público — la instancia queda coherente con un solo logo subido.
    await esperarMarca(admin, '/blog', (src) => src === publico);
    await esperarMarca(admin, '/admin', (src) => src === publico);
    await admin.close();
  });

  test('los tres subidos: cada zona muestra EL SUYO', async ({ request, adminContext }) => {
    const tres = await subirLogo(request, 'public');
    const conBack = await subirLogo(request, 'backoffice');
    const conBlog = await subirLogo(request, 'blog');
    expect(new Set([tres.public, conBack.backoffice, conBlog.blog]).size).toBe(3);

    const page = await adminContext.newPage();
    await esperarMarca(page, '/', (src) => src === conBlog.public);
    // EL INTERCAMBIO DEL BLOG (opción A): misma cabecera, otro logo, decidido por la
    // ruta en el cliente. La mutación que mata: quitar el intercambio → aquí saldría el
    // logo público.
    await esperarMarca(page, '/blog', (src) => src === conBlog.blog);
    await esperarMarca(page, '/admin', (src) => src === conBlog.backoffice);
    // Y al volver fuera del blog, el público otra vez.
    await esperarMarca(page, '/busqueda', (src) => src === conBlog.public);
    await page.close();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BARRERA — la pantalla
// ─────────────────────────────────────────────────────────────────────────────

test.describe('/admin/marca', () => {
  test.afterAll(async ({ playwright }) => {
    const request = await playwright.request.newContext();
    await limpiarMarca(request);
    await request.dispose();
  });

  test('un ADMIN sube un logo desde la pantalla y lo quita', async ({ adminContext, request }) => {
    await limpiarMarca(request);
    const page = await adminContext.newPage();
    await page.goto('/admin/marca');

    const zona = page.getByTestId('zona-blog');
    await expect(zona).toBeVisible();
    // Sin logo: la pantalla dice QUÉ se está viendo, no deja un hueco.
    await expect(page.getByTestId('origen-blog')).toContainText('Sin logo');

    await page.getByTestId('input-blog').setInputFiles(IMAGEN);
    await expect(page.getByTestId('origen-blog')).toContainText('Logo propio', {
      timeout: 15_000,
    });
    // UXV.3 — el éxito se anuncia por el canal único (toast), no por un banner propio.
    await expect(page.getByText(/logo de blog actualizado/i)).toBeVisible();

    // Y se ve donde tiene que verse.
    await esperarMarca(page, '/blog', (src) => src !== null);

    // Quitar: confirmación antes (acción irreversible) y vuelta al respaldo.
    await page.goto('/admin/marca');
    await zona.getByRole('button', { name: 'Quitar' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Quitar' }).click();
    await expect(page.getByTestId('origen-blog')).toContainText('Sin logo', { timeout: 15_000 });
    await page.close();
  });

  test('un EDITOR no llega a la pantalla de marca', async ({ editorContext }) => {
    // La identidad de la instancia es ADMIN: el middleware corta por el mapa de
    // secciones, igual que con Ajustes o Instancia.
    const page = await editorContext.newPage();
    await page.goto('/admin/marca');
    // El middleware devuelve a la portada (`Response.redirect(new URL('/'))`).
    await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 });
    await expect(page.getByTestId('marca-zonas')).toHaveCount(0);
    await page.close();
  });

  test('el panel de Instancia enseña los tres logos y enlaza a Marca', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/instancia');
    const logos = page.getByTestId('instancia-logos');
    await expect(logos).toBeVisible({ timeout: 15_000 });
    await expect(logos.getByRole('link', { name: 'Cambiar' })).toBeVisible();
    await page.close();
  });
});
