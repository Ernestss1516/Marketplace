import { test, expect } from '../e2e/fixtures/auth';
import {
  esperarPortadaEscaparate,
  esperarPortadaPantalla,
  ponerPortadaEscaparate,
  ponerPortadaPantalla,
  restaurarPortada,
} from '../e2e/helpers/portada';
import { RUTA_BLOG, RUTA_PAGINA } from '../e2e/helpers/contenido-editorial';
import { preparar } from './preparar';

/**
 * E0 — EL CATÁLOGO DE CAPTURAS.
 *
 * ── POR QUÉ ESTAS Y NO LAS 81 ─────────────────────────────────────────────────────────
 *
 * Por COBERTURA DE IDIOMA VISUAL, no de rutas (docs/diseno-sistema-estilo.md §10.3). Las
 * 39 pantallas del backoffice son cuatro idiomas repetidos —tabla, formulario, cola,
 * detalle—; fotografiar las 39 costaría ocho veces más y no detectaría nada que no
 * detecten cuatro. El criterio para AMPLIAR esta lista no es «una ruta nueva», es «un
 * idioma visual nuevo».
 *
 * Cada pantalla se captura en ESCRITORIO (1280) y en MÓVIL (375) — los dos proyectos de
 * `playwright.snapshots.config.ts`. El responsive es inviolable, y hay cicatrices
 * concretas que vigilar: el `hidden md:block` del aside y el `min-w-0` del `<main>` en
 * `(admin)/layout.tsx`, que arreglaron el desbordamiento horizontal de las tablas.
 *
 * ── QUÉ PRUEBA UN ROJO AQUÍ ───────────────────────────────────────────────────────────
 *
 * Que algo cambió de aspecto. Nada más y nada menos. Mientras el modelo activo sea el 0,
 * eso es SIEMPRE un bug de migración: Modelo 0 es el estado actual, no una versión
 * parecida de él. La instrucción cuando una captura difiere es revertir el cambio que la
 * movió, no actualizar el baseline.
 *
 * ── LO QUE NO ESTÁ AQUÍ, Y ES A PROPÓSITO ─────────────────────────────────────────────
 *
 * El aviso de sesión que E0 consolida (29 copias) **no aparece en ninguna captura**, y no
 * es un olvido: sólo se pinta cuando la sesión existe pero no trae `accessToken`, un
 * estado que no se alcanza navegando —el middleware manda al login antes—. Su barrera es
 * de otro tipo y más estrecha que un píxel: `aviso.test.tsx` compara la cadena de clases
 * producida con la literal de las 29 copias, carácter a carácter.
 */

// ── Público (sin sesión) ────────────────────────────────────────────────────────────────
//
// Formularios de auth, formulario público, catálogo de planes y el 404.
//
// ── LA QUE SIGUE SIN ESTAR: BÚSQUEDA (y el LISTADO de blog) ─────────────────────────────
//
// Aquí hubo tres ausencias —portada, búsqueda y listado de blog—, sacadas con la medición
// delante. Sus capturas no fallaban por un cambio de estilo: fallaban porque **su contenido
// no era determinista en esta batería**.
//
//   · portada  — esperado 4311 px de alto, recibido 1339 px, dos corridas seguidas;
//   · búsqueda — recibido 1027 px en una corrida y 990 px en la siguiente, con el MISMO
//     árbol de fuentes. Dos alturas distintas del mismo código es no-determinismo, y ahí
//     no hay nada que interpretar.
//
// La causa era estructural: esas páginas pintan ESTADO GLOBAL MUTABLE. La portada monta
// `HomeBlockRenderer` con los bloques de `HomepageConfig`, que las specs de
// `/admin/portada` reescriben; los listados salen del índice de Meilisearch, que unas specs
// llenan y el teardown vacía; y los artículos del blog los crean las specs de blog.
//
// Y quedó escrito qué haría falta para que volvieran: «escribir un `HomepageConfig` conocido
// y sembrar un conjunto fijo de anuncios ya indexados».
//
// ── LA PORTADA HA VUELTO (escaparate, ráfaga B) ─────────────────────────────────────────
//
// La primera mitad de esa tarea está hecha, y por eso vuelve — ver el describe
// «Escaparate» de más abajo. La segunda mitad (los anuncios indexados) NO hace falta,
// porque la portada medible se configura SIN bloque `listings`: en vez de fijar el índice,
// se mide una portada que no lo consulta. Búsqueda y el LISTADO de blog siguen fuera, que
// es donde el índice manda de verdad.
//
// LO QUE ESTA AUSENCIA **NO** DEJA SIN VIGILAR: nada de lo que E0 cambió. Los 29 avisos
// consolidados viven todos en el backoffice, que sí está cubierto entero, y las clases
// muertas que se quitaron están en los overlays, que tienen sus propias capturas.
test.describe('Público', () => {
  const RUTAS: readonly [nombre: string, ruta: string][] = [
    ['planes', '/planes'],
    ['contacto', '/contacto'],
    ['login', '/login'],
    ['registro', '/registro'],
    ['recuperar', '/recuperar'],
    // El 404: una ruta que con seguridad no existe. Es una de las pantallas donde irán
    // las ilustraciones (E7), así que conviene tener su antes.
    ['no-encontrado', '/esta-ruta-no-existe-e0'],
  ];

  for (const [nombre, ruta] of RUTAS) {
    test(nombre, async ({ page }) => {
      await preparar(page, ruta);
      await expect(page).toHaveScreenshot(`publico-${nombre}.png`, { fullPage: true });
    });
  }
});

