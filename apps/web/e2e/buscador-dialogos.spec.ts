import { chromium } from '@playwright/test';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/auth';
import { elegirCategoria } from './helpers/buscador';

/**
 * ══ BUSCADOR · BQ-C — LOS DETALLES QUE SÓLO APARECEN CON UN DIÁLOGO DENTRO DE UN FORM ══
 *
 * El §5.3 del diseño enumeró cuatro y dijo de ellos algo muy concreto: *«ninguno es un
 * riesgo abierto: los cuatro tienen respuesta y los cuatro hay que VERIFICARLOS, no
 * descubrirlos»*. Esto es esa verificación, y vive en e2e porque los cuatro son
 * comportamiento de navegador de verdad —el `<form>`, el portal a `<body>`, el foco, el
 * bloqueo de scroll— y ninguno se puede afirmar desde jsdom.
 *
 * El quinto describe es el CLS del bloqueo de scroll, que es el único de los cuatro que no
 * dependía de nosotros sino de una librería, y por eso es el que más falta hacía medir.
 */

/**
 * ⚠ EL DISPARADOR SE PIDE POR ROL, NO CON `getByLabel('Categoría')`.
 *
 * `getByLabel` casa por SUBCADENA, y en una portada que monte el bloque de búsqueda con
 * pestañas hay un `<div role="tabpanel" aria-labelledby="tab-categories">` cuyo nombre
 * accesible es «Categorías» — que contiene «Categoría». Dos elementos, modo estricto, y el
 * fallo no tiene nada que ver con lo que estas pruebas miden.
 *
 * Hoy no muerde porque la portada sembrada no lleva ese bloque, y ésa es justamente la
 * razón para quitarlo de en medio: la configuración de portada la escriben otras specs y
 * la del despliegue la escribe un admin. Una barrera que exige CERO (§5.3·4) no puede
 * depender de qué bloques haya puestos ese día.
 */

/** El buscador de la portada, con las sugerencias de etiqueta ya desplegadas (B4). */
async function conSugerenciasAbiertas(page: Page) {
  await page.getByPlaceholder('¿Qué estás buscando?').fill('garant');
  await expect(page.getByTestId('sugerencias-etiquetas')).toBeVisible();
}

