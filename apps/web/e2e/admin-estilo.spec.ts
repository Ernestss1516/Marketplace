/**
 * E9 — LA PANTALLA DEL SISTEMA DE ESTILO, EN PANTALLA.
 *
 * ── REPARTO CON LAS OTRAS DOS BATERÍAS ───────────────────────────────────────────────
 *
 * La validación de contraste, la derivación de la paleta y la auditoría se comprueban
 * donde viven: `estilo.spec.ts` y `contraste-modelos.spec.ts`, en el backend. El reparto
 * del 422 entre los cuatro campos es una función pura y se prueba valor a valor en
 * `estilo-admin.test.ts`. Aquí se comprueba lo que sólo existe cuando las tres piezas se
 * juntan en un navegador:
 *
 *  · que a la pantalla SE LLEGA desde el backoffice, y sólo un ADMIN;
 *  · que el 422 de contraste aparece **junto al color culpable, con el ratio medido** —
 *    la mutación que este fichero existe para matar es enseñarlo como toast, que deja al
 *    admin sin saber cuál de los cuatro colores corregir;
 *  · que NO hay un quinto mando para el color de la letra (decisión #2 de E4a): el que no
 *    exista es lo que garantiza que nadie rompa la accesibilidad eligiéndolo.
 *
 * ── POR QUÉ ESTE FICHERO DEJA LA INSTANCIA COMO LA ENCONTRÓ ─────────────────────────
 *
 * Guardar aquí repinta las 81 pantallas de la plataforma, y la batería de capturas
 * fotografía el Modelo 0. Un test que se dejara un tema puesto teñiría de rojo una barrera
 * que no tiene nada que ver con él —y el diagnóstico sería carísimo—, así que el que
 * guarda termina SIEMPRE en «volver a fábrica».
 */
import { test, expect } from './fixtures/auth';

