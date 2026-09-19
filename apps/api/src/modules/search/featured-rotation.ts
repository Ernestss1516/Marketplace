/**
 * ROTACIÓN DE DESTACADOS — LA ARITMÉTICA DEL ANILLO, en un solo sitio.
 *
 * POR QUÉ ESTE MÓDULO EXISTE. Estas cuatro cosas vivían dentro de `search.controller.ts`, que
 * era su único consumidor. Dejaron de serlo cuando el diálogo de compra pasó a enseñarle al
 * vendedor cuánta vitrina le tocaría (R4): esa cifra tiene que salir de LA MISMA fórmula que
 * reparte los turnos, no de una copia. Si la ventana cambia, la promesa cambia con ella — y
 * eso sólo se puede garantizar si hay una fórmula, no dos.
 *
 * ES ARITMÉTICA PURA: ni Nest, ni Meilisearch, ni base de datos. Por eso puede importarlo
 * también el módulo de facturación sin arrastrar nada del de búsqueda.
 */

/**
 * Tamaño del bloque «Promocionados» (política de ordenación C, RÁFAGA 1). Son los huecos que
 * se reparten: TODA la aritmética de abajo sale de aquí y del número de candidatos.
 */
export const FEATURED_BLOCK_SIZE = 4;

/**
 * La duración de la ventana: cada cuánto cambia el turno.
 *
 * 15 MINUTOS (diseño D1) es el equilibrio entre las dos cosas que se pelean: más corta reparte
 * antes (el ciclo con N=50 dura 3 h 15 en vez de 13 h) pero hace que el bloque cambie mientras
 * alguien navega; más larga es más estable pero condena a los últimos del anillo a esperar.
 * Quince minutos es más que una sesión de navegación típica, así que el visitante corriente ve
 * UN bloque estable de principio a fin.
 *
 * SE AJUSTA POR ENTORNO, no por `Setting`: la búsqueda no toca Postgres
 * (`apps/api/CLAUDE.md`), así que leer un ajuste de base de datos en la ruta más caliente del
 * sitio está descartado. Mismo molde que `MEILI_INDEX_NAME`.
 *
 * LA GUARDA NO ES PARANOIA: un `FEATURED_ROTATION_WINDOW_MINUTES=0` (o un valor con una coma
 * mal puesta) daría una ventana de cero segundos y `Math.floor(x / 0) = Infinity`, y de ahí
 * `Infinity % grupos = NaN`: el bloque se quedaría vacío en todo el sitio por un typo en un
 * `.env`. Ante cualquier valor que no sea un número positivo, se usa el de por defecto.
 */
const VENTANA_POR_DEFECTO_MINUTOS = 15;
const ventanaPedida = Number(process.env.FEATURED_ROTATION_WINDOW_MINUTES);
export const FEATURED_ROTATION_WINDOW_MINUTES =
  Number.isFinite(ventanaPedida) && ventanaPedida > 0 ? ventanaPedida : VENTANA_POR_DEFECTO_MINUTOS;
export const FEATURED_ROTATION_WINDOW_SECONDS = FEATURED_ROTATION_WINDOW_MINUTES * 60;

const MINUTOS_AL_DIA = 24 * 60;

/**
 * Qué grupo del anillo le toca a la ventana en curso (1-indexado, como las páginas de
 * Meilisearch).
 *
 * EL CURSOR ES EL RELOJ, Y NO HAY MÁS ESTADO QUE ESE. La ventana se deriva del epoch UTC
 * (`floor(ahora / duración)`), así que dos instancias del backend calculan el mismo turno sin
 * hablar entre ellas, no hay contador que resetear, no hay cron, y dada una hora y un número de
 * grupos la salida es única — es decir, reproducible cuando haya que depurarla.
 *
 * EL `+ 1` NO ES COSMÉTICO: las páginas de Meilisearch empiezan en 1. Sin él, una de cada
 * `grupos` ventanas pediría la página 0 y el bloque saldría vacío o desalineado.
 *
 * Con `grupos <= 1` no hay nada que rotar (todos los destacados caben en el bloque) y la
 * respuesta es siempre la página 1 — el caso mayoritario del sitio.
 */
export function grupoDeLaVentana(
  ahoraMs: number,
  grupos: number,
  ventanaSegundos: number = FEATURED_ROTATION_WINDOW_SECONDS,
): number {
  if (!Number.isFinite(grupos) || grupos <= 1) return 1;
  const ventana = Math.floor(ahoraMs / 1000 / ventanaSegundos);
  return (ventana % grupos) + 1;
}