/**
 * ══ ESCAPARATE · RÁFAGA B — LAS TRES SUPERFICIES QUE VA A REPINTAR LA C ══════════════
 *
 * Ver `docs/diseno-escaparate.md` §3.4 y §3.5.
 *
 * ── POR QUÉ ENTRAN AHORA Y NO CON EL CAMBIO ─────────────────────────────────────────
 *
 * Porque el escaparate va a repintar la portada, el blog y las páginas de arriba abajo, y
 * **hoy ninguna red las mira**. Una barrera que se escribe DESPUÉS del cambio no vigila
 * nada: sólo certifica lo que ya hay. Así que el baseline se toma aquí, con el aspecto de
 * HOY, y la ráfaga C se mide contra él.
 *
 * De ahí una propiedad que conviene usar: **cuando C repinte, estas tres capturas se
 * pondrán rojas, y ése es el entregable**. El artefacto de CI trae antes/después/diff, y
 * eso es lo que se mira para aprobar el escaparate. Regenerar el baseline es el acto que
 * dice «aprobado», no un trámite para volver a verde.
 *
 * ── TRES, Y NO TREINTA ──────────────────────────────────────────────────────────────
 *
 * Mismo criterio que el resto del fichero: por idioma visual. La portada es el motor de
 * bloques de portada con seis piezas montadas; el artículo es el motor del blog **dentro
 * de la zona `blog`** (la única zona pública que ajusta tokens); la página es la misma
 * maquinaria **fuera** de esa zona, o sea la base — y es donde vive el CTA que en la
 * ráfaga C se convierte en banda. El LISTADO de blog no entra: su tarjeta es una variante
 * del mismo idioma que ya cubre el artículo, y depende de qué posts hayan creado otras
 * specs.
 *
 * ── ⚠ ESTE DESCRIBE MUTA, Y ES EL ÚNICO DEL FICHERO ─────────────────────────────────
 *
 * `playwright.snapshots.config.ts` dice de esta batería que «no muta nada (sólo navega y
 * fotografía)». Deja de ser literal aquí: la portada se configura antes de disparar y se
 * restaura después. No hay alternativa — la portada por defecto lleva un bloque `listings`
 * cuyo orden depende de una ventana de rotación de 15 minutos, y con eso no se puede tomar
 * un baseline estable. Se mide una portada que no consulta el índice, en vez de fijar el
 * índice entero. El contrato de restaurar es el mismo que cumplen las specs de portada de
 * la batería funcional.
 */
