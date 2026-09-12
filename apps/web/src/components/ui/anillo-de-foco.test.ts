import * as fs from 'fs';
import * as path from 'path';

/**
 * ══ E14 · LA BANDA DEL ANILLO DE FOCO SALE DEL TEMA, NUNCA DE UN BLANCO A FUEGO ══════
 *
 * ── QUÉ VIGILA ────────────────────────────────────────────────────────────────────
 *
 * `ring-offset-2` dibuja una banda de 2 px entre el elemento y el anillo de foco, y su
 * color sale de `--tw-ring-offset-color`, que **por defecto es `#fff` literal**. Para que
 * esa banda sea el lienzo del tema hay que decirlo: `ring-offset-background`.
 *
 * Nueve de los diez componentes con anillo lo decían. `badge.tsx` no, desde que shadcn lo
 * generó, y **nadie podía verlo**: el `--background` del Modelo 0 es `0 0% 100%`, el mismo
 * blanco, así que el defecto es invisible mientras todos los temas sean claros.
 *
 * ── POR QUÉ HACE FALTA UNA PRUEBA Y NO BASTA CON HABERLO ARREGLADO ───────────────
 *
 * Porque es un defecto que **ninguna otra barrera puede cazar**:
 *
 *  · las capturas no lo ven — el anillo sólo existe en `:focus`;
 *  · la validación de contraste no lo ve — mide TOKENS, y este blanco no es un token: es
 *    un valor por defecto de Tailwind que no pasa por el sistema de estilo;
 *  · el test de invariancia no lo ve — ignora `class`, que es donde vive.
 *
 * Y en cuanto exista una versión de lienzo oscuro sería un halo blanco alrededor de cada
 * elemento enfocado, con el anillo midiéndose contra un vecino que el tema no controla.
 *
 * ── SE MIDE POR FICHERO, Y NO POR CADENA — LA PRIMERA VERSIÓN SE PASÓ DE LISTA ────
 *
 * Lo natural parecía exigirlo dentro de cada cadena literal. **Es más estricto de lo que
 * el lenguaje permite**: las clases de un elemento se componen a menudo de varias cadenas
 * adyacentes que `cn()` une —`MunicipioAutocomplete` declara la banda en una línea y pide
 * el desplazamiento en la siguiente, y es correcto—, así que esa regla marcaba código
 * bueno.
 *
 * El fichero es la granularidad honesta para una comprobación textual, y es exactamente la
 * que caza el defecto que ocurrió: un componente que **no declara la banda en ninguna
 * parte**. Se descartan los comentarios antes de mirar, o el propio texto que explica esto
 * contaría como declaración — y una barrera que se satisface a sí misma con su comentario
 * no es una barrera.
 *
 * ⚠ NO exige `ring-offset-2` a quien no lo use: los 71 usos de `focus:ring-2` sin banda
 * son legítimos —el anillo toca la superficie de verdad, y para ésos están las parejas
 * «anillo sobre la tarjeta / la capa flotante» que E14 añadió a la validación—.
 */

const RAIZ = path.join(__dirname, '..', '..');

function ficheros(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const completo = path.join(dir, e.name);
    if (e.isDirectory()) return ficheros(completo);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [completo] : [];
  });
}

/** El fuente sin comentarios: sólo lo que llega al navegador cuenta como declaración. */
function sinComentarios(fuente: string): string {
  return fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('Toda banda de anillo de foco toma su color del tema', () => {
  const conBanda = ficheros(RAIZ)
    .map((fichero) => ({
      fichero: path.relative(RAIZ, fichero),
      codigo: sinComentarios(fs.readFileSync(fichero, 'utf8')),
    }))
    .filter(({ codigo }) => codigo.includes('ring-offset-2'));

  /**
   * LA RED DE LA PROPIA PRUEBA. Si el recorrido dejara de encontrar ficheros —un cambio de
   * estructura de carpetas, una extensión nueva—, la comprobación de abajo pasaría en
   * verde sin haber mirado nada, que es la forma más silenciosa de perder una barrera.
   */
  it('encuentra los ficheros que piden banda, o no está midiendo nada', () => {
    expect(conBanda.length).toBeGreaterThanOrEqual(10);
  });

  it('ninguno se queda con el blanco por defecto de Tailwind', () => {
    const huerfanos = conBanda
      .filter(({ codigo }) => !codigo.includes('ring-offset-background'))
      .map(({ fichero }) => fichero);
    expect(huerfanos).toEqual([]);
  });
});
