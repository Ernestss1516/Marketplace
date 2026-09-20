// EL LCP DE /busqueda CON LAS DOS FILAS DE DESTACADOS — medido sobre una IMAGEN, no sobre
// un párrafo.
//
// ── QUÉ PENDIENTE CIERRA ─────────────────────────────────────────────────────────────────
//
// `estado-tecnico.md` («Destacados — RÁFAGA 3») dejó esto escrito, y con razón:
//
//   «⚠ EL LCP NO SE MIDIÓ DE VERDAD […] La semilla de pruebas no trae imágenes, así que el
//    bloque pinta ocho marcos vacíos y el elemento LCP resultó ser un <p> de texto. La
//    medición no tocó el camino de las imágenes, que es justo el que las dos filas duplican.
//    […] queda pendiente y no está cubierto por ninguna barrera.»
//
// El diagnóstico previo a escribir esto encontró que la frase se quedaba corta en un punto
// que cambia la solución: la batería SÍ sube fotos —diecisiete specs lo hacen— pero todas
// suben `fixtures/test-image.png`, **un PNG de 1×1 y 70 bytes**. Y el tamaño que el estándar
// de LCP atribuye a una imagen es `min(área intrínseca, área pintada)`: un 1×1 vale **1**,
// así que cualquier párrafo lo gana. O sea que sembrar fotos con la fixture de siempre
// habría dado exactamente el mismo resultado de antes y con más pasos. Ver
// `helpers/foto-determinista.ts`.
//
// ── LAS CINCO BARRERAS, Y LA QUE SE DECIDIÓ NO PONER ─────────────────────────────────────
//
//   B1  La semilla es DETERMINISTA: los píxeles están firmados y los bytes que el navegador
//       descarga son los mismos en dos cargas.
//   B2  El elemento LCP es UNA IMAGEN del bloque de destacados —el camino que las dos filas
//       duplican—, no un texto.
//   B3  El instrumento NO da verde por no medir: servir esas mismas fotos SIN OPTIMIZAR
//       empeora el LCP medido, y se exige que lo acuse.
//   B5  `GRID_MEDIA_SIZES` pide el tamaño JUSTO: el ancho que el navegador descarga es el
//       menor del `srcset` que cubre la caja pintada. Ni borroso ni de más.
//
//   B4  **NO hay umbral de tiempo, y es una decisión, no un olvido.** Un tope de
//       milisegundos en un runner compartido es un generador de rojos ambientales, y este
//       repositorio ya decidió que un rojo que a veces sale enseña a ignorar los rojos
//       (`playwright.snapshots.config.ts`, `retries: 0`). La prueba de estabilidad de abajo
//       MIDE la dispersión y la imprime, para que la decisión se pueda revisar con datos en
//       vez de con opiniones; lo que no hace es convertirla en una barrera.
//
// El molde es el del CLS de `hueco-banner-invisible.spec.ts`: comparar DOS medidas de la
// MISMA página en la MISMA corrida, en vez de comparar una medida contra una constante.
// Es lo único que no depende de lo cargado que esté el runner.

import type { CDPSession, Page, Response } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { loginViaApi, pollSearch } from './helpers/api';
import { limpiarAnunciosPorPrefijo } from './helpers/seed-listings';
import { firmaDeLosPixeles, LADO, SHA256_PIXELES } from './helpers/foto-determinista';
import { sembrarDestacadosConFoto, type AnuncioConFoto } from './helpers/seed-fotos-lcp';
import { MAXIMO_VISIBLE } from '../src/components/busqueda/destacados-dos-filas';

/** El prefijo de los títulos sembrados — también lo que la limpieza busca. */
const MARCA = 'LCPFOTO';