test.describe('Escaparate', () => {
  test.beforeAll(async ({ browser, request }) => {
    await ponerPortadaEscaparate(request);
    // Sin esperar, la captura puede fotografiar la portada ANTERIOR: el 200 del PATCH no
    // garantiza que el frontend haya invalidado su caché. Un baseline tomado así estaría
    // mal tomado y nadie lo notaría. Ver `esperarPortadaEscaparate`.
    const calentamiento = await browser.newPage();
    await esperarPortadaEscaparate(calentamiento);
    await calentamiento.close();
  });

  test.afterAll(async ({ request }) => {
    await restaurarPortada(request);
  });

  const RUTAS: readonly [nombre: string, ruta: string][] = [
    ['portada', '/'],
    ['blog-articulo', RUTA_BLOG],
    ['pagina', RUTA_PAGINA],
  ];

  for (const [nombre, ruta] of RUTAS) {
    test(nombre, async ({ page }) => {
      await preparar(page, ruta);
      await expect(page).toHaveScreenshot(`publico-${nombre}.png`, { fullPage: true });
    });
  }
});

/**
 * ══ ESCAPARATE · RÁFAGA D — EL HERO A PANTALLA COMPLETA ══════════════════════════════
 *
 * La misma portada del describe de arriba, con las tres piezas de la ráfaga puestas:
 * altura `pantalla`, rótulo y el buscador montado sobre la banda. Ver
 * `PORTADA_ESCAPARATE_PANTALLA`.
 *
 * ── LO QUE ESTA CAPTURA PRUEBA, Y LO QUE PRUEBA LA DE AL LADO ───────────────────────
 *
 * Van juntas y dicen cosas distintas:
 *
 *   · `publico-portada` sigue en altura `normal` y tiene que quedar **idéntica** tras la
 *     ráfaga D. Ésa es la prueba de que la migración no cambia ninguna portada existente:
 *     la pantalla completa no se enciende al desplegar, se enciende cuando un admin la
 *     elige;
 *   · `publico-portada-pantalla` enseña qué pasa cuando la elige.
 *
 * Se captura a PÁGINA COMPLETA, no sólo el viewport, y es a propósito: lo que hay que
 * poder mirar no es sólo que el hero llene la pantalla, sino que **el primer bloque asoma
 * por abajo** y que la portada sigue fluyendo detrás. Un hero a pantalla completa que
 * reorganizara la página en pantallas sucesivas se vería aquí, y es justo lo que la
 * decisión 1a descarta.
 */
test.describe('Escaparate — hero a pantalla completa', () => {
  test.beforeAll(async ({ browser, request }) => {
    await ponerPortadaPantalla(request);
    const calentamiento = await browser.newPage();
    await esperarPortadaPantalla(calentamiento);
    await calentamiento.close();
  });

  test.afterAll(async ({ request }) => {
    await restaurarPortada(request);
  });

  test('portada-pantalla', async ({ page }) => {
    await preparar(page, '/');
    await expect(page).toHaveScreenshot('publico-portada-pantalla.png', { fullPage: true });
  });
});

// ── Login del backoffice (sin sesión) ───────────────────────────────────────────────────
//
// Va aparte del resto del backoffice porque es OTRA COSA: vive fuera del grupo `(admin)`
// y es la única pantalla oscura del proyecto (10 utilidades `slate-*` escritas a mano).
// Es también la que el diseño propone mover a una zona propia `login` en E5, así que su
// «antes» es exactamente lo que habrá que respetar entonces.
test.describe('Login del backoffice', () => {
  test('admin-login', async ({ page }) => {
    await preparar(page, '/admin/login');
    await expect(page).toHaveScreenshot('admin-login.png', { fullPage: true });
  });
});

