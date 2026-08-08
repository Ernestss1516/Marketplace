import { expect, type Page } from '@playwright/test';

/**
 * UXV.4 — cómo se llega ahora a destacar y a subir un anuncio.
 *
 * Antes había dos botones sueltos en la fila de la tarjeta (`btn-destacar`, `btn-bump`) y
 * las pruebas los clicaban directamente. Con la fusión (TARJETA-D2) hay UN control,
 * `btn-promocionar`, y los dos productos viven dentro del diálogo. Estos helpers
 * concentran ese camino para que las pruebas sigan diciendo lo que quieren decir
 * —«destacar hace X»— sin repetir la navegación en veinte sitios.
 *
 * OJO con el bump gratis: cuando el usuario tiene cuota Pro o saldo, el control primario
 * NO abre el diálogo, lo ejecuta directo (esa es la mitad de TARJETA-D2 que se conservó).
 * Para esos casos está `bumpDirecto`.
 */

/**
 * ¿El control primario es el botón PARTIDO? Lo es cuando el usuario tiene un bump gratis
 * disponible: ahí el botón principal EJECUTA el bump y el diálogo vive detrás del `▾`.
 * Clicar el primario en ese caso bumpearía en vez de abrir nada — que es justo lo que
 * TARJETA-D2 quería conservar, y por lo que estos helpers tienen que distinguirlo.
 */
async function tieneAtajoGratis(page: Page): Promise<boolean> {
  return (await page.getByTestId('btn-promocionar-mas').first().count()) > 0;
}

/** Abre el diálogo de promoción desde la primera tarjeta (o desde la ficha). */
export async function abrirPromocionar(page: Page): Promise<void> {
  if (await tieneAtajoGratis(page)) {
    await page.getByTestId('btn-promocionar-mas').first().click();
    await page.getByRole('menuitem', { name: /ver todas las opciones/i }).click();
  } else {
    await page.getByTestId('btn-promocionar').first().click();
  }
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
}

/** Abre el diálogo y elige el producto «Destacar»: el punto donde empezaban las pruebas viejas. */
export async function abrirDestacar(page: Page): Promise<void> {
  if (await tieneAtajoGratis(page)) {
    // Con atajo de bump gratis, «Destacar anuncio…» está en el desplegable y ya abre el
    // diálogo con ese producto elegido: no hay radio que pulsar después.
    await page.getByTestId('btn-promocionar-mas').first().click();
    await page.getByRole('menuitem', { name: /destacar anuncio/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 });
  } else {
    await abrirPromocionar(page);
    await page.getByRole('dialog').getByLabel(/^Destacar/).first().click();
  }
  // La configuración del destacado (cuota/duración/pago) solo aparece con el producto
  // elegido: esperarla evita que el resto de la prueba corra contra el bloque del bump.
  await expect(
    page.getByRole('dialog').getByText(/Duración|Cómo destacar/).first(),
  ).toBeVisible({ timeout: 15_000 });
}

/** Abre el diálogo, elige «Subir al inicio» y confirma. Para cuando el bump CUESTA. */
export async function subirDesdeDialogo(page: Page): Promise<void> {
  await abrirPromocionar(page);
  await page.getByRole('dialog').getByLabel(/Subir al inicio/).first().click();
  await page.getByTestId('promo-confirmar-bump').click();
}

/**
 * El bump a UN CLIC: el control primario lo ejecuta sin abrir nada cuando es gratis.
 * Si no lo fuera, esto abriría el diálogo y la prueba fallaría — que es lo correcto,
 * porque estaría midiendo otra cosa.
 */
export async function bumpDirecto(page: Page): Promise<void> {
  const boton = page.getByTestId('btn-promocionar').first();
  await expect(boton).toHaveText(/subir gratis/i, { timeout: 15_000 });
  await boton.click();
}
