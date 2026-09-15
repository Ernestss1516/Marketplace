import { test, expect } from '../e2e/fixtures/auth';
import { preparar } from './preparar';

/**
 * ══ BUSCADOR · BQ-E — EL PANEL DE FILTROS, ANTES Y DESPUÉS ═══════════════════════════
 *
 * Las dos superficies que esta ráfaga repinta: el panel de `/busqueda` y el de
 * `/[categoria]`, donde los `<select>` de categoría y provincia pasan a ser los diálogos
 * filtrables del molde de BQ.
 *
 * ── POR QUÉ ENTRAN ANTES QUE EL CAMBIO ──────────────────────────────────────────────
 *
 * Por la regla de orden del escaparate (§0.2), la misma con la que entraron las tres
 * capturas de la ráfaga B: **una red puesta DESPUÉS del cambio no vigila nada, sólo
 * certifica lo que ya hay**. El baseline se toma con el aspecto de hoy, y cuando el
 * cambio entra estas cuatro imágenes se ponen rojas — y ése es el entregable. El artefacto
 * de CI trae antes/obtenida/diff, y eso es lo que se mira para aprobar. Regenerar el
 * baseline es el acto que dice «aprobado», no un trámite para volver a verde.
 *
 * ── SE FOTOGRAFÍA EL PANEL Y NO LA PÁGINA, Y ESO ES LO QUE LO HACE POSIBLE ─────────
 *
 * `pantallas.spec.ts` dejó `/busqueda` FUERA del catálogo con una medición delante:
 * «recibido 1027 px en una corrida y 990 px en la siguiente, con el MISMO árbol de
 * fuentes». La causa era el ÍNDICE — los resultados salen de Meilisearch, que unas specs
 * llenan y el teardown vacía— y sigue siendo verdad. Lo que cambia aquí es el encuadre:
 *
 *  · el elemento fotografiado es el PANEL, así que ninguna tarjeta de resultado entra;
 *  · y la consulta no casa con nada a propósito, así que el reparto de facetas que
 *    devuelve el backend viene vacío y las secciones que lo pintan no existen.
 *
 * Lo que queda dentro del encuadre sale todo de la CONFIG y no del resultado: las
 * secciones nativas (orden, proximidad, categoría, tipo, condición, vídeo, precio,
 * ubicación), los atributos filtrables del ámbito (F6) y las etiquetas ofrecidas (B3),
 * todas con su conteo a cero. Es el mismo criterio con el que la portada volvió al
 * catálogo: en vez de fijar el índice entero, se mide una pantalla que no lo consulta.
 *
 * ── DOS RUTAS, PORQUE NO SON LA MISMA PANTALLA ─────────────────────────────────────
 *
 * El panel es el mismo componente, pero las dos rutas lo montan con props distintas, y las
 * diferencias se ven: en `/[categoria]` la categoría viene marcada en el disparador, los
 * atributos filtrables son los de esa rama (no la unión del árbol) y «Tipo» puede no
 * existir si la política de la categoría ya lo decide. Una sola captura dejaría media
 * ráfaga sin mirar.
 *
 * ── Y EN LOS DOS VIEWPORTS, PORQUE SON DOS RAMAS DEL ÁRBOL ─────────────────────────
 *
 * El panel se pinta dos veces: una barra lateral `hidden … lg:block` y un desplegable
 * `lg:hidden` que no existe hasta que se pulsa «Filtros». No es un `useMediaQuery` —eso
 * sería estructura y pondría roja la invariancia—, así que la única forma de comprobar que
 * las dos geometrías existen de verdad es fotografiarlas. De ahí los dos `data-testid`.
 *
 * ── LO QUE **NO** ENTRA, Y POR QUÉ ─────────────────────────────────────────────────
 *
 * El diálogo ABIERTO desde estas rutas. Ya está fotografiado —`overlays.spec.ts` para el
 * Modelo 0 y `modelos-buscador.spec.ts` para los otros cuatro—, y es el MISMO componente
 * con las MISMAS clases: la capa no recibe nada de quien la monta salvo su contenido, y
 * `/busqueda` está en la zona pública igual que la portada, o sea la BASE, así que hereda
 * los tokens del mismo sitio. El criterio del catálogo es «un idioma visual nuevo», no
 * «una superficie más». Lo nuevo de esta ráfaga son los DISPARADORES, y eso es justo lo
 * que estas cuatro capturas encuadran.
 */

