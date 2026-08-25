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
