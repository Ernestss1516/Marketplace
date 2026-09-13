/**
 * ══ ESCAPARATE · RÁFAGA C — LA BANDA DEL HERO, EN UN SOLO SITIO ══════════════════════
 *
 * La `<section>` a sangre que envuelve al hero: el ambiente del modelo, el patrón
 * superpuesto y el contenedor centrado. `HomeHero` sigue siendo sólo el CONTENIDO —el
 * `<h1>` y el subtítulo—, que es el reparto que ya existía y que esta pieza no cambia:
 * lo que cambia es que la banda deja de estar escrita dos veces.
 *
 * ── EL DEFECTO QUE CIERRA, Y NO ES TEÓRICO ──────────────────────────────────────────
 *
 * La banda vivía copiada en dos ficheros: `(public)/(home)/page.tsx` y
 * `admin/portada/_components/PortadaPreview.tsx`, este último con un comentario que lo
 * admitía («Mismo envoltorio que (home)/page.tsx»). Mientras la banda fue `border-b
 * bg-primary/5` la copia costaba poco. En cuanto gana ambiente y patrón, las dos
 * divergen — y la que diverge es **el preview del editor de portada, que es obligatorio
 * porque guardar ES publicar**. Un preview que miente es peor que no tenerlo.
 *
 * Es el mismo argumento por el que `PortadaPreview` ya reusa `HomeHero` y
 * `HomeBlockRenderer`: «es lo que hace que el preview no pueda mentir».
 *
 * ── POR QUÉ LA ALTURA NO ESTÁ AQUÍ TODAVÍA ──────────────────────────────────────────
 *
 * Porque el hero a pantalla completa es la ráfaga D, y cuando llegue **tendrá que entrar
 * por esta puerta**: un `min-height: 100svh` dentro de un formulario de administración es
 * inusable, así que la altura será una prop de este envoltorio y el preview pasará una
 * versión contenida. Ése es el motivo técnico de que el reparto contenido/envoltorio se
 * mantenga en vez de meterlo todo en `HomeHero`.
 *
 * ── LOS DOS NODOS NUEVOS SON COMUNES A LOS CINCO MODELOS ────────────────────────────
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
export function HomeHeroBanda({ children }: { children: React.ReactNode }) {
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
      <div className="container relative mx-auto px-4 py-10 md:py-14">
        <div className="mx-auto max-w-4xl text-center">{children}</div>
      </div>
    </section>
  );
}
