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
  const RUTAS: readonly [nombre: string, ruta: string][] = [
    ['resumen', '/admin'],
    ['anuncios-tabla', '/admin/anuncios'],
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
    ['usuarios', '/admin/usuarios'],
    ['reportes', '/admin/reportes'],
    ['blog', '/admin/blog'],
    ['facturas', '/admin/facturas'],
    ['marca', '/admin/marca'],
    ['instancia', '/admin/instancia'],
  ];

  for (const [nombre, ruta] of RUTAS) {
    test(nombre, async ({ adminContext }) => {
      const page = await adminContext.newPage();
      await preparar(page, ruta);
      await expect(page).toHaveScreenshot(`backoffice-${nombre}.png`, { fullPage: true });
    });
  }
});

// ── Zona de cuenta (vendedor) ───────────────────────────────────────────────────────────
//
// Las pantallas con datos del usuario y, sobre todo, los ESTADOS VACÍOS: favoritos,
// mensajes y notificaciones de una cuenta recién sembrada están vacíos, que es
// precisamente donde E7 pondrá las ilustraciones. Su «antes» es el hueco que hay hoy.
test.describe('Cuenta', () => {
  const RUTAS: readonly [nombre: string, ruta: string][] = [
    ['perfil', '/perfil'],
    ['mis-anuncios', '/mis-anuncios'],
    ['favoritos', '/favoritos'],
    ['mensajes', '/mensajes'],
    ['notificaciones', '/notificaciones'],
    ['mis-creditos', '/mis-creditos'],
  ];

  for (const [nombre, ruta] of RUTAS) {
    test(nombre, async ({ sellerContext }) => {
      const page = await sellerContext.newPage();
      await preparar(page, ruta);
      await expect(page).toHaveScreenshot(`cuenta-${nombre}.png`, { fullPage: true });
    });
  }
});