test.describe('§5.3 · 1 — abrir un diálogo NO envía el formulario', () => {
  /**
   * Un `<button>` dentro de un `<form>` es `submit` por defecto. Si el disparador lo fuera,
   * pulsarlo lanzaría la búsqueda en vez de abrir la lista — y el usuario acabaría en
   * `/busqueda` sin haber pedido nada. El componente lo pone explícito; esto comprueba el
   * efecto, que es lo que importa.
   */
  test('la URL no se mueve y el diálogo se abre', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Categoría' }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  });
});

test.describe('§5.3 · 2 — el desplegable de etiquetas queda INERTE bajo el diálogo', () => {
  /**
   * ⚠ AQUÍ EL DISEÑO SE EQUIVOCÓ, Y LA MEDICIÓN LO CORRIGIÓ.
   *
   * El §5.3 predijo que abrir un diálogo CERRARÍA el desplegable de sugerencias, razonando
   * así: `SearchBar` cierra las suyas con un `mousedown` fuera del `<form>`, y el velo del
   * diálogo se monta en `<body>`, o sea fuera. **El razonamiento tiene un agujero de
   * cronología**: cuando se pulsa el disparador, el velo TODAVÍA NO EXISTE — el `mousedown`
   * ocurre sobre un botón que está DENTRO del formulario, así que no cierra nada; el velo
   * aparece después. El desplegable se queda abierto, debajo.
   *
   * ── Y RESULTA QUE ESO ESTÁ BIEN, POR UN MOTIVO QUE EL DISEÑO NO MIRÓ ───────────────
   *
   * La preocupación de fondo era «dos capas vivas sobre el mismo buscador». **No hay dos
   * capas vivas**: Radix aplica `aria-hidden` a todo lo que queda fuera del diálogo (vía el
   * paquete `aria-hidden`) y le corta los eventos de puntero. El desplegable no se anuncia,
   * no se puede pulsar y está bajo un velo al 80 %. Es INERTE, que es exactamente lo que se
   * quería conseguir cerrándolo.
   *
   * Y conservarlo tiene una ventaja que cerrarlo no tendría: elegir una categoría vuelve a
   * pedir las sugerencias ACOTADAS a ella (`SearchBar`, efecto con `[query, category]`). Se
   * teclea «garant», se elige Coches, y al cerrar el desplegable está ahí con las etiquetas
   * de Coches. Cerrarlo obligaría a volver a teclear.
   *
   * Así que lo que se fija es la propiedad que de verdad importa —**inerte**—, no la que el
   * diseño supuso.
   */
  test('sigue en el DOM pero fuera del alcance del usuario', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/');
    await conSugerenciasAbiertas(page);

    await page.getByRole('button', { name: 'Categoría' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    const inerte = await page.getByTestId('sugerencias-etiquetas').evaluate((el) => ({
      // `closest` sube por los ancestros: Radix marca el árbol de la página, no cada nodo.
      ocultoALectores: Boolean(el.closest('[aria-hidden="true"]')),
      sinEventos: getComputedStyle(el).pointerEvents === 'none',
    }));

    expect(inerte).toEqual({ ocultoALectores: true, sinEventos: true });
  });

  /** Y al cerrar vuelve a estar vivo: la inercia es del diálogo, no del desplegable. */
  test('vuelve a ser alcanzable al cerrar el diálogo', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/');
    await conSugerenciasAbiertas(page);
    await page.getByRole('button', { name: 'Categoría' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    const revivido = await page.getByTestId('sugerencias-etiquetas').evaluate((el) => ({
      ocultoALectores: Boolean(el.closest('[aria-hidden="true"]')),
      sinEventos: getComputedStyle(el).pointerEvents === 'none',
    }));

    expect(revivido).toEqual({ ocultoALectores: false, sinEventos: false });
  });
});

test.describe('§5.3 · 3 — Esc tiene dos dueños, y no chocan', () => {
  /**
   * Sobre el campo de texto, `Esc` cierra las sugerencias (B4). Con un diálogo abierto lo
   * atrapa Radix y cierra el diálogo.
   *
   * **No chocan aunque las dos capas COEXISTAN** (que es lo que el describe de arriba
   * acaba de medir): con el diálogo abierto, el foco está dentro de él y el desplegable es
   * inerte, así que la tecla tiene un solo destino posible en cada momento. Lo que decide
   * no es que una de las dos no exista, sino dónde está el foco.
   */
  test('Esc sobre el campo cierra las sugerencias', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/');
    await conSugerenciasAbiertas(page);

    await page.getByPlaceholder('¿Qué estás buscando?').press('Escape');
    await expect(page.getByTestId('sugerencias-etiquetas')).toHaveCount(0);
  });

  test('Esc con el diálogo abierto lo cierra y devuelve el foco', { tag: '@2b' }, async ({
    page,
  }) => {
    await page.goto('/');
    const disparador = page.getByRole('button', { name: 'Categoría' });
    await disparador.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');

    await expect(page.getByRole('dialog')).toHaveCount(0);
    /**
     * ⚠ EL FOCO VUELVE AL DISPARADOR, Y ESTA LÍNEA ENCONTRÓ UN DEFECTO REAL.
     *
     * En su primera corrida dio «inactive»: el foco se quedaba en el `<body>`. La causa es
     * el reparto por peso de BQ-B — la capa no se cierra, se DESMONTA, así que Radix nunca
     * ve su `open` pasar a `false` y su `FocusScope` no llegaba a devolverlo. Quien navega
     * con teclado se quedaba en el limbo en medio de un formulario.
     *
     * Lo devuelve ahora `DialogoFiltrable` a mano, en el fotograma siguiente. Sin esta
     * prueba, el defecto habría salido de producción: no se ve con el ratón.
     */
    await expect(disparador).toBeFocused();
  });
});

test.describe('§5.3 · 4 — el bloqueo de scroll no descoloca la página', () => {
  /**
   * ══ EL CLS DEL SCROLL-LOCK ═══════════════════════════════════════════════════════
   *
   * `@radix-ui/react-dialog` depende de `react-remove-scroll`: al abrir, BLOQUEA el scroll
   * del documento. Si el navegador pinta una barra de scroll con ancho, bloquearlo la hace
   * desaparecer y **el contenido se ensancha de golpe**. `react-remove-scroll` lo compensa
   * añadiendo un padding del mismo ancho; si esa compensación fallara, la página entera
   * saltaría ~15 px hacia la derecha.
   *
   * En la portada eso se vería especialmente: el hero va A SANGRE y es lo más ancho que
   * hay, así que un desplazamiento horizontal se lee como un tirón de toda la banda.
   *
   * ── POR QUÉ NO SE FILTRA `hadRecentInput`, Y ES LA DECISIÓN QUE HACE QUE ESTO MIDA ──
   *
   * El CLS «oficial» descarta los desplazamientos ocurridos dentro de los 500 ms
   * siguientes a una interacción: se asume que si el usuario ha pulsado algo, espera que la
   * página cambie. **Aquí ese filtro dejaría el instrumento CIEGO**, porque lo que se mide
   * ocurre exactamente al pulsar. Se cuentan TODOS los desplazamientos, y lo que se afirma
   * no es «el CLS de la métrica de Google» sino «abrir esto no mueve la página».
   *
   * ── EL INSTRUMENTO SE VALIDA CON EL MISMO FALLO QUE VIGILA ─────────────────────────
   *
   * Un número bajo no dice nada si el observador no sabe ver un número alto. La validación
   * no inventa un movimiento cualquiera: reproduce **el modo de fallo exacto** —bloquear el
   * scroll SIN compensar el ancho de la barra— y comprueba que eso sí dispara el
   * observador. Si algún día `react-remove-scroll` dejara de compensar, este par de pruebas
   * se invertiría, que es justo lo que se quiere.
   */

  /** Lo que el observador va acumulando: cuánto se movió y QUIÉN se movió. */
  interface Medida {
    total: number;
    /** Los nodos culpables, con lo que se desplazaron. El rojo tiene que decir qué mirar. */
    fuentes: string[];
  }

  type Ventana = Window & { __cls: number; __fuentes: string[]; __obs: PerformanceObserver };

  /**
   * Arma el observador y pone el contador a cero.
   *
   * ⚠ **GUARDA TAMBIÉN LAS FUENTES, Y ESO NO ES ADORNO.** La primera versión sólo sumaba
   * el número, y cuando dio 0,001 en vez de 0 no había forma de saber si eso era la
   * compensación imperfecta, un anuncio que cargaba tarde o una fuente web. Un medidor que
   * da un número sin decir de dónde sale obliga a adivinar, y adivinar es lo que estas
   * pruebas existen para evitar.
   */
  async function armar(page: Page) {
    await page.evaluate(() => {
      const w = window as unknown as Ventana;
      w.__cls = 0;
      w.__fuentes = [];
      w.__obs = new PerformanceObserver((lista) => {
        for (const entrada of lista.getEntries()) {
          const desplazamiento = entrada as PerformanceEntry & {
            value: number;
            sources?: { node?: Element; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }[];
          };
          w.__cls += desplazamiento.value;
          for (const fuente of desplazamiento.sources ?? []) {
            const nodo = fuente.node;
            const nombre = nodo
              ? `${nodo.tagName.toLowerCase()}${nodo.className ? '.' + String(nodo.className).split(/\s+/).slice(0, 3).join('.') : ''}`
              : '(sin nodo)';
            const dx = Math.round(fuente.currentRect.x - fuente.previousRect.x);
            const dy = Math.round(fuente.currentRect.y - fuente.previousRect.y);
            w.__fuentes.push(`${nombre}  Δx=${dx} Δy=${dy}`);
          }
        }
      });
      w.__obs.observe({ type: 'layout-shift', buffered: false });
    });
  }

  /** Vacía la cola pendiente del observador y devuelve lo acumulado. */
  async function leer(page: Page): Promise<Medida> {
    return page.evaluate(() => {
      const w = window as unknown as Ventana;
      for (const entrada of w.__obs.takeRecords()) {
        w.__cls += (entrada as PerformanceEntry & { value: number }).value;
      }
      return { total: w.__cls, fuentes: w.__fuentes };
    });
  }

  /** El ancho de la barra de scroll clásica. `0` = barras superpuestas o escondidas. */
  const anchoDeBarra = (page: Page) =>
    page.evaluate(() => window.innerWidth - document.documentElement.clientWidth);

  /**
   * ⚠ ESTE APARTADO SE LANZA SU PROPIO NAVEGADOR, Y NO ES UN CAPRICHO.
   *
   * Medido dos veces: en el Chromium de la batería, `window.innerWidth - clientWidth` vale
   * **0**. La primera explicación —barras superpuestas— llevó a forzar una clásica con
   * `::-webkit-scrollbar`, y **siguió valiendo 0**. La causa real es que Playwright arranca
   * el navegador headless con `--hide-scrollbars`, que gana a cualquier CSS.
   *
   * O sea que el defecto que este apartado vigila **es invisible en el runner por
   * construcción**: sin ancho de barra no hay nada que recuperar al bloquear el scroll, no
   * hay salto posible, y las dos pruebas darían verde sin haber medido nada. Ése es
   * justamente el verde que el guard de más abajo se negó a dar, dos corridas seguidas.
   *
   * La salida no es tocar la configuración: quitar `--hide-scrollbars` del proyecto
   * `chromium` metería 15 px de barra en los 271 casos de la batería y en pantallas que no
   * tienen nada que ver con esto. Se lanza un navegador APARTE, sólo para estas dos pruebas,
   * con la barra que tiene el escritorio de verdad — Windows, o Linux sin overlay—, que es
   * donde vive el usuario cuyo hero a sangre daría el tirón.
   */
  async function conBarraDeScroll(
    baseURL: string,
    medir: (page: Page) => Promise<void>,
  ): Promise<void> {
    const navegador = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
    try {
      const contexto = await navegador.newContext({ viewport: { width: 1280, height: 720 } });
      const page = await contexto.newPage();
      await page.goto(new URL('/', baseURL).toString());
      await page.waitForLoadState('networkidle');

      /**
       * ⚠ SIN BARRA DE SCROLL CON ANCHO NO HAY NADA QUE COMPENSAR, y entonces un verde no
       * significaría «la compensación funciona» sino «no hacía falta». Se declara en vez de
       * tragárselo: si algún día este número volviera a 0, estas pruebas tienen que morir
       * ruidosamente y no pasar de largo.
       */
      expect(
        await anchoDeBarra(page),
        'sin barra de scroll con ancho, esta prueba no mediría nada',
      ).toBeGreaterThan(0);

      await medir(page);
    } finally {
      await navegador.close();
    }
  }

  /**
   * LAS DOS MEDIDAS VAN EN LA MISMA PRUEBA, Y ESO ES PARTE DE LA BARRERA.
   *
   * Podrían ser dos tests —uno que mide y otro que valida el instrumento—, y así estuvieron
   * primero. Juntos son mejores por dos razones:
   *
   *  · **Se comparan entre sí, no contra un umbral inventado.** La primera versión exigía
   *    `> 0.01` al salto inyectado y falló con 0.00418: el instrumento SÍ lo veía, pero un
   *    desplazamiento horizontal de 15 px en 1280 px de ancho da una puntuación pequeña, y
   *    el umbral escrito a ojo no lo sabía. Lo que de verdad hay que afirmar no es «el fallo
   *    da más de X», es **«el fallo se distingue del no-fallo»**.
   *  · Un solo navegador y una sola carga para las dos, que es la mitad de coste.
   *
   * Los dos números se adjuntan al informe: cuando esto se ponga rojo, lo primero que hará
   * falta es saber cuánto se movió.
   */
  test('abrir el diálogo no desplaza la página', { tag: '@2b' }, async ({ baseURL }, testInfo) => {
    await conBarraDeScroll(baseURL!, async (page) => {
      // ── 1 · Lo real: abrir el diálogo ───────────────────────────────────────────
      await armar(page);
      await page.getByRole('button', { name: 'Categoría' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      const alAbrir = await leer(page);

      // Se cierra y se deja el documento como estaba antes de inyectar el fallo.
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog')).toHaveCount(0);

      // ── 2 · El mismo bloqueo, SIN la compensación de ancho ──────────────────────
      await armar(page);
      await page.evaluate(() => {
        document.documentElement.style.overflow = 'hidden';
      });
      await expect.poll(async () => (await leer(page)).total, { timeout: 3_000 }).toBeGreaterThan(0);
      const sinCompensar = await leer(page);

      await testInfo.attach('desplazamiento', {
        body: [
          `al abrir:       ${alAbrir.total}`,
          ...alAbrir.fuentes.map((f) => `    ${f}`),
          `sin compensar:  ${sinCompensar.total}`,
          ...sinCompensar.fuentes.map((f) => `    ${f}`),
        ].join('\n'),
        contentType: 'text/plain',
      });

      /**
       * ══ LO QUE SE AFIRMA: CERO. NI UN PÍXEL, NI UNA FUENTE ═══════════════════════
       *
       * ── AQUÍ HUBO UNA TOLERANCIA, Y CONVIENE SABER POR QUÉ SE FUE ────────────────
       *
       * Esta prueba exigía «menos de un tercio de lo que se mueve sin compensar» en vez de
       * un cero redondo, y no por prudencia: es que **quedaba un residuo real** de 0,001 —un
       * nodo desplazado 7,5 px— que esta ráfaga no podía arreglar. El comentario de
       * entonces decía además que venía «de la cabecera `sticky` COMPARTIDA POR TODO EL
       * SITIO», y era falso: la cabecera no se mueve, porque `sticky` NO sale del flujo y
       * recibe la compensación del `body` como cualquier otro elemento.
       *
       * El nodo era el `container mx-auto max-w-5xl` del **banner de cookies**, que es
       * `fixed` y por tanto se mide contra el VIEWPORT, adonde la compensación del `body` no
       * llega ni puede llegar. Media barra de scroll re-centrando 1024 px dentro de un padre
       * que pasa de 1265 a 1280. Está diagnosticado en `docs/diagnostico-residuo-8px.md` y
       * cerrado en `BannerCookies.tsx`, con el gancho que la propia librería publica
       * (`--removed-body-scroll-bar-size`).
       *
       * ── Y POR ESO EL CERO ES EL VALOR, NO EL ARREGLO ─────────────────────────────
       *
       * Un umbral de «un tercio» tolera por construcción que mañana aparezca un SEGUNDO
       * elemento fijo mal compensado: cabría de sobra por debajo y nadie se enteraría hasta
       * que alguien volviera a mirar, meses después. Exigiendo cero, el próximo `fixed` sin
       * compensar pone esto rojo el primer día, con el nodo culpable escrito en el informe.
       *
       * ⚠ **Y SE MIDE CON EL BANNER EN PANTALLA**, que es la única situación en que había
       * algo que medir: esta prueba lanza su propio navegador, sin la cookie de
       * consentimiento que el fixture siembra. Si alguien la moviera al `page` de la batería
       * el banner no existiría, el cero saldría solo y la barrera dejaría de vigilar.
       */

      // 1 · EL INSTRUMENTO VE. Sin esto, el cero de abajo no distinguiría «no hay salto» de
      //     «el observador no mira», que es la forma en que una barrera así se muere.
      expect(sinCompensar.total).toBeGreaterThan(0);

      // 2 · NADA SE MUEVE. El total Y la lista de culpables: el número solo podría quedarse
      //     en cero por redondeo, y las fuentes no redondean.
      expect(alAbrir.total).toBe(0);
      expect(alAbrir.fuentes).toEqual([]);

      /**
       * 3 · Y EL HERO SIGUE SIENDO EL TESTIGO, que era LA preocupación del §5.3: «en la
       * portada montada ese salto se vería en el hero a sangre, que es lo más ancho de la
       * página». Que se mueva SIN compensar es lo que prueba que el instrumento sabe verlo
       * precisamente ahí; que no aparezca con ella ya lo cubre el `toEqual([])` de arriba,
       * y se deja escrito igual porque es la afirmación que se pondría roja si alguien
       * quitara `react-remove-scroll` de en medio.
       */
      const heroSeMueve = (m: Medida) => m.fuentes.some((f) => f.includes('max-w-4xl'));
      expect(heroSeMueve(sinCompensar)).toBe(true);
      expect(heroSeMueve(alAbrir)).toBe(false);
    });
  });

  /**
   * ══ EL ARREGLO, POR LAS DOS PUNTAS ═══════════════════════════════════════════════
   *
   * El cero de arriba es el EFECTO; esto es el MECANISMO, y hacen falta los dos. Un cero
   * puede volverse cierto por el motivo equivocado —que el banner desaparezca, que la
   * librería deje de bloquear el scroll— y entonces la barrera seguiría verde sin vigilar
   * nada.
   *
   * Las dos mitades del arreglo, cada una con su número:
   *
   *  · **SIN overlay el banner está intacto.** `--removed-body-scroll-bar-size` no existe
   *    fuera del bloqueo, así que el `padding-right` cae al respaldo `0px`. Es la condición
   *    que permitió meter esto sin pasar por el catálogo de capturas: el banner de siempre,
   *    sin una diferencia de un píxel.
   *  · **CON overlay compensa, y sólo el contenido.** El `padding-right` pasa a valer la
   *    barra entera, el contenedor centrado se queda donde estaba —**el mismo x, al
   *    decimal**— y el banner sigue a sangre. Ese último detalle es lo que distingue este
   *    arreglo de `.width-before-scroll-bar`, que lo habría encogido (ver
   *    `docs/diagnostico-residuo-8px.md` §2).
   */
  test('el banner se compensa SÓLO mientras hay un overlay abierto', { tag: '@2b' }, async ({ baseURL }) => {
    await conBarraDeScroll(baseURL!, async (page) => {
      const leer = () =>
        page.evaluate(() => {
          const banner = document.querySelector('.fixed.inset-x-0.bottom-0') as HTMLElement;
          const dentro = banner.querySelector('.container') as HTMLElement;
          return {
            padding: getComputedStyle(banner).paddingRight,
            anchoBanner: Math.round(banner.getBoundingClientRect().width),
            xContenedor: Math.round(dentro.getBoundingClientRect().x * 100) / 100,
          };
        });

      /**
       * Este navegador se lanza SIN la cookie de consentimiento que siembra el fixture, así
       * que el banner está en pantalla — que es la única situación en la que había algo que
       * compensar. Si algún día dejara de estarlo, esto muere ruidosamente en vez de dar un
       * verde vacío.
       */
      const cerrado = await leer();
      expect(cerrado.padding, 'sin overlay la variable no existe: el banner, intacto').toBe('0px');

      await page.getByRole('button', { name: 'Categoría' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      const abierto = await leer();

      // La barra que el bloqueo acaba de liberar, ahora en el padding del banner.
      expect(parseFloat(abierto.padding)).toBeGreaterThan(0);
      // El banner sigue llegando a los dos bordes: se compensa el contenido, no la caja.
      expect(abierto.anchoBanner).toBeGreaterThan(cerrado.anchoBanner);
      // Y lo que se quería: el contenedor centrado no se ha movido ni un decimal.
      expect(abierto.xContenedor).toBe(cerrado.xContenedor);
    });
  });
});

test.describe('§5.3 — y el buscador sigue haciendo lo suyo', () => {
  /**
   * La red de toda la ráfaga: los cuatro detalles de arriba miran el diálogo, y podrían
   * estar todos en verde con el buscador roto. Esto comprueba que elegir en el diálogo
   * SIGUE llevando a donde llevaba — la ruta canónica de A1 — después de tocarle la
   * geometría a los cuatro controles.
   */
  test('elegir categoría y buscar lleva a la ruta canónica', { tag: '@2b' }, async ({ page }) => {
    await page.goto('/');
    await elegirCategoria(page, 'Coches');
    await page.getByRole('button', { name: 'Buscar' }).click();

    await page.waitForURL((url) => url.pathname === '/vehiculos/coches', { waitUntil: 'commit' });
  });
});
