import { test, expect } from '../e2e/fixtures/auth';
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
// ── LAS TRES QUE NO ESTÁN: PORTADA, BÚSQUEDA Y LISTADO DE BLOG ──────────────────────────
//
// Estaban aquí, y se sacaron con la medición delante. Sus capturas no fallaban por un
// cambio de estilo: fallaban porque **su contenido no es determinista en esta batería**.
//
//   · portada  — esperado 4311 px de alto, recibido 1339 px, dos corridas seguidas;
//   · búsqueda — recibido 1027 px en una corrida y 990 px en la siguiente, con el MISMO
//     árbol de fuentes. Dos alturas distintas del mismo código es no-determinismo, y ahí
//     no hay nada que interpretar.
//
// La causa es estructural y no se arregla con una tolerancia más ancha: esas tres páginas
// pintan ESTADO GLOBAL MUTABLE que otras specs modifican. La portada monta
// `HomeBlockRenderer` con los bloques de `HomepageConfig`, que las specs de
// `/admin/portada` reescriben; los listados salen del índice de Meilisearch, que unas
// specs llenan y el teardown vacía; y los artículos del blog los crean las specs de blog.
// El baseline se tomó con los restos de sesiones anteriores dentro.
//
// Se sacan en vez de taparse porque una captura que sólo coincide a veces enseña a
// ignorar el rojo — es el mismo motivo por el que esta batería corre con `retries: 0`
// (ver playwright.snapshots.config.ts). Una red en la que no se confía no es una red.
//
// VUELVEN cuando la batería FIJE ese estado antes de disparar: escribir un
// `HomepageConfig` conocido y sembrar un conjunto fijo de anuncios ya indexados. Es una
// tarea con forma concreta, no un pendiente vago; no entra en E0 porque E0 no puede
// comprometer infraestructura pesada sin medirla (§10.2 del diseño).
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
    ['instancia', '/admin/instancia'],
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
