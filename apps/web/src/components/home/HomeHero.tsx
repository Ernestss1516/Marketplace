import type { HomepageConfig } from '@/types/home-blocks';

/**
 * Hero de la portada: el <h1> (parte fija + opciones rotativas) y el subtítulo.
 * Server Component puro — sin 'use client', sin JS: la rotación es CSS
 * (globals.css, reglas `hero-rot-*`), ver docs/diseno-portada.md §3.
 *
 * NO pinta la <section> ni el contenedor: los envuelve la página, que es quien
 * decide el ancho completo y el fondo (§3.5 del diseño). Este componente es el
 * CONTENIDO del hero, y por eso encaja igual dentro del hero actual —que
 * todavía lleva el buscador debajo— que dentro del que quede tras RP.2.
 *
 * El hero NO pasa por el motor de bloques: es campo propio de la config, fuera
 * del array. Esa es la decisión que permite que ningún bloque conozca su índice
 * y que el `switch` con `assertUnreachable` del renderizador siga siendo
 * homogéneo (§2.3).
 */

/**
 * Mapa de literales ESTÁTICOS, no `hero-rot-${n}`. Dos motivos:
 *  1. Tailwind escanea el código en busca de nombres de clase escritos; una
 *     plantilla interpolada es invisible para él. Las reglas viven fuera de
 *     @layer (y por tanto fuera del purge), pero depender de eso sería frágil.
 *  2. Hace explícito que solo hay animación para N = 2…6, que es el tope que el
 *     backend valida (MAX_HERO_ROTATING_OPTIONS). Una opción de más aquí no
 *     "casi funciona": no encuentra clase y el título se queda fijo, que es la
 *     degradación correcta.
 */
const ROTATION_CLASS: Record<number, string> = {
  2: 'hero-rot-2',
  3: 'hero-rot-3',
  4: 'hero-rot-4',
  5: 'hero-rot-5',
  6: 'hero-rot-6',
};

export function HomeHero({ config }: { config: HomepageConfig }) {
  const options = config.heroRotatingOptions;
  // N = 0 → no se emite el <span> contenedor en absoluto: un título estático no
  // necesita andamiaje. N = 1 → se emite, pero sin clase de animación (nada que
  // rotar). Ambos son casos soportados, no errores (§3.2).
  const rotationClass = ROTATION_CLASS[options.length];

  return (
    <>
      <h1 className="mb-8 text-2xl font-bold tracking-tight md:text-3xl">
        {config.heroStaticTitle}
        {options.length > 0 && (
          <>
            {' '}
            <span
              className={rotationClass ? `hero-rot ${rotationClass}` : 'hero-rot'}
              // La velocidad es un valor por INSTANCIA que fija el admin, así que
              // viaja como custom property inline: Tailwind solo genera clases
              // estáticas y no puede expresar "3000 ms" configurable.
              style={
                {
                  '--rot-ms': config.heroRotationMs,
                  '--n': options.length,
                } as React.CSSProperties
              }
            >
              {options.map((option, index) => (
                <span
                  key={index}
                  className="hero-rot-item"
                  style={{ '--i': index } as React.CSSProperties}
                  // ACCESIBILIDAD (§3.3): solo la PRIMERA opción es contenido
                  // semántico. Sin esto un lector de pantalla leería el titular
                  // como una ristra ("Compra y vende coches bicicletas
                  // muebles"); con esto anuncia una frase completa y coherente.
                  // Las demás son decoración visual.
                  // Nada de aria-live: anunciar un cambio de titular cada pocos
                  // segundos es hostil, y esto es un adorno, no una
                  // actualización de estado que el usuario deba conocer.
                  aria-hidden={index > 0 ? true : undefined}
                >
                  {option}
                </span>
              ))}
            </span>
          </>
        )}
      </h1>

      {config.heroSubtitle && (
        // Texto PLANO, no markdown: no se abre la tubería de sanitización para
        // un párrafo bajo un titular (§2.2).
        <p className="mb-8 -mt-4 text-base text-muted-foreground md:text-lg">{config.heroSubtitle}</p>
      )}
    </>
  );
}
