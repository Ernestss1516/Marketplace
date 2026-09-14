import type { Page } from '@playwright/test';

/**
 * ══ BUSCADOR · BQ-A — LOS DOS GESTOS DEL BUSCADOR DE PORTADA, EN UN SOLO SITIO ═══════
 *
 * ── POR QUÉ EXISTE, Y POR QUÉ ENTRA ANTES QUE EL CAMBIO QUE LO NECESITA ─────────────
 *
 * Hoy los dos filtros de la portada son `<select>` nativos y elegir en ellos es una
 * línea: `page.getByLabel('Categoría').selectOption('coches')`. En BQ-B pasan a ser
 * diálogos filtrables (`docs/diseno-buscador.md` §2) y ese gesto pasa a ser tres —abrir,
 * filtrar, elegir—.
 *
 * Si las specs llamaran a `selectOption` directamente, BQ-B tendría que reescribir cada
 * llamada Y cambiar el aspecto a la vez. Con este envoltorio, **BQ-B sólo le cambia las
 * tripas a estas dos funciones** y ni una spec se toca. Es la regla de orden del
 * escaparate (§0.2) aplicada a un asidero de test: la barrera antes de repintar.
 *
 * **HOY NO HACE NADA NUEVO.** Por dentro es `selectOption`, o sea exactamente lo que las
 * specs hacían. BQ-A es de cambio visual nulo también aquí: si esto alterara el
 * comportamiento, no sería un envoltorio, sería el cambio adelantado.
 *
 * ── SE ELIGE POR EL NOMBRE VISIBLE, NO POR EL SLUG ──────────────────────────────────
 *
 * `selectOption('coches')` casa contra el `value` del `<option>`, que es el slug. **Un
 * diálogo no tiene `value`: tiene filas con texto**, así que el único asidero que sobrevive
 * a BQ-B es el nombre que el usuario lee. Las specs pasan a decir «Coches» en vez de
 * «coches», que además es lo que describe lo que hace un usuario.
 *
 * ⚠ UNA ARRUGA QUE BQ-B QUITA: para una categoría PADRE, el `<option>` de hoy se llama
 * «Todo en Vehículos» ([`SearchBar.tsx:175`](../../src/components/busqueda/SearchBar.tsx#L175)),
 * no «Vehículos», así que hoy habría que pasar ese literal entero. Ninguna spec elige un
 * padre todavía. En BQ-B el literal desaparece —la lista aplanada dice «Vehículos» y una
 * coletilla aparte dice cuántas subcategorías cuelgan (decisión 6 del diseño)— y la arruga
 * se va con él.
 *
 * ── EL `aria-label` ES EL CONTRATO, Y NO CAMBIA ─────────────────────────────────────
 *
 * `getByLabel('Categoría')` / `getByLabel('Provincia')` son a la vez la etiqueta accesible
 * del control y el asidero de los tests. **El disparador del diálogo conserva el mismo
 * `aria-label`** (§10.2 del diseño), así que el localizador sigue encontrando el control
 * después de BQ-B: lo único que cambia es la acción.
 */

/**
 * Elige una categoría en el buscador de la PORTADA (no el de `/busqueda`, que es
 * `CategorySelect` y además navega al cambiar).
 *
 * No espera a ninguna navegación a propósito: el buscador de portada **sólo escribe
 * estado**; quien navega es el submit o la elección de una etiqueta.
 */
export async function elegirCategoria(page: Page, nombre: string): Promise<void> {
  await page.getByLabel('Categoría').selectOption({ label: nombre });
}

/**
 * Elige una provincia en el buscador de la portada.
 *
 * El nombre es el EXACTO de `lib/provincias.ts`, grafía cooficial incluida
 * (`Alicante/Alacant`, `Valencia/València`…): es el mismo string que viaja en
 * `?province=` y contra el que el backend filtra con un `=` exacto
 * (`search.service.ts`). Pasar aquí un nombre aproximado es el defecto que el diálogo de
 * BQ-B existe para hacer imposible, así que tampoco se le consiente al test.
 */
export async function elegirProvincia(page: Page, nombre: string): Promise<void> {
  await page.getByLabel('Provincia').selectOption({ label: nombre });
}