/** Una consulta que no casa con nada: sin hits no hay facetas, y sin facetas no hay ruido. */
const SIN_RESULTADOS = 'zzqx-bqe-sin-resultados';

const RUTAS: readonly [nombre: string, ruta: string][] = [
  ['busqueda', `/busqueda?q=${SIN_RESULTADOS}`],
  ['categoria', `/vehiculos/coches?q=${SIN_RESULTADOS}`],
];

/**
 * ⚠ LA VENTANA SE HACE ALTA ANTES DE DISPARAR, Y ES LO QUE HACE LEGIBLE LA FOTO.
 *
 * El panel mide más que los 720 px del proyecto de escritorio, así que Playwright tiene
 * que COSER la captura desplazándose — y al hacerlo se lleva dentro los elementos que no
 * se mueven con el documento: la cabecera `sticky` del sitio público y el pie del banner
 * de cookies. La primera versión de esta captura salía con «Marketplace» pintado encima
 * del título del panel y con el banner cortando la mitad de abajo.
 *
 * Es el mismo remedio, y por la misma razón, que `backoffice-nav-completo`: se agranda la
 * VENTANA para que el elemento quepa entero de una vez. **El ancho no se toca** —es lo que
 * distingue los dos proyectos y lo que esta captura tiene que seguir midiendo—; sólo el
 * alto, que no cambia cómo se maqueta un panel en columna.
 */
const ALTO = 2200;

for (const [nombre, ruta] of RUTAS) {
  test(`panel-${nombre}`, async ({ page }, testInfo) => {
    const ancho = page.viewportSize()?.width ?? 1280;
    await page.setViewportSize({ width: ancho, height: ALTO });

    await preparar(page, ruta);

    const movil = testInfo.project.name === 'movil';
    if (movil) {
      // A 375 px el panel no existe hasta que se despliega. Se pulsa el BOTÓN y no el
      // `<h2>` de la barra lateral, que lleva el mismo texto.
      await page.getByRole('button', { name: 'Filtros' }).click();
    }

    const panel = page.getByTestId(movil ? 'filtros-movil' : 'filtros-escritorio');
    await expect(panel).toBeVisible();

    /**
     * ⚠ LA COMPROBACIÓN QUE IMPIDE QUE ESTA CAPTURA MIENTA. Si un día el panel cayera a
     * un estado degradado —sin árbol de categorías, o con el backend caído—, la foto
     * seguiría pasando y fotografiaría un panel a medias jurando que vigila el entero.
     * Los dos controles que esta ráfaga toca tienen que ESTAR antes de disparar.
     *
     * ⚠ Y SE LOCALIZAN POR SU `aria-label`, QUE ES LO QUE NO CAMBIA (§10.2 del diseño).
     * Por eso **este fichero es idéntico antes y después del cambio**: `getByLabel`
     * encuentra igual el `<select aria-label="Provincia">` de hoy que el disparador del
     * diálogo de mañana. Un localizador atado al `<select>` habría obligado a tocar la
     * red en el mismo commit que repinta lo que vigila, que es la forma de no vigilar
     * nada. Lo único que cambia entre las dos corridas es la IMAGEN, y eso es el diff.
     */
    await expect(panel.getByLabel('Provincia', { exact: false })).toBeVisible();
    await expect(panel.getByLabel('Categoría', { exact: false })).toBeVisible();

    await expect(panel).toHaveScreenshot(`panel-${nombre}.png`);
  });
}
