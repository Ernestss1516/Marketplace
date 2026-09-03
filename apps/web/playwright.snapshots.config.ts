import { defineConfig, devices } from '@playwright/test';
import { config as dotenvParse } from 'dotenv';
import * as path from 'path';

/**
 * E0 — LA BARRERA VISUAL DEL SISTEMA DE ESTILO.
 *
 * ── QUÉ ES ────────────────────────────────────────────────────────────────────────────
 *
 * Una batería SEPARADA que fotografía las pantallas clave y las compara con un baseline.
 * Su único trabajo es sostener el criterio de aceptación de todo el sistema de estilo
 * (docs/diseno-sistema-estilo.md §2.4 y §10.2):
 *
 *     MODELO 0 = EL ACTUAL. No «parecido»: idéntico. Si una captura cambia con Modelo 0
 *     activo, es un BUG DE MIGRACIÓN — se revierte, no se justifica.
 *
 * Sin esto, migrar 83 ficheros a tokens es un acto de fe repetido 83 veces: un cambio de
 * estilo no da error de compilación, no rompe ningún test funcional y sólo se ve si
 * alguien mira. El repo ya tiene la prueba de que eso pasa —`tailwindcss-animate` llevaba
 * ausente con seis ficheros usando sus clases, y ni el build ni los 518 casos de la
 * batería funcional lo notaron.
 *
 * ── POR QUÉ UN FICHERO DE CONFIGURACIÓN PROPIO Y NO MÁS SPECS EN `e2e/` ───────────────
 *
 * Por PRESUPUESTO DE CI, medido y no supuesto (ver el comentario de `timeout-minutes` en
 * .github/workflows/ci.yml):
 *
 *   · el job E2E tiene un límite de 60 min;
 *   · Playwright ya consume ~45 (271 tests, 1 worker, ~10 s/test);
 *   · más ~4,5 de la batería de backend y ~1 del build.
 *
 * Quedan del orden de cinco minutos. Meter aquí ~46 capturas es volver exactamente a la
 * situación que ya canceló el job sin veredicto una vez.
 *
 * Así que esto corre en SU PROPIO JOB, en paralelo — que es literalmente la vía que el
 * workflow ya dejaba propuesta para bajar el reloj: «cada job trae sus propios
 * contenedores de servicio, así que cada shard tendría SU base/Redis/Meili y el estado
 * compartido que hoy obliga a `workers: 1` dejaría de ser un problema».
 *
 * Y el de snapshots es el caso más fácil de esa idea: **no muta nada** (sólo navega y
 * fotografía) y no necesita el wizard de publicar ni esperar a que Meilisearch indexe,
 * que es de donde salen los ~10 s/test de la batería funcional. Aquí una captura son
 * segundos.
 *
 * ── LO QUE SE REUSA TAL CUAL ──────────────────────────────────────────────────────────
 *
 * `globalSetup` y `globalTeardown` son LOS MISMOS ficheros de `e2e/`: migraciones,
 * siembra idempotente, las seis cuentas y el `storageState` por rol ya están resueltos
 * ahí, y duplicarlos sería crear una segunda verdad sobre cómo se prepara el entorno.
 * Las specs importan el fixture de auth de `e2e/fixtures/auth.ts` por lo mismo.
 */

const apiDir = path.join(__dirname, '..', 'api');
const testEnv =
  dotenvParse({ path: path.join(apiDir, '.env.test'), processEnv: {} }).parsed ?? {};