// ── Backoffice (ADMIN) ──────────────────────────────────────────────────────────────────
//
// Los cuatro idiomas del backoffice y las dos pantallas de Plataforma que el sistema de
// estilo va a extender (marca e instancia). Aquí es donde vive el grueso de la dispersión
// que E0 consolida: 30 de los 33 ficheros del banner amarillo son de esta zona.
test.describe('Backoffice', () => {
  const RUTAS: readonly [nombre: string, ruta: string, tapar?: string][] = [
    ['resumen', '/admin'],
    // `tapar` = la fecha. Ver el bloque FECHAS al final del fichero.
    ['anuncios-tabla', '/admin/anuncios', '[data-testid="anuncio-fecha-publicacion"]'],
    // EL FORMULARIO ES `facturas/emisor` Y NO `/admin/ajustes`, que es donde primero se
    // puso. Ajustes pinta **49 marcas «Actualizado: …»**, una por ajuste, y su texto
    // cambia cada vez que se escribe uno. A 1280 px eso sólo cambia unos dígitos; a
    // 375 px un carácter de más reajusta el salto de línea de una fila y **la página
    // entera se desplaza 24 px**, con lo que el 7 % de los píxeles difiere.
    //
    // Costó localizarlo porque el patrón engañaba: la captura falló dos veces seguidas
    // con un cambio en el árbol y pasó dos veces sin él, lo que parecía causalidad
    // clarísima. No lo era — con el mismo código volvió a medir la altura del baseline.
    // Lo que lo delató fue que dos corridas idénticas dieran 608394 y 608550 píxeles
    // distintos: dos medidas distintas del mismo código no son una regresión.
    //
    // `facturas/emisor` es el mismo idioma visual —etiquetas, campos, guardar— sin una
    // sola fecha. Enmascarar no habría servido: la máscara se pinta DESPUÉS del
    // maquetado, así que tapa el texto variable pero no el desplazamiento que provoca.
    ['formulario', '/admin/facturas/emisor'],
    ['moderacion-cola', '/admin/moderacion'],
    // AQUÍ ESTUVO `/admin/usuarios`, y se retira en E2 con dos motivos medidos.
    //
    // Al bajar la tolerancia a cero (ver `threshold` en la config) aparecieron dos
    // fuentes de ruido que el umbral por defecto tapaba:
    //
    //  1. la columna «Última conexión» lleva la HORA del último acceso, y
    //     `global-setup` entra con las seis cuentas en cada corrida para guardar su
    //     sesión: cambia siempre. Esto sí se podía tapar —el texto mide igual,
    //     `dd/mm/aa, hh:mm`, así que no arrastra el maquetado— y se probó;
    //  2. pero debajo apareció lo que no tiene arreglo desde aquí: **las dos últimas
    //     filas intercambian su orden entre corridas**. Las dos cuentas no han
    //     entrado nunca, así que empatan en la columna por la que se ordena y el
    //     desempate no es estable.
    //
    // El idioma visual «tabla del backoffice» ya lo cubre `anuncios-tabla`, así que
    // esta pantalla no aportaba cobertura nueva: aportaba un rojo intermitente. Y una
    // captura que sólo coincide a veces enseña a ignorar el rojo, que es justo lo que
    // esta batería no se puede permitir ahora que BLOQUEA el CI.
    // `tapar` = la fecha del reporte. La OTRA fecha de esta pantalla —el
    // `resolvedAt` que acompaña a «por {moderador}»— no se enmascara porque no se
    // pinta: la denuncia sembrada está PENDIENTE, así que ese párrafo no existe en
    // la captura. Si algún día la siembra resolviera una, volvería la caducidad por
    // ahí y habría que envolver esa fecha en su propio ancla (tapar el párrafo
    // entero taparía además el nombre del moderador, que es enmascarar de más).
    ['reportes', '/admin/reportes', '[data-testid="reporte-fecha"]'],
    ['blog', '/admin/blog'],
    ['facturas', '/admin/facturas'],
    ['marca', '/admin/marca'],
    /**
     * E12 — `tapar` = LAS DOS FILAS QUE PINTAN LA MÁQUINA, no el código.
     *
     * Ésta es la única pantalla de la batería que muestra el entorno del despliegue, y dos
     * de sus filas cambian sin que nadie toque nada: «Versión de la API» sale de
     * `npm_package_version` —o sea, de CÓMO se lanzó el proceso, no de qué versión es— y
     * «Commit desplegado» saldrá de `GIT_SHA` en cuanto el despliegue lo exporte.
     *
     * Sin la máscara, el baseline de cada plataforma guarda el entorno de la máquina que lo
     * escribió, y la captura falla en la siguiente sin que nada esté roto. Se descubrió así:
     * el baseline de win32 llevaba una versión de API y el runner de linux otra, y esos 363
     * píxeles llevaban tres ráfagas apuntados como «deriva pendiente de revisar».
     *
     * ENMASCARAR AQUÍ SÍ VALE, y conviene decir por qué, porque el §10.3 del diseño advierte
     * justo de lo contrario: la máscara se pinta DESPUÉS del maquetado, así que tapa el texto
     * pero no el desplazamiento que ese texto provoca. Ahí está la diferencia con
     * `/admin/ajustes`, que se sacó del catálogo: allí el texto variable reajustaba el salto
     * de línea y movía la página entera 24 px. Aquí el valor es corto y va en una fila propia;
     * **medido**: con la versión cambiada las dos imágenes siguen teniendo el mismo alto.
     *
     * ⚠ SE TAPA LA FILA ENTERA Y NO SÓLO EL VALOR, y esto costó una mutación descubrirlo. La
     * primera versión tapaba el `<dd>`, para no perder de vista la etiqueta. No servía:
     * Playwright dibuja la máscara sobre la CAJA del elemento, y la caja de un valor alineado
     * a la derecha cambia de ancho con el texto — así que con una versión más larga el
     * rectángulo tapado era otro y la captura seguía difiriendo en 1.720 píxeles. Curiosamente
     * pasaba en móvil, donde el `<dd>` ocupa el ancho completo y la caja no se mueve: un
     * recordatorio de que dos proyectos no son dos corridas del mismo test.
     *
     * Lo que queda sin vigilar son las dos etiquetas. Es el precio, y es barato.
     */
    [
      'instancia',
      '/admin/instancia',
      '[data-testid="dato-version-api"], [data-testid="dato-commit"]',
    ],
  ];

  for (const [nombre, ruta, tapar] of RUTAS) {
    test(nombre, async ({ adminContext }) => {
      const page = await adminContext.newPage();
      await preparar(page, ruta);
      await expect(page).toHaveScreenshot(`backoffice-${nombre}.png`, {
        fullPage: true,
        mask: tapar ? [page.locator(tapar)] : [],
      });
    });
  }

  /**
   * E11 — EL NAV ENTERO, Y ES EL ÚNICO SITIO DONDE SE LE VE LA CARA.
   *
   * ── EL PUNTO CIEGO QUE CIERRA ───────────────────────────────────────────────────────
   *
   * Las nueve capturas de arriba llevan el sidebar dentro y aun así **no vigilan la mitad
   * de abajo del menú**. La causa está en [`(admin)/layout.tsx`](../src/app/(admin)/layout.tsx):
   * el aside es `sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto`, o sea que se
   * recorta a la altura de la ventana y hace scroll por dentro. Con 27 secciones en 6
   * grupos la lista pasa de los 664 px que quedan bajo la cabecera a 720 de alto, así que
   * el grupo «Plataforma» entero —Ajustes, Marca, Ilustraciones, Estilo, Instancia— cae
   * fuera de todas las fotos. `fullPage: true` no ayuda: el aside es `sticky` y su altura
   * no crece con la página.
   *
   * Se descubrió en E9 por la vía tonta: se añadió una sección al nav dando por hecho que
   * las capturas del backoffice se moverían, y **no se movió ni una**. Una barrera que no
   * se inmuta cuando cambias justo lo que vigila no está vigilando eso.
   *
   * ── POR QUÉ ASÍ Y NO DE OTRAS DOS MANERAS QUE SE CONSIDERARON ──────────────────────
   *
   *  · **No se desplaza el sidebar hasta abajo** para fotografiar el final: eso cambiaría
   *    un punto ciego por otro —el principio de la lista— y además el desplazamiento
   *    interno es una posición más que tendría que salir idéntica en cada corrida.
   *  · **No se fotografía la página entera a una ventana alta**: haría una captura enorme
   *    de una pantalla que ya está cubierta, para vigilar una franja estrecha. Se paga
   *    ancho de banda de CI por píxeles que no aportan.
   *
   * Lo que se hace es fotografiar **el elemento del nav**, con la ventana lo bastante alta
   * para que no lo recorte nadie. La captura es estrecha (el ancho del aside) y lleva las
   * 27 secciones con sus 6 cabeceras de grupo.
   *
   * ── LA ASERCIÓN DE ANTES DEL DISPARO NO ES DECORACIÓN ──────────────────────────────
   *
   * `toBeInViewport()` sobre la última sección es lo que impide que esta captura vuelva a
   * mentir como mentían las otras nueve: si algún día el nav crece y vuelve a recortarse,
   * el test **falla ahí**, con un mensaje que se entiende, en vez de seguir fotografiando
   * felizmente media lista y jurando que la cubre entera.
   *
   * SÓLO EN ESCRITORIO: el aside es `hidden md:block`. La versión móvil del mismo
   * componente ya tiene su foto en `overlays.spec.ts` (`admin-drawer`).
   */
  test('nav-completo', async ({ adminContext }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'escritorio',
      'El aside es `hidden md:block`; en móvil el menú es el cajón, que ya tiene captura propia.',
    );

    const page = await adminContext.newPage();
    // Alta a propósito: es lo que quita el recorte del aside. El ancho no se toca — la
    // captura es del elemento, así que sólo mide lo que ocupa el nav.
    await page.setViewportSize({ width: 1280, height: 1400 });
    await preparar(page, '/admin');

    const nav = page.getByTestId('admin-nav');
    await expect(nav).toBeVisible();

    // Las 28 de `BACKOFFICE_SECTIONS` para un ADMIN (27 + «Cookies», que añadió la
    // ráfaga 2 del consentimiento). El número lo pinzan también `admin-roles.spec.ts` y
    // `nav-backoffice.spec.ts`; aquí se repite porque una captura que dice «el nav
    // entero» tiene que comprobar que lo es antes de disparar.
    await expect(nav.getByRole('link')).toHaveCount(28);
    // Y la última de todas, DENTRO del recorte: sin esto volveríamos al punto ciego.
    // Era «Instancia» hasta que «Cookies» pasó a ir detrás — el punto ciego se tapa
    // mirando la ÚLTIMA, así que el nombre tiene que moverse con ella.
    await expect(nav.getByRole('link', { name: 'Cookies' })).toBeInViewport();

    await expect(nav).toHaveScreenshot('backoffice-nav-completo.png');
  });
});