/**
 * CÓMO SE PARTE EL ANILLO EN TURNOS — A PARTES IGUALES, y no llenando hasta agotar.
 *
 * ─── EL DEFECTO QUE ESTO CIERRA ──────────────────────────────────────────────────
 *
 * El anillo se recorría con la paginación de Meilisearch, que llena las páginas CON
 * AVIDEZ: `hitsPerPage` fijo y el resto para la última. Con cinco destacados y cuatro
 * huecos, los grupos salían **[4, 1]**: durante quince minutos el bloque enseña cuatro
 * anuncios y durante los quince siguientes enseña **uno**. El de ese grupo paga lo mismo
 * y comparte vitrina con nadie… porque no hay nadie con quien compartirla: su turno es
 * un bloque de una sola tarjeta, y el visitante ve una sección casi vacía.
 *
 * No es un caso raro: pasa siempre que el número de destacados no es múltiplo del bloque
 * y el resto es pequeño. Con trece destacados, **[4, 4, 4, 1]**.
 *
 * ─── POR QUÉ `ceil(N / grupos)` NO BASTA, aunque lo parezca ──────────────────────
 *
 * La salida evidente —subir el tamaño de página a `ceil(N / grupos)`— arregla unos casos
 * y deja otros intactos, porque **sigue siendo una página de tamaño fijo**. Con N=13 y
 * bloque 4: `grupos = 4`, `ceil(13/4) = 4`, y los grupos vuelven a ser **[4, 4, 4, 1]**.
 * No cambia nada justo en el caso peor.
 *
 * El reparto de verdad necesita que los grupos tengan **tamaños distintos entre sí**: los
 * primeros `resto` llevan uno más que los demás. Eso no se puede expresar con un número
 * de página, y por eso el anillo pasa a pedirse por `offset`/`limit`.
 *
 * ─── LA ARITMÉTICA ───────────────────────────────────────────────────────────────
 *
 *     grupos = ceil(N / tamaño)          ← no cambia: es el nº de turnos del ciclo
 *     base   = floor(N / grupos)
 *     resto  = N % grupos                ← cuántos grupos llevan uno de más
 *
 * Con N=5 y tamaño 4: `grupos=2`, `base=2`, `resto=1` → **[3, 2]**.
 * Con N=13 y tamaño 4: `grupos=4`, `base=3`, `resto=1` → **[4, 3, 3, 3]**.
 *
 * DOS PROPIEDADES, y las dos importan:
 *
 *   · **Ningún grupo pasa de `tamaño`.** El mayor es `ceil(N/grupos)`, y como
 *     `grupos ≥ N/tamaño`, eso es `≤ tamaño`. El bloque nunca recibe más de lo que
 *     puede pintar — que es lo que hace de este cambio una precondición segura para
 *     agrandarlo después.
 *   · **Cada destacado sale exactamente una vez por ciclo.** Los grupos son una
 *     PARTICIÓN de los N: los tramos son contiguos, no se solapan y cubren el total.
 *     Ni se pierde ni se repite ninguno, que es la promesa que sostiene la rotación.
 *
 * EL NÚMERO DE GRUPOS NO CAMBIA, y por eso `cuotaDeVitrina` —la cifra que se le enseña
 * al vendedor antes de cobrarle— sigue siendo exactamente la misma: cada anuncio sigue
 * saliendo un turno de cada `grupos`, o sea `1440 / grupos` minutos al día. Lo que cambia
 * es que ese turno ya no puede tocarle casi vacío.
 */
export interface RepartoDelAnillo {
  /** Cuántos destacados se reparten el anillo. */
  candidatos: number;
  /** En cuántos turnos se parte el ciclo. `ceil(N / tamaño)`, como siempre. */
  grupos: number;
  /** El grupo más grande. Los demás llevan esto o uno menos. */
  mayor: number;
  /** El grupo más pequeño. `mayor - menor` es 0 o 1, nunca más. */
  menor: number;
}

export function repartoDelAnillo(
  candidatos: number,
  tamañoDelBloque: number = FEATURED_BLOCK_SIZE,
): RepartoDelAnillo {
  const n = Math.max(0, Math.floor(candidatos));
  const tamaño = Math.max(1, Math.floor(tamañoDelBloque));
  // Sin candidatos no hay anillo. Se devuelve `grupos: 1` —y no 0— porque quien llama lo
  // usa como divisor y como argumento de `grupoDeLaVentana`; el bloque vacío lo resuelve
  // el `limit: 0` del tramo, no un caso especial repartido por el controlador.
  if (n === 0) return { candidatos: 0, grupos: 1, mayor: 0, menor: 0 };

  const grupos = Math.ceil(n / tamaño);
  const base = Math.floor(n / grupos);
  const resto = n % grupos;
  return { candidatos: n, grupos, mayor: resto > 0 ? base + 1 : base, menor: base };
}

