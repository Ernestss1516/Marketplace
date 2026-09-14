import { test, expect } from '../e2e/fixtures/auth';
import {
  esperarPortadaEscaparate,
  ponerPortadaEscaparate,
  restaurarPortada,
} from '../e2e/helpers/portada';
import { preparar } from './preparar';

/**
 * E0 — LOS OVERLAYS ABIERTOS: la barrera del `tailwindcss-animate` ausente.
 *
 * ── QUÉ VIGILAN ESTAS DOS CAPTURAS ────────────────────────────────────────────────────
 *
 * El paquete `tailwindcss-animate` NO está instalado —ni en `package.json`, ni en los
 * `plugins` de `tailwind.config.ts`, ni en `node_modules`— y sin embargo seis ficheros
 * usaban sus clases (`animate-in`, `zoom-in-95`, `slide-in-from-top-2`…). Ninguna
 * generaba CSS: los diálogos, los desplegables y los selectores aparecen **en seco**, y
 * llevan así quién sabe cuánto sin que el build ni los 518 casos de la batería funcional
 * lo notaran.
 *
 * E0 **quita las clases muertas y NO instala el plugin** (§6.3 del diseño). Instalarlo
 * añadiría animación en seis componentes de golpe, justo en la ráfaga cuyo único
 * propósito es demostrar que nada cambió. La animación de overlays vuelve en E6, ya como
 * parte del vocabulario del modelo y con su intensidad ajustada por zona.
 *
 * Estas capturas son lo que convierte esa decisión en algo comprobable: fotografían un
 * overlay ABIERTO antes y después de quitar las clases. Como las clases no producían CSS,
 * las dos capturas tienen que ser idénticas. Si alguien instalara el plugin, dejarían de
 * serlo inmediatamente — que es exactamente el aviso que se quiere.
 *
 * Los cuatro componentes afectados comparten el mismo bloque de clases muertas, así que
 * un `SelectContent` y un `DialogContent` cubren las dos formas (capa flotante anclada y
 * capa a pantalla completa) sin fotografiar los cuatro.
 */

/**
 * `SelectContent` (ui/select.tsx) — la capa flotante.
 *
 * SE ABRE EN `/admin/mensajes-contacto` Y NO EN `/contacto`, y la primera versión de esta
 * captura sí usaba `/contacto`: falló, y el fallo enseñó algo que conviene dejar escrito.
 * El selector de motivo del formulario público se puebla desde la base
 * (`GET /contacto/motivos`) y el seed de pruebas no siembra ninguno, así que la pantalla
 * cae —correctamente— a su estado «el formulario no está disponible» y ahí no hay ningún
 * selector que abrir.
 *
 * Los filtros de la bandeja del backoffice no tienen ese problema: su primera opción
 * («Todos…») es una constante del componente, no una fila. Una captura no puede depender
 * de que alguien se acuerde de sembrar algo.
 */
test.describe('Selector abierto', () => {
  test('admin-select', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await preparar(page, '/admin/mensajes-contacto');

    await page.getByRole('combobox').first().click();
    // La capa se ancla al disparador y se posiciona en dos pasos; esperar a que una de
    // sus opciones sea visible garantiza que ya está colocada, no a medio camino.
    await expect(page.getByRole('option').first()).toBeVisible();

    await expect(page).toHaveScreenshot('overlay-admin-select.png');
  });
});

/**
 * `DialogContent` (el mismo bloque de clases muertas que ui/dialog.tsx) — la capa a
 * pantalla completa. El cajón del backoffice sólo existe por debajo de `md`, así que esta
 * captura es SÓLO del proyecto móvil: en escritorio su disparador está en `md:hidden` y no
 * hay nada que abrir.
 */
test.describe('Cajón del backoffice abierto', () => {
  test('admin-drawer', async ({ adminContext }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'movil',
      'El cajón vive en `md:hidden`: en escritorio no hay disparador que pulsar.',
    );

    const page = await adminContext.newPage();
    await preparar(page, '/admin');

    await page.getByLabel('Abrir el menú del backoffice').click();
    await expect(page.getByLabel('Menú del backoffice')).toBeVisible();

    await expect(page).toHaveScreenshot('overlay-admin-drawer.png');
  });
});