/**
 * E11 — LA GRÁFICA. El único idioma visual del backoffice que no cubría ninguna captura.
 *
 * ── CÓMO SE SUPO QUE FALTABA, Y CÓMO SE SUPO QUE ERA EL ÚNICO ─────────────────────────
 *
 * Inventariando las 41 rutas de `(admin)` por las primitivas que pintan —tabla, tarjetas,
 * formulario, diálogo, lista ordenable, editor de bloques, subida, badge, previa,
 * conversación— y cruzándolo con lo que ya fotografían las nueve capturas de arriba. De
 * los diez idiomas, nueve ya estaban cubiertos: las 32 rutas sin foto propia son variantes
 * de algo ya vigilado, que es exactamente lo que el §10.3 del diseño planificó («cobertura
 * por IDIOMA VISUAL, no por ruta»).
 *
 * El que se escapaba es éste: `StatsChart` (Recharts) pinta ejes, rejilla, leyenda y
 * líneas, y **nada de eso se parece a ninguna otra pantalla**. Un cambio de tokens que
 * dejara la rejilla invisible o los ejes ilegibles no lo cazaba nadie.
 *
 * Vale la pena decir que la primera medición dijo «no falta ninguno» y se equivocaba: el
 * clasificador sólo miraba los ficheros dentro del directorio de cada ruta, y la gráfica
 * vive en `components/stats/`. Ante un inventario que sale redondo, la pregunta es si la
 * medición mira donde tiene que mirar.
 *
 * ── POR QUÉ ESTA CAPTURA SIRVE DATOS FIJOS, CUANDO NINGUNA OTRA LO HACE ──────────────
 *
 * Porque la pantalla de verdad es **inestable por dos ejes a la vez**, y las dos ya han
 * mordido a esta batería antes (§10.3): las fechas del eje X se mueven cada día, y los
 * recuentos dependen de lo que hayan hecho las otras specs de la corrida. Fotografiarla en
 * vivo sería repetir el caso de `/admin/ajustes` —la que hubo que sacar del catálogo—
 * sabiéndolo de antemano.
 *
 * Enmascarar no vale, y ésa es la lección que el §10.3 dejó escrita con sangre: la máscara
 * se pinta DESPUÉS del maquetado, así que tapa el texto que cambia pero no el
 * desplazamiento que ese texto provoca. En una gráfica, además, el dato ES la forma.
 *
 * Y la alternativa que el diseño recomienda para una pantalla movediza —«fotografiar otra
 * del mismo idioma visual»— aquí no existe: las otras tres pantallas con gráfica
 * (`/admin/estadisticas/categorias/[id]`, `/admin/anuncios/[id]`, `/admin/usuarios/[id]`)
 * montan el MISMO componente con los MISMOS dos ejes de variabilidad.
 *
 * Así que se fija la respuesta de la API. Lo que se fotografía sigue siendo el build de
 * producción pintando con los tokens de verdad; lo único que deja de ser real es el dato,
 * que es justo lo que no se quiere vigilar aquí.
 *
 * ── LA COMPROBACIÓN QUE IMPIDE QUE ESTA CAPTURA SE PUDRA EN SILENCIO ────────────────
 *
 * Servir un cuerpo fijo acopla el test a la forma de `PulsoPlataforma`. Si esa forma
 * cambiara, la pantalla caería a su estado vacío —«Sin actividad registrada en esta
 * ventana»— y la captura seguiría pasando, fotografiando un hueco y jurando que vigila una
 * gráfica. Por eso antes de disparar se exige que el mensaje de vacío NO esté: el día que
 * el contrato cambie, esto se pone rojo en vez de degradarse sin avisar.
 */
