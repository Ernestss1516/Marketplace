import type { PriceUnit } from '@/types';

/**
 * Lógica PURA de selección de formato de precio (RP.3), compartida por el
 * servidor y el cliente.
 *
 * POR QUÉ VIVE AQUÍ Y NO EN `steps/StepDatos.tsx`, donde nació:
 * ese módulo lleva `'use client'` porque además pinta el formulario (Radix
 * Select, etc.). Esta función no necesita nada de eso —no usa hooks, ni estado,
 * ni API del navegador: solo mira si un valor está en una lista—, pero por vivir
 * en ese fichero quedaba marcada como función de CLIENTE. Y la página
 * `(account)/mis-anuncios/[id]/editar/page.tsx`, que es un Server Component, la
 * llamaba durante el render del servidor:
 *
 *   ⨯ Error: Attempted to call resolvePriceUnitSelection() from the server but
 *     resolvePriceUnitSelection is on the client.
 *
 * `next dev` no lo detecta (la frontera cliente/servidor es laxa en desarrollo);
 * `next start` sí → la página de editar anuncio CRASHEABA en producción, para
 * usuarios reales. Se descubrió al pasar el CI de Playwright a modo producción.
 *
 * La cura es que la lógica pura viva en un módulo SIN `'use client'`, importable
 * desde los dos lados. La función no era client-only: solo estaba en un fichero
 * que lo era.
 */

/**
 * Elige qué formato debe quedar seleccionado (RP.3). Preferencias, en orden:
 * el actual si la categoría lo permite (edición: no se cambia lo que el
 * vendedor ya eligió), ONE_TIME si está permitido, y si no el primero de la
 * lista. Nunca devuelve un formato fuera de `allowed` salvo que la lista venga
 * vacía, donde ONE_TIME es el mismo default que aplica el backend.
 *
 * Pura: el wizard la llama al elegir categoría y al montar la edición.
 */
export function resolvePriceUnitSelection(
  allowed: PriceUnit[],
  current?: PriceUnit,
): PriceUnit {
  if (current && allowed.includes(current)) return current;
  if (allowed.includes('ONE_TIME')) return 'ONE_TIME';
  return allowed[0] ?? 'ONE_TIME';
}