/**
 * ══ BUSCADOR · BQ-C — EL DIÁLOGO FILTRABLE, ABIERTO ══════════════════════════════════
 *
 * **Es la única captura del catálogo que enseña el punto 1 del encargo.** Las cuatro de
 * portada fotografían el buscador con los diálogos CERRADOS: ahí sólo se ve un disparador
 * que se parece mucho al `<select>` que sustituyó. Lo que la ráfaga construyó —el campo de
 * texto que filtra, la lista, la ruta de ancestros, la cuenta de subcategorías— no aparece
 * en ninguna hasta ésta.
 *
 * ── Y ES LA ÚNICA QUE PUEDE ENSEÑAR LAS DOS GEOMETRÍAS ─────────────────────────────
 *
 * La decisión 2 del diseño (§6.2) es que en móvil el diálogo sea una HOJA A PANTALLA
 * COMPLETA y en escritorio un cuadro centrado. Eso se consigue con clases `md:` sobre un
 * solo árbol de React —nunca con un `useMediaQuery`, que sería estructura y pondría roja la
 * invariancia—, así que **la única forma de comprobar que las dos geometrías existen de
 * verdad es fotografiarlas**. Se toma en los dos proyectos por eso, y no por simetría.
 *
 * ── SE ELIGE EL DE CATEGORÍA, NO EL DE PROVINCIA ───────────────────────────────────
 *
 * Porque es el que tiene más idioma visual que enseñar: el de provincia son 52 filas de una
 * palabra, y el de categoría trae además la ruta de ancestros atenuada a la derecha y la
 * nota de «y N subcategorías» — las dos ranuras que un `<option>` no podía tener. El
 * criterio para ampliar el catálogo de capturas es «un idioma visual nuevo», no «una
 * superficie más», y el de provincia no añade ninguno.
 *
 * ── LA PORTADA MEDIBLE, POR EL MISMO CONTRATO QUE EL RESTO ─────────────────────────
 *
 * La portada sembrada monta un bloque `listings` cuyo orden depende de la ventana de
 * rotación de 15 minutos: dos lecturas separadas por esa ventana darían capturas distintas
 * sin que nadie hubiera tocado nada. Se pone `PORTADA_ESCAPARATE` —que no lo lleva— y se
 * restaura al terminar, que es lo que ya hacen `pantallas.spec.ts` y la invariancia.
 *
 * ⚠ SE ABRE CON TECLADO Y NO CON RATÓN, y no es un capricho: al hacer clic, el puntero
 * queda sobre la fila que hay debajo y `onMouseEnter` la resalta — así que la captura
 * saldría con DOS filas marcadas (la activa por teclado y la que esté bajo el cursor) o con
 * una distinta según dónde caiga el ratón. `Enter` sobre el disparador enfocado abre la
 * capa sin mover el puntero, y el resaltado es entonces el que el componente decide.
 */
test.describe('Diálogo filtrable del buscador abierto', () => {
  test.beforeAll(async ({ browser, request }) => {
    await ponerPortadaEscaparate(request);
    // El calentamiento va en una página APARTE y aquí, no dentro del test: el 200 del PATCH
    // no garantiza que el frontend haya invalidado su caché, y un baseline tomado de la
    // portada anterior estaría mal tomado sin que nadie lo notara. Mismo contrato que
    // `pantallas.spec.ts`.
    const calentamiento = await browser.newPage();
    await esperarPortadaEscaparate(calentamiento);
    await calentamiento.close();
  });

  test.afterAll(async ({ request }) => {
    await restaurarPortada(request);
  });

  test('buscador-dialogo-categoria', async ({ page }) => {
    await preparar(page, '/');

    await page.getByLabel('Categoría').focus();
    await page.keyboard.press('Enter');

    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();
    // Esperar a una FILA y no sólo a la capa: el contenido llega por `next/dynamic`, y sin
    // esto la foto podría salir con el diálogo montado y la lista todavía vacía.
    await expect(dialogo.getByRole('option').first()).toBeVisible();

    await expect(page).toHaveScreenshot('buscador-dialogo-categoria.png');
  });
});