test.describe('Gráfica del backoffice', () => {
  /** Catorce días con forma reconocible: una subida, un valle y un repunte. */
  const DIAS = Array.from({ length: 14 }, (_, i) => {
    const dia = String(i + 1).padStart(2, '0');
    return `2026-03-${dia}`;
  });
  const VISTAS = [12, 18, 25, 31, 28, 22, 15, 11, 14, 21, 34, 41, 38, 30];
  const APARICIONES = [120, 168, 210, 265, 240, 190, 140, 105, 132, 198, 300, 355, 322, 268];

  const PULSO = {
    days: 7,
    totals: { views: 340, impressions: 3013, activeListings: 42, ctr: 11.3, ctrMinImpressions: 100 },
    dailyViews: DIAS.map((date, i) => ({ date, count: VISTAS[i] })),
    dailyImpressions: DIAS.map((date, i) => ({ date, count: APARICIONES[i] })),
    categories: [],
  };

  test('estadisticas-grafica', async ({ adminContext }) => {
    const page = await adminContext.newPage();

    // `**/api/…` y no `**/admin/stats/**` a secas: sin el `/api/` delante, el patrón casa
    // también con rutas del navegador y Playwright acabaría sirviendo JSON como si fuera
    // una página. Es un error que ya se cometió en `admin-fuga-secretos.spec.ts`.
    await page.route('**/api/admin/stats/platform**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(PULSO),
      }),
    );

    await preparar(page, '/admin/estadisticas');

    const grafica = page.getByTestId('pulso-chart');
    await expect(grafica).toBeVisible();
    // ⚠ La comprobación que hace honesta a esta captura: si el contrato cambiara, aquí
    // habría un estado vacío en vez de una gráfica, y la foto no vigilaría nada.
    await expect(grafica).not.toContainText('Sin actividad registrada');

    await expect(grafica).toHaveScreenshot('backoffice-estadisticas-grafica.png');
  });
});

