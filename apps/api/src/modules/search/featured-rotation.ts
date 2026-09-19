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

/**
 * EL TOPE DE LO QUE SE SIRVE AL BLOQUE — dos filas de cuatro (decisión D-7).
 *
 * ES REDUNDANTE HOY Y SE ESCRIBE IGUAL. La rejilla del bloque no pasa de cuatro columnas
 * (`md:grid-cols-4`), así que «dos filas» ya son ocho por construcción y este tope no muerde
 * en ningún viewport. Está aquí como red: el día que alguien añada un `xl:grid-cols-5`, lo
 * que impide que el servidor empiece a mandar diez es esta línea, no que se acuerde.
 */
export const FEATURED_BLOCK_MAX_VISIBLE = 2 * FEATURED_BLOCK_SIZE;

/**
 * CUÁNTAS TARJETAS DEL BLOQUE VE **TODO EL MUNDO**, sea cual sea su pantalla.
 *
 * El bloque se sirve entero (hasta ocho) y el CSS enseña las que caben: cuatro en móvil, seis
 * en tableta, ocho en escritorio. **Cuatro es el suelo** — dos columnas por dos filas, el tramo
 * más estrecho—, así que ésas las ve cualquiera.
 *
 * ─── PARA QUÉ SIRVE ESTE NÚMERO: PARA NO INFLAR «VECES LISTADO» ─────────────────
 *
 * El contador de impresiones se alimentaba de lo SERVIDO, y servido y visto dejaron de ser lo
 * mismo en cuanto el bloque pasó a dos filas: en un móvil se mandan ocho y se ven cuatro. Como
 * «veces listado» es **un dato que el vendedor Pro usa para decidir si el destacado le sale a
 * cuenta**, contar las ocho le diría que su anuncio se vio el doble de lo que se vio.
 *
 * Contando sólo estas cuatro, la cifra es un **suelo**: nunca promete impresiones que no
 * ocurrieron. En un escritorio se ven ocho y se cuentan cuatro, o sea que el dato se queda
 * corto — y quedarse corto en una métrica de rentabilidad es lo aceptable; inflarla no.
 *
 * ⚠ ESTE 4 ES EL MISMO QUE `VISIBLES_POR_TRAMO.base` DEL FRONTEND
 * (`apps/web/src/components/busqueda/destacados-dos-filas.ts`), y son dos paquetes distintos,
 * así que no hay import que los ate: **si allí cambian las columnas del tramo más estrecho,
 * hay que cambiar esto**. Cada lado tiene un caso que fija el número para que el desajuste
 * salga en rojo en vez de en silencio.
 */
export const FEATURED_BLOCK_MIN_VISIBLE = FEATURED_BLOCK_SIZE;

/**
 * QUÉ TRAMOS DEL ANILLO SE SIRVEN AL BLOQUE: el turno de esta ventana **y el siguiente**.
 *
 * ─── POR QUÉ DOS GRUPOS DE CUATRO Y NO UN GRUPO DE OCHO (decisión D-3) ──────────
 *
 * El bloque pasa a enseñar dos filas en pantallas anchas, y la salida evidente —doblar el
 * tamaño del grupo a ocho— tiene un defecto que no se ve desde un escritorio: el recorte por
 * viewport deja fuera **las posiciones 5 a 8**, y la posición dentro del grupo la fija el
 * orden del anillo, no el azar. O sea que los cuatro últimos de cada grupo **no los vería
 * ningún visitante de móvil, nunca**. En un marketplace C2C el móvil suele ser la mayoría del
 * tráfico: la mitad de los huecos de pago serían invisibles para casi todo el mundo, y quien
 * cayera en esa mitad pagaría lo mismo por mucho menos.
 *
 * Con grupos de CUATRO y el escritorio pintando dos, cada destacado pasa por las cuatro
 * primeras posiciones en su propio turno. **Nadie queda en un sitio que el móvil no mira**, y
 * el escritorio simplemente adelanta el turno siguiente.
 *
 * ─── EL ENVOLTORIO NO PUEDE REPETIR A NADIE ─────────────────────────────────────
 *
 * El «siguiente» da la vuelta al anillo, así que con UN SOLO grupo el siguiente sería él
 * mismo y el bloque enseñaría dos veces las mismas tarjetas. Eso no es un detalle estético:
 * repetir es una de las tres cosas que el bloque tiene prohibidas (no inventar, no repetir,
 * no colar un no-destacado). Por eso con `grupos <= 1` se devuelve UN tramo y punto — no un
 * `dedupe` después, que sería tapar el caso en vez de no producirlo.
 *
 * ─── SE FUSIONAN CUANDO SON CONTIGUOS, que es casi siempre ──────────────────────
 *
 * Los tramos de dos turnos consecutivos son adyacentes en el conjunto ordenado, así que se
 * piden en UNA consulta. Sólo el último turno del ciclo —el que da la vuelta— necesita dos,
 * porque su continuación está al principio. Es una de cada `grupos` ventanas.
 */
export function tramosDelBloque(
  candidatos: number,
  turno: number,
  tamañoDelBloque: number = FEATURED_BLOCK_SIZE,
): { offset: number; limit: number }[] {
  const { candidatos: n, grupos } = repartoDelAnillo(candidatos, tamañoDelBloque);
  if (n === 0) return [];

  const actual = tramoDelGrupo(n, turno, tamañoDelBloque);
  // Un solo grupo: todos los destacados caben en él, no hay «siguiente» que no sea él mismo.
  if (grupos <= 1) return [actual];

  const enRango = Math.min(Math.max(Math.floor(turno), 1), grupos);
  const siguiente = tramoDelGrupo(n, (enRango % grupos) + 1, tamañoDelBloque);

  return actual.offset + actual.limit === siguiente.offset
    ? [{ offset: actual.offset, limit: actual.limit + siguiente.limit }]
    : [actual, siguiente];
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
