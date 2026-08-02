import { expect, type Page } from '@playwright/test';

/**
 * B2 — el wizard de publicar/editar tiene un paso "Etiquetas" ENTRE "Atributos" y
 * "Ubicación":
 *
 *   Categoría → Fotos → Datos → Atributos → ETIQUETAS → Ubicación → Publicar
 *
 * Los specs se escribieron antes de que ese paso existiera: hacían "Siguiente"
 * tras Atributos y esperaban directamente el heading "Ubicación". Con el CI
 * cancelándose por timeout, el drift se sedimentó sin que nadie lo viera.
 *
 * REGLA DE DESAPARICIÓN (B2, ver `resolveActiveSteps` en PublicarWizard.tsx): el
 * paso solo EXISTE si la categoría tiene tags efectivos. En el seed de test,
 * `coches` los tiene (hereda `garantia` y `envio-incluido` de `vehiculos`, más su
 * propio `unico-dueno`); `moviles` no tiene ninguno. Por eso unos specs fallaban y
 * otros no. Este helper mira si el paso está y lo cruza SOLO si está, así que
 * puede llamarse desde cualquier spec sin saber qué categoría usa.
 *
 * Los tags son OPCIONALES: `validateStep('tags', …)` solo bloquea si se pasa del
 * tope, nunca por no marcar ninguno. Así que se cruza pulsando "Siguiente" sin
 * seleccionar nada — el anuncio queda igual que antes de que el paso existiera, y
 * lo que cada test verifica no cambia.
 *
 * Se llama JUSTO DESPUÉS del "Siguiente" que sale de Atributos y ANTES de esperar
 * el heading "Ubicación". La aserción de "Ubicación" del llamante se mantiene tal
 * cual: este helper no la sustituye, solo se asegura de que se llegue hasta ahí.
 */
export async function cruzarPasoEtiquetas(page: Page): Promise<void> {
  const etiquetas = page.getByRole('heading', { name: 'Etiquetas' });
  const ubicacion = page.getByRole('heading', { name: 'Ubicación' });

  // Tras salir de Atributos el wizard enseña uno de los dos, según haya tags o no.
  // Esperar a "cualquiera de los dos" evita depender de la categoría del spec.
  await expect(etiquetas.or(ubicacion).first()).toBeVisible();

  if (await etiquetas.isVisible()) {
    await page.getByRole('button', { name: 'Siguiente' }).click();
  }
}