// ── Zona de cuenta (vendedor) ───────────────────────────────────────────────────────────
//
// Las pantallas con datos del usuario y, sobre todo, los ESTADOS VACÍOS: favoritos,
// mensajes y notificaciones de una cuenta recién sembrada están vacíos, que es
// precisamente donde E7 pondrá las ilustraciones. Su «antes» es el hueco que hay hoy.
test.describe('Cuenta', () => {
  const RUTAS: readonly [nombre: string, ruta: string, tapar?: string][] = [
    ['perfil', '/perfil'],
    // Las DOS líneas de fecha de la tarjeta (publicación y caducidad). La de caducidad
    // no se pinta hoy —el anuncio sembrado no llega a ACTIVE con `expiresAt`—, y su
    // ancla se enmascara igual: un selector que no encuentra nada no tapa nada, y el
    // día que la siembra cambie no vuelve la caducidad por la puerta de atrás.
    ['mis-anuncios', '/mis-anuncios', '[data-testid="mi-anuncio-publicado"], [data-testid="mi-anuncio-caduca"]'],
    ['favoritos', '/favoritos'],
    ['mensajes', '/mensajes'],
    ['notificaciones', '/notificaciones'],
    ['mis-creditos', '/mis-creditos'],
  ];

  for (const [nombre, ruta, tapar] of RUTAS) {
    test(nombre, async ({ sellerContext }) => {
      const page = await sellerContext.newPage();
      await preparar(page, ruta);
      await expect(page).toHaveScreenshot(`cuenta-${nombre}.png`, {
        fullPage: true,
        mask: tapar ? [page.locator(tapar)] : [],
      });
    });
  }
});

