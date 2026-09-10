/**
 * E10 — NINGUNA PANTALLA DE STAFF PINTA TEXTO DEL SERVIDOR.
 *
 * ── QUÉ VIGILA, Y POR QUÉ LA MITAD QUE IMPORTA ES LA SEGUNDA ────────────────────────
 *
 * Comprobar que una pantalla que funciona no enseña secretos es lo fácil: no los enseña
 * porque no los pide. La vía real era otra —**la rama de error**—, y por eso cada pantalla
 * se mira dos veces:
 *
 *  1. **cargando bien**, que es la comprobación que ya existía para `/admin/instancia`;
 *  2. **con el servidor devolviendo un error que lleva un secreto dentro del `message`**,
 *     que es lo que el molde viejo (`Error ${statusCode}: ${message}`) habría pintado tal
 *     cual en el DOM, y lo que `mensajeDeErrorAdmin` existe para impedir.
 *
 * El error se fabrica interceptando la petición con `page.route`, así que no depende de que
 * el backend falle solo — es determinista, y comprueba EL MOLDE, que es lo que se arregló.
 *
 * ── POR QUÉ ESTAS CUATRO ────────────────────────────────────────────────────────────
 *
 * El molde estaba en 36 ficheros y fotografiar los 36 sería pagar mucho CI por la misma
 * afirmación. Estas cuatro son las de «configuración de la instancia» —las únicas cuyos
 * endpoints tocan proveedores y credenciales—, así que son donde un secreto tendría de
 * verdad por dónde entrar. El resto lo cubre el test unitario de `mensajeDeErrorAdmin`,
 * que prueba la función por la que ahora pasan las 54 llamadas.
 */
import { test, expect } from './fixtures/auth';
import {
  exigirQueNoHayaSecretos,
  SECRETO_DE_MENTIRA,
} from './helpers/secretos';

/**
 * Las cuatro pantallas, con la llamada que hay que romper para llegar a su rama de error.
 *
 * ⚠ EL PATRÓN LLEVA `/api/` DELANTE, Y NO ES DECORATIVO. La primera versión interceptaba
 * `**` + la ruta a secas, y para dos de las cuatro **eso casa también con la navegación de
 * la propia página**: `/admin/estilo` es a la vez el path del navegador (puerto 3000) y el
 * de su endpoint (puerto 3001). Playwright cumplía la navegación con el JSON de mentira, el
 * navegador lo pintaba como texto plano, y el escáner encontraba el secreto —dentro de un
 * cuerpo que no era la pantalla, sino la respuesta cruda—.
 *
 * O sea: dos rojos que NO eran del producto. Se descubrió leyendo el volcado que guarda
 * `exigirQueNoHayaSecretos`, que para eso está: el cuerpo empezaba por `{"statusCode":500`
 * en vez de por el HTML de la pantalla, y eso lo dijo todo en un vistazo.
 */
const PANTALLAS: readonly {
  nombre: string;
  ruta: string;
  /** El patrón de la petición A LA API que pinta la pantalla. */
  peticion: string;
  /** Un trozo del encabezado, para saber que hemos llegado. */
  titulo: string;
}[] = [
  { nombre: 'instancia', ruta: '/admin/instancia', peticion: '**/api/admin/instance-info**', titulo: 'Instancia' },
  { nombre: 'marca', ruta: '/admin/marca', peticion: '**/api/branding**', titulo: 'Marca' },
  { nombre: 'ilustraciones', ruta: '/admin/ilustraciones', peticion: '**/api/admin/ilustraciones**', titulo: 'Ilustraciones' },
  { nombre: 'estilo', ruta: '/admin/estilo', peticion: '**/api/admin/estilo**', titulo: 'Estilo' },
];

test.describe('Fuga de secretos — las pantallas de configuración de la instancia', () => {
  for (const { nombre, ruta, titulo } of PANTALLAS) {
    test(`${nombre}: cargando bien, no hay nada con forma de secreto`, async ({ adminContext }) => {
      const page = await adminContext.newPage();
      await page.goto(ruta);
      await expect(page.getByRole('heading', { name: titulo, exact: true })).toBeVisible({
        timeout: 15_000,
      });

      await exigirQueNoHayaSecretos(page, `${nombre} (carga normal)`);
      await page.close();
    });
  }

  for (const { nombre, ruta, peticion, titulo } of PANTALLAS) {
    test(`${nombre}: EL SERVIDOR FALLA CON UN SECRETO DENTRO y la pantalla no lo pinta`, async ({
      adminContext,
    }) => {
      const page = await adminContext.newPage();

      // El 500 que el molde viejo habría pintado entero. Lleva la forma de una clave de
      // Resend dentro del `message` — exactamente lo que pasaría si un `throw` del backend
      // interpolara un valor de configuración.
      await page.route(peticion, (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({
            statusCode: 500,
            message: `Fallo al hablar con el proveedor usando la clave ${SECRETO_DE_MENTIRA}`,
            error: 'Internal Server Error',
          }),
        }),
      );

      await page.goto(ruta);

      // ⚠ PRIMERO: QUE ESTO SIGA SIENDO LA PANTALLA. Las cuatro conservan su encabezado en
      // la rama de error, así que exigirlo es lo que garantiza que estamos escaneando el
      // HTML del backoffice y no —como pasó al escribir este test— la respuesta cruda de la
      // API servida directamente al navegador. Sin esta línea, interceptar de más convierte
      // el test en un rojo que acusa al producto de algo que hizo el propio test.
      await expect(page.getByRole('heading', { name: titulo, exact: true })).toBeVisible({
        timeout: 15_000,
      });

      // Y que la pantalla haya REACCIONADO al error: si no, mediríamos una página a medio
      // cargar en vez de su rama de error.
      await expect(page.getByText(/Error|error/).first()).toBeVisible({ timeout: 15_000 });

      // LA BARRERA: el secreto NO está en ninguna parte del cuerpo.
      await exigirQueNoHayaSecretos(page, `${nombre} (rama de error)`);

      // Y la comprobación complementaria, que es la que mata la mutación: el texto del
      // servidor tampoco está. Si alguien devolviera el molde crudo, esto caería aunque el
      // mensaje de ese día no llevara nada con forma de clave.
      const cuerpo = (await page.locator('body').textContent()) ?? '';
      expect(cuerpo).not.toContain('Fallo al hablar con el proveedor');
      expect(cuerpo).not.toContain('Internal Server Error');

      // Lo que SÍ tiene que ver el operador: que ha fallado el servidor, y el código.
      expect(cuerpo).toContain('500');

      await page.close();
    });
  }
});