/**
 * El tramo del conjunto ordenado que le toca a un turno: `[offset, offset + limit)`.
 *
 * LOS `resto` PRIMEROS GRUPOS LLEVAN UNO MÁS, y por eso el desplazamiento no es un
 * múltiplo: hasta `resto` hay que contar los de más que ya han pasado por delante, y a
 * partir de ahí ese extra deja de crecer (`min(i, resto)`).
 *
 * `turno` es 1-indexado, como lo devuelve `grupoDeLaVentana`. Un turno fuera de rango se
 * acota en vez de devolver un tramo imposible: un `offset` negativo o más allá del final
 * vaciaría el bloque en todo el sitio, y eso no puede depender de una aritmética que
 * alguien toque más adelante.
 */
export function tramoDelGrupo(
  candidatos: number,
  turno: number,
  tamañoDelBloque: number = FEATURED_BLOCK_SIZE,
): { offset: number; limit: number } {
  const { candidatos: n, grupos } = repartoDelAnillo(candidatos, tamañoDelBloque);
  if (n === 0) return { offset: 0, limit: 0 };

  const i = Math.min(Math.max(Math.floor(turno), 1), grupos) - 1;
  const base = Math.floor(n / grupos);
  const resto = n % grupos;
  return { offset: i * base + Math.min(i, resto), limit: base + (i < resto ? 1 : 0) };
}

/** Lo que le toca a UN anuncio cuando `candidatos` se reparten el bloque. */
export interface CuotaDeVitrina {
  /** Cuántos anuncios se reparten los huecos (el que pregunta, incluido). */
  candidatos: number;
  /** En cuántos grupos se parte el anillo: `ceil(candidatos / 4)`. Es la longitud del ciclo. */
  grupos: number;
  /** `true` cuando todos caben en el bloque y por tanto nadie espera turno. */
  siempre: boolean;
  /** Cuánto sale en el bloque, al día, cada uno de los candidatos. */
  minutosDeVitrinaAlDia: number;
  /** Lo que tarda el anillo en dar una vuelta — y por tanto la espera máxima de un recién llegado. */
  cicloMinutos: number;
}

/**
 * LA CIFRA QUE SE LE ENSEÑA AL VENDEDOR ANTES DE COBRARLE, y la misma con la que se reparte.
 *
 * De dónde sale, sin trucos: cada anuncio ocupa EXACTAMENTE un grupo por ciclo, durante una
 * ventana. Si el anillo tiene `grupos` grupos, el ciclo dura `grupos` ventanas, y en un día
 * caben `1440 / (grupos · ventana)` ciclos — luego cada anuncio sale `1440 / grupos` minutos al
 * día. Con cuatro huecos y doce candidatos: tres grupos, ocho horas cada uno. Es la tabla del
 * §2 del diseño, calculada en vez de copiada.
 *
 * `candidatos` INCLUYE A QUIEN PREGUNTA, y esto no es un detalle: quien está a punto de comprar
 * todavía no está entre los vigentes, así que calcular con los que ya hay le prometería una
 * cuota que dejará de ser cierta EN EL MISMO INSTANTE EN QUE PAGUE. Con cuatro destacados en su
 * categoría, la cuenta ingenua diría «saldrás siempre» y la verdad es que pasarían a ser cinco
 * y saldría media jornada. Quien llama pasa `vigentes + 1`.
 */
export function cuotaDeVitrina(
  candidatos: number,
  tamañoDelBloque: number = FEATURED_BLOCK_SIZE,
  ventanaMinutos: number = FEATURED_ROTATION_WINDOW_MINUTES,
): CuotaDeVitrina {
  const enJuego = Math.max(1, Math.floor(candidatos));
  const grupos = Math.max(1, Math.ceil(enJuego / tamañoDelBloque));
  return {
    candidatos: enJuego,
    grupos,
    siempre: grupos <= 1,
    minutosDeVitrinaAlDia: MINUTOS_AL_DIA / grupos,
    cicloMinutos: grupos * ventanaMinutos,
  };
}