/**
 * ── FECHAS: POR QUÉ TRES CAPTURAS LLEVAN MÁSCARA ──────────────────────────────────────
 *
 * El 4 de septiembre de 2026, a las 00:19 UTC, la puerta de capturas se puso roja sin que
 * nadie hubiera tocado una línea de `apps/web`. Fallaban cuatro capturas —`anuncios-tabla`,
 * `reportes` y `mis-anuncios` en sus dos viewports— y **sólo** esas cuatro: exactamente las
 * que pintan la fecha de HOY (`04/09/26`, `04/09/2026`, `4 sept 2026`). Los baselines se
 * habían generado el día 3, y toda la migración de estilo ocurrió ese mismo día, así que la
 * bomba nunca había llegado a sonar.
 *
 * Lo que la siembra publica lo publica AHORA, así que esas pantallas llevan dentro el
 * calendario. Sin arreglarlo, cualquier ráfaga —aunque no toque el frontend— necesitaría un
 * commit de baselines sólo por el cambio de día, y una puerta que se pone roja por el
 * calendario es una puerta que se aprende a ignorar. Es la misma lección que cerró la
 * estabilización de la batería de backend, aplicada a la red visual.
 *
 * ── ENMASCARAR NO BASTA SI LA CAJA SE MUEVE (lo que la mutación enseñó) ───────────────
 *
 * La máscara se pinta DESPUÉS del maquetado y SOBRE LA CAJA DEL ELEMENTO. De ahí salen dos
 * condiciones, y la segunda no estaba en el plan:
 *
 *   1. el texto no puede DESPLAZAR nada (es lo que hundió a `/admin/ajustes`, donde un
 *      carácter de más movía la página entera 24 px);
 *   2. la CAJA del elemento enmascarado no puede cambiar de tamaño — porque el rectángulo
 *      lo sigue, y una máscara que se encoge con el texto deja de tapar lo mismo.
 *
 * La segunda se descubrió mutando: se reescribió la fecha en el DOM antes de disparar,
 * contra los mismos baselines. `anuncios-tabla` pasó; `reportes` cayó con 3.183 píxeles
 * —la tabla entera desplazada— y `mis-anuncios` con 75. Midiendo la caja con varias fechas:
 *
 *   · `/admin/anuncios`  → 107,20 px con TODAS. La columna la fija la cabecera
 *     («Publicado» es más ancha que `dd/mm/aa`), no el dato.
 *   · `/admin/reportes`  → 104,08 / 103,34 / 91,47 / 97,55 / 102,50 px. Aquí la cabecera
 *     («Fecha») es más corta que el dato, así que manda la fecha.
 *   · `mis-anuncios`     → el `<span>` 68,77 vs 73,02 px; el `<p>` que lo contiene, 342 px
 *     con las dos.
 *
 * Por eso el anclaje NO es «la fecha» en los tres sitios, sino la caja estable más pequeña
 * que la contiene: la CELDA en el backoffice y el PÁRRAFO en `mis-anuncios`. Y por eso las
 * dos celdas llevan `tabular-nums` (ver sus comentarios): con cifras tabulares `dd/mm/aa` y
 * `dd/mm/aaaa` miden siempre lo mismo, así que la estabilidad deja de depender de que la
 * cabecera resulte ser más ancha que el dato.
 *
 * El precio, dicho entero: en `mis-anuncios` la máscara tapa también la palabra
 * «Publicado». Es el mínimo que se puede tapar sin que la máscara se mueva, y lo que se
 * pierde está cubierto al lado — la línea de la ubicación, justo encima, lleva exactamente
 * la misma tipografía (`text-xs text-muted-foreground`) y sigue vigilada.
 *
 * ── POR QUÉ NO SE RETIRAN, QUE ERA LA OTRA SALIDA ─────────────────────────────────────
 *
 * Porque `anuncios-tabla` no puede salir de la red: es el que sostiene el razonamiento con
 * el que se retiró `/admin/usuarios` («el idioma visual *tabla del backoffice* ya lo cubre
 * `anuncios-tabla`»). Retirarlo dejaría sin cobertura el idioma que aquél le delegó —una
 * retirada que arrastra otra—. Enmascarar las mantiene a las tres vigilando todo lo demás.
 */