test.describe('Sistema de estilo — /admin/estilo', () => {
  test('B1 — se llega desde el nav del backoffice, y la ruta ya no es un 404', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin');

    // La entrada existe en el nav, que es lo que hace la pantalla ALCANZABLE. Hasta E9 el
    // backend estaba entero y no había por dónde entrar.
    const nav = page.getByTestId('admin-nav');
    const enlace = nav.getByRole('link', { name: 'Estilo', exact: true });
    await expect(enlace).toBeVisible();

    await enlace.click();
    await page.waitForURL(/\/admin\/estilo$/, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Estilo', exact: true })).toBeVisible();
  });

  test('B1 — un MODERATOR ni la ve ni la abre', async ({ moderatorContext }) => {
    const page = await moderatorContext.newPage();
    await page.goto('/admin');

    await expect(
      page.getByTestId('admin-nav').getByRole('link', { name: 'Estilo', exact: true }),
    ).toHaveCount(0);

    // Y el nav no es la puerta: la ruta escrita a mano tampoco entra. El piso real lo
    // ponen el middleware (derivado del mismo mapa) y el `@MinRole(ADMIN)` del controlador.
    // Mismo molde de aserción que las tres de `admin-roles.spec.ts` para las rutas de
    // ADMIN: se espera a salir de `/admin`, en vez de mirar la URL una sola vez.
    await page.goto('/admin/estilo');
    await page.waitForURL((url) => !url.pathname.startsWith('/admin'), { timeout: 8_000 });
    expect(page.url()).not.toContain('/admin');
  });

  test('B2 — el catálogo, la versión y los cuatro colores se pintan desde el GET', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/estilo');

    // El modelo de fábrica del catálogo, con su descripción.
    await expect(page.getByTestId('selector-modelo')).toHaveValue('modelo-0');
    await expect(page.getByTestId('selector-version')).toHaveValue('1');
    await expect(page.getByTestId('descripcion-modelo')).toBeVisible();

    // Los CUATRO, y con el valor guardado dentro — no vacíos.
    for (const ranura of ['primary', 'secondary', 'accent', 'neutral']) {
      await expect(page.getByTestId(`campo-color-${ranura}`)).toBeVisible();
      await expect(page.getByTestId(`valor-${ranura}`)).not.toHaveValue('');
    }

    // La previa, que es lo que hace la pantalla honesta (§11).
    await expect(page.getByTestId('previa-lienzo')).toBeVisible();
  });

  test('B5 — NO hay mando para el color de la letra (decisión #2 de E4a)', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/estilo');

    // Cuatro campos de color y ninguno más. El `-foreground` lo elige `mejorTextoSobre`
    // midiendo contraste: que no exista el control es más fuerte que validarlo.
    await expect(page.locator('[data-testid^="campo-color-"]')).toHaveCount(4);
    for (const prohibido of [
      'primary-foreground',
      'secondary-foreground',
      'accent-foreground',
      'foreground',
    ]) {
      await expect(page.getByTestId(`campo-color-${prohibido}`)).toHaveCount(0);
    }
  });

  test('B4 — el 422 de contraste sale EN EL CAMPO del color culpable, con el ratio', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/estilo');

    // UN PRINCIPAL DEMASIADO CLARO (slate-200). Medido con el motor de verdad antes de
    // escribir el test, porque la primera elección —un gris medio— NO servía: contra el
    // 50 % de luminosidad `mejorTextoSobre` encuentra una letra oscura que da 5,3:1, así
    // que el guardado pasaba y no había 422 que enseñar. Ésa es justamente la decisión #2
    // funcionando: la letra la elige la máquina y casi siempre acierta.
    //
    // Lo que NO puede arreglar sola es el anillo de foco, que es el principal literal
    // sobre el lienzo: a 1,23:1 contra el blanco no llega a los 3:1 de interfaz.
    await page.getByTestId('valor-primary').fill('#e2e8f0');
    await page.getByTestId('guardar-estilo').click();

    // AQUÍ ESTÁ LA BARRERA: el aviso cuelga del campo `primary`, no de un toast suelto.
    //
    // Y es el caso que hace falta pinzar, no uno cualquiera: la frase del backend dice
    // «sobre el fondo», así que un mapeo escrito a ojo lo habría mandado al campo del
    // NEUTRO —donde el admin podría tocar el gris eternamente sin arreglar nada—. El
    // color que mueve este ratio es el principal, porque `tokens.ring = colores.primary`.
    const error = page.getByTestId('error-contraste-primary');
    await expect(error).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('error-contraste-neutral')).toHaveCount(0);

    // Y lleva el número medido dentro, que es lo que convierte «no cumple» en algo
    // accionable: el admin ve cuánto le falta y hacia dónde mover el color.
    await expect(error).toContainText('anillo de foco sobre el fondo');
    await expect(error).toContainText(/\d+,\d+:1/);
    await expect(error).toContainText('necesita 3:1');

    // El campo queda marcado como inválido para quien navega con lector de pantalla.
    await expect(page.getByTestId('valor-primary')).toHaveAttribute('aria-invalid', 'true');

    // Y NADA se guardó: el servidor valida ANTES de escribir, así que la plataforma sigue
    // con su tema. Se comprueba recargando, que es lo que ve el siguiente que entre — y
    // contra el valor de fábrica, no contra «distinto de lo que escribí»: así el test
    // falla también si se guardara cualquier OTRA cosa.
    await page.reload();
    await expect(page.getByTestId('valor-primary')).toHaveValue('221.2 83.2% 53.3%');
  });

  test('B3 — guardar aplica el tema, y «volver a fábrica» lo deshace', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/estilo');

    try {
      // Un azul más oscuro que el de fábrica: cumple AA de sobra con letra clara, así que
      // el guardado tiene que pasar. Lo que se prueba es el camino completo, no el color.
      await page.getByTestId('valor-primary').fill('#1d4ed8');
      await expect(page.getByTestId('hay-cambios')).toBeVisible();

      await page.getByTestId('guardar-estilo').click();

      // Guardado: el botón se apaga porque el borrador YA es lo guardado, y el aviso de
      // cambios pendientes desaparece.
      await expect(page.getByTestId('hay-cambios')).toHaveCount(0, { timeout: 15_000 });
      await expect(page.getByTestId('guardar-estilo')).toBeDisabled();
      await expect(page.getByTestId('error-contraste-primary')).toHaveCount(0);

      // Y persiste: lo que se ve al recargar es lo que el servidor tiene, no estado local.
      // El valor exacto —no un «distinto del anterior»— porque de paso pinza la
      // NORMALIZACIÓN: el hexadecimal que manda el selector se guarda como triplete, y esa
      // conversión ocurre una sola vez, en el servidor.
      await page.reload();
      await expect(page.getByTestId('valor-primary')).toHaveValue('224.3 76.3% 48%');
    } finally {
      // VOLVER A FÁBRICA — y va en `finally` a propósito: si una aserción de arriba falla,
      // la instancia NO se queda con un tema puesto que teñiría la batería de capturas.
      await page.getByTestId('volver-a-fabrica').click();
      await page.getByTestId('confirmar-volver-a-fabrica').click();

      // El DELETE borra la fila y la pantalla se repuebla con el estado de fábrica, que es
      // el azul del Modelo 0 — el mismo con el que se fotografía la plataforma.
      await expect(page.getByTestId('valor-primary')).toHaveValue('221.2 83.2% 53.3%', {
        timeout: 15_000,
      });
      await expect(page.getByTestId('selector-modelo')).toHaveValue('modelo-0');
    }
  });

  test('B6 — /admin/ilustraciones (E7) sigue en pie: son dos pantallas, no una', async ({
    adminContext,
  }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/ilustraciones');

    await expect(page.getByRole('heading', { name: 'Ilustraciones', exact: true })).toBeVisible();
    // Y las dos conviven en el mismo grupo del nav, que es lo que cierra el sistema de
    // estilo: modelo y colores aquí, imágenes allí.
    await expect(
      page.getByTestId('admin-nav').getByRole('link', { name: 'Estilo', exact: true }),
    ).toBeVisible();
  });
});
