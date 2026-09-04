import type { APIRequestContext, Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { adminApiToken } from './helpers/api';

/**
 * ══ E6 · LA FRONTERA, HECHA TEST ═════════════════════════════════════════════════════
 *
 * «Un modelo REVISTE, no REORGANIZA» es la decisión #1 de todo el sistema de estilo, y
 * hasta hoy era una regla de DISCIPLINA: se cumplía porque quien escribía un modelo se
 * acordaba. Esto la convierte en un rojo de CI.
 *
 * El mecanismo, del §10.5 del diseño: se carga la MISMA RUTA con DOS MODELOS distintos y
 * se compara el árbol DOM ignorando por completo estilos y clases. **Si difiere en algo
 * más que en estilo, el modelo reorganizó, y el test se pone rojo.**
 *
 * ── POR QUÉ HACE FALTA UN MODELO EXTREMO ─────────────────────────────────────────────
 *
 * Porque con dos modelos parecidos este test pasaría por casualidad. `MODELO_PRUEBA`
 * («Contraluz») invierte el lienzo, cambia la familia tipográfica, multiplica el radio
 * por 2,5, dobla el tempo y adelgaza el trazo de los iconos. Si una reorganización se le
 * escapa a ése, no la iba a cazar ninguno.
 *
 * ── SE ACTIVA POR LA VÍA REAL ────────────────────────────────────────────────────────
 *
 * Con el mismo `PUT /api/admin/estilo` que usaría un admin, no escribiendo la fila a
 * mano. Así el test recorre lo que recorre producción —validación AA, `AuditLog` y, sobre
 * todo, el `revalidateTag('estilo')` que tumba la caché del frontend—. Un test que se
 * salta el camino de producción da un verde que no dice nada.
 *
 * ── LO QUE SE IGNORA AL COMPARAR, Y POR QUÉ ──────────────────────────────────────────
 *
 * `class` y `style`, obviamente: son el revestimiento. Y los identificadores generados
 * (`id`, `for`, `aria-controls`…), porque Radix los numera por orden de montaje y dos
 * cargas pueden repartirlos distinto sin que nadie haya cambiado nada — ruido, no señal.
 * Se ignoran también `<script>` y `<style>`: el primero lleva la carga de React (que
 * incluye el propio CSS del tema) y el segundo ES el tema.
 *
 * Lo que SÍ se compara: la sucesión de etiquetas, su anidamiento, TODO EL TEXTO y el
 * resto de atributos —`href`, `src`, `alt`, `role`, `type`, `data-testid`—. O sea: un
 * modelo no puede cambiar la estructura, ni el contenido, ni a dónde lleva un enlace, ni
 * lo que oye un lector de pantalla.
 */

const RUTAS_PUBLICAS = ['/planes', '/login', '/registro', '/contacto', '/admin/login'];
const RUTA_BACKOFFICE = '/admin/anuncios';

const COLORES_0 = {
  primary: '221.2 83.2% 53.3%',
  secondary: '210 40% 96.1%',
  accent: '210 40% 96.1%',
  neutral: '210 40% 96.1%',
};
const COLORES_PRUEBA = {
  primary: '28 96% 54%',
  secondary: '168 62% 30%',
  accent: '318 62% 42%',
  neutral: '30 22% 20%',
};

const API = 'http://localhost:3001';

async function ponerModelo(
  request: APIRequestContext,
  modelo: string,
  colores: Record<string, string>,
): Promise<void> {
  const res = await request.put(`${API}/api/admin/estilo`, {
    headers: { Authorization: `Bearer ${adminApiToken()}` },
    data: { modelo, version: '1', colores },
  });
  if (!res.ok()) {
    throw new Error(`[invariancia] no se pudo activar ${modelo}: ${res.status()} ${await res.text()}`);
  }
}

/**
 * El árbol de una ruta, normalizado a texto. Se serializa DENTRO de la página para no
 * traerse el DOM entero por el puente de Playwright.
 */
async function arbolDe(page: Page, ruta: string): Promise<string> {
  await page.goto(ruta);
  await page.waitForLoadState('domcontentloaded');
  // Las pantallas del backoffice piden sus datos desde el cliente; sin esto se
  // compararían dos esqueletos vacíos, que coinciden siempre.
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

  return page.evaluate(() => {
    const IGNORAR = new Set([
      'class',
      'style',
      'id',
      'for',
      'aria-controls',
      'aria-labelledby',
      'aria-describedby',
      'aria-owns',
      'aria-activedescendant',
    ]);
    const SALTAR = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
    const salida: string[] = [];

    const recorrer = (nodo: Node): void => {
      if (nodo.nodeType === Node.TEXT_NODE) {
        const t = (nodo.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (t) salida.push(`#${t}`);
        return;
      }
      if (nodo.nodeType !== Node.ELEMENT_NODE) return;
      const el = nodo as Element;
      if (SALTAR.has(el.tagName)) return;
      const tag = el.tagName.toLowerCase();
      const attrs = Array.from(el.attributes)
        .filter((a) => !IGNORAR.has(a.name))
        .map((a) => `${a.name}="${a.value}"`)
        .sort()
        .join(' ');
      salida.push(`<${tag}${attrs ? ' ' + attrs : ''}>`);
      for (const hijo of Array.from(el.childNodes)) recorrer(hijo);
      salida.push(`</${tag}>`);
    };

    recorrer(document.body);
    return salida.join('\n');
  });
}

/** Lo que sí tiene que cambiar: el bloque de variables del tema. */
async function temaDe(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raiz = getComputedStyle(document.documentElement);
    return [
      raiz.getPropertyValue('--background').trim(),
      raiz.getPropertyValue('--primary').trim(),
      raiz.getPropertyValue('--radius').trim(),
      raiz.getPropertyValue('--font-sans').trim(),
      raiz.getPropertyValue('--motion-duration').trim(),
    ].join(' | ');
  });
}

