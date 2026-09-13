import type { HeroHeight } from '@/types/home-blocks';

/**
 * ══ LA BANDA DEL HERO, EN UN SOLO SITIO ══════════════════════════════════════════════
 *
 * La `<section>` a sangre que envuelve al hero: el ambiente del modelo, el patrón
 * superpuesto, la altura y el contenedor centrado. `HomeHero` sigue siendo sólo el
 * CONTENIDO —el rótulo, el `<h1>` y el subtítulo—, que es el reparto que ya existía.
 *
 * ── EL DEFECTO QUE CERRÓ (ráfaga C) ─────────────────────────────────────────────────
 *
 * La banda vivía copiada en dos ficheros: `(public)/(home)/page.tsx` y
 * `admin/portada/_components/PortadaPreview.tsx`, este último con un comentario que lo
 * admitía («Mismo envoltorio que (home)/page.tsx»). Mientras la banda fue `border-b
 * bg-primary/5` la copia costaba poco. En cuanto ganó ambiente y patrón, las dos
 * habrían divergido — y la que diverge es **el preview del editor de portada, que es
 * obligatorio porque guardar ES publicar**. Un preview que miente es peor que no tenerlo.
 *
 * Es el mismo argumento por el que `PortadaPreview` ya reusa `HomeHero` y
 * `HomeBlockRenderer`: «es lo que hace que el preview no pueda mentir».
 *
 * ── Y POR QUÉ LA ALTURA ENTRA POR AQUÍ (ráfaga D) ───────────────────────────────────
 *
 * Porque es propiedad de la BANDA, no del contenido: `HomeHero` no sabe —ni tiene por
 * qué— cuánto espacio ocupa lo que pinta. Que la altura sea una prop de este envoltorio
 * es además lo que permite que el preview enseñe la altura elegida sin que el editor
 * tenga que reproducir nada.
 *
 * ── LOS DOS NODOS SON COMUNES A LOS CINCO MODELOS ───────────────────────────────────
 *
 * La `<section>` y el `<div>` del patrón se emiten SIEMPRE, para todos. Un modelo que no
 * quiera patrón no omite el nodo: declara `--hero-patron: none` y el nodo se pinta
 * transparente (es lo que hacen el Modelo 0 y el de prueba). Si un modelo pudiera
 * quitarlo, el test de invariancia se pondría rojo — y tendría razón.
 *
 * El ambiente y el patrón van por `style` y no por clase porque son valores de token
 * completos (`background` con sus capas), no utilidades: así los documentó la ráfaga A.
 * Que vayan en `style` es además irrelevante para la invariancia, que ignora `class` y
 * `style` por ser el revestimiento.
 */

/**
 * ══ ESCAPARATE · RÁFAGA D — LAS TRES ALTURAS ═════════════════════════════════════════
 *
 * Clases ESTÁTICAS en un `Record`, nunca interpoladas. Es la regla del repo, escrita ya
 * en `HomeHero` (`ROTATION_CLASS`) y en tres renderizadores de bloque: Tailwind purga lo
 * que no encuentra escrito, así que un `py-[${n}]` compuesto no existiría en el CSS final.
 *
 * `pantalla` combina la altura (`.hero-pantalla`, globals.css) con `flex items-center`:
 * el contenido se centra en el espacio que sobra en vez de quedarse pegado arriba, que es
 * lo que distingue un hero a pantalla completa de un hero con mucho padding.
 *
 * El padding se conserva en las tres: con `min-height`, si el contenido crece la banda
 * crece — y sin padding el titular tocaría el borde justo en ese caso.
 */
const ALTURA_CLASS: Record<HeroHeight, string> = {
  normal: 'py-10 md:py-14',
  alto: 'py-16 md:py-24',
  pantalla: 'hero-pantalla flex items-center py-16 md:py-24',
};

export function HomeHeroBanda({
  altura = 'normal',
  children,
}: {
  altura?: HeroHeight;
  children: React.ReactNode;
}) {
  /**
   * CAE A `normal` SI LA CLAVE NO ESTÁ, y no es paranoia: `heroHeight` es una columna de
   * texto validada por el DTO, pero una fila editada a mano en la base o una config de
   * una versión futura podrían traer otra cosa. Sin esta red, la clase saldría
   * `undefined` y la banda perdería hasta el padding. Mismo criterio defensivo que
   * `ROTATION_CLASS` con un número de opciones fuera de rango.
   */
  const claseDeAltura = ALTURA_CLASS[altura] ?? ALTURA_CLASS.normal;

  return (
    <section
      className="relative overflow-hidden border-b"
      style={{ background: 'var(--hero-ambiente)' }}
    >
      {/* El patrón, SIEMPRE emitido. `aria-hidden` y sin eventos: es ambiente, no
          contenido — no lo anuncia un lector de pantalla ni intercepta un clic. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{ background: 'var(--hero-patron)' }}
      />

      {/* `relative` para quedar POR ENCIMA del patrón sin inventar un z-index: dos
          hermanos posicionados se apilan en orden de documento, y éste va después. */}
      <div className={`container relative mx-auto px-4 ${claseDeAltura}`}>
        <div className="mx-auto w-full max-w-4xl text-center">{children}</div>
      </div>
    </section>
  );
}
