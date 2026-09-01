// MODERACIÓN M4 — Playwright: marcar a un vendedor para revisión previa desde
// /admin/usuarios.
//
// Lo que cubre y el backend no puede cubrir: que el interruptor EXISTA en el
// backoffice y que lo que se ve después de recargar sea lo que se guardó. La
// consecuencia —que los anuncios de ese vendedor vayan a PENDING_REVIEW— ya está
// probada en la batería de la API; aquí sólo se comprueba el camino de la mano
// del administrador hasta el dato.
//
// Idempotente: si un run anterior dejó al usuario marcado, lo desmarca antes de
// empezar, y termina siempre desmarcándolo.

import { test, expect } from './fixtures/auth';

const TARGET = 'Review Target E2E';

test.describe('Marcar un vendedor para revisión previa', () => {
  test('ADMIN marca y desmarca; la marca sobrevive a recargar', async ({ adminContext }) => {
    const page = await adminContext.newPage();
    await page.goto('/admin/usuarios', { waitUntil: 'domcontentloaded' });

    const buscar = page.getByPlaceholder(/buscar por nombre o email/i);
    await expect(buscar).toBeVisible({ timeout: 15_000 });
    await buscar.fill(TARGET);
    await page.getByRole('button', { name: 'Buscar' }).click();

    const fila = page.locator('tr', { hasText: TARGET });
    await expect(fila).toBeVisible({ timeout: 10_000 });

    // DOS COLUMNAS, NO UNA DENTRO DE OTRA. La independencia semántica ya la afirma
    // la batería de la API; lo que sólo se puede ver aquí es que se leen A LA VEZ,
    // que es lo que evita entender «de confianza» como «exento de revisión». Si
    // alguien colapsara «Revisión» dentro de «Confianza», el resto del test
    // seguiría en verde y esta línea no.
    await expect(page.getByRole('columnheader', { name: 'Confianza' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Revisión' })).toBeVisible();

    const marca = fila.getByText('En revisión');
    const boton = fila.getByRole('button', { name: /^(No revisar|Revisar)$/ });

    if (await marca.isVisible()) {
      await boton.click();
      await expect(marca).not.toBeVisible({ timeout: 5_000 });
    }

    // Marcar.
    await boton.click();
    await expect(marca).toBeVisible({ timeout: 5_000 });

    // Recargar: si sólo hubiera cambiado el estado de React y no la base, aquí se
    // vería. Es la mitad que hace que este test valga la pena.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await buscar.fill(TARGET);
    await page.getByRole('button', { name: 'Buscar' }).click();
    await expect(fila.getByText('En revisión')).toBeVisible({ timeout: 10_000 });

    // La confianza es OTRA columna: marcar revisión no toca la insignia. Los dos
    // ejes se ven a la vez justo para que nadie lea «de confianza» como «exento».
    await expect(fila.getByText('De confianza')).not.toBeVisible();

    // Desmarcar — y dejar el estado limpio.
    await fila.getByRole('button', { name: 'No revisar' }).click();
    await expect(fila.getByText('En revisión')).not.toBeVisible({ timeout: 5_000 });
  });
});