test.describe('Invariancia del HTML entre modelos', () => {
  test.afterEach(async ({ request }) => {
    // Pase lo que pase, la instancia vuelve al Modelo 0: esto corre dentro de la batería
    // compartida y un tema de prueba fugado repintaría todas las specs siguientes.
    await ponerModelo(request, 'modelo-0', COLORES_0);
  });

  test('dos modelos radicalmente distintos producen el MISMO árbol', async ({
    page,
    adminContext,
    request,
  }) => {
    const paginaAdmin = await adminContext.newPage();

    // ── 1 · El árbol con el Modelo 0 ──────────────────────────────────────────────
    await ponerModelo(request, 'modelo-0', COLORES_0);
    const temaCero = await temaDe(await abrir(page, '/planes'));
    const cero: Record<string, string> = {};
    for (const ruta of RUTAS_PUBLICAS) cero[ruta] = await arbolDe(page, ruta);
    cero[RUTA_BACKOFFICE] = await arbolDe(paginaAdmin, RUTA_BACKOFFICE);

    // ── 2 · El mismo árbol con el modelo extremo ──────────────────────────────────
    await ponerModelo(request, 'modelo-prueba-contraluz', COLORES_PRUEBA);
    const temaExtremo = await temaDe(await abrir(page, '/planes'));
    const extremo: Record<string, string> = {};
    for (const ruta of RUTAS_PUBLICAS) extremo[ruta] = await arbolDe(page, ruta);
    extremo[RUTA_BACKOFFICE] = await arbolDe(paginaAdmin, RUTA_BACKOFFICE);

    /**
     * ⚠ LA RED DEL TEST, Y VA ANTES QUE LA COMPARACIÓN.
     *
     * Si el cambio de modelo no llegara a la página —la caché del frontend sin tumbar,
     * el PUT sin efecto, el bloque sin emitir—, las dos capturas serían del MISMO tema y
     * el árbol coincidiría por el motivo equivocado. Un verde así es peor que un rojo:
     * afirma que la frontera se respeta cuando lo que ocurre es que no se ha probado.
     */
    expect(
      temaExtremo,
      'el modelo extremo no llegó a la página: la comparación de abajo no probaría nada',
    ).not.toBe(temaCero);

    // ── 3 · La frontera ───────────────────────────────────────────────────────────
    for (const ruta of [...RUTAS_PUBLICAS, RUTA_BACKOFFICE]) {
      expect(extremo[ruta], `«${ruta}» cambió de estructura al cambiar de modelo`).toBe(
        cero[ruta],
      );
    }

    await paginaAdmin.close();
  });
});

/** Navega y devuelve la misma página, para poder encadenar. */
async function abrir(page: Page, ruta: string): Promise<Page> {
  await page.goto(ruta);
  await page.waitForLoadState('domcontentloaded');
  return page;
}