/**
 * QUIÉN SIEMBRA, Y POR QUÉ NO ES EL VENDEDOR — DOS ROJOS, LOS DOS DE LA BATERÍA ENTERA.
 *
 * Destacar de verdad se paga, así que esta spec pide saldo al administrador y lo gasta. Eso
 * deja **cartera con saldo y apuntes en el historial** en la cuenta que lo haga.
 *
 * 1 · CON `seller-e2e` CAÍAN DOS SPECS POSTERIORES: `mis-creditos` («renderiza la página con
 *     saldo 0 e historial vacío») y `pulido` («sin movimientos, el vacío dice qué son»). Las
 *     dos afirman, con razón, que ese vendedor **no tiene cartera** — es el estado que
 *     necesitan para probar el vacío, y no hay forma de devolverlo: retirar el saldo deja los
 *     apuntes, y los apuntes son justo lo que miran.
 *
 * 2 · Y CON UNA CUENTA NUEVA EN LA SEMILLA CAÍA EL JOB DE CAPTURAS. Fue lo siguiente que se
 *     probó, y el CI lo cazó: `/admin` pinta «Usuarios totales», el job de capturas usa el
 *     MISMO `seed-playwright.ts`, y un séptimo usuario mueve esa cifra — o sea, una captura
 *     roja por haber añadido una cuenta de pruebas. Regenerar la base para acomodarla habría
 *     sido exactamente el rojo crónico de capturas que `estado-tecnico.md` documenta.
 *
 * Así que se reutiliza `buyer-e2e`, que es la única cuenta a la que **ya se le dan créditos**
 * en la batería (`h8-d3-coupons` le canjea cupones de 25 y 5) y de la que, precisamente por
 * eso, **nadie afirma que tenga la cartera vacía**. Y ese spec corre ANTES que éste en el
 * orden alfabético, así que tampoco se le estropea lo suyo. Que el «comprador» publique suena
 * raro, pero aquí los ocho anuncios son un soporte para ocho fotos y se borran al terminar.
 */
const VENDEDOR = 'buyer-e2e@example.com';

/** El bloque «Promocionados», por el nombre accesible que le pone `FeaturedBlock`. */
const BLOQUE = 'section[aria-label*="promocionados"]';

let sembrados: AnuncioConFoto[] = [];
let RUTA = '';

test.beforeAll(async ({ playwright }) => {
  // Ocho altas con una foto de 3,3 MB cada una, ocho publicaciones, ocho destacados y la
  // espera a que Meilisearch los tenga. No cabe en el plazo por defecto de un test.
  test.setTimeout(240_000);

  const request = await playwright.request.newContext();
  try {
    const token = await loginViaApi(request, VENDEDOR, 'Test1234!');

    // La misma barrera que `tags-filtro.spec.ts` y por el mismo motivo: Playwright descarta
    // el worker cuando un test falla y vuelve a ejecutar este `beforeAll`, así que sin esto
    // cada fallo dejaría OTRA generación de ocho destacados — y con más de ocho compitiendo,
    // el anillo de la rotación serviría un turno distinto y la página dejaría de enseñar los
    // de esta generación. Ver `helpers/seed-listings.ts`.
    await limpiarAnunciosPorPrefijo(request, token, `${MARCA} `);

    const sello = String(Date.now());
    sembrados = await sembrarDestacadosConFoto(request, token, {
      marca: MARCA,
      sello,
      cuantos: MAXIMO_VISIBLE,
    });

    // La búsqueda se acota a ESTOS anuncios: así el bloque de destacados son exactamente los
    // ocho sembrados, pase lo que pase con lo que hayan dejado otras specs.
    RUTA = `/busqueda?q=${MARCA}`;

    // La indexación es asíncrona (BullMQ), y además el destacado encola una REINDEXACIÓN
    // aparte: no basta con que el anuncio esté, tiene que estar YA con `boostScore = 1`, que
    // es lo que lo mete en el bloque.
    await pollSearch(
      request,
      { q: MARCA, hitsPerPage: '30' },
      (body) =>
        body.hits.filter((h) => (h as { boostScore?: number }).boostScore === 1).length >=
        MAXIMO_VISIBLE,
      { timeoutMs: 90_000 },
    );
  } finally {
    await request.dispose();
  }
});

/**
 * ⚠ SE RECOGE LO SEMBRADO, y no es higiene: es la misma lección que el `afterAll` de
 * `hueco-banner-invisible.spec.ts` («para no filtrar a los specs siguientes — la batería
 * comparte base»), sólo que aquí lo que se filtra es peor.
 *
 * Estos ocho anuncios quedan ACTIVE **y destacados durante siete días** en el índice. Todo lo
 * que corra después y mire una lista de resultados —y va media batería por detrás en el orden
 * alfabético— se encontraría con un bloque «Promocionados» lleno de anuncios que no ha
 * sembrado, y con ocho resultados de más en `moviles`. Un rojo así aparece en una spec sin
 * ninguna relación con ésta y no dice de dónde viene.
 *
 * Se borran por la API y no por Prisma, por lo mismo que `limpiarAnunciosPorPrefijo`:
 * `DELETE /listings/:id` encola la retirada del índice igual que en producción, y un borrado
 * por debajo dejaría el documento huérfano en Meilisearch — o sea, el filtrado que esto
 * evita, exactamente igual pero sin fila en Postgres a la que echarle la culpa.
 */
