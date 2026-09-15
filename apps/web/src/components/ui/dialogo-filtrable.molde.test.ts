import * as fs from 'fs';
import * as path from 'path';

/**
 * ══ BUSCADOR · BQ-E — EL MOLDE NO SABE DE DOMINIO, Y AHORA HAY QUIEN LO VIGILE ═══════
 *
 * ── QUÉ SE AFIRMA, Y POR QUÉ HACÍA FALTA JUSTO EN ESTA RÁFAGA ─────────────────────
 *
 * `DialogoFiltrable` nació con una promesa escrita en su cabecera: *«no conoce categorías
 * ni provincias, no recorre árboles, no lee constantes, no navega, no toca la URL y no
 * llama a ninguna API»*. Mientras tuvo UN solo cliente —el buscador de la portada— esa
 * promesa era barata: la portada sólo escribe estado, así que nada empujaba hacia dentro.
 *
 * BQ-E le trae el segundo, y es el que tira: en `/busqueda` elegir **navega**. La salida
 * fácil habría sido enseñarle al molde un modo `navegar` —una prop `href`, un `router`
 * dentro, un `onElegir` que además empuje la URL—, y el §12.5 del diseño dejó esa puerta
 * abierta a propósito («decidir si el de /busqueda deja de navegar o si el molde admite un
 * modo que navegue»). Se cerró por el otro lado: **la navegación vive en el adaptador**
 * (`CategorySelect.goTo`, `FilterPanel.update`), y el molde no se tocó.
 *
 * Esto es lo que impide que esa decisión se deshaga sin querer en la ráfaga siguiente. Un
 * `useRouter` dentro de la capa funcionaría perfectamente en `/busqueda` y rompería la
 * portada sólo cuando alguien mirase — que es la clase de regresión que no da error de
 * compilación ni mueve un píxel en las capturas.
 *
 * ── SE MIDE SOBRE EL FUENTE, Y NO RENDERIZANDO ────────────────────────────────────
 *
 * Porque lo que se vigila es una DEPENDENCIA, no un comportamiento: un molde que importa
 * `next/navigation` ya perdió la propiedad aunque en la rama que el test recorra no llegue
 * a llamarlo. Mismo instrumento que `anillo-de-foco.test.ts`, y por el mismo motivo: el
 * defecto que hay que cazar es textual.
 *
 * Los comentarios se descartan antes de mirar — si no, este mismo fichero y las cabeceras
 * del molde (que nombran `provincias`, `CategoriaDialogo` y `/busqueda` para explicar por
 * qué NO están dentro) contarían como infracción, y una barrera que se dispara con su
 * propia documentación no vigila nada.
 */

const UI = __dirname;

/** Los dos ficheros del molde: el disparador y la capa que llega por `next/dynamic`. */
const MOLDE = ['dialogo-filtrable.tsx', 'dialogo-filtrable-capa.tsx'];

/** El fuente sin comentarios: sólo lo que llega al navegador cuenta. */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const codigo = MOLDE.map((nombre) => ({
  nombre,
  fuente: sinComentarios(fs.readFileSync(path.join(UI, nombre), 'utf8')),
}));

/**
 * Lo que un molde de presentación no puede nombrar.
 *
 * Cada entrada es un modo de fallo concreto y no una sospecha genérica:
 *  · la navegación es la que BQ-E tuvo la tentación de meter dentro;
 *  · las tres fuentes de dominio son las que los adaptadores existen para traducir;
 *  · `fetch` cierra la tercera mitad de la promesa de la cabecera («no llama a ninguna
 *    API»), que hoy nadie ha pedido pero es el siguiente atajo natural el día que una
 *    lista sea demasiado larga para viajar con la página.
 */
const PROHIBIDO: readonly [patron: RegExp, porque: string][] = [
  [/next\/navigation/, 'navegar es cosa del adaptador (CategorySelect.goTo, FilterPanel.update)'],
  [/\brouter\./, 'navegar es cosa del adaptador'],
  [/window\.location/, 'navegar es cosa del adaptador'],
  [/@\/lib\/provincias/, 'las 52 provincias las traduce ProvinciaDialogo'],
  [/@\/lib\/category-tree/, 'el árbol lo aplana CategoriaDialogo'],
  [/@\/types/, 'el molde recibe `OpcionFiltrable`, no tipos de negocio'],
  [/\bfetch\s*\(/, 'la lista llega por props, ya cargada'],
];

describe('BQ-E — el molde del diálogo filtrable sigue sin saber de dominio', () => {
  /**
   * LA RED DE LA PROPIA PRUEBA: si el molde se renombrara o se partiera en otros ficheros,
   * `readFileSync` ya habría reventado — pero un fuente vacío pasaría todas las
   * comprobaciones de abajo en verde sin haber mirado nada.
   */
  it('lee los dos ficheros del molde, o no está midiendo nada', () => {
    expect(codigo.map(({ nombre }) => nombre)).toEqual(MOLDE);
    for (const { nombre, fuente } of codigo) {
      expect({ nombre, vacio: fuente.trim().length < 500 }).toEqual({ nombre, vacio: false });
    }
  });

  it.each(PROHIBIDO)('no nombra %s — %s', (patron, porque) => {
    const infractores = codigo
      .filter(({ fuente }) => patron.test(fuente))
      .map(({ nombre }) => `${nombre} (${porque})`);
    expect(infractores).toEqual([]);
  });

  /**
   * Y LA OTRA MITAD DE LA PRUEBA DE REUTILIZACIÓN: que los dos clientes sean de verdad dos.
   * Sin esto, el molde podría quedarse limpio porque nadie lo usa — que es la forma
   * aburrida de cumplir una regla de acoplamiento.
   */
  it('lo montan los dos adaptadores de dominio, y ésos son los que saben', () => {
    const busqueda = path.join(UI, '..', 'busqueda');
    const leer = (n: string) => fs.readFileSync(path.join(busqueda, n), 'utf8');

    expect(sinComentarios(leer('CategoriaDialogo.tsx'))).toContain('DialogoFiltrable');
    expect(sinComentarios(leer('ProvinciaDialogo.tsx'))).toContain('DialogoFiltrable');

    // El segundo cliente del molde (BQ-E): el mismo adaptador de categoría, con un
    // `onElegir` que navega. Si alguien volviera a un `<select>` aquí, esto lo dice.
    const selector = sinComentarios(leer('CategorySelect.tsx'));
    expect(selector).toContain('CategoriaDialogo');
    expect(selector).toContain('next/navigation');
    expect(selector).not.toMatch(/<select/);

    const panel = sinComentarios(leer('FilterPanel.tsx'));
    expect(panel).toContain('ProvinciaDialogo');
    // El panel conserva OTROS `<select>` (orden, condición, radio): lo que no puede volver
    // es el de provincia, que es el que tenía el problema del valor exacto.
    expect(panel).not.toContain('PROVINCIAS');
  });
});
