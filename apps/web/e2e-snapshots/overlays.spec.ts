import { test, expect } from '../e2e/fixtures/auth';
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