test.afterAll(async ({ playwright }) => {
  const request = await playwright.request.newContext();
  try {
    const token = await loginViaApi(request, VENDEDOR, 'Test1234!');
    await limpiarAnunciosPorPrefijo(request, token, `${MARCA} `);
  } finally {
    await request.dispose();
  }
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// EL INSTRUMENTO
// ─────────────────────────────────────────────────────────────────────────────────────────

interface MedidaLcp {
  /** Cuántas entradas emitió el observador. Cero = el instrumento no vio NADA. */
  entradas: number;
  /** El instante del elemento LCP final, en ms desde el inicio de la navegación. */
  ms: number;
  /** El área que el estándar le atribuye. Para una imagen, `min(intrínseca, pintada)`. */
  area: number;
  /** La dirección que el navegador descargó (vacía si el LCP fue un texto). */
  url: string;
  etiqueta: string;
  /** Si el LCP cayó dentro del bloque de destacados. */
  enElBloque: boolean;
  /** El texto del elemento, recortado — lo que se lee cuando el LCP resulta ser un párrafo. */
  texto: string;
  anchoPintado: number;
  altoPintado: number;
  anchoIntrinseco: number;
  dpr: number;
  srcset: string;
  /** Bytes de TODAS las imágenes de la carga medida. Es el estímulo de la barrera 3. */
  bytesImagenes: number;
}

/** La sesión CDP de cada página armada — la que vacía la caché antes de cada medida. */
const sesionesCdp = new WeakMap<Page, CDPSession>();

/**
 * UNA RED CON ANCHO DE BANDA FINITO — 40 Mbit/s de bajada y 20 ms de latencia.
 *
 * ── POR QUÉ HAY QUE PONER ESTO, Y NO ES «HACERLO MÁS DIFÍCIL» ───────────────────────────
 *
 * Se midió sin ello primero, y el resultado fue el que enseña por qué hace falta: sirviendo
 * las ocho fotos **sin optimizar** —de ~62 KB a 3,3 MB cada una, **×155 en bytes**— el LCP
 * pasaba de 444 ms a 448 ms. Un ×1,01. Y en la siguiente corrida, con el mismo estímulo,
 * ×1,62.
 *
 * No era que el instrumento no viera: era que en `localhost` **el ancho de banda es
 * prácticamente infinito**, así que los bytes de la imagen no son el cuello de botella de
 * nada y el LCP lo fija el render del servidor. Un «LCP» medido ahí dice lo poco que pesa el
 * HTML y no dice nada de las fotos — o sea, el mismo defecto que esta ráfaga vino a arreglar,
 * sólo que una capa más abajo: antes se medía el texto en vez de la imagen, y después se
 * medía la imagen por una tubería donde el tamaño de la imagen no cuenta.
 *
 * Con el ancho de banda acotado, los bytes vuelven a costar tiempo, que es lo que le pasa a
 * cualquier visitante real. 40 Mbit/s es una conexión doméstica corriente, no un castigo:
 * suficiente para que la página base siga cargando en el orden de medio segundo, y suficiente
 * para que 26 MB de fotos sin optimizar no puedan pasar desapercibidos.
 *
 * ES ADEMÁS LO QUE HACE LA MEDIDA REPRODUCIBLE. El emulador reparte un presupuesto fijo de
 * bytes por segundo; no depende de lo rápido que esté hoy el disco del runner. La dispersión
 * medida con esto puesta es la prueba de estabilidad del final del fichero.
 */
const RED_DOMESTICA = {
  offline: false,
  downloadThroughput: (40 * 1024 * 1024) / 8,
  uploadThroughput: (10 * 1024 * 1024) / 8,
  latency: 20,
};

type Ventana = Window & {
  __lcp?: { ms: number; area: number; url: string }[];
  __lcpEl?: Element | null;
};

/**
 * `addInitScript` + `buffered: true`, por lo mismo que el medidor de CLS del banner: lo que
 * se vigila es la CARGA, y un observador armado después de `load` llega tarde a su propia
 * pregunta.
 */
async function armar(page: Page, opciones: { conRed?: boolean } = {}) {
  // ⚠ LA CACHÉ DEL NAVEGADOR — apagarla NO es una tirita, es la mitad de lo que significa
  // medir un LCP. Y hacen falta LAS DOS cosas de aquí abajo, lo que se aprendió midiendo.
  //
  // Sin nada de esto, la primera versión de la prueba medía una mentira, y se vio en los
  // números: la carga medida descargaba **0 bytes de imagen** —todas salían de la caché de la
  // carga de calentamiento— y el LCP se quedaba clavado en ~420 ms, el suelo del render de
  // servidor. La foto no participaba en lo que se estaba llamando «el LCP de la foto», así
  // que la degradación de la barrera 3 apenas lo movía: comparaba una carga sin red contra
  // otra con red.
  //
  // Y `setCacheDisabled` SOLO NO BASTA, que es lo que costó otra vuelta: Chromium lo
  // implementa como «revalida siempre», no como «no uses la caché». Con eso las ocho fotos
  // seguían respondiendo **304 Not Modified** y el cuerpo salía igual del disco — mismos cero
  // bytes. Por eso `medir` vacía la caché (`Network.clearBrowserCache`) justo antes de la
  // carga que mide; esto de aquí impide además que se vuelva a llenar a mitad.
  //
  // El visitante al que este número le importa llega con la caché VACÍA: es su primera
  // visita. Lo que sí está caliente en su caso es el SERVIDOR —el redimensionado de
  // `/_next/image` ya está en `.next/cache` porque lo pidió otro visitante—, y eso lo sigue
  // dando la carga de calentamiento, que no depende de la caché del navegador. Las dos
  // mitades quedan donde tienen que estar.
  //
  // Por CDP porque Playwright no expone la caché en su API. Es específico de Chromium, que es
  // el único proyecto de `playwright.config.ts`.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  // Sólo donde se COMPARAN tiempos. Las barreras estructurales (2 y 5) no ganan nada
  // esperando más, así que corren a la velocidad de la máquina.
  if (opciones.conRed) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', RED_DOMESTICA);
  }
  sesionesCdp.set(page, cdp);

  await page.addInitScript(() => {
    const w = window as unknown as Ventana;
    w.__lcp = [];
    w.__lcpEl = null;
    new PerformanceObserver((lista) => {
      for (const entrada of lista.getEntries()) {
        const lcp = entrada as PerformanceEntry & { size: number; url?: string; element?: Element };
        w.__lcp!.push({ ms: lcp.startTime, area: lcp.size, url: lcp.url ?? '' });
        w.__lcpEl = lcp.element ?? null;
      }
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
}

async function leer(page: Page, selectorBloque: string): Promise<Omit<MedidaLcp, 'bytesImagenes'>> {
  return page.evaluate((selBloque) => {
    const w = window as unknown as Ventana;
    const entradas = w.__lcp ?? [];
    const ultima = entradas[entradas.length - 1];
    const el = w.__lcpEl ?? null;
    const caja = el?.getBoundingClientRect();
    const img = el instanceof HTMLImageElement ? el : null;
    return {
      entradas: entradas.length,
      ms: ultima?.ms ?? 0,
      area: ultima?.area ?? 0,
      url: ultima?.url ?? '',
      etiqueta: el?.tagName ?? '(sin elemento)',
      enElBloque: !!el?.closest(selBloque),
      texto: (el?.textContent ?? '').trim().slice(0, 80),
      anchoPintado: Math.round(caja?.width ?? 0),
      altoPintado: Math.round(caja?.height ?? 0),
      anchoIntrinseco: img?.naturalWidth ?? 0,
      dpr: window.devicePixelRatio,
      srcset: img?.srcset ?? '',
    };
  }, selectorBloque);
}

/**
 * Carga la ruta DOS veces y devuelve la medida de la segunda. Con `calentar: false` se salta
 * la primera, para cuando el calentamiento ya lo hizo la medida anterior (ver `mejorDe`).
 *
 * ⚠ LA PRIMERA CARGA ES UN CALENTAMIENTO, Y NO ES CEREMONIA. `/_next/image` redimensiona con
 * `sharp` la primera vez que le piden un ancho y **guarda el resultado en `.next/cache`**; la
 * segunda petición se sirve de la caché. Medir la primera carga sería medir el redimensionado,
 * que es un coste que ningún visitante paga dos veces y que además ensucia cualquier
 * comparación entre dos variantes (la que se midiera primero saldría peor por serlo).
 * El SSR de la ruta y la consulta a Meilisearch se benefician igual.
 */
async function medir(
  page: Page,
  ruta: string,
  opciones: { calentar?: boolean } = {},
): Promise<MedidaLcp> {
  if (opciones.calentar !== false) {
    await page.goto(ruta);
    await page.waitForLoadState('networkidle');
  }

  // Caché del navegador a cero: la carga que se mide es la de un visitante que llega por
  // primera vez. Ver el porqué (y por qué `setCacheDisabled` solo no bastaba) en `armar`.
  await sesionesCdp.get(page)?.send('Network.clearBrowserCache');

  // Los bytes se cuentan por la cabecera `content-length` y no leyendo el cuerpo: leerlo es
  // asíncrono y competiría con la propia medición. Sólo de la SEGUNDA carga, la que se mide.
  let bytesImagenes = 0;
  const contar = (respuesta: Response) => {
    if (respuesta.request().resourceType() !== 'image') return;
    bytesImagenes += Number(respuesta.headers()['content-length'] ?? 0);
  };
  page.on('response', contar);
  await page.goto(ruta);
  await page.waitForLoadState('networkidle');
  // Un par de frames: el observador emite la entrada al pintar, no al descargar.
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  page.off('response', contar);

  return { ...(await leer(page, BLOQUE)), bytesImagenes };
}

/**
 * `veces` medidas y se devuelve **la mejor** (la más rápida), no la media.
 *
 * El mínimo es el estadístico estable de una medida de tiempo: una carga puede salir lenta
 * por mil motivos ajenos a la página (el planificador del sistema, otro proceso, el disco),
 * pero **no puede salir más rápida de lo que la página permite**. La media arrastra cada
 * hipo del runner al número; el mínimo, no. Es lo que hace que comparar dos variantes con un
 * margen modesto signifique algo.
 */
async function mejorDe(page: Page, ruta: string, veces: number): Promise<MedidaLcp> {
  let mejor: MedidaLcp | undefined;
  for (let i = 0; i < veces; i++) {
    // El calentamiento del servidor se paga UNA vez: lo que calienta (el redimensionado en
    // `.next/cache`, el SSR de la ruta) sigue caliente para las repeticiones siguientes, y
    // con la red emulada cada carga de más cuesta segundos.
    const m = await medir(page, ruta, { calentar: i === 0 });
    if (!mejor || m.ms < mejor.ms) mejor = m;
  }
  return mejor!;
}

/**
 * LA DEGRADACIÓN DE LA BARRERA 3 — las fotos, **sin optimizar**.
 *
 * Cada petición a `/_next/image` lleva dentro, en el parámetro `url`, la dirección real del
 * objeto en MinIO. Esto la reencamina a esa dirección: el navegador recibe el PNG original de
 * 1800×1800 y 3,3 MB en vez del WebP de 256 px y ~62 KB que el optimizador serviría.
 *
 * ES LA REGRESIÓN DE VERDAD, no un retardo inventado: es exactamente lo que pasaría si
 * alguien pusiera `unoptimized` en la tarjeta, o si `next/image` dejara de estar en el camino.
 * Un `route.fulfill` con bytes de mentira habría demostrado que Playwright sabe esperar; esto
 * demuestra que la medición se mueve cuando la página empeora.
 */
async function servirSinOptimizar(page: Page) {
  await page.route('**/_next/image**', async (route) => {
    const original = new URL(route.request().url()).searchParams.get('url');
    if (!original) return route.continue();
    await route.continue({ url: original });
  });
}

/** Los anchos que el `srcset` ofrece, ordenados. */
function anchosDelSrcset(srcset: string): number[] {
  return srcset
    .split(',')
    .map((c) => /(\d+)w\s*$/.exec(c.trim())?.[1])
    .filter((w): w is string => !!w)
    .map(Number)
    .sort((a, b) => a - b);
}

/** El ancho que la petición pidió de verdad (`?w=`). */
function anchoPedido(url: string): number {
  return Number(new URL(url, 'http://localhost:3000').searchParams.get('w') ?? '0');
}

// ─────────────────────────────────────────────────────────────────────────────────────────
// BARRERA 1 — la semilla es determinista
// ─────────────────────────────────────────────────────────────────────────────────────────

test.describe('BARRERA 1 — la semilla con fotos es determinista', () => {
  test('los píxeles de la foto sembrada tienen la firma esperada', async () => {
    // Si esto cae, la semilla cambió y **las medidas de LCP de antes y de después no son
    // comparables**. No es un detalle de implementación: es la premisa de todo lo demás.
    expect(
      firmaDeLosPixeles(),
      'los píxeles de la foto de la semilla cambiaron: actualiza SHA256_PIXELES ' +
        'a conciencia, sabiendo que invalida las medidas anteriores',
    ).toBe(SHA256_PIXELES);
  });

  test('las ocho tarjetas sembradas llevan foto, y la misma foto', async ({ page }) => {
    await page.goto(RUTA);
    await page.waitForLoadState('networkidle');

    const fotos = page.locator(`${BLOQUE} img`);
    await expect(fotos).toHaveCount(MAXIMO_VISIBLE);

    // «Sin foto» es el hueco que pinta `CardPhotoCarousel` cuando no hay ninguna. Que no
    // aparezca es la forma directa de decir que la semilla de fotos funcionó.
    await expect(page.locator(BLOQUE).getByText('Sin foto')).toHaveCount(0);

    for (const url of sembrados.map((s) => s.urlFoto)) {
      expect(url, 'la URL pública de la foto tiene que salir de MinIO').toContain('/marketplace');
    }
  });

  test('dos cargas descargan EXACTAMENTE los mismos bytes', async ({ page }) => {
    // La determinación que de verdad importa para una medida de tiempo no es que el fichero
    // de origen sea el mismo, sino que **lo que viaja por la red** lo sea. Entre el objeto de
    // MinIO y el navegador está el optimizador: se comprueba a su salida.
    await armar(page);
    const primera = await medir(page, RUTA);
    expect(primera.url, 'el LCP tiene que traer una URL para poder pedirla otra vez').not.toBe('');

    const a = await page.request.get(primera.url);
    const b = await page.request.get(primera.url);
    const bytesA = (await a.body()).length;
    const bytesB = (await b.body()).length;
    expect(bytesA, 'la imagen del LCP tiene que pesar lo mismo en dos peticiones').toBe(bytesB);
    expect(bytesA).toBeGreaterThan(0);
    console.log(`[LCP] la imagen del LCP pesa ${(bytesA / 1024).toFixed(1)} KB`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// BARRERA 2 — el elemento LCP es una IMAGEN del bloque, no un texto
// ─────────────────────────────────────────────────────────────────────────────────────────

test.describe('BARRERA 2 — el LCP mide el camino de las imágenes', () => {
  test('el elemento LCP es la foto de una tarjeta de destacados', async ({ page }) => {
    await armar(page);
    const medida = await medir(page, RUTA);

    expect(medida.entradas, 'el observador de LCP no emitió ninguna entrada').toBeGreaterThan(0);

    // EL CORAZÓN DE ESTA RÁFAGA. Antes aquí salía `P` y el texto de un párrafo.
    expect(
      medida.etiqueta,
      `el elemento LCP sigue sin ser una imagen: <${medida.etiqueta}> «${medida.texto}»`,
    ).toBe('IMG');

    expect(
      medida.enElBloque,
      'el LCP tiene que caer dentro del bloque de destacados — es el camino que las dos ' +
        'filas duplican',
    ).toBe(true);

    expect(medida.url, 'la foto tiene que pasar por el optimizador de Next').toContain(
      '/_next/image',
    );
    const origen = new URL(medida.url, 'http://localhost:3000').searchParams.get('url') ?? '';
    expect(
      sembrados.map((s) => s.urlFoto),
      `la foto del LCP (${origen}) tiene que ser una de las sembradas`,
    ).toContain(origen);

    // El área que el estándar atribuye: con el 1×1 de `fixtures/test-image.png` valdría 1 y
    // ganaría cualquier texto. Se exige que cubra la caja pintada, que es lo que significa
    // «la foto es de verdad».
    expect(
      medida.area,
      `el área atribuida al LCP (${medida.area}) tiene que cubrir la caja pintada ` +
        `(${medida.anchoPintado}×${medida.altoPintado})`,
    ).toBeGreaterThanOrEqual(medida.anchoPintado * medida.altoPintado * 0.9);

    expect(medida.anchoIntrinseco, 'la foto descargada no puede ser más pequeña que su caja')
      .toBeGreaterThanOrEqual(medida.anchoPintado);
    expect(LADO, 'la foto de la semilla tiene que ser mayor que la caja').toBeGreaterThan(
      medida.anchoPintado,
    );

    console.log(
      `[LCP] elemento=${medida.etiqueta} area=${medida.area} caja=${medida.anchoPintado}×` +
        `${medida.altoPintado} dpr=${medida.dpr} LCP=${medida.ms.toFixed(0)} ms`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// BARRERA 5 — `GRID_MEDIA_SIZES` pide el tamaño justo
// ─────────────────────────────────────────────────────────────────────────────────────────

test.describe('BARRERA 5 — el `sizes` de la rejilla pide la resolución justa', () => {
  test('el ancho descargado es el menor del srcset que cubre la caja', async ({ page }) => {
    await armar(page);
    const medida = await medir(page, RUTA);

    const anchos = anchosDelSrcset(medida.srcset);
    expect(anchos.length, `el srcset no trae candidatos: «${medida.srcset}»`).toBeGreaterThan(1);

    const necesario = Math.ceil(medida.anchoPintado * medida.dpr);
    const esperado = anchos.find((w) => w >= necesario);
    const pedido = anchoPedido(medida.url);

    // ─── POR QUÉ ASÍ Y NO CONTRA UN NÚMERO ─────────────────────────────────────────────
    //
    // Se podría exigir `w === 256` y estaría bien hoy, a 1280 px de ancho. Pero ese 256 sale
    // de tres cosas a la vez (el `sizes`, las columnas de la rejilla y la lista de anchos que
    // genera Next), y escribirlo a mano ataría la prueba a las tres. Lo que de verdad se
    // quiere afirmar es más simple y no tiene constantes: **de todos los tamaños ofrecidos,
    // el navegador pidió el más pequeño que cubre lo que se pinta.**
    //
    // Y es exactamente la afirmación que el defecto rompía: con el `33vw` hasta 1024 px que
    // `GRID_MEDIA_SIZES` declaraba antes de la ráfaga 3, el navegador calculaba una caja
    // mayor que la real y saltaba al siguiente candidato — una imagen un tercio más grande,
    // descargada y decodificada para nada, ocho veces y por encima del pliegue.
    expect(
      pedido,
      `se pidió w=${pedido} para una caja de ${medida.anchoPintado} CSS × dpr ${medida.dpr} ` +
        `(= ${necesario} px); el menor candidato que la cubre es ${esperado}. ` +
        `Candidatos: ${anchos.join(', ')}. Revisa GRID_MEDIA_SIZES en card-shells.tsx`,
    ).toBe(esperado);

    console.log(
      `[LCP] sizes: caja=${medida.anchoPintado} CSS · necesario=${necesario} px · ` +
        `pedido w=${pedido} · candidatos=[${anchos.join(', ')}]`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// BARRERA 3 — el instrumento no da verde por no medir
// ─────────────────────────────────────────────────────────────────────────────────────────

test.describe('BARRERA 3 — una degradación real empeora el LCP medido', () => {
  test('servir las fotos SIN OPTIMIZAR empeora el LCP, y el instrumento lo acusa', async ({
    page,
  }) => {
    test.setTimeout(240_000);

    // BASE — la página tal cual, en esta misma corrida, en esta misma máquina y por la misma
    // red emulada. Las tres cosas se mantienen fijas entre las dos medidas: lo único que
    // cambia de una a otra es que las fotos dejan de pasar por el optimizador.
    await armar(page, { conRed: true });
    const base = await mejorDe(page, RUTA, 2);
    expect(base.etiqueta, 'la medida base tiene que ser una imagen').toBe('IMG');

    // DEGRADADA — las mismas ocho fotos, sin pasar por el optimizador.
    await servirSinOptimizar(page);
    const degradada = await mejorDe(page, RUTA, 2);

    console.log(
      `[LCP] base=${base.ms.toFixed(0)} ms (${(base.bytesImagenes / 1024).toFixed(0)} KB de ` +
        `imágenes) · sin optimizar=${degradada.ms.toFixed(0)} ms ` +
        `(${(degradada.bytesImagenes / 1024).toFixed(0)} KB) · ` +
        `×${(degradada.ms / base.ms).toFixed(2)} en tiempo, ` +
        `×${(degradada.bytesImagenes / base.bytesImagenes).toFixed(1)} en bytes`,
    );

    // El LCP sigue siendo una imagen: lo que cambia son los bytes, no la estructura. Si
    // cambiara de elemento, la comparación no diría lo que pretende.
    expect(degradada.etiqueta, 'la medida degradada tiene que seguir siendo una imagen').toBe(
      'IMG',
    );

    // ── PRIMERO: QUE EL ESTÍMULO SEA DE VERDAD ────────────────────────────────────────
    //
    // Antes de exigir que el LCP empeore hay que demostrar que la página empeoró. Si la
    // reescritura de la ruta fallara en silencio —un cambio en cómo Next forma la URL del
    // optimizador, por ejemplo—, el LCP no se movería y el rojo diría «el instrumento está
    // ciego» cuando el problema sería que no se le enseñó nada. Los bytes lo zanjan: el
    // original son ~3,3 MB por foto contra las decenas de KB del WebP recortado.
    expect(
      degradada.bytesImagenes,
      `la degradación no llegó a ocurrir: la carga «sin optimizar» descargó ` +
        `${(degradada.bytesImagenes / 1024).toFixed(0)} KB de imágenes contra los ` +
        `${(base.bytesImagenes / 1024).toFixed(0)} KB de la base. Revisa servirSinOptimizar()`,
    ).toBeGreaterThan(base.bytesImagenes * 5);
    // Y que lo que llega es de verdad el original, no otro tamaño del optimizador.
    expect(degradada.url).toContain('/_next/image');

    // ── Y AHORA SÍ: QUE EL INSTRUMENTO LO ACUSE ───────────────────────────────────────
    //
    // EL MARGEN SE ELIGIÓ CON DATOS, Y EL PRIMER DATO FUE UN FRACASO ÚTIL: sin acotar el
    // ancho de banda, este mismo estímulo de ×155 en bytes movía el LCP un ×1,01. De ahí
    // salió `RED_DOMESTICA` — la explicación entera está en su comentario.
    //
    // Con la red acotada, 3,3 MB por foto **tienen** que costar tiempo: la sola foto del LCP
    // no cabe en menos de medio segundo a 40 Mbit/s compartidos con las otras siete. Medido
    // aquí: ×8,6 (608 ms → 5.216 ms). Se pide un ×2, que queda muy por encima de la
    // dispersión de la página sin tocar —×1,2 en el peor caso medido, impresa en la última
    // prueba de este fichero— y muy por debajo del margen real, para no atar la barrera a la
    // velocidad del runner.
    expect(
      degradada.ms,
      `sin optimizar, el LCP debería empeorar claramente: base ${base.ms.toFixed(0)} ms vs ` +
        `${degradada.ms.toFixed(0)} ms. Si no se mueve, el medidor no está midiendo la imagen`,
    ).toBeGreaterThan(base.ms * 2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────
// LA ESTABILIDAD — se mide y se imprime; NO se convierte en umbral
// ─────────────────────────────────────────────────────────────────────────────────────────

test.describe('La dispersión del LCP, medida (y por qué no hay umbral)', () => {
  test('tres medidas seguidas: se informa la dispersión, no se exige un tope', async ({
    page,
  }) => {
    test.setTimeout(150_000);

    // CON LA MISMA RED EMULADA QUE LA BARRERA 3, porque es de esa dispersión de la que
    // depende su margen — y porque un LCP medido con ancho de banda infinito no es un número
    // que le sirva a nadie (ver `RED_DOMESTICA`).
    await armar(page, { conRed: true });
    const medidas: number[] = [];
    for (let i = 0; i < 3; i++) {
      medidas.push((await medir(page, RUTA, { calentar: i === 0 })).ms);
    }
    const min = Math.min(...medidas);
    const max = Math.max(...medidas);

    console.log(
      `[LCP] /busqueda con 8 destacados y foto, a 40 Mbit/s — tres medidas: ` +
        `${medidas.map((m) => m.toFixed(0)).join(' / ')} ms · ` +
        `dispersión ${(max - min).toFixed(0)} ms (×${(max / min).toFixed(2)})`,
    );

    // ⚠ LO ÚNICO QUE SE AFIRMA AQUÍ es que el instrumento sigue vivo en las tres. El número
    // en sí NO se compara contra nada: un tope de milisegundos en un runner compartido es
    // un generador de rojos ambientales, y la mitad de la lección de esta ráfaga es que un
    // rojo que a veces sale enseña a ignorar los rojos.
    //
    // La dispersión queda impresa en el informe de la corrida: si algún día se quiere poner
    // un tope, el dato para decidirlo está ahí, corrida a corrida, en vez de tener que
    // suponerlo.
    for (const m of medidas) {
      expect(m, 'ninguna de las tres medidas puede ser cero (eso sería no medir)').toBeGreaterThan(
        0,
      );
    }
  });
});