export default defineConfig({
  testDir: './e2e-snapshots',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',

  // Mismo motivo que en la batería funcional: una sola base, un índice de Meili y una
  // db de Redis compartidos. Aquí además el orden importa poco, pero paralelizar no
  // aportaría nada — el coste de esta batería es la navegación, no la CPU.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,

  /**
   * CERO REINTENTOS, y al revés que la batería funcional (que usa uno a propósito).
   *
   * Allí el reintento SEPARA información: lo que pasa al segundo intento sale como
   * `flaky` y lo que falla las dos veces es real. Aquí haría lo contrario: una captura
   * que sólo coincide a veces es una captura INESTABLE, y esconderla tras un reintento
   * enseña a ignorar el rojo — que es la forma en que las baterías visuales se mueren.
   * Si algo parpadea, se arregla la fuente de ruido (ver `preparar()`), no el contador.
   */
  retries: 0,

  reporter: 'html',
  timeout: process.env.CI ? 90_000 : 60_000,

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      /**
       * `animations: 'disabled'` congela animaciones y transiciones CSS y las lleva a su
       * estado final antes de disparar. Es la primera de las dos defensas contra el
       * movimiento; la otra es `prefers-reduced-motion`, que `preparar()` fuerza y que
       * además es el camino que el propio CSS del repo ya respeta (la rotación del hero
       * y el sprite del póster degradan a un estado completo).
       */
      animations: 'disabled',
      caret: 'hide',
      /**
       * `scale: 'css'` fotografía en píxeles CSS y no en píxeles del dispositivo: hace la
       * captura independiente del `devicePixelRatio` del runner.
       */
      scale: 'css',
      /**
       * Tolerancia PEQUEÑA PERO NO CERO. El antialiasing del texto varía lo justo entre
       * ejecuciones como para que un cero absoluto produzca rojos que no significan nada.
       * 0,2 % de los píxeles es holgado para eso y sigue siendo mucho más estrecho que
       * cualquier cambio real de color, espaciado o tipografía, que mueven porcentajes
       * enteros.
       */
      maxDiffPixelRatio: 0.002,
    },
  },

  /**
   * Las capturas se nombran por proyecto (`escritorio`/`movil`) y por plataforma. Lo
   * segundo NO es decorativo: una captura hecha en Windows y otra en el runner de Linux
   * NUNCA coinciden —distinto rasterizador de fuentes—, y mezclarlas sin distinguirlas
   * produciría rojos permanentes e inexplicables. Cada plataforma tiene su baseline.
   */
  snapshotPathTemplate: '{testDir}/__capturas__/{projectName}/{arg}-{platform}{ext}',

  projects: [
    {
      name: 'escritorio',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } },
    },
    {
      /**
       * MÓVIL POR VIEWPORT, NO POR `devices['Pixel 5']`, y es deliberado.
       *
       * Emular un dispositivo táctil cambia `hover` y `pointer`, y este repo TIENE CSS
       * que depende de eso: el sprite del póster animado vive dentro de
       * `@media (hover: hover) and (pointer: fine)` justamente para que el móvil no lo
       * pague. Con emulación completa la captura móvil probaría una rama distinta del
       * CSS sin que nadie lo hubiera decidido.
       *
       * Redimensionar el viewport es además lo que ya hacen las seis specs funcionales
       * que prueban el responsive (`nav-backoffice`, `shell-cuenta`, `logos-marca`…), así
       * que esto es el mismo criterio y no uno nuevo.
       */
      name: 'movil',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 667 } },
    },
  ],

  // Idénticos a los de `playwright.config.ts`, y por los mismos motivos documentados
  // allí (el backend sin `--watch` en CI; el front en `next start` por el vigilante de
  // memoria de `next dev`). Si uno cambia, cambian los dos.
  webServer: [
    {
      command: process.env.CI
        ? 'pnpm --filter @marketplace/api exec nest start'
        : 'pnpm --filter @marketplace/api dev',
      url: 'http://localhost:3001/api/categories',
      reuseExistingServer: !process.env.CI,
      /**
       * 300 s Y NO LOS 120 DE `playwright.config.ts`, con la cicatriz medida detrás:
       * la primera vuelta de este job en CI murió con
       * `Timed out waiting 120000ms from config.webServer` — sin una sola captura
       * tomada, que es lo que despistó al principio (parecía un problema de imágenes
       * y era de arranque).
       *
       * `nest start` COMPILA la API entera antes de servir. En el job `e2e` eso cabe
       * en 120 s porque llega con el runner caliente: antes de Playwright ya han
       * corrido dos baterías de Jest sobre el mismo árbol. Aquí Playwright es lo
       * primero que toca TypeScript, y en frío no llega.
       *
       * Se sube el plazo en vez de añadir un paso de compilación al job porque
       * `pnpm --filter @marketplace/api start` está roto por otros motivos ya
       * documentados (el entry real queda en `dist/src/main.js` y multer es una
       * dependencia fantasma que sólo `nest start` resuelve). Sigue siendo un límite
       * finito: si un día el arranque tarda cinco minutos, eso es un problema y este
       * job debe decirlo.
       */
      timeout: 300_000,
      env: { ...testEnv, ...process.env, PORT: '3001' },
    },
    {
      /**
       * SIEMPRE PRODUCCIÓN, TAMBIÉN EN LOCAL — y aquí esta batería SÍ se desvía de
       * `playwright.config.ts`, que en local usa `next dev`.
       *
       * El motivo es una cicatriz: los primeros baselines se tomaron con `next dev` y
       * en CI fallaron 21 capturas. La causa no era ningún cambio de estilo, era que
       * **`next dev` pinta el indicador de desarrollo de Next y `next start` no**. Un
       * círculo flotante de unos 900 píxeles que existe en un modo y no en el otro
       * convierte cualquier baseline de desarrollo en incomparable con producción.
       *
       * Se resuelve fotografiando SIEMPRE lo mismo que se despliega, en vez de apagar
       * el indicador: la batería visual existe para vigilar lo que ve la gente, y lo
       * que ve la gente es el build de producción. La otra vía —`devIndicators: false`
       * en next.config— tocaría la configuración de la aplicación para acomodar a una
       * herramienta de pruebas, y dejaría la puerta abierta a la siguiente diferencia
       * entre modos que aparezca.
       *
       * El precio es el `build` de abajo: en local esta batería tarda un par de minutos
       * más en arrancar. Es un coste que se paga a propósito y una sola vez por corrida.
       * En CI el build ya lo hace un paso propio del job —hace falta que los
       * `NEXT_PUBLIC_*` se horneen con el entorno del job—, así que aquí sólo se arranca.
       */
      command: process.env.CI
        ? 'pnpm --filter @marketplace/web start'
        : 'pnpm --filter @marketplace/web build && pnpm --filter @marketplace/web start',
      url: 'http://localhost:3000',
      reuseExistingServer: !process.env.CI,
      // El build cabe dentro: 120 s no bastaban con él delante.
      timeout: 300_000,
    },
  ],
});
