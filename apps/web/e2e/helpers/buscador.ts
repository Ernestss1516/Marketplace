import { expect, type Page } from '@playwright/test';

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
 * ⚠ **BQ-B YA PASÓ, Y SE LE CAMBIARON LAS TRIPAS A ESTAS DOS FUNCIONES — A NADA MÁS.**
 * Donde había un `selectOption` hay ahora tres gestos: abrir, filtrar, elegir. Ni una spec
 * se tocó, que era exactamente para lo que este fichero entró una ráfaga antes.
 *
 * ── SE ELIGE POR EL NOMBRE VISIBLE, NO POR EL SLUG ──────────────────────────────────
 *
 * `selectOption('coches')` casa contra el `value` del `<option>`, que es el slug. **Un
 * diálogo no tiene `value`: tiene filas con texto**, así que el único asidero que sobrevive
 * a BQ-B es el nombre que el usuario lee. Las specs pasan a decir «Coches» en vez de
 * «coches», que además es lo que describe lo que hace un usuario.
 *
 * La arruga que BQ-A dejó anotada —que una categoría PADRE se llamaba «Todo en Vehículos»
 * y no «Vehículos»— **se fue con el `<select>`**: la lista aplanada dice «Vehículos» y la
 * cuenta de subcategorías va en una nota aparte (decisión 6 del diseño). Un padre se elige
 * ahora por su nombre, igual que una hoja.
 *
 * ── EL `aria-label` ES EL CONTRATO, Y NO CAMBIA ─────────────────────────────────────
 *
 * `getByLabel('Categoría')` / `getByLabel('Provincia')` son a la vez la etiqueta accesible
 * del control y el asidero de los tests. **El disparador del diálogo conserva el mismo
 * `aria-label`** (§10.2 del diseño), así que el localizador sigue encontrando el control
 * después de BQ-B: lo único que cambia es la acción.
 */

/**
 * Los tres gestos del diálogo: abrir, filtrar, elegir.
 *
 * **Se teclea el nombre antes de elegir en vez de buscar la fila en la lista entera**, y no
 * es para ir más rápido: es lo que prueba que el FILTRO funciona. Una versión que abriera
 * y pinchara sin escribir daría verde con el campo de texto roto.
 *
 * `first()` porque el filtro deja la coincidencia más ajustada arriba (startsWith primero,
 * desempate por longitud): tecleado el nombre completo, la primera fila ES la buscada.
 *
 * Se espera a que la capa se cierre antes de devolver el control. Sin eso, la acción
 * siguiente de la spec puede caer sobre el velo —que todavía intercepta clics— y fallar
 * con un timeout que no dice nada de lo que se estaba probando.
 */
export async function elegirEnDialogo(page: Page, campo: string, nombre: string): Promise<void> {
  await page.getByLabel(campo, { exact: false }).first().click();
  const dialogo = page.getByRole('dialog');
  await dialogo.getByRole('combobox').fill(nombre);
  await dialogo.getByRole('option', { name: nombre }).first().click();
  await expect(dialogo).toBeHidden();
}

/**
 * ⚠ BUSCADOR · BQ-E — Y AHORA HAY UN SEGUNDO CLIENTE, por eso esta función se exporta.
 *
 * Los tres gestos son LOS MISMOS en el panel de filtros de `/busqueda` y `/[categoria]`,
 * porque debajo hay el mismo molde. Lo único distinto es lo que pasa DESPUÉS de elegir:
 * allí se navega, así que quien llame desde esas rutas tiene que esperar a la URL. Eso se
 * queda fuera de aquí a propósito —a qué URL se llega depende de la spec—, y es la misma
 * frontera que el código respeta: el molde elige, el adaptador navega.
 */

/**
 * Elige una categoría en el buscador de la PORTADA (no el del panel de `/busqueda`, que
 * comparte molde pero navega al elegir).
 *
 * No espera a ninguna navegación a propósito: el buscador de portada **sólo escribe
 * estado**; quien navega es el submit o la elección de una etiqueta.
 */
export async function elegirCategoria(page: Page, nombre: string): Promise<void> {
  await elegirEnDialogo(page, 'Categoría', nombre);
}

/**
 * Elige una provincia. Sirve para el buscador de la portada Y para el panel de filtros de
 * `/busqueda` y `/[categoria]` (BQ-E): es el mismo `ProvinciaDialogo` y el mismo
 * `aria-label`, así que el gesto no se duplica. Quien llame desde el panel espera después
 * a la URL — allí elegir navega.
 *
 * El nombre es el EXACTO de `lib/provincias.ts`, grafía cooficial incluida
 * (`Alicante/Alacant`, `Valencia/València`…): es el mismo string que viaja en
 * `?province=` y contra el que el backend filtra con un `=` exacto
 * (`search.service.ts`). Pasar aquí un nombre aproximado es el defecto que el diálogo
 * existe para hacer imposible, así que tampoco se le consiente al test.
 */
export async function elegirProvincia(page: Page, nombre: string): Promise<void> {
  await elegirEnDialogo(page, 'Provincia', nombre);
}
