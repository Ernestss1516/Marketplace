/**
 * AJUSTES RÁFAGA B — EL PANEL DE INSTANCIA, EN PANTALLA.
 *
 * ── REPARTO CON LA BATERÍA DE BACKEND ─────────────────────────────────────────────────────
 *
 * Que la respuesta NO lleve un secreto se comprueba a nivel HTTP en
 * `apps/api/test/instance-info.e2e-spec.ts`, que es donde se puede leer el entorno real y
 * buscar cada valor prohibido dentro del JSON. Aquí se comprueba lo que sólo existe en la
 * pantalla, y que es justo el motivo de esta página:
 *
 *  · que las ALARMAS SE VEAN — ámbar y arriba, no un gris al final. Una alarma que hay que
 *    buscar no es una alarma, y estas dos (facturación de pega, cobros de prueba) no dan
 *    ningún error por su cuenta: nadie las descubre hasta que duele.
 *  · que la página sea de CONSULTA: ni un control editable. No es Ajustes.
 *  · que lo que no existe se DIGA — «no aplica», «no disponible»— en vez de dejar un hueco
 *    que se lee como un dato que no se cargó.
 */
import { test, expect } from './fixtures/auth';

test.describe('Panel de instancia — /admin/instancia', () => {
  test('los cuatro bloques están, con los datos que difieren entre despliegues', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/instancia');

    await expect(page.getByRole('heading', { name: 'Instancia', exact: true })).toBeVisible();
    for (const bloque of ['Identidad', 'Correos', 'Proveedores', 'Configuración con efecto']) {
      await expect(page.getByRole('heading', { name: bloque })).toBeVisible();
    }

    // Los de máxima prioridad: los que difieren entre instancias y confirmarlos evita el
    // incidente. Se comprueba que la ETIQUETA está; el valor depende del entorno.
    const contenido = page.getByTestId('instancia-contenido');
    for (const etiqueta of [
      'Dominio público',
      'Entorno',
      'Remitente',
      'Buzón de soporte',
      'Facturación',
      'Emisor fiscal',
      'Almacenamiento de imágenes',
      'Zona horaria',
    ]) {
      await expect(contenido.getByText(etiqueta, { exact: true })).toBeVisible();
    }
  });

  test('LA ALARMA SE VE: facturación de pega y cobros de prueba, en ámbar y arriba', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/instancia');

    const avisos = page.getByTestId('aviso-instancia');
    // En el entorno de test el proveedor es `stub` y Redsys va en `test`, así que las dos
    // alarmas tienen que estar. Si algún día el entorno cambiara, este spec lo diría.
    await expect(avisos.first()).toBeVisible();
    await expect(
      page.getByText(/NO son fiscalmente válidas/i),
    ).toBeVisible();
    await expect(page.getByText(/van al TPV de PRUEBAS/i)).toBeVisible();

    // ÁMBAR DE VERDAD, no un texto gris: el aviso lleva su fondo y su borde. Es la
    // diferencia entre una alarma y una nota al pie.
    await expect(avisos.first()).toHaveClass(/border-amber-400/);
    await expect(avisos.first()).toHaveClass(/bg-amber-50/);
  });

  test('es de CONSULTA: no hay ni un control editable', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/instancia');
    await expect(page.getByRole('heading', { name: 'Identidad' })).toBeVisible();

    // Ni inputs, ni selects, ni textareas, ni un botón de guardar. Lo que se cambia se
    // cambia en Ajustes, y esta página enlaza allí en vez de duplicar el control.
    await expect(page.locator('input')).toHaveCount(0);
    await expect(page.locator('select')).toHaveCount(0);
    await expect(page.locator('textarea')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /guardar/i })).toHaveCount(0);
    await expect(
      page.getByRole('paragraph').filter({ hasText: 'pantalla de' }).getByRole('link', { name: 'Ajustes' }),
    ).toBeVisible();
  });

  test('lo que no existe se dice: «no aplica» y «no disponible»', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/instancia');

    // No hay correo de contacto público, no hay tipo de IVA global, y nadie inyecta GIT_SHA
    // todavía. Las tres se dicen con esas palabras en vez de con un hueco o un valor creíble.
    await expect(page.getByText('No aplica')).toBeVisible();
    await expect(page.getByText('Por línea de factura')).toBeVisible();
    await expect(page.getByText('Commit desplegado', { exact: true })).toBeVisible();
    await expect(page.getByText(/todavía no exporta GIT_SHA/i)).toBeVisible();
  });

  test('de las credenciales, sólo el hecho: nunca aparece una clave', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/instancia');
    await expect(page.getByRole('heading', { name: 'Proveedores' })).toBeVisible();

    // «Configurado» / «Sin configurar» y nada más. El texto de la página no puede contener
    // nada con forma de secreto — los prefijos de clave de las pasarelas y de Resend.
    const texto = (await page.locator('body').textContent()) ?? '';
    for (const prefijo of ['sk_test_', 'sk_live_', 'whsec_', 're_']) {
      expect(texto).not.toContain(prefijo);
    }
    await expect(page.getByText('Configurado').first()).toBeVisible();
  });

  test('un MODERATOR no llega: la sección es ADMIN', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin/instancia');

    // El middleware del backoffice es fail-closed por sección: sin piso ADMIN no se entra, y
    // el usuario acaba fuera de la ruta en vez de viendo un panel a medias.
    await expect(page).not.toHaveURL(/\/admin\/instancia$/);
  });
});
